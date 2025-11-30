// Audit logging for AI agent actions

export type AuditEventType =
  | "agent_started"
  | "agent_completed"
  | "agent_failed"
  | "tool_called"
  | "tool_result"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "guardrail_triggered"
  | "llm_request"
  | "llm_response";

export interface AuditLogEntry {
  timestamp: string;
  eventType: AuditEventType;
  workspaceId: string;
  runId: string;
  data: Record<string, unknown>;
}

// In-memory buffer for audit logs (in production, these would go to a persistent store)
const auditBuffer: AuditLogEntry[] = [];
const MAX_BUFFER_SIZE = 1000;

export function logAuditEvent(
  eventType: AuditEventType,
  workspaceId: string,
  runId: string,
  data: Record<string, unknown>
): void {
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    eventType,
    workspaceId,
    runId,
    data,
  };

  // Add to buffer
  auditBuffer.push(entry);

  // Trim buffer if too large
  if (auditBuffer.length > MAX_BUFFER_SIZE) {
    auditBuffer.splice(0, auditBuffer.length - MAX_BUFFER_SIZE);
  }

  // Also log to CloudWatch for persistence
  console.log(
    JSON.stringify({
      level: "AUDIT",
      ...entry,
    })
  );
}

// Helper functions for common audit events
export const audit = {
  agentStarted(workspaceId: string, runId: string, input: string): void {
    logAuditEvent("agent_started", workspaceId, runId, {
      input: input.substring(0, 500), // Truncate long inputs
    });
  },

  agentCompleted(
    workspaceId: string,
    runId: string,
    result: string,
    iterations: number
  ): void {
    logAuditEvent("agent_completed", workspaceId, runId, {
      result: result.substring(0, 500),
      iterations,
    });
  },

  agentFailed(workspaceId: string, runId: string, error: string): void {
    logAuditEvent("agent_failed", workspaceId, runId, { error });
  },

  toolCalled(
    workspaceId: string,
    runId: string,
    toolName: string,
    args: Record<string, unknown>
  ): void {
    logAuditEvent("tool_called", workspaceId, runId, {
      toolName,
      args: sanitizeForAudit(args),
    });
  },

  toolResult(
    workspaceId: string,
    runId: string,
    toolName: string,
    success: boolean,
    outputPreview: string
  ): void {
    logAuditEvent("tool_result", workspaceId, runId, {
      toolName,
      success,
      outputPreview: outputPreview.substring(0, 200),
    });
  },

  approvalRequested(
    workspaceId: string,
    runId: string,
    toolName: string,
    args: Record<string, unknown>
  ): void {
    logAuditEvent("approval_requested", workspaceId, runId, {
      toolName,
      args: sanitizeForAudit(args),
    });
  },

  approvalDecided(
    workspaceId: string,
    runId: string,
    toolName: string,
    approved: boolean,
    approvedBy?: string
  ): void {
    logAuditEvent(approved ? "approval_granted" : "approval_denied", workspaceId, runId, {
      toolName,
      approvedBy,
    });
  },

  guardrailTriggered(
    workspaceId: string,
    runId: string,
    violations: Array<{ type: string; description: string; severity: string }>
  ): void {
    logAuditEvent("guardrail_triggered", workspaceId, runId, { violations });
  },

  llmRequest(
    workspaceId: string,
    runId: string,
    model: string,
    messageCount: number
  ): void {
    logAuditEvent("llm_request", workspaceId, runId, {
      model,
      messageCount,
    });
  },

  llmResponse(
    workspaceId: string,
    runId: string,
    toolCallCount: number,
    hasContent: boolean
  ): void {
    logAuditEvent("llm_response", workspaceId, runId, {
      toolCallCount,
      hasContent,
    });
  },
};

// Sanitize data for audit logs (remove sensitive info)
function sanitizeForAudit(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    // Redact sensitive-looking keys
    if (
      /password|secret|token|key|credential/i.test(key) &&
      typeof value === "string"
    ) {
      sanitized[key] = "***REDACTED***";
    } else if (typeof value === "string" && value.length > 500) {
      // Truncate long strings
      sanitized[key] = value.substring(0, 500) + "...[truncated]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeForAudit(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// Get recent audit logs for a run
export function getAuditLogsForRun(runId: string): AuditLogEntry[] {
  return auditBuffer.filter((entry) => entry.runId === runId);
}

// Get recent audit logs for a workspace
export function getAuditLogsForWorkspace(
  workspaceId: string,
  limit: number = 100
): AuditLogEntry[] {
  return auditBuffer
    .filter((entry) => entry.workspaceId === workspaceId)
    .slice(-limit);
}
