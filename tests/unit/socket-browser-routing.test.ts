/**
 * Relay routing for the Web-to-Figma browser extension.
 *
 * Same method as socket-webflow-routing.test.ts: spawn the real socket.ts on a
 * spare port and drive it over WebSockets. The browser extension is a third
 * command-answering client, so what has to hold is the Webflow contract again,
 * plus that the three never cross:
 *
 *  - `target: "browser"` reaches the client that joined with `role: "browser"`
 *    and neither editor; untargeted and webflow-targeted commands never reach it.
 *  - With no browser connected, the sender gets an error naming the browser
 *    extension — not silence, and not a message blaming Figma.
 *  - The Figma bootstrap broadcast never hands a browser command to an
 *    unclassified client.
 *  - If the extension drops mid-command, the error names the extension.
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

/** Answer a command the way an editor client does. */
function reply(ws: WebSocket, channel: string, id: string, result: unknown): void {
  ws.send(JSON.stringify({ type: "message", channel, message: { id, result } }));
}

/** Send a command as an agent would, optionally addressed to a target. */
function send(ws: WebSocket, channel: string, command: string, target?: "webflow" | "browser"): string {
  const id = `req-${Math.random().toString(36).slice(2, 9)}`;
  ws.send(JSON.stringify({ type: "message", channel, message: { id, command, ...(target ? { target } : {}), params: {} } }));
  return id;
}

const ch = () => `ch-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  port = 36000 + Math.floor(Math.random() * 1000);
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

describe("relay routing for the browser extension", () => {
  it("delivers a browser-targeted command to the browser client only", async () => {
    const channel = ch();
    const agent = await connect();
    const figma = await connect();
    const webflow = await connect();
    const browser = await connect();
    await join(agent, channel);
    await join(figma, channel, "figma");
    await join(webflow, channel, "webflow");
    await join(browser, channel, "browser");

    const figmaSaw = collect(figma);
    const webflowSaw = collect(webflow);
    const delivered = waitFor(browser, (m) => m.type === "broadcast" && m.message?.command === "browser_capture");
    send(agent, channel, "browser_capture", "browser");
    const msg = await delivered;

    expect(msg.message.target).toBe("browser");
    await delay(200);
    expect(figmaSaw.some((m) => m.message?.command === "browser_capture")).toBe(false);
    expect(webflowSaw.some((m) => m.message?.command === "browser_capture")).toBe(false);
    [agent, figma, webflow, browser].forEach((w) => w.close());
  });

  it("never gives the browser a Figma or Webflow command", async () => {
    const channel = ch();
    const agent = await connect();
    const figma = await connect();
    const webflow = await connect();
    const browser = await connect();
    await join(agent, channel);
    await join(figma, channel, "figma");
    await join(webflow, channel, "webflow");
    await join(browser, channel, "browser");

    const browserSaw = collect(browser);
    const toFigma = waitFor(figma, (m) => m.type === "broadcast" && m.message?.command === "get_document_info");
    const id1 = send(agent, channel, "get_document_info");
    await toFigma;
    reply(figma, channel, id1, { ok: true });

    const toWebflow = waitFor(webflow, (m) => m.type === "broadcast" && m.message?.command === "webflow_get_styles");
    send(agent, channel, "webflow_get_styles", "webflow");
    await toWebflow;

    await delay(200);
    expect(browserSaw.some((m) => m.message?.command === "get_document_info")).toBe(false);
    expect(browserSaw.some((m) => m.message?.command === "webflow_get_styles")).toBe(false);
    [agent, figma, webflow, browser].forEach((w) => w.close());
  });

  it("routes the browser's reply back to the agent that asked", async () => {
    const channel = ch();
    const agent = await connect();
    const browser = await connect();
    await join(agent, channel);
    await join(browser, channel, "browser");

    const delivered = waitFor(browser, (m) => m.type === "broadcast" && m.message?.command === "browser_status");
    const id = send(agent, channel, "browser_status", "browser");
    await delivered;
    const answered = waitFor(agent, (m) => m.type === "broadcast" && m.message?.id === id && m.message?.result !== undefined);
    reply(browser, channel, id, { extension: "Web-to-Figma" });
    const msg = await answered;
    expect(msg.message.result.extension).toBe("Web-to-Figma");
    agent.close();
    browser.close();
  });

  it("names the browser extension when none is connected", async () => {
    const channel = ch();
    const agent = await connect();
    const figma = await connect();
    await join(agent, channel);
    await join(figma, channel, "figma");

    const rejected = waitFor(agent, (m) => m.type === "broadcast" && typeof m.message?.error === "string", 8000);
    send(agent, channel, "browser_capture", "browser");
    const msg = await rejected;
    expect(msg.message.error).toContain("Web-to-Figma browser extension");
    expect(msg.message.error).not.toContain("Figma plugin");
    agent.close();
    figma.close();
  });

  it("does not hand a browser command to an unclassified client", async () => {
    const channel = ch();
    const agent = await connect();
    const unclassified = await connect();
    await join(agent, channel);
    await join(unclassified, channel);

    const seen = collect(unclassified);
    const rejected = waitFor(agent, (m) => m.type === "broadcast" && typeof m.message?.error === "string", 8000);
    send(agent, channel, "browser_capture", "browser");
    await rejected;
    expect(seen.some((m) => m.message?.command === "browser_capture")).toBe(false);
    agent.close();
    unclassified.close();
  });

  it("names the browser extension when it drops mid-command", async () => {
    const channel = ch();
    const agent = await connect();
    const browser = await connect();
    await join(agent, channel);
    await join(browser, channel, "browser");

    const delivered = waitFor(browser, (m) => m.type === "broadcast" && m.message?.command === "browser_capture");
    const id = send(agent, channel, "browser_capture", "browser");
    await delivered;
    const failed = waitFor(agent, (m) => m.type === "broadcast" && m.message?.id === id && typeof m.message?.error === "string", 8000);
    browser.close();
    const msg = await failed;
    expect(msg.message.error).toContain("Web-to-Figma browser extension disconnected");
    agent.close();
  });

  it("reports who is on each channel, so an agent can find the plugin", async () => {
    const channel = ch();
    const agent = await connect();
    const figma = await connect();
    const browser = await connect();
    await join(agent, channel);
    await join(figma, channel, "figma");
    await join(browser, channel, "browser");
    await delay(200);
    const status = (await (await fetch(`http://localhost:${port}/status`)).json()) as {
      channelClients: Array<{ channel: string; figma: number; browser: number; agents: number; other: number }>;
    };
    const row = status.channelClients.find((r) => r.channel === channel)!;
    expect(row).toMatchObject({ figma: 1, browser: 1, other: 1 }); // the agent has not sent a command yet
    [agent, figma, browser].forEach((w) => w.close());
  });

  it("serves the web import runtime for the plugin panel's Upload", async () => {
    const res = await fetch(`http://localhost:${port}/web-import-runtime.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.text()).toContain("async function __w2fEntry");
  });

  it("reports the browser client in /status", async () => {
    const channel = ch();
    const agent = await connect();
    const browser = await connect();
    await join(agent, channel);
    await join(browser, channel, "browser");
    await delay(200);
    const status = (await (await fetch(`http://localhost:${port}/status`)).json()) as {
      queue: { browserCount: number; pluginCount: number; webflowCount: number };
    };
    expect(status.queue.browserCount).toBeGreaterThanOrEqual(1);
    expect(status.queue.pluginCount).toBe(0);
    agent.close();
    browser.close();
  });
});
