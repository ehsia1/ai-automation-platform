/**
 * Seeds CloudWatch with synthetic test logs for agent testing
 * Run with: npx tsx scripts/seed-test-logs.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from "@aws-sdk/client-cloudwatch-logs";

const LOG_GROUP_NAME = "/ai-automation-platform/test-service";
const LOG_STREAM_NAME = "calculator-service";

const client = new CloudWatchLogsClient({});

// Generate realistic error logs for the calculator service
function generateTestLogs(): Array<{ timestamp: number; message: string }> {
  const now = Date.now();
  const logs: Array<{ timestamp: number; message: string }> = [];

  // Generate logs over the past hour with some patterns
  const correlationId = `corr-${Math.random().toString(36).substring(7)}`;

  // Normal request logs leading up to the error
  logs.push({
    timestamp: now - 60 * 60 * 1000, // 1 hour ago
    message: JSON.stringify({
      level: "INFO",
      service: "calculator-service",
      message: "Service started",
      version: "1.2.3",
    }),
  });

  // Simulate a series of successful requests
  for (let i = 5; i >= 1; i--) {
    logs.push({
      timestamp: now - i * 10 * 60 * 1000, // Every 10 minutes
      message: JSON.stringify({
        level: "INFO",
        service: "calculator-service",
        message: "Request processed successfully",
        path: "/api/calculate",
        method: "POST",
        params: { operation: "multiply", a: Math.floor(Math.random() * 100), b: Math.floor(Math.random() * 100) },
        duration_ms: Math.floor(Math.random() * 50) + 10,
        correlation_id: `corr-${Math.random().toString(36).substring(7)}`,
      }),
    });
  }

  // The problematic request that causes the error
  logs.push({
    timestamp: now - 5 * 60 * 1000, // 5 minutes ago
    message: JSON.stringify({
      level: "INFO",
      service: "calculator-service",
      message: "Request received",
      path: "/api/calculate",
      method: "POST",
      params: { operation: "divide", a: 10, b: 0 },
      correlation_id: correlationId,
    }),
  });

  // The error itself
  logs.push({
    timestamp: now - 5 * 60 * 1000 + 100,
    message: JSON.stringify({
      level: "ERROR",
      service: "calculator-service",
      message: "ZeroDivisionError: division by zero",
      error_type: "ZeroDivisionError",
      function: "divide",
      file: "src/calculator.py",
      line: 5,
      correlation_id: correlationId,
    }),
  });

  // Stack trace
  logs.push({
    timestamp: now - 5 * 60 * 1000 + 200,
    message: JSON.stringify({
      level: "ERROR",
      service: "calculator-service",
      message: "Traceback (most recent call last):\n  File \"src/calculator.py\", line 5, in divide\n    return a / b\nZeroDivisionError: division by zero",
      correlation_id: correlationId,
    }),
  });

  // More errors at different times to show a pattern
  for (let i = 4; i >= 1; i--) {
    const errorCorrelationId = `corr-${Math.random().toString(36).substring(7)}`;
    logs.push({
      timestamp: now - i * 60 * 1000,
      message: JSON.stringify({
        level: "ERROR",
        service: "calculator-service",
        message: "ZeroDivisionError: division by zero",
        error_type: "ZeroDivisionError",
        function: "divide",
        file: "src/calculator.py",
        line: 5,
        params: { a: Math.floor(Math.random() * 100), b: 0 },
        correlation_id: errorCorrelationId,
      }),
    });
  }

  // Sort by timestamp
  return logs.sort((a, b) => a.timestamp - b.timestamp);
}

async function createLogGroup(): Promise<void> {
  try {
    await client.send(new CreateLogGroupCommand({ logGroupName: LOG_GROUP_NAME }));
    console.log(`✅ Created log group: ${LOG_GROUP_NAME}`);
  } catch (error) {
    if (error instanceof ResourceAlreadyExistsException) {
      console.log(`ℹ️ Log group already exists: ${LOG_GROUP_NAME}`);
    } else {
      throw error;
    }
  }
}

async function createLogStream(): Promise<void> {
  try {
    await client.send(new CreateLogStreamCommand({
      logGroupName: LOG_GROUP_NAME,
      logStreamName: LOG_STREAM_NAME,
    }));
    console.log(`✅ Created log stream: ${LOG_STREAM_NAME}`);
  } catch (error) {
    if (error instanceof ResourceAlreadyExistsException) {
      console.log(`ℹ️ Log stream already exists: ${LOG_STREAM_NAME}`);
    } else {
      throw error;
    }
  }
}

async function putLogEvents(logs: Array<{ timestamp: number; message: string }>): Promise<void> {
  // CloudWatch requires events to be in chronological order and has a limit per batch
  const BATCH_SIZE = 100;

  for (let i = 0; i < logs.length; i += BATCH_SIZE) {
    const batch = logs.slice(i, i + BATCH_SIZE);

    await client.send(new PutLogEventsCommand({
      logGroupName: LOG_GROUP_NAME,
      logStreamName: LOG_STREAM_NAME,
      logEvents: batch,
    }));

    console.log(`✅ Published ${batch.length} log events (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
  }
}

async function main(): Promise<void> {
  console.log("🚀 Seeding CloudWatch with test logs...\n");

  try {
    await createLogGroup();
    await createLogStream();

    const logs = generateTestLogs();
    console.log(`\n📝 Generated ${logs.length} test log events`);

    await putLogEvents(logs);

    console.log("\n✅ Done! Test logs are ready.");
    console.log(`\nLog group: ${LOG_GROUP_NAME}`);
    console.log(`Log stream: ${LOG_STREAM_NAME}`);
    console.log("\nSample CloudWatch Insights query:");
    console.log(`  fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20`);
  } catch (error) {
    console.error("❌ Error seeding logs:", error);
    process.exit(1);
  }
}

main();
