import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  ListMetricsCommand,
  Statistic,
  type Datapoint,
  type Dimension,
} from "@aws-sdk/client-cloudwatch";
import type { Tool, ToolResult, ToolContext } from "./types";
import type { ToolDefinition } from "../llm/providers/types";

// CloudWatch Metrics query tool
const TOOL_NAME = "cloudwatch_get_metrics";
const LIST_TOOL_NAME = "cloudwatch_list_metrics";

interface GetMetricsArgs {
  namespace: string;
  metric_name: string;
  dimensions?: Record<string, string>;
  statistics?: string[];
  period?: number; // in seconds
  start_time?: string; // ISO 8601 or relative like "1h", "30m", "1d"
  end_time?: string; // ISO 8601 or "now"
}

interface ListMetricsArgs {
  namespace?: string;
  metric_name?: string;
  dimension_name?: string;
  dimension_value?: string;
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

// Get Metrics Definition
const getMetricsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: TOOL_NAME,
    description:
      "Query CloudWatch metrics to get statistics like CPU utilization, memory usage, request latency, error counts, etc. Use this to understand system health and performance during incident investigation.",
    parameters: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description:
            'AWS namespace for the metric (e.g., "AWS/EC2", "AWS/Lambda", "AWS/ECS", "AWS/RDS", "AWS/ApiGateway", "AWS/ApplicationELB")',
        },
        metric_name: {
          type: "string",
          description:
            'Name of the metric (e.g., "CPUUtilization", "Duration", "Errors", "Invocations", "5XXError", "TargetResponseTime", "RequestCount")',
        },
        dimensions: {
          type: "object",
          description:
            'Key-value pairs to filter the metric (e.g., {"FunctionName": "my-lambda"} or {"ServiceName": "my-ecs-service", "ClusterName": "my-cluster"})',
          additionalProperties: true,
        },
        statistics: {
          type: "array",
          items: { type: "string" },
          description:
            'Statistics to retrieve: "Average", "Sum", "Minimum", "Maximum", "SampleCount". Defaults to ["Average", "Maximum"].',
        },
        period: {
          type: "number",
          description:
            "The granularity in seconds for the datapoints. Must be at least 60. Defaults to 300 (5 minutes).",
        },
        start_time: {
          type: "string",
          description:
            'Start time for the query. Can be ISO 8601 format or relative like "1h", "30m", "1d". Defaults to "1h" (1 hour ago).',
        },
        end_time: {
          type: "string",
          description:
            'End time for the query. Can be ISO 8601 format or "now". Defaults to "now".',
        },
      },
      required: ["namespace", "metric_name"],
    },
  },
};

// List Metrics Definition
const listMetricsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: LIST_TOOL_NAME,
    description:
      "List available CloudWatch metrics in an AWS account. Use this to discover what metrics exist for a service before querying specific metrics.",
    parameters: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description:
            'AWS namespace to filter by (e.g., "AWS/Lambda", "AWS/ECS"). If not specified, lists metrics from all namespaces.',
        },
        metric_name: {
          type: "string",
          description: "Metric name to filter by (e.g., \"CPUUtilization\").",
        },
        dimension_name: {
          type: "string",
          description:
            'Dimension name to filter by (e.g., "FunctionName", "ServiceName").',
        },
        dimension_value: {
          type: "string",
          description: "Dimension value to filter by.",
        },
      },
      required: [],
    },
  },
};

async function executeGetMetrics(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const {
    namespace,
    metric_name,
    dimensions,
    statistics,
    period,
    start_time,
    end_time,
  } = args as unknown as GetMetricsArgs;

  if (!namespace || !metric_name) {
    return {
      success: false,
      output: "",
      error: "Missing required parameters: namespace and metric_name are required",
    };
  }

  const client = new CloudWatchClient({});
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

  // Build dimensions array
  const dimensionsList = dimensions
    ? Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }))
    : undefined;

  // Parse statistics
  const statsToUse: Statistic[] = (statistics || ["Average", "Maximum"]).map(
    (s) => s as Statistic
  );

  try {
    const command = new GetMetricStatisticsCommand({
      Namespace: namespace,
      MetricName: metric_name,
      Dimensions: dimensionsList,
      StartTime: startTimeDate,
      EndTime: endTimeDate,
      Period: period || 300, // Default 5 minutes
      Statistics: statsToUse,
    });

    const result = await client.send(command);
    const datapoints = result.Datapoints || [];

    if (datapoints.length === 0) {
      return {
        success: true,
        output: `No datapoints found for ${namespace}/${metric_name} in the specified time range.`,
        metadata: {
          namespace,
          metric_name,
          dimensions,
          start_time: startTimeDate.toISOString(),
          end_time: endTimeDate.toISOString(),
          datapoint_count: 0,
        },
      };
    }

    // Sort by timestamp
    datapoints.sort(
      (a: Datapoint, b: Datapoint) => (a.Timestamp?.getTime() || 0) - (b.Timestamp?.getTime() || 0)
    );

    // Format output
    const lines: string[] = [];
    lines.push(`Metric: ${namespace}/${metric_name}`);
    if (dimensionsList && dimensionsList.length > 0) {
      lines.push(
        `Dimensions: ${dimensionsList.map((d) => `${d.Name}=${d.Value}`).join(", ")}`
      );
    }
    lines.push(
      `Time Range: ${startTimeDate.toISOString()} to ${endTimeDate.toISOString()}`
    );
    lines.push(`Period: ${period || 300} seconds`);
    lines.push(`Datapoints: ${datapoints.length}`);
    lines.push("");

    // Summary statistics
    const avgValues = datapoints
      .map((d: Datapoint) => d.Average)
      .filter((v): v is number => v !== undefined);
    const maxValues = datapoints
      .map((d: Datapoint) => d.Maximum)
      .filter((v): v is number => v !== undefined);
    const sumValues = datapoints
      .map((d: Datapoint) => d.Sum)
      .filter((v): v is number => v !== undefined);

    if (avgValues.length > 0) {
      const overallAvg = avgValues.reduce((a: number, b: number) => a + b, 0) / avgValues.length;
      const maxOfMax = Math.max(...maxValues);
      const minOfAvg = Math.min(...avgValues);
      lines.push("Summary:");
      lines.push(`  Average: ${overallAvg.toFixed(2)}`);
      lines.push(`  Peak: ${maxOfMax.toFixed(2)}`);
      lines.push(`  Minimum: ${minOfAvg.toFixed(2)}`);
      if (sumValues.length > 0) {
        const totalSum = sumValues.reduce((a: number, b: number) => a + b, 0);
        lines.push(`  Total: ${totalSum.toFixed(2)}`);
      }
      lines.push("");
    }

    // Recent datapoints (last 10)
    lines.push("Recent Datapoints:");
    const recentPoints = datapoints.slice(-10);
    for (const dp of recentPoints) {
      const timestamp = dp.Timestamp?.toISOString() || "unknown";
      const values: string[] = [];
      if (dp.Average !== undefined) values.push(`Avg=${dp.Average.toFixed(2)}`);
      if (dp.Maximum !== undefined) values.push(`Max=${dp.Maximum.toFixed(2)}`);
      if (dp.Minimum !== undefined) values.push(`Min=${dp.Minimum.toFixed(2)}`);
      if (dp.Sum !== undefined) values.push(`Sum=${dp.Sum.toFixed(2)}`);
      if (dp.SampleCount !== undefined) values.push(`Count=${dp.SampleCount}`);
      lines.push(`  ${timestamp}: ${values.join(", ")}`);
    }

    return {
      success: true,
      output: lines.join("\n"),
      metadata: {
        namespace,
        metric_name,
        dimensions,
        start_time: startTimeDate.toISOString(),
        end_time: endTimeDate.toISOString(),
        datapoint_count: datapoints.length,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `CloudWatch GetMetricStatistics failed: ${errorMessage}`,
    };
  }
}

async function executeListMetrics(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const { namespace, metric_name, dimension_name, dimension_value } =
    args as unknown as ListMetricsArgs;

  const client = new CloudWatchClient({});

  try {
    const command = new ListMetricsCommand({
      Namespace: namespace,
      MetricName: metric_name,
      Dimensions:
        dimension_name && dimension_value
          ? [{ Name: dimension_name, Value: dimension_value }]
          : dimension_name
            ? [{ Name: dimension_name }]
            : undefined,
    });

    const result = await client.send(command);
    const metrics = result.Metrics || [];

    if (metrics.length === 0) {
      return {
        success: true,
        output: "No metrics found matching the specified criteria.",
        metadata: { namespace, metric_name, dimension_name, dimension_value, count: 0 },
      };
    }

    // Group metrics by namespace
    const byNamespace: Record<string, Array<{ name: string; dimensions: string }>> = {};
    for (const metric of metrics.slice(0, 100)) {
      // Limit to 100
      const ns = metric.Namespace || "Unknown";
      if (!byNamespace[ns]) {
        byNamespace[ns] = [];
      }
      const dims = (metric.Dimensions || [])
        .map((d: Dimension) => `${d.Name}=${d.Value}`)
        .join(", ");
      byNamespace[ns].push({
        name: metric.MetricName || "Unknown",
        dimensions: dims || "(none)",
      });
    }

    // Format output
    const lines: string[] = [`Found ${metrics.length} metrics:`, ""];
    for (const [ns, metricsInNs] of Object.entries(byNamespace)) {
      lines.push(`Namespace: ${ns}`);
      for (const m of metricsInNs) {
        lines.push(`  - ${m.name} [${m.dimensions}]`);
      }
      lines.push("");
    }

    return {
      success: true,
      output: lines.join("\n"),
      metadata: {
        namespace,
        metric_name,
        dimension_name,
        dimension_value,
        count: metrics.length,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `CloudWatch ListMetrics failed: ${errorMessage}`,
    };
  }
}

export const cloudwatchGetMetricsTool: Tool = {
  name: TOOL_NAME,
  description: getMetricsDefinition.function.description,
  riskTier: "read_only",
  definition: getMetricsDefinition,
  execute: executeGetMetrics,
};

export const cloudwatchListMetricsTool: Tool = {
  name: LIST_TOOL_NAME,
  description: listMetricsDefinition.function.description,
  riskTier: "read_only",
  definition: listMetricsDefinition,
  execute: executeListMetrics,
};
