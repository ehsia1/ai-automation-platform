// Microsoft Teams Adaptive Card types
export interface TeamsAdaptiveCard {
  type: "AdaptiveCard";
  $schema: string;
  version: string;
  body: AdaptiveCardElement[];
  actions?: AdaptiveCardAction[];
}

export interface AdaptiveCardElement {
  type: string;
  text?: string;
  weight?: string;
  size?: string;
  color?: string;
  wrap?: boolean;
  spacing?: string;
  columns?: AdaptiveCardColumn[];
  items?: AdaptiveCardElement[];
  facts?: Array<{ title: string; value: string }>;
}

export interface AdaptiveCardColumn {
  type: "Column";
  width: string;
  items: AdaptiveCardElement[];
}

export interface AdaptiveCardAction {
  type: string;
  title: string;
  url?: string;
}

export interface TeamsMessage {
  type: "message";
  attachments: Array<{
    contentType: string;
    contentUrl: null;
    content: TeamsAdaptiveCard;
  }>;
}

export interface AlertNotificationData {
  alertId: string;
  title: string;
  severity: string;
  service?: string;
  summary: string;
  suggestedActions?: string[];
  rootCause?: string;
  dashboardUrl?: string;
  sourceUrl?: string;
}

function getSeverityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "attention"; // Red
    case "high":
      return "warning"; // Orange/Yellow
    case "medium":
      return "accent"; // Blue
    case "low":
      return "good"; // Green
    default:
      return "default";
  }
}

function getSeverityEmoji(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "🟢";
    default:
      return "⚪";
  }
}

export function formatAlertNotification(data: AlertNotificationData): TeamsMessage {
  const emoji = getSeverityEmoji(data.severity);
  const color = getSeverityColor(data.severity);

  const body: AdaptiveCardElement[] = [
    {
      type: "TextBlock",
      text: `${emoji} Alert: ${data.title}`,
      weight: "bolder",
      size: "large",
      wrap: true,
    },
    {
      type: "ColumnSet",
      columns: [
        {
          type: "Column",
          width: "auto",
          items: [
            {
              type: "TextBlock",
              text: "Severity:",
              weight: "bolder",
            },
            {
              type: "TextBlock",
              text: data.severity.toUpperCase(),
              color: color,
              weight: "bolder",
            },
          ],
        },
        {
          type: "Column",
          width: "auto",
          items: [
            {
              type: "TextBlock",
              text: "Service:",
              weight: "bolder",
            },
            {
              type: "TextBlock",
              text: data.service || "Unknown",
            },
          ],
        },
      ],
    },
    {
      type: "TextBlock",
      text: "**Summary:**",
      weight: "bolder",
      spacing: "medium",
    },
    {
      type: "TextBlock",
      text: data.summary,
      wrap: true,
    },
  ];

  if (data.rootCause) {
    body.push(
      {
        type: "TextBlock",
        text: "**Probable Root Cause:**",
        weight: "bolder",
        spacing: "medium",
      },
      {
        type: "TextBlock",
        text: data.rootCause,
        wrap: true,
      }
    );
  }

  if (data.suggestedActions && data.suggestedActions.length > 0) {
    body.push(
      {
        type: "TextBlock",
        text: "**Suggested Actions:**",
        weight: "bolder",
        spacing: "medium",
      },
      {
        type: "TextBlock",
        text: data.suggestedActions.map((a, i) => `${i + 1}. ${a}`).join("\n"),
        wrap: true,
      }
    );
  }

  const actions: AdaptiveCardAction[] = [];

  if (data.dashboardUrl) {
    actions.push({
      type: "Action.OpenUrl",
      title: "View in Dashboard",
      url: data.dashboardUrl,
    });
  }

  if (data.sourceUrl) {
    actions.push({
      type: "Action.OpenUrl",
      title: "View Source",
      url: data.sourceUrl,
    });
  }

  const card: TeamsAdaptiveCard = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body,
    ...(actions.length > 0 && { actions }),
  };

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: card,
      },
    ],
  };
}

export async function sendTeamsMessage(
  webhookUrl: string,
  message: TeamsMessage
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Teams webhook error: ${response.status} - ${errorText}`);
  }
}

export async function sendAlertNotification(
  webhookUrl: string,
  data: AlertNotificationData
): Promise<void> {
  const message = formatAlertNotification(data);
  await sendTeamsMessage(webhookUrl, message);
}
