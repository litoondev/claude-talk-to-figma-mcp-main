/**
 * Color Generator Utility
 * Generates Tailwind-like color scales from a base hex color using HSL adjustments
 * Creates color palettes with 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950 stops
 */

interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

interface RGBA {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a?: number; // 0-1
}

interface ColorStop {
  name: string;
  weight: number;
  hex: string;
  hsl: HSL;
  rgb: RGBA;
}

interface ColorScale {
  name: string;
  baseColor: string;
  stops: Record<number, ColorStop>;
}

/**
 * Convert hex string to RGB
 */
export function hexToRgb(hex: string): RGBA {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  return { r, g, b, a: 1 };
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').toUpperCase();
}

/**
 * Convert RGB to HSL
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL to RGB
 */
export function hslToRgb(h: number, s: number, l: number): RGBA {
  h = h / 360;
  s = s / 100;
  l = l / 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a: 1,
  };
}

/**
 * Generate a Tailwind-like color scale
 * Adjusts lightness for different weights (50=very light, 500=base, 950=very dark)
 */
export function generateColorScale(baseHex: string, colorName: string = 'Color'): ColorScale {
  const baseRgb = hexToRgb(baseHex);
  const baseHsl = rgbToHsl(baseRgb.r, baseRgb.g, baseRgb.b);

  // Tailwind-like lightness values for different stops
  // These are carefully tuned to create a pleasing palette
  const lightnessMap: Record<number, number> = {
    50: 97,
    100: 94,
    200: 88,
    300: 80,
    400: 69,
    500: 55,    // Base color
    600: 48,
    700: 41,
    800: 33,
    900: 24,
    950: 15,
  };

  const stops: Record<number, ColorStop> = {};

  Object.entries(lightnessMap).forEach(([weight, lightness]) => {
    const weightNum = parseInt(weight);
    const newHsl: HSL = {
      h: baseHsl.h,
      s: baseHsl.s,
      l: lightness,
    };

    const newRgb = hslToRgb(newHsl.h, newHsl.s, newHsl.l);
    const hex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);

    stops[weightNum] = {
      name: `${colorName}/${weightNum}`,
      weight: weightNum,
      hex,
      hsl: newHsl,
      rgb: newRgb,
    };
  });

  return {
    name: colorName,
    baseColor: baseHex,
    stops,
  };
}

/**
 * Adjust the saturation of a generated scale
 * Useful for desaturating a color or increasing vibrancy
 */
export function adjustScaleSaturation(scale: ColorScale, saturationMultiplier: number): ColorScale {
  const adjustedStops: Record<number, ColorStop> = {};

  Object.entries(scale.stops).forEach(([_, stop]) => {
    const newS = Math.max(0, Math.min(100, stop.hsl.s * saturationMultiplier));
    const newHsl: HSL = {
      h: stop.hsl.h,
      s: newS,
      l: stop.hsl.l,
    };

    const newRgb = hslToRgb(newHsl.h, newHsl.s, newHsl.l);
    const hex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);

    adjustedStops[stop.weight] = {
      ...stop,
      hex,
      hsl: newHsl,
      rgb: newRgb,
    };
  });

  return {
    ...scale,
    stops: adjustedStops,
  };
}

/**
 * Format a color scale for display
 */
export function formatColorScale(scale: ColorScale): string {
  const lines = [
    `Color Scale: ${scale.name}`,
    `Base Color: ${scale.baseColor}`,
    '─'.repeat(50),
  ];

  const weights = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  weights.forEach(weight => {
    const stop = scale.stops[weight];
    if (stop) {
      lines.push(
        `${weight.toString().padEnd(3)} | ${stop.hex} | HSL(${stop.hsl.h}, ${stop.hsl.s}%, ${stop.hsl.l}%)`
      );
    }
  });

  return lines.join('\n');
}

/**
 * Export color scale as Figma variable definitions
 * Returns an array of variable definitions suitable for figma_batch
 */
export function exportAsVariableDefinitions(
  scale: ColorScale,
  collectionName: string = 'Colors'
): Array<{
  type: 'set_variable';
  collectionName: string;
  name: string;
  resolvedType: string;
  value: string;
  createIfMissing: boolean;
}> {
  const weights = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

  return weights.map(weight => ({
    type: 'set_variable' as const,
    collectionName,
    name: scale.stops[weight].name,
    resolvedType: 'COLOR',
    value: scale.stops[weight].hex,
    createIfMissing: true,
  }));
}
