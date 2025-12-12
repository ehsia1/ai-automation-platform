import type {
  LLMProvider,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionWithToolsOptions,
  LLMToolResponse,
  LLMConfig,
  LLMRetryOptions,
} from "./providers/types";
import { OllamaProvider } from "./providers/ollama";
import { AnthropicProvider } from "./providers/anthropic";
import { BedrockProvider } from "./providers/bedrock";
import { withRetry, type RetryOptions } from "./retry";

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
  } else if (config.provider === "bedrock") {
    provider = new BedrockProvider({
      region: config.bedrockRegion,
      model: config.bedrockModel,
    });
  } else {
    throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

export function getProvider(): LLMProvider {
  if (!provider) {
    const llmProvider = process.env.LLM_PROVIDER || "ollama";

    if (llmProvider === "anthropic") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY environment variable is required when using Anthropic provider");
      }
      provider = new AnthropicProvider({
        apiKey,
        model: process.env.ANTHROPIC_MODEL,
      });
    } else if (llmProvider === "bedrock") {
      provider = new BedrockProvider({
        region: process.env.BEDROCK_REGION || process.env.AWS_REGION,
        model: process.env.BEDROCK_MODEL,
      });
    } else {
      // Default to Ollama for local development
      provider = new OllamaProvider({
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        model: process.env.OLLAMA_MODEL || "llama3.1:8b",
      });
    }
  }
  return provider;
}

/**
 * Convert LLM retry options to internal retry options
 */
function toRetryOptions(
  retryConfig: LLMRetryOptions | false | undefined
): RetryOptions | undefined {
  if (retryConfig === false) {
    return { maxRetries: 0 };
  }
  if (!retryConfig) {
    // Default retry options
    return {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      onRetry: (error, attempt, delayMs) => {
        console.warn(
          `LLM call failed, retrying (attempt ${attempt}, delay ${delayMs}ms):`,
          error instanceof Error ? error.message : error
        );
      },
    };
  }
  return {
    ...retryConfig,
    onRetry:
      retryConfig.onRetry ??
      ((error, attempt, delayMs) => {
        console.warn(
          `LLM call failed, retrying (attempt ${attempt}, delay ${delayMs}ms):`,
          error instanceof Error ? error.message : error
        );
      }),
  };
}

export async function complete(
  messages: LLMMessage[],
  options?: LLMCompletionOptions
): Promise<string> {
  const retryOpts = toRetryOptions(options?.retry);

  return withRetry(
    () => getProvider().complete(messages, options),
    retryOpts
  );
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

  const retryOpts = toRetryOptions(options?.retry);

  return withRetry(() => p.completeWithTools!(messages, options), retryOpts);
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
