/**
 * RAG Search Tool
 *
 * Agent tool for searching indexed documentation.
 * Enables the agent to find relevant runbooks, past incidents, etc.
 */

import type { Tool, ToolResult, ToolContext } from "../tools/types";
import type { ToolDefinition } from "../llm/providers/types";
import { getRagClient } from "./client";
import type { DocumentSource, SearchOptions } from "./types";

const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "search_docs",
    description: `Search through indexed documentation, runbooks, and past incidents to find relevant information.

Use this tool to:
- Find runbooks for specific services or error types
- Look up past incidents with similar symptoms
- Search README files and wiki documentation
- Find code comments and documentation

The search uses semantic similarity, so use natural language queries describing what you're looking for.`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language search query. Be specific about what you're looking for. Example: 'How to handle database connection timeouts in payment service'",
        },
        source_type: {
          type: "string",
          enum: ["runbook", "incident", "readme", "wiki", "code_comment", "all"],
          description:
            "Filter by document source type. Use 'all' to search everything (default).",
        },
        service: {
          type: "string",
          description:
            "Filter by service name. Only return results for this service.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of results to return (default: 5, max: 20).",
        },
      },
      required: ["query"],
    },
  },
};

export const searchDocsTool: Tool = {
  name: "search_docs",
  description: definition.function.description,
  riskTier: "read_only",
  definition,

  execute: async (
    args: Record<string, unknown>,
    _context: ToolContext
  ): Promise<ToolResult> => {
    const query = args.query as string;
    const sourceType = args.source_type as string | undefined;
    const service = args.service as string | undefined;
    const limit = Math.min((args.limit as number) || 5, 20);

    try {
      const client = getRagClient();

      // Build search options
      const options: SearchOptions = {
        limit,
        threshold: 0.6, // Lower threshold for broader results
        includeContent: true,
      };

      // Add filters if specified
      if (sourceType && sourceType !== "all") {
        options.filter = {
          ...options.filter,
          source: sourceType as DocumentSource,
        };
      }

      if (service) {
        options.filter = {
          ...options.filter,
          service,
        };
      }

      // Perform search
      const results = await client.search(query, options);

      if (results.length === 0) {
        return {
          success: true,
          output: `No relevant documentation found for: "${query}".\n\nTip: Try broadening your search or using different keywords.`,
        };
      }

      // Format results
      const formattedResults = results.map((result, index) => {
        const { chunk, score } = result;
        const meta = chunk.metadata;

        const header = [
          `## Result ${index + 1}`,
          `- **Source**: ${meta.title || meta.path || chunk.documentId}`,
          `- **Type**: ${meta.source}`,
          meta.service ? `- **Service**: ${meta.service}` : null,
          `- **Relevance**: ${(score * 100).toFixed(1)}%`,
        ]
          .filter(Boolean)
          .join("\n");

        return `${header}\n\n${chunk.content}`;
      });

      const output = [
        `Found ${results.length} relevant document(s) for: "${query}"`,
        "",
        ...formattedResults,
      ].join("\n\n---\n\n");

      return { success: true, output };
    } catch (error) {
      return {
        success: false,
        output: `Documentation search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Tool to get RAG index statistics
 */
const statsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "docs_stats",
    description:
      "Get statistics about the indexed documentation (number of documents, chunks, etc.)",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const docsStatsTool: Tool = {
  name: "docs_stats",
  description: statsDefinition.function.description,
  riskTier: "read_only",
  definition: statsDefinition,

  execute: async (): Promise<ToolResult> => {
    try {
      const client = getRagClient();
      const stats = await client.stats();

      const output = [
        "Documentation Index Statistics:",
        `- Total documents: ${stats.totalDocuments}`,
        `- Total chunks: ${stats.totalChunks}`,
        stats.sizeBytes
          ? `- Index size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      return { success: true, output };
    } catch (error) {
      return {
        success: false,
        output: `Failed to get stats: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
