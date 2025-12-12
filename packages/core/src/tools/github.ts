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
  const { query, repo, language, path, max_results } = args as unknown as SearchCodeArgs;

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
  const { repo, path, ref } = args as unknown as GetFileArgs;

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
          description: "Array of file changes to include in the PR. IMPORTANT: Each file's content must be the COMPLETE file content (not just changed lines) since it replaces the entire file.",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "The file path relative to repo root (e.g., src/calculator.py)",
              },
              content: {
                type: "string",
                description: "The COMPLETE new content for the file. IMPORTANT: This replaces the entire file, so you must include ALL existing code (imports, functions, classes, etc.) with your changes applied. Do NOT provide only the changed lines - include the full file content.",
              },
            },
            required: ["path", "content"],
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
  const { repo, title, body, base, head } = args as Omit<CreatePRArgs, "files">;
  let { files } = args as { files: unknown };

  if (!repo || !title || !body || !base || !head || !files) {
    return {
      success: false,
      output: "",
      error: "Missing required parameters",
    };
  }

  // Handle files passed as JSON string (LLMs sometimes do this)
  if (typeof files === "string") {
    try {
      files = JSON.parse(files);
    } catch {
      return {
        success: false,
        output: "",
        error: "files must be a valid JSON array",
      };
    }
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

  // Normalize file structure - handle both 'path' and 'filename' keys
  // Also normalize content: convert literal \n escape sequences to actual newlines
  // (LLMs sometimes output escaped newlines instead of actual newline characters)
  const normalizedFiles = (files as Array<{ path?: string; filename?: string; content: string }>).map(f => {
    let content = f.content;

    // Check if content has literal \n instead of actual newlines
    // A heuristic: if there are no actual newlines but there are literal \n sequences
    if (!content.includes('\n') && content.includes('\\n')) {
      // Replace literal \n with actual newlines
      content = content.replace(/\\n/g, '\n');
    }
    // Also handle case where content has both (mixed) - likely the literal ones are wrong
    // If the ratio of literal \n to actual newlines is high, normalize them
    else if (content.includes('\\n')) {
      const actualNewlines = (content.match(/\n/g) || []).length;
      const literalNewlines = (content.match(/\\n/g) || []).length;

      // If there are more literal than actual, the LLM probably meant real newlines
      if (literalNewlines > actualNewlines) {
        content = content.replace(/\\n/g, '\n');
      }
    }

    // Also handle escaped tabs
    if (content.includes('\\t')) {
      content = content.replace(/\\t/g, '\t');
    }

    return {
      path: f.path || f.filename || "unknown.txt",
      content,
    };
  });

  try {
    const client = getOctokit();

    // VALIDATION: Check that provided content is not suspiciously small
    // This catches the common LLM mistake of providing only changed lines instead of the full file
    for (const file of normalizedFiles) {
      // Get the original file to compare sizes
      try {
        const originalResponse = await client.repos.getContent({
          owner,
          repo: repoName,
          path: file.path,
          ref: base,
        });

        if (!Array.isArray(originalResponse.data) && originalResponse.data.type === "file") {
          const originalContent = Buffer.from(originalResponse.data.content, "base64").toString("utf8");
          const originalSize = originalContent.length;
          const newSize = file.content.length;

          // Check if new content is suspiciously small compared to original
          // Allow new files (original doesn't exist) or legitimate small files
          const MIN_CONTENT_THRESHOLD = 50; // Minimum characters for a meaningful file
          const SIZE_RATIO_THRESHOLD = 0.3; // New content should be at least 30% of original

          if (originalSize > MIN_CONTENT_THRESHOLD && newSize < originalSize * SIZE_RATIO_THRESHOLD) {
            // Include a snippet of the original file to help the LLM understand what's needed
            const originalPreview = originalContent.substring(0, 300).replace(/\n/g, "\\n");
            return {
              success: false,
              output: "",
              error: `VALIDATION FAILED for file "${file.path}": ` +
                `The provided content (${newSize} chars) is much smaller than the original file (${originalSize} chars). ` +
                `You must provide the COMPLETE file, not just the changed lines. ` +
                `The original file starts with: "${originalPreview}..." ` +
                `Copy the ENTIRE original file content and apply your fix to it.`,
            };
          }

          // Also check if content looks like just a diff/snippet (common LLM mistake)
          const looksLikeSnippet =
            file.content.includes("...") && newSize < 500 ||
            file.content.startsWith("def ") && !file.content.includes("import") && originalContent.includes("import") ||
            file.content.startsWith("function ") && !file.content.includes("import") && originalContent.includes("import");

          if (looksLikeSnippet && originalSize > MIN_CONTENT_THRESHOLD) {
            return {
              success: false,
              output: "",
              error: `VALIDATION FAILED for file "${file.path}": ` +
                `The provided content appears to be a code snippet rather than a complete file. ` +
                `The original file has imports/headers that are missing from your content. ` +
                `Please provide the COMPLETE file content with your changes applied.`,
            };
          }
        }
      } catch {
        // File doesn't exist yet (new file) - that's OK, skip validation
      }
    }

    // 1. Get the base branch reference
    const baseRef = await client.git.getRef({
      owner,
      repo: repoName,
      ref: `heads/${base}`,
    });

    const baseSha = baseRef.data.object.sha;

    // 2. Create a new branch from base (or update if exists)
    try {
      await client.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/${head}`,
        sha: baseSha,
      });
    } catch (refError) {
      const errorMsg = refError instanceof Error ? refError.message : String(refError);
      if (errorMsg.includes("Reference already exists")) {
        // Branch exists - reset it to base branch
        await client.git.updateRef({
          owner,
          repo: repoName,
          ref: `heads/${head}`,
          sha: baseSha,
          force: true,
        });
      } else {
        throw refError;
      }
    }

    // 3. Get the current tree
    const baseTree = await client.git.getTree({
      owner,
      repo: repoName,
      tree_sha: baseSha,
    });

    // 4. Create blobs for each file
    const blobs = await Promise.all(
      normalizedFiles.map(async (file) => {
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

    // 8. Create the draft PR (or find existing one)
    let pr;
    try {
      pr = await client.pulls.create({
        owner,
        repo: repoName,
        title,
        body: body + "\n\n---\n_Created by AI On-Call Engineer_",
        head,
        base,
        draft: true,
      });
    } catch (prError) {
      const prErrorMsg = prError instanceof Error ? prError.message : String(prError);
      if (prErrorMsg.includes("A pull request already exists")) {
        // Find the existing PR
        const existingPRs = await client.pulls.list({
          owner,
          repo: repoName,
          head: `${owner}:${head}`,
          base,
          state: "open",
        });

        if (existingPRs.data.length > 0) {
          // Update the existing PR with new title/body
          pr = await client.pulls.update({
            owner,
            repo: repoName,
            pull_number: existingPRs.data[0].number,
            title,
            body: body + "\n\n---\n_Updated by AI On-Call Engineer_",
          });

          return {
            success: true,
            output: `Existing PR updated successfully!\n\nTitle: ${title}\nPR URL: ${pr.data.html_url}\nBranch: ${head} → ${base}\nFiles changed: ${normalizedFiles.length}`,
            metadata: {
              pr_number: pr.data.number,
              pr_url: pr.data.html_url,
              branch: head,
              files_changed: normalizedFiles.map((f) => f.path),
            },
          };
        }
      }
      throw prError;
    }

    return {
      success: true,
      output: `Draft PR created successfully!\n\nTitle: ${title}\nPR URL: ${pr.data.html_url}\nBranch: ${head} → ${base}\nFiles changed: ${normalizedFiles.length}`,
      metadata: {
        pr_number: pr.data.number,
        pr_url: pr.data.html_url,
        branch: head,
        files_changed: normalizedFiles.map((f) => f.path),
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
  riskTier: "safe_write",
  definition: createPRDefinition,
  execute: executeCreatePR,
};

// ============================================================================
// GitHub List Repository Files Tool
// ============================================================================

const LIST_FILES_TOOL_NAME = "github_list_files";

interface ListFilesArgs {
  repo: string;
  path?: string;
  ref?: string;
}

const listFilesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: LIST_FILES_TOOL_NAME,
    description:
      "List files and directories in a GitHub repository. Use this to explore the repository structure and find relevant files before reading them. Start with the root path to understand the project layout.",
    parameters: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository (format: owner/repo)",
        },
        path: {
          type: "string",
          description:
            "Path within the repository to list. Defaults to root (''). Use 'src' to list src folder, etc.",
        },
        ref: {
          type: "string",
          description:
            "Git ref (branch, tag, or commit SHA). Defaults to the default branch.",
        },
      },
      required: ["repo"],
    },
  },
};

async function executeListFiles(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const { repo, path = "", ref } = args as unknown as ListFilesArgs;

  if (!repo) {
    return {
      success: false,
      output: "",
      error: "Missing required parameter: repo",
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
      path: path || "",
      ref,
    });

    // Handle directory listing
    if (!Array.isArray(response.data)) {
      return {
        success: false,
        output: "",
        error: "Path points to a file, not a directory. Use github_get_file to read it.",
      };
    }

    // Format directory listing
    const items = response.data.map((item) => {
      const icon = item.type === "dir" ? "📁" : "📄";
      const size = item.type === "file" ? ` (${item.size} bytes)` : "";
      return `${icon} ${item.path}${size}`;
    });

    const pathDisplay = path || "(root)";
    return {
      success: true,
      output: `Repository: ${repo}\nPath: ${pathDisplay}\n\nContents:\n${items.join("\n")}`,
      metadata: {
        repo,
        path: path || "",
        item_count: items.length,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `Failed to list files: ${errorMessage}`,
    };
  }
}

export const githubListFilesTool: Tool = {
  name: LIST_FILES_TOOL_NAME,
  description: listFilesDefinition.function.description,
  riskTier: "read_only",
  definition: listFilesDefinition,
  execute: executeListFiles,
};

// ============================================================================
// GitHub Create Single File PR Tool (Simpler version for smaller LLMs)
// ============================================================================

const CREATE_SINGLE_FILE_PR_TOOL_NAME = "github_create_single_file_pr";

interface CreateSingleFilePRArgs {
  repo: string;
  title: string;
  description: string;
  branch_name: string;
  file_path: string;
  file_content: string;
}

const createSingleFilePRDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: CREATE_SINGLE_FILE_PR_TOOL_NAME,
    description:
      "Create a draft pull request that modifies a single file. SIMPLER than github_create_draft_pr - use this when fixing ONE file. The file_content must be the COMPLETE file (copy the entire file from github_get_file and apply your fix).",
    parameters: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository (format: owner/repo, e.g., ehsia1/ai-oncall-test)",
        },
        title: {
          type: "string",
          description: "PR title (e.g., Fix division by zero error)",
        },
        description: {
          type: "string",
          description: "PR description explaining the fix (plain text, no code)",
        },
        branch_name: {
          type: "string",
          description: "New branch name (e.g., fix/divide-by-zero)",
        },
        file_path: {
          type: "string",
          description: "Path to the file being modified (e.g., src/calculator.py)",
        },
        file_content: {
          type: "string",
          description: "The COMPLETE new file content. CRITICAL: Copy the ENTIRE file from github_get_file, apply your fix, and paste all of it here. Must include all imports, all functions, everything.",
        },
      },
      required: ["repo", "title", "description", "branch_name", "file_path", "file_content"],
    },
  },
};

async function executeCreateSingleFilePR(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { repo, title, description, branch_name, file_path, file_content } =
    args as unknown as CreateSingleFilePRArgs;

  // Validate all required fields are present
  if (!repo || !title || !description || !branch_name || !file_path || !file_content) {
    const missing = [];
    if (!repo) missing.push("repo");
    if (!title) missing.push("title");
    if (!description) missing.push("description");
    if (!branch_name) missing.push("branch_name");
    if (!file_path) missing.push("file_path");
    if (!file_content) missing.push("file_content");
    return {
      success: false,
      output: "",
      error: `Missing required parameters: ${missing.join(", ")}. All 6 parameters are required.`,
    };
  }

  // Convert to the multi-file format and reuse existing implementation
  const multiFileArgs = {
    repo,
    title,
    body: description,
    base: "main",
    head: branch_name,
    files: [{ path: file_path, content: file_content }],
  };

  return executeCreatePR(multiFileArgs, context);
}

export const githubCreateSingleFilePRTool: Tool = {
  name: CREATE_SINGLE_FILE_PR_TOOL_NAME,
  description: createSingleFilePRDefinition.function.description,
  riskTier: "safe_write",
  definition: createSingleFilePRDefinition,
  execute: executeCreateSingleFilePR,
};

// ============================================================================
// GitHub Edit File Tool (Search & Replace)
// ============================================================================

const EDIT_FILE_TOOL_NAME = "github_edit_file";

interface EditOperation {
  old_string: string;
  new_string: string;
}

interface EditFileArgs {
  repo: string;
  file_path: string;
  edits: EditOperation[];
  title: string;
  description: string;
  branch_name: string;
  base_branch?: string;
}

const editFileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: EDIT_FILE_TOOL_NAME,
    description:
      "Edit a file in a GitHub repository using search-and-replace. PREFERRED over github_create_draft_pr because you don't need to provide full file content - just specify what to find and what to replace it with. The original file is automatically fetched and the edits are applied. Creates a draft PR with the changes.",
    parameters: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository (format: owner/repo)",
        },
        file_path: {
          type: "string",
          description: "Path to the file to edit (e.g., src/calculator.py)",
        },
        edits: {
          type: "array",
          description: "Array of search-and-replace operations. Each edit finds 'old_string' and replaces it with 'new_string'. IMPORTANT: old_string must match EXACTLY (including whitespace and indentation).",
          items: {
            type: "object",
            properties: {
              old_string: {
                type: "string",
                description: "The exact string to find in the file. Must match precisely including all whitespace, indentation, and newlines.",
              },
              new_string: {
                type: "string",
                description: "The string to replace old_string with.",
              },
            },
            required: ["old_string", "new_string"],
          },
        },
        title: {
          type: "string",
          description: "Pull request title",
        },
        description: {
          type: "string",
          description: "Pull request description explaining the changes",
        },
        branch_name: {
          type: "string",
          description: "Name for the new branch (e.g., fix/divide-by-zero)",
        },
        base_branch: {
          type: "string",
          description: "Base branch to merge into (defaults to 'main')",
        },
      },
      required: ["repo", "file_path", "edits", "title", "description", "branch_name"],
    },
  },
};

async function executeEditFile(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const {
    repo,
    file_path,
    title,
    description,
    branch_name,
    base_branch = "main",
  } = args as Omit<EditFileArgs, "edits">;
  let { edits } = args as { edits: unknown };

  // Validate required params
  if (!repo || !file_path || !edits || !title || !description || !branch_name) {
    const missing = [];
    if (!repo) missing.push("repo");
    if (!file_path) missing.push("file_path");
    if (!edits) missing.push("edits");
    if (!title) missing.push("title");
    if (!description) missing.push("description");
    if (!branch_name) missing.push("branch_name");
    return {
      success: false,
      output: "",
      error: `Missing required parameters: ${missing.join(", ")}`,
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

  // Handle edits passed as JSON string
  if (typeof edits === "string") {
    try {
      edits = JSON.parse(edits);
    } catch {
      return {
        success: false,
        output: "",
        error: "edits must be a valid JSON array",
      };
    }
  }

  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      success: false,
      output: "",
      error: "edits must be a non-empty array of {old_string, new_string} objects",
    };
  }

  try {
    const client = getOctokit();

    // 1. Fetch the original file content
    const fileResponse = await client.repos.getContent({
      owner,
      repo: repoName,
      path: file_path,
      ref: base_branch,
    });

    if (Array.isArray(fileResponse.data) || fileResponse.data.type !== "file") {
      return {
        success: false,
        output: "",
        error: `Path "${file_path}" is not a file`,
      };
    }

    let content = Buffer.from(fileResponse.data.content, "base64").toString("utf8");
    const originalContent = content;

    // 2. Apply each edit operation
    const editResults: string[] = [];
    for (let i = 0; i < (edits as EditOperation[]).length; i++) {
      const edit = (edits as EditOperation[])[i];

      if (!edit.old_string || edit.new_string === undefined) {
        return {
          success: false,
          output: "",
          error: `Edit ${i + 1} is missing old_string or new_string`,
        };
      }

      // Normalize escape sequences in old_string and new_string
      let oldStr = edit.old_string;
      let newStr = edit.new_string;

      // Handle literal \n and \t (LLMs sometimes output these instead of actual newlines/tabs)
      if (oldStr.includes('\\n') && !content.includes(oldStr)) {
        oldStr = oldStr.replace(/\\n/g, '\n');
      }
      if (oldStr.includes('\\t') && !content.includes(oldStr)) {
        oldStr = oldStr.replace(/\\t/g, '\t');
      }
      if (newStr.includes('\\n')) {
        newStr = newStr.replace(/\\n/g, '\n');
      }
      if (newStr.includes('\\t')) {
        newStr = newStr.replace(/\\t/g, '\t');
      }

      // Check if old_string exists in content
      if (!content.includes(oldStr)) {
        // Try to find a close match to give helpful error
        const preview = oldStr.substring(0, 50).replace(/\n/g, '\\n');
        return {
          success: false,
          output: "",
          error: `Edit ${i + 1} failed: Could not find "${preview}${oldStr.length > 50 ? '...' : ''}" in the file. Make sure old_string matches exactly, including whitespace and indentation. TIP: Use github_get_file first to see the exact content.`,
        };
      }

      // Check for multiple occurrences
      const occurrences = content.split(oldStr).length - 1;
      if (occurrences > 1) {
        const preview = oldStr.substring(0, 50).replace(/\n/g, '\\n');
        return {
          success: false,
          output: "",
          error: `Edit ${i + 1} failed: Found ${occurrences} occurrences of "${preview}${oldStr.length > 50 ? '...' : ''}". old_string must be unique. Include more surrounding context to make it unique.`,
        };
      }

      // Apply the replacement
      content = content.replace(oldStr, newStr);
      editResults.push(`✓ Edit ${i + 1}: Replaced ${oldStr.split('\n').length} line(s)`);
    }

    // 3. Verify something actually changed
    if (content === originalContent) {
      return {
        success: false,
        output: "",
        error: "No changes were made. The edits resulted in identical content.",
      };
    }

    // 4. Create the PR using the existing PR creation logic
    const prArgs = {
      repo,
      title,
      body: description,
      base: base_branch,
      head: branch_name,
      files: [{ path: file_path, content }],
    };

    const prResult = await executeCreatePR(prArgs, context);

    // Add edit details to the output
    if (prResult.success) {
      prResult.output = `Edits applied:\n${editResults.join('\n')}\n\n${prResult.output}`;
    }

    return prResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `Failed to edit file: ${errorMessage}`,
    };
  }
}

export const githubEditFileTool: Tool = {
  name: EDIT_FILE_TOOL_NAME,
  description: editFileDefinition.function.description,
  riskTier: "safe_write",
  definition: editFileDefinition,
  execute: executeEditFile,
};
