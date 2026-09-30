# Color Generator Guide

A Tailwind-like color palette generator integrated with your Figma design system.

## Quick Start

### Option 1: Using Claude

Ask Claude to generate and create color palettes:

```
Generate a violet color scale from #8C41F1 and create it as variables in my Figma Colors collection
```

Claude will:
1. Generate all 11 color stops (50–950)
2. Show you the preview
3. Create Figma variables automatically

### Option 2: Using the Standalone UI

Open `src/claude_mcp_plugin/color-generator-ui.html` in your browser or Figma plugin:

1. **Enter a hex color** — e.g., `#8C41F1`
2. **Name your palette** — e.g., "Primary", "Violet", "Electric"
3. **Adjust saturation** — slider 0–200% (100% = original)
4. **Preview the scale** — see all 11 color stops instantly
5. **Create in Figma** — adds all colors as variables to your collection

## Available Tools

### `generate_color_scale`

Generates a Tailwind-like color scale from a hex color.

**Parameters:**
- `baseColor` (required) — hex code, e.g., `#8C41F1`
- `colorName` (optional) — palette name, default: "Color"
- `saturationAdjustment` (optional) — 0–2 multiplier, default: 1.0

**Example:**
```
Claude: Generate a 50% desaturated blue palette from #0066FF named "Sky"
```

### `create_color_variables`

Creates all 11 color stops as Figma variables in your design system.

**Parameters:**
- `baseColor` (required) — hex code
- `colorName` (optional) — palette name
- `collectionName` (optional) — Figma collection, default: "Colors"
- `saturationAdjustment` (optional) — multiplier

**Example:**
```
Claude: Create primary color variables from #0066FF in the "Design Tokens" collection
```

### `analyze_color`

Breaks down a hex color into RGB and HSL components.

**Parameters:**
- `hexColor` (required) — hex code

**Example:**
```
Claude: Analyze the color #8C41F1
```

## Color Scale Anatomy

Each palette generates 11 stops using HSL lightness adjustments:

| Weight | Lightness | Use Case |
|--------|-----------|----------|
| **50** | 97% | Lightest backgrounds, borders |
| **100** | 94% | Light backgrounds |
| **200** | 88% | Hover states, light fills |
| **300** | 80% | Secondary elements |
| **400** | 69% | Tertiary elements |
| **500** | 55% | **Base color** (your input) |
| **600** | 48% | Darker fills |
| **700** | 41% | Darker text, hover states |
| **800** | 33% | Dark elements |
| **900** | 24% | Darkest text, dark mode fills |
| **950** | 15% | Darkest backgrounds |

## Variable Naming

Variables are created with Client-First naming:

```
Colors/Violet/50
Colors/Violet/100
Colors/Violet/200
... (through 950)
```

Can be customized by changing the **Figma Collection** name.

## Color Adjustment

Use the **Saturation** slider to fine-tune generated colors:

- **0%** — Completely desaturated (grayscale)
- **50%** — Half saturation
- **100%** — Original saturation (default)
- **150%** — More vibrant
- **200%** — Maximum saturation

## Workflow Examples

### Build a Complete Color System

1. Generate "Primary" from your brand color
2. Generate "Secondary" from an accent color
3. Generate "Gray" from a neutral color
4. Generate "Success", "Warning", "Error" from semantic colors
5. All variables are immediately available in Figma

### Export for Documentation

1. Generate a palette
2. Click **Export JSON** to download
3. Use in design documentation or component library

### Share with Team

1. Generate the palette in Claude
2. Create variables in Figma
3. All team members see updated colors in the design system

## Tips & Tricks

**Adjust Before Creating**
- If the generated palette is too saturated, reduce saturation before creating variables
- If it's too desaturated, increase saturation

**Use with Existing System**
- New variables are created in your existing collection
- Existing variables with the same name are updated
- No design system cleanup needed

**Copy Individual Colors**
- Click any color swatch in the UI to copy its hex value
- Use in code, other tools, or documentation

**Batch Generate**
- Use `figma_batch` with multiple `create_color_variables` operations
- Creates multiple palettes in a single efficient call

## Integration Points

### Works With Your Existing Tools

- `set_variable` — underlying Figma variable creation
- `figma_batch` — efficient multi-palette generation
- `get_variables` — inspect created variables
- `get_design_system` — see color usage in your file

### Accessible From

- Claude conversations
- Your Figma plugin UI
- Standalone HTML file
- Command line via MCP

## Troubleshooting

**Colors look wrong?**
- Check saturation adjustment
- Verify base hex is valid
- Try a different base color

**Variables not appearing in Figma?**
- Ensure collection name is correct
- Check Figma file permissions
- Verify plugin channel is connected

**Need a specific palette?**
- Adjust saturation for desired intensity
- Try different base hex values
- Use the saturation slider in the UI

## Next Steps

1. **Open the color generator UI** — `color-generator-ui.html`
2. **Generate your first palette** — pick a brand color
3. **Create variables** — add to your Figma design system
4. **Use in Claude** — ask to generate and create palettes

Enjoy building beautiful, consistent color systems! 🎨
