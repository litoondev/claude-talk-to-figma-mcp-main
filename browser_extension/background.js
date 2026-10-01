/**
 * Web-to-Figma — background service worker.
 *
 * Joins the same relay the Figma plugin and the Webflow extension use, as a
 * third client with `role: "browser"`. The relay delivers commands carrying
 * `target: "browser"` here; everything else still goes to Figma.
 *
 *   join     → { type: "join", channel, id, role: "browser" }
 *   command  ← { type: "broadcast", message: { id, command, target, params } }
 *   success  → { id, type: "message", channel, message: { id, result } }
 *   failure  → { id, type: "message", channel, message: { id, error } }
 *   progress → { type: "progress_update", channel, id, message: { data } }
 *
 * SESSION VS SOCKET (LESSONS L11)
 * -------------------------------
 * The channel the user connected to is stored (`desired`) separately from the
 * live socket. A drop reconnects and rejoins the stored channel; only an
 * explicit Disconnect clears it. A service-worker restart reads it back from
 * chrome.storage and reconnects too.
 *
 * HEARTBEAT (LESSONS L12)
 * -----------------------
 * A heartbeat every 15s keeps the worker alive (Chrome keeps a service worker
 * running while its WebSocket is active) and proves the link. The watchdog
 * that closes a silent socket is armed only after the relay has answered one
 * heartbeat, so a relay that predates heartbeats never triggers a reconnect loop.
 */

// The extractor is plain script; loading it here gives the worker the same
// schema constant the page-side capture stamps on its output.
importScripts("extractor.js");
const SCHEMA = self.__webToFigma.SCHEMA;

const DEFAULT_RELAY = "ws://localhost:3055";
const HEARTBEAT_MS = 15000;
const WATCHDOG_MS = 45000;
const MAX_REPLY_BYTES = 15 * 1024 * 1024; // relay's Bun default frame limit is 16 MB
// Next.js and similar builds split CSS into dozens of chunks on a CDN; a low cap
// left most of a real page's hover rules and keyframes unread.
const MAX_EXTRA_SHEETS = 80;
const MAX_SHEET_CHARS = 2_000_000;
const MAX_TOTAL_SHEET_CHARS = 12_000_000;
const SHEET_CONCURRENCY = 6;

const state = {
  socket: null,
  connected: false,
  joined: false,
  channel: null,
  relay: DEFAULT_RELAY,
  desired: null, // { relay, channel } while the user wants to be connected
  heartbeatTimer: null,
  heartbeatAckSeen: false,
  lastAck: 0,
  reconnectTimer: null,
  reconnectDelay: 1000,
  log: [],
  busy: null,
};

// ─── State & popup plumbing ────────────────────────────────────────────────

function describe(error) {
  return error && error.message ? error.message : String(error);
}

function log(text, level = "info") {
  state.log.unshift({ at: Date.now(), text, level });
  state.log.length = Math.min(state.log.length, 40);
  broadcastState();
}

function publicState() {
  return {
    connected: state.connected && state.joined,
    connecting: !!state.desired && !(state.connected && state.joined),
    channel: state.channel || (state.desired && state.desired.channel) || null,
    relay: (state.desired && state.desired.relay) || state.relay,
    busy: state.busy,
    log: state.log.slice(0, 20),
    version: chrome.runtime.getManifest().version,
  };
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: "state", state: publicState() }).catch(() => {
    /* popup closed — nothing is listening */
  });
  updateBadge();
}

function updateBadge() {
  const on = state.connected && state.joined;
  chrome.action.setBadgeText({ text: state.busy ? "…" : on ? "ON" : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: state.busy ? "#f59e0b" : "#16a34a" }).catch(() => {});
}

async function saveDesired() {
  await chrome.storage.local.set({ desired: state.desired, relay: state.relay });
}

// ─── Connection ────────────────────────────────────────────────────────────

function connect(relay, channel) {
  state.desired = { relay: relay || DEFAULT_RELAY, channel };
  state.relay = state.desired.relay;
  saveDesired();
  open();
}

function open() {
  if (!state.desired) return;
  clearTimeout(state.reconnectTimer);
  closeSocket();

  const { relay, channel } = state.desired;
  let socket;
  try {
    socket = new WebSocket(relay);
  } catch (error) {
    log(`Could not open ${relay}: ${describe(error)}`, "error");
    scheduleReconnect();
    return;
  }
  state.socket = socket;
  state.heartbeatAckSeen = false;
  broadcastState();

  socket.onopen = () => {
    if (state.socket !== socket) return;
    state.connected = true;
    state.channel = channel;
    socket.send(JSON.stringify({ type: "join", channel, id: `join-${Date.now()}`, role: "browser" }));
    startHeartbeat(socket);
  };

  socket.onmessage = (event) => {
    if (state.socket !== socket) return;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === "heartbeat_ack") {
      state.heartbeatAckSeen = true;
      state.lastAck = Date.now();
      return;
    }
    if (data.type === "system") {
      if (data.message && typeof data.message === "object" && data.message.result && !state.joined) {
        state.joined = true;
        state.reconnectDelay = 1000;
        log(`Joined channel ${channel}.`, "ok");
      }
      return;
    }
    if (data.type === "error") {
      log(typeof data.message === "string" ? data.message : "Relay error", "error");
      return;
    }
    if (data.type === "activity" || data.type === "queue_position") return;

    const message = data.message;
    // A reply to a command this extension sent to the Figma plugin.
    if (message && message.id && ownRequests.has(message.id) && (message.result !== undefined || message.error !== undefined)) {
      const pending = ownRequests.get(message.id);
      ownRequests.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(new Error(String(message.error)));
      else pending.resolve(message.result);
      return;
    }
    // Only inbound commands addressed to us. Our own replies echo back with
    // result/error, and commands for Figma never carry target "browser".
    if (!message || !message.command || message.result !== undefined || message.error !== undefined) return;
    if (message.target !== "browser") return;
    handleCommand(message.id, message.command, message.params || {});
  };

  socket.onclose = () => {
    if (state.socket !== socket) return;
    state.connected = false;
    state.joined = false;
    stopHeartbeat();
    state.socket = null;
    if (state.desired) {
      log("Connection lost — reconnecting…", "error");
      scheduleReconnect();
    } else {
      log("Disconnected.");
    }
    broadcastState();
  };

  socket.onerror = () => {
    // onclose follows and handles recovery; this only names the likely cause.
    if (state.socket === socket && !state.connected) {
      log(`Could not reach the relay at ${relay}. Is "npm run socket" running?`, "error");
    }
  };
}

function closeSocket() {
  stopHeartbeat();
  const s = state.socket;
  state.socket = null;
  state.connected = false;
  state.joined = false;
  if (s) {
    try { s.close(); } catch { /* already closed */ }
  }
}

function disconnect() {
  state.desired = null;
  clearTimeout(state.reconnectTimer);
  saveDesired();
  closeSocket();
  state.channel = null;
  log("Disconnected.");
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  if (!state.desired) return;
  const delay = state.reconnectDelay;
  state.reconnectDelay = Math.min(delay * 2, 30000);
  state.reconnectTimer = setTimeout(open, delay);
}

function startHeartbeat(socket) {
  stopHeartbeat();
  state.lastAck = Date.now();
  state.heartbeatTimer = setInterval(() => {
    if (state.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
    // Watchdog only once the relay has proved it answers heartbeats (L12).
    if (state.heartbeatAckSeen && Date.now() - state.lastAck > WATCHDOG_MS) {
      log("Relay stopped answering — reconnecting…", "error");
      try { socket.close(); } catch { /* onclose reconnects */ }
      return;
    }
    try {
      socket.send(JSON.stringify({ type: "heartbeat", ts: Date.now() }));
    } catch { /* onclose handles it */ }
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
}

function send(payload) {
  const s = state.socket;
  if (!s || s.readyState !== WebSocket.OPEN) return false;
  s.send(JSON.stringify(payload));
  return true;
}

function reply(id, payload) {
  return send({ id, type: "message", channel: state.channel, message: { id, ...payload } });
}

function progress(id, command, pct, message) {
  if (!id) return; // local captures from the popup have no requester
  send({
    type: "progress_update",
    channel: state.channel,
    id,
    message: { data: { status: "in_progress", progress: pct, message, commandType: command } },
  });
}

// ─── Commands to the Figma plugin ─────────────────────────────────────────

const ownRequests = new Map(); // id → { resolve, reject, timer }

/**
 * The import runs inside the Figma plugin through its existing execute_code
 * command; the code is shipped with the extension (web-import-runtime.js,
 * generated from src/web_import/runtime.js), not built into the plugin.
 */
let runtimeSource = null;
async function runWebImport(op, params) {
  if (!runtimeSource) runtimeSource = await (await fetch(chrome.runtime.getURL("web-import-runtime.js"))).text();
  const reply = await sendToFigma("execute_code", {
    code: runtimeSource + "\nreturn JSON.stringify(await __w2fEntry(params));",
    params: Object.assign({ op }, params),
  });
  if (!reply || typeof reply.result !== "string") throw new Error("The Figma plugin returned no import result.");
  return JSON.parse(reply.result);
}

/** Send a command to the Figma plugin on this channel and wait for its reply. */
function sendToFigma(command, params, timeoutMs = 115000) {
  return new Promise((resolve, reject) => {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) {
      reject(new Error("Not connected to the relay. Paste the Figma plugin's channel ID and press Connect."));
      return;
    }
    const id = `w2f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      ownRequests.delete(id);
      reject(new Error(`The Figma plugin did not answer within ${timeoutMs / 1000}s.`));
    }, timeoutMs);
    ownRequests.set(id, { resolve, reject, timer });
    send({ id, type: "message", channel: state.channel, message: { id, command, params } });
  });
}

/** Every image source a capture refers to, with the size it is shown at. */
function captureImageSources(capture) {
  const out = new Map();
  for (const n of capture.nodes || []) {
    const src = n.media && (n.media.src || n.media.poster);
    if (src && !out.has(src)) out.set(src, { src, width: n.rect.w, height: n.rect.h });
    for (const bg of n.backgroundImages || []) if (!out.has(bg)) out.set(bg, { src: bg, width: n.rect.w, height: n.rect.h });
  }
  return Array.from(out.values());
}

/** Fetch and convert a capture's images into capture.assets (src → base64 PNG/JPEG/GIF or SVG markup). */
async function attachAssets(capture, budgetBytes) {
  const sources = captureImageSources(capture).slice(0, 120);
  const assets = {};
  const failed = [];
  let used = 0;
  const queue = sources.slice();
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (used >= budgetBytes) { failed.push(`${item.src} (size budget reached)`); continue; }
      try {
        const out = await fetchForFigma(item);
        used += (out.base64 || out.svg || "").length;
        assets[item.src] = out.kind === "svg" ? { svg: out.svg } : { base64: out.base64, mime: out.mime };
      } catch (error) {
        failed.push(`${item.src} (${describe(error)})`);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  capture.assets = assets;
  return { count: Object.keys(assets).length, failed };
}

/**
 * Send to Figma: capture the active tab (or the picked element), build it in
 * the Figma plugin on this channel, then fill its images — the same result as
 * Claude's browser_capture_to_figma, without Claude.
 */
async function sendPageToFigma(scope, width) {
  const tab = await resolveTab({});
  assertCapturable(tab);
  state.busy = "Sending to Figma…";
  broadcastState();
  try {
    log(`Capturing ${tab.url}`);
    const capture = await COMMANDS.browser_capture({ scope, maxNodes: 2500, width: width || 1440 }, null);
    const slim = {
      schema: capture.schema, version: capture.version, url: capture.url, title: capture.title,
      capturedAt: capture.capturedAt, viewport: capture.viewport, scope: capture.scope,
      nodes: capture.nodes, styles: capture.styles, interactions: capture.interactions,
      keyframes: capture.keyframes, breakpoints: capture.breakpoints,
      warnings: capture.warnings, extractorBuild: capture.extractorBuild,
    };
    log(`Building ${capture.stats.nodes} elements in Figma…`);
    const result = await runWebImport("import", { capture: slim, remap: true });
    let placed = 0;
    const failed = [];
    const images = result.images || [];
    if (images.length) {
      log(`Fetching ${images.length} image placeholder(s)…`);
      const bySrc = new Map();
      for (const img of images) {
        if (!bySrc.has(img.src)) bySrc.set(img.src, []);
        bySrc.get(img.src).push(img);
      }
      let batch = [];
      let bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        const r = await runWebImport("place", { items: batch });
        placed += r.placed;
        for (const f of r.failed || []) failed.push(f.error);
        batch = [];
        bytes = 0;
      };
      for (const [src, targets] of bySrc) {
        try {
          const out = await fetchForFigma({ src, width: targets[0].width, height: targets[0].height });
          for (const t of targets) {
            batch.push({ nodeId: t.nodeId, imageData: out.base64, svg: out.svg, scaleMode: t.scaleMode, background: t.background, filters: t.filters, fit: t.fit, position: t.position });
            bytes += (out.base64 || out.svg || "").length;
          }
          if (bytes > 6_000_000) await flush();
        } catch (error) {
          failed.push(`${src} (${describe(error)})`);
        }
      }
      await flush();
    }
    const c = result.created || {};
    const summary = `Built ${result.rootName}: ${c.frames} frames, ${c.texts} texts, ${c.autoLayouts} Auto Layout, ${c.grids} Grid` +
      (images.length ? `, ${placed} images` : "") + (failed.length ? ` (${failed.length} images failed)` : "");
    log(summary, "ok");
    return { result, placed, failed, summary };
  } finally {
    state.busy = null;
    broadcastState();
  }
}

// ─── Tabs & injection ──────────────────────────────────────────────────────

const BLOCKED_URL = /^(chrome|edge|brave|about|chrome-extension|devtools|view-source):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i;

async function resolveTab(params) {
  if (params.url) {
    if (!/^https?:\/\//i.test(params.url)) throw new Error(`Only http(s) URLs can be opened, not "${params.url}".`);
    const tab = await chrome.tabs.create({ url: params.url, active: true });
    await waitForLoad(tab.id, 45000);
    await new Promise((r) => setTimeout(r, params.settleMs || 1500));
    return chrome.tabs.get(tab.id);
  }
  if (params.tabId !== undefined && params.tabId !== null) {
    return chrome.tabs.get(Number(params.tabId));
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: "normal" });
  if (!tab) throw new Error("No active browser tab. Open the page to capture in Chrome, or pass a url.");
  return tab;
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`The page did not finish loading within ${timeoutMs / 1000}s.`));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") listener(tabId, { status: "complete" });
    }).catch(() => {});
  });
}

function assertCapturable(tab) {
  if (!tab.url || BLOCKED_URL.test(tab.url)) {
    throw new Error(`Chrome does not let extensions read ${tab.url || "this tab"}. Open a normal web page.`);
  }
  if (/^file:/i.test(tab.url)) {
    throw new Error("This is a local file. Enable \"Allow access to file URLs\" for Web-to-Figma in chrome://extensions, then retry.");
  }
}

/**
 * Lay the page out at an exact viewport width, as if the window were that size.
 *
 * Capturing at whatever width the user's window happens to be gives the wrong
 * breakpoint: a 2560px monitor captures the 2560px layout when the design is
 * 1440. Chrome's DevTools protocol (the same engine Puppeteer drives) overrides
 * the viewport for this tab only, so media queries, vw units and container
 * widths resolve at exactly `width`. Chrome shows a "started debugging" bar
 * while it is attached; it is detached as soon as the capture ends.
 */
async function withViewport(tabId, width, height, fn) {
  if (!width) return fn();
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    throw new Error(
      `Could not set the ${width}px viewport: ${describe(error)}. ` +
      "Close DevTools on that tab (only one debugger can attach), then try again."
    );
  }
  try {
    await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", {
      width: Math.round(width),
      height: Math.round(height || 900),
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    // Classic scrollbars take ~15px of layout width; hidden, the page lays out
    // at exactly `width`, which is the frame width a designer expects.
    try { await chrome.debugger.sendCommand(target, "Emulation.setScrollbarsHidden", { hidden: true }); } catch (e) { /* older Chrome */ }
    // Let layout, media queries and resize listeners settle at the new width.
    await new Promise((r) => setTimeout(r, 800));
    return await fn();
  } finally {
    try { await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride", {}); } catch (e) { /* tab closed */ }
    try { await chrome.debugger.detach(target); } catch (e) { /* already detached */ }
  }
}

async function runInPage(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  if (!res) throw new Error("The page returned nothing — it may have navigated away during the capture.");
  return res.result;
}

async function injectExtractor(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["extractor.js"] });
}

/** Fetch cross-origin stylesheets the page itself cannot read. Extensions are not bound by CORS. */
async function fetchSheets(hrefs) {
  const queue = Array.from(new Set(hrefs)).slice(0, MAX_EXTRA_SHEETS);
  const out = [];
  const failed = [];
  let total = 0;
  let skipped = 0;
  async function worker() {
    while (queue.length) {
      const href = queue.shift();
      if (total >= MAX_TOTAL_SHEET_CHARS) { skipped++; continue; }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(href, { signal: controller.signal, credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const css = (await res.text()).slice(0, MAX_SHEET_CHARS);
        total += css.length;
        out.push({ href, css });
      } catch (error) {
        failed.push(`${href} (${describe(error)})`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  await Promise.all(Array.from({ length: SHEET_CONCURRENCY }, worker));
  return { sheets: out, failed, skipped };
}

// ─── Images for Figma ──────────────────────────────────────────────────────

const FIGMA_MAX_IMAGE = 4_800_000; // figma.createImage refuses over 5 MB

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function sniff(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return null;
}

async function fetchForFigma(item) {
  const src = item.src;
  let blob;
  if (/^data:/i.test(src)) {
    blob = await (await fetch(src)).blob();
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(src, { signal: controller.signal, credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    } finally {
      clearTimeout(timer);
    }
  }
  const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const text = new TextDecoder().decode(head).trimStart().toLowerCase();
  if (/svg/.test(blob.type) || text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) {
    const svg = await blob.text();
    if (svg.length > 400_000) throw new Error("SVG over 400 KB");
    return { kind: "svg", svg };
  }
  const direct = sniff(head);
  const maxW = Math.min(4096, Math.max(64, Math.round((item.width || 0) * 2) || 4096));
  const maxH = Math.min(4096, Math.max(64, Math.round((item.height || 0) * 2) || 4096));
  // Already a format Figma takes, and small enough: pass it through untouched
  // (keeps animated GIFs animated and photos at their original quality).
  if (direct && blob.size <= FIGMA_MAX_IMAGE && blob.size <= 1_500_000) {
    return { kind: "image", mime: direct, base64: toBase64(await blob.arrayBuffer()) };
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    throw new Error(`Chrome could not decode ${blob.type || "this image"}`);
  }
  let scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
  // JPEG only for opaque images: a transparent WebP logo must stay transparent.
  // A 64×64 sample is enough to find transparency without reading every pixel.
  let opaque = direct === "image/jpeg";
  if (!opaque) {
    const probe = new OffscreenCanvas(64, 64);
    const pctx = probe.getContext("2d");
    pctx.drawImage(bitmap, 0, 0, 64, 64);
    const data = pctx.getImageData(0, 0, 64, 64).data;
    opaque = true;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { opaque = false; break; }
  }
  const photo = opaque;
  for (let attempt = 0; attempt < 4; attempt++) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const out = await canvas.convertToBlob(photo ? { type: "image/jpeg", quality: 0.9 } : { type: "image/png" });
    if (out.size <= FIGMA_MAX_IMAGE) {
      return { kind: "image", mime: out.type, base64: toBase64(await out.arrayBuffer()), width: w, height: h, converted: blob.type || true };
    }
    scale *= 0.7;
  }
  throw new Error("Still over 5 MB after scaling down");
}

// ─── Commands ──────────────────────────────────────────────────────────────

const COMMANDS = {
  async browser_status() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: "normal" });
    let picked = null;
    if (tab && tab.id !== undefined) {
      const stored = await chrome.storage.session.get(`picked:${tab.id}`);
      picked = stored[`picked:${tab.id}`] || null;
    }
    return {
      extension: "Web-to-Figma",
      viewportControl: true,
      version: chrome.runtime.getManifest().version,
      schema: SCHEMA,
      channel: state.channel,
      activeTab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
      capturable: tab ? !(!tab.url || BLOCKED_URL.test(tab.url)) : false,
      picked,
    };
  },

  async browser_pick(params, id) {
    const tab = await resolveTab({ tabId: params.tabId });
    assertCapturable(tab);
    const timeoutMs = Math.min(Math.max(Number(params.timeoutSec) || 60, 5), 110) * 1000;
    progress(id, "browser_pick", 10, "Waiting for you to click an element in the page…");
    await chrome.tabs.update(tab.id, { active: true });
    const picked = await startPicker(tab.id, timeoutMs);
    return picked;
  },

  /**
   * Fetch images for the Figma importer and hand them back in a form Figma
   * accepts. figma.createImage takes PNG, JPEG and GIF only, while most sites
   * serve WebP or AVIF — Chrome decodes all of them, so conversion happens
   * here. SVG sources come back as markup to be placed as vectors.
   * Oversized images are scaled to twice their displayed size (retina), and
   * anything still over Figma's 5 MB limit is scaled down further.
   */
  async browser_fetch_images(params, id) {
    const items = Array.isArray(params.images) ? params.images.slice(0, 60) : [];
    const budget = Math.min(Number(params.maxBytes) || 8_000_000, 12_000_000);
    const results = [];
    let used = 0;
    let done = 0;
    const queue = items.slice();
    async function worker() {
      while (queue.length) {
        const item = queue.shift();
        try {
          if (used >= budget) { results.push({ src: item.src, ok: false, deferred: true }); continue; }
          const out = await fetchForFigma(item);
          used += out.base64 ? out.base64.length : (out.svg ? out.svg.length : 0);
          results.push(Object.assign({ src: item.src, ok: true }, out));
        } catch (error) {
          results.push({ src: item.src, ok: false, error: describe(error) });
        }
        done++;
        if (done % 5 === 0) progress(id, "browser_fetch_images", Math.round((done / items.length) * 100), `Fetched ${done} of ${items.length} images`);
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    return { images: results };
  },

  async browser_capture(params, id) {
    const tab = await resolveTab(params);
    assertCapturable(tab);
    const tabId = tab.id;
    state.busy = `Capturing ${tab.url}`;
    broadcastState();
    try {
      progress(id, "browser_capture", 5, `Reading ${tab.url}`);
      await injectExtractor(tabId);

      const unreadable = await runInPage(tabId, () => window.__webToFigma.listUnreadableSheets());
      let extraSheets = [];
      const preWarnings = [];
      if (unreadable && unreadable.length) {
        progress(id, "browser_capture", 15, `Fetching ${unreadable.length} cross-origin stylesheet(s)`);
        const fetched = await fetchSheets(unreadable);
        extraSheets = fetched.sheets;
        if (unreadable.length > MAX_EXTRA_SHEETS) {
          preWarnings.push(`Only the first ${MAX_EXTRA_SHEETS} of ${unreadable.length} cross-origin stylesheets were fetched.`);
        }
        if (fetched.skipped) preWarnings.push(`${fetched.skipped} stylesheet(s) skipped after ${MAX_TOTAL_SHEET_CHARS / 1e6}M characters of CSS.`);
        if (fetched.failed.length) preWarnings.push(`Could not fetch: ${fetched.failed.slice(0, 5).join(", ")}${fetched.failed.length > 5 ? ` and ${fetched.failed.length - 5} more` : ""}`);
      }

      progress(id, "browser_capture", 25, params.autoScroll === false ? "Reading computed styles" : "Scrolling the page to trigger lazy content and scroll reveals");
      const opts = {
        scope: params.scope || "page",
        selector: params.selector || null,
        maxNodes: params.maxNodes,
        autoScroll: params.autoScroll,
        extraSheets,
      };
      if (params.width) progress(id, "browser_capture", 30, `Laying the page out at ${params.width}px`);
      const result = await withViewport(tabId, Number(params.width) || 0, Number(params.height) || 0, () =>
        runInPage(tabId, (o) => window.__webToFigma.capture(o), [opts])
      );
      if (!result || result.schema !== SCHEMA) {
        throw new Error("The extractor returned no capture. The page may block script injection.");
      }
      result.warnings = preWarnings.concat(result.warnings || []);
      result.tab = { id: tabId, title: tab.title };

      const size = new Blob([JSON.stringify(result)]).size;
      if (size > MAX_REPLY_BYTES) {
        throw new Error(
          `The capture is ${(size / 1048576).toFixed(1)} MB, over the relay's ${MAX_REPLY_BYTES / 1048576} MB message limit ` +
          `(${result.stats.nodes} elements). Capture one section with scope "selector" or "selection", or lower maxNodes.`
        );
      }
      progress(id, "browser_capture", 95, `Captured ${result.stats.nodes} elements`);
      log(`Captured ${result.stats.nodes} elements from ${tab.url}`, "ok");
      return result;
    } finally {
      state.busy = null;
      broadcastState();
    }
  },
};

async function handleCommand(id, command, params) {
  const handler = COMMANDS[command];
  if (!handler) {
    reply(id, { error: `Unknown command "${command}". This extension implements: ${Object.keys(COMMANDS).join(", ")}` });
    return;
  }
  log(`⌛ ${command}`);
  try {
    const result = await handler(params, id);
    if (!reply(id, { result })) log(`Finished ${command} but the relay connection had dropped.`, "error");
    else log(`✅ ${command}`, "ok");
  } catch (error) {
    const text = describe(error);
    reply(id, { error: text });
    log(`❌ ${command} — ${text}`, "error");
  }
}

// ─── Element picker ────────────────────────────────────────────────────────

const pickWaiters = new Map(); // tabId → resolve

async function startPicker(tabId, timeoutMs) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["picker.js"] });
  if (!timeoutMs) return null;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pickWaiters.delete(tabId);
      chrome.scripting.executeScript({ target: { tabId }, func: () => window.__webToFigmaPicker && window.__webToFigmaPicker.stop() }).catch(() => {});
      reject(new Error(`No element was picked within ${timeoutMs / 1000}s.`));
    }, timeoutMs);
    pickWaiters.set(tabId, (picked) => {
      clearTimeout(timer);
      pickWaiters.delete(tabId);
      if (picked) resolve(picked);
      else reject(new Error("Picking was cancelled (Esc)."));
    });
  });
}

// ─── Popup messages ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case "getState":
        return publicState();
      case "connect":
        connect(msg.relay, msg.channel);
        return publicState();
      case "disconnect":
        disconnect();
        return publicState();
      case "pick": {
        const tab = await resolveTab({});
        assertCapturable(tab);
        await startPicker(tab.id, 0);
        return { ok: true };
      }
      case "picked": {
        const tabId = sender.tab && sender.tab.id;
        if (tabId === undefined) return null;
        if (msg.picked) await chrome.storage.session.set({ [`picked:${tabId}`]: msg.picked });
        if (msg.picked) log(`Picked ${msg.picked.label}`, "ok");
        const waiter = pickWaiters.get(tabId);
        if (waiter) waiter(msg.picked || null);
        return null;
      }
      case "captureLocal": {
        const result = await COMMANDS.browser_capture({ scope: msg.scope || "page", autoScroll: msg.autoScroll }, null);
        // Saved with its images, so the plugin's Upload builds it complete.
        const assets = await attachAssets(result, 40_000_000);
        if (assets.failed.length) result.warnings = (result.warnings || []).concat([`${assets.failed.length} image(s) could not be saved: ${assets.failed.slice(0, 3).join(", ")}`]);
        return { result };
      }
      case "sendToFigma": {
        const tab = await resolveTab({});
        const stored = await chrome.storage.session.get(`picked:${tab.id}`);
        const scope = msg.scope || (stored[`picked:${tab.id}`] ? "selection" : "page");
        return await sendPageToFigma(scope, Number(msg.width) || 1440);
      }
      default:
        return null;
    }
  })().then(sendResponse, (error) => sendResponse({ error: describe(error) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`picked:${tabId}`).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  // A navigation drops the page's picked marker, so the stored pick goes with it.
  if (info.status === "loading") chrome.storage.session.remove(`picked:${tabId}`).catch(() => {});
});

// ─── Startup: restore the session ──────────────────────────────────────────

async function restore() {
  const stored = await chrome.storage.local.get(["desired", "relay"]);
  if (stored.relay) state.relay = stored.relay;
  if (stored.desired && stored.desired.channel && !state.socket) {
    state.desired = stored.desired;
    open();
  }
  updateBadge();
}

// A safety net for a worker that was stopped anyway: the alarm wakes it and
// restore() reconnects if the user still wants to be connected.
chrome.alarms.create("keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive" && state.desired && !state.socket) open();
});
chrome.runtime.onStartup.addListener(restore);
chrome.runtime.onInstalled.addListener(restore);
restore();
