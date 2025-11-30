export interface AlertNotificationData {
  alertId: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  service?: string;
  summary: string;
  suggestedActions: string[];
  rootCause?: string;
  sourceUrl?: string;
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string | { type: string; text: string; emoji?: boolean };
    url?: string;
    action_id?: string;
  }>;
  accessory?: {
    type: string;
    text: { type: string; text: string; emoji?: boolean };
    url?: string;
    action_id?: string;
  };
}

interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case "critical":
      return ":red_circle:";
    case "high":
      return ":large_orange_circle:";
    case "medium":
      return ":large_yellow_circle:";
    case "low":
      return ":large_green_circle:";
    default:
      return ":white_circle:";
  }
}

export function formatAlertNotification(data: AlertNotificationData): SlackMessage {
  const emoji = getSeverityEmoji(data.severity);
  const fallbackText = `${emoji} [${data.severity.toUpperCase()}] ${data.title}`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} ${data.title}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Severity:* \`${data.severity.toUpperCase()}\`${data.service ? ` • *Service:* ${data.service}` : ""}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Summary*\n${data.summary}`,
      },
    },
  ];

  if (data.rootCause) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:mag: *Likely Root Cause*\n${data.rootCause}`,
      },
    });
  }

  const actionsText = data.suggestedActions
    .map((action, i) => `${i + 1}. ${action}`)
    .join("\n");

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `:hammer_and_wrench: *Suggested Actions*\n${actionsText}`,
    },
  });

  if (data.sourceUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Original Alert",
            emoji: true,
          },
          url: data.sourceUrl,
          action_id: "view_alert",
        },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Alert ID: \`${data.alertId}\` • Sent by AI Automation Platform`,
      },
    ],
  });

  return {
    text: fallbackText,
    blocks,
  };
}

export async function sendAlertNotification(
  webhookUrl: string,
  data: AlertNotificationData
): Promise<void> {
  const message = formatAlertNotification(data);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Slack webhook failed: ${response.status} - ${errorText}`);
  }
}
