import { z } from "zod";

export const ItemSourceSchema = z.enum([
  "datadog",
  "pagerduty",
  "opsgenie",
  "cloudwatch",
  "github",
  "email",
  "calendar",
  "manual",
]);

export const ItemStatusSchema = z.enum([
  "ingested",
  "classified",
  "processed",
  "error",
]);

export const ItemTypeSchema = z.enum([
  "alert",
  "email",
  "calendar_event",
  "pr",
  "other",
]);

export const ModeSchema = z.enum(["engineering", "personal", "shared"]);

export const PrioritySchema = z.enum(["critical", "high", "medium", "low"]);

export const IncomingItemSchema = z.object({
  item_id: z.string().uuid(),
  workspace_id: z.string(),
  source: ItemSourceSchema,
  source_item_id: z.string(),
  received_at: z.string().datetime(),
  raw_payload: z.record(z.string(), z.unknown()),
  metadata: z.object({
    title: z.string().optional(),
    subject: z.string().optional(),
    sender: z.string().optional(),
    service: z.string().optional(),
    severity: z.string().optional(),
    url: z.string().url().optional(),
  }),
  status: ItemStatusSchema,
});

export const ClassifiedItemSchema = IncomingItemSchema.extend({
  item_type: ItemTypeSchema,
  mode: ModeSchema,
  priority: PrioritySchema,
  requires_action: z.boolean(),
  summary: z.string().optional(),
  tags: z.array(z.string()).default([]),
  deadline: z.string().datetime().optional(),
  project_id: z.string().optional(),
  classified_at: z.string().datetime(),
});

export type ItemSource = z.infer<typeof ItemSourceSchema>;
export type ItemStatus = z.infer<typeof ItemStatusSchema>;
export type ItemType = z.infer<typeof ItemTypeSchema>;
export type Mode = z.infer<typeof ModeSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type IncomingItem = z.infer<typeof IncomingItemSchema>;
export type ClassifiedItem = z.infer<typeof ClassifiedItemSchema>;
