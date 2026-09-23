import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { coerceBoolean, coerceJson } from "../utils/schema-helpers";
import { logger } from "../utils/logger";
import { sendCommandToWebflow } from "../utils/websocket";

/**
 * Webflow Designer tools — the canvas half.
 *
 * These are the counterpart to `webflow-tools.ts`. That module talks to the
 * Data API over HTTP and owns *content*; this one drives Webflow's **Designer
 * API**, which owns elements, styles, variables and components, and which only
 * exists inside a Designer Extension running in the browser.
 *
 * So these tools take the same route the Figma tools do — the WebSocket relay
 * in `src/socket.ts` — with one difference: each command carries
 * `target: "webflow"`, and the relay delivers it to the extension that joined
 * the channel with `role: "webflow"` instead of to the Figma plugin. Channel
 * isolation, the per-channel command queue, the timeout and the activity feed
 * are all shared, unchanged.
 *
 * WHY A CHANNEL AND NOT A SITE ID
 * -------------------------------
 * Webflow's own bridge routes by `siteId` and emits to *every* extension
 * session registered for that site, with no queue. Two agents on one site
 * therefore interleave silently, and a mismatched message is dropped with no
 * reply at all, so the caller waits out the timeout and is told the app is not
 * running. Addressing a channel instead gives one agent one editor, and the
 * existing queue serialises the writes.
 *
 * WHAT THESE ARE FOR
 * ------------------
 * CLAUDE.md section 17 is the standard these exist to make enforceable:
 * colour as variables and never hard-coded, typography on the global tag
 * selectors before any class, and repeated structure as components carrying the
 * designer's own property and variant names. Each tool below is shaped so the
 * compliant path is the easy one.
 */

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

const fail = (context: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${context}: ${message}`);
  return {
    content: [{ type: "text" as const, text: `❌ ${context}: ${message}` }],
    isError: true,
  };
};

/** Render whatever the extension sent back, without pretending to know its shape. */
function render(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

const CONNECT_HINT =
  "Requires the Webflow Designer extension to be open and joined to this channel " +
  "(Designer → Apps panel → the extension → same channel ID). Run " +
  "webflow_designer_status first if unsure.";

export function registerWebflowDesignerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_designer_status",
    "Check whether a Webflow Designer extension is connected to this channel and which site and page it currently has open. Call this before any other webflow_designer_* tool: everything here needs a live extension, and this is the only way to find out without waiting out a two-minute timeout.",
    {},
    async () => {
      try {
        const result = await sendCommandToWebflow("webflow_status", {}, 20000);
        return ok(`✅ Webflow Designer extension connected.\n\n${render(result)}`);
      } catch (error) {
        return fail(
          "No Webflow Designer extension on this channel",
          error instanceof Error
            ? new Error(
                `${error.message}\n\nOpen the site in the Webflow Designer, open the Apps panel (press E), launch the extension, and join channel with the same ID this session used.`
              )
            : error
        );
      }
    }
  );

  // -------------------------------------------------------------------------
  // Reading the canvas
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_designer_get_structure",
    `Read the element tree of the current Webflow page: ids, tag names, applied classes and text content. This is the Webflow-side counterpart of get_node_info, and the thing to compare against the Figma frame when auditing. ${CONNECT_HINT}`,
    {
      elementId: z
        .string()
        .optional()
        .describe("Read one subtree. Omit for the whole page."),
      depth: z
        .number()
        .optional()
        .describe("How many levels to descend. Keep it small on a large page; the response is capped."),
    },
    async ({ elementId, depth }) => {
      try {
        const result = await sendCommandToWebflow("webflow_get_structure", { elementId, depth });
        return ok(render(result));
      } catch (error) {
        return fail("Error reading the Webflow page structure", error);
      }
    }
  );

  server.tool(
    "webflow_designer_get_styles",
    `List the styles (classes) defined on the site, with the properties each one sets. Read this before creating a class: reusing an existing class is what keeps the build component-based instead of a pile of one-off styling, and a duplicate class under a slightly different name is the usual way that slips. ${CONNECT_HINT}`,
    {},
    async () => {
      try {
        return ok(render(await sendCommandToWebflow("webflow_get_styles", {})));
      } catch (error) {
        return fail("Error listing Webflow styles", error);
      }
    }
  );

  server.tool(
    "webflow_designer_get_variables",
    `List the site's variable collections and their variables, with ids, types and resolved values. Read this before binding anything: section 17.2 requires every colour to reference a variable, and binding needs the id. ${CONNECT_HINT}`,
    {},
    async () => {
      try {
        return ok(render(await sendCommandToWebflow("webflow_get_variables", {})));
      } catch (error) {
        return fail("Error listing Webflow variables", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Variables — section 17.2
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_designer_create_variables",
    "Create Webflow variables in bulk, normally straight from a Figma collection so the two systems stay traceable. Keep the Figma names verbatim (spacing/40, color/brand/primary). Create these before building anything: a style written against a literal has to be rewritten later, one written against a variable does not.",
    {
      collection: z
        .string()
        .optional()
        .describe("Variable collection name. Omit to use the site's default collection."),
      variables: coerceJson(
        z.array(
          z.object({
            name: z.string().describe("Variable name, ideally the Figma name unchanged."),
            type: z
              .enum(["color", "size", "percentage", "number", "fontFamily"])
              .describe(
                "Webflow variable type. Figma COLOR → color; FLOAT used for spacing, radius or font size → size; STRING used for a font → fontFamily."
              ),
            value: z
              .string()
              .describe("Value, e.g. '#1a1a1a', '40px', '1.5rem', 'Inter'."),
          })
        )
      ).describe("The variables to create."),
    },
    async ({ collection, variables }) => {
      try {
        if (variables.length === 0) {
          return fail("Nothing to create", new Error("Pass at least one variable."));
        }
        const result = await sendCommandToWebflow("webflow_create_variables", {
          collection,
          variables,
        });
        return ok(
          `✅ Created ${variables.length} variable${variables.length === 1 ? "" : "s"}.\n\n${render(result)}`
        );
      } catch (error) {
        return fail("Error creating Webflow variables", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Typography on tags — section 17.2
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_designer_set_tag_style",
    "Set the base typography on a global tag selector — h1–h6, paragraph, or body. Section 17.2 requires this BEFORE any class exists: it is what makes an unstyled heading anywhere on the site come out right, and it is the difference between a design system and a pile of classes. Take the values from the matching Figma text style. A class may afterwards carry only what genuinely differs from its tag, and must never restate the tag's values.",
    {
      tag: z
        .enum(["body", "h1", "h2", "h3", "h4", "h5", "h6", "paragraph", "link", "blockquote"])
        .describe("The tag selector to style."),
      properties: coerceJson(z.record(z.string())).describe(
        "CSS property → value, e.g. {\"font-size\":\"48px\",\"line-height\":\"1.1\",\"font-weight\":\"700\"}. Use a variable reference rather than a raw colour."
      ),
      breakpoint: z
        .enum(["main", "medium", "small", "tiny"])
        .optional()
        .describe(
          "Webflow breakpoint: main (desktop, 992+), medium (tablet, ≤991), small (mobile landscape, ≤767), tiny (mobile portrait, ≤479). Omit for main. Author main first — Webflow's cascade only flows downward."
        ),
    },
    async ({ tag, properties, breakpoint }) => {
      try {
        const result = await sendCommandToWebflow("webflow_set_tag_style", {
          tag,
          properties,
          breakpoint: breakpoint ?? "main",
        });
        return ok(
          `✅ Base style set on <${tag}>${breakpoint && breakpoint !== "main" ? ` at ${breakpoint}` : ""}.\n\n${render(result)}`
        );
      } catch (error) {
        return fail("Error setting the Webflow tag style", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_designer_set_style",
    "Create or update a Webflow class and its properties. Check webflow_designer_get_styles first and reuse an existing class rather than minting a near-duplicate. A class on a text element should carry ONLY what differs from its tag style — restating the tag's line height here is what silently breaks when the base changes later. Reference variables instead of raw colours; a hard-coded colour is a defect under section 17.2.",
    {
      name: z.string().describe("Class name, by role: section-hero, card-feature, heading-title."),
      properties: coerceJson(z.record(z.string())).describe(
        "CSS property → value. Use variable references for colour, spacing and radius."
      ),
      breakpoint: z
        .enum(["main", "medium", "small", "tiny"])
        .optional()
        .describe("Breakpoint to author on. Omit for main (desktop). Finish main before going down."),
      inheritsFrom: z
        .string()
        .optional()
        .describe("Parent class name, to create this as a combo class."),
    },
    async ({ name, properties, breakpoint, inheritsFrom }) => {
      try {
        const result = await sendCommandToWebflow("webflow_set_style", {
          name,
          properties,
          breakpoint: breakpoint ?? "main",
          inheritsFrom,
        });
        return ok(`✅ Style "${name}" applied.\n\n${render(result)}`);
      } catch (error) {
        return fail("Error setting the Webflow style", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Elements
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_designer_create_element",
    `Create an element on the Webflow canvas. Build top to bottom, one section at a time, verifying each before the next — a whole page built blind is a whole page to debug. Give every repeated element the SAME class rather than styling two identical cards separately. ${CONNECT_HINT}`,
    {
      parentId: z
        .string()
        .optional()
        .describe("Element id to insert into, from webflow_designer_get_structure. Omit for the page body."),
      tag: z
        .string()
        .describe("Element type: div, section, container, h1-h6, paragraph, link, image, button, list, listitem, embed."),
      className: z.string().optional().describe("Class to apply on creation."),
      text: z.string().optional().describe("Text content, for a text element."),
      attributes: coerceJson(z.record(z.string())).optional().describe("Custom attributes, e.g. alt or href."),
      position: z
        .enum(["append", "prepend", "before", "after"])
        .optional()
        .describe("Where to place it relative to the parent or sibling. Default append."),
    },
    async ({ parentId, tag, className, text, attributes, position }) => {
      try {
        const result = await sendCommandToWebflow("webflow_create_element", {
          parentId,
          tag,
          className,
          text,
          attributes,
          position: position ?? "append",
        });
        return ok(`✅ Created <${tag}>.\n\n${render(result)}`);
      } catch (error) {
        return fail("Error creating the Webflow element", error);
      }
    }
  );

  server.tool(
    "webflow_designer_set_text",
    `Replace the text of an existing element. Use the copy from the Figma frame exactly — never invent, shorten or "improve" it. ${CONNECT_HINT}`,
    {
      elementId: z.string().describe("Element id from webflow_designer_get_structure."),
      text: z.string().describe("The exact copy from the design."),
    },
    async ({ elementId, text }) => {
      try {
        return ok(render(await sendCommandToWebflow("webflow_set_text", { elementId, text })));
      } catch (error) {
        return fail("Error setting the Webflow element text", error);
      }
    }
  );

  server.tool(
    "webflow_designer_delete_element",
    "Delete an element and its children from the canvas. Destructive: show the user what will go before calling it.",
    {
      elementId: z.string().describe("Element id to remove."),
      confirm: coerceBoolean.describe("Must be true. Deleting takes the element's children with it."),
    },
    async ({ elementId, confirm }) => {
      try {
        if (!confirm) {
          return fail(
            "Deletion was not confirmed",
            new Error("This removes the element and everything inside it. Ask the user, then call again with confirm: true.")
          );
        }
        return ok(render(await sendCommandToWebflow("webflow_delete_element", { elementId })));
      } catch (error) {
        return fail("Error deleting the Webflow element", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Components — section 17.3
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_designer_create_component",
    "Turn an element into a reusable Webflow component, carrying the Figma component's properties and variants across. Section 17.3 requires this for anything appearing more than once — button, card, nav bar, footer, list row. Keep the designer's exact property and variant names: renaming breaks their ability to talk about it. A Figma property Webflow cannot express is reported, never flattened into a hard-coded value.",
    {
      elementId: z.string().describe("The element to convert, already built and checked against the design."),
      name: z.string().describe("Component name, by role: Card-Pricing, Button-Primary."),
      properties: coerceJson(
        z.array(
          z.object({
            name: z.string().describe("Property name, exactly as Figma has it (e.g. 'Button Style')."),
            type: z
              .enum(["text", "visibility", "image", "link", "slot"])
              .describe(
                "Figma text property → text; boolean show/hide → visibility; image/fill → image; link/URL → link; instance swap → slot."
              ),
            targetElementId: z
              .string()
              .optional()
              .describe("Element inside the component this property drives."),
          })
        )
      )
        .optional()
        .describe("Component properties, mapped from the Figma component's properties."),
      variants: coerceJson(z.array(z.string()))
        .optional()
        .describe(
          "Variant names from the Figma variant property values, e.g. ['Primary','Secondary']. Variants that change structure rather than styling may need separate components — decide, then say which you chose and why."
        ),
    },
    async ({ elementId, name, properties, variants }) => {
      try {
        const result = await sendCommandToWebflow("webflow_create_component", {
          elementId,
          name,
          properties,
          variants,
        });
        return ok(
          `✅ Component "${name}" created` +
            (properties?.length ? ` with ${properties.length} propert${properties.length === 1 ? "y" : "ies"}` : "") +
            (variants?.length ? ` and ${variants.length} variant${variants.length === 1 ? "" : "s"}` : "") +
            `.\n\n${render(result)}`
        );
      } catch (error) {
        return fail("Error creating the Webflow component", error);
      }
    }
  );

  server.tool(
    "webflow_designer_insert_component",
    `Place an instance of an existing component. Override only what differs per occurrence — text, image, a variant — never the styling. ${CONNECT_HINT}`,
    {
      componentId: z.string().describe("Component id, from webflow_designer_get_structure."),
      parentId: z.string().optional().describe("Element to insert into. Omit for the page body."),
      variant: z.string().optional().describe("Variant name to use, if the component has variants."),
      overrides: coerceJson(z.record(z.string()))
        .optional()
        .describe("Property name → value, for this instance only."),
    },
    async ({ componentId, parentId, variant, overrides }) => {
      try {
        const result = await sendCommandToWebflow("webflow_insert_component", {
          componentId,
          parentId,
          variant,
          overrides,
        });
        return ok(`✅ Component instance placed.\n\n${render(result)}`);
      } catch (error) {
        return fail("Error inserting the Webflow component", error);
      }
    }
  );
}
