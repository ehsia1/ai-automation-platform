/**
 * File-based Vector Store
 *
 * Simple JSON file storage for local development.
 * No external dependencies - works anywhere.
 */

import fs from "fs/promises";
import path from "path";
import type {
  VectorStore,
  VectorStoreStats,
  DocumentChunk,
  SearchResult,
  SearchOptions,
  DocumentMetadata,
} from "../types";

export interface FileStoreConfig {
  /** Directory to store the vector data */
  dataDir?: string;
  /** Filename for the index */
  indexFile?: string;
}

interface StoredData {
  chunks: DocumentChunk[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    version: number;
  };
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Check if metadata matches filter
 */
function matchesFilter(
  metadata: DocumentMetadata,
  filter: Partial<DocumentMetadata>
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && metadata[key] !== value) {
      return false;
    }
  }
  return true;
}

export class FileVectorStore implements VectorStore {
  readonly name = "file";

  private dataDir: string;
  private indexPath: string;
  private data: StoredData | null = null;

  constructor(config: FileStoreConfig = {}) {
    this.dataDir = config.dataDir || path.join(process.cwd(), ".rag");
    const indexFile = config.indexFile || "vectors.json";
    this.indexPath = path.join(this.dataDir, indexFile);
  }

  /**
   * Initialize the store - load existing data or create new
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });

      try {
        const content = await fs.readFile(this.indexPath, "utf-8");
        this.data = JSON.parse(content) as StoredData;
        console.log(`[FileVectorStore] Loaded ${this.data.chunks.length} chunks from ${this.indexPath}`);
      } catch {
        // File doesn't exist - start fresh
        this.data = {
          chunks: [],
          metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
          },
        };
        console.log("[FileVectorStore] Initialized new empty store");
      }
    } catch (error) {
      throw new Error(`Failed to initialize file store: ${error}`);
    }
  }

  /**
   * Save data to file
   */
  private async save(): Promise<void> {
    if (!this.data) {
      throw new Error("Store not initialized");
    }

    this.data.metadata.updatedAt = new Date().toISOString();
    await fs.writeFile(this.indexPath, JSON.stringify(this.data, null, 2));
  }

  /**
   * Add or update document chunks
   */
  async upsert(chunks: DocumentChunk[]): Promise<void> {
    if (!this.data) {
      await this.initialize();
    }

    for (const chunk of chunks) {
      // Check if chunk already exists
      const existingIndex = this.data!.chunks.findIndex(
        (c) => c.documentId === chunk.documentId && c.chunkIndex === chunk.chunkIndex
      );

      if (existingIndex >= 0) {
        // Update existing
        this.data!.chunks[existingIndex] = chunk;
      } else {
        // Add new
        this.data!.chunks.push(chunk);
      }
    }

    await this.save();
    console.log(`[FileVectorStore] Upserted ${chunks.length} chunks`);
  }

  /**
   * Search for similar chunks
   */
  async search(
    embedding: number[],
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    if (!this.data) {
      await this.initialize();
    }

    const {
      limit = 10,
      threshold = 0.7,
      filter,
      includeContent = true,
    } = options;

    // Calculate similarity for all chunks
    const results: SearchResult[] = [];

    for (const chunk of this.data!.chunks) {
      // Apply metadata filter
      if (filter && !matchesFilter(chunk.metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(embedding, chunk.embedding);

      if (score >= threshold) {
        results.push({
          chunk: includeContent
            ? chunk
            : { ...chunk, content: "", embedding: [] },
          score,
        });
      }
    }

    // Sort by score (descending) and limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Remove all chunks for a document
   */
  async remove(documentId: string): Promise<void> {
    if (!this.data) {
      await this.initialize();
    }

    const before = this.data!.chunks.length;
    this.data!.chunks = this.data!.chunks.filter((c) => c.documentId !== documentId);
    const removed = before - this.data!.chunks.length;

    if (removed > 0) {
      await this.save();
      console.log(`[FileVectorStore] Removed ${removed} chunks for document ${documentId}`);
    }
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    if (!this.data) {
      await this.initialize();
    }

    this.data!.chunks = [];
    await this.save();
    console.log("[FileVectorStore] Cleared all chunks");
  }

  /**
   * Get store statistics
   */
  async stats(): Promise<VectorStoreStats> {
    if (!this.data) {
      await this.initialize();
    }

    const documentIds = new Set(this.data!.chunks.map((c) => c.documentId));

    // Estimate file size
    let sizeBytes: number | undefined;
    try {
      const stat = await fs.stat(this.indexPath);
      sizeBytes = stat.size;
    } catch {
      // File may not exist yet
    }

    return {
      totalChunks: this.data!.chunks.length,
      totalDocuments: documentIds.size,
      sizeBytes,
    };
  }
}

/**
 * Create file vector store
 */
export function createFileStore(config?: FileStoreConfig): VectorStore {
  return new FileVectorStore(config);
}
