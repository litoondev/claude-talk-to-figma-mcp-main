import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";
import { serverUrl, defaultPort, WS_URL, reconnectInterval } from "../config/config";
import { FigmaCommand, FigmaResponse, CommandProgressUpdate, PendingRequest, ProgressMessage } from "../types";
import { hasScopeState, getScopeState, SCOPE_CREATION_COMMANDS } from "./section-scope";
import { withReadCache, invalidateCache, isNonMutating, CACHEABLE_READS } from "./cache";

// WebSocket connection and request tracking
let ws: WebSocket | null = null;

// `currentChannel` is the channel this process is joined to *right now*; it is
// null whenever the socket is down. `desiredChannel` is the channel the session
// belongs to and outlives any number of transport drops.
//
// Keeping only the first of these is what made a relay restart end the session:
// the socket reconnected, `currentChannel` was cleared, nothing rejoined, and
// every later command failed with "Must join a channel before sending commands"
// while the plugin still showed a green badge. The transport recovered; the
// session did not. Reconnect now restores membership from `desiredChannel`.
let currentChannel: string | null = null;
let desiredChannel: string | null = null;

// Reconnect bookkeeping. The previous backoff was
// `reconnectInterval * 1.5 ** floor(random() * 5)` — a random pick from five
// fixed delays, not a backoff at all: it never grew with consecutive failures
// and never reset after a success, so a relay that stayed down was hammered at
// whatever delay the dice gave.
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
const MAX_RECONNECT_DELAY_MS = 30_000;

// Application-level liveness. A TCP connection that dies without a FIN — laptop
// sleep, VPN flap, a network change — leaves the socket readable as OPEN while
// nothing crosses it. Without a heartbeat that state is only discovered when a
// command times out minutes later.
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastInboundAt = 0;

// Stable session ID for this MCP process — survives reconnections.
// Sent in join messages so the server can deduplicate reconnecting agents
// (e.g., after context compaction) instead of counting them as separate agents.
const SESSION_ID = `mcp_${process.pid}_${Date.now()}`;

// Map of pending requests for promise tracking
const pendingRequests = new Map<string, PendingRequest>();

/**
 * Connects to the Figma server via WebSocket.
 * @param port - Optional port for the connection (defaults to defaultPort from config)
 */
export function connectToFigma(port: number = defaultPort) {
  // An explicit connect is an intent to be connected, so it lifts a previous
  // shutdown. Otherwise a process that called closeFigmaConnection() could
  // never come back.
  shuttingDown = false;

  // If already connected, do nothing
  if (ws && ws.readyState === WebSocket.OPEN) {
    logger.info('Already connected to Figma');
    return;
  }

  // If connection is in progress (CONNECTING state), wait
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    logger.info('Connection to Figma is already in progress');
    return;
  }

  // If there's an existing socket in a closing state, clean it up
  if (ws && (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED)) {
    ws.removeAllListeners();
    ws = null;
  }

  const wsUrl = serverUrl === 'localhost' ? `${WS_URL}:${port}` : WS_URL;
  logger.info(`Connecting to Figma socket server at ${wsUrl}...`);
  
  try {
    ws = new WebSocket(wsUrl);
    
    // Add connection timeout
    const connectionTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        logger.error('Connection to Figma timed out');
        ws.terminate();
      }
    }, 10000); // 10 second connection timeout
    
    ws.on('open', () => {
      clearTimeout(connectionTimeout);
      logger.info('Connected to Figma socket server');
      reconnectAttempts = 0;
      lastInboundAt = Date.now();
      startHeartbeat(port);

      // The socket is new, so channel membership on the relay is gone with the
      // old one: `currentChannel` describes the live connection and must be
      // cleared. What must NOT be lost is the session's channel, so if this
      // process had joined one before the drop, rejoin it now.
      currentChannel = null;
      if (desiredChannel) rejoinAfterReconnect(desiredChannel);
    });

    ws.on('pong', () => {
      lastInboundAt = Date.now();
    });

    ws.on("message", (data: any) => {
      try {
        lastInboundAt = Date.now();
        const json = JSON.parse(data) as ProgressMessage;

        // Handle queue position updates from server-side command queue
        if ((json as any).type === 'queue_position') {
          const queueRequestId = (json as any).id;
          if (queueRequestId && pendingRequests.has(queueRequestId)) {
            const request = pendingRequests.get(queueRequestId)!;
            request.lastActivity = Date.now();
            // Reset timeout — command is queued and will be processed eventually
            clearTimeout(request.timeout);
            request.timeout = setTimeout(() => {
              if (pendingRequests.has(queueRequestId)) {
                logger.error(`Request ${queueRequestId} timed out while queued`);
                pendingRequests.delete(queueRequestId);
                request.reject(new Error('Request to Figma timed out while queued'));
              }
            }, 300000); // 5 min timeout while queued
          }
          return;
        }

        // Handle progress updates
        if (json.type === 'progress_update') {
          const progressData = json.message.data as CommandProgressUpdate;
          const requestId = json.id || '';

          if (requestId && pendingRequests.has(requestId)) {
            const request = pendingRequests.get(requestId)!;

            // Update last activity timestamp
            request.lastActivity = Date.now();

            // Reset the timeout to prevent timeouts during long-running operations
            clearTimeout(request.timeout);

            // Create a new timeout with extended time for long operations
            request.timeout = setTimeout(() => {
              if (pendingRequests.has(requestId)) {
                logger.error(`Request ${requestId} timed out after extended period of inactivity`);
                pendingRequests.delete(requestId);
                request.reject(new Error('Request to Figma timed out'));
              }
            }, 120000); // 120 second timeout for inactivity during progress updates

            // Log progress
            logger.info(`Progress update for ${progressData.commandType}: ${progressData.progress}% - ${progressData.message}`);

            // For completed updates, we could resolve the request early if desired
            if (progressData.status === 'completed' && progressData.progress === 100) {
              // Optionally resolve early with partial data
              // request.resolve(progressData.payload);
              // pendingRequests.delete(requestId);

              // Instead, just log the completion, wait for final result from Figma
              logger.info(`Operation ${progressData.commandType} completed, waiting for final result`);
            }
          }
          return;
        }

        // Handle regular responses
        const myResponse = json.message;

        // Not every relay frame carries a `message`: activity broadcasts are
        // `{type:"activity", event:{…}}`, and the relay's own pong is bare.
        // Reading `.command` off those threw once per frame, filling the log
        // with "undefined is not an object" during normal operation.
        if (!myResponse || typeof myResponse !== "object") {
          return;
        }

        logger.debug(`Received message: ${JSON.stringify(myResponse)}`);

        // Skip command echoes (own messages broadcast back to sender)
        if (myResponse.command) {
          return;
        }

        // Handle response to a request (success or error)
        if (
          myResponse.id &&
          pendingRequests.has(myResponse.id)
        ) {
          const request = pendingRequests.get(myResponse.id)!;
          clearTimeout(request.timeout);

          // Check for error at root level or nested inside result
          const error = myResponse.error ?? (myResponse.result && myResponse.result.error);

          if (error) {
            logger.error(`Error from Figma: ${error}`);
            request.reject(new Error(String(error)));
          } else {
            request.resolve(myResponse.result ?? myResponse);
          }

          pendingRequests.delete(myResponse.id);
        } else {
          // Handle broadcast messages or events
          logger.info(`Received broadcast message: ${JSON.stringify(myResponse)}`);
        }
      } catch (error) {
        logger.error(`Error parsing message: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    ws.on('error', (error) => {
      logger.error(`Socket error: ${error}`);
      // Don't attempt to reconnect here, let the close handler do it
    });

    ws.on('close', (code, reason) => {
      clearTimeout(connectionTimeout);
      stopHeartbeat();
      logger.info(`Disconnected from Figma socket server with code ${code} and reason: ${reason || 'No reason provided'}`);
      ws = null;
      currentChannel = null;

      // Reject all pending requests
      for (const [id, request] of pendingRequests.entries()) {
        clearTimeout(request.timeout);
        request.reject(new Error(`Connection closed with code ${code}: ${reason || 'No reason provided'}`));
        pendingRequests.delete(id);
      }

      scheduleReconnect(port);
    });

  } catch (error) {
    logger.error(`Failed to create WebSocket connection: ${error instanceof Error ? error.message : String(error)}`);
    scheduleReconnect(port);
  }
}

/**
 * Reconnect with real exponential backoff and jitter.
 *
 * The delay doubles per consecutive failure up to 30s and resets to the base
 * interval as soon as a connection opens, so a brief blip recovers in ~2s while
 * a relay that is genuinely down is not polled in a tight loop. The jitter stops
 * several MCP processes that dropped together from retrying in lockstep.
 */
function scheduleReconnect(port: number): void {
  if (shuttingDown) return;
  if (reconnectTimer) return; // an attempt is already pending

  const exponential = Math.min(
    MAX_RECONNECT_DELAY_MS,
    reconnectInterval * Math.pow(2, reconnectAttempts)
  );
  const delay = Math.round(exponential * (0.5 + Math.random() * 0.5));
  reconnectAttempts++;

  logger.info(`Attempting to reconnect in ${(delay / 1000).toFixed(1)} seconds (attempt ${reconnectAttempts})...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToFigma(port);
  }, delay);

  // A pending reconnect must not be the only reason the process stays alive.
  if (typeof (reconnectTimer as any)?.unref === "function") {
    (reconnectTimer as any).unref();
  }
}

/**
 * Restore channel membership after the transport comes back.
 *
 * Deliberately does not verify the plugin leg: the plugin may still be
 * reconnecting on its own schedule, and a failed ping here would clear
 * `desiredChannel` and undo the recovery this function exists to perform. The
 * next real command surfaces a genuinely absent plugin on its own.
 */
function rejoinAfterReconnect(channelName: string): void {
  sendCommandRaw("join", { channel: channelName }, 5000)
    .then(() => {
      currentChannel = channelName;
      logger.info(`Rejoined channel ${channelName} after reconnect`);
    })
    .catch((error) => {
      logger.error(
        `Failed to rejoin channel ${channelName} after reconnect: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
      // Leave `desiredChannel` set — the next close schedules another attempt.
    });
}

/**
 * Ping the relay on an interval and tear the socket down when it stops
 * answering, so a half-open connection becomes a reconnect within
 * HEARTBEAT_TIMEOUT_MS instead of surfacing as a command timeout minutes later.
 */
function startHeartbeat(port: number): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    const socket = ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    if (Date.now() - lastInboundAt > HEARTBEAT_TIMEOUT_MS) {
      logger.warn(
        `No traffic from the relay for ${HEARTBEAT_TIMEOUT_MS / 1000}s — ` +
        `treating the connection as dead and reconnecting.`
      );
      // terminate(), not close(): a half-open socket never completes a closing
      // handshake, so close() would hang instead of firing 'close'.
      try { socket.terminate(); } catch { /* already gone */ }
      return;
    }

    try { socket.ping(); } catch { /* the close handler will pick this up */ }
  }, HEARTBEAT_INTERVAL_MS);

  // Never let the heartbeat alone keep the process alive.
  if (typeof (heartbeatTimer as any)?.unref === "function") {
    (heartbeatTimer as any).unref();
  }
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Wait until the relay socket is OPEN, starting a connection if there isn't one.
 *
 * WHY THIS EXISTS
 * ---------------
 * The MCP process and the socket relay start independently: the host launches
 * the MCP server at app start, while the relay and the Figma plugin come up
 * whenever the user gets to them. `connectToFigma()` is fire-and-forget, so for
 * the first seconds of a session — and again during any reconnect backoff —
 * `ws` is CONNECTING or null.
 *
 * Throwing the instant `ws` is not OPEN reported "bridge offline" while the
 * plugin sat there showing a green "Connected" badge, because the broken leg
 * was MCP→relay, not plugin→relay. Waiting a bounded amount of time removes
 * that false negative without reintroducing a long stall.
 */
async function waitForConnection(timeoutMs: number = 8000): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    // Kick a fresh attempt rather than waiting out the exponential backoff,
    // which can be up to 30s — far longer than a caller should ever block.
    if (!ws) connectToFigma();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const target = serverUrl === "localhost" ? `${WS_URL}:${defaultPort}` : WS_URL;
  throw new Error(
    `RELAY UNREACHABLE — could not reach the socket relay at ${target} within ` +
    `${timeoutMs / 1000}s. The Figma plugin talks to the relay, and so does this ` +
    `server; if the relay is not running neither side can see the other. ` +
    `Start it with \`bun run socket\` (or \`npm run socket\`), then retry.`
  );
}

/**
 * Join a specific channel in Figma.
 * @param channelName - Name of the channel to join
 * @returns Promise that resolves when successfully joined the channel
 */
export async function joinChannel(channelName: string): Promise<void> {
  // Wait for the relay leg instead of failing the moment it is not yet open.
  await waitForConnection();

  try {
    // The relay acknowledges "join" instantly; use a short timeout so we
    // don't hang for minutes if the relay itself is unreachable.
    await sendCommandToFigma("join", { channel: channelName }, 5000);
    currentChannel = channelName;
    // The relay accepted the join, so this is the session's channel from here
    // on. Recorded before the plugin check below, because a plugin that is not
    // open yet is a reason to wait for it — not a reason to forget which
    // channel this session belongs to.
    desiredChannel = channelName;

    try {
      // Ping goes all the way to the Figma plugin and back. Now that the relay
      // leg is guaranteed open, this only measures plugin liveness, so a short
      // bound is safe: 5s covers a healthy local roundtrip with room to spare
      // while still failing fast when the plugin genuinely is not there.
      await sendCommandToFigma("ping", {}, 5000);
      logger.info(`Joined channel: ${channelName}`);
    } catch (verificationError) {
      currentChannel = null;
      const errorMsg = verificationError instanceof Error
        ? verificationError.message
        : String(verificationError);
      logger.error(`Failed to verify channel ${channelName}: ${errorMsg}`);
      throw new Error(
        `PLUGIN BRIDGE OFFLINE — channel "${channelName}" joined the relay but the Figma plugin did not respond. ` +
        `Open the Claude Talk to Figma plugin in your Figma file, enter channel "${channelName}", and click Join. ` +
        `Do NOT attempt any design operations until the bridge is confirmed online. ` +
        `Stop and ask the user to connect the plugin.`
      );
    }
  } catch (error) {
    logger.error(`Failed to join channel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get the current channel the connection is joined to.
 * @returns The current channel name or null if not connected to any channel
 */
export function getCurrentChannel(): string | null {
  return currentChannel;
}

/**
 * The channel this session belongs to, which survives transport drops.
 * Non-null while `getCurrentChannel()` is null means "reconnecting", not
 * "no session" — the two are worth telling apart when reporting status.
 */
export function getDesiredChannel(): string | null {
  return desiredChannel;
}

/**
 * This process's session ID, as the relay sees it in join messages.
 *
 * Exported so a test can drive the relay's session-deduplication path — the
 * mechanism that actually closes a stale connection when an agent reconnects —
 * rather than reimplementing a drop.
 */
export function getSessionId(): string {
  return SESSION_ID;
}

/**
 * Stop reconnecting. For process shutdown and for tests, which would otherwise
 * leave a backoff timer scheduling connections after the assertions are done.
 */
export function closeFigmaConnection(): void {
  shuttingDown = true;
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  desiredChannel = null;
  currentChannel = null;
  if (ws) {
    try { ws.removeAllListeners(); ws.close(); } catch { /* already gone */ }
    ws = null;
  }
}

/**
 * Send a command to Figma via WebSocket, bypassing the read cache.
 * @param command - The command to send
 * @param params - Additional parameters for the command
 * @param timeoutMs - Timeout in milliseconds before failing
 * @returns A promise that resolves with the Figma response
 */
async function sendCommandRaw(
  command: FigmaCommand,
  params: unknown = {},
  timeoutMs: number = 300000,
  target: "figma" | "webflow" = "figma"
): Promise<unknown> {
  // Wait for the relay leg to come up rather than rejecting the first command
  // of a session outright — see waitForConnection for why that mattered.
  await waitForConnection();

  return new Promise((resolve, reject) => {
    // Check if we need a channel for this command
    const requiresChannel = command !== "join";
    if (requiresChannel && !currentChannel) {
      reject(new Error("Must join a channel before sending commands"));
      return;
    }

    // ── Section scope enforcement ─────────────────────────────────────────
    // When a section scope is active and this is a creation command that has
    // no parentId, automatically inject the section's node ID so the new
    // element is created inside the scoped section rather than on the page root.
    let effectiveParams: Record<string, unknown> = { ...(params as any) };
    if (
      hasScopeState() &&
      SCOPE_CREATION_COMMANDS.has(command as string) &&
      !(effectiveParams as any).parentId
    ) {
      const scope = getScopeState()!;
      effectiveParams = { ...effectiveParams, parentId: scope.sectionId };
      logger.info(
        `[SectionScope] Auto-injecting parentId=${scope.sectionId} ("${scope.sectionName}") for command "${command}"`
      );
    }
    // ─────────────────────────────────────────────────────────────────────

    const id = uuidv4();
    const request = {
      id,
      type: command === "join" ? "join" : "message",
      ...(command === "join"
        ? { channel: (effectiveParams as any).channel, sessionId: SESSION_ID }
        : { channel: currentChannel }),
      message: {
        id,
        command,
        // Which editor the relay should deliver this to. Omitted for Figma so
        // older relays, which know nothing about targets, are unaffected.
        ...(target === "webflow" ? { target } : {}),
        params: {
          ...effectiveParams,
          commandId: id, // Include the command ID in params
        },
      },
    };

    // Set timeout for request
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        logger.error(`Request ${id} to Figma timed out after ${timeoutMs / 1000} seconds`);
        reject(new Error('Request to Figma timed out'));
      }
    }, timeoutMs);

    // Store the promise callbacks to resolve/reject later
    pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
      lastActivity: Date.now()
    });

    // Send the request. waitForConnection guarantees an OPEN socket, but the
    // socket can still drop between that check and here, so fail the request
    // explicitly instead of throwing past the promise.
    const socket = ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      clearTimeout(timeout);
      pendingRequests.delete(id);
      reject(new Error("Connection to the socket relay dropped before the command could be sent."));
      return;
    }

    logger.info(`Sending command to Figma: ${command}`);
    logger.debug(`Request details: ${JSON.stringify(request)}`);
    socket.send(JSON.stringify(request));
  });
}

/**
 * Send a command to Figma, reusing a recent response when the command is a
 * cacheable read and invalidating the cache when it is anything else.
 *
 * This wraps every tool call, so caching and invalidation stay correct no matter
 * which tool (or `figma_batch` op) issues the command.
 */
export function sendCommandToFigma(
  command: FigmaCommand,
  params: unknown = {},
  timeoutMs: number = 300000
): Promise<unknown> {
  if (CACHEABLE_READS[command as string] !== undefined) {
    return withReadCache(command as string, params, () =>
      sendCommandRaw(command, params, timeoutMs)
    );
  }

  // Anything that is not a known read may have changed the document.
  if (!isNonMutating(command as string)) {
    invalidateCache(command as string);
  }

  return sendCommandRaw(command, params, timeoutMs);
}

/**
 * Send a command to the Webflow Designer extension over the same relay.
 *
 * Shares the channel, the queue and the reconnection logic with the Figma path
 * — only the delivery target differs. The Figma read cache is deliberately not
 * consulted: the two editors have separate documents, and a cache keyed by
 * command name alone would collide across them.
 */
export function sendCommandToWebflow(
  command: string,
  params: unknown = {},
  timeoutMs: number = 300000
): Promise<unknown> {
  return sendCommandRaw(command as FigmaCommand, params, timeoutMs, "webflow");
}
