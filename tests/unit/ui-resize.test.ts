/**
 * The plugin panel is user-resizable: a corner handle in ui.html drags, and the
 * main thread is the only side that can change the window, so every drag step
 * arrives as a "resize-ui" message.
 *
 * Two halves are covered here: the main thread's handling of that message
 * (clamping, persistence, failure path), and the UI's drag arithmetic, which is
 * executed out of ui.html against a stub DOM so the test fails if the handler
 * stops posting the size.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { loadPlugin, clearNodes } from "../fixtures/figma-plugin-harness";

const UI_PATH = path.join(__dirname, "../../src/claude_mcp_plugin/ui.html");

let api: any;
let figma: any;
let resizes: Array<[number, number]>;
let stored: Array<[string, any]>;

beforeEach(() => {
  clearNodes();
  const loaded = loadPlugin();
  api = loaded.api;
  figma = loaded.figma;

  resizes = [];
  stored = [];
  figma.ui.resize = (width: number, height: number) => {
    resizes.push([width, height]);
  };
  figma.clientStorage.setAsync = async (key: string, value: any) => {
    stored.push([key, value]);
  };
});

const send = (msg: any) => figma.ui.onmessage(msg);
/** The plugin also stores activity settings on load; only the size matters here. */
const storedSizes = () => stored.filter(([key]) => key === "mcp_ui_size");
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("main thread: resize-ui", () => {
  it("resizes the window to the requested size", async () => {
    await send({ type: "resize-ui", width: 640, height: 700 });
    expect(resizes).toEqual([[640, 700]]);
  });

  it("clamps below the minimum and above the maximum", async () => {
    await send({ type: "resize-ui", width: 10, height: 10 });
    await send({ type: "resize-ui", width: 99999, height: 99999 });
    expect(resizes).toEqual([[320, 320], [2400, 2400]]);
  });

  it("rounds fractional sizes rather than passing them on", async () => {
    await send({ type: "resize-ui", width: 640.6, height: 700.2 });
    expect(resizes).toEqual([[641, 700]]);
  });

  it("ignores a message with an unusable size instead of throwing", async () => {
    await expect(send({ type: "resize-ui", width: "wide", height: null })).resolves.not.toThrow();
    expect(resizes).toEqual([]);
  });

  it("stores the size only on the message that ends the drag", async () => {
    await send({ type: "resize-ui", width: 500, height: 500 });
    await send({ type: "resize-ui", width: 520, height: 540, persist: true });
    await flush();
    expect(storedSizes()).toEqual([["mcp_ui_size", { width: 520, height: 540 }]]);
  });

  it("tells the user when Figma refuses the resize", async () => {
    const notices: string[] = [];
    figma.notify = (message: string) => notices.push(message);
    figma.ui.resize = () => {
      throw new Error("Cannot resize");
    };
    await send({ type: "resize-ui", width: 500, height: 500, persist: true });
    await flush();
    expect(notices.join(" ")).toContain("Cannot resize");
    expect(storedSizes()).toEqual([]);
  });
});

describe("main thread: stored size on open", () => {
  it("re-applies the last size the user dragged to", async () => {
    clearNodes();
    const loaded = loadPlugin();
    const applied: Array<[number, number]> = [];
    loaded.figma.clientStorage.getAsync = async () => ({ width: 900, height: 800 });
    loaded.figma.ui.resize = (w: number, h: number) => applied.push([w, h]);
    await loaded.api.restoreUiSize();
    expect(applied).toEqual([[900, 800]]);
  });

  it("opens at the default size when nothing is stored", async () => {
    await api.restoreUiSize();
    expect(resizes).toEqual([]);
  });

  it("survives a storage read that fails", async () => {
    figma.clientStorage.getAsync = async () => {
      throw new Error("storage unavailable");
    };
    await expect(api.restoreUiSize()).resolves.toBeUndefined();
    expect(resizes).toEqual([]);
  });
});

/**
 * Run the drag methods straight out of ui.html. The class there needs a full
 * document, so the three resize methods are lifted onto a stub that carries
 * only what they touch.
 */
function loadDragMethods() {
  const html = fs.readFileSync(UI_PATH, "utf8");
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!script) throw new Error("no <script> block in ui.html");

  const names = ["startResize", "doResize", "stopResize", "sendResize"];
  const sources = names.map((name) => {
    const marker = `\n      ${name}(`;
    const at = script[1].indexOf(marker);
    if (at === -1) throw new Error(`${name} not found in ui.html`);
    const from = at + 1 + "      ".length;
    // Walk braces from the method's opening brace to its closing one; the
    // slice keeps the parameter list, so the method arrives intact.
    let depth = 0;
    let i = script[1].indexOf("{", at);
    for (; i < script[1].length; i++) {
      if (script[1][i] === "{") depth++;
      else if (script[1][i] === "}" && --depth === 0) break;
    }
    return `${name}: function ${script[1].slice(from, i + 1)}`;
  });

  return vm.runInNewContext(`({ ${sources.join(",\n")} })`, {});
}

describe("ui: corner drag", () => {
  const messages: any[] = [];

  function stub(width = 360, height = 520) {
    const classList = () => {
      const set = new Set<string>();
      return { add: (c: string) => set.add(c), remove: (c: string) => set.delete(c), has: (c: string) => set.has(c) };
    };
    const listeners: Record<string, Function[]> = {};
    const ctx: any = {
      ...loadDragMethods(),
      resizeState: {
        isResizing: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        startWidth: 0,
        startHeight: 0,
        width: 0,
        height: 0,
        minWidth: 320,
        minHeight: 320,
        maxWidth: 2400,
        maxHeight: 2400,
      },
      ui: {
        resizeHandle: {
          classList: classList(),
          setPointerCapture: () => undefined,
          releasePointerCapture: () => undefined,
        },
      },
      window: {
        innerWidth: width,
        innerHeight: height,
        addEventListener: (type: string, fn: Function) => (listeners[type] = [...(listeners[type] ?? []), fn]),
        removeEventListener: (type: string, fn: Function) => {
          listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
        },
      },
      document: { body: { classList: classList() } },
      parent: { postMessage: (msg: any) => messages.push(msg.pluginMessage) },
      listeners,
    };
    // The methods read `window`, `document` and `parent` as globals.
    for (const name of ["startResize", "doResize", "stopResize", "sendResize"]) {
      ctx[name] = new Function(
        "window",
        "document",
        "parent",
        `return (${ctx[name].toString()})`
      )(ctx.window, ctx.document, ctx.parent).bind(ctx);
    }
    return ctx;
  }

  beforeEach(() => {
    messages.length = 0;
  });

  it("turns a drag into the new window size", () => {
    const c = stub(360, 520);
    c.startResize({ preventDefault() {}, pointerId: 1, screenX: 100, screenY: 100 });
    c.doResize({ screenX: 240, screenY: 180 });
    expect(messages).toEqual([{ type: "resize-ui", width: 500, height: 600, persist: false }]);
  });

  it("clamps at the minimum while dragging inwards", () => {
    const c = stub(360, 520);
    c.startResize({ preventDefault() {}, pointerId: 1, screenX: 100, screenY: 100 });
    c.doResize({ screenX: -400, screenY: -400 });
    expect(messages).toEqual([{ type: "resize-ui", width: 320, height: 320, persist: false }]);
  });

  it("does not post a message when the size has not changed", () => {
    const c = stub(360, 520);
    c.startResize({ preventDefault() {}, pointerId: 1, screenX: 100, screenY: 100 });
    c.doResize({ screenX: 100, screenY: 100 });
    expect(messages).toEqual([]);
  });

  it("marks only the end of the drag for persistence, and releases", () => {
    const c = stub(360, 520);
    c.startResize({ preventDefault() {}, pointerId: 1, screenX: 100, screenY: 100 });
    c.doResize({ screenX: 200, screenY: 200 });
    c.stopResize();
    expect(messages.map((m) => m.persist)).toEqual([false, true]);
    expect(messages[messages.length - 1]).toEqual({ type: "resize-ui", width: 460, height: 620, persist: true });
    expect(c.resizeState.isResizing).toBe(false);
    expect(c.listeners.pointermove).toEqual([]);
    expect(c.document.body.classList.has("is-resizing")).toBe(false);
  });

  it("ignores pointer moves that arrive after the drag ended", () => {
    const c = stub(360, 520);
    c.startResize({ preventDefault() {}, pointerId: 1, screenX: 100, screenY: 100 });
    c.stopResize();
    messages.length = 0;
    c.doResize({ screenX: 900, screenY: 900 });
    expect(messages).toEqual([]);
  });

  it("keeps listening while the pointer is outside the iframe", () => {
    const c = stub(360, 520);
    c.startResize({ preventDefault() {}, pointerId: 1, screenX: 100, screenY: 100 });
    // Negative client coordinates mean the cursor left the frame; the drag uses
    // screen coordinates, so it still tracks.
    c.doResize({ screenX: 700, screenY: 90, clientX: -50, clientY: -50 });
    expect(messages[0]).toEqual({ type: "resize-ui", width: 960, height: 510, persist: false });
  });
});
