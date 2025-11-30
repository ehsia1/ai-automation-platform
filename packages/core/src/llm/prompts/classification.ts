import type { LLMMessage } from "../providers/types";

export interface ClassificationInput {
  source: string;
  title?: string;
  subject?: string;
  body?: string;
  sender?: string;
  service?: string;
  rawSeverity?: string;
  url?: string;
}

export interface ClassificationResult {
  item_type: "alert" | "email" | "calendar_event" | "pr" | "other";
  mode: "engineering" | "personal" | "shared";
  priority: "critical" | "high" | "medium" | "low";
  requires_action: boolean;
  summary: string;
  suggested_actions: string[];
  service?: string;
  tags: string[];
}

const SYSTEM_PROMPT = `You are an AI assistant that classifies incoming items for a unified automation platform.
Your job is to analyze the item and provide structured classification data.

You MUST respond with valid JSON only, no other text.

The JSON schema you must follow:
{
  "item_type": "alert" | "email" | "calendar_event" | "pr" | "other",
  "mode": "engineering" | "personal" | "shared",
  "priority": "critical" | "high" | "medium" | "low",
  "requires_action": boolean,
  "summary": "1-2 sentence summary of what this item is about",
  "suggested_actions": ["array of recommended next steps"],
  "service": "affected service name if applicable",
  "tags": ["relevant", "tags"]
}

Classification guidelines:
- item_type: Use "alert" for monitoring alerts (Datadog, CloudWatch, PagerDuty), "email" for emails, "pr" for GitHub PRs, "calendar_event" for calendar items
- mode: Use "engineering" for DevOps/engineering items, "personal" for personal life items (wedding, school, bills), "shared" for ambiguous items
- priority:
  - "critical" = immediate attention needed, service down or major impact
  - "high" = should be addressed soon, potential customer impact
  - "medium" = normal priority, no immediate urgency
  - "low" = informational, can be addressed when convenient
- requires_action: true if someone needs to do something about this item
- service: Extract the service/component name from alerts if present`;

export function buildClassificationPrompt(
  input: ClassificationInput
): LLMMessage[] {
  const userContent = `Please classify this incoming item:

Source: ${input.source}
${input.title ? `Title: ${input.title}` : ""}
${input.subject ? `Subject: ${input.subject}` : ""}
${input.sender ? `Sender: ${input.sender}` : ""}
${input.service ? `Service: ${input.service}` : ""}
${input.rawSeverity ? `Original Severity: ${input.rawSeverity}` : ""}
${input.url ? `URL: ${input.url}` : ""}

Body/Content:
${input.body || "(no content)"}

Respond with JSON only.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
