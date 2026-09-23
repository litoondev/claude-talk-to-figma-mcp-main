/**
 * Webflow Data API v2 client.
 *
 * WHY THIS EXISTS
 * ---------------
 * Webflow splits its surface the same way Figma does, and this project already
 * lives with that split once (see `utils/figma-rest.ts`):
 *
 *   Figma   Plugin API (in-sandbox, via the relay)  |  REST API (server-side)
 *   Webflow Designer API (in-Designer extension)    |  Data API (server-side)
 *
 * This module is the server-side half for Webflow. It can read and write
 * **content**: sites, pages, page SEO, the text nodes on a page, CMS
 * collections and items, and publishing.
 *
 * It deliberately CANNOT create or modify elements, styles, variables or
 * components on the canvas. Those live only in Webflow's Designer API, which
 * is reachable exclusively from a Designer Extension running inside Webflow —
 * exactly as this project's own Figma plugin runs inside Figma. Any tool that
 * claims otherwise would be lying to the model; see `tools/webflow-tools.ts`,
 * which states the boundary in its descriptions.
 *
 * WHY THE DATA API IS THE PARALLEL-SAFE HALF
 * ------------------------------------------
 * Every call here is addressed by an explicit id and carries no session state.
 * There is no "current active page", so two people on two machines can run
 * these tools at once without fighting over a cursor. The Designer half cannot
 * make that promise, which is why it is a separate phase.
 *
 * Auth: set `WEBFLOW_TOKEN` in the MCP server environment. Create one at
 * Site settings → Apps & integrations → API access, scoped to the APIs you
 * actually need — read-only is enough for every `webflow_get_*`/`_list_*` tool.
 */

import { logger } from "./logger";
import { WEBFLOW_API_CONFIG } from "../config/config";

/** Error carrying HTTP context from a failed Webflow Data API call. */
export class WebflowRestError extends Error {
  public readonly status?: number;
  public readonly endpoint?: string;

  constructor(message: string, status?: number, endpoint?: string) {
    super(message);
    this.name = "WebflowRestError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

// ---------------------------------------------------------------------------
// Response shapes (only the fields we actually consume)
// ---------------------------------------------------------------------------

export interface WebflowCustomDomain {
  id: string;
  url: string;
}

export interface WebflowSite {
  id: string;
  workspaceId?: string;
  displayName: string;
  shortName?: string;
  previewUrl?: string;
  lastPublished?: string | null;
  lastUpdated?: string;
  customDomains?: WebflowCustomDomain[];
}

export interface WebflowPageSeo {
  title?: string | null;
  description?: string | null;
}

export interface WebflowPageOpenGraph {
  title?: string | null;
  titleCopied?: boolean;
  description?: string | null;
  descriptionCopied?: boolean;
}

export interface WebflowPage {
  id: string;
  siteId?: string;
  title?: string;
  slug?: string;
  parentId?: string | null;
  collectionId?: string | null;
  createdOn?: string;
  lastUpdated?: string;
  archived?: boolean;
  draft?: boolean;
  canBranch?: boolean;
  isBranch?: boolean;
  seo?: WebflowPageSeo;
  openGraph?: WebflowPageOpenGraph;
  localeId?: string;
}

/**
 * One editable text node on a page.
 *
 * Webflow's DOM endpoint exposes *text*, not structure: you can rewrite the
 * copy inside a node, never add, move or restyle one.
 */
export interface WebflowDomNode {
  id: string;
  type?: string;
  text?: { html?: string; text?: string };
  attributes?: Record<string, string>;
  choices?: unknown;
  image?: { alt?: string | null; assetId?: string };
}

export interface WebflowCollectionField {
  id: string;
  isRequired?: boolean;
  isEditable?: boolean;
  type: string;
  slug: string;
  displayName: string;
  helpText?: string | null;
  validations?: Record<string, unknown>;
}

export interface WebflowCollection {
  id: string;
  displayName: string;
  singularName?: string;
  slug: string;
  createdOn?: string;
  lastUpdated?: string;
  fields?: WebflowCollectionField[];
}

export interface WebflowItem {
  id: string;
  cmsLocaleId?: string;
  lastPublished?: string | null;
  lastUpdated?: string;
  createdOn?: string;
  isArchived?: boolean;
  isDraft?: boolean;
  fieldData: Record<string, unknown>;
}

export interface WebflowPagination {
  limit?: number;
  offset?: number;
  total?: number;
}

export interface WebflowPublishResult {
  customDomains?: WebflowCustomDomain[];
  publishToWebflowSubdomain?: boolean;
}

// ---------------------------------------------------------------------------
// Token handling
// ---------------------------------------------------------------------------

/**
 * Read the Webflow API token from the environment at call time.
 *
 * Deliberately lazy (not captured at module load) so that tests and long-lived
 * server processes can change the environment without a reimport — the same
 * reasoning as `getFigmaToken()`.
 */
export function getWebflowToken(): string {
  const token = process.env.WEBFLOW_TOKEN || process.env.WEBFLOW_API_TOKEN || "";

  // A DXT/MCP host that fails to substitute a `${user_config.*}` placeholder
  // passes the literal template through. That reaches Webflow as a non-empty
  // string and comes back as a confusing 401, so catch it here.
  if (token.includes("${") || token.includes("user_config")) {
    throw new WebflowRestError(
      "The Webflow token was not substituted by the host — the server received the literal " +
        `placeholder "${token}" instead of a real token.\n\n` +
        "This means the extension's token field is not being injected. Fix: configure the " +
        "server directly in claude_desktop_config.json with the token in an explicit env block:\n" +
        '  "env": { "WEBFLOW_TOKEN": "your_token_here" }\n' +
        "and remove/disable the extension so the two do not both register."
    );
  }

  if (!token.trim()) {
    throw new WebflowRestError(
      "No Webflow API token found. The Webflow tools talk to the Webflow Data API, " +
        "which needs a site or workspace token.\n\n" +
        "Fix: in Webflow go to Site settings → Apps & integrations → API access → " +
        "Generate API token, choose the scopes you need (read-only is enough for every " +
        "webflow_get_*/webflow_list_* tool), then expose it to this MCP server as " +
        "WEBFLOW_TOKEN.\n\n" +
        'Example MCP config:\n  "env": { "WEBFLOW_TOKEN": "your_token_here" }'
    );
  }

  return token.trim();
}

/** True when a token is present, without throwing. Used for capability checks. */
export function hasWebflowToken(): boolean {
  try {
    getWebflowToken();
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
      return Math.min(asSeconds * 1000, WEBFLOW_API_CONFIG.maxBackoffMs);
    }
    const asDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(asDate)) {
      return Math.min(Math.max(asDate - Date.now(), 0), WEBFLOW_API_CONFIG.maxBackoffMs);
    }
  }

  const exponential = WEBFLOW_API_CONFIG.baseBackoffMs * Math.pow(2, attempt);
  const jitter = Math.random() * WEBFLOW_API_CONFIG.baseBackoffMs;
  return Math.min(exponential + jitter, WEBFLOW_API_CONFIG.maxBackoffMs);
}

/** Turn a Webflow error payload into a readable message. */
function describeFailure(status: number, rawBody: string, endpointHint?: string): string {
  let detail = rawBody;
  try {
    const parsed = JSON.parse(rawBody) as {
      message?: string;
      msg?: string;
      err?: string;
      details?: unknown;
    };
    detail = parsed.message || parsed.msg || parsed.err || rawBody;
    // Field-level validation errors are the single most useful thing Webflow
    // returns on a rejected CMS write, and they live in `details`.
    if (parsed.details !== undefined) {
      const rendered =
        typeof parsed.details === "string" ? parsed.details : JSON.stringify(parsed.details);
      if (rendered && rendered !== "[]" && rendered !== "{}") detail += ` — ${rendered}`;
    }
  } catch {
    /* keep raw body */
  }

  switch (status) {
    case 401:
      return `401 — token rejected by Webflow. Check WEBFLOW_TOKEN is valid and not revoked. A site token is scoped to one site; a workspace token covers the workspace. (${detail})`;
    case 403: {
      // Webflow names the exact missing scope in the body ("missing the
      // following scopes - 'sites:read'"), which `detail` already carries. The
      // advice only has to say what to do about it.
      const scopeAdvice =
        "Site settings → Apps & integrations → API access sets read vs read-and-write per API, " +
        "and a token cannot be widened after it is minted — generate a new one with the scope named above.";

      // Site creation is the one endpoint where a 403 is usually the plan, not
      // the scope, and re-minting a token there would waste the user's time.
      if (endpointHint?.includes("/workspaces/")) {
        return (
          `403 — creating a site needs an Enterprise workspace and a token with the workspace:write scope. ` +
          `On any other plan this call returns 403 however the token is scoped, so create the site in the ` +
          `Webflow dashboard instead. If you are on Enterprise: ${scopeAdvice} (${detail})`
        );
      }
      return `403 — the token is valid but is missing a scope. ${scopeAdvice} (${detail})`;
    }
    case 404:
      return `404 — not found. Check the site / page / collection / item id, and that this token's scope covers that site. (${detail})`;
    case 409:
      return `409 — conflict. Usually a slug that already exists in the collection, or an item being edited elsewhere at the same time. (${detail})`;
    case 429:
      return `429 — Webflow rate limit hit and retries were exhausted. Lower WEBFLOW_API_CONCURRENCY or batch fewer items per call. (${detail})`;
    default:
      return `${status} — ${detail}`;
  }
}

/**
 * Perform an authenticated request against the Webflow Data API.
 *
 * Retries transient failures (429/408/5xx and network errors) with backoff,
 * and enforces a per-request timeout.
 */
export async function webflowRest<T>(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    /** Override the token, mainly for tests. */
    token?: string;
  } = {}
): Promise<T> {
  const { method = "GET", body } = options;
  const token = options.token ?? getWebflowToken();
  const url = `${WEBFLOW_API_CONFIG.baseUrl}${endpoint}`;

  let lastError: unknown;

  for (let attempt = 0; attempt <= WEBFLOW_API_CONFIG.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBFLOW_API_CONFIG.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const rawBody = await response.text().catch(() => "");

        if (isRetryableStatus(response.status) && attempt < WEBFLOW_API_CONFIG.maxRetries) {
          const wait = computeBackoffMs(attempt, response.headers.get("Retry-After"));
          logger.warn(
            `Webflow ${method} ${endpoint} → ${response.status}; retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${WEBFLOW_API_CONFIG.maxRetries})`
          );
          await sleep(wait);
          continue;
        }

        throw new WebflowRestError(
          describeFailure(response.status, rawBody, endpoint),
          response.status,
          endpoint
        );
      }

      // DELETE and some POSTs return an empty body.
      const text = await response.text();
      if (!text) return {} as T;

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new WebflowRestError(
          `Webflow returned a non-JSON response for ${endpoint}: ${text.slice(0, 200)}`,
          response.status,
          endpoint
        );
      }
    } catch (error) {
      lastError = error;

      // Auth/404/parse failures are final — do not burn retries on them.
      if (error instanceof WebflowRestError) throw error;

      if (attempt < WEBFLOW_API_CONFIG.maxRetries) {
        const wait = computeBackoffMs(attempt, null);
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Webflow ${method} ${endpoint} network error (${reason}); retrying in ${Math.round(wait)}ms`
        );
        await sleep(wait);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new WebflowRestError(
    `Webflow ${method} ${endpoint} failed after ${WEBFLOW_API_CONFIG.maxRetries + 1} attempts: ${reason}`,
    undefined,
    endpoint
  );
}

// ---------------------------------------------------------------------------
// Endpoint wrappers — sites
// ---------------------------------------------------------------------------

/** GET /v2/sites — also the cheapest way to validate a token. */
export async function listSites(): Promise<WebflowSite[]> {
  const data = await webflowRest<{ sites?: WebflowSite[] }>("/v2/sites");
  return data.sites ?? [];
}

/** GET /v2/sites/:site_id */
export function getSite(siteId: string): Promise<WebflowSite> {
  return webflowRest<WebflowSite>(`/v2/sites/${encodeURIComponent(siteId)}`);
}

/**
 * POST /v2/workspaces/:workspace_id/sites — create a new site.
 *
 * Enterprise workspaces only, and the token needs `workspace:write`. On every
 * other plan Webflow answers 403 no matter how the call is shaped, which is why
 * the tool wrapping this says so up front: the limit is the plan, not the API,
 * and certainly not the Designer API.
 */
export function createSite(
  workspaceId: string,
  options: { name: string; templateName?: string; parentFolderId?: string }
): Promise<WebflowSite> {
  const body: Record<string, unknown> = { name: options.name };
  if (options.templateName) body.templateName = options.templateName;
  if (options.parentFolderId) body.parentFolderId = options.parentFolderId;
  return webflowRest<WebflowSite>(
    `/v2/workspaces/${encodeURIComponent(workspaceId)}/sites`,
    { method: "POST", body }
  );
}

/**
 * POST /v2/sites/:site_id/publish
 *
 * Pushes the current staged state to the named domains. This is the one call in
 * this module that is visible to the public internet, which is why the tool
 * wrapping it demands an explicit confirmation.
 */
export function publishSite(
  siteId: string,
  options: { customDomains?: string[]; publishToWebflowSubdomain?: boolean }
): Promise<WebflowPublishResult> {
  const body: Record<string, unknown> = {};
  if (options.customDomains?.length) body.customDomains = options.customDomains;
  if (options.publishToWebflowSubdomain !== undefined) {
    body.publishToWebflowSubdomain = options.publishToWebflowSubdomain;
  }
  return webflowRest<WebflowPublishResult>(
    `/v2/sites/${encodeURIComponent(siteId)}/publish`,
    { method: "POST", body }
  );
}

// ---------------------------------------------------------------------------
// Endpoint wrappers — pages
// ---------------------------------------------------------------------------

/** GET /v2/sites/:site_id/pages */
export async function listPages(
  siteId: string,
  query: { limit?: number; offset?: number; localeId?: string } = {}
): Promise<{ pages: WebflowPage[]; pagination?: WebflowPagination }> {
  const data = await webflowRest<{ pages?: WebflowPage[]; pagination?: WebflowPagination }>(
    `/v2/sites/${encodeURIComponent(siteId)}/pages${buildQuery(query)}`
  );
  return { pages: data.pages ?? [], pagination: data.pagination };
}

/** GET /v2/pages/:page_id */
export function getPage(pageId: string, localeId?: string): Promise<WebflowPage> {
  return webflowRest<WebflowPage>(
    `/v2/pages/${encodeURIComponent(pageId)}${buildQuery({ localeId })}`
  );
}

/** PUT /v2/pages/:page_id — page settings: title, slug, SEO and Open Graph. */
export function updatePageSettings(
  pageId: string,
  patch: Partial<Pick<WebflowPage, "title" | "slug" | "seo" | "openGraph">>,
  localeId?: string
): Promise<WebflowPage> {
  return webflowRest<WebflowPage>(
    `/v2/pages/${encodeURIComponent(pageId)}${buildQuery({ localeId })}`,
    { method: "PUT", body: patch }
  );
}

/** GET /v2/pages/:page_id/dom — the page's editable text nodes. */
export async function getPageContent(
  pageId: string,
  query: { limit?: number; offset?: number; localeId?: string } = {}
): Promise<{ nodes: WebflowDomNode[]; pagination?: WebflowPagination }> {
  const data = await webflowRest<{ nodes?: WebflowDomNode[]; pagination?: WebflowPagination }>(
    `/v2/pages/${encodeURIComponent(pageId)}/dom${buildQuery(query)}`
  );
  return { nodes: data.nodes ?? [], pagination: data.pagination };
}

/**
 * POST /v2/pages/:page_id/dom — rewrite the copy inside existing text nodes.
 *
 * Text only. Nodes cannot be created, deleted, reordered or restyled here; that
 * is the Designer API's territory.
 */
export function updatePageContent(
  pageId: string,
  nodes: Array<{ nodeId: string; text?: string; attributes?: Record<string, string> }>,
  localeId?: string
): Promise<unknown> {
  return webflowRest<unknown>(
    `/v2/pages/${encodeURIComponent(pageId)}/dom${buildQuery({ localeId })}`,
    { method: "POST", body: { nodes } }
  );
}

// ---------------------------------------------------------------------------
// Endpoint wrappers — CMS
// ---------------------------------------------------------------------------

/** GET /v2/sites/:site_id/collections */
export async function listCollections(siteId: string): Promise<WebflowCollection[]> {
  const data = await webflowRest<{ collections?: WebflowCollection[] }>(
    `/v2/sites/${encodeURIComponent(siteId)}/collections`
  );
  return data.collections ?? [];
}

/** GET /v2/collections/:collection_id — includes the field schema. */
export function getCollection(collectionId: string): Promise<WebflowCollection> {
  return webflowRest<WebflowCollection>(`/v2/collections/${encodeURIComponent(collectionId)}`);
}

/** GET /v2/collections/:collection_id/items */
export async function listItems(
  collectionId: string,
  query: { limit?: number; offset?: number; slug?: string; name?: string; cmsLocaleId?: string } = {}
): Promise<{ items: WebflowItem[]; pagination?: WebflowPagination }> {
  const data = await webflowRest<{ items?: WebflowItem[]; pagination?: WebflowPagination }>(
    `/v2/collections/${encodeURIComponent(collectionId)}/items${buildQuery(query)}`
  );
  return { items: data.items ?? [], pagination: data.pagination };
}

/**
 * POST /v2/collections/:collection_id/items/bulk — create staged items.
 *
 * Staged, not live: the items exist in the CMS but are not on the published
 * site until the site or the items are published.
 */
export async function createItems(
  collectionId: string,
  items: Array<{ fieldData: Record<string, unknown>; isDraft?: boolean; isArchived?: boolean }>
): Promise<WebflowItem[]> {
  const data = await webflowRest<{ items?: WebflowItem[] } | WebflowItem[]>(
    `/v2/collections/${encodeURIComponent(collectionId)}/items/bulk`,
    { method: "POST", body: { items } }
  );
  return Array.isArray(data) ? data : (data.items ?? []);
}

/** PATCH /v2/collections/:collection_id/items — update staged items in bulk. */
export async function updateItems(
  collectionId: string,
  items: Array<{
    id: string;
    fieldData?: Record<string, unknown>;
    isDraft?: boolean;
    isArchived?: boolean;
  }>
): Promise<WebflowItem[]> {
  const data = await webflowRest<{ items?: WebflowItem[] } | WebflowItem[]>(
    `/v2/collections/${encodeURIComponent(collectionId)}/items`,
    { method: "PATCH", body: { items } }
  );
  return Array.isArray(data) ? data : (data.items ?? []);
}

/** POST /v2/collections/:collection_id/items/publish — push staged items live. */
export function publishItems(
  collectionId: string,
  itemIds: string[]
): Promise<{ publishedItemIds?: string[]; errors?: unknown[] }> {
  return webflowRest<{ publishedItemIds?: string[]; errors?: unknown[] }>(
    `/v2/collections/${encodeURIComponent(collectionId)}/items/publish`,
    { method: "POST", body: { itemIds } }
  );
}

/** DELETE /v2/collections/:collection_id/items — remove items in bulk. */
export function deleteItems(collectionId: string, itemIds: string[]): Promise<unknown> {
  return webflowRest<unknown>(`/v2/collections/${encodeURIComponent(collectionId)}/items`, {
    method: "DELETE",
    body: { items: itemIds.map((id) => ({ id })) },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a query string from defined values only.
 *
 * `undefined` keys are dropped rather than sent as the string "undefined",
 * which Webflow would reject as an invalid parameter.
 */
function buildQuery(params: Record<string, string | number | undefined>): string {
  const pairs = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );
  if (pairs.length === 0) return "";
  const search = new URLSearchParams();
  for (const [key, value] of pairs) search.set(key, String(value));
  return `?${search.toString()}`;
}

/**
 * Map over items with a concurrency ceiling, preserving input order.
 *
 * Webflow's rate limit is per-token, so a sweep across many pages or
 * collections needs the same restraint the Figma client applies.
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
