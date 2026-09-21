/**
 * The 1:1 gate: does the generated project actually match what Figma had?
 *
 * WHY THIS EXISTS
 * ---------------
 * The skill tells the model not to invent UI, not to use placeholders and to
 * wire every exported asset. Instructions alone do not hold — a model that
 * cannot find an image writes `placehold.co` and reports success, and nobody
 * notices until the page is open in a browser with broken thumbnails.
 *
 * This tool checks the claim mechanically, against the filesystem:
 *
 *   - every image reference in the code resolves to a file that exists
 *   - no placeholder services, lorem ipsum or empty `src` survive
 *   - every asset in assets.manifest.json is actually referenced
 *   - no raw hex/px values where tokens were required
 *
 * It reports PASS/FAIL per check with the offending file and line, so a
 * failure is actionable rather than a verdict.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "fs";
import * as path from "path";

/** Directories that are never the generated source. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", ".turbo",
  "coverage", ".cache", "vendor", "Pods", ".gradle", "DerivedData",
]);

const SOURCE_EXT = new Set([
  ".html", ".htm", ".css", ".scss", ".js", ".jsx", ".ts", ".tsx",
  ".vue", ".svelte", ".astro", ".kt", ".swift", ".xml",
]);

/** Markers of a design that was invented rather than exported. */
const PLACEHOLDER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /placehold\.(co|it|jp)/i, label: "placehold.co" },
  { re: /via\.placeholder\.com/i, label: "via.placeholder.com" },
  { re: /picsum\.photos/i, label: "picsum.photos" },
  { re: /source\.unsplash\.com/i, label: "unsplash source" },
  { re: /dummyimage\.com/i, label: "dummyimage.com" },
  { re: /lorem\s+ipsum/i, label: "lorem ipsum" },
  { re: /\bsrc\s*=\s*(""|''|\{\s*""\s*\})/, label: "empty src" },
  { re: /<img[^>]*\bsrc\s*=\s*["']#["']/i, label: "placeholder href src" },
  { re: /\b(placeholder|your)[-_]?image\b/i, label: 'named "placeholder image"' },
];

/** Reference forms that point at an asset file. */
const REFERENCE_PATTERNS: RegExp[] = [
  /\bsrc\s*=\s*["']([^"'${}]+?)["']/gi,
  /\bsrcS?et\s*=\s*["']([^"'${}]+?)["']/gi,
  /url\(\s*["']?([^"')${}]+?)["']?\s*\)/gi,
  /\brequire\(\s*["']([^"'${}]+?)["']\s*\)/gi,
  /\bfrom\s+["']([^"'${}]*\.(?:png|jpe?g|gif|webp|avif|svg))["']/gi,
  /\bhref\s*=\s*["']([^"'${}]+?\.(?:png|jpe?g|gif|webp|avif|svg))["']/gi,
];

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** Raw values that should have been tokens. */
const RAW_VALUE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /#[0-9a-fA-F]{6}\b(?![0-9a-fA-F])/, label: "raw hex color" },
  { re: /\brgba?\(\s*\d+\s*,/, label: "raw rgb color" },
  { re: /\[#[0-9a-fA-F]{3,8}\]/, label: "arbitrary Tailwind color" },
  { re: /\[\d+(\.\d+)?px\]/, label: "arbitrary Tailwind size" },
];

/**
 * A model that never reached Figma does not usually write `placehold.co`. It
 * paints the slot instead: a box with an aspect ratio, a gradient fill, an
 * inline SVG glyph and a caption naming the picture that should have been
 * there. That reads as design, not as a placeholder, so every URL-shaped
 * pattern above misses it — and the audit used to report PASS on a project
 * whose every image was fabricated this way.
 *
 * These patterns only count in a file that loads no real image at all; a
 * gradient beside an actual `<img>` is just a gradient.
 */
const FABRICATED_SLOT_PATTERNS: Array<{ re: RegExp; label: string; needsPaint?: boolean }> = [
  {
    re: /\b(?:image|img|photo|mockup|thumb(?:nail)?|screenshot|poster|artwork|avatar)[A-Za-z]*\s*[:=]\s*["'`]/i,
    label: "image slot described in a string instead of loaded from a file",
  },
  {
    re: /\baspect-?ratio\s*:\s*["'`]?\s*[\d.]+\s*\/\s*[\d.]+/i,
    label: "aspect-ratio box with no image in it",
    needsPaint: true,
  },
];

/** The fill that turns an empty box into something that looks like a picture. */
const PAINT_PATTERN = /(?:linear|radial|conic)-gradient\s*\(|background(?:-color)?\s*:\s*(?:#|rgb|var\()/i;

/** Ways real image content actually enters a file. */
const REAL_IMAGE_PATTERNS: RegExp[] = [
  /<img\b/i,
  /<(?:Image|ExpoImage|NextImage)\b/,
  /\bfrom\s+["']next\/image["']/,
  /\bfrom\s+["']expo-image["']/,
  /\bpainterResource\s*\(/,
  /\bAsyncImage\s*\(/,
  /url\(\s*["']?[^"')]*\.(?:png|jpe?g|gif|webp|avif|svg)/i,
];

interface Finding {
  file: string;
  line: number;
  detail: string;
}

interface ManifestAsset {
  id?: string;
  file?: string;
  kind?: string;
  nodes?: unknown[];
}

export function registerAuditTools(server: McpServer): void {
  server.tool(
    "audit_generated_code",
    "Audit a generated frontend project for 1:1 fidelity before calling it done: broken image paths, placeholder " +
      "images, image slots faked with gradients and inline SVG, a project that wires no images at all, " +
      "unreferenced exported assets, and raw hex/px values that should be tokens. Run this at the end of " +
      "every Figma-to-code run. Returns PASS/FAIL per check with file and line; a check that could not be run " +
      "is UNVERIFIED and blocks the pass, never a silent PASS.",
    {
      projectDir: z.string().describe("Absolute path of the generated project root"),
      manifestPath: z
        .string()
        .optional()
        .describe("Absolute path to assets.manifest.json. Defaults to <projectDir>/assets/assets.manifest.json"),
      checkTokens: z
        .boolean()
        .optional()
        .describe("Also fail on raw hex/px values in component code (default true)"),
      requireAssets: z
        .boolean()
        .optional()
        .describe(
          "Whether this project is expected to carry assets exported from Figma (default true). When true, a " +
            "missing manifest is UNVERIFIED and a project that resolves no image at all fails. Set false only " +
            "for a design that genuinely has no images, or one serving every image from a remote CDN."
        ),
    },
    async ({ projectDir, manifestPath, checkTokens, requireAssets }) => {
      try {
        if (!path.isAbsolute(projectDir)) return text(`projectDir must be an absolute path. Received: ${projectDir}`);
        if (!fs.existsSync(projectDir)) return text(`projectDir does not exist: ${projectDir}`);

        const files = collectSourceFiles(projectDir);
        if (files.length === 0) {
          return text(`No source files found under ${projectDir}. Nothing to audit — is this the right directory?`);
        }

        const assetsExpected = requireAssets !== false;
        const placeholders: Finding[] = [];
        const broken: Finding[] = [];
        const rawValues: Finding[] = [];
        const fabricated: Finding[] = [];
        const referenced = new Set<string>();
        let resolvedImages = 0;

        for (const file of files) {
          let contents: string;
          try {
            contents = fs.readFileSync(file, "utf8");
          } catch {
            continue;
          }
          const rel = path.relative(projectDir, file);
          const lines = contents.split(/\r?\n/);
          const references = extractReferences(contents);

          // A file that loads no image anywhere is the only place a painted
          // box can be standing in for one.
          const imageRefs = references.filter((reference) => IMAGE_EXT.test(reference));
          const loadsRealImage = imageRefs.length > 0 || REAL_IMAGE_PATTERNS.some((re) => re.test(contents));
          const painted = PAINT_PATTERN.test(contents);

          lines.forEach((line, index) => {
            for (const { re, label } of PLACEHOLDER_PATTERNS) {
              if (re.test(line)) placeholders.push({ file: rel, line: index + 1, detail: label });
            }

            if (!loadsRealImage && isComponentFile(file)) {
              for (const { re, label, needsPaint } of FABRICATED_SLOT_PATTERNS) {
                if (!re.test(line)) continue;
                if (needsPaint && !painted) continue;
                fabricated.push({ file: rel, line: index + 1, detail: `${label}: ${line.trim().slice(0, 60)}` });
              }
            }

            if (checkTokens !== false && isComponentFile(file)) {
              for (const { re, label } of RAW_VALUE_PATTERNS) {
                // A token definition file is where raw values belong.
                if (re.test(line) && !isTokenFile(rel)) {
                  rawValues.push({ file: rel, line: index + 1, detail: `${label}: ${line.trim().slice(0, 60)}` });
                }
              }
            }
          });

          for (const reference of imageRefs) {
            referenced.add(path.basename(reference.split("?")[0].split("#")[0]));
            const resolved = resolveReference(reference, file, projectDir);
            if (resolved) resolvedImages++;
            if (!resolved) {
              broken.push({
                file: rel,
                line: lineOf(contents, reference),
                detail: reference.length > 70 ? `${reference.slice(0, 70)}…` : reference,
              });
            }
          }
        }

        // Every exported asset should have found its way into the code.
        const manifestFile = manifestPath || path.join(projectDir, "assets", "assets.manifest.json");
        let unreferenced: string[] = [];
        let manifestCount = 0;
        let manifestNote = "";

        if (fs.existsSync(manifestFile)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { assets?: ManifestAsset[] };
            const assets = manifest.assets || [];
            manifestCount = assets.length;
            unreferenced = assets
              .map((a) => (a.file ? path.basename(a.file) : ""))
              .filter((name) => name && !referenced.has(name));
          } catch (error) {
            manifestNote = `manifest could not be parsed: ${error instanceof Error ? error.message : String(error)}`;
          }
        } else {
          manifestNote = `no manifest at ${manifestFile} — run export_assets first, or pass manifestPath`;
        }

        // A design that produced no image at all was never wired to Figma's
        // assets. Only meaningful when assets were expected in the first place.
        const noImagesWired: Finding[] =
          assetsExpected && resolvedImages === 0
            ? [
                {
                  file: path.basename(projectDir),
                  line: 0,
                  detail:
                    "no image reference in the whole project resolves to a file — the design's images were " +
                    "never exported or never wired. Run export_assets, or pass requireAssets: false if this " +
                    "design genuinely has none.",
                },
              ]
            : [];

        const checks = [
          { name: "No placeholder images or lorem ipsum", failures: placeholders.length, findings: placeholders },
          {
            name: "Image slots are real assets, not painted boxes",
            failures: fabricated.length,
            findings: fabricated,
          },
          // Claiming PASS for an expectation that was switched off would be
          // the same dishonesty this tool exists to catch. Omit the row.
          ...(assetsExpected
            ? [{ name: "The project wires at least one real image", failures: noImagesWired.length, findings: noImagesWired }]
            : []),
          { name: "Every image path resolves to a real file", failures: broken.length, findings: broken },
          {
            name: "Every exported asset is referenced",
            failures: unreferenced.length,
            findings: unreferenced.map((name) => ({ file: name, line: 0, detail: "exported but never used in code" })),
          },
          ...(checkTokens === false
            ? []
            : [{ name: "No raw hex/px in component code", failures: rawValues.length, findings: rawValues }]),
        ];

        const failed = checks.filter((c) => c.failures > 0);
        const lines: string[] = [
          `Audited ${files.length} source file(s) under ${projectDir}`,
          manifestCount ? `Manifest: ${manifestCount} asset(s)` : manifestNote ? `Manifest: ${manifestNote}` : "",
          "",
          ...checks.map((c) => `${c.failures === 0 ? "PASS" : "FAIL"}  ${c.name}${c.failures ? ` — ${c.failures} issue(s)` : ""}`),
        ].filter(Boolean);

        // An unrunnable check is not a passed check. It is listed here and it
        // blocks the verdict, the same way audit_structure_match treats one.
        const unverified: string[] = [];
        if (assetsExpected && manifestNote && manifestCount === 0) {
          unverified.push(`Asset coverage — ${manifestNote}`);
        }
        for (const note of unverified) lines.push("", `UNVERIFIED  ${note}`);

        for (const check of failed) {
          lines.push("", `${check.name}:`);
          for (const finding of check.findings.slice(0, 25)) {
            lines.push(finding.line ? `  ${finding.file}:${finding.line}  ${finding.detail}` : `  ${finding.file}  ${finding.detail}`);
          }
          if (check.findings.length > 25) lines.push(`  …and ${check.findings.length - 25} more`);
        }

        lines.push("");
        if (failed.length === 0 && unverified.length === 0) {
          lines.push("AUDIT PASSED. Every image resolves, nothing is a placeholder.");
        } else if (failed.length === 0) {
          lines.push(
            `AUDIT INCOMPLETE — every executed check passed, but ${unverified.length} item(s) could not be ` +
              `verified here. They are not passes. Resolve them and re-run before reporting the work as done.`
          );
        } else {
          lines.push(
            `AUDIT FAILED — ${failed.length} check(s)${
              unverified.length ? ` and ${unverified.length} unverified item(s)` : ""
            }. Fix these before reporting the work as done; ` +
              `do not substitute a placeholder for an asset that failed to export.`
          );
        }

        return text(lines.join("\n"));
      } catch (error) {
        return text(`Error auditing generated code: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

function collectSourceFiles(root: string, depth = 0): string[] {
  if (depth > 12) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") {
      if (SKIP_DIRS.has(entry.name)) continue;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectSourceFiles(full, depth + 1));
    } else if (SOURCE_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function extractReferences(contents: string): string[] {
  const found = new Set<string>();
  for (const pattern of REFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(contents)) !== null) {
      const raw = match[1];
      if (!raw) continue;
      // srcset carries several candidates with descriptors.
      for (const candidate of raw.split(",")) {
        const cleaned = candidate.trim().split(/\s+/)[0];
        if (cleaned) found.add(cleaned);
      }
    }
  }
  return [...found].filter(isLocalReference);
}

/** Remote, inline and templated references are out of scope for a path check. */
function isLocalReference(reference: string): boolean {
  if (!reference) return false;
  if (/^(https?:)?\/\//i.test(reference)) return false;
  if (/^(data|blob|mailto|tel):/i.test(reference)) return false;
  if (reference.startsWith("#")) return false;
  if (/[${}]/.test(reference)) return false;
  return true;
}

/**
 * Resolve a reference the way the browser or bundler would: relative to the
 * file, or root-relative against the project and its public directories.
 */
function resolveReference(reference: string, fromFile: string, projectDir: string): string | null {
  const clean = reference.split("?")[0].split("#")[0];
  if (!clean) return null;

  const candidates = clean.startsWith("/")
    ? ["public", "static", "www", "dist", "."].map((base) => path.join(projectDir, base, clean))
    : [
        path.resolve(path.dirname(fromFile), clean),
        path.join(projectDir, clean),
        path.join(projectDir, "public", clean),
        path.join(projectDir, "src", clean),
      ];

  for (const candidate of candidates) {
    // Never let a reference escape the project and claim to resolve.
    if (!candidate.startsWith(projectDir)) continue;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* unreadable is unresolved */
    }
  }
  return null;
}

function lineOf(contents: string, needle: string): number {
  const index = contents.indexOf(needle);
  if (index < 0) return 0;
  return contents.slice(0, index).split(/\r?\n/).length;
}

function isComponentFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return [".jsx", ".tsx", ".vue", ".svelte", ".astro", ".html", ".htm", ".css", ".scss"].includes(ext);
}

/** Where raw values are the whole point. */
function isTokenFile(relativePath: string): boolean {
  return /tokens?|theme|variables|globals\.css|design-system/i.test(relativePath);
}

function text(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}
