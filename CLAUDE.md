# Figma Responsive Execution Rules

Scope, Variables, Hug Height & Layer Optimization.

Apply these rules to **any** work on an existing Figma design: responsive adjustments,
layer cleanup, layer renaming, or related design-system tasks.

**Core principle:**
Understand → Scope → Inspect Variables → Execute Only Requested Work →
Fill Width → Hug Height → Optimize Relevant Layers → Validate → Stop.

---

## 1. Understand the designer request first

Identify exactly what was asked before touching anything. Never assume additional tasks.

| Request | Do only this |
| --- | --- |
| "Make the tablet responsive" | Tablet — 768px. Do **not** create or modify Mobile. |
| "Make the mobile responsive" | Mobile — 320px. Do **not** modify Tablet. |
| "Rename the layers" | Rename layers. No redesign, no spacing/typography changes, no new Auto Layout, no responsive versions, no unrelated cleanup. |
| "Optimize the layers" | Layer optimization only. |

**Core scope rule:** understand the request → define the scope → execute only that scope.
No extra design work unless explicitly requested.

## 2. Breakpoints are processed separately

Standard breakpoints: **Desktop 1440px · Tablet 768px · Mobile 320px**.
Only work on the breakpoint the designer requested.

- **Tablet-only:** inspect the Desktop source → work only on the 768px frame →
  complete tablet responsiveness A to Z → validate → **stop**. Do not continue to Mobile.
- **Mobile-only:** inspect the approved source → work only on the 320px frame →
  complete → validate → **stop**. Do not modify Tablet.
- **Tablet + Mobile:** Phase 1 is Tablet, complete and fully checked (responsive, clean,
  correct variables, no fixed-height responsive content, structure optimized only where
  necessary). Then stop and ask:

  > Tablet responsiveness is complete. Should I proceed with the 320px Mobile version?

  Only begin Mobile after confirmation.

Never process Tablet and Mobile simultaneously. Finish one breakpoint completely first.

## 3. Use existing Figma variables and tokens

Before typing any spacing, width, gap, radius, padding, or design value, inspect the
existing local variable collections. The system may define breakpoint modes
(`Desk` 1440, `Tab` 768, `Mobi` 320) and variables such as: Width, Left-Right,
Top-Bottom, Row Gap, Column Gap, Text Container, Radius, Button, Pages, Gap.

**Variable priority when a value is needed:**
1. Search the local Figma variable collections.
2. Find the variable matching the current component/section.
3. Select the correct mode for the requested breakpoint.
4. Bind the property to that variable.
5. Only use a manual value when no suitable token exists.

Example — if `Left-Right` resolves to `spacing/100` (Desktop), `spacing/40` (Tablet),
`spacing/20` (Mobile), bind the variable. Do not type `40px` manually on Tablet.

## 4. If a required variable does not exist

Do **not** auto-create a token. First: re-check related collections, check whether another
existing token is intentionally used for that purpose, check the source/Desktop frame.
If no correct token exists, ask:

> I cannot find an existing local variable for this spacing value. Should I use the current
> manual value or add a new token?

Never silently expand the design system.

## 5. Critical height rule — never fix the height of responsive content

**Mandatory.** Normal responsive layers must not carry a fixed numeric height
(e.g. `H 252`). Use **Height → Hug Contents**.

Applies to: sections · content wrappers · text containers · heading containers ·
paragraph containers · cards · feature blocks · hero content · CTA blocks · form wrappers ·
navigation content · footer columns · article/content areas · Auto Layout frames ·
anything whose height depends on its children.

## 6. Typography grows naturally

Keep the existing local typography style, font size, family, weight, line height and
letter spacing. Allow natural wrapping, use Auto Height / Hug Contents, let the parent
grow with the content. If text wraps to more lines on Tablet or Mobile, height increases
automatically.

Do not: set a manual pixel height, clip text, reduce font size to fit, or change the
typography style to solve a height problem.

## 7. Preferred responsive sizing

| Element | Width | Height |
| --- | --- | --- |
| Container | Fill Container | Hug Contents |
| Text block | Fill Container | Hug Contents / Auto Height |
| Card | Fill Container | Hug Contents |
| Content column | Fill Container | Hug Contents |
| Button | Hug Contents | Hug Contents |
| Full-width mobile CTA | Fill Container | Hug Contents |

## 8. Fixed height exceptions

Fixed height is never the default. It may remain only for elements that intentionally
require a fixed physical dimension: icons, small controls, avatars, explicit image crops,
brand assets, or an existing component with a deliberately fixed spec.
Never extend these exceptions to normal text or content containers.

## 9. Auto Layout is used intentionally

Do not add Auto Layout to every layer just because responsive work is happening. Use it
when it genuinely improves responsive flow, spacing, alignment, stacking, wrapping,
Fill Container or Hug Contents behavior. If a wrapper is unnecessary and removing it makes
the structure cleaner without changing the design, remove it. Avoid needless nesting.

## 10. Optimize the layer structure

Within the requested scope only, remove or simplify: empty frames, empty groups,
unnecessary wrappers, duplicate layers, accidental copies, redundant nested frames,
Auto Layout wrappers with no function, layers with no visual or layout effect.

Never delete: required component layers, component properties, variant structure,
necessary masks, existing design-system elements, layers used for interaction/prototyping.

**Optimization process:**
1. **Scan first** — inspect the whole section/file before removing anything.
2. **Collapse to one layer of Auto Layout** — where a single Auto Layout frame does the job,
   remove the extra groups, double/nested frames and wrappers so the structure is short and solid.
3. **Grid or normal flow** — convert repeating row/column items (card lists, feature grids,
   galleries) to Grid Auto Layout; keep everything else in normal (horizontal/vertical)
   Auto Layout. Choose whichever gives the cleaner, more developer-friendly structure.
   If a Grid conversion would shift spacing, alignment or wrapping, do not convert — keep the
   existing structure and report it.
4. **Reuse system padding** — before setting any padding or gap on an optimized frame, check
   the local variables (Left-Right, Top-Bottom, Row Gap, Column Gap, etc.) and bind the existing
   token. If none exists, follow section 4 (ask; never auto-create).
5. **Conflict-free** — optimized layers must not break other components, instances, variables,
   styles or prototype links. Compare before/after screenshots to confirm the design is unchanged.

## 11. Optimization must not change the design

Layer optimization is structural cleanup. It must not cause visual redesign, typography or
color changes, content changes, unnecessary spacing changes, component detachment,
unexpected resizing, or deleted functionality. The design must look the same unless
responsive adaptation was specifically requested.

## 12. Do not perform extra work

| Request | Allowed | Not allowed |
| --- | --- | --- |
| "Rename these layers" | Rename layers | Responsive redesign, new components, spacing or typography changes, Mobile generation, variable restructuring |
| "Fix Tablet responsiveness" | Tablet responsive changes, necessary Tablet layer optimization, correct variable usage, Tablet fixed-height corrections | Mobile responsiveness, Desktop redesign, unrelated component redesign |
| "Optimize this layer structure" | Remove redundant wrappers, clean hierarchy, rename obvious generic layers as part of that optimization | Redesign the section, change approved typography, change content |

## 13. Responsive height QA

Before marking a breakpoint complete, inspect every relevant content layer and confirm:
no fixed height on sections, text containers, paragraphs, heading wrappers, cards or
content wrappers; text grows naturally; parents grow naturally; Hug Contents used for
content-driven height; Fill Container used for flexible width; no clipped text; no overlap
caused by height constraints. If a numeric height is found, verify it is genuinely
required — otherwise replace it with Hug Contents.

## 14. Variable QA

For the requested breakpoint verify: existing local variables were inspected; the correct
breakpoint mode is used; existing spacing, container, gap and radius variables are reused
where applicable; no duplicate variable was created unnecessarily; no arbitrary value was
introduced where an appropriate token exists.

## 15. Task completion workflow

1. **Read request** — determine exactly what was asked.
2. **Define scope** — which frame, breakpoint, section; responsive / rename / cleanup / other.
3. **Inspect existing system** — components, variables, variable modes, local styles, layer structure.
4. **Execute only requested work.**
5. **Fix responsive sizing** — Fill Container width, Hug Contents height, no arbitrary fixed content height.
6. **Optimize relevant layers** — only structure related to the current task.
7. **QA** — fixed height, overflow, layer structure, variables, visual consistency, task scope.
8. **Stop** — do not automatically move to another breakpoint or another type of work.

## 16. Mandatory rules summary

- Understand the exact requirement first; do only the requested work.
- Never make Tablet and Mobile responsive at the same time.
- Tablet request = Tablet only. Mobile request = Mobile only.
- Tablet + Mobile = finish Tablet, then ask permission before Mobile.
- Reuse existing Figma variables/tokens whenever available; ask before creating one.
- Never use a fixed numeric height for normal responsive content.
- Hug Contents for content-driven height; Fill Container for flexible width.
- Text uses Auto Height / Hug Contents and grows naturally.
- Never reduce font size or change approved typography to solve a height problem.
- Optimize unnecessary layers without changing the approved design.
- Do not add Auto Layout that serves no layout purpose.
- Optimization: scan first, collapse redundant wrappers, use Grid for repeating row/column
  items and normal Auto Layout elsewhere, bind existing padding tokens, stay conflict-free.
- Do not perform extra work the designer did not request.

> **Most important responsive sizing rule:** never solve responsive content with a fixed
> numeric height. Content-driven layers must use Hug Contents so the design grows naturally
> with its content.

---

## 17. Figma → Webflow conversion standard

Applies to **any** work converting a Figma design into a Webflow site.

The conversion runs in **two stages**, and skipping stage 1 is the expensive way:

| Stage | Skill | Job |
| --- | --- | --- |
| 1 | `Webflow_Prepare_v1` | Duplicate the page in Figma and restructure it into Client-First shape. The design does not change. The designer reviews it here. |
| 2 | `Webflow_Export_v1` | Walk the prepared page and build the site in Webflow. |

Doing the structural thinking in Figma first is cheaper on every axis: the Figma
tooling is mature, the result is reviewable before Webflow is touched, stage 2
becomes a walk over a decided structure rather than a judgment call per section,
and the prepared page is a deliverable a developer can hand-build from.

**Naming is Client-First** (Finsweet). Layer names on the prepared page become
Webflow class names verbatim — custom classes `hero-header_content`, utility
classes `padding-global` / `heading-style-h1`, combo classes `button is-primary`.

These are the rules both stages are judged against. If a rule here cannot be met, stop and say which one and why. A page
failing one of these is not "nearly done", it is not done.

### 17.1 Pixel-perfect replication

The Webflow page matches the Figma file exactly. Not one section, text, shadow,
border, icon or spacing value is missing or approximated, however small.
Responsive behaviour follows Figma's breakpoints exactly.

⚠️ Figma's breakpoints and Webflow's do not line up. Webflow's tablet holds from
768 to **991**, and no Figma mode covers **480–767** at all. That gap is handled
explicitly — tablet verified at both ends, the 480–767 band decided with the
designer — never left to inherit by accident.

### 17.2 Global variables and tokens — no hard-coded values

- **Colour.** Every colour is a Webflow **global variable**. A hard-coded colour
  is a defect, including in hover states, borders, shadows and gradients.
- **Spacing.** Margin, padding, gap and layout spacing come from spacing
  variables or a shared global class, matching Figma exactly.
- **Typography.** Font size, line height, weight and family are set on the
  **global tag** — H1–H6, paragraph, body — before any class exists. A class
  carries only what genuinely differs from its tag, and never restates the tag's
  values; a duplicated line height is what silently breaks when the base changes.

A value the Figma file never tokenised is **escalated, not hard-coded**. Section
4's rule still holds — never silently expand the design system — so ask:

> This colour (#xxxxxx, used on <element>) has no variable in the Figma file.
> Should I add it as a Webflow variable, or is it intentionally a one-off?

### 17.3 Component-based development

Anything appearing more than once — button, card, nav bar, footer, list row — is
a reusable Webflow **component**, not a copied block. Figma component
**properties and variants** carry across as Webflow component properties and
variants, keeping the designer's exact names, so the same switch the designer
had is the switch the developer gets. A property Webflow cannot express is
reported, never flattened into a hard-coded value.

### 17.4 Zero repetition and self-audit

- **Fix once, everywhere.** A reported defect is searched for across the whole
  page, fixed in every instance, and the count reported. Being told the same
  thing twice is a process failure, not a user preference.
- **Audit before handing over.** Never give anyone a preview link before walking
  the built page against the Figma screens yourself, screen by screen and
  breakpoint by breakpoint, against the checklist in `Webflow_Export_v1`. That
  is the developer's job, not the designer's. Say that the audit was run, and
  name any line that could not be verified.

### 17.5 What this repo's own tools can and cannot do

Webflow splits its API the way Figma does, and the split decides which tool does
which job:

| | Runs inside the app | Runs from this MCP server |
| --- | --- | --- |
| Figma | Plugin API, via the bridge | REST API (`figma-rest.ts`) |
| Webflow | **Designer API** — a Designer Extension | **Data API** (`webflow-rest.ts`) |

This repo has **both** halves, and each is switched on separately:

| Half | Tools | Route | Switch |
| --- | --- | --- | --- |
| Content | `webflow_*` (16) | Data API over HTTP | **Webflow API token** |
| Canvas | `webflow_designer_*` (12) | The relay, to `webflow_extension/` | **Webflow Designer tools** checkbox |

Everything in 17.1–17.3 is canvas work, so it needs the second switch **and** the
Designer Extension running and joined to the same channel as Figma.

**Webflow's own MCP server, connector and Bridge App are not used and not
needed.** If a session reaches for them, the canvas tools are switched off — that
is the fix, not another integration.

`webflow_preflight` reports all three legs — Figma channel, token and scopes,
extension — in one call. Call it before planning Webflow work, not after hitting
a wall.
