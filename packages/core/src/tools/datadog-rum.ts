/**
 * Datadog RUM (Real User Monitoring) Tool
 *
 * Queries Datadog RUM to investigate frontend performance issues,
 * client-side errors, and user experience data.
 *
 * Environment Variables:
 *   DATADOG_API_KEY - Datadog API key
 *   DATADOG_APP_KEY - Datadog Application key
 *   DATADOG_SITE - Datadog site (default: datadoghq.com)
 */

import type { Tool, ToolResult, ToolContext } from "./types";
import type { ToolDefinition } from "../llm/providers/types";

const TOOL_NAME = "datadog_rum_search";
const DEFAULT_SITE = "datadoghq.com";
const MAX_RESULTS = 50;

interface RUMSearchArgs {
  /** Search query using Datadog query syntax (e.g., "@type:error @application.id:abc123") */
  query: string;
  /** Event type filter: error, action, view, resource, long_task, all */
  event_type?: "error" | "action" | "view" | "resource" | "long_task" | "all";
  /** Start time (ISO 8601 or relative like "1h", "15m", "1d"). Defaults to "1h" */
  start_time?: string;
  /** End time (ISO 8601 or "now"). Defaults to "now" */
  end_time?: string;
  /** Sort order: timestamp (desc) or relevance */
  sort?: "timestamp" | "relevance";
  /** Maximum results (default: 20, max: 50) */
  limit?: number;
}

// RUM event attributes structure (simplified - actual API returns more fields)
interface RUMAttributes {
  date?: string;
  service?: string;
  application?: { id?: string };
  session?: { id?: string };
  error?: { message?: string; stack?: string; source?: string };
  view?: {
    url?: string;
    loading_time?: number;
    first_contentful_paint?: number;
    largest_contentful_paint?: number;
    cumulative_layout_shift?: number;
  };
  action?: { type?: string; target?: { name?: string } };
  resource?: { url?: string; type?: string; duration?: number; status_code?: number };
  long_task?: { duration?: number };
  usr?: { email?: string };
  [key: string]: unknown;
}

interface RUMEvent {
  attributes?: {
    attributes?: RUMAttributes;
    service?: string;
    tags?: string[];
  };
  type?: string;
  id?: string;
}

interface RUMSearchResponse {
  data?: RUMEvent[];
  meta?: {
    page?: {
      after?: string;
    };
    status?: string;
  };
}

function parseRelativeTime(timeStr: string, now: Date): Date {
  const lower = timeStr.toLowerCase().trim();

  if (lower === "now") {
    return now;
  }

  // Relative patterns: "1h", "30m", "2d", "1h ago"
  const relativeMatch = lower.match(/^(\d+)\s*(h|hour|hours|m|min|minutes|d|day|days|w|week|weeks)(\s+ago)?$/);
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

function getDatadogConfig(): { apiKey: string; appKey: string; site: string } | null {
  const apiKey = process.env.DATADOG_API_KEY;
  const appKey = process.env.DATADOG_APP_KEY;

  if (!apiKey || !appKey) {
    return null;
  }

  return {
    apiKey,
    appKey,
    site: process.env.DATADOG_SITE || DEFAULT_SITE,
  };
}

const definition: ToolDefinition = {
  type: "function",
  function: {
    name: TOOL_NAME,
    description:
      "Search Datadog RUM (Real User Monitoring) events to investigate frontend/browser issues. Use this to find client-side errors, performance problems, slow page loads, and user experience issues.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Datadog search query. Examples: "@type:error" for JS errors, "@view.url:*/checkout*" for checkout pages, "@error.message:*timeout*" for timeout errors, "@usr.email:user@example.com" for specific user, "@session.id:abc123" for specific session',
        },
        event_type: {
          type: "string",
          enum: ["error", "action", "view", "resource", "long_task", "all"],
          description:
            "Filter by RUM event type. 'error' = JS errors/exceptions, 'view' = page views, 'action' = user clicks/interactions, 'resource' = XHR/fetch/assets, 'long_task' = long-running tasks",
        },
        start_time: {
          type: "string",
          description:
            'Start time. ISO 8601 or relative like "1h", "30m", "1d", "1w". Defaults to "1h" (1 hour ago)',
        },
        end_time: {
          type: "string",
          description:
            'End time. ISO 8601 or "now". Defaults to "now"',
        },
        sort: {
          type: "string",
          enum: ["timestamp", "relevance"],
          description: "Sort order. Defaults to timestamp (most recent first)",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 20, max: 50)",
        },
      },
      required: ["query"],
    },
  },
};

async function execute(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const {
    query,
    event_type = "all",
    start_time = "1h",
    end_time = "now",
    sort = "timestamp",
    limit = 20,
  } = args as unknown as RUMSearchArgs;

  if (!query) {
    return {
      success: false,
      output: "",
      error: "Missing required parameter: query",
    };
  }

  const config = getDatadogConfig();
  if (!config) {
    return {
      success: false,
      output: "",
      error:
        "Datadog not configured. Set DATADOG_API_KEY and DATADOG_APP_KEY environment variables.",
    };
  }

  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  try {
    startDate = parseRelativeTime(start_time, now);
    endDate = parseRelativeTime(end_time, now);
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Build the query with event type filter
  let fullQuery = query;
  if (event_type !== "all") {
    fullQuery = `@type:${event_type} ${query}`;
  }

  const requestBody = {
    filter: {
      query: fullQuery,
      from: startDate.toISOString(),
      to: endDate.toISOString(),
    },
    sort: sort === "timestamp" ? "-timestamp" : undefined,
    page: {
      limit: Math.min(limit, MAX_RESULTS),
    },
  };

  try {
    const response = await fetch(
      `https://api.${config.site}/api/v2/rum/events/search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "DD-API-KEY": config.apiKey,
          "DD-APPLICATION-KEY": config.appKey,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        output: "",
        error: `Datadog API error (${response.status}): ${errorText}`,
      };
    }

    const data = (await response.json()) as RUMSearchResponse;
    const events = data.data || [];

    if (events.length === 0) {
      return {
        success: true,
        output: `No RUM events found matching "${fullQuery}" in the specified time range.`,
        metadata: {
          query: fullQuery,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          result_count: 0,
        },
      };
    }

    // Format results for readability
    const formattedEvents = events.map((event, index) => {
      const attrs: RUMAttributes = event.attributes?.attributes || {};
      const type = event.type || "unknown";

      // Extract key fields based on event type
      const lines: string[] = [`[${index + 1}] ${type.toUpperCase()}`];

      // Common fields
      if (attrs.date) lines.push(`  Time: ${attrs.date}`);
      if (attrs.service) lines.push(`  Service: ${attrs.service}`);
      if (attrs.application?.id) lines.push(`  App: ${attrs.application.id}`);
      if (attrs.session?.id) lines.push(`  Session: ${attrs.session.id}`);

      // Type-specific fields
      switch (type) {
        case "error":
          if (attrs.error?.message) lines.push(`  Error: ${attrs.error.message}`);
          if (attrs.error?.stack) lines.push(`  Stack: ${String(attrs.error.stack).slice(0, 200)}...`);
          if (attrs.error?.source) lines.push(`  Source: ${attrs.error.source}`);
          if (attrs.view?.url) lines.push(`  URL: ${attrs.view.url}`);
          break;

        case "view":
          if (attrs.view?.url) lines.push(`  URL: ${attrs.view.url}`);
          if (attrs.view?.loading_time) lines.push(`  Load Time: ${attrs.view.loading_time}ms`);
          if (attrs.view?.first_contentful_paint) lines.push(`  FCP: ${attrs.view.first_contentful_paint}ms`);
          if (attrs.view?.largest_contentful_paint) lines.push(`  LCP: ${attrs.view.largest_contentful_paint}ms`);
          if (attrs.view?.cumulative_layout_shift) lines.push(`  CLS: ${attrs.view.cumulative_layout_shift}`);
          break;

        case "action":
          if (attrs.action?.type) lines.push(`  Action: ${attrs.action.type}`);
          if (attrs.action?.target?.name) lines.push(`  Target: ${attrs.action.target.name}`);
          if (attrs.view?.url) lines.push(`  URL: ${attrs.view.url}`);
          break;

        case "resource":
          if (attrs.resource?.url) lines.push(`  Resource: ${attrs.resource.url}`);
          if (attrs.resource?.type) lines.push(`  Type: ${attrs.resource.type}`);
          if (attrs.resource?.duration) lines.push(`  Duration: ${attrs.resource.duration}ms`);
          if (attrs.resource?.status_code) lines.push(`  Status: ${attrs.resource.status_code}`);
          break;

        case "long_task":
          if (attrs.long_task?.duration) lines.push(`  Duration: ${attrs.long_task.duration}ms`);
          if (attrs.view?.url) lines.push(`  URL: ${attrs.view.url}`);
          break;
      }

      // User info if available
      if (attrs.usr?.email) lines.push(`  User: ${attrs.usr.email}`);

      return lines.join("\n");
    });

    return {
      success: true,
      output: `Found ${events.length} RUM event(s):\n\n${formattedEvents.join("\n\n")}`,
      metadata: {
        query: fullQuery,
        event_type,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        result_count: events.length,
        has_more: !!data.meta?.page?.after,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Datadog RUM query failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const datadogRumSearchTool: Tool = {
  name: TOOL_NAME,
  description: definition.function.description,
  riskTier: "read_only",
  definition,
  execute,
};

// Analytics aggregation tool for RUM metrics
const ANALYTICS_TOOL_NAME = "datadog_rum_analytics";

interface RUMAnalyticsArgs {
  /** Metric to aggregate: count, avg, sum, min, max, pct75, pct90, pct95, pct99 */
  compute: string;
  /** Field to aggregate (e.g., "@view.loading_time", "@view.largest_contentful_paint") */
  field?: string;
  /** Group by dimension (e.g., "@view.url_path", "@geo.country", "@device.type") */
  group_by?: string;
  /** Filter query */
  query?: string;
  /** Start time (ISO 8601 or relative) */
  start_time?: string;
  /** End time (ISO 8601 or "now") */
  end_time?: string;
}

interface AnalyticsBucket {
  by?: Record<string, string>;
  computes?: Record<string, number>;
}

interface RUMAnalyticsResponse {
  data?: {
    buckets?: AnalyticsBucket[];
  };
  meta?: {
    status?: string;
  };
}

const analyticsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: ANALYTICS_TOOL_NAME,
    description:
      "Get aggregated RUM analytics and metrics from Datadog. Use this to find performance trends, error rates by page, slowest pages, or breakdown by device/browser/country.",
    parameters: {
      type: "object",
      properties: {
        compute: {
          type: "string",
          enum: ["count", "avg", "sum", "min", "max", "pct75", "pct90", "pct95", "pct99"],
          description:
            "Aggregation type. 'count' for event counts, others require a field.",
        },
        field: {
          type: "string",
          description:
            'Field to aggregate (required except for count). Examples: "@view.loading_time", "@view.largest_contentful_paint", "@view.first_contentful_paint", "@resource.duration"',
        },
        group_by: {
          type: "string",
          description:
            'Dimension to group by. Examples: "@view.url_path", "@geo.country", "@device.type", "@browser.name", "@error.message"',
        },
        query: {
          type: "string",
          description:
            'Filter query. Examples: "@type:view", "@type:error @application.id:myapp", "@view.url:*/api/*"',
        },
        start_time: {
          type: "string",
          description: 'Start time. Defaults to "24h" (24 hours ago)',
        },
        end_time: {
          type: "string",
          description: 'End time. Defaults to "now"',
        },
      },
      required: ["compute"],
    },
  },
};

async function executeAnalytics(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const {
    compute,
    field,
    group_by,
    query = "@type:view",
    start_time = "24h",
    end_time = "now",
  } = args as unknown as RUMAnalyticsArgs;

  if (!compute) {
    return {
      success: false,
      output: "",
      error: "Missing required parameter: compute",
    };
  }

  if (compute !== "count" && !field) {
    return {
      success: false,
      output: "",
      error: `The '${compute}' aggregation requires a 'field' parameter`,
    };
  }

  const config = getDatadogConfig();
  if (!config) {
    return {
      success: false,
      output: "",
      error:
        "Datadog not configured. Set DATADOG_API_KEY and DATADOG_APP_KEY environment variables.",
    };
  }

  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  try {
    startDate = parseRelativeTime(start_time, now);
    endDate = parseRelativeTime(end_time, now);
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const computeSpec: Record<string, unknown> = {
    aggregation: compute,
  };
  if (field) {
    computeSpec.metric = field;
  }

  const requestBody: Record<string, unknown> = {
    filter: {
      query,
      from: startDate.toISOString(),
      to: endDate.toISOString(),
    },
    compute: [computeSpec],
  };

  if (group_by) {
    requestBody.group_by = [
      {
        facet: group_by,
        limit: 20,
        sort: {
          aggregation: compute,
          order: "desc",
          ...(field && { metric: field }),
        },
      },
    ];
  }

  try {
    const response = await fetch(
      `https://api.${config.site}/api/v2/rum/analytics/aggregate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "DD-API-KEY": config.apiKey,
          "DD-APPLICATION-KEY": config.appKey,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        output: "",
        error: `Datadog API error (${response.status}): ${errorText}`,
      };
    }

    const data = (await response.json()) as RUMAnalyticsResponse;
    const buckets = data.data?.buckets || [];

    if (buckets.length === 0) {
      return {
        success: true,
        output: `No data found for query "${query}" in the specified time range.`,
        metadata: {
          query,
          compute,
          field,
          group_by,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
        },
      };
    }

    // Format results
    const fieldLabel = field || "count";
    const computeLabel = `${compute}(${fieldLabel})`;

    const lines: string[] = [`RUM Analytics: ${computeLabel}`];
    lines.push(`Query: ${query}`);
    lines.push(`Time range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    lines.push("");

    if (group_by) {
      lines.push(`Grouped by: ${group_by}`);
      lines.push("-".repeat(50));

      for (const bucket of buckets) {
        const groupValue = bucket.by?.[group_by] || "unknown";
        const value = bucket.computes?.c0;
        const formatted = typeof value === "number"
          ? (compute === "count" ? value.toString() : value.toFixed(2))
          : "N/A";
        lines.push(`  ${groupValue}: ${formatted}`);
      }
    } else {
      // Single aggregate value
      const value = buckets[0]?.computes?.c0;
      const formatted = typeof value === "number"
        ? (compute === "count" ? value.toString() : value.toFixed(2))
        : "N/A";
      lines.push(`Result: ${formatted}`);
    }

    return {
      success: true,
      output: lines.join("\n"),
      metadata: {
        query,
        compute,
        field,
        group_by,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        bucket_count: buckets.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Datadog RUM analytics failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const datadogRumAnalyticsTool: Tool = {
  name: ANALYTICS_TOOL_NAME,
  description: analyticsDefinition.function.description,
  riskTier: "read_only",
  definition: analyticsDefinition,
  execute: executeAnalytics,
};
