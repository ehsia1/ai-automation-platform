/**
 * Ollama Embedding Provider
 *
 * Uses local Ollama instance for generating embeddings.
 * Great for development - no API costs.
 */

import type { EmbeddingProvider } from "../types";

export interface OllamaEmbeddingConfig {
  /** Ollama base URL */
  baseUrl?: string;
  /** Model to use for embeddings */
  model?: string;
}

/**
 * Get embedding dimension for common models
 */
function getModelDimension(model: string): number {
  const dimensions: Record<string, number> = {
    "nomic-embed-text": 768,
    "mxbai-embed-large": 1024,
    "all-minilm": 384,
    "snowflake-arctic-embed": 1024,
  };

  // Default to nomic-embed-text dimension
  return dimensions[model] || 768;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = "ollama";
  readonly dimension: number;

  private baseUrl: string;
  private model: string;

  constructor(config: OllamaEmbeddingConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    this.model = config.model || process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
    this.dimension = getModelDimension(this.model);
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding failed: ${error}`);
    }

    const result = await response.json() as { embedding: number[] };
    return result.embedding;
  }

  /**
   * Generate embeddings for multiple texts
   * Note: Ollama doesn't have native batch support, so we parallelize
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Process in parallel with concurrency limit
    const concurrency = 5;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += concurrency) {
      const batch = texts.slice(i, i + concurrency);
      const embeddings = await Promise.all(batch.map((text) => this.embed(text)));
      results.push(...embeddings);
    }

    return results;
  }
}

/**
 * Create Ollama embedding provider
 */
export function createOllamaEmbedding(config?: OllamaEmbeddingConfig): EmbeddingProvider {
  return new OllamaEmbeddingProvider(config);
}
