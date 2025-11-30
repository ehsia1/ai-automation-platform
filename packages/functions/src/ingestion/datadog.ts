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

interface DatadogWebhookPayload {
  id?: string;
  title?: string;
  text?: string;
  date?: number;
  host?: string;
  service?: string;
  priority?: string;
  alert_type?: string;
  alert_id?: string;
  event_type?: string;
  tags?: string[];
  url?: string;
  [key: string]: unknown;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Parse the webhook payload
    const body = event.body ? JSON.parse(event.body) : {};
    const payload = body as DatadogWebhookPayload;

    // Generate unique item ID
    const itemId = randomUUID();
    const now = new Date().toISOString();

    // Normalize the Datadog payload into our IncomingItem format
    const item: IncomingItem = {
      item_id: itemId,
      workspace_id: DEFAULT_WORKSPACE_ID,
      source: "datadog",
      source_item_id: payload.alert_id || payload.id || itemId,
      received_at: now,
      raw_payload: payload,
      metadata: {
        title: payload.title || "Datadog Alert",
        service: payload.service || extractServiceFromTags(payload.tags),
        severity: mapDatadogPriority(payload.priority || payload.alert_type),
        url: payload.url,
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

    console.log(`Ingested Datadog alert: ${itemId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        item_id: itemId,
      }),
    };
  } catch (error) {
    console.error("Error processing Datadog webhook:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};

function extractServiceFromTags(tags?: string[]): string | undefined {
  if (!tags) return undefined;
  const serviceTag = tags.find(
    (t) => t.startsWith("service:") || t.startsWith("env:")
  );
  if (serviceTag) {
    return serviceTag.split(":")[1];
  }
  return undefined;
}

function mapDatadogPriority(priority?: string): string {
  switch (priority?.toLowerCase()) {
    case "p1":
    case "critical":
    case "error":
      return "critical";
    case "p2":
    case "high":
    case "warning":
      return "high";
    case "p3":
    case "medium":
      return "medium";
    case "p4":
    case "low":
    case "info":
      return "low";
    default:
      return "medium";
  }
}
