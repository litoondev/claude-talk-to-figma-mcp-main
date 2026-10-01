/**
 * Run the browser extension's extractor inside a real headless Chrome.
 *
 * A mocked DOM cannot answer the questions the extractor exists for — what
 * getComputedStyle returns, how oklch() resolves, whether an
 * IntersectionObserver reveal fires during the scroll probe — so this drives
 * the installed Chrome over the DevTools protocol instead.
 *
 *   node tests/fixtures/browser-capture/chrome-harness.mjs <page.html> [optsJSON] [out.json]
 *
 * Prints the capture JSON (or writes it to out.json). Exits 2 when no Chrome is
 * installed, so a test can report "skipped: no browser" rather than pass.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const chromePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error("No Chrome found (set CHROME_PATH).");
  process.exit(2);
}

const [pageArg, optsArg = "{}", outArg] = process.argv.slice(2);
if (!pageArg) {
  console.error("usage: chrome-harness.mjs <page.html|url> [optsJSON] [out.json]");
  process.exit(1);
}
const url = /^https?:|^file:/.test(pageArg) ? pageArg : pathToFileURL(path.resolve(pageArg)).href;
const opts = JSON.parse(optsArg);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "w2f-chrome-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  "--allow-file-access-from-files", "--window-size=1280,800", "about:blank",
], { stdio: "ignore" });

const cleanup = () => {
  try { chrome.kill("SIGKILL"); } catch {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
};
const hardStop = setTimeout(() => { console.error("harness timeout"); cleanup(); process.exit(3); }, 90_000);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function devtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not come up");
}

try {
  const ws = new WebSocket(await devtools());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send("Page.enable");
  // W2F_WIDTH=1440: lay the page out at that width, as the extension does with
  // Emulation.setDeviceMetricsOverride.
  if (process.env.W2F_WIDTH) {
    const width = Number(process.env.W2F_WIDTH);
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Emulation.setScrollbarsHidden", { hidden: true });
  }
  await send("Page.navigate", { url });
  for (let i = 0; i < 200 && !events.some((e) => e.method === "Page.loadEventFired"); i++) await delay(50);

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(d.exception?.description || d.text);
    }
    return r.result.result.value;
  };

  // W2F_EVAL=<file.js>: evaluate that script in the page instead of capturing.
  // It must evaluate to a Promise of a JSON string. Used to run pieces of the
  // extension (image conversion) in a real browser.
  if (process.env.W2F_EVAL) {
    // The extension's worker source, for scripts that load it into the page.
    const bg = fs.readFileSync(new URL("../../../browser_extension/background.js", import.meta.url), "utf8");
    await evaluate(`window.__BG_SOURCE = ${JSON.stringify(bg)}; true`);
    const json = await evaluate(fs.readFileSync(process.env.W2F_EVAL, "utf8"));
    if (outArg) fs.writeFileSync(outArg, json);
    else process.stdout.write(json);
    ws.close();
    clearTimeout(hardStop);
    cleanup();
    process.exit(0);
  }

  // Inject the extractor the way background.js does (MAIN world, file source),
  // unless the page already loads it itself.
  const extractorSource = fs.readFileSync(new URL("../../../browser_extension/extractor.js", import.meta.url), "utf8");
  if (!(await evaluate("!!window.__webToFigma"))) await evaluate(extractorSource + "\n;true");

  // Fetch cross-origin stylesheets the page cannot read, as background.js does.
  if (opts.extraSheets === undefined) {
    const hrefs = (await evaluate("window.__webToFigma.listUnreadableSheets()")) || [];
    opts.extraSheets = [];
    for (const href of hrefs.slice(0, 80)) {
      try {
        const r = await fetch(href);
        if (r.ok) opts.extraSheets.push({ href, css: (await r.text()).slice(0, 2_000_000) });
      } catch { /* reported by the extractor as unreadable */ }
    }
  }

  const res = await send("Runtime.evaluate", {
    expression: `window.__webToFigma.capture(${JSON.stringify(opts)}).then(r => JSON.stringify(r))`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    const d = res.result.exceptionDetails;
    throw new Error(d.exception?.description || d.text);
  }
  const json = res.result.result.value;
  if (outArg) fs.writeFileSync(outArg, json);
  else process.stdout.write(json);
  ws.close();
  clearTimeout(hardStop);
  cleanup();
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  clearTimeout(hardStop);
  cleanup();
  process.exit(1);
}
