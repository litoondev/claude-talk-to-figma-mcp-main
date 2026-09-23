/**
 * Foreign (remote) style and variable bindings.
 *
 * A Figma file lists a source file in its style picker for as long as anything
 * in the document references a style that file owns — subscription has nothing
 * to do with it. `audit_remote_styles` finds those references and
 * `rebind_remote_styles` repoints them at local equivalents.
 *
 * The names below are taken from the file this was written for (Jones
 * Orthodontics, ZL9YKbj5WfHUakX1Md3OYg) and the library whose styles show up in
 * it: "Desk/H2 Desk" and "Mobi/H2 Mobi" are real style names read from HIP
 * Master Component over REST, "Text Color/H2" and "colors/Gray/800" are real
 * variable names read off node 14834:142509. Ledger L3: a fixture models the
 * real file, not what the implementation already handles. What is NOT modelled
 * here is a live probe of the node tree — see the QA report.
 */
import { loadPlugin, makeNode, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;

/** Two remote text styles from HIP Master Component, and the local twin of one. */
const STYLES = [
  { id: "S:remote-h2-desk", key: "ed237eb633c0a128848ad90c4271575d6cc071e1", name: "Desk/H2 Desk", type: "TEXT" as const, remote: true },
  { id: "S:remote-h2-mobi", key: "813775c264809f6a53a6c4161adbebd670d36cce", name: "Mobi/H2 Mobi", type: "TEXT" as const, remote: true },
  { id: "S:remote-brand", key: "aa11bb22cc33", name: "Brand/Primary", type: "PAINT" as const, remote: true },
  { id: "S:local-h2-desk", key: "local-1", name: "H2 Desk", type: "TEXT" as const },
  { id: "S:local-brand", key: "local-2", name: "Brand/Primary", type: "PAINT" as const },
];

const COLLECTIONS = [{ id: "VC:1", name: "Tokens", modes: [{ modeId: "m1", name: "Desk" }], variableIds: ["V:local-gray"] }];
const VARIABLES = [
  { id: "V:local-gray", key: "lv1", name: "colors/Gray/800", resolvedType: "COLOR", valuesByMode: {} },
  { id: "V:remote-gray", key: "rv1", name: "colors/Gray/800", resolvedType: "COLOR", valuesByMode: {}, remote: true },
  { id: "V:remote-h2", key: "rv2", name: "Text Color/H2", resolvedType: "COLOR", valuesByMode: {}, remote: true },
];

function load() {
  clearNodes();
  ({ api, figma } = loadPlugin({ styles: STYLES as any, collections: COLLECTIONS as any, variables: VARIABLES as any }));
}

beforeEach(load);

/** Register a subtree and return the root, so `nodeId: "root"` resolves. */
function root(children: any[], spec: any = {}) {
  const node = makeNode({ id: "root", name: "Work Process", children, ...spec });
  const all: any[] = [];
  const walk = (n: any) => {
    all.push(n);
    (n.children ?? []).forEach((child: any) => {
      child.parent = n;
      walk(child);
    });
  };
  walk(node);
  registerNodes(...all);
  return node;
}

const audit = (extra: any = {}) => api.auditRemoteStylesCommand({ nodeId: "root", ...extra });
const rebind = (extra: any = {}) => api.rebindRemoteStylesCommand({ nodeId: "root", ...extra });

describe("audit_remote_styles", () => {
  it("reports an all-local subtree as clean rather than failing", async () => {
    root([makeNode({ id: "t1", name: "Heading", type: "TEXT", textStyleId: "S:local-h2-desk" })]);

    const r = await audit();

    expect(r.remoteStyleCount).toBe(0);
    expect(r.remoteVariableCount).toBe(0);
    expect(r.totalBindings).toBe(0);
    expect(r.styles).toEqual([]);
  });

  it("names the node, the property and the style key for each foreign binding", async () => {
    root([makeNode({ id: "t1", name: "Heading", type: "TEXT", textStyleId: "S:remote-h2-desk" })]);

    const r = await audit();

    expect(r.remoteStyleCount).toBe(1);
    expect(r.styles[0]).toMatchObject({
      name: "Desk/H2 Desk",
      key: "ed237eb633c0a128848ad90c4271575d6cc071e1",
      usages: 1,
    });
    expect(r.bindings[0]).toMatchObject({
      nodeId: "t1",
      nodeName: "Heading",
      property: "textStyleId",
      kind: "style",
      targetName: "Desk/H2 Desk",
    });
  });

  it("reports each segment of mixed text styling instead of skipping the node", async () => {
    root([
      makeNode({
        id: "t1",
        name: "Paragraph",
        type: "TEXT",
        characters: "Straighter smiles",
        textStyleId: figma.mixed,
        styledTextSegments: [
          { start: 0, end: 10, textStyleId: "S:remote-h2-desk" },
          { start: 10, end: 17, textStyleId: "S:remote-h2-mobi" },
        ],
      }),
    ]);

    const r = await audit();

    expect(r.remoteStyleCount).toBe(2);
    expect(r.bindings.map((b: any) => b.targetName).sort()).toEqual(["Desk/H2 Desk", "Mobi/H2 Mobi"]);
    expect(r.bindings.every((b: any) => b.range)).toBe(true);
  });

  it("flags a binding inside a component instance rather than dropping it", async () => {
    root([
      makeNode({
        id: "i1",
        name: "Card",
        type: "INSTANCE",
        children: [makeNode({ id: "t1", name: "Title", type: "TEXT", textStyleId: "S:remote-h2-desk" })],
      }),
    ]);

    const r = await audit();

    expect(r.totalBindings).toBe(1);
    expect(r.bindings[0].insideInstance).toBe(true);
    expect(r.styles[0].insideInstance).toBe(1);
  });

  it("finds a foreign variable bound on a node field and on a paint", async () => {
    root([
      makeNode({ id: "f1", name: "Wrapper", boundVariables: { itemSpacing: { type: "VARIABLE_ALIAS", id: "V:remote-h2" } } }),
      makeNode({
        id: "f2",
        name: "Card",
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, boundVariables: { color: { type: "VARIABLE_ALIAS", id: "V:remote-gray" } } }],
      }),
    ]);

    const r = await audit();

    expect(r.remoteVariableCount).toBe(2);
    expect(r.bindings.map((b: any) => b.property).sort()).toEqual(["fills[0].color", "itemSpacing"]);
  });

  it("does not report a variable that is local to this file", async () => {
    root([makeNode({ id: "f1", name: "Wrapper", boundVariables: { itemSpacing: { type: "VARIABLE_ALIAS", id: "V:local-gray" } } })]);

    const r = await audit();

    expect(r.remoteVariableCount).toBe(0);
  });
});

describe("rebind_remote_styles", () => {
  it("changes nothing unless dryRun is explicitly false", async () => {
    const tree = root([makeNode({ id: "t1", name: "Heading", type: "TEXT", textStyleId: "S:remote-h2-desk" })]);

    const r = await rebind();

    expect(r.dryRun).toBe(true);
    expect(r.wouldRebind).toBe(1);
    expect(r.mapping[0]).toMatchObject({ from: "Desk/H2 Desk", to: "H2 Desk", matchedBy: "leaf", count: 1 });
    expect(tree.children[0].textStyleId).toBe("S:remote-h2-desk");
  });

  it("repoints the binding at the local style when applied", async () => {
    const tree = root([makeNode({ id: "t1", name: "Heading", type: "TEXT", textStyleId: "S:remote-h2-desk" })]);

    const r = await rebind({ dryRun: false });

    expect(r.rebound).toBe(1);
    expect(r.errors).toEqual([]);
    expect(tree.children[0].textStyleId).toBe("S:local-h2-desk");
  });

  it("matches an exact full-path name under matchBy:'name', and refuses a leaf-only twin", async () => {
    const tree = root([
      makeNode({ id: "r1", name: "BG", fillStyleId: "S:remote-brand" }),
      makeNode({ id: "t1", name: "Heading", type: "TEXT", textStyleId: "S:remote-h2-desk" }),
    ]);

    const r = await rebind({ dryRun: false, matchBy: "name" });

    // "Brand/Primary" exists locally under the same full path; "Desk/H2 Desk" does not.
    expect(tree.children[0].fillStyleId).toBe("S:local-brand");
    expect(tree.children[1].textStyleId).toBe("S:remote-h2-desk");
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0].reason).toContain('no local style is named "Desk/H2 Desk"');
  });

  it("leaves a style with no local equivalent alone, and never creates one", async () => {
    const tree = root([makeNode({ id: "t1", name: "Sub", type: "TEXT", textStyleId: "S:remote-h2-mobi" })]);
    const before = (await figma.getLocalTextStylesAsync()).length;

    const r = await rebind({ dryRun: false });

    expect(r.rebound).toBe(0);
    expect(r.unmatched[0]).toMatchObject({ nodeId: "t1", targetName: "Mobi/H2 Mobi" });
    expect(r.unmatched[0].reason).toContain("no local style");
    expect(tree.children[0].textStyleId).toBe("S:remote-h2-mobi");
    expect((await figma.getLocalTextStylesAsync()).length).toBe(before);
  });

  it("refuses to touch a binding inside an instance and says why", async () => {
    root([
      makeNode({
        id: "i1",
        name: "Card",
        type: "INSTANCE",
        children: [makeNode({ id: "t1", name: "Title", type: "TEXT", textStyleId: "S:remote-h2-desk" })],
      }),
    ]);

    const r = await rebind({ dryRun: false });

    expect(r.rebound).toBe(0);
    expect(r.unmatched[0].reason).toContain("component instance");
  });

  it("names the style that failed rather than reporting undefined (ledger L6)", async () => {
    const tree = root([makeNode({ id: "t1", name: "Heading", type: "TEXT", textStyleId: "S:remote-h2-desk" })]);
    // Figma rejects some promises with no Error object at all.
    tree.children[0].setTextStyleIdAsync = () => Promise.reject(undefined);

    const r = await rebind({ dryRun: false });

    expect(r.rebound).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ nodeId: "t1", nodeName: "Heading", targetName: "Desk/H2 Desk" });
    expect(r.errors[0].reason).toBe("undefined");
  });

  it("reports a per-range binding as unsupported instead of silently rebinding the whole node", async () => {
    root([
      makeNode({
        id: "t1",
        name: "Paragraph",
        type: "TEXT",
        characters: "Straighter smiles",
        textStyleId: figma.mixed,
        styledTextSegments: [{ start: 0, end: 17, textStyleId: "S:remote-h2-desk" }],
      }),
    ]);

    const r = await rebind({ dryRun: false });

    expect(r.rebound).toBe(0);
    expect(r.errors[0].reason).toContain("per text range");
  });
});
