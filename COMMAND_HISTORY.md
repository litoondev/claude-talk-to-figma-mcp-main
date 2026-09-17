# 📋 Command History & Reuse Feature

## Overview

The **Command History & Reuse** feature makes your Figma plugin panel smarter by tracking all commands executed and allowing you to quickly re-run them in Claude. This eliminates the need to remember or retype commands you've used before.

## Features

### 1. **Clickable Activity Log**
Every command that completes successfully is now clickable in the activity log:
- **Click any activity entry** to copy the command to your clipboard
- Completed commands show a hover state indicating they're clickable
- A tooltip appears on hover: "Click to copy command"

### 2. **Recent Commands Panel**
A quick-access panel shows your 10 most recent commands:
- **Appears automatically** when you've run any commands
- **Shows unique commands only** (no duplicates)
- **Ordered by most recent** (newest at the left)
- **One-click copy** to clipboard

### 3. **Smart Clipboard Formatting**
When you click to copy a command:
- The command text is formatted as a clean prompt
- It's copied to your clipboard ready to paste into Claude
- You get a Figma notification confirming the copy

## How to Use

### Scenario 1: Repeat a Command in the Same Session
```
1. You run: "Optimize the layers of the selected section"
2. After the command completes, it appears in the activity log
3. Click on the activity entry → command is copied
4. Paste into Claude chat → same command runs again
```

### Scenario 2: Use Recent Commands Panel
```
1. Run several commands: "Make responsive", "Rename layers", "Optimize layers"
2. The Recent Commands panel shows all three (newest first)
3. To run "Optimize layers" again, click the button in the panel
4. Command is copied and ready to paste in Claude
```

### Scenario 3: Quick Access Later
```
1. You've executed: "Convert layout to Grid"
2. Later in the session, you want the same command
3. Look at the Recent Commands panel → click the command
4. Paste it into Claude (no need to remember exact phrasing)
```

## UI Elements

### Activity Row (Clickable)
```
┌─ 14:32:45 ▶ Started "optimize_layers" 1s ──────────────────────────┐
│                                                                       │
│ Click to copy command                                               │
└─────────────────────────────────────────────────────────────────────┘
```

### Recent Commands Panel
```
┌─ 📌 RECENT COMMANDS ──────────────────────────────────────────────────┐
│  📋 optimize… │ 📋 make_responsive │ 📋 rename… │ 📋 convert_layout   │
└───────────────────────────────────────────────────────────────────────┘
```

## Behavior

### Auto-tracking
- Commands are automatically tracked when they **complete successfully**
- Failed or errored commands are NOT added to recent list
- Duplicate commands are moved to the front (no duplicates in the list)
- Maximum 10 recent commands stored (oldest removed when limit reached)

### Clear Activity
- Clicking the "Clear" button removes all activity entries
- **Also clears the Recent Commands panel**
- Useful to start fresh without clutter

### Light/Dark Mode
- Both light and dark themes are supported
- Hover states and styling adapt to theme
- Recent command buttons match theme colors

## Technical Details

### Implementation
- **Frontend**: JavaScript in `ui.html` (plugin UI)
- **Storage**: In-memory session only (not persisted)
- **Tracking**: Happens in `addActivityEntry()` method
- **Display**: `renderRecentCommands()` and `renderActivity()` methods

### Data Structure
```javascript
// Recent commands are stored as simple array
this.recentCommands = {
  list: ["optimize_layers", "make_responsive", "rename_layers"],
  max: 10  // Maximum items to keep
}

// Activity entries track full details
this.activity = {
  entries: [
    {
      ts: 1694970765000,
      kind: "completed",
      command: "optimize_layers",
      message: "Created Frame 'Optimized Content'",
      durationMs: 2341,
      nodeIds: ["123:456"],
      nodeNames: ["Optimized Content"]
    }
  ],
  max: 100  // Bounded so DOM doesn't grow unbounded
}
```

## Examples

### Example 1: Batch Layer Optimization
```
Step 1: User selects "Section A" and runs:
        "Optimize the layers of the selected section"
        
        Command appears in activity log ✓
        Button shows in Recent Commands panel ✓

Step 2: User selects "Section B" and clicks the recent command button
        Command copies to clipboard
        
Step 3: User pastes into Claude
        Claude runs the same command on Section B ✓
```

### Example 2: Design System Audit
```
Session flow:
1. "Find all text with contrast < 4.5:1" → Completed ✓
2. "Show me the design system" → Completed ✓
3. "Change primary color from #FF6B6B to #E63946" → Completed ✓

Recent Commands panel now shows:
   [Change primary...] [Show me the...] [Find all text...]

User clicks "Find all text..." → instantly copies the command
No need to rephrase or remember the exact wording ✓
```

### Example 3: Mobile Responsiveness
```
Commands used this session:
1. "Analyze this page for responsive issues"
2. "Make a Tablet version at 768px"
3. "Make a Mobile version at 320px"

Recent Commands shows all three. To rerun mobile responsiveness
on a different screen, just click the "Make a Mobile..." button ✓
```

## Tips & Tricks

### ✨ Pro Tips
1. **Check the Recent Commands panel first** before typing a long command
2. **Commands only appear after completion** (keep watch for green checkmark)
3. **Longer command names are truncated** with `…` but full text shows in tooltip
4. **Recent commands are session-scoped** (lost when plugin closes)
5. **Same command used twice** moves to front, doesn't duplicate

### 🎯 Best Practices
- **Use meaningful command phrasings** that you might want to repeat
- **Clear activity** between separate design tasks to reduce clutter
- **Use the panel for repetitive work** (applying same change to multiple sections)
- **Copy first, then modify** if you need a slight variation

## Limitations

❌ **Not Persisted**: Commands are only stored during the current session
  - Reload the plugin → recent commands list clears
  - This is intentional (keeps memory usage low)

❌ **No Command Parameters**: Only command names are tracked
  - "Optimize section A" and "Optimize section B" both show as "optimize_layers"
  - Parameters are not stored (focus is on the action, not the specifics)

❌ **No Edit/Modify**: Can't edit commands before copying
  - Click to copy as-is
  - Modify in Claude if needed

## Future Enhancements (Potential)

🚀 **Possible additions** (not currently implemented):
- Save favorite commands across sessions (localStorage)
- Create command aliases/shortcuts
- Export activity log as JSON
- Search/filter recent commands
- Command templates with parameter placeholders
- Batch execute multiple commands at once

## Troubleshooting

### Recent Commands panel not showing
**Problem**: I've run commands but the Recent Commands panel is empty
**Solution**: Panel only shows after at least one command completes. Make sure the activity shows a ✓ (completed) marker.

### Click didn't copy the command
**Problem**: I clicked but nothing was copied
**Solution**: 
1. Only completed commands (green ✓) are clickable
2. Check browser console (F12) for errors
3. Try copying the channel ID first to verify clipboard works

### Commands disappeared from recent list
**Problem**: I had commands, then they vanished
**Solution**: This is normal - clicking "Clear" removes all activity and recent commands. Reload the plugin to reset.

## See Also

- [Installation Guide](README.md#installation)
- [Live Activity Tracking](README.md#live-activity-tracking)
- [Claude Desktop Integration](README.md#-every-session-after-the-first)

---

**Version**: 1.2.0+  
**Last Updated**: 2026-09-17  
**Status**: ✅ Stable
