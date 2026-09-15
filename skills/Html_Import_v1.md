---
id: Html_Import_v1
title: HTML / URL to Figma Import
description: >
  Rebuild an HTML page or website URL in Figma so it looks identical to the
  page — every element, text, image and icon, nothing left out and nothing
  restyled — while linking colours, typography, spacing and radii to the
  file's own design system. Use this skill whenever the user shares an HTML
  file, a web page URL, or website code and asks to convert, import, recreate,
  rebuild or design it in Figma. It analyses the page, maps values to the
  existing variables and styles, builds anything missing with the page's own
  values, turns repeated elements that the system lacks into new components
  placed beside the page, keeps the layer tree flat with Figma Grid or Auto
  Layout, and ends with Import Notes and a side-by-side comparison.
triggers:
  - html to figma
  - convert html to figma
  - convert this html
  - import html
  - url to figma
  - website to figma
  - convert this website to figma
  - build this page in figma
  - recreate this website in figma
  - html file to figma
uses:
  - join_channel
  - check_figma_connection
  - analyze_html
  - get_design_system
  - match_design_tokens
  - get_pages
  - get_selection
  - figma_batch
  - create_frame
  - create_text
  - set_auto_layout
  - set_grid_layout
  - set_layout_sizing
  - apply_variable_bindings
  - set_text_style_id
  - create_component_instance
  - create_component_from_node
  - set_svg
  - place_html_image
  - set_image
  - set_image_fill
  - export_node_as_image
  - clean_layers
---

# HTML / URL to Figma Import

Turn a web page into a Figma design that is **the same as the page**. Four
rules hold for the whole import and override any shortcut below:

1. **Identical.** Every section, text, image, icon, border, shadow and fixed
   overlay the page shows is built. Nothing is left out, nothing is added.
2. **Linked to the style guide.** Every colour, text style, spacing and radius
   that exists in the file's design system is bound to it, never typed.
3. **New components only where they earn it.** An element the system has no
   component for becomes a new component placed beside the page when it
   repeats. A one-off element is built as plain layers.
4. **Zero compromise.** No value is rounded, swapped for a "close" token,
   restyled, shortened or simplified. When something cannot be reproduced,
   say so; never ship a quiet approximation.

Follow the steps in order. Do not skip the analysis or the matching: building
first and matching later is how hardcoded values end up next to tokens that
already existed.

---

## Step 1 — Analyse the page

1. Confirm the plugin is connected (`check_figma_connection`, `join_channel`).
2. Call `analyze_html` with the URL or the absolute path of the `.html` file.
3. Read the whole report:
   - **PAGE OUTLINE**: the sections to build, top to bottom, and for every
     container a layout recommendation (`Figma Grid — N columns` or
     `Auto Layout — horizontal/vertical`). Fixed overlays are part of the
     outline and are built at their declared position.
   - **COLOURS, TYPOGRAPHY, SPACING & RADII**: every value the CSS declares.
   - **TEXT CONTENT**: the copy. Use it exactly; never invent or shorten text.
     If the report says more text was not listed, call again with a higher
     `maxTexts` until nothing is missing.
   - **IMAGES & ICONS**: every image, inline SVG and CSS background to place.
   - **Not built**: only what a visitor cannot see (hidden elements, sprite
     sheets). Anything else in that list is a gap: report it.
4. The analysis reads the markup and CSS without a browser. Values that only
   exist after layout (computed widths, content injected by JavaScript) are
   not in it, and neither are SVG colours set by CSS classes (the markup only
   carries `currentColor`); Step 5 checks those against the screenshot. Before
   building, ask the user for a full-page screenshot of the
   source if you do not have one: it is the reference for Step 5, and without
   it "identical" cannot be verified.
5. If the source is a URL that needs a login, or the report says stylesheets
   failed to load, tell the user what is missing before building.

## Step 2 — Map to the design system

1. Call `get_design_system` to see the file's components, variables and styles.
2. Call `match_design_tokens` with the token lists printed at the end of the
   `analyze_html` report.
3. Treat its three lists as rules:
   - **USE FROM YOUR DESIGN SYSTEM**: bind the variable or apply the text
     style. Never type the raw value for these.
   - **CLOSE, NOT EXACT**: build with the HTML's value; do not silently swap to
     the nearest style. A near match changes the design.
   - **NOT IN YOUR DESIGN SYSTEM**: build with the HTML's value.
4. **Never create new variables or styles** for missing values. Tokens are the
   design system; if you think it should gain one, ask the user.
5. Reuse an existing component (`create_component_instance`) when one matches
   a page element exactly: button, card, nav item, input. If it only looks
   similar (different padding, colour, radius or text style), do not use it;
   see "Components" below.

## Step 3 — Build with a flat structure

Build one top-level frame per page at the desktop width (1440 unless the page
clearly targets another width), then one frame per section, top to bottom.
Batch the work with `figma_batch`: one batch per section is a good size.

### Choose the layout per container

| The page declares | Build it as | Tool |
|---|---|---|
| `display: grid` with N equal columns (N ≥ 2) | Figma Grid, N columns | `set_grid_layout` |
| A heading above a grid of equal cards | One Grid: heading spans all columns, cards directly inside | `set_grid_layout` with `spans` |
| Flex row that wraps equal items | Figma Grid, columns = what the desktop shows | `set_grid_layout` |
| Flex row, no wrap (nav, button group, logo row) | Auto Layout horizontal | `set_auto_layout` |
| Flex column, or plain stacked blocks | Auto Layout vertical | `set_auto_layout` |
| A `div` with one child and no background, border, padding or radius | **No frame.** Put the child in the parent | none |

Rules that keep the tree clean:

- **Never mirror the DOM.** HTML wraps things in divs for CSS reasons. Create a
  frame only when it has a visual (fill, stroke, radius, shadow) or a layout
  job (padding, gap, direction, grid). A heading and its cards need one Grid
  frame, not `section > container > row > col > card`. Flattening is allowed
  only when the render stays identical; if removing a wrapper would move,
  resize or restyle anything, keep the frame.
- **Prefer Grid when it removes a wrapper.** If a section is "heading + row of
  equal cards", make the section itself the Grid with the heading spanning
  every column. Do not add a row frame.
- **Use Auto Layout when content flows in one direction** and a Grid would
  not remove a layer.
- **Sizing:** containers and text blocks Fill width and Hug height; buttons Hug
  both. Never give content a fixed height. Images, icons and avatars keep the
  fixed size the page declares.
- **Alignment:** translate CSS to Auto Layout values; never type a CSS keyword.
  `justify-content` → `primaryAxisAlignItems` (`flex-start` MIN, `center`
  CENTER, `flex-end` MAX, `space-between` SPACE_BETWEEN). `align-items` →
  `counterAxisAlignItems` (`flex-start` MIN, `center` CENTER, `flex-end` MAX,
  `baseline` BASELINE). `align-items: stretch`, the CSS default, has no frame
  value: set `counterAxisAlignItems` to MIN and make each child Fill the cross
  axis (width in a vertical frame, height in a horizontal one). Use the
  alignment clause each recommendation prints (primary/counter, or cells for
  Grid); FILL there means child layoutSizing FILL.
- **Gaps and padding:** set them from the matched variables with
  `apply_variable_bindings` (`itemSpacing`, `paddingTop/Right/Bottom/Left`,
  and `gridRowGap` / `gridColumnGap` on Grid frames). Raw numbers only for
  values under NOT IN YOUR DESIGN SYSTEM.
- **Text:** create with `create_text`, then `set_text_style_id` for matched
  styles. Text is Fill width and Auto Height so it wraps naturally. Keep every
  inline difference the page has (a bold word, a link colour, a line break).
- **Colours:** bind with `apply_variable_bindings` (`fills/0/color`,
  `strokes/0/color`) for matched colours. Borders, shadows, opacity and
  gradients are built too, not dropped because no token exists.
- **Names:** name layers by role (`Section-WorkProcess`, `Card-Step`,
  `Heading-Title`), never `Frame 12`.

### Building a Grid

Call `set_grid_layout` **after** the children exist inside the frame, in
reading order:

```
set_grid_layout {
  nodeId: "<section frame>",
  columns: 4,
  rowGap: 60,
  columnGap: 16,
  spans: [{ "nodeId": "<heading>", "columnSpan": 4 }]
}
```

It places the children in order, spans the heading, and restores the frame
if Figma refuses anything. If it fails, report the error; **never imitate a
Grid** with `ungroup_nodes`, `move_node` or `set_auto_layout NONE`.

### Images and icons

Place every entry of IMAGES & ICONS in its section, at its declared size.

- **Inline SVG icon or illustration:** the main report gives only the asset
  id, not the markup. Call `analyze_html` again with
  `svgMarkupFor: ["asset-N", …]`, listing every icon you need in one call, to
  get self-contained markup. Sprite icons (`<use href="#…">`) arrive already
  resolved. Then use `set_svg` with that markup and size it to the declared
  width and height.
- **`<img>`, `<picture>`, video poster, CSS background:** create a frame or
  rectangle at the declared size (with the page's radius), then call
  `place_html_image` with that `nodeId`, the asset's `source` exactly as
  listed, `pageSource` (the URL or `.html` path given to `analyze_html`), and
  a `scaleMode` taken from `object-fit` / `background-size`: `cover` → `FILL`,
  `contain` → `FIT`, a repeating background → `TILE`. The server fetches the
  bytes itself, so images from any host and local files next to the page work.
- If `place_html_image` fails for a web URL, try `set_image_fill` with
  `sourceType: "url"`.
- If an image still cannot be placed, keep the frame at its exact size, name
  it `Image-Missing-<name>`, and list it under "Not identical" in the report.
  Never delete the space it occupies.

### Components

Decide per element that the design system has no exact component for:

| The element | Build it as |
|---|---|
| Appears 2 or more times with the same structure (card, button, nav item, list row, badge) | **A new component**, with an instance at every place it appears |
| Appears once | Plain layers, exactly as the page shows it |

To create one:

1. Build the first occurrence with plain layers, bound to tokens like
   everything else, and check it against the source.
2. `create_component_from_node` on it. Name it by role (`Card-Pricing`,
   `Button-Primary`).
3. Move the main component into a frame named `Components — from HTML`,
   placed beside the page (same parent, to the right of the page frame), with
   vertical Auto Layout so every new component is listed there.
4. Put an instance (`create_component_instance` with the returned key) at
   every occurrence, including the first. Override only what differs per
   occurrence (text, image), never the styling.
5. Never create a component for a one-off element, and never change an
   existing design-system component to fit the page.

## Step 4 — Import Notes

1. Create a frame named `Import Notes` beside the imported page (same parent,
   80px to the right), vertical Auto Layout, padding 32, gap 12, white fill.
2. Add text: the source URL or file, the date, then the **IMPORT NOTES**
   block from `match_design_tokens` exactly as printed, followed by a short
   "Layout decisions" list (which sections became Grid, which Auto Layout, and
   why) and a "New components" list (name and how many instances).

## Step 5 — Optimise and verify

1. Call `clean_layers` with `dryRun: true` on the imported page and follow its
   scan → ask → apply flow for anything it proposes. Apply nothing that would
   change the render.
2. `export_node_as_image` the page and compare it with the source screenshot,
   section by section: order, text, line breaks, colours, spacing, sizes,
   images, icons, borders and shadows.
3. Also check the counts: every TEXT CONTENT item exists as a text layer and
   every IMAGES & ICONS entry is placed.
4. Look specifically at what the analysis cannot see: icon colours set by CSS
   classes rather than `currentColor`, images or text a script adds after
   loading, and anything drawn with CSS alone (pseudo-elements, gradients on
   borders). Where the screenshot differs, fix it; where it cannot be fixed,
   list it under "Not identical".
5. Fix every difference and export again. Repeat until nothing differs. Only
   call the import identical after a comparison shows it; without a source
   screenshot, say that identity was not verified.

## Final report to the user

Keep it short, in the user's language:

- **Built:** the page frame name and its sections.
- **Reused from your design system:** counts of colours, text styles, spacing
  and radius tokens bound, and existing components used.
- **Not in your design system, created with the HTML's values (Done):** the
  list from the Import Notes.
- **New components:** names and instance counts, in `Components — from HTML`.
- **Layout:** which sections use Grid and which use Auto Layout.
- **Not identical:** every remaining difference from the source and why
  (fonts that are not installed, an image that could not be loaded, content
  a script adds, `justify-content: space-around` / `space-evenly`, which the
  analysis reports as having no Figma equivalent). If this list is empty, say
  how it was verified.
