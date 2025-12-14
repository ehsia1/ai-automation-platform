/**
 * Test Service Registry
 *
 * Demonstrates service lookup and matching capabilities.
 * Run with: npx tsx scripts/test-service-registry.ts
 */

import {
  ServiceRegistry,
  initializeServiceRegistry,
  getServiceRegistry,
} from "../packages/core/src/services/index.js";

async function main() {
  console.log("=== Service Registry Test ===\n");

  // Initialize from config file
  await initializeServiceRegistry();
  const registry = getServiceRegistry();

  // Show summary
  console.log(registry.getSummary());

  // Test lookups
  console.log("\n--- Lookup Tests ---");

  const testQueries = [
    "ai-oncall-test",
    "ai-agent-test",
    "aioncalltest", // No dashes (alias match)
    "ai_oncall_test", // Underscores (alias match)
    "oncall-test", // Partial match (fuzzy)
    "ehsia1/ai-oncall-test", // Full repo path
    "payment-service", // Non-existent
    "ai-automation-platform",
  ];

  for (const query of testQueries) {
    const result = registry.lookup(query);
    if (result) {
      console.log(`  "${query}" → ${result.name} (${result.matchType})`);
      console.log(`     repo: ${result.config.repository}`);
    } else {
      console.log(`  "${query}" → NOT FOUND`);
    }
  }

  // Test convenience methods
  console.log("\n--- Convenience Methods ---");

  const repo = registry.getRepository("ai-oncall-test");
  console.log(`  getRepository("ai-oncall-test"): ${repo}`);

  const logGroups = registry.getLogGroups("ai-automation-platform");
  console.log(
    `  getLogGroups("ai-automation-platform"): ${logGroups.join(", ") || "(none)"}`
  );

  // Test filters
  console.log("\n--- Filter by Team ---");
  const platformServices = registry.getByTeam("platform");
  for (const [name] of platformServices) {
    console.log(`  - ${name}`);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
