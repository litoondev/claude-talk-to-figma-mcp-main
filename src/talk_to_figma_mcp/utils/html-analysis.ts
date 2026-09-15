/**
 * Read what an HTML page declares — structure, text, colours, type, spacing and
 * layout — so it can be rebuilt in Figma against the file's own design system.
 *
 * There is no browser here, so nothing is *computed*: no cascade by specificity,
 * no inheritance beyond the page's base font family, no layout boxes. What comes
 * back is what the markup and stylesheets declare, which is also what a designer
 * reads. Values that only exist after layout (percentages, `auto`, viewport
 * units) are left out rather than guessed.
 *
 * Deliberately dependency-free: a tolerant tag scanner and a small CSS parser
 * cover real-world pages well enough for token and structure extraction.
 */

import * as path from "path";

// ── CSS ─────────────────────────────────────────────────────────────────────

export interface CssRule {
  selector: string;
  /** The @media / @container condition this rule sits under, or null for base styles. */
  media: string | null;
  declarations: Record<string, string>;
}

/** Split on a separator that is not inside parentheses, brackets or quotes. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Split a CSS value on whitespace outside parentheses: `2rem clamp(1rem, 2vw, 3rem)` → 2 parts. */
export function splitSpaces(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/** Declarations of one block. Nested blocks (CSS nesting) are skipped. */
export function parseDeclarations(body: string): Record<string, string> {
  let flat = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) flat += ch;
  }

  const out: Record<string, string> = {};
  for (const part of splitTopLevel(flat, ";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    if (!/^-{0,2}[a-z][\w-]*$/.test(property)) continue;
    const value = part.slice(colon + 1).replace(/!important\s*$/i, "").trim();
    if (value) out[property] = value;
  }
  return out;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

function parseCssBlock(text: string, media: string | null, rules: CssRule[]): void {
  let i = 0;
  while (i < text.length) {
    const brace = text.indexOf("{", i);
    if (brace === -1) return;
    let prelude = text.slice(i, brace);
    // Statement at-rules (@import …; @charset …;) end at a semicolon before the block.
    const lastSemicolon = prelude.lastIndexOf(";");
    if (lastSemicolon !== -1) prelude = prelude.slice(lastSemicolon + 1);
    prelude = prelude.trim();
    const close = matchingBrace(text, brace);
    const body = text.slice(brace + 1, close);

    if (prelude.startsWith("@")) {
      const name = (/^@([\w-]+)/.exec(prelude)?.[1] ?? "").toLowerCase();
      if (name === "media" || name === "container") {
        const condition = prelude.slice(name.length + 1).trim();
        parseCssBlock(body, media ? `${media} and ${condition}` : condition, rules);
      } else if (name === "supports" || name === "layer" || name === "document") {
        parseCssBlock(body, media, rules);
      }
      // @font-face, @keyframes, @page …: no layout or token worth reading.
    } else if (prelude) {
      const declarations = parseDeclarations(body);
      if (Object.keys(declarations).length > 0) {
        for (const selector of splitTopLevel(prelude, ",")) {
          const trimmed = selector.trim();
          if (trimmed) rules.push({ selector: trimmed, media, declarations });
        }
      }
    }
    i = close + 1;
  }
}

export function parseCss(css: string): CssRule[] {
  const rules: CssRule[] = [];
  parseCssBlock(css.replace(/\/\*[\s\S]*?\*\//g, ""), null, rules);
  return rules;
}

/** Replace `var(--name, fallback)` with the page's custom property values. */
export function resolveVars(value: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 8 || !value.includes("var(")) return value;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf("var(", i);
    if (start === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, start);
    let parens = 0;
    let end = start + 3;
    for (; end < value.length; end++) {
      if (value[end] === "(") parens++;
      else if (value[end] === ")") {
        parens--;
        if (parens === 0) break;
      }
    }
    const [name, ...fallback] = splitTopLevel(value.slice(start + 4, end), ",");
    const key = name.trim().toLowerCase();
    const replacement = vars[key] !== undefined ? vars[key] : fallback.join(",").trim();
    out += resolveVars(replacement, vars, depth + 1);
    i = end + 1;
  }
  return out;
}

/** A length in px, or null when it only exists after layout (%, vw, auto). */
export function toPx(raw: string, rootPx: number, emPx: number = rootPx): number | null {
  const value = raw.trim().toLowerCase();
  const fn = /^(clamp|min|max)\((.*)\)$/.exec(value);
  if (fn) {
    const args = splitTopLevel(fn[2], ",")
      .map((arg) => toPx(arg, rootPx, emPx))
      .filter((n): n is number => n !== null);
    if (args.length === 0) return null;
    // clamp(min, preferred, max): a desktop design sits at the maximum.
    if (fn[1] === "clamp") return args[args.length - 1];
    return fn[1] === "min" ? Math.min(...args) : Math.max(...args);
  }
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value);
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (!match[2]) return n === 0 ? 0 : null;
  const px = match[2] === "px" ? n : match[2] === "rem" ? n * rootPx : n * emPx;
  return Math.round(px * 100) / 100;
}

// ── Colours ─────────────────────────────────────────────────────────────────

export interface ColorValue {
  hex: string;
  alpha: number;
}

const NAMED_COLORS: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  gray: "#808080",
  grey: "#808080",
  orange: "#ffa500",
  yellow: "#ffff00",
  purple: "#800080",
};

const COLOR_IN_VALUE = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b(?:white|black|red|green|blue|gray|grey|orange|yellow|purple)\b/g;

const COLOR_PROPERTIES = /^(color|background(-color|-image)?|background|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|text-decoration-color|caret-color|accent-color|column-rule(-color)?)$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255];
}

export function parseColor(raw: string): ColorValue | null {
  const value = raw.trim().toLowerCase();
  if (value.startsWith("#")) {
    let hex = value.slice(1);
    if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
    if (hex.length <= 4) hex = hex.split("").map((c) => c + c).join("");
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { hex: "#" + hex.slice(0, 6), alpha: round2(alpha) };
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(value);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const alphaPart = parts[3];
    const alpha =
      alphaPart === undefined ? 1 : alphaPart.endsWith("%") ? parseFloat(alphaPart) / 100 : parseFloat(alphaPart);
    let rgb: number[];
    if (fn[1].startsWith("rgb")) {
      rgb = parts.slice(0, 3).map((p) => (p.endsWith("%") ? parseFloat(p) * 2.55 : parseFloat(p)));
    } else {
      rgb = hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100);
    }
    if ([...rgb, alpha].some((n) => Number.isNaN(n))) return null;
    const hex = rgb
      .map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0"))
      .join("");
    return { hex: "#" + hex, alpha: round2(alpha) };
  }
  return NAMED_COLORS[value] ? { hex: NAMED_COLORS[value], alpha: 1 } : null;
}

// ── HTML ────────────────────────────────────────────────────────────────────

export interface HtmlElement {
  tag: string;
  /** The tag as written: SVG is case-sensitive (linearGradient, foreignObject). */
  name: string;
  /** Attribute names lower-cased, for lookups. */
  attrs: Record<string, string>;
  /** Attributes as written and in order, for re-serialising SVG (viewBox). */
  attrList: Array<[string, string]>;
  children: Array<HtmlElement | string>;
  parent: HtmlElement | null;
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  middot: "·", bull: "•", times: "×", euro: "€", pound: "£", deg: "°",
};

/** Decode numeric and common named entities; unknown names are left as written. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return NAMED_ENTITIES[lower] ?? entity;
  });
}

function parseAttributeList(raw: string): Array<[string, string]> {
  const list: Array<[string, string]> = [];
  const pattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    list.push([match[1], decodeEntities(match[2] ?? match[3] ?? match[4] ?? "")]);
  }
  return list;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [name, value] of parseAttributeList(raw)) attrs[name.toLowerCase()] = value;
  return attrs;
}

export interface ParsedHtml {
  root: HtmlElement;
  styles: string[];
  title: string | null;
}

/**
 * A tolerant tag scanner: enough structure to find sections, repeated items and
 * text. Script, noscript and template content is ignored entirely.
 */
export function parseHtml(html: string): ParsedHtml {
  const root: HtmlElement = { tag: "#document", name: "#document", attrs: {}, attrList: [], children: [], parent: null };
  const styles: string[] = [];
  let title: string | null = null;
  let current = root;

  const pattern =
    /<!--[\s\S]*?-->|<![^>]*>|<(script|style|noscript|template|textarea|title)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    if (match[1]) {
      const tag = match[1].toLowerCase();
      if (tag === "style") styles.push(match[3]);
      else if (tag === "title") title = decodeEntities(match[3]).trim() || title;
      else if (tag === "textarea") {
        const el: HtmlElement = {
          tag,
          name: match[1],
          attrs: parseAttributes(match[2]),
          attrList: parseAttributeList(match[2]),
          children: [decodeEntities(match[3])],
          parent: current,
        };
        current.children.push(el);
      }
      continue;
    }
    if (match[4]) {
      const tag = match[4].toLowerCase();
      let node: HtmlElement | null = current;
      while (node && node.tag !== tag) node = node.parent;
      if (node && node.parent) current = node.parent;
      continue;
    }
    if (match[5]) {
      const tag = match[5].toLowerCase();
      const rawAttrs = match[6] ?? "";
      const selfClosing = /\/\s*$/.test(rawAttrs);
      // The two end tags authors most often omit.
      if ((tag === "p" || tag === "li") && current.tag === tag && current.parent) current = current.parent;
      const cleanAttrs = rawAttrs.replace(/\/\s*$/, "");
      const el: HtmlElement = {
        tag,
        name: match[5],
        attrs: parseAttributes(cleanAttrs),
        attrList: parseAttributeList(cleanAttrs),
        children: [],
        parent: current,
      };
      current.children.push(el);
      if (!VOID_TAGS.has(tag) && !selfClosing) current = el;
      continue;
    }
    if (match[7] && match[7].trim()) current.children.push(decodeEntities(match[7]));
  }

  return { root, styles, title };
}

/** `<link rel="stylesheet" href>` targets, in document order. */
export function findStylesheetHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const pattern = /<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const attrs = parseAttributes(match[1]);
    if ((attrs.rel ?? "").toLowerCase().split(/\s+/).includes("stylesheet") && attrs.href) hrefs.push(attrs.href);
  }
  return hrefs;
}

export function elementChildren(el: HtmlElement): HtmlElement[] {
  return el.children.filter((c): c is HtmlElement => typeof c !== "string");
}

function classList(el: HtmlElement): string[] {
  return (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
}

export function textContent(el: HtmlElement): string {
  if (el.tag === "svg") return "";
  const parts: string[] = [];
  for (const child of el.children) parts.push(typeof child === "string" ? child : textContent(child));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function describeElement(el: HtmlElement): string {
  const id = el.attrs.id ? `#${el.attrs.id}` : "";
  const classes = classList(el).slice(0, 3).map((c) => `.${c}`).join("");
  return `<${el.tag}${id}${classes}>`;
}

function signature(el: HtmlElement): string {
  const classes = classList(el).slice().sort().slice(0, 2).map((c) => `.${c}`).join("");
  return `${el.tag}${classes}`;
}

function findElement(el: HtmlElement, tag: string): HtmlElement | null {
  for (const child of elementChildren(el)) {
    if (child.tag === tag) return child;
    const found = findElement(child, tag);
    if (found) return found;
  }
  return null;
}

// ── Selector matching (subject compound only) ───────────────────────────────

interface Subject {
  tag: string | null;
  id: string | null;
  classes: string[];
}

/**
 * The element a selector styles, reduced to its last compound. Rules with
 * pseudo-classes or pseudo-elements describe states or generated content, not
 * the default layout, so they are not matched to elements.
 */
export function subjectOf(selector: string): Subject | null {
  const cleaned = selector.replace(/\[[^\]]*\]/g, "").trim();
  if (!cleaned || cleaned.includes(":")) return null;
  const compounds = cleaned.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  const last = compounds[compounds.length - 1];
  const tag = /^([a-zA-Z][\w-]*)/.exec(last)?.[1]?.toLowerCase() ?? null;
  const id = /#([\w-]+)/.exec(last)?.[1] ?? null;
  const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  if (!tag && !id && classes.length === 0) return null;
  return { tag, id, classes };
}

function elementMatches(el: HtmlElement, subject: Subject): boolean {
  if (subject.tag && subject.tag !== el.tag) return false;
  if (subject.id && el.attrs.id !== subject.id) return false;
  const classes = classList(el);
  return subject.classes.every((c) => classes.includes(c));
}

// ── Layout ──────────────────────────────────────────────────────────────────

export type CellAlign = "MIN" | "CENTER" | "MAX" | "FILL";

/** CSS flex alignment translated to what a Figma Auto Layout frame can express. */
export interface FlexAlignment {
  primary: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counter: "MIN" | "CENTER" | "MAX" | "BASELINE";
  /**
   * align-items: stretch (also the CSS default). Figma has no STRETCH value: the
   * frame keeps counter MIN and its children Fill on the cross axis.
   */
  fillCrossAxis: boolean;
  /** Declared values Figma cannot express, e.g. "justify-content: space-around". */
  unsupported: string[];
}

export interface LayoutHint {
  kind: "grid" | "flex";
  columns: number | null;
  direction: "row" | "column";
  wrap: boolean;
  rowGap: number | null;
  columnGap: number | null;
  /** Flex only. */
  align?: FlexAlignment;
  /** Grid only: how children sit in their cells. FILL is child sizing, not an align value. */
  cells?: { horizontal: CellAlign; vertical: CellAlign };
}

function firstKeyword(value: string | undefined): string | null {
  if (!value) return null;
  const words = value.trim().toLowerCase().split(/\s+/).filter((w) => w !== "safe" && w !== "unsafe");
  if (words[0] === "first" || words[0] === "last") return words[1] === "baseline" ? "baseline" : words[0];
  return words[0] ?? null;
}

export function readFlexAlignment(style: Record<string, string>, direction: "row" | "column"): FlexAlignment {
  const placeContent = splitSpaces(style["place-content"] ?? "");
  const placeItems = splitSpaces(style["place-items"] ?? "");
  const justify = firstKeyword(style["justify-content"] ?? placeContent[1] ?? placeContent[0]) ?? "normal";
  const align = firstKeyword(style["align-items"] ?? placeItems[0]) ?? "normal";
  const unsupported: string[] = [];

  let primary: FlexAlignment["primary"] = "MIN";
  if (justify === "center") primary = "CENTER";
  else if (["flex-end", "end", "right"].includes(justify)) primary = "MAX";
  else if (justify === "space-between") primary = "SPACE_BETWEEN";
  else if (justify === "space-around" || justify === "space-evenly") unsupported.push(`justify-content: ${justify}`);

  let counter: FlexAlignment["counter"] = "MIN";
  let fillCrossAxis = false;
  if (align === "center") counter = "CENTER";
  else if (["flex-end", "end", "self-end"].includes(align)) counter = "MAX";
  else if (align === "baseline") counter = direction === "row" ? "BASELINE" : "MIN";
  else if (align === "stretch" || align === "normal") fillCrossAxis = true;

  return { primary, counter, fillCrossAxis, unsupported };
}

function cellAlign(value: string | null): CellAlign {
  if (value === "center") return "CENTER";
  if (value && ["end", "flex-end", "self-end", "right"].includes(value)) return "MAX";
  if (value && ["start", "flex-start", "self-start", "left", "baseline"].includes(value)) return "MIN";
  return "FILL"; // stretch / normal: the grid default
}

export function readGridCells(style: Record<string, string>): { horizontal: CellAlign; vertical: CellAlign } {
  const placeItems = splitSpaces(style["place-items"] ?? "");
  return {
    horizontal: cellAlign(firstKeyword(style["justify-items"] ?? placeItems[1] ?? placeItems[0])),
    vertical: cellAlign(firstKeyword(style["align-items"] ?? placeItems[0])),
  };
}

export function countColumns(template: string | undefined): number | null {
  if (!template) return null;
  const value = template.trim();
  if (/^repeat\(\s*auto-(fit|fill)/.test(value)) return null;
  const tracks = splitSpaces(value.replace(/\[[^\]]*\]/g, " "));
  let count = 0;
  for (const track of tracks) {
    const repeat = /^repeat\(\s*(\d+)\s*,(.*)\)$/.exec(track);
    count += repeat ? parseInt(repeat[1], 10) * Math.max(1, splitSpaces(repeat[2]).length) : 1;
  }
  return count || null;
}

export function readLayout(style: Record<string, string>, rootPx: number): LayoutHint | null {
  const display = (style.display ?? "").trim();
  const gapParts = splitSpaces(style.gap ?? style["grid-gap"] ?? "");
  const rowGap = toPx(style["row-gap"] ?? style["grid-row-gap"] ?? gapParts[0] ?? "", rootPx);
  const columnGap = toPx(style["column-gap"] ?? style["grid-column-gap"] ?? gapParts[1] ?? gapParts[0] ?? "", rootPx);
  if (/grid/.test(display)) {
    return {
      kind: "grid",
      columns: countColumns(style["grid-template-columns"]),
      direction: "row",
      wrap: false,
      rowGap,
      columnGap,
      cells: readGridCells(style),
    };
  }
  if (/flex/.test(display)) {
    const flow = `${style["flex-direction"] ?? ""} ${style["flex-flow"] ?? ""}`;
    const wrapValue = `${style["flex-wrap"] ?? ""} ${style["flex-flow"] ?? ""}`;
    const direction = flow.includes("column") ? "column" : "row";
    return {
      kind: "flex",
      columns: null,
      direction,
      wrap: /(^|\s)wrap\b/.test(wrapValue),
      rowGap,
      columnGap,
      align: readFlexAlignment(style, direction),
    };
  }
  return null;
}

const INLINE_TAGS = new Set(["a", "span", "button", "img", "label", "strong", "em", "b", "i", "small", "svg", "picture"]);

/** The alignment clause appended to a recommendation, or "" when the CSS declares no layout. */
export function describeAlignment(layout: LayoutHint | null, asGrid = false): string {
  if (!layout) return "";
  if (layout.kind === "grid" && layout.cells) {
    return `cells: horizontal ${layout.cells.horizontal}, vertical ${layout.cells.vertical}`;
  }
  if (layout.kind !== "flex" || !layout.align) return "";
  const a = layout.align;
  if (asGrid) {
    const vertical = a.fillCrossAxis ? "FILL" : a.counter === "BASELINE" ? "MIN" : a.counter;
    return `cells: horizontal FILL, vertical ${vertical}`;
  }
  const cross = layout.direction === "row" ? "height" : "width";
  const parts = [
    `primary ${a.primary}`,
    `counter ${a.counter}${a.fillCrossAxis ? ` + children Fill ${cross} (align-items: stretch)` : ""}`,
    ...a.unsupported.map((u) => `${u} has no Figma equivalent`),
  ];
  return parts.join(", ");
}

/** How to build a container in Figma, from what the CSS declares. */
export function recommendLayout(layout: LayoutHint | null, equalItems: number, inlineItems: boolean): string {
  const gap = (n: number | null) => (n !== null && n > 0 ? `, gap ${n}` : "");
  const withAlignment = (base: string, asGrid = false) => {
    const clause = describeAlignment(layout, asGrid);
    return clause ? `${base}; ${clause}` : base;
  };
  if (layout?.kind === "grid") {
    if (layout.columns === 1) return `Auto Layout — vertical${gap(layout.rowGap)}`;
    if (layout.columns && layout.columns > 1) {
      return withAlignment(
        `Figma Grid — ${layout.columns} columns${gap(layout.columnGap)}${layout.rowGap !== layout.columnGap ? `, row gap ${layout.rowGap ?? 0}` : ""}`
      );
    }
    return withAlignment("Figma Grid — auto-fit columns; use the column count the desktop design shows");
  }
  if (layout?.kind === "flex") {
    if (layout.direction === "column") return withAlignment(`Auto Layout — vertical${gap(layout.rowGap)}`);
    if (layout.wrap && equalItems > 2) {
      return withAlignment(
        `Figma Grid — ${equalItems} equal items that wrap; use the column count the desktop design shows${gap(layout.columnGap)}`,
        true
      );
    }
    return withAlignment(`Auto Layout — horizontal${gap(layout.columnGap)}`);
  }
  return inlineItems ? "Auto Layout — horizontal (inline items)" : "Auto Layout — vertical (items stack)";
}

// ── Assets ──────────────────────────────────────────────────────────────────

export interface AssetEntry {
  /** Stable within one analysis: asset-1, asset-2 … in document order. */
  id: string;
  /** 1-based index of the outline section it sits in, or null when outside every section. */
  section: number | null;
  kind: "img" | "picture" | "video-poster" | "inline-svg" | "css-background";
  element: string;
  /** Absolute URL, absolute file path or data: URI. Null for inline SVG, whose markup is in svgMarkup. */
  source: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  /** Inline SVG only: self-contained markup, ready for set_svg. */
  svgMarkup?: string;
}

/** Resolve an asset reference against the page (URL) or the HTML file (absolute path). */
export function resolveAssetUrl(src: string, base: string | undefined): string {
  const value = src.trim();
  if (!value || /^(data|blob):/i.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (!base) return value;
  if (/^https?:\/\//i.test(base)) {
    try {
      return new URL(value, base).toString();
    } catch {
      return value;
    }
  }
  if (path.isAbsolute(value)) return value;
  return path.resolve(path.dirname(base), decodeURIComponent(value.split(/[?#]/)[0]));
}

/**
 * Rewrite url(...) references in a stylesheet to absolute ones. CSS resolves them
 * against the stylesheet's own location, not the page's, so this must run per
 * sheet before the sheets are merged.
 */
export function absolutizeCssUrls(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole, _quote: string, url: string) => {
    if (!url || /^(data|blob):/i.test(url) || url.startsWith("#")) return whole;
    return `url("${resolveAssetUrl(url, base)}")`;
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attrsToString(list: Array<[string, string]>): string {
  return list.map(([name, value]) => ` ${name}="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`).join("");
}

/**
 * Re-serialise an inline SVG so it stands on its own: `<use href="#id">` is
 * replaced by the referenced symbol's content (a sprite reference is otherwise
 * an empty icon once copied out of the page), `currentColor` becomes the colour
 * the SVG inherits, and the namespace and viewBox are present.
 */
export function serializeSvg(svg: HtmlElement, idIndex: Map<string, HtmlElement>, currentColor: string | null): string {
  let symbolViewBox: string | null = null;

  const serialize = (el: HtmlElement, depth: number): string => {
    if (depth > 30) return "";
    if (el.tag === "use") {
      const href = (el.attrs.href ?? el.attrs["xlink:href"] ?? "").trim();
      const target = href.startsWith("#") ? idIndex.get(href.slice(1)) : undefined;
      if (!target) return "";
      if (!symbolViewBox && target.attrs.viewbox) symbolViewBox = target.attrs.viewbox;
      const passed = el.attrList.filter(([name]) => !/^(href|xlink:href|x|y|width|height)$/i.test(name));
      const x = parseFloat(el.attrs.x ?? "0") || 0;
      const y = parseFloat(el.attrs.y ?? "0") || 0;
      if (x || y) passed.push(["transform", `translate(${x} ${y})`]);
      const content = target.tag === "symbol" || target.tag === "svg"
        ? target.children.map((c) => (typeof c === "string" ? escapeText(c) : serialize(c, depth + 1))).join("")
        : serialize(target, depth + 1);
      return `<g${attrsToString(passed)}>${content}</g>`;
    }
    const children = el.children.map((c) => (typeof c === "string" ? escapeText(c) : serialize(c, depth + 1))).join("");
    const attrs = el.attrList.slice();
    if (el === svg) {
      if (!attrs.some(([name]) => name.toLowerCase() === "xmlns")) attrs.unshift(["xmlns", SVG_NS]);
      if (!el.attrs.viewbox && symbolViewBox) attrs.push(["viewBox", symbolViewBox]);
    }
    const open = `<${el.name}${attrsToString(attrs)}`;
    return children ? `${open}>${children}</${el.name}>` : `${open}/>`;
  };

  const markup = serialize(svg, 0);
  return currentColor ? markup.replace(/currentColor/gi, currentColor) : markup;
}

type Inset = { top: string | null; right: string | null; bottom: string | null; left: string | null };

function describeInset(inset: Inset): string {
  const parts = (["top", "right", "bottom", "left"] as const)
    .filter((side) => inset[side] !== null)
    .map((side) => `${side}: ${inset[side]}`);
  return parts.length ? parts.join(", ") : "position not declared";
}

// ── Analysis ────────────────────────────────────────────────────────────────

export interface Tally {
  value: number;
  count: number;
}

export interface ColorTally {
  hex: string;
  alpha: number;
  count: number;
  uses: { text: number; background: number; border: number; other: number };
}

export interface TypographyEntry {
  fontFamily: string | null;
  familyInherited: boolean;
  fontSize: number;
  fontWeight: number | null;
  lineHeight: string | null;
  letterSpacing: number | null;
  selectors: string[];
  count: number;
}

export interface GroupSummary {
  container: string;
  itemSignature: string;
  count: number;
  layout: LayoutHint | null;
  recommendation: string;
  responsive: Array<{ media: string; layout: LayoutHint }>;
  /** How many identical containers this line stands for. */
  repeats: number;
}

export interface SectionSummary {
  index: number;
  element: string;
  label: string;
  headings: string[];
  counts: Record<string, number>;
  layout: LayoutHint | null;
  recommendation: string;
  /** Declared position when the section is a fixed overlay, else null. */
  overlay: Inset | null;
  groups: GroupSummary[];
}

export interface HtmlAnalysis {
  title: string | null;
  ruleCount: number;
  mediaRuleCount: number;
  rootFontSize: number;
  baseFontFamily: string | null;
  customPropertyCount: number;
  sections: SectionSummary[];
  tokens: {
    colors: ColorTally[];
    typography: TypographyEntry[];
    gaps: Tally[];
    padding: Tally[];
    margin: Tally[];
    radii: Tally[];
  };
  texts: Array<{ tag: string; text: string }>;
  textsTruncated: boolean;
  /** Elements left out of the build: hidden, sprite SVGs, fixed overlays. */
  skipped: Array<{ element: string; reason: string }>;
  /** Every visible image and icon, in document order. */
  assets: AssetEntry[];
}

const GAP_PROPERTIES = new Set(["gap", "row-gap", "column-gap", "grid-gap", "grid-row-gap", "grid-column-gap"]);
const LAYOUT_PROPERTIES = /^(display|grid-template-columns|flex-direction|flex-flow|flex-wrap|gap|row-gap|column-gap|grid-gap)$/;
const SECTION_TAGS = new Set(["header", "nav", "section", "article", "aside", "footer"]);
const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "button", "label", "blockquote", "figcaption", "dt", "dd", "th", "td"]);
const WEIGHT_KEYWORDS: Record<string, number> = { normal: 400, bold: 700, bolder: 700, lighter: 300 };

function firstFamily(value: string): string | null {
  const first = splitTopLevel(value, ",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first ? first : null;
}

function parseWeight(value: string | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (/^[1-9]00$/.test(v)) return parseInt(v, 10);
  return WEIGHT_KEYWORDS[v] ?? null;
}

function parseLineHeight(value: string | undefined, fontSize: number, rootPx: number): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "normal") return null;
  if (/^\d*\.?\d+$/.test(v)) return `${Math.round(parseFloat(v) * 100)}%`;
  if (/^\d*\.?\d+%$/.test(v)) return v;
  const px = toPx(v, rootPx, fontSize);
  return px === null ? null : `${px}px`;
}

function readTypography(
  style: Record<string, string>,
  rootPx: number
): Omit<TypographyEntry, "selectors" | "count" | "familyInherited"> | null {
  let family = style["font-family"] ? firstFamily(style["font-family"]) : null;
  let sizeValue = style["font-size"];
  let weight = parseWeight(style["font-weight"]);
  let lineHeightValue = style["line-height"];

  if (style.font) {
    const tokens = splitSpaces(style.font);
    const sizeIndex = tokens.findIndex((t) => /^(\d*\.?\d+(px|rem|em)|(clamp|min|max)\(.*\))(\/.+)?$/i.test(t));
    if (sizeIndex !== -1) {
      const [size, lineHeight] = splitTopLevel(tokens[sizeIndex], "/");
      sizeValue = sizeValue ?? size;
      lineHeightValue = lineHeightValue ?? lineHeight;
      for (const token of tokens.slice(0, sizeIndex)) weight = weight ?? parseWeight(token);
      family = family ?? firstFamily(tokens.slice(sizeIndex + 1).join(" "));
    }
  }

  if (!sizeValue) return null;
  const fontSize = toPx(sizeValue, rootPx);
  if (fontSize === null || fontSize <= 0) return null;

  let letterSpacing: number | null = null;
  const ls = style["letter-spacing"]?.trim().toLowerCase();
  if (ls && ls !== "normal") letterSpacing = toPx(ls, rootPx, fontSize);

  return {
    fontFamily: family,
    fontSize,
    fontWeight: weight,
    lineHeight: parseLineHeight(lineHeightValue, fontSize, rootPx),
    letterSpacing,
  };
}

function lengths(value: string, rootPx: number): number[] {
  return splitSpaces(value)
    .map((part) => toPx(part, rootPx))
    .filter((n): n is number => n !== null && n > 0)
    .map((n) => Math.round(n * 2) / 2);
}

function tallyAdd(map: Map<number, number>, values: number[]): void {
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
}

function sortedTally(map: Map<number, number>): Tally[] {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value - b.value);
}

/** Collapse identical groups (three alike feature lists) into one line with a count. */
function dedupeGroups(groups: GroupSummary[]): GroupSummary[] {
  const merged = new Map<string, GroupSummary>();
  for (const group of groups) {
    const key = [group.container, group.itemSignature, group.count, group.recommendation, JSON.stringify(group.responsive)].join("|");
    const existing = merged.get(key);
    if (existing) existing.repeats++;
    else merged.set(key, group);
  }
  return [...merged.values()].sort((a, b) => b.count - a.count || b.repeats - a.repeats);
}

/**
 * Analyse a page. `externalCss` is the text of its linked stylesheets, in order;
 * <style> blocks and inline style attributes are read from the HTML itself.
 */
export function analyzeHtml(
  html: string,
  externalCss: string[] = [],
  options: { maxTexts?: number; baseUrl?: string } = {}
): HtmlAnalysis {
  const parsed = parseHtml(html);
  const rules = parseCss([...externalCss, ...parsed.styles].join("\n"));

  // Custom properties and the root font size come from base rules on the page root.
  const rootRules = rules.filter((r) => r.media === null && /^(:root|html|body|\*)$/i.test(r.selector));
  const vars: Record<string, string> = {};
  for (const rule of rootRules) {
    for (const [property, value] of Object.entries(rule.declarations)) {
      if (property.startsWith("--")) vars[property] = value;
    }
  }
  const resolve = (style: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [property, value] of Object.entries(style)) {
      if (!property.startsWith("--")) out[property] = resolveVars(value, vars);
    }
    return out;
  };

  let rootFontSize = 16;
  let baseFontFamily: string | null = null;
  for (const rule of rootRules) {
    const style = resolve(rule.declarations);
    const size = style["font-size"]?.trim();
    if (/^(html|:root)$/i.test(rule.selector) && size) {
      if (size.endsWith("%")) rootFontSize = (16 * parseFloat(size)) / 100;
      else if (size.endsWith("px")) rootFontSize = parseFloat(size);
    }
    const family = style["font-family"] ?? (style.font ? readTypography(style, rootFontSize)?.fontFamily ?? undefined : undefined);
    if (family) baseFontFamily = firstFamily(family) ?? baseFontFamily;
  }

  // ── Tokens, from every declaration the page makes ─────────────────────────
  const colors = new Map<string, ColorTally>();
  const typography = new Map<string, TypographyEntry>();
  const gaps = new Map<number, number>();
  const padding = new Map<number, number>();
  const margin = new Map<number, number>();
  const radii = new Map<number, number>();

  const collect = (selector: string, rawStyle: Record<string, string>) => {
    const style = resolve(rawStyle);
    for (const [property, value] of Object.entries(style)) {
      if (COLOR_PROPERTIES.test(property)) {
        for (const found of value.match(COLOR_IN_VALUE) ?? []) {
          const color = parseColor(found);
          if (!color || color.alpha === 0) continue;
          const key = `${color.hex}@${color.alpha}`;
          const entry = colors.get(key) ?? { ...color, count: 0, uses: { text: 0, background: 0, border: 0, other: 0 } };
          entry.count++;
          const use = property === "color" ? "text" : property.startsWith("background") ? "background" : /^(border|outline)/.test(property) ? "border" : "other";
          entry.uses[use]++;
          colors.set(key, entry);
        }
      }
      if (GAP_PROPERTIES.has(property)) tallyAdd(gaps, lengths(value, rootFontSize));
      else if (/^padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(property)) tallyAdd(padding, lengths(value, rootFontSize));
      else if (/^margin(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(property)) tallyAdd(margin, lengths(value, rootFontSize));
      else if (/^border(-(top|bottom)-(left|right))?-radius$/.test(property)) tallyAdd(radii, lengths(value.split("/")[0], rootFontSize));
    }
    const type = readTypography(style, rootFontSize);
    if (type) {
      const familyInherited = type.fontFamily === null && baseFontFamily !== null;
      const fontFamily = type.fontFamily ?? baseFontFamily;
      const key = [fontFamily, type.fontSize, type.fontWeight, type.lineHeight, type.letterSpacing].join("|");
      const entry = typography.get(key) ?? { ...type, fontFamily, familyInherited, selectors: [], count: 0 };
      entry.count++;
      if (!entry.selectors.includes(selector) && entry.selectors.length < 6) entry.selectors.push(selector);
      typography.set(key, entry);
    }
  };

  for (const rule of rules) collect(rule.selector, rule.declarations);

  const body = findElement(parsed.root, "body") ?? parsed.root;
  const walkInline = (el: HtmlElement) => {
    if (el.attrs.style) collect(`${describeElement(el)} (inline)`, parseDeclarations(el.attrs.style));
    for (const child of elementChildren(el)) walkInline(child);
  };
  walkInline(body);

  // ── Structure ─────────────────────────────────────────────────────────────
  const indexed = rules
    .map((rule) => ({ rule, subject: subjectOf(rule.selector) }))
    .filter((entry): entry is { rule: CssRule; subject: Subject } => entry.subject !== null);

  const styleCache = new Map<HtmlElement, Record<string, string>>();
  const styleOf = (el: HtmlElement): Record<string, string> => {
    const cached = styleCache.get(el);
    if (cached) return cached;
    const style = computeStyle(el);
    styleCache.set(el, style);
    return style;
  };
  const computeStyle = (el: HtmlElement): Record<string, string> => {
    const merged: Record<string, string> = {};
    for (const { rule, subject } of indexed) {
      if (rule.media === null && elementMatches(el, subject)) Object.assign(merged, rule.declarations);
    }
    if (el.attrs.style) Object.assign(merged, parseDeclarations(el.attrs.style));
    return resolve(merged);
  };

  const responsiveLayouts = (el: HtmlElement, base: Record<string, string>) => {
    const byMedia = new Map<string, Record<string, string>>();
    for (const { rule, subject } of indexed) {
      if (rule.media === null || !elementMatches(el, subject)) continue;
      const layoutDecls = Object.entries(rule.declarations).filter(([p]) => LAYOUT_PROPERTIES.test(p));
      if (layoutDecls.length === 0) continue;
      const merged = byMedia.get(rule.media) ?? { ...base };
      for (const [p, v] of layoutDecls) merged[p] = v;
      byMedia.set(rule.media, merged);
    }
    const out: Array<{ media: string; layout: LayoutHint }> = [];
    for (const [media, style] of byMedia) {
      const layout = readLayout(resolve(style), rootFontSize);
      if (layout) out.push({ media, layout });
    }
    return out;
  };

  const containsSectionTag = (el: HtmlElement): boolean =>
    elementChildren(el).some((c) => SECTION_TAGS.has(c.tag) || c.tag === "main" || containsSectionTag(c));

  // What a visitor never sees is not built: the hidden attribute, display:none,
  // and sprite-only SVGs. aria-hidden is deliberately NOT hidden — it hides from
  // screen readers, and decorative icons carry it while being fully visible.
  // A visible inline SVG is a "graphic": not a section, group or text, but an asset.
  const skipped: Array<{ element: string; reason: string }> = [];
  const isSpriteSvg = (el: HtmlElement): boolean => {
    const kids = elementChildren(el);
    return kids.length > 0 && kids.every((c) => ["symbol", "defs", "title", "desc"].includes(c.tag));
  };
  const skipReason = (el: HtmlElement): string | null => {
    if (["script", "style", "link", "meta", "template", "noscript", "br"].includes(el.tag)) return "not content";
    if ("hidden" in el.attrs) return "hidden";
    if ((styleOf(el).display ?? "").trim() === "none") {
      return el.tag === "svg" ? "icon sprite or decoration" : "hidden (display: none)";
    }
    if (el.tag === "svg") return isSpriteSvg(el) ? "icon sprite or decoration" : "graphic";
    return null;
  };
  // Fixed overlays (theme toggles, chat buttons, cookie bars) are visible, so they are
  // built — as their own section, placed where the CSS pins them.
  const overlayOf = (el: HtmlElement): Inset | null => {
    const style = styleOf(el);
    if ((style.position ?? "").trim() !== "fixed") return null;
    const inset = splitSpaces(style.inset ?? "");
    const fromInset = (index: number): string | null => {
      if (inset.length === 0) return null;
      if (inset.length === 1) return inset[0];
      if (inset.length === 2) return inset[index % 2];
      if (inset.length === 3) return index === 3 ? inset[1] : inset[index];
      return inset[index];
    };
    return {
      top: style.top ?? fromInset(0),
      right: style.right ?? fromInset(1),
      bottom: style.bottom ?? fromInset(2),
      left: style.left ?? fromInset(3),
    };
  };

  const sectionElements: HtmlElement[] = [];
  const findSections = (el: HtmlElement, depth: number) => {
    for (const child of elementChildren(el)) {
      const reason = skipReason(child);
      if (reason) {
        if (reason !== "not content" && reason !== "graphic") skipped.push({ element: describeElement(child), reason });
        continue;
      }
      if (overlayOf(child)) sectionElements.push(child);
      else if (child.tag === "main") findSections(child, depth + 1);
      else if (SECTION_TAGS.has(child.tag)) sectionElements.push(child);
      else if (depth < 4 && containsSectionTag(child)) findSections(child, depth + 1);
      else if (elementChildren(child).length > 0) sectionElements.push(child);
    }
  };
  findSections(body, 0);

  const count = (el: HtmlElement, test: (e: HtmlElement) => boolean): number => {
    let n = 0;
    const walk = (node: HtmlElement) => {
      for (const child of elementChildren(node)) {
        if (test(child)) n++;
        if (child.tag !== "svg") walk(child);
      }
    };
    walk(el);
    return n;
  };

  const sections: SectionSummary[] = sectionElements.map((el, i) => {
    const headings: string[] = [];
    const findHeadings = (node: HtmlElement) => {
      for (const child of elementChildren(node)) {
        if (/^h[1-6]$/.test(child.tag)) {
          const text = textContent(child);
          if (text && headings.length < 3) headings.push(text.slice(0, 80));
        } else findHeadings(child);
      }
    };
    findHeadings(el);

    const groups: GroupSummary[] = [];
    const findGroups = (node: HtmlElement, depth: number) => {
      if (depth > 10 || (depth > 0 && skipReason(node))) return;
      if (node.tag === "table") {
        const rows: HtmlElement[] = [];
        const collectRows = (n: HtmlElement) => {
          for (const c of elementChildren(n)) {
            if (c.tag === "tr") rows.push(c);
            else collectRows(c);
          }
        };
        collectRows(node);
        const cells = Math.max(0, ...rows.map((r) => elementChildren(r).filter((c) => c.tag === "td" || c.tag === "th").length));
        groups.push({
          container: describeElement(node),
          itemSignature: "rows",
          count: rows.length,
          layout: null,
          recommendation: `Table — vertical Auto Layout of ${rows.length} rows, each a horizontal Auto Layout of ${cells} cells`,
          responsive: [],
          repeats: 1,
        });
        return;
      }
      const kids = elementChildren(node).filter((c) => !skipReason(c));
      // A button's or link's icon and label are the component's inside, not a layout decision.
      if (kids.length >= 2 && !INLINE_TAGS.has(node.tag)) {
        const signatures = new Map<string, number>();
        for (const kid of kids) signatures.set(signature(kid), (signatures.get(signature(kid)) ?? 0) + 1);
        const [itemSignature, itemCount] = [...signatures.entries()].sort((a, b) => b[1] - a[1])[0];
        const equal = itemCount >= 2 && itemCount >= kids.length * 0.6;
        const style = styleOf(node);
        const layout = readLayout(style, rootFontSize);
        if (equal || layout) {
          groups.push({
            container: describeElement(node),
            itemSignature: equal ? itemSignature : "mixed items",
            count: equal ? itemCount : kids.length,
            layout,
            recommendation: recommendLayout(layout, equal ? itemCount : 0, kids.every((k) => INLINE_TAGS.has(k.tag))),
            responsive: responsiveLayouts(node, style),
            repeats: 1,
          });
        }
      }
      for (const kid of kids) findGroups(kid, depth + 1);
    };
    findGroups(el, 0);

    const sectionLayout = readLayout(styleOf(el), rootFontSize);
    const overlay = overlayOf(el);
    // The section's own children decide its layout too: a wrapping row of equal columns is a Grid.
    const sectionKids = elementChildren(el).filter((c) => !skipReason(c));
    const kidSignatures = new Map<string, number>();
    for (const kid of sectionKids) kidSignatures.set(signature(kid), (kidSignatures.get(signature(kid)) ?? 0) + 1);
    const largestSet = Math.max(0, ...kidSignatures.values());
    const equalKids = largestSet >= 2 && largestSet >= sectionKids.length * 0.6 ? largestSet : 0;
    return {
      index: i + 1,
      element: describeElement(el),
      label: headings[0] ?? el.attrs["aria-label"] ?? "",
      headings,
      counts: {
        headings: count(el, (e) => /^h[1-6]$/.test(e.tag)),
        paragraphs: count(el, (e) => e.tag === "p"),
        images: count(el, (e) => ["img", "svg", "picture", "video"].includes(e.tag)),
        links: count(el, (e) => e.tag === "a"),
        buttons: count(el, (e) => e.tag === "button" || e.attrs.role === "button" || /\b(btn|button)\b/i.test(e.attrs.class ?? "")),
        inputs: count(el, (e) => ["input", "select", "textarea"].includes(e.tag)),
        listItems: count(el, (e) => e.tag === "li"),
      },
      layout: sectionLayout,
      overlay,
      recommendation: overlay
        ? `fixed overlay — place at its declared position (${describeInset(overlay)})`
        : recommendLayout(
            sectionLayout,
            equalKids,
            sectionKids.length > 0 && sectionKids.every((k) => INLINE_TAGS.has(k.tag))
          ),
      groups: dedupeGroups(groups).slice(0, 8),
    };
  });

  // ── Images & icons ────────────────────────────────────────────────────────
  const idIndex = new Map<string, HtmlElement>();
  const indexIds = (el: HtmlElement) => {
    if (el.attrs.id && !idIndex.has(el.attrs.id)) idIndex.set(el.attrs.id, el);
    for (const child of elementChildren(el)) indexIds(child);
  };
  indexIds(parsed.root);

  const sectionNumber = new Map<HtmlElement, number>(sectionElements.map((el, i) => [el, i + 1]));
  const assets: AssetEntry[] = [];
  const declaredSize = (el: HtmlElement) => {
    const style = styleOf(el);
    const read = (side: "width" | "height"): number | null => {
      const attr = el.attrs[side]?.trim();
      if (attr && /^\d+(\.\d+)?(px)?$/.test(attr)) return parseFloat(attr);
      return style[side] ? toPx(style[side], rootFontSize) : null;
    };
    return { width: read("width"), height: read("height") };
  };
  const inheritedColor = (el: HtmlElement): string | null => {
    for (let node: HtmlElement | null = el; node && node.tag !== "#document"; node = node.parent) {
      const declared = styleOf(node).color ?? node.attrs.color;
      const color = declared ? parseColor(declared) : null;
      if (color) return color.hex;
    }
    return null;
  };
  const lastSrcsetUrl = (srcset: string | undefined): string | null => {
    if (!srcset) return null;
    const urls = srcset.split(",").map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
    return urls.length ? urls[urls.length - 1] : null;
  };
  const imageSource = (img: HtmlElement): string | null => {
    // Lazy loaders put a 1×1 placeholder in src and the real image in data-src.
    const placeholder = !img.attrs.src || /^data:image\/gif/i.test(img.attrs.src);
    const raw = placeholder
      ? img.attrs["data-src"] ?? img.attrs["data-lazy-src"] ?? lastSrcsetUrl(img.attrs.srcset ?? img.attrs["data-srcset"]) ?? img.attrs.src
      : img.attrs.src;
    return raw ? resolveAssetUrl(raw, options.baseUrl) : null;
  };
  const addAsset = (el: HtmlElement, kind: AssetEntry["kind"], source: string | null, section: number | null, extra: Partial<AssetEntry> = {}) => {
    const size = declaredSize(el);
    assets.push({
      id: `asset-${assets.length + 1}`,
      section,
      kind,
      element: describeElement(el),
      source,
      alt: (el.attrs.alt ?? el.attrs["aria-label"] ?? el.attrs.title ?? "").trim(),
      width: size.width,
      height: size.height,
      ...extra,
    });
  };
  const walkAssets = (el: HtmlElement, section: number | null) => {
    for (const child of elementChildren(el)) {
      const here = sectionNumber.get(child) ?? section;
      const reason = skipReason(child);
      if (reason && reason !== "graphic") continue;
      if (child.tag === "img") {
        addAsset(child, "img", imageSource(child), here);
        continue;
      }
      if (child.tag === "picture") {
        const img = elementChildren(child).find((c) => c.tag === "img");
        const source = elementChildren(child).find((c) => c.tag === "source");
        const fromImg = img ? imageSource(img) : null;
        const fromSource = lastSrcsetUrl(source?.attrs.srcset);
        addAsset(img ?? child, "picture", fromImg ?? (fromSource ? resolveAssetUrl(fromSource, options.baseUrl) : null), here);
        continue;
      }
      if (child.tag === "video") {
        if (child.attrs.poster) addAsset(child, "video-poster", resolveAssetUrl(child.attrs.poster, options.baseUrl), here);
        continue;
      }
      if (child.tag === "svg") {
        const title = elementChildren(child).find((c) => c.tag === "title");
        addAsset(child, "inline-svg", null, here, {
          alt: (child.attrs["aria-label"] ?? (title ? textContent(title) : "")).trim(),
          svgMarkup: serializeSvg(child, idIndex, inheritedColor(child)),
        });
        continue;
      }
      const style = styleOf(child);
      const background = style["background-image"] ?? style.background;
      const url = background ? /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(background)?.[2] : undefined;
      if (url && !url.startsWith("#")) addAsset(child, "css-background", resolveAssetUrl(url, options.baseUrl), here);
      walkAssets(child, here);
    }
  };
  walkAssets(body, null);

  // ── Text content ──────────────────────────────────────────────────────────
  const maxTexts = options.maxTexts ?? 80;
  const texts: Array<{ tag: string; text: string }> = [];
  let textsTruncated = false;
  const walkTexts = (el: HtmlElement) => {
    for (const child of elementChildren(el)) {
      if (skipReason(child)) continue;
      const isText = TEXT_TAGS.has(child.tag) || child.tag === "a";
      if (isText) {
        const text = textContent(child);
        if (text) {
          if (texts.length >= maxTexts) {
            textsTruncated = true;
            return;
          }
          const last = texts[texts.length - 1];
          if (!last || last.text !== text) texts.push({ tag: child.tag, text: text.slice(0, 160) });
        }
        if (child.tag !== "li") continue;
      }
      walkTexts(child);
    }
  };
  walkTexts(body);

  return {
    title: parsed.title,
    ruleCount: rules.length,
    mediaRuleCount: rules.filter((r) => r.media !== null).length,
    rootFontSize,
    baseFontFamily,
    customPropertyCount: Object.keys(vars).length,
    sections,
    tokens: {
      colors: [...colors.values()].sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)),
      typography: [...typography.values()].sort((a, b) => b.fontSize - a.fontSize || b.count - a.count),
      gaps: sortedTally(gaps),
      padding: sortedTally(padding),
      margin: sortedTally(margin),
      radii: sortedTally(radii),
    },
    texts,
    textsTruncated,
    skipped,
    assets,
  };
}
