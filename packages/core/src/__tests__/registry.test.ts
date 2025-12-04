/**
 * Tests for tool registry
 * Run with: npx tsx packages/core/src/__tests__/registry.test.ts
 */

import type { Tool, ToolResult, ToolContext, ToolRiskTier } from "../tools/types";
import type { ToolDefinition } from "../llm/providers/types";

// Create a fresh registry for testing (can't use singleton)
class TestToolRegistry {
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

  clear(): void {
    this.tools.clear();
  }
}

// Helper to check if a tool requires approval
function requiresApproval(registry: TestToolRegistry, toolName: string): boolean {
  const tier = registry.getRiskTier(toolName);
  return tier === "destructive";
}

// Helper to check if a tool can auto-execute
function canAutoExecute(registry: TestToolRegistry, toolName: string): boolean {
  const tier = registry.getRiskTier(toolName);
  return tier === "read_only" || tier === "safe_write";
}

// Test utilities
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.log(`❌ ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

// Create mock tools for testing
function createMockTool(
  name: string,
  riskTier: ToolRiskTier,
  executeFn?: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
): Tool {
  const definition: ToolDefinition = {
    type: "function",
    function: {
      name,
      description: `Mock ${name} tool for testing`,
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "Test input" },
        },
        required: ["input"],
      },
    },
  };

  return {
    name,
    description: definition.function.description,
    riskTier,
    definition,
    execute: executeFn ?? (async (args) => ({
      success: true,
      output: `Executed ${name} with input: ${args.input}`,
    })),
  };
}

const mockContext: ToolContext = {
  workspaceId: "test-workspace",
  runId: "test-run-123",
};

async function runTests() {
  console.log("Running tool registry tests...\n");

  // Test 1: Register a tool
  await test("Register a tool successfully", async () => {
    const registry = new TestToolRegistry();
    const tool = createMockTool("test_tool", "read_only");

    registry.register(tool);

    const retrieved = registry.get("test_tool");
    if (!retrieved) throw new Error("Tool not found after registration");
    if (retrieved.name !== "test_tool") throw new Error("Wrong tool name");
  });

  // Test 2: Duplicate registration throws error
  await test("Duplicate registration throws error", async () => {
    const registry = new TestToolRegistry();
    const tool1 = createMockTool("duplicate_tool", "read_only");
    const tool2 = createMockTool("duplicate_tool", "safe_write");

    registry.register(tool1);

    try {
      registry.register(tool2);
      throw new Error("Should have thrown");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("already registered")) {
        throw new Error("Wrong error message");
      }
    }
  });

  // Test 3: Get returns undefined for unknown tool
  await test("Get returns undefined for unknown tool", async () => {
    const registry = new TestToolRegistry();

    const result = registry.get("nonexistent_tool");
    if (result !== undefined) throw new Error("Should return undefined");
  });

  // Test 4: GetAll returns all registered tools
  await test("GetAll returns all registered tools", async () => {
    const registry = new TestToolRegistry();
    registry.register(createMockTool("tool1", "read_only"));
    registry.register(createMockTool("tool2", "safe_write"));
    registry.register(createMockTool("tool3", "destructive"));

    const all = registry.getAll();
    if (all.length !== 3) throw new Error(`Expected 3 tools, got ${all.length}`);

    const names = all.map(t => t.name).sort();
    if (names[0] !== "tool1" || names[1] !== "tool2" || names[2] !== "tool3") {
      throw new Error(`Wrong tool names: ${names}`);
    }
  });

  // Test 5: GetDefinitions returns tool definitions
  await test("GetDefinitions returns tool definitions", async () => {
    const registry = new TestToolRegistry();
    registry.register(createMockTool("def_tool", "read_only"));

    const definitions = registry.getDefinitions();
    if (definitions.length !== 1) throw new Error("Wrong definition count");
    if (definitions[0].function.name !== "def_tool") throw new Error("Wrong definition name");
    if (definitions[0].type !== "function") throw new Error("Wrong definition type");
  });

  // Test 6: GetRiskTier returns correct tier
  await test("GetRiskTier returns correct tier", async () => {
    const registry = new TestToolRegistry();
    registry.register(createMockTool("read_tool", "read_only"));
    registry.register(createMockTool("write_tool", "safe_write"));
    registry.register(createMockTool("danger_tool", "destructive"));

    if (registry.getRiskTier("read_tool") !== "read_only") {
      throw new Error("Wrong tier for read_tool");
    }
    if (registry.getRiskTier("write_tool") !== "safe_write") {
      throw new Error("Wrong tier for write_tool");
    }
    if (registry.getRiskTier("danger_tool") !== "destructive") {
      throw new Error("Wrong tier for danger_tool");
    }
    if (registry.getRiskTier("unknown") !== undefined) {
      throw new Error("Should return undefined for unknown tool");
    }
  });

  // Test 7: Execute runs tool successfully
  await test("Execute runs tool successfully", async () => {
    const registry = new TestToolRegistry();
    registry.register(createMockTool("exec_tool", "read_only"));

    const result = await registry.execute(
      "exec_tool",
      { input: "test value" },
      mockContext
    );

    if (!result.success) throw new Error("Execution should succeed");
    if (!result.output.includes("test value")) {
      throw new Error(`Output missing input: ${result.output}`);
    }
  });

  // Test 8: Execute unknown tool returns error
  await test("Execute unknown tool returns error", async () => {
    const registry = new TestToolRegistry();

    const result = await registry.execute(
      "unknown_tool",
      { input: "test" },
      mockContext
    );

    if (result.success) throw new Error("Should fail for unknown tool");
    if (!result.error?.includes("Unknown tool")) {
      throw new Error(`Wrong error: ${result.error}`);
    }
  });

  // Test 9: Execute catches tool errors
  await test("Execute catches tool execution errors", async () => {
    const registry = new TestToolRegistry();
    const errorTool = createMockTool("error_tool", "read_only", async () => {
      throw new Error("Simulated tool failure");
    });
    registry.register(errorTool);

    const result = await registry.execute(
      "error_tool",
      { input: "test" },
      mockContext
    );

    if (result.success) throw new Error("Should fail when tool throws");
    if (!result.error?.includes("Simulated tool failure")) {
      throw new Error(`Wrong error: ${result.error}`);
    }
  });

  // Test 10: requiresApproval for destructive tools
  await test("requiresApproval returns true for destructive tools", async () => {
    const registry = new TestToolRegistry();
    registry.register(createMockTool("safe_tool", "read_only"));
    registry.register(createMockTool("write_tool", "safe_write"));
    registry.register(createMockTool("danger_tool", "destructive"));

    if (requiresApproval(registry, "safe_tool")) {
      throw new Error("read_only should not require approval");
    }
    if (requiresApproval(registry, "write_tool")) {
      throw new Error("safe_write should not require approval");
    }
    if (!requiresApproval(registry, "danger_tool")) {
      throw new Error("destructive should require approval");
    }
  });

  // Test 11: canAutoExecute for safe tools
  await test("canAutoExecute returns true for safe tools", async () => {
    const registry = new TestToolRegistry();
    registry.register(createMockTool("read_tool", "read_only"));
    registry.register(createMockTool("write_tool", "safe_write"));
    registry.register(createMockTool("danger_tool", "destructive"));

    if (!canAutoExecute(registry, "read_tool")) {
      throw new Error("read_only should auto-execute");
    }
    if (!canAutoExecute(registry, "write_tool")) {
      throw new Error("safe_write should auto-execute");
    }
    if (canAutoExecute(registry, "danger_tool")) {
      throw new Error("destructive should NOT auto-execute");
    }
  });

  // Test 12: Execute passes context correctly
  await test("Execute passes context to tool", async () => {
    const registry = new TestToolRegistry();
    let receivedContext: ToolContext | null = null;

    const contextTool = createMockTool("context_tool", "read_only", async (_args, ctx) => {
      receivedContext = ctx;
      return { success: true, output: "done" };
    });
    registry.register(contextTool);

    await registry.execute("context_tool", { input: "test" }, mockContext);

    if (!receivedContext) throw new Error("Context not passed");
    if (receivedContext.workspaceId !== "test-workspace") {
      throw new Error("Wrong workspaceId");
    }
    if (receivedContext.runId !== "test-run-123") {
      throw new Error("Wrong runId");
    }
  });

  // Test 13: Execute passes args correctly
  await test("Execute passes args to tool", async () => {
    const registry = new TestToolRegistry();
    let receivedArgs: Record<string, unknown> | null = null;

    const argsTool = createMockTool("args_tool", "read_only", async (args) => {
      receivedArgs = args;
      return { success: true, output: "done" };
    });
    registry.register(argsTool);

    await registry.execute(
      "args_tool",
      { input: "hello", extra: 123, nested: { key: "value" } },
      mockContext
    );

    if (!receivedArgs) throw new Error("Args not passed");
    if (receivedArgs.input !== "hello") throw new Error("Wrong input arg");
    if (receivedArgs.extra !== 123) throw new Error("Wrong extra arg");
    if ((receivedArgs.nested as { key: string })?.key !== "value") {
      throw new Error("Wrong nested arg");
    }
  });

  // Test 14: Tool returns metadata
  await test("Tool can return metadata", async () => {
    const registry = new TestToolRegistry();
    const metaTool = createMockTool("meta_tool", "read_only", async () => ({
      success: true,
      output: "result",
      metadata: {
        duration: 100,
        source: "test",
      },
    }));
    registry.register(metaTool);

    const result = await registry.execute("meta_tool", { input: "test" }, mockContext);

    if (!result.success) throw new Error("Should succeed");
    if (!result.metadata) throw new Error("Missing metadata");
    if (result.metadata.duration !== 100) throw new Error("Wrong duration");
    if (result.metadata.source !== "test") throw new Error("Wrong source");
  });

  console.log("\nAll tests completed!");
}

runTests().catch(console.error);
