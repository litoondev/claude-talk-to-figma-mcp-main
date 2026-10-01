// Evaluated in a headless Chrome page by chrome-harness.mjs (W2F_EVAL).
// Loads the extension's background.js with a stub `chrome`, then runs its
// image conversion on a real WebP and a real SVG, as it would for Figma.
(async () => {
  const on = () => ({ addListener() {}, removeListener() {} });
  window.chrome = {
    runtime: { getManifest: () => ({ version: "test" }), sendMessage: () => Promise.resolve(), onMessage: on(), onStartup: on(), onInstalled: on() },
    action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
    storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: { onUpdated: on(), onRemoved: on() },
    alarms: { create() {}, onAlarm: on() },
  };
  window.importScripts = () => { window.__webToFigma = { SCHEMA: "web-to-figma/capture" }; };
  const src = window.__BG_SOURCE;
  (0, eval)(src);

  // A 300×200 WebP with transparency, made by Chrome itself.
  const c = document.createElement("canvas");
  c.width = 300; c.height = 200;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(249,115,22,0.8)"; g.fillRect(0, 0, 300, 200);
  const webp = c.toDataURL("image/webp", 0.9);
  const svg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>');

  g.clearRect(0, 0, 300, 200);
  g.fillStyle = "rgb(20,40,60)"; g.fillRect(0, 0, 300, 200);
  const opaqueWebp = c.toDataURL("image/webp", 0.9);

  const head = (r) => atob(r.base64.slice(0, 16)).split("").slice(0, 4).map((ch) => ch.charCodeAt(0));
  const out = {};
  const r1 = await fetchForFigma({ src: webp, width: 100, height: 60 });
  out.webp = { kind: r1.kind, mime: r1.mime, width: r1.width, height: r1.height, head: head(r1) };
  const r0 = await fetchForFigma({ src: opaqueWebp, width: 300, height: 200 });
  out.opaqueWebp = { mime: r0.mime, width: r0.width, head: head(r0) };
  const r2 = await fetchForFigma({ src: svg });
  out.svg = { kind: r2.kind, starts: r2.svg.slice(0, 4) };
  try { await fetchForFigma({ src: "data:text/plain,hello" }); out.bad = "no error"; } catch (e) { out.bad = String(e.message || e); }
  return JSON.stringify(out);
})()
