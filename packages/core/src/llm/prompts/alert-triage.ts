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
  "root_cause": "Most likely root cause based on available information",
  "suggested_actions": ["Array of specific actions to take to resolve this"],
  "investigation_steps": ["Steps to investigate further if root cause is unclear"],
  "summary": "2-3 sentence executive summary for stakeholders",
  "escalation_needed": boolean,
  "estimated_impact": "Description of customer/business impact"
}

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
