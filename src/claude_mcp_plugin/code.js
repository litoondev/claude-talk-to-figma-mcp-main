// This is the main code file for the Claude MCP Figma plugin
// It handles Figma API commands

// Safe color channel parser: returns a valid 0-1 number or NaN.
// Unlike `parseFloat(x) || 0`, this does NOT silently fall back to 0 (black).
function safeChannel(value) {
  if (value === undefined || value === null) return NaN;
  var n = typeof value === "number" ? value : parseFloat(value);
  return isNaN(n) ? NaN : Math.max(0, Math.min(1, n));
}

// Build a Figma paint from an {r, g, b, a?} color object.
function safePaint(color) {
  if (!color || typeof color !== "object") return null;
  var r = safeChannel(color.r);
  var g = safeChannel(color.g);
  var b = safeChannel(color.b);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  var a = safeChannel(color.a);
  return {
    type: "SOLID",
    color: { r: r, g: g, b: b },
    opacity: isNaN(a) ? 1 : a,
  };
}

// Plugin state
const state = {
  serverPort: 3055, // Default port
};

// Helper function for progress updates
function sendProgressUpdate(commandId, commandType, status, progress, totalItems, processedItems, message, payload = null) {
  const update = {
    type: 'command_progress',
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now()
  };

  // Add optional chunk information if present
  if (payload) {
    if (payload.currentChunk !== undefined && payload.totalChunks !== undefined) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }

  // Send to UI
  figma.ui.postMessage(update);
  console.log(`Progress update: ${status} - ${progress}% - ${message}`);

  return update;
}

// ─── Live Activity Tracking ────────────────────────────────────────────────
//
// Three surfaces make the agent's work visible, each covering a gap the others
// cannot:
//
//   1. Panel feed   — a scrolling log in the plugin UI. Local to the operator.
//   2. Selection    — touched nodes are selected as they change. Figma syncs
//                     selection in multiplayer, so collaborators see coloured
//                     outlines move around the canvas in real time.
//   3. Canvas overlay — a locked status frame written into the page itself.
//                     This is the only surface visible to someone who has the
//                     file open but is not running the plugin, so it is what
//                     makes progress trackable by *anyone* with file access.
//
// The overlay writes real nodes into the user's document, which shows up in
// version history and the undo stack. It is therefore OFF by default and must
// be turned on explicitly (UI toggle, or the set_activity_overlay MCP tool).

const OVERLAY_MARKER_KEY = "claudeActivityOverlay";
const OVERLAY_FRAME_NAME = "⚡ Claude Live Activity";

const activity = {
  settings: {
    overlayEnabled: false,   // writes nodes into the document — opt-in
    highlightEnabled: true,  // selection sync — free, no document mutation
    followViewport: false,   // pan the canvas to follow work — can be jarring
    cursorEnabled: false,    // synthetic multiplayer-style cursor — opt-in
    cursorLabel: "Claude",   // name shown in the cursor's pill
  },
  // Most recent entries, newest last. Bounded so a long session cannot grow
  // the plugin's memory without limit.
  log: [],
  maxLog: 40,
  overlayLogLines: 8,
  current: null,           // { command, startedAt } while a command is running
  completed: 0,
  failed: 0,
  // Serialises overlay redraws: Figma node writes are async (font loading), and
  // overlapping redraws would interleave partial text updates.
  overlayBusy: false,
  overlayDirty: false,
  // Ghost cursor animation handles.
  cursorAnim: null,
  cursorIdleTimer: null,
};

function activityTimestamp(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function prettyCommand(command) {
  return String(command || "command").replace(/_/g, " ");
}

/**
 * Record one lifecycle entry and refresh every activity surface.
 * `entry` is { kind, command, message, durationMs?, nodeIds?, nodeNames? }.
 */
function recordActivity(entry) {
  const record = Object.assign({ ts: Date.now() }, entry);

  activity.log.push(record);
  if (activity.log.length > activity.maxLog) {
    activity.log.splice(0, activity.log.length - activity.maxLog);
  }

  if (entry.kind === "started") {
    activity.current = { command: entry.command, startedAt: record.ts };
  } else if (entry.kind === "completed" || entry.kind === "error") {
    if (entry.kind === "completed") activity.completed++;
    else activity.failed++;
    activity.current = null;
  }

  // Feed the plugin panel.
  figma.ui.postMessage({
    type: "activity-entry",
    entry: record,
    state: {
      working: !!activity.current,
      currentCommand: activity.current ? activity.current.command : null,
      startedAt: activity.current ? activity.current.startedAt : null,
      completed: activity.completed,
      failed: activity.failed,
      settings: activity.settings,
    },
  });

  if (activity.settings.overlayEnabled) {
    scheduleOverlayUpdate();
  }

  // Drive the ghost cursor to whatever is being worked on. Fire-and-forget:
  // cursor movement is cosmetic and must never delay or fail a command.
  if (activity.settings.cursorEnabled && (entry.kind === "started" || entry.kind === "completed")) {
    moveCursorToNode(
      entry.nodeIds,
      entry.kind === "started" ? prettyCommand(entry.command) : null
    ).catch(() => {});
  }
}

/**
 * Select the nodes a command touched.
 *
 * Selection is per-user state, but Figma broadcasts it over multiplayer — which
 * means collaborators watching the file see the selection outline jump to each
 * element as the agent works on it. That is the cheapest possible "show live
 * movement on the canvas", and unlike the overlay it mutates nothing.
 */
async function highlightNodes(nodeIds) {
  if (!activity.settings.highlightEnabled) return;
  if (!nodeIds || !nodeIds.length) return;

  try {
    const nodes = [];
    for (const id of nodeIds.slice(0, 50)) {
      const node = await figma.getNodeByIdAsync(id);
      // Never select our own instrumentation nodes.
      if (node && node.getPluginData && (
        node.getPluginData(CURSOR_MARKER_KEY) === "1" ||
        node.getPluginData(OVERLAY_MARKER_KEY) === "1"
      )) continue;
      // Only nodes on the current page can be selected, and only real scene
      // nodes (pages and the document root are not selectable).
      if (node && !node.removed && node.type !== "PAGE" && node.type !== "DOCUMENT") {
        if (figma.currentPage.selection !== undefined) {
          // Verify the node actually lives on the current page.
          let parent = node.parent;
          let onCurrentPage = false;
          while (parent) {
            if (parent.id === figma.currentPage.id) { onCurrentPage = true; break; }
            parent = parent.parent;
          }
          if (onCurrentPage) nodes.push(node);
        }
      }
    }

    if (!nodes.length) return;
    figma.currentPage.selection = nodes;

    if (activity.settings.followViewport) {
      figma.viewport.scrollAndZoomIntoView(nodes);
    }
  } catch (err) {
    // Highlighting is cosmetic; never let it break a command.
    console.log("highlightNodes failed:", err && err.message);
  }
}

// ─── Canvas overlay ────────────────────────────────────────────────────────

async function loadOverlayFonts() {
  const candidates = [
    { family: "Inter", style: "Regular" },
    { family: "Roboto", style: "Regular" },
  ];
  const bolds = [
    { family: "Inter", style: "Bold" },
    { family: "Roboto", style: "Bold" },
  ];

  let regular = null;
  let bold = null;

  for (const font of candidates) {
    try { await figma.loadFontAsync(font); regular = font; break; } catch (e) { /* try next */ }
  }
  for (const font of bolds) {
    try { await figma.loadFontAsync(font); bold = font; break; } catch (e) { /* try next */ }
  }

  if (!regular) return null;
  return { regular, bold: bold || regular };
}

function findOverlayFrame() {
  const children = figma.currentPage.children;
  for (const child of children) {
    if (!child.removed && child.getPluginData(OVERLAY_MARKER_KEY) === "1") return child;
  }
  return null;
}

function makeText(name, fonts, useBold, size, color) {
  const text = figma.createText();
  text.name = name;
  text.fontName = useBold ? fonts.bold : fonts.regular;
  text.fontSize = size;
  text.fills = [{ type: "SOLID", color: color }];
  text.layoutAlign = "STRETCH";
  return text;
}

/**
 * Create the overlay frame, positioned just above and left of existing page
 * content so it does not sit on top of the design being worked on.
 */
async function createOverlayFrame(fonts) {
  const frame = figma.createFrame();
  frame.name = OVERLAY_FRAME_NAME;
  frame.setPluginData(OVERLAY_MARKER_KEY, "1");

  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "FIXED";
  frame.resize(340, 100);
  frame.itemSpacing = 8;
  frame.paddingTop = 16;
  frame.paddingBottom = 16;
  frame.paddingLeft = 16;
  frame.paddingRight = 16;
  frame.cornerRadius = 12;
  frame.fills = [{ type: "SOLID", color: { r: 0.09, g: 0.07, b: 0.11 } }];
  frame.strokes = [{ type: "SOLID", color: { r: 0.31, g: 0.21, b: 0.39 } }];
  frame.strokeWeight = 1;

  frame.appendChild(makeText("title", fonts, true, 13, { r: 1, g: 1, b: 1 }));
  frame.appendChild(makeText("status", fonts, true, 12, { r: 0.75, g: 0.55, b: 0.93 }));
  frame.appendChild(makeText("log", fonts, false, 11, { r: 0.68, g: 0.62, b: 0.74 }));

  // Position above the top-left of existing content.
  let minX = 0;
  let minY = 0;
  let found = false;
  for (const child of figma.currentPage.children) {
    // Ignore our own instrumentation, or the overlay would drift further away
    // from the design every time it is recreated.
    if (child === frame) continue;
    if (child.getPluginData(OVERLAY_MARKER_KEY) === "1") continue;
    if (child.getPluginData(CURSOR_MARKER_KEY) === "1") continue;
    if (typeof child.x !== "number" || typeof child.y !== "number") continue;
    if (!found) { minX = child.x; minY = child.y; found = true; }
    else { minX = Math.min(minX, child.x); minY = Math.min(minY, child.y); }
  }
  frame.x = found ? minX : 0;
  frame.y = found ? minY - frame.height - 48 : 0;

  // Locked so it cannot be dragged into the design by accident, and collapsed
  // so it does not clutter the layers panel.
  frame.locked = true;
  frame.expanded = false;

  return frame;
}

function overlayStatusLine() {
  if (activity.current) {
    const seconds = Math.max(0, Math.round((Date.now() - activity.current.startedAt) / 1000));
    return "● AI working — " + prettyCommand(activity.current.command) + " (" + seconds + "s)";
  }
  return "○ Idle — waiting for the next instruction";
}

function overlayLogLines() {
  const lines = [];
  const recent = activity.log.slice(-activity.overlayLogLines);
  for (const entry of recent) {
    const mark =
      entry.kind === "completed" ? "✓" :
      entry.kind === "error" ? "✕" :
      entry.kind === "started" ? "▶" : "·";
    const dur = entry.durationMs != null ? "  " + (entry.durationMs / 1000).toFixed(1) + "s" : "";
    lines.push(activityTimestamp(entry.ts) + "  " + mark + "  " + entry.message + dur);
  }
  return lines.length ? lines.join("\n") : "No activity yet.";
}

/** Coalesce redraw requests so bursts of commands cause one write, not many. */
function scheduleOverlayUpdate() {
  if (activity.overlayBusy) {
    activity.overlayDirty = true;
    return;
  }
  activity.overlayBusy = true;
  updateOverlay()
    .catch((err) => console.log("Overlay update failed:", err && err.message))
    .then(() => {
      activity.overlayBusy = false;
      if (activity.overlayDirty) {
        activity.overlayDirty = false;
        scheduleOverlayUpdate();
      }
    });
}

async function updateOverlay() {
  if (!activity.settings.overlayEnabled) return;

  const fonts = await loadOverlayFonts();
  if (!fonts) return; // No usable font; skip silently rather than throwing.

  let frame = findOverlayFrame();
  if (!frame || frame.removed) {
    frame = await createOverlayFrame(fonts);
  }

  const byName = {};
  for (const child of frame.children) byName[child.name] = child;

  const title = byName["title"];
  const status = byName["status"];
  const log = byName["log"];
  if (!title || !status || !log) return; // Frame was tampered with; leave it be.

  const summary = activity.completed + " done · " + activity.failed + " failed";

  // The frame is locked; unlock briefly so text edits are permitted.
  const wasLocked = frame.locked;
  frame.locked = false;
  try {
    title.characters = "⚡ Claude Talk to Figma — live activity";
    status.characters = overlayStatusLine() + "\n" + summary;
    log.characters = overlayLogLines();
  } finally {
    frame.locked = wasLocked;
  }
}

async function removeOverlay() {
  const frame = findOverlayFrame();
  if (frame && !frame.removed) {
    frame.locked = false;
    frame.remove();
  }
}

// ─── Ghost cursor ──────────────────────────────────────────────────────────
//
// Figma's Plugin API cannot move the real multiplayer cursor — that pointer is
// driven by the user's physical mouse and is not writable. So instead we draw
// our own: a cursor arrow plus a name pill, built from ordinary nodes.
//
// Because it *is* an ordinary node, Figma's multiplayer sync broadcasts every
// position change to everyone with the file open, which reproduces the effect
// of watching a collaborator work. The label carries the current action, so
// observers see not just where the agent is but what it is doing there.
//
// The trade-off is the same as the overlay's: this writes to the document.
// Off by default.

const CURSOR_MARKER_KEY = "claudeActivityCursor";
const CURSOR_NODE_NAME = "⚡ Claude cursor";

/** Arrow drawn as SVG — simpler and sharper than hand-building vector paths. */
const CURSOR_SVG =
  '<svg width="18" height="22" viewBox="0 0 18 22" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M1 1 L1 18.2 L5.5 13.8 L8.6 20.9 L11.9 19.5 L8.8 12.5 L15.2 12.5 Z" ' +
  'fill="#5467F7" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/></svg>';

function findCursorNode() {
  for (const child of figma.currentPage.children) {
    if (!child.removed && child.getPluginData(CURSOR_MARKER_KEY) === "1") return child;
  }
  return null;
}

async function createCursorNode(fonts) {
  const container = figma.createFrame();
  container.name = CURSOR_NODE_NAME;
  container.setPluginData(CURSOR_MARKER_KEY, "1");
  container.fills = [];
  container.clipsContent = false;
  container.resize(160, 46);

  // Arrow
  const arrow = figma.createNodeFromSvg(CURSOR_SVG);
  arrow.name = "arrow";
  arrow.x = 0;
  arrow.y = 0;
  container.appendChild(arrow);

  // Name / action pill
  const pill = figma.createFrame();
  pill.name = "label";
  pill.layoutMode = "HORIZONTAL";
  pill.primaryAxisSizingMode = "AUTO";
  pill.counterAxisSizingMode = "AUTO";
  pill.paddingLeft = 7;
  pill.paddingRight = 7;
  pill.paddingTop = 3;
  pill.paddingBottom = 3;
  pill.cornerRadius = 4;
  pill.clipsContent = false;
  pill.fills = [{ type: "SOLID", color: { r: 0.33, g: 0.40, b: 0.97 } }];

  const label = figma.createText();
  label.name = "labelText";
  label.fontName = fonts.bold;
  label.fontSize = 11;
  label.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  label.characters = activity.settings.cursorLabel || "Claude";
  pill.appendChild(label);

  container.appendChild(pill);
  pill.x = 14;
  pill.y = 20;

  container.locked = true;
  container.expanded = false;
  return container;
}

/** Create the cursor on demand; returns null if fonts are unavailable. */
async function ensureCursorNode() {
  let node = findCursorNode();
  if (node && !node.removed) return node;

  const fonts = await loadOverlayFonts();
  if (!fonts) return null;
  return await createCursorNode(fonts);
}

/** Update the pill text to reflect what the agent is doing right now. */
async function setCursorLabel(text) {
  const node = findCursorNode();
  if (!node || node.removed) return;

  const pill = node.findOne
    ? node.findOne((n) => n.name === "label")
    : null;
  const label = pill && pill.findOne ? pill.findOne((n) => n.name === "labelText") : null;
  if (!label) return;

  const fonts = await loadOverlayFonts();
  if (!fonts) return;

  const wasLocked = node.locked;
  node.locked = false;
  try {
    await figma.loadFontAsync(label.fontName);
    label.characters = text;
  } catch (e) {
    // Font vanished mid-session; leave the previous text in place.
  } finally {
    node.locked = wasLocked;
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Glide the cursor to a point. Stepwise rather than instant, so observers
 * perceive movement between elements instead of teleporting.
 */
function animateCursorTo(node, targetX, targetY) {
  if (activity.cursorAnim) {
    clearInterval(activity.cursorAnim);
    activity.cursorAnim = null;
  }

  const startX = node.x;
  const startY = node.y;
  const dx = targetX - startX;
  const dy = targetY - startY;

  // Nothing meaningful to animate.
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    node.x = targetX;
    node.y = targetY;
    return;
  }

  const steps = 12;
  let step = 0;

  activity.cursorAnim = setInterval(() => {
    step++;
    if (node.removed) {
      clearInterval(activity.cursorAnim);
      activity.cursorAnim = null;
      return;
    }

    const t = easeOutCubic(Math.min(1, step / steps));
    const wasLocked = node.locked;
    node.locked = false;
    try {
      node.x = startX + dx * t;
      node.y = startY + dy * t;
    } catch (e) {
      // Node became unwritable (deleted, or page switched) — stop cleanly.
      clearInterval(activity.cursorAnim);
      activity.cursorAnim = null;
      return;
    } finally {
      if (!node.removed) node.locked = wasLocked;
    }

    if (step >= steps) {
      clearInterval(activity.cursorAnim);
      activity.cursorAnim = null;
    }
  }, 25);
}

/**
 * Point the cursor at a node, and label it with the action in progress.
 * Silently does nothing when the target is not on the current page.
 */
async function moveCursorToNode(nodeIds, actionLabel) {
  if (!activity.settings.cursorEnabled) return;

  try {
    const cursor = await ensureCursorNode();
    if (!cursor || cursor.removed) return;

    if (actionLabel) {
      const base = activity.settings.cursorLabel || "Claude";
      await setCursorLabel(base + " — " + actionLabel);
    }

    if (!nodeIds || !nodeIds.length) return;

    // First target that is resolvable and has geometry on this page wins.
    for (const id of nodeIds.slice(0, 10)) {
      const target = await figma.getNodeByIdAsync(id);
      if (!target || target.removed) continue;
      if (target.id === cursor.id) continue;

      const box = target.absoluteBoundingBox;
      if (!box) continue;

      // Sit just inside the element's top-left, the way a real pointer would
      // when someone clicks into it.
      animateCursorTo(cursor, box.x + Math.min(24, box.width * 0.25), box.y + Math.min(24, box.height * 0.25));
      break;
    }

    scheduleCursorIdle();
  } catch (err) {
    console.log("moveCursorToNode failed:", err && err.message);
  }
}

/** After a quiet spell, drop the action from the label so it reads as idle. */
function scheduleCursorIdle() {
  if (activity.cursorIdleTimer) clearTimeout(activity.cursorIdleTimer);
  activity.cursorIdleTimer = setTimeout(() => {
    if (!activity.settings.cursorEnabled) return;
    setCursorLabel(activity.settings.cursorLabel || "Claude").catch(() => {});
  }, 4000);
}

function removeCursorNode() {
  if (activity.cursorAnim) {
    clearInterval(activity.cursorAnim);
    activity.cursorAnim = null;
  }
  if (activity.cursorIdleTimer) {
    clearTimeout(activity.cursorIdleTimer);
    activity.cursorIdleTimer = null;
  }
  const node = findCursorNode();
  if (node && !node.removed) {
    node.locked = false;
    node.remove();
  }
}

/** Apply and persist activity settings; returns the effective settings. */
async function applyActivitySettings(next) {
  const overlayBefore = activity.settings.overlayEnabled;
  const cursorBefore = activity.settings.cursorEnabled;

  if (next && typeof next === "object") {
    if (typeof next.overlayEnabled === "boolean") activity.settings.overlayEnabled = next.overlayEnabled;
    if (typeof next.highlightEnabled === "boolean") activity.settings.highlightEnabled = next.highlightEnabled;
    if (typeof next.followViewport === "boolean") activity.settings.followViewport = next.followViewport;
    if (typeof next.cursorEnabled === "boolean") activity.settings.cursorEnabled = next.cursorEnabled;
    if (typeof next.cursorLabel === "string" && next.cursorLabel.trim()) {
      activity.settings.cursorLabel = next.cursorLabel.trim().slice(0, 24);
    }
  }

  try {
    await figma.clientStorage.setAsync("activitySettings", activity.settings);
  } catch (e) { /* storage is best-effort */ }

  if (overlayBefore && !activity.settings.overlayEnabled) {
    await removeOverlay();
  } else if (activity.settings.overlayEnabled) {
    await updateOverlay();
  }

  if (cursorBefore && !activity.settings.cursorEnabled) {
    removeCursorNode();
  } else if (activity.settings.cursorEnabled) {
    // Materialise it immediately so enabling the toggle gives visible feedback
    // rather than waiting for the next command.
    await ensureCursorNode();
    await setCursorLabel(activity.settings.cursorLabel || "Claude");
  } else if (!activity.settings.cursorEnabled) {
    removeCursorNode();
  }

  figma.ui.postMessage({ type: "activity-settings", settings: activity.settings });
  return activity.settings;
}

async function loadActivitySettings() {
  try {
    const stored = await figma.clientStorage.getAsync("activitySettings");
    if (stored && typeof stored === "object") {
      Object.assign(activity.settings, stored);
    }
  } catch (e) { /* defaults are fine */ }
  figma.ui.postMessage({ type: "activity-settings", settings: activity.settings });
}

/**
 * Best-effort extraction of node ids from a command's params or its result,
 * so activity entries can name what was touched. Mirrors the shapes used across
 * the tool surface: id / nodeId / parentId / nodeIds / arrays of {id}.
 */
function collectNodeIds(value, budget) {
  const limit = budget || 12;
  const found = [];

  const walk = (v, depth) => {
    if (found.length >= limit || depth < 0 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth - 1);
      return;
    }
    for (const key of Object.keys(v)) {
      if (found.length >= limit) return;
      const raw = v[key];
      if ((key === "id" || key === "nodeId" || key === "parentId") && typeof raw === "string" && raw) {
        if (found.indexOf(raw) === -1) found.push(raw);
        continue;
      }
      if (key === "nodeIds" && Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === "string" && found.indexOf(item) === -1) found.push(item);
          if (found.length >= limit) return;
        }
        continue;
      }
      if (raw && typeof raw === "object") walk(raw, depth - 1);
    }
  };

  walk(value, 4);
  return found;
}

function collectNodeNames(value, budget) {
  const limit = budget || 12;
  const found = [];

  const walk = (v, depth) => {
    if (found.length >= limit || depth < 0 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth - 1);
      return;
    }
    // Only count `name` when it accompanies an `id`, so font and style names
    // do not masquerade as node names.
    if (typeof v.name === "string" && typeof v.id === "string" && v.name) {
      if (found.indexOf(v.name) === -1) found.push(v.name);
    }
    for (const key of Object.keys(v)) {
      if (found.length >= limit) return;
      if (v[key] && typeof v[key] === "object") walk(v[key], depth - 1);
    }
  };

  walk(value, 4);
  return found;
}

/** Backing implementation for the set_activity_overlay MCP tool. */
async function setActivityOverlayCommand(params) {
  const settings = await applyActivitySettings(params || {});
  const visibleToOthers = [];
  if (settings.cursorEnabled) visibleToOthers.push("a live cursor");
  if (settings.overlayEnabled) visibleToOthers.push("a status overlay");
  if (settings.highlightEnabled) visibleToOthers.push("selection highlighting");

  return {
    settings: {
      overlayEnabled: settings.overlayEnabled,
      highlightEnabled: settings.highlightEnabled,
      followViewport: settings.followViewport,
      cursorEnabled: settings.cursorEnabled,
      cursorLabel: settings.cursorLabel,
    },
    overlayPresent: !!findOverlayFrame(),
    cursorPresent: !!findCursorNode(),
    message: visibleToOthers.length
      ? "Collaborators in this file will see " + visibleToOthers.join(", ") + "."
      : "All in-canvas indicators are off. Nothing is visible to other collaborators.",
  };
}

/** Backing implementation for the get_activity_state MCP tool. */
function getActivityStateCommand() {
  return {
    working: !!activity.current,
    currentCommand: activity.current ? activity.current.command : null,
    startedAt: activity.current ? activity.current.startedAt : null,
    completed: activity.completed,
    failed: activity.failed,
    settings: activity.settings,
    recent: activity.log.slice(-15).map((entry) => ({
      ts: entry.ts,
      kind: entry.kind,
      command: entry.command,
      message: entry.message,
      durationMs: entry.durationMs,
      nodeIds: entry.nodeIds,
      nodeNames: entry.nodeNames,
    })),
  };
}

function describeForLog(command, params) {
  const pretty = prettyCommand(command);
  if (params && typeof params === "object") {
    const label = params.name || params.text || params.characters;
    if (typeof label === "string" && label.trim()) {
      const trimmed = label.length > 36 ? label.slice(0, 36) + "…" : label;
      return pretty + ' "' + trimmed + '"';
    }
  }
  return pretty;
}

// Show UI
figma.showUI(__html__, { width: 360, height: 520 });
loadActivitySettings();

// Plugin commands from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "execute-command": {
      // Execute commands received from UI (which gets them from WebSocket).
      // Every command is bracketed by activity events so the panel, the canvas
      // overlay and any watching collaborator can follow the work live.
      const startedAt = Date.now();
      const inputIds = collectNodeIds(msg.params);

      recordActivity({
        kind: "started",
        command: msg.command,
        message: describeForLog(msg.command, msg.params),
        nodeIds: inputIds,
      });

      // Highlight the inputs immediately so the canvas shows *where* work is
      // about to happen, not just where it landed.
      if (inputIds.length) highlightNodes(inputIds);

      try {
        const result = await handleCommand(msg.command, msg.params);

        const resultIds = collectNodeIds(result);
        const touched = resultIds.length ? resultIds : inputIds;

        recordActivity({
          kind: "completed",
          command: msg.command,
          message: describeForLog(msg.command, msg.params),
          durationMs: Date.now() - startedAt,
          nodeIds: touched,
          nodeNames: collectNodeNames(result),
        });

        if (touched.length) highlightNodes(touched);

        // Send result back to UI
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
      } catch (error) {
        recordActivity({
          kind: "error",
          command: msg.command,
          message: (error && error.message) || "Error executing command",
          durationMs: Date.now() - startedAt,
          nodeIds: inputIds,
        });

        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: (error && error.message) || "Error executing command",
        });
      }
      break;
    }
    case "set-activity-settings":
      applyActivitySettings(msg.settings);
      break;
  }
};

// Listen for plugin commands from menu
figma.on("run", ({ command }) => {
  figma.ui.postMessage({ type: "auto-connect" });
});

// The ghost cursor is ephemeral instrumentation, not part of the design, so it
// must not outlive the session that drew it. The overlay is deliberately left
// in place — it is a status record the user chose to add.
figma.on("close", () => {
  try { removeCursorNode(); } catch (e) { /* nothing useful to do on teardown */ }
});

// Update plugin settings
function updateSettings(settings) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }

  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
  });
}

// Helper: safe node lookup using figma.getNodeByIdAsync.
// The original getNodeByIdAsync works fine — the bug was in ui.html's
// sendErrorResponse which dropped error messages (no type/channel fields).
// With that fixed, errors propagate correctly and timeouts are eliminated.
async function getNodeByIdSafe(nodeId) {
  if (!nodeId) return null;
  return await figma.getNodeByIdAsync(nodeId);
}

// Handle commands from UI
async function handleCommand(command, params) {
  switch (command) {
    case "ping":
      return { status: "ok" };
    case "set_activity_overlay":
      return await setActivityOverlayCommand(params);
    case "get_activity_state":
      return getActivityStateCommand();
    case "get_document_info":
      return await getDocumentInfo();
    case "get_selection":
      return await getSelection();
    case "get_node_info":
      if (!params || !params.nodeId) {
        throw new Error("Missing nodeId parameter");
      }
      return await getNodeInfo(params.nodeId);
    case "get_nodes_info":
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return await getNodesInfo(params.nodeIds);
    case "create_rectangle":
      return await createRectangle(params);
    case "create_frame":
      return await createFrame(params);
    case "create_text":
      return await createText(params);
    case "set_fill_color":
      return await setFillColor(params);
    case "set_stroke_color":
      return await setStrokeColor(params);
    case "set_selection_colors":
      return await setSelectionColors(params);
    case "move_node":
      return await moveNode(params);
    case "resize_node":
      return await resizeNode(params);
    case "delete_node":
      return await deleteNode(params);
    case "get_design_system":
      return await getDesignSystem(params);
    case "analyze_responsive":
      return await analyzeResponsive(params);
    case "make_responsive":
      return await makeResponsive(params);
    case "validate_responsive":
      return await validateResponsiveCommand(params);
    case "clean_layers":
      return await cleanLayersCommand(params);
    case "get_styles":
      return await getStyles();
    case "get_local_components":
      return await getLocalComponents();
    // case "get_team_components":
    //   return await getTeamComponents();
    case "create_component_instance":
      return await createComponentInstance(params);
    case "export_node_as_image":
      return await exportNodeAsImage(params);
    case "set_corner_radius":
      return await setCornerRadius(params);
    case "set_text_content":
      return await setTextContent(params);
    case "clone_node":
      return await cloneNode(params);
    case "scan_text_nodes":
      return await scanTextNodes(params);
    case "fix_text_sizing":
      return await fixTextSizing(params);
    case "set_multiple_text_contents":
      return await setMultipleTextContents(params);
    case "set_auto_layout":
      return await setAutoLayout(params);
    case "set_layout_sizing":
      return await setLayoutSizing(params);
    // Nuevos comandos para propiedades de texto
    case "set_font_name":
      return await setFontName(params);
    case "set_font_size":
      return await setFontSize(params);
    case "set_font_weight":
      return await setFontWeight(params);
    case "set_letter_spacing":
      return await setLetterSpacing(params);
    case "set_line_height":
      return await setLineHeight(params);
    case "set_paragraph_spacing":
      return await setParagraphSpacing(params);
    case "set_text_case":
      return await setTextCase(params);
    case "set_text_decoration":
      return await setTextDecoration(params);
    case "set_text_align":
      return await setTextAlign(params);
    case "get_styled_text_segments":
      return await getStyledTextSegments(params);
    case "load_font_async":
      return await loadFontAsyncWrapper(params);
    case "get_remote_components":
      return await getRemoteComponents(params);
    case "set_effects":
      return await setEffects(params);
    case "set_effect_style_id":
      return await setEffectStyleId(params);
    case "set_text_style_id":
      return await setTextStyleId(params);
    case "group_nodes":
      return await groupNodes(params);
    case "ungroup_nodes":
      return await ungroupNodes(params);
    case "flatten_node":
      return await flattenNode(params);
    case "insert_child":
      return await insertChild(params);
    case "create_ellipse":
      return await createEllipse(params);
    case "create_polygon":
      return await createPolygon(params);
    case "create_star":
      return await createStar(params);
    case "create_vector":
      return await createVector(params);
    case "create_line":
      return await createLine(params);
    case "create_component_from_node":
      return await createComponentFromNode(params);
    case "create_component_set":
      return await createComponentSet(params);
    case "set_instance_variant":
      return await setInstanceVariant(params);
    case "create_page":
      return await createPage(params);
    case "delete_page":
      return await deletePage(params);
    case "rename_page":
      return await renamePage(params);
    case "get_pages":
      return await getPages();
    case "get_file_key":
      return await getFileKey();
    case "set_current_page":
      return await setCurrentPage(params);
    case "rename_node":
      return await renameNode(params);
    case "set_image_fill":
      return await setImageFill(params);
    case "get_image_from_node":
      return await getImageFromNode(params);
    case "replace_image_fill":
      return await replaceImageFill(params);
    // COMMENTED OUT: get_image_bytes - Issues pending investigation
    // case "get_image_bytes":
    //   return await getImageBytes(params);
    case "apply_image_transform":
      return await applyImageTransform(params);
    case "set_image_filters":
      return await setImageFilters(params);
    case "rotate_node":
      return await rotateNode(params);
    case "set_node_properties":
      return await setNodeProperties(params);
    case "reorder_node":
      return await reorderNode(params);
    case "duplicate_page":
      return await duplicatePage(params);
    case "convert_to_frame":
      return await convertToFrame(params);
    case "set_gradient":
      return await setGradient(params);
    case "boolean_operation":
      return await booleanOperation(params);
    case "set_svg":
      return await setSvg(params);
    case "get_svg":
      return await getSvg(params);
    case "set_image":
      return await setImage(params);
    case "set_grid":
      return await setGrid(params);
    case "get_grid":
      return await getGrid(params);
    case "set_guide":
      return await setGuide(params);
    case "get_guide":
      return await getGuide(params);
    case "set_annotation":
      return await setAnnotation(params);
    case "get_annotation":
      return await getAnnotation(params);
    case "get_variables":
      return await getVariables(params);
    case "set_variable":
      return await setVariable(params);
    case "apply_variable_to_node":
      return await applyVariableToNode(params);
    case "switch_variable_mode":
      return await switchVariableMode(params);
    case "find_variable":
      return await findVariable(params);
    case "apply_variable_bindings":
      return await applyVariableBindings(params);
    case "get_node_variable_bindings":
      return await getNodeVariableBindings(params);
    case "import_library_variable":
      return await importLibraryVariable(params);
    // ── FigJam commands ──────────────────────────────────────────────────
    case "get_figjam_elements":
      return await getFigJamElements();
    case "create_sticky":
      return await createSticky(params);
    case "set_sticky_text":
      return await setStickyText(params);
    case "create_shape_with_text":
      return await createShapeWithText(params);
    case "create_connector":
      return await createConnector(params);
    case "create_section":
      return await createSection(params);
    case "set_reactions":
      return await setReactions(params);
    case "get_reactions":
      return await getReactions(params);
    case "detach_instance":
      return await detachInstance(params);
    case "create_text_style":
      return await createTextStyle(params);
    case "create_paint_style":
      return await createPaintStyle(params);
    case "create_effect_style":
      return await createEffectStyle(params);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
};

// Command implementations

async function getDocumentInfo() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    name: page.name,
    id: page.id,
    type: page.type,
    children: page.children.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
    })),
    currentPage: {
      id: page.id,
      name: page.name,
      childCount: page.children.length,
    },
    pages: [
      {
        id: page.id,
        name: page.name,
        childCount: page.children.length,
      },
    ],
  };
}

async function getSelection() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
    })),
  };
}

async function getNodeInfo(nodeId) {
  const node = await getNodeByIdSafe(nodeId);

  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const response = await node.exportAsync({
    format: "JSON_REST_V1",
  });

  // Add local coordinates if node supports positioning
  if ("x" in node && "y" in node) {
    response.document.localPosition = {
      x: node.x,
      y: node.y
    };
  }

  return response.document;
}

async function getNodesInfo(nodeIds) {
  try {
    // Load all nodes in parallel
    const nodes = await Promise.all(
      nodeIds.map((id) => getNodeByIdSafe(id))
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        const doc = response.document;
        // Add local coordinates if node supports positioning
        if ("x" in node && "y" in node) {
          doc.localPosition = {
            x: node.x,
            y: node.y
          };
        }
        return {
          nodeId: node.id,
          document: doc,
        };
      })
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
}

async function createRectangle(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Rectangle",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
  } = params || {};

  const rect = figma.createRectangle();
  rect.x = x;
  rect.y = y;
  rect.resize(width, height);
  rect.name = name;

  // Set fill color if provided
  if (fillColor) {
    var fillPaint = safePaint(fillColor);
    if (fillPaint) rect.fills = [fillPaint];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    var strokePaint = safePaint(strokeColor);
    if (strokePaint) rect.strokes = [strokePaint];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    rect.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(rect);
  } else {
    figma.currentPage.appendChild(rect);
  }

  return {
    id: rect.id,
    name: rect.name,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    parentId: rect.parent ? rect.parent.id : undefined,
  };
}

async function createFrame(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Frame",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
  } = params || {};

  const frame = figma.createFrame();
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.name = name;

  // Set fill color if provided (invalid color → skip, keeping Figma default)
  if (fillColor) {
    var fillPaint = safePaint(fillColor);
    if (fillPaint) frame.fills = [fillPaint];
  }

  // Set stroke color and weight if provided (invalid color → skip)
  if (strokeColor) {
    var strokePaint = safePaint(strokeColor);
    if (strokePaint) frame.strokes = [strokePaint];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    frame.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  var targetParent = figma.currentPage;
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    targetParent = parentNode;
  }
  targetParent.appendChild(frame);

  // Auto-Grid logic: if parent is a PAGE, add a standard column grid (hidden by default)
  if (targetParent.type === "PAGE") {
    var colCount = 4; // Mobile
    if (width >= 1024) colCount = 12; // Desktop
    else if (width >= 768) colCount = 8; // Tablet

    frame.layoutGrids = [
      {
        pattern: "COLUMNS",
        alignment: "STRETCH",
        count: colCount,
        gutterSize: 20,
        offset: 20,
        visible: false,
        color: { r: 1, g: 0, b: 0, a: 0.1 },
      },
    ];
  }

  return {
    id: frame.id,
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    fills: frame.fills,
    strokes: frame.strokes,
    strokeWeight: frame.strokeWeight,
    parentId: frame.parent ? frame.parent.id : undefined,
  };
}

async function createText(params) {
  const {
    x = 0,
    y = 0,
    text = "Text",
    fontSize = 14,
    fontWeight = 400,
    fontColor = { r: 0, g: 0, b: 0, a: 1 }, // Default to black
    name = "Text",
    parentId,
    textAlignHorizontal,
    textAutoResize,
    width,
  } = params || {};

  // Map common font weights to Figma font styles
  const getFontStyle = (weight) => {
    switch (weight) {
      case 100:
        return "Thin";
      case 200:
        return "Extra Light";
      case 300:
        return "Light";
      case 400:
        return "Regular";
      case 500:
        return "Medium";
      case 600:
        return "Semi Bold";
      case 700:
        return "Bold";
      case 800:
        return "Extra Bold";
      case 900:
        return "Black";
      default:
        return "Regular";
    }
  };

  const textNode = figma.createText();
  textNode.x = x;
  textNode.y = y;
  textNode.name = name;
  try {
    await figma.loadFontAsync({
      family: "Inter",
      style: getFontStyle(fontWeight),
    });
    textNode.fontName = { family: "Inter", style: getFontStyle(fontWeight) };
    textNode.fontSize = parseInt(fontSize);
  } catch (error) {
    console.error("Error setting font size", error);
  }
  await setCharacters(textNode, text);

  // Set text color
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(fontColor.r) || 0,
      g: parseFloat(fontColor.g) || 0,
      b: parseFloat(fontColor.b) || 0,
    },
    opacity: parseFloat(fontColor.a) || 1,
  };
  textNode.fills = [paintStyle];

  // Set text alignment if provided
  if (textAlignHorizontal && ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"].includes(textAlignHorizontal)) {
    textNode.textAlignHorizontal = textAlignHorizontal;
  }

  // Determine textAutoResize automatically when not explicitly set.
  // Rules (applied before width so the resize call below doesn't lock height):
  //   - width provided → paragraph context → HEIGHT (auto height, fixed width)
  //   - no width, no explicit resize → single-line context → WIDTH_AND_HEIGHT (hug both)
  // An explicit textAutoResize param always wins.
  const resolvedResize = textAutoResize && ["WIDTH_AND_HEIGHT", "HEIGHT", "NONE", "TRUNCATE"].includes(textAutoResize)
    ? textAutoResize
    : (width && typeof width === "number" && width > 0)
      ? "HEIGHT"
      : "WIDTH_AND_HEIGHT";
  textNode.textAutoResize = resolvedResize;

  // Set width if provided (useful with textAutoResize "HEIGHT" for fixed-width wrapping text)
  if (width && typeof width === "number" && width > 0) {
    textNode.resize(width, textNode.height);
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(textNode);
  } else {
    figma.currentPage.appendChild(textNode);
  }

  return {
    id: textNode.id,
    name: textNode.name,
    x: textNode.x,
    y: textNode.y,
    width: textNode.width,
    height: textNode.height,
    characters: textNode.characters,
    fontSize: textNode.fontSize,
    fontWeight: fontWeight,
    fontColor: fontColor,
    fontName: textNode.fontName,
    fills: textNode.fills,
    parentId: textNode.parent ? textNode.parent.id : undefined,
  };
}

async function setFillColor(params) {
  const {
    nodeId,
    color,
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  const fillPaint = safePaint(color);
  if (!fillPaint) {
    throw new Error("Invalid color data received from MCP layer.");
  }

  node.fills = [fillPaint];

  return {
    id: node.id,
    name: node.name,
    fills: [fillPaint],
  };
}

async function setStrokeColor(params) {
  const {
    nodeId,
    color,
    strokeWeight,
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("strokes" in node)) {
    throw new Error(`Node does not support strokes: ${nodeId}`);
  }

  const strokePaint = safePaint(color);
  if (!strokePaint) {
    throw new Error("Invalid color data received from MCP layer.");
  }

  node.strokes = [strokePaint];

  if (strokeWeight !== undefined) {
    node.strokeWeight = parseFloat(strokeWeight);
  }

  return {
    id: node.id,
    name: node.name,
    strokes: node.strokes,
    strokeWeight: "strokeWeight" in node ? node.strokeWeight : undefined,
  };
}

async function setSelectionColors(params) {
  const { nodeId, r, g, b, a, commandId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (r === undefined || g === undefined || b === undefined) {
    throw new Error("RGB components (r, g, b) are required");
  }

  const newColor = {
    r: parseFloat(r),
    g: parseFloat(g),
    b: parseFloat(b),
  };
  const opacity = a !== undefined ? parseFloat(a) : 1;

  // Get all descendant nodes + the target node itself
  let targets = [];
  if ("findAll" in node) {
    targets = [node].concat(node.findAll(() => true));
  } else {
    targets = [node];
  }

  let changedCount = 0;
  const totalNodes = targets.length;
  const chunkSize = 200; // Process 200 nodes at a time

  sendProgressUpdate(commandId, "set_selection_colors", "started", 0, totalNodes, 0, `Starting color update for ${totalNodes} nodes...`);

  for (let i = 0; i < totalNodes; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);
    
    for (const n of chunk) {
      let nodeModified = false;

      // Update strokes
      if ("strokes" in n && Array.isArray(n.strokes) && n.strokes.length > 0) {
        let strokesChanged = false;
        const newStrokes = n.strokes.map(s => {
          if (s.type === "SOLID") {
            // Only update if color or opacity is different
            if (s.color.r !== newColor.r || s.color.g !== newColor.g || s.color.b !== newColor.b || s.opacity !== opacity) {
              strokesChanged = true;
              return Object.assign({}, s, { color: newColor, opacity: opacity });
            }
          }
          return s;
        });
        
        if (strokesChanged) {
          n.strokes = newStrokes;
          nodeModified = true;
        }
      }

      // Update fills
      if ("fills" in n && Array.isArray(n.fills) && n.fills.length > 0) {
        let fillsChanged = false;
        const newFills = n.fills.map(f => {
          if (f.type === "SOLID" && f.visible !== false) {
            // Only update if color or opacity is different
            if (f.color.r !== newColor.r || f.color.g !== newColor.g || f.color.b !== newColor.b || f.opacity !== opacity) {
              fillsChanged = true;
              return Object.assign({}, f, { color: newColor, opacity: opacity, visible: true });
            }
          }
          return f;
        });

        if (fillsChanged) {
          n.fills = newFills;
          nodeModified = true;
        }
      }

      if (nodeModified) {
        changedCount++;
      }
    }

    // After each chunk, yield to main thread and send progress
    const processedCount = Math.min(i + chunkSize, totalNodes);
    const progress = Math.round((processedCount / totalNodes) * 100);
    
    sendProgressUpdate(commandId, "set_selection_colors", "in_progress", progress, totalNodes, processedCount, `Processed ${processedCount}/${totalNodes} nodes...`);
    
    // Tiny delay to breathe
    await new Promise(resolve => setTimeout(resolve, 1));
  }

  return {
    id: node.id,
    name: node.name,
    nodesChanged: changedCount,
    totalProcessed: totalNodes
  };
}

async function moveNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (x === undefined || y === undefined) {
    throw new Error("Missing x or y parameters");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("x" in node) || !("y" in node)) {
    throw new Error(`Node does not support position: ${nodeId}`);
  }

  node.x = x;
  node.y = y;

  return {
    id: node.id,
    name: node.name,
    x: node.x,
    y: node.y,
  };
}

/** Read one axis's sizing without throwing on a node that has no layout axis. */
function safeReadSizing(node, axis) {
  try {
    return axis === "vertical" ? readVerticalSizing(node) : readHorizontalSizing(node);
  } catch (e) {
    return null;
  }
}

async function resizeNode(params) {
  const { nodeId, width, height, allowFixedHeight } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (width === undefined && height === undefined) {
    throw new Error("Provide at least one of width or height");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("resize" in node)) {
    throw new Error(`Node does not support resizing: ${nodeId}`);
  }

  // resize() writes a literal height and, on an auto layout frame, silently
  // flips Hug contents back to Fixed. That is the single easiest way to
  // reintroduce the fixed heights this plugin exists to avoid, so a container
  // whose height follows its content has to be pinned deliberately.
  const heightRequested = height !== undefined;
  const isContentDrivenHeight =
    isContainer(node) && !hasIntrinsicSize(node) && readVerticalSizing(node) !== "FIXED";

  if (heightRequested && isContentDrivenHeight && allowFixedHeight !== true) {
    throw new Error(
      `"${node.name}" sizes its height to its content (${readVerticalSizing(node)}). Setting a ` +
        `fixed height of ${height}px would clip or strand that content when it reflows. ` +
        "Change the content or the padding instead, or use set_layout_sizing to change how it " +
        "sizes. Pass allowFixedHeight: true only for something that genuinely needs a fixed " +
        "physical size, such as an image crop or an avatar."
    );
  }

  // resize() takes both axes and pins both, so a width-only call would still
  // convert Hug height to Fixed. Remember the sizing of whichever axis the
  // caller did not ask about, and put it back afterwards.
  const priorVertical = heightRequested ? null : safeReadSizing(node, "vertical");
  const priorHorizontal = width === undefined ? safeReadSizing(node, "horizontal") : null;

  const targetWidth = width === undefined ? node.width : width;
  const targetHeight = heightRequested ? height : node.height;
  node.resize(targetWidth, targetHeight);

  if (priorVertical && priorVertical !== "FIXED") writeVerticalSizing(node, priorVertical);
  if (priorHorizontal && priorHorizontal !== "FIXED") writeHorizontalSizing(node, priorHorizontal);

  return {
    id: node.id,
    name: node.name,
    width: node.width,
    height: node.height,
    layoutSizingVertical: readVerticalSizing(node),
    heightPinned: heightRequested,
  };
}

async function deleteNode(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Save node info before deleting
  const nodeInfo = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  node.remove();

  return nodeInfo;
}

async function getStyles() {
  const styles = {
    colors: await figma.getLocalPaintStylesAsync(),
    texts: await figma.getLocalTextStylesAsync(),
    effects: await figma.getLocalEffectStylesAsync(),
    grids: await figma.getLocalGridStylesAsync(),
  };

  return {
    colors: styles.colors.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      paint: style.paints[0],
    })),
    texts: styles.texts.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
  };
}

// ─── Design system inspection ──────────────────────────────────────────────
//
// WHY THIS EXISTS
// ---------------
// The "local design library first" rule requires the agent to know what the
// file already defines *before* it designs anything. The individual primitives
// (get_styles, get_variables, get_local_components) each answer a fragment of
// that, which meant four-plus round trips and no single view — expensive enough
// that the rule tended to get skipped.
//
// This gathers the whole picture in one call: typography, colour, tokens,
// components with their variant properties, and — importantly — the spacing,
// radius and gap values actually *observed* in the file. That last part matters
// because most real files encode their layout rhythm in usage rather than in
// named tokens, so "match the existing spacing" is unanswerable from styles
// alone.

/** Convert a Figma 0-1 RGB paint to a #RRGGBB string for legibility. */
function paintToHex(paint) {
  if (!paint || paint.type !== "SOLID" || !paint.color) return null;
  const toByte = (c) => {
    const v = Math.round(Math.max(0, Math.min(1, c)) * 255);
    return v.toString(16).padStart(2, "0");
  };
  return "#" + toByte(paint.color.r) + toByte(paint.color.g) + toByte(paint.color.b);
}

/** Flatten a Figma lineHeight / letterSpacing union into something printable. */
function typographyUnit(value) {
  if (!value || typeof value !== "object") return null;
  if (value.unit === "AUTO") return "auto";
  if (value.unit === "PERCENT") return value.value + "%";
  return value.value + "px";
}

/**
 * Tally a value into a frequency map. Used to surface the dominant spacing and
 * radius values rather than a raw dump of every number in the document.
 */
function tally(map, value) {
  if (typeof value !== "number" || !isFinite(value) || value <= 0) return;
  const key = Math.round(value * 100) / 100;
  map[key] = (map[key] || 0) + 1;
}

/** Return the most common entries of a tally, most frequent first. */
function topTally(map, limit) {
  return Object.keys(map)
    .map((k) => ({ value: Number(k), count: map[k] }))
    .sort((a, b) => b.count - a.count || a.value - b.value)
    .slice(0, limit || 12);
}

/**
 * Walk a bounded sample of the document collecting layout conventions.
 * Bounded because a large file can hold tens of thousands of nodes and the
 * point is the *rhythm*, which a sample captures perfectly well.
 */
function collectLayoutConventions(roots, budget) {
  const limit = budget || 4000;
  const padding = {};
  const gaps = {};
  const radii = {};
  const fontSizes = {};
  const autoLayoutModes = { HORIZONTAL: 0, VERTICAL: 0, NONE: 0 };
  const fontFamilies = {};
  let visited = 0;

  const walk = (node) => {
    if (visited >= limit || !node || node.removed) return;
    visited++;

    // Skip our own instrumentation so it cannot pollute the conventions.
    if (node.getPluginData) {
      const marker = node.getPluginData(OVERLAY_MARKER_KEY) || node.getPluginData(CURSOR_MARKER_KEY);
      if (marker === "1") return;
    }

    if ("layoutMode" in node && node.layoutMode) {
      autoLayoutModes[node.layoutMode] = (autoLayoutModes[node.layoutMode] || 0) + 1;
      if (node.layoutMode !== "NONE") {
        tally(padding, node.paddingTop);
        tally(padding, node.paddingRight);
        tally(padding, node.paddingBottom);
        tally(padding, node.paddingLeft);
        tally(gaps, node.itemSpacing);
      }
    }

    if (typeof node.cornerRadius === "number") tally(radii, node.cornerRadius);

    if (node.type === "TEXT") {
      if (typeof node.fontSize === "number") tally(fontSizes, node.fontSize);
      const fn = node.fontName;
      if (fn && typeof fn === "object" && fn.family) {
        fontFamilies[fn.family] = (fontFamilies[fn.family] || 0) + 1;
      }
    }

    if ("children" in node && node.children) {
      for (const child of node.children) {
        if (visited >= limit) return;
        walk(child);
      }
    }
  };

  for (const root of roots) walk(root);

  return {
    sampledNodes: visited,
    padding: topTally(padding, 10),
    gaps: topTally(gaps, 10),
    cornerRadii: topTally(radii, 10),
    fontSizes: topTally(fontSizes, 14),
    fontFamilies: Object.keys(fontFamilies)
      .map((k) => ({ family: k, count: fontFamilies[k] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    autoLayoutUsage: autoLayoutModes,
  };
}

/**
 * One-call snapshot of everything the local file already defines.
 * `scope`: "page" (default, fast) or "document" (all pages).
 */
async function getDesignSystem(params) {
  const opts = params || {};
  const scope = opts.scope === "document" ? "document" : "page";
  const includeVariables = opts.includeVariables !== false;
  const includeComponents = opts.includeComponents !== false;

  // ── Styles ────────────────────────────────────────────────────────────
  const [paintStyles, textStyles, effectStyles, gridStyles] = await Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.getLocalGridStylesAsync(),
  ]);

  const colors = paintStyles.map((style) => ({
    id: style.id,
    name: style.name,
    key: style.key,
    hex: paintToHex(style.paints && style.paints[0]),
    type: style.paints && style.paints[0] ? style.paints[0].type : null,
    opacity:
      style.paints && style.paints[0] && typeof style.paints[0].opacity === "number"
        ? style.paints[0].opacity
        : 1,
  }));

  const typography = textStyles.map((style) => ({
    id: style.id,
    name: style.name,
    key: style.key,
    fontFamily: style.fontName ? style.fontName.family : null,
    fontStyle: style.fontName ? style.fontName.style : null,
    fontSize: style.fontSize,
    lineHeight: typographyUnit(style.lineHeight),
    letterSpacing: typographyUnit(style.letterSpacing),
    paragraphSpacing: style.paragraphSpacing,
    textCase: style.textCase,
    textDecoration: style.textDecoration,
  }));

  const effects = effectStyles.map((style) => ({
    id: style.id,
    name: style.name,
    key: style.key,
    effects: (style.effects || []).map((e) => ({
      type: e.type,
      radius: e.radius,
      spread: e.spread,
      offset: e.offset,
      color: e.color ? paintToHex({ type: "SOLID", color: e.color }) : null,
      opacity: e.color && typeof e.color.a === "number" ? e.color.a : undefined,
    })),
  }));

  const grids = gridStyles.map((style) => ({
    id: style.id,
    name: style.name,
    key: style.key,
    layoutGrids: (style.layoutGrids || []).map((g) => ({
      pattern: g.pattern,
      sectionSize: g.sectionSize,
      gutterSize: g.gutterSize,
      count: g.count,
      alignment: g.alignment,
    })),
  }));

  // ── Variables / tokens ────────────────────────────────────────────────
  let variableCollections = [];
  let variablesAvailable = false;
  if (includeVariables && figma.variables) {
    try {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      variablesAvailable = true;
      // One index so an alias can be reported by the name it points at. A raw
      // {type:"VARIABLE_ALIAS", id:"VariableID:12:34"} tells a reader nothing,
      // and an alias flattened to its hex invites copying the hex.
      const aliasIndex = await buildVariableIndex();
      for (const collection of collections) {
        const vars = [];
        for (const variableId of collection.variableIds) {
          const variable = await figma.variables.getVariableByIdAsync(variableId);
          if (!variable) continue;
          // Resolve colour values to hex so the agent can match them by eye;
          // aliases stay aliases, named for what they point at.
          const values = {};
          for (const modeId of Object.keys(variable.valuesByMode || {})) {
            const raw = variable.valuesByMode[modeId];
            if (raw && typeof raw === "object" && raw.type === "VARIABLE_ALIAS") {
              const target = aliasIndex.byId[raw.id];
              values[modeId] = `→ ${target ? target.name : "(alias outside this file)"}`;
            } else if (raw && typeof raw === "object" && "r" in raw) {
              values[modeId] = paintToHex({ type: "SOLID", color: raw });
            } else {
              values[modeId] = raw;
            }
          }
          vars.push({
            id: variable.id,
            name: variable.name,
            resolvedType: variable.resolvedType,
            scopes: variable.scopes || [],
            valuesByMode: values,
          });
        }
        variableCollections.push({
          id: collection.id,
          name: collection.name,
          modes: (collection.modes || []).map((m) => ({ modeId: m.modeId, name: m.name })),
          variableCount: vars.length,
          variables: vars,
        });
      }
    } catch (err) {
      // Variables API unavailable in this Figma build — not fatal.
      variablesAvailable = false;
    }
  }

  // ── Components ────────────────────────────────────────────────────────
  let components = [];
  let componentSets = [];
  if (includeComponents) {
    if (scope === "document") await figma.loadAllPagesAsync();
    const root = scope === "document" ? figma.root : figma.currentPage;

    const sets = root.findAllWithCriteria({ types: ["COMPONENT_SET"] });
    componentSets = sets.map((set) => ({
      id: set.id,
      name: set.name,
      key: "key" in set ? set.key : null,
      // Variant properties are what make a set reusable — surface them so the
      // agent can pick an existing variant instead of building a new component.
      variantProperties: set.variantGroupProperties
        ? Object.keys(set.variantGroupProperties).map((prop) => ({
            property: prop,
            values: set.variantGroupProperties[prop].values,
          }))
        : [],
      variantCount: set.children ? set.children.length : 0,
    }));

    const setIds = {};
    for (const s of sets) setIds[s.id] = true;

    const found = root.findAllWithCriteria({ types: ["COMPONENT"] });
    components = found
      // Children of a set are already described by the set itself.
      .filter((c) => !(c.parent && setIds[c.parent.id]))
      .map((component) => ({
        id: component.id,
        name: component.name,
        key: "key" in component ? component.key : null,
        description: component.description || "",
        width: Math.round(component.width),
        height: Math.round(component.height),
      }));
  }

  // ── Observed layout conventions ───────────────────────────────────────
  const roots = scope === "document" ? figma.root.children : [figma.currentPage];
  const conventions = collectLayoutConventions(roots, opts.sampleLimit || 4000);

  return {
    scope,
    page: { id: figma.currentPage.id, name: figma.currentPage.name },
    summary: {
      colorStyles: colors.length,
      textStyles: typography.length,
      effectStyles: effects.length,
      gridStyles: grids.length,
      variableCollections: variableCollections.length,
      variables: variableCollections.reduce((n, c) => n + c.variableCount, 0),
      components: components.length,
      componentSets: componentSets.length,
      variablesAvailable,
    },
    colors,
    typography,
    effects,
    grids,
    variableCollections,
    components,
    componentSets,
    conventions,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSIVE WEBSITE ENGINE
// ═══════════════════════════════════════════════════════════════════════════
//
// Inspect → Reuse → Adapt → Validate.
//
// The central design decision here is that responsive versions are produced by
// CLONING the source frame and adapting the clone's layout, never by rebuilding
// it from primitives. Cloning is what makes the safety rules true by
// construction rather than by discipline:
//
//   - component instances stay connected (no detaching)
//   - variable and style bindings survive untouched
//   - text content, fills, images, effects and section order are preserved
//   - the original desktop frame is never mutated
//
// Everything after the clone is a layout adaptation: changing layout direction,
// sizing behaviour, padding and spacing. We change how the design *flows*, not
// what it *is*. Nothing here rewrites copy, swaps colours, or restyles.

const RESPONSIVE_PRESETS = {
  desktop: { key: "desktop", label: "Desktop", width: 1440, sidePadding: 72, maxContent: 1240 },
  tablet: { key: "tablet", label: "Tablet", width: 768, sidePadding: 30, maxContent: 708 },
  mobile: { key: "mobile", label: "Mobile", width: 320, sidePadding: 16, maxContent: 288 },
};

/** Return a breakpoint preset at the exact width requested by the designer. */
function resolveResponsivePreset(key, requestedWidth) {
  const base = RESPONSIVE_PRESETS[key];
  if (!base) return null;
  if (requestedWidth === undefined || requestedWidth === null) return { ...base };

  const width = Number(requestedWidth);
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error('targetWidth must be a positive number.');
  }

  return {
    ...base,
    width,
    maxContent: Math.max(0, Math.min(base.maxContent, width - base.sidePadding * 2)),
    customWidth: Math.abs(width - base.width) > 0.01,
  };
}

// 320 is the default mobile *design* frame. Both widths are always used for QA
// because a layout that survives 390 but breaks at 320 is not responsive.
const QA_WIDTHS = [390, 320];

// Section spacing envelopes, used only when the file defines no spacing tokens.
const SECTION_SPACING_FALLBACK = {
  desktop: { min: 96, max: 128 },
  tablet: { min: 72, max: 96 },
  mobile: { min: 48, max: 72 },
};

// Tokens that mark a text style as belonging to a breakpoint, so that
// "Heading/Display/Desktop" can be resolved to "Heading/Display/Mobile".
//
// There is deliberately NO hardcoded type scale here. Inventing sizes such as
// "mobile H1 = 36px" would fabricate a typography system the file never agreed
// to. Responsive typography is resolved by finding the local style the project
// already defines for the target breakpoint; when none exists, the existing
// style is preserved and the gap is reported rather than papered over.
const BREAKPOINT_STYLE_TOKENS = {
  desktop: ["desktop", "dsk", "lg", "large", "wide", "1440", "1280"],
  tablet: ["tablet", "tab", "md", "medium", "768", "1024"],
  mobile: ["mobile", "mob", "sm", "small", "phone", "320", "390"],
};

// Elements whose size is intrinsic — the spec's allowed exceptions to the
// "no fixed dimensions" rule.
const INTRINSIC_SIZE_PATTERN = /\b(icon|avatar|logo|badge|dot|bullet|divider|spacer|flag|thumb)\b/i;

// Content-driven elements that must hug rather than fill.
const HUG_PATTERN = /\b(button|btn|cta|badge|tag|chip|pill|label|nav.?item|menu.?item|link|toggle|switch|checkbox|radio|icon)\b/i;

// Flexible elements that should fill their parent.
const FILL_PATTERN = /\b(wrapper|container|content|column|col|card|field|input|textarea|section|row|stack|grid|group|body|main|header|footer|nav|form|image|img|media)\b/i;

const MIN_TAP_TARGET = 44;
const MIN_READABLE_FONT = 12;

// ─── Analysis helpers ──────────────────────────────────────────────────────

function isContainer(node) {
  return !!node && "children" in node && Array.isArray(node.children);
}

function isAutoLayout(node) {
  return !!node && "layoutMode" in node && node.layoutMode && node.layoutMode !== "NONE";
}

function isInstrumentation(node) {
  if (!node || !node.getPluginData) return false;
  return (
    node.getPluginData(OVERLAY_MARKER_KEY) === "1" ||
    node.getPluginData(CURSOR_MARKER_KEY) === "1"
  );
}

/**
 * Explicit Figma Auto Layout absolute positioning is designer-controlled.
 * Responsive generation treats the layer as an opaque, immutable subtree.
 */
function isAbsolutePositionedLayer(node) {
  if (!node) return false;
  try {
    return "layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE";
  } catch (e) {
    return false;
  }
}

function collectAbsolutePositionedLayers(root, includeRoot) {
  const found = [];
  const walk = (node, depth) => {
    if (!node || node.removed || depth > 18) return;
    if ((node !== root || includeRoot === true) && isAbsolutePositionedLayer(node)) {
      found.push(node);
      return; // The complete subtree is protected by its absolute root.
    }
    if (isContainer(node)) for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return found;
}

function containsAbsolutePositionedLayer(node) {
  return collectAbsolutePositionedLayers(node, true).length > 0;
}

/** Horizontal sizing behaviour, tolerant of older Figma API surfaces. */
function readHorizontalSizing(node) {
  try {
    if ("layoutSizingHorizontal" in node && node.layoutSizingHorizontal) {
      return node.layoutSizingHorizontal;
    }
  } catch (e) { /* fall through */ }
  if (node.layoutGrow === 1) return "FILL";
  return "FIXED";
}

/**
 * Vertical sizing behaviour, tolerant of older Figma API surfaces.
 *
 * Reports FIXED for a container with no auto layout too: such a frame holds a
 * literal height that nothing will update when its content reflows, which is
 * the same defect from the layout's point of view.
 */
function readVerticalSizing(node) {
  try {
    if ("layoutSizingVertical" in node && node.layoutSizingVertical) {
      return node.layoutSizingVertical;
    }
  } catch (e) { /* fall through to the axis-based path */ }
  if (!isAutoLayout(node)) return "FIXED";
  if (node.layoutMode === "VERTICAL") {
    return node.primaryAxisSizingMode === "AUTO" ? "HUG" : "FIXED";
  }
  return node.counterAxisSizingMode === "AUTO" ? "HUG" : "FIXED";
}

/** Set vertical sizing, degrading gracefully when the API is unavailable. */
function writeVerticalSizing(node, value) {
  try {
    if ("layoutSizingVertical" in node) {
      node.layoutSizingVertical = value;
      return true;
    }
  } catch (e) { /* fall through to the legacy axis path */ }
  if (!isAutoLayout(node)) return false;
  try {
    const mode = value === "HUG" ? "AUTO" : "FIXED";
    if (node.layoutMode === "VERTICAL") node.primaryAxisSizingMode = mode;
    else node.counterAxisSizingMode = mode;
    return true;
  } catch (e) { /* sizing mode not writable */ }
  return false;
}

/** Set horizontal sizing, degrading gracefully when the API is unavailable. */
function writeHorizontalSizing(node, value) {
  try {
    if ("layoutSizingHorizontal" in node) {
      node.layoutSizingHorizontal = value;
      return true;
    }
  } catch (e) { /* fall through to legacy path */ }
  try {
    if (value === "FILL") {
      node.layoutAlign = "STRETCH";
      node.layoutGrow = 1;
      return true;
    }
  } catch (e) { /* unsupported */ }
  return false;
}

function nodeIsImageLike(node) {
  if (!node) return false;
  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") return false;
  const name = (node.name || "").toLowerCase();
  if (/image|img|photo|picture|illustration|screenshot|hero.?visual|thumbnail/.test(name)) return true;
  const fills = node.fills;
  if (Array.isArray(fills) && fills.some((f) => f && f.type === "IMAGE")) return true;
  return false;
}

/** Keep cloned image/crop containers locked to their desktop aspect ratio. */
function preserveImageAspectRatios(source, target) {
  let preserved = 0;
  const pair = (desktopNode, responsiveNode, depth) => {
    if (!desktopNode || !responsiveNode || depth > 18) return;
    if (
      isAbsolutePositionedLayer(desktopNode) ||
      isAbsolutePositionedLayer(responsiveNode)
    ) {
      return;
    }

    if (
      nodeIsImageLike(desktopNode) &&
      desktopNode.width > 0 &&
      desktopNode.height > 0
    ) {
      try {
        if ('constrainProportions' in responsiveNode) {
          responsiveNode.constrainProportions = true;
          preserved++;
        }
      } catch (e) { /* this node type does not expose ratio locking */ }
    }

    if (!isContainer(desktopNode) || !isContainer(responsiveNode)) return;
    const unusedResponsive = responsiveNode.children.slice();
    for (const desktopChild of desktopNode.children) {
      let matchIndex = unusedResponsive.findIndex(
        (candidate) =>
          candidate.type === desktopChild.type && candidate.name === desktopChild.name
      );
      if (matchIndex < 0) {
        matchIndex = unusedResponsive.findIndex(
          (candidate) =>
            candidate.type === desktopChild.type &&
            nodeIsImageLike(candidate) === nodeIsImageLike(desktopChild)
        );
      }
      if (matchIndex < 0) continue;
      const responsiveChild = unusedResponsive.splice(matchIndex, 1)[0];
      pair(desktopChild, responsiveChild, depth + 1);
    }
  };
  pair(source, target, 0);
  return preserved;
}

function nodeIsTextLike(node) {
  if (!node) return false;
  if (node.type === "TEXT") return true;
  if (!isContainer(node)) return false;
  return node.children.some((c) => nodeIsTextLike(c));
}

function nodeIsInputLike(node) {
  const name = (node.name || "").toLowerCase();
  return /input|field|textarea|select|dropdown|checkbox|radio|form.?control/.test(name);
}

function nodeIsButtonLike(node) {
  const name = (node.name || "").toLowerCase();
  return /button|btn|cta|submit/.test(name);
}

function countDescendants(node, predicate, budget) {
  let count = 0;
  const limit = budget || 400;
  const walk = (n, depth) => {
    if (count >= limit || depth > 8 || !n) return;
    if (predicate(n)) count++;
    if (isContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return count;
}

/**
 * A card grid is a container whose children are broadly uniform in size and
 * numerous enough that the row count is the thing that should change
 * responsively, rather than the cards themselves shrinking.
 */
function looksLikeCardGrid(node) {
  if (!isContainer(node) || node.children.length < 3) return false;
  const kids = node.children.filter((c) => c.visible !== false);
  if (kids.length < 3) return false;

  const widths = kids.map((c) => c.width).filter((w) => typeof w === "number" && w > 0);
  if (widths.length < 3) return false;

  const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
  if (avg <= 0) return false;
  const uniform = widths.every((w) => Math.abs(w - avg) / avg < 0.25);

  const horizontal = node.layoutMode === "HORIZONTAL" || !isAutoLayout(node);
  return uniform && horizontal;
}

/** Text and imagery sitting side by side — the classic hero shape. */
function looksLikeSplitSection(node) {
  if (!isContainer(node)) return false;
  const kids = node.children.filter((c) => c.visible !== false);
  if (kids.length !== 2) return false;
  if (isAutoLayout(node) && node.layoutMode !== "HORIZONTAL") return false;

  const hasText = kids.some((k) => nodeIsTextLike(k));
  const hasVisual = kids.some((k) => nodeIsImageLike(k) || countDescendants(k, nodeIsImageLike, 20) > 0);
  return hasText && hasVisual;
}

function looksLikeHorizontalBar(node) {
  if (!isContainer(node)) return false;
  if (node.height > 160) return false;
  return node.layoutMode === "HORIZONTAL" || node.children.length >= 2;
}

/**
 * Classify a top-level section so the decision engine knows which responsive
 * behaviour applies. Name conventions are checked first because designers name
 * things deliberately; structure is the fallback.
 */
function classifySection(node, index, total) {
  const name = (node.name || "").toLowerCase();

  if (/\b(nav|navbar|header|topbar|menu|app.?bar)\b/.test(name)) return "navigation";
  if (/\bfooter\b/.test(name)) return "footer";
  if (/\b(hero|banner|masthead|jumbotron)\b/.test(name)) return "hero";
  if (/\b(form|contact|signup|sign.?up|subscribe|newsletter)\b/.test(name)) return "form";
  if (/\b(table|comparison|pricing.?table|spec|matrix)\b/.test(name)) return "table";
  if (/\b(grid|cards?|services?|features?|gallery|portfolio|testimonials?|logos?)\b/.test(name)) {
    return "cardGrid";
  }

  // Structural fallbacks.
  if (index === 0 && looksLikeHorizontalBar(node)) return "navigation";
  if (index === total - 1 && total > 2) return "footer";
  if (countDescendants(node, nodeIsInputLike, 40) >= 2) return "form";
  if (looksLikeCardGrid(node)) return "cardGrid";
  if (looksLikeSplitSection(node)) return "hero";
  return "generic";
}

/** Inspect one section and describe what the engine needs to know about it. */
function analyzeSection(node, index, total) {
  const kind = classifySection(node, index, total);
  const fixedWidthChildren = [];
  const absoluteChildren = collectAbsolutePositionedLayers(node, true).map((child) => ({
    id: child.id,
    name: child.name,
  }));

  if (isContainer(node)) {
    for (const child of node.children) {
      if (child.visible === false) continue;
      if (
        !isAbsolutePositionedLayer(child) &&
        isAutoLayout(node) &&
        readHorizontalSizing(child) === "FIXED" &&
        child.width > 400
      ) {
        fixedWidthChildren.push({ id: child.id, name: child.name, width: Math.round(child.width) });
      }
    }
  }

  return {
    id: node.id,
    name: node.name,
    kind,
    type: node.type,
    width: Math.round(node.width || 0),
    height: Math.round(node.height || 0),
    autoLayout: isAutoLayout(node) ? node.layoutMode : "NONE",
    itemSpacing: isAutoLayout(node) ? node.itemSpacing : null,
    padding: isAutoLayout(node)
      ? { top: node.paddingTop, right: node.paddingRight, bottom: node.paddingBottom, left: node.paddingLeft }
      : null,
    childCount: isContainer(node) ? node.children.length : 0,
    childWidths: isContainer(node)
      ? node.children
          .filter((child) => child.visible !== false && !isAbsolutePositionedLayer(child))
          .map((child) => Number(child.width) || 0)
      : [],
    columns: kind === "cardGrid" && isContainer(node) ? node.children.filter((c) => c.visible !== false).length : null,
    hasImages: countDescendants(node, nodeIsImageLike, 50) > 0,
    inputCount: countDescendants(node, nodeIsInputLike, 40),
    buttonCount: countDescendants(node, nodeIsButtonLike, 40),
    instanceCount: countDescendants(node, (n) => n.type === "INSTANCE", 200),
    fixedWidthChildren,
    absoluteChildren,
    usesAutoLayout: isAutoLayout(node),
  };
}

/**
 * Detect frames in the file that already represent other breakpoints, so the
 * engine can update them rather than creating duplicates, and can learn the
 * project's existing responsive conventions.
 */
function responsiveBaseName(value) {
  let name = (value || "Frame").trim();
  const breakpointSuffix = /\s*(?:[-\u2013\u2014/]\s*)?(?:(?:\d+\s*(?:px)?\s*)?(?:desktop|desk|tablet|tab|mobile|mobi|mob)|(?:desktop|desk|tablet|tab|mobile|mobi|mob)(?:\s*[-\u2013\u2014/]?\s*\d+\s*(?:px)?)?)\s*$/i;
  let previous = "";
  while (name && name !== previous) {
    previous = name;
    name = name.replace(breakpointSuffix, "").trim();
  }
  return name.replace(/[\s\-/\u2013\u2014]+$/, "").trim() || "Frame";
}

function breakpointNameMatches(name, preset) {
  const value = (name || "").toLowerCase();
  const width = new RegExp(`\\b${preset.width}\\s*(?:px)?\\b`, "i").test(value);
  if (preset.key === "tablet") return width || /\b(tablet|tab)\b/i.test(value);
  if (preset.key === "mobile") return width || /\b(mobile|mobi|mob|phone)\b/i.test(value);
  return width || /\b(desktop|desk)\b/i.test(value);
}

function breakpointNameMentionsWidth(name, preset) {
  return new RegExp(`\\b${preset.width}\\s*(?:px)?\\b`, 'i').test(name || '');
}

function findExistingBreakpointFrame(sourceNode, preset, parentOverride) {
  const parent = parentOverride || sourceNode.parent || figma.currentPage;
  if (!isContainer(parent)) return null;

  const baseName = responsiveBaseName(sourceNode.name).toLowerCase();
  const candidates = [];
  const genericCandidates = [];
  for (const sibling of parent.children) {
    if (sibling.id === sourceNode.id || sibling.removed) continue;
    if (typeof sibling.width !== "number") continue;

    const sharesBase = responsiveBaseName(sibling.name).toLowerCase() === baseName;
    const exactWidth = Math.abs(sibling.width - preset.width) <= 1;
    const namesBreakpoint = breakpointNameMatches(sibling.name, preset);
    const namesExactWidth = breakpointNameMentionsWidth(sibling.name, preset);

    // A 768px Tab and an 834px Tab are separate requested outputs. A generic
    // breakpoint label must never cause one exact-width frame to overwrite the other.
    if (!exactWidth && !namesExactWidth) continue;

    const candidate = {
      node: sibling,
      score: (exactWidth ? 4 : 0) + (namesExactWidth ? 2 : 0) + (namesBreakpoint ? 1 : 0),
    };
    if (sharesBase) candidates.push(candidate);
    else if (responsiveBaseName(sibling.name) === "Frame") genericCandidates.push(candidate);
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length) return candidates[0].node;

  // A same-area frame named only "Tab / 768px" or "Mobile" is a valid slot
  // even though it carries no page base name. Reuse it only when unambiguous.
  genericCandidates.sort((a, b) => b.score - a.score);
  return genericCandidates.length === 1 ? genericCandidates[0].node : null;
}

function findExistingResponsiveFrames(sourceNode, parentOverride) {
  const parent = parentOverride || sourceNode.parent || figma.currentPage;
  if (!isContainer(parent)) return [];

  const baseName = responsiveBaseName(sourceNode.name).toLowerCase();
  const found = [];

  for (const sibling of parent.children) {
    if (sibling.id === sourceNode.id || sibling.removed) continue;
    if (typeof sibling.width !== "number") continue;

    const name = (sibling.name || "").trim();
    const normalizedSibling = responsiveBaseName(name);
    const sharesBase = normalizedSibling.toLowerCase() === baseName;
    const isGenericSlot = normalizedSibling === "Frame";
    const namesBreakpoint = /\b(desktop|desk|tablet|tab|mobile|mobi|mob)\b|\b(1440|768|390|320)\b/i.test(name);
    if ((!sharesBase && !isGenericSlot) || !namesBreakpoint) continue;

    found.push({
      id: sibling.id,
      name: sibling.name,
      width: Math.round(sibling.width),
      matchesBase: !!sharesBase,
    });
  }
  return found;
}

function responsiveSiblingAnchor(source, presetKey, parent) {
  if (presetKey === "mobile") {
    const tablet = findExistingBreakpointFrame(source, RESPONSIVE_PRESETS.tablet, parent);
    if (tablet) return tablet;

    // A custom-width Tablet (for example 834px) is still the canonical anchor
    // for Mobile. Exact-width matching protects generation from overwriting it,
    // while this category-only lookup is used solely for sibling ordering.
    if (isContainer(parent)) {
      const baseName = responsiveBaseName(source.name).toLowerCase();
      const customTablet = parent.children.find(
        (sibling) =>
          sibling.id !== source.id &&
          !sibling.removed &&
          responsiveBaseName(sibling.name).toLowerCase() === baseName &&
          /\b(tablet|tab)\b/i.test(sibling.name || '')
      );
      if (customTablet) return customTablet;
    }
  }
  return source.parent === parent ? source : null;
}

function placeResponsiveFrame(frame, source, presetKey, parent, gutter, report) {
  const anchor = responsiveSiblingAnchor(source, presetKey, parent);

  try {
    if (anchor && typeof parent.insertChild === "function") {
      const anchorIndex = parent.children.indexOf(anchor);
      parent.insertChild(anchorIndex + 1, frame);
    } else if (frame.parent !== parent && typeof parent.appendChild === "function") {
      parent.appendChild(frame);
    }
  } catch (e) {
    report.warnings.push(`Could not order ${frame.name} beside the desktop frame: ${e && e.message}`);
  }

  if (!isAutoLayout(parent) && anchor) {
    frame.x = anchor.x + anchor.width + gutter;
    frame.y = source.y;
  } else if (isAutoLayout(parent) && parent.layoutMode === "VERTICAL") {
    report.warnings.push(
      `${parent.name} uses vertical Auto Layout, so ${frame.name} was ordered after its ` +
        "breakpoint sibling but cannot be positioned beside it without changing the parent."
    );
  }
}

// ─── Decision engine ───────────────────────────────────────────────────────

/**
 * Decide how a section should behave at a target breakpoint.
 *
 * This is deliberately behaviour-based rather than scale-based: the output is a
 * list of layout intentions, never "shrink everything by 0.53". Proportional
 * scaling is the failure mode this whole feature exists to avoid.
 */
function splitRemainsReadable(section, preset) {
  const widths = (section.childWidths || []).filter((width) => width > 0);
  if (widths.length < 2) return preset.width >= RESPONSIVE_PRESETS.tablet.width;

  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= 0) return false;
  const narrowestRatio = Math.min(...widths) / total;
  const gap = typeof section.itemSpacing === 'number' ? section.itemSpacing : 0;
  const usable = Math.max(0, preset.width - preset.sidePadding * 2 - gap);

  // Roughly 240px is the minimum useful text/image column at Tablet widths.
  // The source ratio is preserved for this estimate instead of assuming 50/50.
  return usable * narrowestRatio >= 240;
}

function decideBehaviors(section, presetKey, preservation, targetPreset) {
  const behaviors = [];
  const preset = targetPreset || RESPONSIVE_PRESETS[presetKey];
  const isMobile = presetKey === "mobile";
  const isTablet = presetKey === "tablet";
  const flexible = preservation === "flexible";
  const balanced = preservation === "balanced" || flexible;

  // Universal: tighten the rhythm, release fixed widths, keep content flowing.
  behaviors.push("reduce-padding");
  behaviors.push("reduce-gap");
  if (section.fixedWidthChildren.length) behaviors.push("release-fixed-width");

  switch (section.kind) {
    case "navigation":
      if (isMobile) {
        behaviors.push("collapse-navigation");
      } else if (isTablet) {
        behaviors.push("keep-horizontal");
        if (balanced) behaviors.push("collapse-navigation-if-crowded");
      }
      break;

    case "hero":
      if (isMobile) {
        behaviors.push("stack-vertical");
        behaviors.push("text-before-media");
        behaviors.push("media-full-width");
      } else if (isTablet) {
        if (splitRemainsReadable(section, preset)) {
          behaviors.push("keep-horizontal");
          behaviors.push("equalize-split");
        } else {
          behaviors.push("stack-vertical");
          behaviors.push("media-full-width");
        }
      }
      break;

    case "cardGrid": {
      const cards = section.columns || section.childCount || 0;
      if (isMobile) {
        behaviors.push("columns:1");
      } else if (isTablet) {
        behaviors.push(cards >= 4 ? "columns:2" : "columns:" + Math.min(2, Math.max(1, cards)));
      }
      behaviors.push("enable-wrap");
      break;
    }

    case "form":
      if (isMobile || (isTablet && section.inputCount > 4)) {
        behaviors.push("stack-form-rows");
      }
      behaviors.push("inputs-fill-width");
      break;

    case "table":
      // Converting a table to stacked cards rewrites structure and cannot be
      // done safely without knowing the project's pattern. Horizontal scroll is
      // the least destructive fallback, and we flag it for a human.
      behaviors.push("table-horizontal-scroll");
      behaviors.push("flag-manual-review");
      break;

    case "footer":
      if (isMobile) behaviors.push("columns:1");
      else if (isTablet) behaviors.push("columns:2");
      behaviors.push("enable-wrap");
      break;

    default:
      if (isMobile && section.autoLayout === "HORIZONTAL" && section.childCount > 1) {
        behaviors.push("stack-vertical");
      } else if (
        isTablet &&
        section.autoLayout === "HORIZONTAL" &&
        section.childCount === 2 &&
        !splitRemainsReadable(section, preset)
      ) {
        behaviors.push("stack-vertical");
      } else if (isTablet && section.autoLayout === "HORIZONTAL" && section.childCount > 3) {
        behaviors.push("enable-wrap");
      }
      break;
  }

  // Typography is no longer a per-section behaviour: it is resolved globally
  // against the file's own text styles after the layout settles.
  if (section.absoluteChildren.length) behaviors.push("flag-absolute-positioning");

  return behaviors;
}

/** Build the full responsive plan for a source frame at one breakpoint. */
function buildPlan(sections, presetKey, preservation, targetPreset) {
  const preset = targetPreset || RESPONSIVE_PRESETS[presetKey];
  return sections.map((section) => ({
    id: section.id,
    name: section.name,
    kind: section.kind,
    behaviors: decideBehaviors(section, presetKey, preservation, preset),
  }));
}

// ─── Transforms ────────────────────────────────────────────────────────────

/** Scale a spacing value toward a target, never below a sensible floor. */
function scaleSpacing(value, factor, floor) {
  if (typeof value !== "number" || value <= 0) return value;
  return Math.max(floor === undefined ? 0 : floor, Math.round(value * factor));
}

function applyPaddingScale(node, factor, sidePadding, verticalPadding) {
  if (!isAutoLayout(node)) return;
  // Horizontal padding is pinned to the breakpoint's container rule; vertical
  // padding scales, because vertical rhythm is proportional but gutters are not.
  if (typeof sidePadding === "number") {
    if (node.paddingLeft > 0) node.paddingLeft = Math.min(node.paddingLeft, sidePadding);
    if (node.paddingRight > 0) node.paddingRight = Math.min(node.paddingRight, sidePadding);
  } else {
    node.paddingLeft = scaleSpacing(node.paddingLeft, factor, 0);
    node.paddingRight = scaleSpacing(node.paddingRight, factor, 0);
  }
  if (typeof verticalPadding === "number") {
    node.paddingTop = Math.min(node.paddingTop, verticalPadding);
    node.paddingBottom = Math.min(node.paddingBottom, verticalPadding);
  } else {
    node.paddingTop = scaleSpacing(node.paddingTop, factor, 0);
    node.paddingBottom = scaleSpacing(node.paddingBottom, factor, 0);
  }
}

// ─── Typography: resolve against the file's own text styles ────────────────

/**
 * Split a text style name into a family and a breakpoint, so that styles which
 * already encode responsive intent can be paired up.
 *
 *   "Heading/Display/Desktop" → { family: "heading/display", breakpoint: "desktop" }
 *   "H1 - Mobile"             → { family: "h1",              breakpoint: "mobile" }
 *   "Body"                    → { family: "body",            breakpoint: null }
 */
const RESPONSIVE_SPACING_FIELDS = [
  "itemSpacing",
  "counterAxisSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
];

/**
 * Pair the responsive copy with its desktop source before any layout changes.
 * Object references survive reordering, so the comparison remains valid after
 * heroes stack, grids wrap, or cleanup changes the sibling order.
 */
function buildDesktopSpacingReferences(source, target) {
  const references = new Map();

  const pair = (desktopNode, responsiveNode, depth) => {
    if (!desktopNode || !responsiveNode || depth > 18) return;
    if (
      isAbsolutePositionedLayer(desktopNode) ||
      isAbsolutePositionedLayer(responsiveNode)
    ) {
      return;
    }

    if (isAutoLayout(desktopNode) && isAutoLayout(responsiveNode)) {
      const values = {};
      for (const field of RESPONSIVE_SPACING_FIELDS) {
        if (typeof desktopNode[field] === "number") values[field] = desktopNode[field];
      }
      let resolvedModes = {};
      try {
        resolvedModes = { ...(desktopNode.resolvedVariableModes || {}) };
      } catch (e) {
        resolvedModes = { ...(desktopNode.explicitVariableModes || {}) };
      }
      references.set(responsiveNode, {
        desktopNodeId: desktopNode.id,
        desktopNodeName: desktopNode.name,
        values,
        resolvedModes,
      });
    }

    if (!isContainer(desktopNode) || !isContainer(responsiveNode)) return;
    const unusedDesktop = desktopNode.children.slice();
    for (let i = 0; i < responsiveNode.children.length; i++) {
      const responsiveChild = responsiveNode.children[i];
      let matchIndex = unusedDesktop.findIndex(
        (candidate) =>
          candidate.type === responsiveChild.type &&
          candidate.name === responsiveChild.name
      );
      if (matchIndex < 0 && i < unusedDesktop.length) matchIndex = i;
      if (matchIndex < 0) continue;
      const desktopChild = unusedDesktop.splice(matchIndex, 1)[0];
      pair(desktopChild, responsiveChild, depth + 1);
    }
  };

  pair(source, target, 0);
  return references;
}

function variableAliasId(binding) {
  const value = Array.isArray(binding) ? binding[0] : binding;
  return value && value.id ? value.id : null;
}

/**
 * Desktop is the spacing ceiling. Responsive gaps and padding may stay equal or
 * become smaller, but never grow accidentally. Bound spacing keeps its token:
 * when a Tab/Mobi mode resolves larger, pin that node to the desktop mode for
 * the relevant collection instead of detaching the variable.
 */
async function enforceDesktopSpacingCeiling(references, report) {
  const prevented = [];
  const warnings = [];
  if (!references || typeof references.entries !== "function") {
    return { prevented, warnings };
  }

  for (const [node, reference] of references.entries()) {
    if (!node || node.removed || isAbsolutePositionedLayer(node)) continue;

    const increased = [];
    for (const field of Object.keys(reference.values || {})) {
      const desktopValue = reference.values[field];
      const responsiveValue = node[field];
      if (
        typeof desktopValue === "number" &&
        typeof responsiveValue === "number" &&
        responsiveValue > desktopValue + 0.01
      ) {
        increased.push({ field, desktopValue, responsiveValue });
      }
    }
    if (!increased.length) continue;

    const frozenCollections = new Set();
    for (const increase of increased) {
      const binding = node.boundVariables && node.boundVariables[increase.field];
      const variableId = variableAliasId(binding);
      if (!variableId || !figma.variables) continue;
      try {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (!variable) continue;
        const collectionId = variable.variableCollectionId;
        const desktopModeId = reference.resolvedModes[collectionId];
        if (!desktopModeId || frozenCollections.has(collectionId)) continue;
        const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
        if (!collection || !("setExplicitVariableModeForCollection" in node)) continue;
        node.setExplicitVariableModeForCollection(collection, desktopModeId);
        frozenCollections.add(collectionId);
      } catch (e) {
        // A raw-value cap below still handles unbound or unsupported nodes.
      }
    }

    for (const increase of increased) {
      let finalValue = node[increase.field];
      const method = frozenCollections.size
        ? "preserved desktop variable mode"
        : "capped to desktop value";

      if (typeof finalValue === "number" && finalValue > increase.desktopValue + 0.01) {
        try {
          node[increase.field] = increase.desktopValue;
          finalValue = node[increase.field];
        } catch (e) {
          // Report below if the Figma property remains above the ceiling.
        }
      }

      if (typeof finalValue === "number" && finalValue <= increase.desktopValue + 0.01) {
        prevented.push({
          nodeId: node.id,
          nodeName: node.name,
          property: increase.field,
          desktop: increase.desktopValue,
          responsiveBefore: increase.responsiveValue,
          final: finalValue,
          method,
        });
      } else {
        warnings.push(
          `${node.name}: ${increase.field} resolved to ${increase.responsiveValue}px, above the ` +
            `desktop reference of ${increase.desktopValue}px, and could not be capped without ` +
            "breaking its variable binding. Manual review is required."
        );
      }
    }
  }

  if (report) {
    report.spacingIncreasesPrevented = prevented;
    report.desktopSpacingWarnings = warnings;
    for (const warning of warnings) report.warnings.push(warning);
  }
  return { prevented, warnings };
}

function parseStyleName(name) {
  const raw = String(name || "").trim();
  const parts = raw.split(/[\/>|]+/).map((p) => p.trim()).filter(Boolean);

  // Check the trailing segment, then any hyphen/space suffix within it.
  const testSegments = [];
  if (parts.length) testSegments.push({ text: parts[parts.length - 1], viaSlash: true });
  const dashMatch = raw.match(/^(.*?)[\s]*[-–—][\s]*([A-Za-z0-9]+)$/);
  if (dashMatch) testSegments.push({ text: dashMatch[2], viaSlash: false, head: dashMatch[1] });

  for (const seg of testSegments) {
    const token = seg.text.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const bp of Object.keys(BREAKPOINT_STYLE_TOKENS)) {
      if (BREAKPOINT_STYLE_TOKENS[bp].indexOf(token) !== -1) {
        const family = seg.viaSlash
          ? parts.slice(0, parts.length - 1).join("/").toLowerCase()
          : String(seg.head || "").trim().toLowerCase();
        return { family: family || raw.toLowerCase(), breakpoint: bp };
      }
    }
  }
  return { family: raw.toLowerCase(), breakpoint: null };
}

/**
 * Index the file's local text styles by family, so a style can be exchanged
 * for its equivalent at another breakpoint. Built once per generation run.
 */
async function buildTextStyleIndex() {
  const index = { byId: {}, families: {}, total: 0 };
  let styles = [];
  try {
    styles = await figma.getLocalTextStylesAsync();
  } catch (e) {
    return index;
  }

  for (const style of styles) {
    const parsed = parseStyleName(style.name);
    const entry = {
      id: style.id,
      name: style.name,
      family: parsed.family,
      breakpoint: parsed.breakpoint,
      fontSize: style.fontSize,
    };
    index.byId[style.id] = entry;
    if (!index.families[parsed.family]) index.families[parsed.family] = {};
    // A family may legitimately hold one style per breakpoint, plus a
    // breakpoint-less base under the "base" key.
    index.families[parsed.family][parsed.breakpoint || "base"] = entry;
    index.total++;
  }
  return index;
}

/**
 * Verify typography survived the adaptation untouched.
 *
 * THE RULE: Desktop, Tablet and Mobile use the SAME local text style. Responsive
 * design changes the layout, never the typography. A layer that reads
 * "Subtitle Alt" on desktop must still read "Subtitle Alt" at 320px — not
 * "Subtitle Alt / Mobile", not a smaller style, not a manual override.
 *
 * This function therefore MUTATES NOTHING. Cloning already carried every style
 * link across intact; the job here is to confirm that, record which styles are
 * in play, and flag layers that were never linked to a local style in the first
 * place. Text that does not fit is a layout problem and is solved by fill/hug,
 * wrapping and stacking — never by touching the type.
 */
function verifyTypographyPreserved(root, index, report) {
  const texts = [];
  const walk = (n, depth) => {
    if (!n || depth > 16 || texts.length > 400) return;
    if (isAbsolutePositionedLayer(n)) return;
    if (n.type === "TEXT") texts.push(n);
    if (isContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(root, 0);

  for (const text of texts) {
    const styleId = text.textStyleId;

    if (!styleId || styleId === "" || styleId === figma.mixed) {
      report.unlinkedText.push(text.name || "(unnamed text)");
      continue;
    }

    report.preservedTextStyles++;
    const entry = index && index.byId ? index.byId[styleId] : null;
    const label = entry ? entry.name : "(local style)";
    if (report.textStylesInUse.indexOf(label) === -1) {
      report.textStylesInUse.push(label);
    }
  }
}

// ─── Sizing: Fill container / Hug contents, never fixed ────────────────────

/** Intrinsically-sized elements keep their dimensions (icons, avatars, logos). */
function hasIntrinsicSize(node) {
  return INTRINSIC_SIZE_PATTERN.test(node.name || "");
}

/**
 * Release a fixed height so a container hugs its content.
 *
 * Height must follow content at every breakpoint. A height fixed to match the
 * desktop appearance clips or strands content the moment text rewraps, which is
 * exactly what happens when a 1440px layout is rendered at 320px.
 */
/**
 * Clear height constraints that survive a clone and quietly re-pin a frame.
 *
 * `minHeight` and `maxHeight` do not show up in the sizing dropdown, so a frame
 * can read "Hug contents" and still be stuck at the height it was given on
 * desktop. Releasing the sizing mode alone does not fix that, so clear them too.
 */
function clearHeightConstraints(node, report) {
  let cleared = false;
  for (const prop of ["minHeight", "maxHeight"]) {
    try {
      if (prop in node && typeof node[prop] === "number") {
        node[prop] = null;
        cleared = true;
      }
    } catch (e) { /* not writable on this node type */ }
  }
  if (cleared && report && typeof report.heightConstraintsCleared === "number") {
    report.heightConstraintsCleared++;
  }
  return cleared;
}

function releaseFixedHeight(node, report) {
  if (hasIntrinsicSize(node)) return false;

  // A frame with no auto layout has no content-driven height to fall back on:
  // Figma can only hug along a layout axis. Record it instead of leaving a
  // silently pinned wrapper — the fix is auto layout on that wrapper, which is
  // a structural change and belongs in the report, not in a silent rewrite.
  if (!isAutoLayout(node)) {
    if (
      report &&
      Array.isArray(report.fixedHeightBlockers) &&
      isContainer(node) &&
      node.children.length > 0 &&
      node.type !== "GROUP" &&
      !isComponentLike(node) &&
      !isInsideInstance(node)
    ) {
      report.fixedHeightBlockers.push({
        name: node.name || "(unnamed)",
        id: node.id,
        height: Math.round(node.height || 0),
      });
    }
    return false;
  }

  clearHeightConstraints(node, report);

  // Modern API: one property regardless of layout direction.
  try {
    if ("layoutSizingVertical" in node && node.layoutSizingVertical === "FIXED") {
      node.layoutSizingVertical = "HUG";
      if (report) report.fixedHeightsReleased++;
      return true;
    }
    if ("layoutSizingVertical" in node) return false; // already HUG or FILL
  } catch (e) { /* fall through to the axis-based path */ }

  // Legacy API: height lives on a different axis per layout direction.
  try {
    if (node.layoutMode === "VERTICAL" && node.primaryAxisSizingMode === "FIXED") {
      node.primaryAxisSizingMode = "AUTO";
      if (report) report.fixedHeightsReleased++;
      return true;
    }
    if (node.layoutMode === "HORIZONTAL" && node.counterAxisSizingMode === "FIXED") {
      node.counterAxisSizingMode = "AUTO";
      if (report) report.fixedHeightsReleased++;
      return true;
    }
  } catch (e) { /* sizing mode not writable */ }
  return false;
}

/** True when this node is meant to size to its own content horizontally. */
function shouldHugHorizontally(node) {
  const name = node.name || "";
  return HUG_PATTERN.test(name) && !FILL_PATTERN.test(name);
}

/**
 * Apply the Fill/Hug policy across a subtree.
 *
 * The rule the spec insists on: responsive elements must never carry fixed
 * width or height. Flexible things fill their parent; content-driven things hug
 * their contents. Only intrinsically-sized elements keep explicit dimensions.
 */
function enforceResponsiveSizing(root, report) {
  const walk = (n, depth) => {
    if (!n || depth > 14 || n.removed) return;
    if (isAbsolutePositionedLayer(n)) return;

    const parentIsAutoLayout = n.parent && isAutoLayout(n.parent);

    if (parentIsAutoLayout && !hasIntrinsicSize(n)) {
      if (shouldHugHorizontally(n)) {
        // Content-driven: buttons, tags, labels, nav items.
        try {
          if ("layoutSizingHorizontal" in n && n.layoutSizingHorizontal === "FIXED") {
            n.layoutSizingHorizontal = "HUG";
            report.setToHug++;
          }
        } catch (e) { /* not hug-able */ }
      } else if (n.type === "TEXT") {
        // Text fills the width it is given so it can wrap, UNLESS it sits inside
        // something that hugs — a button label filling its hugging button would
        // be circular.
        const parentHugs = shouldHugHorizontally(n.parent);
        if (!parentHugs && readHorizontalSizing(n) === "FIXED") {
          if (writeHorizontalSizing(n, "FILL")) report.setToFill++;
        }
      } else if (FILL_PATTERN.test(n.name || "") || isContainer(n)) {
        // Width → Fill container is the default for structural elements.
        if (readHorizontalSizing(n) === "FIXED") {
          if (writeHorizontalSizing(n, "FILL")) report.setToFill++;
        }
      }
    }

    // Text grows with its content rather than clipping when it rewraps.
    // NONE pins the box; TRUNCATE pins it *and* replaces the overflow with an
    // ellipsis — both are the "clip the text to fit desktop" failure, and both
    // become auto height. WIDTH_AND_HEIGHT already grows.
    if (n.type === "TEXT") {
      try {
        if (n.textAutoResize === "NONE" || n.textAutoResize === "TRUNCATE") {
          n.textAutoResize = "HEIGHT";
          report.textAutoHeight++;
        }
      } catch (e) { /* not writable */ }
      // Critical: even with textAutoResize="HEIGHT", the layoutSizingVertical
      // can remain "FIXED" which keeps the pixel height locked. Force HUG.
      if (parentIsAutoLayout) {
        try {
          const currentVert = readVerticalSizing(n);
          if (currentVert !== "HUG") {
            // Text sizing is reported separately from container-height fixes.
            // Counting it as a released container height makes the summary
            // double-count text that was also changed to auto height.
            if (writeVerticalSizing(n, "HUG")) report.setToHug++;
          }
        } catch (e) { /* not writable */ }
      }
      // A text node can also be pinned by a max height, which survives cloning.
      clearHeightConstraints(n, report);
    }

    // Height → Hug contents for every container, at every depth.
    releaseFixedHeight(n, report);

    if (isContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };

  // Skip the root itself: its width is the viewport and is set deliberately.
  if (isContainer(root)) for (const c of root.children) walk(c, 0);
}

/**
 * Restore the responsive root's axis-independent sizing after resize().
 *
 * Figma's primary/counter axes depend on layout direction. Setting primary to
 * AUTO and counter to FIXED is correct for a vertical frame but exactly wrong
 * for a horizontal one. The responsive contract is expressed in physical
 * axes instead: viewport width stays FIXED; content-driven height becomes HUG.
 */
function configureResponsiveRootSizing(frame, report) {
  if (!isAutoLayout(frame)) return false;

  clearHeightConstraints(frame, report);
  const widthSet = writeHorizontalSizing(frame, "FIXED");
  const heightSet = writeVerticalSizing(frame, "HUG");

  if (!heightSet && report && Array.isArray(report.warnings)) {
    report.warnings.push(
      `${frame.name}: could not set the responsive root height to Hug contents.`
    );
  }
  if (!widthSet && report && Array.isArray(report.warnings)) {
    report.warnings.push(
      `${frame.name}: could not keep the responsive root width fixed to the viewport.`
    );
  }

  return widthSet && heightSet;
}

/** Turn a horizontal row into a vertical stack, preserving child order. */
function stackVertical(node) {
  if (isAbsolutePositionedLayer(node)) return false;
  if (!isContainer(node)) return false;
  if (!isAutoLayout(node)) return false;
  if (node.layoutMode !== "HORIZONTAL") return false;
  node.layoutMode = "VERTICAL";
  try {
    node.counterAxisAlignItems = "MIN";
  } catch (e) { /* alignment unsupported on this node */ }
  for (const child of node.children) {
    if (isAbsolutePositionedLayer(child)) continue;
    writeHorizontalSizing(child, "FILL");
  }
  return true;
}

/** Move the text child ahead of the media child, per mobile hero convention. */
function textBeforeMedia(node) {
  if (!isContainer(node) || node.children.length !== 2) return false;
  const [first, second] = node.children;
  if (isAbsolutePositionedLayer(first) || isAbsolutePositionedLayer(second)) return false;
  const firstIsMedia = nodeIsImageLike(first) || countDescendants(first, nodeIsImageLike, 20) > 0;
  const secondIsText = nodeIsTextLike(second);
  if (firstIsMedia && secondIsText) {
    node.insertChild(0, second);
    return true;
  }
  return false;
}

/**
 * Lay a uniform grid out at N columns.
 *
 * Cards are set to Fill container and given a MIN WIDTH, rather than a fixed
 * width. A fixed width would pin the cards to one viewport and break at every
 * other size — precisely what the "no fixed dimensions" rule exists to prevent.
 * A min-width is a constraint: it decides how many cards fit per row, and the
 * cards still stretch to consume whatever space that row actually has, so the
 * layout stays correct at intermediate widths too.
 */
function setGridColumns(node, columns, availableWidth, report) {
  if (!isContainer(node)) return false;
  if (isAbsolutePositionedLayer(node)) return false;
  const kids = node.children.filter(
    (c) => c.visible !== false && !isAbsolutePositionedLayer(c)
  );
  if (!kids.length) return false;

  if (columns === 1) {
    // A single column is a vertical stack; children simply fill the width.
    if (!isAutoLayout(node)) node.layoutMode = "VERTICAL";
    else node.layoutMode = "VERTICAL";
    try { node.layoutWrap = "NO_WRAP"; } catch (e) { /* unsupported */ }
    for (const child of kids) {
      writeHorizontalSizing(child, "FILL");
      try { if ("minWidth" in child) child.minWidth = null; } catch (e) { /* unsupported */ }
      releaseFixedHeight(child, report);
    }
    return true;
  }

  if (!isAutoLayout(node)) node.layoutMode = "HORIZONTAL";
  else node.layoutMode = "HORIZONTAL";
  try {
    node.layoutWrap = "WRAP";
  } catch (e) { /* older API without wrap; min-width still constrains sizing */ }

  const gap = typeof node.itemSpacing === "number" ? node.itemSpacing : 0;
  const inner = availableWidth - (node.paddingLeft || 0) - (node.paddingRight || 0);
  // The width at which exactly `columns` cards fit on one row.
  const minWidth = Math.max(1, Math.floor((inner - gap * (columns - 1)) / columns));

  let usedMinWidth = false;
  for (const child of kids) {
    writeHorizontalSizing(child, "FILL");
    releaseFixedHeight(child, report);
    try {
      if ("minWidth" in child) {
        child.minWidth = minWidth;
        usedMinWidth = true;
      }
    } catch (e) { /* min-width unsupported on this node */ }
  }

  if (!usedMinWidth && report) {
    // Without min-width support the row cannot be constrained to N columns
    // without a fixed width, which the sizing rules forbid. Say so plainly.
    report.warnings.push(
      `${node.name}: this Figma version does not support min-width, so a ${columns}-column ` +
        "row could not be constrained without fixed widths. Cards fill the row instead — " +
        "set a min width manually to control the column count."
    );
  }
  return true;
}

/** Stack multi-field form rows into single-column. */
function stackFormRows(node) {
  let changed = 0;
  const walk = (n, depth) => {
    if (!n || depth > 8) return;
    if (isAbsolutePositionedLayer(n)) return;
    if (isContainer(n) && isAutoLayout(n) && n.layoutMode === "HORIZONTAL") {
      const inputs = n.children.filter((c) => nodeIsInputLike(c) || countDescendants(c, nodeIsInputLike, 8) > 0);
      if (inputs.length >= 2) {
        n.layoutMode = "VERTICAL";
        for (const c of n.children) {
          if (!isAbsolutePositionedLayer(c)) writeHorizontalSizing(c, "FILL");
        }
        changed++;
      }
    }
    if (isContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return changed;
}

function inputsFillWidth(node) {
  let changed = 0;
  const walk = (n, depth) => {
    if (!n || depth > 10) return;
    if (isAbsolutePositionedLayer(n)) return;
    if (nodeIsInputLike(n)) {
      if (writeHorizontalSizing(n, "FILL")) changed++;
    }
    if (isContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return changed;
}

/**
 * Collapse desktop navigation for small screens.
 *
 * Reuse first: if the nav is an instance whose component set has a mobile-ish
 * variant, switch to it and touch nothing else. Only when no such variant
 * exists do we fall back to hiding the link list, and we always flag that
 * fallback for human review rather than pretending it is finished work.
 */
async function collapseNavigation(node, report) {
  // 1. Existing mobile variant on an existing component set.
  const instances = [];
  const walk = (n, depth) => {
    if (!n || depth > 6) return;
    if (isAbsolutePositionedLayer(n)) return;
    if (n.type === "INSTANCE") instances.push(n);
    if (isContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };
  if (node.type === "INSTANCE") instances.push(node);
  else walk(node, 0);

  for (const instance of instances) {
    try {
      const main = await instance.getMainComponentAsync();
      const set = main && main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null;
      if (!set || !set.variantGroupProperties) continue;

      for (const prop of Object.keys(set.variantGroupProperties)) {
        const values = set.variantGroupProperties[prop].values || [];
        const mobileValue = values.find((v) => /mobile|small|sm|compact|320|390/i.test(v));
        if (!mobileValue) continue;
        const current = instance.variantProperties ? instance.variantProperties[prop] : null;
        if (current === mobileValue) {
          report.reusedVariants.push(`${set.name} / ${prop}=${mobileValue} (already set)`);
          return { method: "existing-variant", flagged: false };
        }
        instance.setProperties({ [prop]: mobileValue });
        report.reusedVariants.push(`${set.name} / ${prop}=${mobileValue}`);
        return { method: "existing-variant", flagged: false };
      }
    } catch (e) {
      // Instance could not be switched; try the next one.
    }
  }

  // 2. An existing mobile navigation component elsewhere in the file.
  // "Do not create a new hamburger menu when the project already has one" —
  // so look for one before falling back to hiding anything.
  if (instances.length) {
    try {
      const candidates = figma.currentPage.findAllWithCriteria({ types: ["COMPONENT"] });
      const mobileNav = candidates.find((c) => {
        const nm = (c.name || "").toLowerCase();
        const parentName = c.parent && c.parent.name ? c.parent.name.toLowerCase() : "";
        const isNav = /nav|header|menu|topbar|app.?bar/.test(nm + " " + parentName);
        const isMobile = /mobile|small|compact|burger|hamburger|320|390/.test(nm + " " + parentName);
        return isNav && isMobile;
      });

      if (mobileNav && typeof instances[0].swapComponent === "function") {
        instances[0].swapComponent(mobileNav);
        report.reusedVariants.push(`${mobileNav.name} (existing mobile navigation component)`);
        return { method: "existing-component", flagged: false };
      }
    } catch (e) {
      // Search failed; fall through to the least-destructive fallback.
    }
  }

  // 3. Fallback: hide the link list so the bar cannot overflow, and flag it.
  let hidden = 0;
  const hideLinkLists = (n, depth) => {
    if (!n || depth > 5) return;
    if (isAbsolutePositionedLayer(n)) return;
    if (isContainer(n) && isAutoLayout(n) && n.layoutMode === "HORIZONTAL") {
      const linkish = n.children.filter((c) => {
        const nm = (c.name || "").toLowerCase();
        return /link|item|menu.?item|nav.?item/.test(nm) || c.type === "TEXT";
      });
      if (linkish.length >= 3 && n !== node) {
        n.visible = false;
        hidden++;
        return;
      }
    }
    if (isContainer(n)) for (const c of n.children) hideLinkLists(c, depth + 1);
  };
  hideLinkLists(node, 0);

  return { method: hidden ? "hid-desktop-links" : "none", flagged: true, hidden };
}

/** Release oversized fixed widths so content can reflow. */
function releaseFixedWidths(node, maxWidth) {
  let changed = 0;
  const walk = (n, depth) => {
    if (!n || depth > 12) return;
    if (isAbsolutePositionedLayer(n)) return;
    if (isContainer(n) && isAutoLayout(n)) {
      for (const child of n.children) {
        if (isAbsolutePositionedLayer(child)) continue;
        if (typeof child.width === "number" && child.width > maxWidth) {
          if (writeHorizontalSizing(child, "FILL")) changed++;
        }
      }
    }
    if (isContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return changed;
}

/** Make a table scroll horizontally instead of shrinking to illegibility. */
function tableHorizontalScroll(node) {
  try {
    if ("clipsContent" in node) node.clipsContent = true;
    if ("overflowDirection" in node) node.overflowDirection = "HORIZONTAL";
    return true;
  } catch (e) {
    return false;
  }
}

// ─── Generation ────────────────────────────────────────────────────────────

/**
 * Produce one responsive frame from a source frame.
 * Returns a per-frame report describing what was reused, changed and flagged.
 */
async function generateBreakpoint(source, presetKey, options) {
  const preset = options.preset || resolveResponsivePreset(presetKey, options.targetWidth);
  const preservation = options.preservation || "strict";
  const factor = preset.width / Math.max(1, source.width);

  const report = {
    breakpoint: preset.label,
    width: preset.width,
    frameId: null,
    frameName: "",
    created: false,
    updated: false,
    reusedExistingFrame: false,
    replacedEmptyPlaceholder: false,
    absoluteLayersPreserved: [],
    imageAspectRatiosPreserved: 0,
    desktopSpacingReferenceCount: 0,
    spacingIncreasesPrevented: [],
    desktopSpacingWarnings: [],
    sections: [],
    reusedVariants: [],
    // Typography is never altered across breakpoints — only verified.
    preservedTextStyles: 0,
    textStylesInUse: [],
    unlinkedText: [],
    // Sizing: fill/hug replacing fixed dimensions.
    setToFill: 0,
    setToHug: 0,
    textAutoHeight: 0,
    fixedHeightsReleased: 0,
    fixedWidthsReleased: 0,
    heightConstraintsCleared: 0,
    // Containers that cannot hug because they have no auto layout.
    fixedHeightBlockers: [],
    // Layer hygiene.
    renamed: [],
    removed: [],
    collapsed: [],
    warnings: [],
  };

  // ── Step 1: Clone the desktop source ──
  // Never modify the original desktop frame. Always work on a duplicate.
  let responsiveParent = source.parent || figma.currentPage;
  if (options.targetParentId) {
    const requestedParent = await getNodeByIdSafe(options.targetParentId);
    if (requestedParent && "appendChild" in requestedParent) responsiveParent = requestedParent;
  }

  let frame = findExistingBreakpointFrame(source, preset, responsiveParent);
  if (frame) {
    report.updated = true;
    report.reusedExistingFrame = true;
    const meaningfulChildren = isContainer(frame)
      ? frame.children.filter((child) => !child.removed && !isInstrumentation(child))
      : [];

    // A named but empty tablet/mobile frame is a placement placeholder, not a
    // responsive design. Refresh it from an exact desktop clone in the same
    // slot so the result is never rebuilt from scratch.
    if (isContainer(frame) && meaningfulChildren.length === 0) {
      const placeholder = frame;
      const placeholderIndex = isContainer(responsiveParent)
        ? responsiveParent.children.indexOf(placeholder)
        : -1;
      frame = source.clone();
      try {
        if (placeholderIndex >= 0 && typeof responsiveParent.insertChild === "function") {
          responsiveParent.insertChild(placeholderIndex, frame);
        } else if (frame.parent !== responsiveParent && typeof responsiveParent.appendChild === "function") {
          responsiveParent.appendChild(frame);
        }
        if (typeof placeholder.remove === "function") placeholder.remove();
        report.replacedEmptyPlaceholder = true;
      } catch (e) {
        report.warnings.push(`Could not refresh empty breakpoint placeholder: ${e && e.message}`);
      }
    }
  } else {
    frame = source.clone();
    report.created = true;
  }
  const desktopSpacingReferences = buildDesktopSpacingReferences(source, frame);
  report.desktopSpacingReferenceCount = desktopSpacingReferences.size;
  frame.name = buildResponsiveName(source.name, preset);
  report.frameName = frame.name;
  report.frameId = frame.id;
  report.absoluteLayersPreserved = collectAbsolutePositionedLayers(frame, false).map((layer) => ({
    id: layer.id,
    name: layer.name,
  }));
  report.imageAspectRatiosPreserved = preserveImageAspectRatios(source, frame);

  // ── Step 2: Place the clone in the correct location ──
  // If targetParentId is given, place inside that specific section/frame.
  // Otherwise, place beside the source with a gutter.
  const targetParentId = options.targetParentId;
  if (targetParentId) {
    const targetParent = await getNodeByIdSafe(targetParentId);
    if (targetParent && "appendChild" in targetParent) {
      try {
        targetParent.appendChild(frame);
        report.placedInTarget = targetParent.name;
      } catch (e) {
        report.warnings.push(`Could not place in target "${targetParent.name}": ${e && e.message}`);
      }
    } else {
      report.warnings.push(`Target parent "${targetParentId}" not found or cannot hold children.`);
    }
  } else {
    const parent = source.parent || figma.currentPage;
    if (isContainer(parent)) {
      try {
        parent.appendChild(frame);
      } catch (e) { /* parent refused; clone stays where it landed */ }
    }
    if (!isAutoLayout(parent)) {
      frame.x = source.x + source.width + (options.gutter || 120);
      frame.y = source.y;
    }
  }

  // Canonical organization on the canvas: Desktop, Tablet, Mobile. This also
  // corrects the append-only placement above when a responsive sibling exists.
  placeResponsiveFrame(
    frame,
    source,
    presetKey,
    responsiveParent,
    options.gutter || 120,
    report
  );

  // Resize to the target viewport. Height hugs if the frame auto-layouts.
  try {
    frame.resize(preset.width, frame.height);
  } catch (e) {
    report.warnings.push(`Could not resize frame to ${preset.width}px: ${e && e.message}`);
  }
  if (isAutoLayout(frame)) {
    // Width is the viewport and is set deliberately; height follows content.
    configureResponsiveRootSizing(frame, report);
  } else {
    // Without auto layout the clone keeps the source's height verbatim, so the
    // desktop height becomes the tablet/mobile height and content clips as soon
    // as it rewraps. Nothing downstream can fix this — the frame needs auto
    // layout before it can be made responsive.
    report.warnings.push(
      `${frame.name} has no Auto Layout, so it kept the source height of ` +
        `${Math.round(frame.height)}px. Height cannot follow content until the ` +
        "frame uses Auto Layout — add it on the source frame and regenerate."
    );
  }

  // Apply the container rule for this breakpoint.
  if (isAutoLayout(frame)) {
    if (frame.paddingLeft > preset.sidePadding) frame.paddingLeft = preset.sidePadding;
    if (frame.paddingRight > preset.sidePadding) frame.paddingRight = preset.sidePadding;
    const spacing = SECTION_SPACING_FALLBACK[presetKey];
    if (typeof frame.itemSpacing === "number" && frame.itemSpacing > spacing.max) {
      frame.itemSpacing = spacing.max;
    }
  }

  // Adapt each section according to its plan.
  const children = isContainer(frame) ? frame.children.slice() : [];
  const total = children.length;

  for (let i = 0; i < total; i++) {
    const child = children[i];
    if (!child || child.removed || isInstrumentation(child)) continue;
    if (isAbsolutePositionedLayer(child)) {
      report.sections.push({
        name: child.name,
        kind: "absolute",
        changes: ["kept exactly as desktop; manual designer adjustment"],
      });
      continue;
    }

    const analysis = analyzeSection(child, i, total);
    const behaviors = decideBehaviors(analysis, presetKey, preservation, preset);
    const applied = [];

    for (const behavior of behaviors) {
      try {
        if (behavior === "reduce-padding") {
          applyPaddingScale(
            child,
            Math.max(0.5, factor),
            preset.sidePadding,
            SECTION_SPACING_FALLBACK[presetKey].min
          );
          applied.push("reduced padding");
        } else if (behavior === "reduce-gap") {
          if (isAutoLayout(child) && typeof child.itemSpacing === "number") {
            child.itemSpacing = Math.min(child.itemSpacing, preset.sidePadding);
            applied.push("reduced gap");
          }
        } else if (behavior === "release-fixed-width") {
          const n = releaseFixedWidths(child, preset.width - preset.sidePadding * 2);
          report.fixedWidthsReleased += n;
          if (n) applied.push(`released ${n} fixed width${n === 1 ? "" : "s"}`);
        } else if (behavior === "stack-vertical") {
          if (stackVertical(child)) applied.push("stacked vertically");
        } else if (behavior === "text-before-media") {
          if (textBeforeMedia(child)) applied.push("moved media below copy");
        } else if (behavior === "media-full-width") {
          for (const c of child.children || []) {
            if (!isAbsolutePositionedLayer(c) && nodeIsImageLike(c)) {
              writeHorizontalSizing(c, "FILL");
            }
          }
          applied.push("media full width");
        } else if (behavior === "equalize-split") {
          for (const c of child.children || []) {
            if (!isAbsolutePositionedLayer(c)) writeHorizontalSizing(c, "FILL");
          }
          applied.push("equalised split");
        } else if (behavior.indexOf("columns:") === 0) {
          const cols = parseInt(behavior.split(":")[1], 10);
          const before = analysis.columns || analysis.childCount;
          if (setGridColumns(child, cols, preset.width - preset.sidePadding * 2, report)) {
            applied.push(`${before} columns → ${cols}`);
          }
        } else if (behavior === "enable-wrap") {
          if (isContainer(child) && isAutoLayout(child) && child.layoutMode === "HORIZONTAL") {
            try { child.layoutWrap = "WRAP"; applied.push("enabled wrapping"); } catch (e) { /* unsupported */ }
          }
        } else if (behavior === "stack-form-rows") {
          const n = stackFormRows(child);
          if (n) applied.push(`stacked ${n} form row${n === 1 ? "" : "s"}`);
        } else if (behavior === "inputs-fill-width") {
          const n = inputsFillWidth(child);
          if (n) applied.push(`${n} inputs fill width`);
        } else if (behavior === "collapse-navigation") {
          const nav = await collapseNavigation(child, report);
          if (nav.method === "existing-variant") {
            applied.push("switched to existing mobile nav variant");
          } else if (nav.method === "existing-component") {
            applied.push("swapped to the file's existing mobile navigation component");
          } else if (nav.method === "hid-desktop-links") {
            applied.push("hid desktop link list");
            report.warnings.push(
              `${child.name}: no mobile navigation variant exists in the component set. ` +
                "The desktop link list was hidden to prevent overflow — a hamburger " +
                "menu and open/close states still need to be added."
            );
          } else {
            report.warnings.push(
              `${child.name}: could not determine a safe mobile navigation pattern. Left unchanged.`
            );
          }
        } else if (behavior === "table-horizontal-scroll") {
          if (tableHorizontalScroll(child)) applied.push("table scrolls horizontally");
        } else if (behavior === "flag-manual-review") {
          report.warnings.push(
            `${child.name} (${analysis.kind}): no safe automatic responsive pattern. ` +
              "Least-destructive adjustment applied; manual review required."
          );
        } else if (behavior === "flag-absolute-positioning") {
          report.warnings.push(
            `${child.name}: kept ${analysis.absoluteChildren.length} absolute-positioned ` +
              `layer${analysis.absoluteChildren.length === 1 ? "" : "s"} exactly as copied from ` +
              "desktop. They were not ungrouped, resized, rebound, renamed, reordered, or " +
              "otherwise adapted. Manual designer adjustment is required."
          );
        }
      } catch (err) {
        report.warnings.push(
          `${child.name}: "${behavior}" failed (${err && err.message}). Section left as cloned.`
        );
      }
    }

    report.sections.push({
      name: analysis.name,
      kind: analysis.kind,
      changes: applied,
    });
  }

  // Enforce Fill/Hug sizing across the whole frame. This runs in every
  // preservation mode: fixed widths and heights are a correctness problem at
  // other viewports, not a stylistic preference.
  enforceResponsiveSizing(frame, report);

  // ── Bind local variables (Layout, Gap, Radius, Responsive Text Container) ──
  // After responsive sizing is set, bind design-system tokens so breakpoint
  // modes (Desk/Tab/Mobi) automatically resolve to the correct values.
  try {
    const varResult = await bindVariablesToSubtree(frame);
    if (varResult.bindings.length > 0) {
      report.variablesBound = varResult.bindings.length;
      report.variableBindings = varResult.bindings;
    }
    if (varResult.collections.length > 0) {
      report.variableCollections = varResult.collections.map(
        c => ({ name: c.name, modes: c.modes.map(m => m.name) })
      );
    }

    report.absoluteVariableModesPreserved = await preserveAbsoluteVariableModes(
      frame,
      varResult.collections
    );

    // A clone inherits the desktop frame's explicit variable modes. Binding
    // responsive tokens without changing that mode leaves Tablet/Mobile using
    // Desktop values even though the bindings themselves look correct.
    const modeResult = await applyBreakpointVariableModes(
      frame,
      preset.width,
      varResult.collections
    );
    report.variableModes = modeResult.applied;
    for (const warning of modeResult.warnings) report.warnings.push(warning);
  } catch (e) {
    report.warnings.push(`Variable binding failed: ${e && e.message}`);
  }

  // The desktop layout is the hard upper bound for gaps and padding. Run this
  // after responsive variable modes resolve, because an otherwise valid Tab or
  // Mobi token can accidentally be larger than its desktop value.
  try {
    await enforceDesktopSpacingCeiling(desktopSpacingReferences, report);
  } catch (e) {
    report.warnings.push(
      `Desktop spacing comparison failed: ${e && e.message ? e.message : String(e)}`
    );
  }

  // Tidy the layer tree. Runs after the layout work so names describe the
  // final structure, and before the typography check so that check sees what
  // actually shipped.
  if (options.cleanLayers !== false) {
    cleanLayers(frame, options.cleanupOptions, report);
  }

  // Confirm typography came through untouched. Deliberately read-only: the
  // same local style must appear at every breakpoint.
  verifyTypographyPreserved(frame, options.textStyleIndex, report);

  if (report.fixedHeightBlockers.length) {
    const sample = report.fixedHeightBlockers
      .slice(0, 5)
      .map((b) => `${b.name} (${b.height}px)`)
      .join(", ");
    report.warnings.push(
      `${report.fixedHeightBlockers.length} container(s) keep a fixed height because they ` +
        `have no Auto Layout: ${sample}${report.fixedHeightBlockers.length > 5 ? ", …" : ""}. ` +
        "Height cannot hug content on a frame without Auto Layout — add Auto Layout to these " +
        "wrappers (set_auto_layout) so their height follows what is inside them."
    );
  }

  if (report.unlinkedText.length) {
    const sample = report.unlinkedText.slice(0, 5).join(", ");
    report.warnings.push(
      `${report.unlinkedText.length} text layer(s) are not linked to a local text style ` +
        `(${sample}${report.unlinkedText.length > 5 ? ", …" : ""}). ` +
        "They were left untouched — link them to a local style rather than setting values by hand."
    );
  }

  return report;
}

/** Follow the project's naming convention when we can infer one. */
function buildResponsiveName(sourceName, preset) {
  const base = responsiveBaseName(sourceName);
  const breakpointLabel = preset.key === "tablet" ? "Tab" : preset.label;
  return `${base} \u2013 ${preset.width}px ${breakpointLabel}`;

  const name = (sourceName || "Frame").trim();
  // "Homepage / Desktop / 1440" → "Homepage / Mobile / 320"
  const slashPattern = /^(.*?)\s*\/\s*(desktop|tablet|mobile)\s*\/\s*\d+\s*$/i;
  const m = name.match(slashPattern);
  if (m) return `${m[1]} / ${preset.label} / ${preset.width}`;

  const trailing = /^(.*?)[\s\-–—/]*\b(desktop|tablet|mobile)\b.*$/i;
  const t = name.match(trailing);
  if (t) return `${t[1].trim()} / ${preset.label} / ${preset.width}`;

  return `${name} / ${preset.label} / ${preset.width}`;
}

// ─── QA validation ─────────────────────────────────────────────────────────

/**
 * Check a frame for the failure modes that make a layout "not responsive".
 * `width` may differ from the frame's own width so a 320-wide frame can also
 * be reasoned about at 390 without creating another frame.
 */
function validateResponsive(node, width, label) {
  const issues = [];
  const viewport = typeof width === "number" ? width : node.width;
  const frameBox = node.absoluteBoundingBox;

  let inspected = 0;
  const walk = (n, depth) => {
    if (!n || depth > 12 || inspected > 3000 || n.removed) return;
    if (n.visible === false || isInstrumentation(n)) return;
    inspected++;

    if (isAbsolutePositionedLayer(n)) {
      issues.push({
        severity: "warning",
        type: "absolute-positioned-manual",
        node: n.name,
        nodeId: n.id,
        message:
          "preserved exactly from desktop and intentionally excluded from responsive QA; " +
          "manual designer adjustment required",
      });
      return;
    }

    const box = n.absoluteBoundingBox;

    if (box && frameBox) {
      const relLeft = box.x - frameBox.x;
      const relRight = relLeft + box.width;

      // Horizontal overflow — the single most common responsive failure.
      if (relRight > viewport + 0.5) {
        issues.push({
          severity: "error",
          type: "horizontal-overflow",
          node: n.name,
          nodeId: n.id,
          message: `extends ${Math.round(relRight - viewport)}px past the ${viewport}px viewport`,
        });
      }
      if (relLeft < -0.5) {
        issues.push({
          severity: "error",
          type: "off-canvas",
          node: n.name,
          nodeId: n.id,
          message: `starts ${Math.round(-relLeft)}px left of the frame`,
        });
      }
    }

    // Fixed widths wider than the viewport can never fit.
    if (typeof n.width === "number" && n.width > viewport && n.parent && isAutoLayout(n.parent)) {
      if (readHorizontalSizing(n) === "FIXED") {
        issues.push({
          severity: "error",
          type: "fixed-width-too-wide",
          node: n.name,
          nodeId: n.id,
          message: `fixed at ${Math.round(n.width)}px inside a ${viewport}px viewport`,
        });
      }
    }

    // Readability.
    if (n.type === "TEXT" && typeof n.fontSize === "number" && n.fontSize < MIN_READABLE_FONT) {
      issues.push({
        severity: "warning",
        type: "text-too-small",
        node: n.name,
        nodeId: n.id,
        message: `${n.fontSize}px is below the ${MIN_READABLE_FONT}px readability floor`,
      });
    }

    // Layer hygiene: a generic name tells the next reader nothing.
    if (n !== node && isGenericName(n.name) && !isInsideInstance(n)) {
      issues.push({
        severity: "warning",
        type: "generic-layer-name",
        node: n.name,
        nodeId: n.id,
        message: "auto-generated layer name — rename it for what it is",
      });
    }

    // Empty and purposeless layers.
    if (n !== node && isRemovableLayer(n) && !isInsideInstance(n)) {
      issues.push({
        severity: "warning",
        type: "empty-layer",
        node: n.name,
        nodeId: n.id,
        message: "empty or zero-size layer with no layout or visual purpose",
      });
    }

    // A text layer pinned to a fixed height clips the moment it rewraps.
    // textAutoResize can say HEIGHT while the Auto Layout axis is still FIXED,
    // so validation must check both representations of the same constraint.
    let textLayoutIsFixed = false;
    if (n.type === "TEXT" && n.parent && isAutoLayout(n.parent)) {
      try { textLayoutIsFixed = readVerticalSizing(n) === "FIXED"; } catch (e) { /* unavailable */ }
    }
    if (
      n.type === "TEXT" &&
      (n.textAutoResize === "NONE" || n.textAutoResize === "TRUNCATE" || textLayoutIsFixed)
    ) {
      issues.push({
        severity: "warning",
        type: "text-fixed-height",
        node: n.name,
        nodeId: n.id,
        message:
          n.textAutoResize === "TRUNCATE"
            ? "set to truncate — it clips instead of growing when it wraps to more lines"
            : n.textAutoResize === "NONE"
              ? "fixed height — set auto height so it grows when it wraps to more lines"
              : "Auto Layout vertical sizing is Fixed — set it to Hug so wrapped text can grow",
      });
    }

    // Typography that is not linked to a local style carries arbitrary values
    // and will not follow the design system when it changes.
    if (n.type === "TEXT" && (!n.textStyleId || n.textStyleId === "")) {
      issues.push({
        severity: "warning",
        type: "typography-not-linked",
        node: n.name,
        nodeId: n.id,
        message: "not linked to a local text style — its size and spacing are arbitrary values",
      });
    }

    // Fixed dimensions inside auto layout: the sizing rule violation that
    // breaks a layout at every viewport other than the one it was set for.
    if (n.parent && isAutoLayout(n.parent) && !hasIntrinsicSize(n) && n.type !== "TEXT") {
      if (isContainer(n) && readHorizontalSizing(n) === "FIXED") {
        issues.push({
          severity: "warning",
          type: "fixed-width-container",
          node: n.name,
          nodeId: n.id,
          message: `fixed width (${Math.round(n.width)}px) — use Fill container or Hug contents instead`,
        });
      }
      // Containers only: a rectangle, image or vector is allowed a real height.
      if (isContainer(n) && readVerticalSizing(n) === "FIXED") {
        issues.push({
          severity: "warning",
          type: "fixed-height",
          node: n.name,
          nodeId: n.id,
          message: isAutoLayout(n)
            ? `fixed height (${Math.round(n.height)}px) — content cannot grow when it reflows`
            : `fixed height (${Math.round(n.height)}px) with no Auto Layout — it cannot hug ` +
              "its content until the frame uses Auto Layout",
        });
      }

      // A min/max height pins a frame that otherwise reads as "Hug contents",
      // so the sizing dropdown looks right while the height stays stuck.
      for (const prop of ["minHeight", "maxHeight"]) {
        if (typeof n[prop] === "number") {
          issues.push({
            severity: "warning",
            type: "height-constraint",
            node: n.name,
            nodeId: n.id,
            message: `${prop} of ${Math.round(n[prop])}px pins the height even where sizing reads as Hug`,
          });
        }
      }
    }


    // Tap targets.
    if (nodeIsButtonLike(n) && typeof n.height === "number" && n.height > 0 && n.height < MIN_TAP_TARGET) {
      issues.push({
        severity: "warning",
        type: "tap-target-small",
        node: n.name,
        nodeId: n.id,
        message: `${Math.round(n.height)}px tall, below the ${MIN_TAP_TARGET}px tap-target minimum`,
      });
    }

    // Overlap between siblings in a non-auto-layout container.
    if (isContainer(n) && !isAutoLayout(n) && n.children.length > 1 && n.children.length < 40) {
      const boxes = n.children
        .filter(
          (c) =>
            c.visible !== false &&
            !isAbsolutePositionedLayer(c) &&
            c.absoluteBoundingBox
        )
        .map((c) => ({ c, b: c.absoluteBoundingBox }));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].b;
          const b = boxes[j].b;
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          // Require meaningful overlap on both axes — deliberate stacking
          // (badges, avatars) touches edges and should not be reported.
          if (overlapX > 8 && overlapY > 8) {
            issues.push({
              severity: "warning",
              type: "overlap",
              node: `${boxes[i].c.name} ↔ ${boxes[j].c.name}`,
              nodeId: boxes[i].c.id,
              message: `overlap by ${Math.round(overlapX)}×${Math.round(overlapY)}px`,
            });
          }
        }
      }
    }

    if (isContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };

  walk(node, 0);

  // Deduplicate: one message per node per issue type.
  const seen = {};
  const unique = [];
  for (const issue of issues) {
    const key = `${issue.type}|${issue.nodeId}`;
    if (seen[key]) continue;
    seen[key] = true;
    unique.push(issue);
  }

  const errors = unique.filter((i) => i.severity === "error");
  return {
    label: label || `${viewport}px`,
    viewport,
    frameId: node.id,
    frameName: node.name,
    inspected,
    passed: errors.length === 0,
    errorCount: errors.length,
    warningCount: unique.length - errors.length,
    issues: unique.slice(0, 120),
    truncated: unique.length > 120 ? unique.length - 120 : 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER CLEANUP
// ═══════════════════════════════════════════════════════════════════════════
//
// Clean layers → meaningful names → remove redundancy → Auto Layout →
// Fill container → Hug contents → no fixed height.
//
// A file can look correct and still be unusable by the next person who opens
// it. This pass makes the layer tree itself legible.
//
// THE SAFETY BOUNDARY: this never descends into a component instance. An
// instance's children take their names and structure from the main component;
// renaming or deleting inside one produces overrides that fight the design
// system. Instances are treated as sealed units — their contents are exactly
// as designed, and not ours to tidy.

// Figma's auto-generated names: "Frame 123", "Group 45", "Rectangle 12",
// "Text 8", "Component 27", "Vector 16", "Ellipse 3", "Line 2"...
const GENERIC_NAME_PATTERN =
  /^(frame|group|rectangle|rect|text|component|vector|ellipse|line|star|polygon|slice|image|instance|union|subtract|intersect|exclude)(\s+\d+)?$/i;

function isGenericName(name) {
  return GENERIC_NAME_PATTERN.test(String(name || "").trim());
}

/** Inside a component instance nothing may be renamed, removed or restructured. */
function isInsideInstance(node) {
  let p = node.parent;
  let depth = 0;
  while (p && depth < 30) {
    if (p.type === "INSTANCE") return true;
    p = p.parent;
    depth++;
  }
  return false;
}

function isComponentLike(node) {
  return node.type === "INSTANCE" || node.type === "COMPONENT" || node.type === "COMPONENT_SET";
}

/**
 * Does this frame earn its place in the tree?
 *
 * A frame is justified when it controls auto layout, padding, gap, alignment,
 * responsive direction, clipping, background, border or component structure.
 * A frame that does none of those is a wrapper around nothing.
 */
function frameHasLayoutPurpose(node) {
  if (!node || !isContainer(node)) return true;
  if (isComponentLike(node)) return true;
  if (containsAbsolutePositionedLayer(node)) return true;

  if (isAutoLayout(node)) return true;
  if (node.clipsContent) return true;

  const hasFill = Array.isArray(node.fills) && node.fills.some((f) => f && f.visible !== false);
  if (hasFill) return true;
  const hasStroke = Array.isArray(node.strokes) && node.strokes.length > 0;
  if (hasStroke) return true;
  const hasEffects = Array.isArray(node.effects) && node.effects.some((e) => e && e.visible !== false);
  if (hasEffects) return true;

  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) return true;
  if (typeof node.opacity === "number" && node.opacity < 1) return true;
  if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") return true;

  return false;
}

/** Node types that genuinely hold other layers. */
const CONTAINER_TYPES = {
  FRAME: true, GROUP: true, COMPONENT: true, COMPONENT_SET: true,
  INSTANCE: true, SECTION: true,
};

function isLayoutContainerType(node) {
  return !!(node && CONTAINER_TYPES[node.type]);
}

function hasVisualPresence(node) {
  const hasFill = Array.isArray(node.fills) && node.fills.some((f) => f && f.visible !== false);
  const hasStroke = Array.isArray(node.strokes) && node.strokes.length > 0;
  const hasEffects = Array.isArray(node.effects) && node.effects.some((e) => e && e.visible !== false);
  return hasFill || hasStroke || hasEffects;
}

/**
 * Empty containers and zero-size shapes serve no layout or visual purpose.
 *
 * Deliberately conservative. Deleting is the one irreversible thing this whole
 * feature does, so anything ambiguous is left alone and reported instead:
 *
 *   - TEXT is judged only on whether it has content. It is never treated as an
 *     "empty container" — a text layer has no children by definition.
 *   - A sized, empty frame inside an Auto Layout parent is very likely a
 *     deliberate spacer. Removing it would silently change the layout, so it is
 *     flagged rather than deleted.
 */
function isRemovableLayer(node) {
  if (!node || node.removed) return false;
  if (isComponentLike(node)) return false;
  if (isInstrumentation(node)) return false;
  if (isAbsolutePositionedLayer(node)) return false;

  // Text: content is the only question.
  if (node.type === "TEXT") {
    return typeof node.characters === "string" && node.characters.trim() === "";
  }

  // Anything with no area renders nothing.
  if (typeof node.width === "number" && typeof node.height === "number") {
    if (node.width < 0.5 || node.height < 0.5) return true;
  }

  if (isLayoutContainerType(node) && Array.isArray(node.children) && node.children.length === 0) {
    // Doing visual work in its own right — a divider, a coloured block.
    if (hasVisualPresence(node)) return false;

    // Hidden and empty: nothing to lose.
    if (node.visible === false) return true;

    // Sized and empty inside Auto Layout: probably a spacer. Leave it.
    const parentIsAutoLayout = node.parent && isAutoLayout(node.parent);
    if (parentIsAutoLayout && node.width > 0.5 && node.height > 0.5) return false;

    return true;
  }

  return false;
}

/** Empty frames we chose not to delete, so a human can decide. */
function isPossibleSpacer(node) {
  if (!node || node.removed || node.type === "TEXT") return false;
  if (!isLayoutContainerType(node)) return false;
  if (!Array.isArray(node.children) || node.children.length !== 0) return false;
  if (hasVisualPresence(node) || node.visible === false) return false;
  return !!(node.parent && isAutoLayout(node.parent) && node.width > 0.5 && node.height > 0.5);
}

function shortenForName(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const max = limit || 32;
  if (!text) return "";
  return text.length > max ? text.slice(0, max).trim() + "…" : text;
}

function findFirstText(node, budget) {
  let found = null;
  const limit = budget || 60;
  let seen = 0;
  const walk = (n, depth) => {
    if (found || !n || depth > 6 || seen > limit) return;
    seen++;
    if (n.type === "TEXT" && n.characters && n.characters.trim()) {
      found = n;
      return;
    }
    if (isContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return found;
}

/**
 * Derive a meaningful name from what a layer actually is.
 * Deterministic, so the same source produces the same names at every
 * breakpoint — which is what keeps the three frames structurally comparable.
 */
function inferLayerName(node, context) {
  const ctx = context || {};

  if (node.type === "TEXT") {
    const chars = shortenForName(node.characters, 30);
    return chars || "Text";
  }

  if (nodeIsButtonLike(node)) return node.name && !isGenericName(node.name) ? node.name : "Button";
  if (nodeIsInputLike(node)) return node.name && !isGenericName(node.name) ? node.name : "Input Field";

  if (nodeIsImageLike(node)) return "Image";

  // A top-level section names itself after its role.
  if (ctx.sectionKind) {
    const map = {
      navigation: "Navigation",
      hero: "Hero Section",
      cardGrid: "Card Grid",
      form: "Form",
      table: "Table",
      footer: "Footer",
      generic: "Section",
    };
    return map[ctx.sectionKind] || "Section";
  }

  if (isContainer(node)) {
    const kids = node.children.filter((c) => c.visible !== false);
    if (kids.length === 0) return "Empty Frame";

    // A container holding one image is an image wrapper.
    if (kids.length === 1 && nodeIsImageLike(kids[0])) return "Media";

    const allText = kids.every((c) => c.type === "TEXT");
    if (allText) {
      const first = findFirstText(node);
      if (first) return shortenForName(first.characters, 24) + " Group";
      return "Text Content";
    }

    if (kids.every((c) => nodeIsButtonLike(c))) return "CTA Group";

    const first = findFirstText(node);
    if (first) return shortenForName(first.characters, 24) + " Block";

    // Never fall back to a name that is itself generic ("Group", "Frame").
    if (kids.every((c) => nodeIsImageLike(c))) return "Media Group";
    return isAutoLayout(node) ? "Content" : "Content Group";
  }

  return node.type
    ? node.type.charAt(0) + node.type.slice(1).toLowerCase().replace(/_/g, " ")
    : "Layer";
}

/**
 * Remove empty and purposeless layers.
 * Runs bottom-up so that a wrapper emptied by its children's removal is itself
 * then removable in the same pass.
 */
function removeUnwantedLayers(root, report) {
  const walk = (node, depth) => {
    if (!node || node.removed || depth > 16) return;
    if (isInstrumentation(node)) return;
    if (isAbsolutePositionedLayer(node)) return;
    // Never restructure the inside of a component.
    if (node.type === "INSTANCE") return;

    if (isContainer(node)) {
      // Copy the list: children mutate as we remove.
      for (const child of node.children.slice()) walk(child, depth + 1);
    }

    if (node === root) return;

    if (isPossibleSpacer(node)) {
      report.warnings.push(
        `"${node.name}" is an empty ${Math.round(node.width)}×${Math.round(node.height)} frame ` +
          "inside an Auto Layout parent. It was kept in case it is a deliberate spacer — " +
          "delete it manually if it is not, or replace it with a gap value."
      );
      return;
    }

    if (isRemovableLayer(node)) {
      const label = `${node.name} (${node.type.toLowerCase()})`;
      try {
        node.remove();
        report.removed.push(label);
      } catch (e) {
        // Locked or otherwise unremovable — leave it.
      }
    }
  };
  walk(root, 0);
}

/**
 * Collapse wrappers that provide no layout function.
 *
 * Only a single-child frame with no auto layout, background, border, effect or
 * clipping is collapsed — those are pure nesting. Anything doing real work is
 * left exactly as it is.
 */
function collapseRedundantWrappers(root, report) {
  let collapsed = 0;

  const walk = (node, depth) => {
    if (!node || node.removed || depth > 16) return;
    if (isInstrumentation(node) || node.type === "INSTANCE") return;
    if (isAbsolutePositionedLayer(node)) return;
    if (isContainer(node)) for (const child of node.children.slice()) walk(child, depth + 1);

    if (node === root || !node.parent) return;
    if (!isContainer(node) || isComponentLike(node)) return;
    if (node.children.length !== 1) return;
    if (frameHasLayoutPurpose(node)) return;

    const parent = node.parent;
    if (!isContainer(parent)) return;

    const child = node.children[0];
    if (isInstrumentation(child)) return;

    try {
      const index = parent.children.indexOf(node);
      parent.insertChild(index, child);
      const label = node.name;
      node.remove();
      report.collapsed.push(label);
      collapsed++;
    } catch (e) {
      // Reparenting refused (locked layer, incompatible parent) — leave it.
    }
  };

  walk(root, 0);
  return collapsed;
}

/**
 * Give every layer a meaningful name, and number repeated siblings
 * consistently: "Feature Card / 01", "Feature Card / 02", …
 */
function renameLayers(root, sectionKinds, report) {
  const walk = (node, depth, sectionKind) => {
    if (!node || node.removed || depth > 16) return;
    if (isInstrumentation(node)) return;
    if (isAbsolutePositionedLayer(node)) return;
    // An instance's own name may be improved, but never its children's.
    const descend = node.type !== "INSTANCE";

    if (node !== root && !isInsideInstance(node)) {
      if (isGenericName(node.name)) {
        const suggested = inferLayerName(node, { sectionKind });
        if (suggested && suggested !== node.name) {
          try {
            const before = node.name;
            node.name = suggested;
            report.renamed.push(`${before} → ${suggested}`);
          } catch (e) { /* name not writable */ }
        }
      }
    }

    if (descend && isContainer(node)) {
      for (const child of node.children) walk(child, depth + 1, null);

      // Number repeated siblings that share a name.
      const byName = {};
      for (const child of node.children) {
        if (child.removed || isInsideInstance(child) || isAbsolutePositionedLayer(child)) continue;
        const key = child.name;
        if (!byName[key]) byName[key] = [];
        byName[key].push(child);
      }
      for (const key of Object.keys(byName)) {
        const group = byName[key];
        if (group.length < 3) continue;
        if (/\s\/\s\d+$/.test(key)) continue; // already numbered
        for (let i = 0; i < group.length; i++) {
          const numbered = `${key} / ${String(i + 1).padStart(2, "0")}`;
          try {
            group[i].name = numbered;
          } catch (e) { /* not writable */ }
        }
        report.renamed.push(`${key} ×${group.length} → ${key} / 01…`);
      }
    }
  };

  // Top-level children carry their section classification into naming.
  if (isContainer(root)) {
    const kids = root.children;
    for (let i = 0; i < kids.length; i++) {
      const kind = sectionKinds && sectionKinds[i] ? sectionKinds[i] : null;
      walk(kids[i], 1, kind);
    }
  }
}

/** Flag groups that are standing in for responsive structure. */
function flagLayoutGroups(root, report) {
  const walk = (node, depth) => {
    if (!node || node.removed || depth > 14) return;
    if (node.type === "INSTANCE" || isInstrumentation(node)) return;
    if (isAbsolutePositionedLayer(node)) return;

    if (node.type === "GROUP" && node.children && node.children.length > 1) {
      report.warnings.push(
        `"${node.name}" is a Group holding ${node.children.length} layers. Groups cannot ` +
          "control padding, gap or direction, so they do not adapt across breakpoints. " +
          "Convert it to an Auto Layout frame."
      );
    }
    if (isContainer(node)) for (const c of node.children) walk(c, depth + 1);
  };
  walk(root, 0);
}

/** Report nesting chains deep enough to be hard to follow. */
function flagExcessiveNesting(root, report, maxDepth) {
  const limit = maxDepth || 6;
  const walk = (node, depth, trail) => {
    if (!node || node.removed || depth > 18) return;
    if (node.type === "INSTANCE" || isInstrumentation(node)) return;
    if (isAbsolutePositionedLayer(node)) return;

    if (depth >= limit && isContainer(node) && node.children.length === 1) {
      report.warnings.push(
        `Deep nesting (${depth} levels): ${trail.slice(-limit).join(" → ")}. ` +
          "Flatten wrappers that do not control layout."
      );
      return; // one report per chain
    }
    if (isContainer(node)) {
      for (const c of node.children) walk(c, depth + 1, trail.concat([c.name]));
    }
  };
  walk(root, 0, [root.name]);
}

/**
 * Full cleanup pass. Order matters: remove dead layers first, then collapse the
 * wrappers that removal has emptied of purpose, then name what remains — so
 * names describe the final structure rather than an intermediate one.
 */
function cleanLayers(root, options, report) {
  const opts = options || {};

  if (opts.removeUnwanted !== false) removeUnwantedLayers(root, report);
  if (opts.collapseWrappers !== false) collapseRedundantWrappers(root, report);

  // Re-derive section kinds after restructuring so names match reality.
  let sectionKinds = null;
  if (isContainer(root)) {
    const kids = root.children.filter((c) => !isInstrumentation(c));
    sectionKinds = kids.map((c, i) => classifySection(c, i, kids.length));
  }

  if (opts.rename !== false) renameLayers(root, sectionKinds, report);
  if (opts.flagGroups !== false) flagLayoutGroups(root, report);
  if (opts.flagNesting !== false) flagExcessiveNesting(root, report);

  return report;
}

function emptyCleanupReport() {
  return { renamed: [], removed: [], collapsed: [], warnings: [] };
}

// ─── Command entry points ──────────────────────────────────────────────────

async function resolveResponsiveTarget(params) {
  const nodeId = params && params.nodeId;
  if (nodeId) {
    const node = await getNodeByIdSafe(nodeId);
    if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
    return node;
  }
  const selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) {
    throw new Error(
      "Nothing selected. Select a desktop frame, page or section in Figma, or pass nodeId."
    );
  }
  return selection[0];
}

/**
 * Standalone layer cleanup, for tidying a frame the responsive flow did not
 * generate — most usefully the desktop source, so all three breakpoints end up
 * with matching names.
 */
async function cleanLayersCommand(params) {
  const opts = params || {};
  const node = await resolveResponsiveTarget(opts);

  const report = emptyCleanupReport();
  const before = countDescendants(node, function () { return true; }, 5000);

  if (opts.dryRun) {
    // Report only: flag what would change without touching the document.
    const generic = [];
    const empties = [];
    const walk = (n, depth) => {
      if (!n || depth > 16 || n.removed) return;
      if (isInstrumentation(n) || isInsideInstance(n)) return;
      if (n !== node && isGenericName(n.name)) generic.push(n.name);
      if (n !== node && isRemovableLayer(n)) empties.push(`${n.name} (${n.type.toLowerCase()})`);
      if (isContainer(n) && n.type !== "INSTANCE") for (const c of n.children) walk(c, depth + 1);
    };
    walk(node, 0);
    flagLayoutGroups(node, report);
    flagExcessiveNesting(node, report);

    return {
      dryRun: true,
      frame: { id: node.id, name: node.name },
      layerCount: before,
      genericNames: generic,
      removableLayers: empties,
      warnings: report.warnings,
    };
  }

  cleanLayers(node, opts, report);
  const after = countDescendants(node, function () { return true; }, 5000);

  return {
    dryRun: false,
    frame: { id: node.id, name: node.name },
    layerCountBefore: before,
    layerCountAfter: after,
    renamed: report.renamed,
    removed: report.removed,
    collapsed: report.collapsed,
    warnings: report.warnings,
  };
}

async function analyzeResponsive(params) {
  const node = await resolveResponsiveTarget(params);
  const preservation = (params && params.preservation) || "strict";

  const children = isContainer(node)
    ? node.children.filter((c) => c.visible !== false && !isInstrumentation(c))
    : [];
  const sections = children.map((c, i) => analyzeSection(c, i, children.length));

  // Which preset does the source most resemble?
  let sourcePreset = "desktop";
  let bestDelta = Infinity;
  for (const key of Object.keys(RESPONSIVE_PRESETS)) {
    const delta = Math.abs(RESPONSIVE_PRESETS[key].width - node.width);
    if (delta < bestDelta) { bestDelta = delta; sourcePreset = key; }
  }

  const plans = {};
  const planWidths = {};
  const requestedAnalysisKey = params && params.targetWidth !== undefined
    ? params.breakpoint || (Array.isArray(params.breakpoints) && params.breakpoints[0]) ||
      (Number(params.targetWidth) <= 480 ? "mobile" : "tablet")
    : null;
  const analysisKeys = requestedAnalysisKey ? [requestedAnalysisKey] : ["tablet", "mobile"];
  for (const key of analysisKeys) {
    const preset = resolveResponsivePreset(key, params && params.targetWidth);
    if (!preset) continue;
    plans[key] = buildPlan(sections, key, preservation, preset);
    planWidths[key] = preset.width;
  }

  const selfCheck = validateResponsive(node, node.width, `source ${Math.round(node.width)}px`);

  return {
    source: {
      id: node.id,
      name: node.name,
      type: node.type,
      width: Math.round(node.width || 0),
      height: Math.round(node.height || 0),
      autoLayout: isAutoLayout(node) ? node.layoutMode : "NONE",
      padding: isAutoLayout(node)
        ? { top: node.paddingTop, right: node.paddingRight, bottom: node.paddingBottom, left: node.paddingLeft }
        : null,
      itemSpacing: isAutoLayout(node) ? node.itemSpacing : null,
      closestPreset: sourcePreset,
    },
    sectionCount: sections.length,
    sections,
    plans,
    planWidths,
    existingResponsiveFrames: findExistingResponsiveFrames(node),
    sourceIssues: selfCheck,
    layerHygiene: (function () {
      const generic = [];
      const empties = [];
      let deepest = 0;
      const walk = (n, depth) => {
        if (!n || depth > 18 || n.removed) return;
        if (isInstrumentation(n) || isInsideInstance(n)) return;
        if (depth > deepest) deepest = depth;
        if (n !== node && isGenericName(n.name) && generic.length < 40) generic.push(n.name);
        if (n !== node && isRemovableLayer(n) && empties.length < 40) {
          empties.push(`${n.name} (${n.type.toLowerCase()})`);
        }
        if (isContainer(n) && n.type !== "INSTANCE") for (const c of n.children) walk(c, depth + 1);
      };
      walk(node, 0);
      return { genericNames: generic, removableLayers: empties, maxDepth: deepest };
    })(),
    readiness: {
      usesAutoLayout: isAutoLayout(node),
      sectionsWithoutAutoLayout: sections.filter((s) => !s.usesAutoLayout).map((s) => s.name),
      sectionsWithAbsoluteChildren: sections.filter((s) => s.absoluteChildren.length).map((s) => s.name),
      totalInstances: sections.reduce((n, s) => n + s.instanceCount, 0),
    },
  };
}

async function makeResponsive(params) {
  const opts = params || {};
  const node = await resolveResponsiveTarget(opts);
  const preservation = opts.preservation || "strict";
  const hasRequestedBreakpoints = Array.isArray(opts.breakpoints) && opts.breakpoints.length;
  const requested = hasRequestedBreakpoints
    ? Array.from(new Set(opts.breakpoints))
    : [opts.targetWidth !== undefined && Number(opts.targetWidth) <= 480 ? "mobile" : "tablet"];

  // Breakpoints are completed and reviewed independently. Processing both in
  // one command makes it impossible to stop after Tablet QA and get the
  // designer's approval before Mobile begins.
  if (requested.length !== 1) {
    throw new Error(
      "make_responsive accepts exactly one breakpoint per run. Complete and validate Tablet " +
        "first, then run Mobile only after the designer confirms it."
    );
  }

  if (opts.mode === "preview") {
    const analysis = await analyzeResponsive(opts);
    return { mode: "preview", previewOnly: true, analysis, frames: [] };
  }

  // Index the file's text styles once; every breakpoint resolves against it.
  const textStyleIndex = await buildTextStyleIndex();

  const frames = [];
  for (const key of requested) {
    if (!RESPONSIVE_PRESETS[key]) {
      frames.push({ breakpoint: key, error: `Unknown breakpoint "${key}"` });
      continue;
    }
    if (key === "desktop") continue; // the source already is the desktop frame
    const preset = resolveResponsivePreset(key, opts.targetWidth);

    // Resolve target parent: user can pass targetParentId per breakpoint
    // or a single targetParentId for all breakpoints
    let targetParentId = null;
    if (opts.targetParentIds && opts.targetParentIds[key]) {
      targetParentId = opts.targetParentIds[key];
    } else if (opts.targetParentId) {
      targetParentId = opts.targetParentId;
    }

    const report = await generateBreakpoint(node, key, {
      preset,
      preservation,
      gutter: opts.gutter,
      textStyleIndex,
      cleanLayers: opts.cleanLayers !== false,
      cleanupOptions: opts.cleanupOptions,
      targetParentId,
    });
    frames.push(report);
  }

  // QA covers all three required frames. The desktop source is validated at
  // 1440 as well — the spec's final checklist requires it, and a desktop frame
  // that already overflows will hand its problems to every derived breakpoint.
  const validations = [];
  validations.push(
    validateResponsive(node, RESPONSIVE_PRESETS.desktop.width, `Desktop @ ${RESPONSIVE_PRESETS.desktop.width}px (source)`)
  );

  for (const frame of frames) {
    if (!frame.frameId) continue;
    const generated = await getNodeByIdSafe(frame.frameId);
    if (!generated) continue;

    if (frame.breakpoint === RESPONSIVE_PRESETS.mobile.label) {
      // Validate the exact requested width as well as the mobile safety widths.
      const mobileQaWidths = Array.from(new Set([frame.width, ...QA_WIDTHS]));
      for (const qaWidth of mobileQaWidths) {
        validations.push(validateResponsive(generated, qaWidth, `${frame.breakpoint} @ ${qaWidth}px`));
      }
    } else {
      validations.push(validateResponsive(generated, frame.width, `${frame.breakpoint} @ ${frame.width}px`));
    }
  }

  return {
    source: { id: node.id, name: node.name, width: Math.round(node.width) },
    preservation,
    textStylesAvailable: textStyleIndex.total,
    frames,
    validations,
    qaWidths: Array.from(
      new Set([
        ...QA_WIDTHS,
        ...frames
          .filter((frame) => frame.breakpoint === RESPONSIVE_PRESETS.mobile.label)
          .map((frame) => frame.width),
      ])
    ),
  };
}

async function validateResponsiveCommand(params) {
  const node = await resolveResponsiveTarget(params);
  const widths = Array.isArray(params && params.widths) && params.widths.length
    ? params.widths
    : [Math.round(node.width)];

  return {
    frame: { id: node.id, name: node.name, width: Math.round(node.width) },
    results: widths.map((w) => validateResponsive(node, w, `${w}px`)),
  };
}

async function getLocalComponents() {
  await figma.loadAllPagesAsync();

  const components = figma.root.findAllWithCriteria({
    types: ["COMPONENT"],
  });

  return {
    count: components.length,
    components: components.map((component) => ({
      id: component.id,
      name: component.name,
      key: "key" in component ? component.key : null,
    })),
  };
}

// async function getTeamComponents() {
//   try {
//     const teamComponents =
//       await figma.teamLibrary.getAvailableComponentsAsync();

//     return {
//       count: teamComponents.length,
//       components: teamComponents.map((component) => ({
//         key: component.key,
//         name: component.name,
//         description: component.description,
//         libraryName: component.libraryName,
//       })),
//     };
//   } catch (error) {
//     throw new Error(`Error getting team components: ${error.message}`);
//   }
// }

async function createComponentInstance(params) {
  const { componentKey, x = 0, y = 0, parentId } = params || {};

  if (!componentKey) {
    throw new Error("Missing componentKey parameter");
  }

  try {
    console.log(`Looking for component with key: ${componentKey}...`);

    let component = null;

    // Try to find the component locally first (faster than import)
    try {
      // First check current page (fastest)
      const currentPageComponents = figma.currentPage.findAllWithCriteria({
        types: ["COMPONENT"]
      });
      component = currentPageComponents.find(c => c.key === componentKey);

      if (!component) {
        // Load all pages and search entire document
        console.log(`Not on current page, searching all pages...`);
        await figma.loadAllPagesAsync();
        const allComponents = figma.root.findAllWithCriteria({
          types: ["COMPONENT"]
        });
        component = allComponents.find(c => c.key === componentKey);
      }

      if (component) {
        console.log(`Found component locally: ${component.name}`);
      }
    } catch (findError) {
      console.log(`Error searching locally: ${findError.message}`);
    }

    // If not found locally, try importing (for remote/team library components)
    if (!component) {
      console.log(`Component not found locally, trying import...`);

      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Timeout while importing component (10s). The component may be in a team library you don't have access to."));
        }, 10000);
      });

      const importPromise = figma.importComponentByKeyAsync(componentKey);

      component = await Promise.race([importPromise, timeoutPromise])
        .finally(() => {
          clearTimeout(timeoutId);
        });
    }

    console.log(`Component ready, creating instance...`);

    // Create instance and set properties in a separate try block to handle errors specifically from this step
    try {
      const instance = component.createInstance();
      instance.x = x;
      instance.y = y;

      // Add to parent (explicit parentId or currentPage fallback)
      if (parentId) {
        const parentNode = await getNodeByIdSafe(parentId);
        if (!parentNode) {
          throw new Error(`Parent node not found with ID: ${parentId}`);
        }
        if (!("appendChild" in parentNode)) {
          throw new Error(`Parent node does not support children: ${parentId}`);
        }
        parentNode.appendChild(instance);
      } else {
        figma.currentPage.appendChild(instance);
      }

      console.log(`Component instance created and added to ${parentId ? 'parent ' + parentId : 'page'} successfully`);

      return {
        id: instance.id,
        name: instance.name,
        x: instance.x,
        y: instance.y,
        width: instance.width,
        height: instance.height,
        componentId: instance.componentId,
      };
    } catch (instanceError) {
      console.error(`Error creating component instance: ${instanceError.message}`);
      throw new Error(`Error creating component instance: ${instanceError.message}`);
    }
  } catch (error) {
    console.error(`Detailed error creating component instance: ${error.message || "Unknown error"}`);
    console.error(`Stack trace: ${error.stack || "Not available"}`);

    // Provide more helpful error messages for common failure scenarios
    if (error.message.includes("timeout") || error.message.includes("Timeout")) {
      throw new Error(`The component import timed out after 10 seconds. This usually happens with complex remote components or network issues. Try again later or use a simpler component.`);
    } else if (error.message.includes("not found") || error.message.includes("Not found")) {
      throw new Error(`Component with key "${componentKey}" not found. Make sure the component exists and is accessible in your document or team libraries.`);
    } else if (error.message.includes("permission") || error.message.includes("Permission")) {
      throw new Error(`You don't have permission to use this component. Make sure you have access to the team library containing this component.`);
    } else {
      throw new Error(`Error creating component instance: ${error.message}`);
    }
  }
}

async function exportNodeAsImage(params) {
  const { nodeId, scale = 1, format = "PNG" } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  console.log(`[exportNodeAsImage] Starting export for node ${nodeId}, scale: ${scale}, format: ${format}`);
  const startTime = Date.now();

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  console.log(`[exportNodeAsImage] Node found: ${node.name}, type: ${node.type}, size: ${node.width}x${node.height}`);

  if (!("exportAsync" in node)) {
    throw new Error(`Node does not support exporting: ${nodeId}`);
  }

  try {
    const settings = {
      format: format,
      constraint: { type: "SCALE", value: scale },
    };

    // Set up a timeout for large exports
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Export timed out after 60s for node ${nodeId} (${node.name}, ${node.width}x${node.height})`));
      }, 60000); // 60 seconds timeout
    });

    const exportPromise = node.exportAsync(settings);

    const bytes = await Promise.race([exportPromise, timeoutPromise])
      .finally(() => {
        clearTimeout(timeoutId);
      });

    console.log(`[exportNodeAsImage] Export completed in ${Date.now() - startTime}ms, bytes: ${bytes.length}`);

    let mimeType;
    switch (format) {
      case "PNG":
        mimeType = "image/png";
        break;
      case "JPG":
        mimeType = "image/jpeg";
        break;
      case "SVG":
        mimeType = "image/svg+xml";
        break;
      case "PDF":
        mimeType = "application/pdf";
        break;
      default:
        mimeType = "application/octet-stream";
    }

    // Proper way to convert Uint8Array to base64
    const base64 = customBase64Encode(bytes);
    // const imageData = `data:${mimeType};base64,${base64}`;

    return {
      nodeId,
      format,
      scale,
      mimeType,
      imageData: base64,
    };
  } catch (error) {
    throw new Error(`Error exporting node as image: ${error.message}`);
  }
}
function customBase64Encode(bytes) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";

  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  // Main loop deals with bytes in chunks of 3
  for (let i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048 = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032 = (2^6 - 1) << 6
    d = chunk & 63; // 63 = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += chars[a] + chars[b] + chars[c] + chars[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder === 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3 = 2^2 - 1

    base64 += chars[a] + chars[b] + "==";
  } else if (byteRemainder === 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008 = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15 = 2^4 - 1

    base64 += chars[a] + chars[b] + chars[c] + "=";
  }

  return base64;
}

// Decode base64 string to Uint8Array (mirror of customBase64Encode)
function customBase64Decode(base64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  // Remove padding and calculate output length
  let padding = 0;
  if (base64.length > 0 && base64[base64.length - 1] === "=") padding++;
  if (base64.length > 1 && base64[base64.length - 2] === "=") padding++;
  const byteLength = (base64.length * 3) / 4 - padding;
  const bytes = new Uint8Array(byteLength);

  let p = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const a = lookup[base64.charCodeAt(i)];
    const b = lookup[base64.charCodeAt(i + 1)];
    const c = lookup[base64.charCodeAt(i + 2)];
    const d = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (a << 2) | (b >> 4);
    if (p < byteLength) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < byteLength) bytes[p++] = ((c & 3) << 6) | d;
  }

  return bytes;
}

async function setCornerRadius(params) {
  const { nodeId, radius, corners } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (radius === undefined) {
    throw new Error("Missing radius parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if node supports corner radius
  if (!("cornerRadius" in node)) {
    throw new Error(`Node does not support corner radius: ${nodeId}`);
  }

  // If corners array is provided, set individual corner radii
  if (corners && Array.isArray(corners) && corners.length === 4) {
    if ("topLeftRadius" in node) {
      // Node supports individual corner radii
      if (corners[0]) node.topLeftRadius = radius;
      if (corners[1]) node.topRightRadius = radius;
      if (corners[2]) node.bottomRightRadius = radius;
      if (corners[3]) node.bottomLeftRadius = radius;
    } else {
      // Node only supports uniform corner radius
      node.cornerRadius = radius;
    }
  } else {
    // Set uniform corner radius
    node.cornerRadius = radius;
  }

  return {
    id: node.id,
    name: node.name,
    cornerRadius: "cornerRadius" in node ? node.cornerRadius : undefined,
    topLeftRadius: "topLeftRadius" in node ? node.topLeftRadius : undefined,
    topRightRadius: "topRightRadius" in node ? node.topRightRadius : undefined,
    bottomRightRadius:
      "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
    bottomLeftRadius:
      "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined,
  };
}

async function setTextContent(params) {
  const { nodeId, text } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (text === undefined) {
    throw new Error("Missing text parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);

    await setCharacters(node, text);

    return {
      id: node.id,
      name: node.name,
      characters: node.characters,
      fontName: node.fontName,
    };
  } catch (error) {
    throw new Error(`Error setting text content: ${error.message}`);
  }
}

// Initialize settings on load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync("settings");
    if (savedSettings) {
      if (savedSettings.serverPort) {
        state.serverPort = savedSettings.serverPort;
      }
    }

    // Send initial settings to UI
    figma.ui.postMessage({
      type: "init-settings",
      settings: {
        serverPort: state.serverPort,
      },
    });
  } catch (error) {
    console.error("Error loading settings:", error);
  }
})();

function uniqBy(arr, predicate) {
  const cb = typeof predicate === "function" ? predicate : (o) => o[predicate];
  return [
    ...arr
      .reduce((map, item) => {
        const key = item === null || item === undefined ? item : cb(item);

        map.has(key) || map.set(key, item);

        return map;
      }, new Map())
      .values(),
  ];
}
const setCharacters = async (node, characters, options) => {
  const fallbackFont = (options && options.fallbackFont) || {
    family: "Inter",
    style: "Regular",
  };
  try {
    if (node.fontName === figma.mixed) {
      if (options && options.smartStrategy === "prevail") {
        const fontHashTree = {};
        for (let i = 1; i < node.characters.length; i++) {
          const charFont = node.getRangeFontName(i - 1, i);
          const key = `${charFont.family}::${charFont.style}`;
          fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
        }
        const prevailedTreeItem = Object.entries(fontHashTree).sort(
          (a, b) => b[1] - a[1]
        )[0];
        const [family, style] = prevailedTreeItem[0].split("::");
        const prevailedFont = {
          family,
          style,
        };
        await figma.loadFontAsync(prevailedFont);
        node.fontName = prevailedFont;
      } else if (options && options.smartStrategy === "strict") {
        return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
      } else if (options && options.smartStrategy === "experimental") {
        return setCharactersWithSmartMatchFont(node, characters, fallbackFont);
      } else {
        const firstCharFont = node.getRangeFontName(0, 1);
        await figma.loadFontAsync(firstCharFont);
        node.fontName = firstCharFont;
      }
    } else {
      await figma.loadFontAsync({
        family: node.fontName.family,
        style: node.fontName.style,
      });
    }
  } catch (err) {
    console.warn(
      `Failed to load "${node.fontName["family"]} ${node.fontName["style"]}" font and replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
      err
    );
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
  }
  try {
    node.characters = characters;
    return true;
  } catch (err) {
    console.warn(`Failed to set characters. Skipped.`, err);
    return false;
  }
};

const setCharactersWithStrictMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const fontHashTree = {};
  for (let i = 1; i < node.characters.length; i++) {
    const startIdx = i - 1;
    const startCharFont = node.getRangeFontName(startIdx, i);
    const startCharFontVal = `${startCharFont.family}::${startCharFont.style}`;
    while (i < node.characters.length) {
      i++;
      const charFont = node.getRangeFontName(i - 1, i);
      if (startCharFontVal !== `${charFont.family}::${charFont.style}`) {
        break;
      }
    }
    fontHashTree[`${startIdx}_${i}`] = startCharFontVal;
  }
  await figma.loadFontAsync(fallbackFont);
  node.fontName = fallbackFont;
  node.characters = characters;
  console.log(fontHashTree);
  await Promise.all(
    Object.keys(fontHashTree).map(async (range) => {
      console.log(range, fontHashTree[range]);
      const [start, end] = range.split("_");
      const [family, style] = fontHashTree[range].split("::");
      const matchedFont = {
        family,
        style,
      };
      await figma.loadFontAsync(matchedFont);
      return node.setRangeFontName(Number(start), Number(end), matchedFont);
    })
  );
  return true;
};

const getDelimiterPos = (str, delimiter, startIdx = 0, endIdx = str.length) => {
  const indices = [];
  let temp = startIdx;
  for (let i = 0; i < endIdx; i++) {
    if (
      str[i] === delimiter &&
      i + startIdx !== endIdx &&
      temp !== i + startIdx
    ) {
      indices.push([temp, i + startIdx]);
      temp = i + startIdx + 1;
    }
  }
  temp !== endIdx && indices.push([temp, endIdx]);
  return indices.filter(Boolean);
};

const buildLinearOrder = (node) => {
  const fontTree = [];
  const newLinesPos = getDelimiterPos(node.characters, "\n");
  newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd], n) => {
    const newLinesRangeFont = node.getRangeFontName(
      newLinesRangeStart,
      newLinesRangeEnd
    );
    if (newLinesRangeFont === figma.mixed) {
      const spacesPos = getDelimiterPos(
        node.characters,
        " ",
        newLinesRangeStart,
        newLinesRangeEnd
      );
      spacesPos.forEach(([spacesRangeStart, spacesRangeEnd], s) => {
        const spacesRangeFont = node.getRangeFontName(
          spacesRangeStart,
          spacesRangeEnd
        );
        if (spacesRangeFont === figma.mixed) {
          const spacesRangeFont = node.getRangeFontName(
            spacesRangeStart,
            spacesRangeStart[0]
          );
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        } else {
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        }
      });
    } else {
      fontTree.push({
        start: newLinesRangeStart,
        delimiter: "\n",
        family: newLinesRangeFont.family,
        style: newLinesRangeFont.style,
      });
    }
  });
  return fontTree
    .sort((a, b) => +a.start - +b.start)
    .map(({ family, style, delimiter }) => ({ family, style, delimiter }));
};

const setCharactersWithSmartMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const rangeTree = buildLinearOrder(node);
  const fontsToLoad = uniqBy(
    rangeTree,
    ({ family, style }) => `${family}::${style}`
  ).map(({ family, style }) => ({
    family,
    style,
  }));

  await Promise.all([...fontsToLoad, fallbackFont].map(figma.loadFontAsync));

  node.fontName = fallbackFont;
  node.characters = characters;

  let prevPos = 0;
  rangeTree.forEach(({ family, style, delimiter }) => {
    if (prevPos < node.characters.length) {
      const delimeterPos = node.characters.indexOf(delimiter, prevPos);
      const endPos =
        delimeterPos > prevPos ? delimeterPos : node.characters.length;
      const matchedFont = {
        family,
        style,
      };
      node.setRangeFontName(prevPos, endPos, matchedFont);
      prevPos = endPos + 1;
    }
  });
  return true;
};

// Add the cloneNode function implementation
async function cloneNode(params) {
  const { nodeId, x, y, parentId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Clone the node
  const clone = node.clone();

  // If x and y are provided, move the clone to that position
  if (x !== undefined && y !== undefined) {
    if (!("x" in clone) || !("y" in clone)) {
      throw new Error(`Cloned node does not support position: ${nodeId}`);
    }
    clone.x = x;
    clone.y = y;
  }

  // Add the clone to the target parent, or fall back to the original node's parent
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(clone);
  } else if (node.parent) {
    node.parent.appendChild(clone);
  } else {
    figma.currentPage.appendChild(clone);
  }

  return {
    id: clone.id,
    name: clone.name,
    x: "x" in clone ? clone.x : undefined,
    y: "y" in clone ? clone.y : undefined,
    width: "width" in clone ? clone.width : undefined,
    height: "height" in clone ? clone.height : undefined,
  };
}

async function scanTextNodes(params) {
  console.log(`Starting to scan text nodes from node ID: ${params.nodeId}`);
  const { nodeId, useChunking = true, chunkSize = 10, commandId = generateCommandId() } = params || {};

  const node = await getNodeByIdSafe(nodeId);

  if (!node) {
    console.error(`Node with ID ${nodeId} not found`);
    // Send error progress update
    sendProgressUpdate(
      commandId,
      'scan_text_nodes',
      'error',
      0,
      0,
      0,
      `Node with ID ${nodeId} not found`,
      { error: `Node not found: ${nodeId}` }
    );
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // If chunking is not enabled, use the original implementation
  if (!useChunking) {
    const textNodes = [];
    try {
      // Send started progress update
      sendProgressUpdate(
        commandId,
        'scan_text_nodes',
        'started',
        0,
        1, // Not known yet how many nodes there are
        0,
        `Starting scan of node "${node.name || nodeId}" without chunking`,
        null
      );

      await findTextNodes(node, [], 0, textNodes);

      // Send completed progress update
      sendProgressUpdate(
        commandId,
        'scan_text_nodes',
        'completed',
        100,
        textNodes.length,
        textNodes.length,
        `Scan complete. Found ${textNodes.length} text nodes.`,
        { textNodes }
      );

      return {
        success: true,
        message: `Scanned ${textNodes.length} text nodes.`,
        count: textNodes.length,
        textNodes: textNodes,
        commandId
      };
    } catch (error) {
      console.error("Error scanning text nodes:", error);

      // Send error progress update
      sendProgressUpdate(
        commandId,
        'scan_text_nodes',
        'error',
        0,
        0,
        0,
        `Error scanning text nodes: ${error.message}`,
        { error: error.message }
      );

      throw new Error(`Error scanning text nodes: ${error.message}`);
    }
  }

  // Chunked implementation
  console.log(`Using chunked scanning with chunk size: ${chunkSize}`);

  // First, collect all nodes to process (without processing them yet)
  const nodesToProcess = [];

  // Send started progress update
  sendProgressUpdate(
    commandId,
    'scan_text_nodes',
    'started',
    0,
    0, // Not known yet how many nodes there are
    0,
    `Starting chunked scan of node "${node.name || nodeId}"`,
    { chunkSize }
  );

  await collectNodesToProcess(node, [], 0, nodesToProcess);

  const totalNodes = nodesToProcess.length;
  console.log(`Found ${totalNodes} total nodes to process`);

  // Calculate number of chunks needed
  const totalChunks = Math.ceil(totalNodes / chunkSize);
  console.log(`Will process in ${totalChunks} chunks`);

  // Send update after node collection
  sendProgressUpdate(
    commandId,
    'scan_text_nodes',
    'in_progress',
    5, // 5% progress for collection phase
    totalNodes,
    0,
    `Found ${totalNodes} nodes to scan. Will process in ${totalChunks} chunks.`,
    {
      totalNodes,
      totalChunks,
      chunkSize
    }
  );

  // Process nodes in chunks
  const allTextNodes = [];
  let processedNodes = 0;
  let chunksProcessed = 0;

  for (let i = 0; i < totalNodes; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, totalNodes);
    console.log(`Processing chunk ${chunksProcessed + 1}/${totalChunks} (nodes ${i} to ${chunkEnd - 1})`);

    // Send update before processing chunk
    sendProgressUpdate(
      commandId,
      'scan_text_nodes',
      'in_progress',
      Math.round(5 + ((chunksProcessed / totalChunks) * 90)), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processing chunk ${chunksProcessed + 1}/${totalChunks}`,
      {
        currentChunk: chunksProcessed + 1,
        totalChunks,
        textNodesFound: allTextNodes.length
      }
    );

    const chunkNodes = nodesToProcess.slice(i, chunkEnd);
    const chunkTextNodes = [];

    // Process each node in this chunk
    for (const nodeInfo of chunkNodes) {
      if (nodeInfo.node.type === "TEXT") {
        try {
          const textNodeInfo = await processTextNode(nodeInfo.node, nodeInfo.parentPath, nodeInfo.depth);
          if (textNodeInfo) {
            chunkTextNodes.push(textNodeInfo);
          }
        } catch (error) {
          console.error(`Error processing text node: ${error.message}`);
          // Continue with other nodes
        }
      }

      // Brief delay to allow UI updates and prevent freezing
      await delay(5);
    }

    // Add results from this chunk
    allTextNodes.push(...chunkTextNodes);
    processedNodes += chunkNodes.length;
    chunksProcessed++;

    // Send update after processing chunk
    sendProgressUpdate(
      commandId,
      'scan_text_nodes',
      'in_progress',
      Math.round(5 + ((chunksProcessed / totalChunks) * 90)), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processed chunk ${chunksProcessed}/${totalChunks}. Found ${allTextNodes.length} text nodes so far.`,
      {
        currentChunk: chunksProcessed,
        totalChunks,
        processedNodes,
        textNodesFound: allTextNodes.length,
        chunkResult: chunkTextNodes
      }
    );

    // Small delay between chunks to prevent UI freezing
    if (i + chunkSize < totalNodes) {
      await delay(50);
    }
  }

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    'scan_text_nodes',
    'completed',
    100,
    totalNodes,
    processedNodes,
    `Scan complete. Found ${allTextNodes.length} text nodes.`,
    {
      textNodes: allTextNodes,
      processedNodes,
      chunks: chunksProcessed
    }
  );

  return {
    success: true,
    message: `Chunked scan complete. Found ${allTextNodes.length} text nodes.`,
    totalNodes: allTextNodes.length,
    processedNodes: processedNodes,
    chunks: chunksProcessed,
    textNodes: allTextNodes,
    commandId
  };
}

// Helper function to collect all nodes that need to be processed
async function collectNodesToProcess(node, parentPath = [], depth = 0, nodesToProcess = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  // Add this node to the processing list
  nodesToProcess.push({
    node: node,
    parentPath: nodePath,
    depth: depth
  });

  // Recursively add children
  if ("children" in node) {
    for (const child of node.children) {
      await collectNodesToProcess(child, nodePath, depth + 1, nodesToProcess);
    }
  }
}

// Process a single text node
async function processTextNode(node, parentPath, depth) {
  if (node.type !== "TEXT") return null;

  try {
    // Safely extract font information
    let fontFamily = "";
    let fontStyle = "";

    if (node.fontName) {
      if (typeof node.fontName === "object") {
        if ("family" in node.fontName) fontFamily = node.fontName.family;
        if ("style" in node.fontName) fontStyle = node.fontName.style;
      }
    }

    // Create a safe representation of the text node
    const safeTextNode = {
      id: node.id,
      name: node.name || "Text",
      type: node.type,
      characters: node.characters,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
      fontFamily: fontFamily,
      fontStyle: fontStyle,
      x: typeof node.x === "number" ? node.x : 0,
      y: typeof node.y === "number" ? node.y : 0,
      width: typeof node.width === "number" ? node.width : 0,
      height: typeof node.height === "number" ? node.height : 0,
      path: parentPath.join(" > "),
      depth: depth,
    };

    // Highlight the node briefly (optional visual feedback)
    try {
      const originalFills = JSON.parse(JSON.stringify(node.fills));
      node.fills = [
        {
          type: "SOLID",
          color: { r: 1, g: 0.5, b: 0 },
          opacity: 0.3,
        },
      ];

      // Brief delay for the highlight to be visible
      await delay(100);

      try {
        node.fills = originalFills;
      } catch (err) {
        console.error("Error resetting fills:", err);
      }
    } catch (highlightErr) {
      console.error("Error highlighting text node:", highlightErr);
      // Continue anyway, highlighting is just visual feedback
    }

    return safeTextNode;
  } catch (nodeErr) {
    console.error("Error processing text node:", nodeErr);
    return null;
  }
}

// A delay function that returns a promise
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Keep the original findTextNodes for backward compatibility
async function findTextNodes(node, parentPath = [], depth = 0, textNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node including its name
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  if (node.type === "TEXT") {
    try {
      // Safely extract font information to avoid Symbol serialization issues
      let fontFamily = "";
      let fontStyle = "";

      if (node.fontName) {
        if (typeof node.fontName === "object") {
          if ("family" in node.fontName) fontFamily = node.fontName.family;
          if ("style" in node.fontName) fontStyle = node.fontName.style;
        }
      }

      // Create a safe representation of the text node with only serializable properties
      const safeTextNode = {
        id: node.id,
        name: node.name || "Text",
        type: node.type,
        characters: node.characters,
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontFamily: fontFamily,
        fontStyle: fontStyle,
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
        path: nodePath.join(" > "),
        depth: depth,
      };

      // Only highlight the node if it's not being done via API
      try {
        // Safe way to create a temporary highlight without causing serialization issues
        const originalFills = JSON.parse(JSON.stringify(node.fills));
        node.fills = [
          {
            type: "SOLID",
            color: { r: 1, g: 0.5, b: 0 },
            opacity: 0.3,
          },
        ];

        // Promise-based delay instead of setTimeout
        await delay(500);

        try {
          node.fills = originalFills;
        } catch (err) {
          console.error("Error resetting fills:", err);
        }
      } catch (highlightErr) {
        console.error("Error highlighting text node:", highlightErr);
        // Continue anyway, highlighting is just visual feedback
      }

      textNodes.push(safeTextNode);
    } catch (nodeErr) {
      console.error("Error processing text node:", nodeErr);
      // Skip this node but continue with others
    }
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findTextNodes(child, nodePath, depth + 1, textNodes);
    }
  }
}

// Replace text in a specific node
async function setMultipleTextContents(params) {
  const { nodeId, text } = params || {};
  const commandId = params.commandId || generateCommandId();

  if (!nodeId || !text || !Array.isArray(text)) {
    const errorMsg = "Missing required parameters: nodeId and text array";

    // Send error progress update
    sendProgressUpdate(
      commandId,
      'set_multiple_text_contents',
      'error',
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg }
    );

    throw new Error(errorMsg);
  }

  console.log(
    `Starting text replacement for node: ${nodeId} with ${text.length} text replacements`
  );

  // Send started progress update
  sendProgressUpdate(
    commandId,
    'set_multiple_text_contents',
    'started',
    0,
    text.length,
    0,
    `Starting text replacement for ${text.length} nodes`,
    { totalReplacements: text.length }
  );

  // Define the results array and counters
  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Split text replacements into chunks of 5
  const CHUNK_SIZE = 5;
  const chunks = [];

  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Split ${text.length} replacements into ${chunks.length} chunks`);

  // Send chunking info update
  sendProgressUpdate(
    commandId,
    'set_multiple_text_contents',
    'in_progress',
    5, // 5% progress for planning phase
    text.length,
    0,
    `Preparing to replace text in ${text.length} nodes using ${chunks.length} chunks`,
    {
      totalReplacements: text.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE
    }
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(`Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} replacements`);

    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      'set_multiple_text_contents',
      'in_progress',
      Math.round(5 + ((chunkIndex / chunks.length) * 90)), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount
      }
    );

    // Process replacements within a chunk in parallel
    const chunkPromises = chunk.map(async (replacement) => {
      if (!replacement.nodeId || replacement.text === undefined) {
        console.error(`Missing nodeId or text for replacement`);
        return {
          success: false,
          nodeId: replacement.nodeId || "unknown",
          error: "Missing nodeId or text in replacement entry"
        };
      }

      try {
        console.log(`Attempting to replace text in node: ${replacement.nodeId}`);

        // Get the text node to update (just to check it exists and get original text)
        const textNode = await getNodeByIdSafe(replacement.nodeId);

        if (!textNode) {
          console.error(`Text node not found: ${replacement.nodeId}`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node not found: ${replacement.nodeId}`
          };
        }

        if (textNode.type !== "TEXT") {
          console.error(`Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`
          };
        }

        // Save original text for the result
        const originalText = textNode.characters;
        console.log(`Original text: "${originalText}"`);
        console.log(`Will translate to: "${replacement.text}"`);

        // Highlight the node before changing text
        let originalFills;
        try {
          // Save original fills for restoration later
          originalFills = JSON.parse(JSON.stringify(textNode.fills));
          // Apply highlight color (orange with 30% opacity)
          textNode.fills = [
            {
              type: "SOLID",
              color: { r: 1, g: 0.5, b: 0 },
              opacity: 0.3,
            },
          ];
        } catch (highlightErr) {
          console.error(`Error highlighting text node: ${highlightErr.message}`);
          // Continue anyway, highlighting is just visual feedback
        }

        // Use the existing setTextContent function to handle font loading and text setting
        await setTextContent({
          nodeId: replacement.nodeId,
          text: replacement.text
        });

        // Keep highlight for a moment after text change, then restore original fills
        if (originalFills) {
          try {
            // Use delay function for consistent timing
            await delay(500);
            textNode.fills = originalFills;
          } catch (restoreErr) {
            console.error(`Error restoring fills: ${restoreErr.message}`);
          }
        }

        console.log(`Successfully replaced text in node: ${replacement.nodeId}`);
        return {
          success: true,
          nodeId: replacement.nodeId,
          originalText: originalText,
          translatedText: replacement.text
        };
      } catch (error) {
        console.error(`Error replacing text in node ${replacement.nodeId}: ${error.message}`);
        return {
          success: false,
          nodeId: replacement.nodeId,
          error: `Error applying replacement: ${error.message}`
        };
      }
    });

    // Wait for all replacements in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Process results for this chunk
    chunkResults.forEach(result => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    // Send chunk processing complete update with partial results
    sendProgressUpdate(
      commandId,
      'set_multiple_text_contents',
      'in_progress',
      Math.round(5 + (((chunkIndex + 1) / chunks.length) * 90)), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${chunks.length}. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults
      }
    );

    // Add a small delay between chunks to avoid overloading Figma
    if (chunkIndex < chunks.length - 1) {
      console.log('Pausing between chunks to avoid overloading Figma...');
      await delay(1000); // 1 second delay between chunks
    }
  }

  console.log(
    `Replacement complete: ${successCount} successful, ${failureCount} failed`
  );

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    'set_multiple_text_contents',
    'completed',
    100,
    text.length,
    successCount + failureCount,
    `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalReplacements: text.length,
      replacementsApplied: successCount,
      replacementsFailed: failureCount,
      completedInChunks: chunks.length,
      results: results
    }
  );

  return {
    success: successCount > 0,
    nodeId: nodeId,
    replacementsApplied: successCount,
    replacementsFailed: failureCount,
    totalReplacements: text.length,
    results: results,
    completedInChunks: chunks.length,
    commandId
  };
}

// Function to generate simple UUIDs for command IDs
function generateCommandId() {
  return 'cmd_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function setAutoLayout(params) {
  const {
    nodeId,
    layoutMode,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    itemSpacing,
    primaryAxisAlignItems,
    counterAxisAlignItems,
    layoutWrap,
    strokesIncludedInLayout,
    layoutSizingHorizontal,
    layoutSizingVertical
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!layoutMode) {
    throw new Error("Missing layoutMode parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if the node is a frame or group
  if (!("layoutMode" in node)) {
    throw new Error(`Node does not support auto layout: ${nodeId}`);
  }

  // Configure layout mode
  if (layoutMode === "NONE") {
    node.layoutMode = "NONE";
  } else {
    // Set auto layout properties
    node.layoutMode = layoutMode;

    // Configure padding if provided
    if (paddingTop !== undefined) node.paddingTop = paddingTop;
    if (paddingBottom !== undefined) node.paddingBottom = paddingBottom;
    if (paddingLeft !== undefined) node.paddingLeft = paddingLeft;
    if (paddingRight !== undefined) node.paddingRight = paddingRight;

    // Configure item spacing
    if (itemSpacing !== undefined) node.itemSpacing = itemSpacing;

    // Configure alignment
    if (primaryAxisAlignItems !== undefined) {
      node.primaryAxisAlignItems = primaryAxisAlignItems;
    }

    if (counterAxisAlignItems !== undefined) {
      node.counterAxisAlignItems = counterAxisAlignItems;
    }

    // Configure wrap
    if (layoutWrap !== undefined) {
      node.layoutWrap = layoutWrap;
    }

    // Configure stroke inclusion
    if (strokesIncludedInLayout !== undefined) {
      node.strokesIncludedInLayout = strokesIncludedInLayout;
    }

    // Sizing, last: Figma resets these when layoutMode changes.
    //
    // Turning auto layout on for a frame that already has a size leaves its
    // height FIXED at whatever it happened to be, so every frame converted here
    // used to inherit a hardcoded height that survived into every breakpoint.
    // Height therefore hugs its content unless the caller asks for something
    // else; width is left alone, because it is usually the viewport or a Fill
    // decision made by the parent.
    if (layoutSizingHorizontal) {
      if (!writeHorizontalSizing(node, layoutSizingHorizontal)) {
        throw new Error(
          `Could not set horizontal sizing to ${layoutSizingHorizontal} on "${node.name}". ` +
            "FILL requires the node's parent to use Auto Layout."
        );
      }
    }
    const targetVertical = layoutSizingVertical || "HUG";
    if (targetVertical !== "FILL" || (node.parent && isAutoLayout(node.parent))) {
      writeVerticalSizing(node, targetVertical);
    } else {
      throw new Error(
        `Could not set vertical sizing to FILL on "${node.name}". ` +
          "FILL requires the node's parent to use Auto Layout."
      );
    }
    // A leftover min/max height would keep the frame pinned even now that it
    // reads as "Hug contents". Only cleared when hug is what was asked for.
    if (targetVertical === "HUG") clearHeightConstraints(node, null);
  }

  return {
    id: node.id,
    name: node.name,
    layoutMode: node.layoutMode,
    layoutSizingHorizontal: readHorizontalSizing(node),
    layoutSizingVertical: readVerticalSizing(node),
    paddingTop: node.paddingTop,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
    paddingRight: node.paddingRight,
    itemSpacing: node.itemSpacing,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    layoutWrap: node.layoutWrap,
    strokesIncludedInLayout: node.strokesIncludedInLayout
  };
}

/**
 * Set Fill container / Hug contents / Fixed on a node, without resizing it.
 *
 * This is the counterpart to resize_node. Without it the only way to influence
 * a node's size was to give it literal pixel dimensions, which is how fixed
 * heights ended up all over generated layouts: there was no way to express
 * "this height follows its content" at all.
 */
async function setLayoutSizing(params) {
  const { nodeId, horizontal, vertical, releaseHeightConstraints } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!horizontal && !vertical) {
    throw new Error("Provide at least one of horizontal or vertical");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const parentIsAutoLayout = !!(node.parent && isAutoLayout(node.parent));
  const applied = [];

  // FILL is a statement about the parent's layout, HUG about the node's own.
  const requireParentAutoLayout = (value, axis) => {
    if (value === "FILL" && !parentIsAutoLayout) {
      throw new Error(
        `Cannot set ${axis} sizing to FILL on "${node.name}": its parent does not use ` +
          "Auto Layout. Add Auto Layout to the parent first (set_auto_layout)."
      );
    }
  };
  const requireOwnAutoLayout = (value, axis) => {
    if (value === "HUG" && !isAutoLayout(node) && node.type !== "TEXT") {
      throw new Error(
        `Cannot set ${axis} sizing to HUG on "${node.name}": a frame can only hug its ` +
          "content along an Auto Layout axis. Add Auto Layout to this node first " +
          "(set_auto_layout)."
      );
    }
  };

  if (horizontal) {
    requireParentAutoLayout(horizontal, "horizontal");
    requireOwnAutoLayout(horizontal, "horizontal");
    if (!writeHorizontalSizing(node, horizontal)) {
      throw new Error(`Could not set horizontal sizing on "${node.name}"`);
    }
    applied.push(`horizontal → ${horizontal}`);
  }

  if (vertical) {
    requireParentAutoLayout(vertical, "vertical");
    requireOwnAutoLayout(vertical, "vertical");
    // Text hugs vertically through textAutoResize, not through layout sizing.
    if (node.type === "TEXT" && vertical === "HUG") {
      node.textAutoResize = readHorizontalSizing(node) === "FIXED" ? "WIDTH_AND_HEIGHT" : "HEIGHT";
      applied.push("vertical → HUG (auto height)");
    } else if (writeVerticalSizing(node, vertical)) {
      applied.push(`vertical → ${vertical}`);
    } else {
      throw new Error(`Could not set vertical sizing on "${node.name}"`);
    }
  }

  // A min/max height silently overrides HUG, so clear it unless asked not to.
  let constraintsCleared = false;
  if (vertical === "HUG" && releaseHeightConstraints !== false) {
    constraintsCleared = clearHeightConstraints(node, null);
  }

  return {
    id: node.id,
    name: node.name,
    applied,
    constraintsCleared,
    layoutSizingHorizontal: readHorizontalSizing(node),
    layoutSizingVertical: node.type === "TEXT" ? node.textAutoResize : readVerticalSizing(node),
    width: node.width,
    height: node.height,
  };
}

// Nuevas funciones para propiedades de texto

async function setFontName(params) {
  const { nodeId, family, style } = params || {};
  if (!nodeId || !family) {
    throw new Error("Missing nodeId or font family");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync({ family, style: style || "Regular" });
    node.fontName = { family, style: style || "Regular" };
    return {
      id: node.id,
      name: node.name,
      fontName: node.fontName
    };
  } catch (error) {
    throw new Error(`Error setting font name: ${error.message}`);
  }
}

async function setFontSize(params) {
  const { nodeId, fontSize } = params || {};
  if (!nodeId || fontSize === undefined) {
    throw new Error("Missing nodeId or fontSize");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);
    node.fontSize = fontSize;
    return {
      id: node.id,
      name: node.name,
      fontSize: node.fontSize
    };
  } catch (error) {
    throw new Error(`Error setting font size: ${error.message}`);
  }
}

async function setFontWeight(params) {
  const { nodeId, weight } = params || {};
  if (!nodeId || weight === undefined) {
    throw new Error("Missing nodeId or weight");
  }

  // Map weight to font style
  const getFontStyle = (weight) => {
    switch (weight) {
      case 100: return "Thin";
      case 200: return "Extra Light";
      case 300: return "Light";
      case 400: return "Regular";
      case 500: return "Medium";
      case 600: return "Semi Bold";
      case 700: return "Bold";
      case 800: return "Extra Bold";
      case 900: return "Black";
      default: return "Regular";
    }
  };

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const family = node.fontName.family;
    const style = getFontStyle(weight);
    await figma.loadFontAsync({ family, style });
    node.fontName = { family, style };
    return {
      id: node.id,
      name: node.name,
      fontName: node.fontName,
      weight: weight
    };
  } catch (error) {
    throw new Error(`Error setting font weight: ${error.message}`);
  }
}

async function setLetterSpacing(params) {
  const { nodeId, letterSpacing, unit = "PIXELS" } = params || {};
  if (!nodeId || letterSpacing === undefined) {
    throw new Error("Missing nodeId or letterSpacing");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);
    node.letterSpacing = { value: letterSpacing, unit };
    return {
      id: node.id,
      name: node.name,
      letterSpacing: node.letterSpacing
    };
  } catch (error) {
    throw new Error(`Error setting letter spacing: ${error.message}`);
  }
}

async function setLineHeight(params) {
  const { nodeId, lineHeight, unit = "PIXELS" } = params || {};
  if (!nodeId || lineHeight === undefined) {
    throw new Error("Missing nodeId or lineHeight");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);
    node.lineHeight = { value: lineHeight, unit };
    return {
      id: node.id,
      name: node.name,
      lineHeight: node.lineHeight
    };
  } catch (error) {
    throw new Error(`Error setting line height: ${error.message}`);
  }
}

async function setParagraphSpacing(params) {
  const { nodeId, paragraphSpacing } = params || {};
  if (!nodeId || paragraphSpacing === undefined) {
    throw new Error("Missing nodeId or paragraphSpacing");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);
    node.paragraphSpacing = paragraphSpacing;
    return {
      id: node.id,
      name: node.name,
      paragraphSpacing: node.paragraphSpacing
    };
  } catch (error) {
    throw new Error(`Error setting paragraph spacing: ${error.message}`);
  }
}

async function setTextCase(params) {
  const { nodeId, textCase } = params || {};
  if (!nodeId || textCase === undefined) {
    throw new Error("Missing nodeId or textCase");
  }

  // Valid textCase values: "ORIGINAL", "UPPER", "LOWER", "TITLE"
  if (!["ORIGINAL", "UPPER", "LOWER", "TITLE"].includes(textCase)) {
    throw new Error("Invalid textCase value. Must be one of: ORIGINAL, UPPER, LOWER, TITLE");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);
    node.textCase = textCase;
    return {
      id: node.id,
      name: node.name,
      textCase: node.textCase
    };
  } catch (error) {
    throw new Error(`Error setting text case: ${error.message}`);
  }
}

async function setTextDecoration(params) {
  const { nodeId, textDecoration } = params || {};
  if (!nodeId || textDecoration === undefined) {
    throw new Error("Missing nodeId or textDecoration");
  }

  // Valid textDecoration values: "NONE", "UNDERLINE", "STRIKETHROUGH"
  if (!["NONE", "UNDERLINE", "STRIKETHROUGH"].includes(textDecoration)) {
    throw new Error("Invalid textDecoration value. Must be one of: NONE, UNDERLINE, STRIKETHROUGH");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);
    node.textDecoration = textDecoration;
    return {
      id: node.id,
      name: node.name,
      textDecoration: node.textDecoration
    };
  } catch (error) {
    throw new Error(`Error setting text decoration: ${error.message}`);
  }
}

async function setTextAlign(params) {
  const { nodeId, textAlignHorizontal, textAlignVertical } = params || {};
  if (!nodeId) {
    throw new Error("Missing nodeId");
  }

  const validHorizontal = ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"];
  const validVertical = ["TOP", "CENTER", "BOTTOM"];

  if (textAlignHorizontal && !validHorizontal.includes(textAlignHorizontal)) {
    throw new Error("Invalid textAlignHorizontal value. Must be one of: LEFT, CENTER, RIGHT, JUSTIFIED");
  }

  if (textAlignVertical && !validVertical.includes(textAlignVertical)) {
    throw new Error("Invalid textAlignVertical value. Must be one of: TOP, CENTER, BOTTOM");
  }

  if (!textAlignHorizontal && !textAlignVertical) {
    throw new Error("Must provide textAlignHorizontal or textAlignVertical");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);
    if (textAlignHorizontal) {
      node.textAlignHorizontal = textAlignHorizontal;
    }
    if (textAlignVertical) {
      node.textAlignVertical = textAlignVertical;
    }
    return {
      id: node.id,
      name: node.name,
      textAlignHorizontal: node.textAlignHorizontal,
      textAlignVertical: node.textAlignVertical
    };
  } catch (error) {
    throw new Error(`Error setting text alignment: ${error.message}`);
  }
}

async function getStyledTextSegments(params) {
  const { nodeId, property } = params || {};
  if (!nodeId || !property) {
    throw new Error("Missing nodeId or property");
  }

  // Valid properties: "fillStyleId", "fontName", "fontSize", "textCase", 
  // "textDecoration", "textStyleId", "fills", "letterSpacing", "lineHeight", "fontWeight"
  const validProperties = [
    "fillStyleId", "fontName", "fontSize", "textCase",
    "textDecoration", "textStyleId", "fills", "letterSpacing",
    "lineHeight", "fontWeight"
  ];

  if (!validProperties.includes(property)) {
    throw new Error(`Invalid property. Must be one of: ${validProperties.join(", ")}`);
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const segments = node.getStyledTextSegments([property]);

    // Prepare segments data in a format safe for serialization
    const safeSegments = segments.map(segment => {
      const safeSegment = {
        characters: segment.characters,
        start: segment.start,
        end: segment.end
      };

      // Handle different property types for safe serialization
      if (property === "fontName") {
        if (segment[property] && typeof segment[property] === "object") {
          safeSegment[property] = {
            family: segment[property].family || "",
            style: segment[property].style || ""
          };
        } else {
          safeSegment[property] = { family: "", style: "" };
        }
      } else if (property === "letterSpacing" || property === "lineHeight") {
        // Handle spacing properties which have a value and unit
        if (segment[property] && typeof segment[property] === "object") {
          safeSegment[property] = {
            value: segment[property].value || 0,
            unit: segment[property].unit || "PIXELS"
          };
        } else {
          safeSegment[property] = { value: 0, unit: "PIXELS" };
        }
      } else if (property === "fills") {
        // Handle fills which can be complex
        safeSegment[property] = segment[property] ? JSON.parse(JSON.stringify(segment[property])) : [];
      } else {
        // Handle simple properties
        safeSegment[property] = segment[property];
      }

      return safeSegment;
    });

    return {
      id: node.id,
      name: node.name,
      property: property,
      segments: safeSegments
    };
  } catch (error) {
    throw new Error(`Error getting styled text segments: ${error.message}`);
  }
}

async function loadFontAsyncWrapper(params) {
  const { family, style = "Regular" } = params || {};
  if (!family) {
    throw new Error("Missing font family");
  }

  try {
    await figma.loadFontAsync({ family, style });
    return {
      success: true,
      family: family,
      style: style,
      message: `Successfully loaded ${family} ${style}`
    };
  } catch (error) {
    throw new Error(`Error loading font: ${error.message}`);
  }
}

async function getRemoteComponents() {
  try {
    // Check if figma.teamLibrary is available
    if (!figma.teamLibrary) {
      console.error("Error: figma.teamLibrary API is not available");
      throw new Error("The figma.teamLibrary API is not available in this context");
    }

    // Check if figma.teamLibrary.getAvailableComponentsAsync exists
    if (!figma.teamLibrary.getAvailableComponentsAsync) {
      console.error("Error: figma.teamLibrary.getAvailableComponentsAsync is not available");
      throw new Error("The getAvailableComponentsAsync method is not available");
    }

    console.log("Starting remote components retrieval...");

    // Set up a manual timeout to detect deadlocks
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Internal timeout while retrieving remote components (45s)"));
      }, 45000); // 45 seconds internal timeout
    });

    // Execute the request with a manual timeout
    const fetchPromise = figma.teamLibrary.getAvailableComponentsAsync();

    // Use Promise.race to implement the timeout
    const teamComponents = await Promise.race([fetchPromise, timeoutPromise])
      .finally(() => {
        clearTimeout(timeoutId); // Clear the timeout
      });

    console.log(`Retrieved ${teamComponents.length} remote components`);

    return {
      success: true,
      count: teamComponents.length,
      components: teamComponents.map(component => ({
        key: component.key,
        name: component.name,
        description: component.description || "",
        libraryName: component.libraryName
      }))
    };
  } catch (error) {
    console.error(`Detailed error retrieving remote components: ${error.message || "Unknown error"}`);
    console.error(`Stack trace: ${error.stack || "Not available"}`);

    // Instead of returning an error object, throw an exception with the error message
    throw new Error(`Error retrieving remote components: ${error.message}`);
  }
}

// Set Effects Tool
async function setEffects(params) {
  const { nodeId, effects } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!effects || !Array.isArray(effects)) {
    throw new Error("Missing or invalid effects parameter. Must be an array.");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("effects" in node)) {
    throw new Error(`Node does not support effects: ${nodeId}`);
  }

  try {
    // Convert incoming effects to valid Figma effects
    const validEffects = effects.map(effect => {
      // Ensure all effects have the required properties
      if (!effect.type) {
        throw new Error("Each effect must have a type property");
      }

      // Create a clean effect object based on type
      switch (effect.type) {
        case "DROP_SHADOW":
        case "INNER_SHADOW":
          return {
            type: effect.type,
            color: effect.color || { r: 0, g: 0, b: 0, a: 0.5 },
            offset: effect.offset || { x: 0, y: 0 },
            radius: effect.radius || 5,
            spread: effect.spread || 0,
            visible: effect.visible !== undefined ? effect.visible : true,
            blendMode: effect.blendMode || "NORMAL"
          };
        case "LAYER_BLUR":
        case "BACKGROUND_BLUR":
          return {
            type: effect.type,
            radius: effect.radius || 5,
            visible: effect.visible !== undefined ? effect.visible : true
          };
        default:
          throw new Error(`Unsupported effect type: ${effect.type}`);
      }
    });

    // Apply the effects to the node
    node.effects = validEffects;

    return {
      id: node.id,
      name: node.name,
      effects: node.effects
    };
  } catch (error) {
    throw new Error(`Error setting effects: ${error.message}`);
  }
}

// Set Effect Style ID Tool
async function setEffectStyleId(params) {
  const { nodeId, effectStyleId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!effectStyleId) {
    throw new Error("Missing effectStyleId parameter");
  }

  try {
    // Set up a manual timeout to detect long operations
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Timeout while setting effect style ID (20s). The operation took too long to complete."));
      }, 20000); // 20 seconds timeout
    });

    console.log(`Starting to set effect style ID ${effectStyleId} on node ${nodeId}...`);

    // Get node and validate in a promise
    const nodePromise = (async () => {
      const node = await getNodeByIdSafe(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }

      if (!("effectStyleId" in node)) {
        throw new Error(`Node with ID ${nodeId} does not support effect styles`);
      }

      // Try to validate the effect style exists before applying
      console.log(`Fetching effect styles to validate style ID: ${effectStyleId}`);
      const effectStyles = await figma.getLocalEffectStylesAsync();
      const foundStyle = effectStyles.find(style => style.id === effectStyleId);

      if (!foundStyle) {
        throw new Error(`Effect style not found with ID: ${effectStyleId}. Available styles: ${effectStyles.length}`);
      }

      console.log(`Effect style found, applying to node...`);

      // Apply the effect style to the node
      node.effectStyleId = effectStyleId;

      return {
        id: node.id,
        name: node.name,
        effectStyleId: node.effectStyleId,
        appliedEffects: node.effects
      };
    })();

    // Race between the node operation and the timeout
    const result = await Promise.race([nodePromise, timeoutPromise])
      .finally(() => {
        // Clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
      });

    console.log(`Successfully set effect style ID on node ${nodeId}`);
    return result;
  } catch (error) {
    console.error(`Error setting effect style ID: ${error.message || "Unknown error"}`);
    console.error(`Stack trace: ${error.stack || "Not available"}`);

    // Proporcionar mensajes de error específicos para diferentes casos
    if (error.message.includes("timeout") || error.message.includes("Timeout")) {
      throw new Error(`The operation timed out after 8 seconds. This could happen with complex nodes or effects. Try with a simpler node or effect style.`);
    } else if (error.message.includes("not found") && error.message.includes("Node")) {
      throw new Error(`Node with ID "${nodeId}" not found. Make sure the node exists in the current document.`);
    } else if (error.message.includes("not found") && error.message.includes("style")) {
      throw new Error(`Effect style with ID "${effectStyleId}" not found. Make sure the style exists in your local styles.`);
    } else if (error.message.includes("does not support")) {
      throw new Error(`The selected node type does not support effect styles. Only certain node types like frames, components, and instances can have effect styles.`);
    } else {
      throw new Error(`Error setting effect style ID: ${error.message}`);
    }
  }
}

// Set Text Style ID Tool
async function setTextStyleId(params) {
  const { nodeId, textStyleId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!textStyleId) {
    throw new Error("Missing textStyleId parameter");
  }

  try {
    // Set up a manual timeout to detect long operations
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Timeout while setting text style ID (8s). The operation took too long to complete."));
      }, 8000); // 8 seconds timeout
    });

    console.log(`Starting to set text style ID ${textStyleId} on node ${nodeId}...`);

    // Get node and validate in a promise
    const nodePromise = (async () => {
      const node = await getNodeByIdSafe(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }

      if (node.type !== "TEXT") {
        throw new Error(`Node with ID ${nodeId} is not a text node (type: ${node.type})`);
      }

      // Try to validate the text style exists before applying
      console.log(`Fetching text styles to validate style ID: ${textStyleId}`);
      const textStyles = await figma.getLocalTextStylesAsync();
      // Look for the style by ID or by Key (LLMs often pass the key which is a cleaner hex string)
      const foundStyle = textStyles.find(style => style.id === textStyleId || style.key === textStyleId);

      if (!foundStyle) {
        throw new Error(`Text style with ID "${textStyleId}" not found. Make sure the style exists in your local styles.`);
      }

      // Ensure we use the full Figma ID for applying the style
      const actualStyleId = foundStyle.id;

      console.log(`Text style "${foundStyle.name}" found, applying to node...`);

      // Load the font from the style before applying
      await figma.loadFontAsync(foundStyle.fontName);

      // Apply the text style to the node
      await node.setTextStyleIdAsync(actualStyleId);

      return {
        id: node.id,
        name: node.name,
        textStyleId: node.textStyleId,
        styleName: foundStyle.name
      };
    })();

    // Race between the node operation and the timeout
    const result = await Promise.race([nodePromise, timeoutPromise])
      .finally(() => {
        // Clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
      });

    console.log(`Successfully set text style ID on node ${nodeId}`);
    return result;
  } catch (error) {
    console.error(`Error setting text style ID: ${error.message || "Unknown error"}`);
    console.error(`Stack trace: ${error.stack || "Not available"}`);

    // Provide specific error messages for different cases
    if (error.message.includes("timeout") || error.message.includes("Timeout")) {
      throw new Error(`The operation timed out after 8 seconds. This could happen with complex nodes. Try with a simpler node.`);
    } else if (error.message.includes("not found") && error.message.includes("Node")) {
      throw new Error(`Node with ID "${nodeId}" not found. Make sure the node exists in the current document.`);
    } else if (error.message.includes("not found") && error.message.includes("style")) {
      throw new Error(`Text style with ID "${textStyleId}" not found. Make sure the style exists in your local styles.`);
    } else if (error.message.includes("not a text node")) {
      throw new Error(`The selected node is not a text node. Only text nodes can have text styles applied.`);
    } else {
      throw new Error(`Error setting text style ID: ${error.message}`);
    }
  }
}

// Function to group nodes
async function groupNodes(params) {
  const { nodeIds, name } = params || {};

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 2) {
    throw new Error("Must provide at least two nodeIds to group");
  }

  try {
    // Get all nodes to be grouped
    const nodesToGroup = [];
    for (const nodeId of nodeIds) {
      const node = await getNodeByIdSafe(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      nodesToGroup.push(node);
    }

    // Verify that all nodes have the same parent
    const parent = nodesToGroup[0].parent;
    for (const node of nodesToGroup) {
      if (node.parent !== parent) {
        throw new Error("All nodes must have the same parent to be grouped");
      }
    }

    // Create a group and add the nodes to it
    const group = figma.group(nodesToGroup, parent);

    // Optionally set a name for the group
    if (name) {
      group.name = name;
    }

    return {
      id: group.id,
      name: group.name,
      type: group.type,
      children: group.children.map(child => ({ id: child.id, name: child.name, type: child.type }))
    };
  } catch (error) {
    throw new Error(`Error grouping nodes: ${error.message}`);
  }
}

// Function to ungroup nodes
async function ungroupNodes(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  try {
    const node = await getNodeByIdSafe(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    // Verify that the node is a group or a frame
    if (node.type !== "GROUP" && node.type !== "FRAME") {
      throw new Error(`Node with ID ${nodeId} is not a GROUP or FRAME`);
    }

    // Get the parent and children before ungrouping
    const parent = node.parent;
    const children = [...node.children];

    // Ungroup the node
    const ungroupedItems = figma.ungroup(node);

    return {
      success: true,
      ungroupedCount: ungroupedItems.length,
      items: ungroupedItems.map(item => ({ id: item.id, name: item.name, type: item.type }))
    };
  } catch (error) {
    throw new Error(`Error ungrouping node: ${error.message}`);
  }
}

// Function to flatten nodes (e.g., boolean operations, convert to path)
async function flattenNode(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  try {
    const node = await getNodeByIdSafe(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    // Check for specific node types that can be flattened
    const flattenableTypes = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "ELLIPSE", "RECTANGLE"];

    if (!flattenableTypes.includes(node.type)) {
      throw new Error(`Node with ID ${nodeId} and type ${node.type} cannot be flattened. Only vector-based nodes can be flattened.`);
    }

    // Verify the node has the flatten method before calling it
    if (typeof node.flatten !== 'function') {
      throw new Error(`Node with ID ${nodeId} does not support the flatten operation.`);
    }

    // Implement a timeout mechanism
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Flatten operation timed out after 20 seconds. The node may be too complex."));
      }, 20000); // 20 seconds timeout
    });

    // Execute the flatten operation in a promise
    const flattenPromise = new Promise((resolve, reject) => {
      // Execute in the next tick to allow UI updates
      setTimeout(() => {
        try {
          console.log(`Starting flatten operation for node ID ${nodeId}...`);
          const flattened = node.flatten();
          console.log(`Flatten operation completed successfully for node ID ${nodeId}`);
          resolve(flattened);
        } catch (err) {
          console.error(`Error during flatten operation: ${err.message}`);
          reject(err);
        }
      }, 0);
    });

    // Race between the timeout and the operation
    const flattened = await Promise.race([flattenPromise, timeoutPromise])
      .finally(() => {
        // Clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
      });

    return {
      id: flattened.id,
      name: flattened.name,
      type: flattened.type
    };
  } catch (error) {
    console.error(`Error in flattenNode: ${error.message}`);
    if (error.message.includes("timed out")) {
      // Provide a more helpful message for timeout errors
      throw new Error(`The flatten operation timed out. This usually happens with complex nodes. Try simplifying the node first or breaking it into smaller parts.`);
    } else {
      throw new Error(`Error flattening node: ${error.message}`);
    }
  }
}

// Function to insert a child into a parent node
async function insertChild(params) {
  const { parentId, childId, index } = params || {};

  if (!parentId) {
    throw new Error("Missing parentId parameter");
  }

  if (!childId) {
    throw new Error("Missing childId parameter");
  }

  try {
    // Get the parent and child nodes
    const parent = await getNodeByIdSafe(parentId);
    if (!parent) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }

    const child = await getNodeByIdSafe(childId);
    if (!child) {
      throw new Error(`Child node not found with ID: ${childId}`);
    }

    // Check if the parent can have children
    if (!("appendChild" in parent)) {
      throw new Error(`Parent node with ID ${parentId} cannot have children`);
    }

    // Save child's current parent for proper handling
    const originalParent = child.parent;

    // Insert the child at the specified index or append it
    if (index !== undefined && index >= 0 && index <= parent.children.length) {
      parent.insertChild(index, child);
    } else {
      parent.appendChild(child);
    }

    // Verify that the insertion worked
    const newIndex = parent.children.indexOf(child);

    return {
      parentId: parent.id,
      childId: child.id,
      index: newIndex,
      success: newIndex !== -1,
      previousParentId: originalParent ? originalParent.id : null
    };
  } catch (error) {
    console.error(`Error inserting child: ${error.message}`, error);
    throw new Error(`Error inserting child: ${error.message}`);
  }
}

async function createEllipse(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Ellipse",
    parentId,
    fillColor = { r: 0.8, g: 0.8, b: 0.8, a: 1 },
    strokeColor,
    strokeWeight
  } = params || {};

  // Create a new ellipse node
  const ellipse = figma.createEllipse();
  ellipse.name = name;

  // Position and size the ellipse
  ellipse.x = x;
  ellipse.y = y;
  ellipse.resize(width, height);

  // Set fill color if provided
  if (fillColor) {
    var fillPaint = safePaint(fillColor);
    if (fillPaint) ellipse.fills = [fillPaint];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    var strokePaint = safePaint(strokeColor);
    if (strokePaint) ellipse.strokes = [strokePaint];
  }

  if (strokeWeight !== undefined) {
    ellipse.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(ellipse);
  } else {
    figma.currentPage.appendChild(ellipse);
  }

  return {
    id: ellipse.id,
    name: ellipse.name,
    type: ellipse.type,
    x: ellipse.x,
    y: ellipse.y,
    width: ellipse.width,
    height: ellipse.height
  };
}

async function createPolygon(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    sides = 6,
    name = "Polygon",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight
  } = params || {};

  // Create the polygon
  const polygon = figma.createPolygon();
  polygon.x = x;
  polygon.y = y;
  polygon.resize(width, height);
  polygon.name = name;

  // Set the number of sides
  if (sides >= 3) {
    polygon.pointCount = sides;
  }

  // Set fill color if provided
  if (fillColor) {
    var fillPaint = safePaint(fillColor);
    if (fillPaint) polygon.fills = [fillPaint];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    var strokePaint = safePaint(strokeColor);
    if (strokePaint) polygon.strokes = [strokePaint];
  }

  if (strokeWeight !== undefined) {
    polygon.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(polygon);
  } else {
    figma.currentPage.appendChild(polygon);
  }

  return {
    id: polygon.id,
    name: polygon.name,
    type: polygon.type,
    x: polygon.x,
    y: polygon.y,
    width: polygon.width,
    height: polygon.height,
    pointCount: polygon.pointCount,
    fills: polygon.fills,
    strokes: polygon.strokes,
    strokeWeight: polygon.strokeWeight,
    parentId: polygon.parent ? polygon.parent.id : undefined,
  };
}

async function createStar(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    points = 5,
    innerRadius = 0.5, // As a proportion of the outer radius
    name = "Star",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight
  } = params || {};

  // Create the star
  const star = figma.createStar();
  star.x = x;
  star.y = y;
  star.resize(width, height);
  star.name = name;

  // Set the number of points
  if (points >= 3) {
    star.pointCount = points;
  }

  // Set the inner radius ratio
  if (innerRadius > 0 && innerRadius < 1) {
    star.innerRadius = innerRadius;
  }

  // Set fill color if provided
  if (fillColor) {
    var fillPaint = safePaint(fillColor);
    if (fillPaint) star.fills = [fillPaint];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    var strokePaint = safePaint(strokeColor);
    if (strokePaint) star.strokes = [strokePaint];
  }

  if (strokeWeight !== undefined) {
    star.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(star);
  } else {
    figma.currentPage.appendChild(star);
  }

  return {
    id: star.id,
    name: star.name,
    type: star.type,
    x: star.x,
    y: star.y,
    width: star.width,
    height: star.height,
    pointCount: star.pointCount,
    innerRadius: star.innerRadius,
    fills: star.fills,
    strokes: star.strokes,
    strokeWeight: star.strokeWeight,
    parentId: star.parent ? star.parent.id : undefined,
  };
}

async function createVector(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Vector",
    parentId,
    vectorPaths = [],
    fillColor,
    strokeColor,
    strokeWeight
  } = params || {};

  // Create the vector
  const vector = figma.createVector();
  vector.x = x;
  vector.y = y;
  vector.resize(width, height);
  vector.name = name;

  // Set vector paths if provided
  if (vectorPaths && vectorPaths.length > 0) {
    vector.vectorPaths = vectorPaths.map(path => {
      return {
        windingRule: path.windingRule || "EVENODD",
        data: path.data || ""
      };
    });
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: parseFloat(fillColor.a) || 1,
    };
    vector.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: parseFloat(strokeColor.a) || 1,
    };
    vector.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    vector.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(vector);
  } else {
    figma.currentPage.appendChild(vector);
  }

  return {
    id: vector.id,
    name: vector.name,
    type: vector.type,
    x: vector.x,
    y: vector.y,
    width: vector.width,
    height: vector.height,
    vectorNetwork: vector.vectorNetwork,
    fills: vector.fills,
    strokes: vector.strokes,
    strokeWeight: vector.strokeWeight,
    parentId: vector.parent ? vector.parent.id : undefined,
  };
}

async function createLine(params) {
  const {
    x1 = 0,
    y1 = 0,
    x2 = 100,
    y2 = 0,
    name = "Line",
    parentId,
    strokeColor = { r: 0, g: 0, b: 0, a: 1 },
    strokeWeight = 1,
    strokeCap = "NONE" // Can be "NONE", "ROUND", "SQUARE", "ARROW_LINES", or "ARROW_EQUILATERAL"
  } = params || {};

  // Create a vector node to represent the line
  const line = figma.createVector();
  line.name = name;

  // Position the line at the starting point
  line.x = x1;
  line.y = y1;

  // Calculate the vector size
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  line.resize(width > 0 ? width : 1, height > 0 ? height : 1);

  // Create vector path data for a straight line
  // SVG path data format: M (move to) starting point, L (line to) ending point
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Calculate relative endpoint coordinates in the vector's local coordinate system
  const endX = dx > 0 ? width : 0;
  const endY = dy > 0 ? height : 0;
  const startX = dx > 0 ? 0 : width;
  const startY = dy > 0 ? 0 : height;

  // Generate SVG path data for the line
  const pathData = `M ${startX} ${startY} L ${endX} ${endY}`;

  // Set vector paths
  line.vectorPaths = [{
    windingRule: "NONZERO",
    data: pathData
  }];

  // Set stroke color
  const strokeStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(strokeColor.r) || 0,
      g: parseFloat(strokeColor.g) || 0,
      b: parseFloat(strokeColor.b) || 0,
    },
    opacity: parseFloat(strokeColor.a) || 1
  };
  line.strokes = [strokeStyle];

  // Set stroke weight
  line.strokeWeight = strokeWeight;

  // Set stroke cap style if supported
  if (["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"].includes(strokeCap)) {
    line.strokeCap = strokeCap;
  }

  // Set fill to none (transparent) as lines typically don't have fills
  line.fills = [];

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(line);
  } else {
    figma.currentPage.appendChild(line);
  }

  return {
    id: line.id,
    name: line.name,
    type: line.type,
    x: line.x,
    y: line.y,
    width: line.width,
    height: line.height,
    strokeWeight: line.strokeWeight,
    strokeCap: line.strokeCap,
    strokes: line.strokes,
    vectorPaths: line.vectorPaths,
    parentId: line.parent ? line.parent.id : undefined
  };
}

// Rename a node (frame, component, group, etc.)
async function renameNode(params) {
  const { nodeId, name } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!name) {
    throw new Error("Missing name parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type === "DOCUMENT") {
    throw new Error("Cannot rename the document node");
  }

  const oldName = node.name;
  node.name = name;

  return {
    id: node.id,
    name: node.name,
    oldName: oldName,
    type: node.type
  };
}

// Create component from an existing node
async function createComponentFromNode(params) {
  const { nodeId, name, parentId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if the node can be converted to a component
  if (node.type === "DOCUMENT" || node.type === "PAGE") {
    throw new Error(`Cannot create component from ${node.type}`);
  }

  // If already a component, return its info
  if (node.type === "COMPONENT") {
    return {
      id: node.id,
      name: node.name,
      key: node.key,
      alreadyComponent: true
    };
  }

  let component;

  // For frames, groups, and other container nodes, we can use createComponentFromNode
  if ("createComponentFromNode" in figma && (node.type === "FRAME" || node.type === "GROUP" || node.type === "INSTANCE")) {
    // Use Figma's built-in createComponentFromNode API
    component = figma.createComponentFromNode(node);
  } else {
    // For other node types, we need a different approach
    // Create a new component and copy properties from the original node
    const parent = node.parent;
    const index = parent ? parent.children.indexOf(node) : 0;

    // Create frame first if it's not a frame-like node
    if (node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "POLYGON" ||
      node.type === "STAR" || node.type === "VECTOR" || node.type === "TEXT" || node.type === "LINE") {
      // Create a component and add the node as a child
      component = figma.createComponent();
      component.x = node.x;
      component.y = node.y;
      component.resize(node.width, node.height);

      // Clone the node and add it to the component
      const clone = node.clone();
      clone.x = 0;
      clone.y = 0;

      // If parentId is provided, append to that node, otherwise append to current page
      if (parentId) {
        const parentNode = await getNodeByIdSafe(parentId);
        if (!parentNode) {
          throw new Error(`Parent node not found with ID: ${parentId}`);
        }
        if (!("appendChild" in parentNode)) {
          throw new Error(`Parent node does not support children: ${parentId}`);
        }
        parentNode.appendChild(component);
      } else {
        figma.currentPage.appendChild(component);
      }
      component.appendChild(clone);

      // Add component to the same parent at the same position
      if (parent && "insertChild" in parent) {
        parent.insertChild(index, component);
      } else {
        figma.currentPage.appendChild(component);
      }

      // Remove the original node
      node.remove();
    } else if (node.type === "FRAME" || node.type === "GROUP") {
      // Fallback for frames/groups if createComponentFromNode is not available
      component = figma.createComponent();
      component.x = node.x;
      component.y = node.y;
      component.resize(node.width, node.height);

      // Copy children
      for (const child of [...node.children]) {
        component.appendChild(child);
      }

      // Copy visual properties if available
      if ("fills" in node && "fills" in component) {
        component.fills = node.fills;
      }
      if ("strokes" in node && "strokes" in component) {
        component.strokes = node.strokes;
      }
      if ("effects" in node && "effects" in component) {
        component.effects = node.effects;
      }
      if ("cornerRadius" in node && "cornerRadius" in component) {
        component.cornerRadius = node.cornerRadius;
      }

      // Add component to the same parent
      if (parent && "insertChild" in parent) {
        parent.insertChild(index, component);
      } else {
        figma.currentPage.appendChild(component);
      }

      // Remove the original node
      node.remove();
    } else {
      throw new Error(`Cannot create component from node type: ${node.type}`);
    }
  }

  // Set the name if provided
  if (name) {
    component.name = name;
  }

  return {
    id: component.id,
    name: component.name,
    key: component.key,
    width: component.width,
    height: component.height,
    x: component.x,
    y: component.y
  };
}

// Create component set from multiple components
async function createComponentSet(params) {
  const { componentIds, name } = params || {};

  if (!componentIds || !Array.isArray(componentIds) || componentIds.length === 0) {
    throw new Error("Missing or empty componentIds parameter");
  }

  const components = [];
  for (const id of componentIds) {
    const node = await getNodeByIdSafe(id);
    if (!node) {
      throw new Error(`Node not found with ID: ${id}`);
    }
    if (node.type !== "COMPONENT") {
      throw new Error(`Node with ID ${id} is not a component (type: ${node.type})`);
    }
    components.push(node);
  }

  // Determine parent container
  let container = figma.currentPage;
  if (params.parentId) {
    const parentNode = await getNodeByIdSafe(params.parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${params.parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${params.parentId}`);
    }
    container = parentNode;
  }

  // Combine components into a component set
  const componentSet = figma.combineAsVariants(components, container);

  if (name) {
    componentSet.name = name;
  }

  return {
    id: componentSet.id,
    name: componentSet.name,
    key: componentSet.key,
    variantCount: componentSet.children.length,
    width: componentSet.width,
    height: componentSet.height
  };
}

// Set variant properties of a component instance
async function setInstanceVariant(params) {
  const { nodeId, properties } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!properties || typeof properties !== "object") {
    throw new Error("Missing or invalid properties parameter");
  }

  if (Object.keys(properties).length === 0) {
    throw new Error("Properties object cannot be empty");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "INSTANCE") {
    throw new Error(`Node with ID ${nodeId} is not a component instance (type: ${node.type})`);
  }

  if (!("setProperties" in node)) {
    throw new Error(`Node does not support variant properties`);
  }

  node.setProperties(properties);

  return {
    id: node.id,
    name: node.name,
    properties: node.componentProperties
  };
}

// Create a new page
async function createPage(params) {
  const { name } = params || {};

  if (!name) {
    throw new Error("Missing name parameter");
  }

  const page = figma.createPage();
  page.name = name;

  return {
    id: page.id,
    name: page.name
  };
}

// Delete a page
async function deletePage(params) {
  const { pageId } = params || {};

  if (!pageId) {
    throw new Error("Missing pageId parameter");
  }

  // Cannot delete the only page or the current page if it's the only one
  if (figma.root.children.length <= 1) {
    throw new Error("Cannot delete the only page in the document");
  }

  const page = figma.root.children.find(p => p.id === pageId);
  if (!page) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  const pageName = page.name;

  // If deleting current page, switch to another page first
  if (figma.currentPage.id === pageId) {
    const otherPage = figma.root.children.find(p => p.id !== pageId);
    if (otherPage) {
      await figma.setCurrentPageAsync(otherPage);
    }
  }

  page.remove();

  return {
    success: true,
    name: pageName
  };
}

// Rename a page
async function renamePage(params) {
  const { pageId, name } = params || {};

  if (!pageId) {
    throw new Error("Missing pageId parameter");
  }
  if (!name) {
    throw new Error("Missing name parameter");
  }

  const page = figma.root.children.find(p => p.id === pageId);
  if (!page) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  const oldName = page.name;
  page.name = name;

  return {
    id: page.id,
    name: page.name,
    oldName: oldName
  };
}

// Get all pages in the document
async function getPages() {
  await figma.loadAllPagesAsync();

  return {
    pages: figma.root.children.map(page => ({
      id: page.id,
      name: page.name,
      childCount: page.children.length,
      isCurrent: page.id === figma.currentPage.id
    })),
    currentPageId: figma.currentPage.id
  };
}

// Return the key of the file this plugin is currently running in.
//
// This is what lets the REST-based comment tools work without the user pasting
// a file URL: the plugin already knows which file is open, so the server can
// ask instead of asking the human.
//
// `figma.fileKey` is gated behind the private plugin API — it is populated when
// the plugin runs with `enablePrivatePluginApi: true` (as this one does) or as a
// local development / organisation plugin. On a public plugin build it is
// undefined, so callers must handle that case rather than assume a value.
async function getFileKey() {
  const fileKey = typeof figma.fileKey === "string" ? figma.fileKey : null;

  return {
    fileKey: fileKey,
    // figma.root is the DocumentNode; its name is the file name.
    fileName: figma.root && figma.root.name ? figma.root.name : null,
    pageName: figma.currentPage ? figma.currentPage.name : null,
    pageId: figma.currentPage ? figma.currentPage.id : null,
    available: fileKey !== null,
  };
}

// Set the current page
async function setCurrentPage(params) {
  const { pageId } = params || {};

  if (!pageId) {
    throw new Error("Missing pageId parameter");
  }

  const page = figma.root.children.find(p => p.id === pageId);
  if (!page) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  await figma.setCurrentPageAsync(page);

  return {
    id: page.id,
    name: page.name
  };
}

// Helper function: base64 to Uint8Array decoder
function base64ToUint8Array(base64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  const paddingLength = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const cleanBase64 = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = cleanBase64.length;
  const byteLength = (len * 3 / 4) - paddingLength;
  const bytes = new Uint8Array(byteLength);

  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[cleanBase64.charCodeAt(i)];
    const encoded2 = lookup[cleanBase64.charCodeAt(i + 1)];
    const encoded3 = lookup[cleanBase64.charCodeAt(i + 2)];
    const encoded4 = lookup[cleanBase64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (i + 2 < len && cleanBase64[i + 2] !== '=') {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (i + 3 < len && cleanBase64[i + 3] !== '=') {
      bytes[p++] = ((encoded3 & 3) << 6) | encoded4;
    }
  }

  return bytes;
}

// Image manipulation commands

async function setImageFill(params) {
  try {
    const { nodeId, imageSource, sourceType, scaleMode } = params || {};

    if (!nodeId || !imageSource || !sourceType) {
      throw new Error("Missing required parameters: nodeId, imageSource, sourceType");
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (!("fills" in node)) {
      throw new Error(`Node type ${node.type} does not support fills`);
    }
    let image;

    if (sourceType === "url") {
      image = await figma.createImageAsync(imageSource);
    } else if (sourceType === "base64") {
      const imageBytes = base64ToUint8Array(imageSource);
      image = figma.createImage(imageBytes);
    } else {
      throw new Error(`Invalid sourceType: ${sourceType}. Must be 'url' or 'base64'`);
    }

    const imageSize = await image.getSizeAsync();
    if (imageSize.width > 4096 || imageSize.height > 4096) {
      throw new Error(`Image size ${imageSize.width}x${imageSize.height} exceeds Figma limit of 4096x4096`);
    }

    const imageFill = {
      type: "IMAGE",
      scaleMode: scaleMode || "FILL",
      imageHash: image.hash,
    };

    node.fills = [imageFill];

    return {
      name: node.name,
      scaleMode: imageFill.scaleMode,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Error setting image fill: ${errorMsg}`);
  }
}

async function getImageFromNode(params) {
  try {
    const { nodeId } = params || {};

    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (!("fills" in node)) {
      throw new Error(`Node type ${node.type} does not support fills`);
    }

    const fills = Array.isArray(node.fills) ? node.fills : [];
    const imageFill = fills.find(fill => fill.type === "IMAGE");

    if (!imageFill) {
      return {
        name: node.name,
        hasImage: false,
      };
    }

    const image = figma.getImageByHash(imageFill.imageHash);
    const imageSize = image ? await image.getSizeAsync() : null;

    return {
      name: node.name,
      hasImage: true,
      imageHash: imageFill.imageHash,
      scaleMode: imageFill.scaleMode,
      imageSize: imageSize,
      rotation: imageFill.rotation || 0,
      filters: imageFill.filters || null,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Error getting image from node: ${errorMsg}`);
  }
}

async function replaceImageFill(params) {
  try {
    const { nodeId, newImageSource, sourceType, preserveTransform } = params || {};

    if (!nodeId || !newImageSource || !sourceType) {
      throw new Error("Missing required parameters: nodeId, newImageSource, sourceType");
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (!("fills" in node)) {
      throw new Error(`Node type ${node.type} does not support fills`);
    }

    const fills = Array.isArray(node.fills) ? node.fills : [];
    const imageFillIndex = fills.findIndex(fill => fill.type === "IMAGE");

    if (imageFillIndex === -1) {
      throw new Error(`Node does not have an existing image fill to replace`);
    }

    const existingImageFill = fills[imageFillIndex];
    let newImage;

    if (sourceType === "url") {
      newImage = await figma.createImageAsync(newImageSource);
    } else if (sourceType === "base64") {
      const imageBytes = base64ToUint8Array(newImageSource);
      newImage = figma.createImage(imageBytes);
    } else {
      throw new Error(`Invalid sourceType: ${sourceType}`);
    }

    const newImageFill = {
      type: "IMAGE",
      imageHash: newImage.hash,
    };

    if (preserveTransform !== false) {
      if (existingImageFill.scaleMode) newImageFill.scaleMode = existingImageFill.scaleMode;
      if (existingImageFill.imageTransform) newImageFill.imageTransform = existingImageFill.imageTransform;
      if (existingImageFill.rotation) newImageFill.rotation = existingImageFill.rotation;
      if (existingImageFill.scalingFactor) newImageFill.scalingFactor = existingImageFill.scalingFactor;
      if (existingImageFill.filters) newImageFill.filters = existingImageFill.filters;
    } else {
      newImageFill.scaleMode = "FILL";
    }

    const newFills = fills.slice();
    newFills[imageFillIndex] = newImageFill;
    node.fills = newFills;

    return {
      name: node.name,
      preserved: preserveTransform !== false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Error replacing image fill: ${errorMsg}`);
  }
}

// COMMENTED OUT: getImageBytes - Issues pending investigation
// Known issues: 400 errors, inconsistent behavior (black images), file save path needs discussion
/*
async function getImageBytes(params) {
  try {
    const { imageHash, nodeId } = params || {};

    if (!imageHash && !nodeId) {
      throw new Error("Either imageHash or nodeId must be provided");
    }
    let image;

    if (imageHash) {
      image = figma.getImageByHash(imageHash);
      if (!image) {
        throw new Error(`Image not found with hash: ${imageHash}`);
      }
    } else {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }

      if (!("fills" in node)) {
        throw new Error(`Node type ${node.type} does not support fills`);
      }

      const fills = Array.isArray(node.fills) ? node.fills : [];
      const imageFill = fills.find(fill => fill.type === "IMAGE");

      if (!imageFill) {
        throw new Error(`Node does not have an image fill`);
      }

      image = figma.getImageByHash(imageFill.imageHash);
      if (!image) {
        throw new Error(`Image not found for node`);
      }
    }

    const bytes = await image.getBytesAsync();
    const base64 = customBase64Encode(bytes);

    return {
      imageData: base64,
      mimeType: "image/png",
      size: bytes.length,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Error getting image bytes: ${errorMsg}`);
  }
}
*/

async function applyImageTransform(params) {
  try {
    const { nodeId, scaleMode, rotation, translateX, translateY, scale } = params || {};

    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (!("fills" in node)) {
      throw new Error(`Node type ${node.type} does not support fills`);
    }

    const fills = Array.isArray(node.fills) ? node.fills : [];
    const imageFillIndex = fills.findIndex(fill => fill.type === "IMAGE");

    if (imageFillIndex === -1) {
      throw new Error(`Node does not have an image fill`);
    }

    const imageFill = Object.assign({}, fills[imageFillIndex]);
    const transformApplied = [];

    if (scaleMode !== undefined) {
      imageFill.scaleMode = scaleMode;
      transformApplied.push(`scaleMode: ${scaleMode}`);
    }

    if (rotation !== undefined) {
      if (![0, 90, 180, 270].includes(rotation)) {
        throw new Error("Rotation must be 0, 90, 180, or 270 degrees");
      }
      imageFill.rotation = rotation;
      transformApplied.push(`rotation: ${rotation}°`);
    }

    if (translateX !== undefined || translateY !== undefined || scale !== undefined) {
      const currentTransform = imageFill.imageTransform || [[1, 0, 0], [0, 1, 0]];
      const newTransform = [
        [currentTransform[0][0], currentTransform[0][1], currentTransform[0][2]],
        [currentTransform[1][0], currentTransform[1][1], currentTransform[1][2]]
      ];

      if (scale !== undefined) {
        newTransform[0][0] = scale;
        newTransform[1][1] = scale;
        transformApplied.push(`scale: ${scale}`);
      }

      if (translateX !== undefined) {
        newTransform[0][2] = translateX;
        transformApplied.push(`translateX: ${translateX}`);
      }

      if (translateY !== undefined) {
        newTransform[1][2] = translateY;
        transformApplied.push(`translateY: ${translateY}`);
      }

      imageFill.imageTransform = newTransform;
    }

    const newFills = fills.slice();
    newFills[imageFillIndex] = imageFill;
    node.fills = newFills;

    return {
      name: node.name,
      transformApplied: transformApplied.length > 0 ? transformApplied : ["no changes"],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Error applying image transform: ${errorMsg}`);
  }
}

async function setImageFilters(params) {
  try {
    const nodeId = params.nodeId;
    const filters = params.filters;

    if (!nodeId || !filters) {
      throw new Error("Missing required parameters: nodeId, filters");
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error("Node not found with ID: " + nodeId);
    }

    if (!("fills" in node)) {
      throw new Error("Node type " + node.type + " does not support fills");
    }

    const fills = Array.isArray(node.fills) ? node.fills : [];
    const imageFillIndex = fills.findIndex(function(f) { return f.type === "IMAGE"; });

    if (imageFillIndex === -1) {
      throw new Error("Node does not have an image fill");
    }

    const imageFill = Object.assign({}, fills[imageFillIndex]);

    const currentFilters = imageFill.filters || {};
    const newFilters = Object.assign({}, currentFilters);

    if (filters.exposure !== undefined) newFilters.exposure = filters.exposure;
    if (filters.contrast !== undefined) newFilters.contrast = filters.contrast;
    if (filters.saturation !== undefined) newFilters.saturation = filters.saturation;
    if (filters.temperature !== undefined) newFilters.temperature = filters.temperature;
    if (filters.tint !== undefined) newFilters.tint = filters.tint;
    if (filters.highlights !== undefined) newFilters.highlights = filters.highlights;
    if (filters.shadows !== undefined) newFilters.shadows = filters.shadows;

    imageFill.filters = newFilters;

    const newFills = fills.slice();
    newFills[imageFillIndex] = imageFill;
    node.fills = newFills;

    return {
      name: node.name,
      appliedFilters: newFilters
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error("Error setting image filters: " + errorMsg);
  }
}

// Rotate a node
async function rotateNode(params) {
  const { nodeId, angle, relative } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (angle === undefined) {
    throw new Error("Missing angle parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("rotation" in node)) {
    throw new Error(`Node type ${node.type} does not support rotation`);
  }

  if (relative) {
    node.rotation = node.rotation + angle;
  } else {
    node.rotation = angle;
  }

  return {
    id: node.id,
    name: node.name,
    rotation: node.rotation
  };
}

// Set node properties (visibility, lock, opacity)
async function setNodeProperties(params) {
  const { nodeId, visible, locked, opacity } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (visible !== undefined) {
    node.visible = visible;
  }

  if (locked !== undefined) {
    node.locked = locked;
  }

  if (opacity !== undefined) {
    if (!("opacity" in node)) {
      throw new Error(`Node type ${node.type} does not support opacity`);
    }
    node.opacity = opacity;
  }

  return {
    id: node.id,
    name: node.name,
    visible: node.visible,
    locked: node.locked,
    opacity: "opacity" in node ? node.opacity : undefined
  };
}

// Reorder node within its parent (z-order)
async function reorderNode(params) {
  const { nodeId, position, index } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const parent = node.parent;
  if (!parent || !("children" in parent)) {
    throw new Error("Node has no parent container or parent does not support children");
  }

  const siblings = parent.children;
  const currentIndex = siblings.indexOf(node);

  let targetIndex;

  if (index !== undefined) {
    targetIndex = Math.max(0, Math.min(index, siblings.length - 1));
  } else if (position) {
    switch (position) {
      case "front":
        targetIndex = siblings.length - 1;
        break;
      case "back":
        targetIndex = 0;
        break;
      case "forward":
        targetIndex = Math.min(currentIndex + 1, siblings.length - 1);
        break;
      case "backward":
        targetIndex = Math.max(currentIndex - 1, 0);
        break;
      default:
        throw new Error(`Invalid position: ${position}. Use front, back, forward, or backward.`);
    }
  } else {
    throw new Error("Either position or index must be provided");
  }

  parent.insertChild(targetIndex, node);

  return {
    id: node.id,
    name: node.name,
    newIndex: targetIndex,
    parentChildCount: siblings.length
  };
}

// Duplicate a page
async function duplicatePage(params) {
  const { pageId, name } = params || {};

  if (!pageId) {
    throw new Error("Missing pageId parameter");
  }

  const page = figma.root.children.find(p => p.id === pageId);
  if (!page) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  const originalName = page.name;
  const clonedPage = page.clone();

  if (name) {
    clonedPage.name = name;
  } else {
    clonedPage.name = `${originalName} (Copy)`;
  }

  return {
    id: clonedPage.id,
    name: clonedPage.name,
    originalName: originalName,
    childCount: clonedPage.children.length
  };
}

// Convert a group or shape to a frame
async function convertToFrame(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    throw new Error(`Node is already a ${node.type}. No conversion needed.`);
  }

  if (node.type === "PAGE" || node.type === "DOCUMENT") {
    throw new Error(`Cannot convert ${node.type} to a frame`);
  }

  const parent = node.parent;
  if (!parent || !("children" in parent)) {
    throw new Error("Node has no parent container");
  }

  const originalType = node.type;
  const originalName = node.name;
  const siblings = parent.children;
  const originalIndex = siblings.indexOf(node);

  // Create new frame
  const frame = figma.createFrame();
  frame.name = originalName;
  frame.x = node.x;
  frame.y = node.y;
  frame.resize(node.width, node.height);

  // Copy visual properties if available
  if ("fills" in node) frame.fills = JSON.parse(JSON.stringify(node.fills));
  if ("strokes" in node) frame.strokes = JSON.parse(JSON.stringify(node.strokes));
  if ("strokeWeight" in node) frame.strokeWeight = node.strokeWeight;
  if ("effects" in node) frame.effects = JSON.parse(JSON.stringify(node.effects));
  if ("cornerRadius" in node) frame.cornerRadius = node.cornerRadius;
  if ("opacity" in node) frame.opacity = node.opacity;
  if ("rotation" in node) frame.rotation = node.rotation;
  if ("clipsContent" in node) frame.clipsContent = node.clipsContent;

  // Transfer children if the node has them (e.g., groups)
  let childCount = 0;
  const isGroup = node.type === "GROUP";
  if ("children" in node) {
    const children = [...node.children];
    childCount = children.length;
    for (const child of children) {
      frame.appendChild(child);
    }
  }

  // Groups auto-delete when all children are moved out, so check if node still exists
  // Accessing .parent on a deleted node throws in Figma, so use try/catch
  let nodeStillExists = true;
  if (isGroup) {
    try {
      nodeStillExists = node.parent !== null;
    } catch (e) {
      nodeStillExists = false;
    }
  }

  // Insert frame at the correct position in parent
  // If the group was auto-deleted, originalIndex may be stale — recalculate
  const insertIndex = nodeStillExists ? originalIndex : Math.min(originalIndex, parent.children.length);
  parent.insertChild(insertIndex, frame);

  // Remove the original node if it still exists
  if (nodeStillExists) {
    try { node.remove(); } catch (e) { /* already removed */ }
  }

  return {
    id: frame.id,
    name: frame.name,
    originalType: originalType,
    childCount: childCount
  };
}

// Set gradient fill on a node
async function setGradient(params) {
  const { nodeId, type, stops, gradientTransform } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node type ${node.type} does not support fills`);
  }

  if (!stops || !Array.isArray(stops) || stops.length < 2) {
    throw new Error("Gradient requires at least 2 color stops");
  }

  const gradientStops = stops.map(stop => ({
    position: stop.position,
    color: {
      r: stop.color.r,
      g: stop.color.g,
      b: stop.color.b,
      a: stop.color.a !== undefined ? stop.color.a : 1,
    },
  }));

  const gradientFill = {
    type: type,
    gradientStops: gradientStops,
    gradientTransform: gradientTransform || [[1, 0, 0], [0, 1, 0]],
  };

  node.fills = [gradientFill];

  return {
    id: node.id,
    name: node.name,
    fills: node.fills
  };
}

// Boolean operation (union, subtract, intersect, exclude)
async function booleanOperation(params) {
  const { nodeIds, operation, name } = params || {};

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 2) {
    throw new Error("At least 2 node IDs are required for boolean operations");
  }

  if (!operation) {
    throw new Error("Missing operation parameter");
  }

  // Resolve all nodes
  const nodes = [];
  for (const id of nodeIds) {
    const node = await getNodeByIdSafe(id);
    if (!node) {
      throw new Error(`Node not found with ID: ${id}`);
    }
    nodes.push(node);
  }

  // Validate all nodes share the same parent
  const parents = new Set(nodes.map(n => n.parent ? n.parent.id : null));
  if (parents.size > 1) {
    throw new Error(
      `All nodes must share the same parent. Found ${parents.size} different parents. ` +
      `Move nodes into the same frame before performing boolean operations.`
    );
  }

  const parent = nodes[0].parent;
  if (!parent) {
    throw new Error("Nodes have no parent container");
  }

  let result;
  switch (operation) {
    case "UNION":
      result = figma.union(nodes, parent);
      break;
    case "SUBTRACT":
      result = figma.subtract(nodes, parent);
      break;
    case "INTERSECT":
      result = figma.intersect(nodes, parent);
      break;
    case "EXCLUDE":
      result = figma.exclude(nodes, parent);
      break;
    default:
      throw new Error(`Invalid operation: ${operation}. Use UNION, SUBTRACT, INTERSECT, or EXCLUDE.`);
  }

  if (name) {
    result.name = name;
  }

  return {
    id: result.id,
    name: result.name,
    type: result.type
  };
}

// SVG sanitization - strip scripts, event handlers, external resources
function sanitizeSvg(svgString) {
  let clean = svgString;
  // Strip <script> tags
  clean = clean.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Strip event handlers (onclick, onload, etc.) — separate regexes per quote type to handle mixed quotes
  clean = clean.replace(/\bon\w+\s*=\s*"[^"]*"/gi, '');
  clean = clean.replace(/\bon\w+\s*=\s*'[^']*'/gi, '');
  // Strip external resource references
  clean = clean.replace(/xlink:href\s*=\s*["']https?:\/\/[^"']*["']/gi, '');
  clean = clean.replace(/href\s*=\s*["']https?:\/\/[^"']*["']/gi, '');
  // Strip data URIs that could be injection vectors
  clean = clean.replace(/href\s*=\s*["']data:text\/html[^"']*["']/gi, '');
  return clean;
}

// Import SVG string as vector node
async function setSvg(params) {
  const { svgString, x, y, name, parentId } = params || {};

  if (!svgString) {
    throw new Error("Missing svgString parameter");
  }

  // Validate SVG content
  if (!svgString.includes('<svg') && !svgString.includes('<?xml')) {
    throw new Error("Invalid SVG: string must contain an <svg> element");
  }

  // Sanitize the SVG
  const cleanSvg = sanitizeSvg(svgString);

  const node = figma.createNodeFromSvg(cleanSvg);

  if (x !== undefined) node.x = x;
  if (y !== undefined) node.y = y;
  if (name) node.name = name;

  // If parentId is provided, move into that parent
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(node);
  }

  return {
    id: node.id,
    name: node.name,
    width: node.width,
    height: node.height,
    type: node.type
  };
}

// Export a node as SVG string
async function getSvg(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("exportAsync" in node)) {
    throw new Error(`Node type ${node.type} does not support export`);
  }

  const svgString = await node.exportAsync({ format: "SVG_STRING" });

  return {
    svgString: svgString,
    name: node.name,
    id: node.id
  };
}

// Set image fill on a node from base64-encoded image data
async function setImage(params) {
  const { nodeId, imageData, scaleMode } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!imageData) {
    throw new Error("Missing imageData parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (!("fills" in node)) {
    throw new Error(`Node type ${node.type} does not support fills`);
  }

  // Validate base64 charset
  if (!/^[A-Za-z0-9+/=]+$/.test(imageData)) {
    throw new Error("Invalid base64 encoding. Ensure the string contains only valid base64 characters (no data URI prefix).");
  }

  // Decode base64 to Uint8Array (atob is not available in Figma plugin sandbox)
  const bytes = customBase64Decode(imageData);

  // Check decoded size limit (5MB)
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error("Image exceeds 5MB limit. Use a smaller image or compress it first.");
  }

  // Create image in Figma and set as fill
  const image = figma.createImage(bytes);
  node.fills = [{
    type: "IMAGE",
    imageHash: image.hash,
    scaleMode: scaleMode || "FILL",
    visible: true,
    opacity: 1
  }];

  return {
    id: node.id,
    name: node.name,
    imageHash: image.hash,
    scaleMode: scaleMode || "FILL"
  };
}

// Set layout grids on a frame node
async function setGrid(params) {
  const { nodeId, grids } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!grids || !Array.isArray(grids)) {
    throw new Error("Missing or invalid grids parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (!("layoutGrids" in node)) {
    throw new Error(`Node type ${node.type} does not support layout grids. Use a frame node.`);
  }

  const layoutGrids = grids.map(grid => {
    const layoutGrid = {
      pattern: grid.pattern,
      visible: grid.visible !== undefined ? grid.visible : true
    };

    // Ensure required fields have defaults per pattern type to prevent Figma from hanging
    if (grid.pattern === "GRID") {
      layoutGrid.sectionSize = grid.sectionSize !== undefined ? grid.sectionSize : 10;
    } else {
      // COLUMNS and ROWS: alignment determines the variant
      // STRETCH: uses count, gutterSize, offset (evenly divided)
      // MIN/CENTER/MAX: uses sectionSize, count, offset (fixed-size cells)
      layoutGrid.alignment = grid.alignment !== undefined ? grid.alignment : "STRETCH";

      if (layoutGrid.alignment === "STRETCH") {
        layoutGrid.count = grid.count !== undefined ? grid.count : 5;
        layoutGrid.gutterSize = grid.gutterSize !== undefined ? grid.gutterSize : 10;
        layoutGrid.offset = grid.offset !== undefined ? grid.offset : 0;
      } else {
        // MIN/CENTER/MAX: fixed-size cells
        layoutGrid.sectionSize = grid.sectionSize !== undefined ? grid.sectionSize : 10;
        layoutGrid.count = grid.count !== undefined ? grid.count : 1;
        layoutGrid.gutterSize = grid.gutterSize !== undefined ? grid.gutterSize : 0;
        layoutGrid.offset = grid.offset !== undefined ? grid.offset : 0;
      }
    }

    if (grid.color) {
      layoutGrid.color = {
        r: grid.color.r,
        g: grid.color.g,
        b: grid.color.b,
        a: grid.color.a !== undefined ? grid.color.a : 0.1
      };
    }

    return layoutGrid;
  });

  node.layoutGrids = layoutGrids;

  return {
    id: node.id,
    name: node.name,
    gridCount: layoutGrids.length
  };
}

// Get layout grids from a frame node
async function getGrid(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (!("layoutGrids" in node)) {
    throw new Error(`Node type ${node.type} does not support layout grids. Use a frame node.`);
  }

  return {
    id: node.id,
    name: node.name,
    grids: node.layoutGrids.map(grid => ({
      pattern: grid.pattern,
      visible: grid.visible,
      sectionSize: grid.sectionSize,
      count: grid.count,
      gutterSize: grid.gutterSize,
      offset: grid.offset,
      alignment: grid.alignment,
      color: grid.color
    }))
  };
}

// Set guides on a page
async function setGuide(params) {
  const { pageId, guides } = params || {};

  if (!pageId) {
    throw new Error("Missing pageId parameter");
  }
  if (!guides || !Array.isArray(guides)) {
    throw new Error("Missing or invalid guides parameter");
  }

  const page = figma.root.children.find(p => p.id === pageId);
  if (!page) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  page.guides = guides.map(guide => ({
    axis: guide.axis,
    offset: guide.offset
  }));

  return {
    id: page.id,
    name: page.name,
    guideCount: guides.length
  };
}

// Get guides from a page
async function getGuide(params) {
  const { pageId } = params || {};

  if (!pageId) {
    throw new Error("Missing pageId parameter");
  }

  const page = figma.root.children.find(p => p.id === pageId);
  if (!page) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  return {
    id: page.id,
    name: page.name,
    guides: (page.guides || []).map(guide => ({
      axis: guide.axis,
      offset: guide.offset
    }))
  };
}

// Set annotation on a node (proposed API)
async function setAnnotation(params) {
  const { nodeId, label } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!label) {
    throw new Error("Missing label parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Feature detection for annotations API
  if (!("annotations" in node)) {
    throw new Error(
      "Annotations API is not available on this node type (" + node.type + "). " +
      "Supported types: Frame, Rectangle, Ellipse, Text, Component, Instance, etc."
    );
  }

  // node.annotations is ReadonlyArray — must create a new array with deep copies
  // Strip labelMarkdown from copies since Figma auto-generates it from label
  // and rejects annotations that have both label + labelMarkdown
  const existing = node.annotations
    ? node.annotations.map(a => {
        const copy = JSON.parse(JSON.stringify(a));
        if (copy.label && copy.labelMarkdown) {
          delete copy.labelMarkdown;
        }
        return copy;
      })
    : [];
  existing.push({ label: label, properties: [] });
  node.annotations = existing;

  return {
    id: node.id,
    name: node.name,
    annotationCount: existing.length
  };
}

// Get annotations from a node (proposed API)
async function getAnnotation(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Feature detection for proposed API
  if (!("annotations" in node)) {
    throw new Error(
      "Annotations API is not available in this Figma version. " +
      "Please update Figma Desktop to the latest version. " +
      "This feature requires the proposed API (enableProposedApi: true in manifest)."
    );
  }

  return {
    id: node.id,
    name: node.name,
    annotations: node.annotations || []
  };
}

// Get all variable collections and their variables
// ─── Token engine: index, strict matching, binding ─────────────────────────
//
// The rule this section exists to enforce: when the file already defines a
// variable for a property, the property is BOUND to that variable. Copying the
// resolved colour or number instead severs the token connection — the layer
// then stops following the design system and stops responding to mode changes,
// which is invisible until someone edits a token and nothing moves.
//
// Matching is deliberately strict. `colors/Base/Primary`, `colors/Primary/500`
// and `colors/Primary/700` are different tokens with related values; a fuzzy
// match between them silently rewrites the design system's intent. Every
// unmatched property is reported rather than guessed at.

/** Collapse a token path to a comparable key: "Text size/Body1/font-size" → "text-size-body1-font-size". */
function normalizeTokenName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Which variable type a bindable field needs, so a COLOR can never be bound to
 * itemSpacing and produce an unreadable Figma error.
 */
const FIELD_RESOLVED_TYPE = {
  itemSpacing: "FLOAT", counterAxisSpacing: "FLOAT",
  paddingTop: "FLOAT", paddingRight: "FLOAT", paddingBottom: "FLOAT", paddingLeft: "FLOAT",
  width: "FLOAT", height: "FLOAT", minWidth: "FLOAT", maxWidth: "FLOAT",
  minHeight: "FLOAT", maxHeight: "FLOAT",
  opacity: "FLOAT", strokeWeight: "FLOAT",
  strokeTopWeight: "FLOAT", strokeRightWeight: "FLOAT",
  strokeBottomWeight: "FLOAT", strokeLeftWeight: "FLOAT",
  cornerRadius: "FLOAT", topLeftRadius: "FLOAT", topRightRadius: "FLOAT",
  bottomLeftRadius: "FLOAT", bottomRightRadius: "FLOAT",
  fontSize: "FLOAT", lineHeight: "FLOAT", letterSpacing: "FLOAT",
  paragraphSpacing: "FLOAT", paragraphIndent: "FLOAT",
  fontWeight: "FLOAT",
  fontFamily: "STRING", fontStyle: "STRING", characters: "STRING",
  visible: "BOOLEAN",
};

/** Which variable scopes Figma considers appropriate for a bindable field. */
const FIELD_SCOPES = {
  itemSpacing: ["GAP"], counterAxisSpacing: ["GAP"],
  paddingTop: ["GAP"], paddingRight: ["GAP"], paddingBottom: ["GAP"], paddingLeft: ["GAP"],
  width: ["WIDTH_HEIGHT"], height: ["WIDTH_HEIGHT"],
  minWidth: ["WIDTH_HEIGHT"], maxWidth: ["WIDTH_HEIGHT"],
  minHeight: ["WIDTH_HEIGHT"], maxHeight: ["WIDTH_HEIGHT"],
  opacity: ["OPACITY"],
  strokeWeight: ["STROKE_FLOAT"],
  strokeTopWeight: ["STROKE_FLOAT"], strokeRightWeight: ["STROKE_FLOAT"],
  strokeBottomWeight: ["STROKE_FLOAT"], strokeLeftWeight: ["STROKE_FLOAT"],
  cornerRadius: ["CORNER_RADIUS"], topLeftRadius: ["CORNER_RADIUS"],
  topRightRadius: ["CORNER_RADIUS"], bottomLeftRadius: ["CORNER_RADIUS"],
  bottomRightRadius: ["CORNER_RADIUS"],
  fontSize: ["FONT_SIZE"], lineHeight: ["LINE_HEIGHT"], letterSpacing: ["LETTER_SPACING"],
  paragraphSpacing: ["PARAGRAPH_SPACING"], paragraphIndent: ["PARAGRAPH_INDENT"],
  fontWeight: ["FONT_WEIGHT"], fontFamily: ["FONT_FAMILY"], fontStyle: ["FONT_STYLE"],
  characters: ["TEXT_CONTENT"],
};

/** Scopes for the paint- and effect-level pseudo-fields. */
const PAINT_FIELD_SCOPES = {
  fills: ["FRAME_FILL", "SHAPE_FILL", "TEXT_FILL"],
  strokes: ["STROKE_COLOR"],
  effects: ["EFFECT_COLOR"],
};

/**
 * Build the lookup maps once per scan.
 *
 * A file this size (hundreds of variables) is scanned repeatedly during a bind
 * pass; walking the array each time is what makes token binding feel slow
 * enough that people skip it.
 */
async function buildVariableIndex() {
  if (!figma.variables) {
    throw new Error(
      "Variables API is not available. This feature requires Figma with Variables support. " +
        "Ensure enableProposedApi is true in the plugin manifest."
    );
  }

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const index = {
    byExactName: Object.create(null),
    byLowerName: Object.create(null),
    byNormalizedName: Object.create(null),
    byId: Object.create(null),
    collectionById: Object.create(null),
    all: [],
  };

  for (const collection of collections) {
    index.collectionById[collection.id] = collection;
  }

  for (const collection of collections) {
    for (const variableId of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(variableId);
      if (!variable) continue;

      index.byId[variable.id] = variable;
      index.all.push(variable);

      const push = (map, key) => {
        if (!map[key]) map[key] = [];
        map[key].push(variable);
      };
      push(index.byExactName, variable.name);
      push(index.byLowerName, variable.name.toLowerCase());
      push(index.byNormalizedName, normalizeTokenName(variable.name));
    }
  }

  return index;
}

/** A variable's scopes cover a field when they overlap, or when it is ALL_SCOPES. */
function isScopeCompatible(variable, allowedScopes) {
  if (!allowedScopes || !allowedScopes.length) return true;
  const scopes = variable.scopes || [];
  if (!scopes.length) return true; // unscoped: usable anywhere
  if (scopes.indexOf("ALL_SCOPES") !== -1) return true;
  return allowedScopes.some((scope) => scopes.indexOf(scope) !== -1);
}

/**
 * Find the one variable that fits, or explain precisely why nothing does.
 *
 * Returns { variable, matchMethod } on success, or { reason } — never a guess.
 * `reason` is one of not-found / ambiguous / wrong-type / wrong-scope, matching
 * the vocabulary the report uses, so a caller can tell "this token does not
 * exist" apart from "this token exists but cannot legally bind here".
 */
function findCompatibleVariable(index, options) {
  const { name, resolvedType, allowedScopes, collectionName } = options || {};
  if (!name) return { reason: "not-found", detail: "no name given" };

  const failures = { type: 0, scope: 0, collection: 0 };
  const validate = (variable) => {
    if (resolvedType && variable.resolvedType !== resolvedType) {
      failures.type++;
      return false;
    }
    if (!isScopeCompatible(variable, allowedScopes)) {
      failures.scope++;
      return false;
    }
    if (collectionName) {
      const collection = index.collectionById[variable.variableCollectionId];
      if (!collection || collection.name !== collectionName) {
        failures.collection++;
        return false;
      }
    }
    return true;
  };

  // 1. Exact path. 2. Case-insensitive path. 3. Normalized, only when unique.
  const tiers = [
    { candidates: index.byExactName[name] || [], method: "exact" },
    { candidates: index.byLowerName[String(name).toLowerCase()] || [], method: "exact-case-insensitive" },
    { candidates: index.byNormalizedName[normalizeTokenName(name)] || [], method: "normalized-unique" },
  ];

  let sawCandidate = false;
  for (const tier of tiers) {
    if (!tier.candidates.length) continue;
    sawCandidate = true;
    const matches = tier.candidates.filter(validate);
    if (matches.length === 1) return { variable: matches[0], matchMethod: tier.method };
    if (matches.length > 1) {
      return {
        reason: "ambiguous",
        detail: `${matches.length} compatible variables share this name`,
        candidates: matches.map((v) => ({ id: v.id, name: v.name })),
      };
    }
  }

  if (!sawCandidate) return { reason: "not-found", detail: `no variable named "${name}"` };
  if (failures.type) return { reason: "wrong-type", detail: `exists but is not ${resolvedType}` };
  if (failures.scope) {
    return {
      reason: "wrong-scope",
      detail: `exists but its scopes do not cover ${(allowedScopes || []).join(", ")}`,
    };
  }
  if (failures.collection) {
    return { reason: "not-found", detail: `exists but not in collection "${collectionName}"` };
  }
  return { reason: "not-found", detail: `no compatible variable named "${name}"` };
}

/**
 * Describe an alias without flattening it.
 *
 * A value of `→ colors/Base/Gray Main` has to stay an alias; reporting it as
 * `#525252` is what tempts a caller into binding the primitive, or worse into
 * pasting the hex. This resolves the chain for display only.
 */
function describeVariableValue(index, raw, depth) {
  if (raw && typeof raw === "object" && raw.type === "VARIABLE_ALIAS") {
    if (depth > 8) return { alias: true, name: "(alias chain too deep)" };
    const target = index.byId[raw.id];
    if (!target) return { alias: true, id: raw.id, name: "(alias target not in this file)" };
    return { alias: true, id: target.id, name: target.name };
  }
  if (raw && typeof raw === "object" && "r" in raw) {
    return { hex: paintToHex({ type: "SOLID", color: raw }) };
  }
  return { value: raw };
}

/** Serialise a variable for a tool response, aliases intact. */
function describeVariable(index, variable, options) {
  const opts = options || {};
  const collection = index.collectionById[variable.variableCollectionId];
  const out = {
    id: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType,
    scopes: variable.scopes || [],
    collectionId: variable.variableCollectionId,
    collectionName: collection ? collection.name : null,
  };
  if (variable.hiddenFromPublishing) out.hiddenFromPublishing = true;
  if (variable.codeSyntax && Object.keys(variable.codeSyntax).length) {
    out.codeSyntax = variable.codeSyntax;
  }
  if (opts.includeValues !== false && collection) {
    out.valuesByMode = {};
    for (const mode of collection.modes) {
      const raw = (variable.valuesByMode || {})[mode.modeId];
      if (raw === undefined) continue;
      out.valuesByMode[mode.name] = describeVariableValue(index, raw, 0);
    }
  }
  return out;
}

async function getVariables(params) {
  const {
    name,
    nameContains,
    resolvedType,
    collectionName,
    scope,
    includeValues,
    limit,
  } = params || {};

  const index = await buildVariableIndex();
  const max = typeof limit === "number" && limit > 0 ? limit : 200;

  // Unfiltered, a mature token file returns hundreds of variables with every
  // mode value attached. Filtering here is what keeps a token lookup usable.
  const needle = nameContains ? normalizeTokenName(nameContains) : null;
  const matches = index.all.filter((v) => {
    if (name && v.name !== name && normalizeTokenName(v.name) !== normalizeTokenName(name)) return false;
    if (needle && normalizeTokenName(v.name).indexOf(needle) === -1) return false;
    if (resolvedType && v.resolvedType !== resolvedType) return false;
    if (scope && !isScopeCompatible(v, [scope])) return false;
    if (collectionName) {
      const c = index.collectionById[v.variableCollectionId];
      if (!c || c.name !== collectionName) return false;
    }
    return true;
  });

  const collections = Object.keys(index.collectionById).map((id) => {
    const c = index.collectionById[id];
    return {
      id: c.id,
      name: c.name,
      modes: (c.modes || []).map((m) => ({ modeId: m.modeId, name: m.name })),
      variableCount: c.variableIds.length,
    };
  });

  return {
    collections,
    totalVariables: index.all.length,
    matchedVariables: matches.length,
    returned: Math.min(matches.length, max),
    truncated: matches.length > max,
    variables: matches.slice(0, max).map((v) => describeVariable(index, v, { includeValues })),
  };
}

/** Strict lookup exposed as its own command, so a caller can check before binding. */
async function findVariable(params) {
  const { name, resolvedType, collectionName, field } = params || {};
  if (!name) throw new Error("Missing name parameter");

  const index = await buildVariableIndex();
  const allowedScopes = field ? scopesForField(field) : undefined;
  const wantedType = resolvedType || (field ? typeForField(field) : undefined);

  const result = findCompatibleVariable(index, {
    name,
    resolvedType: wantedType,
    allowedScopes,
    collectionName,
  });

  if (result.variable) {
    return {
      found: true,
      matchMethod: result.matchMethod,
      variable: describeVariable(index, result.variable),
    };
  }
  return {
    found: false,
    reason: result.reason,
    detail: result.detail,
    candidates: result.candidates,
  };
}

/** Field → required type, understanding the paint/effect pseudo-fields. */
function typeForField(field) {
  if (/^(fills|strokes|effects)\/\d+\/color$/.test(field)) return "COLOR";
  return FIELD_RESOLVED_TYPE[field];
}

/** Field → acceptable scopes, understanding the paint/effect pseudo-fields. */
function scopesForField(field) {
  const paint = /^(fills|strokes|effects)\/\d+\/color$/.exec(field);
  if (paint) return PAINT_FIELD_SCOPES[paint[1]];
  return FIELD_SCOPES[field];
}

// Create or update a variable
async function setVariable(params) {
  const { collectionId, collectionName, name, resolvedType, value, modeId, createIfMissing } =
    params || {};

  if (!figma.variables) {
    throw new Error(
      "Variables API is not available. This feature requires Figma with Variables support."
    );
  }

  if (!name) {
    throw new Error("Missing name parameter");
  }
  if (!resolvedType) {
    throw new Error("Missing resolvedType parameter");
  }
  if (value === undefined || value === null) {
    throw new Error("Missing value parameter");
  }

  let collection;

  // Find or create collection
  if (collectionId) {
    collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection) {
      throw new Error(`Variable collection not found: ${collectionId}`);
    }
  } else if (collectionName) {
    // Search existing collections first
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    collection = collections.find(c => c.name === collectionName);
    if (!collection) {
      // Creating a collection silently is how a design system grows a second,
      // near-duplicate home for the same tokens.
      if (!createIfMissing) {
        throw new Error(
          `No collection named "${collectionName}". Existing collections: ` +
            collections.map((c) => c.name).join(", ") +
            ". Pass createIfMissing: true to add a new collection — but confirm with the " +
            "designer first, since this expands the design system."
        );
      }
      collection = figma.variables.createVariableCollection(collectionName);
    }
  } else {
    throw new Error("Either collectionId or collectionName must be provided");
  }

  // Find existing variable by name in collection, or create new one
  let variable = null;
  for (const varId of collection.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(varId);
    if (v && v.name === name) {
      variable = v;
      break;
    }
  }

  if (!variable) {
    if (!createIfMissing) {
      throw new Error(
        `No variable named "${name}" in "${collection.name}". Reuse an existing token if one ` +
          "fits, or pass createIfMissing: true to add it — a new token should be the designer's " +
          "call, not an automatic one."
      );
    }
    variable = figma.variables.createVariable(name, collection, resolvedType);
  }

  // Determine mode
  const targetModeId = modeId || collection.modes[0].modeId;

  // Attempt to parse value based on resolvedType if it's a string (MCP/WS serialization fix)
  let finalValue = value;
  if (typeof value === "string") {
    if (resolvedType === "FLOAT") {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) finalValue = parsed;
    } else if (resolvedType === "BOOLEAN") {
      if (value.toLowerCase() === "true") finalValue = true;
      if (value.toLowerCase() === "false") finalValue = false;
    } else if (resolvedType === "COLOR") {
      try {
        // Try to parse JSON if it's a stringified object
        if (value.startsWith("{")) {
          finalValue = JSON.parse(value);
        }
      } catch (e) {
        // Fallback to original value if parsing fails
      }
    }
  }

  // Validate value type matches resolvedType
  if (resolvedType === "COLOR") {
    if (typeof finalValue !== "object" || finalValue === null || finalValue.r === undefined) {
      throw new Error("Value does not match resolvedType. Expected COLOR object {r, g, b, a}, got " + typeof finalValue);
    }
  } else if (resolvedType === "FLOAT") {
    if (typeof finalValue !== "number") {
      throw new Error("Value does not match resolvedType. Expected FLOAT (number), got " + typeof finalValue);
    }
  } else if (resolvedType === "STRING") {
    if (typeof finalValue !== "string") {
      throw new Error("Value does not match resolvedType. Expected STRING, got " + typeof finalValue);
    }
  } else if (resolvedType === "BOOLEAN") {
    if (typeof finalValue !== "boolean") {
      throw new Error("Value does not match resolvedType. Expected BOOLEAN, got " + typeof finalValue);
    }
  }

  // Set value for mode
  variable.setValueForMode(targetModeId, finalValue);

  return {
    variableId: variable.id,
    variableName: variable.name,
    collectionId: collection.id,
    collectionName: collection.name,
    resolvedType: variable.resolvedType,
    value: finalValue
  };
}

// Apply a variable binding to a node property
/**
 * Bind one variable to one node property.
 *
 * Accepts a variable NAME as well as an id: the name is what a token spec
 * actually gives you, and forcing a caller to list every variable first to
 * translate a name into an id is the friction that ends with someone pasting a
 * hex value instead. The name is resolved through the strict matcher, so an
 * ambiguous or wrong-typed name is refused rather than guessed.
 */
async function bindVariableToNode(node, variable, field) {
  if (!("setBoundVariable" in node)) {
    throw new Error(`Node type ${node.type} does not support variable bindings`);
  }

  const paintMatch = /^(fills|strokes|effects)\/(\d+)\/color$/.exec(field);
  if (!paintMatch) {
    node.setBoundVariable(field, variable);
    return;
  }

  const prop = paintMatch[1];
  const idx = parseInt(paintMatch[2], 10);

  if (!(prop in node)) {
    throw new Error(`Node does not have a ${prop} property`);
  }
  // A mixed value means the property differs across the node's content; writing
  // a whole new array would flatten those differences away.
  if (node[prop] === figma.mixed) {
    throw new Error(`${prop} is mixed on "${node.name}" — bind on a single-value node instead`);
  }

  const list = [...node[prop]];
  if (idx >= list.length) {
    throw new Error(`${prop} index ${idx} out of range (node has ${list.length})`);
  }

  if (prop === "effects") {
    const effect = list[idx];
    if (!effect || !("color" in effect)) {
      throw new Error(`effects[${idx}] on "${node.name}" has no colour to bind`);
    }
    if (typeof figma.variables.setBoundVariableForEffect !== "function") {
      throw new Error(
        "This Figma version cannot bind variables to effect colours. Use an effect style instead."
      );
    }
    list[idx] = figma.variables.setBoundVariableForEffect(
      Object.assign({}, effect),
      "color",
      variable
    );
    node.effects = list;
    return;
  }

  const paint = list[idx];
  if (!paint || paint.type !== "SOLID") {
    throw new Error(
      `${prop}[${idx}] on "${node.name}" is ${paint ? paint.type : "empty"}, not SOLID — ` +
        "only a solid paint can carry a colour variable"
    );
  }
  if (typeof figma.variables.setBoundVariableForPaint === "function") {
    list[idx] = figma.variables.setBoundVariableForPaint(
      Object.assign({}, paint),
      "color",
      variable
    );
  } else {
    // Older API: write the alias onto a copy of the paint by hand. Same result,
    // but the official helper is preferred because it validates the paint type.
    const copy = Object.assign({}, paint);
    copy.boundVariables = Object.assign({}, copy.boundVariables || {});
    copy.boundVariables.color = { type: "VARIABLE_ALIAS", id: variable.id };
    list[idx] = copy;
  }
  node[prop] = list;
}

async function applyVariableToNode(params) {
  const {
    nodeId,
    variableId,
    variableName,
    field,
    collectionName,
    requireScopeMatch,
  } = params || {};

  if (!figma.variables) {
    throw new Error(
      "Variables API is not available. This feature requires Figma with Variables support."
    );
  }

  if (!nodeId) throw new Error("Missing nodeId parameter");
  if (!field) throw new Error("Missing field parameter");
  if (!variableId && !variableName) {
    throw new Error("Provide either variableId or variableName");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const index = await buildVariableIndex();
  const wantedType = typeForField(field);
  const allowedScopes = scopesForField(field);

  let variable = null;
  let matchMethod = "id";

  if (variableId) {
    variable = index.byId[variableId] || (await figma.variables.getVariableByIdAsync(variableId));
    if (!variable) throw new Error(`Variable not found with ID: ${variableId}`);
  } else {
    const result = findCompatibleVariable(index, {
      name: variableName,
      resolvedType: wantedType,
      // Scope is advisory by default: plenty of real files use ALL_SCOPES or
      // leave scopes unset, and refusing those would push callers back to
      // hardcoded values. requireScopeMatch makes it a hard gate.
      allowedScopes: requireScopeMatch ? allowedScopes : undefined,
      collectionName,
    });
    if (!result.variable) {
      const err = new Error(
        `No variable bound for ${field}: "${variableName}" — ${result.reason} (${result.detail}). ` +
          "Apply the exact value manually and report it as not token-connected, rather than " +
          "binding a similar token."
      );
      err.tokenReason = result.reason;
      err.candidates = result.candidates;
      throw err;
    }
    variable = result.variable;
    matchMethod = result.matchMethod;
  }

  // Type is a hard gate however the variable was found: binding a COLOR to
  // itemSpacing throws deep inside Figma with a message that says nothing.
  if (wantedType && variable.resolvedType !== wantedType) {
    throw new Error(
      `"${variable.name}" is ${variable.resolvedType}, but ${field} needs ${wantedType}`
    );
  }

  const scopeOk = isScopeCompatible(variable, allowedScopes);
  if (requireScopeMatch && !scopeOk) {
    throw new Error(
      `"${variable.name}" has scopes [${(variable.scopes || []).join(", ")}], which do not cover ` +
        `${field} (expects ${(allowedScopes || []).join(", ")})`
    );
  }

  await bindVariableToNode(node, variable, field);

  const collection = index.collectionById[variable.variableCollectionId];
  return {
    nodeId: node.id,
    nodeName: node.name,
    variableId: variable.id,
    variableName: variable.name,
    field: field,
    matchMethod,
    collectionName: collection ? collection.name : null,
    resolvedType: variable.resolvedType,
    scopeMatch: scopeOk,
    warning: scopeOk
      ? undefined
      : `bound anyway: "${variable.name}" is not scoped for ${field}`,
  };
}

/**
 * Bind many properties in one pass, reporting what bound and what did not.
 *
 * The report is the point. A silent partial failure is how a layout ends up
 * half token-connected, and nobody notices until a token changes and only some
 * of the layers move.
 */
async function applyVariableBindings(params) {
  const { bindings, requireScopeMatch, collectionName } = params || {};

  if (!Array.isArray(bindings) || !bindings.length) {
    throw new Error("Missing bindings parameter (expected a non-empty array)");
  }

  const index = await buildVariableIndex();
  const bound = [];
  const unbound = [];
  const errors = [];

  for (const entry of bindings) {
    const { nodeId, field, variableName, variableId } = entry || {};
    try {
      if (!nodeId || !field) throw new Error("each binding needs nodeId and field");

      const node = await getNodeByIdSafe(nodeId);
      if (!node) throw new Error(`node not found: ${nodeId}`);

      const wantedType = typeForField(field);
      const allowedScopes = scopesForField(field);

      let variable = null;
      let matchMethod = "id";
      if (variableId) {
        variable = index.byId[variableId];
        if (!variable) throw new Error(`variable not found: ${variableId}`);
      } else {
        const result = findCompatibleVariable(index, {
          name: variableName,
          resolvedType: wantedType,
          allowedScopes: requireScopeMatch ? allowedScopes : undefined,
          collectionName: entry.collectionName || collectionName,
        });
        if (!result.variable) {
          // Not an error: a token genuinely may not exist. It is recorded so the
          // value can be applied by hand and flagged as not token-connected.
          unbound.push({
            nodeId,
            nodeName: node.name,
            property: field,
            requestedTokenName: variableName,
            reason: result.reason,
            detail: result.detail,
            candidates: result.candidates,
          });
          continue;
        }
        variable = result.variable;
        matchMethod = result.matchMethod;
      }

      if (wantedType && variable.resolvedType !== wantedType) {
        unbound.push({
          nodeId,
          nodeName: node.name,
          property: field,
          requestedTokenName: variableName || variableId,
          reason: "wrong-type",
          detail: `${variable.name} is ${variable.resolvedType}, ${field} needs ${wantedType}`,
        });
        continue;
      }

      await bindVariableToNode(node, variable, field);
      const collection = index.collectionById[variable.variableCollectionId];
      bound.push({
        nodeId,
        nodeName: node.name,
        property: field,
        variableId: variable.id,
        variableName: variable.name,
        collectionName: collection ? collection.name : null,
        matchMethod,
      });
    } catch (e) {
      errors.push({
        nodeId: nodeId || null,
        property: field || null,
        message: e && e.message ? e.message : String(e),
      });
    }
  }

  return {
    checked: bindings.length,
    boundCount: bound.length,
    unboundCount: unbound.length,
    errorCount: errors.length,
    bound,
    unbound,
    errors,
  };
}

/** Report which of a node's properties carry a variable and which are raw values. */
async function getNodeVariableBindings(params) {
  const { nodeId } = params || {};
  if (!nodeId) throw new Error("Missing nodeId parameter");

  const node = await getNodeByIdSafe(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);

  const index = await buildVariableIndex();
  const describe = (ref) => {
    if (!ref || !ref.id) return null;
    const v = index.byId[ref.id];
    if (!v) return { variableId: ref.id, variableName: "(not in this file)" };
    const c = index.collectionById[v.variableCollectionId];
    return {
      variableId: v.id,
      variableName: v.name,
      collectionName: c ? c.name : null,
      resolvedType: v.resolvedType,
    };
  };

  const bound = {};
  const raw = node.boundVariables || {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (Array.isArray(value)) {
      bound[key] = value.map(describe);
    } else {
      bound[key] = describe(value);
    }
  }

  // Which of the properties this node actually has are still raw values.
  const unbound = [];
  const candidateFields = Object.keys(FIELD_RESOLVED_TYPE);
  for (const f of candidateFields) {
    if (!(f in node)) continue;
    if (bound[f]) continue;
    const current = node[f];
    if (current === undefined || current === null || current === figma.mixed) continue;
    unbound.push({ property: f, value: typeof current === "object" ? "(object)" : current });
  }

  const modes = [];
  if (node.explicitVariableModes) {
    for (const collectionId of Object.keys(node.explicitVariableModes)) {
      const c = index.collectionById[collectionId];
      const modeId = node.explicitVariableModes[collectionId];
      const mode = c && (c.modes || []).find((m) => m.modeId === modeId);
      modes.push({
        collectionId,
        collectionName: c ? c.name : null,
        modeId,
        modeName: mode ? mode.name : null,
      });
    }
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    explicitModes: modes,
    boundProperties: bound,
    unboundProperties: unbound,
  };
}

// Switch variable mode on a node for a collection
/**
 * Pick the breakpoint mode a frame of this width is designed at.
 *
 * The thresholds sit between the reference widths rather than on them, so a
 * 1024-wide frame reads as desktop and a 375-wide frame reads as mobile. Mode
 * names describe reference designs, not CSS media-query boundaries.
 */
function modeForWidth(collection, width, thresholds) {
  const t = thresholds || {};
  const desk = typeof t.desktopMin === "number" ? t.desktopMin : 1024;
  const tablet = typeof t.tabletMin === "number" ? t.tabletMin : 600;

  const wanted = width >= desk ? ["desk", "desktop", "1440", "1280"]
    : width >= tablet ? ["tab", "tablet", "768", "1024"]
    : ["mobi", "mobile", "320", "390"];

  for (const mode of collection.modes || []) {
    const name = (mode.name || "").toLowerCase().trim();
    if (wanted.some((w) => name === w || name.indexOf(w) === 0 || /^\d+$/.test(w) && name.includes(w))) {
      return mode;
    }
  }
  return null;
}

/**
 * Apply the target breakpoint mode to collections used by a generated frame.
 * Non-responsive collections (for example Light/Dark themes) are deliberately
 * left alone; only collections advertising breakpoint-like modes participate.
 */
async function applyBreakpointVariableModes(node, width, collections) {
  const result = { applied: [], warnings: [] };
  if (
    !node ||
    !("setExplicitVariableModeForCollection" in node) ||
    !figma.variables ||
    typeof figma.variables.getVariableCollectionByIdAsync !== "function"
  ) {
    return result;
  }

  for (const summary of collections || []) {
    const hasResponsiveModes = (summary.modes || []).some((m) =>
      /\b(desk(?:top)?|tab(?:let)?|mobi(?:le)?|1440|1280|1024|768|390|320)\b/i.test(
        m.name || ""
      )
    );
    if (!hasResponsiveModes) continue;

    const collection = await figma.variables.getVariableCollectionByIdAsync(summary.id);
    if (!collection) {
      result.warnings.push(`Variable collection "${summary.name}" could not be loaded.`);
      continue;
    }

    const mode = modeForWidth(collection, width);
    if (!mode) {
      result.warnings.push(
        `Variable collection "${collection.name}" has responsive modes but none matches ` +
          `${Math.round(width)}px. Its inherited mode was left unchanged.`
      );
      continue;
    }

    try {
      node.setExplicitVariableModeForCollection(collection, mode.modeId);
      result.applied.push({
        collectionId: collection.id,
        collectionName: collection.name,
        modeId: mode.modeId,
        modeName: mode.name,
      });
    } catch (error) {
      result.warnings.push(
        `Could not apply mode "${mode.name}" from "${collection.name}" to ` +
          `"${node.name}": ${error && error.message ? error.message : String(error)}`
      );
    }
  }

  return result;
}

/**
 * Freeze each protected absolute subtree to the variable modes it resolved
 * immediately after the desktop clone. The responsive root can then switch to
 * Tab/Mobi without changing the copied absolute layer's desktop appearance.
 */
async function preserveAbsoluteVariableModes(root, collections) {
  const preserved = [];
  for (const layer of collectAbsolutePositionedLayers(root, false)) {
    if (!("setExplicitVariableModeForCollection" in layer)) continue;
    let resolved = {};
    try {
      resolved = layer.resolvedVariableModes || layer.explicitVariableModes || {};
    } catch (e) {
      resolved = layer.explicitVariableModes || {};
    }

    for (const summary of collections || []) {
      const modeId = resolved[summary.id];
      if (!modeId) continue;
      const collection = await figma.variables.getVariableCollectionByIdAsync(summary.id);
      if (!collection) continue;
      try {
        layer.setExplicitVariableModeForCollection(collection, modeId);
        const mode = (collection.modes || []).find((candidate) => candidate.modeId === modeId);
        preserved.push({
          nodeId: layer.id,
          nodeName: layer.name,
          collectionId: collection.id,
          collectionName: collection.name,
          modeId,
          modeName: mode ? mode.name : null,
        });
      } catch (e) {
        // The subtree is still left untouched; report only modes we could pin.
      }
    }
  }
  return preserved;
}

/** Nearest ancestor frame whose width tells us which breakpoint we are in. */
function nearestFrameWidth(node) {
  let current = node;
  let depth = 0;
  while (current && depth < 30) {
    if ((current.type === "FRAME" || current.type === "COMPONENT") && current.width > 0) {
      return current.width;
    }
    current = current.parent;
    depth++;
  }
  return null;
}

async function switchVariableMode(params) {
  const { nodeId, collectionId, collectionName, modeId, modeName, thresholds } = params || {};

  if (!figma.variables) {
    throw new Error(
      "Variables API is not available. This feature requires Figma with Variables support."
    );
  }

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!collectionId && !collectionName) {
    throw new Error("Provide either collectionId or collectionName");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("setExplicitVariableModeForCollection" in node)) {
    throw new Error(`Node type ${node.type} does not support variable mode switching`);
  }

  let collection = null;
  if (collectionId) {
    collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection) throw new Error(`Variable collection not found: ${collectionId}`);
  } else {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const lower = collectionName.toLowerCase();
    collection =
      collections.find((c) => c.name === collectionName) ||
      collections.find((c) => c.name.toLowerCase() === lower);
    if (!collection) {
      throw new Error(
        `No collection named "${collectionName}". This file has: ` +
          collections.map((c) => c.name).join(", ")
      );
    }
  }

  let mode = null;
  let selectedBy = "modeId";

  if (modeId) {
    mode = (collection.modes || []).find((m) => m.modeId === modeId);
    if (!mode) throw new Error(`Mode not found with ID: ${modeId} in "${collection.name}"`);
  } else if (modeName && modeName.toLowerCase() !== "auto") {
    // Mode names carry their reference width in practice — "Desk (1440 px)",
    // not "Desk" — while everything else in the system, the token docs
    // included, says Desk / Tab / Mobi. Accept the short name, but only when it
    // singles out one mode: two modes starting with the same word is a question
    // for the caller, not something to resolve by picking the first.
    const modes = collection.modes || [];
    const lower = modeName.toLowerCase().trim();
    const prefixed = modes.filter((m) => (m.name || "").toLowerCase().trim().indexOf(lower) === 0);

    mode =
      modes.find((m) => m.name === modeName) ||
      modes.find((m) => (m.name || "").toLowerCase().trim() === lower) ||
      (prefixed.length === 1 ? prefixed[0] : null);

    if (!mode) {
      throw new Error(
        prefixed.length > 1
          ? `"${modeName}" matches ${prefixed.length} modes in "${collection.name}" (` +
            prefixed.map((m) => m.name).join(", ") +
            "). Name the mode exactly."
          : `No mode named "${modeName}" in "${collection.name}". Modes are: ` +
            modes.map((m) => m.name).join(", ")
      );
    }
    selectedBy = mode.name === modeName ? "modeName" : `modeName (matched "${mode.name}")`;
  } else {
    // Auto: infer the breakpoint from the frame this node sits in.
    const width = nearestFrameWidth(node);
    if (width === null) {
      throw new Error(
        "Could not infer a mode: no ancestor frame has a width. Pass modeName or modeId."
      );
    }
    mode = modeForWidth(collection, width, thresholds);
    if (!mode) {
      throw new Error(
        `No mode in "${collection.name}" matches a ${Math.round(width)}px frame. ` +
          `Modes are: ${(collection.modes || []).map((m) => m.name).join(", ")}. Pass modeName instead.`
      );
    }
    selectedBy = `auto (${Math.round(width)}px frame)`;
  }

  node.setExplicitVariableModeForCollection(collection, mode.modeId);

  return {
    nodeId: node.id,
    nodeName: node.name,
    collectionId: collection.id,
    collectionName: collection.name,
    modeId: mode.modeId,
    modeName: mode.name,
    selectedBy,
  };
}

/**
 * Import a variable from an enabled team library into this file.
 *
 * Without this, a token that lives only in a shared library has no route into
 * the file except creating a local duplicate — which is how two variables named
 * the same thing end up drifting apart.
 */
async function importLibraryVariable(params) {
  const { key, name, libraryCollectionKey } = params || {};

  if (!figma.variables) {
    throw new Error("Variables API is not available.");
  }
  if (!key && !name) {
    throw new Error("Provide either key (the library variable key) or name");
  }

  if (key) {
    const imported = await figma.variables.importVariableByKeyAsync(key);
    const index = await buildVariableIndex();
    return { imported: true, variable: describeVariable(index, imported) };
  }

  if (!figma.teamLibrary) {
    throw new Error(
      "Team library API is unavailable. Pass the variable key directly, or enable the library " +
        "for this file."
    );
  }

  const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  const searchIn = libraryCollectionKey
    ? collections.filter((c) => c.key === libraryCollectionKey)
    : collections;

  if (!searchIn.length) {
    throw new Error(
      libraryCollectionKey
        ? `No enabled library collection with key ${libraryCollectionKey}`
        : "No library variable collections are enabled for this file"
    );
  }

  const normalized = normalizeTokenName(name);
  const hits = [];
  for (const collection of searchIn) {
    const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(collection.key);
    for (const v of vars) {
      if (v.name === name || normalizeTokenName(v.name) === normalized) {
        hits.push({ variable: v, collection });
      }
    }
  }

  if (!hits.length) {
    throw new Error(`No library variable named "${name}" in the enabled libraries`);
  }
  if (hits.length > 1) {
    throw new Error(
      `"${name}" matches ${hits.length} library variables (` +
        hits.map((h) => `${h.collection.name}/${h.variable.name}`).join(", ") +
        "). Pass libraryCollectionKey to disambiguate."
    );
  }

  const imported = await figma.variables.importVariableByKeyAsync(hits[0].variable.key);
  const index = await buildVariableIndex();
  return {
    imported: true,
    fromLibrary: hits[0].collection.name,
    variable: describeVariable(index, imported),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FigJam-specific command implementations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a colour name to an RGBA fill paint object.
 * These match the default colour palette shown in FigJam.
 */
function stickyColorToFill(color) {
  // Values stored as arrays to avoid passing const-object references into
  // Figma's paint normaliser, which may try to extend the color object and
  // throw "object is not extensible" in the plugin sandbox.
  // Values sampled from native FigJam stickies via the plugin API.
  var palette = {
    yellow:  [1.000, 0.886, 0.600],
    pink:    [1.000, 0.659, 0.859],
    green:   [0.702, 0.937, 0.741],
    blue:    [0.659, 0.855, 1.000],
    purple:  [0.827, 0.741, 1.000],
    red:     [1.000, 0.686, 0.639],
    orange:  [1.000, 0.827, 0.659],
    teal:    [0.702, 0.957, 0.937],
    gray:    [0.902, 0.902, 0.902],
    white:   [1.000, 1.000, 1.000],
  };

  var rgb = palette[color] || palette["yellow"];
  // Always construct a fresh color object so Figma can freely extend it.
  return [{ type: "SOLID", color: { r: rgb[0], g: rgb[1], b: rgb[2] }, opacity: 1, visible: true, blendMode: "NORMAL" }];
}

/**
 * Collect all FigJam-specific nodes on the current page.
 * Walks the full node tree and returns stickies, connectors,
 * shapes-with-text, sections and stamps.
 */
async function getFigJamElements() {
  await figma.currentPage.loadAsync();

  const figjamTypes = new Set(["STICKY", "CONNECTOR", "SHAPE_WITH_TEXT", "SECTION", "STAMP"]);
  const results = { stickies: [], connectors: [], shapesWithText: [], sections: [], stamps: [] };

  function walk(node) {
    if (figjamTypes.has(node.type)) {
      const base = { id: node.id, name: node.name, type: node.type, x: node.x, y: node.y };

      switch (node.type) {
        case "STICKY":
          results.stickies.push(Object.assign({}, base, {
            width: node.width,
            height: node.height,
            text: node.text ? node.text.characters : "",
            fills: node.fills,
            isWide: node.isWide,
            authorName: node.authorName,
          }));
          break;

        case "CONNECTOR":
          results.connectors.push(Object.assign({}, base, {
            connectorStart: node.connectorStart,
            connectorEnd: node.connectorEnd,
            connectorLineType: node.connectorLineType,
            connectorStartStrokeCap: node.connectorStartStrokeCap,
            connectorEndStrokeCap: node.connectorEndStrokeCap,
            strokeWeight: node.strokeWeight,
            strokes: node.strokes,
          }));
          break;

        case "SHAPE_WITH_TEXT":
          results.shapesWithText.push(Object.assign({}, base, {
            width: node.width,
            height: node.height,
            shapeType: node.shapeType,
            text: node.text ? node.text.characters : "",
            fills: node.fills,
          }));
          break;

        case "SECTION":
          results.sections.push(Object.assign({}, base, {
            width: node.width,
            height: node.height,
            fills: node.fills,
            childCount: "children" in node ? node.children.length : 0,
          }));
          break;

        case "STAMP":
          results.stamps.push(Object.assign({}, base, {
            width: node.width,
            height: node.height,
            authorName: node.authorName,
          }));
          break;
      }
    }

    // Recurse into children (sections, frames, groups, etc.)
    if ("children" in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  for (const child of figma.currentPage.children) {
    walk(child);
  }

  return {
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name,
    totalElements:
      results.stickies.length +
      results.connectors.length +
      results.shapesWithText.length +
      results.sections.length +
      results.stamps.length,
    stickies: results.stickies,
    connectors: results.connectors,
    shapesWithText: results.shapesWithText,
    sections: results.sections,
    stamps: results.stamps,
  };
}

/**
 * Create a sticky note in FigJam.
 */
async function createSticky(params) {
  const {
    x = 0,
    y = 0,
    text = "",
    color = "yellow",
    isWide = false,
    name,
    parentId,
  } = params || {};

  if (!figma.createSticky) {
    throw new Error("createSticky is not available. This command requires a FigJam document.");
  }

  const sticky = figma.createSticky();
  // figma.createSticky() auto-appends to figma.currentPage — no explicit
  // appendChild needed for the default case.  If a specific parent was
  // requested, move the sticky into it (this re-parents, not double-appends).
  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error("Parent node not found with ID: " + parentId);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error("Parent node does not support children: " + parentId);
    }
    parentNode.appendChild(sticky);
  }

  try {
    sticky.x = x;
    sticky.y = y;
    try { sticky.isWide = isWide; } catch (e) { /* isWide may not be settable in all FigJam versions */ }
    if (name) { sticky.name = name; }
    try {
      // Prefer the native NodeColor API (uses FigJam's exact palette colours).
      // Fall back to manual fills if the property isn't settable.
      sticky.color = color.toUpperCase();
    } catch (e) {
      try {
        sticky.fills = stickyColorToFill(color);
      } catch (fillErr) {
        console.warn("create_sticky: could not apply color '" + color + "':", fillErr);
      }
    }
    if (text) {
      await figma.loadFontAsync(sticky.text.fontName);
      sticky.text.characters = text;
    }
  } catch (propErr) {
    throw new Error("create_sticky failed: " + propErr.message);
  }

  var resultFills;
  try { resultFills = sticky.fills; } catch (e) { resultFills = []; }

  return {
    id: sticky.id,
    name: sticky.name,
    type: sticky.type,
    x: sticky.x,
    y: sticky.y,
    width: sticky.width,
    height: sticky.height,
    text: sticky.text ? sticky.text.characters : "",
    isWide: sticky.isWide,
    fills: resultFills,
    parentId: sticky.parent ? sticky.parent.id : undefined,
  };
}

/**
 * Update the text on an existing sticky note.
 */
async function setStickyText(params) {
  const { nodeId, text } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (text === undefined || text === null) {
    throw new Error("Missing text parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (node.type !== "STICKY") {
    throw new Error(`Node ${nodeId} is not a sticky note (type: ${node.type})`);
  }

  await figma.loadFontAsync(node.text.fontName);
  node.text.characters = text;

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    text: node.text.characters,
  };
}

/**
 * Create a FigJam shape with text.
 */
async function createShapeWithText(params) {
  const {
    x = 0,
    y = 0,
    width = 200,
    height = 200,
    shapeType = "ROUNDED_RECTANGLE",
    text = "",
    fillColor,
    name,
    parentId,
  } = params || {};

  if (!figma.createShapeWithText) {
    throw new Error("createShapeWithText is not available. This command requires a FigJam document.");
  }

  const shape = figma.createShapeWithText();
  shape.x = x;
  shape.y = y;
  shape.resize(width, height);
  shape.shapeType = shapeType;

  if (name) {
    shape.name = name;
  }

  // Set fill color if provided
  if (fillColor) {
    shape.fills = [
      {
        type: "SOLID",
        color: {
          r: parseFloat(fillColor.r) || 0,
          g: parseFloat(fillColor.g) || 0,
          b: parseFloat(fillColor.b) || 0,
        },
        opacity: fillColor.a !== undefined ? parseFloat(fillColor.a) : 1,
      },
    ];
  }

  // Set text via the text sub-layer
  if (text) {
    await figma.loadFontAsync(shape.text.fontName);
    shape.text.characters = text;
  }

  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(shape);
  } else {
    figma.currentPage.appendChild(shape);
  }

  return {
    id: shape.id,
    name: shape.name,
    type: shape.type,
    shapeType: shape.shapeType,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    text: shape.text.characters,
    fills: shape.fills,
    parentId: shape.parent ? shape.parent.id : undefined,
  };
}

/**
 * Create a connector (arrow/line) between two nodes or canvas positions.
 *
 * The Figma plugin API requires connectorStart / connectorEnd to be one of:
 *   - { endpointNodeId, magnet } when connecting to an existing node
 *   - { position: { x, y } }   when connecting to a canvas position
 */
async function createConnector(params) {
  const {
    startNodeId,
    startX,
    startY,
    endNodeId,
    endX,
    endY,
    connectorLineType = "ELBOWED",
    startStrokeCap = "NONE",
    endStrokeCap = "ARROW",
    strokeColor,
    strokeWeight,
    name,
    parentId,
  } = params || {};

  if (!figma.createConnector) {
    throw new Error("createConnector is not available. This command requires a FigJam document.");
  }

  const connector = figma.createConnector();

  // ── Start endpoint ────────────────────────────────────────────────────────
  if (startNodeId) {
    const startNode = await getNodeByIdSafe(startNodeId);
    if (!startNode) {
      throw new Error(`Start node not found with ID: ${startNodeId}`);
    }
    connector.connectorStart = { endpointNodeId: startNodeId, magnet: "AUTO" };
  } else if (startX !== undefined && startY !== undefined) {
    connector.connectorStart = { position: { x: startX, y: startY } };
  } else {
    throw new Error("Either startNodeId or both startX and startY must be provided");
  }

  // ── End endpoint ──────────────────────────────────────────────────────────
  if (endNodeId) {
    const endNode = await getNodeByIdSafe(endNodeId);
    if (!endNode) {
      throw new Error(`End node not found with ID: ${endNodeId}`);
    }
    connector.connectorEnd = { endpointNodeId: endNodeId, magnet: "AUTO" };
  } else if (endX !== undefined && endY !== undefined) {
    connector.connectorEnd = { position: { x: endX, y: endY } };
  } else {
    throw new Error("Either endNodeId or both endX and endY must be provided");
  }

  connector.connectorLineType = connectorLineType;
  connector.connectorStartStrokeCap = startStrokeCap;
  connector.connectorEndStrokeCap = endStrokeCap;

  if (strokeColor) {
    connector.strokes = [
      {
        type: "SOLID",
        color: {
          r: parseFloat(strokeColor.r) || 0,
          g: parseFloat(strokeColor.g) || 0,
          b: parseFloat(strokeColor.b) || 0,
        },
        opacity: strokeColor.a !== undefined ? parseFloat(strokeColor.a) : 1,
      },
    ];
  }

  if (strokeWeight !== undefined) {
    connector.strokeWeight = strokeWeight;
  }

  if (name) {
    connector.name = name;
  }

  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error("Parent node not found with ID: " + parentId);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error("Parent node does not support children: " + parentId);
    }
    parentNode.appendChild(connector);
  } else {
    figma.currentPage.appendChild(connector);
  }

  return {
    id: connector.id,
    name: connector.name,
    type: connector.type,
    connectorStart: connector.connectorStart,
    connectorEnd: connector.connectorEnd,
    connectorLineType: connector.connectorLineType,
    connectorStartStrokeCap: connector.connectorStartStrokeCap,
    connectorEndStrokeCap: connector.connectorEndStrokeCap,
    strokeWeight: connector.strokeWeight,
    strokes: connector.strokes,
  };
}

/**
 * Create a FigJam section.
 */
async function createSection(params) {
  const {
    x = 0,
    y = 0,
    width = 800,
    height = 600,
    name = "Section",
    fillColor,
    parentId,
  } = params || {};

  if (!figma.createSection) {
    throw new Error("createSection is not available. This command requires a FigJam document.");
  }

  const section = figma.createSection();
  section.x = x;
  section.y = y;
  section.resizeWithoutConstraints(width, height);
  section.name = name;

  if (fillColor) {
    section.fills = [
      {
        type: "SOLID",
        color: {
          r: parseFloat(fillColor.r) || 0,
          g: parseFloat(fillColor.g) || 0,
          b: parseFloat(fillColor.b) || 0,
        },
        opacity: fillColor.a !== undefined ? parseFloat(fillColor.a) : 1,
      },
    ];
  }

  if (parentId) {
    const parentNode = await getNodeByIdSafe(parentId);
    if (!parentNode) {
      throw new Error("Parent node not found with ID: " + parentId);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error("Parent node does not support children: " + parentId);
    }
    parentNode.appendChild(section);
  } else {
    figma.currentPage.appendChild(section);
  }

  return {
    id: section.id,
    name: section.name,
    type: section.type,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
    fills: section.fills,
  };
}

// Set prototype reactions (interactions) on a node
async function setReactions(params) {
  if (!params || !params.nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!params.reactions || !Array.isArray(params.reactions)) {
    throw new Error("Missing or invalid reactions parameter");
  }

  const node = await getNodeByIdSafe(params.nodeId);
  if (!node) {
    throw new Error(`Node not found: ${params.nodeId}`);
  }

  // Set overlayPositionType on destination nodes for OVERLAY actions
  const overlayDebug = [];
  for (const r of params.reactions) {
    if (r.actions && Array.isArray(r.actions)) {
      for (const a of r.actions) {
        if (a.type === "NODE" && a.navigation === "OVERLAY" && a.destinationId) {
          try {
            const destNode = await figma.getNodeByIdAsync(a.destinationId);
            const info = { destId: a.destinationId, type: destNode ? destNode.type : "not found" };
            if (destNode) {
              // For instances, set overlay properties on the main component
              let targetNode = destNode;
              if (destNode.type === "INSTANCE") {
                const mainComp = await destNode.getMainComponentAsync();
                if (mainComp) {
                  targetNode = mainComp;
                  info.usingMainComponent = targetNode.id;
                }
              }
              info.targetType = targetNode.type;
              info.hasOverlayPositionType = "overlayPositionType" in targetNode;
              info.beforePositionType = targetNode.overlayPositionType;
              info.beforeBgInteraction = targetNode.overlayBackgroundInteraction;
              try {
                targetNode.overlayPositionType = a.overlayPositionType || "CENTER";
                info.afterPositionType = targetNode.overlayPositionType;
              } catch (e) {
                info.positionTypeError = e.message || String(e);
              }
              try {
                targetNode.overlayBackgroundInteraction = a.overlayBackgroundInteraction || "CLOSE_ON_CLICK_OUTSIDE";
                info.afterBgInteraction = targetNode.overlayBackgroundInteraction;
              } catch (e) {
                info.bgInteractionError = e.message || String(e);
              }
            }
            overlayDebug.push(info);
          } catch (e) {
            overlayDebug.push({ destId: a.destinationId, error: e.message || String(e) });
          }
        }
      }
    }
  }

  // Build reactions array for the Figma API
  const reactions = params.reactions.map((r) => {
    const reaction = {};

    // Set trigger
    if (r.trigger) {
      reaction.trigger = { type: r.trigger.type };
      if (r.trigger.delay !== undefined) {
        reaction.trigger.delay = r.trigger.delay;
      }
    }

    // Build transition object helper
    const buildTransition = (t) => {
      if (!t) return null;
      return {
        type: t.type || "DISSOLVE",
        easing: t.easing || { type: "EASE_IN_AND_OUT" },
        duration: t.duration !== undefined ? t.duration : 0.2,
      };
    };

    // Set actions - support both "actions" (array, new API) and "action" (single, old API)
    if (r.actions && Array.isArray(r.actions)) {
      const mappedActions = r.actions.map((a) => {
        if (a.type === "NODE") {
          const nav = a.navigation || "NAVIGATE";
          const nodeAction = {
            type: "NODE",
            destinationId: a.destinationId || null,
            navigation: nav,
            transition: buildTransition(a.transition),
            preserveScrollPosition: a.preserveScrollPosition || false,
            resetVideoPosition: a.resetVideoPosition || false,
            resetScrollPosition: a.resetScrollPosition || false,
            resetInteractiveComponents: a.resetInteractiveComponents || false,
          };
          if (nav === "OVERLAY" && a.overlayRelativePosition) {
            nodeAction.overlayRelativePosition = a.overlayRelativePosition;
          }
          return nodeAction;
        } else if (a.type === "BACK") {
          return { type: "BACK", transition: buildTransition(a.transition) };
        } else if (a.type === "CLOSE") {
          return { type: "CLOSE" };
        } else if (a.type === "URL") {
          return { type: "URL", url: a.url || "" };
        }
        return { type: a.type };
      });

      reaction.actions = mappedActions;
    }

    return reaction;
  });

  // Debug: log the exact reactions being set
  const debugJson = JSON.stringify(reactions, null, 2);
  console.log("setReactionsAsync input:", debugJson);

  try {
    await node.setReactionsAsync(reactions);
  } catch (e) {
    // Try with singular "action" format (older Figma API)
    try {
      const reactionsOldFormat = reactions.map((r) => ({
        trigger: r.trigger,
        action: r.actions ? r.actions[0] : r.action,
      }));
      await node.setReactionsAsync(reactionsOldFormat);
    } catch (e2) {
      const errStr = e ? (e.message || e.toString() || JSON.stringify(e)) : "unknown";
      const errStr2 = e2 ? (e2.message || e2.toString() || JSON.stringify(e2)) : "unknown";
      throw new Error(`setReactionsAsync failed.\nNew API error: ${errStr}\nOld API error: ${errStr2}\nInput: ${debugJson}`);
    }
  }

  // Verify what was actually set by reading back
  const actualReactions = node.reactions;
  const actualCount = actualReactions ? actualReactions.length : 0;
  const actualJson = JSON.stringify(actualReactions, null, 2);

  return {
    id: node.id,
    name: node.name,
    reactionsCount: reactions.length,
    actualReactionsCount: actualCount,
    sentToFigma: debugJson,
    readBackFromFigma: actualJson,
    overlayDebug: overlayDebug.length > 0 ? overlayDebug : undefined,
    message: `Set ${reactions.length} reaction(s) on node "${node.name}" (verified: ${actualCount} persisted)`,
  };
}

async function getReactions(params) {
  if (!params || !params.nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  const node = await getNodeByIdSafe(params.nodeId);
  if (!node) {
    throw new Error(`Node not found: ${params.nodeId}`);
  }
  const reactions = node.reactions;
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    reactionsCount: reactions ? reactions.length : 0,
    reactions: reactions ? JSON.parse(JSON.stringify(reactions)) : [],
  };
}

/**
 * Detach a component instance
 */
async function detachInstance(params) {
  const { nodeId } = params || {};
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await getNodeByIdSafe(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "INSTANCE") {
    throw new Error(`Node with ID ${nodeId} is not a component INSTANCE`);
  }

  const detachedFrame = node.detachInstance();

  return {
    success: true,
    frameId: detachedFrame.id,
    frameName: detachedFrame.name,
    frameType: detachedFrame.type,
  };
}

/**
 * Create a reusable text style in Figma
 */
async function createTextStyle(params) {
  const {
    name,
    fontFamily,
    fontStyle = "Regular",
    fontSize,
    letterSpacing,
    letterSpacingUnit = "PIXELS",
    lineHeight,
    lineHeightUnit = "PIXELS",
    textCase = "ORIGINAL",
    textDecoration = "NONE",
  } = params || {};

  const style = figma.createTextStyle();
  style.name = name;

  // Load and apply font
  await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
  style.fontName = { family: fontFamily, style: fontStyle };
  style.fontSize = fontSize;

  if (letterSpacing !== undefined) {
    style.letterSpacing = { value: letterSpacing, unit: letterSpacingUnit };
  }

  if (lineHeight !== undefined) {
    if (lineHeightUnit === "AUTO") {
      style.lineHeight = { unit: "AUTO" };
    } else {
      style.lineHeight = { value: lineHeight, unit: lineHeightUnit };
    }
  }

  style.textCase = textCase;
  style.textDecoration = textDecoration;

  return { id: style.id, name: style.name, key: style.key };
}

/**
 * Create a reusable solid paint style in Figma
 */
async function createPaintStyle(params) {
  const { name, r, g, b, a = 1 } = params || {};

  const style = figma.createPaintStyle();
  style.name = name;
  style.paints = [
    {
      type: "SOLID",
      color: { r, g, b },
      opacity: a,
    },
  ];

  return { id: style.id, name: style.name, key: style.key };
}

/**
 * Bind Figma local variables (Layout, Gap, Radius, Responsive Text Container)
 * to all FRAME/COMPONENT/INSTANCE nodes in a subtree.
 *
 * This is a reusable function called by both fixTextSizing and generateBreakpoint
 * so that variables are bound consistently everywhere.
 *
 * Returns { bindings: [...], collections: [...] }
 */
async function bindVariablesToSubtree(root) {
  const result = { bindings: [], collections: [] };
  if (!figma.variables || !figma.variables.getLocalVariableCollectionsAsync) return result;

  let tokenIndex;
  try {
    tokenIndex = await buildVariableIndex();
  } catch (e) {
    return result;
  }

  // Categorize variables by path prefix
  const layoutVars = {};
  const gapVars = {};
  const radiusVars = {};
  const textContainerVars = {};
  const seen = Object.create(null);

  for (const v of tokenIndex.all) {
    const path = (v.name || "").toLowerCase();
    const bucket = path.indexOf("layout/") === 0 ? layoutVars
      : path.indexOf("gap/") === 0 ? gapVars
      : path.indexOf("radius/") === 0 ? radiusVars
      : path.indexOf("responsive text container/") === 0 ? textContainerVars
      : null;
    if (!bucket) continue;

    bucket[v.name] = v;
    const col = tokenIndex.collectionById[v.variableCollectionId];
    if (col && !seen[col.id]) {
      seen[col.id] = true;
      result.collections.push({ id: col.id, name: col.name, modes: col.modes });
    }
  }

  const hasVars = Object.keys(layoutVars).length > 0 ||
                  Object.keys(textContainerVars).length > 0 ||
                  Object.keys(gapVars).length > 0 ||
                  Object.keys(radiusVars).length > 0;
  if (!hasVars) return result;

  // Resolve one token by exact path
  const resolveToken = (bucket, candidatePaths, field) => {
    const wantedType = field ? typeForField(field) : "FLOAT";
    for (const path of candidatePaths) {
      const direct = bucket[path];
      if (direct && direct.resolvedType === wantedType) return direct;
      const hit = findCompatibleVariable(tokenIndex, { name: path, resolvedType: wantedType });
      if (hit.variable) return hit.variable;
    }
    return null;
  };

  // Collect all frames
  const allFrames = [];
  function collectFrames(node) {
    if (!node || node.removed) return;
    if (isAbsolutePositionedLayer(node)) return;
    if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") {
      allFrames.push(node);
    }
    if ("children" in node) {
      for (const child of node.children) collectFrames(child);
    }
  }
  collectFrames(root);

  const layoutSubGroups = ["Default", "Compact", "Inner", "Full Width", "All Locations"];
  function guessLayoutGroup(frame) {
    let node = frame;
    while (node) {
      const name = (node.name || "").toLowerCase();
      for (const group of layoutSubGroups) {
        if (name.includes(group.toLowerCase())) return group;
      }
      node = node.parent;
    }
    return "Default";
  }

  const boundFrameIds = new Set();
  for (const frame of allFrames) {
    if (boundFrameIds.has(frame.id)) continue;
    if (!("setBoundVariable" in frame)) continue;
    boundFrameIds.add(frame.id);

    try {
      const bound = frame.boundVariables || {};
      const occupiedBindings = new Set(Object.keys(bound));
      const group = guessLayoutGroup(frame);
      const isAL = isAutoLayout(frame);

      const bind = (field, variable) => {
        if (!variable) return false;
        // This pass fills gaps; it must never replace a binding inherited from
        // the approved source frame, even when our name heuristic finds a
        // different plausible token.
        if (occupiedBindings.has(field)) return false;
        try {
          frame.setBoundVariable(field, variable);
          // Track the addition locally so another candidate later in this pass
          // cannot overwrite the binding we just added.
          occupiedBindings.add(field);
          result.bindings.push({
            nodeId: frame.id,
            nodeName: frame.name,
            variable: variable.name,
            field,
          });
          return true;
        } catch (e) { return false; }
      };

      // Padding
      const paddingCandidates = [
        `Layout/${group}/container-padding`,
        "Layout/Default/container-padding",
      ];
      const paddingVar = resolveToken(layoutVars, paddingCandidates, "paddingLeft");
      if (paddingVar) {
        const hasUnboundPadding = !bound.paddingLeft || !bound.paddingRight ||
                                   !bound.paddingTop || !bound.paddingBottom;
        if (hasUnboundPadding) {
          bind("paddingLeft", paddingVar);
          bind("paddingRight", paddingVar);
          bind("paddingTop", paddingVar);
          bind("paddingBottom", paddingVar);
        }
      }

      // Section gap
      const sectionGapCandidates = [
        `Layout/${group}/section-gap`,
        "Layout/Default/section-gap",
      ];
      const sectionGapVar = resolveToken(layoutVars, sectionGapCandidates, "itemSpacing");

      // Row gap & column gap
      const rowGapCandidates = [
        `Layout/${group}/row-gap`,
        "Layout/Default/row-gap",
      ];
      const colGapCandidates = [
        `Layout/${group}/column-gap`,
        "Layout/Default/column-gap",
      ];
      const rowGapVar = resolveToken(layoutVars, rowGapCandidates, "itemSpacing");
      const colGapVar = resolveToken(layoutVars, colGapCandidates, "itemSpacing");

      if (isAL && !bound.itemSpacing) {
        const vertical = frame.layoutMode === "VERTICAL";
        if (vertical) {
          const isSectionLevel = frame.parent && (
            frame.parent.type === "PAGE" ||
            (frame.parent.name || "").toLowerCase().includes("section") ||
            frame.parent === root
          );
          bind("itemSpacing", isSectionLevel ? (sectionGapVar || rowGapVar) : rowGapVar);
        } else {
          bind("itemSpacing", colGapVar);
        }
      }

      // Counter axis spacing (for wrap layouts)
      if (isAL && frame.layoutWrap === "WRAP" && "counterAxisSpacing" in frame && !bound.counterAxisSpacing) {
        const vertical = frame.layoutMode === "VERTICAL";
        bind("counterAxisSpacing", vertical ? colGapVar : rowGapVar);
      }

      // Radius
      if (!bound.topLeftRadius && Object.keys(radiusVars).length > 0) {
        let radiusVar = null;
        const frameName = (frame.name || "").toLowerCase();
        for (const [vName, v] of Object.entries(radiusVars)) {
          const vNameLower = vName.toLowerCase();
          if (frameName.includes("card") && vNameLower.includes("card")) { radiusVar = v; break; }
          if (frameName.includes("button") && vNameLower.includes("button")) { radiusVar = v; break; }
          if (frameName.includes("input") && vNameLower.includes("input")) { radiusVar = v; break; }
        }
        if (radiusVar) {
          bind("topLeftRadius", radiusVar);
          bind("topRightRadius", radiusVar);
          bind("bottomLeftRadius", radiusVar);
          bind("bottomRightRadius", radiusVar);
        }
      }

      // Responsive Text Container
      if (Object.keys(textContainerVars).length > 0) {
        const frameName = (frame.name || "").toLowerCase();
        const hasTextChild = frame.children && frame.children.some(c => c.type === "TEXT");
        if (hasTextChild || frameName.includes("text") || frameName.includes("paragraph") ||
            frameName.includes("content") || frameName.includes("intro")) {
          for (const [vName, v] of Object.entries(textContainerVars)) {
            const vNameLower = vName.toLowerCase();
            if (vNameLower.includes("max-width") || vNameLower.includes("maxwidth")) {
              if ("maxWidth" in frame && !bound.maxWidth) {
                bind("maxWidth", v);
              }
            }
            if (vNameLower.includes("width") && !vNameLower.includes("max")) {
              if (!bound.width) bind("width", v);
            }
            if (vNameLower.includes("padding")) {
              if (!bound.paddingLeft) {
                bind("paddingLeft", v);
                bind("paddingRight", v);
                bind("paddingTop", v);
                bind("paddingBottom", v);
              }
            }
          }
        }
      }
    } catch (frameBindErr) {
      // Best-effort
    }
  }

  return result;
}

/**
 * Fix text sizing across an entire node tree (or the current page / full document).
 *
 * Rules applied to every TEXT node:
 *   - textAutoResize NONE or TRUNCATE (fixed height) → needs fix
 *   - Single-line heuristic (no newlines AND ≤ 80 chars) → WIDTH_AND_HEIGHT (hug both)
 *   - Multi-line / paragraph → HEIGHT (auto height) + FILL horizontal if parent uses Auto Layout
 *   - Already HEIGHT → check horizontal; set FILL if parent is Auto Layout and currently FIXED
 *   - Already WIDTH_AND_HEIGHT → leave unchanged (already hugging)
 *
 * @param {object} params
 * @param {string} [params.nodeId]   - Scan only this subtree (optional)
 * @param {string} [params.scope]    - "page" (default), "document", or "selection"
 */
async function fixTextSizing(params) {
  const { nodeId, scope = "page" } = params || {};

  // Resolve the root to scan
  let root;
  if (nodeId) {
    root = await getNodeByIdSafe(nodeId);
    if (!root) throw new Error(`Node not found: ${nodeId}`);
  } else if (scope === "document") {
    root = figma.root;
  } else if (scope === "selection") {
    const sel = figma.currentPage.selection;
    if (!sel || sel.length === 0) throw new Error("Nothing selected — select a node or use scope 'page'");
    root = { children: sel };
  } else {
    root = figma.currentPage;
  }

  // ── Load local variable collections once ──
  // Token groups live in the variable NAME PATH, not in the collection name:
  // a file typically has two collections (primitives, styles) holding
  // "Layout/Default/container-padding", "Gap/24", "Radius/12" and
  // "Responsive Text Container/max-width". Grouping by collection name found
  // nothing in such a file and skipped binding entirely, so group by path.
  let variableCollections = [];
  let layoutVars = {};        // path → variable  (Layout/…)
  let gapVars = {};           // path → variable  (Gap/…)
  let radiusVars = {};        // path → variable  (Radius/…)
  let textContainerVars = {}; // path → variable  (Responsive Text Container/…)
  let tokenIndex = null;

  try {
    if (figma.variables && figma.variables.getLocalVariableCollectionsAsync) {
      tokenIndex = await buildVariableIndex();
      const seen = Object.create(null);

      for (const v of tokenIndex.all) {
        const path = (v.name || "").toLowerCase();
        const bucket = path.indexOf("layout/") === 0 ? layoutVars
          : path.indexOf("gap/") === 0 ? gapVars
          : path.indexOf("radius/") === 0 ? radiusVars
          : path.indexOf("responsive text container/") === 0 ? textContainerVars
          : null;
        if (!bucket) continue;

        bucket[v.name] = v;
        const col = tokenIndex.collectionById[v.variableCollectionId];
        if (col && !seen[col.id]) {
          seen[col.id] = true;
          variableCollections.push({ id: col.id, name: col.name, modes: col.modes });
        }
      }
    }
  } catch (varErr) {
    // Variables API not available — continue without variable binding
  }

  const hasVariablesApi = Object.keys(layoutVars).length > 0 ||
                          Object.keys(textContainerVars).length > 0;

  /**
   * Resolve one token by exact path, trying the given candidates in order.
   *
   * Exact paths only. The previous version took the first variable whose name
   * merely *contained* "width", which in a real file picks between
   * `Layout/Compact/width`, `Layout/Default/width` and
   * `Utilities/Archive card/Width` by object key order — a different token each
   * run, and never a decision anyone made.
   */
  const resolveToken = (bucket, candidatePaths, field) => {
    if (!tokenIndex) return null;
    const wantedType = field ? typeForField(field) : "FLOAT";
    for (const path of candidatePaths) {
      const direct = bucket[path];
      if (direct && direct.resolvedType === wantedType) return direct;
      const hit = findCompatibleVariable(tokenIndex, { name: path, resolvedType: wantedType });
      if (hit.variable) return hit.variable;
    }
    return null;
  };

  // Recursively collect all TEXT nodes
  function collectTextNodes(node, results) {
    if (!node || node.removed) return;
    if (node.type === "TEXT") {
      results.push(node);
    }
    if ("children" in node) {
      for (const child of node.children) collectTextNodes(child, results);
    }
  }

  const textNodes = [];
  collectTextNodes(root, textNodes);

  const fixed = [];
  const skipped = [];
  const errors = [];
  const variableBindings = [];

  for (const node of textNodes) {
    try {
      const currentResize = node.textAutoResize;
      const chars = node.characters || "";
      const parentIsAutoLayout = !!(node.parent && isAutoLayout(node.parent));
      const currentHoriz = readHorizontalSizing(node);

      // Determine if this text has a constrained width
      const hasConstrainedWidth = currentHoriz === "FILL" || (
        currentResize === "NONE" && node.width > 0
      ) || currentResize === "HEIGHT" || currentResize === "TRUNCATE";

      const hasNewlines = chars.includes("\n");
      const isLongText = chars.length > 80;

      // ── Target resize mode ──
      let targetResize;
      if (hasConstrainedWidth || hasNewlines || isLongText) {
        targetResize = "HEIGHT";   // auto height — width stays as-is
      } else {
        targetResize = "WIDTH_AND_HEIGHT";  // hug both — short single-line label
      }

      // Should we set horizontal to FILL?
      const shouldFill = parentIsAutoLayout && currentHoriz !== "FILL" && (
        hasNewlines || isLongText || currentResize === "NONE" || currentResize === "TRUNCATE"
      );

      // Also check: vertical sizing must be HUG in auto-layout contexts
      const needsVertFix = parentIsAutoLayout && readVerticalSizing(node) !== "HUG";

      // Skip nodes that are already correct
      if (currentResize === targetResize && !shouldFill && !needsVertFix) {
        skipped.push({ id: node.id, name: node.name, reason: "already correct" });
        continue;
      }

      // Load font before mutating
      try {
        if (node.fontName && typeof node.fontName === "object" && "family" in node.fontName) {
          await figma.loadFontAsync(node.fontName);
        } else if (node.fontName === figma.mixed) {
          const ranges = node.getStyledTextSegments(["fontName"]);
          const seen = new Set();
          for (const seg of ranges) {
            const key = `${seg.fontName.family}|${seg.fontName.style}`;
            if (!seen.has(key)) {
              seen.add(key);
              await figma.loadFontAsync(seg.fontName);
            }
          }
        }
      } catch (fontErr) {
        errors.push({ id: node.id, name: node.name, error: `Font load failed: ${fontErr.message}` });
        continue;
      }

      const currentVert = parentIsAutoLayout ? readVerticalSizing(node) : null;
      const was = { resize: currentResize, horiz: currentHoriz, vert: currentVert };

      // Apply textAutoResize
      if (currentResize !== targetResize) {
        node.textAutoResize = targetResize;
      }

      // ── Critical: set layoutSizingVertical to HUG ──
      // In auto-layout parents, even with textAutoResize="HEIGHT", the node can
      // still have layoutSizingVertical="FIXED" which keeps the fixed pixel height.
      // We must set it to HUG so the text grows with content.
      if (parentIsAutoLayout && currentVert !== "HUG") {
        writeVerticalSizing(node, "HUG");
      }

      // Apply FILL horizontal if appropriate
      if (shouldFill) {
        writeHorizontalSizing(node, "FILL");
      }

      // Variable binding for text node parents is done in the bulk pass below

      fixed.push({
        id: node.id,
        name: node.name,
        was,
        now: {
          resize: node.textAutoResize,
          horiz: readHorizontalSizing(node),
          vert: parentIsAutoLayout ? readVerticalSizing(node) : null
        },
      });
    } catch (err) {
      errors.push({ id: node.id, name: node.name, error: err.message });
    }
  }

  // ── Bulk variable binding pass ──
  // Delegates to the shared bindVariablesToSubtree function so the same logic
  // runs in both fixTextSizing and generateBreakpoint.
  if (hasVariablesApi) {
    try {
      const varResult = await bindVariablesToSubtree(root);
      variableBindings.push(...varResult.bindings);
      if (varResult.collections.length > 0 && variableCollections.length === 0) {
        variableCollections = varResult.collections;
      }
    } catch (e) {
      // Best-effort — don't fail the overall operation
    }
  }

  return {
    success: true,
    scope: nodeId ? `node:${nodeId}` : scope,
    total: textNodes.length,
    fixed: fixed.length,
    skipped: skipped.length,
    errorCount: errors.length,
    changes: fixed,
    variableBindings: variableBindings.length > 0 ? variableBindings : undefined,
    variableCollectionsFound: variableCollections.length > 0
      ? variableCollections.map(c => ({ name: c.name, modes: c.modes.map(m => m.name) }))
      : undefined,
    errors,
    message: `Fixed ${fixed.length} of ${textNodes.length} text nodes. ${errors.length} error(s).` +
      (variableBindings.length > 0 ? ` Bound ${variableBindings.length} variable(s) to containers.` : "") +
      (variableCollections.length > 0 ? ` Found collections: ${variableCollections.map(c => c.name).join(", ")}.` : ""),
  };
}

/**
 * Create a reusable effect style in Figma
 */
async function createEffectStyle(params) {
  const { name, effects } = params || {};

  const style = figma.createEffectStyle();
  style.name = name;

  style.effects = (effects || []).map((effect) => ({
    type: effect.type,
    radius: effect.radius || 0,
    visible: effect.visible !== false,
    color: effect.color
      ? { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a !== undefined ? effect.color.a : 1 }
      : { r: 0, g: 0, b: 0, a: 0.25 },
    offset: effect.offset ? { x: effect.offset.x, y: effect.offset.y } : { x: 0, y: 0 },
    spread: effect.spread || 0,
    blendMode: effect.blendMode || "NORMAL",
  }));

  return {
    id: style.id,
    name: style.name,
    key: style.key,
    effectCount: style.effects.length,
  };
}
