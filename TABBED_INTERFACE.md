# Tabbed Interface Overview

The plugin UI has been reorganized into **4 dedicated tabs** for better organization and cleaner navigation.

## 📑 Tabs

### 1. ⚡ **Operations** (Default Tab)
The quick operations menu with all available design operations.

**Features:**
- Search operations by keyword
- Filter by category (Layout, Organization, Responsive, Design System, Typography)
- One-click copy of pre-formatted prompts
- All 8+ available operations at a glance

**Use when:**
- You want to discover and copy operation prompts
- You're looking for a specific design task
- You need to refresh on available operations

**Time to action:** < 5 seconds to copy any prompt

---

### 2. 📋 **Activity** (Live Updates)
Real-time activity feed showing everything Claude is doing in your Figma file.

**Features:**
- Live activity log with timestamps
- Status indicators (started ▶, completed ✓, error ✕)
- Recent commands quick-access buttons
- Display options for visual feedback
- Elapsed time for operations
- Node names affected by each operation

**Shows:**
- Every command Claude executes
- Progress and status of operations
- Errors or warnings
- Which layers were modified

**Use when:**
- You want to see what Claude is doing in real-time
- You need to understand what changed
- You want to reuse a recent command
- You're monitoring long operations

**Time to action:** Automatic updates, no action needed

---

### 3. 🔌 **Connect** (Connection Management)
Manage your connection to the Claude MCP server.

**Features:**
- Connection status display
- Progress bar for active operations
- Connect/Disconnect buttons
- Connection information and channel ID
- Clear status messages

**Displays:**
- Server connection status (Connected/Disconnected/Connecting)
- Channel ID to use in Claude chat
- Progress of ongoing operations
- Connection error messages

**Use when:**
- You want to connect/disconnect from the server
- You need your channel ID to paste in Claude chat
- You're troubleshooting connection issues
- You want to see operation progress

**Time to action:** 1 click to connect/disconnect

---

### 4. ⚙️ **Settings** (Configuration)
Configure how the plugin behaves and works with your Figma file.

**Features:**
- Display options for visual feedback
- Live cursor animation settings
- Node highlighting preferences
- Canvas overlay options
- Viewport following preferences
- Figma file configuration
- REST API fallback settings
- About information

**Settings include:**

#### Display Options
- **Live cursor** — Animated cursor showing Claude's position
- **Highlight nodes** — Select nodes as they're being edited
- **Canvas overlay** — Status frame on canvas (adds to document)
- **Follow viewport** — Auto pan/zoom to edited elements

#### Figma File Configuration
- Set explicit Figma file URL or key
- Useful for REST API fallback
- Auto-detection when blank

#### About
- Plugin name and description
- Link to documentation
- Version information

**Use when:**
- You want to customize how the plugin shows work
- You need to set your Figma file key
- You want to enable/disable visual feedback
- You're configuring performance preferences

**Time to action:** 30 seconds to adjust settings

---

## 🎯 Quick Navigation Guide

| Need | Go To | Action |
|------|-------|--------|
| Find an operation prompt | **Operations** | Search → Copy |
| See what Claude did | **Activity** | Watch feed or click recent command |
| Connect to Claude | **Connect** | Click Connect, copy channel ID |
| Reuse a command | **Activity** | Click recent command button |
| Turn off visual feedback | **Settings** | Uncheck display options |
| Set Figma file key | **Settings** | Enter key/URL → Save |
| Check connection status | **Connect** | View status display |
| Search for operations | **Operations** | Type in search box |

---

## 🎨 Tab Bar Design

The tab bar appears at the very top of the plugin panel with:
- **Icon + Label** for each tab
- **Active indicator** (colored bottom border)
- **Hover effects** for discoverability
- **Dark/Light mode** support
- **Responsive sizing** adapts to panel width

### Tab Bar Example
```
⚡Operations | 📋Activity | 🔌Connect | ⚙️Settings
```

---

## 💡 Workflow Examples

### Example 1: Quick Design Operation
```
1. Click ⚡ Operations tab (you're already here)
2. Search "rename"
3. Click "Copy prompt" on Rename Layers
4. Paste in Claude chat
5. Done! (~30 seconds)
```

### Example 2: Monitor Progress
```
1. Start operation in Claude
2. Click 📋 Activity tab
3. Watch the feed update in real-time
4. See completed operations with timestamps
5. Monitor takes no extra time
```

### Example 3: Configure Settings
```
1. Click ⚙️ Settings tab
2. Uncheck "Canvas overlay" to avoid adding nodes to document
3. Check "Follow viewport" to auto-pan
4. Click Save on file key settings (if needed)
5. Configuration complete (~1 minute)
```

### Example 4: Connect to Claude
```
1. Click 🔌 Connect tab
2. Click "Connect" button
3. Copy the channel ID shown
4. Go to Claude chat
5. Paste channel ID to establish link
```

---

## ⌨️ Keyboard Navigation

- **Tab key** — Move between tabs
- **Enter** — Activate tab
- **Cmd/Ctrl + Tab** — Cycle through tabs (future enhancement)

---

## 🌓 Dark/Light Mode

The tab interface works in both themes:
- **Light mode** — Purple accents, clean white background
- **Dark mode** — Blue accents, dark background
- Toggle with the moon/sun icon (top right)

---

## 📱 Responsive Behavior

The tabs adapt to panel width:
- **Wide panels** — Full labels visible
- **Narrow panels** — Icons + abbreviated labels
- **Very narrow** — Icons only (future enhancement)

---

## 🚀 Tips & Tricks

### Pro Tips
1. **Use keyboard shortcuts** — Tab through tabs faster
2. **Check Activity frequently** — See what Claude changed
3. **Customize Settings** — Turn off canvas overlay to keep document clean
4. **Reuse recent commands** — Activity tab has quick-access buttons
5. **Bookmark channel ID** — Copy Connect tab's ID for future sessions

### Performance Tips
- Disable "Canvas overlay" if document is getting bloated
- Disable "Follow viewport" on slow systems
- Keep Activity tab open to monitor progress
- Clear Activity when it gets long

---

## 🔄 Tab Behavior

- **Default tab:** Operations (first time opening)
- **Persistent:** Currently selected tab stays active
- **Scrollable content:** Each tab scrolls independently
- **No tab switching needed:** Many tasks only use one tab

---

## 🧩 Implementation Details

### Tab Classes
```css
.mcp-plugin__tabs-container        /* Tab bar container */
.mcp-plugin__tab                   /* Individual tab button */
.mcp-plugin__tab.active            /* Active tab indicator */
.mcp-plugin__tab-content           /* Tab content area */
.mcp-plugin__tab-content.active    /* Active content display */
```

### Adding New Tabs

To add a new tab:

1. **Add button to tab bar:**
```html
<button class="mcp-plugin__tab" data-tab="newtab">
  <span class="mcp-plugin__tab-icon">🎯</span>New Tab
</button>
```

2. **Add content section:**
```html
<div id="tab-newtab" class="mcp-plugin__tab-content">
  Your content here
</div>
```

3. **Tab switching is automatic** (handled by `initTabs()`)

---

## 🎯 Future Enhancements

Potential improvements:
- [ ] Keyboard shortcuts (Cmd+1 through Cmd+4)
- [ ] Tab persistence across sessions
- [ ] Drag to reorder tabs
- [ ] Collapsible Activity in Operations tab
- [ ] Favorites tab for custom operations
- [ ] More detailed settings organization
- [ ] Help/Tutorial tab

---

## ❓ FAQ

**Q: Why tabs instead of one long scroll?**
A: Tabs keep related features together and reduce cognitive load. You only see what you need.

**Q: Can I disable a tab?**
A: Currently no, but you can hide tabs with CSS. See developer guide for details.

**Q: Which tab should I use most?**
A: Start with Operations, move to Activity to monitor, use Connect as needed, adjust Settings once.

**Q: Do tabs remember my selection?**
A: Currently no, but this is a future enhancement. You start on Operations tab each session.

**Q: Can I add custom tabs?**
A: Yes! See OPERATIONS_DEVELOPER_GUIDE.md for implementation details.

---

## 📖 Related Documentation

- **OPERATIONS_MENU.md** — Detailed operations guide
- **OPERATIONS_MENU_QUICKSTART.md** — Quick start for users
- **OPERATIONS_DEVELOPER_GUIDE.md** — Adding custom tabs
- **README.md** — Project overview

---

**The tabbed interface makes the plugin more organized and easier to use!**
