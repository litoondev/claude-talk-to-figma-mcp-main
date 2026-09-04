# Available commands

📖 [**Commands**](COMMANDS.md) | 🚀 [**Installation**](INSTALLATION.md) | 🛠️ [**Contributing**](CONTRIBUTING.md) | 🆘 [**Troubleshooting**](TROUBLESHOOTING.md) | 📜 [**Changelog**](CHANGELOG.md)

Complete reference of the tools Claude can use to interact with Figma.

## Document and page tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `get_document_info` | Document analysis | Get project overview |
| `get_selection` | Current selection | What is currently selected |
| `get_node_info` | Element details | Inspect a specific component |
| `get_nodes_info` | Multiple elements info | Batch inspection |
| `scan_text_nodes` | Find all text nodes | Text audit and update |
| `get_styles` | Document styles | Color and text style audit |
| `join_channel` | Connect to Figma | Establish communication |
| `export_node_as_image` | Export assets | Generate design assets |
| `get_pages` | List pages | View all document pages |
| `create_page` | Create page | Add a new page to the document |
| `delete_page` | Delete page | Remove a specific page |
| `rename_page` | Rename page | Change a page's name |
| `set_current_page` | Switch page | Go to a specific page |
| `get_file_key` | Query file key | Get file key and availability |
| `set_file_key` | Configure file key | Set file key or Figma URL fallback |

## Image tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `set_image_fill` | Apply image to node | Set product photos, avatars |
| `get_image_from_node` | Extract image metadata | Audit images in design |
| `replace_image_fill` | Swap images | Update assets, placeholders |
| `apply_image_transform` | Adjust image position/scale/rotation | Pan, zoom, rotate image inside node |
| `set_image_filters` | Apply color/light adjustments | Brightness, contrast, saturation, etc. |

**⚠️ Known Limitations:**
- **URL images**: Must be whitelisted in `manifest.json` (`allowedDomains`). Use base64 (`sourceType: "base64"`) for no restrictions.
- **Data URIs not supported**: `data:image/...` format unsupported
- **Rotation**: 90° increments only (0, 90, 180, 270)

## Creation tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `create_rectangle` | Basic shapes | Buttons, backgrounds |
| `create_frame` | Layout containers | Page sections, cards |
| `create_text` | Text elements | Headings, labels |
| `create_ellipse` | Circles/ovals | Profile pictures, icons |
| `create_polygon` | Polygon shapes | Custom geometric elements |
| `create_star` | Stars | Decorative elements |
| `clone_node` | Duplicate elements | Copy existing designs |
| `group_nodes` | Organize elements | Component grouping |
| `ungroup_nodes` | Separate groups | Decompose components |
| `insert_child` | Nest elements | Hierarchical structure |
| `flatten_node` | Vector operations | Boolean operations |

## Modification tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `set_fill_color` | Element colors | Apply brand colors |
| `set_stroke_color` | Border colors | Outline styles |
| `set_selection_colors` | Bulk recolor | Recolor icons and child groups |
| `move_node` | Positioning | Layout adjustments |
| `resize_node` | Size changes | Responsive scaling |
| `rename_node` | Rename node | Organize layers and components |
| `delete_node` | Delete elements | Clean up designs |
| `set_corner_radius` | Rounded corners | Modern UI styles |
| `set_auto_layout` | Flexbox-like layout | Component spacing |
| `set_effects` | Shadows/blurs | Visual finishing |
| `set_effect_style_id` | Apply effect styles | Consistent shadows |

## Text tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `set_text_content` | Update text | Copy changes |
| `set_multiple_text_contents` | Batch update | Multi-element editing |
| `set_text_align` | H/V alignment | Align text or fix RTL languages |
| `set_font_name` | Typography | Apply brand font |
| `set_font_size` | Text size | Create hierarchy |
| `set_font_weight` | Text weight | Bold/light variations |
| `set_text_style_id` | Apply text style | Use corporate typography |
| `set_letter_spacing` | Character spacing | Typography fine-tuning |
| `set_line_height` | Vertical spacing | Text readability |
| `set_paragraph_spacing` | Paragraph spacing | Content structure |
| `set_text_case` | Case transformation | UPPERCASE/lowercase/Title |
| `set_text_decoration` | Text styles | Underline/strikethrough |
| `get_styled_text_segments` | Text analysis | Rich text inspection |
| `load_font_async` | Font loading | Custom font access |

## Component tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `get_local_components` | Project components | Design system audit |
| `get_remote_components` | Team libraries | Access shared components |
| `create_component_instance` | Use components | Consistent UI elements |
## Variable and token tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `get_variables` | List variables and collections | Audit design tokens, pagination, filters |
| `find_variable` | Resolve variable strictly | Find variable without guessing |
| `set_variable` | Create, update value, or rename | Update token value or rename with newName |
| `rename_variable` | Rename a variable | Rename token by name or variableId |
| `rename_variables` | Bulk rename variables | Batch rename list or find/replace pattern |
| `apply_variable_to_node` | Bind variable to node property | Connect fill, stroke, gap, radius to token |
| `apply_variable_bindings` | Batch bind token properties | Connect full section to design system |
| `get_node_variable_bindings` | Inspect variable bindings | Verify tokens bound to node |
| `switch_variable_mode` | Switch mode breakpoint | Set Desk, Tab, or Mobi mode |
| `import_library_variable` | Import team library variable | Use shared team token locally |

## Scripting and developer tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `execute_code` | Run JavaScript in Figma sandbox | Custom batch ops or emergency scripts |
| `figma_batch` | Run multiple commands in 1 call | Fast multi-operation batching |

## FigJam tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `get_figjam_elements` | Read board contents | Inspect stickies, connectors, shapes, sections, stamps |
| `create_sticky` | Create sticky note | Add ideas, comments, or labels to a board |
| `set_sticky_text` | Update sticky text | Edit existing sticky content |
| `create_shape_with_text` | Create labeled shape | Flowchart nodes, process boxes, decision diamonds |
| `create_connector` | Draw connector arrow | Link stickies or shapes with flow arrows |
| `create_section` | Create section region | Group and organise content areas on the board |

## Comment tools

> **⚠️ These tools use the Figma REST API, not the plugin.** Figma's Plugin API has no access to comments, so these tools talk directly to `api.figma.com` using a personal access token in `FIGMA_ACCESS_TOKEN`. They work **without** the socket running and **without** `join_channel` — but they do nothing until a token is configured. See [token setup](INSTALLATION.md#4-optional-enable-comment-tools-figma-rest-token).

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `get_figma_account` | Verify token, get your user id | Confirm setup before a sweep |
| `get_current_file` | File key + name of the open file | Check what "no fileKey" resolves to |
| `list_figma_files` | Expand a team/project into file keys | Discover what to sweep |
| `get_file_comments` | Read comment threads in one file | Review feedback on a single screen |
| `get_my_comments` | Read all of my threads across a team/project | "What have I commented on?" |
| `reply_to_comment` | Reply to one thread | Answer a specific question |
| `reply_to_comments` | Reply to many threads in one call | Batch-close a review round |
| `delete_comment` | Delete your own comment or reply | Clean up superseded feedback |

**You never need to paste a file URL.** `fileKey` is optional on every one of these tools. Omit it and the server asks the connected plugin which file is open — so `get_file_comments` with no arguments reads the comments on whatever you're looking at. `get_my_comments` with no arguments does the same. Pass `fileKey` explicitly only to target a *different* file, which also works with no plugin channel connected.

> Relies on `figma.fileKey`, which needs the private plugin API — available for locally imported and organisation plugins (this project enables it), `undefined` on public plugin builds. If it's unavailable you get an explicit message telling you to pass `fileKey`.

**Concepts:**

- A **thread** is a root comment plus its replies. `commentId` in the output is always the *root* id — that is what you pass back to `reply_to_comment`.
- **Anchors:** comments are pinned to a node (`node 12:34 at +(8, 12)`), to raw canvas coordinates, or unpinned. Node-anchored comments expose `nodeId`, which you can hand to `get_node_info` to inspect what the feedback is about.
- **Resolved threads are hidden by default.** Pass `includeResolved: true` to see them.
- **`onlyAwaitingReply: true`** returns only threads whose most recent message is from someone else — i.e. the ones actually waiting on you.
- **Partial failures are reported, not fatal.** A team sweep normally includes files your token cannot open; those are listed at the end and the rest still returns.

**Typical flow:**

```
1. get_figma_account                → confirm token, note your user id
2. list_figma_files  { teamId }     → discover file keys
3. get_my_comments   { teamId, onlyAwaitingReply: true }
4. reply_to_comments { replies: [...], dryRun: true }   → preview
5. reply_to_comments { replies: [...] }                 → post
```

**Example prompts:**

```
✅ "Show me every unresolved comment I've been mentioned in across team 12345,
    and tell me which ones are waiting on my reply"

✅ "Read my open comments in file ABC123, then for each one look up the node it's
    pinned to and draft a reply explaining the fix"

✅ "Reply to all my threads from the last week confirming they're addressed in v2 —
    do a dry run first"
```

## Understanding coordinate systems

Figma uses two coordinate systems:

- **Global coordinates** (`absoluteBoundingBox`): Position relative to canvas origin (0,0)
- **Local coordinates** (`localPosition`): Position relative to parent node

**When to use which:**
- `get_node_info` returns both `absoluteBoundingBox` (global) and `localPosition` (local)
- `move_node` expects local coordinates (same as create operations)
- To move a node to its current position, use `localPosition.x` and `localPosition.y`

**Example:**
```
Frame at (100, 50)
  └─ Rectangle
     - absoluteBoundingBox: {x: 150, y: 80}  ← Global position
     - localPosition: {x: 50, y: 30}         ← Use for move_node
```

## Effective prompt examples

```
✅ Good: "Create a dashboard with side navigation, a header with user 
profile, and a main area with metric cards"

✅ Good: "Redesign this button component with hover states and 
better contrast ratios"

✅ Good: "Analyze the accessibility of this screen and fix the 
contrast issues"

❌ Avoid: "Make it pretty" (too vague)

❌ Avoid: "Improve the design" (no specific criteria)
```

## Usage tips

1. **Be specific:** The more detailed the instruction, the better the result
2. **Use references:** "Like the button in the previous section" helps maintain consistency
3. **Break down complex tasks:** It's better to make several small changes than one very large one
4. **Check selection:** Make sure the correct element is selected before requesting modifications
