import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import type { Tool, ToolResult, ToolContext } from "./types";
import type { ToolDefinition } from "../llm/providers/types";

// CloudWatch Logs Insights query tool
const TOOL_NAME = "cloudwatch_query_logs";
const MAX_WAIT_TIME_MS = 30000; // 30 second timeout
const POLL_INTERVAL_MS = 1000; // Poll every second
const MAX_RESULTS = 100; // Limit results to avoid huge outputs

interface CloudWatchQueryArgs {
  log_group: string;
  query: string;
  start_time?: string; // ISO 8601 or relative like "1h", "30m", "1d"
  end_time?: string; // ISO 8601 or "now"
}

function parseRelativeTime(timeStr: string, now: Date): Date {
  const lower = timeStr.toLowerCase().trim();

  if (lower === "now") {
    return now;
  }

  // Check for relative time patterns like "1h", "30m", "2d", "1h ago", "30 minutes ago"
  const relativeMatch = lower.match(/^(\d+)\s*(h|hour|hours|m|min|minutes|d|day|days)(\s+ago)?$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const ms =
      unit.startsWith("h")
        ? value * 60 * 60 * 1000
        : unit.startsWith("m")
          ? value * 60 * 1000
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

const definition: ToolDefinition = {
  type: "function",
  function: {
    name: TOOL_NAME,
    description:
      "Query CloudWatch Logs Insights to search and analyze log data. Use this to investigate errors, find patterns, and diagnose issues in AWS services.",
    parameters: {
      type: "object",
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
            'Start time for the query. Can be ISO 8601 format or relative like "1h", "1h ago", "30m", "30 minutes ago", "1d". Defaults to "1h" (1 hour ago).',
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
};

async function execute(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const { log_group, query, start_time, end_time } = args as unknown as CloudWatchQueryArgs;

  if (!log_group || !query) {
    return {
      success: false,
      output: "",
      error: "Missing required parameters: log_group and query are required",
    };
  }

  const client = new CloudWatchLogsClient({});
  const now = new Date();

  // Parse time range
  let startTimeDate: Date;
  let endTimeDate: Date;

  try {
    startTimeDate = parseRelativeTime(start_time || "1h", now);
    endTimeDate = parseRelativeTime(end_time || "now", now);
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Invalid time format: ${error instanceof Error ? error.message : String(error)}`,
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

    const startResult = await client.send(startCommand);
    const queryId = startResult.queryId;

    if (!queryId) {
      return {
        success: false,
        output: "",
        error: "Failed to start CloudWatch query - no query ID returned",
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
      const queryResults = await client.send(getResultsCommand);

      status = queryResults.status || QueryStatus.Failed;
      results = queryResults.results || [];
    }

    if (status !== QueryStatus.Complete) {
      return {
        success: false,
        output: "",
        error: `Query did not complete in time. Final status: ${status}`,
      };
    }

    // Format results as readable text
    if (results.length === 0) {
      return {
        success: true,
        output: "No results found for the query.",
        metadata: {
          log_group,
          query,
          start_time: startTimeDate.toISOString(),
          end_time: endTimeDate.toISOString(),
          result_count: 0,
        },
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
      success: true,
      output: `Found ${results.length} results:\n\n${outputLines.join("\n")}`,
      metadata: {
        log_group,
        query,
        start_time: startTimeDate.toISOString(),
        end_time: endTimeDate.toISOString(),
        result_count: results.length,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `CloudWatch query failed: ${errorMessage}`,
    };
  }
}

export const cloudwatchQueryLogsTool: Tool = {
  name: TOOL_NAME,
  description: definition.function.description,
  riskTier: "read_only",
  definition,
  execute,
};
