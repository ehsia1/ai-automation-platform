/**
 * Integration configuration types
 *
 * Supports three tiers:
 * - MCP: Use existing MCP servers (highest reliability)
 * - API: Dynamic API calls via OpenAPI spec
 * - REST: Simple REST API with discovery
 */

// ============ Auth Types ============

export interface BearerAuth {
  type: "bearer";
  token: string;
}

export interface BasicAuth {
  type: "basic";
  username: string;
  password: string;
}

export interface HeaderAuth {
  type: "header";
  name: string;
  value: string;
}

export interface ApiKeyAuth {
  type: "api_key";
  key: string;
  in: "header" | "query";
  name: string;
}

export type AuthConfig = BearerAuth | BasicAuth | HeaderAuth | ApiKeyAuth;

// ============ Integration Types ============

export interface MCPIntegration {
  type: "mcp";
  /** NPM package name for the MCP server */
  package: string;
  /** Environment variables to pass to the MCP server */
  env?: Record<string, string>;
  /** Optional: specific tools to expose (default: all) */
  tools?: string[];
}

export interface APIIntegration {
  type: "api";
  /** URL to OpenAPI spec (JSON or YAML) */
  openapi: string;
  /** Authentication configuration */
  auth?: AuthConfig;
  /** Base URL override (default: from spec) */
  baseUrl?: string;
  /** Optional: specific operations to expose (default: all) */
  operations?: string[];
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export interface RESTIntegration {
  type: "rest";
  /** Base URL for the API */
  baseUrl: string;
  /** Authentication configuration */
  auth?: AuthConfig;
  /** Known endpoints (optional, agent can discover) */
  endpoints?: RESTEndpoint[];
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export interface RESTEndpoint {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description?: string;
}

export type Integration = MCPIntegration | APIIntegration | RESTIntegration;

// ============ Config Schema ============

export interface IntegrationsConfig {
  /** Version of the config schema */
  version?: string;
  /** Map of integration name to configuration */
  integrations: Record<string, Integration>;
}

// ============ Runtime Types ============

export interface IntegrationTool {
  /** Integration this tool belongs to */
  integration: string;
  /** Tool name (unique within integration) */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON schema for parameters */
  parameters: Record<string, unknown>;
  /** Risk tier for approval workflow */
  riskTier: "read_only" | "safe_write" | "destructive";
}

export interface IntegrationCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** HTTP status code if applicable */
  statusCode?: number;
  /** Metadata about the call */
  metadata?: {
    integration: string;
    operation: string;
    duration: number;
  };
}

// ============ Client Interfaces ============

export interface IntegrationClient {
  /** Name of the integration */
  name: string;
  /** Type of integration */
  type: "mcp" | "api" | "rest";
  /** Get available tools */
  getTools(): IntegrationTool[];
  /** Execute an operation */
  call(
    operation: string,
    params?: Record<string, unknown>
  ): Promise<IntegrationCallResult>;
  /** Test the connection */
  testConnection(): Promise<{ ok: boolean; message: string }>;
  /** Clean up resources */
  close(): Promise<void>;
}

// ============ OpenAPI Types (subset) ============

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, OpenAPIPathItem>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

export interface OpenAPIPathItem {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<
      string,
      {
        schema?: unknown;
      }
    >;
  };
  responses?: Record<string, unknown>;
  tags?: string[];
}

export interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: unknown;
}
