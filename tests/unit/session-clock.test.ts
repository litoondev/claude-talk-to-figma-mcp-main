/**
 * The Connect tab's session clock.
 *
 * It read "00:00" for the whole session while the panel sat connected and the
 * operation counter beside it climbed. The cause was an ordering bug rather
 * than a timer one: the socket's system-result branch set
 * `this.state.connected = true` and *then* called `updateStatus(true, ...)`,
 * which started the clock only on the disconnected→connected edge it computed
 * from that same field. By the time it looked, the edge had already been
 * consumed, so `stats.connectedAt` stayed null and every render produced 00:00.
 *
 * Both halves are covered here: the redundant assignment is gone from the
 * connect path, and `updateStatus` now keys off the clock's own state so no
 * future caller can swallow the start the same way.
 *
 * The methods are lifted out of ui.html and run against stubs, as in
 * tests/unit/plugin-session-recovery.test.ts, so the tests fail if the real
 * code regresses rather than passing against a copy of it.
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const UI_PATH = path.join(__dirname, "../../src/claude_mcp_plugin/ui.html");

function loadUiMethods(names: string[], sandbox: Record<string, unknown>) {
  const html = fs.readFileSync(UI_PATH, "utf8");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const source = scripts.find((s) => s.includes("renderStats(")) ?? "";
  if (!source) throw new Error("renderStats not found in ui.html");

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

  return vm.runInNewContext(`({ ${parts.join(",\n")} })`, sandbox);
}

/** Only what updateStatus and renderStats actually touch. */
function fakeElement() {
  return {
    innerHTML: "",
    textContent: "",
    className: "",
    attrs: {} as Record<string, string>,
    classes: new Set<string>(),
    setAttribute(name: string, value: string) { this.attrs[name] = value; },
    classList: {
      toggle(_name: string, _on: boolean) { /* recorded nowhere; not asserted */ },
    },
  };
}

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  url: string;
  readyState = 1;
  sent: string[] = [];
  onopen: any = null;
  onmessage: any = null;
  onclose: any = null;
  onerror: any = null;
  constructor(url: string) { this.url = url; FakeSocket.last = this; }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
}

const METHODS = ["connect", "updateStatus", "renderStats", "stopHeartbeat", "cancelReconnect"];

const harnesses: any[] = [];
afterEach(() => {
  for (const h of harnesses) {
    try { h.stopHeartbeat(); h.cancelReconnect(); } catch { /* already down */ }
  }
  harnesses.length = 0;
});

function makeHarness(now: { value: number }) {
  const sandbox: Record<string, unknown> = {
    WebSocket: FakeSocket,
    console,
    setTimeout: (fn: any, ms: number) => (globalThis.setTimeout as any)(fn, ms),
    clearTimeout: (id: any) => (globalThis.clearTimeout as any)(id),
    setInterval: (fn: any, ms: number) => (globalThis.setInterval as any)(fn, ms),
    clearInterval: (id: any) => (globalThis.clearInterval as any)(id),
    // A Date whose now() the test drives, so elapsed time is asserted exactly
    // rather than raced against the wall clock.
    Date: Object.assign(function () {} as any, Date, { now: () => now.value }),
    JSON,
    Math,
    String,
    parent: { postMessage: () => {} },
  };

  const ui = loadUiMethods(METHODS, sandbox);

  const self: any = {
    ui: {
      connectionStatus: fakeElement(),
      connectToggleBtn: fakeElement(),
      copyChannelBtn: fakeElement(),
      connDot: fakeElement(),
      connDotLarge: fakeElement(),
      connChipText: fakeElement(),
      statNodes: fakeElement(),
      statOps: fakeElement(),
      statUptime: fakeElement(),
    },
    state: {
      connected: false,
      socket: null,
      serverPort: 3055,
      pendingRequests: new Map(),
      channel: "ru98imtq",
      userDisconnected: false,
      heartbeatAckSeen: true,
      reconnectAttempts: 0,
      reconnectTimer: null,
      heartbeatTimer: null,
      lastInboundAt: 0,
    },
    stats: { nodes: new Set(), ops: 0, connectedAt: null },
    RECONNECT_BASE_MS: 1000,
    RECONNECT_MAX_MS: 30000,
    HEARTBEAT_INTERVAL_MS: 15000,
    HEARTBEAT_TIMEOUT_MS: 45000,
    settingsReady: Promise.resolve(),
    generateChannelName: () => "ru98imtq",
    handleSocketMessage: () => {},
    persistChannel: () => {},
    startHeartbeat: () => {},
    scheduleReconnect: () => {},
  };

  for (const name of METHODS) self[name] = (ui as any)[name].bind(self);
  harnesses.push(self);
  return self;
}

const clock = (h: any) => h.ui.statUptime.textContent;

describe("session clock", () => {
  it("starts when the socket goes live", () => {
    const now = { value: 1_000_000 };
    const h = makeHarness(now);

    h.updateStatus(true, "Connected on port 3055");
    expect(h.stats.connectedAt).toBe(1_000_000);

    now.value += 95_000;
    h.renderStats();
    expect(clock(h)).toBe("01:35");
  });

  it("starts even when the caller already flipped state.connected", () => {
    // The exact shape of the bug: the connect path set the field first, so the
    // edge updateStatus used to watch for had already been consumed.
    const now = { value: 5_000 };
    const h = makeHarness(now);
    h.state.connected = true;

    h.updateStatus(true, "Connected on port 3055");
    now.value += 61_000;
    h.renderStats();

    expect(clock(h)).toBe("01:01");
  });

  it("does not restart on every status refresh while connected", () => {
    const now = { value: 0 };
    const h = makeHarness(now);

    h.updateStatus(true, "Connected on port 3055");
    now.value += 30_000;
    h.updateStatus(true, "Connected on port 3055");
    h.renderStats();

    expect(clock(h)).toBe("00:30");
  });

  it("resets to 00:00 on disconnect", () => {
    const now = { value: 0 };
    const h = makeHarness(now);

    h.updateStatus(true, "Connected on port 3055");
    now.value += 45_000;
    h.updateStatus(false, "Disconnected.");

    expect(h.stats.connectedAt).toBeNull();
    expect(clock(h)).toBe("00:00");
  });

  it("runs after a real join, through the socket's own message handler", async () => {
    const now = { value: 2_000 };
    const h = makeHarness(now);
    await h.connect(3055);
    const socket = FakeSocket.last!;
    socket.onopen();

    // What the bridge sends back once the join succeeds.
    socket.onmessage({
      data: JSON.stringify({
        type: "system",
        channel: "ru98imtq",
        message: { result: true, message: "Joined channel" },
      }),
    });

    expect(h.state.connected).toBe(true);
    expect(h.stats.connectedAt).toBe(2_000);

    now.value += 5_000;
    h.renderStats();
    expect(clock(h)).toBe("00:05");
  });
});

describe("connect path", () => {
  it("leaves state.connected for updateStatus to set, so the edge survives", () => {
    const html = fs.readFileSync(UI_PATH, "utf8");
    const joinBranch = html.slice(
      html.indexOf("if (data.message && data.message.result)"),
      html.indexOf("if (data.message && data.message.result)") + 400
    );
    expect(joinBranch).not.toMatch(/this\.state\.connected\s*=\s*true/);
  });
});
