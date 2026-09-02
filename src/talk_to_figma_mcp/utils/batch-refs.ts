/**
 * Pure helpers for `figma_batch` — parameter normalisation and back-reference
 * resolution. Kept apart from the tool registration so they can be tested
 * without pulling in the WebSocket transport.
 */

import { applyColorDefaults } from "./defaults";

/** Fields whose value is an RGBA colour object needing the same defaults the single-op tools apply. */
const COLOR_FIELDS = ["fillColor", "strokeColor", "color"];

/** Default node names, matching what the equivalent single-op tools use. */
const DEFAULT_NAMES: Record<string, string> = {
  create_rectangle: "Rectangle",
  create_frame: "Frame",
  create_ellipse: "Ellipse",
  create_polygon: "Polygon",
  create_star: "Star",
  create_text: "Text",
};

/**
 * Apply the same normalisation the individual tools apply, so an op behaves
 * identically whether it is batched or called on its own.
 */
export function normalizeParams(command: string, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };

  for (const field of COLOR_FIELDS) {
    const value = out[field];
    if (value && typeof value === "object" && "r" in (value as any)) {
      out[field] = applyColorDefaults(value as any);
    }
  }

  const fallbackName = DEFAULT_NAMES[command];
  if (fallbackName && !out.name) out.name = fallbackName;

  return out;
}

/**
 * Resolve `$N.field` / `$last.field` back-references against results already
 * produced in this batch, so a created node's id can feed the next op without a
 * round trip to the model.
 */
export function resolveRefs(value: unknown, results: Array<Record<string, unknown> | null>): unknown {
  if (typeof value === "string") {
    const match = /^\$(\d+|last)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
    if (!match) return value;

    const index = match[1] === "last" ? results.length - 1 : Number(match[1]);
    const source = results[index];
    if (!source) {
      throw new Error(
        `Reference "${value}" points at op ${index}, which produced no result`
      );
    }
    const resolved = source[match[2]];
    if (resolved === undefined) {
      throw new Error(
        `Reference "${value}" resolved to op ${index}, which has no field "${match[2]}"`
      );
    }
    return resolved;
  }

  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, results));

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveRefs(inner, results);
    }
    return out;
  }

  return value;
}
