/**
 * GitHub Docs Module
 *
 * Fetches documentation from GitHub repositories and indexes
 * them into the RAG system for semantic search by the AI agent.
 *
 * Features:
 * - Automatic discovery of docs in repos (README, docs/, runbooks/)
 * - Integration with service registry for bulk indexing
 * - Support for markdown and other doc formats
 *
 * Usage:
 * ```typescript
 * import { aggregateServiceDocs, aggregateRepoDocs } from './docs';
 *
 * // Index all docs from service registry repos
 * const result = await aggregateServiceDocs();
 * console.log(`Indexed ${result.docsIndexed} docs`);
 *
 * // Index docs from specific repos
 * const result = await aggregateRepoDocs([
 *   { repository: 'owner/repo1', serviceName: 'service1' },
 *   { repository: 'owner/repo2' },
 * ]);
 * ```
 */

// Types
export * from "./types";

// GitHub loader
export { GitHubDocsLoader, fetchRepoDocumentation } from "./github-loader";

// Aggregator
export {
  DocsAggregator,
  getDocsAggregator,
  aggregateServiceDocs,
  aggregateRepoDocs,
} from "./aggregator";
