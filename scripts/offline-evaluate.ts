#!/usr/bin/env npx tsx
/**
 * Offline Evaluation Script
 *
 * Evaluates existing alerts and agent runs against test scenarios
 * without triggering new webhooks or emails.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = process.env.API_URL || "https://hdmirmb7ei.execute-api.us-east-1.amazonaws.com";
const SCENARIOS_DIR = path.join(__dirname, "../test_scenarios/engineering");

interface TestScenario {
  id: string;
  description: string;
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
  };
}

interface Alert {
  alert_id: string;
  item_id: string;
  service: string;
  title: string;
  severity: string;
  status: string;
}

interface AgentRun {
  run_id: string;
  trigger_id: string;
  status: string;
  output?: {
    summary?: string;
    root_cause?: string;
    suggested_actions?: string[];
  };
}

interface EvaluationResult {
  scenario_id: string;
  description: string;
  matched_alert: string | null;
  matched_agent_run: string | null;
  passed: boolean;
  checks: {
    name: string;
    passed: boolean;
    expected: unknown;
    actual: unknown;
  }[];
}

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

// Map scenario to expected alert title patterns
const scenarioToAlertPattern: Record<string, { service: string; titlePatterns: string[] }> = {
  "5xx_error_spike": { service: "checkout-api", titlePatterns: ["error rate", "5xx", "error spike"] },
  "canary_test_failure": { service: "checkout-api", titlePatterns: ["canary", "checkout-flow"] },
  "database_connection_failure": { service: "order-service", titlePatterns: ["database", "connection"] },
  "deployment_failure": { service: "user-service", titlePatterns: ["deployment", "failed"] },
  "disk_space_warning": { service: "log-aggregator", titlePatterns: ["disk", "space"] },
  "high_cpu_billing": { service: "billing-api", titlePatterns: ["cpu", "billing"] },
  "kafka_consumer_lag": { service: "event-processor", titlePatterns: ["consumer", "lag"] },
  "latency_degradation": { service: "search-service", titlePatterns: ["latency"] },
  "memory_leak_auth": { service: "auth-service", titlePatterns: ["memory"] },
  "rate_limiting": { service: "partner-api", titlePatterns: ["rate limit"] },
  "security_failed_logins": { service: "auth-service", titlePatterns: ["security", "login", "failed"] },
  "ssl_cert_expiring": { service: "edge-proxy", titlePatterns: ["ssl", "certificate", "expir"] },
};

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

function findMatchingAlert(scenario: TestScenario, alerts: Alert[]): Alert | null {
  const pattern = scenarioToAlertPattern[scenario.id];
  if (!pattern) return null;

  // Find alerts matching service and title pattern
  const matching = alerts.filter(alert => {
    if (alert.service !== pattern.service) return false;
    const lowerTitle = alert.title.toLowerCase();
    return pattern.titlePatterns.some(p => lowerTitle.includes(p.toLowerCase()));
  });

  // Return most recent one
  return matching[0] || null;
}

async function main() {
  log("🔍 AI Automation Platform Offline Evaluation", "bold");
  log(`API URL: ${API_URL}\n`);

  // Load scenarios
  const scenarioFiles = fs.readdirSync(SCENARIOS_DIR).filter(f => f.endsWith(".json"));
  const scenarios: TestScenario[] = [];
  for (const file of scenarioFiles) {
    const content = fs.readFileSync(path.join(SCENARIOS_DIR, file), "utf-8");
    scenarios.push(JSON.parse(content));
  }
  log(`Loaded ${scenarios.length} test scenarios`);

  // Fetch alerts
  const alertsRes = await fetch(`${API_URL}/alerts?workspace_id=default&limit=200`);
  const alertsData = await alertsRes.json() as { alerts: Alert[] };
  const alerts = alertsData.alerts || [];
  log(`Fetched ${alerts.length} alerts`);

  // Fetch agent runs
  const runsRes = await fetch(`${API_URL}/agent-runs?workspace_id=default&limit=200`);
  const runsData = await runsRes.json() as { agentRuns: AgentRun[] };
  const agentRuns = runsData.agentRuns || [];
  log(`Fetched ${agentRuns.length} agent runs`);

  // Build trigger_id -> agent_run map
  const runsByTriggerId = new Map<string, AgentRun>();
  for (const run of agentRuns) {
    if (run.trigger_id && run.status === "success") {
      runsByTriggerId.set(run.trigger_id, run);
    }
  }

  // Evaluate each scenario
  const results: EvaluationResult[] = [];

  for (const scenario of scenarios) {
    log(`\n📋 Evaluating: ${scenario.id}`, "blue");

    const result: EvaluationResult = {
      scenario_id: scenario.id,
      description: scenario.description,
      matched_alert: null,
      matched_agent_run: null,
      passed: false,
      checks: [],
    };

    // Skip non-actionable scenarios
    if (!scenario.expected.classification.requires_action) {
      result.passed = true;
      result.checks.push({
        name: "non_actionable",
        passed: true,
        expected: "No action required",
        actual: "Skipped",
      });
      results.push(result);
      log(`  ✓ Skipped (non-actionable scenario)`, "green");
      continue;
    }

    // Find matching alert
    const alert = findMatchingAlert(scenario, alerts);
    if (!alert) {
      result.checks.push({
        name: "alert_found",
        passed: false,
        expected: `Alert for ${scenario.expected.classification.service}`,
        actual: "No matching alert found",
      });
      results.push(result);
      log(`  ✗ No matching alert found`, "red");
      continue;
    }

    result.matched_alert = alert.alert_id;
    log(`  Found alert: ${alert.title.substring(0, 50)}...`);

    // Find agent run for this alert
    const agentRun = runsByTriggerId.get(alert.alert_id);
    if (!agentRun) {
      result.checks.push({
        name: "agent_run_found",
        passed: false,
        expected: "Agent run for alert",
        actual: "No agent run found",
      });
      results.push(result);
      log(`  ✗ No agent run found for alert`, "red");
      continue;
    }

    result.matched_agent_run = agentRun.run_id;

    // Fetch full agent run details
    const runDetailRes = await fetch(`${API_URL}/agent-runs/${agentRun.run_id}`);
    const runDetail = await runDetailRes.json() as { agentRun: AgentRun };
    const output = runDetail.agentRun?.output;

    if (!output) {
      result.checks.push({
        name: "output_exists",
        passed: false,
        expected: "Agent output",
        actual: "No output",
      });
      results.push(result);
      log(`  ✗ Agent run has no output`, "red");
      continue;
    }

    // Check summary keywords (40% threshold)
    const { summary_keywords, root_cause_keywords, action_keywords } = scenario.expected.triage;

    if (summary_keywords.length > 0) {
      const { found, missing } = checkKeywords(output.summary, summary_keywords);
      const threshold = Math.ceil(summary_keywords.length * 0.4);
      const passed = found.length >= threshold;
      result.checks.push({
        name: "summary_keywords",
        passed,
        expected: `At least ${threshold} of: ${summary_keywords.join(", ")}`,
        actual: `Found: ${found.join(", ")}${missing.length > 0 ? ` | Missing: ${missing.join(", ")}` : ""}`,
      });
      log(`  ${passed ? "✓" : "✗"} Summary: ${found.length}/${threshold} keywords`, passed ? "green" : "red");
    }

    // Check root cause keywords (20% threshold)
    // Also check suggested_actions since model sometimes puts analysis there
    if (root_cause_keywords.length > 0) {
      const rootCauseText = [
        output.root_cause,
        output.suggested_actions?.join(" "),
      ].filter(Boolean).join(" ");
      const { found, missing } = checkKeywords(rootCauseText, root_cause_keywords);
      const threshold = Math.ceil(root_cause_keywords.length * 0.2);
      const passed = found.length >= threshold;
      result.checks.push({
        name: "root_cause_keywords",
        passed,
        expected: `At least ${threshold} of: ${root_cause_keywords.join(", ")}`,
        actual: `Found: ${found.join(", ")}${missing.length > 0 ? ` | Missing: ${missing.join(", ")}` : ""}`,
      });
      log(`  ${passed ? "✓" : "✗"} Root cause: ${found.length}/${threshold} keywords`, passed ? "green" : "red");
    }

    // Check action keywords (20% threshold)
    if (action_keywords.length > 0) {
      const actions = output.suggested_actions?.join(" ") || "";
      const { found, missing } = checkKeywords(actions, action_keywords);
      const threshold = Math.ceil(action_keywords.length * 0.2);
      const passed = found.length >= threshold;
      result.checks.push({
        name: "action_keywords",
        passed,
        expected: `At least ${threshold} of: ${action_keywords.join(", ")}`,
        actual: `Found: ${found.join(", ")}${missing.length > 0 ? ` | Missing: ${missing.join(", ")}` : ""}`,
      });
      log(`  ${passed ? "✓" : "✗"} Actions: ${found.length}/${threshold} keywords`, passed ? "green" : "red");
    }

    result.passed = result.checks.every(c => c.passed);
    results.push(result);
  }

  // Print summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  log("\n" + "═".repeat(60), "bold");
  log("📊 OFFLINE EVALUATION SUMMARY", "bold");
  log("═".repeat(60), "bold");

  log(`Total scenarios: ${results.length}`);
  log(`Passed: ${passed}`, passed > 0 ? "green" : undefined);
  log(`Failed: ${failed}`, failed > 0 ? "red" : undefined);
  log(`Pass rate: ${((passed / results.length) * 100).toFixed(1)}%`);

  const passRate = (passed / results.length) * 100;
  const mvpPass = passRate >= 80;

  log("\n" + "─".repeat(60));
  log("📋 MVP PASS CRITERIA", "bold");
  log("─".repeat(60));
  log(`  Pass rate ≥ 80%: ${mvpPass ? "✅" : "❌"} (${passRate.toFixed(1)}%)`);
  log(`\n  ${mvpPass ? "🎉 MVP CRITERIA MET!" : "⚠️  MVP CRITERIA NOT MET"}`, mvpPass ? "green" : "yellow");

  if (failed > 0) {
    log("\n" + "─".repeat(60));
    log("❌ FAILED SCENARIOS", "red");
    log("─".repeat(60));
    for (const result of results.filter(r => !r.passed)) {
      const failedChecks = result.checks.filter(c => !c.passed).map(c => c.name).join(", ");
      log(`  • ${result.scenario_id}: ${failedChecks || "Unknown"}`, "red");
    }
  }
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
