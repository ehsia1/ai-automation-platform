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
    const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls?.map(
      (tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })
    );

    // Determine finish reason
    let finishReason: "stop" | "tool_calls" | "length" = "stop";
    if (choice?.finish_reason === "tool_calls" || toolCalls?.length) {
      finishReason = "tool_calls";
    } else if (choice?.finish_reason === "length") {
      finishReason = "length";
    }

    return {
      content: choice?.message?.content || undefined,
      tool_calls: toolCalls,
      finish_reason: finishReason,
    };
  }
}
