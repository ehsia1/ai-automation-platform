import type { EventBridgeEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import {
  resumeAgentAfterApproval,
  buildInvestigationPrompt,
  initializeLLM,
  sendApprovalEmail,
  type AgentState,
  type AgentEvent,
  type ToolContext,
  type ApprovalEmailData,
} from "@ai-automation-platform/core";

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Event detail type for approval decisions
interface ApprovalDecidedDetail {
  workspaceId: string;
  runId: string;
  approved: boolean;
  reason?: string;
  decidedBy: string;
  decidedAt: string;
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

// Update agent run in DynamoDB
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
  event: EventBridgeEvent<"approval.decided", ApprovalDecidedDetail>
): Promise<void> {
  console.log("=".repeat(60));
  console.log("AGENT RESUME HANDLER TRIGGERED");
  console.log("=".repeat(60));
  console.log("Event:", JSON.stringify(event, null, 2));

  const { workspaceId, runId, approved, reason, decidedBy } = event.detail;

  // Get the agent run from DynamoDB
  const getResult = await docClient.send(
    new GetCommand({
      TableName: Resource.AgentRuns.name,
      Key: {
        workspace_id: workspaceId,
        run_id: runId,
      },
    })
  );

  if (!getResult.Item) {
    console.error("Agent run not found:", runId);
    return;
  }

  const agentRun = getResult.Item;

  // Verify the run is paused and has pending approval
  if (agentRun.status !== "paused" || !agentRun.pending_approval) {
    console.log("Agent run is not waiting for approval:", {
      status: agentRun.status,
      hasPendingApproval: !!agentRun.pending_approval,
    });
    return;
  }

  console.log(`Resuming agent run ${runId} - approved: ${approved}`);

  // Initialize LLM
  initLLM();

  // Reconstruct the agent state from saved data
  const savedState: AgentState = {
    status: "paused",
    messages: agentRun.messages || [],
    iterations: agentRun.iterations || 0,
    toolCallHistory: agentRun.tool_calls || [],
    pendingApproval: {
      toolCallId: agentRun.pending_approval.toolCallId,
      toolName: agentRun.pending_approval.toolName,
      toolArgs: agentRun.pending_approval.toolArgs,
      requestedAt: agentRun.pending_approval.requestedAt,
    },
  };

  // Set up tool context
  const toolContext: ToolContext = {
    workspaceId,
    runId,
  };

  // Agent configuration
  const config = {
    maxIterations: 15,
    systemPrompt: buildInvestigationPrompt(agentRun.context),
    timeoutMs: 110000,
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
        console.log("Agent completed");
        break;
      case "failed":
        console.error("Agent failed:", evt.error);
        break;
    }
  };

  try {
    // Resume the agent with the approval decision
    const finalState = await resumeAgentAfterApproval(
      savedState,
      approved,
      config,
      toolContext,
      onEvent
    );

    // Save the updated state
    await updateAgentRun(workspaceId, runId, finalState);

    console.log("Agent resume complete:", {
      status: finalState.status,
      iterations: finalState.iterations,
      toolCalls: finalState.toolCallHistory.length,
    });

    // If paused again for another approval, send notification
    if (finalState.status === "paused" && finalState.pendingApproval) {
      console.log("Agent paused again - waiting for approval:", finalState.pendingApproval);

      const alertEmailTo = process.env.ALERT_EMAIL_TO;
      const alertEmailFrom = process.env.ALERT_EMAIL_FROM || "onboarding@resend.dev";
      const apiUrl = Resource.Api.url;

      if (alertEmailTo && apiUrl) {
        const requestedAt = finalState.pendingApproval.requestedAt;
        const expiresAt = new Date(
          new Date(requestedAt).getTime() + 30 * 60 * 1000
        ).toISOString();

        const approvalEmailData: ApprovalEmailData = {
          runId,
          workspaceId,
          toolName: finalState.pendingApproval.toolName,
          toolArgs: finalState.pendingApproval.toolArgs,
          requestedAt,
          expiresAt,
          approveUrl: `${apiUrl}approvals/${runId}/approve?workspace_id=${workspaceId}`,
          rejectUrl: `${apiUrl}approvals/${runId}/reject?workspace_id=${workspaceId}`,
        };

        try {
          await sendApprovalEmail(
            { to: alertEmailTo, from: alertEmailFrom },
            approvalEmailData
          );
          console.log("Approval notification email sent");
        } catch (emailError) {
          console.error("Failed to send approval email:", emailError);
        }
      }
    }
  } catch (error) {
    console.error("Agent resume error:", error);

    // Update with error state
    const errorState: AgentState = {
      status: "failed",
      messages: savedState.messages,
      iterations: savedState.iterations,
      toolCallHistory: savedState.toolCallHistory,
      error: error instanceof Error ? error.message : String(error),
    };

    await updateAgentRun(workspaceId, runId, errorState);

    throw error;
  }
}
