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

const DEFAULT_WORKSPACE_ID = "default";

interface EmailPayload {
  subject: string;
  body: string;
  sender: string;
  received_at?: string;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const payload = body as EmailPayload;

    if (!payload.subject || !payload.body || !payload.sender) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "Missing required fields: subject, body, sender",
        }),
      };
    }

    const itemId = randomUUID();
    const now = new Date().toISOString();

    const item: IncomingItem = {
      item_id: itemId,
      workspace_id: DEFAULT_WORKSPACE_ID,
      source: "email",
      source_item_id: itemId,
      received_at: payload.received_at || now,
      raw_payload: { ...payload },
      metadata: {
        subject: payload.subject,
        sender: payload.sender,
      },
      status: "ingested",
    };

    await dynamodb.send(
      new PutCommand({
        TableName: Resource.Items.name,
        Item: item,
      })
    );

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

    console.log(`Ingested email: ${itemId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        item_id: itemId,
      }),
    };
  } catch (error) {
    console.error("Error processing email:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
