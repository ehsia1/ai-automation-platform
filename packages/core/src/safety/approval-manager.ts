// Approval workflow manager for high-risk agent actions

export interface ApprovalRequest {
  id: string;
  workspaceId: string;
  runId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  riskTier: "destructive";
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}

// Approval timeout (30 minutes)
const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

// Create an approval request
export function createApprovalRequest(
  id: string,
  workspaceId: string,
  runId: string,
  toolName: string,
  toolArgs: Record<string, unknown>
): ApprovalRequest {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + APPROVAL_TIMEOUT_MS);

  return {
    id,
    workspaceId,
    runId,
    toolName,
    toolArgs,
    riskTier: "destructive",
    status: "pending",
    requestedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

// Check if an approval request has expired
export function isExpired(request: ApprovalRequest): boolean {
  return new Date(request.expiresAt) < new Date();
}

// Format approval request for notification
export function formatApprovalNotification(request: ApprovalRequest): {
  subject: string;
  text: string;
  html: string;
} {
  const argsFormatted = Object.entries(request.toolArgs)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
    .join("\n");

  const expiresIn = Math.max(
    0,
    Math.round(
      (new Date(request.expiresAt).getTime() - Date.now()) / 60000
    )
  );

  const subject = `🔐 Approval Required: ${request.toolName}`;

  const text = `
AI Agent Approval Request
========================

The AI agent is requesting permission to perform a high-risk action.

Tool: ${request.toolName}
Risk Level: ${request.riskTier.toUpperCase()}

Arguments:
${argsFormatted}

Request ID: ${request.id}
Run ID: ${request.runId}
Requested At: ${request.requestedAt}
Expires In: ${expiresIn} minutes

To approve or reject this action, use the approval API:

APPROVE:
curl -X POST /approvals/${request.id}/approve

REJECT:
curl -X POST /approvals/${request.id}/reject

If no action is taken, this request will automatically expire.
`.trim();

  const html = `
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
    <h2 style="margin: 0 0 8px 0; font-size: 16px; color: #991b1b;">
      ${request.toolName}
    </h2>
    <p style="margin: 0; color: #dc2626; font-size: 12px; text-transform: uppercase;">
      Risk Level: ${request.riskTier}
    </p>
  </div>

  <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
    <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #666;">Arguments</h3>
    <pre style="margin: 0; background: #fff; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 13px;">${JSON.stringify(request.toolArgs, null, 2)}</pre>
  </div>

  <div style="margin-bottom: 20px;">
    <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">
      <strong>Request ID:</strong> ${request.id}<br>
      <strong>Run ID:</strong> ${request.runId}<br>
      <strong>Expires In:</strong> ${expiresIn} minutes
    </p>
  </div>

  <div style="margin-top: 24px;">
    <p style="margin: 0 0 12px 0; font-size: 14px;">
      To approve or reject, use the approval API endpoints.
    </p>
  </div>

  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #999;">
    <p style="margin: 0;">AI Automation Platform - Approval System</p>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

// Build approval/rejection URLs
export function buildApprovalUrls(
  baseUrl: string,
  requestId: string
): { approveUrl: string; rejectUrl: string } {
  return {
    approveUrl: `${baseUrl}/approvals/${requestId}/approve`,
    rejectUrl: `${baseUrl}/approvals/${requestId}/reject`,
  };
}
