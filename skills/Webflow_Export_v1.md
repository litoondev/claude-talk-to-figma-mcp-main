---
id: Webflow_Export_v1
title: Figma to Webflow
description: >
  Rebuild a Figma frame as a real Webflow page — every section, text, image and
  icon, nothing left out and nothing restyled — with Auto Layout translated to
  flex and grid, Figma variables mapped onto Webflow variables, repeated
  elements turned into Webflow components, and the file's breakpoint modes
  re-authored on Webflow's own breakpoints. Use this skill whenever the user
  asks to export, convert, push, publish, build or "ship" a Figma design, page,
  screen or section into Webflow, or says "figma to webflow", "design to
  webflow", "build this in webflow", "make this a webflow page", or hands over a
  Figma frame and asks for a live site. Requires the Webflow MCP server to be
  connected alongside this plugin; this skill reads Figma and instructs the
  Webflow tools, it does not call the Webflow API itself.
triggers:
  - figma to webflow
  - design to webflow
  - export to webflow
  - convert figma to webflow
  - build this in webflow
  - push this to webflow
  - make this a webflow page
  - rebuild this design in webflow
  - webflow export
  - figma webflow
  - turn this figma into a webflow site
  - recreate this frame in webflow
uses:
  - join_channel
  - check_figma_connection
  - get_design_system
  - get_document_info
  - get_pages
  - get_selection
  - get_node_info
  - get_nodes_info
  - get_variables
  - get_node_variable_bindings
  - find_variable
  - get_styles
  - get_local_components
  - scan_text_nodes
  - analyze_responsive
  - validate_responsive
  - export_node_as_image
  - export_assets
  - get_svg
  - set_section_scope
  - clear_section_scope
  - figma_batch
  - get_token_usage
---

# FIGMA → WEBFLOW

Turn a Figma frame into a Webflow page that is **the same as the design**. Four
rules hold for the whole export and override any shortcut below:

1. **Identical.** Every section, text, image, icon, border, shadow and overlay
   the design shows gets built. Nothing is left out, nothing is added.
2. **Linked to the system.** Every colour, type ramp, spacing and radius that
   exists as a Figma variable becomes a Webflow variable and is referenced —
   never typed as a raw value in a style.
3. **Classes and components, not one-off styling.** Structure that repeats
   becomes a Webflow component; styling that repeats becomes a reused class.
4. **Zero compromise.** No value is rounded, swapped for a "close" token,
   restyled or simplified. When something cannot be reproduced in Webflow, say
   so in the report; never ship a quiet approximation.

---

## This is stage 2 of two

| | Skill | Job |
| --- | --- | --- |
| Stage 1 | `Webflow_Prepare_v1` | Duplicate the Figma page and restructure it into Client-First shape, in Figma. The design does not change. |
| **Stage 2** | **this skill** | Walk the prepared page and build it in Webflow. |

**Check for a prepared page first.** `get_pages`, and look for one named
`Webflow Ready — …`. If it exists, export from **that** page, not from the
original design.

If it does not exist, say so and offer stage 1 before continuing:

> There is no Webflow Ready page in this file. I can export directly from the
> design, but preparing it first is faster, cheaper and lets you review the
> structure in Figma before anything reaches Webflow. Prepare it first?

Exporting directly still works — every rule below holds either way — but it
makes one pass read the Figma tree, decide the mapping and write the site all at
once, with every write a round trip to the Designer. Prefer stage 1.

### What a prepared page changes

On a prepared page, the structural decisions are already made, so this skill
stops guessing and starts copying:

- **Layer names are the class names.** `hero-header_component`, `padding-global`,
  `heading-style-h1`, `button is-primary` — apply them verbatim. Do not
  re-derive, re-case or improve them. A space in a layer name means a combo
  class: `button is-primary` is the class `button` plus the combo `is-primary`.
- **The skeleton is already there.** `page-wrapper` › `main-wrapper` ›
  `section_…` › `padding-global` › `container-…` › `padding-section-…`. Build it
  as it stands; the nesting decisions were made and reviewed in stage 1.
- **Auto Layout is already the flex model.** Translate it directly with the Step
  3 tables. Nothing needs collapsing — stage 1 did that.
- **Components already exist** as Figma components, with variants named for the
  combo classes they become.

Where the prepared page and the rules below disagree, the prepared page wins on
*structure* and the rules below win on *correctness* — a fixed height that
survived stage 1 is still a defect, and is still built as `auto`.

---

## The acceptance standard

This is the bar the finished page is judged against. It is not advisory. If any
line here cannot be met, stop and say which one and why, before building
further — a page that fails one of these is not "nearly done", it is not done.

**1. Pixel-perfect replication.**
The Webflow page matches the Figma file exactly. Not one section, text, shadow,
border, icon or spacing value is missing or approximated, however small. The
responsive behaviour matches Figma's breakpoints exactly too (see Step 5 for
where Figma's breakpoints and Webflow's do not line up — that gap is handled,
never ignored).

**2. Global variables and tokens, never hard-coded values.**
- **Colour:** every colour is a Webflow **global variable**. A hard-coded colour
  is a defect, including in hover states, borders, shadows and gradients.
- **Spacing:** margin, padding, gap and layout spacing come from spacing
  variables or a shared global class, matching Figma exactly.
- **Typography:** font size, line height, weight and family are set on the
  **global tag** first — H1–H6 and the body/paragraph tag — not on a class per
  heading. Classes only carry what genuinely differs from the base tag.

**3. Component-based build.**
Anything appearing more than once — button, card, nav bar, footer, list row —
is a reusable Webflow **component**, not a copied block. Figma component
**properties and variants** are carried across as Webflow component properties
and variants, so the same switch the designer had is the switch the developer
gets.

**4. Zero repetition, and self-audit before handing anything over.**
- A correction is applied **once, everywhere it applies**. If the user has to
  give the same instruction twice, that is a process failure: when told to fix
  something, immediately find every other instance of the same mistake and fix
  those too, then say how many you found.
- **Never hand over a preview link before auditing it yourself.** Step 7 is the
  gate. Comparing the built page against the Figma screens, screen by screen and
  breakpoint by breakpoint, is your job and not the designer's.

---

This skill is the inverse of `Html_Import_v1`. Where that one reads a page and
builds Figma, this one reads Figma and builds a page.

---

## What this skill does and does not do

This plugin has **both halves** of Webflow, and they arrive by different routes:

| | Tools | Route | Needs |
| --- | --- | --- | --- |
| **Canvas** — elements, classes, tag styles, variables, components | `webflow_designer_*` (12) | The relay, to this plugin's own Webflow Designer Extension | The extension open and joined to this channel |
| **Content** — sites, pages, SEO, page copy, CMS, publishing | `webflow_*` (16) | Webflow's Data API over HTTP | A `WEBFLOW_TOKEN` with the right scopes |

**Use these tools. Do not tell the user to install Webflow's own MCP server or
its Bridge App** — this plugin replaces both, and routes by channel rather than
by site id so one agent gets one editor.

### If the `webflow_designer_*` tools are missing

They are off by default, because they cost schema on every request and do
nothing without a running extension. If you cannot see them, say exactly this
rather than reaching for another integration:

> The Webflow Designer tools are turned off. Enable them in Claude Desktop →
> Settings → Extensions → Claude Talk to Figma → **Webflow Designer tools**,
> then quit Claude Desktop completely and reopen it.

Then the extension has to be running: see `webflow_extension/README.md`. To test
without a Webflow account at all, `npm run webflow:harness -- <channel-id>`
stands in for it.

### Canvas tools, by job

| Job | Tool |
| --- | --- |
| Confirm the extension is connected | `webflow_designer_status` |
| Read the element tree | `webflow_designer_get_structure` |
| Read existing classes | `webflow_designer_get_styles` |
| Read existing variables | `webflow_designer_get_variables` |
| Create variables from Figma tokens | `webflow_designer_create_variables` |
| Set base typography on h1–h6 / paragraph / body | `webflow_designer_set_tag_style` |
| Create or update a class | `webflow_designer_set_style` |
| Create an element | `webflow_designer_create_element` |
| Replace copy | `webflow_designer_set_text` |
| Remove an element | `webflow_designer_delete_element` |
| Make a component | `webflow_designer_create_component` |
| Place an instance | `webflow_designer_insert_component` |

### Content tools, by job

| Job | Tool |
| --- | --- |
| Find the site and its ids | `webflow_list_sites`, `webflow_get_site` |
| Pages and their SEO | `webflow_list_pages`, `webflow_get_page`, `webflow_update_page_settings` |
| Copy inside existing text nodes | `webflow_get_page_content`, `webflow_update_page_content` |
| CMS | `webflow_list_collections`, `webflow_get_collection`, `webflow_list_items`, `webflow_create_items`, `webflow_update_items` |
| Publishing | `webflow_publish_items`, `webflow_publish_site` |

Creating a site (`webflow_create_site`) needs an **Enterprise** workspace; on any
other plan it returns 403 and the site is created in the Webflow dashboard.

---

## Step 0 — Preconditions

Check all four before touching anything. Each failure has a different fix, so
report which one failed.

1. **Figma side.** `check_figma_connection`, then `join_channel`. Confirm the
   frame to export with `get_selection`, or ask the user which frame.
2. **Webflow canvas.** Call `webflow_designer_status`. It answers only when this
   plugin's Webflow Designer Extension is open in the Designer's Apps panel
   (press `E`) and joined to **this same channel**. If the tool does not exist,
   it is switched off — see above. If it exists but errors, the extension is not
   running or is on another channel. The content tools need none of this; they
   are addressed by id over HTTP.
3. **Target.** Ask which site and which page. Never create a page on a site the
   user has not named. Use `data_sites_tool` to list sites if the user is
   unsure.

   ⚠️ **One agent per site.** The bridge routes Designer calls by `siteId` and
   delivers them to **every** Bridge App session connected for that site, with
   no queue and no locking. Webflow's real-time collaboration resolves
   overlapping edits as last-write-wins, so a second agent — or a teammate
   editing the same page by hand — will silently overwrite this run. Before
   building, confirm with the user that nobody else is working on this site
   right now, and say plainly that concurrent edits cannot be detected.
4. **Reference screenshot.** `export_node_as_image` on the source frame at every
   breakpoint you are going to build. This is the only way Step 7 can verify
   anything. Without it, say plainly at the end that identity was not verified.

---

## Step 1 — Read the design

Read from the **Webflow Ready** page when one exists, otherwise the design page.
Scope first so a large file does not flood the context: `set_section_scope` on
the frame being exported, and `clear_section_scope` when done.

On a prepared page, `get_nodes_info` is doing something different from the usual
read: the names it returns are the answer, not evidence toward one. Record every
layer name exactly as written.

1. `get_design_system` — the file's variables, styles and components in one
   call. This is the map for Step 2.
2. `get_variables` — every collection, with its modes. Note the breakpoint
   collection if one exists (commonly `Desk` 1440 / `Tab` 768 / `Mobi` 320).
3. `get_styles` and `get_local_components` — text/colour/effect styles and the
   component set.
4. `get_node_info` on the frame, then `get_nodes_info` per section. Record for
   every node: `layoutMode`, `layoutWrap`, `itemSpacing`, `counterAxisSpacing`,
   padding, `primaryAxisAlignItems`, `counterAxisAlignItems`,
   `layoutSizingHorizontal`, `layoutSizingVertical`, `layoutGrow`, fills,
   strokes, effects, `cornerRadius`, and the text properties.
5. `get_node_variable_bindings` on every node that has them. A bound property is
   the difference between "this is 40px" and "this is `spacing/40`" — the second
   becomes a Webflow variable reference, the first becomes a literal.
6. `scan_text_nodes` — the full copy. Use it exactly; never invent, shorten or
   "improve" text.
7. `analyze_responsive` on the frame — where fixed heights, fixed widths and
   non-hugging content will cause trouble once it is flex.

Batch the reads with `figma_batch`: one batch per section is a good size.

---

## Step 2 — Map Figma variables to Webflow variables

Do this **before** creating a single element. Styles created against literals
have to be rewritten later; styles created against variables do not.

1. For each Figma variable collection, create the matching Webflow variable
   collection with `webflow_designer_create_variables`. Keep the Figma names verbatim
   (`spacing/40`, `color/brand/primary`) so the two systems stay traceable.
2. Type mapping:

   | Figma variable type | Webflow variable type |
   | --- | --- |
   | `COLOR` | Color |
   | `FLOAT` used for spacing, gap, padding | Size |
   | `FLOAT` used for radius | Size |
   | `FLOAT` used for font size | Size |
   | `STRING` used for font family | Font family |
   | `BOOLEAN` | no equivalent — resolve it at build time and report it |

3. **Modes do not map.** Figma resolves a mode per node; Webflow resolves a
   variable per breakpoint via the cascade. Create the variable once, from the
   **desktop** mode value, and re-author the tablet and mobile values as
   breakpoint overrides in Step 6. Do not create three variables named
   `spacing-40-tab` and so on.
4. **A value with no Figma variable behind it is escalated, not hard-coded.**
   Never invent a token silently, and never type a raw colour. Those two rules
   collide whenever the design uses a colour the Figma file never tokenised, so
   resolve it out loud rather than picking for the user:

   > This colour (#xxxxxx, used on <element>) has no variable in the Figma file.
   > Should I add it as a Webflow variable, or is it intentionally a one-off?

   Spacing and radius without a token follow the same rule. Whatever is decided
   goes in the Export Notes under "not tokenised".

5. **Typography goes on the global tags first.** Set font family, size, line
   height, weight and letter spacing on the **tag selector** — H1, H2, H3, H4,
   H5, H6, paragraph, and the body tag for the base — from the matching Figma
   text style. This is what makes an unstyled heading anywhere on the site come
   out right, and it is the difference between a design system and a pile of
   classes.

   Only after the tags are set, add a class for a text style that genuinely
   differs from its tag (`Heading-H2-Light`, `Body-Large`), and let it carry
   **only the properties that differ**. Never restate the tag's values in the
   class: a duplicated line-height is the thing that silently breaks when the
   base changes later.

   A Figma text style with no obvious tag (an eyebrow, a caption, a button
   label) becomes a class named after the style.

---

## Step 3 — Translate layout

This is the whole job. Get the table right and the page is right.

### Structure

| Figma | Webflow |
| --- | --- |
| Frame, `layoutMode: VERTICAL` | Div block, `display: flex`, `flex-direction: column` |
| Frame, `layoutMode: HORIZONTAL` | Div block, `display: flex`, `flex-direction: row` |
| Frame, `layoutWrap: WRAP` | add `flex-wrap: wrap` |
| Grid Auto Layout frame | Div block, `display: grid`, columns from the Figma grid |
| Frame, `layoutMode: NONE`, with absolute children | Div block, `position: relative`; children `position: absolute` at their offsets |
| Top-level page frame | Section |
| Section's inner max-width frame | Container, or a div with `max-width` + `margin: 0 auto` |
| Group | **no element** — put the children in the parent |
| Frame with one child, no fill, stroke, radius or padding | **no element** — put the child in the parent |
| Text node | Heading (`h1`–`h6`) if it uses a heading style, otherwise Paragraph or Text block |
| Rectangle / frame with an image fill | Image, or a div with a background image |
| Vector / boolean / icon | Embed with inline SVG, or an Image if it is raster |
| Component instance | Component instance (`webflow_designer_insert_component`) |
| Frame with `clipsContent: true` | add `overflow: hidden` |

**Never mirror the Figma layer tree.** Designers nest frames for organisation
the same way HTML nests divs for CSS. Create an element only when it has a
visual job (fill, stroke, radius, shadow) or a layout job (padding, gap,
direction, grid). Flattening is allowed **only** when the render stays
identical; if removing a wrapper would move, resize or restyle anything, keep
it.

### Sizing

| Figma | Webflow |
| --- | --- |
| `layoutSizingHorizontal: FILL` | `width: 100%`, or `flex: 1` when it shares a row |
| `layoutSizingHorizontal: HUG` | `width: auto` |
| `layoutSizingHorizontal: FIXED` | `width: <n>px` — only for icons, avatars, image crops |
| `layoutSizingVertical: HUG` | `height: auto` — **the default for all content** |
| `layoutSizingVertical: FILL` | `align-self: stretch` |
| `layoutSizingVertical: FIXED` | `height: <n>px` — icons and deliberate crops only |
| `layoutGrow: 1` | `flex: 1` |
| `minWidth` / `maxWidth` | `min-width` / `max-width` |

**Never put a fixed height on a text element, card, section or content
wrapper.** If the Figma node carries one, that is a defect in the source, not a
spec to copy — build it `auto` and list it in the Export Notes. Text must be
free to wrap to more lines on tablet and mobile.

### Spacing and alignment

| Figma | Webflow |
| --- | --- |
| `itemSpacing` | `gap` (`column-gap` on a row, `row-gap` on a column) |
| `counterAxisSpacing` on a wrapping frame | `row-gap` |
| Grid `rowGap` / `columnGap` | `row-gap` / `column-gap` |
| `paddingTop/Right/Bottom/Left` | `padding-*` |
| `primaryAxisAlignItems: MIN / CENTER / MAX / SPACE_BETWEEN` | `justify-content: flex-start / center / flex-end / space-between` |
| `counterAxisAlignItems: MIN / CENTER / MAX / BASELINE` | `align-items: flex-start / center / flex-end / baseline` |

Where the Figma property is bound to a variable, set the Webflow property to the
**variable reference**, not the resolved number. Raw numbers only for values
that had no binding.

### Appearance

| Figma | Webflow |
| --- | --- |
| Solid fill | `background-color`, or `color` on text |
| Gradient fill | `background-image: linear-gradient(...)` |
| Image fill, `scaleMode: FILL` | `object-fit: cover` / `background-size: cover` |
| Image fill, `scaleMode: FIT` | `object-fit: contain` / `background-size: contain` |
| Stroke | `border`, with `border-style: solid` and the stroke weight |
| `cornerRadius` | `border-radius` |
| `DROP_SHADOW` effect | `box-shadow` |
| `LAYER_BLUR` | `filter: blur(...)` |
| `BACKGROUND_BLUR` | `backdrop-filter: blur(...)` |
| `opacity` | `opacity` |
| `blendMode` | `mix-blend-mode` |

---

## Step 4 — Build

Build **top to bottom, one section at a time**, verifying each section before
starting the next. A whole page built blind is a whole page to debug.

Two ways to create elements; pick per section:

Build with `webflow_designer_create_element`, one element at a time, passing
`parentId` from the element you just created so the tree grows in reading order.
There is no bulk-HTML shortcut here: the Designer API builds elements, not
markup, and a structure assembled one node at a time is one you can verify one
node at a time.

As you go:

1. Create the section element first, then its children in reading order.
2. Create the class with `webflow_designer_set_style` **before** applying it, and give
   every repeated element the **same class** — never style two identical cards
   separately. Name classes by role, lower-case and hyphenated
   (`section-hero`, `card-feature`, `heading-title`).
3. Apply properties referencing the Step 2 variables.
4. Confirm placement with `webflow_designer_get_structure` before moving on.

### Components

Decide per element:

| The element | Build it as |
| --- | --- |
| A Figma component instance | A Webflow component instance |
| Appears 2+ times with the same structure, not a Figma component | **A new Webflow component** |
| Appears once | Plain elements with a reused class |

To create one: build the first occurrence, confirm it against the design,
create the component with `webflow_designer_create_component`, then place
instances with `webflow_designer_insert_component`. Override only what differs
per occurrence (text, image), never the styling.

`webflow_designer_create_component` reports any property or variant this
Designer API version cannot define, rather than flattening it into a hard-coded
value. When it does, pass the report on to the user — those are set by hand in
the Designer, and section 17.3 is not met until they are.

**Carry the Figma component's properties and variants across.** A component
rebuilt as a static block loses the thing that made it a component, and the
developer inherits a page they cannot change in one place.

| In Figma | In Webflow |
| --- | --- |
| Text property | Component property, type Text |
| Boolean property (show/hide a layer) | Component property, type Visibility |
| Instance swap property | A slot, filled per instance |
| Image/fill property | Component property, type Image |
| Link or URL property | Component property, type Link |
| Variant property with a set of values (Size: S/M/L, Style: Primary/Secondary) | A variant of the Webflow component per value, with the same names |

Rules:

- **Keep the names.** A Figma property called `Button Style` with values
  `Primary` / `Secondary` keeps those exact names in Webflow. Renaming breaks
  the designer's ability to talk about it.
- **Variants that only change styling** become Webflow component variants.
  Variants that change *structure* (an extra row, a different arrangement) may
  need separate components — decide, then say which you chose and why.
- **A property Webflow cannot express** is reported in the Export Notes, never
  quietly flattened into a hard-coded value.

### Images, icons and assets

1. `export_assets` on the frame for raster images at 2x, and `get_svg` for
   vector icons.
2. Upload through Webflow's asset tooling and place the returned URLs. Use
   `asset_tool` to organise folders and to list what is already there — reuse an
   existing asset rather than uploading a duplicate. `get_image_preview`
   confirms a URL resolves to the right image.
3. If an upload path is not available in the connected tool set, **stop and ask
   the user to upload the exported files**, then reference them. Do not
   hot-link the Figma export URLs — they expire.
4. Inline SVG icons go in an Embed element, at the declared width and height.
5. If an image cannot be placed, keep the element at its exact size, name it
   `image-missing-<name>`, and list it under "Not identical". Never delete the
   space it occupies.

### Repeating content

A row of cards driven by real content (blog posts, team members, products,
testimonials) should become a **CMS Collection** plus a Collection List, not
eight hand-built divs. Create the Collection and fields with `data_cms_tool`,
bind the Collection List, and style the single Collection Item. Ask the user
first — this is a structural decision about their site, not a design decision.

---

## Step 5 — Breakpoints

⚠️ **Figma's breakpoints and Webflow's are not the same numbers.** Read this
before re-authoring anything.

| Webflow breakpoint | Applies at | Closest Figma mode |
| --- | --- | --- |
| Desktop (base) | 992px and up | `Desk` 1440 |
| Tablet | up to 991px | `Tab` 768 |
| Mobile landscape | up to 767px | — |
| Mobile portrait | up to 479px | `Mobi` 320 |

Consequences you must handle rather than ignore:

- A design authored at **768** is being asked to hold from **768 to 991** in
  Webflow. Check that the tablet layout still reads at 991px, not just at 768.
- There is **no Figma mode for the 480–767 band**. Decide with the user: let it
  inherit tablet, or interpolate between tablet and mobile. Never leave it
  unchecked — it is the band most likely to break.
- Webflow's cascade runs **downward only**: a value set on Desktop flows to
  Tablet and Mobile; a value set on Mobile does not flow up. So author
  **Desktop first, completely**, then edit down.
- Larger breakpoints (1280 / 1440 / 1920) are optional and off by default. If
  the design is authored at 1440 and must be pixel-exact there, ask whether to
  enable the 1440 breakpoint rather than assuming.

Process, one breakpoint at a time:

1. Finish Desktop completely and verify it (Step 7) before touching Tablet.
2. Switch the Figma variable mode to `Tab` and re-read the bound values. Set
   only the properties that actually differ as Tablet overrides.
3. Verify Tablet at both 768 and 991.
4. Then Mobile portrait from the `Mobi` mode, verified at 320 and 479.
5. Check the 480–767 band last, per the decision above.

Do not work two breakpoints at once. Do not re-author a value that the cascade
already delivers correctly — every unnecessary override is a future bug.

---

## Step 6 — Export Notes

Create a page or a note the user can keep, recording:

- Source: the Figma file, frame name and node id, and the date.
- **Variables created**, with the Figma name each one came from.
- **Classes created**, and which Figma text/colour style each maps to.
- **Components created**, and instance counts.
- **Not tokenised**: every literal value written because no Figma variable
  existed behind it.
- **Breakpoint decisions**: what was set on Desktop, what was overridden where,
  and what was decided for the 480–767 band.
- **Not identical**: every remaining difference and why.

---

## Step 7 — Verify

Verification is not optional and it is not "it looks about right".

1. Publish to the Webflow staging domain, or take a Designer preview.
2. Compare against the Step 0 Figma screenshot **section by section, at each
   breakpoint**: order, copy, line breaks, colours, spacing, sizes, images,
   icons, borders, shadows.
3. Check the counts: every text node from `scan_text_nodes` exists on the page,
   every exported asset is placed.
4. Check specifically the things that break in translation:
   - text that wrapped to a different number of lines, and whether anything
     below it was pushed or clipped;
   - any element that still carries a fixed height;
   - `space-around` / `space-evenly`, which Figma has no equivalent for;
   - fonts that are in Figma but not uploaded to the Webflow site — the page
     will silently fall back, and the fallback is not the design;
   - hover, focus and active states, which the Figma frame does not show at all.
     Ask the user for them rather than inventing them.
5. Fix every difference and compare again. Repeat until nothing differs.
6. Run `validate_responsive` on the Figma source as a cross-check that the
   design itself was sound at each breakpoint.

Only call the export identical **after** a comparison shows it. Without a
source screenshot, say that identity was not verified.

### The self-audit gate

**Do not give anyone a preview link until this checklist passes.** Checking is
your job, not the designer's; a link handed over unaudited spends their time
finding what you could have found yourself.

Walk the built page against the Figma screens, **screen by screen and breakpoint
by breakpoint**, and confirm every line:

- [ ] Every section from the Figma frame exists, in the same order.
- [ ] Every text string matches, including case and line breaks.
- [ ] Every image and icon is placed, at the right size and crop.
- [ ] Every border, shadow, radius, gradient and opacity is present.
- [ ] Spacing matches — padding, margin and gap, at every breakpoint.
- [ ] **No hard-coded colour anywhere.** Spot-check hover states, borders and
      shadows specifically; they are where raw hex survives an audit.
- [ ] Typography comes from the tag styles, and classes restate nothing.
- [ ] Every repeated element is a component instance, not a copy.
- [ ] Figma component properties and variants exist as Webflow properties and
      variants, with the same names.
- [ ] Desktop, tablet, mobile landscape and mobile portrait all checked — and
      tablet checked at **both 768 and 991**, per Step 5.
- [ ] No text clipped, no element overflowing, no horizontal scroll.

If a line fails, fix it and re-audit. State in the handover that you ran this
audit — and if you could not check something, say which line and why, rather
than leaving the checklist implied.

### Fixing a correction once, everywhere

When the user reports a defect, **do not fix only the instance they pointed at.**
Search the page for every other occurrence of the same mistake, fix those too,
and report the count:

> Fixed. The same hard-coded colour was on 4 other elements — all now bound to
> `color/brand/primary`.

Having to give the same instruction twice is a failure of this step.

---

## Final report to the user

Keep it short, in the user's language:

- **Built:** the Webflow site, page, and the sections created.
- **Variables:** how many created, from which Figma collections.
- **Classes and components:** names and instance counts.
- **Not tokenised:** the literal values, and why.
- **Breakpoints:** what was authored where, and what was decided for 480–767.
- **Not identical:** every remaining difference and why. If this list is empty,
  say how it was verified.
- **Needs a human:** hover/focus states, interactions, SEO fields, form actions,
  and anything else the Figma frame could not express.
- **Self-audit:** confirm the Step 7 checklist was run, and name any line you
  could not verify.

Finish with `get_token_usage`.
