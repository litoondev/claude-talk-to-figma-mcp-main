/**
 * The plugin half of session recovery.
 *
 * Before this, a dropped socket ended the session for good: ui.html's onclose
 * only wrote a status string, and the Connect button minted a *new* random
 * channel — so reconnecting stranded whatever agent was joined to the old one.
 * The channel is the session's identity, so it is generated once, reused on
 * every reconnect, and persisted through the main thread.
 *
 * The connection methods are executed out of ui.html against stubs, in the same
 * way tests/unit/ui-resize.test.ts drives the drag methods, so the tests fail if
 * the real code stops doing this rather than passing against a copy of it.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { loadPlugin, clearNodes } from "../fixtures/figma-plugin-harness";

const UI_PATH = path.join(__dirname, "../../src/claude_mcp_plugin/ui.html");

// ─── Main thread ───────────────────────────────────────────────────────────

describe("main thread: channel persistence", () => {
  let figma: any;
  let stored: Array<[string, any]>;

  beforeEach(() => {
    clearNodes();
    const loaded = loadPlugin();
    figma = loaded.figma;
    stored = [];
    figma.clientStorage.setAsync = async (key: string, value: any) => {
      stored.push([key, value]);
    };
  });

  const send = (msg: any) => figma.ui.onmessage(msg);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const channels = () => stored.filter(([key]) => key === "mcp_channel");

  it("stores the channel the UI reports", async () => {
    await send({ type: "persist-channel", channel: "abc12345" });
    await flush();
    expect(channels()).toEqual([["mcp_channel", "abc12345"]]);
  });

  it("ignores an empty or non-string channel rather than storing junk", async () => {
    await send({ type: "persist-channel", channel: "" });
    await send({ type: "persist-channel", channel: null });
    await send({ type: "persist-channel" });
    await flush();
    expect(channels()).toEqual([]);
  });

  it("survives a storage write that fails", async () => {
    figma.clientStorage.setAsync = async () => {
      throw new Error("storage unavailable");
    };
    await expect(send({ type: "persist-channel", channel: "abc12345" })).resolves.not.toThrow();
  });
});

// ─── UI thread ─────────────────────────────────────────────────────────────

/**
 * Lift named methods out of ui.html's <script> block onto a plain object, so
 * they run against stubs without needing a document. Mirrors the approach in
 * ui-resize.test.ts, extended to keep `async` on the methods that have it.
 */
function loadUiMethods(names: string[], sandbox: Record<string, unknown>) {
  const html = fs.readFileSync(UI_PATH, "utf8");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const source = scripts.find((s) => s.includes("scheduleReconnect(")) ?? "";
  if (!source) throw new Error("connection methods not found in ui.html");

  const parts = names.map((name) => {
    const asyncMarker = `\n      async ${name}(`;
    const plainMarker = `\n      ${name}(`;
    let at = source.indexOf(asyncMarker);
    const isAsync = at !== -1;
    if (!isAsync) at = source.indexOf(plainMarker);
    if (at === -1) throw new Error(`${name} not found in ui.html`);

    const from = source.indexOf(name, at);
    let depth = 0;
    let i = source.indexOf("{", at);
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) break;
    }
    return `${name}: ${isAsync ? "async " : ""}function ${source.slice(from, i + 1)}`;
  });

  // The lifted methods resolve globals against the vm context, not the test's,
  // so everything they touch — `parent`, the timer functions, WebSocket — has to
  // be handed in here rather than set on `global`.
  return vm.runInNewContext(`({ ${parts.join(",\n")} })`, sandbox);
}

/** Minimal stand-in for a browser WebSocket: records sends, fires nothing itself. */
class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeSocket | null = null;
  url: string;
  readyState = 1;
  sent: string[] = [];
  closed = 0;
  onopen: any = null;
  onmessage: any = null;
  onclose: any = null;
  onerror: any = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed++;
    this.readyState = 3;
  }
}
(FakeSocket as any).prototype.constructor = FakeSocket;

const METHODS = [
  "connect",
  "disconnect",
  "scheduleReconnect",
  "cancelReconnect",
  "startHeartbeat",
  "stopHeartbeat",
  "persistChannel",
];

/**
 * A stub carrying only what the connection methods touch.
 *
 * `scheduleReal: false` makes the sandbox's setTimeout record a delay without
 * actually arming it, so the backoff test can read the sequence without leaving
 * timers pending that would later call connect() after the assertions.
 */
/**
 * Every harness is torn down after its test. A successful connect starts the
 * real heartbeat interval, and leaving even one armed keeps the jest worker
 * alive after the assertions pass — which `--forceExit` would hide rather than
 * fix.
 */
const harnesses: any[] = [];
afterEach(() => {
  for (const h of harnesses) {
    try { h.stopHeartbeat(); h.cancelReconnect(); } catch { /* already down */ }
  }
  harnesses.length = 0;
});

function makeHarness(overrides: any = {}) {
  const { scheduleReal = true, ...rest } = overrides;
  const statuses: Array<[boolean, string]> = [];
  const posted: any[] = [];
  const timeoutDelays: number[] = [];

  const sandbox: Record<string, unknown> = {
    WebSocket: FakeSocket,
    console,
    // Delegated through globalThis at call time so jest's fake timers, installed
    // per test, are the ones the lifted code actually uses.
    setTimeout: (fn: any, ms: number) => {
      timeoutDelays.push(ms);
      return scheduleReal ? (globalThis.setTimeout as any)(fn, ms) : 1;
    },
    clearTimeout: (id: any) => (globalThis.clearTimeout as any)(id),
    setInterval: (fn: any, ms: number) => (globalThis.setInterval as any)(fn, ms),
    clearInterval: (id: any) => (globalThis.clearInterval as any)(id),
    Date,
    JSON,
    Math,
    parent: { postMessage: (m: any) => posted.push(m) },
  };

  const ui = loadUiMethods(METHODS, sandbox);

  const self: any = {
    state: {
      connected: false,
      socket: null,
      serverPort: 3055,
      pendingRequests: new Map(),
      channel: null,
      userDisconnected: false,
      heartbeatAckSeen: true,
      reconnectAttempts: 0,
      reconnectTimer: null,
      heartbeatTimer: null,
      lastInboundAt: 0,
    },
    RECONNECT_BASE_MS: 1000,
    RECONNECT_MAX_MS: 30000,
    HEARTBEAT_INTERVAL_MS: 15000,
    HEARTBEAT_TIMEOUT_MS: 45000,
    settingsReady: Promise.resolve(),
    updateStatus: (connected: boolean, message: string) => statuses.push([connected, message]),
    generateChannelName: () => "generated",
    handleSocketMessage: () => {},
    statuses,
    posted,
    timeoutDelays,
    ...rest,
  };

  for (const name of METHODS) self[name] = (ui as any)[name].bind(self);
  harnesses.push(self);
  return self;
}

describe("ui.html: channel reuse across reconnects", () => {
  it("generates a channel on the first connect", async () => {
    const h = makeHarness();
    await h.connect(3055);
    FakeSocket.last!.onopen();
    expect(h.state.channel).toBe("generated");
  });

  it("reuses the same channel on a reconnect instead of minting a new one", async () => {
    const h = makeHarness({ generateChannelName: () => `new-${Math.random()}` });
    await h.connect(3055);
    const first = FakeSocket.last!;
    first.onopen();
    const original = h.state.channel;

    // A drop, then the reconnect.
    h.state.socket = null;
    h.state.connected = false;
    await h.connect(3055);
    const second = FakeSocket.last!;
    second.onopen();

    expect(h.state.channel).toBe(original);
    const join = JSON.parse(second.sent.find((s) => s.includes('"join"'))!);
    expect(join.channel).toBe(original);
  });

  it("adopts a channel restored from storage rather than generating one", async () => {
    const h = makeHarness();
    h.state.channel = "stored99"; // as init-settings would have set it
    await h.connect(3055);
    FakeSocket.last!.onopen();
    expect(h.state.channel).toBe("stored99");
  });

  it("asks the main thread to persist the channel it connected with", async () => {
    const h = makeHarness();
    await h.connect(3055);
    FakeSocket.last!.onopen();
    const msg = h.posted.find((m: any) => m.pluginMessage?.type === "persist-channel");
    expect(msg.pluginMessage.channel).toBe("generated");
  });
});

describe("ui.html: reconnect backoff", () => {
  it("backs off exponentially, and each delay stays within its jitter band", () => {
    const h = makeHarness({ scheduleReal: false });

    for (let i = 0; i < 4; i++) {
      h.state.reconnectTimer = null;
      h.scheduleReconnect();
    }
    const delays = h.timeoutDelays;

    // Jitter is 50-100% of 1s, 2s, 4s, 8s.
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThanOrEqual(1000);
    expect(delays[3]).toBeGreaterThanOrEqual(4000);
    expect(delays[3]).toBeLessThanOrEqual(8000);
    expect(h.state.reconnectAttempts).toBe(4);
  });

  it("does not schedule a reconnect after the user clicked Disconnect", () => {
    const h = makeHarness();
    h.state.userDisconnected = true;
    h.scheduleReconnect();
    expect(h.state.reconnectTimer).toBeNull();
  });

  it("does not stack a second timer while one is pending", () => {
    const h = makeHarness();
    h.scheduleReconnect();
    const first = h.state.reconnectTimer;
    h.scheduleReconnect();
    expect(h.state.reconnectTimer).toBe(first);
    expect(h.state.reconnectAttempts).toBe(1);
    h.cancelReconnect();
  });

  it("marks intent on disconnect so the close is not treated as a fault", () => {
    const h = makeHarness();
    h.state.socket = new FakeSocket("ws://localhost:3055");
    h.disconnect();
    expect(h.state.userDisconnected).toBe(true);
    expect(h.state.reconnectTimer).toBeNull();
  });
});

describe("ui.html: heartbeat", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sends a heartbeat on the interval while the socket is open", () => {
    const h = makeHarness();
    const socket = new FakeSocket("ws://localhost:3055");
    h.state.socket = socket;
    h.state.lastInboundAt = Date.now();

    h.startHeartbeat();
    jest.advanceTimersByTime(15000);

    const beats = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.type === "heartbeat");
    expect(beats.length).toBe(1);
    expect(typeof beats[0].ts).toBe("number");
    h.stopHeartbeat();
  });

  it("closes a socket that has gone quiet, so the reconnect path can run", () => {
    const h = makeHarness();
    const socket = new FakeSocket("ws://localhost:3055");
    h.state.socket = socket;
    // Last traffic is older than the timeout: the half-open case.
    h.state.lastInboundAt = Date.now() - 60000;

    h.startHeartbeat();
    jest.advanceTimersByTime(15000);

    expect(socket.closed).toBe(1);
    h.stopHeartbeat();
  });

  it("leaves a busy socket alone even though it never answers a heartbeat", () => {
    const h = makeHarness();
    const socket = new FakeSocket("ws://localhost:3055");
    h.state.socket = socket;
    h.state.lastInboundAt = Date.now();

    h.startHeartbeat();
    // Traffic keeps arriving, so the watchdog is fed on every tick.
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(15000);
      h.state.lastInboundAt = Date.now();
    }
    expect(socket.closed).toBe(0);
    h.stopHeartbeat();
  });

  it("never closes the socket against a relay that does not answer heartbeats", () => {
    // An older relay ignores the heartbeat frame. Enforcing the timeout there
    // would close a healthy socket every 45s — a disconnect loop introduced by
    // the very check meant to prevent disconnects.
    const h = makeHarness();
    const socket = new FakeSocket("ws://localhost:3055");
    h.state.socket = socket;
    h.state.heartbeatAckSeen = false;
    h.state.lastInboundAt = Date.now() - 600000;

    h.startHeartbeat();
    jest.advanceTimersByTime(15000 * 6);

    expect(socket.closed).toBe(0);
    // It keeps offering heartbeats, so a relay that gains support is picked up.
    expect(socket.sent.length).toBeGreaterThan(0);
    h.stopHeartbeat();
  });

  it("stops the heartbeat when told to", () => {
    const h = makeHarness();
    const socket = new FakeSocket("ws://localhost:3055");
    h.state.socket = socket;
    h.state.lastInboundAt = Date.now();

    h.startHeartbeat();
    h.stopHeartbeat();
    jest.advanceTimersByTime(60000);
    expect(socket.sent.length).toBe(0);
    expect(h.state.heartbeatTimer).toBeNull();
  });
});
