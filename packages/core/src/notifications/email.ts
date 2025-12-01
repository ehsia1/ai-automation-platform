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

// Approval email types
export interface ApprovalEmailData {
  runId: string;
  workspaceId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  requestedAt: string;
  expiresAt: string;
  approveUrl: string;
  rejectUrl: string;
}

function formatApprovalHtmlEmail(data: ApprovalEmailData): string {
  const expiresIn = Math.max(
    0,
    Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 60000)
  );

  const argsFormatted = JSON.stringify(data.toolArgs, null, 2);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border-left: 4px solid #dc2626; padding-left: 16px; margin-bottom: 20px;">
    <h1 style="margin: 0 0 8px 0; font-size: 20px;">
      🔐 Approval Required
    </h1>
    <p style="margin: 0; color: #666; font-size: 14px;">
      The AI agent is requesting permission to perform a high-risk action.
    </p>
  </div>

  <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
    <h2 style="margin: 0 0 8px 0; font-size: 18px; color: #991b1b;">
      ${data.toolName}
    </h2>
    <p style="margin: 0; color: #dc2626; font-size: 12px; text-transform: uppercase; font-weight: 600;">
      ⚠️ DESTRUCTIVE ACTION
    </p>
  </div>

  <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
    <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #666;">Arguments</h3>
    <pre style="margin: 0; background: #fff; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 13px; border: 1px solid #e5e7eb;">${argsFormatted}</pre>
  </div>

  <div style="margin-bottom: 24px; text-align: center;">
    <a href="${data.approveUrl}" style="display: inline-block; background: #16a34a; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-right: 12px;">
      ✓ Approve
    </a>
    <a href="${data.rejectUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">
      ✗ Reject
    </a>
  </div>

  <div style="background: #fef3c7; border-radius: 8px; padding: 12px; margin-bottom: 20px;">
    <p style="margin: 0; font-size: 14px; color: #92400e;">
      ⏱️ This request expires in <strong>${expiresIn} minutes</strong>
    </p>
  </div>

  <div style="margin-bottom: 20px;">
    <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;">
      <strong>Run ID:</strong> ${data.runId}<br>
      <strong>Workspace:</strong> ${data.workspaceId}<br>
      <strong>Requested:</strong> ${new Date(data.requestedAt).toLocaleString()}
    </p>
  </div>

  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #999;">
    <p style="margin: 0;">AI Automation Platform - Approval System</p>
    <p style="margin: 4px 0 0 0;">If no action is taken, this request will automatically expire.</p>
  </div>
</body>
</html>
  `.trim();
}

function formatApprovalTextEmail(data: ApprovalEmailData): string {
  const expiresIn = Math.max(
    0,
    Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 60000)
  );

  const argsFormatted = Object.entries(data.toolArgs)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
    .join("\n");

  return `
🔐 AI Agent Approval Request
============================

The AI agent is requesting permission to perform a high-risk action.

TOOL: ${data.toolName}
RISK LEVEL: DESTRUCTIVE

ARGUMENTS:
${argsFormatted}

To approve this action, visit:
${data.approveUrl}

To reject this action, visit:
${data.rejectUrl}

⏱️ This request expires in ${expiresIn} minutes

---
Run ID: ${data.runId}
Workspace: ${data.workspaceId}
Requested: ${new Date(data.requestedAt).toLocaleString()}

If no action is taken, this request will automatically expire.
  `.trim();
}

export async function sendApprovalEmail(
  config: EmailConfig,
  data: ApprovalEmailData
): Promise<void> {
  const client = getResendClient();
  const toAddresses = Array.isArray(config.to) ? config.to : [config.to];
  const subject = `🔐 Approval Required: ${data.toolName}`;

  const { error } = await client.emails.send({
    from: config.from,
    to: toAddresses,
    replyTo: config.replyTo,
    subject,
    html: formatApprovalHtmlEmail(data),
    text: formatApprovalTextEmail(data),
  });

  if (error) {
    throw new Error(`Failed to send approval email: ${error.message}`);
  }
}
