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
  /**
   * Compute geometry the way Figma does — Auto Layout and Grid positions, Hug
   * sizes, group bounds — and refuse what Figma refuses. Off by default so older
   * fixtures that declare their own geometry keep working unchanged.
   */
  layoutEngine?: boolean;
  /**
   * Styles the file can see. `remote: true` models a style owned by another
   * file — the shape `audit_remote_styles` exists to find. Local styles are the
   * ones getLocal*StylesAsync returns; remote ones are reachable only by id.
   */
  styles?: MockStyle[];
}

export type MockStyle = {
  id: string;
  name: string;
  key: string;
  /** PAINT | TEXT | EFFECT | GRID — Figma's BaseStyle.type. */
  type: "PAINT" | "TEXT" | "EFFECT" | "GRID";
  remote?: boolean;
};

/** Set by loadPlugin; read when a node is created. */
const engine = { enabled: false, page: null as any };

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
    // A new Figma frame hugs its primary axis and fixes its counter axis.
    counterAxisSizingMode: spec.counterAxisSizingMode ?? (engine.enabled ? "FIXED" : "AUTO"),
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
    strokesIncludedInLayout: spec.strokesIncludedInLayout ?? false,
    strokeWeight: spec.strokeWeight ?? 1,
    strokeTopWeight: spec.strokeTopWeight ?? spec.strokeWeight ?? 1,
    strokeRightWeight: spec.strokeRightWeight ?? spec.strokeWeight ?? 1,
    strokeBottomWeight: spec.strokeBottomWeight ?? spec.strokeWeight ?? 1,
    strokeLeftWeight: spec.strokeLeftWeight ?? spec.strokeWeight ?? 1,
    // Figma: a number on every frame and shape, figma.mixed when the corners differ.
    cornerRadius: spec.cornerRadius ?? 0,
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
      if (engine.enabled) {
        // Confirmed live: resizing to the size a frame already renders at changes nothing,
        // not even a hugging axis. Only a real change fixes both axes.
        const current = this.parent ? this.absoluteBoundingBox : null;
        if (current && Math.abs(current.width - w) < 0.01 && Math.abs(current.height - h) < 0.01) return;
      }
      this.width = w;
      this.height = h;
      if (engine.enabled) {
        // Figma: resizing an Auto Layout frame or a Fill child fixes both axes.
        this.primaryAxisSizingMode = "FIXED";
        this.counterAxisSizingMode = "FIXED";
        this._verticalSizing = "FIXED";
        this._horizontalSizing = "FIXED";
        return;
      }
      // Matches Figma: a literal resize pins the axis it touches.
      if (this.layoutMode === "VERTICAL") this.primaryAxisSizingMode = "FIXED";
      else if (this.layoutMode === "HORIZONTAL") this.counterAxisSizingMode = "FIXED";
      this._verticalSizing = "FIXED";
    },
    fillStyleId: spec.fillStyleId ?? "",
    strokeStyleId: spec.strokeStyleId ?? "",
    effectStyleId: spec.effectStyleId ?? "",
    gridStyleId: spec.gridStyleId ?? "",
    // Figma: the async setters are the supported path on the current API and
    // they reject on a style id that does not resolve. Modelled as rejecting so
    // a test cannot pass by assigning a bogus id.
    async setFillStyleIdAsync(id: string) {
      this.fillStyleId = id;
    },
    async setStrokeStyleIdAsync(id: string) {
      this.strokeStyleId = id;
    },
    async setEffectStyleIdAsync(id: string) {
      this.effectStyleId = id;
    },
    async setGridStyleIdAsync(id: string) {
      this.gridStyleId = id;
    },
    async setTextStyleIdAsync(id: string) {
      this.textStyleId = id;
    },
    /**
     * Figma returns one entry per run of uniform styling. Fixtures declare the
     * runs directly via `styledTextSegments`; a node without them reports a
     * single run covering the whole string, which is what a real unmixed text
     * node does.
     */
    getStyledTextSegments(fields: string[]) {
      const declared = spec.styledTextSegments as any[] | undefined;
      const runs =
        declared ?? [{ start: 0, end: (this.characters ?? "").length }];
      return runs.map((run: any) => {
        const out: any = { start: run.start, end: run.end };
        for (const field of fields) out[field] = run[field] ?? "";
        return out;
      });
    },
    setBoundVariable(field: string, variable: any) {
      if (variable === null) {
        // Figma: binding null removes the variable and keeps the current value.
        const { [field]: _removed, ...rest } = this.boundVariables;
        this.boundVariables = rest;
        return;
      }
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
      const oldParent = child.parent;
      if (child.parent?.children) {
        const oldIndex = child.parent.children.indexOf(child);
        if (oldIndex >= 0) child.parent.children.splice(oldIndex, 1);
      }
      this.children.push(child);
      child.parent = this;
      child._gridCell = undefined;
      removeEmptiedGroup(oldParent, this);
    },
    insertChild(index: number, child: any) {
      const oldParent = child.parent;
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
      removeEmptiedGroup(oldParent, this);
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
      const oldParent = this.parent;
      if (this.parent?.children) {
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
      }
      this.parent = null;
      this.removed = true;
      removeEmptiedGroup(oldParent, null);
      // Figma: a removed node keeps its id and \`removed\`; reading anything else throws.
      const id = this.id;
      for (const key of ["name", "children", "width", "height", "x", "y"]) {
        Object.defineProperty(this, key, {
          configurable: true,
          get: () => { throw new Error(`in get_${key}: The node with id "${id}" does not exist`); },
          set: () => { throw new Error(`in set_${key}: The node with id "${id}" does not exist`); },
        });
      }
    },
    clone(nested = false) {
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
          children: (this.children ?? []).map((child: any) => child.clone(true)),
        });
      } finally {
        for (const current of subtree) current.parent = originalParents.get(current);
      }

      if (engine.enabled) {
        Object.assign(copy, {
          primaryAxisAlignItems: this.primaryAxisAlignItems,
          counterAxisAlignItems: this.counterAxisAlignItems,
          clipsContent: this.clipsContent,
        });
        // Figma parents a duplicate to the current page, not beside the original.
        if (!nested) placeOnPage(copy);
        return copy;
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

  if (spec.rotation !== undefined) node.rotation = spec.rotation;
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

  if (engine.enabled && !spec.absoluteBoundingBox) installLayoutEngine(node, spec);

  return node;
}

// ─── Layout engine ──────────────────────────────────────────────────────────
//
// Just enough of Figma's layout to measure whether a restructure moved anything:
// horizontal/vertical Auto Layout (padding, gap, MIN/CENTER/MAX, space between,
// Hug/Fixed/cross-axis Fill), Grid (FIXED/FLEX/HUG tracks, spans, cell
// alignment), absolute children, and groups, whose children sit in the group's
// parent coordinate space. Every read is computed from the current tree.

const isLayoutFrame = (node: any) =>
  !!node && Array.isArray(node.children) && !!node.layoutMode && node.layoutMode !== "NONE";
const inFlow = (node: any) => node.visible !== false && node.layoutPositioning !== "ABSOLUTE";
const isPageLike = (node: any) => !node || !node.type || node.type === "PAGE";

function sizingOf(node: any, axis: "h" | "v"): string {
  const explicit = axis === "h" ? node._horizontalSizing : node._verticalSizing;
  if (explicit) return explicit;
  if (node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL") {
    const primary = (node.layoutMode === "HORIZONTAL") === (axis === "h");
    return (primary ? node.primaryAxisSizingMode : node.counterAxisSizingMode) === "AUTO" ? "HUG" : "FIXED";
  }
  return "FIXED";
}

type Rect = { x: number; y: number; width: number; height: number };

function groupLocalUnion(group: any): Rect {
  const rects = group.children
    .filter((child: any) => child.visible !== false)
    .map((child: any) =>
      child.type === "GROUP" ? groupLocalUnion(child) : { x: child.x, y: child.y, ...intrinsicSize(child) }
    );
  if (rects.length === 0) return { x: group.x, y: group.y, width: 0, height: 0 };
  const x = Math.min(...rects.map((r: Rect) => r.x));
  const y = Math.min(...rects.map((r: Rect) => r.y));
  const right = Math.max(...rects.map((r: Rect) => r.x + r.width));
  const bottom = Math.max(...rects.map((r: Rect) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

function intrinsicSize(node: any): { width: number; height: number } {
  if (node.type === "GROUP") {
    const union = groupLocalUnion(node);
    return { width: union.width, height: union.height };
  }
  if (isLayoutFrame(node)) {
    const measured = measureLayout(node, null);
    return { width: measured.width, height: measured.height };
  }
  return { width: node.width, height: node.height };
}

/**
 * Padding as layout uses it. Confirmed live: with strokesIncludedInLayout and
 * visible strokes, each side's stroke weight adds to that side's padding.
 */
function layoutPadding(frame: any) {
  const strokes = frame.strokesIncludedInLayout && Array.isArray(frame.strokes) && frame.strokes.some((p: any) => p && p.visible !== false);
  const w = (key: string) => (strokes ? frame[key] ?? 0 : 0);
  return {
    top: frame.paddingTop + w("strokeTopWeight"),
    right: frame.paddingRight + w("strokeRightWeight"),
    bottom: frame.paddingBottom + w("strokeBottomWeight"),
    left: frame.paddingLeft + w("strokeLeftWeight"),
  };
}

function measureLayout(frame: any, outer: { width: number; height: number } | null) {
  return frame.layoutMode === "GRID" ? measureGrid(frame, outer) : measureStack(frame, outer);
}

function measureStack(frame: any, outer: { width: number; height: number } | null) {
  const P = layoutPadding(frame);
  const vertical = frame.layoutMode === "VERTICAL";
  const kids = frame.children.filter(inFlow);
  const sizes = kids.map(intrinsicSize);
  const mainOf = (s: any) => (vertical ? s.height : s.width);
  const crossOf = (s: any) => (vertical ? s.width : s.height);
  const [padMainStart, padMainEnd, padCrossStart, padCrossEnd] = vertical
    ? [P.top, P.bottom, P.left, P.right]
    : [P.left, P.right, P.top, P.bottom];
  const mainAxis = vertical ? "v" : "h";
  const crossAxis = vertical ? "h" : "v";
  const hugMain = sizingOf(frame, mainAxis) === "HUG";
  const hugCross = sizingOf(frame, crossAxis) === "HUG";
  const fixedMain = vertical ? (outer ? outer.height : frame.height) : (outer ? outer.width : frame.width);
  // Main-axis Fill shares what a fixed frame has left; in a hugging frame it keeps its own size.
  const fillers = hugMain ? [] : kids.filter((kid: any) => sizingOf(kid, mainAxis) === "FILL");
  if (fillers.length) {
    if (frame.primaryAxisAlignItems === "SPACE_BETWEEN") throw new Error("layout engine: Fill with space between is not modelled");
    const rest = kids.reduce((sum: number, kid: any, i: number) => sum + (fillers.includes(kid) ? 0 : mainOf(sizes[i])), 0);
    const share = (fixedMain - padMainStart - padMainEnd - rest - Math.max(0, kids.length - 1) * frame.itemSpacing) / fillers.length;
    kids.forEach((kid: any, i: number) => {
      if (fillers.includes(kid)) sizes[i] = vertical ? { ...sizes[i], height: share } : { ...sizes[i], width: share };
    });
  }
  const totalMain = sizes.reduce((sum: number, s: any) => sum + mainOf(s), 0);
  const fixedCross = vertical ? (outer ? outer.width : frame.width) : (outer ? outer.height : frame.height);
  const spaceBetween = frame.primaryAxisAlignItems === "SPACE_BETWEEN" && kids.length > 1;
  const gap = spaceBetween && !hugMain
    ? (fixedMain - padMainStart - padMainEnd - totalMain) / (kids.length - 1)
    : frame.itemSpacing;
  const mainSize = hugMain
    ? padMainStart + totalMain + Math.max(0, kids.length - 1) * gap + padMainEnd
    : fixedMain;
  // A hugging frame grows to its content, Fill children included (live: a FILL/FILL block in a
  // FIXED/HUG row renders at its content height); in a fixed frame Fill takes what is there.
  const crossContent = kids
    .filter((kid: any) => hugCross || sizingOf(kid, crossAxis) !== "FILL")
    .reduce((max: number, kid: any) => Math.max(max, crossOf(sizes[kids.indexOf(kid)])), 0);
  const crossSize = hugCross ? padCrossStart + crossContent + padCrossEnd : fixedCross;
  const innerCross = crossSize - padCrossStart - padCrossEnd;

  const slots = new Map<any, Rect>();
  let cursor = padMainStart;
  kids.forEach((kid: any, i: number) => {
    const main = mainOf(sizes[i]);
    const fills = sizingOf(kid, crossAxis) === "FILL";
    const cross = fills ? innerCross : crossOf(sizes[i]);
    let offset = padCrossStart;
    if (!fills && frame.counterAxisAlignItems === "CENTER") offset = padCrossStart + (innerCross - cross) / 2;
    if (!fills && frame.counterAxisAlignItems === "MAX") offset = crossSize - padCrossEnd - cross;
    slots.set(kid, vertical
      ? { x: offset, y: cursor, width: cross, height: main }
      : { x: cursor, y: offset, width: main, height: cross });
    cursor += main + gap;
  });
  return vertical
    ? { width: crossSize, height: mainSize, slots }
    : { width: mainSize, height: crossSize, slots };
}

function alignInTrack(align: string, start: number, track: number, size: number) {
  if (align === "CENTER") return start + (track - size) / 2;
  if (align === "MAX") return start + track - size;
  return start;
}

function measureGrid(frame: any, outer: { width: number; height: number } | null) {
  const P = layoutPadding(frame);
  const kids = frame.children.filter(inFlow);
  const placement = autoFlowPlacement(frame);
  const sizes = new Map<any, { width: number; height: number }>(kids.map((kid: any) => [kid, intrinsicSize(kid)]));
  const hugW = sizingOf(frame, "h") === "HUG";
  const hugH = sizingOf(frame, "v") === "HUG";

  const trackSizes = (tracks: any[], gap: number, available: number | null, measure: (index: number) => number) => {
    const fixed = tracks.map((track, i) => (track.type === "FIXED" ? track.value : track.type === "HUG" ? measure(i) : 0));
    const flexTotal = tracks.reduce((sum, track) => sum + (track.type === "FLEX" ? track.value : 0), 0);
    if (flexTotal === 0) return fixed;
    if (available === null) throw new Error("layout engine: FLEX tracks need a fixed size");
    const free = available - gap * (tracks.length - 1) - fixed.reduce((sum, value) => sum + value, 0);
    return tracks.map((track, i) => (track.type === "FLEX" ? (free * track.value) / flexTotal : fixed[i]));
  };
  const cellOf = (kid: any) => {
    const cell = placement.get(kid);
    if (!cell || cell.row >= frame.gridRowCount || cell.column >= frame.gridColumnCount) {
      throw new Error(`layout engine: "${kid.name}" is placed outside the grid`);
    }
    return cell;
  };
  const widthOuter = hugW ? null : (outer ? outer.width : frame.width) - P.left - P.right;
  const heightOuter = hugH ? null : (outer ? outer.height : frame.height) - P.top - P.bottom;
  const columns = trackSizes(frame.gridColumnSizes, frame.gridColumnGap, widthOuter, (c) =>
    Math.max(0, ...kids.filter((kid: any) => cellOf(kid).column === c && (kid.gridColumnSpan ?? 1) === 1).map((kid: any) => sizes.get(kid)!.width))
  );
  const rows = trackSizes(frame.gridRowSizes, frame.gridRowGap, heightOuter, (r) =>
    Math.max(0, ...kids.filter((kid: any) => cellOf(kid).row === r).map((kid: any) => sizes.get(kid)!.height))
  );
  const offset = (tracks: number[], gap: number, index: number) =>
    tracks.slice(0, index).reduce((sum, value) => sum + value, 0) + index * gap;

  const slots = new Map<any, Rect>();
  for (const kid of kids) {
    const cell = cellOf(kid);
    const span = Math.min(kid.gridColumnSpan ?? 1, columns.length - cell.column);
    const trackX = P.left + offset(columns, frame.gridColumnGap, cell.column);
    const trackW = columns.slice(cell.column, cell.column + span).reduce((sum, value) => sum + value, 0) + (span - 1) * frame.gridColumnGap;
    const trackY = P.top + offset(rows, frame.gridRowGap, cell.row);
    const trackH = rows[cell.row];
    const size = sizes.get(kid)!;
    const width = sizingOf(kid, "h") === "FILL" ? trackW : size.width;
    const height = sizingOf(kid, "v") === "FILL" ? trackH : size.height;
    slots.set(kid, {
      x: alignInTrack(kid.gridChildHorizontalAlign, trackX, trackW, width),
      y: alignInTrack(kid.gridChildVerticalAlign, trackY, trackH, height),
      width,
      height,
    });
  }
  const width = hugW
    ? P.left + offset(columns, frame.gridColumnGap, columns.length) - frame.gridColumnGap + P.right
    : outer ? outer.width : frame.width;
  const height = hugH
    ? P.top + offset(rows, frame.gridRowGap, rows.length) - frame.gridRowGap + P.bottom
    : outer ? outer.height : frame.height;
  return { width, height, slots };
}

function outerSize(node: any): { width: number; height: number } {
  if (isLayoutFrame(node.parent) && inFlow(node)) {
    const slot = slotOf(node);
    return { width: slot.width, height: slot.height };
  }
  return intrinsicSize(node);
}

function slotOf(node: any): Rect {
  const slot = measureLayout(node.parent, outerSize(node.parent)).slots.get(node);
  if (!slot) throw new Error(`layout engine: no slot for "${node.name}"`);
  return slot;
}

function engineBox(node: any): Rect {
  const parent = node.parent;
  if (isPageLike(parent)) {
    if (node.type === "GROUP") return groupLocalUnion(node);
    return { x: node.x, y: node.y, ...outerSize(node) };
  }
  if (isLayoutFrame(parent) && inFlow(node)) {
    const parentBox = engineBox(parent);
    const slot = slotOf(node);
    return { x: parentBox.x + slot.x, y: parentBox.y + slot.y, width: slot.width, height: slot.height };
  }
  let originX: number;
  let originY: number;
  if (parent.type === "GROUP") {
    const groupBox = engineBox(parent);
    const union = groupLocalUnion(parent);
    originX = groupBox.x - union.x;
    originY = groupBox.y - union.y;
  } else {
    const parentBox = engineBox(parent);
    originX = parentBox.x;
    originY = parentBox.y;
  }
  if (node.type === "GROUP") {
    const union = groupLocalUnion(node);
    return { x: originX + union.x, y: originY + union.y, width: union.width, height: union.height };
  }
  return { x: originX + node.x, y: originY + node.y, ...intrinsicSize(node) };
}

function installLayoutEngine(node: any, spec: any) {
  Object.defineProperty(node, "absoluteBoundingBox", {
    enumerable: false,
    configurable: true,
    get: () => (node.removed ? null : engineBox(node)),
  });
  Object.defineProperty(node, "absoluteRenderBounds", {
    enumerable: false,
    configurable: true,
    get: () => {
      if (node.removed) return null;
      const box = engineBox(node);
      const outset = spec.renderOutset ?? 0;
      return { x: box.x - outset, y: box.y - outset, width: box.width + 2 * outset, height: box.height + 2 * outset };
    },
  });
  Object.defineProperty(node, "absoluteTransform", {
    enumerable: false,
    configurable: true,
    get: () => {
      const box = engineBox(node);
      return [[1, 0, box.x], [0, 1, box.y]];
    },
  });
  Object.defineProperty(node, "relativeTransform", {
    enumerable: false,
    configurable: true,
    get: () => [[1, 0, node.x], [0, 1, node.y]],
    set: (value: number[][]) => {
      node.x = value[0][2];
      node.y = value[1][2];
    },
  });

  // Figma stores sizing per primary/counter axis, so turning a row into a column swaps
  // which of width and height hugs (confirmed live: FIXED/HUG row → HUG/FIXED column).
  let layoutMode = node.layoutMode;
  Object.defineProperty(node, "layoutMode", {
    enumerable: true,
    configurable: true,
    get: () => layoutMode,
    set: (value: string) => {
      const flips = (layoutMode === "HORIZONTAL" && value === "VERTICAL") || (layoutMode === "VERTICAL" && value === "HORIZONTAL");
      if (flips) {
        const own = (sizing: string | null) => sizing === "HUG" || sizing === "FIXED";
        const h = node._horizontalSizing ?? sizingOf(node, "h");
        const v = node._verticalSizing ?? sizingOf(node, "v");
        if (own(h) && own(v)) {
          node._horizontalSizing = v;
          node._verticalSizing = h;
        }
      }
      layoutMode = value;
    },
  });

  // Figma refuses these outside Auto Layout; so does the engine.
  let positioning = spec.layoutPositioning ?? "AUTO";
  Object.defineProperty(node, "layoutPositioning", {
    enumerable: true,
    configurable: true,
    get: () => positioning,
    set: (value: string) => {
      if (value === "ABSOLUTE" && !isLayoutFrame(node.parent)) {
        throw new Error("in set_layoutPositioning: node must be a child of an auto-layout frame");
      }
      positioning = value;
    },
  });
  const guardSizing = (axis: "h" | "v") => ({
    enumerable: false,
    configurable: true,
    get: () => {
      if (!isLayoutFrame(node) && !isLayoutFrame(node.parent)) {
        throw new Error(`layoutSizing${axis === "h" ? "Horizontal" : "Vertical"} unavailable`);
      }
      return sizingOf(node, axis);
    },
    set: (value: string) => {
      if (value === "FILL" && !isLayoutFrame(node.parent)) {
        throw new Error("FILL can only be set on children of auto-layout frames");
      }
      if (value === "HUG" && !isLayoutFrame(node) && node.type !== "TEXT") {
        throw new Error("HUG can only be set on auto-layout frames and text nodes");
      }
      if (axis === "h") node._horizontalSizing = value;
      else node._verticalSizing = value;
      if (value === "HUG" && node.layoutMode === "HORIZONTAL") {
        if (axis === "h") node.primaryAxisSizingMode = "AUTO";
        else node.counterAxisSizingMode = "AUTO";
      }
      if (value === "HUG" && node.layoutMode === "VERTICAL") {
        if (axis === "v") node.primaryAxisSizingMode = "AUTO";
        else node.counterAxisSizingMode = "AUTO";
      }
    },
  });
  Object.defineProperty(node, "layoutSizingHorizontal", guardSizing("h"));
  Object.defineProperty(node, "layoutSizingVertical", guardSizing("v"));
}

/** Figma deletes a group the moment its last child leaves. */
function removeEmptiedGroup(oldParent: any, newParent: any) {
  if (!engine.enabled || !oldParent || oldParent === newParent) return;
  if (oldParent.type === "GROUP" && !oldParent.removed && oldParent.children.length === 0) oldParent.remove();
}

function makePage() {
  const page: any = { id: "0:1", name: "Page 1", type: "PAGE", selection: [], children: [] };
  const detach = (child: any) => {
    const oldParent = child.parent;
    if (oldParent?.children) {
      const index = oldParent.children.indexOf(child);
      if (index >= 0) oldParent.children.splice(index, 1);
    }
    return oldParent;
  };
  page.appendChild = (child: any) => {
    const oldParent = detach(child);
    page.children.push(child);
    child.parent = page;
    removeEmptiedGroup(oldParent, page);
  };
  page.insertChild = (index: number, child: any) => {
    const oldParent = child.parent;
    const oldIndex = oldParent === page ? page.children.indexOf(child) : -1;
    detach(child);
    page.children.splice(oldIndex >= 0 && oldIndex < index ? index - 1 : index, 0, child);
    child.parent = page;
    removeEmptiedGroup(oldParent, page);
  };
  return page;
}

/** Put a node at the top level of the mock's current page, as Figma does for created and cloned nodes. */
export function placeOnPage(node: any) {
  const page = engine.page;
  if (!page) throw new Error("placeOnPage needs loadPlugin({ layoutEngine: true })");
  if (node.parent?.children) {
    const index = node.parent.children.indexOf(node);
    if (index >= 0) node.parent.children.splice(index, 1);
  }
  page.children.push(node);
  node.parent = page;
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
  const styles = options.styles ?? [];
  const localStylesOfType = (type: string) =>
    styles.filter((s) => s.type === type && !s.remote);

  return {
    mixed,
    showUI: () => undefined,
    // `resize` is modelled because the plugin calls it: the panel is
    // user-resizable and re-applies its stored size on load. Tests that need
    // to assert the size replace these with spies.
    ui: {
      onmessage: null as unknown,
      postMessage: () => undefined,
      resize: (_width: number, _height: number): void => undefined,
    },
    on: () => undefined,
    notify: () => undefined,
    commitUndo: () => undefined,
    createFrame: () =>
      options.layoutEngine
        ? placeOnPage(makeNode({ name: "Frame", fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }], clipsContent: true }))
        : makeNode({ name: "Frame" }),
    currentPage: options.layoutEngine ? makePage() : { selection: [], children: [] },
    root: { children: [] },
    loadAllPagesAsync: async () => undefined,
    clientStorage: {
      // Typed loosely on purpose: real clientStorage returns whatever was
      // stored, so a test must be able to hand back a value.
      getAsync: async (_key?: string): Promise<any> => undefined,
      setAsync: async (_key?: string, _value?: any): Promise<void> => undefined,
    },
    getNodeByIdAsync: async (id: string) => nodeRegistry.get(id) ?? null,
    // Figma: getStyleByIdAsync resolves local AND remote styles; the
    // getLocal*StylesAsync family returns local ones only. That asymmetry is
    // the whole reason a remote binding is invisible to the rest of this
    // plugin, so the mock has to keep the two apart.
    getStyleByIdAsync: async (id: string) => styles.find((s) => s.id === id) ?? null,
    getLocalPaintStylesAsync: async () => localStylesOfType("PAINT"),
    getLocalTextStylesAsync: async () => localStylesOfType("TEXT"),
    getLocalEffectStylesAsync: async () => localStylesOfType("EFFECT"),
    getLocalGridStylesAsync: async () => localStylesOfType("GRID"),
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
  engine.enabled = options.layoutEngine === true;
  engine.page = engine.enabled ? figma.currentPage : null;

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
