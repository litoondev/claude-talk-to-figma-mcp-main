/**
 * Pure helpers for turning Figma's flat comment list into threads, filtering
 * them, and rendering them for the model.
 *
 * Deliberately free of network and env access so the logic is unit-testable.
 */

import type {
  FigmaComment,
  FigmaClientMeta,
  FigmaFrameOffset,
  FigmaUser,
  FigmaVector,
} from "./figma-rest";

/** A thread root plus its replies, in chronological order. */
export interface CommentThread {
  /** Id of the root comment; this is what you pass to reply_to_comment. */
  rootId: string;
  fileKey: string;
  fileName?: string;
  author: FigmaUser;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  message: string;
  /** Human-readable description of where the pin sits. */
  anchor: string;
  /** Present when the comment is pinned to a node rather than raw canvas. */
  nodeId?: string;
  replies: FigmaComment[];
  /** Distinct handles that appear anywhere in the thread. */
  participants: string[];
  /** Author id of the most recent message in the thread. */
  lastMessageAuthorId: string;
  /** ISO timestamp of the most recent message in the thread. */
  lastMessageAt: string;
}

export type AuthorScope = "root" | "any";

export interface ThreadFilterOptions {
  /** Restrict to threads involving this Figma user id. Omit for everyone. */
  authorId?: string;
  /** "root" = only threads I started; "any" = also threads I replied in. */
  authorScope?: AuthorScope;
  /** Include threads Figma has marked resolved. Default false. */
  includeResolved?: boolean;
  /** Only threads whose latest activity is at or after this ISO timestamp. */
  since?: string;
  /** Only threads whose last message is NOT from `authorId` (i.e. awaiting me). */
  onlyAwaitingReply?: boolean;
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

function isFrameOffset(meta: FigmaClientMeta): meta is FigmaFrameOffset {
  return !!meta && typeof meta === "object" && "node_id" in meta;
}

function isVector(meta: FigmaClientMeta): meta is FigmaVector {
  return (
    !!meta &&
    typeof meta === "object" &&
    "x" in meta &&
    "y" in meta &&
    typeof (meta as FigmaVector).x === "number"
  );
}

/** Extract the node id a comment is pinned to, if any. */
export function extractNodeId(meta: FigmaClientMeta): string | undefined {
  return isFrameOffset(meta) ? meta.node_id : undefined;
}

/** Render a comment's pin location as a short human-readable string. */
export function describeAnchor(meta: FigmaClientMeta): string {
  if (isFrameOffset(meta)) {
    const offset = meta.node_offset;
    const at =
      offset && typeof offset.x === "number"
        ? ` at +(${Math.round(offset.x)}, ${Math.round(offset.y)})`
        : "";
    return `node ${meta.node_id}${at}`;
  }

  if (isVector(meta)) {
    return `canvas (${Math.round(meta.x)}, ${Math.round(meta.y)})`;
  }

  return "unpinned (file-level comment)";
}

// ---------------------------------------------------------------------------
// Threading
// ---------------------------------------------------------------------------

const byCreatedAtAsc = (a: FigmaComment, b: FigmaComment): number =>
  Date.parse(a.created_at) - Date.parse(b.created_at);

/**
 * Group a flat comment array into threads.
 *
 * Figma marks replies with a non-empty `parent_id` pointing at the root. A
 * reply whose root is missing from the payload (deleted root, truncated fetch)
 * is promoted to its own thread rather than being silently dropped.
 */
export function groupIntoThreads(
  comments: readonly FigmaComment[],
  fileName?: string
): CommentThread[] {
  const roots = comments.filter((c) => !c.parent_id);
  const rootIds = new Set(roots.map((c) => c.id));
  const orphans = comments.filter((c) => c.parent_id && !rootIds.has(c.parent_id));

  const repliesByRoot = new Map<string, FigmaComment[]>();
  for (const comment of comments) {
    if (!comment.parent_id || !rootIds.has(comment.parent_id)) continue;
    const bucket = repliesByRoot.get(comment.parent_id);
    if (bucket) bucket.push(comment);
    else repliesByRoot.set(comment.parent_id, [comment]);
  }

  const build = (root: FigmaComment): CommentThread => {
    const replies = (repliesByRoot.get(root.id) ?? []).slice().sort(byCreatedAtAsc);
    const all = [root, ...replies];
    const last = all[all.length - 1] as FigmaComment;

    const participants: string[] = [];
    for (const c of all) {
      const handle = c.user?.handle;
      if (handle && !participants.includes(handle)) participants.push(handle);
    }

    return {
      rootId: root.id,
      fileKey: root.file_key,
      fileName,
      author: root.user,
      createdAt: root.created_at,
      resolved: !!root.resolved_at,
      resolvedAt: root.resolved_at ?? null,
      message: root.message,
      anchor: describeAnchor(root.client_meta),
      nodeId: extractNodeId(root.client_meta),
      replies,
      participants,
      lastMessageAuthorId: last.user?.id ?? root.user?.id ?? "",
      lastMessageAt: last.created_at,
    };
  };

  return [...roots, ...orphans].map(build).sort(
    (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
  );
}

/** Does this thread involve the given user, per the requested scope? */
export function threadInvolvesAuthor(
  thread: CommentThread,
  authorId: string,
  scope: AuthorScope = "any"
): boolean {
  if (thread.author?.id === authorId) return true;
  if (scope === "root") return false;
  return thread.replies.some((reply) => reply.user?.id === authorId);
}

/** Apply the standard set of thread filters. */
export function filterThreads(
  threads: readonly CommentThread[],
  options: ThreadFilterOptions = {}
): CommentThread[] {
  const {
    authorId,
    authorScope = "any",
    includeResolved = false,
    since,
    onlyAwaitingReply = false,
  } = options;

  const sinceMs = since ? Date.parse(since) : undefined;

  return threads.filter((thread) => {
    if (!includeResolved && thread.resolved) return false;
    if (authorId && !threadInvolvesAuthor(thread, authorId, authorScope)) return false;

    if (sinceMs !== undefined && !Number.isNaN(sinceMs)) {
      if (Date.parse(thread.lastMessageAt) < sinceMs) return false;
    }

    if (onlyAwaitingReply && authorId && thread.lastMessageAuthorId === authorId) {
      return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** One-line-per-thread digest, compact enough for large sweeps. */
export function formatThreadDigest(
  threads: readonly CommentThread[],
  options: { messageLength?: number } = {}
): string {
  const { messageLength = 160 } = options;
  if (threads.length === 0) return "No matching comment threads.";

  return threads
    .map((thread, index) => {
      const where = thread.fileName ? `${thread.fileName} (${thread.fileKey})` : thread.fileKey;
      const status = thread.resolved ? "resolved" : "open";
      const replyCount =
        thread.replies.length === 0
          ? "no replies"
          : `${thread.replies.length} repl${thread.replies.length === 1 ? "y" : "ies"}`;

      const lines = [
        `${index + 1}. [${status}] ${where}`,
        `   thread ${thread.rootId} · ${thread.author?.handle ?? "unknown"} · ${thread.createdAt}`,
        `   anchor: ${thread.anchor} · ${replyCount} · participants: ${thread.participants.join(", ")}`,
        `   "${truncate(thread.message, messageLength)}"`,
      ];

      for (const reply of thread.replies) {
        lines.push(
          `     ↳ ${reply.user?.handle ?? "unknown"}: "${truncate(reply.message, messageLength)}"`
        );
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

/** Compact machine-readable projection, for when the model needs to act on threads. */
export function toThreadSummaries(threads: readonly CommentThread[]) {
  return threads.map((thread) => ({
    fileKey: thread.fileKey,
    fileName: thread.fileName,
    commentId: thread.rootId,
    author: thread.author?.handle,
    createdAt: thread.createdAt,
    resolved: thread.resolved,
    nodeId: thread.nodeId,
    anchor: thread.anchor,
    message: thread.message,
    replyCount: thread.replies.length,
    lastMessageAt: thread.lastMessageAt,
    replies: thread.replies.map((reply) => ({
      commentId: reply.id,
      author: reply.user?.handle,
      createdAt: reply.created_at,
      message: reply.message,
    })),
  }));
}
