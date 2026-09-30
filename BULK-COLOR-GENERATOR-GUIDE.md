# Bulk Color Generator Guide

Rapidly generate Tailwind-like color scales for all your design system colors at once.

## Quick Start

### Option 1: Using Claude (Fastest)

```
Generate scales for my Primary, Secondary, Tertiary, Accent, CTA, and Gray colors,
then create them as variables in my Figma Colors collection
```

Claude will:
1. Generate all 11 stops for each color
2. Show previews
3. Create all variables in Figma in one operation (~77 variables)

### Option 2: Using the Bulk UI

Open `src/claude_mcp_plugin/bulk-color-generator-ui.html`:

1. **Select colors** — checkbox each color you want to scale (Primary, Secondary, etc.)
2. **Edit if needed** — click "Edit" to change hex values
3. **Preview first** — click "Preview" on any color to see its scale
4. **Generate** — click "Generate Selected" to create all scales
5. **Create in Figma** — review the preview, then create all variables

## Available Tools

### `generate_bulk_color_scales`

Generate multiple color scales in one call.

**Example:**
```
Claude: Generate scales for Primary (#0066FF), Secondary (#FF6B6B), and Accent (#FFD93D)
```

**Parameters:**
- `colors` (required) — array of `{name, hex, saturationAdjustment?}`
- All 11-stop scales generated instantly

### `create_bulk_color_variables`

Create all generated scales as Figma variables simultaneously.

**Example:**
```
Claude: Create color variables for Primary, Secondary, Accent in my Colors collection
```

**Parameters:**
- `colors` (required) — array of color definitions
- `collectionName` (optional) — Figma collection, default: "Colors"
- Creates 11 variables per color in one efficient batch operation

### `extract_and_scale_colors`

Read existing Figma colors and generate scales for them automatically.

Perfect for upgrading an existing simple color system!

**Example:**
```
Claude: Extract the Primary, Secondary, and Gray colors from my file and generate scales
```

**Parameters:**
- `colorNames` (required) — array of names to extract, e.g., `['Primary', 'Secondary', 'Gray Main']`
- `collectionName` (optional) — which collection to read from
- `outputCollectionName` (optional) — where to create scaled variables

## Workflow Examples

### Example 1: Upgrade Existing System

You have: Primary, Secondary, Tertiary, Accent, CTA, Gray Main (7 simple colors)

Want: Full token system with 77 variables (11 stops × 7 colors)

**Do this:**
```
Claude: Extract Primary, Secondary, Tertiary, Accent, CTA, and Gray Main from my file,
generate full scales for each, then create them as variables
```

**Result:** 77 new color variables, instantly organized and ready to use.

### Example 2: Brand Color Expansion

You have brand colors and want to create a complete palette.

**Do this:**
1. Open `bulk-color-generator-ui.html`
2. Edit the default colors to match your brand colors
3. Select all colors
4. Click "Generate Selected"
5. Click "Create in Figma"

**Result:** Professional color system with light/dark variations for every color.

### Example 3: Quick Multi-Color Generation

Generate scales for new colors you're adding to your system.

**Do this:**
```
Claude: Generate scales for these colors and add them to my Colors collection:
- NewPrimary: #6366F1
- NewAccent: #EC4899
- NewSuccess: #22C55E
```

**Result:** Instant integration of new colors into your design system.

## Color Scale Stops Explained

Each color generates **11 stops** using HSL lightness:

```
50   → 97% lightness  (Lightest backgrounds)
100  → 94%            (Light UI elements)
200  → 88%            (Light fills)
300  → 80%            (Secondary elements)
400  → 69%            (Tertiary elements)
500  → 55%            (BASE — your input color)
600  → 48%            (Darker fills)
700  → 41%            (Dark elements)
800  → 33%            (Very dark)
900  → 24%            (Darkest text)
950  → 15%            (Darkest backgrounds)
```

## Variable Naming

Variables are created as:

```
Colors/Primary/50
Colors/Primary/100
Colors/Primary/200
... (through 950)

Colors/Secondary/50
Colors/Secondary/100
... (through 950)

[and so on for each color]
```

### Custom Collection Names

Change the collection in the UI or tool parameters:

```
Claude: Generate scales and create them in "Design Tokens" collection
```

Result: Variables named `Design Tokens/Primary/50`, etc.

## Tips & Tricks

### Preview Before Creating

Always preview a color scale before creating variables.

- Click "Preview" on individual colors in the UI
- Or use Claude to show previews first: `Preview scales for my Primary and Secondary colors`

### Batch Operations are Efficient

Creating 77 variables at once costs far less than creating them one-by-one.
Use `create_bulk_color_variables` or `figma_batch` for efficiency.

### Edit Colors Easily

In the UI, click "Edit" on any color card to change its hex value.

Changes apply instantly to the preview.

### Extract & Auto-Scale

If your Figma file already has simple colors defined, use `extract_and_scale_colors`:

```
Claude: Extract and scale Primary, Secondary, Accent from my file
```

Reads your current colors and generates full palettes automatically.

### Saturation Adjustments

Fine-tune color vibrancy before creating:

**Desaturated palette:**
```
Claude: Generate scales with 50% saturation for Primary, Secondary, Tertiary
```

**More vibrant:**
```
Claude: Generate scales with 150% saturation for Accent and CTA
```

## Common Workflows

### Build a New Design System

```
1. Open bulk-color-generator-ui.html
2. Edit colors to match your brand
3. Select all 7 default colors
4. Click "Generate Selected"
5. Click "Create in Figma"
→ Instant 77-variable design system
```

### Upgrade Existing Colors

```
Claude: Extract my current Primary, Secondary, Gray colors and generate full scales
→ Reads your file, creates new 33-variable palette
```

### Add New Color Family

```
Claude: Generate scales for NewPrimary and NewAccent, then add to Colors collection
→ Extends your system with new colors
```

### Export for Documentation

```
1. Generate scales in bulk UI
2. Take screenshots of previews
3. Export as documentation or design guide
```

## Troubleshooting

**Variables not created?**
- Check collection name is spelled correctly
- Ensure Figma plugin is connected
- Try creating a test color first

**Colors look wrong?**
- Adjust saturation before creating
- Try different base hex values
- Check if lightness adjustments match your brand

**Want different stops?**
- Current: 11 stops (50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950)
- This is Tailwind's standard
- Can be customized if needed

## Next Steps

1. **Open the bulk UI** — `bulk-color-generator-ui.html`
2. **Edit colors** to match your design system
3. **Select all** or choose specific colors
4. **Generate and create** in Figma
5. **Use in your designs** — all colors now available as variables

Enjoy your complete color system! 🎨
