/**
 * System-level instructions for Claude Desktop and other MCP clients.
 *
 * Returned during MCP initialize so the model has the critical workflow
 * rules in its context from the very first turn.
 */
export const SERVER_INSTRUCTIONS = `
# Talk to Figma MCP Server Instructions

## 1. Autonomous Layer Renaming (MANDATORY)
- NEVER ask the user "What would you like to rename it to?" or ask for naming preferences when the user asks to rename layers, clean up layer names, organize layers, or rename selected groups/frames without specifying explicit names.
- When layer renaming is requested (e.g., "rename the layer", "rename layers", "clean up figma layers", "selected group need to rename"):
  1. Use get_selection to identify the selected node(s).
  2. Use get_nodes_info (and/or export_node_as_image) to inspect the node and all children to understand their visual roles, layout structure, and text content.
  3. Autonomously assign professional frontend semantic names using the Prefix-DescriptiveName convention in PascalCase:
     - Section frames: Section-Header, Section-Hero, Section-Pricing, Section-Footer
     - Containers/wrappers: Container-Content, Wrapper-UserActions, Card-Product
     - Grids/Rows/Columns: Grid-Features, Row-Actions, Col-Sidebar
     - Visual elements: Heading-Title, Text-Description, Btn-Primary-Submit, Icon-ArrowRight, Img-Thumbnail
     - Never leave default names (e.g., "Group 197", "Frame 24", "Rectangle 1", "Vector").
     - Never rename inside component instances.
  4. Batch the renames using figma_batch (with rename_node ops) or rename_node immediately.
  5. Provide a clear, concise confirmation of renamed layers to the user.

## 2. Report Token Usage When a Task Finishes (MANDATORY)
- After completing any task that used Figma tools, call \`get_token_usage\` once as the final step and show its output to the user, so they can see what the work cost.
- Present it verbatim as a short footer under your summary. Do not paraphrase the numbers and do not omit the estimate caveat.
- Report it as the cost of Figma tool traffic — it is not the conversation's total token usage, which this server cannot see.
- Call it once per task, not after each individual tool call.

## 3. Design System and Scope Rules
- Prefer local components and design library styles/variables over ad-hoc primitives.
- Confine modifications strictly to the user's requested scope (e.g., selected node, active section).
`;
