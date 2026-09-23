---
id: Webflow_Prepare_v1
title: Prepare a Figma Page for Webflow
description: >
  Stage 1 of the Figma → Webflow pipeline. Duplicates a Figma page to a new
  "Webflow Ready" page and restructures it into Client-First shape — the
  page-wrapper / main-wrapper / section_ / padding-global / container /
  padding-section skeleton, Client-First class names on every layer, utility
  classes for typography and spacing, components for anything repeated — while
  the rendered design stays pixel-identical to the original. Use this skill
  whenever the user asks to prepare, restructure, rename or get a Figma design
  ready for Webflow, or says "make this Webflow ready", "apply Client-First",
  "structure this for Webflow", or asks to convert a design to Webflow before
  any Webflow work has been done. The original page is never modified. Run this
  before Webflow_Export_v1, which walks the prepared page and builds the site.
triggers:
  - prepare for webflow
  - webflow ready
  - make this webflow ready
  - structure this for webflow
  - client-first
  - apply client first
  - client first naming
  - rename layers for webflow
  - restructure for webflow
  - figma to webflow prep
  - get this ready for webflow
  - webflow structure in figma
uses:
  - join_channel
  - check_figma_connection
  - get_design_system
  - get_document_info
  - get_pages
  - set_current_page
  - get_selection
  - get_node_info
  - get_nodes_info
  - get_styles
  - get_local_components
  - get_variables
  - get_node_variable_bindings
  - find_variable
  - apply_variable_bindings
  - scan_text_nodes
  - clean_layers
  - convert_layout
  - set_grid_layout
  - set_auto_layout
  - set_layout_sizing
  - create_frame
  - insert_child
  - group_nodes
  - ungroup_nodes
  - clone_node
  - rename_node
  - move_node
  - delete_node
  - reorder_node
  - create_component_from_node
  - create_component_instance
  - set_section_scope
  - clear_section_scope
  - export_node_as_image
  - analyze_responsive
  - validate_responsive
  - figma_batch
  - get_token_usage
---

# PREPARE A FIGMA PAGE FOR WEBFLOW

Turn a Figma page into a **Webflow-shaped** Figma page: same design, different
structure. Nothing here touches Webflow.

## Why this is a separate stage

Converting a Figma design straight to Webflow asks one pass to do three jobs at
once — read the Figma tree, decide the Webflow mapping, and write the site — with
every write a round trip to the Designer. It is slow, expensive, and the first
time anyone sees the structural decisions is when they are already in the live
site.

Doing the structural thinking **in Figma first** is cheaper on every axis:

- The restructuring tools here are mature and already tested against real files.
- The designer can review the result in Figma, before Webflow is touched.
- Stage 2 becomes a walk over a decided structure instead of a judgment call per
  section.
- The prepared page is a deliverable by itself — a developer can hand-build from
  it.

Four rules hold for the whole job:

1. **The design does not change.** This is structural work. Same pixels, same
   copy, same colours, same spacing. Verified by comparison in Step 9, not by
   assumption.
2. **The original is never modified.** All work happens on the duplicate.
3. **Client-First naming, exactly.** Layer names become Webflow class names
   verbatim in stage 2, so a name that is wrong here is a class that is wrong
   there.
4. **Structure for Webflow, not for Figma.** Figma tolerates nesting that
   Webflow should not inherit. Collapse it here.

---

## Step 0 — Preconditions

1. `check_figma_connection`, then `join_channel`.
2. `get_pages` — identify the source page. If the user selected a frame rather
   than naming a page, `get_selection` and confirm which page it belongs to.
3. `get_design_system`, `get_variables`, `get_styles`, `get_local_components` —
   the tokens and components that must survive the restructure.
4. `export_node_as_image` on the source page's main frame, at every breakpoint.
   This is the reference Step 9 compares against. Without it, say plainly at the
   end that identity was not verified.

---

## Step 1 — Duplicate, never edit in place

Create a new page named **`Webflow Ready — <source page name>`** and copy the
source frames into it.

`duplicate_page` is the tool for this. It is outside the `standard` profile, so
call it through `figma_batch`. If it is unavailable, `clone_node` each top-level
frame onto a new page instead.

Then `set_current_page` to the new page and `set_section_scope` on the frame
being worked on, so a large file does not flood the context. `clear_section_scope`
when the section is done.

**From here on, every edit is on the duplicate.** If you find yourself reading a
node id from the source page, stop — you are about to edit the wrong copy.

---

## Step 2 — Build the Client-First skeleton

Client-First's core structure, in this exact nesting:

```
page-wrapper
└── main-wrapper
    └── section_<identifier>
        └── padding-global
            └── container-<size>
                └── padding-section-<size>
                    └── <content>
```

What each one is for:

| Layer | Job |
| --- | --- |
| `page-wrapper` | Outermost parent of everything on the page |
| `main-wrapper` | The page's main content. **Nav and footer sit outside it**, as siblings inside `page-wrapper` |
| `section_<identifier>` | One per section, named for what it is: `section_hero`, `section_pricing` |
| `padding-global` | Horizontal padding only — left and right, site-wide |
| `container-<size>` | Max width plus `margin: auto`. `small`, `medium`, `large` |
| `padding-section-<size>` | Vertical padding only — top and bottom |

Sizes run `small`, `medium`, `large`, `xlarge`, and so on. `container-large` is
80rem / 1280px by default.

**Reducing the nesting.** Client-First permits putting `padding-section-<size>`
on the same layer as `padding-global` rather than nesting it, which removes one
frame per section. Prefer that when the section's padding is uniform, and say so
in the report. Keep them separate when a section needs different horizontal and
vertical treatment.

Build the skeleton with `create_frame` and `insert_child`, then move the existing
content inside. Every skeleton frame is Auto Layout vertical, Fill width, Hug
height.

---

## Step 3 — Name every layer

There are three kinds of name, and mixing them up is the most common way this
goes wrong.

### Custom classes — component-specific

Underscore separates the component from its part; hyphens separate words within
a part.

```
hero-header_component
hero-header_content
hero-header_image-wrapper
pricing-card_component
pricing-card_title
```

Never invent a second convention. `hero_Content`, `heroContent` and
`hero-content` are all wrong where `hero_content` is right.

### Utility classes — global, reusable

Hyphenated, describing a property rather than a place:

| Group | Names |
| --- | --- |
| Structure | `padding-global`, `container-small/medium/large`, `padding-section-small/medium/large` |
| Typography | `heading-style-h1` … `heading-style-h6`, `text-size-tiny/small/regular/medium/large`, `text-weight-normal/semibold/bold`, `text-align-center`, `text-style-allcaps` |
| Spacing | `margin-top/bottom/left/right/vertical/horizontal` paired with `margin-tiny/small/medium/large`, same for `padding-` |
| Width | `max-width-xsmall/small/medium/large/full` |

### Combo classes — variants

Prefixed `is-`, applied on top of a base class. In Figma, name the layer with
both, space-separated, exactly as Webflow will show it:

```
button is-primary
button is-secondary
section_header is-home
```

### Applying them

Renaming one layer per round trip is slow on a real page and easy to lose track
of. Read the whole section first (`get_nodes_info`), decide every name, then send
the `rename_node` calls together in a single `figma_batch` — one batch per
section is a good size.

---

## Step 4 — Restructure

The design is Figma-shaped. Make it Webflow-shaped.

1. **Scan first.** `clean_layers` with `dryRun: true` over the section. Follow
   its scan → ask → apply flow. Remove empty frames, purposeless groups and
   redundant single-child wrappers. Apply nothing that changes the render.
2. **Collapse nesting.** A frame with no fill, stroke, radius, effect, padding or
   layout job is not a div worth having. Webflow inherits whatever you leave.
3. **Auto Layout is the flex model.** Every content frame should be Auto Layout,
   because that is what becomes `display: flex` in stage 2. Use `convert_layout`
   to turn free-positioned frames into Auto Layout or Grid where the render
   stays identical; it refuses anything it cannot reproduce exactly, and a
   refusal is reported, never worked around by hand.
4. **Repeating items become Grid.** A row of equal cards is `set_grid_layout`,
   which maps to `display: grid`. A nav bar or button group stays horizontal
   Auto Layout.
5. **Sizing.** Containers and text Fill width, Hug height. Buttons Hug both.
   Icons, avatars and deliberate image crops keep their fixed size. **No fixed
   height on anything content-driven** — it becomes a fixed height in Webflow and
   clips the moment the copy changes.

---

## Step 5 — Typography onto utility classes

Every text layer gets a utility class name that says what it will be in Webflow:

| The text is | Name the layer |
| --- | --- |
| A page's single main heading | `heading-style-h1` |
| A section heading | `heading-style-h2` |
| A card or sub-heading | `heading-style-h3` … `h6` |
| Body copy | `text-size-regular`, or `-medium` / `-large` as the design shows |
| Small print, captions | `text-size-small`, `text-size-tiny` |

Where a text layer needs both a role and a style, use the custom class for the
role and let the utility carry the type: `pricing-card_title` with
`heading-style-h3`.

**Do not change the typography.** Font, size, line height, weight and letter
spacing stay exactly as the design has them. This step names what already
exists; it does not restyle it. If a text layer uses a size that matches no
utility in the set, say so in the report rather than rounding it to the nearest.

---

## Step 6 — Components and variants

| The element | Do this |
| --- | --- |
| Already a Figma component | Keep it. Rename to `<name>_component`. |
| Repeats 2+ times, not a component | `create_component_from_node` on the first occurrence, then `create_component_instance` everywhere else. |
| Appears once | Plain frames with a custom class name. |

**Variants become combo classes.** A Figma variant property `Style` with values
`Primary` / `Secondary` becomes `button is-primary` / `button is-secondary`.
Keep the designer's own value names — renaming them breaks the ability to talk
about the design.

Put new components in a frame named `Components — Webflow Ready` beside the page,
so stage 2 can find them and the designer can see what was created.

---

## Step 7 — Keep the tokens bound

Every colour, spacing, radius and type value that was bound to a Figma variable
must still be bound after the restructure. Moving a layer into a new wrapper is
the usual way a binding gets lost.

After restructuring a section, `get_node_variable_bindings` across it and compare
with what Step 0 recorded. Re-bind anything dropped with
`apply_variable_bindings`.

**Never create a variable here.** A value with no token behind it stays a raw
value and goes in the report; stage 2 will ask the user what to do with it.

---

## Step 8 — Breakpoints

Leave the Figma breakpoint modes as they are. Do not re-author responsive values
in this stage — stage 2 maps modes onto Webflow's breakpoints, and it needs the
source values untouched to do that.

Do run `analyze_responsive` over the prepared page and report:

- any fixed height left on content,
- any layer that will not Fill or Hug as stage 2 expects,
- text that already clips at the narrowest breakpoint.

These are cheaper to fix here than after they are a live site.

---

## Step 9 — Prove the design did not change

Restructuring that changes the render is a failure, however clean the result.

1. `export_node_as_image` the prepared page at every breakpoint.
2. Compare against the Step 0 exports **section by section**: position, size,
   spacing, colour, type, line breaks, images, borders, shadows.
3. Fix every difference and export again. Repeat until nothing differs.
4. `validate_responsive` on the prepared page as a cross-check.

Only call the page ready after a comparison shows it. Without the Step 0
exports, say that identity was not verified.

---

## Report

Keep it short, in the user's language:

- **Prepared page:** its name, and the sections restructured.
- **Structure:** the skeleton used, and whether `padding-section` was combined
  with `padding-global` or kept separate.
- **Names:** how many custom classes, utility classes and combo classes.
- **Layers removed:** the count, and what kind (empty frames, wrappers, groups).
- **Components:** created and reused, with instance counts.
- **Tokens:** bindings preserved, and any value with no token behind it.
- **Responsive flags:** what `analyze_responsive` found.
- **Identical:** how it was verified, or that it was not.
- **Next:** that `Webflow_Export_v1` is the stage that builds the site, and that
  the designer should review this page first.

Finish with `get_token_usage`, so the saving over a direct conversion is visible.
