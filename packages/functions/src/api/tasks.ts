import { APIGatewayProxyHandler } from "aws-lambda";
import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const DEFAULT_WORKSPACE_ID = "default";

export const list: APIGatewayProxyHandler = async (event) => {
  try {
    const status = event.queryStringParameters?.status;
    const mode = event.queryStringParameters?.mode;
    const limit = parseInt(event.queryStringParameters?.limit || "50", 10);

    const filters: string[] = [];
    const expressionValues: Record<string, unknown> = {
      ":wsId": DEFAULT_WORKSPACE_ID,
    };
    const expressionNames: Record<string, string> = {};

    if (status) {
      filters.push("#status = :status");
      expressionValues[":status"] = status;
      expressionNames["#status"] = "status";
    }

    if (mode) {
      filters.push("#mode = :mode");
      expressionValues[":mode"] = mode;
      expressionNames["#mode"] = "mode";
    }

    const result = await dynamodb.send(
      new QueryCommand({
        TableName: Resource.Tasks.name,
        KeyConditionExpression: "workspace_id = :wsId",
        FilterExpression: filters.length > 0 ? filters.join(" AND ") : undefined,
        ExpressionAttributeNames:
          Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
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
        tasks: result.Items || [],
        count: result.Count,
      }),
    };
  } catch (error) {
    console.error("Error listing tasks:", error);
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
