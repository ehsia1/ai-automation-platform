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
    const source = event.queryStringParameters?.source;
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

    if (source) {
      filters.push("#source = :source");
      expressionValues[":source"] = source;
      expressionNames["#source"] = "source";
    }

    const result = await dynamodb.send(
      new QueryCommand({
        TableName: Resource.Items.name,
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
        items: result.Items || [],
        count: result.Count,
      }),
    };
  } catch (error) {
    console.error("Error listing items:", error);
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
    const itemId = event.pathParameters?.id;
    if (!itemId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Missing item ID" }),
      };
    }

    const result = await dynamodb.send(
      new GetCommand({
        TableName: Resource.Items.name,
        Key: {
          workspace_id: DEFAULT_WORKSPACE_ID,
          item_id: itemId,
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
        body: JSON.stringify({ error: "Item not found" }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        item: result.Item,
      }),
    };
  } catch (error) {
    console.error("Error getting item:", error);
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
