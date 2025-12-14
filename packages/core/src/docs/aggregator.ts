/**
 * Docs Aggregator
 *
 * Aggregates documentation from all services in the registry
 * and indexes them into the RAG system for semantic search.
 *
 * Usage:
 * ```typescript
 * import { DocsAggregator, aggregateServiceDocs } from './docs';
 *
 * // One-line aggregation (uses service registry)
 * const result = await aggregateServiceDocs();
 *
 * // Or with more control:
 * const aggregator = new DocsAggregator();
 * await aggregator.aggregateFromRegistry();
 * ```
 */

import { getRagClient } from "../rag/client";
import type { Document } from "../rag/types";
import { getServiceRegistry, initializeServiceRegistry } from "../services";
import { GitHubDocsLoader } from "./github-loader";
import type { AggregationResult, FetchedDoc, DocsFetchConfig, RepoDocsResult } from "./types";
import { DEFAULT_DOCS_CONFIG } from "./types";

/**
 * Convert a fetched doc to a RAG document
 */
function toRagDocument(doc: FetchedDoc): Document {
  // Create a unique ID based on repo and path
  const id = `github:${doc.repository}:${doc.path}`.replace(/[^a-zA-Z0-9:-]/g, "_");

  return {
    id,
    content: doc.content,
    metadata: {
      source: doc.type,
      service: doc.serviceName,
      path: doc.path,
      title: extractTitle(doc.content, doc.path),
      repository: doc.repository,
    },
  };
}

/**
 * Extract title from markdown content or filename
 */
function extractTitle(content: string, path: string): string {
  // Try to extract H1 from markdown
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Fall back to filename without extension
  const filename = path.split("/").pop() || path;
  return filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
}

/**
 * Docs Aggregator class
 */
export class DocsAggregator {
  private loader: GitHubDocsLoader;
  private config: DocsFetchConfig;

  constructor(config: Partial<DocsFetchConfig> = {}) {
    this.config = { ...DEFAULT_DOCS_CONFIG, ...config };
    this.loader = new GitHubDocsLoader(this.config);
  }

  /**
   * Aggregate docs from all services in the registry
   */
  async aggregateFromRegistry(): Promise<AggregationResult> {
    const startTime = Date.now();
    const result: AggregationResult = {
      reposProcessed: 0,
      docsFound: 0,
      docsIndexed: 0,
      chunksCreated: 0,
      errors: new Map(),
      durationMs: 0,
    };

    // Initialize service registry
    const registry = getServiceRegistry();
    if (!registry.isInitialized()) {
      try {
        await initializeServiceRegistry();
      } catch (error) {
        console.log("[DocsAggregator] Service registry not found, skipping");
        result.durationMs = Date.now() - startTime;
        return result;
      }
    }

    // Get all services
    const services = registry.getAll();
    if (services.size === 0) {
      console.log("[DocsAggregator] No services in registry");
      result.durationMs = Date.now() - startTime;
      return result;
    }

    console.log(`[DocsAggregator] Found ${services.size} services in registry`);

    // Collect repos to fetch
    const repos: Array<{ repository: string; serviceName: string }> = [];
    for (const [name, config] of services) {
      repos.push({ repository: config.repository, serviceName: name });
    }

    // Aggregate from repos
    const repoResults = await this.aggregateFromRepos(repos);

    result.reposProcessed = repoResults.reposProcessed;
    result.docsFound = repoResults.docsFound;
    result.docsIndexed = repoResults.docsIndexed;
    result.chunksCreated = repoResults.chunksCreated;
    result.errors = repoResults.errors;
    result.durationMs = Date.now() - startTime;

    return result;
  }

  /**
   * Aggregate docs from a list of repositories
   */
  async aggregateFromRepos(
    repos: Array<{ repository: string; serviceName?: string }>
  ): Promise<AggregationResult> {
    const startTime = Date.now();
    const result: AggregationResult = {
      reposProcessed: 0,
      docsFound: 0,
      docsIndexed: 0,
      chunksCreated: 0,
      errors: new Map(),
      durationMs: 0,
    };

    // Fetch docs from all repos
    const repoResults = await this.loader.fetchFromRepos(repos);

    // Initialize RAG client
    const ragClient = getRagClient();
    await ragClient.initialize();

    // Index docs from each repo
    for (const repoResult of repoResults) {
      result.reposProcessed++;

      if (repoResult.errors.length > 0) {
        result.errors.set(repoResult.repository, repoResult.errors);
      }

      result.docsFound += repoResult.docsCount;

      // Convert and index documents
      if (repoResult.docs.length > 0) {
        const documents = repoResult.docs.map(toRagDocument);

        try {
          const chunksCreated = await ragClient.indexDocuments(documents);
          result.docsIndexed += documents.length;
          result.chunksCreated += chunksCreated;
          console.log(
            `[DocsAggregator] Indexed ${documents.length} docs from ${repoResult.repository} (${chunksCreated} chunks)`
          );
        } catch (error) {
          const errors = result.errors.get(repoResult.repository) || [];
          errors.push(`Indexing failed: ${error}`);
          result.errors.set(repoResult.repository, errors);
        }
      }
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * Aggregate docs from a single repository
   */
  async aggregateFromRepo(
    repository: string,
    serviceName?: string
  ): Promise<AggregationResult> {
    return this.aggregateFromRepos([{ repository, serviceName }]);
  }

  /**
   * Index a single document
   */
  async indexDocument(doc: FetchedDoc): Promise<number> {
    const ragClient = getRagClient();
    await ragClient.initialize();

    const document = toRagDocument(doc);
    return ragClient.indexDocuments([document]);
  }
}

// Singleton instance
let aggregatorInstance: DocsAggregator | null = null;

/**
 * Get the global DocsAggregator instance
 */
export function getDocsAggregator(config?: Partial<DocsFetchConfig>): DocsAggregator {
  if (!aggregatorInstance || config) {
    aggregatorInstance = new DocsAggregator(config);
  }
  return aggregatorInstance;
}

/**
 * Convenience function to aggregate all service docs
 */
export async function aggregateServiceDocs(): Promise<AggregationResult> {
  const aggregator = getDocsAggregator();
  return aggregator.aggregateFromRegistry();
}

/**
 * Convenience function to aggregate docs from specific repos
 */
export async function aggregateRepoDocs(
  repos: Array<{ repository: string; serviceName?: string }>
): Promise<AggregationResult> {
  const aggregator = getDocsAggregator();
  return aggregator.aggregateFromRepos(repos);
}
