/**
 * Live activity tools — make the agent's own work observable.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now the only evidence that the agent had done anything was the final
 * result of each command. Nobody watching — not the operator, not a
 * collaborator with the Figma file open — could tell whether work was in
 * progress, what it was touching, or what had already landed.
 *
 * Activity is tracked in two independent places, and these tools expose both:
 *
 *   • The relay (src/activity.ts) sees every command's queue → dispatch →
 *     response lifecycle. It is queried over HTTP and works even when the
 *     Figma plugin has disconnected. This is the source for `get_activity_log`.
 *
 *   • The plugin (src/claude_mcp_plugin/code.js) sees what actually happened
 *     inside the document — resolved node names, the canvas overlay, node
 *     highlighting. Reached over the plugin channel by `set_activity_overlay`.
 *
 * The relay log is the more reliable of the two and should be preferred for
 * "what has happened"; the plugin is authoritative for "what is visible in the
 * file right now".
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../utils/websocket";
import { serverUrl, defaultPort } from "../config/config";

/** HTTP origin of the relay, mirroring the WebSocket target in config.ts. */
function relayHttpBase(): string {
  return serverUrl === "localhost"
    ? `http://localhost:${defaultPort}`
    : `https://${serverUrl}`;
}

interface ActivityEventShape {
  seq: number;
  ts: number;
  channel: string;
  kind: string;
  message: string;
  command?: string;
  durationMs?: number;
  nodeIds?: string[];
  nodeNames?: string[];
  progress?: number;
}

interface ChannelStateShape {
  channel: string;
  working: boolean;
  currentCommand: string | null;
  startedAt: number | null;
  queueDepth: number;
  completed: number;
  failed: number;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms < 1000 ? ` (${ms}ms)` : ` (${(ms / 1000).toFixed(1)}s)`;
}

export function registerActivityTools(server: McpServer): void {
  // ── 1. get_activity_log ───────────────────────────────────────────────────
  server.tool(
    "get_activity_log",
    "Read the live activity log of everything that has happened over the Figma bridge — " +
      "commands queued, started, completed, failed, and timed out — plus whether work is " +
      "in flight right now. Read from the relay server, so it reports history even for " +
      "commands issued by other agents or in earlier sessions of this relay process. " +
      "Use it to report progress, to check whether a long operation is still running, or " +
      "to audit what was changed.",
    {
      limit: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe("Maximum number of most-recent events to return (default 50)."),
      since: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Return only events with a sequence number greater than this. Pass the " +
            "latestSeq from a previous call to poll for just what is new."
        ),
      channel: z
        .string()
        .optional()
        .describe("Restrict to a single channel. Defaults to all channels."),
      kinds: z
        .array(
          z.enum([
            "queued",
            "started",
            "progress",
            "completed",
            "error",
            "timeout",
            "connection",
            "note",
          ])
        )
        .optional()
        .describe("Filter to these event kinds. Defaults to all kinds."),
    },
    async ({ limit, since, channel, kinds }) => {
      const params = new URLSearchParams();
      // Over-fetch when filtering by kind so the post-filter still has enough
      // rows to satisfy `limit`.
      params.set("limit", String(kinds && kinds.length ? 500 : limit ?? 50));
      if (since !== undefined) params.set("since", String(since));
      if (channel) params.set("channel", channel);

      const url = `${relayHttpBase()}/activity?${params.toString()}`;

      let payload: {
        events: ActivityEventShape[];
        channels: ChannelStateShape[];
        latestSeq: number;
      };

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`relay responded ${response.status} ${response.statusText}`);
        }
        payload = await response.json();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text:
                `Could not read the activity log from the relay at ${relayHttpBase()}.\n` +
                `Reason: ${detail}\n\n` +
                "The WebSocket server is probably not running. Start it with:\n" +
                "  npm run socket",
            },
          ],
        };
      }

      let events = payload.events || [];
      if (kinds && kinds.length) {
        const allowed = new Set(kinds);
        events = events.filter((e) => allowed.has(e.kind));
        const cap = limit ?? 50;
        if (events.length > cap) events = events.slice(events.length - cap);
      }

      const lines: string[] = [];

      // Current state first — this is what answers "is it working right now?".
      const channels = payload.channels || [];
      if (channels.length === 0) {
        lines.push("No channel is currently connected to the relay.");
      } else {
        for (const c of channels) {
          if (c.working) {
            const elapsed = c.startedAt
              ? ` for ${((Date.now() - c.startedAt) / 1000).toFixed(1)}s`
              : "";
            lines.push(
              `Channel ${c.channel}: WORKING — ${c.currentCommand ?? "command"}${elapsed}` +
                ` · ${c.queueDepth} queued · ${c.completed} done · ${c.failed} failed`
            );
          } else {
            lines.push(
              `Channel ${c.channel}: idle · ${c.queueDepth} queued · ` +
                `${c.completed} done · ${c.failed} failed`
            );
          }
        }
      }

      lines.push("");

      if (events.length === 0) {
        lines.push("No activity events matched.");
      } else {
        lines.push(`Activity (${events.length} events, oldest first):`);
        for (const e of events) {
          const nodes =
            e.nodeNames && e.nodeNames.length
              ? `  [${e.nodeNames.slice(0, 5).join(", ")}]`
              : e.nodeIds && e.nodeIds.length
              ? `  [${e.nodeIds.slice(0, 5).join(", ")}]`
              : "";
          const progress = e.progress !== undefined ? ` ${e.progress}%` : "";
          lines.push(
            `  ${formatClock(e.ts)}  ${e.kind.padEnd(9)} ${e.message}` +
              `${progress}${formatDuration(e.durationMs)}${nodes}`
          );
        }
      }

      lines.push("");
      lines.push(`latestSeq: ${payload.latestSeq} (pass as "since" to poll for new events)`);
      lines.push(`Live dashboard: ${relayHttpBase()}/dashboard`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // ── 2. set_activity_overlay ───────────────────────────────────────────────
  server.tool(
    "set_activity_overlay",
    "Control how the agent's work is made visible inside Figma itself, to the operator and " +
      "to anyone else with the file open. 'cursorEnabled' draws a moving cursor with a name " +
      "label that travels to each element as it is worked on — the closest thing to watching " +
      "a human collaborator, and the best option when someone asks to *see* the agent work. " +
      "It is on by default and removed again when the plugin closes. " +
      "'overlayEnabled' writes a locked status card showing the current action and recent " +
      "history; it persists in the document and in version history, so it stays off by " +
      "default. 'highlightEnabled' selects each node as it changes, which collaborators " +
      "see as moving selection outlines and which modifies nothing. 'followViewport' scrolls " +
      "the canvas to work that is off-screen, leaving it alone when the target is already " +
      "visible. Use this tool to turn the live feedback *off* for a silent run, or to rename " +
      "the cursor — the visible defaults need no setup. Requires the Figma plugin to be connected.",
    {
      cursorEnabled: z
        .boolean()
        .optional()
        .describe(
          "Draw a synthetic multiplayer-style cursor that moves to each element as it is " +
            "edited, labelled with the action in progress. Visible to every collaborator. " +
            "Adds a locked node to the document; removed automatically when the plugin " +
            "closes, so it never outlives the session. Default on."
        ),
      cursorLabel: z
        .string()
        .max(24)
        .optional()
        .describe(
          "Name shown in the cursor's pill, e.g. 'Claude' or 'AI Designer'. Default 'Claude'."
        ),
      overlayEnabled: z
        .boolean()
        .optional()
        .describe(
          "Write a live status frame onto the canvas so anyone with the file open can " +
            "track progress. Adds nodes to the document. Default off."
        ),
      highlightEnabled: z
        .boolean()
        .optional()
        .describe(
          "Select nodes as they are changed so the work is visible on the canvas. " +
            "Modifies nothing. Default on."
        ),
      followViewport: z
        .boolean()
        .optional()
        .describe(
          "Scroll the canvas to a change that is off-screen, so work is never invisible. " +
            "Nodes already in view are left alone, so the canvas does not jump around " +
            "during an edit. Default on; turn off if a human is navigating the same file."
        ),
    },
    async ({ cursorEnabled, cursorLabel, overlayEnabled, highlightEnabled, followViewport }) => {
      const params: Record<string, boolean | string> = {};
      if (cursorEnabled !== undefined) params.cursorEnabled = cursorEnabled;
      if (cursorLabel !== undefined) params.cursorLabel = cursorLabel;
      if (overlayEnabled !== undefined) params.overlayEnabled = overlayEnabled;
      if (highlightEnabled !== undefined) params.highlightEnabled = highlightEnabled;
      if (followViewport !== undefined) params.followViewport = followViewport;

      if (Object.keys(params).length === 0) {
        return {
          content: [
            {
              type: "text",
              text:
                "No settings supplied. Pass at least one of cursorEnabled, cursorLabel, " +
                "overlayEnabled, highlightEnabled or followViewport. Use get_activity_state " +
                "to read the current settings without changing them.",
            },
          ],
        };
      }

      try {
        const result = (await sendCommandToFigma("set_activity_overlay", params)) as any;
        const s = result?.settings ?? {};
        return {
          content: [
            {
              type: "text",
              text:
                `${result?.message ?? "Activity settings updated."}\n\n` +
                `Live cursor:       ${s.cursorEnabled ? `on ("${s.cursorLabel ?? "Claude"}")` : "off"}\n` +
                `Canvas overlay:    ${s.overlayEnabled ? "on" : "off"}\n` +
                `Node highlighting: ${s.highlightEnabled ? "on" : "off"}\n` +
                `Follow viewport:   ${s.followViewport ? "on" : "off"}`,
            },
          ],
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Could not update activity settings: ${detail}` }],
        };
      }
    }
  );

  // ── 3. get_activity_state ─────────────────────────────────────────────────
  server.tool(
    "get_activity_state",
    "Read the Figma plugin's own view of current activity — whether a command is running, " +
      "the recent in-document history with resolved node names, and which visibility " +
      "surfaces (canvas overlay, node highlighting, viewport following) are switched on. " +
      "Complements get_activity_log, which reads the relay's view and does not require the " +
      "plugin to be connected.",
    {},
    async () => {
      try {
        const result = (await sendCommandToFigma("get_activity_state", {})) as any;

        const lines: string[] = [];
        if (result?.working) {
          const elapsed = result.startedAt
            ? ` for ${((Date.now() - result.startedAt) / 1000).toFixed(1)}s`
            : "";
          lines.push(`Status: WORKING — ${result.currentCommand ?? "command"}${elapsed}`);
        } else {
          lines.push("Status: idle");
        }
        lines.push(`Completed: ${result?.completed ?? 0} · Failed: ${result?.failed ?? 0}`);

        const s = result?.settings ?? {};
        lines.push("");
        lines.push(
          `Live cursor: ${s.cursorEnabled ? "on" : "off"} · ` +
            `Canvas overlay: ${s.overlayEnabled ? "on" : "off"} · ` +
            `Highlighting: ${s.highlightEnabled ? "on" : "off"} · ` +
            `Follow viewport: ${s.followViewport ? "on" : "off"}`
        );

        const recent: any[] = result?.recent ?? [];
        lines.push("");
        if (recent.length === 0) {
          lines.push("No in-document activity recorded yet.");
        } else {
          lines.push(`Recent in-document activity (${recent.length}, oldest first):`);
          for (const e of recent) {
            const nodes =
              e.nodeNames && e.nodeNames.length
                ? `  [${e.nodeNames.slice(0, 5).join(", ")}]`
                : "";
            lines.push(
              `  ${formatClock(e.ts)}  ${String(e.kind).padEnd(9)} ${e.message}` +
                `${formatDuration(e.durationMs)}${nodes}`
            );
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text:
                `Could not read activity state from the Figma plugin: ${detail}\n\n` +
                "If the plugin is not connected, use get_activity_log instead — it reads " +
                "from the relay and does not need the plugin.",
            },
          ],
        };
      }
    }
  );
}
