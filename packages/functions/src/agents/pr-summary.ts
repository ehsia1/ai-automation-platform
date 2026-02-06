import type { EventBridgeEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import {
  runAgentLoop,
  buildPRSummaryPrompt,
  initializeLLM,
  type AgentState,
  type AgentEvent,
  type ToolContext,
  type PRSummaryContext,
} from "@ai-automation-platform/core";

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// Event detail type for PR summary requests
interface PRSummaryRequestDetail {
  workspaceId: string;
  runId: string;
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  description: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  files: Array<{
    filename: string;
    status: "added" | "modified" | "removed" | "renamed";
    additions: number;
    deletions: number;
    patch?: string;
  }>;
  fullDiff?: string;
  // If true, post the summary as a comment on the PR
  postComment?: boolean;
}

// Initialize LLM from environment
function initLLM(): void {
  initializeLLM({
    provider: (process.env.LLM_PROVIDER as "ollama" | "anthropic" | "bedrock") || "bedrock",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaModel: process.env.OLLAMA_MODEL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL,
    bedrockRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION,
    bedrockModel: process.env.BEDROCK_MODEL,
  });
}

// Save agent run to DynamoDB
async function saveAgentRun(
  workspaceId: string,
  runId: string,
  state: AgentState,
  context: PRSummaryRequestDetail
): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: Resource.AgentRuns.name,
      Item: {
        workspace_id: workspaceId,
        run_id: runId,
        agent_type: "pr-summary",
        status: state.status,
        input: `PR #${context.pullNumber}: ${context.title}`,
        result: state.result,
        error: state.error,
        iterations: state.iterations,
        tool_call_count: state.toolCallHistory.length,
        tool_calls: state.toolCallHistory,
        messages: state.messages,
        pending_approval: state.pendingApproval,
        context: {
          owner: context.owner,
          repo: context.repo,
          pullNumber: context.pullNumber,
          title: context.title,
          author: context.author,
        },
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
        "tool_calls = :toolCalls, updated_at = :updatedAt",
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
        ":updatedAt": now,
      },
    })
  );
}

export async function handler(
  event: EventBridgeEvent<"pr.summary.requested", PRSummaryRequestDetail>
): Promise<void> {
  console.log("PR Summary Agent triggered:", JSON.stringify(event, null, 2));

  const detail = event.detail;
  const { workspaceId, runId, owner, repo, pullNumber } = detail;

  // Initialize LLM
  initLLM();

  // Build PR summary context
  const prContext: PRSummaryContext = {
    owner: detail.owner,
    repo: detail.repo,
    pullNumber: detail.pullNumber,
    title: detail.title,
    description: detail.description,
    author: detail.author,
    baseBranch: detail.baseBranch,
    headBranch: detail.headBranch,
    files: detail.files,
    fullDiff: detail.fullDiff,
  };

  // Build the prompt with PR details
  const systemPrompt = buildPRSummaryPrompt(prContext);

  // Set up tool context
  const toolContext: ToolContext = {
    workspaceId,
    runId,
  };

  // Agent configuration - PR summary doesn't need many iterations
  // since it's mostly analysis with optional tool use for context
  const config = {
    maxIterations: 5,
    systemPrompt,
    timeoutMs: 60000, // 60 seconds should be enough for summary
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
      case "llm_response":
        console.log("LLM response received, length:", evt.content.length);
        break;
      case "completed":
        console.log("PR Summary completed");
        break;
      case "failed":
        console.error("PR Summary failed:", evt.error);
        break;
    }
  };

  try {
    // The initial prompt just asks the agent to generate the summary
    // The system prompt already contains all the PR details
    const userPrompt = "Generate the PR summary based on the details provided above.";

    // Run the agent loop
    const finalState = await runAgentLoop(userPrompt, config, toolContext, undefined, onEvent);

    // Save the final state
    await saveAgentRun(workspaceId, runId, finalState, detail);

    console.log("PR Summary complete:", {
      status: finalState.status,
      iterations: finalState.iterations,
      toolCalls: finalState.toolCallHistory.length,
      resultLength: finalState.result?.length || 0,
    });

    // If postComment is true and we have a result, post it as a PR comment
    if (detail.postComment && finalState.result && finalState.status === "completed") {
      // The agent could use github tools to post a comment, but for simplicity
      // we can also handle this directly via GitHub API
      console.log("PR Summary result ready for posting:", {
        owner,
        repo,
        pullNumber,
        summaryLength: finalState.result.length,
      });
      // Note: Actual posting would require the github tool or direct API call
      // For now, the summary is saved in DynamoDB and can be retrieved
    }
  } catch (error) {
    console.error("PR Summary error:", error);

    // Save error state
    const errorState: AgentState = {
      status: "failed",
      messages: [],
      iterations: 0,
      toolCallHistory: [],
      error: error instanceof Error ? error.message : String(error),
    };

    await saveAgentRun(workspaceId, runId, errorState, detail);

    throw error;
  }
}
