/**
 * The Webflow Designer Extension's command layer.
 *
 * The extension itself can only run inside Webflow, but its *mapping* logic
 * does not need a Designer: which preset a tag resolves to, how a heading level
 * is applied, which variable constructor a type picks, and what the failure text
 * says when something is not there. That is where the bugs are, and all of it is
 * pure enough to run against a fake `webflow` global.
 *
 * What this cannot cover is whether Webflow's real API behaves as its own bridge
 * app implies — the calls here were taken from that app's source rather than
 * guessed, but only a live Designer proves them. The extension README says so
 * too, so nobody reads a green suite as "verified against Webflow".
 */
import { describe, it, expect, beforeEach } from "bun:test";

const APP = "../../webflow_extension/public/app.js";

/** A stand-in for one Designer element. */
function makeElement(id: string, type = "DOM", extras: Record<string, any> = {}) {
  const el: any = {
    id,
    type,
    children: true,
    _tag: null,
    _text: null,
    _styles: [] as any[],
    _attrs: {} as Record<string, string>,
    _removed: false,
    async getTag() { return el._tag; },
    async setTag(tag: string) { el._tag = tag; },
    async getTextContent() { return el._text; },
    async setTextContent(text: string) { el._text = text; },
    async getStyles() { return el._styles; },
    async setStyles(styles: any[]) { el._styles = styles; },
    async setCustomAttribute(k: string, v: string) { el._attrs[k] = v; },
    async getChildren() { return []; },
    async remove() { el._removed = true; },
    ...extras,
  };
  return el;
}

function makeStyle(name: string) {
  const style: any = {
    _name: name,
    _props: {} as Record<string, string>,
    _breakpoint: null as string | null,
    async getName() { return style._name; },
    async getProperties() { return style._props; },
    async setProperties(props: Record<string, string>, opts: any) {
      style._props = { ...style._props, ...props };
      style._breakpoint = opts?.breakpoint ?? null;
    },
  };
  return style;
}

/** The fake Designer. Only what the commands actually touch. */
function makeWebflow() {
  const styles: any[] = [];
  const elements: any[] = [];
  const collections: any[] = [];
  const components: any[] = [];

  const root = makeElement("root", "DOM", {
    async append(preset: any) {
      const child = makeElement(`el-${elements.length + 1}`, "DOM");
      child._preset = preset;
      elements.push(child);
      return child;
    },
    async prepend(preset: any) {
      const child = makeElement(`el-${elements.length + 1}`, "DOM");
      child._preset = preset;
      elements.push(child);
      return child;
    },
  });
  elements.push(root);

  const wf: any = {
    elementPresets: {
      DivBlock: "DivBlock", Section: "Section", BlockContainer: "BlockContainer",
      Heading: "Heading", Paragraph: "Paragraph", TextBlock: "TextBlock",
      Button: "Button", LinkBlock: "LinkBlock", Image: "Image",
      List: "List", ListItem: "ListItem", HtmlEmbed: "HtmlEmbed", FormForm: "FormForm",
    },
    _styles: styles,
    _elements: elements,
    _collections: collections,
    _components: components,
    async getRootElement() { return root; },
    async getAllElements() { return elements; },
    async getAllStyles() { return styles; },
    async getStyleByName(name: string) {
      return styles.find((s) => s._name === name) ?? null;
    },
    async createStyle(name: string) {
      const style = makeStyle(name);
      styles.push(style);
      return style;
    },
    async getAllVariableCollections() { return collections; },
    async createVariableCollection(name: string) {
      const vars: any[] = [];
      const collection: any = {
        _name: name,
        _vars: vars,
        async getName() { return name; },
        async getAllVariables() { return vars; },
        async createColorVariable(n: string, v: string) { return push(n, "color", v); },
        async createSizeVariable(n: string, v: string) { return push(n, "size", v); },
        async createPercentageVariable(n: string, v: string) { return push(n, "percentage", v); },
        async createNumberVariable(n: string, v: number) { return push(n, "number", v); },
        async createFontFamilyVariable(n: string, v: string) { return push(n, "fontFamily", v); },
      };
      function push(n: string, type: string, value: unknown) {
        const variable = {
          id: `var-${vars.length + 1}`, type,
          async getName() { return n; },
          async get() { return value; },
        };
        vars.push(variable);
        return variable;
      }
      collections.push(collection);
      return collection;
    },
    async getCurrentPage() {
      return { id: "page-1", async getName() { return "Home"; } };
    },
    async getAllComponents() { return components; },
    async registerComponent(name: string, _el: any) {
      const component = { id: `cmp-${components.length + 1}`, name };
      components.push(component);
      return component;
    },
    notify() {},
  };
  return wf;
}

// Some commands take no parameters (webflow_status), so the argument is optional.
let COMMANDS: Record<string, (p?: any) => Promise<any>>;
let helpers: any;
let wf: any;

beforeEach(() => {
  wf = makeWebflow();
  (globalThis as any).webflow = wf;
  delete require.cache[require.resolve(APP)];
  helpers = require(APP);
  COMMANDS = helpers.COMMANDS;
});

describe("command table", () => {
  it("implements exactly the commands the MCP tools send", () => {
    // Drift here is invisible at runtime until a tool call comes back "Unknown
    // command", so the two lists are pinned together.
    expect(Object.keys(COMMANDS).sort()).toEqual([
      "webflow_create_component",
      "webflow_create_element",
      "webflow_create_variables",
      "webflow_delete_element",
      "webflow_get_structure",
      "webflow_get_styles",
      "webflow_get_variables",
      "webflow_insert_component",
      "webflow_set_style",
      "webflow_set_tag_style",
      "webflow_set_text",
      "webflow_status",
    ]);
  });
});

describe("tag → preset mapping", () => {
  it("maps every documented tag to a real preset", () => {
    for (const tag of ["div", "section", "container", "paragraph", "button", "image", "list", "embed"]) {
      expect(helpers.presetFor(tag)).toBeTruthy();
    }
  });

  it("sends all six heading levels to the Heading preset", () => {
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      expect(helpers.presetFor(tag)).toBe("Heading");
    }
  });

  it("names the supported tags when asked for one that does not exist", () => {
    // A bare "not found" would leave the model guessing at the vocabulary.
    expect(() => helpers.presetFor("marquee")).toThrow(/Supported:/);
  });

  it("reads the heading level rather than trusting the preset", () => {
    expect(helpers.headingLevel("h3")).toBe("h3");
    expect(helpers.headingLevel("H5")).toBe("h5");
    expect(helpers.headingLevel("div")).toBeNull();
    expect(helpers.headingLevel("h7")).toBeNull();
  });
});

describe("element creation", () => {
  it("applies the heading level after appending the shared Heading preset", async () => {
    const result = await COMMANDS.webflow_create_element({ tag: "h2", text: "Pricing" });
    const created = wf._elements.find((e: any) => e.id === result.id);
    expect(created._preset).toBe("Heading");
    expect(created._tag).toBe("h2");
    expect(created._text).toBe("Pricing");
  });

  it("reuses an existing class instead of minting a duplicate", async () => {
    await wf.createStyle("card-feature");
    await COMMANDS.webflow_create_element({ tag: "div", className: "card-feature" });
    await COMMANDS.webflow_create_element({ tag: "div", className: "card-feature" });
    expect(wf._styles.filter((s: any) => s._name === "card-feature")).toHaveLength(1);
  });

  it("creates the class when it does not exist yet", async () => {
    await COMMANDS.webflow_create_element({ tag: "div", className: "section-hero" });
    expect(await wf.getStyleByName("section-hero")).toBeTruthy();
  });

  it("sets custom attributes", async () => {
    const result = await COMMANDS.webflow_create_element({
      tag: "image", attributes: { alt: "Team photo" },
    });
    const created = wf._elements.find((e: any) => e.id === result.id);
    expect(created._attrs.alt).toBe("Team photo");
  });

  it("explains a stale element id instead of failing opaquely", async () => {
    await expect(
      COMMANDS.webflow_create_element({ parentId: "gone", tag: "div" })
    ).rejects.toThrow(/re-read webflow_get_structure/);
  });
});

describe("styles", () => {
  it("names a tag style after the tag itself", async () => {
    await COMMANDS.webflow_set_tag_style({
      tag: "h1", properties: { "font-size": "48px" },
    });
    const style = await wf.getStyleByName("h1");
    expect(style).toBeTruthy();
    expect(style._props["font-size"]).toBe("48px");
  });

  it("defaults to the main breakpoint, since Webflow's cascade only flows down", async () => {
    await COMMANDS.webflow_set_tag_style({ tag: "h1", properties: { "font-size": "48px" } });
    expect((await wf.getStyleByName("h1"))._breakpoint).toBe("main");
  });

  it("authors an override on the named breakpoint", async () => {
    await COMMANDS.webflow_set_tag_style({
      tag: "h1", properties: { "font-size": "32px" }, breakpoint: "small",
    });
    expect((await wf.getStyleByName("h1"))._breakpoint).toBe("small");
  });

  it("updates an existing class rather than replacing it", async () => {
    await COMMANDS.webflow_set_style({ name: "card", properties: { padding: "24px" } });
    await COMMANDS.webflow_set_style({ name: "card", properties: { "border-radius": "8px" } });
    const style = await wf.getStyleByName("card");
    expect(style._props).toEqual({ padding: "24px", "border-radius": "8px" });
    expect(wf._styles.filter((s: any) => s._name === "card")).toHaveLength(1);
  });
});

describe("variables", () => {
  it("dispatches each Figma-derived type to its own constructor", async () => {
    const result = await COMMANDS.webflow_create_variables({
      collection: "Design tokens",
      variables: [
        { name: "color/brand/primary", type: "color", value: "#4353ff" },
        { name: "spacing/40", type: "size", value: "40px" },
        { name: "font/body", type: "fontFamily", value: "Inter" },
      ],
    });
    expect(result.created.map((v: any) => v.type)).toEqual(["color", "size", "fontFamily"]);
  });

  it("keeps the Figma names verbatim so the two systems stay traceable", async () => {
    await COMMANDS.webflow_create_variables({
      variables: [{ name: "color/brand/primary", type: "color", value: "#000" }],
    });
    const listed = await COMMANDS.webflow_get_variables();
    expect(listed.collections[0].variables[0].name).toBe("color/brand/primary");
  });

  it("reuses a collection by name instead of creating a second one", async () => {
    await COMMANDS.webflow_create_variables({
      collection: "Design tokens",
      variables: [{ name: "a", type: "color", value: "#000" }],
    });
    await COMMANDS.webflow_create_variables({
      collection: "Design tokens",
      variables: [{ name: "b", type: "color", value: "#fff" }],
    });
    expect(wf._collections).toHaveLength(1);
    expect(wf._collections[0]._vars).toHaveLength(2);
  });

  it("names the offending variable when the type is unsupported", async () => {
    await expect(
      COMMANDS.webflow_create_variables({
        variables: [{ name: "shadow/card", type: "shadow", value: "..." }],
      })
    ).rejects.toThrow(/shadow\/card/);
  });

  it("refuses an empty batch rather than silently doing nothing", async () => {
    await expect(COMMANDS.webflow_create_variables({ variables: [] })).rejects.toThrow(/at least one/);
  });
});

describe("components", () => {
  it("reports properties it could not define instead of dropping them", async () => {
    // The fake component exposes no createProperty, like an older Designer API.
    // A silently flattened property is one the designer discovers much later.
    const result = await COMMANDS.webflow_create_component({
      elementId: "root",
      name: "Card-Pricing",
      properties: [{ name: "Button Style", type: "text" }],
      variants: ["Primary", "Secondary"],
    });
    expect(result.unsupported).toContain("1 property definition(s)");
    expect(result.unsupported).toContain("2 variant(s)");
  });

  it("says nothing about unsupported features when none were asked for", async () => {
    const result = await COMMANDS.webflow_create_component({ elementId: "root", name: "Plain" });
    expect(result.unsupported).toBeUndefined();
  });
});

describe("reads", () => {
  it("reports the page and its own command list on status", async () => {
    const status = await COMMANDS.webflow_status();
    expect(status.connected).toBe(true);
    expect(status.page.name).toBe("Home");
    expect(status.commands).toHaveLength(12);
  });

  it("describes the tree from the root when given no element", async () => {
    await COMMANDS.webflow_create_element({ tag: "section" });
    const structure = await COMMANDS.webflow_get_structure({});
    expect(structure.count).toBeGreaterThanOrEqual(1);
    expect(structure.elements[0].id).toBe("root");
  });

  it("lists styles with their properties", async () => {
    await COMMANDS.webflow_set_style({ name: "card", properties: { padding: "24px" } });
    const listed = await COMMANDS.webflow_get_styles();
    expect(listed.styles.find((s: any) => s.name === "card").properties.padding).toBe("24px");
  });
});

describe("text and deletion", () => {
  it("replaces text on an existing element", async () => {
    const created = await COMMANDS.webflow_create_element({ tag: "paragraph", text: "before" });
    await COMMANDS.webflow_set_text({ elementId: created.id, text: "after" });
    expect(wf._elements.find((e: any) => e.id === created.id)._text).toBe("after");
  });

  it("removes an element", async () => {
    const created = await COMMANDS.webflow_create_element({ tag: "div" });
    const result = await COMMANDS.webflow_delete_element({ elementId: created.id });
    expect(result.removed).toBe(created.id);
    expect(wf._elements.find((e: any) => e.id === created.id)._removed).toBe(true);
  });
});

describe("element ids", () => {
  it("serialises Webflow's object ids so they survive the relay's JSON", () => {
    // Inside a component an id is {component, element}, not a string.
    expect(helpers.idToKey("plain")).toBe("plain");
    expect(helpers.idToKey({ component: "123", element: "456" })).toBe(
      JSON.stringify({ component: "123", element: "456" })
    );
  });
});

describe("the MCP tools and the extension agree on command names", () => {
  it("every command the tools send is implemented here", async () => {
    // These two files are edited independently and never import each other, so
    // nothing but this test stops them drifting. The symptom of drift is a tool
    // call that succeeds all the way to the extension and comes back "Unknown
    // command" — after the user has already connected and pressed go.
    const source = await Bun.file(
      new URL("../../src/talk_to_figma_mcp/tools/webflow-designer-tools.ts", import.meta.url)
    ).text();

    const sent = new Set<string>();
    for (const match of source.matchAll(/sendCommandToWebflow\(\s*"([a-z_0-9]+)"/g)) {
      sent.add(match[1]);
    }

    expect(sent.size).toBeGreaterThan(0);
    const implemented = new Set(Object.keys(COMMANDS));
    const missing = [...sent].filter((name) => !implemented.has(name));
    expect(missing).toEqual([]);
  });

  it("the extension implements nothing the tools never call", () => {
    // The reverse direction: dead command handlers are code nobody can reach,
    // and they make the status report overstate what the extension can do.
    const source = require("node:fs").readFileSync(
      new URL("../../src/talk_to_figma_mcp/tools/webflow-designer-tools.ts", import.meta.url).pathname,
      "utf8"
    );
    const sent = new Set<string>();
    for (const match of source.matchAll(/sendCommandToWebflow\(\s*"([a-z_0-9]+)"/g)) {
      sent.add(match[1]);
    }
    const dead = Object.keys(COMMANDS).filter((name) => !sent.has(name));
    expect(dead).toEqual([]);
  });
});
