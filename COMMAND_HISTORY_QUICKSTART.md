# ⚡ Command History - Quick Start (30 seconds)

## What's New? 📋

**Your Figma plugin can now remember and repeat commands!**

- ✅ Run a command → It appears in activity log (clickable)
- ✅ Click the activity entry → Command copied to clipboard
- ✅ Paste in Claude → Same command runs again
- ✅ No re-typing needed!

## Installation 🚀

1. **Download the new extension**
   ```
   claude-talk-to-figma-mcp.mcpb (version 1.2.0+)
   ```

2. **Install in Claude Desktop**
   - Double-click the `.mcpb` file
   - Click **Install** (or **Replace** if updating)
   - Quit Claude completely (`Cmd` + `Q`)
   - Reopen Claude Desktop

3. **Connect to Figma**
   - Figma → Plugins → Development → Claude Talk to Figma
   - Copy the channel ID from the green box
   - Claude: `Connect to Figma, channel XXXXXX`

## Usage 🎯

### Method 1: Click Activity Log
```
1. Run: "Optimize the layers of the selected section"
2. Claude executes → activity log updates ✓
3. Click the activity entry → command copied
4. Paste into Claude → command runs again
```

### Method 2: Use Recent Commands Panel
```
1. You've run several commands
2. Panel shows: 📋 optimize... 📋 make_responsive...
3. Click any button → command copied
4. Paste into Claude → done!
```

## Real Example 🎬

**Scenario: Optimize multiple design sections**

```
┌─ Figma Plugin Panel ──────────────────────────┐
│                                               │
│ 📌 RECENT COMMANDS                            │
│ [📋 optimize_layers] [📋 make_responsive]     │
│                                               │
│ LIVE ACTIVITY                                 │
│ ✓ Simplified 3 nested frames    1s            │ ← CLICK ME!
│ ✓ Created Grid layout           2s            │ ← CLICK ME!
│ ▶ Starting optimize_layers...                 │
│                                               │
└─────────────────────────────────────────────┘

Step 1: Select "Hero Section" → run command
        ✓ Completes → appears in activity log

Step 2: Select "Features Section" → click [📋 optimize_layers]
        ✓ Command copied to clipboard

Step 3: Paste in Claude
        Claude runs it on "Features Section"
        Done! Same command, different section
```

## Key Features ✨

| Feature | What It Does |
|---------|-------------|
| **Clickable Rows** | Activity entries with ✓ are clickable |
| **Recent Panel** | Shows 10 most recent unique commands |
| **Auto-Copy** | Command goes straight to clipboard |
| **Smart Format** | Ready to paste directly into Claude |
| **Notifications** | Figma confirms when copy succeeds |
| **Clean UI** | Blends seamlessly with existing panel |
| **Dark Mode** | Full support for light & dark themes |

## Tips & Tricks 💡

✨ **Pro Tips:**
- Only **completed** commands (with ✓) are clickable
- **Recent Commands panel** shows up automatically when you have history
- **Long command names** are truncated with `…` (hover for full text)
- **Click "Clear"** to remove all history and start fresh
- **Recent commands** are in **newest-first order**

## What Gets Saved? 💾

✅ **Saved During Session**
- Recent commands (up to 10 unique)
- Activity log entries (up to 100)
- They appear instantly when you run commands

❌ **Not Saved** (cleared when plugin closes)
- History only exists during current session
- Closing plugin = fresh start
- This is intentional (keeps memory light)

## Troubleshooting 🔧

| Problem | Solution |
|---------|----------|
| **No Recent Commands showing** | Run a command that completes (shows ✓) |
| **Can't click activity entry** | Only completed commands (✓) are clickable |
| **Copied wrong text** | Try clicking the recent command button instead |
| **History disappeared** | Normal - it resets when you close the plugin |
| **Dark mode looks wrong** | Try toggling the moon/sun icon in top-right corner |

## Video Walkthrough

Not available yet, but here's what it looks like:

```
1. You type in Claude:
   "Optimize the layers of the selected section"

2. Plugin executes
   Activity log updates: "✓ Simplified 3 nested frames  1s"

3. You click the activity entry
   A tooltip appears: "Click to copy command"

4. The command is copied to clipboard
   Figma shows: "✓ Command copied: optimize_layers"

5. You paste into Claude
   Click, click, done - no re-typing!
```

## Related Documentation 📚

For more details, see:
- **[COMMAND_HISTORY.md](COMMAND_HISTORY.md)** - Complete feature guide
- **[COMMAND_HISTORY_VISUAL_GUIDE.md](COMMAND_HISTORY_VISUAL_GUIDE.md)** - Visual examples
- **[COMMAND_HISTORY_IMPLEMENTATION.md](COMMAND_HISTORY_IMPLEMENTATION.md)** - Technical details

## FAQ

**Q: Do commands get saved permanently?**  
A: No, only during the current session. Reload → history clears.

**Q: Can I edit commands before copying?**  
A: No, but you can copy and then modify in Claude chat.

**Q: What if I run the same command twice?**  
A: It moves to the front of recent commands (no duplicates).

**Q: How many recent commands are saved?**  
A: Last 10 unique commands. Oldest removes when you exceed 10.

**Q: Works on Mac/Windows/Linux?**  
A: Yes, all three platforms fully supported.

## Report Issues

Found a bug? Have feedback?  
→ [GitHub Issues](https://github.com/arinspunk/claude-talk-to-figma-mcp/issues)

---

**You're all set!** 🎉

Start running commands and watch the Recent Commands panel grow.  
Your future self will thank you for not re-typing! ✨

