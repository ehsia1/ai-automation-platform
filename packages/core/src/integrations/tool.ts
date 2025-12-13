/**
 * Integration Tool for Agent
 *
 * Allows agents to call any configured integration dynamically.
 */

import type { Tool, ToolResult, ToolContext } from "../tools/types";
import type { ToolDefinition } from "../llm/providers/types";
import { getIntegrationRouter } from "./router";

const apiCallDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "api_call",
    description: `Call any configured API integration. Use this to interact with external services like PagerDuty, internal APIs, or any service configured in integrations.yaml.

Before calling, you can use 'list_integrations' operation to see available integrations and their operations.

Examples:
- List all integrations: { "integration": "_system", "operation": "list_integrations" }
- List operations for an integration: { "integration": "_system", "operation": "list_operations", "params": { "integration": "pagerduty" } }
- Call PagerDuty: { "integration": "pagerduty", "operation": "listIncidents", "params": { "status": "triggered" } }
- Make a REST request: { "integration": "internal-api", "operation": "request", "params": { "method": "GET", "path": "/users" } }`,
    parameters: {
      type: "object",
      properties: {
        integration: {
          type: "string",
          description:
            'Name of the integration to call, or "_system" for meta-operations like listing integrations',
        },
        operation: {
          type: "string",
          description:
            "Operation to perform (e.g., 'listIncidents', 'request', 'list_integrations')",
        },
        params: {
          type: "object",
          description: "Parameters for the operation",
          additionalProperties: true,
        },
      },
      required: ["integration", "operation"],
    },
  },
};

export const apiCallTool: Tool = {
  name: "api_call",
  description: apiCallDefinition.function.description,
  riskTier: "safe_write", // Default, actual risk tier determined per-operation
  definition: apiCallDefinition,

  async execute(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const integration = args.integration as string;
    const operation = args.operation as string;
    const params = args.params as Record<string, unknown> | undefined;

    const router = getIntegrationRouter();

    // Ensure router is initialized (lazy loading)
    await router.ensureInitialized();

    // Handle system meta-operations
    if (integration === "_system") {
      return handleSystemOperation(operation, params, router);
    }

    // Check if integration exists
    if (!router.hasIntegration(integration)) {
      const available = router.getIntegrations();
      return {
        success: false,
        output: "",
        error: `Unknown integration: ${integration}. Available integrations: ${available.join(", ") || "none configured"}`,
      };
    }

    // Call the integration
    const result = await router.call(integration, operation, params);

    if (result.success) {
      return {
        success: true,
        output:
          typeof result.data === "string"
            ? result.data
            : JSON.stringify(result.data, null, 2),
        metadata: result.metadata,
      };
    } else {
      return {
        success: false,
        output: "",
        error: result.error || "Operation failed",
        metadata: result.metadata,
      };
    }
  },
};

function handleSystemOperation(
  operation: string,
  params: Record<string, unknown> | undefined,
  router: ReturnType<typeof getIntegrationRouter>
): ToolResult {
  switch (operation) {
    case "list_integrations": {
      const integrations = router.getIntegrations();
      const details = integrations.map((name) => {
        const client = router.getClient(name);
        const toolCount = client?.getTools().length || 0;
        return `- ${name} (${client?.type || "unknown"}, ${toolCount} operations)`;
      });

      return {
        success: true,
        output:
          integrations.length > 0
            ? `Available integrations:\n${details.join("\n")}`
            : "No integrations configured. Add integrations to integrations.yaml",
      };
    }

    case "list_operations": {
      const integrationName = params?.integration as string;
      if (!integrationName) {
        return {
          success: false,
          output: "",
          error: 'Missing required param: "integration"',
        };
      }

      const tools = router.getToolsForIntegration(integrationName);
      if (tools.length === 0) {
        return {
          success: false,
          output: "",
          error: `No operations found for integration: ${integrationName}`,
        };
      }

      const details = tools.map(
        (t) => `- ${t.name}: ${t.description} [${t.riskTier}]`
      );

      return {
        success: true,
        output: `Operations for ${integrationName}:\n${details.join("\n")}`,
      };
    }

    case "test_connection": {
      const integrationName = params?.integration as string;
      if (!integrationName) {
        return {
          success: false,
          output: "",
          error: 'Missing required param: "integration"',
        };
      }

      // Note: This is sync context, so we return a message
      return {
        success: true,
        output: `To test ${integrationName}, the system will verify the connection on next use.`,
      };
    }

    default:
      return {
        success: false,
        output: "",
        error: `Unknown system operation: ${operation}. Available: list_integrations, list_operations, test_connection`,
      };
  }
}

/**
 * Tool for listing available integrations (simpler interface)
 */
const listIntegrationsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_integrations",
    description:
      "List all configured API integrations and their available operations. Use this to discover what external services are available.",
    parameters: {
      type: "object",
      properties: {
        integration: {
          type: "string",
          description:
            "Optional: specific integration to get details for. If omitted, lists all integrations.",
        },
      },
    },
  },
};

export const listIntegrationsTool: Tool = {
  name: "list_integrations",
  description: listIntegrationsDefinition.function.description,
  riskTier: "read_only",
  definition: listIntegrationsDefinition,

  async execute(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const router = getIntegrationRouter();

    // Ensure router is initialized (lazy loading)
    await router.ensureInitialized();

    const specificIntegration = args.integration as string | undefined;

    if (specificIntegration) {
      const tools = router.getToolsForIntegration(specificIntegration);
      if (tools.length === 0) {
        return {
          success: false,
          output: "",
          error: `Integration not found: ${specificIntegration}`,
        };
      }

      const details = tools.map((t) => ({
        name: t.name,
        description: t.description,
        riskTier: t.riskTier,
        parameters: t.parameters,
      }));

      return {
        success: true,
        output: JSON.stringify(
          {
            integration: specificIntegration,
            operations: details,
          },
          null,
          2
        ),
      };
    }

    // List all integrations
    const integrations = router.getIntegrations();
    const summary = integrations.map((name) => {
      const client = router.getClient(name);
      const tools = client?.getTools() || [];
      return {
        name,
        type: client?.type || "unknown",
        operationCount: tools.length,
        operations: tools.slice(0, 5).map((t) => t.name), // First 5 ops
      };
    });

    return {
      success: true,
      output:
        integrations.length > 0
          ? JSON.stringify({ integrations: summary }, null, 2)
          : "No integrations configured. Add integrations to integrations.yaml",
    };
  },
};
