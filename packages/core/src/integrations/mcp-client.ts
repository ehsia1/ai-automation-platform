/**
 * MCP Client Implementation
 *
 * Spawns and communicates with MCP servers using the official SDK.
 * Supports both NPX-based and binary MCP servers.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  MCPIntegration,
  IntegrationClient,
  IntegrationTool,
  IntegrationCallResult,
} from "./types";

/**
 * Client for MCP (Model Context Protocol) servers
 */
export class MCPClient implements IntegrationClient {
  name: string;
  type: "mcp" = "mcp";
  private config: MCPIntegration;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: IntegrationTool[] = [];
  private initialized = false;

  constructor(name: string, config: MCPIntegration) {
    this.name = name;
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Build the command to spawn the MCP server
      const { command, args } = this.buildCommand();

      // Prepare environment variables
      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      if (this.config.env) {
        for (const [key, value] of Object.entries(this.config.env)) {
          // Resolve environment variable references like ${VAR}
          env[key] = this.resolveEnvValue(value);
        }
      }

      // Create stdio transport
      this.transport = new StdioClientTransport({
        command,
        args,
        env,
      });

      // Create and connect client
      this.client = new Client(
        {
          name: `ai-agent-${this.name}`,
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);

      // Discover available tools
      await this.discoverTools();

      this.initialized = true;
      console.log(
        `[MCP] Initialized ${this.name} with ${this.tools.length} tools`
      );
    } catch (error) {
      console.error(`[MCP] Failed to initialize ${this.name}:`, error);
      throw error;
    }
  }

  private buildCommand(): { command: string; args: string[] } {
    const pkg = this.config.package;

    // Check if it's an NPX package or a local binary
    if (pkg.startsWith("./") || pkg.startsWith("/")) {
      // Local binary
      return { command: pkg, args: [] };
    }

    // NPX package - common patterns:
    // @modelcontextprotocol/server-notion → npx -y @modelcontextprotocol/server-notion
    // @anthropic/mcp-server-github → npx -y @anthropic/mcp-server-github
    return {
      command: "npx",
      args: ["-y", pkg],
    };
  }

  private resolveEnvValue(value: string): string {
    // Handle ${VAR} and ${VAR:-default} patterns
    return value.replace(/\$\{([^}]+)\}/g, (match, expr) => {
      const [varName, defaultValue] = expr.split(":-");
      return process.env[varName] || defaultValue || "";
    });
  }

  private async discoverTools(): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.listTools();

      this.tools = [];

      for (const tool of result.tools) {
        // Check if this tool should be included based on config
        if (
          this.config.tools &&
          this.config.tools.length > 0 &&
          !this.config.tools.includes(tool.name)
        ) {
          continue;
        }

        // Determine risk tier from tool name/description
        const riskTier = this.inferRiskTier(tool.name, tool.description || "");

        this.tools.push({
          integration: this.name,
          name: tool.name,
          description: tool.description || `MCP tool: ${tool.name}`,
          parameters: (tool.inputSchema || {}) as Record<string, unknown>,
          riskTier,
        });
      }
    } catch (error) {
      console.error(`[MCP] Failed to discover tools for ${this.name}:`, error);
      this.tools = [];
    }
  }

  private inferRiskTier(
    name: string,
    description: string
  ): "read_only" | "safe_write" | "destructive" {
    const nameLower = name.toLowerCase();
    const descLower = description.toLowerCase();
    const combined = `${nameLower} ${descLower}`;

    // Destructive operations
    if (
      combined.includes("delete") ||
      combined.includes("remove") ||
      combined.includes("drop") ||
      combined.includes("destroy")
    ) {
      return "destructive";
    }

    // Write operations
    if (
      combined.includes("create") ||
      combined.includes("update") ||
      combined.includes("write") ||
      combined.includes("add") ||
      combined.includes("edit") ||
      combined.includes("modify") ||
      combined.includes("set") ||
      combined.includes("post") ||
      combined.includes("put")
    ) {
      return "safe_write";
    }

    // Default to read_only
    return "read_only";
  }

  getTools(): IntegrationTool[] {
    return this.tools;
  }

  async call(
    operation: string,
    params?: Record<string, unknown>
  ): Promise<IntegrationCallResult> {
    const startTime = Date.now();

    if (!this.client || !this.initialized) {
      return {
        success: false,
        error: "MCP client not initialized",
        metadata: {
          integration: this.name,
          operation,
          duration: Date.now() - startTime,
        },
      };
    }

    try {
      const result = await this.client.callTool({
        name: operation,
        arguments: params || {},
      });

      // Extract text content from the result
      let data: unknown;
      if (result.content && Array.isArray(result.content)) {
        const textContents = result.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { type: "text"; text: string }).text);

        if (textContents.length === 1) {
          // Try to parse as JSON
          try {
            data = JSON.parse(textContents[0]);
          } catch {
            data = textContents[0];
          }
        } else if (textContents.length > 1) {
          data = textContents;
        } else {
          data = result.content;
        }
      } else {
        data = result;
      }

      return {
        success: !result.isError,
        data,
        error: result.isError ? String(data) : undefined,
        metadata: {
          integration: this.name,
          operation,
          duration: Date.now() - startTime,
        },
      };
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

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.client || !this.initialized) {
      try {
        await this.initialize();
        return {
          ok: true,
          message: `Connected. Found ${this.tools.length} tools.`,
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      ok: true,
      message: `Connected. Found ${this.tools.length} tools.`,
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error(`[MCP] Error closing ${this.name}:`, error);
      }
    }
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        console.error(`[MCP] Error closing transport for ${this.name}:`, error);
      }
    }
    this.client = null;
    this.transport = null;
    this.initialized = false;
    this.tools = [];
  }
}
