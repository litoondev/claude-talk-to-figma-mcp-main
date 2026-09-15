/**
 * HTML / URL → Figma import tools.
 *
 *   analyze_html         — read a page (URL or local file) and report its sections,
 *                          text, colours, typography, spacing and layout, with a
 *                          Grid-or-Auto-Layout recommendation per container.
 *   match_design_tokens  — compare those values with the Figma file's variables and
 *                          styles: what to bind, and what is not in the system.
 *
 * Building is done with the existing creation, layout and variable tools, in the
 * order the Html_Import skill lays out. These two tools only make sure that build
 * starts from what the page actually declares and what the file actually has.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceJson } from "../utils/schema-helpers";
import { textResponse, errorResponse } from "../utils/respond";
import { absolutizeCssUrls, analyzeHtml, AssetEntry, findStylesheetHrefs, HtmlAnalysis, LayoutHint } from "../utils/html-analysis";
import {
  DesignSystemSnapshot,
  describeTypography,
  matchDesignTokens,
  renderImportNotes,
  TokenMatchResult,
} from "../utils/token-matching";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 3_000_000;
const MAX_CSS_CHARS = 1_500_000;
const MAX_STYLESHEETS = 8;

export interface LoadedHtml {
  kind: "url" | "file";
  location: string;
  html: string;
  stylesheets: Array<{ href: string; css: string }>;
  warnings: string[];
}

async function fetchText(url: string, maxChars: number): Promise<{ text: string; finalUrl: string; truncated: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "claude-talk-to-figma-mcp (html import)", Accept: "text/html,text/css,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const text = await response.text();
    return { text: text.slice(0, maxChars), finalUrl: response.url || url, truncated: text.length > maxChars };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${url} did not respond within ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load a page and its linked stylesheets. Local files are limited to .html/.htm
 * and .css, so this cannot be pointed at arbitrary files on the machine.
 */
export async function loadHtmlSource(source: string, includeStylesheets = true): Promise<LoadedHtml> {
  const trimmed = source.trim();
  const warnings: string[] = [];
  const stylesheets: Array<{ href: string; css: string }> = [];

  if (/^https?:\/\//i.test(trimmed)) {
    const page = await fetchText(trimmed, MAX_HTML_CHARS);
    if (page.truncated) warnings.push(`The page is larger than ${MAX_HTML_CHARS} characters; only the start was read.`);
    if (includeStylesheets) {
      const hrefs = findStylesheetHrefs(page.text);
      for (const href of hrefs.slice(0, MAX_STYLESHEETS)) {
        try {
          const sheetUrl = new URL(href, page.finalUrl).toString();
          const sheet = await fetchText(sheetUrl, MAX_CSS_CHARS);
          stylesheets.push({ href: sheetUrl, css: absolutizeCssUrls(sheet.text, sheetUrl) });
        } catch (error) {
          warnings.push(`Stylesheet not loaded: ${href} (${error instanceof Error ? error.message : String(error)})`);
        }
      }
      if (hrefs.length > MAX_STYLESHEETS) warnings.push(`${hrefs.length - MAX_STYLESHEETS} more stylesheets were not loaded.`);
    }
    return { kind: "url", location: page.finalUrl, html: page.text, stylesheets, warnings };
  }

  const expanded = trimmed.startsWith("~") ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
  if (!path.isAbsolute(expanded)) {
    throw new Error(`"${source}" is neither an http(s) URL nor an absolute file path.`);
  }
  if (!/\.html?$/i.test(expanded)) throw new Error(`Only .html or .htm files can be read, not "${path.basename(expanded)}".`);
  const html = (await fs.promises.readFile(expanded, "utf8")).slice(0, MAX_HTML_CHARS);

  if (includeStylesheets) {
    const hrefs = findStylesheetHrefs(html);
    for (const href of hrefs.slice(0, MAX_STYLESHEETS)) {
      try {
        if (/^(https?:)?\/\//i.test(href)) {
          const sheetUrl = href.startsWith("//") ? `https:${href}` : href;
          const sheet = await fetchText(sheetUrl, MAX_CSS_CHARS);
          stylesheets.push({ href, css: absolutizeCssUrls(sheet.text, sheetUrl) });
          continue;
        }
        const file = path.resolve(path.dirname(expanded), href.split(/[?#]/)[0]);
        if (!/\.css$/i.test(file)) throw new Error("not a .css file");
        stylesheets.push({ href, css: absolutizeCssUrls((await fs.promises.readFile(file, "utf8")).slice(0, MAX_CSS_CHARS), file) });
      } catch (error) {
        warnings.push(`Stylesheet not loaded: ${href} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }
  return { kind: "file", location: expanded, html, stylesheets, warnings };
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

function expandHome(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("~") ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
}

/** The image format, read from the bytes rather than trusted from a name or header. */
export function detectImageType(bytes: Uint8Array): "png" | "jpeg" | "gif" | "webp" | "svg" | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 6 && ascii(0, 3) === "GIF") return "gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  const head = Buffer.from(bytes.slice(0, 512)).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

/**
 * The bytes of an image listed under IMAGES & ICONS. A local file must be an
 * image inside the imported .html file's folder, so this cannot be pointed at
 * arbitrary files on the machine.
 */
export async function readImageBytes(source: string, pageSource?: string): Promise<Uint8Array> {
  const value = source.trim();

  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    if (comma === -1) throw new Error("The data: URI has no data.");
    const meta = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    return meta.includes(";base64")
      ? new Uint8Array(Buffer.from(payload, "base64"))
      : new Uint8Array(Buffer.from(decodeURIComponent(payload), "utf8"));
  }

  if (/^https?:\/\//i.test(value)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(value, {
        headers: { "User-Agent": "claude-talk-to-figma-mcp (html import)", Accept: "image/*,*/*;q=0.5" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${value} returned HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_IMAGE_BYTES) {
        throw new Error(`The image is ${(declared / 1048576).toFixed(1)} MB; Figma plugins accept up to 5 MB.`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${value} did not respond within ${FETCH_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  if (!pageSource || /^https?:\/\//i.test(pageSource.trim())) {
    throw new Error(`"${source}" is a file path, so pageSource must be the absolute path of the .html file it came from.`);
  }
  const page = expandHome(pageSource);
  if (!path.isAbsolute(page) || !/\.html?$/i.test(page)) {
    throw new Error(`pageSource must be the absolute path of the imported .html file, not "${pageSource}".`);
  }
  const file = path.resolve(expandHome(value));
  const relative = path.relative(path.dirname(page), file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `"${file}" is outside the folder of ${path.basename(page)}; only images next to or below the imported page can be read.`
    );
  }
  if (!IMAGE_FILE.test(file)) throw new Error(`"${path.basename(file)}" is not a .png, .jpg, .gif or .webp image.`);
  return new Uint8Array(await fs.promises.readFile(file));
}

function section(title: string): string {
  return `\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`;
}

function describeLayout(layout: LayoutHint): string {
  if (layout.kind === "grid") return `grid, ${layout.columns ?? "auto-fit"} columns${layout.columnGap ? `, gap ${layout.columnGap}` : ""}`;
  return `flex ${layout.direction}${layout.wrap ? " wrap" : ""}${layout.columnGap ? `, gap ${layout.columnGap}` : ""}`;
}

/** The token lists match_design_tokens takes, most used first. */
export function tokensForMatching(analysis: HtmlAnalysis) {
  const spacing = new Map<number, number>();
  for (const t of [...analysis.tokens.gaps, ...analysis.tokens.padding]) spacing.set(t.value, (spacing.get(t.value) ?? 0) + t.count);
  return {
    colors: analysis.tokens.colors.filter((c) => c.alpha === 1).slice(0, 24).map((c) => c.hex),
    typography: [...analysis.tokens.typography]
      .sort((a, b) => b.count - a.count)
      .slice(0, 16)
      .map((t) => ({
        label: t.selectors[0],
        fontFamily: t.fontFamily,
        fontSize: t.fontSize,
        fontWeight: t.fontWeight,
        lineHeight: t.lineHeight,
        letterSpacing: t.letterSpacing,
      })),
    spacing: [...spacing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([value]) => value),
    radii: analysis.tokens.radii.slice(0, 10).map((t) => t.value),
  };
}

function describeAssetSource(asset: AssetEntry): string {
  if (asset.kind === "inline-svg") {
    return `inline SVG, ${asset.svgMarkup?.length ?? 0} chars of markup (pass svgMarkupFor: ["${asset.id}"])`;
  }
  if (!asset.source) return "source not found";
  if (asset.source.startsWith("data:")) {
    const type = asset.source.slice(5, Math.max(5, asset.source.search(/[;,]/)));
    return `data URI (${type || "unknown type"}, ${asset.source.length} chars)`;
  }
  return asset.source;
}

export function renderHtmlAnalysis(
  analysis: HtmlAnalysis,
  loaded: Pick<LoadedHtml, "location" | "stylesheets" | "warnings">,
  options: { svgMarkupFor?: string[] } = {}
): string {
  const lines: string[] = [];
  lines.push(`HTML analysis — "${analysis.title ?? "untitled page"}"`);
  lines.push(
    `Source: ${loaded.location} · ${loaded.stylesheets.length} linked stylesheet(s) · ${analysis.ruleCount} CSS rules ` +
      `(${analysis.mediaRuleCount} inside @media) · root font size ${analysis.rootFontSize}px` +
      (analysis.baseFontFamily ? ` · base font ${analysis.baseFontFamily}` : "")
  );
  lines.push("Values are what the markup and CSS declare — there is no browser layout here.");
  for (const warning of loaded.warnings) lines.push(`⚠ ${warning}`);

  lines.push(section("PAGE OUTLINE — build top to bottom, one frame per section"));
  for (const s of analysis.sections) {
    lines.push(`${s.index}. ${s.element}${s.label ? ` — "${s.label}"` : ""}`);
    const counts = Object.entries(s.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(" · ");
    if (counts) lines.push(`   contains: ${counts}`);
    lines.push(`   section: ${s.recommendation}`);
    for (const g of s.groups) {
      const alike = g.repeats > 1 ? ` (${g.repeats} alike)` : "";
      lines.push(`   • ${g.count} × ${g.itemSignature} in ${g.container}${alike} → ${g.recommendation}`);
      for (const r of g.responsive) lines.push(`       at ${r.media}: ${describeLayout(r.layout)}`);
    }
  }
  if (analysis.sections.length === 0) lines.push("  No sections found.");
  if (analysis.skipped.length) {
    lines.push("\n  Not built (not visible in the page flow):");
    for (const item of analysis.skipped.slice(0, 10)) lines.push(`   – ${item.element}: ${item.reason}`);
    if (analysis.skipped.length > 10) lines.push(`   – … ${analysis.skipped.length - 10} more`);
  }

  lines.push(section("COLOURS — most used first"));
  for (const c of analysis.tokens.colors.slice(0, 24)) {
    const uses = Object.entries(c.uses).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ");
    lines.push(`  ${c.hex}${c.alpha < 1 ? ` @${Math.round(c.alpha * 100)}%` : ""}  ×${c.count}  (${uses})`);
  }

  lines.push(section("TYPOGRAPHY — largest first"));
  for (const t of analysis.tokens.typography.slice(0, 20)) {
    lines.push(
      `  ${t.fontFamily ?? "?"}${t.familyInherited ? " (inherited)" : ""} ${t.fontSize}px ${t.fontWeight ?? 400}` +
        `  lh ${t.lineHeight ?? "normal"}  ls ${t.letterSpacing ?? 0}px  — ${t.selectors.slice(0, 3).join(", ")}`
    );
  }

  const tally = (entries: Array<{ value: number; count: number }>) =>
    entries.length ? entries.slice(0, 12).map((e) => `${e.value} (×${e.count})`).join(", ") : "none";
  lines.push(section("SPACING & RADII"));
  lines.push(`  Gaps:    ${tally(analysis.tokens.gaps)}`);
  lines.push(`  Padding: ${tally(analysis.tokens.padding)}`);
  lines.push(`  Margin:  ${tally(analysis.tokens.margin)}`);
  lines.push(`  Radii:   ${tally(analysis.tokens.radii)}`);

  lines.push(section("TEXT CONTENT — use this copy exactly"));
  for (const t of analysis.texts) lines.push(`  (${t.tag}) ${t.text}`);
  if (analysis.textsTruncated) lines.push("  … more text not listed — raise maxTexts to see it");

  lines.push(section("IMAGES & ICONS — place every one"));
  for (const asset of analysis.assets.slice(0, 80)) {
    const size = asset.width !== null || asset.height !== null ? `${asset.width ?? "?"}×${asset.height ?? "?"}` : "size not declared";
    lines.push(`  [${asset.id}] §${asset.section ?? "–"} ${asset.kind} ${asset.element} — ${describeAssetSource(asset)} — alt "${asset.alt}" — ${size}`);
  }
  if (analysis.assets.length > 80) lines.push(`  … ${analysis.assets.length - 80} more`);
  if (analysis.assets.length === 0) lines.push("  None found.");

  const wanted = options.svgMarkupFor ?? [];
  if (wanted.length) {
    lines.push(section("SVG MARKUP"));
    for (const id of wanted) {
      const asset = analysis.assets.find((a) => a.id === id);
      lines.push(asset?.svgMarkup ? `  [${id}] ${asset.svgMarkup}` : `  [${id}] not an inline SVG in this report`);
    }
  }

  lines.push(section("NEXT STEP"));
  lines.push("  Call match_design_tokens with exactly these values before building:");
  lines.push(`  ${JSON.stringify(tokensForMatching(analysis))}`);
  return lines.join("\n");
}

export function renderTokenMatch(result: TokenMatchResult): string {
  const lines: string[] = [];
  const total =
    result.colors.matched.length + result.colors.missing.length +
    result.typography.matched.length + result.typography.near.length + result.typography.missing.length +
    result.spacing.matched.length + result.spacing.missing.length +
    result.radii.matched.length + result.radii.missing.length;
  const found = result.colors.matched.length + result.typography.matched.length + result.spacing.matched.length + result.radii.matched.length;
  lines.push(`Design-system match — ${found} of ${total} values found in this file.`);

  lines.push(section("USE FROM YOUR DESIGN SYSTEM — bind these, do not type the value"));
  const mode = (m?: string) => (m ? ` [${m}]` : "");
  const alts = (a: string[]) => (a.length ? ` (also: ${a.join(", ")})` : "");
  for (const c of result.colors.matched) lines.push(`  Colour ${c.value} → ${c.kind} "${c.name}"${mode(c.mode)} id ${c.id}${alts(c.alternatives)}`);
  for (const t of result.typography.matched) lines.push(`  Text ${describeTypography(t.token)} → text style "${t.style.name}" id ${t.style.id}`);
  for (const s of result.spacing.matched) lines.push(`  Spacing ${s.value} → variable "${s.name}"${mode(s.mode)} id ${s.id}${alts(s.alternatives)}`);
  for (const r of result.radii.matched) lines.push(`  Radius ${r.value} → variable "${r.name}"${mode(r.mode)} id ${r.id}${alts(r.alternatives)}`);
  if (found === 0) lines.push("  Nothing matched.");

  if (result.typography.near.length) {
    lines.push(section("CLOSE, NOT EXACT — build with the HTML values"));
    for (const n of result.typography.near) {
      lines.push(`  ${describeTypography(n.token)} ~ "${n.style.name}": ${n.differences.join(", ")}`);
    }
  }

  lines.push(section("IMPORT NOTES — put this in the Import Notes frame and the final summary"));
  lines.push(renderImportNotes(result));
  lines.push("\nDo not create variables or styles for the missing values unless the user asks.");
  return lines.join("\n");
}

export function registerHtmlImportTools(server: McpServer): void {
  server.tool(
    "analyze_html",
    "Read an HTML page (http/https URL, or an absolute path to a local .html file) before rebuilding it in Figma. " +
      "Returns the page outline section by section, the exact text copy, and the colours, typography, spacing and " +
      "radii the CSS declares (linked stylesheets, <style> blocks, inline styles, :root variables and rem resolved), " +
      "plus a layout recommendation per container: CSS grid or equal wrapping items → Figma Grid, flex → Auto Layout, " +
      "and every visible image and icon with its absolute source, alt text and declared size (inline SVGs by id; " +
      "pass svgMarkupFor to get their self-contained markup). " +
      "Ends with the token lists to pass to match_design_tokens. Read-only; nothing in Figma changes. " +
      "For an HTML→Figma request, load the Html_Import skill with figma_skill first.",
    {
      source: z.string().describe("http(s) URL, or an absolute path to a .html/.htm file (~ allowed)."),
      maxTexts: z.number().int().positive().max(400).optional().describe("How many text items to list. Default 80."),
      includeStylesheets: z.boolean().optional().describe("Load linked stylesheets. Default true."),
      svgMarkupFor: z
        .array(z.string())
        .optional()
        .describe("Asset ids from IMAGES & ICONS (e.g. [\"asset-3\"]) whose full inline SVG markup to print, ready for set_svg."),
    },
    async ({ source, maxTexts, includeStylesheets, svgMarkupFor }) => {
      try {
        const loaded = await loadHtmlSource(source, includeStylesheets ?? true);
        const analysis = analyzeHtml(loaded.html, loaded.stylesheets.map((s) => s.css), {
          maxTexts,
          baseUrl: loaded.location,
        });
        return textResponse(renderHtmlAnalysis(analysis, loaded, { svgMarkupFor }));
      } catch (error) {
        return errorResponse("analyzing HTML", error);
      }
    }
  );

  server.tool(
    "match_design_tokens",
    "Compare design values (usually the lists analyze_html prints) with the open Figma file's own design system: " +
      "colour variables and colour styles, text styles (family, size, weight, line height, letter spacing), and " +
      "spacing and radius variables, respecting each variable's scopes. Splits them into what to bind from the " +
      "system, what is close but not exact, and what is not in the system. Writes the Import Notes text listing " +
      "what had to be built with the HTML's own values. Never creates tokens.",
    {
      colors: coerceJson(z.array(z.string())).optional().describe("Hex colours, e.g. [\"#030712\", \"#f97316\"]"),
      typography: coerceJson(
        z.array(
          z.object({
            label: z.string().optional(),
            fontFamily: z.string().nullable().optional(),
            fontSize: z.coerce.number(),
            fontWeight: z.coerce.number().nullable().optional(),
            lineHeight: z.union([z.string(), z.number()]).nullable().optional(),
            letterSpacing: z.coerce.number().nullable().optional(),
          })
        )
      ).optional().describe("Type combinations: fontFamily, fontSize px, fontWeight, lineHeight ('24px' or '150%'), letterSpacing px"),
      spacing: coerceJson(z.array(z.coerce.number())).optional().describe("Gap and padding values in px"),
      radii: coerceJson(z.array(z.coerce.number())).optional().describe("Corner radius values in px"),
    },
    async ({ colors, typography, spacing, radii }) => {
      try {
        const ds = (await sendCommandToFigma("get_design_system", {
          scope: "page",
          includeVariables: true,
          includeComponents: false,
          sampleLimit: 50,
        })) as DesignSystemSnapshot;
        const result = matchDesignTokens({ colors, typography, spacing, radii }, ds);
        return textResponse(renderTokenMatch(result));
      } catch (error) {
        return errorResponse(
          "matching design tokens (the Figma plugin must be connected — run join_channel first)",
          error
        );
      }
    }
  );
  server.tool(
    "place_html_image",
    "Put an image from analyze_html's IMAGES & ICONS list into a Figma node as an image fill. The server gets the " +
      "bytes itself — downloads the URL, reads the local file (only .png/.jpg/.gif/.webp inside the imported .html " +
      "file's folder) or decodes the data: URI — and sends them to the plugin. So it works for any image host and for " +
      "local .html imports, unlike set_image_fill with a URL, which the plugin's network rules may refuse. Create the " +
      "frame or rectangle at the image's exact size first, then call this with its nodeId. SVG sources are refused: " +
      "use set_svg with the markup instead.",
    {
      nodeId: z.string().describe("The frame or rectangle to fill, already at the image's exact size"),
      source: z.string().describe("The asset's source exactly as IMAGES & ICONS lists it: absolute URL, absolute file path, or data: URI"),
      pageSource: z
        .string()
        .optional()
        .describe("The URL or .html path given to analyze_html. Required when source is a file path."),
      scaleMode: z
        .enum(["FILL", "FIT", "CROP", "TILE"])
        .optional()
        .describe("FILL (default) like object-fit: cover; FIT like object-fit: contain; TILE for repeating backgrounds."),
    },
    async ({ nodeId, source, pageSource, scaleMode }) => {
      try {
        const bytes = await readImageBytes(source, pageSource);
        if (bytes.length > MAX_IMAGE_BYTES) {
          throw new Error(`The image is ${(bytes.length / 1048576).toFixed(1)} MB; Figma plugins accept up to 5 MB. Compress it first.`);
        }
        const type = detectImageType(bytes);
        if (type === "svg") throw new Error("This source is an SVG, which cannot be an image fill. Use set_svg with its markup instead.");
        if (!type) throw new Error("The source is not a PNG, JPEG, GIF or WebP image.");
        const mode = scaleMode ?? "FILL";
        const result = (await sendCommandToFigma(
          "set_image",
          { nodeId, imageData: Buffer.from(bytes).toString("base64"), scaleMode: mode },
          60000
        )) as { name?: string } | undefined;
        const from = source.trim().startsWith("data:") ? "a data URI" : source.trim();
        return textResponse(
          `Placed ${type.toUpperCase()} image (${Math.round(bytes.length / 1024)} KB, ${mode}) on "${result?.name ?? nodeId}" from ${from}.`
        );
      } catch (error) {
        return errorResponse("placing HTML image", error);
      }
    }
  );
}
