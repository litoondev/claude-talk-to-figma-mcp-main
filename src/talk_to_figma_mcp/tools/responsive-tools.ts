/**
 * Responsive Website tools — Inspect → Reuse → Adapt → Validate.
 *
 * WHY THIS EXISTS
 * ---------------
 * Responsive work done badly is proportional scaling: take the desktop frame,
 * shrink it, ship it. That produces unreadable type, squashed cards and
 * navigation that overlaps its own logo.
 *
 * These tools model responsive design the way a designer does — as a set of
 * *behaviour* decisions per section (stack this, wrap that, collapse the nav)
 * applied to a clone of the approved design. Cloning is the load-bearing
 * choice: component instances stay connected, variable and style bindings
 * survive, and copy is never touched, so the safety rules hold by construction
 * rather than by care.
 *
 * BREAKPOINTS
 * The default design frames are 1440 / 768 / 320. Intermediate widths are meant
 * to be handled by Auto Layout, fill/hug sizing and wrapping rather than by
 * more frames. QA runs at BOTH 390 and 320, because a layout that survives 390
 * and breaks at 320 is not responsive.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../utils/websocket";

// ── Shapes returned by the plugin ─────────────────────────────────────────

interface SectionAnalysis {
  id: string;
  name: string;
  kind: string;
  width: number;
  height: number;
  autoLayout: string;
  itemSpacing: number | null;
  childCount: number;
  columns: number | null;
  hasImages: boolean;
  inputCount: number;
  buttonCount: number;
  instanceCount: number;
  fixedWidthChildren: Array<{ id: string; name: string; width: number }>;
  absoluteChildren: Array<{ id: string; name: string }>;
  usesAutoLayout: boolean;
}

interface PlanEntry {
  id: string;
  name: string;
  kind: string;
  behaviors: string[];
}

interface ValidationIssue {
  severity: string;
  type: string;
  node: string;
  nodeId: string;
  message: string;
}

interface ValidationResult {
  label: string;
  viewport: number;
  frameName: string;
  inspected: number;
  passed: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
  truncated: number;
}

interface FrameReport {
  breakpoint: string;
  width: number;
  frameId: string | null;
  frameName: string;
  created: boolean;
  sections: Array<{ name: string; kind: string; changes: string[] }>;
  reusedVariants: string[];
  preservedTextStyles: number;
  textStylesInUse: string[];
  unlinkedText: string[];
  setToFill: number;
  setToHug: number;
  textAutoHeight: number;
  fixedHeightsReleased: number;
  fixedWidthsReleased: number;
  renamed: string[];
  removed: string[];
  collapsed: string[];
  warnings: string[];
  error?: string;
}

// ── Rendering helpers ─────────────────────────────────────────────────────

function renderValidation(v: ValidationResult, indent = "  "): string[] {
  const lines: string[] = [];
  const verdict = v.passed
    ? `PASS (${v.warningCount} warning${v.warningCount === 1 ? "" : "s"})`
    : `FAIL — ${v.errorCount} error${v.errorCount === 1 ? "" : "s"}, ${v.warningCount} warning${v.warningCount === 1 ? "" : "s"}`;
  lines.push(`${indent}${v.label}: ${verdict}`);

  const errors = v.issues.filter((i) => i.severity === "error");
  const warnings = v.issues.filter((i) => i.severity !== "error");

  for (const issue of errors.slice(0, 15)) {
    lines.push(`${indent}  ✕ ${issue.node} — ${issue.message}`);
  }
  for (const issue of warnings.slice(0, 10)) {
    lines.push(`${indent}  ! ${issue.node} — ${issue.message}`);
  }
  if (v.truncated > 0) {
    lines.push(`${indent}  … ${v.truncated} further issues not listed`);
  }
  return lines;
}

function describeBehavior(behavior: string): string {
  if (behavior.startsWith("columns:")) return `${behavior.split(":")[1]} column layout`;
  const map: Record<string, string> = {
    "reduce-padding": "reduce padding",
    "reduce-gap": "reduce gap",
    "release-fixed-width": "release fixed widths",
    "stack-vertical": "stack vertically",
    "text-before-media": "copy above media",
    "media-full-width": "media full width",
    "equalize-split": "equalise split",
    "enable-wrap": "enable wrapping",
    "stack-form-rows": "stack form rows",
    "inputs-fill-width": "inputs fill width",
    "collapse-navigation": "collapse navigation to mobile",
    "collapse-navigation-if-crowded": "collapse navigation if crowded",
    "keep-horizontal": "keep horizontal",
    "table-horizontal-scroll": "table scrolls horizontally",
    "flag-manual-review": "FLAG for manual review",
    "flag-absolute-positioning": "FLAG absolute positioning",
  };
  return map[behavior] ?? behavior;
}

export function registerResponsiveTools(server: McpServer): void {
  // ── 1. analyze_responsive ───────────────────────────────────────────────
  server.tool(
    "analyze_responsive",
    "Inspect a desktop frame, page or section and report how it should behave responsively — " +
      "WITHOUT modifying anything. Classifies each section (navigation, hero, card grid, form, " +
      "table, footer), reports auto-layout readiness, fixed widths and absolutely positioned " +
      "children that cannot reflow, finds existing tablet/mobile frames so they can be updated " +
      "rather than duplicated, and returns the planned responsive behaviour per section for " +
      "tablet and mobile. Run this before make_responsive to review the plan, or on its own to " +
      "audit an existing design for responsive problems.",
    {
      nodeId: z
        .string()
        .optional()
        .describe("Frame or section to analyze. Defaults to the current Figma selection."),
      preservation: z
        .enum(["strict", "balanced", "flexible"])
        .optional()
        .describe(
          "How much change is permitted. 'strict' (default) preserves the design as far as " +
            "possible; 'balanced' allows minor restructuring; 'flexible' allows larger layout " +
            "restructuring. Typography is never altered in any mode."
        ),
    },
    async ({ nodeId, preservation }) => {
      try {
        const r = (await sendCommandToFigma("analyze_responsive", {
          nodeId,
          preservation: preservation ?? "strict",
        })) as {
          source: Record<string, unknown>;
          sectionCount: number;
          sections: SectionAnalysis[];
          plans: Record<string, PlanEntry[]>;
          existingResponsiveFrames: Array<{ id: string; name: string; width: number }>;
          sourceIssues: ValidationResult;
          readiness: {
            usesAutoLayout: boolean;
            sectionsWithoutAutoLayout: string[];
            sectionsWithAbsoluteChildren: string[];
            totalInstances: number;
          };
        };

        const lines: string[] = [];
        const src = r.source as Record<string, any>;

        lines.push(
          `Responsive analysis — "${src.name}" (${src.width}×${src.height}, ` +
            `closest preset: ${src.closestPreset})`
        );
        lines.push(`${r.sectionCount} sections · ${r.readiness.totalInstances} component instances`);

        // Readiness first: these determine whether adaptation can work at all.
        lines.push("\n── READINESS ──────────────────────────────────────────");
        lines.push(
          `  Root auto layout: ${r.readiness.usesAutoLayout ? "yes" : "NO — layout cannot reflow reliably"}`
        );
        if (r.readiness.sectionsWithoutAutoLayout.length) {
          lines.push(
            `  Sections without auto layout: ${r.readiness.sectionsWithoutAutoLayout.join(", ")}`
          );
        }
        if (r.readiness.sectionsWithAbsoluteChildren.length) {
          lines.push(
            `  Absolutely positioned content: ${r.readiness.sectionsWithAbsoluteChildren.join(", ")}`
          );
        }

        // Existing frames — reuse before creating.
        lines.push("\n── EXISTING RESPONSIVE FRAMES ─────────────────────────");
        if (r.existingResponsiveFrames.length) {
          for (const f of r.existingResponsiveFrames) {
            lines.push(`  ${f.name} — ${f.width}px  (id: ${f.id})`);
          }
          lines.push("  Update these rather than creating duplicates.");
        } else {
          lines.push("  None found. make_responsive will create new frames.");
        }

        // Section-by-section plan.
        lines.push("\n── SECTIONS AND PLANNED BEHAVIOUR ─────────────────────");
        for (let i = 0; i < r.sections.length; i++) {
          const s = r.sections[i];
          const tabletPlan = r.plans.tablet?.[i];
          const mobilePlan = r.plans.mobile?.[i];

          const detail: string[] = [`${s.autoLayout.toLowerCase()} layout`, `${s.childCount} children`];
          if (s.columns) detail.push(`${s.columns} columns`);
          if (s.inputCount) detail.push(`${s.inputCount} inputs`);
          if (s.instanceCount) detail.push(`${s.instanceCount} instances`);

          lines.push(`\n  [${s.kind}] ${s.name}  (${detail.join(", ")})`);
          if (s.fixedWidthChildren.length) {
            lines.push(
              `      fixed widths: ${s.fixedWidthChildren.map((c) => `${c.name} ${c.width}px`).join(", ")}`
            );
          }
          if (tabletPlan) {
            lines.push(`      768:  ${tabletPlan.behaviors.map(describeBehavior).join(" · ")}`);
          }
          if (mobilePlan) {
            lines.push(`      320:  ${mobilePlan.behaviors.map(describeBehavior).join(" · ")}`);
          }
        }

        // Problems already present in the source.
        if (r.sourceIssues && (r.sourceIssues.errorCount || r.sourceIssues.warningCount)) {
          lines.push("\n── ISSUES IN THE SOURCE DESIGN ────────────────────────");
          lines.push(...renderValidation(r.sourceIssues));
        }

        lines.push("\n── NEXT ───────────────────────────────────────────────");
        lines.push(
          "  Run make_responsive to generate 768px and 320px frames from this plan.\n" +
            "  Nothing has been modified by this analysis."
        );

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Could not analyze the selection: ${detail}` }],
        };
      }
    }
  );

  // ── 2. make_responsive ──────────────────────────────────────────────────
  server.tool(
    "make_responsive",
    "Generate responsive tablet (768px) and mobile (320px) versions of a desktop frame, page or " +
      "section. Works by CLONING the source and adapting the clone's layout — so component " +
      "instances stay connected, variable and style bindings survive, copy is never rewritten, " +
      "and the original desktop frame is never modified. " +
      "Sections are adapted by behaviour, not by scaling: grids drop columns, heroes stack with " +
      "copy above media, form rows go single-column, navigation switches to an existing mobile " +
      "variant, wide tables scroll rather than shrink. " +
      "TYPOGRAPHY IS NEVER CHANGED — every breakpoint keeps the exact same local text style as " +
      "the desktop source. No style switching, no size, weight, line-height or letter-spacing " +
      "edits. Text that does not fit is solved with Fill container, Hug contents, wrapping and " +
      "stacking. Containers are set to Fill width / Hug height so nothing carries a fixed size. " +
      "Every generated mobile frame is validated at BOTH 390px and 320px. Anything that cannot " +
      "be adapted safely is left alone and reported as needing manual review. " +
      "Call get_design_system and analyze_responsive first.",
    {
      nodeId: z
        .string()
        .optional()
        .describe("Source frame to make responsive. Defaults to the current Figma selection."),
      breakpoints: z
        .array(z.enum(["tablet", "mobile"]))
        .optional()
        .describe(
          "Which frames to generate. Default ['tablet','mobile'] → 768px and 320px. " +
            "Intermediate widths are handled by auto layout rather than extra frames."
        ),
      preservation: z
        .enum(["strict", "balanced", "flexible"])
        .optional()
        .describe(
          "'strict' (default) keeps the design as-is and only changes layout flow. 'balanced' " +
            "allows minor restructuring; 'flexible' allows larger restructuring. Typography is " +
            "untouched in every mode."
        ),
      mode: z
        .enum(["create", "preview"])
        .optional()
        .describe(
          "'create' (default) generates frames. 'preview' returns the plan and changes nothing."
        ),
      cleanLayers: z
        .boolean()
        .optional()
        .describe(
          "Tidy the generated frames' layer tree: rename generic layers, remove empty ones, " +
            "collapse redundant wrappers. Never enters component instances. Default true."
        ),
      gutter: z
        .number()
        .optional()
        .describe("Horizontal gap between the source frame and generated frames. Default 120px."),
    },
    async ({ nodeId, breakpoints, preservation, mode, cleanLayers, gutter }) => {
      try {
        const r = (await sendCommandToFigma("make_responsive", {
          nodeId,
          breakpoints: breakpoints ?? ["tablet", "mobile"],
          preservation: preservation ?? "strict",
          mode: mode ?? "create",
          cleanLayers: cleanLayers !== false,
          gutter,
        })) as {
          mode?: string;
          previewOnly?: boolean;
          source: { name: string; width: number };
          preservation: string;
          textStylesAvailable: number;
          frames: FrameReport[];
          validations: ValidationResult[];
          qaWidths: number[];
        };

        if (r.previewOnly) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Preview mode — nothing was created or modified.\n" +
                  "Run analyze_responsive for the full plan, or call make_responsive with " +
                  "mode:'create' to generate the frames.",
              },
            ],
          };
        }

        const lines: string[] = [];
        lines.push(`Responsive update complete — source "${r.source.name}" (${r.source.width}px)`);
        lines.push(`Preservation mode: ${r.preservation}`);

        // Created
        lines.push("\nCreated:");
        for (const f of r.frames) {
          if (f.error) {
            lines.push(`  ✕ ${f.breakpoint}: ${f.error}`);
            continue;
          }
          lines.push(`  - ${f.frameName} (${f.width}px)`);
        }

        // Reused — the point of the whole exercise
        const reused = r.frames.flatMap((f) => f.reusedVariants ?? []);
        if (reused.length) {
          lines.push("\nReused existing component variants:");
          for (const v of Array.from(new Set(reused))) lines.push(`  - ${v}`);
        }

        // Typography — identical at every breakpoint, by design.
        const stylesInUse = r.frames.flatMap((f) => f.textStylesInUse ?? []);
        const preservedType = r.frames.reduce((n, f) => n + (f.preservedTextStyles ?? 0), 0);

        lines.push("\nTypography — unchanged across all breakpoints:");
        if (preservedType > 0) {
          lines.push(
            `  ${preservedType} text layers kept their original local style, identical to desktop.`
          );
        }
        if (stylesInUse.length) {
          lines.push(`  Styles in use: ${Array.from(new Set(stylesInUse)).join(", ")}`);
        }
        lines.push(
          "  No style was switched, no size, weight, line height or letter spacing was altered."
        );

        // Sizing — fill/hug replacing fixed dimensions.
        const toFill = r.frames.reduce((n, f) => n + (f.setToFill ?? 0), 0);
        const toHug = r.frames.reduce((n, f) => n + (f.setToHug ?? 0), 0);
        const heights = r.frames.reduce((n, f) => n + (f.fixedHeightsReleased ?? 0), 0);
        const autoH = r.frames.reduce((n, f) => n + (f.textAutoHeight ?? 0), 0);
        if (toFill || toHug || heights || autoH) {
          lines.push("\nResponsive sizing (fixed dimensions removed):");
          if (toFill) lines.push(`  ${toFill} elements → Fill container`);
          if (toHug) lines.push(`  ${toHug} elements → Hug contents`);
          if (heights) lines.push(`  ${heights} fixed heights released`);
          if (autoH) lines.push(`  ${autoH} text layers → auto height`);
        }

        // Responsive changes, per frame
        lines.push("\nResponsive changes:");
        for (const f of r.frames) {
          if (f.error) continue;
          const changed = (f.sections ?? []).filter((s) => s.changes.length > 0);
          if (!changed.length) {
            lines.push(`  ${f.breakpoint}: no layout changes required`);
            continue;
          }
          lines.push(`  ${f.breakpoint} (${f.width}px):`);
          for (const s of changed) {
            lines.push(`    ${s.name} [${s.kind}] — ${s.changes.join("; ")}`);
          }

        }

        // Layer hygiene
        const renamed = r.frames.flatMap((f) => f.renamed ?? []);
        const removed = r.frames.flatMap((f) => f.removed ?? []);
        const collapsed = r.frames.flatMap((f) => f.collapsed ?? []);
        if (renamed.length || removed.length || collapsed.length) {
          lines.push("\nLayer cleanup:");
          if (renamed.length) {
            const uniq = Array.from(new Set(renamed));
            lines.push(`  Renamed ${uniq.length} generic layers:`);
            for (const x of uniq.slice(0, 12)) lines.push(`    ${x}`);
            if (uniq.length > 12) lines.push(`    … ${uniq.length - 12} more`);
          }
          if (removed.length) {
            const uniq = Array.from(new Set(removed));
            lines.push(`  Removed ${uniq.length} empty/purposeless layers:`);
            for (const x of uniq.slice(0, 8)) lines.push(`    ${x}`);
            if (uniq.length > 8) lines.push(`    … ${uniq.length - 8} more`);
          }
          if (collapsed.length) {
            const uniq = Array.from(new Set(collapsed));
            lines.push(`  Collapsed ${uniq.length} redundant wrappers: ${uniq.slice(0, 8).join(", ")}`);
          }
          lines.push("  Component instances were not entered — their contents are untouched.");
        }

        // QA
        lines.push(`\nResponsive QA (mobile validated at ${r.qaWidths.join("px and ")}px):`);
        let anyFail = false;
        for (const v of r.validations) {
          if (!v.passed) anyFail = true;
          lines.push(...renderValidation(v));
        }

        // Warnings / manual review
        const warnings = r.frames.flatMap((f) => f.warnings ?? []);
        if (warnings.length) {
          lines.push("\nWarnings — manual review required:");
          for (const w of Array.from(new Set(warnings))) lines.push(`  ⚠ ${w}`);
        }

        if (anyFail) {
          lines.push(
            "\nSome checks failed. Fix the errors above, then re-run validate_responsive. " +
              "The original desktop frame is unchanged, so nothing is lost."
          );
        } else if (!warnings.length) {
          lines.push("\nAll generated frames passed responsive QA.");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Could not generate responsive layouts: ${detail}` }],
        };
      }
    }
  );

  // ── 3. clean_layers ─────────────────────────────────────────────────────
  server.tool(
    "clean_layers",
    "Tidy a frame's layer tree so it is legible to the next designer or developer. " +
      "Renames auto-generated names ('Frame 123', 'Group 45', 'Rectangle 12') to meaningful ones " +
      "derived from what each layer actually is, numbers repeated siblings consistently " +
      "('Feature Card / 01'), removes empty and zero-size layers, and collapses wrappers that " +
      "control no layout. " +
      "NEVER enters a component instance — an instance's structure and names come from its main " +
      "component and are not ours to edit — and never touches text styles, font values or copy. " +
      "Groups standing in for responsive structure and excessively deep nesting are reported " +
      "rather than restructured. " +
      "Run it on the desktop source before make_responsive so all three breakpoints share the " +
      "same names; generated frames are cleaned automatically.",
    {
      nodeId: z
        .string()
        .optional()
        .describe("Frame to clean. Defaults to the current Figma selection."),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "Report what would change without modifying anything. Use this first on a file you " +
            "do not want altered."
        ),
      rename: z.boolean().optional().describe("Rename generic layers. Default true."),
      removeUnwanted: z
        .boolean()
        .optional()
        .describe("Remove empty, zero-size and contentless layers. Default true."),
      collapseWrappers: z
        .boolean()
        .optional()
        .describe("Collapse single-child frames that control no layout. Default true."),
    },
    async ({ nodeId, dryRun, rename, removeUnwanted, collapseWrappers }) => {
      try {
        const r = (await sendCommandToFigma("clean_layers", {
          nodeId,
          dryRun: dryRun ?? false,
          rename: rename ?? true,
          removeUnwanted: removeUnwanted ?? true,
          collapseWrappers: collapseWrappers ?? true,
        })) as {
          dryRun: boolean;
          frame: { id: string; name: string };
          layerCount?: number;
          layerCountBefore?: number;
          layerCountAfter?: number;
          genericNames?: string[];
          removableLayers?: string[];
          renamed?: string[];
          removed?: string[];
          collapsed?: string[];
          warnings: string[];
        };

        const lines: string[] = [];

        if (r.dryRun) {
          lines.push(`Layer audit — "${r.frame.name}" (${r.layerCount} layers). Nothing modified.`);
          lines.push("");
          if (r.genericNames?.length) {
            lines.push(`${r.genericNames.length} layers have auto-generated names:`);
            for (const n of r.genericNames.slice(0, 20)) lines.push(`  ${n}`);
            if (r.genericNames.length > 20) lines.push(`  … ${r.genericNames.length - 20} more`);
          } else {
            lines.push("No auto-generated layer names found.");
          }
          lines.push("");
          if (r.removableLayers?.length) {
            lines.push(`${r.removableLayers.length} layers are empty or serve no purpose:`);
            for (const n of r.removableLayers.slice(0, 15)) lines.push(`  ${n}`);
            if (r.removableLayers.length > 15) lines.push(`  … ${r.removableLayers.length - 15} more`);
          } else {
            lines.push("No empty or purposeless layers found.");
          }
        } else {
          const before = r.layerCountBefore ?? 0;
          const after = r.layerCountAfter ?? 0;
          lines.push(
            `Layer cleanup — "${r.frame.name}": ${before} layers → ${after}` +
              (before > after ? ` (${before - after} removed)` : "")
          );

          if (r.renamed?.length) {
            lines.push(`\nRenamed ${r.renamed.length}:`);
            for (const x of r.renamed.slice(0, 25)) lines.push(`  ${x}`);
            if (r.renamed.length > 25) lines.push(`  … ${r.renamed.length - 25} more`);
          }
          if (r.removed?.length) {
            lines.push(`\nRemoved ${r.removed.length}:`);
            for (const x of r.removed.slice(0, 15)) lines.push(`  ${x}`);
            if (r.removed.length > 15) lines.push(`  … ${r.removed.length - 15} more`);
          }
          if (r.collapsed?.length) {
            lines.push(`\nCollapsed ${r.collapsed.length} redundant wrappers:`);
            lines.push(`  ${r.collapsed.slice(0, 15).join(", ")}`);
          }
          if (!r.renamed?.length && !r.removed?.length && !r.collapsed?.length) {
            lines.push("\nNothing needed changing — the layer tree is already clean.");
          }
          lines.push("\nComponent instances were not entered. Typography and copy untouched.");
        }

        if (r.warnings?.length) {
          lines.push("\nNeeds a human decision:");
          for (const w of Array.from(new Set(r.warnings)).slice(0, 15)) lines.push(`  ⚠ ${w}`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Could not clean layers: ${detail}` }] };
      }
    }
  );

  // ── 4. validate_responsive ──────────────────────────────────────────────
  server.tool(
    "validate_responsive",
    "Run responsive QA on a frame at one or more viewport widths without modifying anything. " +
      "Reports horizontal overflow, off-canvas content, fixed widths wider than the viewport, " +
      "overlapping siblings, text below the readability floor, fixed-size text boxes that may " +
      "clip, and tap targets under 44px. " +
      "Defaults to checking BOTH 390px and 320px, because a layout that works at 390 and breaks " +
      "at 320 is not fully responsive.",
    {
      nodeId: z
        .string()
        .optional()
        .describe("Frame to validate. Defaults to the current Figma selection."),
      widths: z
        .array(z.number().int().positive().max(4000))
        .optional()
        .describe("Viewport widths to check. Default [390, 320]."),
    },
    async ({ nodeId, widths }) => {
      try {
        const r = (await sendCommandToFigma("validate_responsive", {
          nodeId,
          widths: widths ?? [390, 320],
        })) as {
          frame: { name: string; width: number };
          results: ValidationResult[];
        };

        const lines: string[] = [];
        lines.push(`Responsive QA — "${r.frame.name}" (frame width ${r.frame.width}px)`);
        lines.push("");
        for (const v of r.results) {
          lines.push(...renderValidation(v, ""));
          lines.push("");
        }

        const failed = r.results.filter((v) => !v.passed);
        if (failed.length === 0) {
          lines.push(`Passed at every width checked: ${r.results.map((v) => v.viewport).join("px, ")}px.`);
        } else {
          lines.push(
            `Failed at ${failed.map((v) => v.viewport + "px").join(", ")}. ` +
              "Common fixes: convert fixed widths to Fill container, enable auto-layout wrapping, " +
              "or stack the offending row vertically."
          );
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Could not validate: ${detail}` }],
        };
      }
    }
  );
}
