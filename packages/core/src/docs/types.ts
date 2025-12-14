/**
 * GitHub Docs Aggregator Types
 *
 * Types for fetching and indexing documentation from GitHub repositories.
 */

import type { DocumentSource } from "../rag/types";

/**
 * Configuration for which docs to fetch from a repository
 */
export interface DocsFetchConfig {
  /** Glob patterns for doc files to fetch */
  patterns: string[];
  /** Directories to scan for docs */
  directories: string[];
  /** File extensions to include */
  extensions: string[];
  /** Maximum file size in bytes (skip larger files) */
  maxFileSize: number;
  /** Maximum files per repository */
  maxFilesPerRepo: number;
}

/**
 * A fetched documentation file
 */
export interface FetchedDoc {
  /** Repository in owner/repo format */
  repository: string;
  /** File path within the repository */
  path: string;
  /** File content */
  content: string;
  /** Content type based on path */
  type: DocumentSource;
  /** File size in bytes */
  size: number;
  /** SHA of the file */
  sha: string;
  /** Service name if from service registry */
  serviceName?: string;
}

/**
 * Result of fetching docs from a repository
 */
export interface RepoDocsResult {
  /** Repository in owner/repo format */
  repository: string;
  /** Service name if from service registry */
  serviceName?: string;
  /** Number of docs fetched */
  docsCount: number;
  /** Total size of fetched docs */
  totalSize: number;
  /** Fetched documents */
  docs: FetchedDoc[];
  /** Errors encountered */
  errors: string[];
}

/**
 * Result of aggregating docs from multiple repositories
 */
export interface AggregationResult {
  /** Total repositories processed */
  reposProcessed: number;
  /** Total documents fetched */
  docsFound: number;
  /** Total documents indexed */
  docsIndexed: number;
  /** Total chunks created */
  chunksCreated: number;
  /** Errors by repository */
  errors: Map<string, string[]>;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Default configuration for docs fetching
 */
export const DEFAULT_DOCS_CONFIG: DocsFetchConfig = {
  patterns: [
    "README.md",
    "README",
    "readme.md",
    "CONTRIBUTING.md",
    "CHANGELOG.md",
    "ARCHITECTURE.md",
    "docs/**/*.md",
    "documentation/**/*.md",
    "runbooks/**/*.md",
    "runbook/**/*.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/*.md",
  ],
  directories: ["docs", "documentation", "runbooks", "runbook", "wiki", ".github"],
  extensions: [".md", ".mdx", ".txt", ".rst"],
  maxFileSize: 500 * 1024, // 500KB
  maxFilesPerRepo: 100,
};
