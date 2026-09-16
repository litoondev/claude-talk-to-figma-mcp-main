/**
 * Bug report: replacing text inside a component lost its inline formatting.
 * The bold lead-in either spread over the whole node or landed on the wrong
 * words, because ranges were scaled by length and there was no way to say which
 * part of the new text is bold.
 *
 * The fixture is copied from the designer's file: text node 15709:96101 in the
 * `inner_card` component. It is Lato, bold through "adulthood," (0–42) and
 * regular after that, with one text style linked across the whole string.
 */
import { loadPlugin, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;

const REGULAR = { family: "Lato", style: "Regular" };
const BOLD = { family: "Lato", style: "Bold" };
const BLACK = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
const TEXT_STYLE = "S:9b2dfc17fa0e75238285b6626369ade640026125,";
const WEIGHTS: Record<string, number> = { Regular: 400, Medium: 500, SemiBold: 600, Bold: 700 };

/** Styles Lato has in the designer's file. Anything else fails to load, as in Figma. */
let available = new Set(["Lato|Regular", "Lato|Bold", "Lato|SemiBold"]);

type Style = { fontName: any; fontWeight: number; fontSize: number; fills: any; textStyleId: string };

const style = (fontName: any, textStyleId = ""): Style => ({
  fontName,
  fontWeight: WEIGHTS[fontName.style] ?? 400,
  fontSize: 20,
  fills: BLACK,
  textStyleId,
});

/**
 * Per-character styling with the constraints this fix depends on:
 * - writing `characters` flattens every character onto the first one's style;
 * - setting `fontName` on the whole node detaches its text style;
 * - linking a text style resets the range to the style's own font, so a bold
 *   override has to be applied after the link, not before.
 */
function makeTextNode(id: string, runs: Array<{ text: string; style: Style }>) {
  let characters = runs.map((r) => r.text).join("");
  let styles: Style[] = runs.flatMap((r) => Array.from({ length: r.text.length }, () => ({ ...r.style })));
  const calls: string[] = [];

  const node: any = {
    id,
    name: "Paragraph_Text",
    type: "TEXT",
    removed: false,
    get characters() {
      return characters;
    },
    set characters(value: string) {
      const first = { ...styles[0] };
      characters = value;
      styles = Array.from({ length: value.length }, () => ({ ...first }));
    },
    get fontName() {
      const first = JSON.stringify(styles[0]?.fontName);
      return styles.every((s) => JSON.stringify(s.fontName) === first) ? styles[0].fontName : figma.mixed;
    },
    set fontName(value: any) {
      styles = styles.map((s) => ({ ...s, fontName: value, fontWeight: WEIGHTS[value.style] ?? 400, textStyleId: "" }));
    },
    getRangeFontName: (start: number) => styles[start].fontName,
    setRangeFontName: (start: number, end: number, value: any) => {
      calls.push(`fontName ${start}-${end} ${value.style}`);
      for (let i = start; i < end; i++) {
        styles[i] = { ...styles[i], fontName: value, fontWeight: WEIGHTS[value.style] ?? 400 };
      }
    },
    setRangeFontSize: (start: number, end: number, value: number) => {
      calls.push(`fontSize ${start}-${end}`);
      for (let i = start; i < end; i++) styles[i] = { ...styles[i], fontSize: value };
    },
    setRangeFills: (start: number, end: number, value: any) => {
      for (let i = start; i < end; i++) styles[i] = { ...styles[i], fills: value };
    },
    setRangeTextStyleIdAsync: async (start: number, end: number, value: string) => {
      calls.push(`textStyle ${start}-${end}`);
      for (let i = start; i < end; i++) {
        styles[i] = { ...styles[i], textStyleId: value, fontName: REGULAR, fontWeight: 400, fontSize: 20 };
      }
    },
    setRangeTextCase: () => calls.push("textCase"),
    setRangeTextDecoration: () => undefined,
    setRangeLetterSpacing: () => undefined,
    setRangeLineHeight: () => calls.push("lineHeight"),
    getStyledTextSegments: (fields: string[]) => {
      const segments: any[] = [];
      const key = (s: Style) => JSON.stringify(fields.map((f) => (s as any)[f] ?? null));
      styles.forEach((s, i) => {
        const last = segments[segments.length - 1];
        if (last && last._key === key(s)) {
          last.end = i + 1;
          return;
        }
        const segment: any = { start: i, end: i + 1, _key: key(s) };
        for (const f of fields) segment[f] = (s as any)[f];
        segments.push(segment);
      });
      return segments.map((s) => ({ ...s, characters: characters.slice(s.start, s.end) }));
    },
    _styleAt: (index: number) => styles[index],
    _calls: calls,
  };
  return node;
}

/** The real node from inner_card. */
const innerCardText = () =>
  makeTextNode("15709:96101", [
    { text: "Braces are just as effective in adulthood,", style: style(BOLD, TEXT_STYLE) },
    { text: " though treatment sometimes takes a little longer.", style: style(REGULAR, TEXT_STYLE) },
  ]);

/** Which characters of the node are bold, as the substrings a designer would see. */
function boldText(node: any): string[] {
  const out: string[] = [];
  let run = "";
  for (let i = 0; i < node.characters.length; i++) {
    if (node._styleAt(i).fontName.style === "Bold") run += node.characters[i];
    else if (run) {
      out.push(run);
      run = "";
    }
  }
  if (run) out.push(run);
  return out;
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  clearNodes();
  ({ api, figma } = loadPlugin());
  available = new Set(["Lato|Regular", "Lato|Bold", "Lato|SemiBold"]);
  // Figma rejects a missing style with no message at all — seen live.
  figma.loadFontAsync = async (font: any) => {
    if (typeof font === "symbol") throw new Error("Cannot unwrap symbol");
    if (!available.has(`${font.family}|${font.style}`)) return Promise.reject(undefined);
  };
});

describe("parseTextFormatting", () => {
  it("strips **bold** markers and records the bold range", () => {
    expect(plain(api.parseTextFormatting("Start **bold segment** end"))).toEqual({
      text: "Start bold segment end",
      bold: [{ start: 6, end: 18 }],
    });
  });

  it("reads <b> and <strong> tags, in any case", () => {
    expect(plain(api.parseTextFormatting("This is <b>bold</b> and <STRONG>strong</STRONG>."))).toEqual({
      text: "This is bold and strong.",
      bold: [
        { start: 8, end: 12 },
        { start: 17, end: 23 },
      ],
    });
  });

  it("merges touching bold ranges and drops empty tags", () => {
    expect(plain(api.parseTextFormatting("**Bold**<b> too</b><b></b> end"))).toEqual({
      text: "Bold too end",
      bold: [{ start: 0, end: 8 }],
    });
  });

  it("leaves text without a complete marker pair alone", () => {
    expect(api.parseTextFormatting("Rated 5** by patients")).toBeNull();
    expect(api.parseTextFormatting("No formatting here")).toBeNull();
  });
});

describe("set_text_content with formatting markers", () => {
  it("mock refuses a font style the family does not have, as Figma does", async () => {
    await expect(figma.loadFontAsync({ family: "Lato", style: "Heavy" })).rejects.toBeUndefined();
  });

  it("verification step from the report: only the middle segment is bold", async () => {
    const node = makeTextNode("1:1", [{ text: "Start old end", style: style(REGULAR) }]);
    registerNodes(node);

    const result = await api.setTextContent({ nodeId: node.id, text: "Start **bold segment** end" });

    expect(node.characters).toBe("Start bold segment end");
    expect(boldText(node)).toEqual(["bold segment"]);
    expect(result.formatting).toBe("markup");
    expect(plain(result.warnings)).toEqual([]);
  });

  it("keeps the inner_card hierarchy: the marked lead-in is bold, the rest regular", async () => {
    const node = innerCardText();
    registerNodes(node);

    await api.setTextContent({
      nodeId: node.id,
      text: "**Clear aligners work just as well for adults,** and treatment is often faster than expected.",
    });

    expect(node.characters).toBe("Clear aligners work just as well for adults, and treatment is often faster than expected.");
    expect(boldText(node)).toEqual(["Clear aligners work just as well for adults,"]);
  });

  it("keeps the text style linked on every character instead of typing its values", async () => {
    const node = innerCardText();
    registerNodes(node);

    await api.setTextContent({ nodeId: node.id, text: "**New lead-in,** new body." });

    for (let i = 0; i < node.characters.length; i++) expect(node._styleAt(i).textStyleId).toBe(TEXT_STYLE);
    expect(node._calls.some((c: string) => c.startsWith("fontSize"))).toBe(false);
    expect(node._calls.includes("lineHeight")).toBe(false);
  });

  it("uses the family's Bold when the node had no bold segment", async () => {
    const node = makeTextNode("1:2", [{ text: "All regular", style: style(REGULAR) }]);
    registerNodes(node);

    await api.setTextContent({ nodeId: node.id, text: "Now <b>partly</b> bold" });

    expect(boldText(node)).toEqual(["partly"]);
  });

  it("warns instead of silently writing regular text when no bold style loads", async () => {
    available = new Set(["Lato|Regular"]);
    const node = makeTextNode("1:3", [{ text: "All regular", style: style(REGULAR) }]);
    registerNodes(node);

    const result = await api.setTextContent({ nodeId: node.id, text: "Needs **bold** here" });

    expect(node.characters).toBe("Needs bold here");
    expect(boldText(node)).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/No bold style of "Lato"/);
  });

  it("writes asterisks literally with formatting: plain", async () => {
    const node = makeTextNode("1:4", [{ text: "x", style: style(REGULAR) }]);
    registerNodes(node);

    await api.setTextContent({ nodeId: node.id, text: "**not bold**", formatting: "plain" });

    expect(node.characters).toBe("**not bold**");
    expect(boldText(node)).toEqual([]);
  });

  it("rejects an unknown formatting mode", async () => {
    const node = makeTextNode("1:5", [{ text: "x", style: style(REGULAR) }]);
    registerNodes(node);

    await expect(api.setTextContent({ nodeId: node.id, text: "y", formatting: "html" })).rejects.toThrow(
      /formatting must be "markdown" or "plain"/
    );
  });
});

describe("set_text_content without markers", () => {
  it("keeps the bold lead-in on the rewritten lead-in, ending at the same comma", async () => {
    const node = innerCardText();
    registerNodes(node);

    await api.setTextContent({
      nodeId: node.id,
      text: "Clear aligners work just as well for adults, though treatment sometimes takes a little longer.",
    });

    // Proportional scaling put this boundary 8 characters early, mid-word.
    expect(boldText(node)).toEqual(["Clear aligners work just as well for adults,"]);
  });

  it("never splits a word when the boundary sits in a rewritten middle", async () => {
    const node = innerCardText();
    registerNodes(node);

    await api.setTextContent({ nodeId: node.id, text: "Braces work for everyone." });

    const bold = boldText(node);
    expect(bold.length).toBe(1);
    const end = bold[0].length;
    expect(node.characters[end - 1] === " " || node.characters[end] === " " || end === node.characters.length).toBe(true);
  });
});

describe("set_multiple_text_contents", () => {
  it("applies markers per node and reports warnings per node", async () => {
    // Lato has its Bold; this Inter install has only Regular.
    const INTER = { family: "Inter", style: "Regular" };
    available = new Set(["Lato|Regular", "Lato|Bold", "Inter|Regular"]);
    const a = innerCardText();
    const b = makeTextNode("1:6", [{ text: "Plain", style: style(INTER) }]);
    registerNodes(a, b);

    const result = await api.setMultipleTextContents({
      nodeId: "0:1",
      text: [
        { nodeId: a.id, text: "**Lead-in,** body." },
        { nodeId: b.id, text: "Needs **bold**" },
      ],
    });

    expect(a.characters).toBe("Lead-in, body.");
    expect(boldText(a)).toEqual(["Lead-in,"]);
    const second = result.results.find((r: any) => r.nodeId === b.id);
    expect(second.success).toBe(true);
    expect(b.characters).toBe("Needs bold");
    expect(second.warnings.join(" ")).toMatch(/No bold style of "Inter"/);
  });
});

describe("a font the text already uses is missing", () => {
  it("names the font instead of failing with 'undefined'", async () => {
    // Figma rejects with no message; the plugin used to read .message of undefined.
    available = new Set(["Lato|Regular"]);
    const node = innerCardText();
    registerNodes(node);

    await expect(api.setTextContent({ nodeId: node.id, text: "**New,** text." })).rejects.toThrow(
      /The font "Lato Bold" used by this text is not available/
    );
    expect(node.characters).toBe("Braces are just as effective in adulthood, though treatment sometimes takes a little longer.");
  });
});
