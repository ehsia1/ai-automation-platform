/**
 * GitHub Docs Loader
 *
 * Fetches documentation files from GitHub repositories.
 * Supports fetching READMEs, docs folders, runbooks, and other markdown files.
 */

import { Octokit } from "@octokit/rest";
import type { DocumentSource } from "../rag/types";
import type { FetchedDoc, RepoDocsResult, DocsFetchConfig } from "./types";
import { DEFAULT_DOCS_CONFIG } from "./types";

// Lazy initialization of Octokit client
let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is not set");
    }
    octokit = new Octokit({ auth: token });
  }
  return octokit;
}

/**
 * Determine document source type from file path
 */
function getDocType(path: string): DocumentSource {
  const lowerPath = path.toLowerCase();

  if (lowerPath.includes("runbook")) return "runbook";
  if (lowerPath.includes("readme")) return "readme";
  if (lowerPath.includes("wiki")) return "wiki";
  if (lowerPath.includes("issue_template")) return "issue";
  if (lowerPath.includes("pull_request_template")) return "pr_description";
  if (lowerPath.includes("docs/") || lowerPath.includes("documentation/")) return "wiki";

  return "readme";
}

/**
 * Check if a file matches the fetch patterns
 */
function matchesPatterns(path: string, config: DocsFetchConfig): boolean {
  const lowerPath = path.toLowerCase();

  // Check extensions
  const hasValidExtension = config.extensions.some((ext) =>
    lowerPath.endsWith(ext.toLowerCase())
  );
  if (!hasValidExtension) return false;

  // Check patterns (simple glob matching)
  return config.patterns.some((pattern) => {
    const lowerPattern = pattern.toLowerCase();

    // Exact match
    if (lowerPath === lowerPattern) return true;

    // Simple wildcard matching
    if (lowerPattern.includes("**")) {
      const base = lowerPattern.split("**")[0];
      return lowerPath.startsWith(base);
    }

    // Filename match (pattern without path)
    if (!lowerPattern.includes("/")) {
      const filename = lowerPath.split("/").pop() || "";
      return filename === lowerPattern;
    }

    return false;
  });
}

/**
 * Fetch a single file from GitHub
 */
async function fetchFile(
  owner: string,
  repo: string,
  path: string,
  config: DocsFetchConfig
): Promise<FetchedDoc | null> {
  const client = getOctokit();

  try {
    const response = await client.repos.getContent({
      owner,
      repo,
      path,
    });

    // Skip directories
    if (Array.isArray(response.data)) {
      return null;
    }

    if (response.data.type !== "file") {
      return null;
    }

    // Skip files that are too large
    if (response.data.size > config.maxFileSize) {
      console.log(`[DocsLoader] Skipping ${path}: too large (${response.data.size} bytes)`);
      return null;
    }

    // Decode content
    const content = Buffer.from(response.data.content, "base64").toString("utf8");

    return {
      repository: `${owner}/${repo}`,
      path,
      content,
      type: getDocType(path),
      size: response.data.size,
      sha: response.data.sha,
    };
  } catch (error) {
    // File not found is expected for optional files
    if ((error as { status?: number }).status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * List files in a directory recursively
 */
async function listDirectory(
  owner: string,
  repo: string,
  dirPath: string,
  config: DocsFetchConfig,
  depth = 0
): Promise<string[]> {
  // Limit recursion depth
  if (depth > 3) return [];

  const client = getOctokit();
  const files: string[] = [];

  try {
    const response = await client.repos.getContent({
      owner,
      repo,
      path: dirPath,
    });

    if (!Array.isArray(response.data)) {
      return [];
    }

    for (const item of response.data) {
      if (item.type === "file") {
        // Check if file matches our patterns
        if (matchesPatterns(item.path, config)) {
          files.push(item.path);
        }
      } else if (item.type === "dir") {
        // Recurse into subdirectories
        const subFiles = await listDirectory(owner, repo, item.path, config, depth + 1);
        files.push(...subFiles);
      }
    }
  } catch (error) {
    // Directory not found is expected
    if ((error as { status?: number }).status !== 404) {
      console.warn(`[DocsLoader] Error listing ${dirPath}: ${error}`);
    }
  }

  return files;
}

/**
 * Fetch all documentation from a repository
 */
export async function fetchRepoDocumentation(
  repository: string,
  serviceName?: string,
  config: DocsFetchConfig = DEFAULT_DOCS_CONFIG
): Promise<RepoDocsResult> {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    return {
      repository,
      serviceName,
      docsCount: 0,
      totalSize: 0,
      docs: [],
      errors: [`Invalid repository format: ${repository}`],
    };
  }

  const result: RepoDocsResult = {
    repository,
    serviceName,
    docsCount: 0,
    totalSize: 0,
    docs: [],
    errors: [],
  };

  const fetchedPaths = new Set<string>();

  try {
    // 1. Fetch root-level files (README, etc.)
    const rootFiles = ["README.md", "README", "readme.md", "CONTRIBUTING.md", "CHANGELOG.md", "ARCHITECTURE.md"];
    for (const filename of rootFiles) {
      if (fetchedPaths.size >= config.maxFilesPerRepo) break;

      try {
        const doc = await fetchFile(owner, repo, filename, config);
        if (doc && !fetchedPaths.has(doc.path)) {
          doc.serviceName = serviceName;
          result.docs.push(doc);
          result.totalSize += doc.size;
          fetchedPaths.add(doc.path);
        }
      } catch (error) {
        result.errors.push(`Error fetching ${filename}: ${error}`);
      }
    }

    // 2. Fetch from documentation directories
    for (const dirPath of config.directories) {
      if (fetchedPaths.size >= config.maxFilesPerRepo) break;

      try {
        const files = await listDirectory(owner, repo, dirPath, config);

        for (const filePath of files) {
          if (fetchedPaths.size >= config.maxFilesPerRepo) break;
          if (fetchedPaths.has(filePath)) continue;

          const doc = await fetchFile(owner, repo, filePath, config);
          if (doc) {
            doc.serviceName = serviceName;
            result.docs.push(doc);
            result.totalSize += doc.size;
            fetchedPaths.add(filePath);
          }
        }
      } catch (error) {
        result.errors.push(`Error listing ${dirPath}: ${error}`);
      }
    }

    result.docsCount = result.docs.length;
  } catch (error) {
    result.errors.push(`Failed to fetch docs: ${error}`);
  }

  return result;
}

/**
 * GitHub Docs Loader class
 */
export class GitHubDocsLoader {
  private config: DocsFetchConfig;

  constructor(config: Partial<DocsFetchConfig> = {}) {
    this.config = { ...DEFAULT_DOCS_CONFIG, ...config };
  }

  /**
   * Fetch documentation from a single repository
   */
  async fetchFromRepo(repository: string, serviceName?: string): Promise<RepoDocsResult> {
    return fetchRepoDocumentation(repository, serviceName, this.config);
  }

  /**
   * Fetch documentation from multiple repositories
   */
  async fetchFromRepos(
    repos: Array<{ repository: string; serviceName?: string }>
  ): Promise<RepoDocsResult[]> {
    const results: RepoDocsResult[] = [];

    for (const { repository, serviceName } of repos) {
      console.log(`[DocsLoader] Fetching docs from ${repository}...`);
      const result = await this.fetchFromRepo(repository, serviceName);
      results.push(result);

      if (result.errors.length > 0) {
        console.warn(`[DocsLoader] ${repository}: ${result.errors.length} errors`);
      }
      console.log(`[DocsLoader] ${repository}: ${result.docsCount} docs fetched`);
    }

    return results;
  }
}
