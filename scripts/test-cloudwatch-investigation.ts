/**
 * Test script for CloudWatch Logs investigation flow
 * Tests the agent's ability to query real CloudWatch logs and find issues
 *
 * Run with: npx tsx scripts/test-cloudwatch-investigation.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { runAgentLoop, type AgentConfig } from "../packages/core/src/agent/loop.js";
import { buildInvestigationPrompt } from "../packages/core/src/agent/prompts/devops-investigator.js";
// Tools auto-register on import via index.ts
import "../packages/core/src/tools/index.js";

const LOG_GROUP = "/ai-automation-platform/test-service";

async function main() {
  console.log("=".repeat(80));
  console.log("CloudWatch Logs Investigation Test");
  console.log("=".repeat(80));
  console.log(`\nTarget Log Group: ${LOG_GROUP}\n`);

  const alertContext = {
    service: "calculator-service",
    errorMessage: "ZeroDivisionError detected in production",
    logGroup: LOG_GROUP,
  };

  const config: AgentConfig = {
    maxIterations: 8,
    systemPrompt: buildInvestigationPrompt(alertContext),
  };

  const input = `Investigate the ZeroDivisionError issues in the calculator-service.

IMPORTANT: Use the cloudwatch_query_logs tool to query the log group "${LOG_GROUP}".

Steps:
1. Use cloudwatch_query_logs with the log_group "${LOG_GROUP}" and query for ERROR messages
2. Analyze the error patterns and root cause from the log results
3. Identify which function/file is causing the issue based on the log data
4. Summarize your findings with specific evidence from the logs

Example query to use: "fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20"

Use start_time: "24h" since the errors may have occurred earlier today.`;

  console.log("Investigation Prompt:", input);
  console.log("\n" + "=".repeat(80) + "\n");

  const toolCallsSummary: { name: string; success: boolean; output: string }[] = [];

  try {
    const state = await runAgentLoop(
      input,
      config,
      { runId: "cloudwatch-test", workspaceId: "local" },
      undefined,
      async (event) => {
        switch (event.type) {
          case "iteration_start":
            console.log(`\n--- Iteration ${event.iteration} ---`);
            break;
          case "tool_call":
            console.log(`\n🔧 Tool call: ${event.toolName}`);
            console.log("   Args:", JSON.stringify(event.args, null, 2).split("\n").join("\n   "));
            break;
          case "tool_result":
            const outputPreview = event.result.output.substring(0, 800);
            console.log(`   ✅ Result (${event.result.success ? "success" : "error"}): ${outputPreview}${event.result.output.length > 800 ? "..." : ""}`);
            toolCallsSummary.push({
              name: event.toolName,
              success: event.result.success,
              output: event.result.output.substring(0, 200),
            });
            break;
          case "llm_response":
            console.log("\n💬 LLM Response:");
            console.log(event.content);
            break;
          case "completed":
            console.log("\n\n" + "=".repeat(80));
            console.log("✅ INVESTIGATION COMPLETE");
            console.log("=".repeat(80));
            break;
          case "failed":
            console.log("\n❌ INVESTIGATION FAILED:", event.error);
            break;
          case "approval_required":
            console.log(`\n⚠️ Approval required for: ${event.toolName}`);
            break;
        }
      }
    );

    // Final summary
    console.log("\n" + "=".repeat(80));
    console.log("TEST RESULTS");
    console.log("=".repeat(80));
    console.log("\nAgent State:");
    console.log("  Status:", state.status);
    console.log("  Iterations:", state.iterations);
    console.log("  Tool calls:", state.toolCallHistory.length);

    // Verify the agent used CloudWatch tools
    const cloudwatchCalls = state.toolCallHistory.filter(
      (tc) => tc.toolName.includes("cloudwatch")
    );
    console.log("\nCloudWatch Tool Usage:");
    console.log("  CloudWatch calls:", cloudwatchCalls.length);

    for (const tc of cloudwatchCalls) {
      console.log(`    - ${tc.toolName}: ${tc.result.success ? "✅" : "❌"}`);
    }

    // Validate test passed
    const testPassed =
      cloudwatchCalls.length > 0 &&
      cloudwatchCalls.every((tc) => tc.result.success) &&
      state.status === "completed";

    console.log("\n" + "=".repeat(80));
    if (testPassed) {
      console.log("✅ TEST PASSED: Agent successfully queried CloudWatch logs and completed investigation");
    } else {
      console.log("❌ TEST FAILED:");
      if (cloudwatchCalls.length === 0) {
        console.log("   - Agent did not use CloudWatch tools");
      }
      if (!cloudwatchCalls.every((tc) => tc.result.success)) {
        console.log("   - Some CloudWatch calls failed");
      }
      if (state.status !== "completed") {
        console.log(`   - Agent status: ${state.status} (expected: completed)`);
      }
    }
    console.log("=".repeat(80));

    // Check if agent found the ZeroDivisionError
    const finalResult = state.result || "";
    if (finalResult.toLowerCase().includes("zerodivision") ||
        finalResult.toLowerCase().includes("division by zero") ||
        finalResult.toLowerCase().includes("divide")) {
      console.log("\n✅ Agent correctly identified the ZeroDivisionError issue");
    } else {
      console.log("\n⚠️ Agent may not have identified the specific error");
    }

    return testPassed;
  } catch (error) {
    console.error("\n❌ Test failed with error:", error);
    return false;
  }
}

main()
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
