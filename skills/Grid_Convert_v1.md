---
id: Grid_Convert_v1
title: Figma Grid Converter
description: >
  Converts a selected section, frame, group or page into a Figma Grid (GRID
  auto layout) that renders exactly as before, with the fewest layers, walking
  parent → child → grandchild and removing every wrapper a Grid makes
  unnecessary. Use this skill whenever the user says "convert to grid", "make
  this a grid", "grid layout", "gridify", "full grid", "Figma grid system",
  "fewer layers", "too many auto layout wrappers" or "rebuild this with grid",
  or asks for a flatter, production-ready layout structure even without the
  word grid. Plans and applies through convert_layout, which measures every
  layer and puts the design back if anything would move.
triggers:
  - convert to grid
  - make this a grid
  - grid layout
  - gridify
  - full grid
  - figma grid system
  - turn this section into a grid
  - rebuild this with grid
  - fewer layers
  - minimal layers
  - too many auto layout wrappers
uses:
  - join_channel
  - check_figma_connection
  - get_selection
  - get_nodes_info
  - export_node_as_image
  - convert_layout
  - clean_layers
---

# Figma Grid Converter

You rebuild sections as Figma Grids that look **exactly** the same with the
**minimum** number of layers. Where a file has
`Section > Container > Row > Column > Card`, the result is `Section (Grid) > Card`.

Two outcomes, in this order:

1. **Identical render.** Every layer keeps its x/y and size. If a Grid cannot
   reproduce something exactly, that part gets Auto Layout or stays as it is,
   with the reason. Never approximate and never snap.
2. **Minimum layers.** A frame survives only if it does something a Grid cell
   cannot (see "What survives").

`convert_layout` with `mode: "grid"` implements this whole procedure:
- **Blueprint:** it reads layer geometry, removes wrappers, and plans tracks,
  spans, spacer rows, cell alignment and absolute overlays.
- **Choice:** it uses a Grid wherever one fits and Auto Layout elsewhere, and
  applies exactly the variant the user approved.
- **Safety:** it measures every layer afterwards, and if anything moved more than
  0.5px it puts the original back from a hidden copy.
- **Tokens:** it keeps gap and padding variables bound.

Your job is to scope the request, run the scan, explain it, get approval and
report. Do not rebuild what the tool refused by other means.

---

## Step 0 — Connect and read

1. `join_channel` with the channel the user gave; ask if there is none.
   `check_figma_connection` if a call fails.
2. `get_selection`. If nothing is selected, ask which section to convert.
   `convert_layout` scans the whole page when it gets no node, so only do that
   when the user asked for the page.
3. `get_nodes_info` on the target (`depth` 3–5) when you need to explain the
   structure to the user. The tool reads geometry itself, so this is for the
   conversation, not for planning by hand.
4. `export_node_as_image` (PNG, scale 0.25–0.5): the **before** picture.

Scope follows CLAUDE.md: convert what was asked, one section or page, and nothing
else. "Convert to grid" means every level of that section, parent to deepest
child; the tool walks the whole tree.

---

## Step 1 — Scan

`convert_layout` with `mode: "grid"`, `dryRun: true`, `nodeId` = the target.
Nothing changes. Each proposal (and each `inside:` line) states:

- **layout**: `3-column Grid, 4 row(s), spacer row(s) 16px, equal columns, gaps 16/40px`,
  or `vertical, gap 24px` when Auto Layout was chosen;
- **gridRefusal**: why this container is Auto Layout rather than a Grid;
- **flattens**: the wrappers that will be removed;
- **keeps … in place as absolute**: overlays (badges, a pin on a map);
- **Cannot convert**: containers left as they are, with the reason.

## Step 2 — Explain and ask

In the user's language, per proposal: its name, its Grid shape or why it is
Auto Layout, how many wrapper layers go, and what stays absolute or unchanged.
Then ask. Apply with `convert_layout` (`mode: "grid"`, no `dryRun`) and only the
approved IDs in `confirmedIds`. A proposal converts with every frame inside it;
an inner ID converts only that frame.

If hidden or empty layers should be deleted rather than kept, that is a
separate request: run `clean_layers` (scan → ask → apply) first. Hidden layers
are otherwise kept, as hidden absolute layers where they were.

## Step 3 — Verify and report

1. `export_node_as_image` at the same scale and compare with the before picture:
   edges, gaps, alignment, text wrapping, image crops.
2. Read the apply result: `converted` (with layouts), `skipped` (put back, with
   reason), `tokensBound`, `tokensMissing`.
3. If `tokensMissing` lists values, ask: "I cannot find an existing local
   variable for … Should I use the current manual value or add a new token?"
   Never create tokens without a yes.

```
Converted: # Work Process (id) — 4-column Grid, 2 rows, equal columns, gaps 40/16 (Row Gap, Column Gap)
Layers removed: Container, 8 card wrappers
Auto Layout instead of Grid: Paragraphs ×3 — single column
Absolute: pin (over Map)
Put back: Hover Interactions — "Button" and "Link" are not aligned (left edges 3px apart)
Verified: before/after export identical; every layer measured by the plugin
```

Rename layers only if the user asked (load `Layer_Rename_v1`).

---

## How the tool decides (for explaining results)

### The minimal-layer scale

| Level | Structure | When |
|---|---|---|
| L0 | One Grid, content as direct children, headings span all columns | One row gap and one column gap describe everything |
| L1 | One Grid with FIXED columns or spacer rows | Unequal columns (sidebar + content); a larger gap above the cards than below the heading |
| L3 | Grid with a surviving child frame | The child paints, clips, is a component, or its spacing cannot be expressed by the parent's tracks. It is converted in turn |
| L5 | Any of the above + absolute children | Overlaps: badges, pins, decorative shapes |

Candidates for each container:
1. a Grid of the container's own layers as cells (columns the designer drew);
2. a Grid of the layers inside its wrappers;
3. Auto Layout, keeping rows that become Grids of their own. Used only when
   neither Grid describes the layers.

**A Grid wins whenever one fits; between the two Grids the one leaving fewer
layers wins, a tie going to the designer's cells.** Grid cells are converted in
turn, so a Grid removes more than its own level shows. Apply rebuilds the
variant the scan proposed, so what the user approved is what they get.

### What survives

A frame is kept only if it:

- paints a fill, stroke or effect, or has opacity or a blend mode;
- clips content that reaches its edge, or clips with rounded corners;
- is a component, instance or mask. Never entered or dissolved;
- has a prototype interaction or export setting;
- has a variable bound to anything other than gap or padding;
- has an absolutely positioned child.

Everything else dissolves. A wrapper exactly the size of its one layer always
dissolves.

### Auto Layout instead of a Grid (gridRefusal)

| Reason | Why |
|---|---|
| single column | A 1-column Grid adds nothing a vertical stack does not; CLAUDE.md keeps normal flow for non-repeating content |
| items spaced apart, not in columns | Label ↔ value, logo ↔ menu: a gap wider than an item. Space between stays responsive; a Grid would fix that distance at today's width |
| columns not evenly spaced / columns shift / staggered row | No track, span or cell alignment reproduces it |
| rows not evenly spaced | A larger gap is less than twice the row gap, so a spacer row cannot reproduce it |

### Refusals — report, do not work around

| Reason | Tell the user |
|---|---|
| not aligned left/centre/right (or top/centre/bottom), with px | Layers are off by that amount. Converting would move them. They can align them and scan again |
| free composition (most layers overlap) | A collage, kept as drawn |
| rotated, mask, instance, main component | Left whole by design |
| already a Grid | Nothing to do there; frames inside are still checked |

Never imitate a refused conversion with `set_grid_layout`, `set_auto_layout`,
`move_node`, `ungroup_nodes`, manual x/y or an `execute_code` script. Those have
no measurement and no rollback, and a hand-built Grid that looks right usually
has no layout left.

---

## Figma Grid mechanics (reference)

- `layoutMode: "GRID"`, explicit rows × columns; children sit in cells.
- Tracks: `FLEX` (share of free space, like `fr`), `FIXED` px, `HUG`. Rows hug by
  default. FLEX columns need a frame with a defined width; the tool keeps the
  frame's width Fixed or Fill, and height becomes Hug.
- One `gridRowGap` and one `gridColumnGap`. A different gap between two rows is an
  empty FIXED spacer row of (gap − 2 × row gap), never a wrapper.
- Padding works as in Auto Layout.
- Placement: with auto-flow (`gridItemsPositioning: "ROW_AUTO_FLOW"`) children fill
  cells in layer order, so layer order is reading order. With spacer rows or an
  empty cell before the last row, placement is `MANUAL` via
  `appendChildAt(child, row, column)`.
- Spans: `gridColumnSpan`. Figma refuses a span over a cell already occupied, so a
  span is set while its row holds nothing else. Row spans are not used: they
  are not verified in a live file yet.
- Cell alignment: `gridChildHorizontalAlign` / `gridChildVerticalAlign`
  (`MIN`/`CENTER`/`MAX`). This is how a right-aligned button beside a left-aligned
  heading needs no wrapper.
- Child sizing in a cell: `FILL` stretches to the track (equal cards, panels that
  stretched to their row), otherwise Fixed/Hug keeps its size.
- `layoutPositioning: "ABSOLUTE"` takes a child out of the cells: overlays, and
  hidden layers, which would otherwise claim a cell.
- When Grid is the wrong answer: free-form compositions, a wrapping list of
  unequal chips (Auto Layout with wrap), rotated frames, masks.
