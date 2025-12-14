#!/usr/bin/env node
/**
 * MCP Server for AWS CloudWatch Logs
 *
 * Exposes CloudWatch Logs Insights queries via the Model Context Protocol.
 * Can be used with Claude Desktop, Claude Code, or any MCP-compatible client.
 *
 * Usage:
 *   npx @ai-automation/mcp-cloudwatch
 *
 * Environment Variables:
 *   AWS_REGION - AWS region (default: us-east-1)
 *   AWS_ACCESS_KEY_ID - AWS access key (or use IAM role)
 *   AWS_SECRET_ACCESS_KEY - AWS secret key (or use IAM role)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const MAX_WAIT_TIME_MS = 30000;
const POLL_INTERVAL_MS = 1000;
const MAX_RESULTS = 100;

// Create CloudWatch client
const cloudwatchClient = new CloudWatchLogsClient({
  region: process.env.AWS_REGION || "us-east-1",
});

/**
 * Parse relative time strings like "1h", "30m", "1d" into Date objects
 */
function parseRelativeTime(timeStr: string, now: Date): Date {
  const lower = timeStr.toLowerCase().trim();

  if (lower === "now") {
    return now;
  }

  // Relative patterns: "1h", "30m", "2d", "1w", "1h ago"
  const relativeMatch = lower.match(
    /^(\d+)\s*(h|hour|hours|m|min|minutes|d|day|days|w|week|weeks)(\s+ago)?$/
  );
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const ms =
      unit.startsWith("h")
        ? value * 60 * 60 * 1000
        : unit.startsWith("m")
          ? value * 60 * 1000
          : unit.startsWith("w")
            ? value * 7 * 24 * 60 * 60 * 1000
            : value * 24 * 60 * 60 * 1000;
    return new Date(now.getTime() - ms);
  }

  // Try parsing as ISO date
  const parsed = new Date(timeStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  throw new Error(`Invalid time format: ${timeStr}`);
}

/**
 * Query CloudWatch Logs Insights
 */
async function queryLogs(args: {
  log_group: string;
  query: string;
  start_time?: string;
  end_time?: string;
}): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { log_group, query, start_time, end_time } = args;

  if (!log_group || !query) {
    return {
      content: [{ type: "text", text: "Missing required parameters: log_group and query are required" }],
      isError: true,
    };
  }

  const now = new Date();

  // Parse time range
  let startTimeDate: Date;
  let endTimeDate: Date;

  try {
    startTimeDate = parseRelativeTime(start_time || "1h", now);
    endTimeDate = parseRelativeTime(end_time || "now", now);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Invalid time format: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }

  try {
    // Start the query
    const startCommand = new StartQueryCommand({
      logGroupName: log_group,
      startTime: Math.floor(startTimeDate.getTime() / 1000),
      endTime: Math.floor(endTimeDate.getTime() / 1000),
      queryString: query,
      limit: MAX_RESULTS,
    });

    const startResult = await cloudwatchClient.send(startCommand);
    const queryId = startResult.queryId;

    if (!queryId) {
      return {
        content: [{ type: "text", text: "Failed to start CloudWatch query - no query ID returned" }],
        isError: true,
      };
    }

    // Poll for results
    const startPollTime = Date.now();
    let status: QueryStatus | string = QueryStatus.Running;
    let results: Array<Array<{ field?: string; value?: string }>> = [];

    while (
      Date.now() - startPollTime < MAX_WAIT_TIME_MS &&
      (status === QueryStatus.Running || status === QueryStatus.Scheduled)
    ) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const getResultsCommand = new GetQueryResultsCommand({ queryId });
      const queryResults = await cloudwatchClient.send(getResultsCommand);

      status = queryResults.status || QueryStatus.Failed;
      results = queryResults.results || [];
    }

    if (status !== QueryStatus.Complete) {
      return {
        content: [{ type: "text", text: `Query did not complete in time. Final status: ${status}` }],
        isError: true,
      };
    }

    // Format results
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No results found for query in ${log_group}` }],
      };
    }

    // Convert results to readable format
    const formattedResults = results.map((row) => {
      const obj: Record<string, string> = {};
      for (const field of row) {
        if (field.field && field.value) {
          obj[field.field] = field.value;
        }
      }
      return obj;
    });

    // Create human-readable output
    const outputLines = formattedResults.map((row, i) => {
      const parts = Object.entries(row).map(([k, v]) => `${k}: ${v}`);
      return `[${i + 1}] ${parts.join(" | ")}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} results in ${log_group}:\n\n${outputLines.join("\n")}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `CloudWatch query failed: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

/**
 * List available log groups
 */
async function listLogGroups(args: {
  prefix?: string;
  limit?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { prefix, limit = 50 } = args;

  try {
    const command = new DescribeLogGroupsCommand({
      logGroupNamePrefix: prefix,
      limit: Math.min(limit, 50),
    });

    const result = await cloudwatchClient.send(command);
    const groups = result.logGroups || [];

    if (groups.length === 0) {
      return {
        content: [{ type: "text", text: prefix ? `No log groups found with prefix "${prefix}"` : "No log groups found" }],
      };
    }

    const lines = groups.map((group) => {
      const name = group.logGroupName || "(unknown)";
      const size = group.storedBytes ? `${(group.storedBytes / 1024 / 1024).toFixed(2)} MB` : "unknown size";
      const retention = group.retentionInDays ? `${group.retentionInDays} days` : "never expires";
      return `- ${name}\n  Size: ${size}, Retention: ${retention}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Found ${groups.length} log group(s):\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Failed to list log groups: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

// Create MCP server
const server = new Server(
  {
    name: "cloudwatch-logs",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "cloudwatch_query_logs",
        description:
          "Query CloudWatch Logs Insights to search and analyze log data. Use this to investigate errors, find patterns, and diagnose issues in AWS services.",
        inputSchema: {
          type: "object" as const,
          properties: {
            log_group: {
              type: "string",
              description:
                'The CloudWatch Log Group to query (e.g., "/aws/lambda/my-function" or "/ecs/my-service")',
            },
            query: {
              type: "string",
              description:
                'CloudWatch Logs Insights query (e.g., "fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20")',
            },
            start_time: {
              type: "string",
              description:
                'Start time for the query. Can be ISO 8601 format or relative like "1h", "30m", "1d", "1w". Defaults to "1h".',
            },
            end_time: {
              type: "string",
              description:
                'End time for the query. Can be ISO 8601 format or "now". Defaults to "now".',
            },
          },
          required: ["log_group", "query"],
        },
      },
      {
        name: "cloudwatch_list_log_groups",
        description:
          "List available CloudWatch Log Groups. Use this to discover what logs are available before running queries.",
        inputSchema: {
          type: "object" as const,
          properties: {
            prefix: {
              type: "string",
              description:
                'Optional prefix to filter log groups (e.g., "/aws/lambda" or "/ecs")',
            },
            limit: {
              type: "number",
              description: "Maximum number of log groups to return (default: 50, max: 50)",
            },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "cloudwatch_query_logs":
      return queryLogs(args as {
        log_group: string;
        query: string;
        start_time?: string;
        end_time?: string;
      });

    case "cloudwatch_list_log_groups":
      return listLogGroups(args as { prefix?: string; limit?: number });

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CloudWatch Logs MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
