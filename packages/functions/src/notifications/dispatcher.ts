import { EventBridgeHandler } from "aws-lambda";
import {
  sendAlertEmail,
  type NotificationRequestedEvent,
} from "@ai-automation-platform/core";

interface SlackMessage {
  text: string;
  blocks?: Array<{
    type: string;
    text?: { type: string; text: string };
  }>;
}

export const handler: EventBridgeHandler<
  "notification.requested",
  NotificationRequestedEvent,
  void
> = async (event) => {
  const { channel, template, data } = event.detail;

  console.log(`Processing notification: ${template} via ${channel}`);

  try {
    // Slack notification
    if (channel === "slack" || channel === "auto") {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (webhookUrl) {
        const message = formatSlackMessage(template, data);
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message),
        });
        if (!response.ok) {
          console.error(`Slack webhook failed: ${response.status}`);
        } else {
          console.log(`Sent Slack notification: ${template}`);
        }
      }
    }

    // Email notification
    if (channel === "email" || channel === "auto") {
      const emailTo = process.env.ALERT_EMAIL_TO;
      const emailFrom = process.env.ALERT_EMAIL_FROM;
      if (emailTo && emailFrom) {
        await sendAlertEmail(
          { to: emailTo.split(","), from: emailFrom },
          {
            alertId: String(data.alertId || "N/A"),
            title: String(data.title || "Notification"),
            severity: (data.severity as "critical" | "high" | "medium" | "low") || "medium",
            service: data.service as string | undefined,
            summary: String(data.summary || data.content || data.message || ""),
            suggestedActions: (data.suggestedActions as string[]) || [],
            rootCause: data.rootCause as string | undefined,
            sourceUrl: data.sourceUrl as string | undefined,
          }
        );
        console.log(`Sent email notification: ${template}`);
      }
    }
  } catch (error) {
    console.error("Failed to send notification:", error);
    throw error;
  }
};

function formatSlackMessage(
  template: string,
  data: Record<string, unknown>
): SlackMessage {
  switch (template) {
    case "alert_triage_result":
      return {
        text: `Alert Triage Complete: ${data.title || "Alert"}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `✅ Alert Triage Complete`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${data.title}*\n${data.summary || ""}`,
            },
          },
        ],
      };
    case "daily_digest":
      return {
        text: `Daily Digest: ${data.date || new Date().toLocaleDateString()}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `📋 Daily Digest`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: String(data.content || "No items today."),
            },
          },
        ],
      };
    default:
      return {
        text: String(data.message || data.text || "Notification"),
      };
  }
}
