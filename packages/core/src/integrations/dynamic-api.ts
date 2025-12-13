/**
 * Dynamic API Client
 *
 * Executes API calls based on OpenAPI specs or REST discovery.
 * Handles authentication, request building, and response normalization.
 */

import type {
  APIIntegration,
  RESTIntegration,
  AuthConfig,
  IntegrationClient,
  IntegrationTool,
  IntegrationCallResult,
  OpenAPISpec,
  OpenAPIOperation,
  OpenAPIParameter,
} from "./types";

/**
 * Client for APIs with OpenAPI specification
 */
export class OpenAPIClient implements IntegrationClient {
  name: string;
  type: "api" = "api";
  private config: APIIntegration;
  private spec: OpenAPISpec | null = null;
  private baseUrl: string = "";
  private operations: Map<string, ParsedOperation> = new Map();

  constructor(name: string, config: APIIntegration) {
    this.name = name;
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Fetch and parse OpenAPI spec
    const response = await fetch(this.config.openapi);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.status}`);
    }

    const content = await response.text();
    this.spec = this.parseSpec(content);

    // Determine base URL
    this.baseUrl =
      this.config.baseUrl ||
      this.spec.servers?.[0]?.url ||
      new URL(this.config.openapi).origin;

    // Parse operations
    this.parseOperations();
  }

  private parseSpec(content: string): OpenAPISpec {
    // Try JSON first, then YAML
    try {
      return JSON.parse(content);
    } catch {
      // Simple YAML parsing for common cases
      // For production, use a proper YAML parser
      throw new Error("YAML parsing not implemented - use JSON spec");
    }
  }

  private parseOperations(): void {
    if (!this.spec) return;

    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      const methods = ["get", "post", "put", "patch", "delete"] as const;

      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;

        // Skip if not in allowed operations
        if (
          this.config.operations &&
          operation.operationId &&
          !this.config.operations.includes(operation.operationId)
        ) {
          continue;
        }

        const opName =
          operation.operationId ||
          `${method.toUpperCase()}_${path.replace(/\//g, "_")}`;

        this.operations.set(opName, {
          method: method.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
          path,
          operation,
          parameters: operation.parameters || [],
        });
      }
    }
  }

  getTools(): IntegrationTool[] {
    const tools: IntegrationTool[] = [];

    for (const [opName, parsed] of this.operations) {
      // Infer risk tier from HTTP method
      let riskTier: "read_only" | "safe_write" | "destructive" = "read_only";
      if (parsed.method === "DELETE") {
        riskTier = "destructive";
      } else if (["POST", "PUT", "PATCH"].includes(parsed.method)) {
        riskTier = "safe_write";
      }

      tools.push({
        integration: this.name,
        name: opName,
        description:
          parsed.operation.summary ||
          parsed.operation.description ||
          `${parsed.method} ${parsed.path}`,
        parameters: this.buildParameterSchema(parsed),
        riskTier,
      });
    }

    return tools;
  }

  private buildParameterSchema(
    parsed: ParsedOperation
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of parsed.parameters) {
      properties[param.name] = {
        type: "string", // Simplified - should use param.schema
        description: param.description || `${param.in} parameter`,
      };
      if (param.required) {
        required.push(param.name);
      }
    }

    // Add body parameter for POST/PUT/PATCH
    if (["POST", "PUT", "PATCH"].includes(parsed.method)) {
      properties["body"] = {
        type: "object",
        description: "Request body",
      };
    }

    return {
      type: "object",
      properties,
      required,
    };
  }

  async call(
    operation: string,
    params?: Record<string, unknown>
  ): Promise<IntegrationCallResult> {
    const startTime = Date.now();
    const parsed = this.operations.get(operation);

    if (!parsed) {
      // Try to find by natural language match
      const matched = this.findOperationByDescription(operation);
      if (!matched) {
        return {
          success: false,
          error: `Unknown operation: ${operation}. Available: ${Array.from(this.operations.keys()).join(", ")}`,
        };
      }
      return this.executeOperation(matched, params, startTime);
    }

    return this.executeOperation(parsed, params, startTime);
  }

  private findOperationByDescription(query: string): ParsedOperation | null {
    const queryLower = query.toLowerCase();

    for (const [name, parsed] of this.operations) {
      const description = (
        parsed.operation.summary ||
        parsed.operation.description ||
        name
      ).toLowerCase();

      if (
        description.includes(queryLower) ||
        name.toLowerCase().includes(queryLower)
      ) {
        return parsed;
      }
    }

    return null;
  }

  private async executeOperation(
    parsed: ParsedOperation,
    params: Record<string, unknown> | undefined,
    startTime: number
  ): Promise<IntegrationCallResult> {
    try {
      // Build URL with path parameters
      let url = this.baseUrl + parsed.path;
      const queryParams: Record<string, string> = {};
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Apply auth
      this.applyAuth(headers, queryParams);

      // Process parameters
      if (params) {
        for (const param of parsed.parameters) {
          const value = params[param.name];
          if (value === undefined) continue;

          switch (param.in) {
            case "path":
              url = url.replace(`{${param.name}}`, String(value));
              break;
            case "query":
              queryParams[param.name] = String(value);
              break;
            case "header":
              headers[param.name] = String(value);
              break;
          }
        }
      }

      // Add query params to URL
      if (Object.keys(queryParams).length > 0) {
        const qs = new URLSearchParams(queryParams).toString();
        url += (url.includes("?") ? "&" : "?") + qs;
      }

      // Make request
      const fetchOptions: RequestInit = {
        method: parsed.method,
        headers,
      };

      if (params?.body && ["POST", "PUT", "PATCH"].includes(parsed.method)) {
        fetchOptions.body = JSON.stringify(params.body);
      }

      const response = await fetch(url, fetchOptions);
      const data = await this.parseResponse(response);

      return {
        success: response.ok,
        data,
        statusCode: response.status,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        metadata: {
          integration: this.name,
          operation: parsed.operation.operationId || parsed.path,
          duration: Date.now() - startTime,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          integration: this.name,
          operation: parsed.operation.operationId || parsed.path,
          duration: Date.now() - startTime,
        },
      };
    }
  }

  private applyAuth(
    headers: Record<string, string>,
    queryParams: Record<string, string>
  ): void {
    const auth = this.config.auth;
    if (!auth) return;

    switch (auth.type) {
      case "bearer":
        headers["Authorization"] = `Bearer ${auth.token}`;
        break;
      case "basic":
        const credentials = Buffer.from(
          `${auth.username}:${auth.password}`
        ).toString("base64");
        headers["Authorization"] = `Basic ${credentials}`;
        break;
      case "header":
        headers[auth.name] = auth.value;
        break;
      case "api_key":
        if (auth.in === "header") {
          headers[auth.name] = auth.key;
        } else {
          queryParams[auth.name] = auth.key;
        }
        break;
    }
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      return response.json();
    }

    return response.text();
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      // Just check if we can fetch the spec
      const response = await fetch(this.config.openapi);
      if (!response.ok) {
        return {
          ok: false,
          message: `Failed to fetch OpenAPI spec: ${response.status}`,
        };
      }
      return {
        ok: true,
        message: `Connected. Found ${this.operations.size} operations.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async close(): Promise<void> {
    // No cleanup needed
  }
}

/**
 * Client for simple REST APIs without OpenAPI spec
 */
export class RESTClient implements IntegrationClient {
  name: string;
  type: "rest" = "rest";
  private config: RESTIntegration;

  constructor(name: string, config: RESTIntegration) {
    this.name = name;
    this.config = config;
  }

  getTools(): IntegrationTool[] {
    const tools: IntegrationTool[] = [];

    // Add configured endpoints
    if (this.config.endpoints) {
      for (const endpoint of this.config.endpoints) {
        let riskTier: "read_only" | "safe_write" | "destructive" = "read_only";
        if (endpoint.method === "DELETE") {
          riskTier = "destructive";
        } else if (["POST", "PUT", "PATCH"].includes(endpoint.method)) {
          riskTier = "safe_write";
        }

        tools.push({
          integration: this.name,
          name: endpoint.name,
          description: endpoint.description || `${endpoint.method} ${endpoint.path}`,
          parameters: {
            type: "object",
            properties: {
              pathParams: {
                type: "object",
                description: "Path parameters to substitute",
              },
              queryParams: {
                type: "object",
                description: "Query parameters",
              },
              body: {
                type: "object",
                description: "Request body",
              },
            },
          },
          riskTier,
        });
      }
    }

    // Add generic request tool for discovery
    tools.push({
      integration: this.name,
      name: "request",
      description: `Make a request to ${this.config.baseUrl}`,
      parameters: {
        type: "object",
        properties: {
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          },
          path: { type: "string" },
          queryParams: { type: "object" },
          body: { type: "object" },
        },
        required: ["method", "path"],
      },
      riskTier: "safe_write", // Conservative default
    });

    return tools;
  }

  async call(
    operation: string,
    params?: Record<string, unknown>
  ): Promise<IntegrationCallResult> {
    const startTime = Date.now();

    try {
      // Handle generic request
      if (operation === "request") {
        return this.makeRequest(
          params?.method as string,
          params?.path as string,
          params,
          startTime
        );
      }

      // Find configured endpoint
      const endpoint = this.config.endpoints?.find((e) => e.name === operation);
      if (!endpoint) {
        return {
          success: false,
          error: `Unknown endpoint: ${operation}`,
        };
      }

      return this.makeRequest(endpoint.method, endpoint.path, params, startTime);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          integration: this.name,
          operation,
          duration: Date.now() - startTime,
        },
      };
    }
  }

  private async makeRequest(
    method: string,
    path: string,
    params: Record<string, unknown> | undefined,
    startTime: number
  ): Promise<IntegrationCallResult> {
    let url = this.config.baseUrl + path;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const queryParams: Record<string, string> = {};

    // Apply auth
    this.applyAuth(headers, queryParams);

    // Substitute path params
    if (params?.pathParams) {
      for (const [key, value] of Object.entries(
        params.pathParams as Record<string, string>
      )) {
        url = url.replace(`{${key}}`, value);
        url = url.replace(`:${key}`, value);
      }
    }

    // Add query params
    if (params?.queryParams) {
      Object.assign(queryParams, params.queryParams);
    }

    if (Object.keys(queryParams).length > 0) {
      const qs = new URLSearchParams(queryParams).toString();
      url += (url.includes("?") ? "&" : "?") + qs;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (params?.body && ["POST", "PUT", "PATCH"].includes(method)) {
      fetchOptions.body = JSON.stringify(params.body);
    }

    const response = await fetch(url, fetchOptions);
    let data: unknown;

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      success: response.ok,
      data,
      statusCode: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
      metadata: {
        integration: this.name,
        operation: `${method} ${path}`,
        duration: Date.now() - startTime,
      },
    };
  }

  private applyAuth(
    headers: Record<string, string>,
    queryParams: Record<string, string>
  ): void {
    const auth = this.config.auth;
    if (!auth) return;

    switch (auth.type) {
      case "bearer":
        headers["Authorization"] = `Bearer ${auth.token}`;
        break;
      case "basic":
        const credentials = Buffer.from(
          `${auth.username}:${auth.password}`
        ).toString("base64");
        headers["Authorization"] = `Basic ${credentials}`;
        break;
      case "header":
        headers[auth.name] = auth.value;
        break;
      case "api_key":
        if (auth.in === "header") {
          headers[auth.name] = auth.key;
        } else {
          queryParams[auth.name] = auth.key;
        }
        break;
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      // Try a simple GET to the base URL
      const response = await fetch(this.config.baseUrl, {
        method: "HEAD",
      });
      return {
        ok: response.ok,
        message: response.ok
          ? "Connected"
          : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async close(): Promise<void> {
    // No cleanup needed
  }
}

interface ParsedOperation {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  operation: OpenAPIOperation;
  parameters: OpenAPIParameter[];
}
