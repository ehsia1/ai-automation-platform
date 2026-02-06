import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  type Datapoint,
} from "@aws-sdk/client-cloudwatch";
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import type { Tool, ToolResult, ToolContext } from "./types";
import type { ToolDefinition } from "../llm/providers/types";

const TOOL_NAME = "build_incident_timeline";

interface TimelineEvent {
  timestamp: string;
  source: string; // "cloudwatch_logs", "cloudwatch_metrics", "github", etc.
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  details?: string;
  metadata?: Record<string, unknown>;
}

interface BuildTimelineArgs {
  log_group?: string;
  start_time: string; // ISO 8601 or relative like "1h", "30m", "1d"
  end_time?: string; // ISO 8601 or "now"
  filter_pattern?: string; // Additional filter for logs
  metric_queries?: Array<{
    namespace: string;
    metric_name: string;
    dimensions?: Record<string, string>;
    threshold?: number; // Alert when metric exceeds this
    threshold_type?: "above" | "below"; // Default: "above"
  }>;
  include_deployments?: boolean;
  service_name?: string;
}

function parseRelativeTime(timeStr: string, now: Date): Date {
  const lower = timeStr.toLowerCase().trim();

  if (lower === "now") {
    return now;
  }

  // Check for relative time patterns like "1h", "30m", "2d", "1h ago"
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

function classifyLogSeverity(message: string): TimelineEvent["severity"] {
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes("critical") ||
    lowerMessage.includes("fatal") ||
    lowerMessage.includes("panic")
  ) {
    return "critical";
  }
  if (
    lowerMessage.includes("error") ||
    lowerMessage.includes("exception") ||
    lowerMessage.includes("failed")
  ) {
    return "error";
  }
  if (
    lowerMessage.includes("warn") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("retry")
  ) {
    return "warning";
  }
  return "info";
}

function extractLogTitle(message: string): string {
  // Try to extract the first meaningful line or error type
  const lines = message.split("\n").filter((l) => l.trim().length > 0);
  const firstLine = lines[0] || message;

  // Clean up and truncate
  const cleaned = firstLine.replace(/^\[\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\]]*\]\s*/, "");
  return cleaned.length > 100 ? cleaned.substring(0, 100) + "..." : cleaned;
}

const definition: ToolDefinition = {
  type: "function",
  function: {
    name: TOOL_NAME,
    description: `Build a structured incident timeline by correlating events from CloudWatch Logs and Metrics.
Use this to create a chronological view of what happened during an incident.
Returns events sorted by timestamp with severity classification.`,
    parameters: {
      type: "object",
      properties: {
        log_group: {
          type: "string",
          description: "CloudWatch Log Group to query for events",
        },
        start_time: {
          type: "string",
          description:
            'Start time for the timeline. ISO 8601 format or relative like "2h", "1d". Required.',
        },
        end_time: {
          type: "string",
          description: 'End time for the timeline. ISO 8601 format or "now". Defaults to "now".',
        },
        filter_pattern: {
          type: "string",
          description:
            "Additional filter pattern for logs (e.g., \"ERROR OR WARN\"). Default: looks for errors/warnings.",
        },
        metric_queries: {
          type: "array",
          description:
            "List of metrics to include in timeline. Events are generated when metrics cross thresholds.",
          items: {
            type: "object",
            properties: {
              namespace: {
                type: "string",
                description: 'AWS namespace (e.g., "AWS/Lambda")',
              },
              metric_name: {
                type: "string",
                description: 'Metric name (e.g., "Errors", "CPUUtilization")',
              },
              dimensions: {
                type: "object",
                description: "Dimension filters for the metric",
              },
              threshold: {
                type: "number",
                description: "Value threshold that triggers an event",
              },
              threshold_type: {
                type: "string",
                description: 'Whether to alert above or below threshold: "above" or "below". Default: "above"',
              },
            },
            required: ["namespace", "metric_name"],
          },
        },
        service_name: {
          type: "string",
          description: "Service name for context in event titles",
        },
      },
      required: ["start_time"],
    },
  },
};

async function queryLogs(
  logGroup: string,
  startTime: Date,
  endTime: Date,
  filterPattern?: string
): Promise<TimelineEvent[]> {
  const logsClient = new CloudWatchLogsClient({});
  const events: TimelineEvent[] = [];

  // Default filter for errors and warnings
  const filter = filterPattern || "ERROR OR WARN OR Exception OR CRITICAL OR FATAL";

  const query = `
    fields @timestamp, @message, @logStream
    | filter @message like /${filter.replace(/\s+OR\s+/gi, "|")}/i
    | sort @timestamp desc
    | limit 50
  `.trim();

  try {
    // Start the query
    const startCommand = new StartQueryCommand({
      logGroupName: logGroup,
      startTime: Math.floor(startTime.getTime() / 1000),
      endTime: Math.floor(endTime.getTime() / 1000),
      queryString: query,
    });

    const startResult = await logsClient.send(startCommand);
    const queryId = startResult.queryId;

    if (!queryId) {
      return events;
    }

    // Poll for results (max 30 seconds)
    let status: QueryStatus | undefined = "Running";
    let attempts = 0;
    const maxAttempts = 15;
    let results: Array<Array<{ field?: string; value?: string }>> = [];

    while (status === "Running" && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const getResultsCommand = new GetQueryResultsCommand({ queryId });
      const getResult = await logsClient.send(getResultsCommand);
      status = getResult.status;
      results = getResult.results || [];
      attempts++;
    }

    // Process results into timeline events
    for (const row of results) {
      const fields: Record<string, string> = {};
      for (const item of row) {
        if (item.field && item.value) {
          fields[item.field] = item.value;
        }
      }

      const timestamp = fields["@timestamp"];
      const message = fields["@message"] || "";
      const logStream = fields["@logStream"] || "";

      if (timestamp) {
        events.push({
          timestamp,
          source: "cloudwatch_logs",
          severity: classifyLogSeverity(message),
          title: extractLogTitle(message),
          details: message.length > 500 ? message.substring(0, 500) + "..." : message,
          metadata: { logStream, logGroup },
        });
      }
    }
  } catch (error) {
    // Return error as an event
    events.push({
      timestamp: new Date().toISOString(),
      source: "timeline_builder",
      severity: "warning",
      title: `Failed to query logs: ${logGroup}`,
      details: error instanceof Error ? error.message : String(error),
    });
  }

  return events;
}

async function queryMetrics(
  queries: BuildTimelineArgs["metric_queries"],
  startTime: Date,
  endTime: Date,
  serviceName?: string
): Promise<TimelineEvent[]> {
  if (!queries || queries.length === 0) {
    return [];
  }

  const cwClient = new CloudWatchClient({});
  const events: TimelineEvent[] = [];

  for (const metricQuery of queries) {
    const dimensions = metricQuery.dimensions
      ? Object.entries(metricQuery.dimensions).map(([Name, Value]) => ({ Name, Value }))
      : undefined;

    try {
      const command = new GetMetricStatisticsCommand({
        Namespace: metricQuery.namespace,
        MetricName: metricQuery.metric_name,
        Dimensions: dimensions,
        StartTime: startTime,
        EndTime: endTime,
        Period: 60, // 1-minute granularity for timeline
        Statistics: ["Average", "Maximum"],
      });

      const result = await cwClient.send(command);
      const datapoints = result.Datapoints || [];

      // Sort by timestamp
      datapoints.sort(
        (a: Datapoint, b: Datapoint) =>
          (a.Timestamp?.getTime() || 0) - (b.Timestamp?.getTime() || 0)
      );

      // Check for threshold crossings
      const threshold = metricQuery.threshold;
      const thresholdType = metricQuery.threshold_type || "above";

      for (const dp of datapoints) {
        const value = dp.Maximum ?? dp.Average;
        if (value === undefined || !dp.Timestamp) continue;

        const crossesThreshold =
          threshold !== undefined &&
          ((thresholdType === "above" && value > threshold) ||
            (thresholdType === "below" && value < threshold));

        if (crossesThreshold) {
          const metricLabel = serviceName
            ? `${serviceName}: ${metricQuery.metric_name}`
            : `${metricQuery.namespace}/${metricQuery.metric_name}`;

          events.push({
            timestamp: dp.Timestamp.toISOString(),
            source: "cloudwatch_metrics",
            severity: value > (threshold || 0) * 2 ? "critical" : "warning",
            title: `${metricLabel} ${thresholdType === "above" ? "exceeded" : "dropped below"} threshold`,
            details: `Value: ${value.toFixed(2)} (threshold: ${threshold})`,
            metadata: {
              namespace: metricQuery.namespace,
              metricName: metricQuery.metric_name,
              dimensions: metricQuery.dimensions,
              value,
              threshold,
            },
          });
        }
      }
    } catch (error) {
      events.push({
        timestamp: new Date().toISOString(),
        source: "timeline_builder",
        severity: "warning",
        title: `Failed to query metric: ${metricQuery.namespace}/${metricQuery.metric_name}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return events;
}

async function execute(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const {
    log_group,
    start_time,
    end_time,
    filter_pattern,
    metric_queries,
    service_name,
  } = args as unknown as BuildTimelineArgs;

  if (!start_time) {
    return {
      success: false,
      output: "",
      error: "start_time is required",
    };
  }

  const now = new Date();
  let startTimeDate: Date;
  let endTimeDate: Date;

  try {
    startTimeDate = parseRelativeTime(start_time, now);
    endTimeDate = parseRelativeTime(end_time || "now", now);
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Invalid time format: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const allEvents: TimelineEvent[] = [];

  // Query logs if log_group is provided
  if (log_group) {
    const logEvents = await queryLogs(log_group, startTimeDate, endTimeDate, filter_pattern);
    allEvents.push(...logEvents);
  }

  // Query metrics if provided
  if (metric_queries && metric_queries.length > 0) {
    const metricEvents = await queryMetrics(metric_queries, startTimeDate, endTimeDate, service_name);
    allEvents.push(...metricEvents);
  }

  // Sort all events by timestamp (newest first)
  allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Format output
  const lines: string[] = [];
  lines.push("# Incident Timeline");
  lines.push("");
  lines.push(`**Time Range:** ${startTimeDate.toISOString()} to ${endTimeDate.toISOString()}`);
  if (service_name) {
    lines.push(`**Service:** ${service_name}`);
  }
  lines.push(`**Events Found:** ${allEvents.length}`);
  lines.push("");

  if (allEvents.length === 0) {
    lines.push("No events found in the specified time range.");
  } else {
    // Group events by severity
    const critical = allEvents.filter((e) => e.severity === "critical");
    const errors = allEvents.filter((e) => e.severity === "error");
    const warnings = allEvents.filter((e) => e.severity === "warning");
    const info = allEvents.filter((e) => e.severity === "info");

    lines.push("## Summary");
    lines.push(`- Critical: ${critical.length}`);
    lines.push(`- Errors: ${errors.length}`);
    lines.push(`- Warnings: ${warnings.length}`);
    lines.push(`- Info: ${info.length}`);
    lines.push("");

    lines.push("## Chronological Events");
    lines.push("");

    const severityIcons: Record<string, string> = {
      critical: "[CRITICAL]",
      error: "[ERROR]",
      warning: "[WARN]",
      info: "[INFO]",
    };

    for (const event of allEvents.slice(0, 30)) {
      // Limit to 30 events
      const icon = severityIcons[event.severity] || "[INFO]";
      const time = new Date(event.timestamp).toISOString().replace("T", " ").replace("Z", " UTC");
      lines.push(`### ${time}`);
      lines.push(`${icon} **${event.title}**`);
      lines.push(`Source: ${event.source}`);
      if (event.details) {
        lines.push("");
        lines.push("```");
        lines.push(event.details.substring(0, 300));
        if (event.details.length > 300) lines.push("...");
        lines.push("```");
      }
      lines.push("");
    }

    if (allEvents.length > 30) {
      lines.push(`... and ${allEvents.length - 30} more events`);
    }
  }

  return {
    success: true,
    output: lines.join("\n"),
    metadata: {
      start_time: startTimeDate.toISOString(),
      end_time: endTimeDate.toISOString(),
      event_count: allEvents.length,
      events_by_severity: {
        critical: allEvents.filter((e) => e.severity === "critical").length,
        error: allEvents.filter((e) => e.severity === "error").length,
        warning: allEvents.filter((e) => e.severity === "warning").length,
        info: allEvents.filter((e) => e.severity === "info").length,
      },
    },
  };
}

export const buildIncidentTimelineTool: Tool = {
  name: TOOL_NAME,
  description: definition.function.description,
  riskTier: "read_only",
  definition,
  execute,
};
