# Web-to-Figma Capture — Chrome extension

Reads a live web page the way the browser rendered it, and hands the result to
Claude over the same relay the Figma plugin uses. Claude can then rebuild the page
in Figma, binding it to your own variables and text styles.

```
Claude
  └─ MCP server
       ├─ Figma tools ─────────► relay :3055 ─► Figma plugin
       ├─ webflow_designer_* ──► relay :3055 ─► Webflow extension
       └─ browser_* ───────────► relay :3055 ─► this extension ─► the page in Chrome
```

`analyze_html` reads a page's **source**. This extension reads the **result**:
computed styles after every stylesheet and script has run, content built by
JavaScript, CSS variables resolved to real colours, and animation state.

## Install

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and select this `browser_extension` folder.
3. Pin **Web-to-Figma** from the puzzle-piece menu so its button is visible.

It needs Chrome 116 or later (also works in Edge and Brave). To capture local
`.html` files, turn on **Allow access to file URLs** in the extension's details.

## Use

1. Start the relay: `npm run socket` in the repo root.
2. Open the Figma plugin and note its **channel ID**. Claude joins that channel.
3. Click the extension button, paste the same channel ID, and press **Connect**.
   The badge shows **ON** while it is connected.
4. Open the page you want in Chrome and tell Claude, for example:
   *"Connect to ws://localhost:3055 and build this page in Figma."*
   Claude finds the channel by itself (you don't have to paste it) and runs
   `browser_capture_to_figma`. The page is captured and sent straight to the
   Figma plugin, which builds it in a few seconds.

The connection lives in the extension's background worker, so closing the popup
does not disconnect it. It reconnects to the same channel by itself if the relay
restarts. Only **Disconnect** ends the session.

Three ways to get a page into Figma. They all build the same result:

| Way | How |
|---|---|
| **Ask Claude** | *"Build this page in Figma"*: Claude runs `browser_capture_to_figma` |
| **Send to Figma** (popup button) | Builds the page in the Figma plugin on the same channel, without Claude |
| **Save capture → Upload** | Saves the page with its images as a JSON file; then use **Upload capture** in the plugin's Connect tab |

**Pick element** lets you click the one section you want: ↑ selects the parent,
↓ goes back down, Esc cancels. Send to Figma and Claude then use only that
section.

## Tools

| Tool | What it does |
|---|---|
| `browser_status` | Is the extension connected; which tab is active; can Chrome read it; was an element picked |
| `browser_pick` | Waits for you to click an element in the page |
| `browser_capture` | Captures the page, a picked element, or a CSS selector. Can open a `url` first. Saves the full JSON and returns a summary |
| `browser_capture_nodes` | Reads one part of a saved capture, with every style listed, ready to build in Figma |
| `browser_capture_to_figma` | Captures the page (or loads a saved capture) and builds it in Figma in one step, images included |

## Exact viewport width

Your Chrome window's width does not decide the layout. Before capturing, the
extension makes Chrome lay the page out at an exact width: **1440 px by
default** for `browser_capture_to_figma` and Send to Figma (the width box next
to the button), or whatever width you ask for (`768`, `375`, …). It does this
through Chrome's DevTools protocol, the same engine Puppeteer drives, but in
your real tab with your login. Media queries, `vw` units and container widths
all resolve at that width, and scrollbars are hidden so the layout is exactly
that wide. Chrome shows a "started debugging this browser" bar while this
happens; it goes away when the capture ends. If DevTools is open on that tab,
close it first, because only one debugger can attach at a time.

The capture also waits for the page to finish loading first: the load event,
web fonts, and 600 ms with no new network requests. It waits again after
scrolling, since scrolling triggers lazy loading.

## What Claude builds in Figma

`browser_capture_to_figma` sends the capture directly to the Figma plugin. None
of it passes through the conversation, so a whole page takes seconds. The plugin
builds it like this:

- **Layout.**
  - flex → **Auto Layout**, with the page's gap, padding and alignment;
  - CSS grid → **Grid**;
  - stacked blocks → vertical Auto Layout;
  - a row of inline boxes → horizontal Auto Layout.

  Where spacing between stacked blocks varies, the difference goes into an
  invisible top padding, or a named `Spacer-N` if the block has a visible box.
  Absolute positioning is used only when elements really overlap.
- **Sizing.** Heights hug their content (with the page height as a minimum where
  content alone is shorter, such as a full-screen hero). Widths fill their
  container where the page does. Text wraps at its real width.
- **Names.** Every layer is named by role and content: `Section-Features`,
  `Card-Pricing`, `Btn-GetStarted`, `Heading-OurServices`, `Input-Email`,
  `Icon-Arrow`. Empty wrapper `div`s that add a level and nothing else are
  removed.
- **Your design system.** Colours, text styles, spacing and radii are bound to
  your existing variables and text styles, **exact matches only**. Everything
  else keeps the page's own value and is listed in the report. Nothing new is
  created in your design system.
- **Images.** The extension fetches every image and converts WebP and AVIF to PNG
  or JPEG, the only formats Figma accepts. Transparency is kept, and images
  are scaled to twice their displayed size. SVG files become editable vectors.
- **Motion.** Hover rules, transitions and scroll data are saved on each layer as
  plugin data (`web2figma`), ready for an HTML export.
- **Visual fidelity first.** After building, every Auto Layout frame is measured
  against the page. Any frame whose size, or whose children's positions or
  sizes, are off by more than 2.5 px switches to exact X/Y positions and fixed
  sizes; its children keep their own Auto Layout where that matches. The same
  happens when CSS stacking (`z-index`) puts a layer above a later sibling it
  overlaps, because in Auto Layout the flow order is the paint order. Rotations
  (`rotate:` or `transform`), `::before`/`::after`, dot-grid backgrounds and CSS
  image filters are reproduced too. Line breaks Figma would place differently
  (`text-wrap: balance`) follow the browser's own lines.

## What a capture contains

- **Structure.** Every visible element with its position on the page, its tag and
  classes, and text kept in order around inline tags such as `<strong>` and `<a>`.
  Also images (the resolved `src`), background images, inline SVG markup,
  `::before`/`::after` content, and whether an element is fixed or sticky.
- **Styles.** Each element's computed layout (flex, grid, gap, padding, sizes),
  paint (fills, borders, radii, shadows, filters, blend modes) and type. Defaults
  are dropped, and identical styles are stored once and shared.
- **Tokens with usage counts.** Colours (oklch, lab and `color()` converted to sRGB
  hex, source kept), gradients, type combinations, spacing, radii, shadows and
  blurs. The summary ends with a ready-to-use argument block for
  `match_design_tokens`.
- **The page's own system.** CSS custom properties (values on `:root` resolved),
  `@font-face` rules and loaded fonts, and `@media` breakpoints.
- **Interaction and motion.** `:hover`, `:focus` and `:active` rules linked to the
  elements they affect, `@keyframes`, every running animation, and scroll
  behaviour:
  - the GSAP ScrollTrigger registry, if the page uses it;
  - AOS, WOW, Framer and Webflow-style attributes and classes;
  - CSS `animation-timeline: scroll()` or `view()`;
  - a **scroll probe**: before capturing, the extension scrolls the page top to
    bottom and records which classes and inline styles change, at what scroll
    position, and how each element looks once revealed. This also loads lazy
    images and makes content that fades in on scroll visible in the capture.

Stylesheets on another domain can't be read from inside the page, so the
extension downloads them directly. Chrome extensions aren't subject to CORS.

## Limits

- **Figma can't run web animations.** The capture records them so they can be
  stored on the matching layers and put back into an HTML export. They are not
  converted into Figma motion.
- **Fonts must be installed in Figma** for a 1:1 match. The summary names every
  family the page uses, and a family that didn't load is flagged.
- **Capture size is limited by the relay.** One message can be at most 15 MB.
  Typical marketing pages come to 1–2 MB (tested: linear.app at 2,037 elements
  is 1.7 MB; stripe.com at 2,388 elements is 1.7 MB). For bigger pages, capture
  one section at a time with a selector or a picked element.
- **Some pages are off limits.** Chrome doesn't let extensions read `chrome://`
  pages or the Chrome Web Store.
- **IntersectionObserver reveals aren't listed directly.** The browser can't
  enumerate them, so the scroll probe catches them by their effect instead.

## Privacy and permissions

The extension reads **any page Claude asks it to capture**. That needs
`<all_urls>`, because a capture Claude requests has no click in the page to grant
access. So anything else joined to the same relay channel can capture whatever
tab you have open, including pages where you are logged in. Keep the channel ID
to yourself, and press **Disconnect** when you are done. Every capture is listed
in the popup's log.

Values typed into password fields are never captured, and hidden inputs are
skipped entirely. Nothing is sent anywhere except the relay you connect to,
which is `localhost` by default.

## What has been tested, and what hasn't

- **Tested in real headless Chrome.**
  `tests/unit/browser-extractor-chrome.test.ts` runs `extractor.js` inside the
  installed Chrome, and `tests/fixtures/browser-capture/chrome-harness.mjs` can
  point it at any URL.
- **Tested against the real relay.**
  `tests/unit/browser-extension-worker.test.ts` runs `background.js` with a fake
  `chrome` API. It covers joining, commands, progress updates, errors, recovery
  after a relay restart, restoring the session after a worker restart, and the
  heartbeat watchdog.
- **Not tested automatically.** Loading the unpacked extension into Chrome, the
  popup's appearance, `chrome.scripting` injecting into a real tab, and the
  element picker. Current Chrome no longer lets automation load an unpacked
  extension, so these need one manual pass: load it, connect, run
  `browser_status`, pick an element, and run `browser_capture`.
