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
  githubListFilesTool,
} from "./github";

// Register all tools
export function registerAllTools(): void {
  // CloudWatch tools (read_only)
  toolRegistry.register(cloudwatchQueryLogsTool);

  // GitHub tools
  toolRegistry.register(githubSearchCodeTool); // read_only
  toolRegistry.register(githubGetFileTool); // read_only
  toolRegistry.register(githubListFilesTool); // read_only
  toolRegistry.register(githubCreateDraftPRTool); // safe_write
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
} from "./github";
