import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger";
import { getCurrentChannel, sendCommandToWebflow } from "../utils/websocket";
import { hasWebflowToken, listSites, WebflowRestError } from "../utils/webflow-rest";
import { webflowDesignerEnabled } from "../config/profiles";

/**
 * One call that checks every leg of a Figma → Webflow setup at once.
 *
 * WHY THIS EXISTS
 * ---------------
 * A Webflow build depends on three independent things: a Figma channel, a
 * Webflow token with the right scopes, and the Designer extension joined to the
 * same channel. Discovered one at a time, each failure looks like the whole
 * problem — so the user fixes one, comes back, and hits the next. Watching a
 * real session do exactly that is what prompted this: token scopes reported,
 * then the extension, then site creation needing Enterprise, three round trips
 * for a state that could have been read in one.
 *
 * CLAUDE.md §17.4 forbids making the user give the same instruction twice. A
 * tool that reports one blocker at a time guarantees they will.
 *
 * Every check is read-only and none of them throw: a failed leg is a line in
 * the report, not an exception, because the point is to see all of them
 * together.
 */

type Status = "ok" | "blocked" | "off";

interface Check {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

const ICON: Record<Status, string> = { ok: "✅", blocked: "❌", off: "⚪️" };

/** Pull the scope Webflow names out of its own error text — the actionable part. */
function missingScope(message: string): string | null {
  const match = /missing the following scopes?\s*-?\s*'([^']+)'/i.exec(message);
  return match ? match[1] : null;
}

async function checkFigma(): Promise<Check> {
  const channel = getCurrentChannel();
  if (!channel) {
    return {
      name: "Figma channel",
      status: "blocked",
      detail: "not joined",
      fix: "Open the plugin in Figma, copy the channel ID, and call join_channel with it.",
    };
  }
  return { name: "Figma channel", status: "ok", detail: `joined — ${channel}` };
}

async function checkToken(): Promise<Check> {
  if (!hasWebflowToken()) {
    return {
      name: "Webflow token",
      status: "off",
      detail: "not configured",
      fix:
        "Claude Desktop → Settings → Extensions → this extension → Webflow API token. " +
        "Generate one in Webflow at Site settings → Apps & integrations → API access. " +
        "Then quit Claude Desktop completely and reopen.",
    };
  }

  try {
    const sites = await listSites();
    if (sites.length === 0) {
      return {
        name: "Webflow token",
        status: "blocked",
        detail: "valid, but reaches no sites",
        fix:
          "A site token only sees the site it was minted on. Generate one on the target site, " +
          "or use a workspace token with the sites shared to it.",
      };
    }
    const names = sites.map((s) => `${s.displayName} (${s.id})`).join(", ");
    return { name: "Webflow token", status: "ok", detail: `${sites.length} site(s): ${names}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof WebflowRestError ? error.status : undefined;

    if (status === 401) {
      return {
        name: "Webflow token",
        status: "blocked",
        detail: "rejected (401) — invalid, revoked, or copied incompletely",
        fix: "Generate a new token and paste it into the extension's settings.",
      };
    }

    const scope = missingScope(message);
    return {
      name: "Webflow token",
      status: "blocked",
      detail: scope ? `valid, but missing the ${scope} scope` : message.slice(0, 200),
      fix:
        "Scopes are fixed when a token is minted and cannot be widened. Generate a NEW token at " +
        "Site settings → Apps & integrations → API access with sites:read, pages:read and cms:read " +
        "(add pages:write and cms:write to let Claude edit).",
    };
  }
}

async function checkDesigner(): Promise<Check> {
  if (!webflowDesignerEnabled()) {
    return {
      name: "Webflow Designer extension",
      status: "off",
      detail: "canvas tools are switched off",
      fix:
        "Claude Desktop → Settings → Extensions → this extension → turn on 'Webflow Designer tools', " +
        "then quit Claude Desktop completely and reopen. Without this, layout, classes, variables and " +
        "components cannot be built at all.",
    };
  }

  const channel = getCurrentChannel();
  if (!channel) {
    return {
      name: "Webflow Designer extension",
      status: "blocked",
      detail: "cannot check — no Figma channel joined yet",
      fix: "Join a channel first; the extension joins the same one.",
    };
  }

  try {
    // Short timeout on purpose: this is a liveness probe, and the whole value of
    // this tool is that it answers quickly rather than blocking on the relay's
    // two-minute command timeout.
    const result = (await sendCommandToWebflow("webflow_status", {}, 15000)) as {
      page?: { name?: string };
    };
    const page = result?.page?.name ? ` — page "${result.page.name}"` : "";
    return {
      name: "Webflow Designer extension",
      status: "ok",
      detail: `connected on channel ${channel}${page}`,
    };
  } catch {
    return {
      name: "Webflow Designer extension",
      status: "blocked",
      detail: `not on channel ${channel}`,
      fix:
        `Open the site in the Webflow Designer, press E for the Apps panel, launch the ` +
        `Claude Talk to Figma extension, and join channel ${channel}. ` +
        `To try the canvas tools with no Webflow account, run: npm run webflow:harness -- ${channel}`,
    };
  }
}

export function registerWebflowPreflightTools(server: McpServer): void {
  server.tool(
    "webflow_preflight",
    "Check every part of a Figma → Webflow setup in one call: the Figma channel, the Webflow token and its scopes, and whether the Webflow Designer extension is joined. Call this FIRST, before planning or building anything Webflow — it reports all blockers together with the exact fix for each, instead of hitting them one at a time and sending the user back and forth. Read-only and safe to repeat.",
    {},
    async () => {
      try {
        // Run together: three independent services, and the report is only
        // useful as a whole.
        const checks = await Promise.all([checkFigma(), checkToken(), checkDesigner()]);

        const lines = checks.map((c) => `${ICON[c.status]} ${c.name}: ${c.detail}`);
        const blockers = checks.filter((c) => c.status !== "ok");

        let text = `Figma → Webflow setup\n\n${lines.join("\n")}\n`;

        if (blockers.length === 0) {
          text +=
            "\nEverything is connected. You can read the Figma design and build on the Webflow canvas.";
        } else {
          text += `\n${blockers.length} thing${blockers.length === 1 ? "" : "s"} to fix:\n`;
          blockers.forEach((c, i) => {
            text += `\n${i + 1}. ${c.name} — ${c.detail}\n   ${c.fix}\n`;
          });
          text +=
            "\nTell the user all of these at once. Do not start building and report them one at a time.";

          const canRead = checks[0].status === "ok";
          const canContent = checks[1].status === "ok";
          const canCanvas = checks[2].status === "ok";
          text += `\n\nWhat is possible right now: ${
            [
              canRead ? "read the Figma design" : null,
              canContent ? "pages, SEO, CMS and publishing" : null,
              canCanvas ? "build layout, classes and variables" : null,
            ]
              .filter(Boolean)
              .join("; ") || "nothing until at least one of the above is fixed"
          }.`;
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`webflow_preflight failed: ${message}`);
        return {
          content: [{ type: "text" as const, text: `❌ Preflight could not run: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
