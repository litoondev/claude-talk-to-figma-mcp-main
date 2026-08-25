/**
 * Live activity tracking for the Claude ↔ Figma bridge.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every command an AI agent issues against a Figma file passes through the
 * relay in `socket.ts` — it is enqueued, dispatched to the plugin, and answered.
 * That makes the relay the only component that sees the *whole* lifecycle of
 * every change, which makes it the natural home for an activity log.
 *
 * Before this module the work was invisible: the plugin panel showed a single
 * progress bar that each new command overwrote, and collaborators in the Figma
 * file saw nodes appear with no indication of what was producing them or
 * whether more was coming.
 *
 * This module turns that lifecycle into an observable event stream with four
 * consumers:
 *
 *   1. The plugin panel      — subscribes over the existing WebSocket channel.
 *   2. The web dashboard     — GET /dashboard, live over SSE.
 *   3. MCP agents            — GET /activity, via the get_activity_log tool.
 *   4. The in-canvas overlay — driven by the plugin, visible to every
 *                              collaborator in the file via Figma multiplayer.
 *
 * The log is deliberately in-memory and bounded. It is a live view of the
 * current session, not an audit trail that has to survive a restart.
 */

// ─── Event model ────────────────────────────────────────────────────────────

export type ActivityKind =
  | "queued"      // command accepted into the per-channel queue
  | "started"     // command handed to the Figma plugin
  | "progress"    // plugin reported intermediate progress
  | "completed"   // plugin returned a result
  | "error"       // command failed or was rejected
  | "timeout"     // plugin never answered in time
  | "connection"  // a client joined or left a channel
  | "note";       // free-form annotation

export interface ActivityEvent {
  /** Monotonic sequence number — lets clients resume without duplicates. */
  seq: number;
  /** Epoch milliseconds. */
  ts: number;
  channel: string;
  kind: ActivityKind;
  /** Human-readable one-liner, safe to render directly. */
  message: string;
  /** Figma command name, e.g. "create_frame". Absent for connection events. */
  command?: string;
  /** Relay request id, ties queued → started → completed together. */
  requestId?: string;
  /** Wall-clock duration, set on terminal events (completed/error/timeout). */
  durationMs?: number;
  /** Node ids the command targeted or produced, when known. */
  nodeIds?: string[];
  /** Human-readable names for the same nodes, when known. */
  nodeNames?: string[];
  /** Compact, size-capped echo of the command parameters. */
  params?: Record<string, unknown>;
  /** 0–100, present on progress events. */
  progress?: number;
}

/** Per-channel snapshot of "is the AI working right now?". */
export interface ChannelLiveState {
  channel: string;
  /** True while a command is in flight with the plugin. */
  working: boolean;
  /** Command currently in flight, if any. */
  currentCommand: string | null;
  currentRequestId: string | null;
  /** When the in-flight command started, epoch ms. */
  startedAt: number | null;
  /** Commands waiting behind the current one. */
  queueDepth: number;
  /** Terminal counts since the relay started. */
  completed: number;
  failed: number;
  /** Epoch ms of the most recent event on this channel. */
  lastEventAt: number | null;
}

// ─── Bounded log ────────────────────────────────────────────────────────────

/**
 * Ring-buffer capacity. Large enough that a dashboard opened mid-session still
 * has useful history, small enough that a runaway agent cannot exhaust memory.
 */
const MAX_EVENTS = 500;

const events: ActivityEvent[] = [];
let sequence = 0;

const liveStates = new Map<string, ChannelLiveState>();

/** Callbacks fed by every recorded event (SSE streams, WebSocket broadcast). */
type Subscriber = (event: ActivityEvent) => void;
const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function ensureLiveState(channel: string): ChannelLiveState {
  let state = liveStates.get(channel);
  if (!state) {
    state = {
      channel,
      working: false,
      currentCommand: null,
      currentRequestId: null,
      startedAt: null,
      queueDepth: 0,
      completed: 0,
      failed: 0,
      lastEventAt: null,
    };
    liveStates.set(channel, state);
  }
  return state;
}

/**
 * Fold an event into the channel's live state.
 *
 * Terminal events only clear the in-flight slot when they refer to the command
 * that actually occupies it. Without that guard a late response from a command
 * that already timed out would blank out the state of its successor, making the
 * dashboard flicker to "idle" mid-operation.
 */
function applyToLiveState(event: ActivityEvent): void {
  const state = ensureLiveState(event.channel);
  state.lastEventAt = event.ts;

  switch (event.kind) {
    case "started":
      state.working = true;
      state.currentCommand = event.command ?? null;
      state.currentRequestId = event.requestId ?? null;
      state.startedAt = event.ts;
      break;

    case "completed":
    case "error":
    case "timeout": {
      if (event.kind === "completed") state.completed++;
      else state.failed++;

      const isCurrent =
        event.requestId !== undefined &&
        event.requestId === state.currentRequestId;
      if (isCurrent) {
        state.working = false;
        state.currentCommand = null;
        state.currentRequestId = null;
        state.startedAt = null;
      }
      break;
    }
  }
}

/** Called by the relay whenever a channel's queue depth changes. */
export function setQueueDepth(channel: string, depth: number): void {
  ensureLiveState(channel).queueDepth = depth;
}

/** Drop all state for a channel once its last client disconnects. */
export function forgetChannel(channel: string): void {
  liveStates.delete(channel);
}

/**
 * Record an event, trim the buffer, and fan it out to subscribers.
 * Returns the stored event so callers can forward the sequenced copy.
 */
export function recordActivity(
  input: Omit<ActivityEvent, "seq" | "ts"> & { ts?: number }
): ActivityEvent {
  const event: ActivityEvent = {
    ...input,
    seq: ++sequence,
    ts: input.ts ?? Date.now(),
  };

  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  applyToLiveState(event);

  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      // A broken subscriber (closed SSE stream, dead socket) must never
      // interrupt the relay's command path.
    }
  }

  return event;
}

export interface ActivitySnapshot {
  events: ActivityEvent[];
  channels: ChannelLiveState[];
  /** Highest sequence number issued so far. */
  latestSeq: number;
}

/**
 * Read the current log.
 * @param options.since  Only events with seq > since.
 * @param options.limit  Most recent N events (applied after `since`).
 * @param options.channel Restrict to one channel.
 */
export function getActivitySnapshot(options: {
  since?: number;
  limit?: number;
  channel?: string;
} = {}): ActivitySnapshot {
  let selected = events;

  if (options.channel) {
    selected = selected.filter((e) => e.channel === options.channel);
  }
  if (options.since !== undefined) {
    const since = options.since;
    selected = selected.filter((e) => e.seq > since);
  }
  if (options.limit !== undefined && selected.length > options.limit) {
    selected = selected.slice(selected.length - options.limit);
  }

  const channels = options.channel
    ? [ensureLiveState(options.channel)]
    : Array.from(liveStates.values());

  return {
    events: selected,
    channels: channels.map((c) => ({ ...c })),
    latestSeq: sequence,
  };
}

// ─── Parameter summarisation ────────────────────────────────────────────────

/**
 * Values above this length are replaced by a placeholder. Image fills and SVG
 * payloads routinely carry megabytes of base64, which would otherwise be copied
 * into every event, held in the ring buffer, and pushed down every SSE stream.
 */
const MAX_VALUE_LENGTH = 120;
const MAX_ARRAY_ITEMS = 8;
const MAX_KEYS = 20;

function summarizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value.length > MAX_VALUE_LENGTH
      ? `${value.slice(0, MAX_VALUE_LENGTH)}… (${value.length} chars)`
      : value;
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    if (depth <= 0) return `[${value.length} items]`;
    const head = value.slice(0, MAX_ARRAY_ITEMS).map((v) => summarizeValue(v, depth - 1));
    return value.length > MAX_ARRAY_ITEMS
      ? [...head, `… ${value.length - MAX_ARRAY_ITEMS} more`]
      : head;
  }

  if (typeof value === "object") {
    if (depth <= 0) return "{…}";
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) {
        out["…"] = "more keys omitted";
        break;
      }
      out[k] = summarizeValue(v, depth - 1);
      count++;
    }
    return out;
  }

  return String(value);
}

/** Produce a compact, log-safe copy of a command's parameters. */
export function summarizeParams(params: unknown): Record<string, unknown> | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const summarized = summarizeValue(params, 3);
  return summarized && typeof summarized === "object"
    ? (summarized as Record<string, unknown>)
    : undefined;
}

/**
 * Pull node identifiers out of a command's params or a plugin result, so the
 * log can say *which* nodes an operation touched rather than just naming the
 * operation. Covers the shapes actually used across the tool surface:
 * `id`, `nodeId`, `nodeIds`, `parentId`, and arrays of `{id}` objects.
 */
export function extractNodeIds(value: unknown, budget = 12): string[] {
  const found: string[] = [];

  const walk = (v: unknown, depth: number): void => {
    if (found.length >= budget || depth < 0 || !v || typeof v !== "object") return;

    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth - 1);
      return;
    }

    for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
      if (found.length >= budget) return;

      const isIdKey = key === "id" || key === "nodeId" || key === "parentId";
      if (isIdKey && typeof raw === "string" && raw.length > 0) {
        if (!found.includes(raw)) found.push(raw);
        continue;
      }

      if (key === "nodeIds" && Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === "string" && !found.includes(item)) found.push(item);
          if (found.length >= budget) return;
        }
        continue;
      }

      if (raw && typeof raw === "object") walk(raw, depth - 1);
    }
  };

  walk(value, 4);
  return found;
}

/**
 * Pull human-readable node names out of a plugin result, so the log can say
 * "Hero Banner" instead of only "142:87". Names are far more useful than ids
 * for anyone watching who is not the agent that issued the command.
 */
export function extractNodeNames(value: unknown, budget = 12): string[] {
  const found: string[] = [];

  const walk = (v: unknown, depth: number): void => {
    if (found.length >= budget || depth < 0 || !v || typeof v !== "object") return;

    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth - 1);
      return;
    }

    const obj = v as Record<string, unknown>;
    // Only treat `name` as a node name when it sits alongside an `id`, so that
    // unrelated `name` fields (font names, style names) do not leak in.
    if (typeof obj.name === "string" && typeof obj.id === "string" && obj.name.length > 0) {
      if (!found.includes(obj.name)) found.push(obj.name);
    }

    for (const nested of Object.values(obj)) {
      if (found.length >= budget) return;
      if (nested && typeof nested === "object") walk(nested, depth - 1);
    }
  };

  walk(value, 4);
  return found;
}

/** Build the one-line human description shown in every activity surface. */
export function describeCommand(
  command: string,
  params: Record<string, unknown> | undefined
): string {
  const pretty = command.replace(/_/g, " ");
  if (!params) return pretty;

  const name = params.name ?? params.text ?? params.characters;
  if (typeof name === "string" && name.trim().length > 0) {
    const trimmed = name.length > 40 ? `${name.slice(0, 40)}…` : name;
    return `${pretty} — "${trimmed}"`;
  }

  const ids = extractNodeIds(params, 3);
  if (ids.length === 1) return `${pretty} on ${ids[0]}`;
  if (ids.length > 1) return `${pretty} on ${ids.length} nodes`;

  return pretty;
}
