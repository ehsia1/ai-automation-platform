import type { EventBridgeEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import {
  runAgentLoop,
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
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

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
  alertId?: string,
  context?: InvestigationRequestDetail["context"]
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
        messages: state.messages, // Save messages for resume
        pending_approval: state.pendingApproval,
        alert_id: alertId,
        context, // Save context for rebuilding prompt on resume
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

    // Save the final state (include context for resume)
    await saveAgentRun(workspaceId, runId, finalState, prompt, alertId, context);

    console.log("Investigation complete:", {
      status: finalState.status,
      iterations: finalState.iterations,
      toolCalls: finalState.toolCallHistory.length,
    });

    // If paused for approval, send notification email
    if (finalState.status === "paused" && finalState.pendingApproval) {
      console.log("Agent paused - waiting for approval:", finalState.pendingApproval);

      const alertEmailTo = process.env.ALERT_EMAIL_TO;
      const alertEmailFrom = process.env.ALERT_EMAIL_FROM || "onboarding@resend.dev";
      const apiUrl = Resource.Api.url;

      if (alertEmailTo && apiUrl) {
        // Calculate expiration (30 minutes from request)
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
          console.log("Approval notification email sent to:", alertEmailTo);
        } catch (emailError) {
          console.error("Failed to send approval email:", emailError);
          // Don't throw - the agent run is still saved, just notification failed
        }
      } else {
        console.warn("Cannot send approval email: ALERT_EMAIL_TO or API URL not configured");
      }
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

    await saveAgentRun(workspaceId, runId, errorState, prompt, alertId, context);

    throw error;
  }
}
