/**
 * RAG (Retrieval Augmented Generation) Module
 *
 * Provides semantic search over documentation, runbooks, and past incidents.
 *
 * Features:
 * - Multiple embedding providers (Ollama for local, Bedrock for AWS)
 * - Pluggable vector stores (file-based for dev, SST for production)
 * - Document chunking and preprocessing
 * - Agent tools for semantic search
 *
 * Usage:
 * ```typescript
 * import { getRagClient, Document } from './rag';
 *
 * // Index a document
 * const client = getRagClient();
 * await client.indexDocument({
 *   id: 'runbook-payment-errors',
 *   content: '# Payment Error Handling...',
 *   metadata: {
 *     source: 'runbook',
 *     service: 'payment-service',
 *     title: 'Payment Error Handling Guide',
 *   },
 * });
 *
 * // Search for relevant docs
 * const results = await client.search('how to handle payment timeouts');
 *
 * // Get formatted context for LLM
 * const context = await client.getContext('payment timeout errors');
 * ```
 */

// Types
export * from "./types";

// Embedding providers
export * from "./embeddings";

// Vector stores
export * from "./stores";

// Document processor
export { DocumentProcessor, createDocumentProcessor, splitText, preprocessText } from "./processor";

// RAG client
export { RagClient, getRagClient, resetRagClient, type RagClientOptions } from "./client";

// Agent tools
export { searchDocsTool, docsStatsTool } from "./tool";
