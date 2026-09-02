import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "./document-tools";
import { registerCreationTools } from "./creation-tools";
import { registerModificationTools } from "./modification-tools";
import { registerTextTools } from "./text-tools";
import { registerComponentTools } from "./component-tools";
import { registerImageTools } from "./image-tools";
import { registerSvgTools } from "./svg-tools";
import { registerVariableTools } from "./variable-tools";
import { registerFigJamTools } from "./figjam-tools";
import { registerStyleTools } from "./style-tools";
import { registerCommentTools } from "./comment-tools";
import { registerConnectionTools } from "./connection-tools";
import { registerSectionScopeTools } from "./section-scope-tools";
import { registerActivityTools } from "./activity-tools";
import { registerDesignSystemTools } from "./design-system-tools";
import { registerResponsiveTools } from "./responsive-tools";
import { registerBatchTools } from "./batch-tools";
import { getProfile, makeToolFilter } from "../config/profiles";
import { logger } from "../utils/logger";
import { capResponse } from "../utils/respond";

/**
 * Register all Figma tools to the MCP server.
 *
 * Registration is filtered by the active profile (FIGMA_MCP_PROFILE). The tool
 * schema is re-sent on every model request, so advertising 114 tools when a
 * session needs 40 is a recurring cost paid for nothing. Filtering here — rather
 * than inside each category module — keeps every registrar unchanged and lets a
 * profile cut across categories.
 *
 * @param server - The MCP server instance
 */
export function registerTools(server: McpServer): void {
  const profile = getProfile();
  const allow = makeToolFilter(profile);

  // Temporarily intercept `tool` so a registration for an out-of-profile tool
  // becomes a no-op. Restored before returning so nothing else is affected.
  const originalTool = server.tool.bind(server);
  let registered = 0;
  let skipped = 0;

  (server as any).tool = (...args: unknown[]) => {
    const name = args[0];
    if (typeof name === "string" && !allow(name)) {
      skipped++;
      return undefined;
    }
    registered++;

    // Wrap the handler so every tool result passes through the response size
    // cap. Doing it here means a new tool inherits the ceiling for free.
    const handlerIndex = args.length - 1;
    const handler = args[handlerIndex];
    if (typeof handler === "function") {
      const inner = handler as (...a: unknown[]) => unknown;
      args[handlerIndex] = async (...handlerArgs: unknown[]) =>
        capResponse(await inner(...handlerArgs));
    }

    return (originalTool as (...a: unknown[]) => unknown)(...args);
  };

  try {
    // Batched execution — registered first so it is the model's most visible
    // option, and because it is the cheapest way to run anything below.
    registerBatchTools(server);

    // Local design library inspection — see tools/design-system-tools.ts.
    // Registered early because the "reuse before creating" rule requires it to be
    // called before any creation tool.
    registerDesignSystemTools(server);
    // Responsive website generation — see tools/responsive-tools.ts
    registerResponsiveTools(server);

    // Register all tool categories
    registerDocumentTools(server);
    registerCreationTools(server);
    registerModificationTools(server);
    registerTextTools(server);
    registerComponentTools(server);
    registerImageTools(server);
    registerSvgTools(server);
    registerVariableTools(server);
    registerFigJamTools(server);
    registerStyleTools(server);
    // REST-based (no plugin channel required) — see tools/comment-tools.ts
    registerCommentTools(server);
    // Connection diagnostics + REST cross-verification — see tools/connection-tools.ts
    registerConnectionTools(server);
    // Section scope enforcement — see tools/section-scope-tools.ts
    registerSectionScopeTools(server);
    // Live activity tracking — see tools/activity-tools.ts
    registerActivityTools(server);
  } finally {
    (server as any).tool = originalTool;
  }

  logger.info(
    `Tool profile "${profile}": ${registered} tools registered, ${skipped} withheld ` +
      `(still reachable via figma_batch).`
  );
}

// Export all tool registration functions for individual usage if needed
export {
  registerDocumentTools,
  registerCreationTools,
  registerModificationTools,
  registerTextTools,
  registerComponentTools,
  registerImageTools,
  registerSvgTools,
  registerVariableTools,
  registerFigJamTools,
  registerStyleTools,
  registerCommentTools,
  registerConnectionTools,
  registerSectionScopeTools,
  registerActivityTools,
  registerDesignSystemTools,
  registerResponsiveTools,
  registerBatchTools,
};
