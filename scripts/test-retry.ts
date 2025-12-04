/**
 * Integration test for LLM retry behavior
 *
 * This script creates a mock server that simulates various failure scenarios
 * and tests that the retry logic handles them correctly.
 *
 * Run with: npx tsx scripts/test-retry.ts
 */

import http from "http";
import { complete, initializeLLM } from "@ai-automation-platform/core";

// Track request counts for verification
let requestCount = 0;
let scenario: "rate_limit" | "server_error" | "network_flaky" | "success" = "success";

// Mock Ollama server
const mockServer = http.createServer((req, res) => {
  requestCount++;
  console.log(`  [Mock Server] Request #${requestCount} (scenario: ${scenario})`);

  // Collect request body
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    // Simulate different failure scenarios
    switch (scenario) {
      case "rate_limit":
        // Fail first 2 requests with 429, then succeed
        if (requestCount <= 2) {
          console.log(`  [Mock Server] Returning 429 Too Many Requests`);
          res.writeHead(429, {
            "Content-Type": "application/json",
            "Retry-After": "1"
          });
          res.end(JSON.stringify({ error: "Rate limited" }));
          return;
        }
        break;

      case "server_error":
        // Fail first request with 500, then succeed
        if (requestCount === 1) {
          console.log(`  [Mock Server] Returning 500 Internal Server Error`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
          return;
        }
        break;

      case "network_flaky":
        // Destroy connection on first request (simulates network failure)
        if (requestCount === 1) {
          console.log(`  [Mock Server] Destroying connection (network failure)`);
          req.socket?.destroy();
          return;
        }
        break;
    }

    // Success response (OpenAI-compatible format)
    console.log(`  [Mock Server] Returning success response`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "mock-response",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "Hello! This is a mock response."
        },
        finish_reason: "stop"
      }]
    }));
  });
});

async function runTest(
  name: string,
  testScenario: typeof scenario,
  expectedRequests: number,
  shouldSucceed: boolean = true
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Test: ${name}`);
  console.log("=".repeat(60));

  // Reset state
  requestCount = 0;
  scenario = testScenario;

  const retryAttempts: { attempt: number; delay: number }[] = [];

  try {
    const startTime = Date.now();
    const result = await complete(
      [{ role: "user", content: "Hello" }],
      {
        retry: {
          maxRetries: 3,
          initialDelayMs: 100, // Fast for testing
          maxDelayMs: 500,
          onRetry: (error, attempt, delayMs) => {
            retryAttempts.push({ attempt, delay: delayMs });
            console.log(`  [Retry] Attempt ${attempt}, waiting ${delayMs}ms`);
            console.log(`  [Retry] Error: ${error instanceof Error ? error.message : error}`);
          }
        }
      }
    );
    const duration = Date.now() - startTime;

    if (!shouldSucceed) {
      console.log(`❌ FAIL: Expected failure but got success`);
      return false;
    }

    console.log(`\nResult: "${result.substring(0, 50)}..."`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Total requests: ${requestCount}`);
    console.log(`Retry attempts: ${retryAttempts.length}`);

    if (requestCount !== expectedRequests) {
      console.log(`❌ FAIL: Expected ${expectedRequests} requests, got ${requestCount}`);
      return false;
    }

    console.log(`✅ PASS`);
    return true;

  } catch (error) {
    if (shouldSucceed) {
      console.log(`❌ FAIL: ${error instanceof Error ? error.message : error}`);
      return false;
    }
    console.log(`✅ PASS (expected failure): ${error instanceof Error ? error.message : error}`);
    return true;
  }
}

async function main() {
  const PORT = 11435; // Different from real Ollama port

  // Start mock server
  await new Promise<void>((resolve) => {
    mockServer.listen(PORT, () => {
      console.log(`Mock Ollama server running on port ${PORT}`);
      resolve();
    });
  });

  // Configure LLM to use mock server
  initializeLLM({
    provider: "ollama",
    ollamaBaseUrl: `http://localhost:${PORT}`,
    ollamaModel: "test-model",
  });

  console.log("\n🧪 Starting Retry Integration Tests\n");

  const results: boolean[] = [];

  // Test 1: Normal success (no retry needed)
  results.push(await runTest(
    "Normal success - no retry needed",
    "success",
    1 // Should only make 1 request
  ));

  // Test 2: Rate limit (429) - should retry
  results.push(await runTest(
    "Rate limit (429) - retries twice then succeeds",
    "rate_limit",
    3 // 2 failures + 1 success
  ));

  // Test 3: Server error (500) - should retry
  results.push(await runTest(
    "Server error (500) - retries once then succeeds",
    "server_error",
    2 // 1 failure + 1 success
  ));

  // Test 4: Network flaky - should retry
  results.push(await runTest(
    "Network failure - retries once then succeeds",
    "network_flaky",
    2 // 1 failure + 1 success
  ));

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("\n🎉 All retry tests passed!");
  } else {
    console.log("\n⚠️  Some tests failed");
    process.exitCode = 1;
  }

  // Cleanup
  mockServer.close();
}

main().catch((error) => {
  console.error("Test runner error:", error);
  mockServer.close();
  process.exit(1);
});
