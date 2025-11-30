import { z } from "zod";
import { AlertSeveritySchema } from "./alert";

// EventBridge event types
export const EventTypes = {
  INCOMING_ITEM_CREATED: "item.created",
  ITEM_CLASSIFIED: "item.classified",
  ALERT_CREATED: "alert.created",
  TASK_CREATED: "task.created",
  AGENT_RUN_REQUESTED: "agent.run.requested",
  AGENT_RUN_COMPLETED: "agent.run.completed",
  NOTIFICATION_REQUESTED: "notification.requested",
  NOTIFICATION_SENT: "notification.sent",
} as const;

export const IncomingItemCreatedEventSchema = z.object({
  workspace_id: z.string(),
  item_id: z.string().uuid(),
  source: z.string(),
});

export const ItemClassifiedEventSchema = z.object({
  workspace_id: z.string(),
  item_id: z.string().uuid(),
  item_type: z.string(),
  mode: z.string(),
  requires_action: z.boolean(),
});

export const AlertCreatedEventSchema = z.object({
  workspace_id: z.string(),
  alert_id: z.string().uuid(),
  item_id: z.string().uuid(),
  severity: AlertSeveritySchema,
  service: z.string().optional(),
});

export const NotificationRequestedEventSchema = z.object({
  workspace_id: z.string(),
  channel: z.enum(["teams", "email", "sms", "auto"]),
  template: z.string(),
  data: z.record(z.string(), z.unknown()),
  user_id: z.string().optional(),
});

export type IncomingItemCreatedEvent = z.infer<
  typeof IncomingItemCreatedEventSchema
>;
export type ItemClassifiedEvent = z.infer<typeof ItemClassifiedEventSchema>;
export type AlertCreatedEvent = z.infer<typeof AlertCreatedEventSchema>;
export type NotificationRequestedEvent = z.infer<
  typeof NotificationRequestedEventSchema
>;
