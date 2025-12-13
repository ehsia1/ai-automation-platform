#!/usr/bin/env npx tsx
/**
 * E2E test script for database investigation scenarios
 * Tests the agent's ability to investigate data quality issues
 *
 * Prerequisites:
 * 1. Local PostgreSQL with test database (run test-database-tool.ts first to verify)
 * 2. DATABASE_URL set to postgresql://evan@localhost:5432/ai_automation_test
 *
 * Run with: npx tsx scripts/test-agent-database.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { runAgentLoop, type AgentConfig, type AgentState } from "../packages/core/src/agent/loop.js";
import {
  buildInvestigationPrompt,
  type InvestigationContext,
} from "../packages/core/src/agent/prompts/devops-investigator.js";
import "../packages/core/src/tools/index.js";

// Set DATABASE_URL for local testing
const DATABASE_URL = "postgresql://evan@localhost:5432/ai_automation_test";
process.env.DATABASE_URL = DATABASE_URL;

interface TestScenario {
  name: string;
  context: InvestigationContext;
  input: string;
  expectedTools: string[];
  expectedKeywords: string[];
}

const scenarios: TestScenario[] = [
  {
    name: "Negative Balance Investigation",
    context: {
      database: {
        issueType: "data_integrity",
        suspectedTables: ["customers"],
        description: "Some customers have negative account balances",
      },
    },
    input: `Investigate why some customers have negative balances in the database.
Find which customers are affected and determine if this is a data issue or code bug.
Use postgres_schema first to understand the table structure, then query for anomalies.`,
    expectedTools: ["postgres_schema", "postgres_query"],
    expectedKeywords: ["negative", "balance", "customer"],
  },
  {
    name: "Duplicate Records Investigation",
    context: {
      database: {
        issueType: "duplicates",
        suspectedTables: ["customers"],
        description: "Duplicate customer records detected",
      },
    },
    input: `Investigate duplicate customer records in the database.
Find any customers with duplicate emails and report your findings.
Start by understanding the schema, then query for duplicates.`,
    expectedTools: ["postgres_schema", "postgres_query"],
    expectedKeywords: ["duplicate", "email", "count"],
  },
  {
    name: "Calculation Error Investigation",
    context: {
      database: {
        issueType: "calculation_error",
        suspectedTables: ["orders", "order_items"],
        description: "Order totals don't match sum of line items",
      },
    },
    input: `Investigate order calculation discrepancies.
Some orders have total_amount that doesn't match the sum of their line items.
Find these orders and calculate the discrepancy amounts.`,
    expectedTools: ["postgres_schema", "postgres_query"],
    expectedKeywords: ["order", "total", "discrepancy", "sum"],
  },
  {
    name: "Missing Data Investigation",
    context: {
      database: {
        issueType: "missing_data",
        suspectedTables: ["customers"],
        description: "Some customers missing required name field",
      },
    },
    input: `Investigate customers with missing or empty name fields.
Find all affected records and report your findings.`,
    expectedTools: ["postgres_schema", "postgres_query"],
    expectedKeywords: ["name", "null", "empty", "customer"],
  },
];

async function runScenario(scenario: TestScenario): Promise<{
  passed: boolean;
  toolsUsed: string[];
  keywordsFound: string[];
  missingTools: string[];
  missingKeywords: string[];
  state: AgentState;
}> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`SCENARIO: ${scenario.name}`);
  console.log("=".repeat(70));

  const config: AgentConfig = {
    maxIterations: 8,
    systemPrompt: buildInvestigationPrompt(scenario.context),
    timeoutMs: 120000, // 2 minutes
  };

  const state = await runAgentLoop(
    scenario.input,
    config,
    { runId: `test-db-${Date.now()}`, workspaceId: "local" },
    undefined,
    async (event) => {
      switch (event.type) {
        case "iteration_start":
          console.log(`\n--- Iteration ${event.iteration} ---`);
          break;
        case "tool_call":
          console.log(`🔧 ${event.toolName}`);
          if (event.toolName === "postgres_query") {
            const query = (event.args.query as string) || "";
            console.log(`   Query: ${query.substring(0, 100)}${query.length > 100 ? "..." : ""}`);
          }
          break;
        case "tool_result":
          const preview = event.result.output.substring(0, 200);
          console.log(`   ${event.result.success ? "✅" : "❌"} ${preview}${event.result.output.length > 200 ? "..." : ""}`);
          break;
        case "llm_response":
          console.log(`💬 Response: ${event.content.substring(0, 200)}...`);
          break;
        case "completed":
          console.log(`\n✅ Completed`);
          break;
        case "failed":
          console.log(`\n❌ Failed: ${event.error}`);
          break;
      }
    }
  );

  // Evaluate results
  const toolsUsed = [...new Set(state.toolCallHistory.map((tc) => tc.toolName))];
  const allOutput = state.toolCallHistory
    .map((tc) => tc.result.output)
    .join(" ")
    .toLowerCase();
  const finalResult = (state.result || "").toLowerCase();
  const combinedText = allOutput + " " + finalResult;

  const keywordsFound = scenario.expectedKeywords.filter((kw) =>
    combinedText.includes(kw.toLowerCase())
  );
  const missingTools = scenario.expectedTools.filter((t) => !toolsUsed.includes(t));
  const missingKeywords = scenario.expectedKeywords.filter(
    (kw) => !combinedText.includes(kw.toLowerCase())
  );

  const passed =
    missingTools.length === 0 &&
    keywordsFound.length >= Math.ceil(scenario.expectedKeywords.length * 0.7);

  return {
    passed,
    toolsUsed,
    keywordsFound,
    missingTools,
    missingKeywords,
    state,
  };
}

async function main() {
  console.log("🔍 Database Investigation E2E Tests");
  console.log(`Database: ${DATABASE_URL}\n`);

  const results: Array<{ name: string; passed: boolean; details: string }> = [];

  // Run a single scenario for quick testing, or all for full test
  const testScenarios = process.argv.includes("--all") ? scenarios : [scenarios[0]];

  for (const scenario of testScenarios) {
    try {
      const result = await runScenario(scenario);

      const details = [
        `Tools used: ${result.toolsUsed.join(", ")}`,
        `Missing tools: ${result.missingTools.length === 0 ? "none" : result.missingTools.join(", ")}`,
        `Keywords found: ${result.keywordsFound.join(", ")}`,
        `Missing keywords: ${result.missingKeywords.length === 0 ? "none" : result.missingKeywords.join(", ")}`,
        `Status: ${result.state.status}`,
        `Iterations: ${result.state.iterations}`,
      ].join("\n  ");

      results.push({
        name: scenario.name,
        passed: result.passed,
        details,
      });

      console.log(`\n${result.passed ? "✅ PASSED" : "❌ FAILED"}: ${scenario.name}`);
      console.log(`  ${details}`);
    } catch (error) {
      results.push({
        name: scenario.name,
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
      console.error(`\n❌ ERROR: ${scenario.name}`, error);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log(`\nPass rate: ${passed}/${total} (${passRate}%)\n`);

  for (const result of results) {
    console.log(`${result.passed ? "✅" : "❌"} ${result.name}`);
  }

  if (!process.argv.includes("--all")) {
    console.log("\n💡 Run with --all to test all scenarios");
  }

  // Exit with appropriate code
  process.exit(passed === total ? 0 : 1);
}

main().catch(console.error);
