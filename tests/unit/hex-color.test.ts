import { hexToRgba, coerceColor } from "../../src/talk_to_figma_mcp/utils/defaults";
import { normalizeParams } from "../../src/talk_to_figma_mcp/utils/batch-refs";

describe("hexToRgba", () => {
  it("parses #RRGGBB", () => {
    expect(hexToRgba("#FFFFFF")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(hexToRgba("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("parses without the leading hash", () => {
    expect(hexToRgba("FFFFFF")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("expands #RGB shorthand by doubling each digit", () => {
    expect(hexToRgba("#F00")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    // #0AF -> #00AAFF
    expect(hexToRgba("#0AF")).toEqual(hexToRgba("#00AAFF"));
  });

  it("parses #RRGGBBAA alpha", () => {
    expect(hexToRgba("#FF000000")).toEqual({ r: 1, g: 0, b: 0, a: 0 });
    expect(hexToRgba("#FF0000FF")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("is case insensitive", () => {
    expect(hexToRgba("#d2629e")).toEqual(hexToRgba("#D2629E"));
  });

  it("converts the real palette value the failing session mis-mapped", () => {
    // #D2629E -> 210/255, 98/255, 158/255
    const c = hexToRgba("#D2629E")!;
    expect(c.r).toBeCloseTo(210 / 255, 10);
    expect(c.g).toBeCloseTo(98 / 255, 10);
    expect(c.b).toBeCloseTo(158 / 255, 10);
    expect(c.a).toBe(1);
  });

  it("returns null for values that are not hex", () => {
    expect(hexToRgba("not-a-color")).toBeNull();
    expect(hexToRgba("#12345")).toBeNull(); // wrong length
    expect(hexToRgba("#GGGGGG")).toBeNull(); // non-hex digits
    expect(hexToRgba("")).toBeNull();
  });
});

describe("coerceColor", () => {
  it("passes through an existing rgba object, applying the alpha default", () => {
    expect(coerceColor({ r: 1, g: 0, b: 0 })).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("leaves a non-hex string untouched", () => {
    expect(coerceColor("heading-large")).toBe("heading-large");
  });
});

describe("normalizeParams — set_variable colour coercion", () => {
  it("converts a hex value when resolvedType is COLOR", () => {
    const out = normalizeParams("set_variable", {
      name: "Primary/500",
      resolvedType: "COLOR",
      value: "#D2629E",
    });
    expect(out.value).toEqual(hexToRgba("#D2629E"));
  });

  it("converts a '#'-prefixed value even without resolvedType", () => {
    const out = normalizeParams("set_variable", {
      name: "Primary/500",
      value: "#D2629E",
    });
    expect(out.value).toEqual(hexToRgba("#D2629E"));
  });

  it("does NOT rewrite a STRING token that merely looks like hex", () => {
    // The guard that matters: a genuine STRING variable whose value reads
    // "fff" or "abc123" must survive untouched.
    const out = normalizeParams("set_variable", {
      name: "Brand/Code",
      resolvedType: "STRING",
      value: "abc123",
    });
    expect(out.value).toBe("abc123");

    const out2 = normalizeParams("set_variable", {
      name: "Brand/Short",
      resolvedType: "STRING",
      value: "fff",
    });
    expect(out2.value).toBe("fff");
  });

  it("leaves numeric and boolean values alone", () => {
    expect(
      normalizeParams("set_variable", { name: "Space/4", resolvedType: "FLOAT", value: 4 }).value
    ).toBe(4);
    expect(
      normalizeParams("set_variable", { name: "Flag/On", resolvedType: "BOOLEAN", value: true }).value
    ).toBe(true);
  });

  it("still coerces hex on ordinary colour fields", () => {
    const out = normalizeParams("set_fill_color", { nodeId: "1:2", color: "#FF0000" });
    expect(out.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });
});
