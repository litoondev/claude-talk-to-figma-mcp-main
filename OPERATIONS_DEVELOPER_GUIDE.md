# Operations Menu — Developer Integration Guide

For developers who want to extend, customize, or integrate the Operations Menu with other systems.

## 📁 File Structure

```
src/claude_mcp_plugin/
├── ui.html                    # Main plugin UI + OperationsMenu class
├── code.js                    # Figma plugin backend
├── manifest.json              # Plugin configuration
└── operations-menu.js         # Standalone operations manager (optional)

skills/
├── Grid_Convert_v1.md         # Skill documentation
├── Layer_Rename_v1.md
├── Responsive_Apply_v1.md
└── Html_Import_v1.md

OPERATIONS_MENU.md             # User documentation
OPERATIONS_MENU_QUICKSTART.md  # Quick start guide
OPERATIONS_IMPLEMENTATION.md   # Implementation summary
OPERATIONS_DEVELOPER_GUIDE.md  # This file
```

## 🔧 Working with the OperationsMenu Class

### Location
The `OperationsMenu` class is embedded in `src/claude_mcp_plugin/ui.html` starting at line ~530 (after the `<script>` tag).

### Class Structure

```javascript
class OperationsMenu {
  constructor()  // Initialize with operations array
  getCategories()     // Returns array of unique categories
  search(query)       // Filter by keyword
  setCategory(category)  // Filter by category
  filter()            // Apply current filters
  getFiltered()       // Return filtered operations
}
```

### Using OperationsMenu Standalone

```javascript
// Create instance
const menu = new OperationsMenu();

// Search
menu.search("rename");
const results = menu.getFiltered();
// → [{ id: 'rename_layers', ... }]

// Filter by category
menu.setCategory('Organization');
const org = menu.getFiltered();
// → [Rename Layers, Optimize Layers]

// Get all categories
const cats = menu.getCategories();
// → ['all', 'Design System', 'Layout', ...]

// Access raw operations
const allOps = menu.operations;
// → Array of 8+ operation objects
```

## 📋 Operation Object Schema

Each operation is a JavaScript object:

```javascript
{
  id: string,           // Unique identifier (use_underscores)
  category: string,     // Category name (auto-grouped)
  title: string,        // Display name (2-3 words)
  description: string,  // One-liner description
  triggers: string[],   // Array of search keywords
  prompt: string,       // Copy-paste ready prompt
  icon: string          // Single emoji character
}
```

### Field Descriptions

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `id` | string | Unique identifier, used internally | `rename_layers` |
| `category` | string | Logical grouping for filtering | `Organization` |
| `title` | string | Display title on card | `Rename Layers` |
| `description` | string | One-line explanation | `Semantic naming conventions` |
| `triggers` | string[] | Search keywords | `['rename', 'clean up']` |
| `prompt` | string | Text to copy to Claude | `Rename all layers using...` |
| `icon` | string | Visual identifier (emoji) | `📝` |

## ➕ Adding New Operations

### Step 1: Edit ui.html

Find the `OperationsMenu` constructor in `ui.html` (around line 530):

```javascript
class OperationsMenu {
  constructor() {
    this.operations = [
      // ... existing operations ...
      
      // Add your new operation here:
      {
        id: 'new_operation_id',
        category: 'CategoryName',
        title: 'New Operation Title',
        description: 'Short description of what it does',
        triggers: ['keyword1', 'keyword2', 'keyword 3'],
        prompt: 'The actual prompt text that will be copied to Claude',
        icon: '🎯'
      }
    ];
  }
}
```

### Step 2: Test Locally

1. Reload the Figma plugin panel
2. Search for one of your triggers
3. Verify it appears in results
4. Click "Copy prompt" and verify it copies

### Step 3: Optional - Update Skills

If your operation maps to an existing skill, update the prompt to reference the skill ID:

```javascript
prompt: `Apply the Layer_Rename_v1 skill...`
```

## 🎨 Styling Operations

All styling is in the `<style>` section of `ui.html`. Classes follow this pattern:

```css
.mcp-plugin__operations-*         /* Main container */
.mcp-plugin__operations-search    /* Search input */
.mcp-plugin__operations-tab       /* Category buttons */
.mcp-plugin__operations-grid      /* Card grid */
.mcp-plugin__operation-*          /* Individual cards */
```

### Customizing Appearance

To change grid columns:
```css
.mcp-plugin__operations-grid {
  grid-template-columns: 1fr 1fr 1fr; /* 3 columns instead of 2 */
}
```

To change card size:
```css
.mcp-plugin__operation-item {
  min-height: 120px;  /* Taller cards */
}
```

To change colors:
```css
.mcp-plugin__operation-action {
  background: #your-color;
}
```

## 🔗 Integrating with Skills

Operations are **independent** of skills but can reference them.

To link an operation to a skill:

```javascript
{
  id: 'grid_convert',
  title: 'Convert to Grid',
  prompt: 'Convert this to a Figma Grid using the Grid_Convert_v1 skill...',
  // The skill name is referenced in the prompt text
}
```

Skills are in `skills/` directory:
- `Grid_Convert_v1.md`
- `Layer_Rename_v1.md`
- `Responsive_Apply_v1.md`
- `Html_Import_v1.md`

## 🔄 Integration with ClaudeMCPPlugin

The operations menu is initialized automatically:

```javascript
class ClaudeMCPPlugin {
  constructor() {
    this.operationsMenu = new OperationsMenu();
    // ...
  }

  init() {
    this.initOperationsMenu();  // Called here
    // ...
  }
}
```

### Key Methods

```javascript
// Initialize UI and event listeners
initOperationsMenu()

// Re-render the operations grid
renderOperations()

// Copy operation prompt to clipboard
copyOperationPrompt(operation)
```

## 📡 Extending Functionality

### Add Custom Search Logic

Replace the `filter()` method:

```javascript
filter() {
  this.filteredOperations = this.operations.filter(op => {
    // Custom logic here
    const matchesSearch = ...;
    const matchesCategory = ...;
    const customFilter = ...;  // Your custom filter
    return matchesSearch && matchesCategory && customFilter;
  });
}
```

### Add Favorites

Store favorites in localStorage:

```javascript
// Add to constructor
this.favorites = JSON.parse(localStorage.getItem('operationFavorites')) || [];

// Add method
addFavorite(operationId) {
  if (!this.favorites.includes(operationId)) {
    this.favorites.push(operationId);
    localStorage.setItem('operationFavorites', JSON.stringify(this.favorites));
  }
}
```

### Add Operation History

```javascript
// Track usage
trackUsage(operationId) {
  const history = JSON.parse(localStorage.getItem('operationHistory')) || {};
  history[operationId] = (history[operationId] || 0) + 1;
  localStorage.setItem('operationHistory', JSON.stringify(history));
}

// Get most used
getMostUsed() {
  const history = JSON.parse(localStorage.getItem('operationHistory')) || {};
  return Object.entries(history)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => this.operations.find(op => op.id === id));
}
```

### Add Keyboard Shortcuts

```javascript
// Add to init()
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + K for search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('operations-search').focus();
  }
  
  // Cmd/Ctrl + 1-8 for quick access
  if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '8') {
    const index = parseInt(e.key) - 1;
    const op = this.operationsMenu.getFiltered()[index];
    if (op) this.copyOperationPrompt(op);
  }
});
```

## 🧪 Testing Operations

### Unit Tests (Using Jest)

```javascript
describe('OperationsMenu', () => {
  let menu;

  beforeEach(() => {
    menu = new OperationsMenu();
  });

  test('should search by keyword', () => {
    menu.search('rename');
    const results = menu.getFiltered();
    expect(results.some(op => op.id === 'rename_layers')).toBe(true);
  });

  test('should filter by category', () => {
    menu.setCategory('Organization');
    const results = menu.getFiltered();
    expect(results.every(op => op.category === 'Organization')).toBe(true);
  });

  test('should return all categories', () => {
    const cats = menu.getCategories();
    expect(cats).toContain('all');
    expect(cats.length).toBeGreaterThan(1);
  });
});
```

### Manual Testing Checklist

```markdown
- [ ] All operations appear in grid
- [ ] Search filters correctly
- [ ] Categories filter correctly
- [ ] Copy button works
- [ ] Dark mode renders correctly
- [ ] Grid is responsive
- [ ] No console errors
- [ ] Performance is good (< 100ms search)
```

## 🔍 Debugging

### Enable Logging

Add console output to track operations:

```javascript
renderOperations() {
  const grid = document.getElementById("operations-grid");
  const operations = this.operationsMenu.getFiltered();
  
  console.log('Rendering operations:', {
    total: this.operationsMenu.operations.length,
    filtered: operations.length,
    search: this.operationsMenu.searchQuery,
    category: this.operationsMenu.selectedCategory
  });
  
  // ... rest of code
}
```

### Check State

In browser console:
```javascript
// Check current operations
plugin.operationsMenu.operations.length

// Check filtered results
plugin.operationsMenu.getFiltered().length

// Test search
plugin.operationsMenu.search('rename');
plugin.operationsMenu.getFiltered()

// Test category
plugin.operationsMenu.setCategory('Organization');
plugin.operationsMenu.getFiltered()
```

## 📦 Bundling for Distribution

When building the plugin package:

1. **Minify ui.html** — Compress embedded JavaScript
2. **Update manifest.json** — Increment version number
3. **Update CHANGELOG** — Document new operations
4. **Test all operations** — Verify all functionality

```bash
# Build and package
npm run build
npm run pack  # Creates .dxt file
```

## 🚀 Deployment Workflow

1. **Add operation to OperationsMenu** in ui.html
2. **Test locally** in Figma plugin panel
3. **Update documentation** (OPERATIONS_MENU.md)
4. **Commit changes** to git
5. **Build plugin** with `npm run build`
6. **Test in Figma** one more time
7. **Deploy** to users

## 🔗 Connecting to Claude API

If you want to execute operations directly (advanced):

```javascript
// Execute operation without Claude chat
async executeOperation(operationId) {
  const operation = this.operations.find(op => op.id === operationId);
  
  // Send to Figma plugin backend
  const result = await this.callPluginCommand({
    command: operation.id,
    prompt: operation.prompt
  });
  
  return result;
}
```

## 📚 Related Documentation

- **OPERATIONS_MENU.md** — User guide and reference
- **OPERATIONS_MENU_QUICKSTART.md** — Quick start for users
- **OPERATIONS_IMPLEMENTATION.md** — Implementation details
- **README.md** — Project overview
- **skills/*** — Individual skill documentation

## 💡 Best Practices

✅ **Keep prompts concise** — 1-2 sentences max  
✅ **Use action verbs** — "Convert", "Rename", "Audit"  
✅ **Include triggers** — Helps with discoverability  
✅ **Test after changes** — Verify search and filters work  
✅ **Document changes** — Update relevant .md files  
✅ **Keep categories consistent** — Reuse existing categories  
✅ **Use emojis wisely** — Unique, memorable icons  

## ❓ Common Tasks

### Add 10 new operations at once

```javascript
// In constructor, after existing operations:
const newOps = [
  { id: 'op1', category: 'Cat1', title: 'Op 1', ... },
  { id: 'op2', category: 'Cat2', title: 'Op 2', ... },
  // ... 8 more
];
this.operations.push(...newOps);
```

### Change grid to 3 columns

```css
.mcp-plugin__operations-grid {
  grid-template-columns: 1fr 1fr 1fr;
}
```

### Hide operations menu for certain users

```javascript
if (shouldShowOperations) {
  document.querySelector('.mcp-plugin__operations').style.display = 'block';
} else {
  document.querySelector('.mcp-plugin__operations').style.display = 'none';
}
```

### Export operations as JSON

```javascript
const json = JSON.stringify(menu.operations, null, 2);
console.log(json);
```

---

**Questions?** Check OPERATIONS_MENU.md or file an issue on GitHub.
