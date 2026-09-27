---
id: Responsive_Apply_v2
title: Responsive Apply — Low Token
description: >
  Token-efficient responsive workflow for duplicating a selected Figma frame
  into Tablet 768, Mobile 320, or both in one run. Reuse exact local components
  and variables, share discovery across breakpoints, preserve the source, and
  validate every produced duplicate without loading full file inventories.
triggers:
  - make responsive
  - tablet and mobile
  - tablet mobile together
  - tablet 768
  - mobile 320
  - responsive low token
uses:
  - join_channel
  - check_figma_connection
  - get_selection
  - get_nodes_info
  - get_node_variable_bindings
  - get_variables
  - find_variable
  - apply_variable_to_node
  - switch_variable_mode
  - set_instance_variant
  - set_layout_sizing
  - clone_node
  - export_node_as_image
  - analyze_responsive
  - validate_responsive
  - figma_batch
  - get_token_usage
---

# Responsive Apply — Low-Token Workflow

Create responsive duplicates from one untouched source. Support `Tablet 768`,
`Mobile 320`, or `Both`. When the user requests both, complete them in one run
with one shared discovery pass; do not repeat the workflow per breakpoint.

## Required sequence

1. Run `join_channel -> check_figma_connection -> get_selection` once. If the
   selection is empty, ask for a frame and stop. Restrict all work to that frame.
2. Ask for `Tablet 768`, `Mobile 320`, or `Both` only when the request does not
   already specify the target.
3. Inspect the source once with `get_nodes_info` at depth 2 or 3 and export one
   before image. Run `analyze_responsive` with `responseMode: "compact"` once
   per requested width; issue both independent calls together when both are
   requested.
4. Discover components narrowly. Search by the selected section's exact name and
   requested width. Never dump every local component when an exact master is
   already known or a narrow lookup can confirm it.
5. Discover variables narrowly. Read collection modes and query exact token
   names. Do not request every variable or call `get_design_system` unless an
   exact component or token lookup fails.
6. Clone the untouched source once per requested breakpoint. Place the clones
   beside one another. Never derive Mobile from Tablet or Tablet from Mobile.
7. Component-first: swap each clone to the matching existing breakpoint master,
   or change instance variant properties when the breakpoint is a variant.
   Preserve overrides. Never detach or rebuild an existing component by hand.
8. Switch each clone to the file's exact breakpoint mode. Bind only missing
   properties to exact existing variables. If no exact token exists, ask; never
   create or approximate one.
9. Keep containers, cards, text blocks, and columns Fill width + Hug height;
   buttons Hug both. Never fix content height, shrink type, alter copy, or clip
   text to solve reflow.
10. Run `validate_responsive` with `responseMode: "compact"` once per produced
    width; issue both validations together when both are requested. Re-read only
    changed roots and nodes named by a failure. Export one final image per clone.
11. Report each duplicate separately with node IDs and before -> after values,
    then call `get_token_usage` once for the whole run.

## Shared-discovery rules

- Cache source ID, parent/page ID, source bounds, `clipsContent`, main component,
  matching breakpoint masters, variable collection IDs, and mode IDs for the
  duration of the run.
- Reuse a confirmed component or variable ID after a compact verification. Do
  not repeat `get_local_components`, `get_design_system`, or all-variable reads.
- Treat write results as evidence. Do not immediately re-read values already
  returned by a successful write.
- Use `figma_batch` for independent property writes. Do not batch clone or swap
  operations when a returned clone ID is required by the next operation.

## Preservation rules

- Check `clipsContent` before any size or layout change.
- Never move or resize absolute-positioned layers. Use their existing
  breakpoint component state and report them for manual review.
- Preserve masks, imagery, prototype links, variants, and component properties.
- Keep deliberate image-mask overlaps and approved decorative overflow.
- Modify only the new duplicates; leave the source and unrelated selections
  untouched.

## Compact read policy

- Start with node depth 2–3. Read deeper only for a failing child.
- Prefer exact `get_variables({name: ...})` or `find_variable` requests.
- Use one before export and one final export per produced duplicate.
- A full design-system/component inventory is fallback discovery, not preflight.

## Completion gate

- Every requested breakpoint has its own clone from the original.
- Each clone uses the matching existing component/variant and variable mode.
- Text wraps naturally; content-driven layers have no fixed height.
- `validate_responsive` passes at every requested width.
- Intentional masks/overflow and skipped absolute layers are reported.
- No unrequested breakpoint or unrelated node was changed.
