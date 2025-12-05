import type { LLMMessage, ToolCall } from "../llm/providers/types";
import { completeWithTools } from "../llm/client";
import {
  toolRegistry,
  canAutoExecute,
  requiresApproval,
  type ToolContext,
  type ToolResult,
} from "../tools";
import {
  TimeoutController,
  AgentTimeoutError,
  withTimeout,
} from "./timeout";

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
  // Track files that have been successfully read via github_get_file
  // Format: "owner/repo:path" -> true
  successfullyReadFiles?: Record<string, boolean>;
  // Track files that are known to exist in the repo (from github_list_files)
  // Format: "owner/repo:path" -> true
  knownExistingFiles?: Record<string, boolean>;
}

// Events emitted during agent execution
export type AgentEvent =
  | { type: "iteration_start"; iteration: number }
  | { type: "tool_call"; toolName: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; result: ToolResult }
  | { type: "approval_required"; toolName: string; args: Record<string, unknown>; toolCallId: string }
  | { type: "llm_response"; content: string }
  | { type: "completed"; result: string }
  | { type: "failed"; error: string }
  | { type: "timeout"; elapsedMs: number; iteration: number; lastToolCall?: string };

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

// Extract tool call from text when LLM outputs JSON instead of using function calling
// This rescues tool calls that small local LLMs sometimes output as text
function extractToolCallFromText(text: string): { name: string; parameters: Record<string, unknown> } | null {
  // Known tool names we're looking for
  const toolNames = [
    "github_create_single_file_pr",
    "github_create_draft_pr",
    "github_get_file",
    "github_list_files",
    "github_search_code",
    "cloudwatch_query_logs",
  ];

  // Try to find any JSON object that looks like a tool call
  // Pattern: {"name": "tool_name", "parameters": {...}}
  for (const toolName of toolNames) {
    // Check if this tool name appears in the text
    if (!text.includes(toolName)) continue;

    // Try to find the JSON structure
    const namePattern = new RegExp(`"name"\\s*:\\s*"${toolName}"`, "i");
    if (namePattern.test(text)) {
      // Find the start of the JSON object containing this
      const nameMatch = text.match(namePattern);
      if (!nameMatch) continue;

      const nameIdx = text.indexOf(nameMatch[0]);
      // Find the opening brace before the "name" key
      let startIdx = nameIdx;
      for (let i = nameIdx - 1; i >= 0; i--) {
        if (text[i] === "{") {
          startIdx = i;
          break;
        }
      }

      // Find the complete JSON object using brace matching
      let braceCount = 0;
      let endIdx = startIdx;
      let inString = false;
      let escapeNext = false;

      for (let i = startIdx; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === "\\") {
          escapeNext = true;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === "{") braceCount++;
          if (char === "}") braceCount--;
          if (braceCount === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }

      if (endIdx > startIdx) {
        const fullJson = text.substring(startIdx, endIdx);
        try {
          const parsed = JSON.parse(fullJson);
          if (parsed.name === toolName && parsed.parameters) {
            console.log(`🔍 Extracted tool call pattern 1: ${toolName}`);
            return { name: toolName, parameters: parsed.parameters };
          }
        } catch (e) {
          console.log(`⚠️ JSON parse failed for pattern 1: ${e}`);
        }
      }
    }
  }

  // Pattern 2: Look for a JSON object with tool-specific parameters (no wrapper)
  // For github_create_single_file_pr: must have repo, branch_name, file_path, file_content
  if (text.includes("file_content") && text.includes("branch_name")) {
    // Find the first { that starts a potential tool call
    const startIdx = text.indexOf("{");
    if (startIdx >= 0) {
      let braceCount = 0;
      let endIdx = startIdx;
      let inString = false;
      let escapeNext = false;

      for (let i = startIdx; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === "\\") {
          escapeNext = true;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === "{") braceCount++;
          if (char === "}") braceCount--;
          if (braceCount === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }

      if (endIdx > startIdx) {
        const fullJson = text.substring(startIdx, endIdx);
        try {
          const parameters = JSON.parse(fullJson);
          // Check if this looks like a single-file PR call
          if (parameters.repo && parameters.branch_name && parameters.file_path && parameters.file_content) {
            console.log(`🔍 Extracted tool call pattern 2: github_create_single_file_pr`);
            return { name: "github_create_single_file_pr", parameters };
          }
        } catch (e) {
          console.log(`⚠️ JSON parse failed for pattern 2: ${e}`);
        }
      }
    }
  }

  return null;
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

// Default timeout: 5 minutes
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// Helper to validate that files in a PR have been successfully read first
// IMPORTANT: Only EXISTING files need to be read before modification.
// New files (not seen in github_list_files) can be created without reading.
function validatePRFilesWereRead(
  prArgs: Record<string, unknown>,
  successfullyReadFiles: Record<string, boolean>,
  knownExistingFiles: Record<string, boolean>
): { valid: boolean; missingFiles: string[]; newFiles: string[] } {
  const repo = prArgs.repo as string;
  let files = prArgs.files as Array<{ path?: string; filename?: string }> | string | undefined;

  // Handle files passed as JSON string
  if (typeof files === "string") {
    try {
      files = JSON.parse(files) as Array<{ path?: string; filename?: string }>;
    } catch {
      return { valid: false, missingFiles: ["(invalid files array)"], newFiles: [] };
    }
  }

  if (!Array.isArray(files) || files.length === 0) {
    return { valid: false, missingFiles: ["(no files specified)"], newFiles: [] };
  }

  const missingFiles: string[] = [];
  const newFiles: string[] = [];

  for (const file of files) {
    const path = file.path || file.filename;
    if (!path) continue;

    const key = `${repo}:${path}`;
    const fileExists = knownExistingFiles[key];
    const fileWasRead = successfullyReadFiles[key];

    if (fileExists && !fileWasRead) {
      // File exists but wasn't read - this is the dangerous case we want to block
      missingFiles.push(path);
    } else if (!fileExists) {
      // File doesn't exist (new file) - that's fine, just track it
      newFiles.push(path);
    }
    // else: File exists and was read - good to go
  }

  return {
    valid: missingFiles.length === 0,
    missingFiles,
    newFiles,
  };
}

// Minimum time needed to start a new iteration (30 seconds for LLM call + buffer)
const MIN_ITERATION_TIME_MS = 30 * 1000;

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
    successfullyReadFiles: {},
    knownExistingFiles: {},
  };

  // Ensure tracking objects are initialized for restored states
  if (!state.successfullyReadFiles) {
    state.successfullyReadFiles = {};
  }
  if (!state.knownExistingFiles) {
    state.knownExistingFiles = {};
  }

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

  // Set up timeout controller if configured
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastToolCall: string | undefined;

  const timeoutController = new TimeoutController(timeoutMs, () => {
    console.warn(
      `Agent timeout triggered after ${timeoutController.elapsedMs}ms ` +
      `(iteration ${state.iterations}, last tool: ${lastToolCall ?? "none"})`
    );
  });

  // Start the timeout timer
  timeoutController.start();

  // Get tool definitions
  const tools = toolRegistry.getDefinitions();

  // Main loop
  while (state.iterations < config.maxIterations && state.status === "running") {
    // Check if we have enough time to start a new iteration
    if (!timeoutController.hasTimeFor(MIN_ITERATION_TIME_MS)) {
      console.warn(
        `Insufficient time remaining (${timeoutController.remainingMs}ms) for new iteration, ` +
        `stopping gracefully at iteration ${state.iterations}`
      );

      await emit({
        type: "timeout",
        elapsedMs: timeoutController.elapsedMs,
        iteration: state.iterations,
        lastToolCall,
      });

      // Graceful timeout - save progress
      state.status = "completed";
      state.result =
        `Investigation timed out after ${Math.round(timeoutController.elapsedMs / 1000)}s. ` +
        `Completed ${state.iterations} iterations. Here's what I found:\n\n` +
        state.messages
          .filter((m) => m.role === "assistant" && m.content)
          .map((m) => m.content)
          .join("\n\n");

      await emit({ type: "completed", result: state.result });
      timeoutController.stop();
      return state;
    }

    // Check if already timed out
    if (timeoutController.isTimedOut) {
      await emit({
        type: "timeout",
        elapsedMs: timeoutController.elapsedMs,
        iteration: state.iterations,
        lastToolCall,
      });

      state.status = "failed";
      state.error = `Agent timed out after ${timeoutController.elapsedMs}ms`;
      timeoutController.stop();
      return state;
    }

    state.iterations++;
    await emit({ type: "iteration_start", iteration: state.iterations });

    try {
      // Call LLM with tools (with per-call timeout based on remaining time)
      const llmTimeoutMs = Math.min(
        timeoutController.remainingMs - 5000, // Leave 5s buffer
        60000 // Max 60s per LLM call
      );

      const response = await withTimeout(
        completeWithTools(state.messages, {
          tools,
          temperature: 0.2, // Lower temperature for more focused responses
          maxTokens: 4096,
        }),
        llmTimeoutMs,
        `LLM call timed out after ${llmTimeoutMs}ms`
      );

      // Check if LLM wants to call tools
      if (response.tool_calls && response.tool_calls.length > 0) {
        // SAFETY: Filter out invalid tool calls
        const hasGetFile = response.tool_calls.some(tc => tc.function.name === "github_get_file");
        const filteredToolCalls = response.tool_calls.filter(tc => {
          // Rule 1: Block github_create_draft_pr if called in same turn as github_get_file
          // The LLM needs to wait for file content before creating a PR
          if (tc.function.name === "github_create_draft_pr" && hasGetFile) {
            console.warn("⚠️ Blocking github_create_draft_pr - must wait for github_get_file results first");
            return false;
          }

          // Rule 2: Block github_create_draft_pr if trying to modify EXISTING files that weren't read
          // New files (not in knownExistingFiles) are allowed without reading
          if (tc.function.name === "github_create_draft_pr") {
            // Debug: log the raw arguments string from the LLM
            console.log(`🔍 DEBUG github_create_draft_pr RAW arguments:`, tc.function.arguments);
            const args = parseToolArgs(tc.function.arguments);
            // Debug: log what the LLM is passing for files
            console.log(`🔍 DEBUG github_create_draft_pr parsed args keys:`, Object.keys(args));
            console.log(`🔍 DEBUG github_create_draft_pr args:`, JSON.stringify({
              hasFiles: "files" in args,
              filesType: typeof args.files,
              filesIsArray: Array.isArray(args.files),
              filesLength: Array.isArray(args.files) ? args.files.length : "N/A",
              filesPreview: typeof args.files === "string"
                ? args.files.substring(0, 200)
                : Array.isArray(args.files)
                  ? JSON.stringify(args.files).substring(0, 200)
                  : String(args.files)
            }, null, 2));
            const validation = validatePRFilesWereRead(
              args,
              state.successfullyReadFiles || {},
              state.knownExistingFiles || {}
            );
            if (!validation.valid) {
              console.warn(
                `⚠️ Blocking github_create_draft_pr - existing files not read first: ${validation.missingFiles.join(", ")}`
              );
              if (validation.newFiles.length > 0) {
                console.log(`ℹ️ New files allowed: ${validation.newFiles.join(", ")}`);
              }
              // We'll let this through but add a synthetic tool result explaining the error
              // This way the LLM knows what went wrong and can fix it
              return false;
            }
          }

          return true;
        });

        // If we blocked PR creation due to unread files, add an error message
        const blockedPRCalls = response.tool_calls.filter(tc => {
          if (tc.function.name !== "github_create_draft_pr") return false;
          if (hasGetFile) return true; // Blocked by rule 1
          const args = parseToolArgs(tc.function.arguments);
          const validation = validatePRFilesWereRead(
            args,
            state.successfullyReadFiles || {},
            state.knownExistingFiles || {}
          );
          return !validation.valid;
        });

        if (blockedPRCalls.length > 0) {
          // Add a message explaining why PR creation was blocked
          const prArgs = parseToolArgs(blockedPRCalls[0].function.arguments);
          const validation = validatePRFilesWereRead(
            prArgs,
            state.successfullyReadFiles || {},
            state.knownExistingFiles || {}
          );

          state.messages.push({
            role: "assistant",
            content: response.content || "",
            tool_calls: blockedPRCalls,
          });

          let errorMessage = `⛔ PR CREATION BLOCKED: You must read EXISTING files first using github_get_file before modifying them.\n\n` +
            `Files that EXIST but were NOT READ: ${validation.missingFiles.join(", ")}\n\n`;

          if (validation.newFiles.length > 0) {
            errorMessage += `(New files are allowed: ${validation.newFiles.join(", ")})\n\n`;
          }

          errorMessage += `Please:\n` +
            `1. Use github_list_files to explore the repository structure\n` +
            `2. Use github_get_file to read the COMPLETE content of each EXISTING file you want to modify\n` +
            `3. For NEW files, you can include them without reading first\n` +
            `4. Then call github_create_draft_pr with the full file content (including your changes)`;

          state.messages.push({
            role: "tool",
            content: errorMessage,
            tool_call_id: blockedPRCalls[0].id,
          });

          // Continue to next iteration so LLM can fix its mistake
          continue;
        }

        // Add assistant message with tool calls
        state.messages.push({
          role: "assistant",
          content: response.content || "",
          tool_calls: filteredToolCalls,
        });

        // Process each tool call
        for (const toolCall of filteredToolCalls) {
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
          lastToolCall = toolCall.function.name;
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

          // Track successful github_get_file calls for PR validation
          if (toolCall.function.name === "github_get_file" && result.success) {
            const repo = args.repo as string;
            const path = args.path as string;
            if (repo && path) {
              const key = `${repo}:${path}`;
              state.successfullyReadFiles = state.successfullyReadFiles || {};
              state.successfullyReadFiles[key] = true;
              // Also mark it as existing since we successfully read it
              state.knownExistingFiles = state.knownExistingFiles || {};
              state.knownExistingFiles[key] = true;
              console.log(`✅ Tracked successful file read: ${key}`);
            }
          }

          // Track files discovered via github_list_files for PR validation
          // This helps distinguish new files from existing files in multi-file PRs
          if (toolCall.function.name === "github_list_files" && result.success) {
            const repo = args.repo as string;
            const basePath = (args.path as string) || "";
            if (repo && result.output) {
              // Parse the output to extract file paths
              // Format: "📄 path/to/file.py (123 bytes)" or "📁 path/to/dir"
              const lines = result.output.split("\n");
              state.knownExistingFiles = state.knownExistingFiles || {};
              for (const line of lines) {
                // Match file lines (📄 prefix)
                const fileMatch = line.match(/^📄\s+(\S+)/);
                if (fileMatch) {
                  const filePath = fileMatch[1];
                  const key = `${repo}:${filePath}`;
                  state.knownExistingFiles[key] = true;
                }
              }
              const fileCount = Object.keys(state.knownExistingFiles).filter(k => k.startsWith(`${repo}:`)).length;
              console.log(`📂 Tracked ${fileCount} known files in ${repo}`);
            }
          }

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
        // No tool calls - LLM returned text only
        let textContent = response.content || "Investigation complete.";

        // RESCUE LOGIC: Detect tool calls embedded as JSON in text response
        // Small local LLMs sometimes output tool calls as JSON text instead of using function calling
        const extractedToolCall = extractToolCallFromText(textContent);
        if (extractedToolCall) {
          console.log(`🔧 Rescued tool call from text: ${extractedToolCall.name}`);

          // Create a synthetic tool call and process it
          const syntheticToolCall: ToolCall = {
            id: `rescued_${Date.now()}`,
            type: "function",
            function: {
              name: extractedToolCall.name,
              arguments: JSON.stringify(extractedToolCall.parameters),
            },
          };

          // Add assistant message with the rescued tool call
          state.messages.push({
            role: "assistant",
            content: "", // Clear the text since we're converting it to a tool call
            tool_calls: [syntheticToolCall],
          });

          const args = extractedToolCall.parameters;

          await emit({
            type: "tool_call",
            toolName: syntheticToolCall.function.name,
            args,
          });

          // Check if tool requires approval
          if (requiresApproval(syntheticToolCall.function.name)) {
            state.status = "paused";
            state.pendingApproval = {
              toolCallId: syntheticToolCall.id,
              toolName: syntheticToolCall.function.name,
              toolArgs: args,
              requestedAt: new Date().toISOString(),
            };

            await emit({
              type: "approval_required",
              toolName: syntheticToolCall.function.name,
              args,
              toolCallId: syntheticToolCall.id,
            });

            return state;
          }

          // Execute the rescued tool call
          lastToolCall = syntheticToolCall.function.name;
          const result = await executeTool(syntheticToolCall, context);

          await emit({
            type: "tool_result",
            toolName: syntheticToolCall.function.name,
            result: {
              success: result.success,
              output: result.output,
              error: result.error,
            },
          });

          // Track successful github_get_file calls
          if (syntheticToolCall.function.name === "github_get_file" && result.success) {
            const repo = args.repo as string;
            const path = args.path as string;
            if (repo && path) {
              const key = `${repo}:${path}`;
              state.successfullyReadFiles = state.successfullyReadFiles || {};
              state.successfullyReadFiles[key] = true;
              state.knownExistingFiles = state.knownExistingFiles || {};
              state.knownExistingFiles[key] = true;
              console.log(`✅ Tracked successful file read (rescued): ${key}`);
            }
          }

          // Record in history
          state.toolCallHistory.push({
            iteration: state.iterations,
            toolName: syntheticToolCall.function.name,
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
            tool_call_id: syntheticToolCall.id,
          });

          // Continue to next iteration
          continue;
        }

        // Check if the LLM stopped prematurely without completing key steps
        const hasQueriedLogs = state.toolCallHistory.some(tc => tc.toolName === "cloudwatch_query_logs");
        const hasListedFiles = state.toolCallHistory.some(tc => tc.toolName === "github_list_files");
        const hasGotFile = state.toolCallHistory.some(tc => tc.toolName === "github_get_file");
        const hasCreatedPR = state.toolCallHistory.some(tc =>
          tc.toolName === "github_create_draft_pr" || tc.toolName === "github_create_single_file_pr"
        );

        // If we haven't completed the investigation flow and have iterations left, re-prompt
        const investigationIncomplete = hasQueriedLogs && !hasCreatedPR && state.iterations < config.maxIterations - 1;

        if (investigationIncomplete) {
          console.log(`⚠️ LLM stopped without completing flow. Completed: logs=${hasQueriedLogs}, list=${hasListedFiles}, get=${hasGotFile}, pr=${hasCreatedPR}`);

          // Add the LLM's response and a continuation prompt
          state.messages.push({
            role: "assistant",
            content: textContent,
          });

          // Add a system message reminding the LLM to continue using tools
          let continuationPrompt = "⚠️ INVESTIGATION NOT COMPLETE. You need to continue using tools:\n\n";

          if (!hasListedFiles && !hasGotFile) {
            continuationPrompt += "- NEXT: Call github_list_files to explore the repository structure for the buggy code\n";
          } else if (hasListedFiles && !hasGotFile) {
            continuationPrompt += "- NEXT: Call github_get_file to read the file containing the bug\n";
          } else if (hasGotFile && !hasCreatedPR) {
            continuationPrompt += "- NEXT: Call github_create_single_file_pr to create a PR with your fix\n";
          }

          continuationPrompt += "\nDO NOT describe tool calls. EXECUTE the tool directly using the function calling mechanism.";

          state.messages.push({
            role: "user",
            content: continuationPrompt,
          });

          await emit({ type: "llm_response", content: textContent });

          // Continue to next iteration instead of returning
          continue;
        }

        // Investigation is complete or we can't continue
        state.messages.push({
          role: "assistant",
          content: textContent,
        });

        await emit({ type: "llm_response", content: textContent });

        state.status = "completed";
        state.result = textContent;

        await emit({ type: "completed", result: textContent });
        timeoutController.stop();
        return state;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      state.status = "failed";
      state.error = errorMessage;

      await emit({ type: "failed", error: errorMessage });
      timeoutController.stop();
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

  timeoutController.stop();
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
