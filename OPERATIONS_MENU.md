# Quick Operations Menu

The Figma plugin now includes a **Quick Operations Menu** that provides one-click access to common design operations and ready-to-use prompts for Claude.

## Overview

The Operations Menu appears at the top of the plugin panel and gives you instant access to 8+ pre-configured design operations. Each operation has:

- **Title & Icon** — Quick visual identification
- **Description** — What the operation does
- **Ready-to-copy Prompt** — Pre-formatted text ready for Claude chat
- **Category Filtering** — Organize operations by type (Layout, Organization, Responsive, etc.)
- **Search** — Find operations by keyword

## Available Operations

### Layout Operations
- **Convert to Grid** (📊) — Convert selected layers to Figma Grid layout with minimal structure
- **Audit Spacing** (📐) — Standardize padding and gaps using design tokens

### Organization
- **Rename Layers** (📝) — Rename using semantic conventions (BEM-like prefixes)
- **Optimize Layers** (✨) — Remove wrappers and flatten redundant structure

### Responsive Design
- **Make Responsive** (📱) — Adapt for tablet (768px) and mobile (320px)
- **Apply Hug Heights** (📏) — Replace fixed heights with Hug Contents

### Design System
- **Design System First** (🎨) — Reuse existing components and variables
- **Color Audit** (🎯) — Ensure colors are bound to variables/styles

### Typography
- **Fix Typography** (🔤) — Bind to text styles and ensure proper hierarchy

## How to Use

### 1. **Search for an Operation**
Type in the search box to filter operations by keyword:
- "rename" → shows all renaming operations
- "responsive" → shows mobile/tablet operations
- "grid" → shows grid-related operations

### 2. **Filter by Category**
Click category tabs to view operations in specific categories:
- **All** — Show all operations
- **Layout** — Layout and spacing operations
- **Organization** — Layer management
- **Responsive** — Mobile/tablet adaptations
- **Design System** — Component and variable reuse
- **Typography** — Text and font operations

### 3. **Copy a Prompt**
Click the **"Copy prompt"** button on any operation card to:
1. Copy the pre-formatted prompt to your clipboard
2. See a confirmation notification in Figma
3. Paste directly into Claude chat

### 4. **Use in Claude**
Paste the copied prompt into Claude and add details:

```
Rename Layers

Rename all layers using professional frontend naming conventions (semantic HTML + BEM-like prefixes).

[Optional: Add context about your design]
```

## Adding New Operations

To add a new operation, edit the `OperationsMenu` class in `ui.html`:

```javascript
{
  id: 'my_operation',           // Unique ID (use_underscores)
  category: 'Layout',            // Category name (will be auto-grouped)
  title: 'My Operation',         // Display title
  description: 'Brief description of what this does',
  triggers: [                    // Keywords for searching
    'keyword1',
    'keyword2',
    'phrase to match'
  ],
  prompt: 'The prompt text to copy...',
  icon: '🎯'                     // Emoji icon for visual ID
}
```

### Example: Adding a "Fix Colors" Operation

```javascript
{
  id: 'fix_colors',
  category: 'Design System',
  title: 'Fix Colors',
  description: 'Bind all colors to existing color variables',
  triggers: ['fix colors', 'color variables', 'bind colors'],
  prompt: 'Review all fill colors and stroke colors. Bind them to existing color variables in the design system. Flag any colors not represented.',
  icon: '🎨'
}
```

## Design Principles

The Operations Menu follows these principles:

1. **Self-service** — Users find operations without asking Claude
2. **Copy-paste ready** — Every prompt is formatted for immediate use in Claude chat
3. **Discoverable** — Search and category filtering help find the right operation
4. **Extensible** — New operations can be added without modifying other systems
5. **Organized** — Operations are grouped by category (Layout, Organization, etc.)

## Integration with Claude Chat

When you copy an operation prompt and paste it in Claude:

1. **Lead with the operation name** — "Rename Layers"
2. **Add the prompt** — The copy-paste text
3. **Add context** — Selection, file state, specific requirements
4. **Chat normally** — Claude recognizes the operation and adapts accordingly

Example chat flow:
```
User: Rename Layers

Rename all layers using professional frontend naming conventions 
(semantic HTML + BEM-like prefixes).

I've selected the card component and its children. Please rename 
everything following frontend conventions.

Claude: I'll rename your selected layers using semantic naming 
conventions. First, let me inspect the structure...
[Claude proceeds with the operation]
```

## Keyboard Shortcuts (Future)

Future versions may support keyboard shortcuts like:
- `Cmd+K` (Mac) / `Ctrl+K` (Windows) — Open operations search
- `Cmd+1` through `Cmd+8` — Quick access to top operations

## Troubleshooting

### Operations menu not showing?
- Reload the plugin panel
- Ensure you're using the latest version

### Prompt not copying?
- Check your clipboard permissions in Figma
- Try the "Copy command" button on recent activity instead
- Manually select and copy the prompt from the dialog

### Want to customize operations?
- Edit `ui.html` and modify the `OperationsMenu` class
- Add/remove/modify operations as needed
- Reload the plugin to see changes

## Structure

The Operations Menu consists of:

- **operations-menu.js** — Standalone operations manager (if using externally)
- **ui.html** — Plugin UI with embedded `OperationsMenu` class and UI rendering
- **Styling** — CSS classes prefixed with `mcp-plugin__operations-*`

## Future Enhancements

Potential additions:
- Keyboard shortcuts for quick access
- Custom operation creation UI
- Operation history and favorites
- Integration with skill discovery
- Claude API direct execution (with permission)
- Operation parameters and options UI

## Questions?

For issues or feature requests:
1. Check the plugin logs in Figma DevTools
2. Review recent activity in the plugin panel
3. Refer to the main README.md for project setup
