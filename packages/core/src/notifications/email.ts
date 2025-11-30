import { Resend } from "resend";

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    resend = new Resend(apiKey);
  }
  return resend;
}

export interface AlertEmailData {
  alertId: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  service?: string;
  summary: string;
  suggestedActions: string[];
  rootCause?: string;
  sourceUrl?: string;
}

export interface EmailConfig {
  to: string | string[];
  from: string;
  replyTo?: string;
}

function getSeverityEmoji(severity: string): string {
  switch (severity) {
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

function formatHtmlEmail(data: AlertEmailData): string {
  const emoji = getSeverityEmoji(data.severity);
  const severityColor =
    data.severity === "critical"
      ? "#dc2626"
      : data.severity === "high"
        ? "#ea580c"
        : data.severity === "medium"
          ? "#ca8a04"
          : "#16a34a";

  const actionsHtml = data.suggestedActions
    .map((action) => `<li style="margin-bottom: 8px;">${action}</li>`)
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border-left: 4px solid ${severityColor}; padding-left: 16px; margin-bottom: 20px;">
    <h1 style="margin: 0 0 8px 0; font-size: 20px;">
      ${emoji} ${data.title}
    </h1>
    <p style="margin: 0; color: #666; font-size: 14px;">
      <strong>Severity:</strong> <span style="color: ${severityColor}; text-transform: uppercase;">${data.severity}</span>
      ${data.service ? ` • <strong>Service:</strong> ${data.service}` : ""}
    </p>
  </div>

  <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
    <h2 style="margin: 0 0 8px 0; font-size: 14px; color: #666; text-transform: uppercase;">Summary</h2>
    <p style="margin: 0;">${data.summary}</p>
  </div>

  ${
    data.rootCause
      ? `
  <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
    <h2 style="margin: 0 0 8px 0; font-size: 14px; color: #92400e; text-transform: uppercase;">Likely Root Cause</h2>
    <p style="margin: 0; color: #78350f;">${data.rootCause}</p>
  </div>
  `
      : ""
  }

  <div style="margin-bottom: 20px;">
    <h2 style="margin: 0 0 12px 0; font-size: 14px; color: #666; text-transform: uppercase;">Suggested Actions</h2>
    <ol style="margin: 0; padding-left: 20px;">
      ${actionsHtml}
    </ol>
  </div>

  ${
    data.sourceUrl
      ? `
  <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
    <a href="${data.sourceUrl}" style="color: #2563eb; text-decoration: none;">View Original Alert →</a>
  </div>
  `
      : ""
  }

  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #999;">
    <p style="margin: 0;">Alert ID: ${data.alertId}</p>
    <p style="margin: 4px 0 0 0;">Sent by AI Automation Platform</p>
  </div>
</body>
</html>
  `.trim();
}

function formatTextEmail(data: AlertEmailData): string {
  const emoji = getSeverityEmoji(data.severity);
  const actions = data.suggestedActions
    .map((action, i) => `${i + 1}. ${action}`)
    .join("\n");

  return `
${emoji} ${data.title}
${"=".repeat(50)}

Severity: ${data.severity.toUpperCase()}
${data.service ? `Service: ${data.service}` : ""}

SUMMARY
${data.summary}

${data.rootCause ? `LIKELY ROOT CAUSE\n${data.rootCause}\n` : ""}
SUGGESTED ACTIONS
${actions}

${data.sourceUrl ? `View Original: ${data.sourceUrl}\n` : ""}
---
Alert ID: ${data.alertId}
Sent by AI Automation Platform
  `.trim();
}

export async function sendAlertEmail(
  config: EmailConfig,
  data: AlertEmailData
): Promise<void> {
  const client = getResendClient();
  const toAddresses = Array.isArray(config.to) ? config.to : [config.to];
  const emoji = getSeverityEmoji(data.severity);
  const subject = `${emoji} [${data.severity.toUpperCase()}] ${data.title}`;

  const { error } = await client.emails.send({
    from: config.from,
    to: toAddresses,
    replyTo: config.replyTo,
    subject,
    html: formatHtmlEmail(data),
    text: formatTextEmail(data),
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}
