import { APIGatewayProxyHandler } from "aws-lambda";
import { randomUUID } from "crypto";
import { Resource } from "sst";
import { EventBridge } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { IncomingItem } from "@ai-automation-platform/core";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const eventbridge = new EventBridge({});

// Default workspace for MVP (single-tenant)
const DEFAULT_WORKSPACE_ID = "default";

/**
 * OpsGenie Webhook Payload
 * @see https://support.atlassian.com/opsgenie/docs/integrate-opsgenie-with-webhook/
 */
interface OpsGenieWebhookPayload {
  action: string; // "Create", "Acknowledge", "Close", "AddNote", "AssignOwnership", "Delete", etc.
  source?: {
    name?: string;
    type?: string; // "api", "web", etc.
  };
  alert: {
    alertId: string;
    message?: string;
    username?: string;
    alias?: string;
    tinyId?: string;
    entity?: string;
    userId?: string;
    createdAt?: number; // Unix timestamp
    updatedAt?: number;
    priority?: string; // "P1", "P2", "P3", "P4", "P5"
    tags?: string[];
    teams?: string[];
    recipients?: string[];
    description?: string; // Truncated to 1000 chars
    details?: Record<string, string>; // Truncated to 1000 chars
    [key: string]: unknown;
  };
  escalation?: {
    id?: string;
    name?: string;
  };
  integrationId?: string;
  integrationName?: string;
  integrationType?: string;
  [key: string]: unknown;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Parse the webhook payload
    const body = event.body ? JSON.parse(event.body) : {};
    const payload = body as OpsGenieWebhookPayload;

    // Validate the payload has expected structure
    if (!payload.alert?.alertId) {
      console.warn("Received malformed OpsGenie webhook:", JSON.stringify(body).slice(0, 500));
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "Invalid OpsGenie webhook payload - missing alert.alertId",
        }),
      };
    }

    const alertData = payload.alert;

    // Generate unique item ID
    const itemId = randomUUID();
    const now = new Date().toISOString();

    // Extract service from tags or details
    const service = extractService(alertData.tags, alertData.details, alertData.entity);

    // Normalize the OpsGenie payload into our IncomingItem format
    const item: IncomingItem = {
      item_id: itemId,
      workspace_id: DEFAULT_WORKSPACE_ID,
      source: "opsgenie",
      source_item_id: alertData.alertId,
      received_at: now,
      raw_payload: payload,
      metadata: {
        title: alertData.message || "OpsGenie Alert",
        service,
        severity: mapOpsGeniePriority(alertData.priority),
        url: `https://app.opsgenie.com/alert/detail/${alertData.alertId}`,
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
            action: payload.action, // Include OpsGenie action for filtering
          }),
        },
      ],
    });

    console.log(`Ingested OpsGenie alert: ${itemId} (action: ${payload.action})`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        item_id: itemId,
        action: payload.action,
      }),
    };
  } catch (error) {
    console.error("Error processing OpsGenie webhook:", error);
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
 * Extract service name from tags, details, or entity
 */
function extractService(
  tags?: string[],
  details?: Record<string, string>,
  entity?: string
): string | undefined {
  // Check tags for service: prefix
  if (tags) {
    const serviceTag = tags.find((t) => t.toLowerCase().startsWith("service:"));
    if (serviceTag) {
      return serviceTag.split(":")[1];
    }
  }

  // Check details for service field
  if (details?.service) {
    return details.service;
  }

  // Fall back to entity if it looks like a service name
  if (entity && entity.length > 0) {
    return entity;
  }

  return undefined;
}

/**
 * Map OpsGenie priority to our severity levels
 * OpsGenie priorities: P1 (Critical) to P5 (Informational)
 */
function mapOpsGeniePriority(priority?: string): string {
  switch (priority?.toUpperCase()) {
    case "P1":
      return "critical";
    case "P2":
      return "high";
    case "P3":
      return "medium";
    case "P4":
    case "P5":
      return "low";
    default:
      return "medium";
  }
}
