/**
 * Tests for agent timeout utilities
 * Run with: npx tsx packages/core/src/__tests__/timeout.test.ts
 */

import {
  TimeoutController,
  AgentTimeoutError,
  withTimeout,
  isTimeoutError,
} from "../agent/timeout";

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.log(`❌ ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("Running agent timeout utility tests...\n");

  // Test 1: TimeoutController tracks elapsed time
  await test("TimeoutController tracks elapsed time", async () => {
    const controller = new TimeoutController(1000);
    await sleep(100);
    const elapsed = controller.elapsedMs;
    if (elapsed < 90 || elapsed > 200) {
      throw new Error(`Expected ~100ms elapsed, got ${elapsed}ms`);
    }
  });

  // Test 2: TimeoutController calculates remaining time
  await test("TimeoutController calculates remaining time", async () => {
    const controller = new TimeoutController(1000);
    await sleep(100);
    const remaining = controller.remainingMs;
    if (remaining < 800 || remaining > 920) {
      throw new Error(`Expected ~900ms remaining, got ${remaining}ms`);
    }
  });

  // Test 3: hasTimeFor returns correct values
  await test("hasTimeFor returns correct values", async () => {
    const controller = new TimeoutController(500);

    if (!controller.hasTimeFor(400)) {
      throw new Error("Should have time for 400ms");
    }

    if (controller.hasTimeFor(600)) {
      throw new Error("Should NOT have time for 600ms");
    }

    await sleep(200);
    if (controller.hasTimeFor(400)) {
      throw new Error("Should NOT have time for 400ms after 200ms elapsed");
    }
  });

  // Test 4: TimeoutController triggers on timeout
  await test("TimeoutController triggers callback on timeout", async () => {
    let triggered = false;
    const controller = new TimeoutController(100, () => {
      triggered = true;
    });
    controller.start();

    await sleep(150);

    if (!triggered) {
      throw new Error("Timeout callback should have been triggered");
    }
    if (!controller.isTimedOut) {
      throw new Error("isTimedOut should be true");
    }

    controller.stop();
  });

  // Test 5: TimeoutController can be stopped before timeout
  await test("TimeoutController can be stopped before timeout", async () => {
    let triggered = false;
    const controller = new TimeoutController(200, () => {
      triggered = true;
    });
    controller.start();

    await sleep(50);
    controller.stop();
    await sleep(200);

    if (triggered) {
      throw new Error("Timeout callback should NOT have been triggered");
    }
    if (controller.isTimedOut) {
      throw new Error("isTimedOut should be false after stop()");
    }
  });

  // Test 6: withTimeout completes before timeout
  await test("withTimeout completes before timeout", async () => {
    const result = await withTimeout(
      (async () => {
        await sleep(50);
        return "success";
      })(),
      200
    );

    if (result !== "success") {
      throw new Error(`Expected "success", got "${result}"`);
    }
  });

  // Test 7: withTimeout throws on timeout
  await test("withTimeout throws AgentTimeoutError on timeout", async () => {
    try {
      await withTimeout(
        (async () => {
          await sleep(300);
          return "should not reach";
        })(),
        100,
        "Custom timeout message"
      );
      throw new Error("Should have thrown");
    } catch (error) {
      if (!isTimeoutError(error)) {
        throw new Error("Should be AgentTimeoutError");
      }
      if (!error.message.includes("Custom timeout message")) {
        throw new Error(`Wrong message: ${error.message}`);
      }
      if (error.timeoutMs !== 100) {
        throw new Error(`Wrong timeoutMs: ${error.timeoutMs}`);
      }
    }
  });

  // Test 8: AgentTimeoutError includes context
  await test("AgentTimeoutError includes context", async () => {
    const error = new AgentTimeoutError(
      "Test timeout",
      5000,
      3000,
      { iteration: 5, lastToolCall: "github_search" }
    );

    if (error.name !== "AgentTimeoutError") {
      throw new Error(`Wrong name: ${error.name}`);
    }
    if (error.timeoutMs !== 5000) {
      throw new Error(`Wrong timeoutMs: ${error.timeoutMs}`);
    }
    if (error.elapsedMs !== 3000) {
      throw new Error(`Wrong elapsedMs: ${error.elapsedMs}`);
    }
    if (error.context?.iteration !== 5) {
      throw new Error(`Wrong iteration: ${error.context?.iteration}`);
    }
    if (error.context?.lastToolCall !== "github_search") {
      throw new Error(`Wrong lastToolCall: ${error.context?.lastToolCall}`);
    }
  });

  // Test 9: isTimeoutError correctly identifies errors
  await test("isTimeoutError correctly identifies timeout errors", async () => {
    const timeoutError = new AgentTimeoutError("test", 100, 100);
    const regularError = new Error("regular error");

    if (!isTimeoutError(timeoutError)) {
      throw new Error("Should identify AgentTimeoutError");
    }
    if (isTimeoutError(regularError)) {
      throw new Error("Should NOT identify regular Error");
    }
    if (isTimeoutError(null)) {
      throw new Error("Should NOT identify null");
    }
    if (isTimeoutError("string error")) {
      throw new Error("Should NOT identify string");
    }
  });

  // Test 10: checkTimeout throws when timed out
  await test("checkTimeout throws when timed out", async () => {
    const controller = new TimeoutController(50);
    controller.start();

    await sleep(100);

    try {
      controller.checkTimeout({ iteration: 3, lastToolCall: "test_tool" });
      throw new Error("Should have thrown");
    } catch (error) {
      if (!isTimeoutError(error)) {
        throw new Error("Should be AgentTimeoutError");
      }
      if (error.context?.iteration !== 3) {
        throw new Error(`Wrong context iteration: ${error.context?.iteration}`);
      }
    }

    controller.stop();
  });

  console.log("\nAll tests completed!");
}

runTests().catch(console.error);
