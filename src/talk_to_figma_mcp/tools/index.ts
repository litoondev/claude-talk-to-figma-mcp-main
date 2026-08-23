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

/**
 * Register all Figma tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerTools(server: McpServer): void {
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
};