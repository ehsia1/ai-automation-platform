export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

// Tool calling types
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameterProperty>;
      required?: string[];
    };
  };
}

export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  items?: {
    type: string;
    properties?: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LLMToolResponse {
  content?: string;
  tool_calls?: ToolCall[];
  finish_reason: "stop" | "tool_calls" | "length";
}

export interface LLMCompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LLMCompletionWithToolsOptions extends LLMCompletionOptions {
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

export interface LLMProvider {
  complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<string>;

  completeWithTools?(
    messages: LLMMessage[],
    options?: LLMCompletionWithToolsOptions
  ): Promise<LLMToolResponse>;
}

export interface LLMConfig {
  provider: "ollama" | "anthropic";
  // Ollama config
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  // Anthropic config
  anthropicApiKey?: string;
  anthropicModel?: string;
}
