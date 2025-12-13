/**
 * Test script for Integration System
 *
 * Verifies that the integration router can:
 * 1. Load integrations from config
 * 2. Initialize clients (REST, OpenAPI)
 * 3. Discover tools
 * 4. Execute operations
 */

import { getIntegrationRouter, resetIntegrationRouter } from "../packages/core/src/integrations/router";
import { apiCallTool, listIntegrationsTool } from "../packages/core/src/integrations/tool";

async function testIntegrations() {
  console.log("=== Integration System Test ===\n");

  // Reset any existing router state
  await resetIntegrationRouter();

  // Test 1: Initialize router
  console.log("1. Testing router initialization...");
  const router = getIntegrationRouter();
  await router.ensureInitialized();

  const integrations = router.getIntegrations();
  console.log(`   ✓ Loaded ${integrations.length} integrations: ${integrations.join(", ")}`);

  // Test 2: List integrations via tool
  console.log("\n2. Testing list_integrations tool...");
  const listResult = await listIntegrationsTool.execute({}, {} as never);
  if (listResult.success) {
    console.log("   ✓ List integrations successful");
    const parsed = JSON.parse(listResult.output);
    console.log(`   Integrations: ${JSON.stringify(parsed.integrations?.map((i: { name: string }) => i.name) || [])}`);
  } else {
    console.log(`   ✗ List integrations failed: ${listResult.error}`);
  }

  // Test 3: Get tools for each integration
  console.log("\n3. Testing tool discovery...");
  for (const name of integrations) {
    const tools = router.getToolsForIntegration(name);
    console.log(`   ${name}: ${tools.length} tools`);
    if (tools.length > 0) {
      tools.slice(0, 3).forEach((t) => {
        console.log(`     - ${t.name}: ${t.description.slice(0, 50)}... [${t.riskTier}]`);
      });
      if (tools.length > 3) {
        console.log(`     ... and ${tools.length - 3} more`);
      }
    }
  }

  // Test 4: Make a simple API call
  console.log("\n4. Testing API call (jsonplaceholder.listPosts)...");
  const apiResult = await apiCallTool.execute(
    {
      integration: "jsonplaceholder",
      operation: "listPosts",
    },
    {} as never
  );

  if (apiResult.success) {
    const posts = JSON.parse(apiResult.output);
    console.log(`   ✓ API call successful, got ${Array.isArray(posts) ? posts.length : "?"} posts`);
  } else {
    console.log(`   ✗ API call failed: ${apiResult.error}`);
  }

  // Test 5: Test connection for each integration
  console.log("\n5. Testing connections...");
  const testResults = await router.testAllIntegrations();
  for (const [name, result] of testResults) {
    console.log(`   ${name}: ${result.ok ? "✓" : "✗"} ${result.message}`);
  }

  // Test 6: Test HTTPBin (OpenAPI) if available
  if (integrations.includes("httpbin")) {
    console.log("\n6. Testing HTTPBin OpenAPI integration...");
    const httpbinResult = await apiCallTool.execute(
      {
        integration: "httpbin",
        operation: "GET__ip",
      },
      {} as never
    );

    if (httpbinResult.success) {
      console.log("   ✓ HTTPBin API call successful");
      console.log(`   Response: ${httpbinResult.output.slice(0, 100)}`);
    } else {
      console.log(`   ✗ HTTPBin API call failed: ${httpbinResult.error}`);
    }
  }

  console.log("\n=== Test Complete ===");

  // Cleanup
  await router.close();
}

// Run tests
testIntegrations().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
