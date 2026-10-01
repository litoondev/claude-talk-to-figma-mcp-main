/**
 * Web-to-Figma page extractor.
 *
 * Injected into the page's MAIN world by background.js, so it can read what the
 * browser actually rendered — computed styles, the JS-built DOM, running
 * animations, scroll libraries' own registries — rather than what the HTML
 * source declares. `analyze_html` reads the source; this reads the result.
 *
 * It defines one global, `window.__webToFigma`, and changes nothing on the page
 * except the scroll position during the optional scroll probe, which is
 * restored before it returns.
 *
 * OUTPUT SHAPE (schema "web-to-figma/capture", version 1)
 * ------------------------------------------------------
 *   nodes[]      flat element list; `parent` / `children` hold ids, `s` indexes
 *                into styles[]. Page coordinates in `rect`.
 *   styles[]     unique computed-style objects with defaults removed. Hundreds
 *                of elements share a handful of styles, so a table is several
 *                times smaller than inline styles.
 *   tokens       colours, gradients, typography, spacing, radii, shadows and
 *                blurs, each with usage counts — the input match_design_tokens
 *                needs.
 *   cssVariables, fonts, breakpoints, interactions (:hover/:focus/:active
 *   rules), keyframes, animations (document.getAnimations()), scroll
 *   (libraries, triggers, probe hints, scroll timelines), warnings, stats.
 *
 * The file also exports its pure helpers under CommonJS so unit tests can load
 * it without a browser.
 */
(function (root) {
  "use strict";

  var SCHEMA = "web-to-figma/capture";
  var VERSION = 1;
  // Bumped whenever capture output changes in a way the importer relies on.
  // The server and importer warn when a capture comes from an older extension,
  // so a stale install is reported instead of silently missing elements.
  var EXTRACTOR_BUILD = 3;
  var PICK_ATTR = "data-web-to-figma-picked";

  // Every property read per element. Order is kept in the output.
  var PROPS = [
    // box & position
    "display", "position", "top", "right", "bottom", "left", "z-index", "float", "box-sizing",
    "width", "height", "min-width", "min-height", "max-width", "max-height", "aspect-ratio",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "overflow-x", "overflow-y",
    // flex container / item
    "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content",
    "row-gap", "column-gap",
    "align-self", "justify-self", "flex-grow", "flex-shrink", "flex-basis", "order",
    // grid container / item
    "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-auto-columns",
    "grid-auto-rows", "justify-items",
    "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
    // paint
    "color", "background-color", "background-image", "background-size", "background-position",
    "background-repeat", "background-clip", "opacity", "visibility", "mix-blend-mode",
    "box-shadow", "filter", "backdrop-filter", "clip-path", "transform", "transform-origin",
    "rotate", "scale", "translate",
    "object-fit", "object-position", "cursor",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-left-radius", "border-top-right-radius",
    "border-bottom-right-radius", "border-bottom-left-radius",
    "outline-width", "outline-style", "outline-color", "outline-offset",
    // text
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
    "word-spacing", "text-align", "text-transform", "text-decoration-line",
    "text-decoration-color", "text-decoration-style", "text-shadow", "white-space",
    "text-overflow", "-webkit-line-clamp", "vertical-align", "text-wrap",
    // motion
    "transition-property", "transition-duration", "transition-timing-function", "transition-delay",
    "animation-name", "animation-duration", "animation-timing-function", "animation-delay",
    "animation-iteration-count", "animation-direction", "animation-fill-mode",
    "animation-play-state", "animation-timeline", "will-change",
    // svg
    "fill", "stroke", "stroke-width",
  ];

  // Values that mean "nothing set". Dropped from the style table.
  var DEFAULTS = {
    "position": "static", "top": "auto", "right": "auto", "bottom": "auto", "left": "auto",
    "z-index": "auto", "float": "none", "box-sizing": "content-box",
    "min-width": ["auto", "0px"], "min-height": ["auto", "0px"],
    "max-width": "none", "max-height": "none", "aspect-ratio": "auto",
    "margin-top": "0px", "margin-right": "0px", "margin-bottom": "0px", "margin-left": "0px",
    "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px",
    "overflow-x": "visible", "overflow-y": "visible",
    "flex-direction": "row", "flex-wrap": "nowrap", "justify-content": "normal",
    "align-items": "normal", "align-content": "normal", "row-gap": "normal", "column-gap": "normal",
    "align-self": "auto", "justify-self": "auto", "flex-grow": "0", "flex-shrink": "1",
    "flex-basis": "auto", "order": "0",
    "grid-template-columns": "none", "grid-template-rows": "none", "grid-auto-flow": "row",
    "grid-auto-columns": "auto", "grid-auto-rows": "auto", "justify-items": ["normal", "legacy"],
    "grid-column-start": "auto", "grid-column-end": "auto",
    "grid-row-start": "auto", "grid-row-end": "auto",
    "background-color": "rgba(0, 0, 0, 0)", "background-image": "none",
    "background-size": "auto", "background-position": "0% 0%", "background-repeat": "repeat",
    "background-clip": "border-box", "opacity": "1", "visibility": "visible",
    "mix-blend-mode": "normal", "box-shadow": "none", "filter": "none", "backdrop-filter": "none",
    "clip-path": "none", "transform": "none", "object-fit": "fill", "object-position": "50% 50%",
    "rotate": "none", "scale": "none", "translate": "none",
    "cursor": "auto",
    "border-top-width": "0px", "border-right-width": "0px", "border-bottom-width": "0px",
    "border-left-width": "0px",
    "border-top-style": "none", "border-right-style": "none", "border-bottom-style": "none",
    "border-left-style": "none",
    "border-top-left-radius": "0px", "border-top-right-radius": "0px",
    "border-bottom-right-radius": "0px", "border-bottom-left-radius": "0px",
    "outline-width": ["0px", "medium"], "outline-style": "none", "outline-offset": "0px",
    "font-style": "normal", "letter-spacing": "normal", "word-spacing": "0px",
    "text-align": ["start", "left"], "text-transform": "none", "text-decoration-line": "none",
    "text-decoration-style": "solid", "text-shadow": "none", "white-space": "normal", "text-wrap": "wrap",
    "text-overflow": "clip", "-webkit-line-clamp": "none", "vertical-align": "baseline",
    "transition-property": "all", "transition-duration": "0s", "transition-timing-function": "ease",
    "transition-delay": "0s",
    "animation-name": "none", "animation-duration": "0s", "animation-timing-function": "ease",
    "animation-delay": "0s", "animation-iteration-count": "1", "animation-direction": "normal",
    "animation-fill-mode": "none", "animation-play-state": "running", "animation-timeline": "auto",
    "will-change": "auto", "fill": "rgb(0, 0, 0)", "stroke": "none", "stroke-width": "1px",
  };

  var FLEX_CONTAINER = ["flex-direction", "flex-wrap"];
  var BOX_ALIGN = ["justify-content", "align-items", "align-content", "row-gap", "column-gap"];
  var GRID_CONTAINER = ["grid-template-columns", "grid-template-rows", "grid-auto-flow",
    "grid-auto-columns", "grid-auto-rows", "justify-items"];
  var FLEX_ITEM = ["flex-grow", "flex-shrink", "flex-basis", "order"];
  var GRID_ITEM = ["grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end", "justify-self"];
  var TEXT_ONLY = ["text-wrap", "text-align", "text-transform", "text-decoration-line", "text-decoration-color",
    "text-decoration-style", "text-shadow", "white-space", "text-overflow", "-webkit-line-clamp",
    "letter-spacing", "word-spacing"];
  var SVG_ONLY = ["fill", "stroke", "stroke-width"];

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, META: 1, LINK: 1, HEAD: 1, TITLE: 1, BASE: 1,
  };
  var INLINE_DISPLAYS = { "inline": 1, "inline-block": 1, "inline-flex": 1, "inline-grid": 1, "contents": 1 };
  var KEEP_ATTRS = ["id", "class", "href", "src", "alt", "title", "role", "aria-label", "type",
    "name", "placeholder", "for", "target", "rel", "width", "height", "viewBox", "loading"];
  var SCROLL_ATTR_RE = /^data-(aos|scroll|sal|animate|animation|wow|reveal|framer|w-id|motion|gsap|parallax|speed|inview|lax)/i;
  var SCROLL_CLASS_RE = /(^|\s)(wow|aos-\S+|reveal\S*|fade-?in\S*|slide-?in\S*|is-inview|in-view|animate__\S+|sal-\S+|js-scroll\S*)(\s|$)/i;

  // ── Pure helpers (exported for tests) ────────────────────────────────────

  function toHex2(n) {
    var h = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return h.length === 1 ? "0" + h : h;
  }

  /** Parse a computed colour. Returns {hex, alpha} or null. Handles rgb()/rgba() and #hex. */
  function parseColor(value) {
    if (!value || typeof value !== "string") return null;
    var v = value.trim();
    var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(v);
    if (m) {
      var a = m[4] === undefined ? 1 : (m[4].slice(-1) === "%" ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { hex: "#" + toHex2(+m[1]) + toHex2(+m[2]) + toHex2(+m[3]), alpha: Math.round(a * 1000) / 1000 };
    }
    m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
    if (m) {
      var hex = m[1].length === 3 ? m[1].split("").map(function (c) { return c + c; }).join("") : m[1];
      var alpha = m[2] ? Math.round((parseInt(m[2], 16) / 255) * 1000) / 1000 : 1;
      return { hex: "#" + hex.toLowerCase(), alpha: alpha };
    }
    return null;
  }

  /** Every colour literal inside a compound value (shadows, gradients). */
  function colorsIn(value) {
    if (!value || value === "none") return [];
    var out = [];
    var re = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|(?:oklch|oklab|lab|lch|hsla?|hwb|color)\([^)]*\))/gi;
    var m;
    while ((m = re.exec(value))) out.push(m[1]);
    return out;
  }

  /** First family in a font stack, unquoted. */
  function primaryFamily(stack) {
    if (!stack) return null;
    var first = String(stack).split(",")[0].trim();
    return first.replace(/^["']|["']$/g, "") || null;
  }

  function px(value) {
    if (value === undefined || value === null) return null;
    var m = /^(-?[\d.]+)px$/.exec(String(value).trim());
    return m ? parseFloat(m[1]) : null;
  }

  function round(n, places) {
    var f = Math.pow(10, places === undefined ? 2 : places);
    return Math.round(n * f) / f;
  }

  function isDefault(prop, value) {
    var d = DEFAULTS[prop];
    if (d === undefined) return false;
    return Array.isArray(d) ? d.indexOf(value) !== -1 : d === value;
  }

  /**
   * Reduce one element's raw computed values to what matters for rebuilding it.
   * `ctx` says what the element is: flex/grid container or item, has text, is SVG.
   */
  function pruneStyle(raw, ctx) {
    var out = {};
    var display = raw["display"];
    var isFlex = /flex/.test(display || "");
    var isGrid = /grid/.test(display || "");
    for (var i = 0; i < PROPS.length; i++) {
      var p = PROPS[i];
      var v = raw[p];
      if (v === undefined || v === null || v === "") continue;
      if (isDefault(p, v)) continue;
      if (FLEX_CONTAINER.indexOf(p) !== -1 && !isFlex) continue;
      if (GRID_CONTAINER.indexOf(p) !== -1 && !isGrid) continue;
      if (BOX_ALIGN.indexOf(p) !== -1 && !isFlex && !isGrid) continue;
      if (FLEX_ITEM.indexOf(p) !== -1 && !ctx.flexItem) continue;
      if (GRID_ITEM.indexOf(p) !== -1 && !ctx.gridItem) continue;
      if (TEXT_ONLY.indexOf(p) !== -1 && !ctx.hasText) continue;
      if (SVG_ONLY.indexOf(p) !== -1 && !ctx.isSvg) continue;
      if (/^border-(top|right|bottom|left)-(style|color)$/.test(p)) {
        var side = p.split("-")[1];
        if (raw["border-" + side + "-width"] === "0px" || raw["border-" + side + "-style"] === "none") continue;
      }
      if (/^outline-(color|offset|width)$/.test(p) && raw["outline-style"] === "none") continue;
      if (p === "transform-origin" && (raw["transform"] === "none" || !raw["transform"])) continue;
      if (p === "text-decoration-color" && raw["text-decoration-line"] === "none") continue;
      if (/^transition-/.test(p) && p !== "transition-duration" && raw["transition-duration"] === "0s") continue;
      if (/^animation-/.test(p) && p !== "animation-name" && raw["animation-name"] === "none" && p !== "animation-timeline") continue;
      if (p === "color" && !ctx.hasText && !ctx.isSvg) continue;
      if (/^font-|^line-height$|^vertical-align$/.test(p) && !ctx.hasText) continue;
      out[p] = v;
    }
    return out;
  }

  /** Collapse whitespace the way the element's white-space mode would. */
  function normalizeText(text, whiteSpace) {
    if (!text) return "";
    if (/pre/.test(whiteSpace || "")) return text;
    return text.replace(/\s+/g, " ");
  }

  /** Strip :hover/:focus/:active (and -visible/-within) so the base element can be queried. */
  function baseSelector(selector) {
    var stripped = selector
      .replace(/:(hover|focus-visible|focus-within|focus|active)\b/g, "")
      .replace(/::?(before|after)\b/g, "")
      .trim();
    if (!stripped || /[>+~,]\s*$/.test(stripped)) return null;
    return stripped;
  }

  function interactionState(selector) {
    var states = [];
    var re = /:(hover|focus-visible|focus-within|focus|active)\b/g;
    var m;
    while ((m = re.exec(selector))) if (states.indexOf(m[1]) === -1) states.push(m[1]);
    return states;
  }

  /** min/max-width numbers from a media condition text. */
  function breakpointOf(mediaText) {
    var min = /min-width:\s*([\d.]+)(px|em|rem)/i.exec(mediaText);
    var max = /max-width:\s*([\d.]+)(px|em|rem)/i.exec(mediaText);
    var conv = function (m) {
      if (!m) return null;
      var n = parseFloat(m[1]);
      return m[2].toLowerCase() === "px" ? n : n * 16;
    };
    var r = { query: mediaText, minWidth: conv(min), maxWidth: conv(max) };
    return r.minWidth === null && r.maxWidth === null ? null : r;
  }

  /**
   * Split a declaration block's cssText into {property: value}, respecting
   * quotes and parentheses. cssText keeps the author's shorthands
   * (`background: …`), where iterating the style object yields every expanded
   * longhand, most of them `initial`.
   */
  function parseCssText(text) {
    var out = {};
    var depth = 0, quote = null, start = 0;
    var parts = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quote) { if (ch === quote && text[i - 1] !== "\\") quote = null; continue; }
      if (ch === "\"" || ch === "'") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (ch === ";" && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    for (var j = 0; j < parts.length; j++) {
      var colon = parts[j].indexOf(":");
      if (colon === -1) continue;
      var name = parts[j].slice(0, colon).trim();
      var value = parts[j].slice(colon + 1).trim();
      if (name) out[name] = value;
    }
    return out;
  }

  /** Style declarations as a plain object, shorthands kept as written. */
  function declarations(style) {
    var out = {};
    if (!style) return out;
    if (typeof style.cssText === "string" && style.cssText) {
      out = parseCssText(style.cssText);
      if (Object.keys(out).length) return out;
    }
    for (var i = 0; i < style.length; i++) {
      var name = style[i];
      out[name] = style.getPropertyValue(name).trim() +
        (style.getPropertyPriority && style.getPropertyPriority(name) ? " !important" : "");
    }
    return out;
  }

  function Counter() { this.map = Object.create(null); }
  Counter.prototype.add = function (key, extra) {
    var e = this.map[key];
    if (!e) { e = this.map[key] = { key: key, count: 0 }; }
    e.count++;
    if (extra) extra(e);
    return e;
  };
  Counter.prototype.sorted = function (limit) {
    var all = Object.keys(this.map).map(function (k) { return this.map[k]; }, this);
    all.sort(function (a, b) { return b.count - a.count; });
    return limit ? all.slice(0, limit) : all;
  };

  // ── Browser-only capture ─────────────────────────────────────────────────

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function describeError(e) { return e && e.message ? e.message : String(e); }

  /** Convert any CSS colour (oklch, lab, color()) to sRGB via a 1px canvas. */
  function makeColorResolver(doc) {
    var ctx = null;
    var cache = Object.create(null);
    return function (value) {
      if (cache[value] !== undefined) return cache[value];
      // A paint server (url(#pattern), url(#gradient)) or keyword is not a colour.
      if (!value || /^\s*url\(/i.test(value) || /^(none|inherit|initial|unset|context-fill|context-stroke)$/i.test(String(value).trim())) {
        return (cache[value] = null);
      }
      var direct = parseColor(value);
      if (direct) return (cache[value] = direct);
      try {
        if (!ctx) {
          var c = doc.createElement("canvas");
          c.width = c.height = 1;
          ctx = c.getContext("2d", { willReadFrequently: true });
        }
        ctx.clearRect(0, 0, 1, 1);
        // Canvas ignores a value it cannot parse and keeps the previous one, so
        // set two different sentinels: if the value is invalid, the result
        // differs between them and the value is refused (not read as transparent).
        ctx.fillStyle = "#010203";
        ctx.fillStyle = value;
        var first = ctx.fillStyle;
        ctx.fillStyle = "#040506";
        ctx.fillStyle = value;
        if (ctx.fillStyle !== first) return (cache[value] = null);
        ctx.fillRect(0, 0, 1, 1);
        var d = ctx.getImageData(0, 0, 1, 1).data;
        var res = { hex: "#" + toHex2(d[0]) + toHex2(d[1]) + toHex2(d[2]), alpha: round(d[3] / 255, 3), source: value };
        return (cache[value] = res);
      } catch (e) {
        return (cache[value] = null);
      }
    };
  }

  /** Stylesheets the page cannot read (cross-origin without CORS). */
  function listUnreadableSheets() {
    var out = [];
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      try {
        void sh.cssRules;
      } catch (e) {
        if (sh.href) out.push(sh.href);
      }
    }
    return out;
  }

  /**
   * Walk every readable rule once: custom properties, :hover/:focus/:active
   * rules, @keyframes, @media breakpoints, @font-face.
   */
  function scanStylesheets(extraSheets, warnings) {
    var result = {
      vars: [], interactions: [], keyframes: [], breakpoints: Object.create(null),
      fontFaces: [], readable: 0, unreadable: [], fetched: 0,
    };
    var MAX_RULES = 60000;
    var visited = 0;

    function walk(rules, media, parentSelector, baseHref) {
      for (var i = 0; i < rules.length && visited < MAX_RULES; i++) {
        var r = rules[i];
        visited++;
        var type = r.constructor && r.constructor.name;
        if (type === "CSSImportRule") {
          var imported = null;
          try { imported = r.styleSheet && r.styleSheet.cssRules; } catch (e) { imported = null; }
          if (imported) walk(imported, (r.media && r.media.mediaText) || media, null, (r.styleSheet && r.styleSheet.href) || baseHref);
          else if (r.href) result.unreadable.push(r.styleSheet && r.styleSheet.href || r.href);
        } else if (r.media && r.cssRules) {
          var mt = r.media.mediaText || r.conditionText || "";
          var bp = breakpointOf(mt);
          if (bp) result.breakpoints[mt] = bp;
          walk(r.cssRules, mt, parentSelector, baseHref);
        } else if (type === "CSSKeyframesRule" || (r.name && r.cssRules && /keyframes/i.test(r.cssText.slice(0, 20)))) {
          var frames = [];
          for (var k = 0; k < r.cssRules.length; k++) {
            frames.push({ offset: r.cssRules[k].keyText, style: declarations(r.cssRules[k].style) });
          }
          result.keyframes.push({ name: r.name, frames: frames });
        } else if (type === "CSSFontFaceRule") {
          var ff = declarations(r.style);
          if (ff.src && baseHref) {
            ff.src = ff.src.replace(/url\((['"]?)([^'")]+)\1\)/g, function (all, q, u) {
              try { return "url(\"" + new URL(u, baseHref).href + "\")"; } catch (e) { return all; }
            });
          }
          result.fontFaces.push(ff);
        } else if (r.selectorText !== undefined && r.style) {
          var sel = r.selectorText;
          if (parentSelector && sel.indexOf("&") !== -1) sel = sel.replace(/&/g, parentSelector);
          else if (parentSelector && r.parentRule && r.parentRule.selectorText !== undefined) sel = parentSelector + " " + sel;
          // custom properties
          for (var j = 0; j < r.style.length; j++) {
            var name = r.style[j];
            if (name.indexOf("--") === 0 && result.vars.length < 3000) {
              result.vars.push({ name: name, value: r.style.getPropertyValue(name).trim(), selector: sel, media: media || null });
            }
          }
          // interaction states
          if (/:(hover|focus|active)/.test(sel) && result.interactions.length < 800) {
            var parts = sel.split(",");
            for (var pI = 0; pI < parts.length; pI++) {
              var part = parts[pI].trim();
              var states = interactionState(part);
              if (!states.length) continue;
              result.interactions.push({
                selector: part, states: states, base: baseSelector(part), media: media || null,
                declarations: declarations(r.style),
              });
            }
          }
          if (r.cssRules && r.cssRules.length) walk(r.cssRules, media, sel, baseHref);
        } else if (r.cssRules) {
          // @supports, @layer, @container
          walk(r.cssRules, media, parentSelector, baseHref);
        }
      }
    }

    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      var rules = null;
      try { rules = sh.cssRules; } catch (e) { rules = null; }
      if (rules) {
        result.readable++;
        walk(rules, null, null, sh.href || document.baseURI);
      } else if (sh.href) {
        result.unreadable.push(sh.href);
      }
    }
    var fetchedHrefs = Object.create(null);
    (extraSheets || []).forEach(function (x) {
      try {
        var cs = new CSSStyleSheet();
        cs.replaceSync(x.css);
        result.fetched++;
        fetchedHrefs[x.href] = 1;
        walk(cs.cssRules, null, null, x.href);
      } catch (e) {
        warnings.push("Could not parse stylesheet " + x.href + ": " + describeError(e));
      }
    });
    result.unreadable = result.unreadable.filter(function (h) { return !fetchedHrefs[h]; });
    if (result.unreadable.length) {
      warnings.push(result.unreadable.length + " cross-origin stylesheet(s) could not be read, so their hover rules, keyframes and variables are missing: " + result.unreadable.slice(0, 5).join(", "));
    }
    if (visited >= MAX_RULES) warnings.push("Stopped reading stylesheets after " + MAX_RULES + " rules.");
    return result;
  }

  /** Scroll libraries the page exposes as globals, plus their registered triggers. */
  function detectScrollLibraries(idOf) {
    var libs = [];
    var triggers = [];
    var w = window;
    try {
      if (w.gsap) libs.push({ name: "GSAP", version: w.gsap.version || null });
      var ST = w.ScrollTrigger || (w.gsap && w.gsap.plugins && w.gsap.plugins.scrollTrigger);
      if (ST && typeof ST.getAll === "function") {
        libs.push({ name: "ScrollTrigger", version: ST.version || null });
        ST.getAll().slice(0, 300).forEach(function (t) {
          var targets = [];
          try {
            if (t.animation && typeof t.animation.targets === "function") {
              t.animation.targets().slice(0, 20).forEach(function (el) { var id = idOf(el); if (id) targets.push(id); });
            }
          } catch (e) { /* timelines without targets */ }
          triggers.push({
            library: "ScrollTrigger",
            trigger: idOf(t.trigger) || null,
            start: t.vars && t.vars.start !== undefined ? String(t.vars.start) : (typeof t.start === "number" ? t.start : null),
            end: t.vars && t.vars.end !== undefined ? String(t.vars.end) : (typeof t.end === "number" ? t.end : null),
            scrub: t.vars ? (t.vars.scrub === undefined ? false : t.vars.scrub) : null,
            pin: t.vars ? !!t.vars.pin : null,
            toggleActions: t.vars && t.vars.toggleActions ? t.vars.toggleActions : null,
            targets: targets,
          });
        });
      }
    } catch (e) { /* a page's globals are not ours to trust */ }
    var checks = [
      ["AOS", function () { return w.AOS; }],
      ["ScrollReveal", function () { return w.ScrollReveal || w.sr; }],
      ["WOW.js", function () { return w.WOW; }],
      ["Lenis", function () { return w.Lenis || w.lenis; }],
      ["Locomotive Scroll", function () { return w.LocomotiveScroll; }],
      ["Lottie", function () { return w.lottie || w.bodymovin; }],
      ["anime.js", function () { return w.anime; }],
      ["Swiper", function () { return w.Swiper; }],
      ["Webflow Interactions", function () { return w.Webflow && document.documentElement.getAttribute("data-wf-page"); }],
      ["Framer", function () { return document.querySelector("[data-framer-appear-id],[data-framer-name]"); }],
      ["Motion One", function () { return w.Motion; }],
    ];
    checks.forEach(function (c) {
      try { if (c[1]()) libs.push({ name: c[0], version: null }); } catch (e) { /* ignore */ }
    });
    return { libraries: libs, triggers: triggers };
  }

  /** True when two inline styles differ only in `--custom` properties (pointer-follow effects). */
  function onlyCustomPropsChanged(before, after) {
    var a = parseCssText(before || ""), b = parseCssText(after || "");
    var keys = Object.keys(a).concat(Object.keys(b));
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf("--") === 0) continue;
      if (a[keys[i]] !== b[keys[i]]) return false;
    }
    return true;
  }

  /**
   * Scroll the page top to bottom so lazy content loads and scroll-triggered
   * reveals fire, recording which attributes changed at which scroll offset.
   * Elements that changed are snapshotted at the bottom (their revealed state).
   */
  async function scrollProbe(opts) {
    var hints = [];
    var changed = new Map();
    var origin = { x: window.scrollX, y: window.scrollY };
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length && hints.length < 2000; i++) {
        var rec = records[i];
        if (rec.type !== "attributes" || rec.target.nodeType !== 1) continue;
        if (rec.attributeName === PICK_ATTR) continue;
        var now = rec.target.getAttribute(rec.attributeName);
        if (now === rec.oldValue) continue;
        if (rec.attributeName === "style" && onlyCustomPropsChanged(rec.oldValue, now)) continue;
        hints.push({ el: rec.target, attribute: rec.attributeName, from: rec.oldValue, to: now, scrollY: Math.round(window.scrollY) });
        changed.set(rec.target, true);
      }
    });
    observer.observe(document.documentElement, {
      subtree: true, attributes: true, attributeOldValue: true,
      attributeFilter: ["class", "style", "data-aos", "data-scroll", "data-inview", "data-animate", "aria-hidden"],
    });
    var step = Math.max(200, Math.round(window.innerHeight * 0.8));
    var deadline = Date.now() + (opts.probeBudgetMs || 15000);
    var y = 0;
    try {
      while (Date.now() < deadline) {
        var max = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) - window.innerHeight;
        if (y > max) break;
        window.scrollTo(0, y);
        await wait(opts.stepMs || 140);
        y += step;
      }
      var bottom = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) - window.innerHeight;
      if (bottom > 0) window.scrollTo(0, bottom);
      await wait(opts.settleMs || 700);
    } finally {
      observer.disconnect();
    }
    var revealed = new Map();
    changed.forEach(function (_, el) {
      try {
        var cs = getComputedStyle(el);
        revealed.set(el, { opacity: cs.opacity, transform: cs.transform, visibility: cs.visibility, className: typeof el.className === "string" ? el.className : null });
      } catch (e) { /* detached */ }
    });
    window.scrollTo(0, 0);
    await wait(opts.settleMs || 700);
    return { hints: hints, revealed: revealed, origin: origin, timedOut: Date.now() >= deadline };
  }

  /**
   * Wait until the page has finished loading what it is going to load:
   * the load event, web fonts, and a quiet network (no new resource requests
   * for `quietMs`). Content that arrives late — fonts, lazy images, data
   * fetched by scripts — would otherwise be missing or measured at the wrong size.
   */
  async function waitForIdle(opts) {
    var budget = opts.idleBudgetMs || 10000;
    var quietMs = opts.quietMs || 600;
    var started = Date.now();
    if (document.readyState !== "complete") {
      await new Promise(function (r) { window.addEventListener("load", r, { once: true }); setTimeout(r, budget); });
    }
    try { await Promise.race([document.fonts.ready, wait(budget)]); } catch (e) { /* no FontFaceSet */ }
    var lastActivity = Date.now();
    var observer = null;
    try {
      observer = new PerformanceObserver(function () { lastActivity = Date.now(); });
      observer.observe({ type: "resource", buffered: false });
    } catch (e) { observer = null; }
    while (Date.now() - started < budget && Date.now() - lastActivity < quietMs) await wait(100);
    if (observer) observer.disconnect();
    var pending = Array.prototype.filter.call(document.images, function (img) { return !img.complete && img.loading !== "lazy"; });
    if (pending.length) {
      await Promise.race([
        Promise.all(pending.map(function (img) { return img.decode ? img.decode().catch(function () {}) : null; })),
        wait(Math.max(0, budget - (Date.now() - started))),
      ]);
    }
    return Date.now() - started;
  }

  async function capture(options) {
    var started = Date.now();
    var opts = options || {};
    var maxNodes = Math.max(50, Math.min(20000, opts.maxNodes || 5000));
    var warnings = [];
    var doc = document;
    var resolveColor = makeColorResolver(doc);

    // ── scope ──
    var rootEl = null;
    var scope = opts.scope || "page";
    if (scope === "selection") {
      rootEl = doc.querySelector("[" + PICK_ATTR + "]");
      if (!rootEl) throw new Error("No element is picked on this page. Use \"Pick element\" in the extension popup (or browser_pick) first, or capture with scope \"page\".");
    } else if (scope === "selector") {
      if (!opts.selector) throw new Error("scope \"selector\" needs a CSS selector.");
      try { rootEl = doc.querySelector(opts.selector); } catch (e) { throw new Error("Invalid CSS selector \"" + opts.selector + "\": " + describeError(e)); }
      if (!rootEl) throw new Error("No element matches the selector \"" + opts.selector + "\" on " + location.href + ".");
    } else {
      rootEl = doc.body || doc.documentElement;
    }

    // ── wait for the page to finish loading ──
    var idleMs = await waitForIdle(opts);

    // ── probe ──
    var probe = null;
    if (opts.autoScroll !== false && scope === "page") {
      try { probe = await scrollProbe(opts); } catch (e) { warnings.push("Scroll probe failed: " + describeError(e)); }
      if (probe && probe.timedOut) warnings.push("Scroll probe hit its time budget before reaching the bottom; content further down may not have loaded.");
      // Scrolling triggers lazy loads; let them finish before measuring.
      idleMs += await waitForIdle({ idleBudgetMs: 6000, quietMs: 500 });
      var pending = Array.prototype.filter.call(rootEl.querySelectorAll("img"), function (img) { return !img.complete; });
      if (pending.length) {
        await Promise.race([
          Promise.all(pending.map(function (img) { return img.decode ? img.decode().catch(function () {}) : null; })),
          wait(2500),
        ]);
      }
    } else {
      try { await (doc.fonts && doc.fonts.ready); } catch (e) { /* ignore */ }
    }

    var scrollX = window.scrollX, scrollY = window.scrollY;
    var nodes = [];
    var styleIndex = Object.create(null);
    var styles = [];
    var ids = new Map();
    var truncated = false;

    var colorCounter = new Counter();
    var patternsExpanded = 0;
    var gradientCounter = new Counter();
    var typeCounter = new Counter();
    var spacingCounter = new Counter();
    var radiusCounter = new Counter();
    var shadowCounter = new Counter();
    var blurCounter = new Counter();

    function idOf(el) { return el && ids.get(el) || null; }

    /** The element, or its closest captured ancestor (SVG internals are not nodes). */
    function nearestId(el) {
      for (var e = el; e; e = e.parentElement || (e.getRootNode && e.getRootNode().host) || null) {
        var id = ids.get(e);
        if (id) return id;
      }
      return null;
    }

    function internStyle(obj) {
      var key = JSON.stringify(obj);
      var i = styleIndex[key];
      if (i === undefined) { i = styleIndex[key] = styles.length; styles.push(obj); }
      return i;
    }

    function readRaw(cs) {
      var raw = {};
      for (var i = 0; i < PROPS.length; i++) raw[PROPS[i]] = cs.getPropertyValue(PROPS[i]);
      return raw;
    }

    function countColor(value, prop) {
      if (!value || value === "none" || value === "transparent" || value === "currentcolor") return;
      var c = resolveColor(value);
      if (!c || c.alpha === 0) return;
      var key = c.hex + (c.alpha < 1 ? "@" + c.alpha : "");
      colorCounter.add(key, function (e) {
        e.hex = c.hex; e.alpha = c.alpha;
        if (c.source) e.source = c.source;
        e.props = e.props || {};
        e.props[prop] = (e.props[prop] || 0) + 1;
      });
    }

    function collectTokens(raw, pruned, hasText, isSvg, sample) {
      if (hasText) countColor(raw["color"], "text");
      countColor(raw["background-color"], "background");
      ["top", "right", "bottom", "left"].forEach(function (side) {
        if (pruned["border-" + side + "-color"]) countColor(raw["border-" + side + "-color"], "border");
      });
      if (pruned["outline-color"]) countColor(raw["outline-color"], "outline");
      if (isSvg) { countColor(pruned["fill"], "fill"); countColor(pruned["stroke"], "stroke"); }
      var bgImg = raw["background-image"];
      if (bgImg && bgImg !== "none" && /gradient\(/.test(bgImg)) {
        gradientCounter.add(bgImg);
        colorsIn(bgImg).forEach(function (c) { countColor(c, "gradient"); });
      }
      if (pruned["box-shadow"]) {
        shadowCounter.add(raw["box-shadow"]);
        colorsIn(raw["box-shadow"]).forEach(function (c) { countColor(c, "shadow"); });
      }
      if (pruned["text-shadow"]) {
        shadowCounter.add("text: " + raw["text-shadow"]);
      }
      [["filter", raw["filter"]], ["backdrop-filter", raw["backdrop-filter"]]].forEach(function (f) {
        var m = /blur\(([^)]+)\)/.exec(f[1] || "");
        if (m) blurCounter.add(f[0] + ": " + m[1]);
      });
      ["padding-top", "padding-right", "padding-bottom", "padding-left", "row-gap", "column-gap",
        "margin-top", "margin-right", "margin-bottom", "margin-left"].forEach(function (p) {
        var n = px(pruned[p]);
        if (n !== null && n > 0) spacingCounter.add(String(round(n)), function (e) { e.value = round(n); });
      });
      ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"].forEach(function (p) {
        var n = px(String(pruned[p] || "").split(" ")[0]);
        if (n !== null && n > 0) radiusCounter.add(String(round(n)), function (e) { e.value = round(n); });
      });
      if (hasText) {
        var fs = px(raw["font-size"]);
        var lh = raw["line-height"];
        var ls = raw["letter-spacing"] === "normal" ? 0 : px(raw["letter-spacing"]);
        var t = {
          fontFamily: primaryFamily(raw["font-family"]),
          fontSize: fs,
          fontWeight: parseInt(raw["font-weight"], 10) || null,
          lineHeight: lh === "normal" ? "normal" : (px(lh) !== null ? round(px(lh)) + "px" : lh),
          letterSpacing: ls === null ? null : round(ls, 3),
          fontStyle: raw["font-style"] === "normal" ? undefined : raw["font-style"],
          textTransform: raw["text-transform"] === "none" ? undefined : raw["text-transform"],
        };
        var key = [t.fontFamily, t.fontSize, t.fontWeight, t.lineHeight, t.letterSpacing, t.fontStyle || "", t.textTransform || ""].join("|");
        typeCounter.add(key, function (e) {
          if (!e.style) { e.style = t; e.sample = sample.slice(0, 60); e.stack = raw["font-family"]; }
        });
      }
    }

    function pageRect(r) {
      return { x: round(r.left + scrollX, 1), y: round(r.top + scrollY, 1), w: round(r.width, 1), h: round(r.height, 1) };
    }

    function attrsOf(el) {
      var out = {};
      for (var i = 0; i < KEEP_ATTRS.length; i++) {
        var v = el.getAttribute(KEEP_ATTRS[i]);
        if (v !== null && v !== "") out[KEEP_ATTRS[i]] = v.length > 500 ? v.slice(0, 500) : v;
      }
      if (out.href && el.href && typeof el.href === "string") out.href = el.href;
      var dataCount = 0;
      for (var j = 0; j < el.attributes.length && dataCount < 20; j++) {
        var a = el.attributes[j];
        if (a.name.indexOf("data-") === 0 && a.name !== PICK_ATTR) {
          out[a.name] = a.value.length > 200 ? a.value.slice(0, 200) : a.value;
          dataCount++;
        }
      }
      return out;
    }

    function pseudoOf(el, which) {
      var cs;
      try { cs = getComputedStyle(el, which); } catch (e) { return null; }
      var content = cs.getPropertyValue("content");
      if (!content || content === "none" || content === "normal") return null;
      if (cs.getPropertyValue("display") === "none") return null;
      var raw = readRaw(cs);
      var pruned = pruneStyle(raw, { hasText: content !== "\"\"" && content !== "''", isSvg: false, flexItem: true, gridItem: true });
      if (!pruned["color"] && raw["color"]) pruned["color"] = raw["color"];
      collectTokens(raw, pruned, false, false, "");
      return { content: content, s: internStyle(pruned) };
    }

    function mediaOf(el, tag) {
      if (tag === "IMG") {
        return { src: el.currentSrc || el.src, srcset: el.getAttribute("srcset") || undefined, alt: el.alt || "", naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, complete: el.complete };
      }
      if (tag === "VIDEO") {
        var v = { video: true, src: el.currentSrc || el.src || null, poster: el.poster || null };
        // The frame the page is showing right now: what a design of this page shows.
        // A cross-origin video without CORS taints the canvas; then only the poster is available.
        try {
          if (el.readyState >= 2 && el.videoWidth) {
            var vw = Math.min(el.videoWidth, 1920), vh = Math.round(el.videoHeight * vw / el.videoWidth);
            var cv = doc.createElement("canvas");
            cv.width = vw; cv.height = vh;
            cv.getContext("2d").drawImage(el, 0, 0, vw, vh);
            v.frame = cv.toDataURL("image/jpeg", 0.85);
            v.naturalWidth = vw; v.naturalHeight = vh;
          }
        } catch (e) { /* tainted canvas: poster only */ }
        return v;
      }
      if (tag === "IFRAME") return { iframe: true, src: el.src || null };
      if (tag === "CANVAS") return { canvas: true };
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        var type = (el.getAttribute("type") || "").toLowerCase();
        var f = { field: tag.toLowerCase(), type: type || undefined, placeholder: el.placeholder || undefined };
        // Never capture what someone typed into a password field.
        if (type !== "password" && tag !== "SELECT") f.value = el.value ? String(el.value).slice(0, 200) : undefined;
        if (tag === "SELECT" && el.selectedOptions && el.selectedOptions[0]) f.value = el.selectedOptions[0].textContent.trim().slice(0, 200);
        if (type === "checkbox" || type === "radio") f.checked = !!el.checked;
        return f;
      }
      return null;
    }

    function backgroundUrls(value) {
      var out = [];
      if (!value || value === "none") return out;
      var re = /url\((['"]?)([^'")]+)\1\)/g;
      var m;
      while ((m = re.exec(value))) {
        try { out.push(new URL(m[2], doc.baseURI).href); } catch (e) { out.push(m[2]); }
      }
      return out;
    }

    // ── walk ──
    function visit(el, parentId, parentDisplay) {
      if (nodes.length >= maxNodes) { truncated = true; return null; }
      var tag = el.tagName;
      if (!tag || SKIP_TAGS[tag]) return null;
      if (tag === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "hidden") return null;
      var cs = getComputedStyle(el);
      if (cs.display === "none") return null;
      // Not rendered even though it has a box: content of a closed <details>,
      // content-visibility:hidden, a hidden slot. Chrome reports sizes for these.
      if (typeof el.checkVisibility === "function" && !el.checkVisibility({ contentVisibilityAuto: false })) return null;

      var r = el.getBoundingClientRect();
      var isSvgRoot = tag.toLowerCase() === "svg";
      var raw = readRaw(cs);

      // direct text runs
      var runs = [];
      var directText = "";
      var hasElementKids = false;
      var childList = renderedChildren(el);
      for (var ci = 0; ci < childList.length; ci++) {
        var c = childList[ci];
        if (c.nodeType === 3) {
          var t = normalizeText(c.nodeValue, raw["white-space"]);
          if (t.trim()) { runs.push({ text: t }); directText += t; }
        } else if (c.nodeType === 1 && c.tagName === "BR") {
          if (directText) { runs.push({ text: "\n" }); directText += "\n"; }
        } else if (c.nodeType === 1) {
          hasElementKids = true;
        }
      }
      var hasText = !!directText.trim() || tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON";

      var ctx = {
        hasText: hasText,
        isSvg: isSvgRoot,
        flexItem: /flex/.test(parentDisplay || ""),
        gridItem: /grid/.test(parentDisplay || ""),
      };
      var pruned = pruneStyle(raw, ctx);
      var node = {
        id: "n" + (nodes.length + 1),
        parent: parentId,
        tag: tag.toLowerCase(),
        rect: pageRect(r),
        s: internStyle(pruned),
      };
      ids.set(el, node.id);
      nodes.push(node);

      var attrs = attrsOf(el);
      if (Object.keys(attrs).length) node.attrs = attrs;
      if (hasText && directText.trim()) {
        node.text = directText.split("\n").map(function (line) { return normalizeText(line, raw["white-space"]).trim(); }).join("\n").trim();
        // The lines exactly as the browser broke them, for wrapping Figma
        // cannot reproduce (text-wrap: balance, hyphenation, kerning edge cases).
        var lh = px(raw["line-height"]) || (px(raw["font-size"]) || 16) * 1.2;
        if (r.height > lh * 1.5) {
          var lines = lineTexts(el);
          if (lines && lines.length > 1) node.lines = lines;
        }
      }
      if (cs.position === "fixed") node.fixed = true;
      if (cs.position === "sticky") node.sticky = true;
      if (cs.visibility === "hidden") node.hidden = true;
      var media = mediaOf(el, tag);
      if (media) node.media = media;
      var bgUrls = backgroundUrls(raw["background-image"]);
      if (bgUrls.length) node.backgroundImages = bgUrls;
      if (el.shadowRoot) node.shadowRoot = true;

      collectTokens(raw, pruned, hasText, isSvgRoot, directText.trim());

      var before = pseudoOf(el, "::before");
      var after = pseudoOf(el, "::after");
      if (before || after) node.pseudo = { before: before || undefined, after: after || undefined };

      var hint = scrollHintFor(el, attrs);
      if (hint) node.scrollHint = hint;
      if (probe && probe.revealed.has(el)) node.revealed = probe.revealed.get(el);

      if (isSvgRoot) {
        var svg = svgWithComputedPaint(el);
        var SVG_LIMIT = 1500000;
        node.svg = svg.length > SVG_LIMIT ? null : svg;
        if (svg.length > SVG_LIMIT) warnings.push("SVG " + node.id + " is " + Math.round(svg.length / 1024) + "KB and was not inlined.");
        return node;
      }

      if (hasElementKids || runs.length) {
        var kids = [];
        var mixed = [];
        for (var ki = 0; ki < childList.length; ki++) {
          var k = childList[ki];
          if (k.nodeType === 3) {
            var tt = normalizeText(k.nodeValue, raw["white-space"]);
            if (tt.trim() && runs.length) mixed.push({ text: tt });
          } else if (k.nodeType === 1 && k.tagName === "BR") {
            if (runs.length) mixed.push({ text: "\n" });
          } else if (k.nodeType === 1) {
            var childNode = visit(k, node.id, raw["display"]);
            if (childNode) {
              kids.push(childNode.id);
              if (runs.length) mixed.push({ node: childNode.id });
            }
          }
        }
        if (kids.length) node.children = kids;
        // Text that sits beside element children (a label next to an icon, text
        // after a block <b>): record where each piece is drawn, so it can be
        // placed there instead of over the whole element.
        if (runs.length && kids.length) {
          var pieces = [];
          var rg = document.createRange();
          for (var pi = 0; pi < childList.length && pieces.length < 20; pi++) {
            var pc = childList[pi];
            if (pc.nodeType !== 3) continue;
            var ptxt = normalizeText(pc.nodeValue, raw["white-space"]).trim();
            if (!ptxt) continue;
            rg.selectNodeContents(pc);
            var pr = rg.getBoundingClientRect();
            if (pr.width > 0 && pr.height > 0) pieces.push({ text: ptxt, rect: pageRect(pr) });
          }
          if (pieces.length) node.textPieces = pieces;
        }
        // Mixed inline content (text interleaved with <strong>, <a>…) is kept in order,
        // so the importer can build one rich text layer instead of loose fragments.
        if (runs.length && kids.length && mixed.length > 1) {
          var allInline = kids.every(function (id) {
            var n = nodes[parseInt(id.slice(1), 10) - 1];
            return INLINE_DISPLAYS[styles[n.s]["display"] || "inline"] || !styles[n.s]["display"];
          });
          if (allInline) node.runs = mixed;
        }
      }
      return node;
    }

    /**
     * The text of each rendered line, by measuring where each word sits.
     * Words whose top moves down by more than half a line start a new line.
     */
    function lineTexts(el) {
      var lines = [];
      var currentTop = null;
      var current = "";
      var range = document.createRange();
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var count = 0;
      for (var tn = walker.nextNode(); tn; tn = walker.nextNode()) {
        var text = tn.nodeValue;
        var re = /\S+/g;
        var m;
        while ((m = re.exec(text))) {
          if (++count > 400) return null;
          range.setStart(tn, m.index);
          range.setEnd(tn, m.index + m[0].length);
          var rects = range.getClientRects();
          if (!rects.length) continue;
          var top = rects[0].top;
          if (currentTop === null || top > currentTop + rects[0].height * 0.5) {
            if (current) lines.push(current);
            current = m[0];
            currentTop = top;
          } else {
            current += " " + m[0];
          }
        }
      }
      if (current) lines.push(current);
      return lines;
    }

    /**
     * Replace each `fill="url(#pattern)"` with real tiled shapes.
     * Figma's SVG import flattens <pattern> paint to an empty rectangle, so a
     * dot field drawn with a pattern disappears. The tiles are generated from the
     * pattern's own content over the filled element's bounding box, in the same
     * user space; the original element keeps its stroke but loses the fill.
     */
    /** The part of an <svg>'s viewBox that is on screen, in its user units (null when it has no viewBox). */
    function visibleUserRect(svgEl) {
      var vb = svgEl.viewBox && svgEl.viewBox.baseVal;
      if (!vb || !vb.width || !vb.height) return null;
      var r = svgEl.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      var par = (svgEl.getAttribute("preserveAspectRatio") || "xMidYMid meet").trim();
      if (par.indexOf("none") === 0) return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
      var slice = /slice/.test(par);
      var s = slice ? Math.max(r.width / vb.width, r.height / vb.height) : Math.min(r.width / vb.width, r.height / vb.height);
      var w = r.width / s, h = r.height / s;
      var ax = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5;
      var ay = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
      return { x: vb.x + (vb.width - w) * ax, y: vb.y + (vb.height - h) * ay, width: w, height: h };
    }

    function expandPatterns(srcList, dstList, clone) {
      var MAX_TILES = 6000;
      var SVGNS = "http://www.w3.org/2000/svg";
      for (var i = 0; i < dstList.length; i++) {
        var el = dstList[i];
        var fill = el.getAttribute && el.getAttribute("fill");
        var m = fill && /^url\(#([^)]+)\)$/.exec(fill.trim());
        if (!m) continue;
        var pattern = null;
        try { pattern = clone.querySelector("pattern#" + CSS.escape(m[1])); } catch (e) { pattern = null; }
        if (!pattern) continue;
        var box;
        try { box = srcList[i].getBBox(); } catch (e) { continue; }
        if (!box || box.width <= 0 || box.height <= 0) continue;
        var bbUnits = (pattern.getAttribute("patternUnits") || "objectBoundingBox") === "objectBoundingBox";
        var num = function (attr, dflt) {
          var raw = pattern.getAttribute(attr);
          if (raw === null || raw === "") return dflt;
          var v = parseFloat(raw);
          return /%$/.test(raw) ? v / 100 : v;
        };
        var pw = num("width", 0), ph = num("height", 0), px0 = num("x", 0), py0 = num("y", 0);
        if (bbUnits) { pw *= box.width; ph *= box.height; px0 = box.x + px0 * box.width; py0 = box.y + py0 * box.height; }
        if (!(pw > 0 && ph > 0)) continue;
        // Tile only what the SVG viewport shows: with preserveAspectRatio "slice"
        // most of a full-viewBox pattern is cropped out of view.
        var vis = visibleUserRect(srcList[0]);
        if (vis) {
          var ix1 = Math.max(box.x, vis.x), iy1 = Math.max(box.y, vis.y);
          var ix2 = Math.min(box.x + box.width, vis.x + vis.width), iy2 = Math.min(box.y + box.height, vis.y + vis.height);
          if (ix2 <= ix1 || iy2 <= iy1) continue;
          box = { x: ix1, y: iy1, width: ix2 - ix1, height: iy2 - iy1 };
        }
        var c0 = Math.floor((box.x - px0) / pw), c1 = Math.ceil((box.x + box.width - px0) / pw);
        var r0 = Math.floor((box.y - py0) / ph), r1 = Math.ceil((box.y + box.height - py0) / ph);
        if ((c1 - c0) * (r1 - r0) > MAX_TILES) { warnings.push("SVG pattern #" + m[1] + " has " + (c1 - c0) * (r1 - r0) + " tiles; not expanded."); continue; }
        var content = Array.prototype.filter.call(pattern.childNodes, function (k) { return k.nodeType === 1; });
        if (!content.length) continue;
        var group = clone.ownerDocument.createElementNS(SVGNS, "g");
        group.setAttribute("data-pattern", m[1]);
        ["opacity", "fill-opacity", "transform"].forEach(function (a) { var v = el.getAttribute(a); if (v) group.setAttribute(a, v); });
        var transform = pattern.getAttribute("patternTransform");
        if (transform) group.setAttribute("transform", (group.getAttribute("transform") || "") + " " + transform);
        for (var r = r0; r < r1; r++) {
          for (var c = c0; c < c1; c++) {
            var tile = clone.ownerDocument.createElementNS(SVGNS, "g");
            tile.setAttribute("transform", "translate(" + (px0 + c * pw) + " " + (py0 + r * ph) + ")");
            for (var k = 0; k < content.length; k++) tile.appendChild(content[k].cloneNode(true));
            group.appendChild(tile);
          }
        }
        el.parentNode.insertBefore(group, el.nextSibling);
        el.setAttribute("fill", "none");
        patternsExpanded++;
      }
    }

    /**
     * The SVG's markup with its CSS-applied paint written onto each element.
     * Fills set by a stylesheet (`.wave path { fill: #fff }`) are not in the
     * markup; without this, Figma draws them in its default black.
     */
    function svgWithComputedPaint(svgEl) {
      var clone = svgEl.cloneNode(true);
      var src = [svgEl].concat(Array.prototype.slice.call(svgEl.querySelectorAll("*")));
      var dst = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll("*")));
      var PAINT = ["fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "stop-color", "stop-opacity"];
      var INHERITED = { "fill": 1, "stroke": 1, "stroke-width": 1, "fill-opacity": 1, "stroke-opacity": 1 };
      var computed = new Map();
      for (var i = 0; i < src.length && i < dst.length; i++) {
        var tag = src[i].tagName && src[i].tagName.toLowerCase();
        if (!tag || tag === "style" || tag === "script" || tag === "defs" || tag === "title") continue;
        var s;
        try { s = getComputedStyle(src[i]); } catch (e) { continue; }
        computed.set(src[i], s);
        var parentStyle = i > 0 ? computed.get(src[i].parentNode) : null;
        var strokeVisible = s.getPropertyValue("stroke") !== "none" && !/rgba\([^)]*,\s*0\)$/.test(s.getPropertyValue("stroke"));
        for (var p = 0; p < PAINT.length; p++) {
          var prop = PAINT[p];
          if ((prop === "stop-color" || prop === "stop-opacity") !== (tag === "stop")) continue;
          var v = s.getPropertyValue(prop);
          if (!v) continue;
          // Only what changes the drawing: a value the parent already passes
          // down, a default, or a width for an invisible stroke is left out,
          // which keeps a 600-tile dot field small.
          if (INHERITED[prop] && parentStyle && parentStyle.getPropertyValue(prop) === v && !dst[i].hasAttribute(prop)) continue;
          if ((prop === "opacity" || prop === "fill-opacity" || prop === "stroke-opacity" || prop === "stop-opacity") && v === "1") continue;
          if ((prop === "stroke" || prop === "stroke-width") && !strokeVisible) continue;
          if (prop === "fill" || prop === "stroke" || prop === "stop-color") {
            if (/^\s*url\(/i.test(v)) {
              // Keep the paint server reference, local to the markup: url("#id").
              v = v.replace(/url\((['"]?)[^#'")]*#([^'")]+)\1\)/, 'url(#$2)');
            } else {
              var c = resolveColor(v);
              if (!c) continue;
              v = c.alpha < 1 ? "rgba(" + parseInt(c.hex.slice(1, 3), 16) + "," + parseInt(c.hex.slice(3, 5), 16) + "," + parseInt(c.hex.slice(5, 7), 16) + "," + c.alpha + ")" : c.hex;
            }
          }
          dst[i].setAttribute(prop, v);
        }
      }
      expandPatterns(src, dst, clone);
      clone.removeAttribute("class");
      clone.setAttribute("width", String(Math.round(svgEl.getBoundingClientRect().width)));
      clone.setAttribute("height", String(Math.round(svgEl.getBoundingClientRect().height)));
      return clone.outerHTML;
    }

    /**
     * What the browser renders under an element: the shadow tree when there is
     * one, a slot's assigned nodes in place of the slot's fallback content.
     */
    function renderedChildren(el) {
      if (el.tagName === "SLOT" && typeof el.assignedNodes === "function") {
        var assigned = el.assignedNodes({ flatten: true });
        if (assigned.length) return assigned;
      }
      var host = el.shadowRoot && el.shadowRoot.childNodes.length ? el.shadowRoot : el;
      return Array.prototype.slice.call(host.childNodes);
    }

    function scrollHintFor(el, attrs) {
      var hint = null;
      Object.keys(attrs).forEach(function (a) {
        if (SCROLL_ATTR_RE.test(a)) { hint = hint || {}; hint[a] = attrs[a]; }
      });
      var cls = typeof el.className === "string" ? el.className : "";
      var m = SCROLL_CLASS_RE.exec(cls);
      if (m) { hint = hint || {}; hint.class = m[2]; }
      return hint;
    }

    var rootParentDisplay = rootEl.parentElement ? getComputedStyle(rootEl.parentElement).display : "block";
    visit(rootEl, null, rootParentDisplay);
    if (truncated) warnings.push("Stopped at " + maxNodes + " elements (maxNodes). Capture a section with scope \"selector\" or raise maxNodes for the rest.");

    // context background for partial captures: what the section sits on
    var contextBackground = null;
    if (scope !== "page") {
      for (var p = rootEl.parentElement; p; p = p.parentElement) {
        var bg = getComputedStyle(p).backgroundColor;
        var pc = resolveColor(bg);
        if (pc && pc.alpha > 0) { contextBackground = pc.hex + (pc.alpha < 1 ? "@" + pc.alpha : ""); break; }
      }
    }

    // ── stylesheets ──
    // A stylesheet that failed to load (network error, blocked CDN, rate limit)
    // leaves the page unstyled: CSS variables undefined, default 8px margins.
    // Building that would silently be wrong, so it is the first warning.
    var fetchedOk = Object.create(null);
    (opts.extraSheets || []).forEach(function (x) { fetchedOk[x.href] = 1; });
    var failedSheets = Array.prototype.filter.call(doc.querySelectorAll('link[rel~="stylesheet"]'), function (l) {
      if (l.disabled || /print/.test(l.media || "") || !l.href) return false;
      if (!l.sheet) return true;
      var entry = performance.getEntriesByName(l.href)[0];
      if (entry && entry.responseStatus >= 400) return true;
      var readable = true;
      try { void l.sheet.cssRules; } catch (e) { readable = false; }
      // Unreadable, never seen by the network log, and not fetched by the
      // extension either: it did not load. (A cross-origin sheet that did load
      // has a network entry, or was fetched for its rules.)
      return !readable && !entry && !fetchedOk[l.href];
    }).map(function (l) { return l.href; });
    if (failedSheets.length) {
      warnings.unshift("PAGE NOT FULLY STYLED: " + failedSheets.length + " stylesheet(s) did not load (" + failedSheets.slice(0, 3).join(", ") +
        "). Reload the page, wait for it to finish loading, then capture again.");
    }
    var sheet = scanStylesheets(opts.extraSheets, warnings);
    var rootCs = getComputedStyle(doc.documentElement);
    var seenVar = Object.create(null);
    var cssVariables = [];
    sheet.vars.forEach(function (v) {
      var key = v.name + "|" + v.selector + "|" + (v.media || "");
      if (seenVar[key]) return;
      seenVar[key] = 1;
      var entry = { name: v.name, value: v.value, selector: v.selector };
      if (v.media) entry.media = v.media;
      if (/^(:root|html|body|\*)\b/.test(v.selector.trim()) || /(^|,\s*)(:root|html)\b/.test(v.selector)) {
        var resolved = rootCs.getPropertyValue(v.name).trim();
        if (resolved && resolved !== v.value) entry.resolved = resolved;
        var col = resolved || v.value;
        var asColor = /^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/i.test(col) ? resolveColor(col) : null;
        if (asColor) entry.hex = asColor.hex + (asColor.alpha < 1 ? "@" + asColor.alpha : "");
      }
      cssVariables.push(entry);
    });

    var interactions = [];
    sheet.interactions.forEach(function (rule) {
      var matched = [];
      if (rule.base) {
        try {
          var els = doc.querySelectorAll(rule.base);
          for (var i = 0; i < els.length && matched.length < 50; i++) {
            var id = ids.get(els[i]);
            if (id) matched.push(id);
          }
        } catch (e) { /* selectors the engine rejects once pseudo-classes are removed */ }
      }
      if (!matched.length && scope !== "page") return;
      interactions.push({ selector: rule.selector, states: rule.states, media: rule.media || undefined, declarations: rule.declarations, nodes: matched });
    });

    // ── animations ──
    var animations = [];
    var timelines = [];
    try {
      doc.getAnimations().slice(0, 400).forEach(function (a) {
        var effect = a.effect;
        var target = effect && effect.target;
        var entry = {
          type: a.constructor && a.constructor.name || "Animation",
          name: a.animationName || a.transitionProperty || a.id || null,
          node: target ? nearestId(target) : null,
          pseudo: effect && effect.pseudoElement || undefined,
          playState: a.playState,
        };
        try { entry.timing = effect ? effect.getTiming() : null; } catch (e) { entry.timing = null; }
        try { entry.keyframes = effect ? effect.getKeyframes().slice(0, 30) : []; } catch (e) { entry.keyframes = []; }
        var tl = a.timeline && a.timeline.constructor && a.timeline.constructor.name;
        if (tl && tl !== "DocumentTimeline") entry.timeline = tl;
        if (!entry.node && scope !== "page") return;
        animations.push(entry);
      });
    } catch (e) {
      warnings.push("Could not list running animations: " + describeError(e));
    }
    styles.forEach(function (st, i) {
      if (st["animation-timeline"] && st["animation-timeline"] !== "auto") timelines.push({ style: i, animationTimeline: st["animation-timeline"], animationName: st["animation-name"] || null });
    });

    var lib = detectScrollLibraries(idOf);
    // A JS-driven reveal rewrites the same inline style every frame; merge each
    // element+attribute into one hint spanning first value to last.
    var hints = [];
    if (probe) {
      var merged = new Map();
      probe.hints.forEach(function (h) {
        var node = idOf(h.el);
        if (!node) return;
        var key = node + "|" + h.attribute;
        var m = merged.get(key);
        if (!m) {
          m = { node: node, attribute: h.attribute, from: h.from, to: h.to, scrollY: h.scrollY, changes: 0 };
          merged.set(key, m);
          hints.push(m);
        }
        m.to = h.to;
        m.changes++;
      });
      hints = hints.filter(function (h) { return h.from !== h.to; }).slice(0, 1000);
    }

    // ── fonts ──
    var fonts = [];
    try {
      doc.fonts.forEach(function (f) {
        fonts.push({ family: f.family.replace(/^["']|["']$/g, ""), weight: f.weight, style: f.style, status: f.status });
      });
    } catch (e) { /* FontFaceSet not iterable in some engines */ }
    var usedFamilies = Object.create(null);
    typeCounter.sorted().forEach(function (e) { if (e.style.fontFamily) usedFamilies[e.style.fontFamily.toLowerCase()] = 1; });
    // A family is usually split into unicode-range subsets, and the unused ones
    // stay "unloaded" by design. Only a family with no loaded face at all is missing.
    var loadedFamilies = Object.create(null);
    fonts.forEach(function (f) { if (f.status === "loaded") loadedFamilies[f.family.toLowerCase()] = 1; });
    var notLoaded = [];
    fonts.forEach(function (f) {
      var k = f.family.toLowerCase();
      if (usedFamilies[k] && !loadedFamilies[k] && notLoaded.indexOf(f.family) === -1) notLoaded.push(f.family);
    });
    if (notLoaded.length) warnings.push("Fonts used on the page but not loaded at capture time: " + notLoaded.slice(0, 8).join(", "));

    // ── restore ──
    if (probe) window.scrollTo(probe.origin.x, probe.origin.y);

    var keyframes = sheet.keyframes;
    if (scope !== "page") {
      var usedNames = Object.create(null);
      styles.forEach(function (st) { (st["animation-name"] || "").split(",").forEach(function (n) { usedNames[n.trim()] = 1; }); });
      keyframes = keyframes.filter(function (k) { return usedNames[k.name]; });
    }

    var breakpoints = Object.keys(sheet.breakpoints).map(function (k) { return sheet.breakpoints[k]; });
    breakpoints.sort(function (a, b) { return (a.minWidth || a.maxWidth || 0) - (b.minWidth || b.maxWidth || 0); });

    return {
      schema: SCHEMA,
      version: VERSION,
      extractorBuild: EXTRACTOR_BUILD,
      capturedAt: new Date().toISOString(),
      url: location.href,
      title: doc.title,
      lang: doc.documentElement.lang || null,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      page: { width: doc.documentElement.scrollWidth, height: doc.documentElement.scrollHeight },
      scope: { kind: scope, selector: opts.selector || null, root: nodes.length ? nodes[0].id : null, contextBackground: contextBackground },
      nodes: nodes,
      styles: styles,
      tokens: {
        colors: colorCounter.sorted(200).map(function (e) { var o = { hex: e.hex, alpha: e.alpha, count: e.count, usage: e.props }; if (e.source) o.source = e.source; return o; }),
        gradients: gradientCounter.sorted(60).map(function (e) { return { value: e.key, count: e.count }; }),
        typography: typeCounter.sorted(80).map(function (e) {
          var o = { fontFamily: e.style.fontFamily, fontSize: e.style.fontSize, fontWeight: e.style.fontWeight, lineHeight: e.style.lineHeight, letterSpacing: e.style.letterSpacing, count: e.count, sample: e.sample, stack: e.stack };
          if (e.style.fontStyle) o.fontStyle = e.style.fontStyle;
          if (e.style.textTransform) o.textTransform = e.style.textTransform;
          return o;
        }),
        spacing: spacingCounter.sorted(60).map(function (e) { return { value: e.value, count: e.count }; }),
        radii: radiusCounter.sorted(30).map(function (e) { return { value: e.value, count: e.count }; }),
        shadows: shadowCounter.sorted(40).map(function (e) { return { value: e.key, count: e.count }; }),
        blurs: blurCounter.sorted(20).map(function (e) { return { value: e.key, count: e.count }; }),
      },
      cssVariables: cssVariables,
      fonts: fonts,
      fontFaces: sheet.fontFaces.slice(0, 100),
      breakpoints: breakpoints,
      interactions: interactions,
      keyframes: keyframes,
      animations: animations,
      scroll: { libraries: lib.libraries, triggers: lib.triggers, hints: hints, timelines: timelines, probed: !!probe },
      warnings: warnings,
      stats: {
        nodes: nodes.length,
        styles: styles.length,
        truncated: truncated,
        elapsedMs: Date.now() - started,
        waitedForIdleMs: idleMs,
        svgPatternsExpanded: patternsExpanded,
        stylesheets: { readable: sheet.readable, fetched: sheet.fetched, unreadable: sheet.unreadable.length },
      },
    };
  }

  var api = {
    SCHEMA: SCHEMA,
    VERSION: VERSION,
    EXTRACTOR_BUILD: EXTRACTOR_BUILD,
    PICK_ATTR: PICK_ATTR,
    capture: capture,
    listUnreadableSheets: listUnreadableSheets,
    // pure helpers
    parseColor: parseColor,
    colorsIn: colorsIn,
    primaryFamily: primaryFamily,
    pruneStyle: pruneStyle,
    normalizeText: normalizeText,
    baseSelector: baseSelector,
    interactionState: interactionState,
    breakpointOf: breakpointOf,
    parseCssText: parseCssText,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.__webToFigma = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
