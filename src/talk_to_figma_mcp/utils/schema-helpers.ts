import { z } from "zod";

/**
 * Wrap a Zod schema to auto-parse JSON strings from MCP/WebSocket serialization.
 * If the value is a string, attempts JSON.parse; on failure returns the original
 * value so Zod's own validation produces a proper ZodError.
 */
export const coerceJson = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => {
    if (typeof val === "string") {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  }, schema);

/**
 * Coerce string "true"/"false" to boolean for MCP/WebSocket serialization.
 * Unlike z.coerce.boolean() which uses JS truthiness (dangerous: "false" → true),
 * this only converts the exact strings "true" and "false".
 */
export const coerceBoolean = z.preprocess(
  (val) => val === "true" ? true : val === "false" ? false : val,
  z.boolean()
);

type JsonNode = unknown;

const isRgbaObject = (node: Record<string, any>): boolean =>
  node.type === "object" &&
  !!node.properties &&
  ["r", "g", "b"].every((k) => k in node.properties);

/**
 * Strip token-costly boilerplate from a tool's JSON schema before it is sent to
 * the model. The schema is re-sent on every request, so repeated noise adds up:
 * a `$schema` URL per tool, `additionalProperties:false` per object, and a
 * description plus 0-1 bounds on every r/g/b/a channel of every colour.
 *
 * Only what the model reads changes. Arguments are still validated by the Zod
 * schema on the server, so strictness and the 0-1 bounds are still enforced.
 */
export function slimJsonSchema(node: JsonNode, inRgba = false): JsonNode {
  if (Array.isArray(node)) return node.map((item) => slimJsonSchema(item));
  if (!node || typeof node !== "object") return node;
  const source = node as Record<string, any>;
  const rgba = isRgbaObject(source);
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "$schema") continue;
    if (key === "additionalProperties" && value === false) continue;
    if (inRgba && (key === "description" || key === "minimum" || key === "maximum")) continue;
    out[key] =
      key === "properties" && value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([name, child]) => [name, slimJsonSchema(child, rgba)])
          )
        : slimJsonSchema(value);
  }
  if (rgba) out.description = out.description ? `${out.description} (RGBA, 0-1)` : "RGBA, 0-1";
  return out;
}
