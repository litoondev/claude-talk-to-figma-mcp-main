/**
 * A selection is an answer, not a question. These cover the two places the
 * bridge used to throw the question back at the user instead of reading the
 * canvas: get_selection returned no context to reason about, and section scope
 * refused anything that was not literally a SECTION — even a card sitting
 * inside one.
 */
import { loadPlugin, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;

/** Link parents so the plugin can walk ancestry the way Figma does. */
function tree(spec: any, parent: any = null): any {
  const node: any = {
    id: spec.id,
    name: spec.name,
    type: spec.type,
    visible: true,
    width: spec.width ?? 100,
    height: spec.height ?? 100,
    parent,
  };
  if (spec.children) {
    node.children = spec.children.map((c: any) => tree(c, node));
  }
  if (spec.type === "TEXT") node.characters = spec.characters ?? "";
  return node;
}

function find(node: any, id: string): any {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return null;
}

/** Component 6: six stacked sections, each holding cards — the reported file. */
function component6() {
  const page = tree({
    id: "0:1",
    name: "Page 1",
    type: "PAGE",
    children: [
      {
        id: "1:1",
        name: "Component 6",
        type: "FRAME",
        children: [
          {
            id: "2:1",
            name: "Section 1 — Blog Single",
            type: "SECTION",
            children: [{ id: "3:1", name: "Post", type: "FRAME" }],
          },
          {
            id: "2:2",
            name: "Section 2 — Work Process",
            type: "SECTION",
            children: [
              { id: "3:2", name: "Card 1", type: "FRAME" },
              { id: "3:3", name: "Card 2", type: "FRAME" },
            ],
          },
        ],
      },
    ],
  });
  page.parent = { type: "DOCUMENT" };
  return page;
}

beforeEach(() => {
  clearNodes();
  const loaded = loadPlugin();
  api = loaded.api;
  figma = loaded.figma;
  const page = component6();
  registerNodes(page);
  figma.currentPage = { id: page.id, name: page.name, selection: [], children: page.children };
  (figma as any)._page = page;
});

const select = (...ids: string[]) => {
  figma.currentPage.selection = ids.map((id) => find((figma as any)._page, id));
};

describe("get_selection", () => {
  it("reports nothing selected as an empty selection, not an error", async () => {
    const result = await api.getSelection();
    expect(result.selectionCount).toBe(0);
    expect(result.selection).toEqual([]);
  });

  it("names the enclosing section when a card inside it is selected", async () => {
    select("3:2");
    const [node] = (await api.getSelection()).selection;

    expect(node.name).toBe("Card 1");
    expect(node.enclosingSection).toEqual({
      id: "2:2",
      name: "Section 2 — Work Process",
    });
  });

  it("treats a selected section as its own enclosing section", async () => {
    select("2:1");
    const [node] = (await api.getSelection()).selection;

    expect(node.enclosingSection).toEqual({ id: "2:1", name: "Section 1 — Blog Single" });
  });

  it("returns the full path so the target can be named back to the user", async () => {
    select("3:3");
    const [node] = (await api.getSelection()).selection;

    expect(node.path).toBe("Page 1 > Component 6 > Section 2 — Work Process");
    expect(node.ancestors.map((a: any) => a.type)).toEqual(["PAGE", "FRAME", "SECTION"]);
  });

  it("leaves enclosingSection null when nothing above the node is a section", async () => {
    select("1:1");
    const [node] = (await api.getSelection()).selection;

    expect(node.enclosingSection).toBeNull();
  });

  it("carries the text of a selected text node so no extra read is needed", async () => {
    const page = (figma as any)._page;
    const text = tree({ id: "3:9", name: "Price", type: "TEXT", characters: "$8.5K" }, page);
    registerNodes(text);
    figma.currentPage.selection = [text];

    const [node] = (await api.getSelection()).selection;
    expect(node.characters).toBe("$8.5K");
  });

  it("describes every node in a multi-node selection", async () => {
    select("3:2", "3:3");
    const result = await api.getSelection();

    expect(result.selectionCount).toBe(2);
    expect(result.selection.map((n: any) => n.enclosingSection.id)).toEqual(["2:2", "2:2"]);
  });
});
