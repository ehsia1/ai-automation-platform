import { APIGatewayProxyHandler } from "aws-lambda";
import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const DEFAULT_WORKSPACE_ID = "default";

export const list: APIGatewayProxyHandler = async (event) => {
  try {
    const status = event.queryStringParameters?.status;
    const limit = parseInt(event.queryStringParameters?.limit || "50", 10);

    let filterExpression: string | undefined;
    const expressionValues: Record<string, unknown> = {
      ":wsId": DEFAULT_WORKSPACE_ID,
    };

    if (status) {
      filterExpression = "#status = :status";
      expressionValues[":status"] = status;
    }

    const result = await dynamodb.send(
      new QueryCommand({
        TableName: Resource.Alerts.name,
        KeyConditionExpression: "workspace_id = :wsId",
        FilterExpression: filterExpression,
        ExpressionAttributeNames: status ? { "#status": "status" } : undefined,
        ExpressionAttributeValues: expressionValues,
        Limit: limit,
        ScanIndexForward: false,
      })
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        alerts: result.Items || [],
        count: result.Count,
      }),
    };
  } catch (error) {
    console.error("Error listing alerts:", error);
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

export const get: APIGatewayProxyHandler = async (event) => {
  try {
    const alertId = event.pathParameters?.id;
    if (!alertId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Missing alert ID" }),
      };
    }

    const result = await dynamodb.send(
      new GetCommand({
        TableName: Resource.Alerts.name,
        Key: {
          workspace_id: DEFAULT_WORKSPACE_ID,
          alert_id: alertId,
        },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Alert not found" }),
      };
    }

    // Also fetch related agent runs
    const agentRunsResult = await dynamodb.send(
      new QueryCommand({
        TableName: Resource.AgentRuns.name,
        IndexName: "byTrigger",
        KeyConditionExpression: "trigger_id = :alertId",
        ExpressionAttributeValues: {
          ":alertId": alertId,
        },
        ScanIndexForward: false,
      })
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        alert: result.Item,
        agentRuns: agentRunsResult.Items || [],
      }),
    };
  } catch (error) {
    console.error("Error getting alert:", error);
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
