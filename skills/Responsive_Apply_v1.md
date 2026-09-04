---
id: Responsive_Apply_v1
title: HIP Orthodontics Responsive Spec
description: >
  The verified responsive specification for the HIP Orthodontics home page
  template (Desk 1440 / Tab 768 / Mobi 320). Load this skill whenever the
  designer asks to make a breakpoint responsive, adapt a section to tablet or
  mobile, check responsive sizing, or look up the approved padding, gap,
  typography, colour or button values for this file. Every number here was read
  directly from the Figma auto-layout properties, so it is the source of truth —
  use it instead of measuring by eye or inventing a value. Work one breakpoint
  at a time and never fix the height of content-driven layers.
triggers:
  - make the tablet responsive
  - make the mobile responsive
  - tablet responsive
  - mobile responsive
  - responsive design
  - responsive spec
  - 768px breakpoint
  - 320px breakpoint
  - breakpoint values
  - section padding values
  - gap values
  - typography scale
  - hug contents
  - fill container
  - responsive qa
uses:
  - join_channel
  - check_figma_connection
  - get_selection
  - get_document_info
  - get_pages
  - get_nodes_info
  - get_variables
  - find_variable
  - apply_variable_to_node
  - apply_variable_bindings
  - switch_variable_mode
  - set_auto_layout
  - set_layout_sizing
  - set_node_properties
  - fix_text_sizing
  - set_font_size
  - set_line_height
  - set_text_align
  - resize_node
  - export_node_as_image
  - analyze_responsive
  - make_responsive
  - validate_responsive
  - clean_layers
  - figma_batch
---

# HIP Orthodontics — Responsive Specification

**Project:** HIP Orthodontics — Home Page Template
**Breakpoints:** Desk 1440 · Tab 768 · Mobi 320
**Fonts:** Figtree (headings/UI) · Inter (body)
**Source:** read directly from the Figma auto-layout properties. Treat these
numbers as approved. Do not re-derive them by eye.

---

## How to use this skill

1. **Confirm the connection.** `check_figma_connection`; `join_channel` if needed.
2. **Define the scope.** One breakpoint, one frame. Tablet request = tablet only.
   Mobile request = mobile only. Both requested = finish Tablet, stop, ask before
   starting Mobile.
3. **Inspect before changing.** `get_selection` / `get_nodes_info` for structure,
   `export_node_as_image` to see the design, `get_variables` for the live tokens.
4. **Bind tokens, don't type numbers.** Every value below exists as a variable in
   the `styles` collection (§8, §9). Resolve with `find_variable`, bind with
   `apply_variable_to_node` / `apply_variable_bindings`, and select the mode for
   the breakpoint you are on (`switch_variable_mode`). Use a raw number only when
   no token covers the value, and say so.
5. **Width fills, height hugs.** Containers, text blocks, cards and content
   columns: width = Fill Container, height = Hug Contents. Buttons hug both.
   Never set a fixed numeric height on content-driven layers — the frame sizes in
   §6 are *observed results*, not heights to type in.
6. **Batch the writes.** Group edits into `figma_batch` rather than one call per
   property.
7. **QA, then stop.** `validate_responsive` plus the checklist in §11. Do not
   continue to another breakpoint or another kind of work.

---

## 1. Breakpoints and frame sizes

| Name | Width | Observed frame height |
|---|---|---|
| Desk | 1440 | 16011 |
| Tab | 768 | 19125 |
| Mobi | 320 | 15322 |

**Breakpoint tokens** — collection `Breakpoint`, variable `Device`:

| Mode | Value |
|---|---|
| Desk | 1920 |
| Laptop | 1440 |
| Tab | 768 |
| Mobi | 320 |

---

## 2. Global padding and gap system

### Section outer padding (all standard sections)

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| padding-horizontal (L+R) | 100 | 40 | 20 |
| padding-vertical (T+B) | 120 | 60 | 40 |

Exceptions:
- **Brand Logo Bar (trust strip):** padding-vertical = `100 / 60 / 40`
- **#Footer, Tab:** padding-horizontal = `0` (full bleed, intentional)
- **#Footer, Mobi:** padding-bottom = `64` (safe area)

### Gap between section children

| Context | Desk | Tab | Mobi |
|---|---|---|---|
| Standard section gap | 60 | 40 | 30 |
| Inner container gap | 60 | 40 | 30 |
| Inner page sections | 30 | 30 | 20 |
| Logo bar gap | 60 | 10 | 10 |
| Footer sub-sections | 60 | 40 | 30 |

### Content area width (after horizontal padding)

| Desk | Tab | Mobi |
|---|---|---|
| 1240 | 688 | 280 |

---

## 3. Colour tokens

### Base colours

| Token | Hex | Usage |
|---|---|---|
| `colors/Base/Primary` | `#3196a9` | Primary brand |
| `colors/Base/Secondary` | `#06b6d4` | Secondary |
| `colors/Base/Tertiary` | `#8d8dc7` | Tertiary |
| `colors/Base/Accent` | `#eab308` | Accent |
| `colors/Base/CTA` | `#f97316` | Buttons, PreHeader text, highlights |
| `colors/Base/Gray Main` | `#737373` | Body paragraph text |
| `colors/Base/Black` | `#030712` | Headings, button backgrounds |
| `colors/Base/White` | `#ffffff` | Button labels, backgrounds |

### Semantic roles

| Role | Hex | Token |
|---|---|---|
| PreHeader text | `#f97316` | `colors/Base/CTA` |
| Heading text | `#030712` | `colors/Base/Black` |
| Paragraph text | `#737373` | `colors/Base/Gray Main` |
| Button bg (primary) | `#030712` | `colors/Base/Black` |
| Button label | `#ffffff` | `colors/Base/White` |
| CTA button bg | `#f97316` | `colors/Base/CTA` |
| Icon bg (highlight cards) | `#f0fafb` | `colors/Primary/50` |
| Card bg (highlight cards) | `#fafafa` | `colors/Gray/50` |
| Step card bg | `#f5f5f5` | `colors/Gray/100` |
| Section bg (alternate) | `#f5f5f5` | `colors/Gray/100` |
| Logo bar bg | `#e5e5e5` | `colors/Gray/200` |
| NavBar top bar bg | `#152d37` | `colors/Primary/950` |
| Play button bg | `#f97316` | `colors/Base/CTA` |
| Hero overlay | `#030712` | `colors/Base/Black` |

### Section background pattern (Desk)

| Section | Background |
|---|---|
| Hero Banner | transparent (full-bleed image + overlay) |
| # Highlights | `#d4d4d4` |
| # Step Section | `#ffffff` |
| # Our Practice | `#f5f5f5` |
| Brand Logo Bar | `#e5e5e5` |
| # Our Doctors | `#ffffff` |
| # Who We Help | `#f5f5f5` |
| # How We Help | `#ffffff` |
| Brand Logos | `#e5e5e5` |
| InstaSlider | `#ffffff` |

---

## 4. Typography scale

Keep the local text style. Change size/line-height only by moving to the
breakpoint's row below — never to solve a height problem. Text is Auto Height /
Hug Contents and wraps naturally.

### PreHeader (identical in every section)

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| font-family | Figtree | Figtree | Figtree |
| font-size | 16 | 14 | 12 |
| line-height | 24 | 20 | 18 |
| font-weight | 700 | 700 | 700 |
| letter-spacing | 3 | 3 | 3 |
| colour | `#f97316` | `#f97316` | `#f97316` |

### Section Title / H2

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| font-family | Figtree | Figtree | Figtree |
| font-size | 56 | 42 | 32 |
| line-height | 68 | 50 | 40 |
| font-weight | 700 | 700 | 700 |
| letter-spacing | 0 | 0 | 0 |
| colour | `#030712` | `#030712` | `#030712` |

Doctor name / card title uses this same scale.

### Hero Heading / H1 Large

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| font-size | 100 | 56 | 40 |
| line-height | 100 | 68 | 40 |
| font-weight | 700 | 700 | 700 |
| text-align | CENTER | CENTER | CENTER |

### Remaining scale

| Style | Desk size / LH | Tab size / LH | Mobi size / LH |
|---|---|---|---|
| H1 Small | 72 / 72 | 48 / 56 | 36 / 44 |
| H2 Inner | 54 / 68 | 38 / 50 | 30 / 40 |
| H3 | 42 / 56 | 36 / 36 | 28 / 36 |
| H4 | 32 / 46 | 28 / 40 | 24 / 34 |
| H5 | 24 / 34 | 22 / 30 | 20 / 28 |
| H6 (letter-spacing 0.5) | 20 / 30 | 18 / 28 | 16 / 22 |

### Body paragraph

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| font-family | Inter | Inter | Inter |
| font-size | 20 | 18 | 16 |
| line-height | 30 | 28 | 24 |
| font-weight | 400 | 400 | 400 |
| colour | `#737373` | `#737373` | `#737373` |

### text-align rules

| Context | Desk | Tab | Mobi |
|---|---|---|---|
| Section headers (centred) | CENTER | CENTER | CENTER |
| Card text blocks | LEFT | LEFT | **CENTER** (flips) |
| Hero / Slider | CENTER | CENTER | CENTER |
| Our Practice | LEFT | LEFT | **CENTER** (flips) |
| Who We Help cards | LEFT | LEFT | LEFT |

> Only **Doctor Cards** and **# Our Practice** flip to CENTER on mobile. Every
> other card stays LEFT.

---

## 5. Button specs

Buttons hug their contents; the sizes below are the observed result of the
padding and label scale, not values to hard-set.

### Primary button (dark)

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| size | 239 × 60 | 200 × 52 | 158 × 48 |
| bg | `#030712` | `#030712` | `#030712` |
| label font | Figtree 700 | Figtree 700 | Figtree 700 |
| label size / LH | 20 / 30 | 18 / 28 | 16 / 24 |
| label letter-spacing | 1.25 | 0.5 | 0 |
| label colour | `#ffffff` | `#ffffff` | `#ffffff` |
| arrow icon | 20 × 20 | 20 × 20 | 16 × 16 |

### CTA button (hero, orange)

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| size | 364 × 60 | 306 × 52 | 248 × 48 |
| bg | `#f97316` | `#f97316` | `#f97316` |
| label size | 20 | 18 | 16 |

### Nav CTA button (tablet nav only)

| Property | Tab |
|---|---|
| size | 159 × 36 |
| bg | `#f97316` |
| label | 14 / 700 / letter-spacing 1.25 |

### Button slot layout

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| layoutMode | HORIZONTAL WRAP | HORIZONTAL WRAP | HORIZONTAL WRAP |
| gap | 30 | 20 | — |
| counterAxisSpacing | 30 | 20 | — |

---

## 6. Section layout — all sections

`pad-L/R` = paddingLeft/Right · `pad-T/B` = paddingTop/Bottom ·
`gap` = itemSpacing · `cGap` = counterAxisSpacing.
Frame sizes are observed output; reproduce them with padding, gap and
Fill/Hug — not with fixed heights.

### 01 — Hero Banner

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 906 | 768 × 800 | 320 × 597 |
| layoutMode | VERTICAL | VERTICAL | VERTICAL |
| pad-L/R | 0 | 0 | 0 |
| pad-T/B | 0 | 0 | 0 |
| gap | 0 | 0 | 0 |

**NavBar**

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| NavBar height | 164 | 80 | 57 |
| Logo size | 133 × 60 | 111 × 50 | 71 × 32 |
| Top bar height | 64 | — | — |
| Top bar bg | `#152d37` | — | — |
| Mobile icons | — | — | 3 × 32 × 32 |

**Slider / hero content**

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Slider height | 742 | 720 | 540 |
| Text content width | 870 | 688 | 280 |
| Text content pad-L/R | 285 | 40 | 20 |
| Heading → Button gap | 40 | 40 | 40 |

### 02 — # Highlights

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 834 | 768 × 1074 | 320 × 1356 |
| layoutMode | **GRID** | **GRID** | VERTICAL |
| pad-L/R | 100 | 40 | 20 |
| pad-T/B | 120 | 60 | 40 |
| gap | 0 | 0 | 20 |
| Grid columns | 4 | 2 | 1 |
| Card width | 280 | 329 | 280 |
| Icon size | 80 × 80 | 80 × 80 | 60 × 60 |
| Icon corner-radius | 4 | 4 | 4 |
| Icon bg | `#f0fafb` | `#f0fafb` | `#f0fafb` |
| Card bg | `#fafafa` | `#fafafa` | `#fafafa` |
| Cards total | 8 | 8 | 8 |

### 03 — # Step Section

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 943 | 768 × 1200 | 320 × 1210 |
| layoutMode | **GRID** | VERTICAL | HORIZONTAL |
| pad-L/R | 100 | 40 | 20 |
| pad-T/B | 120 | 60 | 40 |
| gap | 60 | 40 | 10 |
| Layout | Text L + Image R, cards below | Text + image stacked, cards row | All stacked |

**Text container**

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Size | 581 × 374 | 688 × 290 | 280 × 406 |
| layoutMode | VERTICAL | VERTICAL | VERTICAL |
| Content → Button gap | 40 | 30 | 24 |
| Heading → Paragraph gap | 24 | 20 | — |

**Step card container**

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| layoutMode | HORIZONTAL | HORIZONTAL | VERTICAL |
| gap | 2 (flush) | 2 (flush) | 2 (flush) |
| Container size | 1240 × 250 | 688 × 194 | 280 × 454 |
| Card count | 3 | 3 | 3 |
| Card bg | `#f5f5f5` | `#f5f5f5` | `#f5f5f5` |

**Image ratio**

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Size | 590 × 393 | — | 280 × 210 |
| Scale mode | FILL | FILL | FILL |

### 04 — # Our Practice

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 670 | 768 × 853 | 320 × 610 |
| layoutMode | HORIZONTAL | VERTICAL | VERTICAL |
| pad-L/R | 100 | 40 | 20 |
| pad-T/B | 120 | 60 | 40 |
| gap | 60 | 40 | 30 |
| Image size | 645 × 430 | 688 × 459 | 280 × 187 |
| Text container | 535 × 314 | 688 × 234 | 280 × 286 |
| Play button | 200 × 200 | 200 × 200 | 81 × 81 |
| Play button bg | `#f97316` | `#f97316` | `#f97316` |
| Content → Button gap | 40 | 30 | 24 |
| text-align | LEFT | LEFT | **CENTER** |

### 05 — Brand Logo Bar (trust strip)

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 400 | 768 × 368 | 320 × 212 |
| layoutMode | HORIZONTAL | HORIZONTAL | HORIZONTAL |
| pad-L/R | 100 | 40 | 20 |
| pad-T/B | **100** | 60 | 40 |
| gap | 60 | 10 | 10 |
| Logo size | 133 × 60 | 89 × 40 | 67 × 30 |
| Logo count | 8 (2 rows × 4) | 6 | 6 |
| Logo row gap | 60 | — | — |

### 06 — # Our Doctors

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 2107 | 768 × 3259 | 320 × 2177 |
| layoutMode | VERTICAL | VERTICAL | VERTICAL |
| pad-L/R | 100 | 40 | 20 |
| pad-T/B | 120 | 60 | 40 |
| gap between cards | 60 | 40 | 30 |
| Doctor cards | 4 | 4 | 4 |

**Header (centred)**

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Header size | 688 × 184 | 688 × 152 | 280 × 214 |
| text-align | CENTER | CENTER | CENTER |

**Doctor card**

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| layoutMode | HORIZONTAL | VERTICAL | VERTICAL |
| Card gap | 60 | 40 | 30 |
| Card size (example) | 1240 × 328–393 | 688 × 707 | 280 × 441 |
| Image alternates L/R | Yes | No (top) | No (top) |
| Image width | 492 or 590 | 688 | 280 |
| Image height | 328 or 393 | 459 | 187 |
| Text block | 688 × 252 | 688 × 208 | 280 × 224 |
| Content → Button gap | 40 | 30 | 24 |
| text-align | LEFT | LEFT | **CENTER** |

### 07 — # Who We Help

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 1852 | 768 × 2512 | 320 × 1706 |
| layoutMode | VERTICAL | VERTICAL | VERTICAL |
| pad-L/R | 100 | 40 | 20 |
| pad-T/B | 120 | 60 | 40 |
| gap between cards | 60 | 40 | 30 |
| Cards | Kids / Teens / Adults | same | same |

**Header (centred)**

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Header size | 688 × 252 | 688 × 152 | 280 × 214 |
| text-align | CENTER | CENTER | CENTER |

**Content card**

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| layoutMode | HORIZONTAL | VERTICAL | VERTICAL |
| Card gap | 60 | 40 | 30 |
| Card size | 1240 × 393 | 688 × 707 | 280 × 441 |
| Image alternates L/R | Yes | No (top) | No (top) |
| Image size | 590 × 393 | 688 × 459 | 280 × 187 |
| Text block | 590 × 282 | 688 × 208 | 280 × 224 |
| Content → Button gap | 40 | 30 | 24 |
| text-align | LEFT | LEFT | LEFT |

### 08 — # How We Help

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 2172 | 768 × 3259 | 320 × 2177 |
| layoutMode | VERTICAL | HORIZONTAL | HORIZONTAL |
| pad-L/R | 100 | 40 | 20 |
| pad-T/B | 120 | 60 | 40 |
| gap | 60 | 40 | 30 |
| Inner container layoutMode | VERTICAL | VERTICAL | VERTICAL |
| Inner container gap | 60 | 40 | 30 |
| Inner container size | 1240 × 1932 | 688 × 3139 | 280 × 2097 |
| Row layout | 2-col alternating | 1-col stacked | 1-col stacked |
| Row count | 4 | 4 | 4 |

### 09 — Brand Logos (with heading)

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 574 | 768 × 352 | 320 × 428 |
| layoutMode | VERTICAL | VERTICAL | HORIZONTAL |
| pad-L/R | 100 | 40 | 20 |
| pad-T/B | 120 | 60 | 40 |
| gap | 60 | 40 | 10 |
| Logos layoutMode | HORIZONTAL | HORIZONTAL **WRAP** | VERTICAL |
| Logos gap | 40 | 40 | 30 |
| Logos cGap (wrap) | — | **40** | — |
| Logo size | 133 × 60 | 89 × 40 | 67 × 30 |
| Logo count | 6 | 6 | 6 |
| Header text-align | CENTER | CENTER | CENTER |

### 10 — InstaSlider

| Property | Desk | Tab | Mobi |
|---|---|---|---|
| Frame size | 1440 × 964 | 768 × 858 | 320 × 697 |
| layoutMode | VERTICAL | VERTICAL | VERTICAL |
| pad-L/R | 100 | 40 | 20 |
| pad-T/B | 120 | 60 | 40 |
| gap | 60 | 40 | 30 |
| Image container | 1240 × 514 | 688 × 578 | 280 × 300 |
| Image container gap | 40 | 40 | 0 |
| Mobi extra | — | — | Social + BTN row added |

### 11 — # Fixed Footer

| Sub-section | Property | Desk | Tab | Mobi |
|---|---|---|---|---|
| **# CTA** | Frame size | 1440 × 824 | 768 × 903 | 320 × 623 |
| | layoutMode | HORIZONTAL | VERTICAL | VERTICAL |
| | pad-L/R | 100 | 40 | 20 |
| | pad-T/B | 120 | 60 | 40 |
| | gap | 60 | 40 | 30 |
| **# Our 5-Star Care** | Frame size | 1440 × 1462 | 768 × 971 | 320 × 1108 |
| | layoutMode | GRID | GRID | VERTICAL |
| | pad-L/R | 100 | 40 | 20 |
| | pad-T/B | 120 | 60 | 40 |
| | gap | 60 | 40 | 30 |
| **# Locations** | Frame size | 1440 × 1432 | 768 × 2058 | 320 × 1471 |
| | layoutMode | VERTICAL | VERTICAL | VERTICAL |
| | pad-L/R | 100 | 40 | 20 |
| | pad-T/B | 120 | 60 | 40 |
| | gap | 60 | 40 | 30 |
| **#Footer** | Frame size | 1440 × 871 | 768 × 659 | 320 × 951 |
| | layoutMode | HORIZONTAL | HORIZONTAL | HORIZONTAL |
| | pad-L/R | 100 | **0** | 20 |
| | pad-T | 120 | 60 | 40 |
| | pad-B | 120 | 60 | **64** |
| | gap | 10 | 10 | 10 |

---

## 7. Component specs

### Utilities — Archive Card

| Token | Desk | Tab | Mobi |
|---|---|---|---|
| Top-Bottom padding | 30 | 30 | 20 |
| Left-Right padding | 30 | 30 | 20 |
| Row gap | 30 | 30 | 20 |
| Column gap | 30 | 30 | 20 |
| Card → pagination gap | 60 | 40 | 30 |
| Title → paragraph gap | 24 | 20 | 16 |
| Paragraph → button gap | 40 | 30 | 24 |

### Utilities — Review Card

| Token | Desk | Tab | Mobi |
|---|---|---|---|
| Top-Bottom padding | 60 | 30 | 20 |
| Left-Right padding | 60 | 30 | 20 |
| Row gap | 24 | 20 | 16 |
| Column gap | 24 | 24 | 16 |
| Icon → paragraph gap | 16 | 16 | 16 |
| Stroke | 0 | 0 | 0 |
| Border radius | 0 | 0 | 0 |
| Width | 590 | 324 | 280 |

### Utilities — Sales Review Card

| Token | Desk | Tab | Mobi |
|---|---|---|---|
| Top-Bottom padding | 60 | 30 | 20 |
| Left-Right padding | 60 | 30 | 20 |
| Row gap | 24 | 20 | 16 |
| Column gap | 24 | 24 | 16 |
| Icon → paragraph gap | 16 | 16 | 16 |
| Width | 590 | 324 | 280 |
| Star icon | 24 | 24 | 16 |
| Google icon | 64 | 64 | 46 |

### Utilities — Popup Card

| Token | Desk | Tab | Mobi |
|---|---|---|---|
| Top-Bottom padding | 60 | 40 | 20 |
| Left-Right padding | 60 | 40 | 20 |
| Border radius | 16 | 12 | 8 |
| Location gap | 32 | 24 | 16 |
| Title → paragraph gap | 12 | 10 | 8 |
| Content gap | 24 | 20 | 16 |
| Row gap | 40 | 40 | 30 |
| Close icon | 44 | 44 | 36 |

### Utilities — Widgets

| Token | Desk | Tab | Mobi |
|---|---|---|---|
| Top-Bottom padding | 30 | 20 | 16 |
| Left-Right padding | 30 | 16 | 8 |
| Border radius | 100 | 100 | 100 |
| Icon size | 40 | 40 | 30 |
| Icon wrapper | 60 | 60 | 46 |

### Utilities — small controls

| Component | Token | Desk | Tab | Mobi |
|---|---|---|---|---|
| Inputs | Width | 713 | 608 | 240 |
| Check Box | Size / radius / border | 16 / 4 / 1 | 16 / 4 / 1 | 14 / 2 / 1 |
| Radio | Size / radius / border | 16 / 100 / 1 | 16 / 100 / 1 | 14 / 100 / 1 |
| Menu Social Icon | Icon / padding | 24 / 10 | 22 / 9 | 20 / 8 |

### Button / Tab

| Token | Desk | Tab | Mobi |
|---|---|---|---|
| Left-Right padding | 32 | 24 | 16 |
| Top-Bottom padding | 15 | 12 | 12 |
| Icon gap | 16 | 12 | 8 |
| Icon size | 20 | 20 | 16 |
| Border radius | 0 | 0 | 0 |
| Stroke | 4 | 3 | 2 |

### Button / Popup icon size

| Desk | Tab | Mobi |
|---|---|---|
| 20 | 20 | 18 |

---

## 8. Layout token variables

Collection `styles`. Bind these rather than typing the number; the mode carries
the breakpoint.

| Token | Desk | Tab | Mobi |
|---|---|---|---|
| `Layout/Section/Standard/max-width` | 1440 | 768 | 320 |
| `Layout/Section/Standard/padding-horizontal` | 100 | 40 | 20 |
| `Layout/Section/Standard/padding-vertical` | 120 | 60 | 40 |
| `Layout/Section/Standard/row-gap` | 60 | 40 | 30 |
| `Layout/Section/Standard/column-gap` | 60 | 40 | 30 |
| `Layout/Section/Compact/max-width` | 1440 | 768 | 320 |
| `Layout/Section/Compact/padding-horizontal` | 100 | 40 | 20 |
| `Layout/Section/Compact/padding-vertical` | 60 | 60 | 40 |
| `Layout/Section/Compact/row-gap` | 60 | 40 | 30 |
| `Layout/Section/Compact/column-gap` | 60 | 40 | 30 |
| `Layout/Section/Inner/max-width` | 1440 | 768 | 320 |
| `Layout/Section/Inner/padding-horizontal` | 100 | 40 | 20 |
| `Layout/Section/Inner/padding-vertical` | 120 | 60 | 40 |
| `Layout/Section/Inner/row-gap` | 30 | 30 | 20 |
| `Layout/Section/Inner/column-gap` | 30 | 30 | 20 |
| `Layout/Section/Inner/title-paragraph-gap` | 8 | 6 | 4 |
| `Layout/Section/Inner/title-gap` | 60 | 40 | 30 |
| `Layout/Section/FullWidth/max-width` | 1440 | 768 | 320 |
| `Layout/Section/FullWidth/padding-horizontal` | 100 | 40 | 20 |
| `Layout/Section/FullWidth/padding-vertical` | 120 | 60 | 40 |
| `Layout/Section/FullWidth/row-gap` | 40 | 30 | 20 |
| `Layout/Section/FullWidth/column-gap` | 40 | 30 | 20 |
| `Layout/Section/FullWidth/title-paragraph-gap` | 8 | 8 | 6 |
| `Layout/Section/FullWidth/paragraph-paragraph-gap` | 24 | 20 | 16 |
| `Layout/Section/FullWidth/title-gap` | 60 | 40 | 30 |
| `Layout/Section/FullWidth/faq-gap` | 16 | 12 | 8 |

These were renamed from the old `Pages/...` paths on 2026-09-03. If a lookup by
one of these names fails, run `get_variables({nameContains: "Layout/Section"})`
before assuming the token is missing.

---

## 9. Gap token variables

Collection `styles`. Same value in every mode — these are fixed steps, not
responsive tokens. Use them for one-off gaps that the layout tokens in §8 do not
cover.

| Token | Value |
|---|---|
| `Gap/none` | 0 |
| `Gap/4` | 4 |
| `Gap/8` | 8 |
| `Gap/12` | 12 |
| `Gap/16` | 16 |
| `Gap/20` | 20 |
| `Gap/24` | 24 |
| `Gap/30` | 30 |
| `Gap/32` | 32 |
| `Gap/40` | 40 |
| `Gap/60` | 60 |
| `Gap/64` | 64 |
| `Gap/96` | 96 |
| `Gap/120` | 120 |
| `Gap/160` | 160 |
| `Gap/240` | 240 |
| `Gap/285` | 285 |
| `Gap/320` | 320 |

---

## 10. Known exceptions and anomalies

These are deliberate. Do not "fix" them.

| Section | Breakpoint | Behaviour | Value |
|---|---|---|---|
| `#Footer` | Tab | padding-horizontal 0 (full bleed) | `pL/R = 0` |
| `#Footer` | Mobi | extra safe-area bottom padding | `pB = 64` |
| `# Highlights` | All | layoutMode is GRID, not HORIZONTAL | `GRID` |
| `# Step Section` | All | layoutMode changes per breakpoint | Desk GRID, Tab VERTICAL, Mobi HORIZONTAL |
| `# How We Help` | Tab + Mobi | outer frame HORIZONTAL, inner VERTICAL | outer `HORIZONTAL` |
| `Brand Logos` | Tab | logos wrap with counterAxisSpacing | `WRAP`, `cGap = 40` |
| `Brand Logos` | Mobi | logos container is VERTICAL | `VERTICAL` |
| `Doctor Cards` | Mobi | text-align flips LEFT → CENTER | `CENTER` |
| `# Our Practice` | Mobi | text-align flips LEFT → CENTER | `CENTER` |
| `Brand Logo Bar` | Desk | padding-vertical 100, not 120 | `pT/B = 100` |
| `Play button` | Mobi | much smaller than desktop | `81 × 81` |
| `Play circle text` | Mobi | font-size scales to 5.67 | `5.67` |
| `# Highlights` | Mobi | gap becomes 20, not 0 | `gap = 20` |
| `InstaSlider` | Mobi | extra Social + BTN row below images | extra child |

---

## 11. Completion checklist

Run before reporting a breakpoint done:

- [ ] Only the requested breakpoint was touched.
- [ ] Every section's padding and gap matches §2 / §6 for that breakpoint, bound
      to the §8 tokens in the right mode.
- [ ] No fixed numeric height on sections, wrappers, text containers, headings,
      paragraphs, cards or content columns. Height = Hug Contents.
- [ ] Width = Fill Container on containers, text blocks, cards and columns;
      buttons hug.
- [ ] Typography matches the §4 row for the breakpoint; nothing shrunk to fit;
      no clipped or overlapping text.
- [ ] text-align follows §4, including the two mobile CENTER flips.
- [ ] Colours come from the §3 tokens.
- [ ] Documented exceptions in §10 are intact.
- [ ] `validate_responsive` passes.
- [ ] Stop. Do not start another breakpoint without being asked.
