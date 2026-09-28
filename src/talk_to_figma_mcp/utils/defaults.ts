import { Color, ColorWithDefaults } from '../types/color';

export const FIGMA_DEFAULTS = {
  color: {
    opacity: 1,
  },
  stroke: {
    weight: 1,
  }
} as const;

export function applyDefault<T>(value: T | undefined, defaultValue: T): T {
  return value !== undefined ? value : defaultValue;
}

export function applyColorDefaults(color: Color): ColorWithDefaults {
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    a: applyDefault(color.a, FIGMA_DEFAULTS.color.opacity)
  };
}

/**
 * Parse a CSS hex colour into Figma's 0–1 RGBA object.
 *
 * WHY THIS EXISTS
 * ---------------
 * Figma's API wants {r,g,b,a} as 0–1 floats, but every design source — a
 * palette, a screenshot, a spec, a variable listing — states colours as hex.
 * Leaving that conversion to the model meant doing 8-bit-to-float division by
 * hand for every stop, and a single slip there is invisible until it lands in
 * the file: one real session mis-mapped a swatch, noticed mid-flight, and paid
 * for the whole set of writes twice.
 *
 * Accepts #RGB, #RRGGBB and #RRGGBBAA, with or without the leading '#'.
 * Returns null for anything else so callers can pass non-hex values through
 * untouched rather than corrupting them.
 */
export function hexToRgba(input: string): ColorWithDefaults | null {
  const hex = input.trim().replace(/^#/, "");

  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  let r: number, g: number, b: number, a = 255;

  if (hex.length === 3) {
    // #RGB shorthand — each digit is doubled (f0a → ff00aa)
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6 || hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16);
  } else {
    return null;
  }

  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

/**
 * Coerce a colour written as hex into Figma's RGBA object, leaving values that
 * are already objects (or genuinely not colours) exactly as they were.
 */
export function coerceColor(value: unknown): unknown {
  if (typeof value === "string") {
    const parsed = hexToRgba(value);
    if (parsed) return parsed;
    return value;
  }
  if (value && typeof value === "object" && "r" in (value as any)) {
    return applyColorDefaults(value as Color);
  }
  return value;
}