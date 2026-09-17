# 📸 Command History Visual Guide

## The Plugin Panel - Before & After Commands

### Before Any Commands
```
┌─────────────────────────────────────────────────────┐
│ 🤖🎨 Claude Talk to Figma                           │
│ AI agents reading and modifying Figma designs       │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ✓ Connected on port 3055!                          │
│   Copy the channel ID: d7b3f1                       │
│                                                     │
│ LIVE ACTIVITY         [Clear]   Idle              │
│ ┌─────────────────────────────────────────────┐    │
│ │ No activity yet. Actions will appear here   │    │
│ │ as Claude works.                            │    │
│ └─────────────────────────────────────────────┘    │
│                                                     │
│ ☐ Live cursor  ☑ Highlight nodes                  │
│ ☐ Canvas overlay  ☑ Follow viewport               │
└─────────────────────────────────────────────────────┘
```

### After Running Commands
```
┌─────────────────────────────────────────────────────┐
│ 🤖🎨 Claude Talk to Figma                           │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ✓ Connected on port 3055! Channel: d7b3f1          │
│                                                     │
│ 📌 RECENT COMMANDS                                  │
│ ┌─────────────────────────────────────────────┐    │
│ │ 📋 optimize… 📋 make_res… 📋 rename_lay…   │    │
│ └─────────────────────────────────────────────┘    │
│                                                     │
│ LIVE ACTIVITY         [Clear]   optimize · 2s     │
│ ┌─────────────────────────────────────────────┐    │
│ │ 14:35:42 ▶ Started optimize_layers          │    │
│ │ 14:35:43 ✓ Simplified 3 nested frames    1s │    │ ← CLICK ME!
│ │         Layer: Section Header               │    │
│ │ 14:35:12 ✓ Created Grid layout            2s │    │ ← CLICK ME!
│ │         Layer: Card Row, Grid Set           │    │
│ │ 14:34:58 ✓ Renamed 14 layers              5s │    │ ← CLICK ME!
│ └─────────────────────────────────────────────┘    │
│                                                     │
│ ☐ Live cursor  ☑ Highlight nodes                  │
└─────────────────────────────────────────────────────┘
```

## Interaction States

### Default Activity Row (Completed Command - No Hover)
```
14:35:43 ✓ Simplified 3 nested frames    1s
         Layer: Section Header
```
- Gray background
- Monospace timestamp
- Green checkmark
- Command duration shown on right

### Hover on Clickable Activity Row
```
14:35:43 ✓ Simplified 3 nested frames    1s  ◀─ HOVER
         Layer: Section Header
    ↑
    Tooltip: "Click to copy command"
    
Background becomes light purple/blue
Text becomes slightly darker
Cursor changes to pointer
```

### After Clicking
```
Figma notification appears:
┌────────────────────────────────────────┐
│ ✓ Command copied: optimize_layers      │
└────────────────────────────────────────┘

Your clipboard now contains:
┌────────────────────────────────────────┐
│ optimize_layers                        │
└────────────────────────────────────────┘
```

### Recent Commands Panel - Interactions

#### Default State
```
📌 RECENT COMMANDS
┌─────────────────────────────────────────────────────┐
│ 📋 optimize_layers  📋 make_responsive  📋 rename… │
│ (most recent)                            (oldest)   │
└─────────────────────────────────────────────────────┘
```

#### Hover on Recent Command Button
```
📌 RECENT COMMANDS
┌─────────────────────────────────────────────────────┐
│ 📋 optimize_layers ◀─ HOVER                        │
│        ↑                                            │
│     Background turns purple/blue                    │
│     Text becomes white                             │
│     Cursor changes to pointer                      │
└─────────────────────────────────────────────────────┘
```

#### After Clicking Recent Command
```
1. Button clicked
        ↓
2. Command copied to clipboard
        ↓
3. Notification: "✓ Command copied: optimize_layers"
        ↓
4. Ready to paste into Claude
```

## Workflow Examples

### Example: Optimize Multiple Sections

```
STEP 1: Select "Hero Section" in Figma
┌─────────────────────────────────────────────────┐
│ You (Claude):                                   │
│ "Optimize the layers of the selected section"  │
└─────────────────────────────────────────────────┘
           ↓ Claude executes
        Activity Log updates:
        ✓ Optimized "Hero Section" layers    2s
           ↑
           └─ CLICKABLE - "Click to copy command"

        Recent Commands Panel updates:
        📋 optimize_layers  (newly added)

────────────────────────────────────────────────

STEP 2: Select "Features Section" in Figma
        Want to use same command? Click the panel!
┌──────────────────────────────┐
│ 📋 optimize_layers           │ ← CLICK HERE
└──────────────────────────────┘
           ↓
     Command copied to clipboard
           ↓
You (Claude):
[Paste the command from clipboard]
           ↓ Claude executes on new selection
        Activity Log updates:
        ✓ Optimized "Features Section" layers  1.5s

Done! Same command, different selection, no re-typing.
```

### Example: Design System Audit

```
Command 1: "Find all text with contrast ratio < 4.5:1"
           ↓ completed
           Activity row appears ✓
           Recent Commands: [Find all text...]

Command 2: "Show me the design system"
           ↓ completed
           Activity row appears ✓
           Recent Commands: [Show me the...] [Find all text...]

Command 3: "Change #FF6B6B to #E63946 everywhere"
           ↓ completed
           Activity row appears ✓
           Recent Commands: [Change #FF6B...] [Show me the...] [Find all text...]

Later: "I want to find contrast issues again"
       Click [Find all text...] in Recent Commands panel
       Command auto-copies to clipboard
       Paste into Claude
       Done! No need to remember exact phrasing
```

## Theme Support

### Light Mode Activity Row
```
Text: Dark purple (#400B55)
Background: White
Hover: Light purple tint
Checkmark: Green (#2e9e57)
```

### Dark Mode Activity Row
```
Text: Light gray
Background: Dark gray (#232323)
Hover: Purple tint (#5467F7)
Checkmark: Green (#2e9e57)
```

### Recent Commands Button - Light Mode
```
Default:
  Background: White
  Border: Light gray
  Text: Dark purple
  Icon: 📋

Hover:
  Background: Purple (#732392)
  Border: Purple
  Text: White
  Smooth transition
```

### Recent Commands Button - Dark Mode
```
Default:
  Background: Dark gray (#2a2a2a)
  Border: Gray
  Text: Light gray
  Icon: 📋

Hover:
  Background: Blue (#5467F7)
  Border: Blue
  Text: White
  Smooth transition
```

## Truncation Behavior

### Long Command Names
```
Full command:
"convert_static_designs_to_auto_layout_or_grid"

Displayed (max 20 chars):
📋 convert_static_d…

Hover tooltip shows:
"convert_static_designs_to_auto_layout_or_grid"
```

### Node Names in Activity Log
```
Full list:
"Layer: Hero Section, Call to Action, Feature Box 1, Feature Box 2, Feature Box 3, and 5 more"

Displayed:
"Layer: Hero Section, Call to Action, Feature Box 1, Feature Box 2, and 4 more"

(Shows first 4, then "+N more")
```

## Status Indicators

### Activity Row Icons
```
▶ = Started (command begins)
✓ = Completed (green, clickable)
✕ = Error (red, not clickable)
· = Progress/intermediate
```

### Status Chip
```
Idle · 3 done, 1 failed
     ↑
Shows total completed and failed commands

Working · optimize · 4s
         ↑
Shows current command and elapsed time (updates live)
```

## Memory Limits

### Recent Commands List
- **Maximum**: 10 unique commands
- **When exceeded**: Oldest command removed
- **Duplicates**: Moved to front (no duplicate entries)

```
You run:
1. optimize_layers ✓
2. make_responsive ✓
3. rename_layers ✓
4. optimize_layers ✓ (again)

Recent list becomes:
[optimize_layers, make_responsive, rename_layers]
  ↑ Most recent
  (no duplicate - moved to front)
```

### Activity Log
- **Maximum**: 100 entries
- **When exceeded**: Oldest entry removed
- **Bounded**: Prevents memory exhaustion

## Clear Behavior

### Before Clear
```
Recent Commands Panel: [optimize] [make_responsive] [rename]
Activity Log: 23 entries
```

### Click "Clear" Button
```
┌──────────────────────────────────────────────┐
│ LIVE ACTIVITY [Clear] ← CLICK                │
└──────────────────────────────────────────────┘
```

### After Clear
```
Recent Commands Panel: (hidden - no commands)
Activity Log: Empty

Message: "No activity yet. Actions will appear here
          as Claude works."
```

---

**This visual guide helps you understand exactly what happens when you interact with the command history feature!**

