/**
 * This module contains all the prompts used by the Figma MCP server.
 * Prompts provide guidance to Claude on how to work with Figma designs effectively.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register all prompts with the MCP server
 * @param server - The MCP server instance
 */
export function registerPrompts(server: McpServer): void {
  // Local Design Library First — governs all creation and editing
  server.prompt(
    "design_system_first",
    "Local design library first: inspect and reuse what the file already defines before creating anything",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `LOCAL DESIGN LIBRARY FIRST

Before creating, editing, generating, or modifying anything in Figma, inspect
the current file and treat it as the primary source of truth.

CORE RULE
Do not start designing from scratch before checking what already exists locally.
Call get_design_system() first. One call returns typography, colours, variables
and tokens, components and component sets with their variant properties, and the
spacing, radius and type conventions actually observed in the file.

For a new screen or section, also read nearby designs — get_document_info(),
get_node_info() on a comparable screen — and treat them as implementation
references, not merely visual inspiration.

REUSE BEFORE CREATING — in strict priority order
  1. Reuse an existing component exactly when it already solves the need.
  2. Reuse an existing variant when an appropriate variation exists.
  3. Compose existing components when the result can be built from current
     primitives.
  4. Extend the system when a new variant or pattern is genuinely required.
  5. Create something new only as a last resort.

Never create a duplicate component, style, variable, or pattern when an
equivalent already exists.

MATCH THE EXISTING DESIGN LANGUAGE
New work must read as a natural continuation of the file. Match the existing
visual hierarchy, typography, colour usage, spacing, radii, component anatomy,
icon style, density, alignment, grid behaviour, naming conventions, variable
structure, and component architecture.

Do not introduce arbitrary new fonts, colours, spacing values, radii or shadows
when suitable values already exist. Prefer the values get_design_system() reports
under OBSERVED CONVENTIONS over round numbers you would otherwise pick.

BIND, DO NOT HARDCODE
  - Colour     → apply_variable_to_node() with an existing colour variable,
                 or set_fill_color() with an existing style's value.
  - Spacing,   → apply_variable_to_node() with the existing spacing, gap,
    gap,          radius or size token: itemSpacing, paddingLeft, cornerRadius,
    radius,       maxWidth and the rest are all bindable fields.
    size
  - Type       → set_text_style_id() with an existing text style.
  - Effects    → set_effect_style_id() with an existing effect style.
  - Components → create_component_instance() with an existing key;
                 set_instance_variant() to select the right variant.

When a variable exists for a value, BIND the variable. Do not read the token's
resolved number or hex and type that in — a copied value looks identical and is
not connected: it stops following the design system, and it stops responding to
the Desk / Tab / Mobi mode of the frame it sits in.

  find_variable()              resolve a token path strictly, before binding
  apply_variable_to_node()     bind one property, by token path
  apply_variable_bindings()    bind many at once, with a bound/unbound report
  get_node_variable_bindings() verify afterwards; find raw values that should
                               have been bound
  switch_variable_mode()       set Desk / Tab / Mobi on a frame, or let it infer
                               the breakpoint from the frame's width
  import_library_variable()    pull a token in from an enabled team library
                               rather than making a local duplicate

Matching is exact. colors/Base/Primary, colors/Primary/500 and colors/Primary/700
are different tokens with related values — never substitute one for another
because the numbers look close. Bind the SEMANTIC token, not the primitive it
aliases: colors/Gray/500 → colors/Base/Gray Main → #525252 means you bind
colors/Gray/500.

If no token matches, apply the exact value manually and say which properties are
not token-connected. Never invent a token, and never widen the system to make
one fit — set_variable() refuses to create anything unless you pass
createIfMissing, which is the designer's call, not yours.

PRESERVE SYSTEM CONSISTENCY WHEN EDITING
  - Preserve established components; do not rebuild them by hand.
  - Keep existing variable bindings intact.
  - Do not detach instances unnecessarily — detach_instance() is a last resort.
  - Preserve component properties and variants.
  - Maintain naming conventions.
  - Do not silently introduce one-off values.

DECISION PRINCIPLE
For every design decision ask: does the current file already define how this
should look or behave? If yes, use it. If partially, extend it consistently.
Only invent when the existing system genuinely does not cover the requirement.

DEFAULT BEHAVIOUR
Local design system first. Existing patterns first. Reuse first. Extend second.
Create new last.`,
            },
          },
        ],
        description:
          "Local design library first: inspect and reuse what the file already defines before creating anything",
      };
    }
  );

  // Responsive Website — preserve the design system while adapting layout
  server.prompt(
    "responsive_website_strategy",
    "Adapt an existing design across breakpoints without redesigning it",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `RESPONSIVE WEBSITE — Inspect → Reuse → Adapt → Validate

Analyze the existing Figma design before making changes. Reuse local components,
component variants, variables, text styles, colour styles, spacing patterns and
existing responsive examples wherever possible. Do not redesign the page simply
because the viewport becomes smaller. Adapt layout behaviour while preserving the
visual identity, content, hierarchy and reusable component system. Create new
components or variants only when the existing system cannot support the required
responsive behaviour. Always validate mobile layouts at both 390px and 320px.

CORE RULE
Existing typography/colour variables + Auto Layout + Fill container + Hug contents.
Solve layout and wrapping first. Never invent type values, detach style/variable
bindings, enlarge body copy at Tablet size, or add a fixed height.

WORKFLOW
  1. get_design_system()   — what the file already defines
  2. analyze_responsive()  — per-section plan; changes nothing
  3. clean_layers()        — tidy only when layer cleanup is in the requested scope
  4. make_responsive()     — generate the requested breakpoint only
  5. validate_responsive() — validate that breakpoint
  6. Report the summary and every manual-review item, then stop

FRAME ORGANIZATION — ALWAYS
Never build a tablet or mobile layout from scratch. For a new breakpoint, follow
this exact order: Desktop frame -> Duplicate exactly -> Move beside Desktop ->
Rename for the breakpoint -> Resize -> Apply responsive changes inside the copy.
Keep the copy in the same section/page area whenever possible. Arrange siblings
left to right as Desktop, Tablet, Mobile. Use clear names such as "Single Work –
768px Tab" and "Single Work – 320px Mobile". The original desktop frame must
remain completely unchanged.

If the designer supplies an exact width, pass it as targetWidth and use it
everywhere: frame width, name, layout calculation and validation. For example,
834px Tablet becomes "Single Work – 834px Tab" and 390px Mobile becomes
"Single Work – 390px Mobile". Never replace a requested width with a default.

Before duplicating, inspect the desktop frame's siblings. If a matching tablet,
mobile, Tab, 768px, 320px, or similarly named frame for the same design already
exists, update that frame instead of creating a duplicate elsewhere. If that
existing frame is an empty placeholder, refresh its slot from an exact desktop
clone before adapting it.

ABSOLUTE-POSITIONED LAYERS — COPY AND LEAVE UNTOUCHED
An absolute-positioned layer is designer-controlled and is an immutable subtree
during responsive generation. Copy it with the desktop frame exactly as it is.
Do not ungroup it. Do not restructure, detach, rebuild, convert, resize, rebind,
rename, reorder, or change its positioning behaviour. Do not modify anything
inside it. Exclude the whole subtree from automatic layout changes, Fill/Hug
enforcement, variable rebinding, layer cleanup and responsive QA fixes.

Even if the copied layer overflows or does not fit the tablet/mobile frame, leave
it unchanged and report it for manual designer adjustment. Never recommend
converting that existing absolute layer to Auto Layout as part of responsive
generation.

DESKTOP SPACING IS THE REFERENCE AND THE CEILING
Before responsive changes, inspect and preserve the desktop spacing relationship
between sections, layers, text blocks, buttons, images and other elements.
Tablet/mobile gaps and padding may stay equal to desktop or become smaller as the
viewport narrows. They must never become larger without an explicit,
designer-approved reason.

Examples:
  Desktop 20px -> Tablet 20px  allowed
  Desktop 20px -> Tablet 16px  allowed
  Desktop 20px -> Tablet 12px  allowed
  Desktop 20px -> Tablet 40px  forbidden

Use the desktop value as a per-layer ceiling for item spacing, row/column gaps
and all four padding sides. Run the comparison after breakpoint variable modes
resolve, because a Tab/Mobi token can otherwise make spacing larger even when
the direct layout transform only reduced it. Preserve token bindings: if a
responsive variable mode exceeds desktop, keep that node on the desktop mode
for the relevant spacing collection rather than detaching or hardcoding the
token. Preserve the desktop hierarchy and visual relationships; never introduce
extra whitespace randomly.

BREAKPOINTS
Default design frames are 1440 (source), 768 (tablet) and 320 (mobile).
The designer's exact requested width always overrides 768/320. Use targetWidth
with the requested Tablet or Mobile behaviour; when no category is supplied,
widths at or below 480px infer Mobile and larger widths infer Tablet.
Process one breakpoint at a time. A Tablet request without a width changes only
768px; a Mobile request without a width changes only 320px. If the designer
requests Tablet and Mobile, finish
and validate Tablet first, report it, then ask for confirmation before beginning
Mobile. Never generate or modify both in one make_responsive call.
Do not create 1280, 1024, 480 or 390 design frames by default. Intermediate
widths are handled by Auto Layout, fill/hug sizing, wrapping, min/max widths and
component variants — not by more frames. Add a width only when the user asks,
the project already uses it, or a problem cannot be validated without it.
390px and 320px are both QA widths. A layout that works at 390 but breaks at 320
is not responsive.

TYPOGRAPHY — KEEP IT CONNECTED TO THE DESIGN SYSTEM
Keep the exact desktop text style/variable whenever it remains readable. Body
copy should normally stay close to its desktop size, especially at Tablet; never
enlarge it merely because the frame is 768px. Reduce spacing and improve column
width before allowing excessive wrapping.

When an oversized heading still does not fit after layout adaptation, use an
existing smaller Tablet/Mobile text style or typography variable from the same
family. Never invent a breakpoint size, detach a text layer, or manually override
font family, size, weight, line height or letter spacing. If no relevant token or
style exists, keep the desktop style and flag it for designer review.

WHEN TEXT DOES NOT FIT — solve layout first
Use this order before considering an existing responsive typography token:
  1. Fill container            5. Responsive stacking
  2. Hug contents              6. Reduced container width
  3. Natural text wrapping     7. Existing local spacing values
  4. Auto Layout               8. Row layout → column layout
Multiline text uses Fill width + Auto height. Single-line labels may Hug contents.

AUTO LAYOUT & SIZING — no fixed width, no fixed height
The default for a normal responsive container is:

  Width  → Fill container
  Height → Hug contents

Height must follow content. A height fixed to match the desktop appearance clips
or strands content the moment text rewraps at a smaller width.

  Fill container → content wrappers, columns, cards in grids, form fields, text
                   containers, section content, navigation containers, images
                   that scale, button groups, responsive rows and stacks
  Hug contents   → buttons, badges, tags, labels, navigation items, small
                   controls, icon+text groups, CTA content — and the HEIGHT of
                   every container
  Text           → fills the width it is given, auto height, so it wraps freely

Never use fixed height on sections, cards, text containers or content wrappers,
and never add one to force alignment. Never use a fixed width where Fill
container would do. Constrain column counts with MIN WIDTH, not fixed width.

Only intrinsically-sized elements keep explicit dimensions: icons, avatars,
brand-specified logos, small decorative elements, and controls the design system
sizes explicitly.

Express all of this with set_layout_sizing(nodeId, horizontal, vertical), which
sets Fill / Hug / Fixed without touching pixel values. resize_node writes a
literal size and pins the layer to one viewport — it is for intrinsically-sized
elements only, and it refuses to pin the height of a container that currently
hugs its content. set_auto_layout sets height to Hug by default, because Figma
otherwise leaves a converted frame's height fixed at whatever it happened to be.

A frame cannot hug without Auto Layout: Figma has no content-driven height to
fall back on. If make_responsive reports a container as "still fixed height",
give that wrapper Auto Layout rather than resizing it.

Preserve correct existing Auto Layout; do not flatten it. Do not introduce new
absolute positioning. Existing absolute-positioned layers follow the immutable
copy-and-leave-untouched rule above.

RESPONSIVE BEHAVIOUR, NOT SCALING
Never scale a section proportionally like an image. Decide behaviour per section:
  Navigation  desktop bar → existing mobile variant → hamburger; never a shrunk
              desktop nav. Validate logo, CTA and hamburger do not overlap at 320.
  Hero        768: keep side-by-side only while both columns remain readable;
              stack when the narrow column would create excessive wrapping.
              320: stack, copy above media unless the design says otherwise.
  Card grid   4 per row → 2 on tablet → 1 on mobile. Do not force narrow cards.
  Forms       multi-field rows stack; inputs fill width; keep label/input pairs
              and error/helper states.
  Tables      horizontal scroll, stacked cards or key-value rows. Never shrink
              text to fit.
  Footer      multi-column → 2 on tablet → 1 on mobile.
  Generic     reduce padding and gaps, release fixed dimensions, allow wrapping,
              stack when a horizontal row cannot fit. At 768, evaluate two
              columns instead of automatically treating Tablet as Mobile.

IMAGES
Preserve every image's aspect ratio, crop intent, focal point, subject visibility,
corner radius and relationship to nearby text. Never stretch, remove or replace
an image during responsive work. At Tablet, scale proportionally and stack a
text/image split only when either column becomes unreadable. At Mobile, normal
content images use Fill width with Auto/aspect-controlled height; intentional
fixed crops keep their crop behaviour and focal position.

MOBILE TOUCH TARGETS
Interactive controls at Mobile should provide at least a 44×44px tap area unless
an existing component/token defines a larger target.

CONTAINERS (fallback only — an existing project container system wins)
  1440: max content 1200–1280, side padding 64–80
  768:  side padding 28–32
  320:  side padding 16
Section spacing: desktop 96–128, tablet 72–96, mobile 48–72.

LAYER HYGIENE — the file must be legible, not just look right
Clean layers → meaningful names → remove redundancy → Auto Layout →
Fill container → Hug contents → no fixed height.

NAMING. No layer keeps an auto-generated name — "Frame 123", "Group 45",
"Rectangle 12", "Text 8", "Component 27", "Vector 16" — where a meaningful one
is possible. Name by purpose: Hero Section, Hero Content, Hero Image, Primary
CTA, Navigation, Mobile Menu, Feature Card, Section Heading, Body Copy, Footer
Links. Number repeated elements consistently: "Feature Card / 01", "/ 02",
"/ 03". Names must match across 1440, 768 and 320.

REMOVE. Empty frames and groups, unused hidden layers, duplicate elements and
text, unused rectangles and vectors, temporary and placeholder layers,
accidental copies, redundant wrappers, unnecessary nested frames, and anything
serving no layout or visual purpose. Never remove something that is part of the
component or design system.

STRUCTURE. Avoid Frame → Frame → Frame → Group → Frame → Text. Prefer
Section → Content Wrapper → Content, or Card → Icon + Content + CTA. A frame
earns its place only if it controls Auto Layout, padding, gap, alignment,
responsive direction, clipping, background, border or component structure. If it
does none of those, remove it.

GROUPS. Prefer Auto Layout frames over plain groups for anything that must
respond. A group cannot control padding, gap or direction, so it cannot adapt.

CONSISTENCY. Desktop, Tablet and Mobile should share the same logical structure:
  Hero Section → Container → Hero Content → Eyebrow / Heading / Description /
  CTA Group, plus Hero Media
Do not invent a different tree per breakpoint unless the layout demands it.

CLEANUP MUST NOT BREAK ANYTHING. Never detach instances, delete component
properties, break variants, rebuild an existing component, flatten an editable
component, or turn a reusable component into a plain frame. Never let renaming
or restructuring change a text layer's local style, size, weight, line height or
letter spacing.

NO FIXED HEIGHT — ANY LAYER
Sections, frames, cards, containers, content wrappers, text layers, typography
containers, navigation wrappers, hero content, feature blocks, forms, footers,
CTA sections: all Hug Contents. Height grows with content.

If a heading wraps to two or three lines at 768 or 320, its container grows.
Never pin it to the desktop height, never clip, and never shrink the type to
make it fit.

Do not use a fixed height to align cards of differing content length. Use Auto
Layout, Fill container, Hug contents and parent alignment instead.

CONTENT IS APPROVED — DO NOT REWRITE
Responsive adaptation is not permission to change copy. Do not rewrite headings,
shorten paragraphs, change CTA wording, remove content, or rephrase legal text.
Allowed: line wrapping, width changes, alignment and layout.
If content causes a responsive problem layout cannot solve, FLAG it.

SAFETY — never without explicit user intent
Do not delete the original desktop frame, detach or flatten components, replace
variables, rewrite copy, change brand colours, fonts or logos, remove sections,
reorder content without responsive justification, or replace images.

WHEN BEHAVIOUR IS UNCLEAR
Preserve the original component, apply the least destructive adjustment, and flag
the section for manual review. A clearly flagged fallback is a correct outcome;
a confident wrong guess is not.

DEFINITION OF DONE
The requested exact-width frame is complete and the desktop source is unchanged ·
local components reused, none detached, variants intact · typography remains
linked to existing styles/variables · colour styles and variables preserved · no
duplicate components · all major layers meaningfully named · no "Frame 123"
names left · empty, duplicate and hidden-unused layers removed · redundant
wrappers and excessive nesting reduced · responsive groups on Auto Layout · no
fixed height on any section, card, container or text layer · text on auto height ·
Fill width / Hug height throughout · no content changes · no image distortion ·
no mobile overflow · 390 and 320 validated · changes summarised · manual-review
items clearly identified.`,
            },
          },
        ],
        description: "Adapt an existing design across breakpoints without redesigning it",
      };
    }
  );

  // Design Strategy Prompt
  server.prompt(
    "design_strategy",
    "Best practices for working with Figma designs",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `When working with Figma designs, follow these best practices:

0. Inspect the Local Design Library FIRST (governs everything below):
   - Call get_design_system() before creating or modifying anything
   - Reuse existing components, variants, styles and variables before making new ones
   - Match the spacing, radius and type conventions the file already uses
   - Only create new styles or components when nothing suitable exists
   - See the design_system_first prompt for the full rule
   - Everything below describes HOW to build once you have confirmed that the
     thing you need does not already exist

1. Start with Document Structure:
   - First use get_document_info() to understand the current document
   - Plan your layout hierarchy before creating elements
   - Create a main container frame for each screen/section

2. Naming Conventions:
   - Use descriptive, semantic names for all elements
   - Follow a consistent naming pattern (e.g., "Login Screen", "Logo Container", "Email Input")
   - Group related elements with meaningful names

3. Layout Hierarchy:
   - Create parent frames first, then add child elements
   - For forms/login screens:
     * Start with the main screen container frame
     * Create a logo container at the top
     * Group input fields in their own containers
     * Place action buttons (login, submit) after inputs
     * Add secondary elements (forgot password, signup links) last

4. Input Fields Structure:
   - Create a container frame for each input field
   - Include a label text above or inside the input
   - Group related inputs (e.g., username/password) together

5. Element Creation:
   - Prefer create_component_instance() over building from primitives whenever a
     suitable component exists — check get_design_system() first
   - Use create_frame() for containers and input fields
   - Use create_text() for labels, buttons text, and links
   - Set colors and styles from the existing system, not from invented values:
     * Bind colors with apply_variable_to_node() when a color variable exists
     * Otherwise use fillColor / strokeColor with an existing style's value
     * Apply text styles with set_text_style_id() rather than setting font
       family, size and weight by hand
     * Reach for raw fillColor / fontSize only when the system defines nothing
       suitable

6. Mofifying existing elements:
  - use set_text_content() to modify text content.

7. Visual Hierarchy:
   - Position elements in logical reading order (top to bottom)
   - Maintain consistent spacing between elements
   - Use appropriate font sizes for different text types:
     * Larger for headings/welcome text
     * Medium for input labels
     * Standard for button text
     * Smaller for helper text/links

8. Best Practices:
   - Verify each creation with get_node_info()
   - Use parentId to maintain proper hierarchy
   - Group related elements together in frames
   - Keep consistent spacing and alignment

Example Login Screen Structure:
- Login Screen (main frame)
  - Logo Container (frame)
    - Logo (image/text)
  - Welcome Text (text)
  - Input Container (frame)
    - Email Input (frame)
      - Email Label (text)
      - Email Field (frame)
    - Password Input (frame)
      - Password Label (text)
      - Password Field (frame)
  - Login Button (frame)
    - Button Text (text)
  - Helper Links (frame)
    - Forgot Password (text)
    - Don't have account (text)`,
            },
          },
        ],
        description: "Best practices for working with Figma designs",
      };
    }
  );

  // Read Design Strategy Prompt
  server.prompt(
    "read_design_strategy",
    "Best practices for reading Figma designs",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `When reading Figma designs, follow these best practices:

1. Start with selection:
   - First use get_selection() to understand the current selection
   - If no selection ask user to select single or multiple nodes

2. Get node infos of the selected nodes:
   - Use get_nodes_info() to get the information of the selected nodes
   - If no selection ask user to select single or multiple nodes
`,
            },
          },
        ],
        description: "Best practices for reading Figma designs",
      };
    }
  );

  // Text Replacement Strategy Prompt
  server.prompt(
    "text_replacement_strategy",
    "Systematic approach for replacing text in Figma designs",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Intelligent Text Replacement Strategy

## 1. Analyze Design & Identify Structure
- Scan text nodes to understand the overall structure of the design
- Use AI pattern recognition to identify logical groupings:
  * Tables (rows, columns, headers, cells)
  * Lists (items, headers, nested lists)
  * Card groups (similar cards with recurring text fields)
  * Forms (labels, input fields, validation text)
  * Navigation (menu items, breadcrumbs)
\`\`\`
scan_text_nodes(nodeId: "node-id")
get_node_info(nodeId: "node-id")  // optional
\`\`\`

## 2. Strategic Chunking for Complex Designs
- Divide replacement tasks into logical content chunks based on design structure
- Use one of these chunking strategies that best fits the design:
  * **Structural Chunking**: Table rows/columns, list sections, card groups
  * **Spatial Chunking**: Top-to-bottom, left-to-right in screen areas
  * **Semantic Chunking**: Content related to the same topic or functionality
  * **Component-Based Chunking**: Process similar component instances together

## 3. Progressive Replacement with Verification
- Create a safe copy of the node for text replacement
- Replace text chunk by chunk with continuous progress updates
- After each chunk is processed:
  * Export that section as a small, manageable image
  * Verify text fits properly and maintain design integrity
  * Fix issues before proceeding to the next chunk

\`\`\`
// Clone the node to create a safe copy
clone_node(nodeId: "selected-node-id", x: [new-x], y: [new-y])

// Replace text chunk by chunk
set_multiple_text_contents(
  nodeId: "parent-node-id", 
  text: [
    { nodeId: "node-id-1", text: "New text 1" },
    // More nodes in this chunk...
  ]
)

// Verify chunk with small, targeted image exports
export_node_as_image(nodeId: "chunk-node-id", format: "PNG", scale: 0.5)
\`\`\`

## 4. Intelligent Handling for Table Data
- For tabular content:
  * Process one row or column at a time
  * Maintain alignment and spacing between cells
  * Consider conditional formatting based on cell content
  * Preserve header/data relationships

## 5. Smart Text Adaptation
- Adaptively handle text based on container constraints:
  * Auto-detect space constraints and adjust text length
  * Apply line breaks at appropriate linguistic points
  * Maintain text hierarchy and emphasis
  * Consider font scaling for critical content that must fit

## 6. Progressive Feedback Loop
- Establish a continuous feedback loop during replacement:
  * Real-time progress updates (0-100%)
  * Small image exports after each chunk for verification
  * Issues identified early and resolved incrementally
  * Quick adjustments applied to subsequent chunks

## 7. Final Verification & Context-Aware QA
- After all chunks are processed:
  * Export the entire design at reduced scale for final verification
  * Check for cross-chunk consistency issues
  * Verify proper text flow between different sections
  * Ensure design harmony across the full composition

## 8. Chunk-Specific Export Scale Guidelines
- Scale exports appropriately based on chunk size:
  * Small chunks (1-5 elements): scale 1.0
  * Medium chunks (6-20 elements): scale 0.7
  * Large chunks (21-50 elements): scale 0.5
  * Very large chunks (50+ elements): scale 0.3
  * Full design verification: scale 0.2

## Sample Chunking Strategy for Common Design Types

### Tables
- Process by logical rows (5-10 rows per chunk)
- Alternative: Process by column for columnar analysis
- Tip: Always include header row in first chunk for reference

### Card Lists
- Group 3-5 similar cards per chunk
- Process entire cards to maintain internal consistency
- Verify text-to-image ratio within cards after each chunk

### Forms
- Group related fields (e.g., "Personal Information", "Payment Details")
- Process labels and input fields together
- Ensure validation messages and hints are updated with their fields

### Navigation & Menus
- Process hierarchical levels together (main menu, submenu)
- Respect information architecture relationships
- Verify menu fit and alignment after replacement

## Best Practices
- **Preserve Design Intent**: Always prioritize design integrity
- **Structural Consistency**: Maintain alignment, spacing, and hierarchy
- **Visual Feedback**: Verify each chunk visually before proceeding
- **Incremental Improvement**: Learn from each chunk to improve subsequent ones
- **Balance Automation & Control**: Let AI handle repetitive replacements but maintain oversight
- **Respect Content Relationships**: Keep related content consistent across chunks

Remember that text is never just text—it's a core design element that must work harmoniously with the overall composition. This chunk-based strategy allows you to methodically transform text while maintaining design integrity.`,
            },
          },
        ],
        description: "Systematic approach for replacing text in Figma designs",
      };
    }
  );

  server.prompt(
    "efficient_execution",
    "Get the same design in far fewer calls: batch writes, read once, keep responses small",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `EFFICIENT EXECUTION

Every tool call is a full round trip: the whole conversation is re-read and the
whole tool list is re-sent. A section built one call at a time costs 30 round
trips; the same section built well costs two or three. Speed and cost here are
the same problem, and both are decided by how you sequence calls — not by how
much you think between them.

BATCH EVERY WRITE
Use figma_batch whenever you are about to issue two or more commands in a row.
Ops run in order, and $N.field feeds an earlier result into a later op:

  figma_batch({ops: [
    {command: "create_frame",    params: {x: 0, y: 0, width: 1440, height: 600,
                                          name: "Hero", parentId: "<page-id>"}},
    {command: "set_auto_layout", params: {nodeId: "$0.id", layoutMode: "VERTICAL",
                                          itemSpacing: 24, paddingTop: 80}},
    {command: "create_text",     params: {text: "Headline", parentId: "$0.id"}},
    {command: "set_font_size",   params: {nodeId: "$last.id", fontSize: 56}},
  ]})

$N.id refers to op N; $last.id refers to the op immediately before. Plan the
whole section, then send it. Do not send one op and wait to see what happens
unless the next op genuinely depends on something you cannot predict.

figma_batch also reaches commands the current tool profile does not advertise —
pass the command name and its normal parameters.

stopOnError defaults to true, which is what you want while building: a failed
parent makes every child after it meaningless. Set it to false only for
independent operations, such as recolouring twenty unrelated nodes.

READ ONCE, READ NARROW
  - get_design_system() once per session. Its result is cached, and re-reading
    it costs you tokens without telling you anything new.
  - get_node_info(nodeId, depth) — pass the smallest depth that answers your
    question. depth 1 is usually enough to find a child; full trees are large
    and most of what they contain you will never look at.
  - Do not re-read a node to confirm a write succeeded. A batch reports each
    op's outcome. Read back only when you need a value you could not predict,
    such as the height of an auto-layout frame after its contents changed.
  - scan_text_nodes leaves highlighting off. Only turn it on when a person is
    watching the canvas — it adds about half a second per node.

WHEN A RESPONSE COMES BACK TRUNCATED
That is the size guard, not an error. Narrow the query: a smaller depth, a
specific child node, or the section you actually care about.

SEQUENCE THAT WORKS
  1. get_design_system() — once.
  2. get_node_info() on the target, at shallow depth, to locate anchors.
  3. One figma_batch that builds the structure.
  4. One figma_batch that styles it.
  5. Verify once at the end, only if the result depends on measured layout.`,
            },
          },
        ],
        description: "Get the same design in far fewer calls: batch writes, read once, keep responses small",
      };
    }
  );
}

// Export individual prompt registration functions
export function registerDesignStrategyPrompt(server: McpServer): void {
  server.prompt(
    "design_strategy",
    "Best practices for working with Figma designs",
    (extra) => {
      // Implementation is the same as above
      // This function is exported for individual usage if needed
    }
  );
}

export function registerReadDesignStrategyPrompt(server: McpServer): void {
  server.prompt(
    "read_design_strategy",
    "Best practices for reading Figma designs",
    (extra) => {
      // Implementation is the same as above
      // This function is exported for individual usage if needed
    }
  );
}

export function registerTextReplacementStrategyPrompt(server: McpServer): void {
  server.prompt(
    "text_replacement_strategy",
    "Systematic approach for replacing text in Figma designs",
    (extra) => {
      // Implementation is the same as above
      // This function is exported for individual usage if needed
    }
  );
}
