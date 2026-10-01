/**
 * The browser extension's service worker against the real relay.
 *
 * background.js runs in a VM context with a fake `chrome` global and the real
 * WebSocket, joined to a real socket.ts spawned on a spare port. Chrome's own
 * APIs are faked; the protocol, the routing, the session recovery and the
 * error text are real.
 *
 * What only a live Chrome proves — that executeScript injects into a real tab,
 * that the popup renders, that the worker stays alive — is not covered here.
 * The extension README says so, so a green run is not read as "verified in Chrome".
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

const ROOT = path.join(import.meta.dir, "..", "..");
const EXT = path.join(ROOT, "browser_extension");
const CAPTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "browser-capture", "page.capture.json"), "utf8"));

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let port = 0;
let relay: ReturnType<typeof Bun.spawn> | null = null;

async function startRelay() {
  relay = Bun.spawn(["bun", "run", "src/socket.ts"], {
    cwd: ROOT,
    env: { ...process.env, SOCKET_PORT: String(port) },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/status`)).ok) return;
    } catch { /* not yet */ }
    await delay(100);
  }
  throw new Error("relay did not start");
}

function stopRelay() {
  relay?.kill();
  relay = null;
}

/** A chrome.* stand-in with just what background.js calls. */
function fakeChrome(tab: { id: number; url: string; title: string }, scriptResults: Array<(args: any) => any>) {
  const store: Record<string, any> = {};
  const session: Record<string, any> = {};
  const listeners: Record<string, Function[]> = {};
  const on = (name: string) => ({ addListener: (fn: Function) => (listeners[name] ||= []).push(fn), removeListener: () => {} });
  const executed: any[] = [];
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.1.0" }),
      sendMessage: () => Promise.resolve(),
      onMessage: on("onMessage"),
      onStartup: on("onStartup"),
      onInstalled: on("onInstalled"),
    },
    action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
    storage: {
      local: { get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])), set: async (o: any) => Object.assign(store, o) },
      session: { get: async (k: string) => (k in session ? { [k]: session[k] } : {}), set: async (o: any) => Object.assign(session, o), remove: async (k: string) => { delete session[k]; } },
    },
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      create: async () => tab,
      update: async () => tab,
      onUpdated: on("tabs.onUpdated"),
      onRemoved: on("tabs.onRemoved"),
    },
    scripting: {
      executeScript: async (spec: any) => {
        executed.push(spec);
        if (spec.files) return [{ result: undefined }];
        const next = scriptResults.shift();
        return [{ result: next ? next(spec.args) : undefined }];
      },
    },
    alarms: { create: () => {}, onAlarm: on("alarms.onAlarm") },
    debugger: {
      calls: [] as any[],
      failAttach: null as string | null,
      async attach(target: any) { if ((chrome as any).debugger.failAttach) throw new Error((chrome as any).debugger.failAttach); (chrome as any).debugger.calls.push(["attach", target.tabId]); },
      async sendCommand(_t: any, method: string, params: any) { (chrome as any).debugger.calls.push([method, params]); return {}; },
      async detach(target: any) { (chrome as any).debugger.calls.push(["detach", target.tabId]); },
    },
  };
  return { chrome, store, executed, listeners };
}

/** Load background.js in its own context, as Chrome would load the worker. */
function loadWorker(chrome: any) {
  const context: any = {
    chrome, WebSocket, fetch, Blob, AbortController, URL, console,
    setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Date, Math, Map, Set, Array, Object, Number, String, Error,
  };
  context.self = context;
  context.importScripts = (file: string) => vm.runInContext(fs.readFileSync(path.join(EXT, file), "utf8"), context);
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), context, { filename: "background.js" });
  return context;
}

function connectAgent(channel: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", channel, id: "agent-join" }));
      setTimeout(() => resolve(ws), 150);
    };
    ws.onerror = reject;
  });
}

function command(agent: WebSocket, channel: string, name: string, params: any = {}, timeoutMs = 8000): Promise<any> {
  const id = `req-${Math.random().toString(36).slice(2, 9)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no reply to ${name}`)), timeoutMs);
    const onMsg = (e: MessageEvent) => {
      const m = JSON.parse(e.data as string);
      if (m.message?.id === id && (m.message.result !== undefined || m.message.error !== undefined)) {
        clearTimeout(timer);
        agent.removeEventListener("message", onMsg);
        resolve(m.message);
      }
    };
    agent.addEventListener("message", onMsg);
    agent.send(JSON.stringify({ type: "message", channel, message: { id, command: name, target: "browser", params } }));
  });
}

async function waitUntil(fn: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await delay(50);
  }
  throw new Error("condition not met");
}

beforeAll(async () => {
  port = 38000 + Math.floor(Math.random() * 1000);
  await startRelay();
});
afterAll(() => stopRelay());

describe("browser extension service worker", () => {
  const TAB = { id: 7, url: "https://example.com/pricing", title: "Pricing" };

  it("joins with role browser and answers browser_status", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const { chrome } = fakeChrome(TAB, []);
    const worker = loadWorker(chrome);
    const agent = await connectAgent(channel);
    vm.runInContext(`connect("ws://localhost:${port}", "${channel}")`, worker);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));

    const res = await command(agent, channel, "browser_status");
    expect(res.result).toMatchObject({ extension: "Web-to-Figma", channel, activeTab: { url: TAB.url }, capturable: true });
    const status = (await (await fetch(`http://localhost:${port}/status`)).json()) as { queue: { browserCount: number } };
    expect(status.queue.browserCount).toBeGreaterThanOrEqual(1);
    vm.runInContext("disconnect()", worker);
    agent.close();
  });

  it("runs a capture: injects the extractor, fetches unreadable sheets, returns the capture", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    let captureArgs: any = null;
    const { chrome, executed } = fakeChrome(TAB, [
      () => [], // listUnreadableSheets
      (args) => { captureArgs = args[0]; return CAPTURE; },
    ]);
    const worker = loadWorker(chrome);
    const agent = await connectAgent(channel);
    vm.runInContext(`connect("ws://localhost:${port}", "${channel}")`, worker);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));

    const progress: any[] = [];
    agent.addEventListener("message", (e) => {
      const m = JSON.parse((e as MessageEvent).data as string);
      if (m.type === "progress_update") progress.push(m);
    });
    const res = await command(agent, channel, "browser_capture", { scope: "selector", selector: "#features", maxNodes: 300 });
    expect(res.error).toBeUndefined();
    expect(res.result.schema).toBe("web-to-figma/capture");
    expect(res.result.tab).toEqual({ id: 7, title: "Pricing" });
    expect(executed[0]).toMatchObject({ target: { tabId: 7 }, world: "MAIN", files: ["extractor.js"] });
    expect(captureArgs).toMatchObject({ scope: "selector", selector: "#features", maxNodes: 300, extraSheets: [] });
    // progress reaches the requesting agent, which keeps its timeout alive
    expect(progress.length).toBeGreaterThan(0);
    vm.runInContext("disconnect()", worker);
    agent.close();
  });

  it("lays the page out at an exact width, then restores the tab", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const { chrome } = fakeChrome(TAB, [() => [], () => CAPTURE]);
    const worker = loadWorker(chrome);
    const agent = await connectAgent(channel);
    vm.runInContext(`connect("ws://localhost:${port}", "${channel}")`, worker);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));
    const res = await command(agent, channel, "browser_capture", { width: 1440 }, 15000);
    expect(res.error).toBeUndefined();
    const calls = (chrome as any).debugger.calls.map((c: any[]) => c[0]);
    expect(calls[0]).toBe("attach");
    const metrics = (chrome as any).debugger.calls.find((c: any[]) => c[0] === "Emulation.setDeviceMetricsOverride")[1];
    expect(metrics).toMatchObject({ width: 1440, mobile: false });
    expect(calls).toContain("Emulation.setScrollbarsHidden");
    // the override is cleared and the debugger detached once the capture is done
    expect(calls.slice(-2)).toEqual(["Emulation.clearDeviceMetricsOverride", "detach"]);
    vm.runInContext("disconnect()", worker);
    agent.close();
  }, 20000);

  it("says to close DevTools when the viewport cannot be set", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const { chrome } = fakeChrome(TAB, [() => []]);
    (chrome as any).debugger.failAttach = "Another debugger is already attached to the tab";
    const worker = loadWorker(chrome);
    const agent = await connectAgent(channel);
    vm.runInContext(`connect("ws://localhost:${port}", "${channel}")`, worker);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));
    const res = await command(agent, channel, "browser_capture", { width: 1440 });
    expect(res.error).toMatch(/Could not set the 1440px viewport.*Close DevTools/);
    vm.runInContext("disconnect()", worker);
    agent.close();
  });

  it("refuses pages Chrome does not let extensions read, by name", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const { chrome } = fakeChrome({ id: 8, url: "chrome://settings", title: "Settings" }, []);
    const worker = loadWorker(chrome);
    const agent = await connectAgent(channel);
    vm.runInContext(`connect("ws://localhost:${port}", "${channel}")`, worker);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));
    const res = await command(agent, channel, "browser_capture", {});
    expect(res.error).toContain("chrome://settings");
    vm.runInContext("disconnect()", worker);
    agent.close();
  });

  it("names an unknown command and lists what it implements", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const { chrome } = fakeChrome(TAB, []);
    const worker = loadWorker(chrome);
    const agent = await connectAgent(channel);
    vm.runInContext(`connect("ws://localhost:${port}", "${channel}")`, worker);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));
    const res = await command(agent, channel, "browser_teleport", {});
    expect(res.error).toMatch(/Unknown command "browser_teleport".*browser_capture/);
    vm.runInContext("disconnect()", worker);
    agent.close();
  });

  it("refuses an oversized capture with the size and what to do", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const huge = { ...CAPTURE, styles: [{ pad: "x".repeat(16 * 1024 * 1024) }] };
    const { chrome } = fakeChrome(TAB, [() => [], () => huge]);
    const worker = loadWorker(chrome);
    const agent = await connectAgent(channel);
    vm.runInContext(`connect("ws://localhost:${port}", "${channel}")`, worker);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));
    const res = await command(agent, channel, "browser_capture", {});
    expect(res.error).toMatch(/MB, over the relay's 15 MB message limit.*scope "selector"/);
    vm.runInContext("disconnect()", worker);
    agent.close();
  });

  it("recovers its session after the relay restarts — a command succeeds with nobody rejoining (L11)", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const { chrome } = fakeChrome(TAB, []);
    const worker = loadWorker(chrome);
    vm.runInContext(`connect("ws://localhost:${port}", "${channel}")`, worker);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));

    stopRelay();
    await waitUntil(() => !vm.runInContext("publicState().connected", worker));
    await startRelay();
    // backoff starts at 1 s
    await waitUntil(() => vm.runInContext("publicState().connected", worker), 10000);

    const agent = await connectAgent(channel);
    const res = await command(agent, channel, "browser_status");
    expect(res.result.channel).toBe(channel);
    vm.runInContext("disconnect()", worker);
    agent.close();
  }, 30000);

  it("restores the stored session when the worker itself restarts", async () => {
    const channel = `ch-${Math.random().toString(36).slice(2, 8)}`;
    const { chrome, store } = fakeChrome(TAB, []);
    store.desired = { relay: `ws://localhost:${port}`, channel };
    const worker = loadWorker(chrome);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));
    const agent = await connectAgent(channel);
    const res = await command(agent, channel, "browser_status");
    expect(res.result.channel).toBe(channel);
    vm.runInContext("disconnect()", worker);
    expect(store.desired).toBeNull();
    agent.close();
  });

  it("keeps the watchdog passive against a relay that never answers heartbeats (L12)", async () => {
    // A bare WebSocket server that accepts the join but ignores heartbeats.
    const silent = Bun.serve({
      port: 0,
      fetch(req, server) { return server.upgrade(req) ? undefined : new Response("x"); },
      websocket: {
        message(ws, raw) {
          const m = JSON.parse(String(raw));
          if (m.type === "join") ws.send(JSON.stringify({ type: "system", message: { id: m.id, result: "ok" } }));
        },
      },
    });
    const { chrome } = fakeChrome(TAB, []);
    const worker = loadWorker(chrome);
    vm.runInContext(`connect("ws://localhost:${silent.port}", "c")`, worker);
    await waitUntil(() => vm.runInContext("publicState().connected", worker));
    // Age the last ack far past the watchdog, then let a real heartbeat tick run.
    vm.runInContext("state.lastAck = 0", worker);
    expect(vm.runInContext("state.heartbeatAckSeen", worker)).toBe(false);
    const socketBefore = vm.runInContext("state.socket", worker);
    await delay(16000); // one real heartbeat interval
    expect(vm.runInContext("state.socket", worker)).toBe(socketBefore);
    expect(vm.runInContext("publicState().connected", worker)).toBe(true);
    vm.runInContext("disconnect()", worker);
    silent.stop(true);
  }, 30000);
});
