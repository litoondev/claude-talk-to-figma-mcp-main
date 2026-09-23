#!/usr/bin/env node
/**
 * Run the Webflow extension's command table outside Webflow.
 *
 * Loads `webflow_extension/public/app.js` — the real file, not a copy — against
 * an in-memory fake Designer, joins the relay as the Webflow editor, and
 * executes whatever Claude sends. Every link in the chain is the shipping one
 * except the Designer itself:
 *
 *   Claude → MCP tool → relay (src/socket.ts) → this harness → fake Designer
 *
 * So it proves routing, the protocol, argument shapes and the command table,
 * and it needs no Webflow account, no CLI, no workspace and no Admin rights.
 * What it cannot prove is that Webflow's real API behaves as expected; only a
 * live Designer settles that.
 *
 *   node scripts/webflow-extension-harness.mjs <channel-id> [--port 3055]
 *
 * Leave it running, then drive it from Claude with the webflow_designer_* tools.
 * State persists for the life of the process, so a create followed by a read
 * behaves the way the real Designer would.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "webflow_extension", "public", "app.js");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const channel = args.find((a) => !a.startsWith("--"));
const portArg = args.indexOf("--port");
const port = portArg !== -1 ? Number(args[portArg + 1]) : 3055;

if (!channel) {
  console.error(
    "Usage: node scripts/webflow-extension-harness.mjs <channel-id> [--port 3055]\n\n" +
      "The channel ID is the one Claude prints when it calls join_channel."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A fake Designer, with enough state to be worth testing against
// ---------------------------------------------------------------------------

let nextId = 1;
const styles = [];
const elements = [];
const collections = [];
const components = [];

function makeStyle(name) {
  const style = {
    _name: name,
    _props: {},
    async getName() { return style._name; },
    async getProperties() { return style._props; },
    async setProperties(props, opts) {
      const bp = opts?.breakpoint ?? "main";
      style._props[bp] = { ...(style._props[bp] || {}), ...props };
    },
  };
  return style;
}

function makeElement(type = "DOM") {
  const el = {
    id: `el-${nextId++}`,
    type,
    children: true,
    textContent: true,
    _tag: null,
    _text: null,
    _styles: [],
    _attrs: {},
    _children: [],
    async getTag() { return el._tag; },
    async setTag(tag) { el._tag = tag; },
    async getTextContent() { return el._text; },
    async setTextContent(text) { el._text = text; },
    async getStyles() { return el._styles; },
    async setStyles(list) { el._styles = list; },
    async setCustomAttribute(k, v) { el._attrs[k] = v; },
    async getChildren() { return el._children; },
    async append(preset) { return attach(el, preset, "push"); },
    async prepend(preset) { return attach(el, preset, "unshift"); },
    async remove() {
      for (const parent of elements) {
        const i = parent._children.indexOf(el);
        if (i !== -1) parent._children.splice(i, 1);
      }
      const i = elements.indexOf(el);
      if (i !== -1) elements.splice(i, 1);
    },
  };
  elements.push(el);
  return el;
}

function attach(parent, preset, how) {
  const child = makeElement("DOM");
  child._preset = typeof preset === "string" ? preset : preset?.name || "Component";
  parent._children[how](child);
  return child;
}

const root = makeElement("DOM");
root._preset = "Body";

globalThis.webflow = {
  elementPresets: {
    DivBlock: "DivBlock", Section: "Section", BlockContainer: "BlockContainer",
    Heading: "Heading", Paragraph: "Paragraph", TextBlock: "TextBlock",
    Button: "Button", LinkBlock: "LinkBlock", Image: "Image",
    List: "List", ListItem: "ListItem", HtmlEmbed: "HtmlEmbed", FormForm: "FormForm",
  },
  async getRootElement() { return root; },
  async getAllElements() { return elements; },
  async getAllStyles() { return styles; },
  async getStyleByName(name) { return styles.find((s) => s._name === name) ?? null; },
  async createStyle(name) {
    const style = makeStyle(name);
    styles.push(style);
    return style;
  },
  async getAllVariableCollections() { return collections; },
  async createVariableCollection(name) {
    const vars = [];
    const make = (n, type, value) => {
      const v = {
        id: `var-${nextId++}`,
        type,
        async getName() { return n; },
        async get() { return value; },
        async set(next) { value = next; },
      };
      vars.push(v);
      return v;
    };
    const collection = {
      _name: name,
      _vars: vars,
      async getName() { return name; },
      async getAllVariables() { return vars; },
      async createColorVariable(n, v) { return make(n, "color", v); },
      async createSizeVariable(n, v) { return make(n, "size", v); },
      async createPercentageVariable(n, v) { return make(n, "percentage", v); },
      async createNumberVariable(n, v) { return make(n, "number", v); },
      async createFontFamilyVariable(n, v) { return make(n, "fontFamily", v); },
    };
    collections.push(collection);
    return collection;
  },
  async getCurrentPage() {
    return { id: "page-1", async getName() { return "Home (harness)"; } };
  },
  async getAllComponents() { return components; },
  async registerComponent(name) {
    const component = { id: `cmp-${nextId++}`, name };
    components.push(component);
    return component;
  },
  notify({ message } = {}) {
    if (message) console.log(`  [notify] ${message}`);
  },
};

// ---------------------------------------------------------------------------
// The real command table
// ---------------------------------------------------------------------------

const { COMMANDS } = require(APP);

// ---------------------------------------------------------------------------
// Relay connection — the same protocol app.js uses in the browser
// ---------------------------------------------------------------------------

const url = `ws://localhost:${port}`;
const socket = new WebSocket(url);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ type: "join", channel, id: `join-${Date.now()}`, role: "webflow" }));
  console.log(`\n  Webflow extension harness`);
  console.log(`  relay    ${url}`);
  console.log(`  channel  ${channel}`);
  console.log(`  commands ${Object.keys(COMMANDS).length}`);
  console.log(`\n  Connected as the Webflow editor. Drive it from Claude with the`);
  console.log(`  webflow_designer_* tools. Ctrl-C to stop.\n`);
});

socket.addEventListener("message", async (event) => {
  let data;
  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }

  if (data.type === "system" || data.type === "error") {
    if (data.type === "error") console.error(`  relay error: ${data.message}`);
    return;
  }

  const message = data.message;
  if (!message?.command || message.result !== undefined || message.error !== undefined) return;

  const { id, command, params = {} } = message;
  const started = Date.now();
  const handler = COMMANDS[command];

  if (!handler) {
    const error = `Unknown command "${command}". Implemented: ${Object.keys(COMMANDS).join(", ")}`;
    console.log(`  ✗ ${command} — not implemented`);
    send(id, { error });
    return;
  }

  try {
    const result = await handler(params);
    console.log(`  ✓ ${command} (${Date.now() - started}ms)`);
    send(id, { result });
  } catch (error) {
    const text = error?.message ?? String(error);
    console.log(`  ✗ ${command} — ${text}`);
    send(id, { error: text });
  }
});

socket.addEventListener("close", () => {
  console.log("\n  Relay connection closed.\n");
  process.exit(0);
});

socket.addEventListener("error", () => {
  console.error(
    `\n  Could not reach the relay at ${url}.\n  Start it with "npm run socket" in another terminal.\n`
  );
  process.exit(1);
});

function send(id, payload) {
  socket.send(JSON.stringify({ id, type: "message", channel, message: { id, ...payload } }));
}
