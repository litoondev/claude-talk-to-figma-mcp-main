/**
 * Match design values taken from an HTML page against the Figma file's own
 * design system — colour variables and styles, text styles, spacing and radius
 * variables — and say plainly what is missing.
 *
 * The rule this serves: reuse what the file defines, build anything else with
 * the page's own values, and never invent a token to paper over the gap. So a
 * miss is a first-class result, reported for the import notes, not something to
 * "fix" by picking the nearest token.
 */

export interface DesignSystemSnapshot {
  colors?: Array<{ id: string; name: string; hex: string | null; opacity?: number }>;
  typography?: Array<{
    id: string;
    name: string;
    fontFamily: string | null;
    fontStyle: string | null;
    fontSize: number;
    lineHeight: string | null;
    letterSpacing: string | null;
  }>;
  variableCollections?: Array<{
    name: string;
    modes: Array<{ modeId: string; name: string }>;
    variables: Array<{
      id: string;
      name: string;
      resolvedType: string;
      scopes?: string[];
      valuesByMode: Record<string, unknown>;
    }>;
  }>;
}

export interface TypographyToken {
  label?: string;
  fontFamily?: string | null;
  fontSize: number;
  fontWeight?: number | null;
  lineHeight?: string | number | null;
  letterSpacing?: number | null;
}

export interface DesignTokens {
  colors?: string[];
  typography?: TypographyToken[];
  spacing?: number[];
  radii?: number[];
}

export interface ColorMatch {
  value: string;
  kind: "variable" | "style";
  name: string;
  id: string;
  mode?: string;
  alternatives: string[];
}

export interface NumberMatch {
  value: number;
  name: string;
  id: string;
  mode?: string;
  alternatives: string[];
}

export interface TypographyMatch {
  token: TypographyToken;
  style: { id: string; name: string };
  differences: string[];
}

export interface TokenMatchResult {
  colors: { matched: ColorMatch[]; missing: string[] };
  typography: { matched: TypographyMatch[]; near: TypographyMatch[]; missing: TypographyToken[] };
  spacing: { matched: NumberMatch[]; missing: number[] };
  radii: { matched: NumberMatch[]; missing: number[] };
}

export function normalizeHex(value: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return `#${hex}`;
}

const WEIGHT_WORDS: Array<[RegExp, number]> = [
  [/thin|hairline/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
];

/** Numeric weight of a Figma font style name: "SemiBold Italic" → 600. */
export function weightFromStyle(style: string | null | undefined): number {
  if (!style) return 400;
  const numeric = /\b([1-9]00)\b/.exec(style);
  if (numeric) return parseInt(numeric[1], 10);
  for (const [pattern, weight] of WEIGHT_WORDS) if (pattern.test(style)) return weight;
  return 400;
}

function familyKey(family: string | null | undefined): string | null {
  if (!family) return null;
  const key = family.replace(/^["']|["']$/g, "").trim().toLowerCase();
  return key || null;
}

/** A line height in px, from "24px", "150%", a unitless 1.5, or a px number. */
function lineHeightPx(value: string | number | null | undefined, fontSize: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const v = value.trim().toLowerCase();
  if (!v || v === "auto" || v === "normal") return null;
  if (v.endsWith("%")) return (fontSize * parseFloat(v)) / 100;
  if (v.endsWith("px")) return parseFloat(v);
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n * fontSize;
}

/** Figma letter spacing ("-1px", "-2%") in px. */
function letterSpacingPx(value: string | null | undefined, fontSize: number): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v.endsWith("%")) return (fontSize * parseFloat(v)) / 100;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function modeName(collection: NonNullable<DesignSystemSnapshot["variableCollections"]>[number], modeId: string) {
  return collection.modes.find((m) => m.modeId === modeId)?.name;
}

export function matchColors(values: string[], ds: DesignSystemSnapshot): TokenMatchResult["colors"] {
  const candidates: Array<Omit<ColorMatch, "value" | "alternatives"> & { hex: string }> = [];
  for (const collection of ds.variableCollections ?? []) {
    for (const variable of collection.variables) {
      if (variable.resolvedType !== "COLOR") continue;
      for (const [modeId, raw] of Object.entries(variable.valuesByMode)) {
        const hex = typeof raw === "string" ? normalizeHex(raw) : null;
        if (hex) candidates.push({ hex, kind: "variable", name: variable.name, id: variable.id, mode: modeName(collection, modeId) });
      }
    }
  }
  for (const style of ds.colors ?? []) {
    const hex = style.hex ? normalizeHex(style.hex) : null;
    if (hex && (style.opacity ?? 1) === 1) candidates.push({ hex, kind: "style", name: style.name, id: style.id });
  }

  const matched: ColorMatch[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const hex = normalizeHex(value);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    const found = candidates.filter((c) => c.hex === hex);
    if (found.length === 0) {
      missing.push(hex);
      continue;
    }
    const names = Array.from(new Set(found.map((f) => f.name)));
    const { hex: _hex, ...best } = found[0];
    matched.push({ value: hex, ...best, alternatives: names.filter((n) => n !== best.name).slice(0, 3) });
  }
  return { matched, missing };
}

const SPACING_NAME = /gap|spac|padding|margin|space|left-right|top-bottom|inset|gutter|offset/i;
const RADIUS_NAME = /radius|round|corner/i;
const OTHER_NAME = /opacity|font|line|letter|weight|stroke|z-?index|duration|breakpoint|device|columns?|size|width|height/i;

type Variable = NonNullable<DesignSystemSnapshot["variableCollections"]>[number]["variables"][number];

function spacingEligible(variable: Variable): boolean {
  const scopes = variable.scopes ?? [];
  if (scopes.includes("GAP")) return true;
  if (scopes.length > 0 && !scopes.includes("ALL_SCOPES")) return false;
  return SPACING_NAME.test(variable.name) || !OTHER_NAME.test(variable.name);
}

function radiusEligible(variable: Variable): boolean {
  const scopes = variable.scopes ?? [];
  if (scopes.includes("CORNER_RADIUS")) return true;
  if (scopes.length > 0 && !scopes.includes("ALL_SCOPES")) return false;
  return RADIUS_NAME.test(variable.name);
}

export function matchNumbers(
  values: number[],
  ds: DesignSystemSnapshot,
  kind: "spacing" | "radius"
): { matched: NumberMatch[]; missing: number[] } {
  const eligible = kind === "spacing" ? spacingEligible : radiusEligible;
  const preferred = kind === "spacing" ? SPACING_NAME : RADIUS_NAME;
  const candidates: Array<Omit<NumberMatch, "alternatives"> & { preferred: boolean }> = [];
  for (const collection of ds.variableCollections ?? []) {
    for (const variable of collection.variables) {
      if (variable.resolvedType !== "FLOAT" || !eligible(variable)) continue;
      for (const [modeId, raw] of Object.entries(variable.valuesByMode)) {
        if (typeof raw !== "number") continue;
        candidates.push({
          value: raw,
          name: variable.name,
          id: variable.id,
          mode: modeName(collection, modeId),
          preferred: preferred.test(variable.name),
        });
      }
    }
  }

  const matched: NumberMatch[] = [];
  const missing: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    if (typeof value !== "number" || Number.isNaN(value) || seen.has(value)) continue;
    seen.add(value);
    const found = candidates
      .filter((c) => Math.abs(c.value - value) <= 0.5)
      .sort((a, b) => Number(b.preferred) - Number(a.preferred));
    if (found.length === 0) {
      missing.push(value);
      continue;
    }
    const names = Array.from(new Set(found.map((f) => f.name)));
    matched.push({
      value,
      name: found[0].name,
      id: found[0].id,
      mode: found[0].mode,
      alternatives: names.filter((n) => n !== found[0].name).slice(0, 3),
    });
  }
  return { matched, missing };
}

export function matchTypography(tokens: TypographyToken[], ds: DesignSystemSnapshot): TokenMatchResult["typography"] {
  const matched: TypographyMatch[] = [];
  const near: TypographyMatch[] = [];
  const missing: TypographyToken[] = [];

  for (const token of tokens) {
    if (!token || !(token.fontSize > 0)) continue;
    const family = familyKey(token.fontFamily);
    const weight = token.fontWeight ?? 400;
    const tokenLineHeight = lineHeightPx(token.lineHeight, token.fontSize);

    let best: TypographyMatch | null = null;
    for (const style of ds.typography ?? []) {
      if (!family || familyKey(style.fontFamily) !== family) continue;
      if (Math.abs(style.fontSize - token.fontSize) > 0.5) continue;

      const differences: string[] = [];
      const styleWeight = weightFromStyle(style.fontStyle);
      if (styleWeight !== weight) differences.push(`weight ${weight} vs ${styleWeight}`);
      const styleLineHeight = lineHeightPx(style.lineHeight, style.fontSize);
      if (tokenLineHeight !== null && styleLineHeight !== null && Math.abs(tokenLineHeight - styleLineHeight) > 1) {
        differences.push(`line height ${round1(tokenLineHeight)}px vs ${round1(styleLineHeight)}px`);
      }
      const styleLetterSpacing = letterSpacingPx(style.letterSpacing, style.fontSize);
      const tokenLetterSpacing = token.letterSpacing ?? 0;
      if (styleLetterSpacing !== null && Math.abs(tokenLetterSpacing - styleLetterSpacing) > 0.25) {
        differences.push(`letter spacing ${round1(tokenLetterSpacing)}px vs ${round1(styleLetterSpacing)}px`);
      }

      if (!best || differences.length < best.differences.length) {
        best = { token, style: { id: style.id, name: style.name }, differences };
      }
    }

    if (!best) missing.push(token);
    else if (best.differences.length === 0) matched.push(best);
    else near.push(best);
  }
  return { matched, near, missing };
}

export function matchDesignTokens(tokens: DesignTokens, ds: DesignSystemSnapshot): TokenMatchResult {
  const spacing = matchNumbers(tokens.spacing ?? [], ds, "spacing");
  const radii = matchNumbers(tokens.radii ?? [], ds, "radius");
  return {
    colors: matchColors(tokens.colors ?? [], ds),
    typography: matchTypography(tokens.typography ?? [], ds),
    spacing,
    radii,
  };
}

export function describeTypography(token: TypographyToken): string {
  const lineHeight = token.lineHeight !== null && token.lineHeight !== undefined ? ` lh ${token.lineHeight}` : "";
  const label = token.label ? ` (${token.label})` : "";
  return `${token.fontFamily ?? "unknown family"} ${token.fontSize}px/${token.fontWeight ?? 400}${lineHeight}${label}`;
}

/**
 * The "not in the design system" note, ready to paste into the Import Notes
 * frame and the final summary.
 */
export function renderImportNotes(result: TokenMatchResult): string {
  const lines: string[] = [];
  if (result.colors.missing.length) lines.push(`• Colours: ${result.colors.missing.join(", ")}`);
  for (const token of result.typography.missing) lines.push(`• Typography: ${describeTypography(token)}`);
  for (const near of result.typography.near) {
    lines.push(
      `• Typography, close but not exact: ${describeTypography(near.token)} — nearest style "${near.style.name}" ` +
        `(${near.differences.join(", ")})`
    );
  }
  if (result.spacing.missing.length) lines.push(`• Spacing: ${result.spacing.missing.map((n) => `${n}px`).join(", ")}`);
  if (result.radii.missing.length) lines.push(`• Corner radius: ${result.radii.missing.map((n) => `${n}px`).join(", ")}`);

  if (lines.length === 0) return "Everything used by the HTML maps to the existing design system.";
  return [
    "Not in the current design system — built with the HTML's own values (Done):",
    ...lines,
    "No new variables or styles were created for these. Add them to the system if they should be reused.",
  ].join("\n");
}
