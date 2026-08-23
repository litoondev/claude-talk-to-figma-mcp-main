/**
 * Figma REST API client.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other tool in this project reaches Figma through the WebSocket relay
 * (`utils/websocket.ts`) into the Figma *Plugin* sandbox. The Plugin API has
 * **no access to comments** — comments are not part of the document node tree
 * and are simply not exposed to plugins.
 *
 * Comments live exclusively in the Figma REST API, which is authenticated with
 * a personal access token rather than a plugin channel. This module is that
 * second, independent transport: it talks straight to https://api.figma.com and
 * works whether or not a Figma plugin channel is currently connected.
 *
 * Auth: set `FIGMA_ACCESS_TOKEN` in the MCP server environment.
 * Create one at https://www.figma.com/developers/api#access-tokens with at
 * least the `file_comments:write` and `files:read` scopes.
 */

import { logger } from "./logger";
import { FIGMA_REST_CONFIG } from "../config/config";

/** Error carrying HTTP context from a failed Figma REST call. */
export class FigmaRestError extends Error {
  public readonly status?: number;
  public readonly endpoint?: string;

  constructor(message: string, status?: number, endpoint?: string) {
    super(message);
    this.name = "FigmaRestError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

// ---------------------------------------------------------------------------
// REST response shapes (only the fields we actually consume)
// ---------------------------------------------------------------------------

export interface FigmaUser {
  id: string;
  handle: string;
  img_url?: string;
  email?: string;
}

/** Absolute canvas coordinate pin. */
export interface FigmaVector {
  x: number;
  y: number;
}

/** Pin anchored to a node, offset from that node's origin. */
export interface FigmaFrameOffset {
  node_id: string;
  node_offset: FigmaVector;
}

export type FigmaClientMeta = FigmaVector | FigmaFrameOffset | Record<string, unknown> | null;

export interface FigmaComment {
  id: string;
  file_key: string;
  /** Empty string for a thread root; the root's id for a reply. */
  parent_id: string;
  user: FigmaUser;
  created_at: string;
  resolved_at: string | null;
  message: string;
  order_id: string | null;
  client_meta: FigmaClientMeta;
}

export interface FigmaProject {
  id: string;
  name: string;
}

export interface FigmaFileSummary {
  key: string;
  name: string;
  last_modified?: string;
  thumbnail_url?: string;
}

// ---------------------------------------------------------------------------
// Token handling
// ---------------------------------------------------------------------------

/**
 * Read the personal access token from the environment at call time.
 *
 * Deliberately lazy (not captured at module load) so that tests and long-lived
 * server processes can change the environment without a reimport.
 */
export function getFigmaToken(): string {
  const token =
    process.env.FIGMA_ACCESS_TOKEN ||
    process.env.FIGMA_PERSONAL_ACCESS_TOKEN ||
    "";

  // A DXT/MCP host that fails to substitute a `${user_config.*}` placeholder
  // passes the literal template through. That reaches Figma as a non-empty
  // string and comes back as a confusing "403 Invalid token", so catch it here.
  if (token.includes("${") || token.includes("user_config")) {
    throw new FigmaRestError(
      "The Figma token was not substituted by the host — the server received the literal " +
        `placeholder "${token}" instead of a real token.\n\n` +
        "This means the extension's token field is not being injected. Fix: configure the " +
        "server directly in claude_desktop_config.json with the token in an explicit env block:\n" +
        '  "env": { "FIGMA_ACCESS_TOKEN": "figd_your_token_here" }\n' +
        "and remove/disable the extension so the two do not both register."
    );
  }

  if (!token.trim()) {
    throw new FigmaRestError(
      "No Figma access token found. Comment tools talk to the Figma REST API, " +
        "which needs a personal access token (the Figma plugin sandbox cannot read comments).\n\n" +
        "Fix: create a token at https://www.figma.com/developers/api#access-tokens " +
        "(scopes: files:read, file_comments:write), then expose it to this MCP server as " +
        "FIGMA_ACCESS_TOKEN.\n\n" +
        'Example MCP config:\n  "env": { "FIGMA_ACCESS_TOKEN": "figd_your_token_here" }'
    );
  }

  return token.trim();
}

/** True when a token is present, without throwing. Useful for capability checks. */
export function hasFigmaToken(): boolean {
  try {
    getFigmaToken();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Decide whether an HTTP status is worth retrying. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Compute backoff delay in ms, honouring a server-provided Retry-After header
 * when present (seconds or HTTP-date), otherwise exponential with jitter.
 */
export function computeBackoffMs(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const asSeconds = Number(retryAfterHeader);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return Math.min(asSeconds * 1000, FIGMA_REST_CONFIG.maxBackoffMs);
    }
    const asDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(asDate)) {
      return Math.min(Math.max(asDate - Date.now(), 0), FIGMA_REST_CONFIG.maxBackoffMs);
    }
  }

  const exponential = FIGMA_REST_CONFIG.baseBackoffMs * Math.pow(2, attempt);
  const jitter = Math.random() * FIGMA_REST_CONFIG.baseBackoffMs;
  return Math.min(exponential + jitter, FIGMA_REST_CONFIG.maxBackoffMs);
}

/** Turn a Figma error payload into a readable message. */
function describeFailure(status: number, rawBody: string): string {
  let detail = rawBody;
  try {
    const parsed = JSON.parse(rawBody) as { err?: string; message?: string };
    detail = parsed.err || parsed.message || rawBody;
  } catch {
    /* keep raw body */
  }

  switch (status) {
    case 401:
    case 403:
      return `${status} — token rejected by Figma. Check that FIGMA_ACCESS_TOKEN is valid and has files:read + file_comments:write scopes, and that your account can open this file. (${detail})`;
    case 404:
      return `404 — not found. Check the file key / project id / team id is correct and visible to your account. (${detail})`;
    case 429:
      return `429 — Figma rate limit hit and retries were exhausted. (${detail})`;
    default:
      return `${status} — ${detail}`;
  }
}

/**
 * Perform an authenticated request against the Figma REST API.
 *
 * Retries transient failures (429/408/5xx and network errors) with backoff,
 * and enforces a per-request timeout.
 */
export async function figmaRest<T>(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "DELETE" | "PUT";
    body?: unknown;
    /** Override the token, mainly for tests. */
    token?: string;
  } = {}
): Promise<T> {
  const { method = "GET", body } = options;
  const token = options.token ?? getFigmaToken();
  const url = `${FIGMA_REST_CONFIG.baseUrl}${endpoint}`;

  let lastError: unknown;

  for (let attempt = 0; attempt <= FIGMA_REST_CONFIG.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FIGMA_REST_CONFIG.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "X-Figma-Token": token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const rawBody = await response.text().catch(() => "");

        if (isRetryableStatus(response.status) && attempt < FIGMA_REST_CONFIG.maxRetries) {
          const wait = computeBackoffMs(attempt, response.headers.get("Retry-After"));
          logger.warn(
            `Figma REST ${method} ${endpoint} → ${response.status}; retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${FIGMA_REST_CONFIG.maxRetries})`
          );
          await sleep(wait);
          continue;
        }

        throw new FigmaRestError(describeFailure(response.status, rawBody), response.status, endpoint);
      }

      // DELETE and some POSTs return an empty body.
      const text = await response.text();
      if (!text) return {} as T;

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new FigmaRestError(
          `Figma returned a non-JSON response for ${endpoint}: ${text.slice(0, 200)}`,
          response.status,
          endpoint
        );
      }
    } catch (error) {
      lastError = error;

      // Auth/404/parse failures are final — do not burn retries on them.
      if (error instanceof FigmaRestError) throw error;

      if (attempt < FIGMA_REST_CONFIG.maxRetries) {
        const wait = computeBackoffMs(attempt, null);
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Figma REST ${method} ${endpoint} network error (${reason}); retrying in ${Math.round(wait)}ms`
        );
        await sleep(wait);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new FigmaRestError(
    `Figma REST ${method} ${endpoint} failed after ${FIGMA_REST_CONFIG.maxRetries + 1} attempts: ${reason}`,
    undefined,
    endpoint
  );
}

// ---------------------------------------------------------------------------
// Bounded concurrency
// ---------------------------------------------------------------------------

/**
 * Map over items with a concurrency ceiling, preserving input order in the
 * output. Keeps team-wide comment sweeps from stampeding Figma's rate limiter.
 */
export async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  limit: number,
  worker: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length);
  const ceiling = Math.max(1, Math.min(limit, items.length || 1));
  let cursor = 0;

  async function runner(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as TIn, index);
    }
  }

  await Promise.all(Array.from({ length: ceiling }, () => runner()));
  return results;
}

// ---------------------------------------------------------------------------
// Endpoint wrappers
// ---------------------------------------------------------------------------

/** GET /v1/me — the token owner. Also the cheapest way to validate a token. */
export function getCurrentUser(): Promise<FigmaUser> {
  return figmaRest<FigmaUser>("/v1/me");
}

/** GET /v1/teams/:team_id/projects */
export async function listTeamProjects(
  teamId: string
): Promise<{ name: string; projects: FigmaProject[] }> {
  const data = await figmaRest<{ name: string; projects: FigmaProject[] }>(
    `/v1/teams/${encodeURIComponent(teamId)}/projects`
  );
  return { name: data.name, projects: data.projects ?? [] };
}

/** GET /v1/projects/:project_id/files */
export async function listProjectFiles(
  projectId: string
): Promise<{ name: string; files: FigmaFileSummary[] }> {
  const data = await figmaRest<{ name: string; files: FigmaFileSummary[] }>(
    `/v1/projects/${encodeURIComponent(projectId)}/files`
  );
  return { name: data.name, files: data.files ?? [] };
}

/** GET /v1/files/:file_key/comments */
export async function listFileComments(
  fileKey: string,
  asMarkdown = true
): Promise<FigmaComment[]> {
  const query = asMarkdown ? "?as_md=true" : "";
  const data = await figmaRest<{ comments: FigmaComment[] }>(
    `/v1/files/${encodeURIComponent(fileKey)}/comments${query}`
  );
  return data.comments ?? [];
}

/**
 * POST /v1/files/:file_key/comments with a `comment_id` — posts a reply into an
 * existing thread. Replies inherit the root comment's pin, so no client_meta.
 */
export function postCommentReply(
  fileKey: string,
  commentId: string,
  message: string
): Promise<FigmaComment> {
  return figmaRest<FigmaComment>(`/v1/files/${encodeURIComponent(fileKey)}/comments`, {
    method: "POST",
    body: { message, comment_id: commentId },
  });
}

/** DELETE /v1/files/:file_key/comments/:comment_id */
export function deleteComment(fileKey: string, commentId: string): Promise<unknown> {
  return figmaRest<unknown>(
    `/v1/files/${encodeURIComponent(fileKey)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" }
  );
}

// ---------------------------------------------------------------------------
// Node reading (for cross-verification of plugin edits)
// ---------------------------------------------------------------------------

export interface FigmaNodeData {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

export interface FigmaFileNodesResponse {
  name: string;
  nodes: Record<string, { document: FigmaNodeData; components: Record<string, unknown> } | null>;
}

/**
 * GET /v1/files/:file_key/nodes?ids=...
 *
 * Reads one or more nodes from a Figma file via the REST API.
 * Use this to independently verify that a plugin edit was persisted to
 * Figma's servers — separate from what the plugin bridge reports.
 *
 * Requires FIGMA_ACCESS_TOKEN with at least `files:read` scope,
 * and the token's account must have view access to the file.
 */
export async function getFileNodes(
  fileKey: string,
  nodeIds: string[]
): Promise<FigmaFileNodesResponse> {
  if (nodeIds.length === 0) {
    throw new FigmaRestError("getFileNodes: nodeIds must not be empty");
  }
  const ids = nodeIds.map(encodeURIComponent).join(",");
  return figmaRest<FigmaFileNodesResponse>(
    `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${ids}`
  );
}

/**
 * GET /v1/files/:file_key (metadata only — no full document tree)
 *
 * Cheapest way to confirm the REST token has access to a specific file
 * without pulling the entire document.
 */
export async function getFileMetadata(
  fileKey: string
): Promise<{ name: string; lastModified: string; thumbnailUrl: string }> {
  const data = await figmaRest<{
    name: string;
    lastModified: string;
    thumbnailUrl: string;
  }>(`/v1/files/${encodeURIComponent(fileKey)}?depth=1`);
  return { name: data.name, lastModified: data.lastModified, thumbnailUrl: data.thumbnailUrl };
}
