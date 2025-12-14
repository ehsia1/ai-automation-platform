/**
 * AWS Bedrock Embedding Provider
 *
 * Uses Amazon Bedrock for generating embeddings.
 * For production use in AWS Lambda.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { EmbeddingProvider } from "../types";

export interface BedrockEmbeddingConfig {
  /** AWS region */
  region?: string;
  /** Model ID to use */
  modelId?: string;
}

/**
 * Get embedding dimension for Bedrock models
 */
function getModelDimension(modelId: string): number {
  const dimensions: Record<string, number> = {
    "amazon.titan-embed-text-v1": 1536,
    "amazon.titan-embed-text-v2:0": 1024,
    "cohere.embed-english-v3": 1024,
    "cohere.embed-multilingual-v3": 1024,
  };

  // Default to Titan v2 dimension
  return dimensions[modelId] || 1024;
}

export class BedrockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "bedrock";
  readonly dimension: number;

  private client: BedrockRuntimeClient;
  private modelId: string;

  constructor(config: BedrockEmbeddingConfig = {}) {
    const region = config.region || process.env.BEDROCK_REGION || "us-east-1";
    this.modelId = config.modelId || process.env.BEDROCK_EMBEDDING_MODEL || "amazon.titan-embed-text-v2:0";
    this.dimension = getModelDimension(this.modelId);

    this.client = new BedrockRuntimeClient({ region });
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    // Format request based on model
    const body = this.formatRequest(text);

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      body: JSON.stringify(body),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await this.client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));

    return this.extractEmbedding(result);
  }

  /**
   * Generate embeddings for multiple texts
   * Bedrock doesn't have native batch support, so we parallelize with limits
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Process in parallel with concurrency limit to avoid throttling
    const concurrency = 3;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += concurrency) {
      const batch = texts.slice(i, i + concurrency);
      const embeddings = await Promise.all(batch.map((text) => this.embed(text)));
      results.push(...embeddings);
    }

    return results;
  }

  /**
   * Format request body based on model
   */
  private formatRequest(text: string): Record<string, unknown> {
    if (this.modelId.startsWith("amazon.titan")) {
      return { inputText: text };
    }

    if (this.modelId.startsWith("cohere")) {
      return {
        texts: [text],
        input_type: "search_document",
      };
    }

    // Default Titan format
    return { inputText: text };
  }

  /**
   * Extract embedding from response based on model
   */
  private extractEmbedding(result: Record<string, unknown>): number[] {
    if (this.modelId.startsWith("amazon.titan")) {
      return result.embedding as number[];
    }

    if (this.modelId.startsWith("cohere")) {
      const embeddings = result.embeddings as number[][];
      return embeddings[0];
    }

    // Default extraction
    return result.embedding as number[];
  }
}

/**
 * Create Bedrock embedding provider
 */
export function createBedrockEmbedding(config?: BedrockEmbeddingConfig): EmbeddingProvider {
  return new BedrockEmbeddingProvider(config);
}
