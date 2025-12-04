/**
 * Tests for agent loop
 * Run with: npx tsx packages/core/src/__tests__/loop.test.ts
 */

import type { LLMMessage, ToolCall, LLMToolResponse } from "../llm/providers/types";
import type { Tool, ToolResult, ToolContext, ToolRiskTier } from "../tools/types";
import type { ToolDefinition } from "../llm/providers/types";
import type { AgentState, AgentConfig, AgentEvent } from "../agent/loop";

// Mock implementation - we'll test the pure logic functions
// Since the real loop depends on external services, we test the key behaviors

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.log(`❌ ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

// Test parseToolArgs logic (extracted for testing)
function parseToolArgs(argsString: string): Record<string, unknown> {
  try {
    return JSON.parse(argsString);
  } catch {
    return { raw: argsString };
  }
}

// Mock tool registry for testing
class MockToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
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

// Helper to check if tool requires approval
function requiresApproval(registry: MockToolRegistry, toolName: string): boolean {
  const tier = registry.getRiskTier(toolName);
  return tier === "destructive";
}

// Helper to check if tool can auto-execute
function canAutoExecute(registry: MockToolRegistry, toolName: string): boolean {
  const tier = registry.getRiskTier(toolName);
  return tier === "read_only" || tier === "safe_write";
}

// Create mock tool
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

// Simulate agent state initialization
function createInitialState(systemPrompt: string, userInput: string): AgentState {
  return {
    status: "running",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput },
    ],
    iterations: 0,
    toolCallHistory: [],
  };
}

// Simulate processing an LLM response with tool calls
async function processToolCalls(
  state: AgentState,
  registry: MockToolRegistry,
  toolCalls: ToolCall[],
  context: ToolContext,
  events: AgentEvent[]
): Promise<void> {
  // Add assistant message with tool calls
  state.messages.push({
    role: "assistant",
    content: "",
    tool_calls: toolCalls,
  });

  for (const toolCall of toolCalls) {
    const args = parseToolArgs(toolCall.function.arguments);

    events.push({
      type: "tool_call",
      toolName: toolCall.function.name,
      args,
    });

    // Check if tool requires approval
    if (requiresApproval(registry, toolCall.function.name)) {
      state.status = "paused";
      state.pendingApproval = {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        toolArgs: args,
        requestedAt: new Date().toISOString(),
      };

      events.push({
        type: "approval_required",
        toolName: toolCall.function.name,
        args,
        toolCallId: toolCall.id,
      });

      return; // Stop and wait for approval
    }

    // Check if tool can auto-execute
    if (!canAutoExecute(registry, toolCall.function.name)) {
      state.status = "paused";
      state.pendingApproval = {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        toolArgs: args,
        requestedAt: new Date().toISOString(),
      };

      events.push({
        type: "approval_required",
        toolName: toolCall.function.name,
        args,
        toolCallId: toolCall.id,
      });

      return;
    }

    // Execute the tool
    const result = await registry.execute(toolCall.function.name, args, context);

    events.push({
      type: "tool_result",
      toolName: toolCall.function.name,
      result,
    });

    // Record in history
    state.toolCallHistory.push({
      iteration: state.iterations,
      toolName: toolCall.function.name,
      args,
      result,
      timestamp: new Date().toISOString(),
    });

    // Add tool result to messages
    state.messages.push({
      role: "tool",
      content: result.success ? result.output : `Error: ${result.error}`,
      tool_call_id: toolCall.id,
    });
  }
}

async function runTests() {
  console.log("Running agent loop tests...\n");

  // Test 1: parseToolArgs with valid JSON
  await test("parseToolArgs parses valid JSON", async () => {
    const args = parseToolArgs('{"key": "value", "count": 42}');
    if (args.key !== "value") throw new Error("Wrong key value");
    if (args.count !== 42) throw new Error("Wrong count value");
  });

  // Test 2: parseToolArgs with invalid JSON
  await test("parseToolArgs wraps invalid JSON in raw field", async () => {
    const args = parseToolArgs("not valid json");
    if (args.raw !== "not valid json") {
      throw new Error(`Expected raw field, got: ${JSON.stringify(args)}`);
    }
  });

  // Test 3: createInitialState creates proper state
  await test("Initial state is created correctly", async () => {
    const state = createInitialState("You are a test agent", "Test input");

    if (state.status !== "running") throw new Error("Wrong initial status");
    if (state.iterations !== 0) throw new Error("Wrong initial iterations");
    if (state.messages.length !== 2) throw new Error("Wrong message count");
    if (state.messages[0].role !== "system") throw new Error("Wrong first message role");
    if (state.messages[1].role !== "user") throw new Error("Wrong second message role");
    if (state.toolCallHistory.length !== 0) throw new Error("Tool history should be empty");
  });

  // Test 4: Process read_only tool call (auto-execute)
  await test("Read-only tool executes automatically", async () => {
    const registry = new MockToolRegistry();
    registry.register(createMockTool("search_logs", "read_only"));

    const state = createInitialState("System", "Search logs");
    state.iterations = 1;

    const events: AgentEvent[] = [];
    const toolCalls: ToolCall[] = [{
      id: "call_1",
      type: "function",
      function: {
        name: "search_logs",
        arguments: '{"input": "error"}',
      },
    }];

    await processToolCalls(state, registry, toolCalls, mockContext, events);

    if (state.status !== "running") {
      throw new Error(`Status should be running, got ${state.status}`);
    }
    if (state.pendingApproval) {
      throw new Error("Should not require approval");
    }
    if (state.toolCallHistory.length !== 1) {
      throw new Error(`Expected 1 history entry, got ${state.toolCallHistory.length}`);
    }
    if (!events.some(e => e.type === "tool_result")) {
      throw new Error("Should have tool_result event");
    }
  });

  // Test 5: Process safe_write tool call (auto-execute)
  await test("Safe-write tool executes automatically", async () => {
    const registry = new MockToolRegistry();
    registry.register(createMockTool("create_comment", "safe_write"));

    const state = createInitialState("System", "Add comment");
    state.iterations = 1;

    const events: AgentEvent[] = [];
    const toolCalls: ToolCall[] = [{
      id: "call_2",
      type: "function",
      function: {
        name: "create_comment",
        arguments: '{"input": "Great work!"}',
      },
    }];

    await processToolCalls(state, registry, toolCalls, mockContext, events);

    if (state.status !== "running") {
      throw new Error(`Status should be running, got ${state.status}`);
    }
    if (state.pendingApproval) {
      throw new Error("Should not require approval");
    }
  });

  // Test 6: Process destructive tool call (requires approval)
  await test("Destructive tool requires approval", async () => {
    const registry = new MockToolRegistry();
    registry.register(createMockTool("merge_pr", "destructive"));

    const state = createInitialState("System", "Merge PR");
    state.iterations = 1;

    const events: AgentEvent[] = [];
    const toolCalls: ToolCall[] = [{
      id: "call_3",
      type: "function",
      function: {
        name: "merge_pr",
        arguments: '{"input": "PR #123"}',
      },
    }];

    await processToolCalls(state, registry, toolCalls, mockContext, events);

    if (state.status !== "paused") {
      throw new Error(`Status should be paused, got ${state.status}`);
    }
    if (!state.pendingApproval) {
      throw new Error("Should have pending approval");
    }
    if (state.pendingApproval.toolName !== "merge_pr") {
      throw new Error(`Wrong tool in approval: ${state.pendingApproval.toolName}`);
    }
    if (!events.some(e => e.type === "approval_required")) {
      throw new Error("Should have approval_required event");
    }
    // Tool should NOT have been executed yet
    if (state.toolCallHistory.length !== 0) {
      throw new Error("Tool should not have executed yet");
    }
  });

  // Test 7: Multiple tool calls - stops at destructive
  await test("Multiple tool calls stop at destructive tool", async () => {
    const registry = new MockToolRegistry();
    registry.register(createMockTool("search_code", "read_only"));
    registry.register(createMockTool("deploy", "destructive"));

    const state = createInitialState("System", "Search and deploy");
    state.iterations = 1;

    const events: AgentEvent[] = [];
    const toolCalls: ToolCall[] = [
      {
        id: "call_a",
        type: "function",
        function: {
          name: "search_code",
          arguments: '{"input": "bug fix"}',
        },
      },
      {
        id: "call_b",
        type: "function",
        function: {
          name: "deploy",
          arguments: '{"input": "production"}',
        },
      },
    ];

    await processToolCalls(state, registry, toolCalls, mockContext, events);

    // First tool should have executed
    if (state.toolCallHistory.length !== 1) {
      throw new Error(`Expected 1 executed tool, got ${state.toolCallHistory.length}`);
    }
    if (state.toolCallHistory[0].toolName !== "search_code") {
      throw new Error("First tool should be search_code");
    }

    // Should be paused for deploy approval
    if (state.status !== "paused") {
      throw new Error("Should be paused for deploy approval");
    }
    if (state.pendingApproval?.toolName !== "deploy") {
      throw new Error("Pending approval should be for deploy");
    }
  });

  // Test 8: Tool execution failure is recorded
  await test("Tool execution failure is recorded in history", async () => {
    const registry = new MockToolRegistry();
    registry.register(createMockTool("failing_tool", "read_only", async () => ({
      success: false,
      output: "",
      error: "Connection timeout",
    })));

    const state = createInitialState("System", "Run failing tool");
    state.iterations = 1;

    const events: AgentEvent[] = [];
    const toolCalls: ToolCall[] = [{
      id: "call_fail",
      type: "function",
      function: {
        name: "failing_tool",
        arguments: '{"input": "test"}',
      },
    }];

    await processToolCalls(state, registry, toolCalls, mockContext, events);

    if (state.toolCallHistory.length !== 1) {
      throw new Error("Should have 1 history entry");
    }
    if (state.toolCallHistory[0].result.success) {
      throw new Error("Result should indicate failure");
    }
    if (!state.toolCallHistory[0].result.error?.includes("Connection timeout")) {
      throw new Error("Error message should be recorded");
    }
  });

  // Test 9: Tool result is added to messages
  await test("Tool result is added to messages", async () => {
    const registry = new MockToolRegistry();
    registry.register(createMockTool("get_info", "read_only", async () => ({
      success: true,
      output: "Info: System healthy",
    })));

    const state = createInitialState("System", "Get info");
    state.iterations = 1;

    const events: AgentEvent[] = [];
    const toolCalls: ToolCall[] = [{
      id: "call_info",
      type: "function",
      function: {
        name: "get_info",
        arguments: '{"input": "status"}',
      },
    }];

    await processToolCalls(state, registry, toolCalls, mockContext, events);

    const toolMessages = state.messages.filter(m => m.role === "tool");
    if (toolMessages.length !== 1) {
      throw new Error(`Expected 1 tool message, got ${toolMessages.length}`);
    }
    if (!toolMessages[0].content?.includes("Info: System healthy")) {
      throw new Error("Tool result should be in message content");
    }
    if (toolMessages[0].tool_call_id !== "call_info") {
      throw new Error("Tool call ID should be set");
    }
  });

  // Test 10: Unknown tool returns error
  await test("Unknown tool returns error result", async () => {
    const registry = new MockToolRegistry();
    // Don't register any tools

    const result = await registry.execute("nonexistent", { input: "test" }, mockContext);

    if (result.success) {
      throw new Error("Should fail for unknown tool");
    }
    if (!result.error?.includes("Unknown tool")) {
      throw new Error(`Wrong error: ${result.error}`);
    }
  });

  // Test 11: Agent state serialization for persistence
  await test("Agent state can be serialized and restored", async () => {
    const state = createInitialState("Test system", "Test input");
    state.iterations = 3;
    state.status = "paused";
    state.pendingApproval = {
      toolCallId: "call_xyz",
      toolName: "deploy",
      toolArgs: { env: "production" },
      requestedAt: "2024-01-15T10:00:00Z",
    };
    state.toolCallHistory.push({
      iteration: 2,
      toolName: "search",
      args: { query: "test" },
      result: { success: true, output: "found" },
      timestamp: "2024-01-15T09:59:00Z",
    });

    // Serialize to JSON (simulating database storage)
    const serialized = JSON.stringify(state);
    const restored: AgentState = JSON.parse(serialized);

    if (restored.status !== "paused") throw new Error("Wrong restored status");
    if (restored.iterations !== 3) throw new Error("Wrong restored iterations");
    if (restored.pendingApproval?.toolName !== "deploy") {
      throw new Error("Wrong restored pending approval");
    }
    if (restored.toolCallHistory.length !== 1) {
      throw new Error("Wrong restored history length");
    }
    if (restored.messages.length !== 2) {
      throw new Error("Wrong restored messages length");
    }
  });

  // Test 12: Event emission for tool calls
  await test("Events are emitted correctly for tool calls", async () => {
    const registry = new MockToolRegistry();
    registry.register(createMockTool("test_tool", "read_only"));

    const state = createInitialState("System", "Test");
    state.iterations = 1;

    const events: AgentEvent[] = [];
    const toolCalls: ToolCall[] = [{
      id: "call_evt",
      type: "function",
      function: {
        name: "test_tool",
        arguments: '{"input": "hello"}',
      },
    }];

    await processToolCalls(state, registry, toolCalls, mockContext, events);

    const toolCallEvent = events.find(e => e.type === "tool_call");
    const toolResultEvent = events.find(e => e.type === "tool_result");

    if (!toolCallEvent) throw new Error("Missing tool_call event");
    if (!toolResultEvent) throw new Error("Missing tool_result event");

    if (toolCallEvent.type !== "tool_call") throw new Error("Wrong event type");
    if ((toolCallEvent as { toolName: string }).toolName !== "test_tool") {
      throw new Error("Wrong tool name in event");
    }
  });

  // Test 13: Resuming from paused state
  await test("Agent can resume from paused state", async () => {
    const state: AgentState = {
      status: "paused",
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User input" },
        { role: "assistant", content: "", tool_calls: [{
          id: "call_resume",
          type: "function",
          function: { name: "deploy", arguments: '{"env": "prod"}' },
        }]},
      ],
      iterations: 2,
      pendingApproval: {
        toolCallId: "call_resume",
        toolName: "deploy",
        toolArgs: { env: "prod" },
        requestedAt: "2024-01-15T10:00:00Z",
      },
      toolCallHistory: [],
    };

    // Simulate approval (what resumeAgentAfterApproval does)
    if (state.status === "paused" && state.pendingApproval) {
      const { toolCallId, toolName, toolArgs } = state.pendingApproval;

      // Execute the approved tool
      const registry = new MockToolRegistry();
      registry.register(createMockTool("deploy", "destructive", async (args) => ({
        success: true,
        output: `Deployed to ${args.env}`,
      })));

      const result = await registry.execute(toolName, toolArgs, mockContext);

      // Add result to messages
      state.messages.push({
        role: "tool",
        content: result.success ? result.output : `Error: ${result.error}`,
        tool_call_id: toolCallId,
      });

      // Record in history
      state.toolCallHistory.push({
        iteration: state.iterations,
        toolName,
        args: toolArgs,
        result,
        timestamp: new Date().toISOString(),
      });

      // Clear pending approval and resume
      state.pendingApproval = undefined;
      state.status = "running";
    }

    if (state.status !== "running") {
      throw new Error("Should be running after approval");
    }
    if (state.pendingApproval) {
      throw new Error("Pending approval should be cleared");
    }
    if (state.toolCallHistory.length !== 1) {
      throw new Error("Tool should have been executed");
    }
    if (!state.toolCallHistory[0].result.output.includes("Deployed to prod")) {
      throw new Error("Deployment result should be recorded");
    }
  });

  // Test 14: Rejection adds rejection message
  await test("Rejection adds appropriate message", async () => {
    const state: AgentState = {
      status: "paused",
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User input" },
      ],
      iterations: 2,
      pendingApproval: {
        toolCallId: "call_reject",
        toolName: "delete_data",
        toolArgs: { table: "users" },
        requestedAt: "2024-01-15T10:00:00Z",
      },
      toolCallHistory: [],
    };

    // Simulate rejection
    if (state.status === "paused" && state.pendingApproval) {
      const { toolCallId, toolName } = state.pendingApproval;

      state.messages.push({
        role: "tool",
        content: `Action "${toolName}" was rejected by the user. Please suggest an alternative approach.`,
        tool_call_id: toolCallId,
      });

      state.pendingApproval = undefined;
      state.status = "running";
    }

    if (state.status !== "running") {
      throw new Error("Should be running after rejection");
    }
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage.content?.includes("rejected")) {
      throw new Error("Should have rejection message");
    }
    if (!lastMessage.content?.includes("delete_data")) {
      throw new Error("Should mention rejected tool");
    }
  });

  // Test 15: Max iterations check
  await test("Agent state tracks iterations correctly", async () => {
    const state = createInitialState("System", "Input");
    const maxIterations = 10;

    // Simulate iterations
    for (let i = 0; i < 12; i++) {
      if (state.iterations >= maxIterations) {
        state.status = "completed";
        state.result = "Reached max iterations";
        break;
      }
      state.iterations++;
    }

    if (state.iterations !== 10) {
      throw new Error(`Expected 10 iterations, got ${state.iterations}`);
    }
    if (state.status !== "completed") {
      throw new Error("Should be completed at max iterations");
    }
  });

  console.log("\nAll tests completed!");
}

runTests().catch(console.error);
