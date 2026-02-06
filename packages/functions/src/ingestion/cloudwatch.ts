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

// Default workspace for MVP (single-tenant)
const DEFAULT_WORKSPACE_ID = "default";

/**
 * CloudWatch Alarm SNS Message format
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html
 */
interface CloudWatchAlarmMessage {
  AlarmName: string;
  AlarmDescription?: string;
  AWSAccountId: string;
  NewStateValue: "ALARM" | "OK" | "INSUFFICIENT_DATA";
  NewStateReason: string;
  StateChangeTime: string;
  Region: string;
  AlarmArn: string;
  OldStateValue?: string;
  Trigger: {
    MetricName: string;
    Namespace: string;
    StatisticType: string;
    Statistic?: string;
    Unit?: string;
    Dimensions?: Array<{ name: string; value: string }>;
    Period: number;
    EvaluationPeriods: number;
    ComparisonOperator: string;
    Threshold: number;
    TreatMissingData?: string;
    EvaluateLowSampleCountPercentile?: string;
  };
  [key: string]: unknown;
}

/**
 * SNS message wrapper format
 */
interface SNSMessageWrapper {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string; // JSON-encoded CloudWatchAlarmMessage
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  UnsubscribeURL?: string;
  SubscribeURL?: string;
  Token?: string;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // Handle SNS subscription confirmation
    if (body.Type === "SubscriptionConfirmation") {
      console.log("SNS Subscription Confirmation received. SubscribeURL:", body.SubscribeURL);
      // In production, you'd want to auto-confirm by fetching the SubscribeURL
      // For now, just acknowledge it
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Subscription confirmation received. Please confirm via SubscribeURL.",
          subscribeUrl: body.SubscribeURL,
        }),
      };
    }

    // Parse the alarm message (either direct or SNS-wrapped)
    let alarmMessage: CloudWatchAlarmMessage;
    let snsWrapper: SNSMessageWrapper | null = null;

    if (body.Type === "Notification" && body.Message) {
      // SNS-wrapped CloudWatch alarm
      snsWrapper = body as SNSMessageWrapper;
      alarmMessage = JSON.parse(snsWrapper.Message);
    } else if (body.AlarmName) {
      // Direct CloudWatch alarm format (e.g., from EventBridge)
      alarmMessage = body as CloudWatchAlarmMessage;
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "Invalid CloudWatch alarm format",
        }),
      };
    }

    // Only process ALARM state (not OK or INSUFFICIENT_DATA)
    if (alarmMessage.NewStateValue !== "ALARM") {
      console.log(`Ignoring CloudWatch alarm state: ${alarmMessage.NewStateValue}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: `Ignored non-ALARM state: ${alarmMessage.NewStateValue}`,
        }),
      };
    }

    // Generate unique item ID
    const itemId = randomUUID();
    const now = new Date().toISOString();

    // Extract service from dimensions or namespace
    const service = extractService(alarmMessage);

    // Build CloudWatch console URL
    const region = alarmMessage.Region || process.env.AWS_REGION || "us-east-1";
    const alarmUrl = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(alarmMessage.AlarmName)}`;

    // Normalize to IncomingItem format
    const item: IncomingItem = {
      item_id: itemId,
      workspace_id: DEFAULT_WORKSPACE_ID,
      source: "cloudwatch",
      source_item_id: alarmMessage.AlarmArn || alarmMessage.AlarmName,
      received_at: now,
      raw_payload: {
        alarm: alarmMessage,
        sns: snsWrapper || undefined,
      },
      metadata: {
        title: alarmMessage.AlarmName,
        service,
        severity: mapCloudWatchSeverity(alarmMessage),
        url: alarmUrl,
      },
      status: "ingested",
    };

    // Write to DynamoDB
    await dynamodb.send(
      new PutCommand({
        TableName: Resource.Items.name,
        Item: item,
      })
    );

    // Emit IncomingItemCreated event to EventBridge
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

    console.log(`Ingested CloudWatch alarm: ${itemId} - ${alarmMessage.AlarmName}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        item_id: itemId,
        alarm_name: alarmMessage.AlarmName,
      }),
    };
  } catch (error) {
    console.error("Error processing CloudWatch alarm:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};

/**
 * Extract service name from alarm dimensions or namespace
 */
function extractService(alarm: CloudWatchAlarmMessage): string | undefined {
  const trigger = alarm.Trigger;

  // Check dimensions for common service identifiers
  const dimensions = trigger?.Dimensions || [];
  for (const dim of dimensions) {
    const name = dim.name.toLowerCase();
    if (
      name === "servicename" ||
      name === "functionname" ||
      name === "tablename" ||
      name === "queuename" ||
      name === "clusteridentifier" ||
      name === "loadbalancer" ||
      name === "targetgroup"
    ) {
      return dim.value;
    }
  }

  // Fall back to namespace (e.g., AWS/Lambda → Lambda)
  if (trigger?.Namespace) {
    const namespace = trigger.Namespace;
    if (namespace.startsWith("AWS/")) {
      return namespace.replace("AWS/", "");
    }
    return namespace;
  }

  return undefined;
}

/**
 * Map CloudWatch alarm to severity
 * CloudWatch doesn't have built-in severity - infer from alarm name/description
 */
function mapCloudWatchSeverity(alarm: CloudWatchAlarmMessage): string {
  const name = alarm.AlarmName.toLowerCase();
  const description = (alarm.AlarmDescription || "").toLowerCase();
  const combined = `${name} ${description}`;

  // Check for severity indicators in name/description
  if (
    combined.includes("critical") ||
    combined.includes("p1") ||
    combined.includes("emergency") ||
    combined.includes("outage")
  ) {
    return "critical";
  }

  if (
    combined.includes("high") ||
    combined.includes("p2") ||
    combined.includes("error") ||
    combined.includes("failure")
  ) {
    return "high";
  }

  if (
    combined.includes("low") ||
    combined.includes("p4") ||
    combined.includes("info") ||
    combined.includes("warning")
  ) {
    return "low";
  }

  // Default to medium for most CloudWatch alarms
  return "medium";
}
