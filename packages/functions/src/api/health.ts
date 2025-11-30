import { APIGatewayProxyHandler } from "aws-lambda";

export const handler: APIGatewayProxyHandler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "ai-automation-platform",
    }),
  };
};
