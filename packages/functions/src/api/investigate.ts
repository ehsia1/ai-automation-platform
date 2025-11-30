import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { Resource } from "sst";
import { randomUUID } from "crypto";

const eventBridge = new EventBridgeClient({});

interface InvestigateRequest {
  prompt: string;
  workspaceId?: string;
  alertId?: string;
  context?: {
    service?: string;
    errorMessage?: string;
    logGroup?: string;
    timeRange?: string;
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}") as InvestigateRequest;

    if (!body.prompt) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Missing required field: prompt",
        }),
      };
    }

    // Generate IDs
    const workspaceId = body.workspaceId || "default";
    const runId = `inv_${randomUUID()}`;

    // Emit investigation.requested event
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: "ai-automation-platform",
            EventBusName: Resource.Bus.name,
            DetailType: "investigation.requested",
            Detail: JSON.stringify({
              workspaceId,
              runId,
              prompt: body.prompt,
              alertId: body.alertId,
              context: body.context,
            }),
          },
        ],
      })
    );

    return {
      statusCode: 202,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Investigation started",
        runId,
        workspaceId,
      }),
    };
  } catch (error) {
    console.error("Failed to start investigation:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to start investigation",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
