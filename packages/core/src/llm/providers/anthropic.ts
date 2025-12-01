import type {
  LLMProvider,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionWithToolsOptions,
  LLMToolResponse,
  ToolCall,
  ToolDefinition,
} from "./types";

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
}

// Anthropic-specific message types
interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || "claude-sonnet-4-20250514";
  }

  async complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<string> {
    // Extract system message if present
    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 2048,
        system: systemMessage?.content,
        messages: nonSystemMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as AnthropicResponse;

    const textContent = data.content.find((c) => c.type === "text");
    return textContent?.text || "";
  }

  async completeWithTools(
    messages: LLMMessage[],
    options?: LLMCompletionWithToolsOptions
  ): Promise<LLMToolResponse> {
    // Extract system message if present
    const systemMessage = messages.find((m) => m.role === "system");

    // Convert messages to Anthropic format
    const anthropicMessages = this.convertMessagesToAnthropic(
      messages.filter((m) => m.role !== "system")
    );

    // Convert tools to Anthropic format
    const anthropicTools = options?.tools
      ? this.convertToolsToAnthropic(options.tools)
      : undefined;

    const requestBody: Record<string, unknown> = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: anthropicMessages,
    };

    if (systemMessage?.content) {
      requestBody.system = systemMessage.content;
    }

    if (anthropicTools && anthropicTools.length > 0) {
      requestBody.tools = anthropicTools;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as AnthropicResponse;

    // Convert response to our format
    return this.convertResponseToToolResponse(data);
  }

  private convertMessagesToAnthropic(messages: LLMMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({
          role: "user",
          content: msg.content,
        });
      } else if (msg.role === "assistant") {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Assistant message with tool calls
          const contentBlocks: AnthropicContentBlock[] = [];

          // Add text content if present
          if (msg.content) {
            contentBlocks.push({
              type: "text",
              text: msg.content,
            });
          }

          // Add tool use blocks
          for (const tc of msg.tool_calls) {
            contentBlocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }

          result.push({
            role: "assistant",
            content: contentBlocks,
          });
        } else {
          result.push({
            role: "assistant",
            content: msg.content,
          });
        }
      } else if (msg.role === "tool") {
        // Tool results need to be added as user messages in Anthropic format
        // They should be grouped with the previous tool results if any
        const lastMsg = result[result.length - 1];

        const toolResultBlock: AnthropicContentBlock = {
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        };

        if (lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
          // Append to existing user message with tool results
          (lastMsg.content as AnthropicContentBlock[]).push(toolResultBlock);
        } else {
          // Create new user message with tool result
          result.push({
            role: "user",
            content: [toolResultBlock],
          });
        }
      }
    }

    return result;
  }

  private convertToolsToAnthropic(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: {
        type: "object" as const,
        properties: tool.function.parameters.properties,
        required: tool.function.parameters.required,
      },
    }));
  }

  private convertResponseToToolResponse(data: AnthropicResponse): LLMToolResponse {
    const toolCalls: ToolCall[] = [];
    let textContent = "";

    for (const block of data.content) {
      if (block.type === "text" && block.text) {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id!,
          type: "function",
          function: {
            name: block.name!,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    // Determine finish reason
    let finishReason: "stop" | "tool_calls" | "length" = "stop";
    if (data.stop_reason === "tool_use") {
      finishReason = "tool_calls";
    } else if (data.stop_reason === "max_tokens") {
      finishReason = "length";
    }

    return {
      content: textContent || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: finishReason,
    };
  }
}
