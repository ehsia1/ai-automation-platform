/**
 * Runbook Executor - Executes structured runbook steps
 */

import type { Tool, ToolResult, ToolContext } from "../tools/types";
import type { ToolDefinition } from "../llm/providers/types";
import type {
  Runbook,
  RunbookStep,
  RunbookExecutionState,
  StepResult,
} from "./types";
import { parseRunbook } from "./types";

const TOOL_NAME = "execute_runbook";

interface ExecuteRunbookArgs {
  runbook_yaml?: string; // Raw YAML content of the runbook
  runbook_url?: string; // URL to fetch runbook from (GitHub)
  variables?: Record<string, unknown>; // Runtime variables to override
  start_from_step?: string; // Step ID to start from (for resuming)
  dry_run?: boolean; // If true, validate but don't execute
}

const definition: ToolDefinition = {
  type: "function",
  function: {
    name: TOOL_NAME,
    description: `Execute a structured runbook for incident remediation.
Runbooks define a series of steps to diagnose and resolve issues.
Each step has a risk level that determines whether it auto-executes or requires approval.
Use this to automate incident response procedures.`,
    parameters: {
      type: "object",
      properties: {
        runbook_yaml: {
          type: "string",
          description: "The YAML content of the runbook to execute",
        },
        runbook_url: {
          type: "string",
          description:
            "URL to fetch runbook from (GitHub raw URL). If provided, takes precedence over runbook_yaml.",
        },
        variables: {
          type: "object",
          description: "Runtime variables to override default values in the runbook",
        },
        start_from_step: {
          type: "string",
          description: "Step ID to start execution from (for resuming interrupted runbooks)",
        },
        dry_run: {
          type: "boolean",
          description: "If true, validates the runbook without executing. Useful for testing.",
        },
      },
      required: [],
    },
  },
};

/**
 * Fetch runbook content from a URL (typically GitHub)
 */
async function fetchRunbookFromUrl(url: string): Promise<string> {
  // Convert GitHub URLs to raw content URLs
  let rawUrl = url;
  if (url.includes("github.com") && !url.includes("raw.githubusercontent.com")) {
    rawUrl = url
      .replace("github.com", "raw.githubusercontent.com")
      .replace("/blob/", "/");
  }

  const response = await fetch(rawUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch runbook: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Execute a single runbook step
 */
async function executeStep(
  step: RunbookStep,
  state: RunbookExecutionState,
  context: ToolContext
): Promise<StepResult> {
  const startedAt = new Date().toISOString();
  const result: StepResult = {
    step_id: step.id,
    step_name: step.name,
    action: step.action,
    status: "success",
    started_at: startedAt,
  };

  try {
    // Check if step requires approval
    if (step.risk_level === "destructive") {
      result.status = "pending_approval";
      result.output = `Step requires approval: ${step.description || step.name}`;
      // In a full implementation, this would create an approval request
      // For now, we mark it as pending and include instructions
      result.error = "Destructive steps require manual approval before execution";
      return result;
    }

    // Execute based on action type
    switch (step.action) {
      case "query_logs": {
        result.output = await executeQueryLogs(step.parameters, state.variables);
        break;
      }
      case "check_metrics": {
        result.output = await executeCheckMetrics(step.parameters, state.variables);
        break;
      }
      case "wait": {
        const seconds = (step.parameters.seconds as number) || 5;
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        result.output = `Waited ${seconds} seconds`;
        break;
      }
      case "notify": {
        result.output = await executeNotify(step.parameters, state.variables);
        break;
      }
      case "api_call": {
        result.output = await executeApiCall(step.parameters, state.variables);
        break;
      }
      case "github_file": {
        result.output = await executeGitHubFile(step.parameters, state.variables);
        break;
      }
      case "condition": {
        result.output = await executeCondition(step.parameters, state);
        break;
      }
      case "shell_command": {
        // Shell commands are always destructive - should not reach here
        result.status = "pending_approval";
        result.output = "Shell commands require approval";
        break;
      }
      default:
        result.status = "failure";
        result.error = `Unknown action type: ${step.action}`;
    }

    result.completed_at = new Date().toISOString();
  } catch (error) {
    result.status = "failure";
    result.error = error instanceof Error ? error.message : String(error);
    result.completed_at = new Date().toISOString();
  }

  return result;
}

/**
 * Action implementations
 */

async function executeQueryLogs(
  params: Record<string, unknown>,
  variables: Record<string, unknown>
): Promise<string> {
  const logGroup = interpolateVariables(params.log_group as string, variables);
  const query = interpolateVariables(params.query as string, variables);
  const timeRange = params.time_range as string || "1h";

  // In a full implementation, this would call the CloudWatch logs tool
  // For now, return a formatted message describing what would be executed
  return `[CloudWatch Logs Query]
Log Group: ${logGroup}
Query: ${query}
Time Range: ${timeRange}

Note: This would execute the cloudwatch_query_logs tool in full implementation.`;
}

async function executeCheckMetrics(
  params: Record<string, unknown>,
  variables: Record<string, unknown>
): Promise<string> {
  const namespace = interpolateVariables(params.namespace as string, variables);
  const metricName = interpolateVariables(params.metric_name as string, variables);
  const dimensions = params.dimensions as Record<string, string> || {};
  const timeRange = params.time_range as string || "1h";

  return `[CloudWatch Metrics Check]
Namespace: ${namespace}
Metric: ${metricName}
Dimensions: ${JSON.stringify(dimensions)}
Time Range: ${timeRange}

Note: This would execute the cloudwatch_get_metrics tool in full implementation.`;
}

async function executeNotify(
  params: Record<string, unknown>,
  variables: Record<string, unknown>
): Promise<string> {
  const channel = interpolateVariables(params.channel as string, variables);
  const message = interpolateVariables(params.message as string, variables);

  return `[Notification Sent]
Channel: ${channel}
Message: ${message}

Note: This would send a notification via the configured notification provider.`;
}

async function executeApiCall(
  params: Record<string, unknown>,
  variables: Record<string, unknown>
): Promise<string> {
  const integration = params.integration as string;
  const operation = params.operation as string;
  const apiParams = params.params as Record<string, unknown> || {};

  return `[API Call]
Integration: ${integration}
Operation: ${operation}
Parameters: ${JSON.stringify(apiParams)}

Note: This would execute the api_call tool in full implementation.`;
}

async function executeGitHubFile(
  params: Record<string, unknown>,
  variables: Record<string, unknown>
): Promise<string> {
  const repo = interpolateVariables(params.repo as string, variables);
  const path = interpolateVariables(params.path as string, variables);

  return `[GitHub File Read]
Repository: ${repo}
Path: ${path}

Note: This would execute the github_get_file tool in full implementation.`;
}

async function executeCondition(
  params: Record<string, unknown>,
  state: RunbookExecutionState
): Promise<string> {
  const expression = params.expression as string;
  const trueStep = params.true_step as string;
  const falseStep = params.false_step as string;

  // Simple condition evaluation based on previous step results
  // In a full implementation, this would support more complex expressions
  const lastResult = state.step_results[state.step_results.length - 1];
  const condition = lastResult?.status === "success";

  return `[Condition Evaluated]
Expression: ${expression}
Result: ${condition}
Next Step: ${condition ? trueStep : falseStep}`;
}

/**
 * Interpolate variables in a string
 */
function interpolateVariables(
  template: string,
  variables: Record<string, unknown>
): string {
  if (!template) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return variables[varName] !== undefined ? String(variables[varName]) : match;
  });
}

/**
 * Main execution function
 */
async function execute(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const {
    runbook_yaml,
    runbook_url,
    variables = {},
    start_from_step,
    dry_run = false,
  } = args as ExecuteRunbookArgs;

  // Get runbook content
  let yamlContent: string;
  try {
    if (runbook_url) {
      yamlContent = await fetchRunbookFromUrl(runbook_url);
    } else if (runbook_yaml) {
      yamlContent = runbook_yaml;
    } else {
      return {
        success: false,
        output: "",
        error: "Either runbook_yaml or runbook_url must be provided",
      };
    }
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Failed to fetch runbook: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Parse runbook
  let runbook: Runbook;
  try {
    runbook = parseRunbook(yamlContent);
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Failed to parse runbook: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Dry run - just validate and return structure
  if (dry_run) {
    const lines: string[] = [];
    lines.push(`# Runbook Validation: ${runbook.metadata.name}`);
    lines.push("");
    lines.push(`**ID:** ${runbook.metadata.id}`);
    lines.push(`**Description:** ${runbook.metadata.description}`);
    if (runbook.metadata.service) {
      lines.push(`**Service:** ${runbook.metadata.service}`);
    }
    lines.push(`**Steps:** ${runbook.steps.length}`);
    lines.push("");
    lines.push("## Steps");
    for (const step of runbook.steps) {
      const riskIcon =
        step.risk_level === "destructive"
          ? "[DESTRUCTIVE]"
          : step.risk_level === "safe_write"
            ? "[WRITE]"
            : "[READ]";
      lines.push(`${riskIcon} **${step.name}** (${step.action})`);
      if (step.description) {
        lines.push(`   ${step.description}`);
      }
    }
    lines.push("");
    lines.push("Runbook validation successful. Ready for execution.");

    return {
      success: true,
      output: lines.join("\n"),
      metadata: {
        runbook_id: runbook.metadata.id,
        step_count: runbook.steps.length,
        dry_run: true,
      },
    };
  }

  // Initialize execution state
  const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const state: RunbookExecutionState = {
    runbook_id: runbook.metadata.id,
    execution_id: executionId,
    status: "running",
    started_at: new Date().toISOString(),
    current_step_index: 0,
    variables: { ...runbook.variables, ...variables },
    step_results: [],
  };

  // Find start step if specified
  if (start_from_step) {
    const startIndex = runbook.steps.findIndex((s) => s.id === start_from_step);
    if (startIndex === -1) {
      return {
        success: false,
        output: "",
        error: `Step not found: ${start_from_step}`,
      };
    }
    state.current_step_index = startIndex;
  }

  // Execute steps
  const lines: string[] = [];
  lines.push(`# Runbook Execution: ${runbook.metadata.name}`);
  lines.push("");
  lines.push(`**Execution ID:** ${executionId}`);
  lines.push(`**Started:** ${state.started_at}`);
  lines.push("");

  for (let i = state.current_step_index; i < runbook.steps.length; i++) {
    const step = runbook.steps[i];
    state.current_step_index = i;

    lines.push(`## Step ${i + 1}: ${step.name}`);
    lines.push(`Action: ${step.action} | Risk: ${step.risk_level}`);
    lines.push("");

    const result = await executeStep(step, state, context);
    state.step_results.push(result);

    // Format result
    const statusIcon =
      result.status === "success"
        ? "[SUCCESS]"
        : result.status === "pending_approval"
          ? "[PENDING APPROVAL]"
          : result.status === "skipped"
            ? "[SKIPPED]"
            : "[FAILED]";

    lines.push(`${statusIcon} ${result.step_name}`);
    if (result.output) {
      lines.push("```");
      lines.push(result.output);
      lines.push("```");
    }
    if (result.error) {
      lines.push(`Error: ${result.error}`);
    }
    lines.push("");

    // Check if we need to stop
    if (result.status === "failure" && !step.continue_on_failure) {
      state.status = "failed";
      state.error = `Step failed: ${step.name}`;
      break;
    }

    if (result.status === "pending_approval") {
      state.status = "pending_approval";
      lines.push(
        `Execution paused. Step "${step.name}" requires approval before continuing.`
      );
      break;
    }
  }

  // Finalize state
  if (state.status === "running") {
    state.status = "completed";
  }
  state.completed_at = new Date().toISOString();

  // Summary
  lines.push("---");
  lines.push("## Summary");
  lines.push(`**Status:** ${state.status}`);
  lines.push(`**Duration:** ${calculateDuration(state.started_at, state.completed_at)}`);
  lines.push(
    `**Steps Completed:** ${state.step_results.filter((r) => r.status === "success").length}/${runbook.steps.length}`
  );

  const hasFailures = state.step_results.some((r) => r.status === "failure");
  const hasPending = state.step_results.some((r) => r.status === "pending_approval");

  return {
    success: !hasFailures,
    output: lines.join("\n"),
    metadata: {
      execution_id: executionId,
      runbook_id: runbook.metadata.id,
      status: state.status,
      steps_completed: state.step_results.filter((r) => r.status === "success").length,
      steps_total: runbook.steps.length,
      pending_approval: hasPending,
    },
  };
}

function calculateDuration(start: string, end?: string): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const durationMs = endMs - startMs;

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  } else if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

export const executeRunbookTool: Tool = {
  name: TOOL_NAME,
  description: definition.function.description,
  riskTier: "safe_write", // Overall tool is safe_write; individual steps may require approval
  definition,
  execute,
};
