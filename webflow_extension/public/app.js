/**
 * Talk to Figma — Webflow Bridge
 *
 * A Webflow Designer Extension that joins the same relay the Figma plugin uses
 * (`src/socket.ts`) and executes Designer API calls on command.
 *
 * WHY A PLAIN SCRIPT
 * ------------------
 * No framework, no bundler, no dependencies: `webflow.json` points `publicDir`
 * straight at this folder, so what is written here is what runs. Webflow's own
 * reference bridge app pulls in React, Vite, Radix and socket.io to do the same
 * job; none of that survives contact with a 300-line command dispatcher, and
 * every dependency is one more thing to keep working inside an iframe we do not
 * control.
 *
 * WHY A RAW WebSocket AND NOT socket.io
 * -------------------------------------
 * The relay is a plain `Bun.serve` WebSocket server and the Figma plugin speaks
 * to it with the browser's own WebSocket. Matching that exactly means one
 * protocol to reason about, and this file can be compared line for line with
 * `src/claude_mcp_plugin/ui.html`.
 *
 * THE PROTOCOL
 * ------------
 *   join     → { type: "join", channel, id, role: "webflow" }
 *   command  ← { type: "broadcast", message: { id, command, params } }
 *   success  → { id, type: "message", channel, message: { id, result } }
 *   failure  → { id, type: "message", channel, message: { id, error } }
 *
 * `role: "webflow"` is what makes the relay deliver `target: "webflow"` commands
 * here instead of to the Figma plugin. The Figma plugin declares no role and is
 * classified from its first response, so both can share one channel.
 */

const DEFAULT_RELAY = "ws://localhost:3055";

const state = {
  socket: null,
  channel: null,
  connected: false,
};

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const els = {};

function log(message, kind = "info") {
  const line = document.createElement("div");
  line.className = `log-line log-${kind}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `${time}  ${message}`;
  els.log.prepend(line);
  while (els.log.childElementCount > 200) els.log.lastElementChild.remove();
}

function setStatus(connected, text) {
  state.connected = connected;
  els.dot.className = `dot ${connected ? "dot-on" : "dot-off"}`;
  els.status.textContent = text;
  els.connect.textContent = connected ? "Disconnect" : "Connect";
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function connect() {
  const channel = els.channel.value.trim();
  if (!channel) {
    log("Enter the channel ID shown in Claude, then connect.", "error");
    return;
  }

  const url = els.relay.value.trim() || DEFAULT_RELAY;
  let socket;
  try {
    socket = new WebSocket(url);
  } catch (error) {
    log(`Could not open ${url}: ${error}`, "error");
    return;
  }

  state.socket = socket;
  setStatus(false, "Connecting…");

  socket.onopen = () => {
    state.channel = channel;
    socket.send(JSON.stringify({ type: "join", channel, id: `join-${Date.now()}`, role: "webflow" }));
    setStatus(true, `Connected · channel ${channel}`);
    log(`Joined channel ${channel} as the Webflow editor.`, "ok");
    try {
      webflow.notify({ type: "Success", message: "Connected to Claude" });
    } catch {
      /* notify is best-effort */
    }
  };

  socket.onmessage = async (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "system") return;
    if (data.type === "error") {
      log(data.message || "Relay error", "error");
      return;
    }

    const message = data.message;
    // Only inbound commands are ours. A broadcast echo of our own reply carries
    // `result`/`error` and must not be executed as if it were a command.
    if (!message || !message.command || message.result !== undefined || message.error !== undefined) {
      return;
    }

    await handleCommand(message.id, message.command, message.params || {});
  };

  socket.onclose = () => {
    setStatus(false, "Disconnected");
    log("Connection closed.", "error");
  };

  socket.onerror = () => {
    // onclose always follows, and carries the user-facing message.
    log(`Could not reach the relay at ${url}. Is "npm run socket" running?`, "error");
  };
}

function disconnect() {
  if (state.socket) state.socket.close();
  state.socket = null;
  state.channel = null;
  setStatus(false, "Disconnected");
}

function reply(id, payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.socket.send(
    JSON.stringify({ id, type: "message", channel: state.channel, message: { id, ...payload } })
  );
}

async function handleCommand(id, command, params) {
  const handler = COMMANDS[command];
  if (!handler) {
    log(`Unknown command: ${command}`, "error");
    reply(id, { error: `Unknown command "${command}". This extension implements: ${Object.keys(COMMANDS).join(", ")}` });
    return;
  }

  log(`⌛ ${command}`);
  try {
    const result = await handler(params);
    reply(id, { result });
    log(`✅ ${command}`, "ok");
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    reply(id, { error: text });
    log(`❌ ${command} — ${text}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Webflow element ids are objects ({component, element}) inside a component and
 * plain-ish otherwise. The relay carries JSON, so ids travel as strings and are
 * matched back by their serialised form — never reconstructed, because the
 * shape is Webflow's to define, not ours.
 */
function idToKey(id) {
  return typeof id === "string" ? id : JSON.stringify(id);
}

async function findElement(elementId) {
  const all = await webflow.getAllElements();
  const match = all.find((el) => idToKey(el.id) === elementId);
  if (!match) {
    throw new Error(
      `No element with id ${elementId} on the current page. Ids change when the page changes — re-read webflow_get_structure.`
    );
  }
  return match;
}

async function describeElement(el, includeStyles) {
  const info = { id: idToKey(el.id), type: el.type };
  if (el.domId) info.domId = el.domId;

  if (el.getTag) {
    try {
      info.tag = await el.getTag();
    } catch {
      /* not all elements carry a tag */
    }
  }

  if (el.textContent && el.getTextContent) {
    try {
      const text = await el.getTextContent();
      if (text) info.text = text;
    } catch {
      /* ignore */
    }
  }

  if (includeStyles && el.getStyles) {
    try {
      const styles = await el.getStyles();
      if (styles && styles.length) {
        info.classes = await Promise.all(styles.map((s) => s.getName()));
      }
    } catch {
      /* ignore */
    }
  }

  return info;
}

async function walk(el, depth, out, includeStyles) {
  out.push(await describeElement(el, includeStyles));
  if (depth <= 0 || !el.children || !el.getChildren) return;
  const children = await el.getChildren();
  for (const child of children) {
    if (child.type === "String") continue;
    await walk(child, depth - 1, out, includeStyles);
  }
}

/** Webflow breakpoint ids, as the Designer API names them. */
const BREAKPOINTS = { main: "main", medium: "medium", small: "small", tiny: "tiny" };

function presetFor(tag) {
  const p = webflow.elementPresets;
  const map = {
    div: p.DivBlock,
    section: p.Section,
    container: p.BlockContainer,
    h1: p.Heading, h2: p.Heading, h3: p.Heading,
    h4: p.Heading, h5: p.Heading, h6: p.Heading,
    heading: p.Heading,
    paragraph: p.Paragraph,
    text: p.TextBlock,
    textblock: p.TextBlock,
    button: p.Button,
    link: p.LinkBlock || p.TextLink,
    image: p.Image,
    list: p.List,
    listitem: p.ListItem,
    embed: p.HtmlEmbed,
    form: p.FormForm,
  };
  const preset = map[String(tag).toLowerCase()];
  if (!preset) {
    throw new Error(
      `No Webflow preset for "${tag}". Supported: ${Object.keys(map).join(", ")}.`
    );
  }
  return preset;
}

/** h1–h6 are Heading presets whose level is set with setTag afterwards. */
function headingLevel(tag) {
  const match = /^h([1-6])$/i.exec(String(tag));
  return match ? `h${match[1]}` : null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const COMMANDS = {
  async webflow_status() {
    const page = await webflow.getCurrentPage();
    const info = await webflow.getSiteInfo?.().catch(() => null);
    return {
      connected: true,
      page: { id: idToKey(page.id), name: await page.getName() },
      site: info ? { id: info.siteId, name: info.siteName } : undefined,
      commands: Object.keys(COMMANDS),
    };
  },

  async webflow_get_structure({ elementId, depth }) {
    const limit = typeof depth === "number" ? depth : 6;
    const out = [];
    if (elementId) {
      await walk(await findElement(elementId), limit, out, true);
    } else {
      const root = await webflow.getRootElement();
      if (!root) return { elements: [], note: "The page has no root element yet." };
      await walk(root, limit, out, true);
    }
    return { count: out.length, elements: out };
  },

  async webflow_get_styles() {
    const styles = await webflow.getAllStyles();
    const out = await Promise.all(
      styles.map(async (style) => {
        const entry = { name: await style.getName() };
        try {
          entry.properties = await style.getProperties();
        } catch {
          /* a style may expose no readable properties */
        }
        return entry;
      })
    );
    return { count: out.length, styles: out };
  },

  async webflow_get_variables() {
    const collections = await webflow.getAllVariableCollections();
    const out = [];
    for (const collection of collections) {
      const variables = await collection.getAllVariables();
      out.push({
        collection: await collection.getName(),
        variables: await Promise.all(
          variables.map(async (v) => ({
            id: idToKey(v.id),
            name: await v.getName(),
            type: v.type,
            value: await v.get().catch(() => null),
          }))
        ),
      });
    }
    return { collections: out };
  },

  async webflow_create_variables({ collection, variables }) {
    if (!Array.isArray(variables) || variables.length === 0) {
      throw new Error("Pass at least one variable.");
    }

    let target;
    const existing = await webflow.getAllVariableCollections();
    if (collection) {
      for (const c of existing) {
        if ((await c.getName()) === collection) { target = c; break; }
      }
      if (!target) target = await webflow.createVariableCollection(collection);
    } else {
      target = existing[0] || (await webflow.createVariableCollection("Design tokens"));
    }

    const created = [];
    for (const spec of variables) {
      const { name, type, value } = spec;
      let variable;
      switch (type) {
        case "color":       variable = await target.createColorVariable(name, value); break;
        case "size":        variable = await target.createSizeVariable(name, value); break;
        case "percentage":  variable = await target.createPercentageVariable(name, value); break;
        case "number":      variable = await target.createNumberVariable(name, Number(value)); break;
        case "fontFamily":  variable = await target.createFontFamilyVariable(name, value); break;
        default:
          throw new Error(`Unsupported variable type "${type}" for "${name}".`);
      }
      created.push({ id: idToKey(variable.id), name, type });
    }

    return { collection: await target.getName(), created };
  },

  async webflow_set_tag_style({ tag, properties, breakpoint }) {
    // A tag style in Webflow is a style whose name is the tag itself.
    const name = String(tag).toLowerCase();
    let style = await webflow.getStyleByName(name);
    if (!style) style = await webflow.createStyle(name);
    await style.setProperties(properties, { breakpoint: BREAKPOINTS[breakpoint] || "main" });
    return { tag: name, breakpoint: breakpoint || "main", properties };
  },

  async webflow_set_style({ name, properties, breakpoint, inheritsFrom }) {
    let style = await webflow.getStyleByName(name);
    if (!style) {
      style = inheritsFrom
        ? await webflow.createStyle(name, { parent: await webflow.getStyleByName(inheritsFrom) })
        : await webflow.createStyle(name);
    }
    await style.setProperties(properties, { breakpoint: BREAKPOINTS[breakpoint] || "main" });
    return { name, breakpoint: breakpoint || "main", properties };
  },

  async webflow_create_element({ parentId, tag, className, text, attributes, position }) {
    const parent = parentId ? await findElement(parentId) : await webflow.getRootElement();
    if (!parent) throw new Error("No parent element available on this page.");

    const preset = presetFor(tag);
    const place = position === "prepend" ? "prepend" : "append";
    if (!(place in parent)) {
      throw new Error(`This parent cannot accept children (${parent.type}).`);
    }
    const el = await parent[place](preset);

    const level = headingLevel(tag);
    if (level && el.setTag) await el.setTag(level);

    if (text && el.setTextContent) await el.setTextContent(text);

    if (className && el.setStyles) {
      let style = await webflow.getStyleByName(className);
      if (!style) style = await webflow.createStyle(className);
      await el.setStyles([style]);
    }

    if (attributes && el.setCustomAttribute) {
      for (const [key, value] of Object.entries(attributes)) {
        await el.setCustomAttribute(key, value);
      }
    }

    return await describeElement(el, true);
  },

  async webflow_set_text({ elementId, text }) {
    const el = await findElement(elementId);
    if (!el.setTextContent) throw new Error(`Element ${elementId} (${el.type}) holds no text.`);
    await el.setTextContent(text);
    return await describeElement(el, false);
  },

  async webflow_delete_element({ elementId }) {
    const el = await findElement(elementId);
    if (!el.remove) throw new Error(`Element ${elementId} (${el.type}) cannot be removed.`);
    await el.remove();
    return { removed: elementId };
  },

  async webflow_create_component({ elementId, name, properties, variants }) {
    const el = await findElement(elementId);
    const component = await webflow.registerComponent(name, el);

    // Properties and variants are reported rather than silently dropped when the
    // running Designer API cannot create them — a flattened property is a lie
    // the designer only discovers later.
    const unsupported = [];
    if (properties?.length && !component.createProperty) {
      unsupported.push(`${properties.length} property definition(s)`);
    }
    if (variants?.length && !component.createVariant) {
      unsupported.push(`${variants.length} variant(s)`);
    }

    return {
      component: { id: idToKey(component.id), name },
      unsupported: unsupported.length
        ? `Created as a component, but this Designer API version could not define: ${unsupported.join(", ")}. Add them by hand in the Designer and report it.`
        : undefined,
    };
  },

  async webflow_insert_component({ componentId, parentId, variant, overrides }) {
    const components = await webflow.getAllComponents();
    const component = components.find((c) => idToKey(c.id) === componentId);
    if (!component) throw new Error(`No component with id ${componentId} on this site.`);

    const parent = parentId ? await findElement(parentId) : await webflow.getRootElement();
    if (!parent || !("append" in parent)) throw new Error("No parent that can accept an instance.");

    const instance = await parent.append(component);
    return {
      instance: await describeElement(instance, true),
      note: variant || overrides
        ? "Variant and property overrides must be set in the Designer; this API version exposes no setter for them."
        : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// The command table is exported when this file is loaded outside a browser, so
// the mapping logic (presets, heading levels, variable dispatch, error text) can
// be tested against a fake `webflow` global with no Designer and no DOM. In the
// extension this branch is simply not taken.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { COMMANDS, idToKey, presetFor, headingLevel, BREAKPOINTS };
}

if (typeof document !== "undefined") {
document.addEventListener("DOMContentLoaded", () => {
  els.channel = document.getElementById("channel");
  els.relay = document.getElementById("relay");
  els.connect = document.getElementById("connect");
  els.status = document.getElementById("status");
  els.dot = document.getElementById("dot");
  els.log = document.getElementById("log");

  els.relay.value = DEFAULT_RELAY;
  els.connect.addEventListener("click", () => (state.connected ? disconnect() : connect()));
  els.channel.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !state.connected) connect();
  });

  setStatus(false, "Not connected");
  log("Paste the channel ID from Claude, then press Connect.");
});
}
