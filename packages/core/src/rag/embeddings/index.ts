/**
 * Embedding Providers
 *
 * Export all embedding providers and factory function.
 */

export * from "./ollama";
export * from "./bedrock";

import type { EmbeddingProvider } from "../types";
import { createOllamaEmbedding, type OllamaEmbeddingConfig } from "./ollama";
import { createBedrockEmbedding, type BedrockEmbeddingConfig } from "./bedrock";

export type EmbeddingProviderType = "ollama" | "bedrock";

export interface CreateEmbeddingProviderOptions {
  type?: EmbeddingProviderType;
  ollama?: OllamaEmbeddingConfig;
  bedrock?: BedrockEmbeddingConfig;
}

/**
 * Create an embedding provider based on configuration or environment
 */
export function createEmbeddingProvider(
  options: CreateEmbeddingProviderOptions = {}
): EmbeddingProvider {
  const type = options.type || (process.env.EMBEDDING_PROVIDER as EmbeddingProviderType) || "ollama";

  switch (type) {
    case "bedrock":
      return createBedrockEmbedding(options.bedrock);
    case "ollama":
    default:
      return createOllamaEmbedding(options.ollama);
  }
}
