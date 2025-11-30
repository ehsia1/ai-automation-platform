import { z } from "zod";

export const AgentKeySchema = z.enum([
  "alert_triage",
  "pr_summary",
  "log_analysis",
  "incident_timeline",
  "daily_digest",
  "task_extractor",
]);

export const AgentRunStatusSchema = z.enum([
  "pending",
  "running",
  "success",
  "error",
]);

export const AgentRunSchema = z.object({
  run_id: z.string().uuid(),
  workspace_id: z.string(),
  agent_key: AgentKeySchema,
  trigger_event: z.string(),
  trigger_id: z.string().optional(), // e.g., alert_id, item_id
  input_snapshot: z.record(z.string(), z.unknown()),
  output: z
    .object({
      summary: z.string().optional(),
      analysis: z.string().optional(),
      suggested_actions: z.array(z.string()).optional(),
      root_cause: z.string().optional(),
      severity_assessment: z.string().optional(),
      raw_response: z.string().optional(),
    })
    .optional(),
  status: AgentRunStatusSchema,
  error_message: z.string().optional(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  duration_ms: z.number().optional(),
});

export type AgentKey = z.infer<typeof AgentKeySchema>;
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
