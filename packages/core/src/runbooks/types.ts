/**
 * Runbook Types - Structured format for automated remediation procedures
 */

export type StepActionType =
  | "query_logs" // Query CloudWatch Logs
  | "check_metrics" // Check CloudWatch Metrics
  | "api_call" // Call external API via integration
  | "github_file" // Read a file from GitHub
  | "shell_command" // Execute shell command (requires approval)
  | "wait" // Wait for a duration
  | "condition" // Conditional branch
  | "notify"; // Send notification

export type StepRiskLevel = "read_only" | "safe_write" | "destructive";

export interface RunbookStep {
  id: string;
  name: string;
  description?: string;
  action: StepActionType;
  risk_level: StepRiskLevel;
  parameters: Record<string, unknown>;
  timeout_seconds?: number; // Max time to wait for step completion
  on_success?: string; // Step ID to go to on success (default: next step)
  on_failure?: string; // Step ID to go to on failure (default: stop)
  continue_on_failure?: boolean; // Whether to continue even if this step fails
  expected_result?: string; // Description of expected outcome for LLM
}

export interface RunbookMetadata {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  service?: string; // Service this runbook applies to
  alert_patterns?: string[]; // Alert patterns that trigger this runbook
  tags?: string[];
  estimated_duration_minutes?: number;
  last_updated?: string;
}

export interface Runbook {
  metadata: RunbookMetadata;
  steps: RunbookStep[];
  variables?: Record<string, unknown>; // Default variable values
}

export interface StepResult {
  step_id: string;
  step_name: string;
  action: StepActionType;
  status: "success" | "failure" | "skipped" | "pending_approval";
  started_at: string;
  completed_at?: string;
  output?: string;
  error?: string;
  approval_id?: string; // If pending approval
}

export interface RunbookExecutionState {
  runbook_id: string;
  execution_id: string;
  status: "running" | "completed" | "failed" | "paused" | "pending_approval";
  started_at: string;
  completed_at?: string;
  current_step_index: number;
  variables: Record<string, unknown>; // Runtime variable values
  step_results: StepResult[];
  error?: string;
}

/**
 * Parse a YAML runbook into a typed Runbook object
 */
export function parseRunbook(yamlContent: string): Runbook {
  // Use dynamic import to avoid bundling issues
  const yaml = require("js-yaml");
  const parsed = yaml.load(yamlContent) as Runbook;

  // Validate required fields
  if (!parsed.metadata?.id || !parsed.metadata?.name) {
    throw new Error("Runbook must have metadata with id and name");
  }

  if (!parsed.steps || parsed.steps.length === 0) {
    throw new Error("Runbook must have at least one step");
  }

  // Validate each step
  for (const step of parsed.steps) {
    if (!step.id || !step.name || !step.action) {
      throw new Error(`Step missing required fields: ${JSON.stringify(step)}`);
    }

    // Validate action type
    const validActions: StepActionType[] = [
      "query_logs",
      "check_metrics",
      "api_call",
      "github_file",
      "shell_command",
      "wait",
      "condition",
      "notify",
    ];
    if (!validActions.includes(step.action)) {
      throw new Error(`Invalid action type: ${step.action}`);
    }

    // Default risk level based on action
    if (!step.risk_level) {
      step.risk_level = getDefaultRiskLevel(step.action);
    }
  }

  return parsed;
}

function getDefaultRiskLevel(action: StepActionType): StepRiskLevel {
  switch (action) {
    case "query_logs":
    case "check_metrics":
    case "github_file":
    case "condition":
      return "read_only";
    case "wait":
    case "notify":
    case "api_call":
      return "safe_write";
    case "shell_command":
      return "destructive";
    default:
      return "safe_write";
  }
}

/**
 * Generate a sample runbook template
 */
export function generateRunbookTemplate(serviceName: string): string {
  return `# Runbook: ${serviceName} Incident Response
metadata:
  id: ${serviceName.toLowerCase().replace(/\s+/g, "-")}-incident-response
  name: "${serviceName} Incident Response"
  description: "Standard incident response procedure for ${serviceName}"
  service: "${serviceName}"
  alert_patterns:
    - "High error rate"
    - "Service down"
  estimated_duration_minutes: 15

steps:
  - id: check_logs
    name: "Check recent error logs"
    description: "Query CloudWatch for recent errors"
    action: query_logs
    risk_level: read_only
    parameters:
      log_group: "/aws/lambda/${serviceName.toLowerCase()}"
      query: "fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20"
      time_range: "30m"

  - id: check_metrics
    name: "Check error rate metrics"
    description: "Verify error rate and latency metrics"
    action: check_metrics
    risk_level: read_only
    parameters:
      namespace: "AWS/Lambda"
      metric_name: "Errors"
      dimensions:
        FunctionName: "${serviceName.toLowerCase()}"
      time_range: "1h"

  - id: notify_team
    name: "Notify on-call team"
    description: "Send alert to Slack channel"
    action: notify
    risk_level: safe_write
    parameters:
      channel: "on-call"
      message: "Investigating ${serviceName} incident"
`;
}
