import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";
import { serverUrl, defaultPort, WS_URL, reconnectInterval } from "../config/config";
import { FigmaCommand, FigmaResponse, CommandProgressUpdate, PendingRequest, ProgressMessage } from "../types";
import { hasScopeState, getScopeState, SCOPE_CREATION_COMMANDS } from "./section-scope";
import { withReadCache, invalidateCache, isNonMutating, CACHEABLE_READS } from "./cache";

// WebSocket connection and request tracking
let ws: WebSocket | null = null;
let currentChannel: string | null = null;

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
      // Reset channel on new connection
      currentChannel = null;
    });

    ws.on("message", (data: any) => {
      try {
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
      logger.info(`Disconnected from Figma socket server with code ${code} and reason: ${reason || 'No reason provided'}`);
      ws = null;

      // Reject all pending requests
      for (const [id, request] of pendingRequests.entries()) {
        clearTimeout(request.timeout);
        request.reject(new Error(`Connection closed with code ${code}: ${reason || 'No reason provided'}`));
        pendingRequests.delete(id);
      }

      // Attempt to reconnect with exponential backoff
      const backoff = Math.min(30000, reconnectInterval * Math.pow(1.5, Math.floor(Math.random() * 5))); // Max 30s
      logger.info(`Attempting to reconnect in ${backoff/1000} seconds...`);
      setTimeout(() => connectToFigma(port), backoff);
    });
    
  } catch (error) {
    logger.error(`Failed to create WebSocket connection: ${error instanceof Error ? error.message : String(error)}`);
    // Attempt to reconnect after a delay
    setTimeout(() => connectToFigma(port), reconnectInterval);
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
