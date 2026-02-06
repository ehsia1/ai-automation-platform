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
 * PagerDuty V3 Webhook Payload
 * @see https://developer.pagerduty.com/docs/webhooks/v3-overview/
 */
interface PagerDutyV3WebhookPayload {
  event: {
    id: string;
    event_type: string; // e.g., "incident.triggered", "incident.resolved"
    resource_type: string; // e.g., "incident"
    occurred_at: string;
    agent?: {
      html_url: string;
      id: string;
      self: string;
      summary: string;
      type: string;
    };
    client?: {
      name: string;
      url?: string;
    };
    data: {
      id: string;
      type: string;
      self: string;
      html_url: string;
      number: number;
      status: string; // "triggered", "acknowledged", "resolved"
      incident_key?: string;
      created_at: string;
      title: string;
      urgency?: string; // "high", "low"
      service?: {
        html_url: string;
        id: string;
        self: string;
        summary: string;
        type: string;
      };
      assignees?: Array<{
        html_url: string;
        id: string;
        self: string;
        summary: string;
        type: string;
      }>;
      escalation_policy?: {
        html_url: string;
        id: string;
        self: string;
        summary: string;
        type: string;
      };
      teams?: Array<{
        html_url: string;
        id: string;
        self: string;
        summary: string;
        type: string;
      }>;
      priority?: {
        id: string;
        self: string;
        summary: string;
        type: string;
      };
      [key: string]: unknown;
    };
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Verify PagerDuty webhook signature (optional but recommended for production)
    // The signature is in header 'x-pagerduty-signature'
    const signature = event.headers["x-pagerduty-signature"];
    if (signature) {
      // TODO: Implement HMAC verification with webhook signing secret
      console.log("PagerDuty signature present (verification not yet implemented)");
    }

    // Parse the webhook payload
    const body = event.body ? JSON.parse(event.body) : {};
    const payload = body as PagerDutyV3WebhookPayload;

    // Validate this is a V3 webhook (has event.data structure)
    if (!payload.event?.data) {
      console.warn("Received non-V3 or malformed PagerDuty webhook:", JSON.stringify(body).slice(0, 500));
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "Invalid PagerDuty V3 webhook payload - missing event.data",
        }),
      };
    }

    const incidentData = payload.event.data;

    // Generate unique item ID
    const itemId = randomUUID();
    const now = new Date().toISOString();

    // Normalize the PagerDuty payload into our IncomingItem format
    const item: IncomingItem = {
      item_id: itemId,
      workspace_id: DEFAULT_WORKSPACE_ID,
      source: "pagerduty",
      source_item_id: incidentData.id,
      received_at: now,
      raw_payload: payload,
      metadata: {
        title: incidentData.title || "PagerDuty Incident",
        service: incidentData.service?.summary,
        severity: mapPagerDutyUrgency(incidentData.urgency, incidentData.priority?.summary),
        url: incidentData.html_url,
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
            event_type: payload.event.event_type, // Include PD event type for filtering
          }),
        },
      ],
    });

    console.log(`Ingested PagerDuty incident: ${itemId} (${payload.event.event_type})`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        item_id: itemId,
        event_type: payload.event.event_type,
      }),
    };
  } catch (error) {
    console.error("Error processing PagerDuty webhook:", error);
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
 * Map PagerDuty urgency/priority to our severity levels
 */
function mapPagerDutyUrgency(urgency?: string, prioritySummary?: string): string {
  // First check priority if available (more granular)
  if (prioritySummary) {
    const lowerPriority = prioritySummary.toLowerCase();
    if (lowerPriority.includes("p1") || lowerPriority.includes("critical") || lowerPriority.includes("sev1")) {
      return "critical";
    }
    if (lowerPriority.includes("p2") || lowerPriority.includes("sev2")) {
      return "high";
    }
    if (lowerPriority.includes("p3") || lowerPriority.includes("sev3")) {
      return "medium";
    }
    if (lowerPriority.includes("p4") || lowerPriority.includes("p5") || lowerPriority.includes("sev4") || lowerPriority.includes("sev5")) {
      return "low";
    }
  }

  // Fall back to urgency
  switch (urgency?.toLowerCase()) {
    case "high":
      return "high";
    case "low":
      return "low";
    default:
      return "medium";
  }
}
