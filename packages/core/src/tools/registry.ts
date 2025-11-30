import type { ToolDefinition } from "../llm/providers/types";
import type { Tool, ToolResult, ToolContext, ToolRiskTier } from "./types";

// Tool registry singleton
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((tool) => tool.definition);
  }

  getRiskTier(name: string): ToolRiskTier | undefined {
    return this.get(name)?.riskTier;
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Unknown tool: ${name}`,
      };
    }

    try {
      return await tool.execute(args, context);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: "",
        error: `Tool execution failed: ${errorMessage}`,
      };
    }
  }
}

// Global registry instance
export const toolRegistry = new ToolRegistry();

// Helper to check if a tool requires approval
export function requiresApproval(toolName: string): boolean {
  const tier = toolRegistry.getRiskTier(toolName);
  return tier === "destructive";
}

// Helper to check if a tool can auto-execute
export function canAutoExecute(toolName: string): boolean {
  const tier = toolRegistry.getRiskTier(toolName);
  return tier === "read_only" || tier === "safe_write";
}
