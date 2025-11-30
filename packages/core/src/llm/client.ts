import type {
  LLMProvider,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionWithToolsOptions,
  LLMToolResponse,
  LLMConfig,
} from "./providers/types";
import { OllamaProvider } from "./providers/ollama";
import { AnthropicProvider } from "./providers/anthropic";

let provider: LLMProvider | null = null;

export function initializeLLM(config: LLMConfig): void {
  if (config.provider === "ollama") {
    provider = new OllamaProvider({
      baseUrl: config.ollamaBaseUrl || "http://localhost:11434",
      model: config.ollamaModel || "llama3.1:8b",
    });
  } else if (config.provider === "anthropic") {
    if (!config.anthropicApiKey) {
      throw new Error("Anthropic API key is required");
    }
    provider = new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
    });
  } else {
    throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

export function getProvider(): LLMProvider {
  if (!provider) {
    // Default to Ollama for local development
    provider = new OllamaProvider({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: process.env.OLLAMA_MODEL || "llama3.1:8b",
    });
  }
  return provider;
}

export async function complete(
  messages: LLMMessage[],
  options?: LLMCompletionOptions
): Promise<string> {
  return getProvider().complete(messages, options);
}

export async function completeWithTools(
  messages: LLMMessage[],
  options?: LLMCompletionWithToolsOptions
): Promise<LLMToolResponse> {
  const p = getProvider();
  if (!p.completeWithTools) {
    throw new Error(
      "Tool calling is not supported by the current LLM provider"
    );
  }
  return p.completeWithTools(messages, options);
}

export async function completeJSON<T>(
  messages: LLMMessage[],
  options?: LLMCompletionOptions
): Promise<T> {
  const response = await complete(messages, options);

  // Try to extract JSON from the response
  // Sometimes LLMs wrap JSON in markdown code blocks
  let jsonStr = response;

  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Also try to find raw JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    throw new Error(`Failed to parse LLM response as JSON: ${response}`);
  }
}
