import { APIGatewayProxyHandler } from "aws-lambda";
import { Resource } from "sst";
import { EventBridge } from "@aws-sdk/client-eventbridge";

const eventbridge = new EventBridge({});
const DEFAULT_WORKSPACE_ID = "default";

// Available agents
const AGENTS = {
  alert_triage: {
    name: "Alert Triage Agent",
    description: "Analyzes alerts and provides triage recommendations",
    triggerEvent: "alert.created",
  },
  daily_digest: {
    name: "Daily Digest Agent",
    description: "Generates daily summary of tasks and items",
    triggerEvent: "digest.requested",
  },
};

export const runAgent: APIGatewayProxyHandler = async (event) => {
  try {
    const agentKey = event.pathParameters?.agentKey;
    if (!agentKey || !(agentKey in AGENTS)) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: `Invalid agent key. Available: ${Object.keys(AGENTS).join(", ")}`,
        }),
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const agent = AGENTS[agentKey as keyof typeof AGENTS];

    // Emit event to trigger the agent
    await eventbridge.putEvents({
      Entries: [
        {
          EventBusName: Resource.Bus.name,
          Source: "ai-automation-platform",
          DetailType: agent.triggerEvent,
          Detail: JSON.stringify({
            workspace_id: DEFAULT_WORKSPACE_ID,
            ...body,
            manual_trigger: true,
          }),
        },
      ],
    });

    return {
      statusCode: 202,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        message: `Agent ${agentKey} triggered successfully`,
        agent: agent.name,
      }),
    };
  } catch (error) {
    console.error("Error triggering agent:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
