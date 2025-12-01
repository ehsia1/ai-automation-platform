import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { Resource } from "sst";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const eventBridge = new EventBridgeClient({});

// List pending approvals
export const list: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const workspaceId = event.queryStringParameters?.workspace_id || "default";

    const result = await docClient.send(
      new QueryCommand({
        TableName: Resource.AgentRuns.name,
        KeyConditionExpression: "workspace_id = :workspaceId",
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":workspaceId": workspaceId,
          ":status": "paused",
        },
      })
    );

    // Filter to only runs with pending approvals
    const pendingApprovals = (result.Items || [])
      .filter((item) => item.pending_approval)
      .map((item) => ({
        runId: item.run_id,
        workspaceId: item.workspace_id,
        agentType: item.agent_type,
        pendingApproval: item.pending_approval,
        createdAt: item.created_at,
      }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvals: pendingApprovals,
        count: pendingApprovals.length,
      }),
    };
  } catch (error) {
    console.error("Failed to list approvals:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list approvals",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

// Approve a pending action
export const approve: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const runId = event.pathParameters?.id;
    if (!runId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing run ID" }),
      };
    }

    const workspaceId =
      event.queryStringParameters?.workspace_id || "default";

    // Get the agent run
    const getResult = await docClient.send(
      new GetCommand({
        TableName: Resource.AgentRuns.name,
        Key: {
          workspace_id: workspaceId,
          run_id: runId,
        },
      })
    );

    if (!getResult.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Agent run not found" }),
      };
    }

    if (getResult.Item.status !== "paused" || !getResult.Item.pending_approval) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "No pending approval for this run",
          status: getResult.Item.status,
        }),
      };
    }

    // Check if approval has expired (30 minutes)
    const requestedAt = new Date(getResult.Item.pending_approval.requestedAt);
    const expiresAt = new Date(requestedAt.getTime() + 30 * 60 * 1000);
    if (new Date() > expiresAt) {
      // Auto-reject expired approvals
      await docClient.send(
        new UpdateCommand({
          TableName: Resource.AgentRuns.name,
          Key: {
            workspace_id: workspaceId,
            run_id: runId,
          },
          UpdateExpression:
            "SET #status = :status, pending_approval.#decisionStatus = :decisionStatus, " +
            "pending_approval.decidedAt = :decidedAt, updated_at = :updatedAt",
          ExpressionAttributeNames: {
            "#status": "status",
            "#decisionStatus": "status",
          },
          ExpressionAttributeValues: {
            ":status": "failed",
            ":decisionStatus": "expired",
            ":decidedAt": new Date().toISOString(),
            ":updatedAt": new Date().toISOString(),
          },
        })
      );

      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Approval request has expired",
          requestedAt: requestedAt.toISOString(),
          expiredAt: expiresAt.toISOString(),
        }),
      };
    }

    // Emit approval.decided event to resume the agent
    console.log("Emitting approval.decided event:", {
      busName: Resource.Bus.name,
      workspaceId,
      runId,
      approved: true,
    });

    const eventResult = await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: "ai-automation-platform",
            EventBusName: Resource.Bus.name,
            DetailType: "approval.decided",
            Detail: JSON.stringify({
              workspaceId,
              runId,
              approved: true,
              decidedBy: "api", // In production, get from auth
              decidedAt: new Date().toISOString(),
            }),
          },
        ],
      })
    );

    console.log("EventBridge response:", JSON.stringify(eventResult, null, 2));

    // Update the run status
    await docClient.send(
      new UpdateCommand({
        TableName: Resource.AgentRuns.name,
        Key: {
          workspace_id: workspaceId,
          run_id: runId,
        },
        UpdateExpression:
          "SET pending_approval.#decisionStatus = :decisionStatus, " +
          "pending_approval.decidedAt = :decidedAt, " +
          "pending_approval.decidedBy = :decidedBy, " +
          "updated_at = :updatedAt",
        ExpressionAttributeNames: {
          "#decisionStatus": "status",
        },
        ExpressionAttributeValues: {
          ":decisionStatus": "approved",
          ":decidedAt": new Date().toISOString(),
          ":decidedBy": "api",
          ":updatedAt": new Date().toISOString(),
        },
      })
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Approval granted",
        runId,
        toolName: getResult.Item.pending_approval.toolName,
      }),
    };
  } catch (error) {
    console.error("Failed to approve:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to process approval",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

// Reject a pending action
export const reject: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const runId = event.pathParameters?.id;
    if (!runId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing run ID" }),
      };
    }

    const workspaceId =
      event.queryStringParameters?.workspace_id || "default";

    // Parse body for optional reason
    let reason: string | undefined;
    try {
      const body = JSON.parse(event.body || "{}");
      reason = body.reason;
    } catch {
      // Ignore parse errors
    }

    // Get the agent run
    const getResult = await docClient.send(
      new GetCommand({
        TableName: Resource.AgentRuns.name,
        Key: {
          workspace_id: workspaceId,
          run_id: runId,
        },
      })
    );

    if (!getResult.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Agent run not found" }),
      };
    }

    if (getResult.Item.status !== "paused" || !getResult.Item.pending_approval) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "No pending approval for this run",
          status: getResult.Item.status,
        }),
      };
    }

    // Emit rejection event
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: "ai-automation-platform",
            EventBusName: Resource.Bus.name,
            DetailType: "approval.decided",
            Detail: JSON.stringify({
              workspaceId,
              runId,
              approved: false,
              reason,
              decidedBy: "api",
              decidedAt: new Date().toISOString(),
            }),
          },
        ],
      })
    );

    // Update the run status
    await docClient.send(
      new UpdateCommand({
        TableName: Resource.AgentRuns.name,
        Key: {
          workspace_id: workspaceId,
          run_id: runId,
        },
        UpdateExpression:
          "SET #status = :status, " +
          "pending_approval.#decisionStatus = :decisionStatus, " +
          "pending_approval.decidedAt = :decidedAt, " +
          "pending_approval.decidedBy = :decidedBy, " +
          "pending_approval.reason = :reason, " +
          "updated_at = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
          "#decisionStatus": "status",
        },
        ExpressionAttributeValues: {
          ":status": "failed",
          ":decisionStatus": "rejected",
          ":decidedAt": new Date().toISOString(),
          ":decidedBy": "api",
          ":reason": reason || null,
          ":updatedAt": new Date().toISOString(),
        },
      })
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Approval rejected",
        runId,
        toolName: getResult.Item.pending_approval.toolName,
        reason,
      }),
    };
  } catch (error) {
    console.error("Failed to reject:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to process rejection",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
