# Quick Operations Menu — Quick Start Guide

## 🎯 What's New?

Your Figma plugin now has a **Quick Operations Menu** at the top of the panel. It shows 8+ common design operations you can use with Claude.

## ⚡ How It Works (3 Steps)

### 1. Open the Plugin Panel
Open the Claude MCP Plugin panel in Figma. At the top, you'll see the "⚡ Quick Operations" section.

### 2. Find Your Operation
- **Scroll** through the grid to see all operations
- **Search** by typing keywords ("rename", "responsive", "grid")
- **Filter** by category (All, Layout, Organization, Responsive, etc.)

### 3. Copy the Prompt
Click **"Copy prompt"** on any operation card. The prompt is instantly copied to your clipboard.

## 💬 Use in Claude Chat

Paste the copied prompt in Claude:

```
Rename Layers

Rename all layers using professional frontend naming conventions 
(semantic HTML + BEM-like prefixes).
```

Add any context you need:
```
Rename Layers

Rename all layers using professional frontend naming conventions 
(semantic HTML + BEM-like prefixes).

My selection: The card component in the hero section. Please follow 
BEM naming for the structure (card, card__image, card__content, etc.)
```

## 📋 Available Operations

| Icon | Operation | What It Does |
|------|-----------|--------------|
| 📊 | Convert to Grid | Flatten layers into Figma Grid layout |
| 📝 | Rename Layers | Semantic naming (BEM-like conventions) |
| 📱 | Make Responsive | Tablet (768px) & mobile (320px) versions |
| ✨ | Optimize Layers | Remove wrappers & flatten structure |
| 🎨 | Design System First | Reuse components & variables |
| 🔤 | Fix Typography | Bind to text styles & ensure hierarchy |
| 📐 | Audit Spacing | Standardize padding & gaps |
| 📏 | Apply Hug Heights | Replace fixed heights with Hug Contents |

## 🔍 Search Examples

**"rename"**
→ Rename Layers, and any other renaming operations

**"responsive"**
→ Make Responsive, Apply Hug Heights

**"grid"**
→ Convert to Grid

**"spacing"**
→ Audit Spacing, Apply Hug Heights

## 🏷️ Filter by Category

- **All** — Every operation
- **Layout** — Grid, spacing, sizing
- **Organization** — Renaming, layer cleanup
- **Responsive** — Mobile, tablet, adaptive design
- **Design System** — Components, variables, colors
- **Typography** — Fonts, text styles, hierarchy

## 💡 Common Workflows

### Workflow 1: Clean Up a Messy Design
1. Select the entire frame
2. Search "organize" or click "Organization" category
3. Copy "Rename Layers" prompt → Rename everything
4. Copy "Optimize Layers" prompt → Remove wrappers
5. Copy "Audit Spacing" prompt → Fix spacing

### Workflow 2: Build Responsive Layout
1. Select the section you want to make responsive
2. Search "responsive"
3. Copy "Make Responsive" prompt → Add tablet & mobile versions
4. Copy "Apply Hug Heights" prompt → Fix content sizing

### Workflow 3: Audit Design System Use
1. Select your page or frame
2. Click "Design System" category
3. Copy "Design System First" prompt → Check reuse
4. Copy "Fix Typography" prompt → Bind text styles
5. Copy "Color Audit" prompt → Bind colors (if available)

## 🎨 Dark/Light Mode

The Operations Menu respects your Figma dark/light mode setting. Click the moon/sun icon to toggle.

## ❓ FAQ

**Q: Can I add my own operations?**
A: Yes! Edit `ui.html` and add new operation objects to the `OperationsMenu` class. See OPERATIONS_MENU.md for details.

**Q: How do I know which operation to use?**
A: The description under each operation title tells you what it does. Use search if you're not sure.

**Q: Do I have to use these exact prompts?**
A: No! You can edit the prompt before pasting into Claude. These are just starting points.

**Q: Can I customize the list?**
A: Yes! Edit the operations in `ui.html` or ask on the project GitHub.

**Q: What if an operation doesn't work?**
A: Make sure you have the right nodes selected, check the plugin panel activity feed for errors, or try a different operation.

## 🚀 Tips

1. **Start simple** — Use "Rename Layers" on a small component first
2. **Read descriptions** — Each operation card explains what it does
3. **Use search** — Faster than browsing when you know what you want
4. **Save favorites** — If you find yourself copying the same prompt, bookmark it in your browser
5. **Share workflows** — Show your team the operations menu for collaborative design work

## 📖 More Info

- See **OPERATIONS_MENU.md** for detailed documentation
- Check **README.md** for plugin setup and configuration
- Visit the **skills/** folder to see available Figma operations

## 🎯 Next Steps

1. ✅ Open the Figma plugin panel
2. ✅ Try copying your first operation prompt
3. ✅ Paste into Claude and start designing
4. ✅ Explore different categories and operations
5. ✅ Customize operations as needed

---

**Happy designing with Claude! 🎨🤖**
