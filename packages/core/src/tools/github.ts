import { Octokit } from "@octokit/rest";
import type { Tool, ToolResult, ToolContext } from "./types";
import type { ToolDefinition } from "../llm/providers/types";

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

// ============================================================================
// GitHub Search Code Tool
// ============================================================================

const SEARCH_TOOL_NAME = "github_search_code";

interface SearchCodeArgs {
  query: string;
  repo?: string;
  language?: string;
  path?: string;
  max_results?: number;
}

const searchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: SEARCH_TOOL_NAME,
    description:
      "Search code across GitHub repositories. Use this to find relevant code files, functions, error handling patterns, or specific strings in the codebase.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query. Can include keywords, function names, error messages, or code patterns.",
        },
        repo: {
          type: "string",
          description:
            "Repository to search in (format: owner/repo). If not specified, searches across accessible repos.",
        },
        language: {
          type: "string",
          description:
            "Filter by programming language (e.g., typescript, python, javascript).",
        },
        path: {
          type: "string",
          description:
            'Filter by file path pattern (e.g., "src/", "*.ts", "lib/utils").',
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 10, max: 30).",
        },
      },
      required: ["query"],
    },
  },
};

async function executeSearch(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const { query, repo, language, path, max_results } = args as SearchCodeArgs;

  if (!query) {
    return {
      success: false,
      output: "",
      error: "Missing required parameter: query",
    };
  }

  try {
    const client = getOctokit();

    // Build search query
    let searchQuery = query;
    if (repo) searchQuery += ` repo:${repo}`;
    if (language) searchQuery += ` language:${language}`;
    if (path) searchQuery += ` path:${path}`;

    const maxResults = Math.min(max_results || 10, 30);

    const response = await client.search.code({
      q: searchQuery,
      per_page: maxResults,
    });

    if (response.data.items.length === 0) {
      return {
        success: true,
        output: "No code matches found for the search query.",
        metadata: {
          query: searchQuery,
          total_count: 0,
        },
      };
    }

    // Format results
    const results = response.data.items.map((item, i) => {
      const lines = [
        `[${i + 1}] ${item.repository.full_name}/${item.path}`,
        `    URL: ${item.html_url}`,
      ];

      // Add text matches if available
      if (item.text_matches && item.text_matches.length > 0) {
        for (const match of item.text_matches.slice(0, 2)) {
          if (match.fragment) {
            lines.push(`    Match: ...${match.fragment.substring(0, 200)}...`);
          }
        }
      }

      return lines.join("\n");
    });

    return {
      success: true,
      output: `Found ${response.data.total_count} total matches (showing ${response.data.items.length}):\n\n${results.join("\n\n")}`,
      metadata: {
        query: searchQuery,
        total_count: response.data.total_count,
        returned_count: response.data.items.length,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `GitHub search failed: ${errorMessage}`,
    };
  }
}

export const githubSearchCodeTool: Tool = {
  name: SEARCH_TOOL_NAME,
  description: searchDefinition.function.description,
  riskTier: "read_only",
  definition: searchDefinition,
  execute: executeSearch,
};

// ============================================================================
// GitHub Get File Contents Tool
// ============================================================================

const GET_FILE_TOOL_NAME = "github_get_file";

interface GetFileArgs {
  repo: string;
  path: string;
  ref?: string;
}

const getFileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: GET_FILE_TOOL_NAME,
    description:
      "Get the contents of a specific file from a GitHub repository. Use this after searching to read the full file content.",
    parameters: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository (format: owner/repo)",
        },
        path: {
          type: "string",
          description: "Path to the file within the repository",
        },
        ref: {
          type: "string",
          description:
            "Git ref (branch, tag, or commit SHA). Defaults to the default branch.",
        },
      },
      required: ["repo", "path"],
    },
  },
};

async function executeGetFile(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const { repo, path, ref } = args as GetFileArgs;

  if (!repo || !path) {
    return {
      success: false,
      output: "",
      error: "Missing required parameters: repo and path",
    };
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    return {
      success: false,
      output: "",
      error: "Invalid repo format. Use owner/repo (e.g., facebook/react)",
    };
  }

  try {
    const client = getOctokit();

    const response = await client.repos.getContent({
      owner,
      repo: repoName,
      path,
      ref,
    });

    // Handle file content (not directory)
    if (Array.isArray(response.data)) {
      return {
        success: false,
        output: "",
        error: "Path points to a directory, not a file",
      };
    }

    if (response.data.type !== "file") {
      return {
        success: false,
        output: "",
        error: `Path is not a file (type: ${response.data.type})`,
      };
    }

    // Decode base64 content
    const content = Buffer.from(response.data.content, "base64").toString("utf8");

    // Truncate if too long
    const MAX_CONTENT_LENGTH = 10000;
    const truncated = content.length > MAX_CONTENT_LENGTH;
    const displayContent = truncated
      ? content.substring(0, MAX_CONTENT_LENGTH) + "\n... [truncated]"
      : content;

    return {
      success: true,
      output: `File: ${repo}/${path}\nSize: ${response.data.size} bytes\nSHA: ${response.data.sha}\n\n\`\`\`\n${displayContent}\n\`\`\``,
      metadata: {
        repo,
        path,
        sha: response.data.sha,
        size: response.data.size,
        truncated,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `Failed to get file: ${errorMessage}`,
    };
  }
}

export const githubGetFileTool: Tool = {
  name: GET_FILE_TOOL_NAME,
  description: getFileDefinition.function.description,
  riskTier: "read_only",
  definition: getFileDefinition,
  execute: executeGetFile,
};

// ============================================================================
// GitHub Create Draft PR Tool
// ============================================================================

const CREATE_PR_TOOL_NAME = "github_create_draft_pr";

interface CreatePRArgs {
  repo: string;
  title: string;
  body: string;
  base: string;
  head: string;
  files: Array<{
    path: string;
    content: string;
  }>;
}

const createPRDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: CREATE_PR_TOOL_NAME,
    description:
      "Create a draft pull request with file changes. The PR is created as a draft so it won't be merged automatically. Use this to propose code fixes.",
    parameters: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository (format: owner/repo)",
        },
        title: {
          type: "string",
          description: "Pull request title",
        },
        body: {
          type: "string",
          description:
            "Pull request description explaining the changes and why they're needed",
        },
        base: {
          type: "string",
          description:
            "Base branch to merge into (e.g., main, master, develop)",
        },
        head: {
          type: "string",
          description:
            "Name for the new branch to create with the changes (e.g., fix/error-handling)",
        },
        files: {
          type: "array",
          description: "Array of file changes to include in the PR",
          items: {
            type: "object",
          },
        },
      },
      required: ["repo", "title", "body", "base", "head", "files"],
    },
  },
};

async function executeCreatePR(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const { repo, title, body, base, head, files } = args as CreatePRArgs;

  if (!repo || !title || !body || !base || !head || !files) {
    return {
      success: false,
      output: "",
      error: "Missing required parameters",
    };
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    return {
      success: false,
      output: "",
      error: "Invalid repo format. Use owner/repo (e.g., facebook/react)",
    };
  }

  if (!Array.isArray(files) || files.length === 0) {
    return {
      success: false,
      output: "",
      error: "files must be a non-empty array",
    };
  }

  try {
    const client = getOctokit();

    // 1. Get the base branch reference
    const baseRef = await client.git.getRef({
      owner,
      repo: repoName,
      ref: `heads/${base}`,
    });

    const baseSha = baseRef.data.object.sha;

    // 2. Create a new branch from base
    await client.git.createRef({
      owner,
      repo: repoName,
      ref: `refs/heads/${head}`,
      sha: baseSha,
    });

    // 3. Get the current tree
    const baseTree = await client.git.getTree({
      owner,
      repo: repoName,
      tree_sha: baseSha,
    });

    // 4. Create blobs for each file
    const blobs = await Promise.all(
      files.map(async (file) => {
        const blob = await client.git.createBlob({
          owner,
          repo: repoName,
          content: Buffer.from(file.content).toString("base64"),
          encoding: "base64",
        });
        return {
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.data.sha,
        };
      })
    );

    // 5. Create a new tree with the changes
    const newTree = await client.git.createTree({
      owner,
      repo: repoName,
      base_tree: baseTree.data.sha,
      tree: blobs,
    });

    // 6. Create a commit
    const commit = await client.git.createCommit({
      owner,
      repo: repoName,
      message: title,
      tree: newTree.data.sha,
      parents: [baseSha],
    });

    // 7. Update the branch to point to the new commit
    await client.git.updateRef({
      owner,
      repo: repoName,
      ref: `heads/${head}`,
      sha: commit.data.sha,
    });

    // 8. Create the draft PR
    const pr = await client.pulls.create({
      owner,
      repo: repoName,
      title,
      body: body + "\n\n---\n_Created by AI On-Call Engineer_",
      head,
      base,
      draft: true,
    });

    return {
      success: true,
      output: `Draft PR created successfully!\n\nTitle: ${title}\nPR URL: ${pr.data.html_url}\nBranch: ${head} → ${base}\nFiles changed: ${files.length}`,
      metadata: {
        pr_number: pr.data.number,
        pr_url: pr.data.html_url,
        branch: head,
        files_changed: files.map((f) => f.path),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `Failed to create PR: ${errorMessage}`,
    };
  }
}

export const githubCreateDraftPRTool: Tool = {
  name: CREATE_PR_TOOL_NAME,
  description: createPRDefinition.function.description,
  riskTier: "destructive", // TEMPORARY: Changed for testing approval flow
  definition: createPRDefinition,
  execute: executeCreatePR,
};
