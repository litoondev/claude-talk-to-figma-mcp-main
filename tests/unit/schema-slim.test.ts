import { slimJsonSchema } from "../../src/talk_to_figma_mcp/utils/schema-helpers";

describe("slimJsonSchema", () => {
  it("drops boilerplate and collapses RGBA channel noise", () => {
    const channel = { type: "number", minimum: 0, maximum: 1, description: "Red component (0-1)" };
    const schema = {
      type: "object",
      properties: {
        width: { type: "number", minimum: 0, description: "Width" },
        fillColor: {
          type: "object",
          properties: { r: channel, g: channel, b: channel, a: channel },
          required: ["r", "g", "b"],
          additionalProperties: false,
          description: "Fill color",
        },
      },
      required: ["width"],
      additionalProperties: false,
      $schema: "http://json-schema.org/draft-07/schema#",
    };
    expect(slimJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        width: { type: "number", minimum: 0, description: "Width" },
        fillColor: {
          type: "object",
          properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } },
          required: ["r", "g", "b"],
          description: "Fill color (RGBA, 0-1)",
        },
      },
      required: ["width"],
    });
  });
});
