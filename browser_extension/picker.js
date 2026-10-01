/**
 * Web-to-Figma element picker.
 *
 * Injected into the page (isolated world) on demand. Highlights the element
 * under the pointer; click picks it, ↑ widens to the parent, ↓ narrows back,
 * Esc cancels. The pick is marked on the DOM with `data-web-to-figma-picked`,
 * because the extractor runs in the page's MAIN world and cannot see this
 * script's variables — the DOM is the one thing both worlds share.
 */
(function () {
  "use strict";
  var ATTR = "data-web-to-figma-picked";
  if (window.__webToFigmaPicker) window.__webToFigmaPicker.stop();

  var box = document.createElement("div");
  var label = document.createElement("div");
  var Z = "2147483647";
  box.style.cssText = "position:fixed;pointer-events:none;z-index:" + Z + ";border:2px solid #f97316;background:rgba(249,115,22,.12);border-radius:2px;transition:all .05s;display:none";
  label.style.cssText = "position:fixed;pointer-events:none;z-index:" + Z + ";background:#111827;color:#fff;font:12px/1.4 -apple-system,system-ui,sans-serif;padding:3px 7px;border-radius:4px;white-space:nowrap;display:none";
  document.documentElement.appendChild(box);
  document.documentElement.appendChild(label);

  var current = null;
  var stack = [];

  function describe(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    var cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (cls.length) s += "." + cls.join(".");
    return s;
  }

  function show(el) {
    current = el;
    var r = el.getBoundingClientRect();
    box.style.display = label.style.display = "block";
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    label.textContent = describe(el) + "  " + Math.round(r.width) + "×" + Math.round(r.height) + "   click to pick · ↑ parent · Esc cancel";
    label.style.left = Math.max(4, r.left) + "px";
    label.style.top = (r.top > 26 ? r.top - 24 : r.bottom + 4) + "px";
  }

  function onMove(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box || el === label) return;
    stack = [];
    show(el);
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); finish(null); }
    else if (e.key === "ArrowUp" && current && current.parentElement && current.parentElement !== document.documentElement) {
      e.preventDefault(); stack.push(current); show(current.parentElement);
    } else if (e.key === "ArrowDown" && stack.length) {
      e.preventDefault(); show(stack.pop());
    }
  }

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    swallow(e);
    if (current) finish(current);
  }

  function finish(el) {
    stop();
    var picked = null;
    if (el) {
      var prev = document.querySelectorAll("[" + ATTR + "]");
      for (var i = 0; i < prev.length; i++) prev[i].removeAttribute(ATTR);
      el.setAttribute(ATTR, "1");
      var r = el.getBoundingClientRect();
      picked = {
        label: describe(el),
        tag: el.tagName.toLowerCase(),
        rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
        text: (el.innerText || "").trim().slice(0, 80),
        url: location.href,
      };
    }
    try {
      chrome.runtime.sendMessage({ type: "picked", picked: picked });
    } catch (e) { /* extension reloaded while picking */ }
  }

  function stop() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", swallow, true);
    document.removeEventListener("mouseup", swallow, true);
    box.remove();
    label.remove();
    window.__webToFigmaPicker = null;
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mousedown", swallow, true);
  document.addEventListener("mouseup", swallow, true);
  window.__webToFigmaPicker = { stop: stop };
})();
