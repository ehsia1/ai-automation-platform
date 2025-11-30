import type { EventBridgeEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import {
  runAgentLoop,
  buildInvestigationPrompt,
  initializeLLM,
  type AgentState,
  type AgentEvent,
  type ToolContext,
} from "@ai-automation-platform/core";

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Event detail type for investigation requests
interface InvestigationRequestDetail {
  workspaceId: string;
  runId: string;
  prompt: string;
  alertId?: string;
  context?: {
    service?: string;
    errorMessage?: string;
    logGroup?: string;
    timeRange?: string;
  };
}

// Initialize LLM from environment
function initLLM(): void {
  initializeLLM({
    provider: (process.env.LLM_PROVIDER as "ollama" | "anthropic") || "ollama",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaModel: process.env.OLLAMA_MODEL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL,
  });
}

// Save agent run to DynamoDB
async function saveAgentRun(
  workspaceId: string,
  runId: string,
  state: AgentState,
  input: string,
  alertId?: string
): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: Resource.AgentRuns.name,
      Item: {
        workspace_id: workspaceId,
        run_id: runId,
        agent_type: "devops-investigator",
        status: state.status,
        input,
        result: state.result,
        error: state.error,
        iterations: state.iterations,
        tool_call_count: state.toolCallHistory.length,
        tool_calls: state.toolCallHistory,
        pending_approval: state.pendingApproval,
        alert_id: alertId,
        created_at: now,
        updated_at: now,
      },
    })
  );
}

// Update agent run status
async function updateAgentRun(
  workspaceId: string,
  runId: string,
  state: AgentState
): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: Resource.AgentRuns.name,
      Key: {
        workspace_id: workspaceId,
        run_id: runId,
      },
      UpdateExpression:
        "SET #status = :status, #result = :result, #error = :error, " +
        "iterations = :iterations, tool_call_count = :toolCount, " +
        "tool_calls = :toolCalls, pending_approval = :pendingApproval, " +
        "updated_at = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
        "#result": "result",
        "#error": "error",
      },
      ExpressionAttributeValues: {
        ":status": state.status,
        ":result": state.result || null,
        ":error": state.error || null,
        ":iterations": state.iterations,
        ":toolCount": state.toolCallHistory.length,
        ":toolCalls": state.toolCallHistory,
        ":pendingApproval": state.pendingApproval || null,
        ":updatedAt": now,
      },
    })
  );
}

export async function handler(
  event: EventBridgeEvent<"investigation.requested", InvestigationRequestDetail>
): Promise<void> {
  console.log("DevOps Investigator triggered:", JSON.stringify(event, null, 2));

  const { workspaceId, runId, prompt, alertId, context } = event.detail;

  // Initialize LLM
  initLLM();

  // Build investigation prompt with context
  const systemPrompt = buildInvestigationPrompt(context);

  // Set up tool context
  const toolContext: ToolContext = {
    workspaceId,
    runId,
  };

  // Agent configuration
  const config = {
    maxIterations: 15,
    systemPrompt,
    timeoutMs: 110000, // 110 seconds (leaving buffer for Lambda 120s timeout)
  };

  // Event handler to log progress
  const onEvent = async (evt: AgentEvent): Promise<void> => {
    switch (evt.type) {
      case "iteration_start":
        console.log(`Starting iteration ${evt.iteration}`);
        break;
      case "tool_call":
        console.log(`Calling tool: ${evt.toolName}`, evt.args);
        break;
      case "tool_result":
        console.log(
          `Tool result (${evt.toolName}):`,
          evt.result.success ? "success" : "failed"
        );
        break;
      case "approval_required":
        console.log(`Approval required for: ${evt.toolName}`, evt.args);
        break;
      case "llm_response":
        console.log("LLM response:", evt.content.substring(0, 200) + "...");
        break;
      case "completed":
        console.log("Investigation completed");
        break;
      case "failed":
        console.error("Investigation failed:", evt.error);
        break;
    }
  };

  try {
    // Run the agent loop
    const finalState = await runAgentLoop(prompt, config, toolContext, undefined, onEvent);

    // Save the final state
    await saveAgentRun(workspaceId, runId, finalState, prompt, alertId);

    console.log("Investigation complete:", {
      status: finalState.status,
      iterations: finalState.iterations,
      toolCalls: finalState.toolCallHistory.length,
    });

    // If paused for approval, we need to handle that
    if (finalState.status === "paused" && finalState.pendingApproval) {
      console.log("Agent paused - waiting for approval:", finalState.pendingApproval);
      // TODO: Send notification for approval
    }
  } catch (error) {
    console.error("Investigation error:", error);

    // Save error state
    const errorState: AgentState = {
      status: "failed",
      messages: [],
      iterations: 0,
      toolCallHistory: [],
      error: error instanceof Error ? error.message : String(error),
    };

    await saveAgentRun(workspaceId, runId, errorState, prompt, alertId);

    throw error;
  }
}
