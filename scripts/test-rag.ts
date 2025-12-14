/**
 * Test script for RAG functionality
 *
 * Tests document indexing and semantic search locally using Ollama.
 *
 * Prerequisites:
 * - Ollama running locally with nomic-embed-text model
 *   Run: ollama pull nomic-embed-text
 *
 * Usage:
 * npx tsx scripts/test-rag.ts
 */

import { getRagClient, type Document } from "../packages/core/src/rag";

async function main() {
  console.log("🔍 RAG Test Script\n");

  // Sample documents
  const documents: Document[] = [
    {
      id: "runbook-payment-timeouts",
      content: `# Payment Service Timeout Handling

## Overview
This runbook covers how to handle timeout errors in the payment service.

## Symptoms
- API requests to /v1/payments/process returning 504 Gateway Timeout
- Payment processing jobs stuck in "pending" state
- High latency alerts from payment-service

## Root Causes
1. Database connection pool exhaustion
2. Third-party payment gateway slowness
3. Transaction deadlocks

## Resolution Steps

### 1. Check Database Connections
\`\`\`sql
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
\`\`\`

### 2. Verify Payment Gateway Status
Check the Stripe/PayPal status pages for any ongoing incidents.

### 3. Clear Stuck Transactions
\`\`\`sql
UPDATE payments SET status = 'failed'
WHERE status = 'pending'
AND created_at < NOW() - INTERVAL '30 minutes';
\`\`\`

## Escalation
Contact: payments-team@company.com
PagerDuty: payments-oncall`,
      metadata: {
        source: "runbook",
        service: "payment-service",
        title: "Payment Service Timeout Handling",
        path: "runbooks/payment-timeouts.md",
      },
    },
    {
      id: "runbook-db-connection-errors",
      content: `# Database Connection Error Handling

## Overview
Handling database connection failures across services.

## Symptoms
- "Connection refused" errors in logs
- "Too many connections" PostgreSQL errors
- Services failing to start

## Resolution Steps

### Check Database Status
\`\`\`bash
psql -h $DB_HOST -U postgres -c "SELECT 1"
\`\`\`

### Connection Pool Tuning
Adjust MAX_POOL_SIZE environment variable (default: 10).

### Emergency: Kill Idle Connections
\`\`\`sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
AND query_start < NOW() - INTERVAL '10 minutes';
\`\`\``,
      metadata: {
        source: "runbook",
        title: "Database Connection Error Handling",
        path: "runbooks/db-connections.md",
      },
    },
    {
      id: "incident-2024-01-15",
      content: `# Incident Report: Payment Processing Outage

**Date**: January 15, 2024
**Duration**: 2 hours 15 minutes
**Severity**: SEV-1

## Summary
Complete payment processing outage affecting all customers.

## Timeline
- 14:00 UTC: Alerts fired for payment-service latency
- 14:15 UTC: Incident declared, on-call paged
- 14:30 UTC: Root cause identified - database connection leak
- 15:45 UTC: Fix deployed, service recovered
- 16:15 UTC: All-clear declared

## Root Cause
A recent code change introduced a bug where database connections were not being properly released after failed transactions. This caused connection pool exhaustion within 3 hours of deployment.

## Resolution
Reverted the problematic commit and manually cleared stuck connections.

## Action Items
1. Add connection leak detection tests
2. Implement connection pool monitoring
3. Set up automatic connection cleanup cron job`,
      metadata: {
        source: "incident",
        service: "payment-service",
        title: "Payment Processing Outage - Jan 2024",
        timestamp: "2024-01-15T16:15:00Z",
      },
    },
  ];

  try {
    // Initialize RAG client
    console.log("Initializing RAG client...");
    const client = getRagClient();
    await client.initialize();

    // Index documents
    console.log("\n📄 Indexing documents...");
    const totalChunks = await client.indexDocuments(documents);
    console.log(`Indexed ${documents.length} documents (${totalChunks} chunks)`);

    // Get stats
    const stats = await client.stats();
    console.log(`\n📊 Index stats: ${stats.totalDocuments} docs, ${stats.totalChunks} chunks`);

    // Test searches
    const testQueries = [
      "payment timeout errors",
      "database connection pool issues",
      "how to fix stuck transactions",
      "previous incidents with payment service",
    ];

    console.log("\n🔎 Running test searches...\n");

    for (const query of testQueries) {
      console.log(`\n--- Query: "${query}" ---`);
      const results = await client.search(query, { limit: 2 });

      if (results.length === 0) {
        console.log("No results found");
      } else {
        for (const result of results) {
          const { chunk, score } = result;
          console.log(
            `\n  [${(score * 100).toFixed(1)}%] ${chunk.metadata.title || chunk.documentId}`
          );
          console.log(`  Type: ${chunk.metadata.source}`);
          console.log(`  Preview: ${chunk.content.slice(0, 150)}...`);
        }
      }
    }

    // Test context generation
    console.log("\n\n📝 Testing context generation...");
    const context = await client.getContext("payment timeouts and database issues");
    console.log("\n" + context.slice(0, 500) + "...");

    console.log("\n\n✅ RAG test completed successfully!");
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
