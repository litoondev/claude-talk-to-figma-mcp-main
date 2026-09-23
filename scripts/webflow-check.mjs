#!/usr/bin/env node
/**
 * Check a Webflow token: is it valid, what scopes does it have, what can it see?
 *
 *   WEBFLOW_TOKEN=... npm run webflow:check
 *
 * The token is read from the environment and never written anywhere. Use this
 * before wiring a token into Claude Desktop — the failure modes are easier to
 * read here than through a tool call, and a scope problem looks exactly like a
 * broken integration until someone prints the actual response.
 *
 * It probes read-only endpoints one at a time, because Webflow scopes are
 * per-API: a token can list sites and still be unable to read pages, and
 * discovering that one call at a time during real work is the slow way.
 */

const token = (process.env.WEBFLOW_TOKEN || process.env.WEBFLOW_API_TOKEN || "").trim();

if (!token) {
  console.error(
    "\n  No token found.\n\n" +
      "  Generate one in Webflow: Site settings → Apps & integrations → API access →\n" +
      "  Generate API token. Then:\n\n" +
      "    WEBFLOW_TOKEN=your_token npm run webflow:check\n"
  );
  process.exit(1);
}

if (token.includes("${") || token.includes("user_config")) {
  console.error(
    "\n  That is a placeholder, not a token — the host did not substitute it.\n" +
      "  Pass the real value directly.\n"
  );
  process.exit(1);
}

const BASE = "https://api.webflow.com";

async function call(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, body };
}

/** Webflow names the missing scope in the message; that is the actionable part. */
function missingScope(body) {
  const message = body?.message || body?.msg || "";
  const match = /missing the following scopes?\s*-?\s*'([^']+)'/i.exec(message);
  return match ? match[1] : null;
}

function line(label, result, extra = "") {
  const mark = result.ok ? "✓" : "✗";
  const scope = result.ok ? "" : missingScope(result.body);
  const detail = result.ok
    ? extra
    : scope
      ? `needs ${scope}`
      : `${result.status} ${result.body?.message || ""}`.trim();
  console.log(`  ${mark} ${label.padEnd(22)} ${detail}`);
  return result.ok;
}

console.log("\n  Checking the token against api.webflow.com …\n");

const sites = await call("/v2/sites");

if (sites.status === 401) {
  console.log("  ✗ The token was rejected outright (401).");
  console.log("    It is invalid, revoked, or was copied incompletely.\n");
  process.exit(1);
}

const canListSites = line("sites:read", sites, `${sites.body?.sites?.length ?? 0} site(s)`);

if (!canListSites) {
  console.log(
    "\n  A token's scopes are fixed when it is minted and cannot be widened.\n" +
      "  Generate a new one with at least sites:read, then run this again.\n"
  );
  process.exit(1);
}

const list = sites.body.sites ?? [];
if (list.length === 0) {
  console.log(
    "\n  The token is valid but reaches no sites. A site token only ever sees the\n" +
      "  site it was minted on; a workspace token needs the sites shared with it.\n"
  );
  process.exit(0);
}

// Probe the rest against the first site, so each scope is reported separately.
const site = list[0];
const pages = await call(`/v2/sites/${site.id}/pages?limit=1`);
line("pages:read", pages, `${pages.body?.pagination?.total ?? pages.body?.pages?.length ?? 0} page(s)`);

const collections = await call(`/v2/sites/${site.id}/collections`);
line(
  "cms:read",
  collections,
  `${collections.body?.collections?.length ?? 0} collection(s)`
);

console.log("\n  Sites this token can reach:\n");
for (const s of list) {
  console.log(`  ${s.displayName}`);
  console.log(`    siteId        ${s.id}`);
  console.log(`    workspaceId   ${s.workspaceId ?? "(not returned)"}`);
  console.log(`    lastPublished ${s.lastPublished ?? "never"}`);
  const domains = s.customDomains?.map((d) => d.url).join(", ");
  console.log(`    domains       ${domains || "(Webflow subdomain only)"}`);
  console.log("");
}

console.log(
  "  Write scopes are not probed here — that would mean changing your site.\n" +
    "  Add pages:write / cms:write when you are ready to let Claude edit.\n"
);
