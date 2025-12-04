/**
 * Tests for retry utility
 * Run with: npx tsx packages/core/src/__tests__/retry.test.ts
 */

import {
  withRetry,
  isRetryableError,
  RetryableError,
} from "../llm/retry";

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.log(`❌ ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

async function runTests() {
  console.log("Running retry utility tests...\n");

  // Test 1: Successful call (no retry needed)
  await test("Successful call returns result", async () => {
    let callCount = 0;
    const result = await withRetry(async () => {
      callCount++;
      return "success";
    });
    if (result !== "success") throw new Error("Wrong result");
    if (callCount !== 1) throw new Error(`Expected 1 call, got ${callCount}`);
  });

  // Test 2: Retry on retryable error, then succeed
  await test("Retries on retryable error, then succeeds", async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          throw new RetryableError("Temporary failure");
        }
        return "success after retry";
      },
      { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 50 }
    );
    if (result !== "success after retry") throw new Error("Wrong result");
    if (callCount !== 3) throw new Error(`Expected 3 calls, got ${callCount}`);
  });

  // Test 3: Non-retryable error throws immediately
  await test("Non-retryable error throws immediately", async () => {
    let callCount = 0;
    try {
      await withRetry(
        async () => {
          callCount++;
          throw new Error("Non-retryable error");
        },
        { maxRetries: 3, initialDelayMs: 10 }
      );
      throw new Error("Should have thrown");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Non-retryable error") {
        throw new Error("Wrong error");
      }
      if (callCount !== 1) throw new Error(`Expected 1 call, got ${callCount}`);
    }
  });

  // Test 4: Max retries exceeded
  await test("Throws after max retries exceeded", async () => {
    let callCount = 0;
    try {
      await withRetry(
        async () => {
          callCount++;
          throw new RetryableError("Always failing");
        },
        { maxRetries: 2, initialDelayMs: 10, maxDelayMs: 50 }
      );
      throw new Error("Should have thrown");
    } catch (error) {
      if (!(error instanceof RetryableError)) {
        throw new Error("Wrong error type");
      }
      // Initial call + 2 retries = 3 calls
      if (callCount !== 3) throw new Error(`Expected 3 calls, got ${callCount}`);
    }
  });

  // Test 5: onRetry callback is called
  await test("onRetry callback is called on each retry", async () => {
    let callCount = 0;
    const retryAttempts: number[] = [];
    await withRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          throw new RetryableError("Temp error");
        }
        return "done";
      },
      {
        maxRetries: 3,
        initialDelayMs: 10,
        onRetry: (_error, attempt) => {
          retryAttempts.push(attempt);
        },
      }
    );
    if (retryAttempts.length !== 2) {
      throw new Error(`Expected 2 retry callbacks, got ${retryAttempts.length}`);
    }
    if (retryAttempts[0] !== 1 || retryAttempts[1] !== 2) {
      throw new Error(`Wrong retry attempts: ${retryAttempts}`);
    }
  });

  // Test 6: isRetryableError detects various error types
  await test("isRetryableError detects retryable errors", async () => {
    // RetryableError
    if (!isRetryableError(new RetryableError("test"))) {
      throw new Error("Should detect RetryableError");
    }

    // 429 status
    if (!isRetryableError(new Error("API error: 429 - Rate limited"))) {
      throw new Error("Should detect 429 errors");
    }

    // 500 status
    if (!isRetryableError(new Error("API error: 500 - Server error"))) {
      throw new Error("Should detect 500 errors");
    }

    // Connection errors
    if (!isRetryableError(new Error("ECONNREFUSED"))) {
      throw new Error("Should detect connection refused");
    }

    // Non-retryable errors
    if (isRetryableError(new Error("API error: 400 - Bad request"))) {
      throw new Error("Should NOT detect 400 as retryable");
    }

    if (isRetryableError(new Error("Some random error"))) {
      throw new Error("Should NOT detect random errors as retryable");
    }
  });

  // Test 7: Disabled retry (retry: false)
  await test("Disabled retry throws immediately", async () => {
    let callCount = 0;
    try {
      await withRetry(
        async () => {
          callCount++;
          throw new RetryableError("Would normally retry");
        },
        { maxRetries: 0 }
      );
      throw new Error("Should have thrown");
    } catch (error) {
      if (!(error instanceof RetryableError)) {
        throw new Error("Wrong error type");
      }
      if (callCount !== 1) throw new Error(`Expected 1 call, got ${callCount}`);
    }
  });

  console.log("\nAll tests completed!");
}

runTests().catch(console.error);
