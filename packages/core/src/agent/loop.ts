import type { LLMMessage, ToolCall } from "../llm/providers/types";
import { completeWithTools } from "../llm/client";
import {
  toolRegistry,
  canAutoExecute,
  requiresApproval,
  type ToolContext,
  type ToolResult,
} from "../tools";

// Agent configuration
export interface AgentConfig {
  maxIterations: number;
  systemPrompt: string;
  timeoutMs?: number;
}

// Agent state - can be saved and restored for continuation
export interface AgentState {
  status: "running" | "paused" | "completed" | "failed";
  messages: LLMMessage[];
  iterations: number;
  pendingApproval?: {
    toolCallId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    requestedAt: string;
  };
  result?: string;
  error?: string;
  toolCallHistory: Array<{
    iteration: number;
    toolName: string;
    args: Record<string, unknown>;
    result: ToolResult;
    timestamp: string;
  }>;
}

// Events emitted during agent execution
export type AgentEvent =
  | { type: "iteration_start"; iteration: number }
  | { type: "tool_call"; toolName: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; result: ToolResult }
  | { type: "approval_required"; toolName: string; args: Record<string, unknown>; toolCallId: string }
  | { type: "llm_response"; content: string }
  | { type: "completed"; result: string }
  | { type: "failed"; error: string };

export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;

// Parse tool call arguments from JSON string
function parseToolArgs(argsString: string): Record<string, unknown> {
  try {
    return JSON.parse(argsString);
  } catch {
    // If parsing fails, wrap the string in an object
    return { raw: argsString };
  }
}

// Execute a single tool call
async function executeTool(
  toolCall: ToolCall,
  context: ToolContext
): Promise<{ success: boolean; output: string; error?: string }> {
  const args = parseToolArgs(toolCall.function.arguments);
  const result = await toolRegistry.execute(toolCall.function.name, args, context);
  return {
    success: result.success,
    output: result.success ? result.output : `Error: ${result.error}`,
    error: result.error,
  };
}

// Main agent loop
export async function runAgentLoop(
  initialInput: string,
  config: AgentConfig,
  context: ToolContext,
  existingState?: AgentState,
  onEvent?: AgentEventHandler
): Promise<AgentState> {
  // Initialize or restore state
  const state: AgentState = existingState ?? {
    status: "running",
    messages: [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: initialInput },
    ],
    iterations: 0,
    toolCallHistory: [],
  };

  // If resuming from paused state with approved tool call
  if (state.status === "paused" && state.pendingApproval) {
    // This will be handled externally - when approval comes in,
    // the caller should execute the tool and add results to messages
    // before calling runAgentLoop again
    state.status = "running";
    state.pendingApproval = undefined;
  }

  const emit = async (event: AgentEvent) => {
    if (onEvent) {
      await onEvent(event);
    }
  };

  // Get tool definitions
  const tools = toolRegistry.getDefinitions();

  // Main loop
  while (state.iterations < config.maxIterations && state.status === "running") {
    state.iterations++;
    await emit({ type: "iteration_start", iteration: state.iterations });

    try {
      // Call LLM with tools
      const response = await completeWithTools(state.messages, {
        tools,
        temperature: 0.2, // Lower temperature for more focused responses
        maxTokens: 4096,
      });

      // Check if LLM wants to call tools
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Add assistant message with tool calls
        state.messages.push({
          role: "assistant",
          content: response.content || "",
          tool_calls: response.tool_calls,
        });

        // Process each tool call
        for (const toolCall of response.tool_calls) {
          const args = parseToolArgs(toolCall.function.arguments);

          await emit({
            type: "tool_call",
            toolName: toolCall.function.name,
            args,
          });

          // Check if tool requires approval
          if (requiresApproval(toolCall.function.name)) {
            state.status = "paused";
            state.pendingApproval = {
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              toolArgs: args,
              requestedAt: new Date().toISOString(),
            };

            await emit({
              type: "approval_required",
              toolName: toolCall.function.name,
              args,
              toolCallId: toolCall.id,
            });

            return state; // Return and wait for approval
          }

          // Check if tool can auto-execute
          if (!canAutoExecute(toolCall.function.name)) {
            // Unknown tool risk tier - treat as requiring approval
            state.status = "paused";
            state.pendingApproval = {
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              toolArgs: args,
              requestedAt: new Date().toISOString(),
            };

            await emit({
              type: "approval_required",
              toolName: toolCall.function.name,
              args,
              toolCallId: toolCall.id,
            });

            return state;
          }

          // Execute the tool
          const result = await executeTool(toolCall, context);

          await emit({
            type: "tool_result",
            toolName: toolCall.function.name,
            result: {
              success: result.success,
              output: result.output,
              error: result.error,
            },
          });

          // Record in history
          state.toolCallHistory.push({
            iteration: state.iterations,
            toolName: toolCall.function.name,
            args,
            result: {
              success: result.success,
              output: result.output,
              error: result.error,
            },
            timestamp: new Date().toISOString(),
          });

          // Add tool result to messages
          state.messages.push({
            role: "tool",
            content: result.output,
            tool_call_id: toolCall.id,
          });
        }
      } else {
        // No tool calls - LLM is done
        const finalContent = response.content || "Investigation complete.";

        state.messages.push({
          role: "assistant",
          content: finalContent,
        });

        await emit({ type: "llm_response", content: finalContent });

        state.status = "completed";
        state.result = finalContent;

        await emit({ type: "completed", result: finalContent });
        return state;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      state.status = "failed";
      state.error = errorMessage;

      await emit({ type: "failed", error: errorMessage });
      return state;
    }
  }

  // Reached max iterations
  if (state.iterations >= config.maxIterations) {
    state.status = "completed";
    state.result =
      "Investigation reached maximum iterations. Here's what I found:\n\n" +
      state.messages
        .filter((m) => m.role === "assistant" && m.content)
        .map((m) => m.content)
        .join("\n\n");

    await emit({ type: "completed", result: state.result });
  }

  return state;
}

// Resume agent after approval
export async function resumeAgentAfterApproval(
  state: AgentState,
  approved: boolean,
  config: AgentConfig,
  context: ToolContext,
  onEvent?: AgentEventHandler
): Promise<AgentState> {
  if (state.status !== "paused" || !state.pendingApproval) {
    throw new Error("Agent is not waiting for approval");
  }

  const { toolCallId, toolName, toolArgs } = state.pendingApproval;

  if (!approved) {
    // User rejected the action
    state.messages.push({
      role: "tool",
      content: `Action "${toolName}" was rejected by the user. Please suggest an alternative approach.`,
      tool_call_id: toolCallId,
    });
    state.pendingApproval = undefined;
    state.status = "running";

    return runAgentLoop("", config, context, state, onEvent);
  }

  // User approved - execute the tool
  const emit = async (event: AgentEvent) => {
    if (onEvent) {
      await onEvent(event);
    }
  };

  const result = await toolRegistry.execute(toolName, toolArgs, context);

  await emit({
    type: "tool_result",
    toolName,
    result,
  });

  // Record in history
  state.toolCallHistory.push({
    iteration: state.iterations,
    toolName,
    args: toolArgs,
    result,
    timestamp: new Date().toISOString(),
  });

  // Add tool result to messages
  state.messages.push({
    role: "tool",
    content: result.success ? result.output : `Error: ${result.error}`,
    tool_call_id: toolCallId,
  });

  state.pendingApproval = undefined;
  state.status = "running";

  // Continue the loop
  return runAgentLoop("", config, context, state, onEvent);
}
