import { APIGatewayProxyHandler } from "aws-lambda";
import { randomUUID } from "crypto";
import { Resource } from "sst";
import { EventBridge } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { IncomingItem, ItemSource } from "@ai-automation-platform/core";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const eventbridge = new EventBridge({});

// Default workspace for MVP (single-tenant)
const DEFAULT_WORKSPACE_ID = "default";

/**
 * Generic webhook handler for any alerting platform.
 *
 * Accepts JSON payloads and attempts to extract common fields.
 * Users can also provide explicit field mappings via query parameters:
 *
 * Query params:
 *   - source: Override the source name (e.g., "sentry", "newrelic", "custom")
 *   - title_field: JSON path to title field (e.g., "alert.name" or "message")
 *   - severity_field: JSON path to severity (e.g., "priority" or "level")
 *   - service_field: JSON path to service name
 *   - url_field: JSON path to alert URL
 *   - id_field: JSON path to unique ID
 *
 * Example:
 *   POST /webhooks/generic?source=sentry&title_field=event.title&severity_field=level
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const params = event.queryStringParameters || {};

    // Get source from query param or try to detect
    const source = (params.source || detectSource(body, event.headers)) as ItemSource;

    // Generate unique item ID
    const itemId = randomUUID();
    const now = new Date().toISOString();

    // Extract fields using configured paths or auto-detection
    const title = extractField(body, params.title_field) || autoDetectTitle(body);
    const severity = extractField(body, params.severity_field) || autoDetectSeverity(body);
    const service = extractField(body, params.service_field) || autoDetectService(body);
    const url = extractField(body, params.url_field) || autoDetectUrl(body);
    const sourceItemId = extractField(body, params.id_field) || autoDetectId(body) || itemId;

    // Normalize to IncomingItem format
    const item: IncomingItem = {
      item_id: itemId,
      workspace_id: DEFAULT_WORKSPACE_ID,
      source,
      source_item_id: String(sourceItemId),
      received_at: now,
      raw_payload: body,
      metadata: {
        title: title ? String(title) : "Alert",
        service: service ? String(service) : undefined,
        severity: severity ? normalizeSeverity(String(severity)) : "medium",
        url: url ? String(url) : undefined,
      },
      status: "ingested",
    };

    // Write to DynamoDB
    await dynamodb.send(
      new PutCommand({
        TableName: Resource.Items.name,
        Item: item,
      })
    );

    // Emit IncomingItemCreated event to EventBridge
    await eventbridge.putEvents({
      Entries: [
        {
          EventBusName: Resource.Bus.name,
          Source: "ai-automation-platform",
          DetailType: "item.created",
          Detail: JSON.stringify({
            workspace_id: item.workspace_id,
            item_id: item.item_id,
            source: item.source,
          }),
        },
      ],
    });

    console.log(`Ingested generic alert: ${itemId} - source: ${source}, title: ${item.metadata.title}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        item_id: itemId,
        source,
        title: item.metadata.title,
      }),
    };
  } catch (error) {
    console.error("Error processing generic webhook:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};

/**
 * Extract a field from nested object using dot notation
 * e.g., "event.title" extracts body.event.title
 */
function extractField(obj: Record<string, unknown>, path?: string): unknown {
  if (!path) return undefined;

  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Try to detect the source from the payload or headers
 */
function detectSource(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>
): ItemSource {
  // Check common headers
  const userAgent = headers["user-agent"]?.toLowerCase() || "";

  if (userAgent.includes("sentry")) return "manual"; // Sentry not in schema, use manual
  if (userAgent.includes("newrelic")) return "manual";
  if (userAgent.includes("grafana")) return "manual";

  // Check payload structure
  if (body.alert_id && body.org_key) return "datadog";
  if (body.event?.event_action && body.event?.data?.incident) return "pagerduty";
  if (body.alert?.alertId && body.source?.type === "opsgenie") return "opsgenie";
  if (body.AlarmName && body.AlarmArn) return "cloudwatch";

  // Default to manual for unknown sources
  return "manual";
}

/**
 * Auto-detect title from common field names
 */
function autoDetectTitle(body: Record<string, unknown>): string | undefined {
  const candidates = [
    "title",
    "name",
    "message",
    "subject",
    "alert.title",
    "alert.name",
    "event.title",
    "event.message",
    "notification.title",
    "summary",
    "description",
    "text",
  ];

  for (const path of candidates) {
    const value = extractField(body, path);
    if (value && typeof value === "string") return value;
  }

  // Try top-level string fields
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string" && value.length > 0 && value.length < 200) {
      if (key.toLowerCase().includes("title") || key.toLowerCase().includes("message")) {
        return value;
      }
    }
  }

  return undefined;
}

/**
 * Auto-detect severity from common field names
 */
function autoDetectSeverity(body: Record<string, unknown>): string | undefined {
  const candidates = [
    "severity",
    "priority",
    "level",
    "urgency",
    "alert.severity",
    "alert.priority",
    "event.severity",
    "criticality",
  ];

  for (const path of candidates) {
    const value = extractField(body, path);
    if (value) return String(value);
  }

  return undefined;
}

/**
 * Auto-detect service from common field names
 */
function autoDetectService(body: Record<string, unknown>): string | undefined {
  const candidates = [
    "service",
    "service_name",
    "serviceName",
    "app",
    "application",
    "component",
    "host",
    "source",
    "alert.service",
    "event.service",
    "resource",
  ];

  for (const path of candidates) {
    const value = extractField(body, path);
    if (value && typeof value === "string") return value;
  }

  return undefined;
}

/**
 * Auto-detect URL from common field names
 */
function autoDetectUrl(body: Record<string, unknown>): string | undefined {
  const candidates = [
    "url",
    "link",
    "alertUrl",
    "alert_url",
    "detailUrl",
    "detail_url",
    "incidentUrl",
    "incident_url",
    "alert.url",
    "event.url",
  ];

  for (const path of candidates) {
    const value = extractField(body, path);
    if (value && typeof value === "string" && value.startsWith("http")) {
      return value;
    }
  }

  return undefined;
}

/**
 * Auto-detect ID from common field names
 */
function autoDetectId(body: Record<string, unknown>): string | undefined {
  const candidates = [
    "id",
    "alertId",
    "alert_id",
    "eventId",
    "event_id",
    "incidentId",
    "incident_id",
    "uuid",
    "key",
    "alert.id",
    "event.id",
  ];

  for (const path of candidates) {
    const value = extractField(body, path);
    if (value) return String(value);
  }

  return undefined;
}

/**
 * Normalize various severity formats to our standard
 */
function normalizeSeverity(severity: string): string {
  const lower = severity.toLowerCase();

  // Critical
  if (["critical", "p1", "sev1", "emergency", "fatal", "1"].includes(lower)) {
    return "critical";
  }

  // High
  if (["high", "p2", "sev2", "error", "major", "2"].includes(lower)) {
    return "high";
  }

  // Medium
  if (["medium", "p3", "sev3", "warning", "warn", "moderate", "3"].includes(lower)) {
    return "medium";
  }

  // Low
  if (["low", "p4", "p5", "sev4", "sev5", "info", "minor", "4", "5"].includes(lower)) {
    return "low";
  }

  return "medium";
}
