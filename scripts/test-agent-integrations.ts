/**
 * Test script for agent integration tools
 * Tests that the agent can discover and use external API integrations
 * Run with: npx tsx scripts/test-agent-integrations.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { runAgentLoop, type AgentConfig } from "../packages/core/src/agent/loop.js";
// Tools auto-register on import via index.ts
import "../packages/core/src/tools/index.js";

async function main() {
  const systemPrompt = `You are an AI assistant with access to external API integrations.

You have the following tools available:
- list_integrations: Discover what API integrations are configured and their operations
- api_call: Call any configured API integration

Your goal is to help users interact with external services through these integrations.

When asked to explore integrations:
1. First use list_integrations to see what's available
2. Then use api_call to interact with specific integrations

Always explain what you're doing and share the results.`;

  const config: AgentConfig = {
    maxIterations: 5,
    systemPrompt,
  };

  const input = `Please explore what API integrations are available, then call the JSONPlaceholder API to get a list of posts and tell me how many posts there are.`;

  console.log("Starting Integration Test Agent...\n");
  console.log("Input:", input);
  console.log("\n" + "=".repeat(80) + "\n");

  const state = await runAgentLoop(
    input,
    config,
    { runId: "integration-test", workspaceId: "local" },
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
          console.log("✅ TEST COMPLETE");
          console.log("=".repeat(80));
          console.log("\nFinal Result:\n");
          console.log(event.result);
          break;
        case "failed":
          console.log("\n❌ TEST FAILED:", event.error);
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

  // Verify integration tools were used
  const usedTools = state.toolCallHistory.map(tc => tc.toolName);
  const hasListIntegrations = usedTools.includes("list_integrations");
  const hasApiCall = usedTools.includes("api_call");

  console.log("\n" + "=".repeat(80));
  console.log("VERIFICATION:");
  console.log(`  list_integrations used: ${hasListIntegrations ? "✅" : "❌"}`);
  console.log(`  api_call used: ${hasApiCall ? "✅" : "❌"}`);
  console.log(`  Test ${hasListIntegrations && hasApiCall && state.status === "completed" ? "PASSED" : "FAILED"}`);
}

main().catch(console.error);
