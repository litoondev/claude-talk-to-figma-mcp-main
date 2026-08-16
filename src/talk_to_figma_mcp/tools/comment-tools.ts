import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { coerceBoolean, coerceJson } from "../utils/schema-helpers";
import { FIGMA_REST_CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import { sendCommandToFigma } from "../utils/websocket";
import {
  FigmaRestError,
  deleteComment,
  getCurrentUser,
  listFileComments,
  listProjectFiles,
  listTeamProjects,
  mapWithConcurrency,
  postCommentReply,
  type FigmaComment,
  type FigmaFileSummary,
} from "../utils/figma-rest";
import {
  filterThreads,
  formatThreadDigest,
  groupIntoThreads,
  toThreadSummaries,
  type CommentThread,
} from "../utils/comment-helpers";

/**
 * Comment tools.
 *
 * These are the only tools in this server that do NOT go through the WebSocket
 * relay — Figma's Plugin API has no comment access, so they call the REST API
 * directly with a personal access token (FIGMA_ACCESS_TOKEN). They therefore
 * work without an active Figma plugin channel, and `join_channel` is not a
 * prerequisite.
 */

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

const fail = (context: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${context}: ${message}`);
  return {
    content: [{ type: "text" as const, text: `❌ ${context}: ${message}` }],
    isError: true,
  };
};

/** A file we intend to sweep for comments. */
interface ResolvedFile {
  key: string;
  name?: string;
}

/** What the plugin reports about the file it is currently open in. */
interface ConnectedFile {
  fileKey: string | null;
  fileName: string | null;
  pageName: string | null;
  available: boolean;
}

/**
 * Ask the connected Figma plugin which file it is open in.
 *
 * This is what removes the "paste the file URL" step: the plugin bridge already
 * knows the open document, so an omitted `fileKey` is resolved from it rather
 * than from the user. Requires an active plugin channel (`join_channel`) —
 * passing `fileKey` explicitly keeps the tools channel-free.
 */
async function resolveConnectedFile(): Promise<ResolvedFile> {
  let response: ConnectedFile;

  try {
    response = (await sendCommandToFigma("get_file_key")) as ConnectedFile;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No fileKey was given and the Figma plugin could not be reached to determine the open file (${reason}). ` +
        "Either connect the plugin first with join_channel, or pass fileKey explicitly."
    );
  }

  if (!response?.fileKey) {
    throw new Error(
      "The connected plugin could not report a file key. This happens when figma.fileKey is unavailable — " +
        "it requires the private plugin API, which is enabled for locally imported and organisation plugins " +
        "but not for public plugin builds. Reload the plugin in Figma (Plugins → Development), or pass " +
        "fileKey explicitly from the file URL: figma.com/design/<FILE_KEY>/<name>"
    );
  }

  return { key: response.fileKey, name: response.fileName ?? undefined };
}

/** Use the caller's fileKey when given, otherwise fall back to the open file. */
async function fileKeyOrConnected(fileKey?: string): Promise<ResolvedFile> {
  if (fileKey?.trim()) return { key: fileKey.trim() };
  return resolveConnectedFile();
}

/** Per-file failure during a sweep — surfaced, never silently swallowed. */
interface SweepFailure {
  fileKey: string;
  fileName?: string;
  reason: string;
}

/**
 * Expand teamId / projectIds / fileKeys into a de-duplicated file list.
 * A team expands to all its projects, and each project to all its files.
 */
async function resolveFileScope(input: {
  teamId?: string;
  projectIds?: string[];
  fileKeys?: string[];
}): Promise<{ files: ResolvedFile[]; notes: string[] }> {
  const notes: string[] = [];
  const byKey = new Map<string, ResolvedFile>();

  const add = (file: ResolvedFile) => {
    const existing = byKey.get(file.key);
    if (!existing || (!existing.name && file.name)) byKey.set(file.key, file);
  };

  for (const key of input.fileKeys ?? []) add({ key });

  const projectIds = [...(input.projectIds ?? [])];

  if (input.teamId) {
    const { name, projects } = await listTeamProjects(input.teamId);
    notes.push(`Team "${name}" → ${projects.length} project(s)`);
    for (const project of projects) {
      if (!projectIds.includes(project.id)) projectIds.push(project.id);
    }
  }

  for (const projectId of projectIds) {
    try {
      const { name, files } = await listProjectFiles(projectId);
      notes.push(`Project "${name}" (${projectId}) → ${files.length} file(s)`);
      files.forEach((file: FigmaFileSummary) => add({ key: file.key, name: file.name }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notes.push(`⚠️ Project ${projectId} skipped: ${reason}`);
    }
  }

  return { files: [...byKey.values()], notes };
}

/**
 * Fetch and thread comments across many files, tolerating per-file failures
 * (a team sweep will normally include files the token cannot open).
 */
async function sweepComments(
  files: readonly ResolvedFile[]
): Promise<{ threads: CommentThread[]; failures: SweepFailure[] }> {
  const threads: CommentThread[] = [];
  const failures: SweepFailure[] = [];

  await mapWithConcurrency(files, FIGMA_REST_CONFIG.concurrency, async (file) => {
    try {
      const comments = await listFileComments(file.key);
      threads.push(...groupIntoThreads(comments, file.name));
    } catch (error) {
      failures.push({
        fileKey: file.key,
        fileName: file.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  threads.sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
  return { threads, failures };
}

function renderFailures(failures: readonly SweepFailure[]): string {
  if (failures.length === 0) return "";
  const lines = failures.map(
    (f) => `   • ${f.fileName ?? f.fileKey} (${f.fileKey}): ${f.reason}`
  );
  return `\n\n⚠️ ${failures.length} file(s) could not be read:\n${lines.join("\n")}`;
}

/**
 * Register Figma comment tools (REST-based) to the MCP server.
 * @param server - The MCP server instance
 */
export function registerCommentTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // Account / token check
  // -------------------------------------------------------------------------
  server.tool(
    "get_figma_account",
    "Get the Figma account that owns the configured FIGMA_ACCESS_TOKEN. Use this to discover your own user id (needed to identify 'my' comments) and to verify the token works before running a larger sweep. Does not require a Figma plugin channel.",
    {},
    async () => {
      try {
        const user = await getCurrentUser();
        return ok(
          `✅ Figma token is valid.\n` +
            `User id: ${user.id}\n` +
            `Handle: ${user.handle}\n` +
            `Email: ${user.email ?? "(not exposed by token scope)"}`
        );
      } catch (error) {
        return fail("Error verifying Figma account", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Current file resolution
  // -------------------------------------------------------------------------
  server.tool(
    "get_current_file",
    "Ask the connected Figma plugin which file is currently open, returning its file key and name. The comment tools call this automatically when no fileKey is given, so you normally never need to ask the user for a file URL. Requires an active plugin channel (join_channel).",
    {},
    async () => {
      try {
        const file = await resolveConnectedFile();
        return ok(
          `✅ Currently open in Figma:\n` +
            `File: ${file.name ?? "(unnamed)"}\n` +
            `File key: ${file.key}\n\n` +
            `Comment tools will use this automatically when fileKey is omitted.`
        );
      } catch (error) {
        return fail("Could not determine the open Figma file", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // File discovery
  // -------------------------------------------------------------------------
  server.tool(
    "list_figma_files",
    "List Figma files visible to the token, expanded from a team id and/or project ids. Useful for discovering file keys before reading comments across a project or team.",
    {
      teamId: z
        .string()
        .optional()
        .describe(
          "Figma team id. Found in the team URL: figma.com/files/team/<TEAM_ID>/... Expands to every project in the team."
        ),
      projectIds: coerceJson(z.array(z.string()))
        .optional()
        .describe("Explicit project ids to expand into files."),
    },
    async ({ teamId, projectIds }) => {
      try {
        if (!teamId && (!projectIds || projectIds.length === 0)) {
          return fail(
            "Invalid scope",
            new Error("Provide teamId and/or projectIds.")
          );
        }

        const { files, notes } = await resolveFileScope({ teamId, projectIds });

        const listing = files
          .map((file, i) => `${i + 1}. ${file.name ?? "(unnamed)"} — ${file.key}`)
          .join("\n");

        return ok(
          `✅ Found ${files.length} file(s).\n\n${notes.join("\n")}\n\n${listing || "(none)"}`
        );
      } catch (error) {
        return fail("Error listing Figma files", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Read: single file
  // -------------------------------------------------------------------------
  server.tool(
    "get_file_comments",
    "Read all comment threads in a single Figma file via the REST API. Returns threads (root + replies) with author, pin location, resolved status and timestamps. If fileKey is omitted, the currently open Figma file is used automatically (requires a connected plugin channel) — do NOT ask the user for a file URL, just call this with no fileKey. Needs FIGMA_ACCESS_TOKEN.",
    {
      fileKey: z
        .string()
        .optional()
        .describe(
          "Figma file key from figma.com/design/<FILE_KEY>/<name>. Omit to use the file currently open in Figma."
        ),
      includeResolved: coerceBoolean
        .optional()
        .describe("Include resolved threads. Defaults to false."),
      authorId: z
        .string()
        .optional()
        .describe("Only threads involving this Figma user id. Use get_figma_account for your own id."),
      authorScope: z
        .enum(["root", "any"])
        .optional()
        .describe("'root' = only threads started by authorId; 'any' = also threads they replied in. Default 'any'."),
      since: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp; only threads with activity at or after this time."),
      format: z
        .enum(["text", "json"])
        .optional()
        .describe("'text' for a readable digest (default), 'json' for structured data."),
    },
    async ({ fileKey, includeResolved, authorId, authorScope, since, format = "text" }) => {
      try {
        const target = await fileKeyOrConnected(fileKey);
        const comments = await listFileComments(target.key);
        const all = groupIntoThreads(comments, target.name);
        const threads = filterThreads(all, {
          authorId,
          authorScope,
          includeResolved,
          since,
        });

        const where = target.name ? `${target.name} (${target.key})` : target.key;
        const source = fileKey ? "" : " — resolved from the file open in Figma";
        const header =
          `✅ ${threads.length} thread(s) matched in ${where}${source} ` +
          `(${all.length} total thread(s), ${comments.length} comment(s)).`;

        const body =
          format === "json"
            ? JSON.stringify(toThreadSummaries(threads), null, 2)
            : formatThreadDigest(threads);

        return ok(`${header}\n\n${body}`);
      } catch (error) {
        return fail(`Error reading comments for file ${fileKey}`, error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Read: my comments across a project / team
  // -------------------------------------------------------------------------
  server.tool(
    "get_my_comments",
    "Read every comment thread authored by the token owner across a whole team, one or more projects, and/or an explicit list of files. This is the 'show me all my comments' sweep: it resolves the file set, fetches comments per file with bounded concurrency, threads them, and filters to your own user id. If no scope is given at all, it defaults to the file currently open in Figma — so call it with no arguments rather than asking the user for a file URL. Files the token cannot open are reported rather than failing the run.",
    {
      teamId: z
        .string()
        .optional()
        .describe(
          "Figma team id — expands to all projects and their files. Omit everything to default to the file currently open in Figma."
        ),
      projectIds: coerceJson(z.array(z.string()))
        .optional()
        .describe("Project ids to include."),
      fileKeys: coerceJson(z.array(z.string()))
        .optional()
        .describe("Explicit file keys to include, in addition to any team/project expansion."),
      authorId: z
        .string()
        .optional()
        .describe("Figma user id to treat as 'me'. Defaults to the token owner (resolved automatically)."),
      authorScope: z
        .enum(["root", "any"])
        .optional()
        .describe("'root' = only threads I started; 'any' = also threads I replied in. Default 'any'."),
      includeResolved: coerceBoolean
        .optional()
        .describe("Include resolved threads. Defaults to false."),
      onlyAwaitingReply: coerceBoolean
        .optional()
        .describe("Only threads whose most recent message is from someone else — i.e. waiting on me. Default false."),
      since: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp; only threads with activity at or after this time."),
      maxFiles: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Safety cap on how many files to sweep. Default 200."),
      format: z
        .enum(["text", "json"])
        .optional()
        .describe("'text' for a readable digest (default), 'json' for structured data."),
    },
    async ({
      teamId,
      projectIds,
      fileKeys,
      authorId,
      authorScope,
      includeResolved,
      onlyAwaitingReply,
      since,
      maxFiles = 200,
      format = "text",
    }) => {
      try {
        // No scope at all → fall back to the file currently open in Figma,
        // so "show me my comments" works with no arguments and no file URL.
        let resolvedFileKeys = fileKeys;
        let scopedToOpenFile = false;
        if (!teamId && !projectIds?.length && !fileKeys?.length) {
          const connected = await fileKeyOrConnected();
          resolvedFileKeys = [connected.key];
          scopedToOpenFile = true;
        }

        // Resolve "me" unless explicitly overridden.
        let meId = authorId;
        let meHandle = "";
        if (!meId) {
          const user = await getCurrentUser();
          meId = user.id;
          meHandle = user.handle;
        }

        const { files, notes } = await resolveFileScope({
          teamId,
          projectIds,
          fileKeys: resolvedFileKeys,
        });
        if (scopedToOpenFile) {
          notes.push("Scope defaulted to the file currently open in Figma");
        }

        const capped = files.slice(0, maxFiles);
        const wasCapped = files.length > capped.length;

        const { threads: allThreads, failures } = await sweepComments(capped);
        const threads = filterThreads(allThreads, {
          authorId: meId,
          authorScope,
          includeResolved,
          since,
          onlyAwaitingReply,
        });

        const who = meHandle ? `${meHandle} (${meId})` : meId;
        const header =
          `✅ ${threads.length} thread(s) involving ${who}\n` +
          `Swept ${capped.length} file(s)${wasCapped ? ` (capped from ${files.length}; raise maxFiles to widen)` : ""}, ` +
          `${allThreads.length} thread(s) seen in total.`;

        const scopeNotes = notes.length ? `\n\nScope:\n${notes.map((n) => `   • ${n}`).join("\n")}` : "";

        const body =
          format === "json"
            ? JSON.stringify(toThreadSummaries(threads), null, 2)
            : formatThreadDigest(threads);

        return ok(`${header}${scopeNotes}${renderFailures(failures)}\n\n${body}`);
      } catch (error) {
        return fail("Error sweeping Figma comments", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Write: reply to one thread
  // -------------------------------------------------------------------------
  server.tool(
    "reply_to_comment",
    "Post a reply into an existing Figma comment thread. The reply inherits the thread's pin, so no coordinates are needed. If fileKey is omitted, the currently open Figma file is used. Requires FIGMA_ACCESS_TOKEN with the file_comments:write scope.",
    {
      fileKey: z
        .string()
        .optional()
        .describe("Figma file key containing the thread. Omit to use the file open in Figma."),
      commentId: z
        .string()
        .describe("Id of the thread's ROOT comment (the `commentId` field returned by get_my_comments / get_file_comments)."),
      message: z
        .string()
        .min(1)
        .describe("Reply text. Supports Figma comment mentions, e.g. '@handle'."),
    },
    async ({ fileKey, commentId, message }) => {
      try {
        const target = await fileKeyOrConnected(fileKey);
        const reply: FigmaComment = await postCommentReply(target.key, commentId, message);
        return ok(
          `✅ Replied to thread ${commentId} in ${target.name ?? target.key}\n` +
            `Reply id: ${reply.id}\n` +
            `Posted at: ${reply.created_at}`
        );
      } catch (error) {
        return fail(`Error replying to comment ${commentId}`, error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Write: batch replies
  // -------------------------------------------------------------------------
  server.tool(
    "reply_to_comments",
    "Post replies to many Figma comment threads in one call, with bounded concurrency. Each entry succeeds or fails independently and a per-item report is returned, so a single bad thread id does not abort the batch.",
    {
      replies: coerceJson(
        z.array(
          z.object({
            fileKey: z
              .string()
              .optional()
              .describe("File key containing the thread. Omit to use the file open in Figma."),
            commentId: z.string().describe("Root comment id of the thread to reply to."),
            message: z.string().min(1).describe("Reply text for this thread."),
          })
        ).min(1)
      ).describe("Array of replies to post."),
      dryRun: coerceBoolean
        .optional()
        .describe("Preview what would be posted without writing anything to Figma. Default false."),
    },
    async ({ replies, dryRun = false }) => {
      try {
        // Resolve the open file once if any entry omitted its fileKey.
        let fallbackKey = "";
        if (replies.some((r) => !r.fileKey?.trim())) {
          fallbackKey = (await fileKeyOrConnected()).key;
        }

        const resolved: { fileKey: string; commentId: string; message: string }[] = replies.map(
          (r) => ({
            fileKey: r.fileKey?.trim() || fallbackKey,
            commentId: r.commentId,
            message: r.message,
          })
        );

        if (dryRun) {
          const preview = resolved
            .map(
              (r, i) =>
                `${i + 1}. ${r.fileKey} · thread ${r.commentId}\n   "${r.message}"`
            )
            .join("\n");
          return ok(
            `🔍 Dry run — nothing was posted.\n${replies.length} reply(ies) would be sent:\n\n${preview}`
          );
        }

        const outcomes = await mapWithConcurrency(
          resolved,
          FIGMA_REST_CONFIG.concurrency,
          async (entry) => {
            try {
              const reply = await postCommentReply(entry.fileKey, entry.commentId, entry.message);
              return { ok: true as const, entry, replyId: reply.id };
            } catch (error) {
              return {
                ok: false as const,
                entry,
                reason: error instanceof Error ? error.message : String(error),
              };
            }
          }
        );

        const succeeded = outcomes.filter((o) => o.ok);
        const failed = outcomes.filter((o) => !o.ok);

        const successLines = succeeded
          .map((o) => `   ✅ ${o.entry.fileKey} · thread ${o.entry.commentId} → reply ${"replyId" in o ? o.replyId : ""}`)
          .join("\n");

        const failureLines = failed
          .map((o) => `   ❌ ${o.entry.fileKey} · thread ${o.entry.commentId}: ${"reason" in o ? o.reason : "unknown"}`)
          .join("\n");

        const summary =
          `Posted ${succeeded.length}/${replies.length} repl${replies.length === 1 ? "y" : "ies"}.` +
          (successLines ? `\n\n${successLines}` : "") +
          (failureLines ? `\n\n${failureLines}` : "");

        return failed.length === replies.length
          ? { content: [{ type: "text" as const, text: `❌ All replies failed.\n\n${summary}` }], isError: true }
          : ok(`✅ ${summary}`);
      } catch (error) {
        return fail("Error posting batch replies", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Write: delete
  // -------------------------------------------------------------------------
  server.tool(
    "delete_comment",
    "Delete a Figma comment or reply. Only comments authored by the token owner can be deleted. Deleting a thread root removes its replies. If fileKey is omitted, the currently open Figma file is used.",
    {
      fileKey: z
        .string()
        .optional()
        .describe("Figma file key containing the comment. Omit to use the file open in Figma."),
      commentId: z.string().describe("Id of the comment or reply to delete."),
    },
    async ({ fileKey, commentId }) => {
      try {
        const target = await fileKeyOrConnected(fileKey);
        await deleteComment(target.key, commentId);
        return ok(`✅ Deleted comment ${commentId} from ${target.name ?? target.key}`);
      } catch (error) {
        if (error instanceof FigmaRestError && error.status === 403) {
          return fail(
            `Error deleting comment ${commentId}`,
            new Error("Figma refused the delete — you can only delete your own comments.")
          );
        }
        return fail(`Error deleting comment ${commentId}`, error);
      }
    }
  );
}
