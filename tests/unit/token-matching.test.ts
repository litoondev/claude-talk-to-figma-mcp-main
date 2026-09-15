/**
 * Matching HTML design values against the Figma file's design system: reuse
 * what exists, and report — never paper over — what does not.
 */
import {
  matchDesignTokens,
  renderImportNotes,
  weightFromStyle,
  DesignSystemSnapshot,
} from "../../src/talk_to_figma_mcp/utils/token-matching";
import { renderTokenMatch } from "../../src/talk_to_figma_mcp/tools/html-import-tools";

jest.mock("../../src/talk_to_figma_mcp/utils/websocket", () => ({ sendCommandToFigma: jest.fn() }));

const ds: DesignSystemSnapshot = {
  colors: [{ id: "S:cta", name: "Brand/CTA", hex: "#f97316", opacity: 1 }],
  typography: [
    { id: "T:h1", name: "Heading/H1", fontFamily: "Figtree", fontStyle: "Bold", fontSize: 64, lineHeight: "110%", letterSpacing: "-1px" },
    { id: "T:body", name: "Body/Regular", fontFamily: "Inter", fontStyle: "Regular", fontSize: 16, lineHeight: "150%", letterSpacing: "0px" },
  ],
  variableCollections: [
    {
      name: "styles",
      modes: [{ modeId: "m1", name: "Desk" }, { modeId: "m2", name: "Tab" }],
      variables: [
        { id: "V:ink", name: "colors/Base/Black", resolvedType: "COLOR", scopes: ["ALL_SCOPES"], valuesByMode: { m1: "#030712", m2: "#030712" } },
        { id: "V:alias", name: "text/heading", resolvedType: "COLOR", scopes: ["ALL_SCOPES"], valuesByMode: { m1: "→ colors/Base/Black" } },
        { id: "V:opacity", name: "Opacity/Muted", resolvedType: "FLOAT", scopes: ["OPACITY"], valuesByMode: { m1: 16 } },
        { id: "V:gap", name: "Gap/Card", resolvedType: "FLOAT", scopes: ["GAP"], valuesByMode: { m1: 16, m2: 12 } },
        { id: "V:lr", name: "Left-Right", resolvedType: "FLOAT", scopes: ["ALL_SCOPES"], valuesByMode: { m1: 100, m2: 40 } },
        { id: "V:radius", name: "Radius/Card", resolvedType: "FLOAT", scopes: ["CORNER_RADIUS"], valuesByMode: { m1: 20 } },
      ],
    },
  ],
};

const result = matchDesignTokens(
  {
    colors: ["#030712", "#F97316", "#0b0f14", "#030712"],
    typography: [
      { label: "h1", fontFamily: "Figtree", fontSize: 64, fontWeight: 700, lineHeight: "110%", letterSpacing: -1 },
      { label: "p", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: "24px" },
      { label: ".lead", fontFamily: "Inter", fontSize: 16, fontWeight: 600 },
      { label: "h2.hero", fontFamily: "Poppins", fontSize: 40, fontWeight: 400 },
    ],
    spacing: [16, 100, 40, 7],
    radii: [20, 8],
  },
  ds
);

describe("colours", () => {
  it("prefers a variable, then a style, and lists what the system lacks", () => {
    expect(result.colors.matched).toEqual([
      { value: "#030712", kind: "variable", name: "colors/Base/Black", id: "V:ink", mode: "Desk", alternatives: [] },
      { value: "#f97316", kind: "style", name: "Brand/CTA", id: "S:cta", alternatives: [] },
    ]);
    expect(result.colors.missing).toEqual(["#0b0f14"]);
  });
});

describe("typography", () => {
  it("matches family, size, weight name and line height across % and px", () => {
    expect(result.typography.matched.map((m) => m.style.name)).toEqual(["Heading/H1", "Body/Regular"]);
  });

  it("reports a same-size, different-weight style as close, not a match", () => {
    expect(result.typography.near).toEqual([
      expect.objectContaining({ style: { id: "T:body", name: "Body/Regular" }, differences: ["weight 600 vs 400"] }),
    ]);
  });

  it("reports an unknown family as missing", () => {
    expect(result.typography.missing.map((t) => t.label)).toEqual(["h2.hero"]);
  });

  it("reads weights from Figma style names", () => {
    expect(weightFromStyle("SemiBold Italic")).toBe(600);
    expect(weightFromStyle("ExtraLight")).toBe(200);
    expect(weightFromStyle("Black")).toBe(900);
    expect(weightFromStyle(null)).toBe(400);
  });
});

describe("spacing and radii", () => {
  it("only binds to variables whose scopes or names fit — never an opacity of 16", () => {
    expect(result.spacing.matched).toEqual([
      { value: 16, name: "Gap/Card", id: "V:gap", mode: "Desk", alternatives: [] },
      { value: 100, name: "Left-Right", id: "V:lr", mode: "Desk", alternatives: [] },
      { value: 40, name: "Left-Right", id: "V:lr", mode: "Tab", alternatives: [] },
    ]);
    expect(result.spacing.missing).toEqual([7]);
  });

  it("matches radii against radius-scoped variables", () => {
    expect(result.radii.matched.map((r) => r.name)).toEqual(["Radius/Card"]);
    expect(result.radii.missing).toEqual([8]);
  });
});

describe("import notes", () => {
  it("lists everything built with the HTML's own values", () => {
    const notes = renderImportNotes(result);
    expect(notes).toContain("Not in the current design system — built with the HTML's own values (Done):");
    expect(notes).toContain("• Colours: #0b0f14");
    expect(notes).toContain("• Typography: Poppins 40px/400 (h2.hero)");
    expect(notes).toContain('close but not exact: Inter 16px/600 (.lead) — nearest style "Body/Regular" (weight 600 vs 400)');
    expect(notes).toContain("• Spacing: 7px");
    expect(notes).toContain("• Corner radius: 8px");
  });

  it("says so when everything maps", () => {
    const clean = matchDesignTokens({ colors: ["#030712"], spacing: [16] }, ds);
    expect(renderImportNotes(clean)).toBe("Everything used by the HTML maps to the existing design system.");
  });

  it("renders the tool report with what to bind first", () => {
    const text = renderTokenMatch(result);
    // 2 colours + 2 text styles + 3 spacing + 1 radius found, of 3 + 4 + 4 + 2 values.
    expect(text).toContain("Design-system match — 8 of 13 values found in this file.");
    expect(text).toContain('Colour #030712 → variable "colors/Base/Black" [Desk] id V:ink');
    expect(text).toContain('Text Figtree 64px/700 lh 110% (h1) → text style "Heading/H1" id T:h1');
    expect(text).toContain("Do not create variables or styles for the missing values unless the user asks.");
  });
});
