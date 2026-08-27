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
- Do not perform extra work the designer did not request.

> **Most important responsive sizing rule:** never solve responsive content with a fixed
> numeric height. Content-driven layers must use Hug Contents so the design grows naturally
> with its content.
