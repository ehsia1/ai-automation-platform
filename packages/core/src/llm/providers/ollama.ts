import type {
  LLMProvider,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionWithToolsOptions,
  LLMToolResponse,
  ToolCall,
} from "./types";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl || "http://localhost:11434";
    this.model = config.model || "llama3.1:8b";
  }

  async complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<string> {
    // Ollama uses OpenAI-compatible API format
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message?.content || "";
  }

  async completeWithTools(
    messages: LLMMessage[],
    options?: LLMCompletionWithToolsOptions
  ): Promise<LLMToolResponse> {
    // Convert messages to OpenAI format, handling tool messages
    const formattedMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.tool_call_id,
        };
      }
      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.tool_calls,
        };
      }
      return {
        role: m.role,
        content: m.content,
      };
    });

    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: formattedMessages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      stream: false,
    };

    // Add tools if provided
    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options?.tool_choice ?? "auto";
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: Array<{
            id: string;
            type: "function";
            function: {
              name: string;
              arguments: string;
            };
          }>;
        };
        finish_reason: string;
      }>;
    };

    const choice = data.choices[0];
    let toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls?.map(
      (tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })
    );

    // Fallback: Try to parse tool calls from text content if model didn't use proper format
    // Some models (like Llama via Ollama) output tool calls as JSON in the content
    if (!toolCalls?.length && choice?.message?.content) {
      const parsedFromContent = this.parseToolCallsFromContent(choice.message.content);
      if (parsedFromContent.length > 0) {
        toolCalls = parsedFromContent;
      }
    }

    // Determine finish reason
    let finishReason: "stop" | "tool_calls" | "length" = "stop";
    if (choice?.finish_reason === "tool_calls" || toolCalls?.length) {
      finishReason = "tool_calls";
    } else if (choice?.finish_reason === "length") {
      finishReason = "length";
    }

    return {
      content: toolCalls?.length ? undefined : choice?.message?.content || undefined,
      tool_calls: toolCalls,
      finish_reason: finishReason,
    };
  }

  /**
   * Parse tool calls from text content when the model outputs JSON instead of using proper tool_calls
   * Handles formats like:
   * - {"name": "tool_name", "parameters": {...}}
   * - {"name": "tool_name", "arguments": {...}}
   */
  private parseToolCallsFromContent(content: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    let callIndex = 0;

    // First, try to find and parse a complete JSON object from the content
    // This handles the case where the entire response is a JSON tool call
    const fullJsonMatch = this.extractCompleteJson(content);
    if (fullJsonMatch) {
      try {
        const parsed = JSON.parse(fullJsonMatch);
        if (parsed.name && (parsed.parameters || parsed.arguments)) {
          const args = parsed.parameters || parsed.arguments;
          toolCalls.push({
            id: `call_${Date.now().toString(36)}_${callIndex++}`,
            type: "function",
            function: {
              name: parsed.name,
              arguments: typeof args === 'string' ? args : JSON.stringify(args),
            },
          });
          return toolCalls;
        }
      } catch {
        // Continue with other parsing methods
      }
    }

    // Match JSON objects that look like tool calls
    // Pattern: {"name": "...", "parameters": {...}} or {"name": "...", "arguments": {...}}
    const jsonPattern = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"(?:parameters|arguments)"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\[[^\[\]]*\]|"[^"]*")/g;

    let match;

    while ((match = jsonPattern.exec(content)) !== null) {
      try {
        const toolName = match[1];
        let argsStr = match[2];

        // Try to find the complete JSON object for the arguments
        // Start from the position of "parameters": or "arguments":
        const startIdx = match.index;
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        let argsStartIdx = -1;
        let argsEndIdx = -1;

        for (let i = startIdx; i < content.length; i++) {
          const char = content[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            escapeNext = true;
            continue;
          }

          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }

          if (inString) continue;

          if (char === '{' || char === '[') {
            if (argsStartIdx === -1 && braceCount === 1) {
              // This is the start of the parameters/arguments object
              argsStartIdx = i;
            }
            braceCount++;
          } else if (char === '}' || char === ']') {
            braceCount--;
            if (braceCount === 1 && argsStartIdx !== -1) {
              argsEndIdx = i + 1;
              break;
            }
          }
        }

        if (argsStartIdx !== -1 && argsEndIdx !== -1) {
          argsStr = content.substring(argsStartIdx, argsEndIdx);
        }

        // Validate it's valid JSON
        JSON.parse(argsStr);

        toolCalls.push({
          id: `call_${Date.now().toString(36)}_${callIndex++}`,
          type: "function",
          function: {
            name: toolName,
            arguments: argsStr,
          },
        });
      } catch {
        // Skip invalid JSON
        continue;
      }
    }

    // If no matches with the pattern, try a simpler line-by-line approach
    if (toolCalls.length === 0) {
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.includes('"name"')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.name && (parsed.parameters || parsed.arguments)) {
              const args = parsed.parameters || parsed.arguments;
              toolCalls.push({
                id: `call_${Date.now().toString(36)}_${callIndex++}`,
                type: "function",
                function: {
                  name: parsed.name,
                  arguments: typeof args === 'string' ? args : JSON.stringify(args),
                },
              });
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    return toolCalls;
  }

  /**
   * Extract a complete JSON object from content, handling nested braces and strings properly
   */
  private extractCompleteJson(content: string): string | null {
    // Find the first { and try to extract a complete JSON object
    const firstBrace = content.indexOf('{');
    if (firstBrace === -1) return null;

    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = firstBrace; i < content.length; i++) {
      const char = content[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          // Found the complete JSON object
          return content.substring(firstBrace, i + 1);
        }
      }
    }

    return null;
  }
}
