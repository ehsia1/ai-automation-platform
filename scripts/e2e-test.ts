#!/usr/bin/env npx tsx
/**
 * E2E Test Driver for AI Automation Platform
 *
 * Tests the full pipeline: Datadog webhook → Classification → Triage → Notifications
 *
 * Usage:
 *   npx tsx scripts/e2e-test.ts                    # Run all tests
 *   npx tsx scripts/e2e-test.ts --scenario high_cpu_billing  # Run specific scenario
 *   npx tsx scripts/e2e-test.ts --verbose          # Verbose output
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types
interface TestScenario {
  id: string;
  description: string;
  input: {
    webhook_payload: Record<string, unknown>;
  };
  expected: {
    classification: {
      item_type: string;
      mode: string;
      priority: string[];
      requires_action: boolean;
      service: string;
    };
    triage: {
      summary_keywords: string[];
      root_cause_keywords: string[];
      action_keywords: string[];
    };
    notification: {
      should_send: boolean;
      severity: string[];
    };
  };
  timeout_ms: number;
}

interface TestResult {
  scenario_id: string;
  description: string;
  passed: boolean;
  duration_ms: number;
  checks: CheckResult[];
  item_id?: string;
  alert_id?: string;
  agent_run_id?: string;
  error?: string;
}

interface CheckResult {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  message?: string;
}

interface ItemResponse {
  item_id: string;
  workspace_id: string;
  status: string;
  item_type?: string;
  mode?: string;
  priority?: string;
  requires_action?: boolean;
  service?: string;
  summary?: string;
  tags?: string[];
}

interface AlertResponse {
  alert_id: string;
  workspace_id: string;
  item_id: string;
  title: string;
  service: string;
  severity: string;
  status: string;
  summary?: string;
}

interface AgentRunResponse {
  run_id: string;
  workspace_id: string;
  agent_key: string;
  trigger_id: string;
  status: string;
  output?: {
    summary?: string;
    root_cause?: string;
    suggested_actions?: string[];
    severity_assessment?: string;
  };
}

// Configuration
const API_URL = process.env.API_URL || "http://localhost:4000";
const SCENARIOS_DIR = path.join(__dirname, "../test_scenarios/engineering");
const MAX_POLL_ATTEMPTS = 45; // 45 * 2s = 90s to handle Lambda cold starts
const POLL_INTERVAL_MS = 2000;

// Parse CLI args
const args = process.argv.slice(2);
const verbose = args.includes("--verbose") || args.includes("-v");
const scenarioFilter = args.find((a) => a.startsWith("--scenario="))?.split("=")[1]
  || args[args.indexOf("--scenario") + 1];

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function log(message: string, color?: keyof typeof colors) {
  const prefix = color ? colors[color] : "";
  const suffix = color ? colors.reset : "";
  console.log(`${prefix}${message}${suffix}`);
}

function logVerbose(message: string) {
  if (verbose) {
    log(`  ${message}`, "dim");
  }
}

async function loadScenarios(): Promise<TestScenario[]> {
  const scenarios: TestScenario[] = [];
  const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(SCENARIOS_DIR, file), "utf-8");
    const scenario = JSON.parse(content) as TestScenario;

    if (scenarioFilter && scenario.id !== scenarioFilter) {
      continue;
    }

    scenarios.push(scenario);
  }

  return scenarios;
}

async function postWebhook(payload: Record<string, unknown>): Promise<{ item_id: string }> {
  const response = await fetch(`${API_URL}/webhooks/datadog`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<{ item_id: string }>;
}

async function pollForItem(itemId: string, maxAttempts = MAX_POLL_ATTEMPTS): Promise<ItemResponse | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${API_URL}/items/${itemId}`);
      if (response.ok) {
        const result = (await response.json()) as { item: ItemResponse };
        const item = result.item;
        if (item && (item.status === "classified" || item.status === "error")) {
          return item;
        }
      }
    } catch {
      // Continue polling
    }
    await sleep(POLL_INTERVAL_MS);
    logVerbose(`Polling item ${itemId}... attempt ${i + 1}/${maxAttempts}`);
  }
  return null;
}

async function pollForAlert(itemId: string, maxAttempts = MAX_POLL_ATTEMPTS): Promise<AlertResponse | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Alerts API doesn't support item_id filter, so we fetch all and find
      const response = await fetch(`${API_URL}/alerts`);
      if (response.ok) {
        const result = (await response.json()) as { alerts: AlertResponse[] };
        const alert = result.alerts?.find((a) => a.item_id === itemId);
        if (alert) {
          return alert;
        }
      }
    } catch {
      // Continue polling
    }
    await sleep(POLL_INTERVAL_MS);
    logVerbose(`Polling alert for item ${itemId}... attempt ${i + 1}/${maxAttempts}`);
  }
  return null;
}

async function pollForAgentRun(alertId: string, maxAttempts = MAX_POLL_ATTEMPTS): Promise<AgentRunResponse | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${API_URL}/agent-runs?trigger_id=${alertId}`);
      if (response.ok) {
        const result = (await response.json()) as { agentRuns: AgentRunResponse[] };
        const run = result.agentRuns?.find((r) => r.trigger_id === alertId && r.status !== "running");
        if (run) {
          return run;
        }
      }
    } catch {
      // Continue polling
    }
    await sleep(POLL_INTERVAL_MS);
    logVerbose(`Polling agent run for alert ${alertId}... attempt ${i + 1}/${maxAttempts}`);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkKeywords(text: string | undefined, keywords: string[]): { found: string[]; missing: string[] } {
  if (!text || keywords.length === 0) {
    return { found: [], missing: [] };
  }

  const lowerText = text.toLowerCase();
  const found: string[] = [];
  const missing: string[] = [];

  for (const keyword of keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      found.push(keyword);
    } else {
      missing.push(keyword);
    }
  }

  return { found, missing };
}

function validateClassification(item: ItemResponse, expected: TestScenario["expected"]["classification"]): CheckResult[] {
  const checks: CheckResult[] = [];

  // Check item_type
  checks.push({
    name: "item_type",
    passed: item.item_type === expected.item_type,
    expected: expected.item_type,
    actual: item.item_type,
  });

  // Check mode
  checks.push({
    name: "mode",
    passed: item.mode === expected.mode,
    expected: expected.mode,
    actual: item.mode,
  });

  // Check priority (allow any of the expected values)
  checks.push({
    name: "priority",
    passed: expected.priority.includes(item.priority || ""),
    expected: expected.priority,
    actual: item.priority,
  });

  // Check requires_action
  checks.push({
    name: "requires_action",
    passed: item.requires_action === expected.requires_action,
    expected: expected.requires_action,
    actual: item.requires_action,
  });

  // Check service
  checks.push({
    name: "service",
    passed: item.service === expected.service,
    expected: expected.service,
    actual: item.service,
  });

  return checks;
}

function validateTriage(agentRun: AgentRunResponse | null, expected: TestScenario["expected"]["triage"]): CheckResult[] {
  const checks: CheckResult[] = [];

  if (!agentRun || !agentRun.output) {
    if (expected.summary_keywords.length > 0) {
      checks.push({
        name: "triage_output",
        passed: false,
        expected: "Agent run with output",
        actual: agentRun ? "No output" : "No agent run",
      });
    }
    return checks;
  }

  const output = agentRun.output;

  // Check summary keywords
  if (expected.summary_keywords.length > 0) {
    const { found, missing } = checkKeywords(output.summary, expected.summary_keywords);
    const passThreshold = Math.ceil(expected.summary_keywords.length * 0.4); // 40% of keywords
    checks.push({
      name: "summary_keywords",
      passed: found.length >= passThreshold,
      expected: `At least ${passThreshold} of: ${expected.summary_keywords.join(", ")}`,
      actual: `Found: ${found.join(", ")}${missing.length > 0 ? ` | Missing: ${missing.join(", ")}` : ""}`,
    });
  }

  // Check root cause keywords
  if (expected.root_cause_keywords.length > 0) {
    const { found, missing } = checkKeywords(output.root_cause, expected.root_cause_keywords);
    const passThreshold = Math.ceil(expected.root_cause_keywords.length * 0.20); // 20% of keywords
    checks.push({
      name: "root_cause_keywords",
      passed: found.length >= passThreshold,
      expected: `At least ${passThreshold} of: ${expected.root_cause_keywords.join(", ")}`,
      actual: `Found: ${found.join(", ")}${missing.length > 0 ? ` | Missing: ${missing.join(", ")}` : ""}`,
    });
  }

  // Check action keywords
  if (expected.action_keywords.length > 0) {
    const actions = output.suggested_actions?.join(" ") || "";
    const { found, missing } = checkKeywords(actions, expected.action_keywords);
    const passThreshold = Math.ceil(expected.action_keywords.length * 0.20); // 20% of keywords
    checks.push({
      name: "action_keywords",
      passed: found.length >= passThreshold,
      expected: `At least ${passThreshold} of: ${expected.action_keywords.join(", ")}`,
      actual: `Found: ${found.join(", ")}${missing.length > 0 ? ` | Missing: ${missing.join(", ")}` : ""}`,
    });
  }

  return checks;
}

async function runScenario(scenario: TestScenario): Promise<TestResult> {
  const startTime = Date.now();
  const result: TestResult = {
    scenario_id: scenario.id,
    description: scenario.description,
    passed: false,
    duration_ms: 0,
    checks: [],
  };

  try {
    log(`\n📋 Running: ${scenario.id}`, "blue");
    logVerbose(scenario.description);

    // Step 1: Post webhook
    logVerbose("Posting webhook...");
    const webhookResult = await postWebhook(scenario.input.webhook_payload);
    result.item_id = webhookResult.item_id;
    logVerbose(`Item created: ${result.item_id}`);

    // Step 2: Poll for classification
    logVerbose("Waiting for classification...");
    const item = await pollForItem(result.item_id);
    if (!item) {
      throw new Error("Classification timed out");
    }
    logVerbose(`Classification complete: ${item.item_type} / ${item.priority}`);

    // Step 3: Validate classification
    const classificationChecks = validateClassification(item, scenario.expected.classification);
    result.checks.push(...classificationChecks);

    // Step 4: If requires_action, check for alert and triage
    if (scenario.expected.classification.requires_action) {
      logVerbose("Waiting for alert...");
      const alert = await pollForAlert(result.item_id);
      if (alert) {
        result.alert_id = alert.alert_id;
        logVerbose(`Alert created: ${result.alert_id}`);

        // Poll for triage agent run
        logVerbose("Waiting for triage agent...");
        const agentRun = await pollForAgentRun(alert.alert_id);
        if (agentRun) {
          result.agent_run_id = agentRun.run_id;
          logVerbose(`Agent run complete: ${agentRun.status}`);

          // Validate triage output
          const triageChecks = validateTriage(agentRun, scenario.expected.triage);
          result.checks.push(...triageChecks);
        } else {
          result.checks.push({
            name: "triage_completion",
            passed: false,
            expected: "Agent run to complete",
            actual: "Timed out",
          });
        }
      } else {
        result.checks.push({
          name: "alert_created",
          passed: false,
          expected: "Alert to be created",
          actual: "No alert found",
        });
      }
    }

    // Calculate overall pass/fail
    const failedChecks = result.checks.filter((c) => !c.passed);
    result.passed = failedChecks.length === 0;

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.passed = false;
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

function printResult(result: TestResult) {
  const icon = result.passed ? "✅" : "❌";
  const color = result.passed ? "green" : "red";

  log(`${icon} ${result.scenario_id} (${result.duration_ms}ms)`, color);

  if (!result.passed || verbose) {
    for (const check of result.checks) {
      const checkIcon = check.passed ? "  ✓" : "  ✗";
      const checkColor = check.passed ? "green" : "red";
      log(`${checkIcon} ${check.name}: expected=${JSON.stringify(check.expected)}, actual=${JSON.stringify(check.actual)}`, checkColor);
    }

    if (result.error) {
      log(`  Error: ${result.error}`, "red");
    }
  }
}

function printSummary(results: TestResult[]) {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0);
  const avgDuration = Math.round(totalDuration / results.length);

  log("\n" + "═".repeat(60), "bold");
  log("📊 TEST SUMMARY", "bold");
  log("═".repeat(60), "bold");

  log(`Total scenarios: ${results.length}`);
  log(`Passed: ${passed}`, passed > 0 ? "green" : undefined);
  log(`Failed: ${failed}`, failed > 0 ? "red" : undefined);
  log(`Pass rate: ${((passed / results.length) * 100).toFixed(1)}%`);
  log(`Average latency: ${avgDuration}ms`);
  log(`Total time: ${totalDuration}ms`);

  // MVP pass criteria
  const passRate = (passed / results.length) * 100;
  const latencyOk = avgDuration < 30000; // 30s for full pipeline
  const mvpPass = passRate >= 80 && latencyOk;

  log("\n" + "─".repeat(60));
  log("📋 MVP PASS CRITERIA", "bold");
  log("─".repeat(60));
  log(`  Pass rate ≥ 80%: ${passRate >= 80 ? "✅" : "❌"} (${passRate.toFixed(1)}%)`);
  log(`  Avg latency < 30s: ${latencyOk ? "✅" : "❌"} (${avgDuration}ms)`);
  log(`\n  ${mvpPass ? "🎉 MVP CRITERIA MET!" : "⚠️  MVP CRITERIA NOT MET"}`, mvpPass ? "green" : "yellow");

  if (failed > 0) {
    log("\n" + "─".repeat(60));
    log("❌ FAILED SCENARIOS", "red");
    log("─".repeat(60));
    for (const result of results.filter((r) => !r.passed)) {
      log(`  • ${result.scenario_id}: ${result.error || "Check failures"}`, "red");
    }
  }
}

async function main() {
  log("🚀 AI Automation Platform E2E Test Runner", "bold");
  log(`API URL: ${API_URL}`);
  log(`Scenarios dir: ${SCENARIOS_DIR}`);
  if (scenarioFilter) {
    log(`Filter: ${scenarioFilter}`, "yellow");
  }

  // Check API health
  try {
    const healthResponse = await fetch(`${API_URL}/`);
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status}`);
    }
    log("✓ API is healthy", "green");
  } catch (error) {
    log(`✗ API not reachable: ${error instanceof Error ? error.message : error}`, "red");
    log("\nMake sure the API is running (sst dev or deployed)", "yellow");
    process.exit(1);
  }

  // Load scenarios
  const scenarios = await loadScenarios();
  if (scenarios.length === 0) {
    log("No scenarios found!", "red");
    process.exit(1);
  }
  log(`\nLoaded ${scenarios.length} test scenarios\n`);

  // Run tests
  const results: TestResult[] = [];
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    results.push(result);
    printResult(result);
  }

  // Print summary
  printSummary(results);

  // Exit with appropriate code
  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
