/**
 * Database Query Tools
 *
 * Read-only database query tools for investigating data issues.
 * Supports PostgreSQL initially, designed for extensibility.
 */

import pg from "pg";
import type { Tool, ToolResult, ToolContext } from "./types";
import type { ToolDefinition } from "../llm/providers/types";

const { Pool } = pg;

// ============================================================================
// Query Validation
// ============================================================================

/**
 * Validates that a SQL query is read-only (no mutations).
 * Returns { valid: true } or { valid: false, reason: string }
 */
function validateReadOnlyQuery(query: string): { valid: boolean; reason?: string } {
  // Normalize: remove comments, collapse whitespace
  const normalized = query
    .replace(/--.*$/gm, "") // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim()
    .toUpperCase();

  // Empty query check
  if (!normalized) {
    return { valid: false, reason: "Empty query" };
  }

  // Allowed statement prefixes
  const allowedPrefixes = [
    "SELECT",
    "WITH", // CTEs - will validate they end in SELECT
    "SHOW",
    "DESCRIBE",
    "DESC",
    "EXPLAIN",
    "TABLE", // PostgreSQL shorthand for SELECT * FROM
  ];

  const startsWithAllowed = allowedPrefixes.some((prefix) =>
    normalized.startsWith(prefix + " ") || normalized === prefix
  );

  if (!startsWithAllowed) {
    return {
      valid: false,
      reason: `Query must start with one of: ${allowedPrefixes.join(", ")}. Got: ${normalized.split(" ")[0]}`,
    };
  }

  // Dangerous keywords that should never appear
  const dangerousKeywords = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "CREATE",
    "ALTER",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
    "EXEC",
    "EXECUTE",
    "CALL", // Stored procedures
    "INTO", // SELECT INTO creates tables
    "COPY", // PostgreSQL bulk operations
    "VACUUM",
    "REINDEX",
    "CLUSTER",
  ];

  for (const keyword of dangerousKeywords) {
    // Check for keyword as a whole word (not part of column name)
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(normalized)) {
      // Special case: "INTO" is OK in subqueries like "SELECT ... WHERE x IN (SELECT ...)"
      // But not OK in "SELECT ... INTO table_name"
      if (keyword === "INTO") {
        // Check if INTO appears after SELECT without being in a subquery context
        const intoIndex = normalized.indexOf("INTO");
        const beforeInto = normalized.substring(0, intoIndex);
        // If there's no opening paren before INTO (not in subquery), it's creating a table
        const openParens = (beforeInto.match(/\(/g) || []).length;
        const closeParens = (beforeInto.match(/\)/g) || []).length;
        if (openParens <= closeParens) {
          return {
            valid: false,
            reason: `SELECT INTO is not allowed (creates tables). Use plain SELECT instead.`,
          };
        }
        continue; // INTO in subquery is OK
      }
      return {
        valid: false,
        reason: `Dangerous keyword "${keyword}" is not allowed in read-only queries`,
      };
    }
  }

  // Validate WITH statements end in SELECT (not INSERT/UPDATE/DELETE)
  if (normalized.startsWith("WITH")) {
    // Find the main query after CTEs
    // CTEs are: WITH name AS (...), name2 AS (...) SELECT/INSERT/etc
    // We need to find the final statement
    let depth = 0;
    let lastKeywordStart = -1;

    for (let i = 0; i < normalized.length; i++) {
      if (normalized[i] === "(") depth++;
      if (normalized[i] === ")") depth--;
      if (depth === 0 && i > 4) {
        // Outside CTEs
        // Look for main statement keywords
        const remaining = normalized.substring(i).trim();
        for (const keyword of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          if (remaining.startsWith(keyword + " ") || remaining === keyword) {
            lastKeywordStart = i;
            if (keyword !== "SELECT") {
              return {
                valid: false,
                reason: `WITH clause must end with SELECT, not ${keyword}`,
              };
            }
            break;
          }
        }
      }
    }
  }

  return { valid: true };
}

// ============================================================================
// Result Formatting
// ============================================================================

/**
 * Formats query results as a readable table string
 */
function formatResults(rows: Record<string, unknown>[], rowCount: number, maxRows: number): string {
  if (rows.length === 0) {
    return "No results returned.";
  }

  const columns = Object.keys(rows[0]);
  const truncated = rowCount > maxRows;

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const col of columns) {
    widths[col] = col.length;
    for (const row of rows) {
      const val = String(row[col] ?? "NULL");
      widths[col] = Math.max(widths[col], Math.min(val.length, 50)); // Cap at 50 chars
    }
  }

  // Build header
  const header = columns.map((col) => col.padEnd(widths[col])).join(" | ");
  const separator = columns.map((col) => "-".repeat(widths[col])).join("-+-");

  // Build rows
  const rowStrings = rows.map((row) =>
    columns
      .map((col) => {
        let val = String(row[col] ?? "NULL");
        if (val.length > 50) val = val.substring(0, 47) + "...";
        return val.padEnd(widths[col]);
      })
      .join(" | ")
  );

  let result = `${header}\n${separator}\n${rowStrings.join("\n")}`;

  if (truncated) {
    result += `\n\n... (showing ${rows.length} of ${rowCount} rows, limited to ${maxRows})`;
  } else {
    result += `\n\n(${rows.length} row${rows.length === 1 ? "" : "s"})`;
  }

  return result;
}

// ============================================================================
// PostgreSQL Query Tool
// ============================================================================

const PG_QUERY_TOOL_NAME = "postgres_query";

interface PostgresQueryArgs {
  connection_string?: string;
  connection_name?: string;
  query: string;
  max_rows?: number;
}

const postgresQueryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: PG_QUERY_TOOL_NAME,
    description: `Execute a read-only SQL query against a PostgreSQL database. Use this to investigate data issues, verify data integrity, check for malformed data, or replicate bugs.

IMPORTANT: Only SELECT queries are allowed. INSERT, UPDATE, DELETE, and DDL statements are blocked.

Connection options:
1. Use 'connection_name' to reference a pre-configured database (recommended)
2. Use 'connection_string' for ad-hoc connections (requires explicit approval)

Example queries:
- Check for NULL values: SELECT * FROM users WHERE email IS NULL LIMIT 10
- Find duplicates: SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1
- Data validation: SELECT * FROM orders WHERE total < 0 OR quantity <= 0
- Recent errors: SELECT * FROM error_logs WHERE created_at > NOW() - INTERVAL '1 hour' ORDER BY created_at DESC`,
    parameters: {
      type: "object",
      properties: {
        connection_name: {
          type: "string",
          description:
            "Name of a pre-configured database connection (e.g., 'production', 'staging', 'analytics'). Connections are configured via environment variables like DB_PRODUCTION_URL.",
        },
        connection_string: {
          type: "string",
          description:
            "PostgreSQL connection string (e.g., postgres://user:pass@host:5432/dbname). Use only if connection_name is not available. Will be logged for audit.",
        },
        query: {
          type: "string",
          description:
            "SQL query to execute. Must be a SELECT statement. Use LIMIT to control result size.",
        },
        max_rows: {
          type: "number",
          description: "Maximum number of rows to return (default: 100, max: 1000)",
        },
      },
      required: ["query"],
    },
  },
};

// Connection pool cache for reuse
const poolCache = new Map<string, pg.Pool>();

function getPool(connectionString: string): pg.Pool {
  let pool = poolCache.get(connectionString);
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5, // Max connections in pool
      idleTimeoutMillis: 30000, // Close idle connections after 30s
      connectionTimeoutMillis: 10000, // Connection timeout 10s
    });
    poolCache.set(connectionString, pool);
  }
  return pool;
}

function resolveConnectionString(args: Partial<PostgresQueryArgs>): string | null {
  // Priority 1: Named connection from environment
  if (args.connection_name) {
    const envKey = `DB_${args.connection_name.toUpperCase().replace(/-/g, "_")}_URL`;
    const url = process.env[envKey];
    if (url) return url;

    // Also try without _URL suffix
    const envKey2 = `DB_${args.connection_name.toUpperCase().replace(/-/g, "_")}`;
    const url2 = process.env[envKey2];
    if (url2) return url2;
  }

  // Priority 2: Direct connection string
  if (args.connection_string) {
    return args.connection_string;
  }

  // Priority 3: Default DATABASE_URL
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  return null;
}

async function executePostgresQuery(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const typedArgs = args as unknown as Partial<PostgresQueryArgs>;
  const { query, max_rows = 100, connection_name, connection_string } = typedArgs;

  // Validate query exists
  if (!query || typeof query !== "string") {
    return {
      success: false,
      output: "",
      error: "Missing required parameter: query",
    };
  }

  // Validate read-only
  const validation = validateReadOnlyQuery(query);
  if (!validation.valid) {
    return {
      success: false,
      output: "",
      error: `Query validation failed: ${validation.reason}`,
    };
  }

  // Resolve connection string
  const resolvedConnection = resolveConnectionString({ query, connection_name, connection_string });
  if (!resolvedConnection) {
    const availableConnections: string[] = [];
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("DB_") && key.endsWith("_URL")) {
        availableConnections.push(key.replace("DB_", "").replace("_URL", "").toLowerCase());
      }
    }

    return {
      success: false,
      output: "",
      error: `No database connection available. ${
        availableConnections.length > 0
          ? `Available connections: ${availableConnections.join(", ")}`
          : "Set DATABASE_URL or DB_<NAME>_URL environment variable."
      }`,
    };
  }

  // Clamp max_rows
  const effectiveMaxRows = Math.min(Math.max(1, max_rows || 100), 1000);

  // Add LIMIT if not present (safety net)
  let effectiveQuery = query.trim();
  if (!effectiveQuery.toUpperCase().includes("LIMIT")) {
    effectiveQuery = `${effectiveQuery} LIMIT ${effectiveMaxRows + 1}`;
  }

  try {
    const pool = getPool(resolvedConnection);

    // Execute with timeout
    const client = await pool.connect();
    try {
      // Set statement timeout (30 seconds)
      await client.query("SET statement_timeout = 30000");

      const result = await client.query(effectiveQuery);

      const rowCount = result.rowCount ?? result.rows.length;
      const rows = result.rows.slice(0, effectiveMaxRows);

      // Mask connection string for logging (hide password)
      const maskedConnection = resolvedConnection.replace(
        /(:\/\/[^:]+:)[^@]+(@)/,
        "$1****$2"
      );

      const output = formatResults(rows, rowCount, effectiveMaxRows);
      const connectionInfo = connection_name
        ? `Connection: ${connection_name}`
        : `Connection: ${maskedConnection.split("/").pop()}`; // Just show database name

      return {
        success: true,
        output: `${connectionInfo}\n\n${output}`,
        metadata: {
          row_count: rowCount,
          rows_returned: rows.length,
          columns: result.fields?.map((f) => f.name) || [],
          connection: connection_name || "direct",
        },
      };
    } finally {
      client.release();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful error messages
    if (errorMessage.includes("ECONNREFUSED")) {
      return {
        success: false,
        output: "",
        error: `Database connection refused. Check if the database is running and accessible.`,
      };
    }
    if (errorMessage.includes("authentication failed")) {
      return {
        success: false,
        output: "",
        error: `Database authentication failed. Check credentials.`,
      };
    }
    if (errorMessage.includes("statement timeout")) {
      return {
        success: false,
        output: "",
        error: `Query timed out (30s limit). Try adding more specific WHERE conditions or LIMIT clause.`,
      };
    }
    if (errorMessage.includes("relation") && errorMessage.includes("does not exist")) {
      return {
        success: false,
        output: "",
        error: `Table not found: ${errorMessage}. Use "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'" to list available tables.`,
      };
    }

    return {
      success: false,
      output: "",
      error: `Query failed: ${errorMessage}`,
    };
  }
}

export const postgresQueryTool: Tool = {
  name: PG_QUERY_TOOL_NAME,
  description: postgresQueryDefinition.function.description,
  riskTier: "read_only", // Read-only queries are safe
  definition: postgresQueryDefinition,
  execute: executePostgresQuery,
};

// ============================================================================
// Database Schema Tool (for discovery)
// ============================================================================

const PG_SCHEMA_TOOL_NAME = "postgres_schema";

const postgresSchemaDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: PG_SCHEMA_TOOL_NAME,
    description: `Get the schema information for a PostgreSQL database. Use this to discover tables, columns, and their types before writing queries.

Returns:
- List of tables in the database
- Columns with their types for a specific table
- Foreign key relationships`,
    parameters: {
      type: "object",
      properties: {
        connection_name: {
          type: "string",
          description: "Name of a pre-configured database connection",
        },
        connection_string: {
          type: "string",
          description: "PostgreSQL connection string (if connection_name not available)",
        },
        table_name: {
          type: "string",
          description:
            "Specific table to get schema for. If omitted, lists all tables.",
        },
        schema_name: {
          type: "string",
          description: "Schema to query (default: 'public')",
        },
      },
      required: [],
    },
  },
};

interface SchemaArgs {
  connection_name?: string;
  connection_string?: string;
  table_name?: string;
  schema_name?: string;
}

async function executePostgresSchema(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const typedArgs = args as unknown as SchemaArgs;
  const {
    connection_name,
    connection_string,
    table_name,
    schema_name = "public",
  } = typedArgs;

  const resolvedConnection = resolveConnectionString({
    connection_name,
    connection_string,
  });

  if (!resolvedConnection) {
    return {
      success: false,
      output: "",
      error: "No database connection available. Set DATABASE_URL or use connection_name.",
    };
  }

  try {
    const pool = getPool(resolvedConnection);
    const client = await pool.connect();

    try {
      if (table_name) {
        // Get specific table schema
        const columnsResult = await client.query(
          `SELECT
            column_name,
            data_type,
            is_nullable,
            column_default,
            character_maximum_length
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position`,
          [schema_name, table_name]
        );

        if (columnsResult.rows.length === 0) {
          return {
            success: false,
            output: "",
            error: `Table "${schema_name}.${table_name}" not found`,
          };
        }

        // Get primary key
        const pkResult = await client.query(
          `SELECT a.attname as column_name
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary`,
          [`${schema_name}.${table_name}`]
        );
        const pkColumns = pkResult.rows.map((r) => r.column_name);

        // Get foreign keys
        const fkResult = await client.query(
          `SELECT
            kcu.column_name,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
          WHERE tc.table_schema = $1
            AND tc.table_name = $2
            AND tc.constraint_type = 'FOREIGN KEY'`,
          [schema_name, table_name]
        );

        // Format output
        let output = `Table: ${schema_name}.${table_name}\n`;
        output += "=".repeat(60) + "\n\n";
        output += "Columns:\n";
        output += "-".repeat(60) + "\n";

        for (const col of columnsResult.rows) {
          const pk = pkColumns.includes(col.column_name) ? " [PK]" : "";
          const nullable = col.is_nullable === "YES" ? " NULL" : " NOT NULL";
          const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : "";
          const length = col.character_maximum_length
            ? `(${col.character_maximum_length})`
            : "";
          output += `  ${col.column_name}: ${col.data_type}${length}${nullable}${defaultVal}${pk}\n`;
        }

        if (fkResult.rows.length > 0) {
          output += "\nForeign Keys:\n";
          output += "-".repeat(60) + "\n";
          for (const fk of fkResult.rows) {
            output += `  ${fk.column_name} -> ${fk.foreign_table}.${fk.foreign_column}\n`;
          }
        }

        // Get row count estimate
        const countResult = await client.query(
          `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = $1`,
          [table_name]
        );
        if (countResult.rows[0]) {
          output += `\nEstimated rows: ~${countResult.rows[0].estimate.toLocaleString()}`;
        }

        return {
          success: true,
          output,
          metadata: {
            table: table_name,
            schema: schema_name,
            column_count: columnsResult.rows.length,
          },
        };
      } else {
        // List all tables
        const tablesResult = await client.query(
          `SELECT
            t.table_name,
            pg_size_pretty(pg_total_relation_size(quote_ident(t.table_name))) as size,
            (SELECT reltuples::bigint FROM pg_class WHERE relname = t.table_name) as row_estimate,
            obj_description((quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass, 'pg_class') as description
          FROM information_schema.tables t
          WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE'
          ORDER BY t.table_name`,
          [schema_name]
        );

        if (tablesResult.rows.length === 0) {
          return {
            success: true,
            output: `No tables found in schema "${schema_name}"`,
          };
        }

        let output = `Tables in schema: ${schema_name}\n`;
        output += "=".repeat(60) + "\n\n";

        for (const table of tablesResult.rows) {
          const desc = table.description ? ` - ${table.description}` : "";
          output += `  ${table.table_name.padEnd(30)} ${table.size.padStart(10)} ~${(table.row_estimate || 0).toLocaleString()} rows${desc}\n`;
        }

        return {
          success: true,
          output,
          metadata: {
            schema: schema_name,
            table_count: tablesResult.rows.length,
          },
        };
      }
    } finally {
      client.release();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `Schema query failed: ${errorMessage}`,
    };
  }
}

export const postgresSchemaTool: Tool = {
  name: PG_SCHEMA_TOOL_NAME,
  description: postgresSchemaDefinition.function.description,
  riskTier: "read_only",
  definition: postgresSchemaDefinition,
  execute: executePostgresSchema,
};
