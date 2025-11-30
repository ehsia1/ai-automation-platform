import { EventBridgeHandler } from "aws-lambda";
import { randomUUID } from "crypto";
import { Resource } from "sst";
import { EventBridge } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  initializeLLM,
  completeJSON,
  buildClassificationPrompt,
  type ClassificationResult,
  type IncomingItem,
  type Alert,
} from "@ai-automation-platform/core";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const eventbridge = new EventBridge({});

// Initialize LLM based on environment
initializeLLM({
  provider: (process.env.LLM_PROVIDER as "ollama" | "anthropic") || "ollama",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
  ollamaModel: process.env.OLLAMA_MODEL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

interface ItemCreatedEvent {
  workspace_id: string;
  item_id: string;
  source: string;
}

export const handler: EventBridgeHandler<"item.created", ItemCreatedEvent, void> = async (
  event
) => {
  const { workspace_id, item_id } = event.detail;
  console.log(`Classifying item: ${item_id}`);

  try {
    // Fetch the item from DynamoDB
    const itemResult = await dynamodb.send(
      new GetCommand({
        TableName: Resource.Items.name,
        Key: {
          workspace_id,
          item_id,
        },
      })
    );

    const item = itemResult.Item as IncomingItem | undefined;
    if (!item) {
      console.error(`Item not found: ${item_id}`);
      return;
    }

    // Build classification prompt
    const rawPayload = item.raw_payload as Record<string, unknown>;
    const messages = buildClassificationPrompt({
      source: item.source,
      title: item.metadata.title,
      subject: item.metadata.subject,
      body:
        (rawPayload.text as string) ||
        (rawPayload.body as string) ||
        JSON.stringify(rawPayload).slice(0, 2000),
      sender: item.metadata.sender,
      service: item.metadata.service,
      rawSeverity: item.metadata.severity,
      url: item.metadata.url,
    });

    // Call LLM for classification
    const classification = await completeJSON<ClassificationResult>(messages, {
      temperature: 0.3,
      maxTokens: 1024,
    });

    console.log(`Classification result:`, classification);

    const now = new Date().toISOString();

    // Update item with classification
    await dynamodb.send(
      new UpdateCommand({
        TableName: Resource.Items.name,
        Key: {
          workspace_id,
          item_id,
        },
        UpdateExpression: `
          SET #status = :status,
              item_type = :item_type,
              #mode = :mode,
              priority = :priority,
              requires_action = :requires_action,
              summary = :summary,
              tags = :tags,
              classified_at = :classified_at,
              service = :service
        `,
        ExpressionAttributeNames: {
          "#status": "status",
          "#mode": "mode",
        },
        ExpressionAttributeValues: {
          ":status": "classified",
          ":item_type": classification.item_type,
          ":mode": classification.mode,
          ":priority": classification.priority,
          ":requires_action": classification.requires_action,
          ":summary": classification.summary,
          ":tags": classification.tags || [],
          ":classified_at": now,
          ":service": classification.service,
        },
      })
    );

    // Emit ItemClassified event
    await eventbridge.putEvents({
      Entries: [
        {
          EventBusName: Resource.Bus.name,
          Source: "ai-automation-platform",
          DetailType: "item.classified",
          Detail: JSON.stringify({
            workspace_id,
            item_id,
            item_type: classification.item_type,
            mode: classification.mode,
            requires_action: classification.requires_action,
          }),
        },
      ],
    });

    // If this is an alert, create an Alert record
    if (classification.item_type === "alert" && classification.requires_action) {
      const alertId = randomUUID();
      const alert: Alert = {
        alert_id: alertId,
        workspace_id,
        item_id,
        title: item.metadata.title || classification.summary || "Alert",
        service: classification.service,
        severity: mapPriorityToSeverity(classification.priority),
        status: "open",
        summary: classification.summary,
        source_url: item.metadata.url,
        created_at: now,
        updated_at: now,
        linked_task_ids: [],
      };

      await dynamodb.send(
        new PutCommand({
          TableName: Resource.Alerts.name,
          Item: alert,
        })
      );

      // Emit AlertCreated event
      await eventbridge.putEvents({
        Entries: [
          {
            EventBusName: Resource.Bus.name,
            Source: "ai-automation-platform",
            DetailType: "alert.created",
            Detail: JSON.stringify({
              workspace_id,
              alert_id: alertId,
              item_id,
              severity: alert.severity,
              service: alert.service,
            }),
          },
        ],
      });

      console.log(`Created alert: ${alertId}`);
    }

    console.log(`Successfully classified item: ${item_id}`);
  } catch (error) {
    console.error(`Error classifying item ${item_id}:`, error);
    // Update item status to error
    await dynamodb.send(
      new UpdateCommand({
        TableName: Resource.Items.name,
        Key: {
          workspace_id,
          item_id,
        },
        UpdateExpression: "SET #status = :status, error_message = :error",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": "error",
          ":error": error instanceof Error ? error.message : "Unknown error",
        },
      })
    );
  }
};

function mapPriorityToSeverity(
  priority: string
): "critical" | "high" | "medium" | "low" {
  switch (priority) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return "medium";
  }
}
