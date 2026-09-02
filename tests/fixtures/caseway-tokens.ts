/**
 * A slice of the real Caseway Partners token file (DESIGN_TOKENS.md).
 *
 * Real names, real alias chains, real scopes and the real two-collection shape
 * — `primitives` with one mode, `styles` with the real mode names, which carry their reference width. The point is to
 * exercise the resolver against the cases that actually occur: sibling tokens
 * whose names differ only in a numeric suffix, aliases that must stay aliases,
 * and identical leaf names living under different path prefixes.
 */
import type { MockCollection, MockVariable } from "./figma-plugin-harness";

export const PRIMITIVES_MODE = "m:prim";
export const DESK = "m:desk";
export const TAB = "m:tab";
export const MOBI = "m:mobi";

const primitives: MockCollection = {
  id: "c:primitives",
  name: "primitives",
  modes: [{ modeId: PRIMITIVES_MODE, name: "Mode 1" }],
  variableIds: [],
};

const styles: MockCollection = {
  id: "c:styles",
  name: "styles",
  modes: [
    { modeId: DESK, name: "Desk (1440 px)" },
    { modeId: TAB, name: "Tab (768 px)" },
    { modeId: MOBI, name: "Mobi (320 px)" },
  ],
  variableIds: [],
};

let seq = 0;
const variables: MockVariable[] = [];

function rgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

function alias(id: string) {
  return { type: "VARIABLE_ALIAS", id };
}

function prim(
  name: string,
  resolvedType: MockVariable["resolvedType"],
  value: unknown,
  scopes: string[] = []
): MockVariable {
  const v: MockVariable = {
    id: `v:${++seq}`,
    name,
    resolvedType,
    scopes,
    variableCollectionId: primitives.id,
    valuesByMode: { [PRIMITIVES_MODE]: value },
  };
  variables.push(v);
  primitives.variableIds.push(v.id);
  return v;
}

function styled(
  name: string,
  resolvedType: MockVariable["resolvedType"],
  values: [unknown, unknown, unknown],
  scopes: string[] = []
): MockVariable {
  const v: MockVariable = {
    id: `v:${++seq}`,
    name,
    resolvedType,
    scopes,
    variableCollectionId: styles.id,
    valuesByMode: { [DESK]: values[0], [TAB]: values[1], [MOBI]: values[2] },
  };
  variables.push(v);
  styles.variableIds.push(v.id);
  return v;
}

// ── Primitives ─────────────────────────────────────────────────────────────
const baseGrayMain = prim("colors/Base/Gray Main", "COLOR", rgb("#525252"), ["ALL_SCOPES"]);
const basePrimary = prim("colors/Base/Primary", "COLOR", rgb("#04724D"), ["ALL_SCOPES"]);
prim("colors/Base/Black", "COLOR", rgb("#03060A"), ["ALL_SCOPES"]);

// The sibling trap from spec §5.1: related values, different tokens.
prim("colors/Primary/500", "COLOR", rgb("#10B978"), ["ALL_SCOPES"]);
prim("colors/Primary/700", "COLOR", alias(basePrimary.id), ["ALL_SCOPES"]);

// The alias that must be bound as itself, not flattened to #525252.
export const grayFiveHundred = prim("colors/Gray/500", "COLOR", alias(baseGrayMain.id), [
  "ALL_SCOPES",
]);

// Spacing ladder — note 64 and 80 exist but 72 does not (spec Test 4).
for (const n of [0, 4, 8, 12, 16, 20, 24, 30, 40, 60, 64, 80, 100, 120, 280, 688]) {
  prim(`spacing/${n}`, "FLOAT", n);
}

prim("breakpoint/Desk", "FLOAT", 1440);
prim("breakpoint/Tab", "FLOAT", 768);
prim("breakpoint/Mobi", "FLOAT", 320);

prim("font-family/Inter", "STRING", "Inter", ["FONT_FAMILY"]);
prim("Text Color/Body", "COLOR", alias(baseGrayMain.id), ["TEXT_FILL"]);

// ── Responsive styles ──────────────────────────────────────────────────────
styled("Layout/Default/container-padding", "FLOAT", [100, 40, 20], ["WIDTH_HEIGHT", "GAP"]);
styled("Layout/Default/row-gap", "FLOAT", [60, 40, 30], ["WIDTH_HEIGHT", "GAP"]);
styled("Layout/Default/column-gap", "FLOAT", [60, 40, 30], ["WIDTH_HEIGHT", "GAP"]);
styled("Layout/Default/section-gap", "FLOAT", [120, 60, 40], ["WIDTH_HEIGHT", "GAP"]);

// Same leaf name under a different prefix — the case that broke fuzzy matching.
styled("Layout/Compact/width", "FLOAT", [1440, 768, 320], ["WIDTH_HEIGHT", "GAP"]);
styled("Layout/Default/width", "FLOAT", [1440, 768, 320], ["WIDTH_HEIGHT", "GAP"]);
styled("Layout/Full Width/width", "FLOAT", [1440, 768, 320], ["WIDTH_HEIGHT", "GAP"]);
styled("Utilities/Archive card/Width", "FLOAT", [590, 324, 280], []);

styled("Responsive Text Container/max-width", "FLOAT", [688, 688, 280], []);
styled("Gap/24", "FLOAT", [24, 24, 24], []);
styled("Radius/12", "FLOAT", [12, 8, 16], ["CORNER_RADIUS"]);

styled("Text size/Body1/font-size", "FLOAT", [20, 18, 16], []);
styled("Text size/Body1/line-height", "FLOAT", [30, 28, 24], []);

// Scope trap: a stroke-only token, wrong for a gap.
styled("Border/4", "FLOAT", [4, 2, 4], ["STROKE_FLOAT"]);

// Ambiguity trap (spec Test 5): two DIFFERENT paths that normalise identically.
// "Utilities/Check Box/Redius" and "Utilities/Check-Box/Redius" both normalise
// to "utilities-check-box-redius".
styled("Utilities/Check Box/Redius", "FLOAT", [4, 4, 2], []);
styled("Utilities/Check-Box/Redius", "FLOAT", [4, 4, 2], []);

export const casewayCollections = [primitives, styles];
export const casewayVariables = variables;

export function casewayFile() {
  return { collections: casewayCollections, variables: casewayVariables };
}
