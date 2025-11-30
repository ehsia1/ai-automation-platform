import type { ToolDefinition } from "../llm/providers/types";

// Risk tiers for tool execution
export type ToolRiskTier = "read_only" | "safe_write" | "destructive";

// Result of tool execution
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// Context passed to tool execution
export interface ToolContext {
  workspaceId: string;
  runId: string;
  // AWS credentials are available via environment
  // GitHub token available via environment
}

// Tool implementation interface
export interface Tool {
  name: string;
  description: string;
  riskTier: ToolRiskTier;
  definition: ToolDefinition;
  execute(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
}

// Parsed tool call with validated arguments
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
