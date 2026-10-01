/**
 * Web-to-Figma browser capture tools.
 *
 *   browser_status         — is the browser extension on this channel, and what tab is open
 *   browser_pick           — ask the user to click the element to capture
 *   browser_capture        — capture the live page's computed design; save it, return a summary
 *   browser_capture_nodes  — read one subtree of a saved capture, styles resolved
 *   browser_capture_to_figma — capture (or load) a page and build it in Figma in one call
 *
 * `analyze_html` reads a page's source. These read what the browser rendered:
 * computed styles after every stylesheet and script has run, the JS-built DOM,
 * resolved CSS variables, hover rules, keyframes, running animations and
 * scroll-library registries. The extension in browser_extension/ does the
 * reading; these tools reach it over the relay with `target: "browser"`, the
 * same way the Webflow Designer tools reach their extension.
 *
 * A full capture is megabytes, far past the tool-result cap, so it is written
 * to disk and the model gets a summary plus a reader for one subtree at a time.
 */

import * as fs from "fs";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToBrowser, sendCommandToFigma } from "../utils/websocket";
import { readImageBytes, detectImageType } from "./html-import-tools";
import { WEB_IMPORT_RUNTIME } from "../web-import/runtime.generated";

/**
 * Run one step of the web import inside the Figma plugin.
 *
 * The importer is not part of the plugin: it is sent with the call through the
 * plugin's existing execute_code command, so the plugin's own code never has
 * to change to support it. The result comes back as a JSON string, which
 * passes execute_code's serialiser untouched.
 */
export async function runWebImport(op: "import" | "place", params: Record<string, unknown>, timeoutMs: number): Promise<any> {
  const reply = (await sendCommandToFigma(
    "execute_code",
    { code: WEB_IMPORT_RUNTIME + "\nreturn JSON.stringify(await __w2fEntry(params));", params: { op, ...params } },
    timeoutMs
  )) as { success?: boolean; result?: unknown };
  if (!reply || typeof reply.result !== "string") {
    throw new Error("The Figma plugin returned no import result. Is it open on this channel?");
  }
  return JSON.parse(reply.result);
}
import { coerceBoolean } from "../utils/schema-helpers";
import { textResponse, errorResponse } from "../utils/respond";
import { assertCapture, Capture, defaultCapturePath, renderNodes, summarizeCapture } from "../utils/browser-capture";

const CONNECT_HINT =
  "Requires the Web-to-Figma browser extension (browser_extension/ in this repo, loaded unpacked in Chrome) " +
  "to be connected to this channel: extension popup → same channel ID → Connect.";

/** The relay drops a command after 120 s, so every capture must finish inside it. */
const CAPTURE_TIMEOUT_MS = 115_000;

function render(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function saveCapture(capture: Capture, saveTo: string | undefined): string {
  const target = saveTo ? path.resolve(saveTo) : defaultCapturePath(capture.url);
  if (saveTo && !path.isAbsolute(saveTo)) {
    throw new Error(`saveTo must be an absolute path, got "${saveTo}".`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(capture));
  return target;
}

function loadCapture(file: string): Capture {
  if (!path.isAbsolute(file)) throw new Error(`path must be absolute, got "${file}".`);
  if (!fs.existsSync(file)) throw new Error(`No capture file at ${file}.`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  assertCapture(parsed);
  return parsed;
}

interface ImportImage {
  nodeId: string;
  src: string;
  filters?: unknown;
  fit?: string;
  position?: string;
  scaleMode?: string;
  svg?: boolean;
  background?: boolean;
  width?: number;
  height?: number;
}

interface ImportResult {
  rootId: string;
  rootName: string;
  width: number;
  height: number;
  sourceHeight: number;
  created: Record<string, number>;
  remap: null | Record<string, { bound?: number; applied?: number; unmatched: Array<{ value: string; count: number }> }>;
  fonts: { substituted: Array<{ from: string; to: string }> };
  images: ImportImage[];
  warnings: string[];
  elapsedMs: number;
}

/** Only what the plugin's importer reads; tokens and motion lists stay on disk. */
export function slimForImport(capture: Capture): Record<string, unknown> {
  return {
    schema: capture.schema,
    version: capture.version,
    url: capture.url,
    title: capture.title,
    capturedAt: capture.capturedAt,
    viewport: capture.viewport,
    scope: capture.scope,
    nodes: capture.nodes,
    styles: capture.styles,
    interactions: capture.interactions,
    keyframes: capture.keyframes,
    breakpoints: capture.breakpoints,
    // carries capture-time problems (an unstyled page) into the import report
    warnings: capture.warnings,
    extractorBuild: (capture as any).extractorBuild,
  };
}

/**
 * Get every image the importer left a placeholder for, and fill it.
 * Through the browser extension when it is connected — it converts WebP/AVIF,
 * which Figma cannot take — otherwise by downloading on the server.
 */
async function placeImages(images: ImportImage[], useBrowser: boolean): Promise<{ placed: number; failed: string[]; via: string }> {
  const bySrc = new Map<string, ImportImage[]>();
  for (const img of images) {
    if (!bySrc.has(img.src)) bySrc.set(img.src, []);
    bySrc.get(img.src)!.push(img);
  }
  const failed: string[] = [];
  let placed = 0;
  const pending: Array<{ nodeId: string; imageData?: string; svg?: string; scaleMode?: string; background?: boolean; filters?: unknown; fit?: string; position?: string }> = [];
  let pendingBytes = 0;

  const flush = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    pendingBytes = 0;
    const res = (await runWebImport("place", { items: batch }, 110_000)) as { placed: number; failed: Array<{ nodeId: string; error: string }> };
    placed += res.placed;
    for (const f of res.failed || []) failed.push(`${f.nodeId}: ${f.error}`);
  };
  const queueFill = async (src: string, data: { base64?: string; svg?: string }) => {
    for (const target of bySrc.get(src) || []) {
      pending.push({ nodeId: target.nodeId, imageData: data.base64, svg: data.svg, scaleMode: target.scaleMode, background: target.background, filters: target.filters, fit: target.fit, position: target.position });
      pendingBytes += (data.base64 || data.svg || "").length;
    }
    if (pendingBytes > 7_000_000) await flush();
  };

  const sources = Array.from(bySrc.keys());
  let via = "server download";
  if (useBrowser) {
    via = "browser extension";
    let queue = sources.map((src) => {
      const first = bySrc.get(src)![0];
      return { src, width: first.width, height: first.height };
    });
    while (queue.length) {
      const batch = queue.splice(0, 12);
      const res = (await sendCommandToBrowser("browser_fetch_images", { images: batch, maxBytes: 8_000_000 }, 110_000)) as {
        images: Array<{ src: string; ok: boolean; deferred?: boolean; error?: string; base64?: string; svg?: string }>;
      };
      for (const r of res.images || []) {
        if (r.ok) await queueFill(r.src, r);
        else if (r.deferred) queue.push(batch.find((b) => b.src === r.src)!);
        else failed.push(`${r.src}: ${r.error}`);
      }
    }
  } else {
    for (const src of sources) {
      try {
        const bytes = await readImageBytes(src);
        const type = detectImageType(bytes);
        if (type === "svg") await queueFill(src, { svg: Buffer.from(bytes).toString("utf8") });
        else if (type === "png" || type === "jpeg" || type === "gif") await queueFill(src, { base64: Buffer.from(bytes).toString("base64") });
        else failed.push(`${src}: ${type ? type.toUpperCase() : "unknown format"} — Figma needs PNG, JPEG or GIF; connect the browser extension to convert it`);
      } catch (error) {
        failed.push(`${src}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await flush();
  return { placed, failed, via };
}

export function renderImportReport(result: ImportResult, extra: { savedTo: string | null; images: { placed: number; failed: string[]; via: string } | null; url: string }): string {
  const L: string[] = [];
  const c = result.created;
  // An outdated extension is the first thing the user needs to hear, not a line among warnings.
  const outdated = (result.warnings || []).find((w) => w.startsWith("OUTDATED EXTENSION"));
  if (outdated) L.push(`⚠ ${outdated}`, "");
  const unstyled = (result.warnings || []).find((w) => w.startsWith("PAGE NOT FULLY STYLED"));
  if (unstyled) L.push(`⚠ ${unstyled}`, "");
  L.push(`✅ Built "${result.rootName}" (${result.rootId}) from ${extra.url}`);
  L.push(
    `${c.frames} frames · ${c.texts} texts · ${c.images} images · ${c.svgs} vectors — ` +
      `${c.autoLayouts} Auto Layout, ${c.grids} Grid, ${c.absoluteContainers} kept absolute` +
      `${c.absoluteFallbacks ? `, ${c.absoluteFallbacks} switched to exact positions to match the page` : ""} · ${Math.round(result.width)}×${Math.round(result.height)} ` +
      `(page section was ${Math.round(result.sourceHeight)} high) · ${result.elapsedMs} ms`
  );
  if (extra.savedTo) L.push(`Capture saved: ${extra.savedTo}`);
  if (extra.images) {
    L.push(`Images: ${extra.images.placed} placed via ${extra.images.via}${extra.images.failed.length ? `, ${extra.images.failed.length} failed` : ""}`);
    for (const f of extra.images.failed.slice(0, 8)) L.push(`  ⚠ ${f}`);
  }
  if (result.remap) {
    const r = result.remap;
    L.push("", "REMAPPED TO YOUR DESIGN SYSTEM (exact matches only)");
    L.push(`  colours bound to variables: ${r.colors.bound} · text styles applied: ${r.textStyles.applied} · spacing bound: ${r.spacing.bound} · radii bound: ${r.radius.bound}`);
    const list = (label: string, items: Array<{ value: string; count: number }>) => {
      if (items.length) L.push(`  not in your system — ${label}: ${items.slice(0, 12).map((i) => `${i.value}×${i.count}`).join(", ")}`);
    };
    list("colours", r.colors.unmatched);
    list("type", r.textStyles.unmatched);
    list("spacing", r.spacing.unmatched);
    list("radii", r.radius.unmatched);
  }
  if (result.fonts.substituted.length) {
    L.push("", `FONTS NOT INSTALLED (substituted): ${result.fonts.substituted.map((f) => `${f.from} → ${f.to}`).join(", ")}`);
  }
  if (result.warnings.length) {
    L.push("", "WARNINGS");
    for (const w of result.warnings.filter((x) => !x.startsWith("OUTDATED EXTENSION") && !x.startsWith("PAGE NOT FULLY STYLED")).slice(0, 12)) L.push(`  ⚠ ${w}`);
  }
  L.push(
    "",
    "NEXT: export_node_as_image on the root and compare it with the live page; fix what differs. " +
      "Values not in the system were built with the page's own values — ask the user before adding any as tokens (CLAUDE.md §4). " +
      "Hover, transition and scroll data are stored on each layer as plugin data \"web2figma\"."
  );
  return L.join("\n");
}

export function registerBrowserCaptureTools(server: McpServer): void {
  server.tool(
    "browser_status",
    "Check whether the Web-to-Figma browser extension is connected to this channel, which tab is active, whether " +
      "Chrome allows reading it, and whether an element has been picked there. Call before browser_capture: it is " +
      "the only way to find out without waiting for a timeout.",
    {},
    async () => {
      try {
        const result = await sendCommandToBrowser("browser_status", {}, 15_000);
        return textResponse(`✅ Browser extension connected.\n\n${render(result)}`);
      } catch (error) {
        return errorResponse(`reaching the browser extension. ${CONNECT_HINT}`, error);
      }
    }
  );

  server.tool(
    "browser_pick",
    "Ask the user to click the element (section, card, component) to capture in their active Chrome tab. Waits " +
      "until they click, press Esc, or the timeout passes. Tell the user to click in the page before calling. " +
      "Then call browser_capture with scope \"selection\".",
    {
      timeoutSec: z.coerce.number().min(5).max(110).optional().describe("How long to wait for the click (default 60)"),
    },
    async ({ timeoutSec }) => {
      const seconds = timeoutSec ?? 60;
      try {
        const picked = await sendCommandToBrowser("browser_pick", { timeoutSec: seconds }, (seconds + 10) * 1000);
        return textResponse(`✅ Picked.\n\n${render(picked)}\n\nNext: browser_capture with scope "selection".`);
      } catch (error) {
        return errorResponse(`picking an element in the browser. ${CONNECT_HINT}`, error);
      }
    }
  );

  server.tool(
    "browser_capture",
    "Capture a live web page's rendered design through the Web-to-Figma browser extension: every element's " +
      "computed styles and position, design tokens with usage counts (colours incl. oklch resolved to hex, " +
      "gradients, typography, spacing, radii, shadows, blurs), CSS variables, fonts, breakpoints, :hover/:focus/" +
      ":active rules mapped to elements, @keyframes, running animations, and scroll behaviour (GSAP ScrollTrigger " +
      "registry, AOS-style attributes, CSS scroll timelines, and a scroll probe that records reveal classes). " +
      "Prefer this to analyze_html whenever the page is open in Chrome or is JS-rendered: it reads the result, not " +
      "the source. Saves the full capture as JSON and returns a summary plus match_design_tokens arguments; read " +
      "blocks with browser_capture_nodes.",
    {
      scope: z.enum(["page", "selection", "selector"]).optional().describe("page (default), selection (the element picked with browser_pick or the popup), or selector"),
      selector: z.string().optional().describe("CSS selector of the root element when scope is \"selector\""),
      url: z.string().optional().describe("Open this http(s) URL in a new tab and capture it, instead of the active tab"),
      tabId: z.coerce.number().int().optional().describe("Capture this tab id instead of the active tab"),
      maxNodes: z.coerce.number().int().min(50).max(20000).optional().describe("Element limit (default 5000)"),
      autoScroll: coerceBoolean.optional().describe("Scroll the page first so lazy content loads and scroll reveals fire (default true; page scope only)"),
      saveTo: z.string().optional().describe("Absolute path for the capture JSON (default: a timestamped file in the OS temp dir)"),
      width: z.coerce.number().int().min(320).max(3840).optional().describe("Lay the page out at exactly this viewport width before capturing (e.g. 1440, 768, 375). Default: the browser window's own width"),
    },
    async ({ scope, selector, url, tabId, maxNodes, autoScroll, saveTo, width }) => {
      if (scope === "selector" && !selector) {
        return errorResponse("capturing the page", new Error("scope \"selector\" needs a selector."));
      }
      if (url && !/^https?:\/\//i.test(url)) {
        return errorResponse("capturing the page", new Error(`url must be http(s), got "${url}".`));
      }
      if (saveTo && !path.isAbsolute(saveTo)) {
        return errorResponse("capturing the page", new Error(`saveTo must be an absolute path, got "${saveTo}".`));
      }
      let capture: unknown;
      try {
        capture = await sendCommandToBrowser(
          "browser_capture",
          { scope: scope ?? "page", selector, url, tabId, maxNodes, autoScroll, width },
          CAPTURE_TIMEOUT_MS
        );
      } catch (error) {
        return errorResponse(`capturing the page in the browser. ${CONNECT_HINT}`, error);
      }
      try {
        assertCapture(capture);
        const file = saveCapture(capture, saveTo);
        return textResponse(summarizeCapture(capture, file));
      } catch (error) {
        return errorResponse("reading the capture the browser extension returned", error);
      }
    }
  );

  server.tool(
    "browser_capture_to_figma",
    "Capture the live page in Chrome (or load a saved capture with path) and build it in the open Figma file in one " +
      "call: flex → Auto Layout, CSS grid → Grid, block flow → vertical Auto Layout, Hug heights, Fill widths, " +
      "semantic layer names, images fetched and converted by the browser extension, SVG icons as vectors. Colours, " +
      "text styles, spacing and radii are bound to the file's existing variables and styles on exact matches; the " +
      "rest keep the page's values and are listed. The capture goes straight to the plugin — it never passes through " +
      "the conversation. Use scope \"selector\"/\"selection\" for one section of a long page.",
    {
      scope: z.enum(["page", "selection", "selector"]).optional().describe("page (default), selection (picked element) or selector"),
      selector: z.string().optional().describe("CSS selector when scope is \"selector\""),
      url: z.string().optional().describe("Open this http(s) URL first instead of using the active tab"),
      tabId: z.coerce.number().int().optional().describe("Capture this tab instead of the active one"),
      path: z.string().optional().describe("Absolute path of a saved capture JSON to import instead of capturing"),
      parentId: z.string().optional().describe("Build inside this frame or page (default: the current page, right of existing content)"),
      maxNodes: z.coerce.number().int().min(50).max(6000).optional().describe("Element limit for the capture (default 2500)"),
      autoScroll: coerceBoolean.optional().describe("Scroll the page first so lazy images and reveals load (default true)"),
      remap: coerceBoolean.optional().describe("Bind to existing variables and text styles (default true)"),
      images: coerceBoolean.optional().describe("Fetch and place images (default true)"),
      width: z.coerce.number().int().min(320).max(3840).optional().describe("Viewport width the page is laid out at before capture (default 1440, the Desktop breakpoint). Use 768 for Tablet, 375 or 320 for Mobile"),
      fidelity: coerceBoolean.optional().describe("After building, switch any Auto Layout frame that does not match the page to exact positions (default true)"),
    },
    async ({ scope, selector, url, tabId, path: file, parentId, maxNodes, autoScroll, remap, images, width, fidelity }) => {
      if (scope === "selector" && !selector) {
        return errorResponse("importing the page", new Error("scope \"selector\" needs a selector."));
      }
      if (url && !/^https?:\/\//i.test(url)) {
        return errorResponse("importing the page", new Error(`url must be http(s), got "${url}".`));
      }
      let capture: Capture;
      let savedTo: string | null = null;
      try {
        if (file) {
          capture = loadCapture(file);
          savedTo = file;
        } else {
          const raw = await sendCommandToBrowser(
            "browser_capture",
            { scope: scope ?? "page", selector, url, tabId, maxNodes: maxNodes ?? 2500, autoScroll, width: width ?? 1440 },
            CAPTURE_TIMEOUT_MS
          );
          assertCapture(raw);
          capture = raw;
          savedTo = saveCapture(capture, undefined);
        }
      } catch (error) {
        return errorResponse(file ? "loading the saved capture" : `capturing the page in the browser. ${CONNECT_HINT}`, error);
      }

      let result: ImportResult;
      try {
        result = (await runWebImport("import", { capture: slimForImport(capture), parentId, remap: remap !== false, fidelity: fidelity !== false }, 115_000)) as ImportResult;
      } catch (error) {
        return errorResponse(
          `building the capture in Figma (capture saved at ${savedTo}; retry with path, or a smaller scope). ` +
            "The Figma plugin must be open on this channel",
          error
        );
      }

      let imageReport: { placed: number; failed: string[]; via: string } | null = null;
      if (images !== false && result.images && result.images.length) {
        try {
          imageReport = await placeImages(result.images, !file);
        } catch (error) {
          imageReport = { placed: 0, failed: [error instanceof Error ? error.message : String(error)], via: file ? "server download" : "browser extension" };
        }
      }
      return textResponse(renderImportReport(result, { savedTo, images: imageReport, url: capture.url }));
    }
  );

  server.tool(
    "browser_capture_nodes",
    "Read one block of a saved browser capture for building it in Figma: each element's size and position, full " +
      "computed style, text (with inline runs in order), attributes, images, SVG markup, pseudo-elements, hover " +
      "rules and scroll hints, indented by depth. Start from an id in browser_capture's OUTLINE.",
    {
      path: z.string().describe("Absolute path of the capture JSON (the \"Saved:\" line from browser_capture)"),
      nodeId: z.string().optional().describe("Root of the subtree, e.g. \"n42\" (default: the capture's root)"),
      depth: z.coerce.number().int().min(0).max(12).optional().describe("Levels below nodeId to include (default 3)"),
    },
    async ({ path: file, nodeId, depth }) => {
      try {
        const capture = loadCapture(file);
        return textResponse(renderNodes(capture, nodeId, depth ?? 3));
      } catch (error) {
        return errorResponse("reading the saved capture", error);
      }
    }
  );
}
