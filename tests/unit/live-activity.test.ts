/**
 * The bridge is meant to be watchable: as it edits, the canvas should show
 * where the work is happening. All three surfaces existed but shipped switched
 * off, and long commands reported nothing between "started" and "completed",
 * so the canvas sat still while the agent worked.
 */
import { loadPlugin, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;

/**
 * `activity` is a top-level `const`, which a VM script does not expose on its
 * context — read and write it through the accessor the plugin already uses for
 * the get_activity_state command.
 */
const settings = () => api.getActivityStateCommand().settings;

/** reportActivityStep is deliberately fire-and-forget; let its work settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function sceneNode(id: string, box: any = { x: 0, y: 0, width: 100, height: 100 }) {
  const node: any = {
    id,
    name: `Node ${id}`,
    type: "FRAME",
    removed: false,
    absoluteBoundingBox: box,
    getPluginData: () => "",
    setPluginData: () => undefined,
  };
  return node;
}

/** Put nodes on the current page so highlightNodes accepts them. */
function onPage(...nodes: any[]) {
  const page = { id: "0:1", name: "Page 1", type: "PAGE", selection: [], children: nodes };
  nodes.forEach((n) => (n.parent = page));
  figma.currentPage = page;
  registerNodes(...nodes);
  return page;
}

beforeEach(() => {
  clearNodes();
  const loaded = loadPlugin();
  api = loaded.api;
  figma = loaded.figma;
  figma.viewport = {
    bounds: { x: 0, y: 0, width: 1000, height: 1000 },
    scrollAndZoomIntoView: jest.fn(),
  };
});

describe("activity defaults", () => {
  it("shows the work without the user having to switch anything on", () => {
    // The overlay is the one surface that persists in the document, so it stays
    // opt-in; everything ephemeral is on.
    expect(settings().highlightEnabled).toBe(true);
    expect(settings().cursorEnabled).toBe(true);
    expect(settings().followViewport).toBe(true);
    expect(settings().overlayEnabled).toBe(false);
  });
});

describe("highlightNodes", () => {
  it("selects the nodes being worked on", async () => {
    const a = sceneNode("1:1");
    onPage(a);

    await api.highlightNodes(["1:1"]);

    expect(figma.currentPage.selection.map((n: any) => n.id)).toEqual(["1:1"]);
  });

  it("scrolls to work that is off-screen", async () => {
    const far = sceneNode("1:2", { x: 8000, y: 8000, width: 100, height: 100 });
    onPage(far);

    await api.highlightNodes(["1:2"]);

    expect(figma.viewport.scrollAndZoomIntoView).toHaveBeenCalled();
  });

  it("leaves the canvas alone when the target is already visible", async () => {
    const near = sceneNode("1:3", { x: 10, y: 10, width: 50, height: 50 });
    onPage(near);

    await api.highlightNodes(["1:3"]);

    expect(figma.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled();
    expect(figma.currentPage.selection.map((n: any) => n.id)).toEqual(["1:3"]);
  });

  it("does not let a slow earlier highlight overwrite a newer one", async () => {
    const first = sceneNode("1:4");
    const second = sceneNode("1:5");
    onPage(first, second);

    const slow = api.highlightNodes(["1:4"]);
    const fast = api.highlightNodes(["1:5"]);
    await Promise.all([slow, fast]);

    // The most recent request wins regardless of which lookup resolved first.
    expect(figma.currentPage.selection.map((n: any) => n.id)).toEqual(["1:5"]);
  });

  it("stays silent when highlighting is turned off", async () => {
    const a = sceneNode("1:6");
    onPage(a);
    settings().highlightEnabled = false;

    await api.highlightNodes(["1:6"]);

    expect(figma.currentPage.selection).toEqual([]);
  });
});

describe("reportActivityStep", () => {
  it("moves the selection mid-command so a long run is visibly progressing", async () => {
    const a = sceneNode("1:7");
    const b = sceneNode("1:8");
    onPage(a, b);

    api.reportActivityStep("1:7", "Updating text");
    await flush();

    expect(figma.currentPage.selection.map((n: any) => n.id)).toEqual(["1:7"]);
  });

  it("ignores empty or malformed ids rather than clearing the selection", async () => {
    const a = sceneNode("1:9");
    onPage(a);
    figma.currentPage.selection = [a];

    api.reportActivityStep([undefined, "", null]);
    await flush();

    expect(figma.currentPage.selection).toEqual([a]);
  });
});
