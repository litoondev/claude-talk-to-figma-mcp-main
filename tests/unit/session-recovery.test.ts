/**
 * Session recovery across a transport drop.
 *
 * A dropped WebSocket is normal — a relay restart, a laptop waking, a network
 * change. What used to make it fatal was that nothing restored the *session*
 * afterwards: the MCP server reconnected its socket but cleared its channel and
 * never rejoined, so every command after a blip failed with "Must join a
 * channel before sending commands" while both ends still displayed
 * "Connected".
 *
 * These tests drive the real relay (`src/socket.ts`, spawned as a subprocess)
 * and the real client (`utils/websocket.ts`). Deliberately not a mirror of the
 * relay's logic reimplemented in the test file: a reimplementation can only
 * confirm what the test author already believed, and this bug lived precisely
 * in the gap between belief and behaviour (LESSONS L3, L5).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "path";

const PORT = 3077;
const REPO_ROOT = path.join(import.meta.dir, "../..");
const RELAY = path.join(REPO_ROOT, "src/socket.ts");

// config.ts reads the port from argv at module load, and waitForConnection()
// reconnects using that default — so it has to be set before the import below.
process.argv.push(`--port=${PORT}`);
const {
  joinChannel,
  getCurrentChannel,
  getDesiredChannel,
  getSessionId,
  sendCommandToFigma,
  closeFigmaConnection,
} = await import("../../src/talk_to_figma_mcp/utils/websocket");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let relay: ReturnType<typeof Bun.spawn> | null = null;

function startRelay() {
  relay = Bun.spawn(["bun", "run", RELAY], {
    cwd: REPO_ROOT,
    env: { ...process.env, SOCKET_PORT: String(PORT) },
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function stopRelay() {
  if (relay) {
    relay.kill();
    await relay.exited;
    relay = null;
  }
}

/** Waits until the relay answers, so tests never race its startup. */
async function waitForRelay(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/status`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error("relay did not start");
}

function openClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("could not connect"));
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

/**
 * Stands in for the Figma plugin: joins a channel and answers the commands the
 * client sends during a join handshake, so the MCP side exercises its real
 * verification path rather than a shortened one.
 */
function fakePlugin(channel: string, ws: WebSocket) {
  ws.send(JSON.stringify({ type: "join", channel }));
  ws.onmessage = (event: MessageEvent) => {
    const data = JSON.parse(String(event.data));
    const msg = data.message;
    if (!msg || !msg.command) return;
    const result =
      msg.command === "ping" ? { status: "ok" } : { name: "Test File", fileKey: "abc" };
    ws.send(JSON.stringify({ type: "message", channel, message: { id: msg.id, result } }));
  };
}

beforeAll(async () => {
  startRelay();
  await waitForRelay();
});

afterAll(async () => {
  closeFigmaConnection();
  await stopRelay();
});

describe("relay heartbeat", () => {
  it("answers a heartbeat before the client has joined any channel", async () => {
    const ws = await openClient();
    const ack = new Promise<any>((resolve) => {
      ws.onmessage = (event: MessageEvent) => {
        const data = JSON.parse(String(event.data));
        if (data.type === "heartbeat_ack") resolve(data);
      };
    });

    ws.send(JSON.stringify({ type: "heartbeat", ts: 12345 }));
    const data = await Promise.race([
      ack,
      sleep(3000).then(() => {
        throw new Error("no heartbeat_ack within 3s");
      }),
    ]);

    // The echoed timestamp is what lets a client measure round-trip liveness
    // rather than merely observing that something came back.
    expect(data.ts).toBe(12345);
    ws.close();
  });
});

describe("session recovery after the connection drops", () => {
  /**
   * The drop is produced through the relay's own session-deduplication path: a
   * second join carrying this process's sessionId makes the relay close the
   * first connection, which is exactly what happens when an agent reconnects.
   * That keeps the relay up, so the test measures the client's recovery rather
   * than a subprocess restart race.
   */
  it("rejoins its channel and keeps working, with no manual join", async () => {
    const channel = "recovery-test";
    const plugin = await openClient();
    fakePlugin(channel, plugin);
    await sleep(300);

    await joinChannel(channel);
    expect(getCurrentChannel()).toBe(channel);
    expect(getDesiredChannel()).toBe(channel);

    // Evict the client's connection.
    const impostor = await openClient();
    impostor.send(
      JSON.stringify({ type: "join", channel: "elsewhere", sessionId: getSessionId() })
    );

    // Wait for the eviction to be observed, then for the rejoin to complete.
    const dropDeadline = Date.now() + 10000;
    while (Date.now() < dropDeadline && getCurrentChannel() !== null) {
      await sleep(100);
    }
    expect(getCurrentChannel()).toBeNull();
    // The transport is gone but the session's channel is not — that distinction
    // is the whole fix.
    expect(getDesiredChannel()).toBe(channel);

    const rejoinDeadline = Date.now() + 25000;
    while (Date.now() < rejoinDeadline && getCurrentChannel() !== channel) {
      await sleep(200);
    }
    expect(getCurrentChannel()).toBe(channel);

    // The real proof: a command routes end to end with nobody rejoining by hand.
    const info = await sendCommandToFigma("get_document_info", {}, 8000);
    expect((info as any).name).toBe("Test File");

    impostor.close();
    plugin.close();
  }, 60000);
});

describe("connection accounting", () => {
  it("does not double-count a closed connection when a session reconnects", async () => {
    const before = (await waitForRelay()).stats.activeConnections;

    // Two joins carrying the same sessionId: the relay closes the first, which
    // fires its own close handler. Decrementing in both places drove the gauge
    // negative and made /status useless for diagnosing dropped sessions.
    const a = await openClient();
    a.send(JSON.stringify({ type: "join", channel: "dedupe", sessionId: "same-session" }));
    await sleep(300);

    const b = await openClient();
    b.send(JSON.stringify({ type: "join", channel: "dedupe", sessionId: "same-session" }));
    await sleep(600);

    const after = (await waitForRelay()).stats.activeConnections;
    expect(after).toBeGreaterThanOrEqual(0);
    // One of the two survived, so the gauge moved by exactly one.
    expect(after - before).toBe(1);

    b.close();
  }, 20000);
});
