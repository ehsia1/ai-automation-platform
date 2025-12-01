/**
 * Local test script for the DevOps Investigator agent
 * Run with: npx tsx scripts/test-agent.ts
 */

// Load environment variables
import * as dotenv from "dotenv";
dotenv.config();

import { runAgentLoop, type AgentConfig } from "../packages/core/src/agent/loop.js";
import { buildInvestigationPrompt } from "../packages/core/src/agent/prompts/devops-investigator.js";
// Tools auto-register on import via index.ts
import "../packages/core/src/tools/index.js";

async function main() {
  const alertContext = {
    service: "calculator",
    errorMessage: "ZeroDivisionError: division by zero",
  };

  const config: AgentConfig = {
    maxIterations: 10,
    systemPrompt: buildInvestigationPrompt(alertContext),
  };

  const input = `Investigate the divide by zero error in the calculator service. The repo is ehsia1/ai-oncall-test and has a bug in the divide function that needs fixing. Please explore the repo structure first, read the calculator file, and create a PR to fix the bug.`;

  console.log("Starting DevOps Investigator agent...\n");
  console.log("Input:", input);
  console.log("\n" + "=".repeat(80) + "\n");

  const state = await runAgentLoop(
    input,
    config,
    { runId: "test-run", workspaceId: "local" },
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
          const output = event.result.output.substring(0, 500);
          console.log(`   ✅ Result (${event.result.success ? "success" : "error"}): ${output}${event.result.output.length > 500 ? "..." : ""}`);
          break;
        case "llm_response":
          console.log("\n💬 LLM Response:");
          console.log(event.content);
          break;
        case "completed":
          console.log("\n\n" + "=".repeat(80));
          console.log("✅ INVESTIGATION COMPLETE");
          console.log("=".repeat(80));
          console.log("\nFinal Result:\n");
          console.log(event.result);
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

  console.log("\n\n" + "=".repeat(80));
  console.log("Final State:");
  console.log("  Status:", state.status);
  console.log("  Iterations:", state.iterations);
  console.log("  Tool calls:", state.toolCallHistory.length);

  // Show tool call summary
  console.log("\nTool Call Summary:");
  for (const tc of state.toolCallHistory) {
    console.log(`  [${tc.iteration}] ${tc.toolName}: ${tc.result.success ? "✅" : "❌"}`);
  }
}

main().catch(console.error);
