/**
 * The structural gate: does the generated markup have the same shape as Figma?
 *
 * WHY THIS EXISTS
 * ---------------
 * `audit_generated_code` proves the assets are real. It says nothing about
 * structure, and structure is where a "1:1" conversion quietly stops being one.
 * A wrapper flattened into its parent, two sections swapped, a card dropped from
 * a grid of six, a HUG frame pinned to `height: 252px` — every one of those can
 * render pixel-identical to the Figma frame and pass a visual diff. The design
 * only breaks later, when the content changes.
 *
 * The skill already tells the model to "walk the contract node by node and
 * confirm each one is present". That is a claim, not a check. This tool makes
 * it mechanical:
 *
 *   - every node in design-contract.json appears in the output   (nothing dropped)
 *   - every element in the output traces back to a node          (nothing invented)
 *   - children keep Figma's order and nesting depth              (no drift)
 *   - layout mode, gap and padding match the Figma frame
 *   - HUG / FILL / FIXED survive as content-driven / flexible / fixed
 *   - text is verbatim
 *
 * HOW IT SEES THE OUTPUT
 * ----------------------
 * Two sources, in order of preference:
 *
 *   1. A DOM snapshot (`domSnapshotPath`) captured from a real browser, which
 *      carries the true hierarchy and true *computed* styles. This is the only
 *      way to check a React/Vue page, because the rendered tree is a runtime
 *      product, not something you can read reliably off the source.
 *   2. Static `.html` files, parsed here with the project's own HTML/CSS parser
 *      and styled by matching the stylesheets' base rules.
 *
 * A page that can be reached by neither is reported UNVERIFIED — never PASS.
 * That rule is the whole point of the seat: a check that did not run is not a
 * check that passed.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "fs";
import * as path from "path";

import {
  parseHtml,
  parseCss,
  parseDeclarations,
  resolveVars,
  elementChildren,
  classList,
  subjectOf,
  elementMatches,
  toPx,
  type HtmlElement,
  type CssRule,
} from "../utils/html-analysis";

// ── The contract, as Phase 1 writes it ──────────────────────────────────────

type Sizing = "HUG" | "FILL" | "FIXED";
type LayoutMode = "HORIZONTAL" | "VERTICAL" | "GRID" | "NONE";

interface ContractPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface ContractLayout {
  mode?: LayoutMode;
  gap?: number | null;
  padding?: ContractPadding | number | null;
  sizingHorizontal?: Sizing;
  sizingVertical?: Sizing;
  width?: number | null;
  height?: number | null;
}

interface ContractNode {
  id: string;
  name?: string;
  slug?: string;
  /** FRAME, TEXT, INSTANCE, VECTOR, RECTANGLE, COMPONENT … */
  type?: string;
  /** Set on INSTANCE: the component slug this node renders. */
  component?: string;
  /** TEXT only, verbatim from Figma. */
  text?: string;
  layout?: ContractLayout;
  assetId?: string;
  decorative?: boolean;
  children?: ContractNode[];
}

interface ContractPage {
  name?: string;
  route?: string;
  tree?: ContractNode[];
}

interface DesignContract {
  pages?: ContractPage[];
}

// ── The output, reduced to one shape whatever it came from ──────────────────

interface Element {
  tag: string;
  /** `data-fig-id`, when the generator stamped one. The only exact anchor. */
  figId: string | null;
  classes: string[];
  /** Own text, children excluded — a heading's copy, not the whole section's. */
  ownText: string;
  styles: Record<string, string>;
  children: Element[];
  line: number;
}

/** Elements that carry no layout meaning of their own. */
const TRANSPARENT_TAGS = new Set(["picture", "template", "slot", "fragment"]);

/** Never counted as invented markup: they are how the platform renders an image. */
const INFRASTRUCTURE_TAGS = new Set(["source", "track", "noscript", "style", "script", "link", "meta", "head", "title"]);

interface Finding {
  where: string;
  detail: string;
}

interface Check {
  name: string;
  findings: Finding[];
}

export function registerStructureTools(server: McpServer): void {
  server.tool(
    "audit_structure_match",
    "Verify the generated frontend has the same structure as Figma: every design-contract node present, nothing " +
      "invented, children in the same order and nesting, and layout mode/gap/padding/HUG/FILL/FIXED and text " +
      "preserved. Reads design-contract.json and either a browser DOM snapshot or the project's .html files. " +
      "Run after audit_generated_code; a page that cannot be read is reported UNVERIFIED, never PASS.",
    {
      projectDir: z.string().describe("Absolute path of the generated project root"),
      contractPath: z
        .string()
        .optional()
        .describe("Absolute path to design-contract.json. Defaults to <projectDir>/design-contract.json"),
      domSnapshotPath: z
        .string()
        .optional()
        .describe(
          "Absolute path to a browser DOM snapshot JSON. Required for React/Vue pages, where the rendered tree " +
            "cannot be read from source. Shape: { pages: [{ route, root: { tag, figId?, classes?, text?, styles?, children? } }] }"
        ),
      routes: z.array(z.string()).optional().describe("Only audit these routes (default: every page in the contract)"),
      tolerancePx: z.coerce.number().min(0).optional().describe("Allowed difference for gap/padding/size, in px (default 2)"),
      allowWrappers: z
        .boolean()
        .optional()
        .describe("Treat a single-child element with no text of its own as transparent rather than invented (default true)"),
    },
    async ({ projectDir, contractPath, domSnapshotPath, routes, tolerancePx, allowWrappers }) => {
      try {
        if (!path.isAbsolute(projectDir)) return text(`projectDir must be an absolute path. Received: ${projectDir}`);
        if (!fs.existsSync(projectDir)) return text(`projectDir does not exist: ${projectDir}`);

        const tolerance = tolerancePx ?? 2;
        const wrappersAllowed = allowWrappers !== false;

        const contractFile = contractPath || path.join(projectDir, "design-contract.json");
        if (!fs.existsSync(contractFile)) {
          return text(
            `No design contract at ${contractFile}.\n` +
              `UNVERIFIED  Structure — there is nothing to compare the output against. ` +
              `Phase 1 writes design-contract.json; run it, or pass contractPath.`
          );
        }

        let contract: DesignContract;
        try {
          contract = JSON.parse(fs.readFileSync(contractFile, "utf8")) as DesignContract;
        } catch (error) {
          return text(`design-contract.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
        }

        const allPages = (contract.pages || []).filter((p) => Array.isArray(p.tree) && p.tree.length > 0);
        const pagesWithoutTree = (contract.pages || []).length - allPages.length;
        if (allPages.length === 0) {
          return text(
            `The contract has no page trees to check.\n` +
              `UNVERIFIED  Structure — every page in design-contract.json has an empty "tree". ` +
              `Phase 1 must capture the layer tree per page before structure can be audited.`
          );
        }

        const pages = routes && routes.length ? allPages.filter((p) => routes.includes(p.route || "")) : allPages;
        if (pages.length === 0) return text(`No contract page matched routes: ${(routes || []).join(", ")}`);

        const snapshots = domSnapshotPath ? loadSnapshot(domSnapshotPath) : null;
        if (domSnapshotPath && !snapshots) return text(`DOM snapshot could not be read or parsed: ${domSnapshotPath}`);

        const dropped: Finding[] = [];
        const invented: Finding[] = [];
        const drift: Finding[] = [];
        const layoutMismatch: Finding[] = [];
        const sizingMismatch: Finding[] = [];
        const copyMismatch: Finding[] = [];
        const unverified: string[] = [];
        const wrappersSeen: Finding[] = [];
        const sources: string[] = [];

        let nodesInContract = 0;
        let nodesMatched = 0;

        for (const page of pages) {
          const route = page.route || page.name || "(unnamed)";
          const tree = page.tree as ContractNode[];
          nodesInContract += countNodes(tree);

          const resolved = resolveOutput(page, projectDir, snapshots);
          if (!resolved) {
            unverified.push(
              `${route} — no readable output. ${
                snapshots ? "The snapshot has no entry for this route." : "No .html file found; pass domSnapshotPath for a React/Vue build."
              }`
            );
            continue;
          }
          sources.push(`${route} ← ${resolved.source}`);

          const context: MatchContext = {
            route,
            source: resolved.source,
            tolerance,
            wrappersAllowed,
            styled: resolved.styled,
            dropped,
            invented,
            drift,
            layoutMismatch,
            sizingMismatch,
            copyMismatch,
            wrappersSeen,
          };

          nodesMatched += matchLevel(tree, flatten(resolved.roots, wrappersAllowed, context), context);
          if (!resolved.styled) {
            unverified.push(`${route} — hierarchy checked, styles not: ${resolved.source} carries no resolvable CSS.`);
          }
        }

        const checks: Check[] = [
          { name: "Every contract node is present in the output", findings: dropped },
          { name: "Nothing in the output is absent from the contract", findings: invented },
          { name: "Children keep Figma's order and nesting", findings: drift },
          { name: "Layout mode, gap and padding match", findings: layoutMismatch },
          { name: "HUG / FILL / FIXED sizing is preserved", findings: sizingMismatch },
          { name: "Text is verbatim", findings: copyMismatch },
        ];

        const failed = checks.filter((c) => c.findings.length > 0);
        const lines: string[] = [
          `Structure audit — ${pages.length} page(s), ${nodesInContract} contract node(s)`,
          `Matched ${nodesMatched} of ${nodesInContract} node(s)`,
        ];
        if (pagesWithoutTree > 0) {
          lines.push(`${pagesWithoutTree} contract page(s) skipped: no "tree" captured`);
        }
        for (const line of sources) lines.push(`  ${line}`);
        lines.push("");

        for (const check of checks) {
          const count = check.findings.length;
          lines.push(`${count === 0 ? "PASS" : "FAIL"}  ${check.name}${count ? ` — ${count} issue(s)` : ""}`);
        }

        for (const note of unverified) lines.push(`UNVERIFIED  ${note}`);

        if (wrappersSeen.length > 0) {
          lines.push("", `Transparent wrappers passed through (${wrappersSeen.length}) — not failures, review if unexpected:`);
          for (const wrapper of wrappersSeen.slice(0, 10)) lines.push(`  ${wrapper.where}  ${wrapper.detail}`);
          if (wrappersSeen.length > 10) lines.push(`  …and ${wrappersSeen.length - 10} more`);
        }

        for (const check of failed) {
          lines.push("", `${check.name}:`);
          for (const finding of check.findings.slice(0, 25)) lines.push(`  ${finding.where}  ${finding.detail}`);
          if (check.findings.length > 25) lines.push(`  …and ${check.findings.length - 25} more`);
        }

        lines.push("");
        if (failed.length === 0 && unverified.length === 0) {
          lines.push(`STRUCTURE AUDIT PASSED. ${nodesInContract} nodes in contract, ${nodesMatched} built, 0 invented.`);
        } else if (failed.length === 0) {
          lines.push(
            `STRUCTURE AUDIT INCOMPLETE — every executed check passed, but ${unverified.length} item(s) could not be ` +
              `verified here. They are not passes. Capture a DOM snapshot and re-run before reporting the work as done.`
          );
        } else {
          lines.push(
            `STRUCTURE AUDIT FAILED — ${failed.length} check(s). Fix the structure to match Figma; ` +
              `never satisfy this audit by editing design-contract.json to match the code.`
          );
        }

        return text(lines.join("\n"));
      } catch (error) {
        return text(`Error auditing structure: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

// ── Reading the output ──────────────────────────────────────────────────────

interface ResolvedOutput {
  roots: Element[];
  source: string;
  /** False when the hierarchy is readable but no CSS could be resolved for it. */
  styled: boolean;
}

interface SnapshotNode {
  tag?: string;
  figId?: string;
  id?: string;
  classes?: string[] | string;
  text?: string;
  styles?: Record<string, string>;
  children?: SnapshotNode[];
}

interface Snapshot {
  pages?: Array<{ route?: string; root?: SnapshotNode; roots?: SnapshotNode[] }>;
}

function loadSnapshot(file: string): Snapshot | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

/** The snapshot wins where it has the route: it is the rendered truth. */
function resolveOutput(page: ContractPage, projectDir: string, snapshots: Snapshot | null): ResolvedOutput | null {
  const route = page.route || "";

  if (snapshots) {
    const entry = (snapshots.pages || []).find((p) => normalizeRoute(p.route || "") === normalizeRoute(route));
    if (entry) {
      const roots = entry.roots ? entry.roots : entry.root ? [entry.root] : [];
      const converted = roots.map(fromSnapshot).filter((el): el is Element => el !== null);
      if (converted.length > 0) {
        // A snapshot carries computed styles, or it carries nothing useful.
        const styled = converted.some(hasAnyStyle);
        return { roots: converted, source: `DOM snapshot (${route})`, styled };
      }
    }
  }

  const htmlFile = findPageFile(projectDir, route);
  if (!htmlFile) return null;

  const html = safeRead(htmlFile);
  if (html === null) return null;

  const parsed = parseHtml(html);
  const css = [...parsed.styles, ...readLinkedStylesheets(html, htmlFile, projectDir)].join("\n");
  const rules = parseCss(css).filter((r) => r.media === null);
  const vars = collectVars(rules);

  const body = findTag(parsed.root, "body") || parsed.root;
  const roots = elementChildren(body)
    .filter((el) => !INFRASTRUCTURE_TAGS.has(el.tag))
    .map((el) => fromHtml(el, rules, vars, html));

  return { roots, source: path.relative(projectDir, htmlFile), styled: rules.length > 0 };
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim().replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed.toLowerCase();
}

/** Route → file, the way a static host would resolve it. */
function findPageFile(projectDir: string, route: string): string | null {
  const clean = normalizeRoute(route).replace(/^\//, "");
  const stem = clean === "/" || clean === "" ? "index" : clean;
  const candidates = [
    `${stem}.html`,
    path.join(stem, "index.html"),
    path.join("dist", `${stem}.html`),
    path.join("dist", stem, "index.html"),
    path.join("out", `${stem}.html`),
    path.join("out", stem, "index.html"),
    path.join("public", `${stem}.html`),
    path.join("build", `${stem}.html`),
  ];
  for (const candidate of candidates) {
    const full = path.join(projectDir, candidate);
    if (!full.startsWith(projectDir)) continue;
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    } catch {
      /* unreadable is not found */
    }
  }
  return null;
}

function safeRead(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readLinkedStylesheets(html: string, htmlFile: string, projectDir: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+\.css)["'][^>]*>/gi)) {
    const href = match[1];
    if (/^(https?:)?\/\//i.test(href)) continue;
    const candidates = href.startsWith("/")
      ? ["public", "static", ".", "dist", "out"].map((base) => path.join(projectDir, base, href))
      : [path.resolve(path.dirname(htmlFile), href), path.join(projectDir, href)];
    for (const candidate of candidates) {
      if (!candidate.startsWith(projectDir)) continue;
      const css = fs.existsSync(candidate) ? safeRead(candidate) : null;
      if (css !== null) {
        out.push(css);
        break;
      }
    }
  }
  return out;
}

function collectVars(rules: CssRule[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const rule of rules) {
    if (!/^(:root|html|body|\*)$/i.test(rule.selector)) continue;
    for (const [property, value] of Object.entries(rule.declarations)) {
      if (property.startsWith("--")) vars[property] = value;
    }
  }
  return vars;
}

function findTag(el: HtmlElement, tag: string): HtmlElement | null {
  if (el.tag === tag) return el;
  for (const child of elementChildren(el)) {
    const found = findTag(child, tag);
    if (found) return found;
  }
  return null;
}

/** Text belonging to this element alone — children carry their own. */
function ownTextOf(el: HtmlElement): string {
  return el.children
    .filter((c): c is string => typeof c === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function fromHtml(el: HtmlElement, rules: CssRule[], vars: Record<string, string>, html: string): Element {
  // Later rules win, and the style attribute wins over all of them. Full
  // specificity is more than this needs: generated code styles by class.
  const styles: Record<string, string> = {};
  for (const rule of rules) {
    const subject = subjectOf(rule.selector);
    if (!subject || !elementMatches(el, subject)) continue;
    for (const [property, value] of Object.entries(rule.declarations)) {
      if (!property.startsWith("--")) styles[property] = resolveVars(value, vars);
    }
  }
  if (el.attrs.style) {
    for (const [property, value] of Object.entries(parseDeclarations(el.attrs.style))) {
      styles[property] = resolveVars(value, vars);
    }
  }
  // Tailwind-style utilities cannot be resolved without the compiled stylesheet;
  // where one is present these class names are read directly instead.
  Object.assign(styles, utilitiesToStyles(classList(el)));

  return {
    tag: el.tag,
    figId: el.attrs["data-fig-id"] ?? el.attrs["data-figma-id"] ?? null,
    classes: classList(el),
    ownText: el.tag === "svg" ? "" : ownTextOf(el),
    styles,
    children: elementChildren(el)
      .filter((child) => !INFRASTRUCTURE_TAGS.has(child.tag))
      .map((child) => fromHtml(child, rules, vars, html)),
    line: lineOf(html, el),
  };
}

/**
 * The handful of Tailwind utilities that carry the properties this audit reads.
 * Enough to check a Tailwind page without compiling it; anything unrecognised is
 * simply absent, and an absent property is never reported as a mismatch.
 */
function utilitiesToStyles(classes: string[]): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const name of classes) {
    if (name === "flex") styles.display = "flex";
    else if (name === "grid") styles.display = "grid";
    else if (name === "hidden") styles.display = "none";
    else if (name === "flex-row") styles["flex-direction"] = "row";
    else if (name === "flex-col") styles["flex-direction"] = "column";
    else if (name === "flex-wrap") styles["flex-wrap"] = "wrap";
    else if (name === "w-full") styles.width = "100%";
    else if (name === "w-fit") styles.width = "fit-content";
    else if (name === "h-auto") styles.height = "auto";
    else if (name === "h-fit") styles.height = "fit-content";
    else if (name === "flex-1") styles.flex = "1 1 0%";
    else if (name === "grow") styles["flex-grow"] = "1";
    else {
      const arbitrary = /^(w|h|gap|gap-x|gap-y|p|px|py|pt|pr|pb|pl)-\[(-?[\d.]+)px\]$/.exec(name);
      if (arbitrary) applySpacingUtility(styles, arbitrary[1], `${arbitrary[2]}px`);
      else {
        // The default scale: one step is 0.25rem.
        const scaled = /^(gap|gap-x|gap-y|p|px|py|pt|pr|pb|pl)-(\d+(?:\.\d+)?)$/.exec(name);
        if (scaled) applySpacingUtility(styles, scaled[1], `${parseFloat(scaled[2]) * 4}px`);
      }
    }
  }
  return styles;
}

function applySpacingUtility(styles: Record<string, string>, prefix: string, value: string): void {
  switch (prefix) {
    case "w": styles.width = value; break;
    case "h": styles.height = value; break;
    case "gap": styles.gap = value; break;
    case "gap-x": styles["column-gap"] = value; break;
    case "gap-y": styles["row-gap"] = value; break;
    case "p": styles.padding = value; break;
    case "px": styles["padding-left"] = value; styles["padding-right"] = value; break;
    case "py": styles["padding-top"] = value; styles["padding-bottom"] = value; break;
    case "pt": styles["padding-top"] = value; break;
    case "pr": styles["padding-right"] = value; break;
    case "pb": styles["padding-bottom"] = value; break;
    case "pl": styles["padding-left"] = value; break;
  }
}

function fromSnapshot(node: SnapshotNode): Element | null {
  if (!node || typeof node !== "object") return null;
  const classes = Array.isArray(node.classes)
    ? node.classes
    : typeof node.classes === "string"
      ? node.classes.split(/\s+/).filter(Boolean)
      : [];
  return {
    tag: (node.tag || "div").toLowerCase(),
    figId: node.figId ?? node.id ?? null,
    classes,
    ownText: (node.text || "").replace(/\s+/g, " ").trim(),
    styles: node.styles || {},
    children: (node.children || []).map(fromSnapshot).filter((el): el is Element => el !== null),
    line: 0,
  };
}

function hasAnyStyle(el: Element): boolean {
  if (Object.keys(el.styles).length > 0) return true;
  return el.children.some(hasAnyStyle);
}

function lineOf(html: string, el: HtmlElement): number {
  const id = el.attrs["data-fig-id"] || el.attrs.id;
  const needle = id ? `"${id}"` : `<${el.name}`;
  const index = html.indexOf(needle);
  if (index < 0) return 0;
  return html.slice(0, index).split(/\r?\n/).length;
}

// ── Matching the contract to the output ─────────────────────────────────────

interface MatchContext {
  route: string;
  source: string;
  tolerance: number;
  wrappersAllowed: boolean;
  styled: boolean;
  dropped: Finding[];
  invented: Finding[];
  drift: Finding[];
  layoutMismatch: Finding[];
  sizingMismatch: Finding[];
  copyMismatch: Finding[];
  wrappersSeen: Finding[];
}

/**
 * Elements that only wrap: `<picture>`, and — when allowed — an *anonymous*
 * single-child element with no text of its own. Real generators emit these
 * (next/image spans, `<picture>` around `<img>`), and failing them as "invented"
 * would bury the findings that matter. They are reported separately instead.
 *
 * Anonymous is the load-bearing word. A single-child element that carries a
 * class or a `data-fig-id` is how a Figma frame with one child is supposed to
 * look, and flattening it would drop a real node and report the drop as a
 * defect — the audit inventing its own findings.
 */
function flatten(elements: Element[], allowed: boolean, ctx?: MatchContext): Element[] {
  const out: Element[] = [];
  for (const el of elements) {
    if (isTransparent(el, allowed)) {
      if (ctx && !TRANSPARENT_TAGS.has(el.tag)) {
        ctx.wrappersSeen.push({ where: at(ctx, el), detail: `<${el.tag}> wraps a single child` });
      }
      out.push(...flatten(el.children, allowed, ctx));
    } else {
      out.push(el);
    }
  }
  return out;
}

function isTransparent(el: Element, allowed: boolean): boolean {
  if (el.figId) return false;
  if (TRANSPARENT_TAGS.has(el.tag)) return true;
  if (!allowed) return false;
  return el.children.length === 1 && el.ownText === "" && el.classes.length === 0;
}

function matchLevel(nodes: ContractNode[], elements: Element[], ctx: MatchContext): number {
  const slots = elements.map((el, index) => ({ el, index, used: false }));
  let matched = 0;

  nodes.forEach((node, expected) => {
    const slot = pick(node, slots, expected);
    if (!slot) {
      const size = countNodes([node]);
      ctx.dropped.push({
        where: `${ctx.route} ${ctx.source}`,
        detail: `${describeNode(node)} is in the contract and not in the output${size > 1 ? ` (with ${size - 1} descendant(s))` : ""}`,
      });
      return;
    }

    slot.used = true;
    matched++;

    if (slot.index !== expected) {
      ctx.drift.push({
        where: at(ctx, slot.el),
        detail: `${describeNode(node)} is child #${expected + 1} in Figma and #${slot.index + 1} in the output`,
      });
    }

    if (ctx.styled) {
      checkLayout(node, slot.el, ctx);
      checkSizing(node, slot.el, ctx);
    }
    checkText(node, slot.el, ctx);

    matched += matchLevel(node.children || [], flatten(slot.el.children, ctx.wrappersAllowed, ctx), ctx);
  });

  for (const slot of slots) {
    if (slot.used) continue;
    // A leaf carrying neither text nor an asset is a styling hook, not content.
    ctx.invented.push({
      where: at(ctx, slot.el),
      detail: `<${slot.el.tag}${slot.el.classes[0] ? `.${slot.el.classes[0]}` : ""}> has no node in the contract`,
    });
  }

  return matched;
}

interface Slot {
  el: Element;
  index: number;
  used: boolean;
}

/** Exact anchor, then the layer-name slug, then position. */
function pick(node: ContractNode, slots: Slot[], expected: number): Slot | null {
  const byId = slots.find((s) => !s.used && s.el.figId && s.el.figId === node.id);
  if (byId) return byId;

  const slug = node.slug || slugify(node.name || "");
  if (slug) {
    const byClass = slots.find(
      (s) => !s.used && (s.el.classes.includes(slug) || s.el.classes.some((c) => c.endsWith(`-${slug}`) || c === slug))
    );
    if (byClass) return byClass;
  }

  const atExpected = slots[expected];
  if (atExpected && !atExpected.used && compatible(node, atExpected.el)) return atExpected;

  return slots.find((s) => !s.used && compatible(node, s.el)) ?? null;
}

/** Deliberately loose: a wrong match is reported, a missed match is a false drop. */
function compatible(node: ContractNode, el: Element): boolean {
  const type = (node.type || "").toUpperCase();
  if (type === "TEXT") return !["img", "svg", "video", "canvas", "input"].includes(el.tag);
  if ((type === "VECTOR" || type === "RECTANGLE") && node.assetId) {
    return ["img", "svg", "picture", "figure", "div", "span"].includes(el.tag);
  }
  return true;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function countNodes(nodes: ContractNode[]): number {
  let total = 0;
  for (const node of nodes) total += 1 + countNodes(node.children || []);
  return total;
}

function describeNode(node: ContractNode): string {
  const label = node.name || node.slug || node.type || "node";
  return `${label} [${node.id}]`;
}

function at(ctx: MatchContext, el: Element): string {
  return el.line ? `${ctx.source}:${el.line}` : `${ctx.route} ${ctx.source}`;
}

// ── The property checks ─────────────────────────────────────────────────────

/**
 * Gap and padding are compared only where the output declares them. An absent
 * declaration is not evidence of a wrong value — it is as often a utility class
 * this audit cannot resolve — and a false FAIL costs more than a missed one,
 * because it teaches the next reader to ignore the report.
 */
function checkLayout(node: ContractNode, el: Element, ctx: MatchContext): void {
  const layout = node.layout;
  if (!layout) return;

  const display = (el.styles.display || "").trim();
  const direction = (el.styles["flex-direction"] || "row").trim();
  const mode = layout.mode;

  if (mode === "HORIZONTAL" || mode === "VERTICAL") {
    const wantColumn = mode === "VERTICAL";
    if (!/flex|grid/.test(display)) {
      if (display) {
        ctx.layoutMismatch.push({
          where: at(ctx, el),
          detail: `${describeNode(node)} is Auto Layout ${mode} in Figma; the output declares display: ${display}`,
        });
      }
    } else if (/flex/.test(display) && direction.includes("column") !== wantColumn) {
      ctx.layoutMismatch.push({
        where: at(ctx, el),
        detail: `${describeNode(node)} is ${mode} in Figma; the output is flex-direction: ${direction}`,
      });
    }
  } else if (mode === "GRID" && display && !/grid/.test(display)) {
    ctx.layoutMismatch.push({
      where: at(ctx, el),
      detail: `${describeNode(node)} is a Figma grid; the output declares display: ${display}`,
    });
  }

  if (typeof layout.gap === "number") {
    const gap = declaredPx(el, ["gap", "row-gap", "column-gap"]);
    if (gap !== null && Math.abs(gap - layout.gap) > ctx.tolerance) {
      ctx.layoutMismatch.push({
        where: at(ctx, el),
        detail: `${describeNode(node)} gap is ${layout.gap} in Figma and ${gap} in the output`,
      });
    }
  }

  const padding = normalizePadding(layout.padding);
  if (padding) {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const expected = padding[side];
      if (typeof expected !== "number") continue;
      const actual = declaredPx(el, [`padding-${side}`, "padding"]);
      if (actual !== null && Math.abs(actual - expected) > ctx.tolerance) {
        ctx.layoutMismatch.push({
          where: at(ctx, el),
          detail: `${describeNode(node)} padding-${side} is ${expected} in Figma and ${actual} in the output`,
        });
      }
    }
  }
}

/**
 * Sizing is checked by what the output *declares*, never by what it omits — so
 * these findings are always real. The fixed height on a HUG frame is the one
 * this exists for: it renders correctly today and breaks the moment the copy
 * grows by a line.
 */
function checkSizing(node: ContractNode, el: Element, ctx: MatchContext): void {
  const layout = node.layout;
  if (!layout) return;

  const height = el.styles.height?.trim();
  const width = el.styles.width?.trim();

  if (layout.sizingVertical === "HUG" && isFixedLength(height)) {
    ctx.sizingMismatch.push({
      where: at(ctx, el),
      detail: `${describeNode(node)} hugs its content in Figma; the output pins height: ${height}`,
    });
  }

  if (layout.sizingHorizontal === "FILL" && isFixedLength(width)) {
    ctx.sizingMismatch.push({
      where: at(ctx, el),
      detail: `${describeNode(node)} fills its container in Figma; the output pins width: ${width}`,
    });
  }

  if (layout.sizingHorizontal === "HUG" && (width === "100%" || el.styles.flex?.startsWith("1"))) {
    ctx.sizingMismatch.push({
      where: at(ctx, el),
      detail: `${describeNode(node)} hugs its content in Figma; the output stretches it (${width || el.styles.flex})`,
    });
  }

  if (layout.sizingHorizontal === "FIXED" && typeof layout.width === "number" && isFixedLength(width)) {
    const actual = toPx(width as string, 16);
    if (actual !== null && Math.abs(actual - layout.width) > ctx.tolerance) {
      ctx.sizingMismatch.push({
        where: at(ctx, el),
        detail: `${describeNode(node)} is ${layout.width}px wide in Figma and ${actual}px in the output`,
      });
    }
  }
}

function checkText(node: ContractNode, el: Element, ctx: MatchContext): void {
  if ((node.type || "").toUpperCase() !== "TEXT") return;
  if (typeof node.text !== "string" || node.text.trim() === "") return;

  const actual = elementText(el);
  if (actual === "") {
    // Interpolated or component-rendered copy: present, but not readable here.
    return;
  }
  if (normalizeCopy(actual) !== normalizeCopy(node.text)) {
    ctx.copyMismatch.push({
      where: at(ctx, el),
      detail: `${describeNode(node)} reads ${quote(node.text)} in Figma and ${quote(actual)} in the output`,
    });
  }
}

function elementText(el: Element): string {
  const parts = [el.ownText, ...el.children.map(elementText)];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Typographic substitutions are the renderer's, not a rewrite. */
function normalizeCopy(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function quote(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return `"${flat.length > 60 ? `${flat.slice(0, 60)}…` : flat}"`;
}

function declaredPx(el: Element, properties: string[]): number | null {
  for (const property of properties) {
    const raw = el.styles[property];
    if (!raw) continue;
    const first = raw.trim().split(/\s+/)[0];
    const value = toPx(first, 16);
    if (value !== null) return value;
  }
  return null;
}

/** A length that cannot grow with its content. Percentages and keywords can. */
function isFixedLength(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (/^(auto|inherit|initial|unset|revert|fit-content|max-content|min-content|100%)$/i.test(trimmed)) return false;
  if (trimmed.endsWith("%") || /^(calc|clamp|min|max)\(/i.test(trimmed)) return false;
  return toPx(trimmed, 16) !== null;
}

function normalizePadding(padding: ContractPadding | number | null | undefined): ContractPadding | null {
  if (padding === null || padding === undefined) return null;
  if (typeof padding === "number") return { top: padding, right: padding, bottom: padding, left: padding };
  return padding;
}

function text(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}
