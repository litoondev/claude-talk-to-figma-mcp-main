/**
 * The ghost cursor is created lazily on the first move. Every command fires at
 * least two moves ("started" and "completed"), and a chunked command fires one
 * per item — all concurrent, all fire-and-forget. Creation therefore has to be
 * single-flight, or the first burst of work leaves a pile of cursor frames at
 * the origin, each animation clearing the previous one's interval.
 */
import { loadPlugin, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;

/** Minimal node factory covering what the cursor builds and moves. */
function makeStub(type: string): any {
  const node: any = {
    id: `${type}:${Math.random().toString(36).slice(2, 8)}`,
    type,
    name: "",
    removed: false,
    x: 0,
    y: 0,
    locked: false,
    children: [] as any[],
    fills: [],
    pluginData: {} as Record<string, string>,
    setPluginData(key: string, value: string) {
      this.pluginData[key] = value;
    },
    getPluginData(key: string) {
      return this.pluginData[key] ?? "";
    },
    resize() {},
    appendChild(child: any) {
      child.parent = this;
      this.children.push(child);
    },
    findOne(predicate: (n: any) => boolean): any {
      for (const c of this.children) {
        if (predicate(c)) return c;
        const hit = c.findOne?.(predicate);
        if (hit) return hit;
      }
      return null;
    },
    remove() {
      this.removed = true;
      const siblings = this.parent?.children;
      if (siblings) siblings.splice(siblings.indexOf(this), 1);
    },
  };
  if (type === "TEXT") node.characters = "";
  return node;
}

beforeEach(() => {
  clearNodes();
  const loaded = loadPlugin();
  api = loaded.api;
  figma = loaded.figma;

  const page: any = { id: "0:1", name: "Page 1", type: "PAGE", selection: [], children: [] };
  figma.currentPage = page;

  const adopt = (node: any) => {
    node.parent = page;
    page.children.push(node);
    return node;
  };

  figma.loadFontAsync = async () => undefined;
  figma.createFrame = () => adopt(makeStub("FRAME"));
  figma.createText = () => adopt(makeStub("TEXT"));
  figma.createNodeFromSvg = () => makeStub("FRAME");
  figma.viewport = { bounds: { x: 0, y: 0, width: 1000, height: 1000 }, scrollAndZoomIntoView: () => {} };
});

// The cursor schedules an idle-relabel timer and a movement interval; clear
// them so they cannot outlive the test that started them.
afterEach(() => {
  try { api.removeCursorNode(); } catch (e) { /* nothing created */ }
});

const cursors = () =>
  figma.currentPage.children.filter(
    (c: any) => !c.removed && c.getPluginData("claudeActivityCursor") === "1"
  );

describe("stored settings", () => {
  it("does not let settings saved under the old defaults switch the cursor off", async () => {
    const store: Record<string, any> = {
      // What an existing user has on disk from before the defaults changed.
      activitySettings: {
        cursorEnabled: false,
        followViewport: false,
        highlightEnabled: true,
        overlayEnabled: false,
        cursorLabel: "AI Designer",
      },
    };
    figma.clientStorage = {
      getAsync: async (k: string) => store[k],
      setAsync: async (k: string, v: any) => {
        store[k] = v;
      },
    };

    await api.loadActivitySettings();
    const s = api.getActivityStateCommand().settings;

    expect(s.cursorEnabled).toBe(true);
    expect(s.followViewport).toBe(true);
    // Choices that were never defaulted differently survive the migration.
    expect(s.cursorLabel).toBe("AI Designer");
    expect(s.overlayEnabled).toBe(false);
  });

  it("respects a deliberate opt-out saved under the current version", async () => {
    const store: Record<string, any> = {
      activitySettings: { cursorEnabled: false, followViewport: true, highlightEnabled: true },
      activitySettingsVersion: 2,
    };
    figma.clientStorage = {
      getAsync: async (k: string) => store[k],
      setAsync: async (k: string, v: any) => {
        store[k] = v;
      },
    };

    await api.loadActivitySettings();

    expect(api.getActivityStateCommand().settings.cursorEnabled).toBe(false);
  });
});

describe("ghost cursor", () => {
  it("creates exactly one cursor when moves arrive concurrently", async () => {
    // "started" and "completed" for the same command, plus per-item steps.
    await Promise.all([
      api.moveCursorToNode([], "Setting text"),
      api.moveCursorToNode([], "Setting text"),
      api.moveCursorToNode([], null),
    ]);

    expect(cursors()).toHaveLength(1);
  });

  it("reuses the existing cursor on later moves", async () => {
    await api.moveCursorToNode([], "First");
    const first = cursors()[0];

    await api.moveCursorToNode([], "Second");

    expect(cursors()).toHaveLength(1);
    expect(cursors()[0]).toBe(first);
  });

  it("does not chase a target the agent has already moved on from", async () => {
    const slow = makeStub("FRAME");
    slow.absoluteBoundingBox = { x: 500, y: 500, width: 100, height: 100 };
    const recent = makeStub("FRAME");
    recent.absoluteBoundingBox = { x: 40, y: 40, width: 100, height: 100 };
    figma.getNodeByIdAsync = async (id: string) => (id === "slow" ? slow : recent);

    await Promise.all([
      api.moveCursorToNode(["slow"], null),
      api.moveCursorToNode(["recent"], null),
    ]);

    // The stale move must not drag the cursor back to the earlier element.
    expect(cursors()[0].x).not.toBe(500 + 24);
  });

  it("removes every cursor it finds, not just the first", async () => {
    await api.moveCursorToNode([], "Working");
    // Simulate strays left in the file by an older build.
    const stray = makeStub("FRAME");
    stray.setPluginData("claudeActivityCursor", "1");
    stray.parent = figma.currentPage;
    figma.currentPage.children.push(stray);

    api.removeCursorNode();

    expect(cursors()).toHaveLength(0);
  });
});
