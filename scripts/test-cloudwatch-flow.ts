/**
 * Full end-to-end test for the DevOps Investigator agent
 * Tests: CloudWatch logs → GitHub code search → PR creation
 *
 * Prerequisites:
 * 1. Run `npx tsx scripts/seed-test-logs.ts` to populate test logs
 * 2. Ensure AWS credentials are configured
 * 3. Ensure GITHUB_TOKEN is set in .env
 *
 * Run with: npx tsx scripts/test-cloudwatch-flow.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { runAgentLoop, type AgentConfig } from "../packages/core/src/agent/loop.js";
import { buildInvestigationPrompt } from "../packages/core/src/agent/prompts/devops-investigator.js";
// Tools auto-register on import via index.ts
import "../packages/core/src/tools/index.js";

const LOG_GROUP = "/ai-automation-platform/test-service";
const TEST_REPO = "ehsia1/ai-oncall-test";

async function main() {
  console.log("=" .repeat(80));
  console.log("🚀 DevOps Investigator - Full Flow Test");
  console.log("=" .repeat(80));
  console.log("\nTest scenario: Datadog alert for ZeroDivisionError");
  console.log(`Log group: ${LOG_GROUP}`);
  console.log(`Target repo: ${TEST_REPO}`);
  console.log("\n");

  // Build the alert context (simulating what would come from a Datadog webhook)
  const alertContext = {
    service: "calculator-service",
    errorMessage: "ZeroDivisionError: division by zero",
    logGroup: LOG_GROUP,
    timeRange: "1h",
  };

  const config: AgentConfig = {
    maxIterations: 15, // Allow more iterations for full flow
    systemPrompt: buildInvestigationPrompt(alertContext),
  };

  // The investigation prompt - simulating a Datadog alert triggering investigation
  const input = `
🚨 ALERT: Datadog detected elevated error rate in calculator-service

Alert Details:
- Service: calculator-service
- Error: ZeroDivisionError: division by zero
- Time: Last hour
- Frequency: 5+ occurrences

Please investigate this issue:

1. First, query CloudWatch logs at "${LOG_GROUP}" to understand the error pattern
   - Look for ERROR level logs
   - Find the stack trace and correlation IDs
   - Identify when the errors started

2. Then search the GitHub repo "${TEST_REPO}" for the buggy code
   - Find the calculator.py file with the divide function
   - Read the full file content

3. Diagnose the root cause based on logs + code

4. Create a PR to fix the bug
   - The fix should handle division by zero gracefully
   - Include a descriptive PR title and body
`.trim();

  console.log("📋 Investigation Input:");
  console.log("-".repeat(40));
  console.log(input);
  console.log("-".repeat(40));
  console.log("\n");

  const state = await runAgentLoop(
    input,
    config,
    { runId: `test-cloudwatch-${Date.now()}`, workspaceId: "local" },
    undefined,
    async (event) => {
      switch (event.type) {
        case "iteration_start":
          console.log(`\n${"=".repeat(60)}`);
          console.log(`📍 Iteration ${event.iteration}`);
          console.log("=".repeat(60));
          break;

        case "tool_call":
          console.log(`\n🔧 Tool: ${event.toolName}`);
          // Pretty print args with truncation for long values
          const prettyArgs = Object.entries(event.args).map(([k, v]) => {
            const strVal = typeof v === "string" ? v : JSON.stringify(v);
            const truncated = strVal.length > 200 ? strVal.substring(0, 200) + "..." : strVal;
            return `   ${k}: ${truncated}`;
          });
          console.log(prettyArgs.join("\n"));
          break;

        case "tool_result":
          const status = event.result.success ? "✅" : "❌";
          const preview = event.result.output.substring(0, 300);
          console.log(`${status} Result: ${preview}${event.result.output.length > 300 ? "..." : ""}`);
          break;

        case "llm_response":
          console.log("\n💬 Agent:");
          // Truncate very long responses
          const content = event.content.length > 500
            ? event.content.substring(0, 500) + "\n... [truncated]"
            : event.content;
          console.log(content);
          break;

        case "completed":
          console.log("\n" + "=".repeat(80));
          console.log("✅ INVESTIGATION COMPLETE");
          console.log("=".repeat(80));
          console.log("\n📝 Final Summary:\n");
          console.log(event.result);
          break;

        case "failed":
          console.log("\n" + "=".repeat(80));
          console.log("❌ INVESTIGATION FAILED");
          console.log("=".repeat(80));
          console.log("Error:", event.error);
          break;

        case "approval_required":
          console.log(`\n⚠️ APPROVAL REQUIRED for: ${event.toolName}`);
          console.log("Args:", JSON.stringify(event.args, null, 2));
          break;
      }
    }
  );

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 Test Results Summary");
  console.log("=".repeat(80));
  console.log(`Status: ${state.status}`);
  console.log(`Iterations: ${state.iterations}`);
  console.log(`Total tool calls: ${state.toolCallHistory.length}`);

  // Group tool calls by name
  const toolCounts: Record<string, { success: number; failed: number }> = {};
  for (const tc of state.toolCallHistory) {
    if (!toolCounts[tc.toolName]) {
      toolCounts[tc.toolName] = { success: 0, failed: 0 };
    }
    if (tc.result.success) {
      toolCounts[tc.toolName].success++;
    } else {
      toolCounts[tc.toolName].failed++;
    }
  }

  console.log("\nTool Usage:");
  for (const [tool, counts] of Object.entries(toolCounts)) {
    console.log(`  ${tool}: ${counts.success} success, ${counts.failed} failed`);
  }

  // Check for expected tools
  const usedCloudWatch = state.toolCallHistory.some(tc => tc.toolName === "cloudwatch_query_logs");
  const usedGitHubSearch = state.toolCallHistory.some(tc => tc.toolName === "github_search_code");
  const usedGitHubGetFile = state.toolCallHistory.some(tc => tc.toolName === "github_get_file");
  const usedGitHubPR = state.toolCallHistory.some(tc =>
    tc.toolName === "github_create_draft_pr" || tc.toolName === "github_create_single_file_pr"
  );

  console.log("\n✅ Expected Flow Validation:");
  console.log(`  CloudWatch query: ${usedCloudWatch ? "✓" : "✗"}`);
  console.log(`  GitHub code search: ${usedGitHubSearch ? "✓" : "✗"}`);
  console.log(`  GitHub get file: ${usedGitHubGetFile ? "✓" : "✗"}`);
  console.log(`  GitHub create PR: ${usedGitHubPR ? "✓" : "✗"}`);

  if (usedCloudWatch && usedGitHubGetFile && usedGitHubPR) {
    console.log("\n🎉 Full investigation flow completed successfully!");
  } else if (usedCloudWatch && usedGitHubGetFile) {
    console.log("\n⚠️ Agent read logs and code but didn't create PR (may need approval)");
  } else {
    console.log("\n⚠️ Agent may not have completed the full flow");
  }
}

main().catch(console.error);
