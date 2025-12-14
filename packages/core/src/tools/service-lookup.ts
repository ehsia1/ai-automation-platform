/**
 * Service Lookup Tool
 *
 * Allows the agent to look up service information from the service registry.
 * Maps service names (from alerts) to GitHub repositories and metadata.
 */

import type { Tool, ToolResult, ToolContext } from "./types";
import type { ToolDefinition } from "../llm/providers/types";
import {
  getServiceRegistry,
  initializeServiceRegistry,
} from "../services/index";

const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "service_lookup",
    description: `Look up service information from the service registry. Use this to find the GitHub repository and metadata for a service mentioned in an alert.

Example inputs:
- "payment-service" → finds payment service repo
- "user-api" → finds user API repo
- "ehsia1/my-repo" → finds by repo name

Returns the repository, team, log groups, and other metadata for the service.`,
    parameters: {
      type: "object",
      properties: {
        service_name: {
          type: "string",
          description:
            "Name of the service to look up. Can be the service name, repo name, or partial match.",
        },
        action: {
          type: "string",
          enum: ["lookup", "list", "list_by_team"],
          description:
            "Action to perform: 'lookup' (default) finds a specific service, 'list' shows all services, 'list_by_team' filters by team",
        },
        team: {
          type: "string",
          description: "Team name when using 'list_by_team' action",
        },
      },
      required: ["service_name"],
    },
  },
};

export const serviceLookupTool: Tool = {
  name: "service_lookup",
  description: definition.function.description,
  riskTier: "read_only",
  definition,

  execute: async (
    args: Record<string, unknown>,
    _context: ToolContext
  ): Promise<ToolResult> => {
    const serviceName = args.service_name as string;
    const action = (args.action as string) || "lookup";
    const team = args.team as string | undefined;

    // Ensure registry is initialized
    const registry = getServiceRegistry();
    if (!registry.isInitialized()) {
      try {
        await initializeServiceRegistry();
      } catch (error) {
        return {
          success: false,
          output: `Failed to initialize service registry: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    try {
      switch (action) {
        case "list": {
          const services = registry.getAll();
          if (services.size === 0) {
            return {
              success: true,
              output:
                "No services registered. Add services to config/service-registry.yaml",
            };
          }

          const lines = ["Registered services:"];
          for (const [name, config] of services) {
            const teamInfo = config.team ? ` (team: ${config.team})` : "";
            lines.push(`  - ${name}: ${config.repository}${teamInfo}`);
          }
          return { success: true, output: lines.join("\n") };
        }

        case "list_by_team": {
          if (!team) {
            return {
              success: false,
              output: "Team name required for list_by_team action",
            };
          }

          const services = registry.getByTeam(team);
          if (services.size === 0) {
            return {
              success: true,
              output: `No services found for team: ${team}`,
            };
          }

          const lines = [`Services for team '${team}':`];
          for (const [name, config] of services) {
            lines.push(`  - ${name}: ${config.repository}`);
          }
          return { success: true, output: lines.join("\n") };
        }

        case "lookup":
        default: {
          const result = registry.lookup(serviceName);

          if (!result) {
            // Show helpful message with available services
            const available = Array.from(registry.getAll().keys());
            return {
              success: false,
              output: `Service not found: "${serviceName}"\n\nAvailable services: ${available.join(", ") || "(none)"}`,
            };
          }

          const config = result.config;
          const lines = [
            `Service: ${result.name}`,
            `Match type: ${result.matchType}`,
            `Repository: ${config.repository}`,
          ];

          if (config.language) lines.push(`Language: ${config.language}`);
          if (config.team) lines.push(`Team: ${config.team}`);
          if (config.description) lines.push(`Description: ${config.description}`);
          if (config.logGroups?.length) {
            lines.push(`Log groups: ${config.logGroups.join(", ")}`);
          }
          if (config.dependencies?.length) {
            lines.push(`Dependencies: ${config.dependencies.join(", ")}`);
          }
          if (config.runbookUrl) lines.push(`Runbook: ${config.runbookUrl}`);
          if (config.oncallSchedule) {
            lines.push(`On-call: ${config.oncallSchedule}`);
          }
          if (config.metadata) {
            lines.push(
              `Metadata: ${JSON.stringify(config.metadata)}`
            );
          }

          return { success: true, output: lines.join("\n") };
        }
      }
    } catch (error) {
      return {
        success: false,
        output: `Service lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
