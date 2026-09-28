---
id: Prototype_Motion_v1
title: Figma Prototype & Motion
description: >
  Plans and builds Figma prototypes and timeline motion in the user's file:
  flows, triggers, navigation, overlays, interactive component states, scroll
  and sticky behaviour, Smart Animate page transitions, and Figma Motion
  keyframes (stagger reveals, loops, path draw, animated fills and effects).
  Use this skill whenever the user asks to prototype, wire up, link or connect
  screens, add interactions, hover or press states, interactive components,
  overlays, modals, dropdowns, mega menus, mobile menus, tabs, accordions,
  carousels, sticky headers, scroll-to anchors, page transitions or smart
  animate, or to add motion, animation, keyframes, timeline, stagger, reveal,
  entrance or micro-interactions — for a whole site, one section, one component
  or a mobile app flow, and even when they only say "make it move",
  "prototype this", "animate the hero" or "prototype kore dao / motion dao".
  Plans the interactions before writing them, writes them through set_reactions
  and uses execute_code to merge, batch or script, then audits for
  broken links, dead ends, Smart Animate name mismatches and short timelines.
triggers:
  - prototype this
  - prototype the website
  - wire up the screens
  - connect screens
  - add interactions
  - hover state
  - interactive component
  - overlay
  - modal
  - dropdown
  - mega menu
  - mobile menu
  - tabs
  - accordion
  - carousel
  - sticky header
  - scroll to section
  - anchor link
  - page transition
  - smart animate
  - figma motion
  - add motion
  - animate the hero
  - keyframe
  - timeline animation
  - stagger reveal
  - entrance animation
  - micro interaction
  - make it move
  - prototype kore dao
  - motion dao
uses:
  - join_channel
  - check_figma_connection
  - get_selection
  - get_node_info
  - get_nodes_info
  - get_reactions
  - set_reactions
  - get_local_components
  - create_component_set
  - set_instance_variant
  - rename_node
  - clone_node
  - execute_code
  - export_node_as_image
  - figma_batch
  - get_token_usage
---

# Figma Prototype & Motion

Two outcomes, in this order:

1. **It works when presented.** No broken link, no unreachable screen, no
   Smart Animate that dissolves because layer names do not match, no timeline
   that ends before its last keyframe.
2. **It feels designed.** One motion language for the whole file — the same
   durations, easing and distances everywhere — not a different animation per
   element.

Four passes on every job, in order. They are checks, not agents; run them
yourself and say which one caught a problem when it helps.

- **Flow** — can a user reach every screen, and get back from each one?
- **Interaction** — does every element that looks interactive respond?
- **Motion** — does the movement explain what happened, on the file's tokens?
- **QA** — will it break in front of the client?

## Two engines

|  | **Prototype** (interactions) | **Motion** (timeline) |
| --- | --- | --- |
| What | Reactions on layers: trigger → action → transition | Keyframes on layers inside a top-level frame, played on that frame's timeline |
| For | Navigation, hover/press, overlays, state changes, scroll-to, flows | Entrance choreography, loops, reveals, animated fills/strokes/effects, path draw |
| Write with | `set_reactions`; `execute_code` to merge, batch or script (below) | `execute_code` only |
| Units | Transition `duration` in **seconds** | `timelinePosition` and durations in **seconds** |

Most real requests need both: Motion for how a screen *arrives*, Prototype for
how the user *moves through* it. "Animate the website" usually means hero
entrance (Motion) + hover states (interactive components) + nav/menus/modals
(overlays) + page transitions (Smart Animate).

Figma Motion is gated per account. Probe once (Step 0). If it is not available,
say so plainly and offer the prototype equivalent — Smart Animate between state
frames, `AFTER_TIMEOUT` sequences, interactive-component states. Never fake a
timeline.

---

## Which tool writes a reaction

**`set_reactions` is the default.** It carries every documented trigger, action,
navigation type, transition and easing — including the ones that used to be
dropped silently: `direction` and `matchLayers` on the directional transitions,
`CUSTOM_CUBIC_BEZIER` and `CUSTOM_SPRING` parameters, `ON_KEY_DOWN` with
`device` and `keyCodes`, `AFTER_TIMEOUT` with `timeout`, `ON_MEDIA_HIT` with
`mediaHitTime`, a `URL` action's `url` and `openInNewTab`, and the
`SET_VARIABLE`, `SET_VARIABLE_MODE` and `CONDITIONAL` actions. It costs far
fewer tokens than a script, so reach for it first.

Overlay settings live on the **destination frame**, not on the reaction, so
`set_reactions` writes `overlayPositionType` and `overlayBackgroundInteraction`
only when you pass them — omit them and the frame keeps whatever the designer
set. Pass them for a dropdown, toast or bottom sheet that must not be centred.

**Three cases still need `execute_code`:**

| Case | Why |
| --- | --- |
| **Merging** with a node's existing reactions | `set_reactions` replaces every reaction on the node. To keep the others, either read with `get_reactions` first and send the combined array, or use script B, which merges by trigger type |
| **Many nodes at once** | One call per node; script B writes a whole screen in one round trip |
| An `UPDATE_MEDIA_RUNTIME` action | Not mapped — only its `type` survives. Calibrate against one built in the UI |

Whichever path, **read the read-back rather than trusting your own intent**:
`set_reactions` returns `readBackFromFigma`, and the scripts return the
reactions they wrote. Springs are the clearest reason — Figma computes a
spring's own duration, so the number that comes back is not the one you sent.
---

## Step 0 — Connect, read, probe

1. `join_channel` with the channel the user gave (ask if none).
   `check_figma_connection` if a call fails.
2. `get_selection`. Nothing selected and the scope is not "the whole page" →
   ask what to work on, then stop.
3. `get_nodes_info` at depth 2–4 on the target — enough to name screens,
   sections, buttons, cards, nav items. Do not deep-dump the page.
4. Run **script A (inventory)**: top-level frames, existing reactions, flow
   starting points, component sets and their variant properties, scrolling
   frames, fixed and sticky layers.
5. Motion requested → run **script E (motion probe)**, once. If it reports
   `"not a supported API"`, Figma Motion is off for this account or runtime:
   say so once, stop trying, offer the prototype equivalent.
6. `export_node_as_image` (PNG, scale 0.25–0.5) — the **before**.

## Step 1 — Brief

Infer everything the file already tells you. Ask only the decisions that
genuinely fork the build, in one message, each with your recommended default:

- **Scope** — whole page / these sections / this component / this flow.
- **Device and start frame** — desktop, mobile, both; which frame the flow
  starts at.
- **Motion intensity** — *Subtle* (legal, medical, finance), *Expressive*
  (SaaS, agency, product launch), *Playful* (consumer, kids, games, events).
  Default Subtle.
- **Existing interactions** — keep and extend, or replace.
- **Missing structure** — a hover variant, a modal frame, a mobile menu that is
  not drawn. Propose building it; never invent it silently.

If the user already gave a detailed brief, do not ask: state the assumptions in
one line and continue.

## Step 2 — Plan, then ask

Show two artefacts, in the user's language, before writing anything.

**Interaction Map** — one row per interaction:

```
# | Element (id)           | Trigger        | Action                | Destination   | Transition
1 | Nav > Services (12:40) | While hovering | Change to             | Hover (12:44) | Smart animate Gentle 0.2s
2 | CTA Book call (12:88)  | On click       | Open overlay (centre) | Modal/Booking | Dissolve 0.25s ease-out
3 | Logo (12:31)           | On click       | Navigate              | Home (10:1)   | Instant
```

**Motion Spec** — the token line first, then one row per animated layer:

```
Tokens: micro 120 · fast 200 · base 300 · slow 450 · entrance 600 · stagger 80ms
        enter EASE_OUT · exit EASE_IN · move GENTLE · rise 24 · scaleFrom 0.96
Reduced motion: opacity only, 200ms, no loops
Hero — timeline of "Home / Desktop", 1.4s
  t     layer        property               dur    easing
  0.00  Eyebrow      opacity 0>1, y 24>0    0.45   enter
  0.08  Headline     opacity 0>1, y 24>0    0.50   enter
  0.30  CTA group    opacity + scale .96>1  0.40   GENTLE
  0.40  Hero image   opacity 0>1, y 40>0    0.70   enter
```

Then ask for approval. Build only the rows that were approved — the user may
approve all, some, or change values.

## Step 3 — Build

Order matters: structure first, motion last. Each stage's output feeds the next.

1. **Approved structure** — missing variants (`create_component_set`), missing
   overlay or modal frames, and renames for Smart Animate (`rename_node`, or
   `figma_batch`): layers that must morph need the **same name and the same
   parent path** in both frames.
2. **Frame settings** — `overflowDirection`, `scrollBehavior`, flow starting
   points (**script D**).
3. **Interactive components** — reactions on the **variants of the main
   component** (**script C**), never on a sublayer inside an instance. Every
   instance then inherits the states.
4. **Screen reactions** — navigate, overlays, scroll-to, back and close.
   `set_reactions` per node; **script B** when reactions must be merged rather
   than replaced, or for more than a handful of nodes at once. Merge by trigger
   type unless the user said replace.
5. **Motion keyframes** — on **descendants** of a top-level frame, never the
   frame itself (**script F** for reveals, **script G** for anything else),
   then extend the timeline to the last keyframe.

While building:

- Every write returns the IDs it changed and the read-back values. Use that as
  evidence instead of re-reading the file.
- Preserve existing reactions and tracks unless the user said replace.
- Do not restructure, detach, delete or restyle anything outside the plan.
- Easing enums are exact: `EASE_IN_AND_OUT`, never `EASE_IN_OUT`.
- If the API refuses something, report it with the manual Figma step. Never
  substitute a different, wrong structure that merely looks similar.

## Step 4 — Verify and report

1. Run **script H (audit)**: broken destinations, wrong navigation type for the
   destination, dead ends, Smart Animate name mismatches, timelines shorter
   than their last keyframe. Fix what the approved plan covers; report the rest.
2. `export_node_as_image` at the same scale as the before-image. The static
   design must be unchanged — images show the resting state only and can never
   show motion, so this proves nothing moved, not that the motion is right.
3. `get_token_usage` once, at the end, and pass it on verbatim.

Report in this shape:

```
Prototype: 24 interactions on 6 screens · flows: Desktop > Home
Interactive components: Button (Default/Hover/Pressed), Card (Default/Hover)
Motion: Home hero 1.4s timeline — 5 layers, stagger 80ms
Structure added (approved): 2 variants, 1 overlay frame, 8 renames
Needs you in Figma UI: <item — exact setting and value>
Audit: 0 broken · 1 dead end (Thank you — intended) · 0 Smart Animate mismatches
Present: open "Home / Desktop" > Present (play) > flow "Desktop"
Tokens: Expressive — fast 200 · base 300 · slow 450 · stagger 80ms
```

---

## Motion tokens

Pick one intensity with the user, write it into the Motion Spec, then use only
those numbers. Durations in ms; the API takes seconds, so 200 ms is `0.2`.

| Token | Subtle | Expressive | Playful | Use |
| --- | --- | --- | --- | --- |
| `micro` | 100 | 120 | 150 | Press, checkbox, toggle knob |
| `fast` | 150 | 200 | 220 | Hover, dropdown, tooltip |
| `base` | 250 | 300 | 350 | Modal, card expand, accordion, tab indicator |
| `slow` | 400 | 450 | 500 | Page transitions, drawers, large morphs |
| `entrance` | 450 | 600 | 700 | Per-element reveal on a timeline |
| `scroll` | 600 | 700 | 800 | `SCROLL_TO` anchors |
| `stagger` | 50 | 80 | 110 | Gap between reveals |
| `rise` | 16px | 24px | 40px | Reveal translateY |
| `slide` | 24px | 40px | 64px | Horizontal reveal |
| `scaleFrom` | 0.98 | 0.96 | 0.9 | Pop-in |
| `hoverLift` | −2px | −4px | −8px | Card lift |
| `pressScale` | 0.98 | 0.97 | 0.94 | Press feedback |

Bigger element or longer distance → longer duration. Exits run about 20%
faster than entrances. Mobile slightly faster than desktop. Nothing
interactive goes over 500 ms — the user is waiting for it.

**Easing by meaning**, not by taste:

| Movement | Easing |
| --- | --- |
| Enters / appears | `EASE_OUT` |
| Leaves | `EASE_IN` |
| Moves A → B, or morphs | `EASE_IN_AND_OUT`, or spring `GENTLE` |
| Physical (drawers, sheets, cards under the finger) | `GENTLE` / `QUICK` |
| Emphasis, success, playful pop | `EASE_OUT_BACK`, or `BOUNCY` (Playful only) |
| Continuous (spinner, marquee, progress) | `LINEAR` |
| Step change (counter, caret) | `HOLD` (Motion only) |

A premium house curve for Expressive: `CUSTOM_CUBIC_BEZIER`
`{ x1: 0.22, y1: 1, x2: 0.36, y2: 1 }` — a strong ease-out. Use it as the
file's `enter` token, not on one element. `set_reactions` carries the control
points, so a custom curve needs no script.

## Choreography

- **Order = reading order = importance**: eyebrow → headline → body → CTA →
  media → decorative last and slowest.
- **Overlap**: stagger shorter than duration, so the next element starts before
  the previous finishes. Non-overlapping reveals feel slow.
- After about 6 items keep the stagger but group the rest, or the tail drags.
- **One hero moment per screen**; everything else supports it quietly. Hero
  total ≤ 1.6 s, and nothing important appears after 1 s.
- **Direction carries meaning**: forward navigation comes from the right, back
  from the left, sheets from where they live — bottom on mobile, right for a
  side panel.
- **Continuity**: the thing clicked becomes the thing seen — card → detail via
  Smart Animate, same layer names.
- The **final keyframe is the design's resting value**. Motion must never leave
  content hidden or displaced.

## Accessibility

No more than 3 flashes per second, and no large full-screen flashes. Parallax
and big zooms are opt-in. Anything that auto-advances (carousel, toast) also
gets a manual control, and both get prototyped. Write a reduced-motion note in
the spec for developers: entrances become opacity-only, springs become
`EASE_OUT`, loops stop.

## Pattern cheatsheet

Each row assumes the structure it names exists. If it does not, propose
building it in Step 2 — do not improvise it during the build.

| Pattern | Build |
| --- | --- |
| Hover / press | Variants; Default `ON_HOVER` → `CHANGE_TO` Hover (`fast`), Hover `ON_PRESS` → Pressed (`micro`) |
| Card hover | Hover variant = `hoverLift` + larger shadow (+ image scale 1.04 inside a clipping frame); `CHANGE_TO`, Smart animate `fast` `EASE_OUT`; the click to detail goes on the instance |
| Button states | `State=Default\|Hover\|Pressed\|Disabled` (+ `Loading` for forms). Disabled has no reactions. Loading → `AFTER_TIMEOUT` → success |
| Dropdown / mega menu | `MOUSE_ENTER` (delay 0.1s) or click → `OVERLAY` with `overlayRelativePosition`, dissolve `fast`; or a Default↔Open variant pair with `MOUSE_LEAVE` delay 0.2s back. Pass `overlayPositionType: "MANUAL"` so it anchors instead of centring |
| Mobile drawer | Burger → `OVERLAY` `MOVE_IN` from RIGHT, `slow` `GENTLE`; X → `CLOSE`. Burger↔X morph = variants with Smart animate |
| Modal / popup form | Click → `OVERLAY` centred, `DISSOLVE` `base` `EASE_OUT` (mobile: `MOVE_IN` from BOTTOM). Close button → `CLOSE`; Esc = `ON_KEY_DOWN` `keyCodes: [27]` → `CLOSE`; submit → `SWAP` to success |
| Tabs | One frame or variant per tab, identical structure and names. `CHANGE_TO`/`NAVIGATE`, Smart animate `base`, `resetScrollPosition: false`. The active indicator must be one layer with the same name in every state so it slides |
| Accordion / FAQ | Closed↔Open variants on `ON_CLICK`, Smart animate `base` `EASE_IN_AND_OUT`; the parent auto layout reflows. A chevron morphs only if it is the same layer |
| Carousel / slider | Arrows and `ON_DRAG` → next/prev, Smart animate or `SLIDE_IN` `slow`; auto-advance `AFTER_TIMEOUT` 4–6s per slide; dots = one moving "active" layer; last → first |
| Anchor nav | Nav item `ON_CLICK` → `SCROLL_TO` the section, `SCROLL_ANIMATE` `scroll` `EASE_IN_AND_OUT`. With a fixed header, target a spacer one header-height above so the heading is not hidden |
| Sticky header | `scrollBehavior = "FIXED"` (always on top) or `"STICKY_SCROLLS"` (sticks once reached); last in layer order. Optional compact state = a second header variant |
| Page transitions | Forward `NAVIGATE` Smart animate `slow` with header and footer names matching so they stay put; back = `BACK`. Websites prefer `DISSOLVE` `base` — never slide a whole web page sideways unless asked |
| Form flow | Field `State=Default\|Focus\|Filled\|Error\|Success`; click → Focus; empty submit → error state frame; valid → success overlay. Multi-step: the progress bar is one matching layer whose width morphs |
| Toast | Action → `OVERLAY` `MOVE_IN` from TOP `base` `GENTLE`; toast `AFTER_TIMEOUT` 3s → `CLOSE`; close icon → `CLOSE` |
| Splash / loader | Splash `AFTER_TIMEOUT` 1.5–2.5s → `NAVIGATE` home, dissolve `slow`. Spinner = `ROTATION` 0 → −360 `LINEAR` 1s; logo draw = `PATH_TRIM_END` 0 → 1 |
| Hero entrance | Motion stagger: eyebrow → headline → subtext → CTA (with `scaleFrom`) → media (bigger `rise`, `slow`) → decorative last. Headline split per line stagger at 40–60 ms |
| List → detail | The thumbnail and the detail hero need the **same name and path**; row `ON_CLICK` → `NAVIGATE`, Smart animate `slow` `GENTLE`; back = `BACK`. Different paths dissolve instead of morphing — rename first, with approval |
| Counter / stats | Text cannot interpolate. Either `HOLD` steps across stacked value layers, or fade-and-rise the final number (usually better), or a developer note |
| Logo marquee | Two identical rows side by side in a clipping frame; `TRANSLATION_X` 0 → −(row width) `LINEAR` over 20–30 s, first frame identical to last |
| App tab bar | One frame per tab, tab bar identical and `FIXED` in all; `NAVIGATE` with `transition: null` or `DISSOLVE` `micro`; the indicator morphs if names match |
| Bottom sheet | `OVERLAY` `MOVE_IN` from BOTTOM `slow` `GENTLE`; drag handle `ON_DRAG` → `CLOSE`; expanded = `SWAP` to a full-height sheet. Pass `overlayPositionType: "BOTTOM_CENTER"` |
| Section reveal on scroll | **There is no scroll-into-view trigger in Figma.** Pick one and say which: (a) animate only above-the-fold content on the page timeline, (b) build each section as its own frame in a scene flow for presenting, (c) leave Figma static below the fold and put the reveal in the spec for developers (IntersectionObserver / ScrollTrigger) |

## Prototype API facts

A reaction is `{ trigger, actions: [...] }`, written with
`await node.setReactionsAsync([...])`. Read-back objects may carry a legacy
`action` field beside `actions`; drop it when re-writing:
`node.reactions.map(({ action, ...r }) => r)`.

One node can hold several reactions with **different** triggers. Two reactions
with the same trigger conflict — merge them into one reaction with several
actions, which run in order.

**Navigation → what the destination must be:**

| `navigation` | Destination |
| --- | --- |
| `NAVIGATE` | A top-level frame (direct child of the page) |
| `OVERLAY` | A top-level frame, opened on top of the current screen |
| `SWAP` | A top-level frame, replacing the current overlay |
| `SCROLL_TO` | A layer **inside the same** top-level frame |
| `CHANGE_TO` | Another **variant of the same component set** |

`ON_HOVER` and `ON_PRESS` are temporary — they revert by themselves, so never
add a reverse reaction for them. `MOUSE_ENTER`/`MOUSE_LEAVE`, `MOUSE_DOWN`/
`MOUSE_UP` and `ON_CLICK` are permanent and **do** need the reverse reaction on
the other variant.

A component's own click action (this button goes *there*) belongs on the
**instance**, because the destination differs per instance. Hover and press
belong on the main component's variants. Both work together.

Scrolling: a top-level frame taller than the device scrolls automatically when
presented. Set `overflowDirection` explicitly only for **nested** scroll areas
(a horizontal card rail, a chat list) — and the nested frame must have
`clipsContent = true` and be smaller than its content.

Variables and conditionals (`SET_VARIABLE`, `CONDITIONAL`) are the most
version-sensitive part of the API, and `set_reactions` passes their fields
through verbatim rather than validating them.
**Calibrate before writing one**: ask the user to build one such interaction by
hand, read it with `get_reactions`, and copy that exact shape. Create variables
only with an explicit yes.

**Smart Animate matches layers by name *and* parent path.** Everything
unmatched dissolves. Keep the hierarchy identical for layers that must morph —
a layer moved into a new wrapper is a different layer. Duplicate names in one
parent confuse matching; make them unique. Position, size, rotation, opacity,
fill colour, corner radius, stroke and effects morph. Text content swaps.

## Motion API facts

One timeline per top-level frame; it plays when the frame is shown. Times are
in seconds.

- **Never animate a top-level frame.** Animate its descendants.
- Transform fields are **relative** to the layer's resting transform:
  `TRANSLATION_Y: 24` means 24 px below where it sits, `0` means where it sits.
  `SCALE_*`: `1` is its size. `ROTATION` in degrees, positive counter-clockwise.
- Absolute fields (`OPACITY`, `WIDTH`, `CORNER_RADIUS`…) replace the value while
  animating, so the last keyframe must equal the design value — `OPACITY` ends
  at `node.opacity`, not blindly at 1.
- The first keyframe's value holds back to t=0 and the last holds to the end;
  no pin keyframe at 0 is needed. Easing on a keyframe is the easing *into* it,
  so the first keyframe's easing is unused.
- Preserve existing work: `applyManualKeyframeTrack` touches one field, where
  assigning `manualKeyframeTracks` overwrites everything. When editing a track,
  keep its `id`, `baseValue` and the keyframes' `id`s.
- Extend a timeline to the last keyframe with `setTimelineDuration`. Never
  shorten one unless asked.

**Animatable fields.** Relative: `TRANSLATION_X`, `TRANSLATION_Y`,
`TRANSLATION_XY` (vector), `ROTATION`, `SCALE_X`, `SCALE_Y`, `SCALE_XY`.
Absolute: `OPACITY`, `CORNER_RADIUS` and the four `RECTANGLE_*_CORNER_RADIUS`,
`STROKE_WEIGHT` and the four `BORDER_*_WEIGHT`, `STACK_SPACING`,
`STACK_COUNTER_SPACING`, `STACK_PADDING_LEFT/TOP/RIGHT/BOTTOM`, `GRID_ROW_GAP`,
`GRID_COLUMN_GAP`, `PATH_TRIM_START`, `PATH_TRIM_END`, `WIDTH`, `HEIGHT` (not
on groups or vectors). Indexed: `fills[i]` and `strokes[i]` colour (SOLID paints
only), and `effects[i].<field>` — `OFFSET_X`, `OFFSET_Y`, `RADIUS`, `SPREAD`,
`COLOR`, `EFFECT_OPACITY` and the glass/noise fields. The paint or effect index
must already exist on the node. Anything else — shear, scroll offset, 3D,
variant properties, text content — throws; do not try.

**Easing types:** `EASE_IN`, `EASE_OUT`, `EASE_IN_AND_OUT`, `LINEAR`,
`EASE_IN_BACK`, `EASE_OUT_BACK`, `EASE_IN_AND_OUT_BACK`, `GENTLE`, `QUICK`,
`BOUNCY`, `SLOW`, `HOLD` (step, Motion only), `CUSTOM_CUBIC_BEZIER` with
`easingFunctionCubicBezier: { x1, y1, x2, y2 }`, and `CUSTOM_SPRING`.

⚠️ **The two spring shapes are different.** A prototype transition spring is
physical — `{ mass, stiffness, damping }`. A Motion keyframe spring is
normalised — `{ bounce }` (0–1). Converting: `figma.motion.physicalSpringToNormalized({ mass, stiffness, damping })`.

Figma ships preset animation styles. Discover them with
`figma.motion.figmaAnimationStyles()` and apply with
`node.applyAnimationStyle(styleId, { duration, timelineOffset, props })` —
`duration` and `timelineOffset` are top level, not inside `props`, and the
`props` shown by the preset are documentation strings, not values to copy.
Verify a style write by reading `node.animationStyles`; style tracks do not
appear in `node.animations`. Prefer manual keyframes for new choreographed
work. Authoring a *custom* animation style is out of scope.

Figma has **no loop flag** in the documented API. Build a loop-ready track (last
keyframe identical to the first, timeline length = loop length); repeat is set
in the timeline UI if the user's Figma offers it. For a repeating prototype,
an `AFTER_TIMEOUT` equal to the timeline length navigating to the same frame
with `transition: null` can work — confirm in Present before claiming it does.

---

## Scripts

Run with `execute_code`: pass the script as `code` and its values as `params`.
Inside the script `figma` and `params` are in scope, `await` works, all pages
are already loaded, and the last `return` is the result. Node lookup is async
only — `await figma.getNodeByIdAsync(id)`; the synchronous form does not exist
here. Every write script returns the IDs it changed.

### A — Inventory (read)

```js
const page = figma.currentPage;
const withR = page.findAll(n => "reactions" in n && n.reactions.length > 0);
return {
  page: page.name,
  flows: page.flowStartingPoints,
  topLevel: page.children.map(n => ({ id: n.id, name: n.name, type: n.type,
    w: Math.round(n.width), h: Math.round(n.height), overflow: n.overflowDirection ?? null })),
  reactionCount: withR.length,
  reactions: withR.slice(0, 80).map(n => ({ id: n.id, name: n.name,
    triggers: n.reactions.map(r => r.trigger?.type),
    targets: n.reactions.flatMap(r => (r.actions ?? []).map(a =>
      a.type === "NODE" ? `${a.navigation}->${a.destinationId}` : a.type)) })),
  componentSets: page.findAll(n => n.type === "COMPONENT_SET").map(s => ({ id: s.id, name: s.name,
    props: Object.keys(s.componentPropertyDefinitions ?? {}),
    variants: s.children.map(v => ({ id: v.id, name: v.name })) })),
  fixedOrSticky: page.findAll(n => n.scrollBehavior && n.scrollBehavior !== "SCROLLS")
    .map(n => ({ id: n.id, name: n.name, scrollBehavior: n.scrollBehavior })),
};
```

### B — Batch link (write)

For merging with a node's existing reactions, and for writing many nodes in one
round trip. `params.links` is built from the approved Interaction Map;
`params.mode` is `"merge"` (default — replaces only same-trigger reactions) or
`"replace"` (clears the node first).

```js
const results = [];
for (const l of params.links) {
  const node = await figma.getNodeByIdAsync(l.from);
  if (!node || !("setReactionsAsync" in node)) {
    results.push({ from: l.from, error: "node missing or cannot hold reactions" });
    continue;
  }
  for (const a of l.actions) {
    if (a.type === "NODE" && !(await figma.getNodeByIdAsync(a.destinationId)))
      throw new Error(`Destination ${a.destinationId} not found for ${node.name}`);
  }
  const keep = params.mode === "replace" ? [] :
    node.reactions.map(({ action, ...r }) => r).filter(r => r.trigger?.type !== l.trigger.type);
  await node.setReactionsAsync([...keep, { trigger: l.trigger, actions: l.actions }]);
  results.push({ id: node.id, name: node.name,
    insideInstance: node.parent?.type === "INSTANCE",
    reactions: node.reactions.map(r => ({ trigger: r.trigger, actions: r.actions })) });
}
return { mutatedNodeIds: results.filter(r => r.id).map(r => r.id), results };
```

`insideInstance: true` means the reaction is an override on that one instance.
That is fine for a one-off link, but a state every instance needs belongs on
the main component's variant — flag it rather than leaving it silently wrong.

Example `params` — a directional overlay, an Esc key, and a URL. Each is also
writable with `set_reactions`; the script earns its place when several nodes go
in one call, or when existing reactions must survive:

```js
{ mode: "merge", links: [
  { from: "12:88", trigger: { type: "ON_CLICK" }, actions: [
    { type: "NODE", destinationId: "40:2", navigation: "OVERLAY",
      transition: { type: "MOVE_IN", direction: "BOTTOM",
        easing: { type: "GENTLE" }, duration: 0.45 } } ] },
  { from: "40:2", trigger: { type: "ON_KEY_DOWN", device: "KEYBOARD", keyCodes: [27] },
    actions: [ { type: "CLOSE" } ] },
  { from: "12:31", trigger: { type: "ON_CLICK" },
    actions: [ { type: "URL", url: "https://example.com", openInNewTab: true } ] },
] }
```

### C — Variant states (write)

`params`: `{ setId, stateProp: "State", from: "Default", to: "Hover",
trigger: "ON_HOVER", transition, match? }`. `match` pins the other variant
properties when the set has more than one axis (e.g. `{ Size: "Large" }`) —
run once per combination.

```js
const set = await figma.getNodeByIdAsync(params.setId);
if (!set || set.type !== "COMPONENT_SET") throw new Error("Not a component set");
const find = (val) => set.children.find(v =>
  v.variantProperties && v.variantProperties[params.stateProp] === val &&
  Object.entries(params.match ?? {}).every(([k, x]) => v.variantProperties[k] === x));
const a = find(params.from), b = find(params.to);
if (!a || !b) throw new Error(`Variant not found: ${params.from} / ${params.to}`);
const trigger = typeof params.trigger === "string" ? { type: params.trigger } : params.trigger;
const keep = a.reactions.map(({ action, ...r }) => r).filter(r => r.trigger?.type !== trigger.type);
await a.setReactionsAsync([...keep, { trigger, actions: [
  { type: "NODE", destinationId: b.id, navigation: "CHANGE_TO", transition: params.transition } ] }]);
return { mutatedNodeIds: [a.id], from: a.name, to: b.name, reactions: a.reactions };
```

### D — Flows, scroll and sticky (write)

`params`: `{ flows?: [{ nodeId, name }], overflow?: [{ id, dir }], scroll?: [{ id, behavior }] }`.
One flow per device or journey ("Desktop", "Mobile", "Checkout") — the name is
what the client sees in Present mode.

```js
const page = figma.currentPage; const mutated = [];
if (params.flows) page.flowStartingPoints = [
  ...page.flowStartingPoints.filter(f => !params.flows.some(n => n.name === f.name)),
  ...params.flows];
for (const o of params.overflow ?? []) {
  const n = await figma.getNodeByIdAsync(o.id); n.overflowDirection = o.dir; mutated.push(n.id);
}
for (const s of params.scroll ?? []) {
  const n = await figma.getNodeByIdAsync(s.id); n.scrollBehavior = s.behavior; mutated.push(n.id);
}
return { mutatedNodeIds: mutated, flows: page.flowStartingPoints };
```

### E — Motion probe (read)

`params`: `{ id }` — any layer inside the target frame. Run once, before
planning any motion.

```js
const n = await figma.getNodeByIdAsync(params.id);
try {
  return {
    motionApi: typeof figma.motion !== "undefined",
    timelines: n.timelines,
    tracks: Object.keys(n.manualKeyframeTracks ?? {}),
    styles: (n.animationStyles ?? []).map(s => s.name),
    presets: figma.motion ? figma.motion.figmaAnimationStyles().map(s => s.name) : [],
  };
} catch (e) {
  return { motionApi: false, error: String(e) };
}
```

`"not a supported API"` means Motion is off for this account or runtime. Stop,
say so, offer the prototype equivalent. Do not retry.

### F — Reveal / stagger (write) — the workhorse

`params`: `{ items: [{ id, delay? }], start: 0, stagger: 0.08, duration: 0.5,
rise: 24, scaleFrom: null, easing: { type: "EASE_OUT" } }`. Each item fades from
0 to **its own** opacity and rises `rise` px to 0, optionally scaling from
`scaleFrom`, starting at `start + i * stagger` or its own `delay`.

Items in **different** top-level frames sit on different timelines — run once
per frame. For a horizontal reveal, pass `rise: 0` and add a `TRANSLATION_X`
track with script G.

```js
const p = Object.assign({ start: 0, stagger: 0.08, duration: 0.5, rise: 24,
  scaleFrom: null, easing: { type: "EASE_OUT" } }, params);
const mutated = []; let end = 0; let any = null;
for (let i = 0; i < p.items.length; i++) {
  const it = p.items[i];
  const n = await figma.getNodeByIdAsync(it.id);
  if (!n) throw new Error(`Missing ${it.id}`);
  if (n.parent?.type === "PAGE") throw new Error(`${n.name} is a top-level frame — animate its children`);
  const t0 = it.delay ?? (p.start + i * p.stagger);
  const t1 = +(t0 + p.duration).toFixed(3);
  const K = (name, a, b) => n.applyManualKeyframeTrack({ type: "PROPERTY", name }, { keyframes: [
    { timelinePosition: t0, value: { type: "FLOAT", value: a } },
    { timelinePosition: t1, value: { type: "FLOAT", value: b }, easing: p.easing } ] });
  K("OPACITY", 0, n.opacity ?? 1);
  if (p.rise) K("TRANSLATION_Y", p.rise, 0);
  if (p.scaleFrom) K("SCALE_XY", p.scaleFrom, 1);
  mutated.push(n.id); end = Math.max(end, t1); any = n;
}
const [tl] = any.timelines;
if (tl && tl.duration < end) { any.setTimelineDuration(tl.id, end); mutated.push(tl.id); }
return { mutatedNodeIds: mutated, end, timelines: any.timelines };
```

### G — Generic tracks (write)

`params.tracks`: `[{ id, field, keyframes }]` for anything script F does not
cover — rotation spin, path draw, corner morph, width grow, colour shift.

```js
const mutated = new Set(); const ends = new Map();
for (const t of params.tracks) {
  const n = await figma.getNodeByIdAsync(t.id);
  if (!n) throw new Error(`Missing ${t.id}`);
  n.applyManualKeyframeTrack({ type: "PROPERTY", name: t.field }, { keyframes: t.keyframes });
  mutated.add(n.id);
  const last = Math.max(...t.keyframes.map(k => k.timelinePosition));
  const [tl] = n.timelines;
  if (tl) ends.set(tl.id, { node: n, tl, end: Math.max(last, ends.get(tl.id)?.end ?? 0) });
}
for (const { node, tl, end } of ends.values())
  if (tl.duration < end) { node.setTimelineDuration(tl.id, end); mutated.add(tl.id); }
return { mutatedNodeIds: [...mutated] };
```

Worked values: path draw — `PATH_TRIM_END` 0 → 1 over 1.2 s `EASE_IN_AND_OUT`
on a vector stroke. Spinner — `ROTATION` 0 → −360 `LINEAR` over 1 s. Progress
bar — `WIDTH` 0.01 → the design width, `EASE_OUT`. Card lift — `TRANSLATION_Y`
0 → −6 plus `effects[0].RADIUS` 8 → 24.

A keyframe value is typed: `{ type: "FLOAT", value: 0 }`,
`{ type: "VECTOR", value: { x, y } }`, `{ type: "COLOR", value: { r, g, b, a } }`
with channels 0–1. Fill and stroke colour are keyed by paint index and are the
one case that needs an object assignment rather than
`applyManualKeyframeTrack` — merge, never overwrite:

```js
const existing = node.manualKeyframeTracks ?? {};
node.manualKeyframeTracks = { ...existing, fills: { ...(existing.fills ?? {}), 0: { keyframes: [
  { timelinePosition: 0,   value: { type: "COLOR", value: { r: 0.1, g: 0.1, b: 0.1, a: 1 } } },
  { timelinePosition: 0.4, value: { type: "COLOR", value: { r: 0.2, g: 0.4, b: 1, a: 1 } },
    easing: { type: "EASE_OUT" } } ] } } };
```

Effects use the indexed helper:
`node.applyManualKeyframeTrack({ type: "INDEXED_ITEM", collection: "effects", index: 0, field: "RADIUS" }, { keyframes })`.

### H — Audit (read)

Run before reporting, every time. `params.rootIds` limits it to those top-level
frames; with no params it scans the whole current page.

```js
const page = figma.currentPage;
const topOf = (n) => { while (n.parent && n.parent.type !== "PAGE") n = n.parent; return n; };
const paths = (root) => {
  const out = new Map();
  const walk = (n, pre) => { for (const c of (n.children ?? [])) {
    const p = pre ? `${pre}/${c.name}` : c.name;
    out.set(p, (out.get(p) ?? 0) + 1);
    if (c.type !== "INSTANCE") walk(c, p); } };
  walk(root, ""); return out;
};
const roots = params && params.rootIds
  ? (await Promise.all(params.rootIds.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean)
  : page.children;
const nodes = roots.flatMap(r => [r, ...(r.findAll ? r.findAll(n => "reactions" in n && n.reactions.length) : [])])
  .filter(n => "reactions" in n && n.reactions.length);

const broken = [], wrongNav = [], smart = [], outgoing = new Set(), targets = new Set();
for (const n of nodes) {
  const src = topOf(n); outgoing.add(src.id);
  for (const r of n.reactions) for (const a of (r.actions ?? [])) {
    if (a.type !== "NODE") continue;
    const d = await figma.getNodeByIdAsync(a.destinationId);
    if (!d) { broken.push({ from: n.name, id: n.id, dest: a.destinationId }); continue; }
    if (["NAVIGATE", "OVERLAY", "SWAP"].includes(a.navigation)) {
      targets.add(d.id);
      if (d.parent?.type !== "PAGE")
        wrongNav.push({ from: n.name, nav: a.navigation, dest: d.name, issue: "destination is not a top-level frame" });
    }
    if (a.navigation === "SCROLL_TO" && topOf(d).id !== src.id)
      wrongNav.push({ from: n.name, nav: "SCROLL_TO", dest: d.name, issue: "target is in another frame" });
    if (a.navigation === "CHANGE_TO" && d.parent?.type !== "COMPONENT_SET")
      wrongNav.push({ from: n.name, nav: "CHANGE_TO", dest: d.name, issue: "destination is not a variant" });
    const t = a.transition;
    if (t && (t.type === "SMART_ANIMATE" || t.matchLayers) && a.navigation !== "CHANGE_TO" && d.parent?.type === "PAGE") {
      const A = paths(src), B = paths(d);
      const dup = [...A.entries(), ...B.entries()].filter(([, c]) => c > 1).map(([k]) => k);
      smart.push({ from: src.name, to: d.name,
        matched: [...A.keys()].filter(k => B.has(k)).length,
        onlyInSource: [...A.keys()].filter(k => !B.has(k)).slice(0, 15),
        onlyInDest: [...B.keys()].filter(k => !A.has(k)).slice(0, 15),
        duplicateNames: [...new Set(dup)].slice(0, 10) });
    }
  }
}
const deadEnds = [];
for (const id of targets) if (!outgoing.has(id))
  deadEnds.push({ id, name: (await figma.getNodeByIdAsync(id))?.name });

const timelineIssues = [];
try {
  for (const r of roots) {
    if (!r.findAll) continue;
    const animated = r.findAll(n => n.manualKeyframeTracks && Object.keys(n.manualKeyframeTracks).length);
    if (!animated.length) continue;
    let last = 0;
    for (const n of animated) {
      const all = [];
      for (const v of Object.values(n.manualKeyframeTracks)) {
        if (v?.keyframes) all.push(...v.keyframes);
        else if (v && typeof v === "object") for (const sub of Object.values(v)) {
          if (sub?.keyframes) all.push(...sub.keyframes);
          else if (sub && typeof sub === "object") for (const f of Object.values(sub))
            if (f?.keyframes) all.push(...f.keyframes);
        }
      }
      for (const kf of all) last = Math.max(last, kf.timelinePosition);
    }
    const [tl] = animated[0].timelines ?? [];
    if (tl && tl.duration + 1e-3 < last) timelineIssues.push({ frame: r.name, timeline: tl.duration, lastKeyframe: last });
  }
} catch (e) { timelineIssues.push({ note: "motion API unavailable: " + String(e) }); }

return { flows: page.flowStartingPoints, interactiveNodes: nodes.length,
  broken, wrongNav, deadEnds, smartAnimate: smart, timelineIssues };
```

Reading the result:

- `broken` — fix the destination or remove the reaction. Ask if it is unclear
  which was meant.
- `wrongNav` — the navigation type does not suit the destination. Fix against
  the navigation table above.
- `deadEnds` — screens a user can enter but not leave. Fine for a final "Thank
  you"; otherwise add Back, Home or Close. Report which you judged intended.
- `smartAnimate.onlyInSource` / `onlyInDest` — those layers dissolve instead of
  morphing. Expected where the content genuinely changes; a defect for anything
  the plan said should morph → rename, with approval.
- `timelineIssues` — extend with `setTimelineDuration`.

## Limits — report, do not work around

| Situation | What to tell the user |
| --- | --- |
| Motion probe says "not a supported API" | Figma Motion is not enabled for this account or runtime — plus the prototype equivalent you propose instead |
| No scroll-into-view trigger exists | Which of the three options you chose, and why |
| Prototype device and background (Present settings) | Not in the Plugin API: Prototype panel in the right sidebar with nothing selected → Device |
| Overlay position or background interaction | Settable: pass `overlayPositionType` / `overlayBackgroundInteraction` on the action. The overlay *background colour* is not in the Plugin API — give the exact Interaction-panel value |
| Reaction lands inside an instance | It is an override on that instance only; a state every instance needs goes on the main component's variant |
| Hover on a mobile flow | Replaced with tap or press, and say so |
| Smart Animate names do not match | List them and ask before renaming — a rename can break another link |
| A state, frame or variant the plan needs does not exist | Offer to build it; never invent content silently |
| Figma computes a spring's own duration | The `duration` passed is kept but the spring decides the feel — read back before quoting a number |

Never delete, detach, restructure or restyle anything outside the approved
plan. Never reduce a font size, clip text or change approved typography to make
motion fit.
