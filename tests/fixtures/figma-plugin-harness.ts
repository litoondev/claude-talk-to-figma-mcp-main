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
    primaryAxisAlignItems: spec.primaryAxisAlignItems ?? "MIN",
    counterAxisAlignItems: spec.counterAxisAlignItems ?? "MIN",
    clipsContent: spec.clipsContent ?? false,
    gridRowGap: 0,
    gridColumnGap: 0,
    gridAutoTracks: "NONE",
    gridItemsPositioning: "MANUAL",
    gridRowSizes: [] as any[],
    gridColumnSizes: [] as any[],
    gridRowSpan: 1,
    gridColumnSpan: 1,
    gridChildHorizontalAlign: "AUTO",
    gridChildVerticalAlign: "AUTO",
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
      child._gridCell = undefined;
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
      child._gridCell = undefined;
    },
    appendChildAt(child: any, row: number, column: number) {
      if (this.layoutMode !== "GRID") throw new Error("appendChildAt needs a GRID frame");
      if (row < 0 || column < 0 || row >= this.gridRowCount || column >= this.gridColumnCount) {
        throw new Error("in appendChildAt: row or column index out of bounds");
      }
      for (const other of this.children) {
        const cell = other._gridCell;
        if (other === child || !cell || other.layoutPositioning === "ABSOLUTE") continue;
        if (cell.row === row && column >= cell.column && column < cell.column + (other.gridColumnSpan ?? 1)) {
          throw new Error("in appendChildAt: the specified cell is occupied");
        }
      }
      this.appendChild(child);
      child._gridCell = { row, column };
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

  // Grid tracks follow the counts, as in Figma: raising a count appends FLEX tracks.
  const trackCount = (key: "gridRowSizes" | "gridColumnSizes") => ({
    enumerable: false,
    configurable: true,
    get: () => node[key].length,
    set(value: number) {
      if (node.layoutMode !== "GRID") throw new Error("grid track counts need layoutMode GRID");
      if (key === "gridRowSizes" && node.gridAutoTracks === "ROWS") {
        throw new Error("gridRowCount cannot be set while gridAutoTracks is ROWS");
      }
      if (value < 1) throw new Error("grid track count must be at least 1");
      while (node[key].length < value) node[key].push({ type: "FLEX", value: 1 });
      node[key].length = value;
    },
  });
  Object.defineProperty(node, "gridRowCount", trackCount("gridRowSizes"));
  Object.defineProperty(node, "gridColumnCount", trackCount("gridColumnSizes"));

  // Figma refuses a column span that would cover a child already placed beside it.
  let columnSpan = 1;
  Object.defineProperty(node, "gridColumnSpan", {
    enumerable: false,
    configurable: true,
    get: () => columnSpan,
    set(value: number) {
      const grid = node.parent;
      if (grid && grid.layoutMode === "GRID") {
        const placement = autoFlowPlacement(grid);
        const own = placement.get(node);
        if (own) {
          if (own.column + value > grid.gridColumnCount) {
            throw new Error("in set_gridColumnSpan: Cannot set child to specified column span beyond the grid");
          }
          for (const [other, cell] of placement) {
            if (other === node || cell.row !== own.row) continue;
            if (cell.column >= own.column + columnSpan && cell.column < own.column + value) {
              throw new Error(
                "in set_gridColumnSpan: Cannot set child to specified column span due to existing children in adjacent columns"
              );
            }
          }
        }
      }
      columnSpan = value;
    },
  });

  // Geometry is opt-in: a spec value or a function of the node's current state.
  if (spec.absoluteBoundingBox) {
    Object.defineProperty(node, "absoluteBoundingBox", {
      enumerable: false,
      configurable: true,
      get: () =>
        typeof spec.absoluteBoundingBox === "function"
          ? spec.absoluteBoundingBox(node)
          : spec.absoluteBoundingBox,
    });
  }

  for (const child of spec.children ?? []) {
    child.parent = node;
    node.children.push(child);
  }

  return node;
}

/**
 * Where row auto-flow puts each in-flow child of a Grid frame, given current
 * spans. Used to refuse a span that would overlap a placed neighbour, as Figma does.
 */
function autoFlowPlacement(grid: any): Map<any, { row: number; column: number }> {
  const columns = Math.max(1, grid.gridColumnCount || 1);
  const placement = new Map<any, { row: number; column: number }>();
  if (grid.gridItemsPositioning === "MANUAL") {
    // Children placed with appendChildAt keep their cell; the rest take the next
    // free cells in reading order, as Figma places a child added with appendChild.
    const occupied = new Set<string>();
    const flowing: any[] = [];
    for (const child of grid.children ?? []) {
      if (child.layoutPositioning === "ABSOLUTE") continue;
      if (!child._gridCell) {
        flowing.push(child);
        continue;
      }
      placement.set(child, child._gridCell);
      for (let c = 0; c < (child.gridColumnSpan ?? 1); c++) occupied.add(`${child._gridCell.row}:${child._gridCell.column + c}`);
    }
    let cursorRow = 0;
    let cursorColumn = 0;
    for (const child of flowing) {
      const span = Math.min(child.gridColumnSpan ?? 1, columns);
      const fits = () => {
        if (cursorColumn + span > columns) return false;
        for (let c = 0; c < span; c++) if (occupied.has(`${cursorRow}:${cursorColumn + c}`)) return false;
        return true;
      };
      while (!fits()) {
        cursorColumn++;
        if (cursorColumn >= columns) {
          cursorColumn = 0;
          cursorRow++;
        }
      }
      placement.set(child, { row: cursorRow, column: cursorColumn });
      for (let c = 0; c < span; c++) occupied.add(`${cursorRow}:${cursorColumn + c}`);
      cursorColumn += span;
    }
    return placement;
  }
  let row = 0;
  let column = 0;
  for (const child of grid.children ?? []) {
    if (child.layoutPositioning === "ABSOLUTE") continue;
    const span = Math.min(child.gridColumnSpan ?? 1, columns);
    if (column + span > columns) {
      row++;
      column = 0;
    }
    placement.set(child, { row, column });
    column += span;
  }
  return placement;
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
    commitUndo: () => undefined,
    createFrame: () => makeNode({ name: "Frame" }),
    currentPage: { selection: [], children: [] },
    root: { children: [] },
    loadAllPagesAsync: async () => undefined,
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
