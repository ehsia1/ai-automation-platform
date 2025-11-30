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
    const agentKey = event.queryStringParameters?.agent_key;
    const triggerId = event.queryStringParameters?.trigger_id;
    const limit = parseInt(event.queryStringParameters?.limit || "50", 10);

    const filters: string[] = [];
    const expressionValues: Record<string, unknown> = {
      ":wsId": DEFAULT_WORKSPACE_ID,
    };

    if (agentKey) {
      filters.push("agent_key = :agentKey");
      expressionValues[":agentKey"] = agentKey;
    }

    if (triggerId) {
      filters.push("trigger_id = :triggerId");
      expressionValues[":triggerId"] = triggerId;
    }

    const result = await dynamodb.send(
      new QueryCommand({
        TableName: Resource.AgentRuns.name,
        KeyConditionExpression: "workspace_id = :wsId",
        FilterExpression: filters.length > 0 ? filters.join(" AND ") : undefined,
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
        agentRuns: result.Items || [],
        count: result.Count,
      }),
    };
  } catch (error) {
    console.error("Error listing agent runs:", error);
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
    const runId = event.pathParameters?.id;
    if (!runId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Missing run ID" }),
      };
    }

    const result = await dynamodb.send(
      new GetCommand({
        TableName: Resource.AgentRuns.name,
        Key: {
          workspace_id: DEFAULT_WORKSPACE_ID,
          run_id: runId,
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
        body: JSON.stringify({ error: "Agent run not found" }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        agentRun: result.Item,
      }),
    };
  } catch (error) {
    console.error("Error getting agent run:", error);
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
