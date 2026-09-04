/**
 * Short-lived read cache for Figma queries.
 *
 * Why: design-system reads (styles, components, variables) are requested over and
 * over inside a single session — every "reuse before creating" check re-fetches the
 * same library. Each round trip costs a full plugin call plus the tokens of the
 * response. Caching them removes both.
 *
 * Staleness is bounded two ways:
 *   1. A per-entry TTL (short for document structure, longer for libraries).
 *   2. Full invalidation whenever any mutating command is sent to Figma.
 *
 * Reads that can change without a command passing through this process
 * (get_selection, get_node_info, scan_text_nodes) are deliberately NOT cached.
 */

import { logger } from "./logger";

/** Set FIGMA_MCP_CACHE=off to disable caching entirely. */
const CACHE_ENABLED = (process.env.FIGMA_MCP_CACHE || "").trim().toLowerCase() !== "off";

/**
 * Commands whose responses are safe to reuse briefly, with their TTL in ms.
 * Library-level reads get a long TTL; document structure gets a short one.
 */
export const CACHEABLE_READS: Record<string, number> = {
  get_design_system: 120_000,
  get_styles: 120_000,
  get_local_components: 120_000,
  get_remote_components: 120_000,
  get_variables: 120_000,
  get_document_info: 10_000,
  get_pages: 10_000,
};

/**
 * Reads that are NOT cached (their answer can change without a command passing
 * through this process) but that must not invalidate the cache either — they
 * change nothing in the document.
 */
export const NON_MUTATING_COMMANDS: ReadonlySet<string> = new Set([
  "get_selection",
  "get_node_info",
  "get_nodes_info",
  "get_node_via_rest",
  "scan_text_nodes",
  "get_styled_text_segments",
  "get_image_from_node",
  "get_svg",
  "get_grid",
  "get_guide",
  "get_annotation",
  "get_reactions",
  "get_figjam_elements",
  "get_activity_log",
  "get_activity_state",
  "get_section_scope",
  "verify_node_in_scope",
  "export_node_as_image",
  "get_file_key",
  "join",
  "ping",
]);

/** True when a command cannot change the document, so the cache stays valid. */
export function isNonMutating(command: string): boolean {
  return NON_MUTATING_COMMANDS.has(command) || CACHEABLE_READS[command] !== undefined;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

let hits = 0;
let misses = 0;

function keyOf(command: string, params: unknown): string {
  return `${command}:${params ? JSON.stringify(params) : ""}`;
}

/**
 * Drop every cached read. Called on any mutating command so the next read
 * reflects the change we just made.
 */
export function invalidateCache(reason?: string): void {
  if (store.size === 0) return;
  logger.debug(`[cache] invalidating ${store.size} entries${reason ? ` (${reason})` : ""}`);
  store.clear();
}

/**
 * Run `fetcher` unless an unexpired cached response for this command+params exists.
 * Returns the cached value when one does.
 */
export async function withReadCache<T>(
  command: string,
  params: unknown,
  fetcher: () => Promise<T>
): Promise<T> {
  const ttl = CACHEABLE_READS[command];
  if (!CACHE_ENABLED || ttl === undefined) return fetcher();

  const key = keyOf(command, params);
  const now = Date.now();
  const hit = store.get(key);

  if (hit && hit.expiresAt > now) {
    hits++;
    logger.debug(`[cache] hit ${command} (${hits} hits / ${misses} misses)`);
    return hit.value as T;
  }

  misses++;
  const value = await fetcher();
  store.set(key, { value, expiresAt: now + ttl });
  return value;
}

/** Cache counters, for diagnostics. */
export function getCacheStats(): { hits: number; misses: number; entries: number } {
  return { hits, misses, entries: store.size };
}
