/**
 * execute_code failures seen in the plugin's live activity log:
 *   - reading another page's children under documentAccess "dynamic-page"
 *   - appending into an instance
 *   - "cannot read property 'Symbol.iterator' of undefined" with no line
 * The error strings below are Figma's own text, copied from the live sandbox.
 */
import { loadPlugin, clearNodes } from "../fixtures/figma-plugin-harness";

const UNLOADED_PAGE_ERROR =
  "in get_children: Cannot access property `children` on a page that has not been explicitly loaded. " +
  "Remember to call `await page.loadAsync()` or `await figma.loadAllPagesAsync()' first.";
const INSTANCE_PARENT_ERROR =
  "in appendChild: Cannot move node. New parent is an instance or is inside of an instance";
const QUICKJS_ITERATOR_ERROR = "cannot read property 'Symbol.iterator' of undefined";

let api: any;
let figma: any;

beforeEach(() => {
  clearNodes();
  ({ api, figma } = loadPlugin());
});

/** A page that refuses `children` until loaded, as Figma does. */
function dynamicPage(children: any[]) {
  const page: any = { type: "PAGE", loaded: false };
  Object.defineProperty(page, "children", {
    get() {
      if (!page.loaded) throw new Error(UNLOADED_PAGE_ERROR);
      return children;
    },
  });
  return page;
}

/** Run a script that must fail and return the error message. */
async function failure(code: string): Promise<string> {
  try {
    await api.executeCode({ code });
  } catch (error: any) {
    return error.message;
  }
  throw new Error("script did not fail");
}

describe("execute_code — dynamic page loading", () => {
  it("mock refuses an unloaded page the way Figma does", () => {
    expect(() => dynamicPage([]).children).toThrow(UNLOADED_PAGE_ERROR);
  });

  it("loads every page before the script runs, so other pages can be read", async () => {
    const pages = [dynamicPage([{}, {}]), dynamicPage([{}])];
    figma.root = { children: pages };
    figma.loadAllPagesAsync = async () => {
      pages.forEach((p) => (p.loaded = true));
    };

    const res = await api.executeCode({
      code: "return figma.root.children.map((p) => p.children.length);",
    });

    expect(res.success).toBe(true);
    expect(Array.from(res.result)).toEqual([2, 1]);
  });

  it("points at page.loadAsync for a page that is still unloaded", async () => {
    figma.root = { children: [dynamicPage([])] };

    const message = await failure("return figma.root.children[0].children.length;");

    expect(message).toContain(UNLOADED_PAGE_ERROR);
    expect(message).toContain("Hint: All pages are loaded before the script starts");
  });

  it("reports a failure to load pages instead of running the script", async () => {
    figma.loadAllPagesAsync = async () => {
      throw new Error("load failed");
    };

    await expect(api.executeCode({ code: "return 1;" })).rejects.toThrow(
      /^execute_code failed: load failed/
    );
  });
});

describe("execute_code — error reports", () => {
  it("gives the script line and a hint when a loop receives undefined", async () => {
    const message = await failure(
      "const a = 1;\nconst nodes = undefined;\nfor (const n of nodes) {}\nreturn a;"
    );

    expect(message).toContain("(line 3 of the script)");
    expect(message).toContain("Hint: A for...of loop, spread (...) or array destructuring received undefined");
  });

  it("recognises Figma's QuickJS wording of the iterator error", async () => {
    const message = await failure(`\n\nthrow new TypeError("${QUICKJS_ITERATOR_ERROR}");`);

    expect(message).toContain(QUICKJS_ITERATOR_ERROR);
    expect(message).toContain("(line 3 of the script)");
    expect(message).toContain("Hint: A for...of loop");
  });

  it("explains that instance children cannot be moved", async () => {
    const message = await failure(`throw new Error("${INSTANCE_PARENT_ERROR}");`);

    expect(message).toContain(INSTANCE_PARENT_ERROR);
    expect(message).toContain("getMainComponentAsync()");
    expect(message).toContain("detachInstance()");
  });

  it("adds only the line to an error with no known cause", async () => {
    const message = await failure("throw new Error('Custom plugin error');");

    expect(message).toBe("execute_code failed: Custom plugin error (line 1 of the script)");
  });

  it("keeps a thrown non-Error value as it is", async () => {
    expect(await failure("throw 'plain value';")).toBe("execute_code failed: plain value");
  });
});

/** Seen live during an HTML import, copied from the plugin's activity log. */
describe("execute_code — hints for errors seen during an HTML import", () => {
  const STRETCH_ERROR =
    "in set_counterAxisAlignItems: Property \"counterAxisAlignItems\" failed validation: Invalid enum value. " +
    "Expected 'MIN' | 'MAX' | 'CENTER' | 'BASELINE', received 'STRETCH'";
  const CSS_KEYWORD_ERROR =
    "in set_primaryAxisAlignItems: Property \"primaryAxisAlignItems\" failed validation: Invalid enum value. " +
    "Expected 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN', received 'flex-start'";

  it("turns a STRETCH alignment into MIN plus cross-axis Fill", async () => {
    const message = await failure(`throw new Error(${JSON.stringify(STRETCH_ERROR)});`);

    expect(message).toContain(STRETCH_ERROR);
    expect(message).toContain("counterAxisAlignItems to 'MIN'");
    expect(message).toContain("layoutSizingHorizontal = 'FILL'");
  });

  it("maps other CSS keywords to Figma's enum names", async () => {
    const message = await failure(`throw new Error(${JSON.stringify(CSS_KEYWORD_ERROR)});`);

    expect(message).toContain("flex-start → MIN");
    expect(message).not.toContain("no STRETCH alignment");
  });

  it("explains a null lookup in Figma's QuickJS wording", async () => {
    const message = await failure(
      `\n\n\n\n\nthrow new TypeError("cannot read property 'findAll' of null");`
    );

    expect(message).toContain("(line 6 of the script)");
    expect(message).toContain("Hint: A lookup returned nothing");
  });

  it("explains a null lookup in V8's wording too", async () => {
    const message = await failure("const node = null;\nreturn node.findAll(() => true);");

    expect(message).toContain("(line 2 of the script)");
    expect(message).toContain("Hint: A lookup returned nothing");
  });

  it("keeps the iterator hint for an undefined loop, not the lookup hint", async () => {
    const message = await failure("for (const n of undefined) {}");

    expect(message).toContain("Hint: A for...of loop");
    expect(message).not.toContain("A lookup returned nothing");
  });
});
