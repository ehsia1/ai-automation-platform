/**
 * Direct test of CloudWatch tool to debug why query returns no results
 */
import * as dotenv from "dotenv";
dotenv.config();

import { cloudwatchQueryLogsTool } from "../packages/core/src/tools/cloudwatch.js";

async function main() {
  console.log("Testing CloudWatch tool directly...\n");
  console.log("Current time:", new Date().toISOString());
  
  const result = await cloudwatchQueryLogsTool.execute(
    {
      log_group: "/ai-automation-platform/test-service",
      query: "fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 5",
      start_time: "1h ago",
      end_time: "now",
    },
    { runId: "test", workspaceId: "local" }
  );

  console.log("\nResult:", JSON.stringify(result, null, 2));
}

main().catch(console.error);
