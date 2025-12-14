/**
 * RAG Client
 *
 * High-level interface for RAG operations.
 * Ties together embedding provider, vector store, and document processor.
 */

import type {
  Document,
  DocumentChunk,
  SearchResult,
  SearchOptions,
  VectorStore,
  EmbeddingProvider,
  VectorStoreStats,
  RagConfig,
} from "./types";
import { createEmbeddingProvider, type EmbeddingProviderType } from "./embeddings";
import { createVectorStore, type VectorStoreType } from "./stores";
import { DocumentProcessor } from "./processor";

export interface RagClientOptions {
  /** Embedding provider type */
  embeddingProvider?: EmbeddingProviderType;
  /** Vector store type */
  vectorStore?: VectorStoreType;
  /** Custom embedding provider instance */
  customEmbeddingProvider?: EmbeddingProvider;
  /** Custom vector store instance */
  customVectorStore?: VectorStore;
  /** Default search options */
  defaultSearchOptions?: SearchOptions;
}

/**
 * Main RAG client for document indexing and semantic search
 */
export class RagClient {
  private embeddingProvider: EmbeddingProvider;
  private vectorStore: VectorStore;
  private processor: DocumentProcessor;
  private defaultSearchOptions: SearchOptions;
  private initialized = false;

  constructor(options: RagClientOptions = {}) {
    // Use custom providers or create from type
    this.embeddingProvider =
      options.customEmbeddingProvider ||
      createEmbeddingProvider({ type: options.embeddingProvider });

    this.vectorStore =
      options.customVectorStore ||
      createVectorStore({ type: options.vectorStore });

    this.processor = new DocumentProcessor(this.embeddingProvider);

    this.defaultSearchOptions = {
      limit: 5,
      threshold: 0.4, // Lower threshold for better recall with local embeddings
      includeContent: true,
      ...options.defaultSearchOptions,
    };
  }

  /**
   * Initialize the RAG client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.vectorStore.initialize();
    this.initialized = true;
    console.log("[RagClient] Initialized");
  }

  /**
   * Ensure client is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Index a document
   */
  async indexDocument(document: Document): Promise<number> {
    await this.ensureInitialized();

    // Remove existing chunks for this document (for updates)
    await this.vectorStore.remove(document.id);

    // Process document into chunks
    const chunks = await this.processor.process(document);

    if (chunks.length === 0) {
      console.log(`[RagClient] Document ${document.id} produced no chunks`);
      return 0;
    }

    // Store chunks
    await this.vectorStore.upsert(chunks);

    console.log(`[RagClient] Indexed document ${document.id}: ${chunks.length} chunks`);
    return chunks.length;
  }

  /**
   * Index multiple documents
   */
  async indexDocuments(documents: Document[]): Promise<number> {
    await this.ensureInitialized();

    let totalChunks = 0;
    for (const doc of documents) {
      const count = await this.indexDocument(doc);
      totalChunks += count;
    }

    console.log(`[RagClient] Indexed ${documents.length} documents: ${totalChunks} total chunks`);
    return totalChunks;
  }

  /**
   * Search for relevant documents
   */
  async search(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();

    const searchOptions = { ...this.defaultSearchOptions, ...options };

    // Generate query embedding
    const embedding = await this.processor.embedQuery(query);

    // Search vector store
    const results = await this.vectorStore.search(embedding, searchOptions);

    console.log(
      `[RagClient] Search for "${query.slice(0, 50)}...": ${results.length} results`
    );

    return results;
  }

  /**
   * Get context for a query (formatted for LLM)
   */
  async getContext(
    query: string,
    options?: SearchOptions
  ): Promise<string> {
    const results = await this.search(query, options);

    if (results.length === 0) {
      return "No relevant documentation found.";
    }

    // Format results as context
    const contextParts = results.map((result, index) => {
      const { chunk, score } = result;
      const source = chunk.metadata.title || chunk.metadata.path || chunk.documentId;
      const sourceType = chunk.metadata.source;

      return [
        `[${index + 1}] Source: ${source} (${sourceType}, relevance: ${(score * 100).toFixed(1)}%)`,
        chunk.content,
      ].join("\n");
    });

    return [
      `Found ${results.length} relevant document(s):`,
      "",
      ...contextParts,
    ].join("\n\n");
  }

  /**
   * Remove a document from the index
   */
  async removeDocument(documentId: string): Promise<void> {
    await this.ensureInitialized();
    await this.vectorStore.remove(documentId);
    console.log(`[RagClient] Removed document ${documentId}`);
  }

  /**
   * Clear all indexed documents
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.vectorStore.clear();
    console.log("[RagClient] Cleared all documents");
  }

  /**
   * Get indexing statistics
   */
  async stats(): Promise<VectorStoreStats> {
    await this.ensureInitialized();
    return this.vectorStore.stats();
  }

  /**
   * Get the embedding dimension
   */
  get embeddingDimension(): number {
    return this.embeddingProvider.dimension;
  }
}

// Singleton instance
let ragClientInstance: RagClient | null = null;

/**
 * Get the global RAG client instance
 */
export function getRagClient(options?: RagClientOptions): RagClient {
  if (!ragClientInstance) {
    ragClientInstance = new RagClient(options);
  }
  return ragClientInstance;
}

/**
 * Reset the global RAG client (for testing)
 */
export function resetRagClient(): void {
  ragClientInstance = null;
}
