/**
 * Load the Figma plugin's code.js into a sandbox with a mocked `figma` global.
 *
 * The plugin is a plain script, not a module — it has no exports. Running it in
 * a VM context makes its top-level function declarations reachable as
 * properties of that context, which is the only way to unit test it without
 * restructuring the plugin around a bundler it does not currently use.
 */
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

export const PLUGIN_PATH = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "claude_mcp_plugin",
  "code.js"
);

export type MockVariable = {
  id: string;
  name: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  scopes: string[];
  variableCollectionId: string;
  valuesByMode: Record<string, unknown>;
  hiddenFromPublishing?: boolean;
  codeSyntax?: Record<string, string>;
};

export type MockCollection = {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  variableIds: string[];
};

export interface MockFigmaOptions {
  collections?: MockCollection[];
  variables?: MockVariable[];
  nodes?: any[];
}

/**
 * Build a scene node close enough to Figma's to exercise sizing and binding.
 *
 * `layoutSizingVertical` is modelled as an accessor that throws when the node
 * has neither auto layout of its own nor an auto layout parent, because that is
 * what the real API does — and the plugin's tolerance of that throw is one of
 * the things worth testing.
 */
export function makeNode(spec: any = {}): any {
  const node: any = {
    id: spec.id ?? `n:${Math.random().toString(36).slice(2, 9)}`,
    name: spec.name ?? "Frame",
    type: spec.type ?? "FRAME",
    removed: false,
    visible: spec.visible !== false,
    width: spec.width ?? 100,
    height: spec.height ?? 100,
    x: spec.x ?? 0,
    y: spec.y ?? 0,
    parent: null,
    children: [],
    layoutMode: spec.layoutMode ?? "NONE",
    layoutPositioning: spec.layoutPositioning ?? "AUTO",
    layoutWrap: spec.layoutWrap ?? "NO_WRAP",
    primaryAxisSizingMode: spec.primaryAxisSizingMode ?? "AUTO",
    counterAxisSizingMode: spec.counterAxisSizingMode ?? "AUTO",
    itemSpacing: spec.itemSpacing ?? 0,
    paddingTop: spec.paddingTop ?? 0,
    paddingRight: spec.paddingRight ?? 0,
    paddingBottom: spec.paddingBottom ?? 0,
    paddingLeft: spec.paddingLeft ?? 0,
    fills: spec.fills ?? [],
    strokes: spec.strokes ?? [],
    effects: spec.effects ?? [],
    boundVariables: spec.boundVariables ?? {},
    explicitVariableModes: { ...(spec.explicitVariableModes ?? {}) },
    resolvedVariableModes: { ...(spec.resolvedVariableModes ?? spec.explicitVariableModes ?? {}) },
    getPluginData: () => "",
    resize(w: number, h: number) {
      this.width = w;
      this.height = h;
      // Matches Figma: a literal resize pins the axis it touches.
      if (this.layoutMode === "VERTICAL") this.primaryAxisSizingMode = "FIXED";
      else if (this.layoutMode === "HORIZONTAL") this.counterAxisSizingMode = "FIXED";
      this._verticalSizing = "FIXED";
    },
    setBoundVariable(field: string, variable: any) {
      this.boundVariables = {
        ...this.boundVariables,
        [field]: { type: "VARIABLE_ALIAS", id: variable.id },
      };
    },
    setExplicitVariableModeForCollection(collection: any, modeId: string) {
      this.explicitVariableModes = {
        ...this.explicitVariableModes,
        [collection.id]: modeId,
      };
    },
    appendChild(child: any) {
      if (child.parent?.children) {
        const oldIndex = child.parent.children.indexOf(child);
        if (oldIndex >= 0) child.parent.children.splice(oldIndex, 1);
      }
      this.children.push(child);
      child.parent = this;
    },
    insertChild(index: number, child: any) {
      if (child.parent?.children) {
        const oldIndex = child.parent.children.indexOf(child);
        if (oldIndex >= 0) {
          child.parent.children.splice(oldIndex, 1);
          if (child.parent === this && oldIndex < index) index--;
        }
      }
      this.children.splice(index, 0, child);
      child.parent = this;
    },
    remove() {
      if (this.parent?.children) {
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
      }
      this.parent = null;
      this.removed = true;
    },
    clone() {
      const subtree: any[] = [];
      const collect = (current: any) => {
        subtree.push(current);
        for (const child of current.children ?? []) collect(child);
      };
      collect(this);
      const originalParents = new Map(subtree.map((current) => [current, current.parent]));
      for (const current of subtree) current.parent = null;

      let copy: any;
      try {
        copy = makeNode({
        name: this.name,
        type: this.type,
        visible: this.visible,
        width: this.width,
        height: this.height,
        x: this.x,
        y: this.y,
        layoutMode: this.layoutMode,
        layoutPositioning: this.layoutPositioning,
        layoutWrap: this.layoutWrap,
        primaryAxisSizingMode: this.primaryAxisSizingMode,
        counterAxisSizingMode: this.counterAxisSizingMode,
        layoutSizingVertical: this._verticalSizing,
        layoutSizingHorizontal: this._horizontalSizing,
        itemSpacing: this.itemSpacing,
        paddingTop: this.paddingTop,
        paddingRight: this.paddingRight,
        paddingBottom: this.paddingBottom,
        paddingLeft: this.paddingLeft,
        fills: this.fills,
        strokes: this.strokes,
        effects: this.effects,
        boundVariables: { ...this.boundVariables },
        explicitVariableModes: { ...this.explicitVariableModes },
        resolvedVariableModes: { ...this.resolvedVariableModes },
        textAutoResize: this.textAutoResize,
        textStyleId: this.textStyleId,
        fontSize: this.fontSize,
          children: (this.children ?? []).map((child: any) => child.clone()),
        });
      } finally {
        for (const current of subtree) current.parent = originalParents.get(current);
      }

      const originalParent = originalParents.get(this);
      if (originalParent?.insertChild) {
        originalParent.insertChild(originalParent.children.indexOf(this) + 1, copy);
      }
      return copy;
    },
  };

  if (spec.type === "TEXT") {
    node.textAutoResize = spec.textAutoResize ?? "NONE";
    node.textStyleId = spec.textStyleId ?? "";
    node.fontSize = spec.fontSize ?? 16;
    delete node.children;
  }

  if (spec.minHeight !== undefined) node.minHeight = spec.minHeight;
  if (spec.maxHeight !== undefined) node.maxHeight = spec.maxHeight;
  if (spec.maxWidth !== undefined) node.maxWidth = spec.maxWidth;

  node._verticalSizing = spec.layoutSizingVertical ?? null;
  node._horizontalSizing = spec.layoutSizingHorizontal ?? null;

  const hasLayoutAxis = () =>
    (node.layoutMode && node.layoutMode !== "NONE") ||
    (node.parent && node.parent.layoutMode && node.parent.layoutMode !== "NONE");

  Object.defineProperty(node, "layoutSizingVertical", {
    enumerable: false,
    configurable: true,
    get() {
      if (!hasLayoutAxis()) throw new Error("layoutSizingVertical unavailable");
      if (node._verticalSizing) return node._verticalSizing;
      if (node.layoutMode === "VERTICAL") {
        return node.primaryAxisSizingMode === "AUTO" ? "HUG" : "FIXED";
      }
      if (node.layoutMode === "HORIZONTAL") {
        return node.counterAxisSizingMode === "AUTO" ? "HUG" : "FIXED";
      }
      return "FIXED";
    },
    set(value) {
      if (!hasLayoutAxis()) throw new Error("layoutSizingVertical unavailable");
      node._verticalSizing = value;
      if (value === "HUG") {
        if (node.layoutMode === "VERTICAL") node.primaryAxisSizingMode = "AUTO";
        if (node.layoutMode === "HORIZONTAL") node.counterAxisSizingMode = "AUTO";
      }
    },
  });

  Object.defineProperty(node, "layoutSizingHorizontal", {
    enumerable: false,
    configurable: true,
    get() {
      if (!hasLayoutAxis()) throw new Error("layoutSizingHorizontal unavailable");
      return node._horizontalSizing ?? "FIXED";
    },
    set(value) {
      if (!hasLayoutAxis()) throw new Error("layoutSizingHorizontal unavailable");
      node._horizontalSizing = value;
    },
  });

  for (const child of spec.children ?? []) {
    child.parent = node;
    node.children.push(child);
  }

  return node;
}

/** Registry the mock's getNodeByIdAsync reads from. */
const nodeRegistry = new Map<string, any>();

export function registerNodes(...nodes: any[]) {
  const walk = (n: any) => {
    if (!n) return;
    nodeRegistry.set(n.id, n);
    for (const c of n.children ?? []) walk(c);
  };
  nodes.forEach(walk);
}

export function clearNodes() {
  nodeRegistry.clear();
}

/** The `figma` surface the plugin touches, enough to execute it. */
export function createMockFigma(options: MockFigmaOptions = {}) {
  const collections = options.collections ?? [];
  const variables = options.variables ?? [];
  const byId = new Map(variables.map((v) => [v.id, v]));

  const mixed = Symbol("figma.mixed");

  return {
    mixed,
    showUI: () => undefined,
    ui: { onmessage: null as unknown, postMessage: () => undefined },
    on: () => undefined,
    notify: () => undefined,
    currentPage: { selection: [], children: [] },
    root: { children: [] },
    clientStorage: {
      getAsync: async () => undefined,
      setAsync: async () => undefined,
    },
    getNodeByIdAsync: async (id: string) => nodeRegistry.get(id) ?? null,
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableCollectionByIdAsync: async (id: string) =>
        collections.find((c) => c.id === id) ?? null,
      getVariableByIdAsync: async (id: string) => {
        const v = byId.get(id);
        if (!v) return null;
        if (typeof (v as any).setValueForMode !== "function") {
          (v as any).setValueForMode = function (modeId: string, val: unknown) {
            this.valuesByMode = this.valuesByMode || {};
            this.valuesByMode[modeId] = val;
          };
        }
        return v;
      },
      setBoundVariableForPaint: (paint: any, field: string, variable: MockVariable) => ({
        ...paint,
        boundVariables: {
          ...(paint.boundVariables ?? {}),
          [field]: { type: "VARIABLE_ALIAS", id: variable.id },
        },
      }),
      setBoundVariableForEffect: (effect: any, field: string, variable: MockVariable) => ({
        ...effect,
        boundVariables: {
          ...(effect.boundVariables ?? {}),
          [field]: { type: "VARIABLE_ALIAS", id: variable.id },
        },
      }),
      createVariable: () => {
        throw new Error("createVariable should not be reached in these tests");
      },
      createVariableCollection: () => {
        throw new Error("createVariableCollection should not be reached in these tests");
      },
    },
  };
}

/**
 * Evaluate the plugin in a fresh context and hand back both the context (whose
 * properties are the plugin's top-level functions) and the mock it ran against.
 */
export function loadPlugin(options: MockFigmaOptions = {}) {
  const source = fs.readFileSync(PLUGIN_PATH, "utf8");
  const figma = createMockFigma(options);

  const sandbox: Record<string, unknown> = {
    figma,
    __html__: "<html></html>",
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Symbol,
    Error,
    Map,
    Set,
    RegExp,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "code.js" });

  return { api: context as any, figma };
}
