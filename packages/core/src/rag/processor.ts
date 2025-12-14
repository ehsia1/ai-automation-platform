/**
 * Document Processor
 *
 * Handles document chunking, preprocessing, and embedding generation.
 */

import type {
  Document,
  DocumentChunk,
  ChunkingOptions,
  EmbeddingProvider,
} from "./types";

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;
const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

/**
 * Split text into chunks
 */
function splitText(
  text: string,
  options: ChunkingOptions = {}
): string[] {
  const maxChunkSize = options.maxChunkSize || DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap || DEFAULT_CHUNK_OVERLAP;
  const separators = options.separators || DEFAULT_SEPARATORS;

  const chunks: string[] = [];

  function splitRecursive(text: string, separatorIndex: number): string[] {
    if (text.length <= maxChunkSize) {
      return [text.trim()].filter(Boolean);
    }

    const separator = separators[separatorIndex] || "";

    if (!separator) {
      // No more separators - hard split
      const result: string[] = [];
      for (let i = 0; i < text.length; i += maxChunkSize - chunkOverlap) {
        result.push(text.slice(i, i + maxChunkSize).trim());
      }
      return result.filter(Boolean);
    }

    const parts = text.split(separator);
    const result: string[] = [];
    let currentChunk = "";

    for (const part of parts) {
      const potentialChunk = currentChunk
        ? currentChunk + separator + part
        : part;

      if (potentialChunk.length <= maxChunkSize) {
        currentChunk = potentialChunk;
      } else {
        if (currentChunk) {
          result.push(currentChunk.trim());
        }

        // If part is too long, split it recursively
        if (part.length > maxChunkSize) {
          result.push(...splitRecursive(part, separatorIndex + 1));
          currentChunk = "";
        } else {
          currentChunk = part;
        }
      }
    }

    if (currentChunk.trim()) {
      result.push(currentChunk.trim());
    }

    return result;
  }

  const rawChunks = splitRecursive(text, 0);

  // Add overlap between chunks
  for (let i = 0; i < rawChunks.length; i++) {
    if (i > 0 && chunkOverlap > 0) {
      // Get overlap from previous chunk
      const prevChunk = rawChunks[i - 1];
      const overlapText = prevChunk.slice(-chunkOverlap);
      chunks.push(overlapText + " " + rawChunks[i]);
    } else {
      chunks.push(rawChunks[i]);
    }
  }

  return chunks.filter(Boolean);
}

/**
 * Preprocess text for embedding
 */
function preprocessText(text: string): string {
  return text
    // Normalize whitespace
    .replace(/\s+/g, " ")
    // Remove excessive newlines
    .replace(/\n{3,}/g, "\n\n")
    // Trim
    .trim();
}

/**
 * Document processor for RAG pipeline
 */
export class DocumentProcessor {
  private embeddingProvider: EmbeddingProvider;
  private chunkingOptions: ChunkingOptions;

  constructor(
    embeddingProvider: EmbeddingProvider,
    chunkingOptions: ChunkingOptions = {}
  ) {
    this.embeddingProvider = embeddingProvider;
    this.chunkingOptions = chunkingOptions;
  }

  /**
   * Process a document into chunks with embeddings
   */
  async process(document: Document): Promise<DocumentChunk[]> {
    // Preprocess content
    const cleanContent = preprocessText(document.content);

    // Split into chunks
    const textChunks = splitText(cleanContent, this.chunkingOptions);

    if (textChunks.length === 0) {
      return [];
    }

    // Generate embeddings for all chunks
    const embeddings = await this.embeddingProvider.embedBatch(textChunks);

    // Create document chunks
    const chunks: DocumentChunk[] = textChunks.map((content, index) => ({
      documentId: document.id,
      chunkIndex: index,
      content,
      embedding: embeddings[index],
      metadata: document.metadata,
    }));

    console.log(
      `[DocumentProcessor] Processed document ${document.id}: ${textChunks.length} chunks`
    );

    return chunks;
  }

  /**
   * Process multiple documents
   */
  async processBatch(documents: Document[]): Promise<DocumentChunk[]> {
    const allChunks: DocumentChunk[] = [];

    for (const doc of documents) {
      const chunks = await this.process(doc);
      allChunks.push(...chunks);
    }

    return allChunks;
  }

  /**
   * Generate embedding for a query (for searching)
   */
  async embedQuery(query: string): Promise<number[]> {
    const cleanQuery = preprocessText(query);
    return this.embeddingProvider.embed(cleanQuery);
  }
}

/**
 * Create a document processor
 */
export function createDocumentProcessor(
  embeddingProvider: EmbeddingProvider,
  chunkingOptions?: ChunkingOptions
): DocumentProcessor {
  return new DocumentProcessor(embeddingProvider, chunkingOptions);
}

// Export utility functions for direct use
export { splitText, preprocessText };
