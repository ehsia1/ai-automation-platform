#!/usr/bin/env npx tsx
/**
 * Test CloudWatch Query Tool
 */
import * as dotenv from "dotenv";
dotenv.config();

import { cloudwatchQueryLogsTool } from "../packages/core/src/tools/cloudwatch";

async function main() {
  console.log("🧪 Testing CloudWatch Query Tool...\n");

  const context = { runId: "test", workspaceId: "test" };

  // Test 1: Query logs
  console.log("Test 1: Query recent logs from test log group");
  const result = await cloudwatchQueryLogsTool.execute({
    log_group: "/ai-automation-platform/test-service",
    query: "fields @timestamp, @message | sort @timestamp desc | limit 5",
    start_time: "1h"
  }, context);

  console.log("Success:", result.success);
  if (result.output.length > 500) {
    console.log("Output:", result.output.slice(0, 500) + "...");
  } else {
    console.log("Output:", result.output);
  }
}

main().catch(console.error);
