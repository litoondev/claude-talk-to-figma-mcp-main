/**
 * Reading a Web-to-Figma browser capture.
 *
 * The browser extension (browser_extension/) sends back the whole page — every
 * element with its computed styles, the design tokens, CSS variables, hover
 * rules, keyframes and scroll behaviour. That is megabytes, and a tool result
 * is capped at ~24k chars, so the capture is saved to disk and the model gets:
 *
 *   summarizeCapture  — the page at a glance: outline, tokens, variables,
 *                       fonts, breakpoints, motion, warnings, and a
 *                       match_design_tokens argument block ready to pass on.
 *   renderNodes       — one subtree at a time, with each node's styles
 *                       resolved, for the build itself.
 *
 * Nothing here talks to Figma or the browser; it is pure so it can be tested
 * against a real capture file.
 */

import * as os from "os";
import * as path from "path";

export const CAPTURE_SCHEMA = "web-to-figma/capture";

/** Keep in step with EXTRACTOR_BUILD in browser_extension/extractor.js and the runtime's required build. */
export const REQUIRED_EXTRACTOR_BUILD = 3;

/** A plain-words warning when a capture came from an outdated extension, else null. */
export function outdatedExtensionWarning(capture: { extractorBuild?: number }): string | null {
  const build = capture.extractorBuild;
  if (build && build >= REQUIRED_EXTRACTOR_BUILD) return null;
  return (
    `OUTDATED EXTENSION: this capture came from an older Web-to-Figma Chrome extension (build ${build ?? "1-2"}, ` +
    `this server needs ${REQUIRED_EXTRACTOR_BUILD}). It misses elements such as SVG pattern fills. ` +
    "Ask the user to reload it in chrome://extensions (↻) and capture again."
  );
}

export interface CaptureNode {
  id: string;
  parent: string | null;
  tag: string;
  rect: { x: number; y: number; w: number; h: number };
  s: number;
  attrs?: Record<string, string>;
  text?: string;
  runs?: Array<{ text?: string; node?: string }>;
  children?: string[];
  media?: Record<string, unknown>;
  pseudo?: { before?: { content: string; s: number }; after?: { content: string; s: number } };
  backgroundImages?: string[];
  svg?: string | null;
  fixed?: boolean;
  sticky?: boolean;
  hidden?: boolean;
  scrollHint?: Record<string, string>;
  revealed?: Record<string, unknown>;
  shadowRoot?: boolean;
}

export interface Capture {
  schema: string;
  version: number;
  capturedAt: string;
  url: string;
  title: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  page: { width: number; height: number };
  scope: { kind: string; selector: string | null; root: string | null; contextBackground: string | null };
  nodes: CaptureNode[];
  styles: Array<Record<string, string>>;
  tokens: {
    colors: Array<{ hex: string; alpha: number; count: number; usage?: Record<string, number>; source?: string }>;
    gradients: Array<{ value: string; count: number }>;
    typography: Array<{
      fontFamily: string | null;
      fontSize: number | null;
      fontWeight: number | null;
      lineHeight: string | null;
      letterSpacing: number | null;
      count: number;
      sample: string;
      stack?: string;
      fontStyle?: string;
      textTransform?: string;
    }>;
    spacing: Array<{ value: number; count: number }>;
    radii: Array<{ value: number; count: number }>;
    shadows: Array<{ value: string; count: number }>;
    blurs: Array<{ value: string; count: number }>;
  };
  cssVariables: Array<{ name: string; value: string; selector: string; resolved?: string; hex?: string; media?: string }>;
  fonts: Array<{ family: string; weight: string; style: string; status: string }>;
  fontFaces?: Array<Record<string, string>>;
  breakpoints: Array<{ query: string; minWidth: number | null; maxWidth: number | null }>;
  interactions: Array<{ selector: string; states: string[]; media?: string; declarations: Record<string, string>; nodes: string[] }>;
  keyframes: Array<{ name: string; frames: Array<{ offset: string; style: Record<string, string> }> }>;
  animations: Array<{ type: string; name: string | null; node: string | null; pseudo?: string; playState: string; timing?: any; timeline?: string }>;
  scroll: {
    libraries: Array<{ name: string; version: string | null }>;
    triggers: Array<Record<string, unknown>>;
    hints: Array<{ node: string; attribute: string; from: string | null; to: string | null; scrollY: number; changes?: number }>;
    timelines: Array<{ style: number; animationTimeline: string; animationName: string | null }>;
    probed: boolean;
  };
  warnings: string[];
  stats: { nodes: number; styles: number; truncated: boolean; elapsedMs: number; stylesheets: { readable: number; fetched: number; unreadable: number } };
  tab?: { id: number; title: string };
}

/**
 * Check a value is a capture this code can read. Only what the readers below
 * depend on is checked — the extension may add fields, and a capture should
 * not be refused for carrying more than expected (LESSONS L7).
 */
export function assertCapture(value: unknown): asserts value is Capture {
  const v = value as any;
  if (!v || typeof v !== "object") throw new Error("The browser extension returned no capture.");
  if (v.schema !== CAPTURE_SCHEMA) {
    throw new Error(`Not a Web-to-Figma capture (schema is ${JSON.stringify(v.schema)}, expected "${CAPTURE_SCHEMA}").`);
  }
  if (!Array.isArray(v.nodes) || !Array.isArray(v.styles) || !v.tokens) {
    throw new Error("The capture is missing its nodes, styles or tokens.");
  }
}

/** Where a capture is saved when the caller does not say. */
export function defaultCapturePath(url: string, now: Date = new Date()): string {
  let host = "page";
  try {
    host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_") || "page";
  } catch {
    /* keep "page" */
  }
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  return path.join(os.tmpdir(), "web-to-figma-captures", `${host}-${stamp}.json`);
}

function nodeIndex(capture: Capture): Map<string, CaptureNode> {
  const map = new Map<string, CaptureNode>();
  for (const n of capture.nodes) map.set(n.id, n);
  return map;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function label(node: CaptureNode): string {
  let s = node.tag;
  if (node.attrs?.id) s += `#${node.attrs.id}`;
  const cls = node.attrs?.class?.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  if (cls && cls.length) s += `.${cls.join(".")}`;
  return s;
}

function rectText(r: CaptureNode["rect"]): string {
  return `${Math.round(r.w)}×${Math.round(r.h)} @${Math.round(r.x)},${Math.round(r.y)}`;
}

/** Colour key as match_design_tokens expects it: plain 6-digit hex. */
function hexOnly(c: { hex: string }): string {
  return c.hex;
}

/** Descendant text, for outline lines. */
function textWithin(byId: Map<string, CaptureNode>, node: CaptureNode, max: number): string {
  const parts: string[] = [];
  const walk = (n: CaptureNode) => {
    if (parts.join(" ").length > max) return;
    if (n.text) parts.push(n.text);
    for (const id of n.children || []) {
      const c = byId.get(id);
      if (c) walk(c);
    }
  };
  walk(node);
  return clip(parts.join(" · "), max);
}

/**
 * The top-level blocks of the page. Starting from the root's children, any
 * block that holds most of the page (a `main`, an app shell) is opened up and
 * replaced by its own children, so the outline lists header, sections and
 * footer rather than "main, footer".
 */
export function outline(capture: Capture, limit = 30): CaptureNode[] {
  const byId = nodeIndex(capture);
  const root = capture.nodes[0];
  if (!root) return [];
  const kidsOf = (n: CaptureNode) =>
    ((n.children || []).map((id) => byId.get(id)).filter(Boolean) as CaptureNode[])
      .filter((k) => k.rect.h >= 24 || k.fixed || k.sticky);
  const total = Math.max(root.rect.h, 1);
  let items = kidsOf(root);
  if (!items.length) return [root];
  for (let pass = 0; pass < 4; pass++) {
    let opened = false;
    const next: CaptureNode[] = [];
    for (const item of items) {
      const kids = kidsOf(item);
      if (item.rect.h >= total * 0.5 && kids.length >= 2) {
        next.push(...kids);
        opened = true;
      } else if (item.rect.h >= total * 0.5 && kids.length === 1) {
        next.push(kids[0]);
        opened = true;
      } else {
        next.push(item);
      }
    }
    items = next;
    if (!opened) break;
  }
  return items.slice(0, limit);
}

/** The arguments match_design_tokens takes, built from the capture's tokens. */
export function tokenMatchArgs(capture: Capture) {
  const colors = Array.from(new Set(capture.tokens.colors.filter((c) => c.alpha >= 0.99).map(hexOnly))).slice(0, 40);
  const typography = capture.tokens.typography
    .filter((t) => t.fontSize && t.sample)
    .slice(0, 20)
    .map((t) => ({
      label: clip(t.sample, 30),
      fontFamily: t.fontFamily,
      fontSize: t.fontSize as number,
      fontWeight: t.fontWeight,
      lineHeight: t.lineHeight === "normal" ? null : t.lineHeight,
      letterSpacing: t.letterSpacing,
    }));
  const spacing = capture.tokens.spacing.filter((s) => s.count >= 2).map((s) => s.value).slice(0, 20);
  const radii = capture.tokens.radii.map((r) => r.value).slice(0, 12);
  return { colors, typography, spacing, radii };
}

export function summarizeCapture(capture: Capture, savedTo: string | null): string {
  const byId = nodeIndex(capture);
  const L: string[] = [];
  const s = capture.stats;
  const outdated = outdatedExtensionWarning(capture as any);
  if (outdated) L.push(`⚠ ${outdated}`, "");
  L.push(`WEB CAPTURE — ${capture.title || "(untitled)"}`);
  L.push(`${capture.url}`);
  L.push(
    `Viewport ${capture.viewport.width}×${capture.viewport.height} @${capture.viewport.devicePixelRatio}x · page ${capture.page.width}×${capture.page.height} · ` +
      `scope ${capture.scope.kind}${capture.scope.selector ? ` (${capture.scope.selector})` : ""} · ` +
      `${s.nodes} elements, ${s.styles} unique styles${s.truncated ? " (TRUNCATED)" : ""} · ${s.elapsedMs} ms`
  );
  if (capture.scope.contextBackground) L.push(`Sits on background ${capture.scope.contextBackground}`);
  if (savedTo) L.push(`Saved: ${savedTo}`);

  if (capture.warnings.length) {
    L.push("", "WARNINGS");
    for (const w of capture.warnings.slice(0, 12)) L.push(`  ⚠ ${clip(w, 300)}`);
  }

  L.push("", "OUTLINE (read a block with browser_capture_nodes)");
  for (const n of outline(capture)) {
    const st = capture.styles[n.s] || {};
    const layout = st.display && /flex|grid/.test(st.display)
      ? ` ${st.display}${st["flex-direction"] ? ` ${st["flex-direction"]}` : ""}${st["grid-template-columns"] ? ` cols[${clip(st["grid-template-columns"], 40)}]` : ""}`
      : "";
    const flags = [n.fixed && "fixed", n.sticky && "sticky"].filter(Boolean).join(",");
    L.push(`  ${n.id} ${label(n)} ${rectText(n.rect)}${layout}${flags ? ` [${flags}]` : ""} — ${textWithin(byId, n, 90) || "(no text)"}`);
  }

  const t = capture.tokens;
  L.push("", `COLOURS (${t.colors.length})`);
  for (const c of t.colors.slice(0, 24)) {
    const usage = c.usage ? Object.entries(c.usage).map(([k, v]) => `${k} ${v}`).join(", ") : "";
    L.push(`  ${c.hex}${c.alpha < 1 ? ` α${c.alpha}` : ""} ×${c.count}${usage ? ` (${usage})` : ""}${c.source ? ` from ${c.source}` : ""}`);
  }
  if (t.gradients.length) {
    L.push(`GRADIENTS (${t.gradients.length})`);
    for (const g of t.gradients.slice(0, 6)) L.push(`  ×${g.count} ${clip(g.value, 160)}`);
  }
  L.push("", `TYPOGRAPHY (${t.typography.length} combinations)`);
  for (const ty of t.typography.slice(0, 16)) {
    L.push(
      `  ${ty.fontFamily} ${ty.fontSize}px/${ty.lineHeight} w${ty.fontWeight}` +
        `${ty.letterSpacing ? ` ls${ty.letterSpacing}px` : ""}${ty.textTransform ? ` ${ty.textTransform}` : ""}${ty.fontStyle ? ` ${ty.fontStyle}` : ""}` +
        ` ×${ty.count} — "${clip(ty.sample, 40)}"`
    );
  }
  L.push("", `SPACING ${t.spacing.slice(0, 20).map((x) => `${x.value}×${x.count}`).join("  ") || "—"}`);
  L.push(`RADII ${t.radii.map((x) => `${x.value}×${x.count}`).join("  ") || "—"}`);
  if (t.shadows.length) {
    L.push("SHADOWS");
    for (const sh of t.shadows.slice(0, 8)) L.push(`  ×${sh.count} ${clip(sh.value, 160)}`);
  }
  if (t.blurs.length) L.push(`BLURS ${t.blurs.map((b) => `${b.value}×${b.count}`).join("  ")}`);

  if (capture.cssVariables.length) {
    // The site's own tokens live on :root/html; third-party widgets declare
    // theirs on their own selectors. Show the root ones first, colours first.
    const isRoot = (sel: string) => /(^|,\s*)(:root|html)\b/.test(sel);
    const ranked = capture.cssVariables
      .map((v, i) => ({ v, i }))
      .sort((a, b) =>
        Number(isRoot(b.v.selector)) - Number(isRoot(a.v.selector)) ||
        Number(!!b.v.hex) - Number(!!a.v.hex) ||
        a.i - b.i
      )
      .map((x) => x.v);
    const rootCount = capture.cssVariables.filter((v) => isRoot(v.selector)).length;
    L.push("", `CSS VARIABLES (${capture.cssVariables.length}, ${rootCount} on :root/html)`);
    for (const v of ranked.slice(0, 40)) {
      L.push(`  ${v.name}: ${clip(v.value, 60)}${v.resolved ? ` → ${clip(v.resolved, 40)}` : ""}${v.hex ? ` [${v.hex}]` : ""}${v.selector !== ":root" ? `  (${clip(v.selector, 40)})` : ""}${v.media ? ` @${clip(v.media, 30)}` : ""}`);
    }
    if (capture.cssVariables.length > 40) L.push(`  … ${capture.cssVariables.length - 40} more in the saved file`);
  }

  const usedFamilies = new Set(t.typography.map((x) => (x.fontFamily || "").toLowerCase()));
  const fontLines = capture.fonts.filter((f) => usedFamilies.has(f.family.toLowerCase()));
  L.push("", `FONTS ${Array.from(usedFamilies).filter(Boolean).join(", ") || "—"}`);
  // Unused unicode-range subsets stay unloaded by design; a family is missing
  // only when none of its faces loaded.
  const loaded = new Set(fontLines.filter((f) => f.status === "loaded").map((f) => f.family.toLowerCase()));
  const missing = Array.from(new Set(fontLines.filter((f) => !loaded.has(f.family.toLowerCase())).map((f) => f.family)));
  if (missing.length) L.push(`  not loaded: ${missing.join(", ")}`);
  L.push("  Check each family is installed in Figma before building; a substitute is a fidelity defect to report.");

  if (capture.breakpoints.length) {
    L.push("", `BREAKPOINTS ${capture.breakpoints.map((b) => (b.minWidth !== null ? `≥${b.minWidth}` : `≤${b.maxWidth}`)).join("  ")}`);
  }

  L.push("", "MOTION & INTERACTION");
  const matchedRules = capture.interactions.filter((i) => i.nodes.length);
  L.push(`  hover/focus/active rules: ${capture.interactions.length} (${matchedRules.length} match captured elements)`);
  // Rules that hit captured elements first; the rest belong to widgets not on screen.
  for (const i of matchedRules.concat(capture.interactions.filter((x) => !x.nodes.length)).slice(0, 10)) {
    const decl = Object.entries(i.declarations).map(([k, v]) => `${k}: ${v}`).join("; ");
    L.push(`    ${clip(i.selector, 60)} → ${clip(decl, 110)}${i.nodes.length ? ` (${i.nodes.length} node${i.nodes.length > 1 ? "s" : ""}: ${i.nodes.slice(0, 4).join(",")})` : ""}`);
  }
  const kfNames = capture.keyframes.map((k) => k.name);
  L.push(`  @keyframes (${kfNames.length}): ${kfNames.slice(0, 16).join(", ") || "—"}${kfNames.length > 16 ? ", …" : ""}`);
  const anims = capture.animations;
  if (anims.length) {
    // Generated sites run dozens of near-identical animations (one per dot,
    // per letter); grouping keeps the distinct behaviours visible.
    const groups = new Map<string, { a: typeof anims[number]; count: number; names: Set<string> }>();
    for (const a of anims) {
      const dur = a.timing && typeof a.timing.duration === "number" ? `${a.timing.duration}ms` : "";
      const key = `${a.type}|${a.node || "?"}|${a.pseudo || ""}|${dur}|${a.playState}|${a.timeline || ""}`;
      const g = groups.get(key) || { a, count: 0, names: new Set<string>() };
      g.count++;
      if (a.name) g.names.add(a.name);
      groups.set(key, g);
    }
    L.push(`  animations (document.getAnimations): ${anims.length} in ${groups.size} group(s)`);
    for (const { a, count, names } of Array.from(groups.values()).slice(0, 10)) {
      const dur = a.timing && typeof a.timing.duration === "number" ? `${a.timing.duration}ms` : "";
      const nameList = Array.from(names);
      L.push(
        `    ${count > 1 ? `×${count} ` : ""}${a.type} ${clip(nameList.slice(0, 3).join(", "), 60)}${nameList.length > 3 ? ", …" : ""}` +
          ` on ${a.node || "?"}${a.pseudo ? a.pseudo : ""} ${dur} ${a.playState}${a.timeline ? ` timeline=${a.timeline}` : ""}`
      );
    }
  }
  const sc = capture.scroll;
  if (sc.libraries.length) L.push(`  libraries: ${sc.libraries.map((l) => `${l.name}${l.version ? ` ${l.version}` : ""}`).join(", ")}`);
  if (sc.triggers.length) L.push(`  scroll triggers: ${sc.triggers.length} (ScrollTrigger registry)`);
  if (sc.timelines.length) L.push(`  CSS scroll timelines: ${sc.timelines.map((x) => `${x.animationName || "?"}@${x.animationTimeline}`).slice(0, 6).join(", ")}`);
  if (sc.hints.length) {
    L.push(`  scroll probe: ${sc.hints.length} attribute change(s) while scrolling`);
    // Class changes are what reveal libraries do; inline-style churn is mostly
    // pointer/parallax updates. Show the former first.
    const ordered = sc.hints.filter((h) => h.attribute !== "style").concat(sc.hints.filter((h) => h.attribute === "style"));
    for (const h of ordered.slice(0, 8)) {
      L.push(`    ${h.node} ${h.attribute}: "${clip(h.from || "", 40)}" → "${clip(h.to || "", 40)}" at y=${h.scrollY}${h.changes && h.changes > 1 ? ` (${h.changes} frames)` : ""}`);
    }
  } else if (!sc.probed) {
    L.push("  scroll probe: not run (section capture or autoScroll false)");
  }
  const hinted = capture.nodes.filter((n) => n.scrollHint).length;
  if (hinted) L.push(`  elements with scroll-animation attributes/classes: ${hinted}`);
  L.push("  Figma cannot run these; store them as plugin data on the matching layers so an HTML export can re-inject them.");

  L.push("", "NEXT: pass this to match_design_tokens, bind what matches, and ask before creating anything that does not (CLAUDE.md §4):");
  L.push(JSON.stringify(tokenMatchArgs(capture)));
  return L.join("\n");
}

/** A node's style, with its pseudo-elements. */
function styleLine(capture: Capture, n: CaptureNode): string {
  const st = capture.styles[n.s] || {};
  return Object.entries(st).map(([k, v]) => `${k}:${v}`).join("; ");
}

/**
 * Render a subtree for building: each node with its rect, text, media and
 * full style, indented by depth. Stops at `maxChars` and says where, so the
 * caller can continue from the next node rather than lose the rest silently.
 */
export function renderNodes(capture: Capture, rootId: string | undefined, depth = 3, maxChars = 20000): string {
  const byId = nodeIndex(capture);
  const root = rootId ? byId.get(rootId) : capture.nodes[0];
  if (!root) {
    throw new Error(`No node "${rootId}" in this capture (ids run n1…n${capture.nodes.length}).`);
  }
  const out: string[] = [];
  let used = 0;
  let stoppedAt: string | null = null;

  const emit = (line: string) => {
    used += line.length + 1;
    out.push(line);
  };

  const walk = (n: CaptureNode, level: number) => {
    if (stoppedAt) return;
    if (used > maxChars) {
      stoppedAt = n.id;
      return;
    }
    const pad = "  ".repeat(level);
    const flags = [n.fixed && "fixed", n.sticky && "sticky", n.hidden && "hidden", n.shadowRoot && "shadow"].filter(Boolean).join(",");
    emit(`${pad}${n.id} ${label(n)} ${rectText(n.rect)}${flags ? ` [${flags}]` : ""}`);
    emit(`${pad}  style: ${styleLine(capture, n) || "(defaults)"}`);
    if (n.runs) {
      emit(`${pad}  runs: ${n.runs.map((r) => (r.text !== undefined ? JSON.stringify(r.text) : `<${r.node}>`)).join(" ")}`);
    } else if (n.text) {
      emit(`${pad}  text: ${JSON.stringify(clip(n.text, 400))}`);
    }
    const attrs = { ...(n.attrs || {}) };
    delete attrs.class;
    delete attrs.id;
    if (Object.keys(attrs).length) emit(`${pad}  attrs: ${clip(JSON.stringify(attrs), 300)}`);
    if (n.media) emit(`${pad}  media: ${clip(JSON.stringify(n.media), 300)}`);
    if (n.backgroundImages) emit(`${pad}  background images: ${n.backgroundImages.join(", ")}`);
    if (n.pseudo?.before) emit(`${pad}  ::before ${n.pseudo.before.content} { ${Object.entries(capture.styles[n.pseudo.before.s] || {}).map(([k, v]) => `${k}:${v}`).join("; ")} }`);
    if (n.pseudo?.after) emit(`${pad}  ::after ${n.pseudo.after.content} { ${Object.entries(capture.styles[n.pseudo.after.s] || {}).map(([k, v]) => `${k}:${v}`).join("; ")} }`);
    if (n.svg) emit(`${pad}  svg: ${n.svg.length > 1500 ? `${n.svg.slice(0, 1500)}… (${n.svg.length} chars — full markup in the saved file)` : n.svg}`);
    if (n.scrollHint) emit(`${pad}  scroll hint: ${JSON.stringify(n.scrollHint)}`);
    if (n.revealed) emit(`${pad}  revealed state: ${JSON.stringify(n.revealed)}`);
    const hovers = capture.interactions.filter((i) => i.nodes.includes(n.id));
    for (const h of hovers.slice(0, 4)) {
      emit(`${pad}  :${h.states.join(":")} → ${Object.entries(h.declarations).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
    }
    const kids = n.children || [];
    if (level >= depth) {
      if (kids.length) emit(`${pad}  … ${kids.length} child${kids.length > 1 ? "ren" : ""} (${kids.slice(0, 8).join(", ")}${kids.length > 8 ? ", …" : ""}) — read with nodeId`);
      return;
    }
    for (const id of kids) {
      const c = byId.get(id);
      if (c) walk(c, level + 1);
    }
  };

  walk(root, 0);
  if (stoppedAt) out.push(`\n[Stopped at ${stoppedAt} to stay within the response limit. Call again with nodeId set to a child listed above, or a smaller depth.]`);
  return out.join("\n");
}
