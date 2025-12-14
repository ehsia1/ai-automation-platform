/**
 * RAG (Retrieval Augmented Generation) Types
 *
 * Defines interfaces for vector storage and semantic search
 * to enhance agent capabilities with relevant documentation.
 */

/**
 * A document to be stored in the vector database
 */
export interface Document {
  /** Unique identifier */
  id: string;
  /** Document content */
  content: string;
  /** Document metadata for filtering */
  metadata: DocumentMetadata;
}

/**
 * Metadata attached to documents for filtering and context
 */
export interface DocumentMetadata {
  /** Source type: runbook, incident, readme, etc. */
  source: DocumentSource;
  /** Service or repository this doc belongs to */
  service?: string;
  /** Original file path or URL */
  path?: string;
  /** Title of the document */
  title?: string;
  /** When the document was created/updated */
  timestamp?: string;
  /** Custom metadata */
  [key: string]: unknown;
}

/**
 * Types of document sources
 */
export type DocumentSource =
  | "runbook"
  | "incident"
  | "readme"
  | "wiki"
  | "code_comment"
  | "pr_description"
  | "issue"
  | "slack_thread"
  | "custom";

/**
 * A chunk of a document with its embedding
 */
export interface DocumentChunk {
  /** Original document ID */
  documentId: string;
  /** Chunk index within document */
  chunkIndex: number;
  /** Chunk content */
  content: string;
  /** Vector embedding */
  embedding: number[];
  /** Inherited metadata */
  metadata: DocumentMetadata;
}

/**
 * Search query options
 */
export interface SearchOptions {
  /** Maximum number of results */
  limit?: number;
  /** Minimum similarity threshold (0-1) */
  threshold?: number;
  /** Filter by metadata */
  filter?: Partial<DocumentMetadata>;
  /** Include document content in results */
  includeContent?: boolean;
}

/**
 * Search result
 */
export interface SearchResult {
  /** Document chunk */
  chunk: DocumentChunk;
  /** Similarity score (0-1, higher is more similar) */
  score: number;
}

/**
 * Vector store interface - abstracts the underlying storage
 */
export interface VectorStore {
  /** Store name for identification */
  name: string;

  /** Initialize the store */
  initialize(): Promise<void>;

  /** Add documents to the store */
  upsert(chunks: DocumentChunk[]): Promise<void>;

  /** Search for similar documents */
  search(embedding: number[], options?: SearchOptions): Promise<SearchResult[]>;

  /** Remove documents by ID */
  remove(documentId: string): Promise<void>;

  /** Clear all documents */
  clear(): Promise<void>;

  /** Get store statistics */
  stats(): Promise<VectorStoreStats>;
}

/**
 * Vector store statistics
 */
export interface VectorStoreStats {
  /** Total number of chunks */
  totalChunks: number;
  /** Total number of unique documents */
  totalDocuments: number;
  /** Storage size in bytes (if available) */
  sizeBytes?: number;
}

/**
 * Embedding provider interface
 */
export interface EmbeddingProvider {
  /** Provider name */
  name: string;
  /** Embedding dimension */
  dimension: number;

  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;

  /** Generate embeddings for multiple texts (batch) */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * Document chunking options
 */
export interface ChunkingOptions {
  /** Maximum chunk size in characters */
  maxChunkSize?: number;
  /** Overlap between chunks */
  chunkOverlap?: number;
  /** Split on these separators (in order of preference) */
  separators?: string[];
}

/**
 * RAG configuration
 */
export interface RagConfig {
  /** Embedding provider to use */
  embeddingProvider: "ollama" | "bedrock";
  /** Vector store to use */
  vectorStore: "file" | "sst";
  /** Chunking options */
  chunking?: ChunkingOptions;
  /** Default search options */
  defaultSearchOptions?: SearchOptions;
}
