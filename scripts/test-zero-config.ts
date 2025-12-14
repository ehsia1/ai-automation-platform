/**
 * Test Zero-Config Integration System
 *
 * Demonstrates that integrations auto-enable based on environment variables.
 * Run with: npx tsx scripts/test-zero-config.ts
 *
 * Try with: PAGERDUTY_TOKEN=test npx tsx scripts/test-zero-config.ts
 */

import {
  getAutoEnabledIntegrations,
  getIntegrationsSummary,
  KNOWN_INTEGRATIONS,
  isIntegrationEnabled,
} from "../packages/core/src/integrations/known-integrations.js";

console.log("=== Zero-Config Integration Test ===\n");

// Show what's auto-enabled
const autoEnabled = getAutoEnabledIntegrations();
console.log(`Auto-enabled integrations (${autoEnabled.length}):`, autoEnabled);

// Show key environment variable status
console.log("\n--- Environment Variable Status ---");
const envChecks = [
  { name: "pagerduty", envVar: "PAGERDUTY_TOKEN" },
  { name: "datadog", envVar: "DATADOG_API_KEY" },
  { name: "slack", envVar: "SLACK_BOT_TOKEN" },
  { name: "jira", envVar: "JIRA_API_TOKEN" },
];

for (const { name, envVar } of envChecks) {
  const isSet = !!process.env[envVar];
  const isEnabled = isIntegrationEnabled(name);
  const status = isEnabled ? "✅ ENABLED" : isSet ? "⚠️ Partial" : "❌ Not set";
  console.log(`  ${envVar}: ${status}`);
}

// Show full summary
console.log("\n--- Full Integration Summary ---");
console.log(getIntegrationsSummary());

// Show all known integrations and their required env vars
console.log("\n--- All Known Integrations ---");
for (const [name, info] of Object.entries(KNOWN_INTEGRATIONS)) {
  const enabled = isIntegrationEnabled(name);
  const envVars = info.envVars.length > 0 ? info.envVars.join(", ") : "(no auth required)";
  console.log(`  ${enabled ? "✅" : "⬜"} ${name}: ${info.displayName}`);
  console.log(`     Env: ${envVars}`);
  console.log(`     Ops: ${info.keyOperations?.join(", ") || "various"}`);
}

console.log("\n=== Test Complete ===");
