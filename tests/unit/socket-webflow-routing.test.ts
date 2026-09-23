/**
 * Relay routing between the two editors.
 *
 * Unlike socket-queue.test.ts, which mirrors socket.ts's constants into the test
 * file, this spawns **the real socket.ts** on a spare port via SOCKET_PORT and
 * drives it over WebSockets. Routing is exactly the kind of logic a mirrored
 * copy would silently stop testing the moment the real file changed, and it is
 * the piece that decides whether a Webflow command can land in Figma.
 *
 * What has to hold:
 *
 *  - A command with `target: "webflow"` reaches the client that joined with
 *    `role: "webflow"`, and nothing else.
 *  - A command without a target still reaches the Figma plugin, so every
 *    existing client keeps working untouched.
 *  - With the wrong editor connected, the sender gets a **named** error rather
 *    than silence. Webflow's own bridge drops a mismatched message with no
 *    reply, so the caller waits out the timeout and is told the app is not
 *    running — the failure this test exists to prevent.
 *  - Both editors share one channel queue, so a second command waits.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

let proc: ReturnType<typeof Bun.spawn>;
let port: number;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function waitFor(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for message")),
      timeoutMs
    );
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeEventListener("message", handler);
          resolve(msg);
        }
      } catch {
        /* ignore */
      }
    };
    ws.addEventListener("message", handler);
  });
}

/** Collect every message a client receives, for "did NOT receive" assertions. */
function collect(ws: WebSocket): any[] {
  const seen: any[] = [];
  ws.addEventListener("message", (event) => {
    try {
      seen.push(JSON.parse((event as MessageEvent).data as string));
    } catch {
      /* ignore */
    }
  });
  return seen;
}

async function join(ws: WebSocket, channel: string, role?: string): Promise<void> {
  const id = `join-${Math.random().toString(36).slice(2, 8)}`;
  const confirmed = waitFor(ws, (m) => m.type === "system" && m.message?.id === id);
  ws.send(JSON.stringify({ type: "join", channel, id, ...(role ? { role } : {}) }));
  await confirmed;
}

/** Send a command as an agent would, optionally addressed to Webflow. */
function send(
  ws: WebSocket,
  channel: string,
  command: string,
  target?: "webflow"
): string {
  const id = `req-${Math.random().toString(36).slice(2, 9)}`;
  ws.send(
    JSON.stringify({
      type: "message",
      channel,
      message: { id, command, ...(target ? { target } : {}), params: {} },
    })
  );
  return id;
}

/** Answer a command the way an editor client does. */
function reply(ws: WebSocket, channel: string, id: string, result: unknown): void {
  ws.send(JSON.stringify({ type: "message", channel, message: { id, result } }));
}

beforeAll(async () => {
  port = 34000 + Math.floor(Math.random() * 1000);
  proc = Bun.spawn(["bun", "run", "src/socket.ts"], {
    env: { ...process.env, SOCKET_PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Give the relay a moment to bind before the first connection.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`http://localhost:${port}/status`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await delay(100);
  }
  throw new Error("relay did not start");
});

afterAll(() => {
  proc?.kill();
});

describe("relay routing between Figma and Webflow clients", () => {
  it("delivers a webflow-targeted command to the Webflow client only", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const agent = await connect();
    const figma = await connect();
    const webflow = await connect();

    await join(agent, channel);
    await join(figma, channel, "figma");
    await join(webflow, channel, "webflow");

    const figmaSaw = collect(figma);
    const delivered = waitFor(
      webflow,
      (m) => m.type === "broadcast" && m.message?.command === "webflow_get_styles"
    );

    send(agent, channel, "webflow_get_styles", "webflow");
    const msg = await delivered;

    expect(msg.message.command).toBe("webflow_get_styles");
    // The Figma plugin must not see a Webflow command.
    expect(
      figmaSaw.some((m) => m.message?.command === "webflow_get_styles")
    ).toBe(false);

    agent.close();
    figma.close();
    webflow.close();
  });

  it("still delivers an untargeted command to the Figma plugin", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const agent = await connect();
    const figma = await connect();
    const webflow = await connect();

    await join(agent, channel);
    await join(figma, channel, "figma");
    await join(webflow, channel, "webflow");

    const webflowSaw = collect(webflow);
    const delivered = waitFor(
      figma,
      (m) => m.type === "broadcast" && m.message?.command === "get_document_info"
    );

    send(agent, channel, "get_document_info");
    await delivered;

    // Backwards compatibility: an old client sends no target and must be unaffected.
    expect(
      webflowSaw.some((m) => m.message?.command === "get_document_info")
    ).toBe(false);

    agent.close();
    figma.close();
    webflow.close();
  });

  it("names the missing editor instead of leaving the caller to time out", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const agent = await connect();
    const figma = await connect();

    await join(agent, channel);
    await join(figma, channel, "figma");

    const rejected = waitFor(
      agent,
      (m) => m.type === "broadcast" && typeof m.message?.error === "string",
      8000
    );

    send(agent, channel, "webflow_get_styles", "webflow");
    const msg = await rejected;

    expect(msg.message.error).toContain("Webflow Designer extension");
    // The error must not blame Figma, which is connected and fine.
    expect(msg.message.error).not.toContain("Figma plugin");

    agent.close();
    figma.close();
  });

  it("does not hand a webflow command to an unclassified client", async () => {
    // The Figma bootstrap path forwards to any non-agent client before the
    // plugin has been classified. That must never catch a Webflow command.
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const agent = await connect();
    const unclassified = await connect();

    await join(agent, channel);
    await join(unclassified, channel); // no role, never sent a response

    const seen = collect(unclassified);
    const rejected = waitFor(
      agent,
      (m) => m.type === "broadcast" && typeof m.message?.error === "string",
      8000
    );

    send(agent, channel, "webflow_create_element", "webflow");
    await rejected;

    expect(
      seen.some((m) => m.message?.command === "webflow_create_element")
    ).toBe(false);

    agent.close();
    unclassified.close();
  });

  it("serialises across both editors through the one channel queue", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const agent = await connect();
    const figma = await connect();
    const webflow = await connect();

    await join(agent, channel);
    await join(figma, channel, "figma");
    await join(webflow, channel, "webflow");

    const webflowSaw = collect(webflow);
    const first = waitFor(
      webflow,
      (m) => m.type === "broadcast" && m.message?.command === "webflow_get_styles"
    );

    const id1 = send(agent, channel, "webflow_get_styles", "webflow");
    await first;

    // Second command while the first is still in flight — the queue holds it.
    send(agent, channel, "webflow_get_variables", "webflow");
    await delay(400);
    expect(
      webflowSaw.some((m) => m.message?.command === "webflow_get_variables")
    ).toBe(false);

    // Answering the first releases the second.
    const second = waitFor(
      webflow,
      (m) => m.type === "broadcast" && m.message?.command === "webflow_get_variables",
      8000
    );
    reply(webflow, channel, id1, { styles: [] });
    await second;

    agent.close();
    figma.close();
    webflow.close();
  });

  it("reports the Webflow client in /status", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const agent = await connect();
    const webflow = await connect();
    await join(agent, channel);
    await join(webflow, channel, "webflow");
    await delay(200);

    const status = (await (await fetch(`http://localhost:${port}/status`)).json()) as {
      queue: { webflowCount: number; pluginCount: number };
    };
    // The role counters live under `queue`, alongside agentCount and pluginCount.
    expect(status.queue.webflowCount).toBeGreaterThanOrEqual(1);
    expect(status.queue.pluginCount).toBe(0);

    agent.close();
    webflow.close();
  });
});
