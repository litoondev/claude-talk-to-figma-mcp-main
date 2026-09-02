/**
 * Regression cover for the two ways a text edit used to go wrong on a node that
 * carries more than one style — the shape of every real pricing card, where the
 * amount is bold and the cadence beside it is not:
 *
 *   1. `node.fontName` is `figma.mixed`, a Symbol. Handing it to a plugin API
 *      call throws "Cannot unwrap symbol", so every write path failed.
 *   2. Assigning `node.characters` collapses per-character styling onto the
 *      first segment, and `set_multiple_text_contents` painted each node orange
 *      before writing — so a failed write left the text stranded that colour.
 */
import { loadPlugin, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;

const BOLD = { family: "Inter", style: "Bold" };
const REGULAR = { family: "Inter", style: "Regular" };
const INK = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
const GREY = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];

type Style = { fontName: any; fontSize: number; fills: any };

/**
 * A text node faithful to the parts of Figma's behaviour under test: styling is
 * per character, `fontName` reports `figma.mixed` when the characters disagree,
 * and writing `characters` flattens every character onto the first one's style.
 */
function makeTextNode(id: string, runs: Array<{ text: string; style: Style }>) {
  let characters = runs.map((r) => r.text).join("");
  let styles: Style[] = runs.flatMap((r) =>
    Array.from({ length: r.text.length }, () => ({ ...r.style }))
  );

  const distinct = (read: (s: Style) => unknown) => {
    const first = JSON.stringify(read(styles[0]));
    return styles.every((s) => JSON.stringify(read(s)) === first)
      ? read(styles[0])
      : figma.mixed;
  };

  const node: any = {
    id,
    name: "Price",
    type: "TEXT",
    removed: false,
    fills: INK,
    get characters() {
      return characters;
    },
    set characters(value: string) {
      const collapsed = { ...styles[0] };
      characters = value;
      styles = Array.from({ length: value.length }, () => ({ ...collapsed }));
    },
    get fontName() {
      return distinct((s) => s.fontName);
    },
    set fontName(value: any) {
      styles = styles.map((s) => ({ ...s, fontName: value }));
    },
    get fontSize() {
      return distinct((s) => s.fontSize);
    },
    getRangeFontName: (start: number, _end: number) => styles[start].fontName,
    setRangeFontName: (start: number, end: number, value: any) => {
      for (let i = start; i < end; i++) styles[i].fontName = value;
    },
    setRangeFontSize: (start: number, end: number, value: any) => {
      for (let i = start; i < end; i++) styles[i].fontSize = value;
    },
    setRangeFills: (start: number, end: number, value: any) => {
      for (let i = start; i < end; i++) styles[i].fills = value;
    },
    setRangeTextCase: () => undefined,
    setRangeTextDecoration: () => undefined,
    setRangeLetterSpacing: () => undefined,
    setRangeLineHeight: () => undefined,
    setRangeFillStyleId: () => undefined,
    getStyledTextSegments: (fields: string[]) => {
      const segments: any[] = [];
      const key = (s: Style) =>
        JSON.stringify(fields.map((f) => (s as any)[f] ?? null));
      for (let i = 0; i < styles.length; i++) {
        const last = segments[segments.length - 1];
        if (last && key(styles[i]) === last._key) {
          last.end = i + 1;
          last.characters = characters.slice(last.start, last.end);
          continue;
        }
        const segment: any = { start: i, end: i + 1, _key: key(styles[i]) };
        for (const f of fields) segment[f] = (styles[i] as any)[f];
        segment.characters = characters[i];
        segments.push(segment);
      }
      return segments;
    },
    // Exposed for assertions only.
    _styleAt: (index: number) => styles[index],
  };

  return node;
}

beforeEach(() => {
  clearNodes();
  const loaded = loadPlugin();
  api = loaded.api;
  figma = loaded.figma;

  // The real API rejects a Symbol exactly this way — the failure the user hit.
  figma.loadFontAsync = async (font: any) => {
    if (typeof font === "symbol") throw new Error("Cannot unwrap symbol");
    if (!font || !font.family) throw new Error("Invalid font");
  };
});

const priceNode = (id = "1:1") =>
  makeTextNode(id, [
    { text: "$8.5K", style: { fontName: BOLD, fontSize: 40, fills: INK } },
    { text: " one-time", style: { fontName: REGULAR, fontSize: 16, fills: GREY } },
  ]);

describe("set_text_content on a multi-style text node", () => {
  it("writes the text instead of failing with 'Cannot unwrap symbol'", async () => {
    const node = priceNode();
    registerNodes(node);

    const result = await api.setTextContent({ nodeId: node.id, text: "$22K one-time" });

    expect(node.characters).toBe("$22K one-time");
    expect(result.characters).toBe("$22K one-time");
  });

  it("never returns figma.mixed — a Symbol cannot cross the socket", async () => {
    const node = priceNode();
    registerNodes(node);

    const result = await api.setTextContent({ nodeId: node.id, text: "$22K one-time" });

    expect(typeof result.fontName).not.toBe("symbol");
    expect(JSON.stringify(result)).toContain("$22K one-time");
  });

  it("keeps the amount bold and the cadence grey — it does not repaint the string", async () => {
    const node = priceNode();
    registerNodes(node);

    await api.setTextContent({ nodeId: node.id, text: "$22K one-time" });

    // "$22K" stays bold ink, " one-time" stays regular grey.
    expect(node._styleAt(0).fontName).toEqual(BOLD);
    expect(node._styleAt(0).fills).toEqual(INK);
    const tail = node.characters.indexOf("one-time");
    expect(node._styleAt(tail).fontName).toEqual(REGULAR);
    expect(node._styleAt(tail).fills).toEqual(GREY);
  });

  it("still writes a uniformly styled node", async () => {
    const node = makeTextNode("1:2", [
      { text: "Foundations", style: { fontName: BOLD, fontSize: 24, fills: INK } },
    ]);
    registerNodes(node);

    const result = await api.setTextContent({ nodeId: node.id, text: "Signature" });

    expect(node.characters).toBe("Signature");
    expect(result.fontName).toEqual(BOLD);
  });
});

describe("set_multiple_text_contents", () => {
  it("leaves fills untouched — no orange highlight to strand on failure", async () => {
    const a = priceNode("1:1");
    const b = priceNode("1:2");
    registerNodes(a, b);
    const seen: any[] = [];
    Object.defineProperty(a, "fills", {
      get: () => INK,
      set: (v) => seen.push(v),
    });

    await api.setMultipleTextContents({
      nodeId: "0:1",
      text: [
        { nodeId: "1:1", text: "$8.5K one-time" },
        { nodeId: "1:2", text: "$4.8K per month" },
      ],
    });

    expect(seen).toEqual([]);
    expect(a.characters).toBe("$8.5K one-time");
    expect(b.characters).toBe("$4.8K per month");
  });
});
