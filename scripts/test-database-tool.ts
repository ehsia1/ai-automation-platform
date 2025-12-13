#!/usr/bin/env npx tsx
/**
 * Test script for the PostgreSQL database tools
 *
 * Tests:
 * 1. Basic query execution
 * 2. Schema discovery
 * 3. Read-only enforcement (blocks INSERT/UPDATE/DELETE)
 * 4. Sample data quality queries to find data errors
 */

import { postgresQueryTool, postgresSchemaTool } from "../packages/core/src/tools/database";
import type { ToolContext } from "../packages/core/src/tools/types";

// Set DATABASE_URL for local testing
const DATABASE_URL = "postgresql://evan@localhost:5432/ai_automation_test";
process.env.DATABASE_URL = DATABASE_URL;

const context: ToolContext = {
  workspaceId: "test",
  runId: "test-run-db",
};

async function runTest(name: string, tool: { execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<{ success: boolean; output: string; error?: string; metadata?: unknown }> }, args: Record<string, unknown>) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log("=".repeat(60));
  console.log("Args:", JSON.stringify(args, null, 2));

  const result = await tool.execute(args, context);

  if (result.success) {
    console.log("\n✅ SUCCESS");
    console.log(result.output);
    if (result.metadata) {
      console.log("\nMetadata:", JSON.stringify(result.metadata, null, 2));
    }
  } else {
    console.log("\n❌ FAILED");
    console.log("Error:", result.error);
  }

  return result;
}

async function main() {
  console.log("🔍 PostgreSQL Database Tools Test");
  console.log(`Database: ${DATABASE_URL}\n`);

  // Test 1: Schema discovery - list all tables
  await runTest("List all tables", postgresSchemaTool, {});

  // Test 2: Schema discovery - specific table
  await runTest("Get customers table schema", postgresSchemaTool, {
    table_name: "customers",
  });

  // Test 3: Basic SELECT query
  await runTest("Select all customers", postgresQueryTool, {
    query: "SELECT * FROM customers",
  });

  // Test 4: Query with aggregation
  await runTest("Count orders by status", postgresQueryTool, {
    query: "SELECT status, COUNT(*) as count, SUM(total_amount) as total FROM orders GROUP BY status",
  });

  // Test 5: Find data errors - negative balances
  await runTest("Find negative customer balances", postgresQueryTool, {
    query: "SELECT id, email, name, balance FROM customers WHERE balance < 0",
  });

  // Test 6: Find data errors - empty names
  await runTest("Find customers with empty names", postgresQueryTool, {
    query: "SELECT id, email, name, balance FROM customers WHERE name = '' OR name IS NULL",
  });

  // Test 7: Find data errors - duplicate emails
  await runTest("Find duplicate emails", postgresQueryTool, {
    query: `
      SELECT email, COUNT(*) as count
      FROM customers
      GROUP BY email
      HAVING COUNT(*) > 1
    `,
  });

  // Test 8: Find data errors - wrong order totals
  await runTest("Find orders where items don't match total", postgresQueryTool, {
    query: `
      SELECT
        o.id as order_id,
        o.total_amount as order_total,
        SUM(oi.line_total) as items_total,
        o.total_amount - SUM(oi.line_total) as discrepancy
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id, o.total_amount
      HAVING o.total_amount != COALESCE(SUM(oi.line_total), 0)
    `,
  });

  // Test 9: Find data errors - wrong line totals
  await runTest("Find order items with incorrect line totals", postgresQueryTool, {
    query: `
      SELECT
        id,
        product_name,
        quantity,
        unit_price,
        line_total,
        quantity * unit_price as expected_total,
        line_total - (quantity * unit_price) as discrepancy
      FROM order_items
      WHERE line_total != quantity * unit_price
    `,
  });

  // Test 10: Find data errors - duplicate refunds
  await runTest("Find duplicate transactions", postgresQueryTool, {
    query: `
      SELECT
        customer_id,
        type,
        reference_id,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM transactions
      WHERE reference_id IS NOT NULL
      GROUP BY customer_id, type, reference_id
      HAVING COUNT(*) > 1
    `,
  });

  // Test 11: Read-only enforcement - should FAIL
  console.log("\n" + "=".repeat(60));
  console.log("SECURITY TESTS - These should fail:");
  console.log("=".repeat(60));

  await runTest("Block INSERT (should fail)", postgresQueryTool, {
    query: "INSERT INTO customers (email, name) VALUES ('hacker@evil.com', 'Hacker')",
  });

  await runTest("Block UPDATE (should fail)", postgresQueryTool, {
    query: "UPDATE customers SET balance = 1000000 WHERE id = 1",
  });

  await runTest("Block DELETE (should fail)", postgresQueryTool, {
    query: "DELETE FROM customers WHERE id = 1",
  });

  await runTest("Block DROP (should fail)", postgresQueryTool, {
    query: "DROP TABLE customers",
  });

  await runTest("Block TRUNCATE (should fail)", postgresQueryTool, {
    query: "TRUNCATE customers",
  });

  // Test 12: CTE query (should work)
  await runTest("CTE query for customer analysis", postgresQueryTool, {
    query: `
      WITH customer_stats AS (
        SELECT
          c.id,
          c.email,
          c.name,
          c.balance,
          COUNT(o.id) as order_count,
          COALESCE(SUM(o.total_amount), 0) as total_spent
        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id
        GROUP BY c.id, c.email, c.name, c.balance
      )
      SELECT * FROM customer_stats
      ORDER BY total_spent DESC
    `,
  });

  console.log("\n" + "=".repeat(60));
  console.log("✅ All tests completed!");
  console.log("=".repeat(60));
}

main().catch(console.error);
