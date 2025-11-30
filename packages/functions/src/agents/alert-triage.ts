import { EventBridgeHandler } from "aws-lambda";
import { randomUUID } from "crypto";
import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  initializeLLM,
  completeJSON,
  buildAlertTriagePrompt,
  sendAlertNotification as sendSlackNotification,
  sendAlertEmail,
  type AlertTriageResult,
  type Alert,
  type AgentRun,
  type ClassifiedItem,
} from "@ai-automation-platform/core";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize LLM based on environment
initializeLLM({
  provider: (process.env.LLM_PROVIDER as "ollama" | "anthropic") || "ollama",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
  ollamaModel: process.env.OLLAMA_MODEL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

interface AlertCreatedEvent {
  workspace_id: string;
  alert_id: string;
  item_id: string;
  severity: string;
  service?: string;
}

export const handler: EventBridgeHandler<
  "alert.created",
  AlertCreatedEvent,
  void
> = async (event) => {
  const { workspace_id, alert_id, item_id } = event.detail;
  const runId = randomUUID();
  const startTime = Date.now();

  console.log(`Starting alert triage for: ${alert_id}`);

  try {
    // Create AgentRun record (pending)
    const agentRun: AgentRun = {
      run_id: runId,
      workspace_id,
      agent_key: "alert_triage",
      trigger_event: "alert.created",
      trigger_id: alert_id,
      input_snapshot: { ...event.detail },
      status: "running",
      created_at: new Date().toISOString(),
    };

    await dynamodb.send(
      new PutCommand({
        TableName: Resource.AgentRuns.name,
        Item: agentRun,
      })
    );

    // Fetch alert
    const alertResult = await dynamodb.send(
      new GetCommand({
        TableName: Resource.Alerts.name,
        Key: {
          workspace_id,
          alert_id,
        },
      })
    );

    const alert = alertResult.Item as Alert | undefined;
    if (!alert) {
      throw new Error(`Alert not found: ${alert_id}`);
    }

    // Fetch the original item for more context
    const itemResult = await dynamodb.send(
      new GetCommand({
        TableName: Resource.Items.name,
        Key: {
          workspace_id,
          item_id,
        },
      })
    );

    const item = itemResult.Item as ClassifiedItem | undefined;

    // Build triage prompt
    const messages = buildAlertTriagePrompt({
      alert,
      itemSummary: item?.summary,
      rawPayload: item?.raw_payload as Record<string, unknown>,
    });

    // Call LLM for triage analysis
    const triageResult = await completeJSON<AlertTriageResult>(messages, {
      temperature: 0.5,
      maxTokens: 2048,
    });

    console.log(`Triage result:`, triageResult);

    const endTime = Date.now();
    const now = new Date().toISOString();

    // Update AgentRun with results
    await dynamodb.send(
      new UpdateCommand({
        TableName: Resource.AgentRuns.name,
        Key: {
          workspace_id,
          run_id: runId,
        },
        UpdateExpression: `
          SET #status = :status,
              #output = :output,
              completed_at = :completedAt,
              duration_ms = :duration
        `,
        ExpressionAttributeNames: {
          "#status": "status",
          "#output": "output",
        },
        ExpressionAttributeValues: {
          ":status": "success",
          ":output": {
            summary: triageResult.summary,
            analysis: triageResult.severity_assessment,
            suggested_actions: triageResult.suggested_actions,
            root_cause: triageResult.root_cause,
            severity_assessment: triageResult.severity_assessment,
          },
          ":completedAt": now,
          ":duration": endTime - startTime,
        },
      })
    );

    // Send notifications via configured channels
    const notificationData = {
      alertId: alert_id,
      title: alert.title,
      severity: alert.severity,
      service: alert.service,
      summary: triageResult.summary,
      suggestedActions: triageResult.suggested_actions,
      rootCause: triageResult.root_cause,
      sourceUrl: alert.source_url,
    };

    // Slack notification
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackWebhookUrl) {
      try {
        await sendSlackNotification(slackWebhookUrl, notificationData);
        console.log(`Sent Slack notification for alert: ${alert_id}`);
      } catch (slackError) {
        console.error("Failed to send Slack notification:", slackError);
      }
    }

    // Email notification
    const emailTo = process.env.ALERT_EMAIL_TO;
    const emailFrom = process.env.ALERT_EMAIL_FROM;
    if (emailTo && emailFrom) {
      try {
        await sendAlertEmail(
          { to: emailTo.split(","), from: emailFrom },
          notificationData
        );
        console.log(`Sent email notification for alert: ${alert_id}`);
      } catch (emailError) {
        console.error("Failed to send email notification:", emailError);
      }
    }

    console.log(`Alert triage completed for: ${alert_id}`);
  } catch (error) {
    console.error(`Error in alert triage for ${alert_id}:`, error);

    // Update AgentRun with error
    await dynamodb.send(
      new UpdateCommand({
        TableName: Resource.AgentRuns.name,
        Key: {
          workspace_id,
          run_id: runId,
        },
        UpdateExpression: `
          SET #status = :status,
              error_message = :error,
              completed_at = :completedAt,
              duration_ms = :duration
        `,
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": "error",
          ":error": error instanceof Error ? error.message : "Unknown error",
          ":completedAt": new Date().toISOString(),
          ":duration": Date.now() - startTime,
        },
      })
    );
  }
};
