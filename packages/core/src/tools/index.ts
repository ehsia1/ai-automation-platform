// Export types
export * from "./types";

// Export registry
export * from "./registry";

// Import tools for registration
import { toolRegistry } from "./registry";
import { cloudwatchQueryLogsTool } from "./cloudwatch";
import {
  githubSearchCodeTool,
  githubGetFileTool,
  githubCreateDraftPRTool,
  githubCreateSingleFilePRTool,
  githubListFilesTool,
  githubEditFileTool,
} from "./github";
import { postgresQueryTool, postgresSchemaTool } from "./database";
import { apiCallTool, listIntegrationsTool } from "../integrations/tool";
import { serviceLookupTool } from "./service-lookup";

// Register all tools
export function registerAllTools(): void {
  // CloudWatch tools (read_only)
  toolRegistry.register(cloudwatchQueryLogsTool);

  // GitHub tools
  toolRegistry.register(githubSearchCodeTool); // read_only
  toolRegistry.register(githubGetFileTool); // read_only
  toolRegistry.register(githubListFilesTool); // read_only
  toolRegistry.register(githubCreateDraftPRTool); // safe_write
  toolRegistry.register(githubCreateSingleFilePRTool); // safe_write - simpler version for single file
  toolRegistry.register(githubEditFileTool); // safe_write - search & replace edits (PREFERRED)

  // Database tools (read_only)
  toolRegistry.register(postgresQueryTool); // read_only - SELECT only
  toolRegistry.register(postgresSchemaTool); // read_only - schema discovery

  // Integration tools (dynamic API calling)
  toolRegistry.register(apiCallTool); // safe_write - call any configured API
  toolRegistry.register(listIntegrationsTool); // read_only - discover integrations

  // Service registry tool (read_only)
  toolRegistry.register(serviceLookupTool); // read_only - find service info
}

// Auto-register on import
registerAllTools();

// Re-export individual tools for direct access
export { cloudwatchQueryLogsTool } from "./cloudwatch";
export {
  githubSearchCodeTool,
  githubGetFileTool,
  githubListFilesTool,
  githubCreateDraftPRTool,
  githubCreateSingleFilePRTool,
  githubEditFileTool,
} from "./github";
export { postgresQueryTool, postgresSchemaTool } from "./database";
export { apiCallTool, listIntegrationsTool } from "../integrations/tool";
export { serviceLookupTool } from "./service-lookup";
