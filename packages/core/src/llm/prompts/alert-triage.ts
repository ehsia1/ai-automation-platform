import type { LLMMessage } from "../providers/types";
import type { Alert } from "../../types";

export interface AlertTriageInput {
  alert: Alert;
  itemSummary?: string;
  rawPayload?: Record<string, unknown>;
}

export interface AlertTriageResult {
  severity_assessment: string;
  root_cause: string;
  suggested_actions: string[];
  investigation_steps: string[];
  summary: string;
  escalation_needed: boolean;
  estimated_impact: string;
}

const SYSTEM_PROMPT = `You are an expert on-call engineer assistant. Your job is to analyze alerts and provide actionable triage information.

You MUST respond with valid JSON only, no other text.

The JSON schema you must follow:
{
  "severity_assessment": "Your assessment of the actual severity and why",
  "root_cause": "Technical root cause analysis - be specific about WHY this is happening",
  "suggested_actions": ["Array of specific actions to take to resolve this"],
  "investigation_steps": ["Steps to investigate further if root cause is unclear"],
  "summary": "2-3 sentence executive summary for stakeholders",
  "escalation_needed": boolean,
  "estimated_impact": "Description of customer/business impact"
}

## Root Cause Analysis Guidelines

When analyzing root cause, consider these common categories and be SPECIFIC:

**For CPU/Memory issues**: traffic spike, memory leak, inefficient code, missing garbage collection, resource exhaustion, thread pool saturation
**For Database issues**: connection pool exhaustion, slow queries, deadlocks, missing indexes, connection leaks, query timeout
**For Network/API issues**: downstream dependency failure, timeout, rate limiting, DNS issues, certificate problems
**For Deployment issues**: configuration error, health check failure, startup failure, dependency mismatch, rollback needed
**For Security issues**: brute force attack, credential stuffing, DDoS, unauthorized access attempt

Always mention the TECHNICAL mechanism (e.g., "connection pool exhausted due to leak" not just "database issue").

## Suggested Actions Guidelines

Use specific ACTION VERBS:
- **Immediate**: restart, scale, rollback, block, isolate, failover
- **Investigation**: investigate, check, query, review, analyze, trace
- **Remediation**: fix, patch, update, increase, decrease, configure, rotate
- **Monitoring**: monitor, alert, track, observe

Be specific: "Scale up to 10 instances" not "consider scaling".

## Summary Guidelines

The summary should include:
1. WHAT is happening (the symptom)
2. WHY it's happening (brief root cause)
3. IMPACT on users/business

Guidelines:
- Be specific and actionable in your suggestions
- Prioritize actions that are most likely to resolve or mitigate the issue
- Consider common failure modes for the type of alert
- If escalation is needed, explain why in the summary
- Keep suggested_actions to 3-5 most important items
- Use technical but clear language`;

export function buildAlertTriagePrompt(
  input: AlertTriageInput
): LLMMessage[] {
  const { alert, itemSummary, rawPayload } = input;

  const userContent = `Please analyze this alert and provide triage guidance:

Alert Details:
- Title: ${alert.title}
- Service: ${alert.service || "Unknown"}
- Severity: ${alert.severity}
- Status: ${alert.status}
- Created: ${alert.created_at}
${alert.source_url ? `- Source URL: ${alert.source_url}` : ""}

${itemSummary ? `Classification Summary: ${itemSummary}` : ""}

${
  rawPayload
    ? `Raw Alert Data:
\`\`\`json
${JSON.stringify(rawPayload, null, 2)}
\`\`\``
    : ""
}

Provide your triage analysis in JSON format.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
