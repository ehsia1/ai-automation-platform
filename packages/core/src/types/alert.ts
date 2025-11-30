import { z } from "zod";
import { PrioritySchema } from "./item";

export const AlertStatusSchema = z.enum([
  "open",
  "investigating",
  "mitigated",
  "resolved",
]);

export const AlertSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
]);

export const AlertSchema = z.object({
  alert_id: z.string().uuid(),
  workspace_id: z.string(),
  item_id: z.string().uuid(),
  title: z.string(),
  service: z.string().optional(),
  severity: AlertSeveritySchema,
  status: AlertStatusSchema,
  summary: z.string().optional(),
  source_url: z.string().url().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  resolved_at: z.string().datetime().optional(),
  linked_task_ids: z.array(z.string().uuid()).default([]),
});

export type AlertStatus = z.infer<typeof AlertStatusSchema>;
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;
export type Alert = z.infer<typeof AlertSchema>;
