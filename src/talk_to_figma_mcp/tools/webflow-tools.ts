import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { coerceBoolean, coerceJson } from "../utils/schema-helpers";
import { logger } from "../utils/logger";
import {
  createItems,
  createSite,
  deleteItems,
  getCollection,
  getPage,
  getPageContent,
  getSite,
  listCollections,
  listItems,
  listPages,
  listSites,
  publishItems,
  publishSite,
  updateItems,
  updatePageContent,
  updatePageSettings,
  type WebflowCollection,
  type WebflowDomNode,
  type WebflowItem,
  type WebflowPage,
  type WebflowSite,
} from "../utils/webflow-rest";

/**
 * Webflow Data API tools.
 *
 * Like the comment tools, these do NOT go through the WebSocket relay — they
 * call Webflow's REST API with a token (WEBFLOW_TOKEN) and work with no Figma
 * plugin channel open. `join_channel` is not a prerequisite.
 *
 * WHAT THESE CAN AND CANNOT DO
 * ----------------------------
 * Webflow splits its API the way Figma does. The Data API reached here owns
 * *content*: sites, pages, page SEO, the text inside existing nodes, CMS
 * collections and items, and publishing. The canvas — elements, styles,
 * classes, variables, components — belongs to Webflow's **Designer API**, which
 * only runs inside a Designer Extension, exactly as this project's own plugin
 * runs inside Figma.
 *
 * That limit is stated on the tools it actually governs (see CANVAS_NOTE), not
 * on all of them. Repeating it everywhere taught the model to reach for it as a
 * general excuse: asked to create a site, it answered that site creation
 * "requires the Designer API". It does not — creating a site is a Data API call
 * (`webflow_create_site`) gated on an Enterprise plan. Each tool now carries the
 * limit that applies to it and no other, and `webflow_list_sites` carries the
 * map of what this server does and does not implement, so an unimplemented
 * endpoint is reported as a gap here rather than as a limit of Webflow.
 *
 * WHY THESE ARE SAFE TO RUN IN PARALLEL
 * -------------------------------------
 * Every call is addressed by an explicit id and holds no session state. There
 * is no "current active page" to fight over, so several people on several
 * machines can use these at the same time — unlike the Designer half, which
 * must be serialised to one agent per site.
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

/**
 * Note about canvas structure, for the few tools where a model might otherwise
 * try to build layout.
 *
 * It is deliberately NOT on every tool. When it was, the model generalised it
 * into a universal excuse and told a user that creating a *site* "requires the
 * Designer API" — which is false; site creation is a Data API call gated on an
 * Enterprise plan. A limit stated in the wrong place is worse than no limit,
 * because it gets applied to things it was never about.
 */
const CANVAS_NOTE =
  "Structure note: page layout — elements, classes, variables, components — cannot be " +
  "created or restyled through the Data API; that is Webflow's Designer API, which runs " +
  "only inside a Designer Extension. This limit is about canvas structure only, and says " +
  "nothing about sites, pages, CMS or publishing.";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatSite(site: WebflowSite): string {
  const domains = site.customDomains?.length
    ? site.customDomains.map((d) => d.url).join(", ")
    : "(none — Webflow subdomain only)";
  return [
    `${site.displayName}`,
    `  id:            ${site.id}`,
    `  workspace id:  ${site.workspaceId ?? "(not returned)"}`,
    `  short name:    ${site.shortName ?? "(unset)"}`,
    `  preview:       ${site.previewUrl ?? "(unset)"}`,
    `  custom domains:${domains}`,
    `  last published:${site.lastPublished ?? "never"}`,
  ].join("\n");
}

function formatPage(page: WebflowPage): string {
  const flags = [
    page.draft ? "draft" : null,
    page.archived ? "archived" : null,
    page.collectionId ? `CMS template for collection ${page.collectionId}` : null,
  ].filter(Boolean);
  return [
    `${page.title ?? "(untitled)"}  /${page.slug ?? ""}`,
    `  id:    ${page.id}`,
    flags.length ? `  flags: ${flags.join(", ")}` : null,
    `  seo:   title=${page.seo?.title ?? "(unset)"} | description=${page.seo?.description ?? "(unset)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCollection(collection: WebflowCollection): string {
  return `${collection.displayName}  (slug: ${collection.slug})\n  id: ${collection.id}`;
}

function formatItem(item: WebflowItem): string {
  const name = (item.fieldData?.name as string) ?? "(no name field)";
  const slug = (item.fieldData?.slug as string) ?? "";
  const state = [item.isDraft ? "draft" : null, item.isArchived ? "archived" : null]
    .filter(Boolean)
    .join(", ");
  return `${name}${slug ? `  /${slug}` : ""}\n  id: ${item.id}${state ? `  [${state}]` : ""}  last published: ${item.lastPublished ?? "never"}`;
}

/** Render a DOM node as the model needs to see it to rewrite its copy. */
function formatDomNode(node: WebflowDomNode): string {
  const body = node.text?.text ?? node.text?.html ?? "";
  const preview = body.length > 160 ? `${body.slice(0, 160)}…` : body;
  return `${node.id}  [${node.type ?? "node"}]\n  ${preview.replace(/\n/g, "\n  ")}`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerWebflowTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // Sites
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_list_sites",
    "List every Webflow site the configured WEBFLOW_TOKEN can reach, with ids, workspace ids, custom domains and last-published time. Call this first: it discovers site ids, gives you the workspaceId other tools need, and proves the token works. A site token sees exactly one site; a workspace token sees the workspace. " +
      "These webflow_* tools cover sites, pages, page SEO, page copy, CMS collections and items, and publishing. They do not cover page layout (see webflow_get_page_content) and they do not cover assets, forms, redirects or webhooks — those are simply not implemented here yet, which is a gap in this server, not a limit of Webflow.",
    {},
    async () => {
      try {
        const sites = await listSites();
        if (sites.length === 0) {
          return ok(
            "✅ Token is valid, but it can reach no sites.\n\n" +
              "A site token is scoped to the site it was minted on. If you expected more, " +
              "generate the token on the right site, or use a workspace token."
          );
        }
        return ok(
          `✅ ${sites.length} site${sites.length === 1 ? "" : "s"} reachable:\n\n` +
            sites.map(formatSite).join("\n\n")
        );
      } catch (error) {
        return fail("Error listing Webflow sites", error);
      }
    }
  );

  server.tool(
    "webflow_get_site",
    "Get one Webflow site's details: display name, custom domains, preview URL and last-published time. Use it to confirm which domains webflow_publish_site would push to before publishing.",
    {
      siteId: z.string().describe("Webflow site id, from webflow_list_sites."),
    },
    async ({ siteId }) => {
      try {
        return ok(`✅ Site:\n\n${formatSite(await getSite(siteId))}`);
      } catch (error) {
        return fail("Error reading Webflow site", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_list_pages",
    "List a site's pages with ids, slugs, SEO fields and draft/archived state. CMS template pages are marked with the collection they render.",
    {
      siteId: z.string().describe("Webflow site id."),
      limit: z.number().optional().describe("Max pages to return (Webflow's default is 100)."),
      offset: z.number().optional().describe("Pagination offset."),
      localeId: z.string().optional().describe("Locale id, for a localised site."),
    },
    async ({ siteId, limit, offset, localeId }) => {
      try {
        const { pages, pagination } = await listPages(siteId, { limit, offset, localeId });
        if (pages.length === 0) return ok("No pages returned for this site.");
        const more =
          pagination?.total && pagination.total > pages.length
            ? `\n\n(${pages.length} of ${pagination.total} — raise limit or use offset for the rest.)`
            : "";
        return ok(
          `✅ ${pages.length} page${pages.length === 1 ? "" : "s"}:\n\n` +
            pages.map(formatPage).join("\n\n") +
            more
        );
      } catch (error) {
        return fail("Error listing Webflow pages", error);
      }
    }
  );

  server.tool(
    "webflow_get_page",
    "Get one page's settings: title, slug, SEO title and description, Open Graph fields, and draft/archived state.",
    {
      pageId: z.string().describe("Webflow page id, from webflow_list_pages."),
      localeId: z.string().optional().describe("Locale id, for a localised site."),
    },
    async ({ pageId, localeId }) => {
      try {
        const page = await getPage(pageId, localeId);
        return ok(
          `✅ Page:\n\n${formatPage(page)}\n` +
            `  open graph: title=${page.openGraph?.title ?? "(inherits SEO title)"} | ` +
            `description=${page.openGraph?.description ?? "(inherits SEO description)"}`
        );
      } catch (error) {
        return fail("Error reading Webflow page", error);
      }
    }
  );

  server.tool(
    "webflow_update_page_settings",
    `Update a page's title, slug, SEO title/description or Open Graph fields. Only the fields you pass are changed. Changing a slug changes the page's public URL and does not create a redirect — say so before doing it. ${CANVAS_NOTE}`,
    {
      pageId: z.string().describe("Webflow page id."),
      title: z.string().optional().describe("Page title, as shown in the Designer."),
      slug: z
        .string()
        .optional()
        .describe("URL slug. Changing this changes the live URL and breaks existing links."),
      seoTitle: z.string().optional().describe("SEO <title>."),
      seoDescription: z.string().optional().describe("SEO meta description."),
      openGraphTitle: z.string().optional().describe("Open Graph title, for social shares."),
      openGraphDescription: z.string().optional().describe("Open Graph description."),
      localeId: z.string().optional().describe("Locale id, for a localised site."),
    },
    async ({
      pageId,
      title,
      slug,
      seoTitle,
      seoDescription,
      openGraphTitle,
      openGraphDescription,
      localeId,
    }) => {
      try {
        const patch: Parameters<typeof updatePageSettings>[1] = {};
        if (title !== undefined) patch.title = title;
        if (slug !== undefined) patch.slug = slug;
        if (seoTitle !== undefined || seoDescription !== undefined) {
          patch.seo = {};
          if (seoTitle !== undefined) patch.seo.title = seoTitle;
          if (seoDescription !== undefined) patch.seo.description = seoDescription;
        }
        if (openGraphTitle !== undefined || openGraphDescription !== undefined) {
          patch.openGraph = {};
          if (openGraphTitle !== undefined) patch.openGraph.title = openGraphTitle;
          if (openGraphDescription !== undefined) {
            patch.openGraph.description = openGraphDescription;
          }
        }

        if (Object.keys(patch).length === 0) {
          return fail(
            "Nothing to update",
            new Error("Pass at least one of title, slug, seoTitle, seoDescription, openGraph*.")
          );
        }

        const page = await updatePageSettings(pageId, patch, localeId);
        return ok(
          `✅ Page updated (staged — publish the site to make it live):\n\n${formatPage(page)}`
        );
      } catch (error) {
        return fail("Error updating Webflow page settings", error);
      }
    }
  );

  server.tool(
    "webflow_get_page_content",
    `Read the editable text nodes on a page, each with the node id needed to rewrite it. Use this before webflow_update_page_content — the ids are the only way to target copy. Returns text, not structure: nodes cannot be added, moved or restyled through this API. ${CANVAS_NOTE}`,
    {
      pageId: z.string().describe("Webflow page id."),
      limit: z.number().optional().describe("Max nodes to return."),
      offset: z.number().optional().describe("Pagination offset."),
      localeId: z.string().optional().describe("Locale id, for a localised site."),
    },
    async ({ pageId, limit, offset, localeId }) => {
      try {
        const { nodes, pagination } = await getPageContent(pageId, { limit, offset, localeId });
        const textNodes = nodes.filter((node) => node.text);
        if (textNodes.length === 0) {
          return ok(
            "No editable text nodes on this page.\n\n" +
              "Pages built entirely from components or CMS bindings expose their copy through " +
              "the component or the collection item, not here."
          );
        }
        const more =
          pagination?.total && pagination.total > nodes.length
            ? `\n\n(${nodes.length} of ${pagination.total} — raise limit or use offset for the rest.)`
            : "";
        return ok(
          `✅ ${textNodes.length} editable text node${textNodes.length === 1 ? "" : "s"}:\n\n` +
            textNodes.map(formatDomNode).join("\n\n") +
            more
        );
      } catch (error) {
        return fail("Error reading Webflow page content", error);
      }
    }
  );

  server.tool(
    "webflow_update_page_content",
    `Rewrite the copy inside existing text nodes on a page. Every node id must come from webflow_get_page_content. Changes are staged until the site is published. Text only: this cannot add, delete, reorder or restyle a node. ${CANVAS_NOTE}`,
    {
      pageId: z.string().describe("Webflow page id."),
      nodes: coerceJson(
        z.array(
          z.object({
            nodeId: z.string().describe("Node id from webflow_get_page_content."),
            text: z
              .string()
              .describe("Replacement copy. Rich-text nodes accept the HTML Webflow returned."),
          })
        )
      ).describe("The nodes to rewrite."),
      localeId: z.string().optional().describe("Locale id, for a localised site."),
    },
    async ({ pageId, nodes, localeId }) => {
      try {
        if (nodes.length === 0) {
          return fail("Nothing to update", new Error("Pass at least one node."));
        }
        await updatePageContent(pageId, nodes, localeId);
        return ok(
          `✅ Rewrote ${nodes.length} text node${nodes.length === 1 ? "" : "s"}.\n\n` +
            "Staged, not live. Publish the site to make it public."
        );
      } catch (error) {
        return fail("Error updating Webflow page content", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // CMS
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_list_collections",
    "List a site's CMS collections with ids and slugs. Start here for any content work: a repeating row of cards on a Webflow site is usually a collection, and editing the collection changes every card at once.",
    {
      siteId: z.string().describe("Webflow site id."),
    },
    async ({ siteId }) => {
      try {
        const collections = await listCollections(siteId);
        if (collections.length === 0) return ok("This site has no CMS collections.");
        return ok(
          `✅ ${collections.length} collection${collections.length === 1 ? "" : "s"}:\n\n` +
            collections.map(formatCollection).join("\n\n")
        );
      } catch (error) {
        return fail("Error listing Webflow collections", error);
      }
    }
  );

  server.tool(
    "webflow_get_collection",
    "Get a collection's field schema: every field's slug, type and whether it is required. Read this before creating or updating items — fieldData keys are field *slugs*, and a wrong slug or type is the usual cause of a rejected write.",
    {
      collectionId: z.string().describe("Collection id, from webflow_list_collections."),
    },
    async ({ collectionId }) => {
      try {
        const collection = await getCollection(collectionId);
        const fields = collection.fields ?? [];
        const rendered = fields.length
          ? fields
              .map(
                (field) =>
                  `  ${field.slug}  [${field.type}]${field.isRequired ? "  (required)" : ""}` +
                  `\n    display name: ${field.displayName}` +
                  (field.helpText ? `\n    help: ${field.helpText}` : "")
              )
              .join("\n")
          : "  (no fields returned)";
        return ok(`✅ ${formatCollection(collection)}\n\nFields:\n${rendered}`);
      } catch (error) {
        return fail("Error reading Webflow collection", error);
      }
    }
  );

  server.tool(
    "webflow_list_items",
    "List items in a CMS collection, with ids, names, slugs and draft/archived state. Filter by slug or name to find one item without paging through the collection.",
    {
      collectionId: z.string().describe("Collection id."),
      limit: z.number().optional().describe("Max items to return (Webflow's default is 100)."),
      offset: z.number().optional().describe("Pagination offset."),
      slug: z.string().optional().describe("Return only the item with this slug."),
      name: z.string().optional().describe("Return only items whose name matches."),
      cmsLocaleId: z.string().optional().describe("CMS locale id, for a localised collection."),
    },
    async ({ collectionId, limit, offset, slug, name, cmsLocaleId }) => {
      try {
        const { items, pagination } = await listItems(collectionId, {
          limit,
          offset,
          slug,
          name,
          cmsLocaleId,
        });
        if (items.length === 0) return ok("No items matched.");
        const more =
          pagination?.total && pagination.total > items.length
            ? `\n\n(${items.length} of ${pagination.total} — raise limit or use offset for the rest.)`
            : "";
        return ok(
          `✅ ${items.length} item${items.length === 1 ? "" : "s"}:\n\n` +
            items.map(formatItem).join("\n\n") +
            more
        );
      } catch (error) {
        return fail("Error listing Webflow collection items", error);
      }
    }
  );

  server.tool(
    "webflow_create_items",
    "Create CMS items in bulk. fieldData keys are field *slugs* from webflow_get_collection — read the schema first. Items are created staged, so nothing is public until they are published. Create as draft while content is still being reviewed.",
    {
      collectionId: z.string().describe("Collection id."),
      items: coerceJson(
        z.array(
          z.object({
            fieldData: z
              .record(z.unknown())
              .describe("Field slug → value. 'name' and 'slug' are required by most collections."),
            isDraft: coerceBoolean.optional().describe("Create as a draft. Default false."),
            isArchived: coerceBoolean.optional().describe("Create archived. Default false."),
          })
        )
      ).describe("The items to create."),
    },
    async ({ collectionId, items }) => {
      try {
        if (items.length === 0) {
          return fail("Nothing to create", new Error("Pass at least one item."));
        }
        const created = await createItems(collectionId, items);
        return ok(
          `✅ Created ${created.length || items.length} item${(created.length || items.length) === 1 ? "" : "s"} (staged):\n\n` +
            (created.length ? created.map(formatItem).join("\n\n") : "(ids not returned)") +
            "\n\nPublish the items or the site to make them public."
        );
      } catch (error) {
        return fail("Error creating Webflow collection items", error);
      }
    }
  );

  server.tool(
    "webflow_update_items",
    "Update CMS items in bulk. Each item needs its id, from webflow_list_items. Only the fieldData keys you pass are changed; omitted fields keep their current values. Changes are staged until published.",
    {
      collectionId: z.string().describe("Collection id."),
      items: coerceJson(
        z.array(
          z.object({
            id: z.string().describe("Item id from webflow_list_items."),
            fieldData: z
              .record(z.unknown())
              .optional()
              .describe("Field slug → new value. Omitted fields are left alone."),
            isDraft: coerceBoolean.optional().describe("Set or clear draft state."),
            isArchived: coerceBoolean.optional().describe("Set or clear archived state."),
          })
        )
      ).describe("The items to update."),
    },
    async ({ collectionId, items }) => {
      try {
        if (items.length === 0) {
          return fail("Nothing to update", new Error("Pass at least one item."));
        }
        const updated = await updateItems(collectionId, items);
        return ok(
          `✅ Updated ${updated.length || items.length} item${(updated.length || items.length) === 1 ? "" : "s"} (staged).\n\n` +
            "Publish the items or the site to make the changes public."
        );
      } catch (error) {
        return fail("Error updating Webflow collection items", error);
      }
    }
  );

  server.tool(
    "webflow_publish_items",
    "Publish staged CMS items so they appear on the live site. This is publicly visible immediately — confirm with the user before calling it. Publishing an item does not publish other staged changes on the site.",
    {
      collectionId: z.string().describe("Collection id."),
      itemIds: coerceJson(z.array(z.string())).describe("Item ids to publish."),
      confirm: coerceBoolean.describe(
        "Must be true. The user has to agree to publishing before this runs — it is visible to the public."
      ),
    },
    async ({ collectionId, itemIds, confirm }) => {
      try {
        if (!confirm) {
          return fail(
            "Publishing was not confirmed",
            new Error(
              "Publishing makes these items public immediately. Ask the user, then call again with confirm: true."
            )
          );
        }
        if (itemIds.length === 0) {
          return fail("Nothing to publish", new Error("Pass at least one item id."));
        }
        const result = await publishItems(collectionId, itemIds);
        const published = result.publishedItemIds?.length ?? itemIds.length;
        const errors = result.errors?.length
          ? `\n\n⚠️ ${result.errors.length} item(s) were rejected: ${JSON.stringify(result.errors).slice(0, 500)}`
          : "";
        return ok(`✅ Published ${published} item${published === 1 ? "" : "s"} live.${errors}`);
      } catch (error) {
        return fail("Error publishing Webflow collection items", error);
      }
    }
  );

  server.tool(
    "webflow_delete_items",
    "Delete CMS items. This is destructive and cannot be undone through the API — Webflow keeps no API-level trash for items. List the items for the user and get their agreement before calling it.",
    {
      collectionId: z.string().describe("Collection id."),
      itemIds: coerceJson(z.array(z.string())).describe("Item ids to delete."),
      confirm: coerceBoolean.describe(
        "Must be true. Deletion is permanent, so the user has to agree first."
      ),
    },
    async ({ collectionId, itemIds, confirm }) => {
      try {
        if (!confirm) {
          return fail(
            "Deletion was not confirmed",
            new Error(
              "Deleting CMS items cannot be undone. Show the user exactly which items, then call again with confirm: true."
            )
          );
        }
        if (itemIds.length === 0) {
          return fail("Nothing to delete", new Error("Pass at least one item id."));
        }
        await deleteItems(collectionId, itemIds);
        return ok(`✅ Deleted ${itemIds.length} item${itemIds.length === 1 ? "" : "s"}.`);
      } catch (error) {
        return fail("Error deleting Webflow collection items", error);
      }
    }
  );

  server.tool(
    "webflow_create_site",
    "Create a new Webflow site in a workspace. Requires an **Enterprise** workspace and a token with the workspace:write scope — on every other plan Webflow returns 403 no matter how the token is scoped, and the site has to be created in the Webflow dashboard instead (Dashboard → + New site). This is a Data API call; it has nothing to do with the Designer API. Get workspaceId from webflow_list_sites, or from the workspace URL in the Webflow dashboard.",
    {
      workspaceId: z
        .string()
        .describe(
          "Workspace id. Shown as workspaceId on any site from webflow_list_sites, or in the dashboard URL."
        ),
      name: z.string().describe("The new site's name."),
      templateName: z
        .string()
        .optional()
        .describe("Workspace or marketplace template to start from. Omit for a blank site."),
      parentFolderId: z.string().optional().describe("Parent folder id, to file the site."),
      confirm: coerceBoolean.describe(
        "Must be true. This creates a real site in the user's workspace, which may consume a site slot on their plan."
      ),
    },
    async ({ workspaceId, name, templateName, parentFolderId, confirm }) => {
      try {
        if (!confirm) {
          return fail(
            "Site creation was not confirmed",
            new Error(
              "Creating a site is a real change to the user's workspace and may consume a site slot. Ask first, then call again with confirm: true."
            )
          );
        }
        const site = await createSite(workspaceId, { name, templateName, parentFolderId });
        return ok(`✅ Site created:\n\n${formatSite(site)}`);
      } catch (error) {
        return fail("Error creating Webflow site", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------
  server.tool(
    "webflow_publish_site",
    "Publish a Webflow site, pushing every staged change to the named domains. This is the most outward-facing call in this server: it puts work on the public internet, including staged changes made by other people. Call webflow_get_site first, show the user which domains will receive it, and get their agreement.",
    {
      siteId: z.string().describe("Webflow site id."),
      customDomains: coerceJson(z.array(z.string()))
        .optional()
        .describe(
          "Custom domain ids to publish to, from webflow_get_site. Omit to publish only to the Webflow subdomain."
        ),
      publishToWebflowSubdomain: coerceBoolean
        .optional()
        .describe("Also publish to the site's webflow.io subdomain."),
      confirm: coerceBoolean.describe(
        "Must be true. Publishing is public and includes anyone else's staged changes, so the user has to agree first."
      ),
    },
    async ({ siteId, customDomains, publishToWebflowSubdomain, confirm }) => {
      try {
        if (!confirm) {
          return fail(
            "Publishing was not confirmed",
            new Error(
              "Publishing pushes every staged change on this site — including changes made by other people — to the public internet. " +
                "Call webflow_get_site, show the user the domains, then call again with confirm: true."
            )
          );
        }
        if (!customDomains?.length && publishToWebflowSubdomain === false) {
          return fail(
            "No publish target",
            new Error(
              "Pass customDomains, or leave publishToWebflowSubdomain unset/true, or nothing would be published."
            )
          );
        }
        const result = await publishSite(siteId, { customDomains, publishToWebflowSubdomain });
        const domains = result.customDomains?.length
          ? result.customDomains.map((d) => d.url).join(", ")
          : "the Webflow subdomain";
        return ok(`✅ Site published to ${domains}.`);
      } catch (error) {
        return fail("Error publishing Webflow site", error);
      }
    }
  );
}
