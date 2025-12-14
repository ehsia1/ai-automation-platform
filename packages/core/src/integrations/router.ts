/**
 * Integration Router
 *
 * Central hub for all integrations. Routes calls to the appropriate
 * client (MCP, OpenAPI, REST) based on configuration.
 */

import type {
  IntegrationsConfig,
  IntegrationClient,
  IntegrationTool,
  IntegrationCallResult,
  MCPIntegration,
  APIIntegration,
  RESTIntegration,
} from "./types";
import { loadIntegrationsConfig, validateConfig, getDefaultConfigPath } from "./config";
import { OpenAPIClient, RESTClient } from "./dynamic-api";
import { MCPClient } from "./mcp-client";
import {
  KNOWN_INTEGRATIONS,
  getAutoEnabledIntegrations,
  getKnownIntegrationConfig,
  getIntegrationsSummary,
} from "./known-integrations";

export class IntegrationRouter {
  private clients: Map<string, IntegrationClient> = new Map();
  private config: IntegrationsConfig | null = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;

  /**
   * Initialize the router from a config file
   */
  async initialize(configPath?: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Prevent concurrent initialization
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.doInitialize(configPath);
    await this.initializing;
    this.initializing = null;
  }

  private async doInitialize(configPath?: string): Promise<void> {
    // Step 1: Get auto-enabled known integrations (based on env vars)
    const autoEnabled = getAutoEnabledIntegrations();
    const knownConfigs: IntegrationsConfig["integrations"] = {};

    for (const name of autoEnabled) {
      const config = getKnownIntegrationConfig(name);
      if (config) {
        knownConfigs[name] = config;
      }
    }

    // Step 2: Try to load YAML config (optional)
    const path = configPath || getDefaultConfigPath();
    let yamlConfig: IntegrationsConfig | null = null;

    try {
      yamlConfig = await loadIntegrationsConfig(path);
    } catch (error) {
      // Config file not found - that's okay, we have known integrations
      console.log(`[IntegrationRouter] No YAML config found at ${path}`);
    }

    // Step 3: Merge configs (YAML overrides known integrations)
    // YAML can also disable known integrations with `enabled: false`
    const mergedIntegrations: IntegrationsConfig["integrations"] = {
      ...knownConfigs, // Start with auto-enabled known integrations
    };

    if (yamlConfig?.integrations) {
      for (const [name, integration] of Object.entries(yamlConfig.integrations)) {
        // Check for explicit disable flag
        if ((integration as { enabled?: boolean }).enabled === false) {
          // Remove from merged if explicitly disabled
          delete mergedIntegrations[name];
          console.log(`[IntegrationRouter] ${name} disabled via YAML config`);
        } else {
          // Override or add
          mergedIntegrations[name] = integration;
        }
      }
    }

    this.config = { integrations: mergedIntegrations };

    // Step 4: Validate merged config
    const errors = validateConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Invalid integrations config:\n${errors.join("\n")}`);
    }

    // Step 5: Initialize clients
    await this.loadClients();
    this.initialized = true;

    // Log summary
    const enabledNames = Object.keys(mergedIntegrations);
    console.log(`[IntegrationRouter] Initialized with ${this.clients.size} integrations: ${enabledNames.join(", ")}`);

    // Show what else is available
    const available = Object.keys(KNOWN_INTEGRATIONS).filter(
      (name) => !enabledNames.includes(name) && KNOWN_INTEGRATIONS[name].envVars.length > 0
    );
    if (available.length > 0) {
      console.log(`[IntegrationRouter] More integrations available: ${available.slice(0, 5).join(", ")}${available.length > 5 ? "..." : ""}`);
    }
  }

  /**
   * Ensure the router is initialized (lazy initialization)
   */
  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Initialize from config object directly (useful for testing)
   */
  async initializeFromConfig(config: IntegrationsConfig): Promise<void> {
    if (this.initialized) {
      await this.close();
    }

    this.config = config;

    const errors = validateConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Invalid integrations config:\n${errors.join("\n")}`);
    }

    await this.loadClients();
    this.initialized = true;
  }

  private async loadClients(): Promise<void> {
    if (!this.config) return;

    const initPromises: Promise<void>[] = [];

    for (const [name, integration] of Object.entries(
      this.config.integrations
    )) {
      let client: IntegrationClient;

      switch (integration.type) {
        case "mcp":
          client = new MCPClient(name, integration);
          break;
        case "api":
          client = new OpenAPIClient(name, integration);
          break;
        case "rest":
          client = new RESTClient(name, integration);
          break;
        default:
          console.warn(`Unknown integration type for ${name}`);
          continue;
      }

      this.clients.set(name, client);

      // Initialize async clients
      if ("initialize" in client && typeof client.initialize === "function") {
        initPromises.push(
          (client as OpenAPIClient).initialize().catch((error) => {
            console.error(`Failed to initialize ${name}:`, error);
          })
        );
      }
    }

    await Promise.all(initPromises);
  }

  /**
   * Get all available integrations
   */
  getIntegrations(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get client for a specific integration
   */
  getClient(name: string): IntegrationClient | undefined {
    return this.clients.get(name);
  }

  /**
   * Check if an integration exists
   */
  hasIntegration(name: string): boolean {
    return this.clients.has(name);
  }

  /**
   * Get all available tools across all integrations
   */
  getAvailableTools(): IntegrationTool[] {
    const tools: IntegrationTool[] = [];

    for (const client of this.clients.values()) {
      tools.push(...client.getTools());
    }

    return tools;
  }

  /**
   * Get tools for a specific integration
   */
  getToolsForIntegration(name: string): IntegrationTool[] {
    const client = this.clients.get(name);
    return client ? client.getTools() : [];
  }

  /**
   * Call an operation on an integration
   */
  async call(
    integration: string,
    operation: string,
    params?: Record<string, unknown>
  ): Promise<IntegrationCallResult> {
    const client = this.clients.get(integration);

    if (!client) {
      return {
        success: false,
        error: `Unknown integration: ${integration}. Available: ${this.getIntegrations().join(", ")}`,
      };
    }

    return client.call(operation, params);
  }

  /**
   * Call with natural language - tries to find the right integration and operation
   */
  async callNaturalLanguage(
    query: string,
    params?: Record<string, unknown>
  ): Promise<IntegrationCallResult> {
    // Simple keyword matching - could be enhanced with embeddings
    const queryLower = query.toLowerCase();

    for (const [name, client] of this.clients) {
      const tools = client.getTools();

      for (const tool of tools) {
        const descLower = tool.description.toLowerCase();
        const nameLower = tool.name.toLowerCase();

        if (descLower.includes(queryLower) || nameLower.includes(queryLower)) {
          return client.call(tool.name, params);
        }
      }
    }

    return {
      success: false,
      error: `Could not find matching operation for: ${query}`,
    };
  }

  /**
   * Test connection to an integration
   */
  async testIntegration(
    name: string
  ): Promise<{ ok: boolean; message: string }> {
    const client = this.clients.get(name);

    if (!client) {
      return { ok: false, message: `Unknown integration: ${name}` };
    }

    return client.testConnection();
  }

  /**
   * Test all integrations
   */
  async testAllIntegrations(): Promise<
    Map<string, { ok: boolean; message: string }>
  > {
    const results = new Map<string, { ok: boolean; message: string }>();

    await Promise.all(
      Array.from(this.clients.entries()).map(async ([name, client]) => {
        const result = await client.testConnection();
        results.set(name, result);
      })
    );

    return results;
  }

  /**
   * Add a new integration dynamically
   */
  async addIntegration(
    name: string,
    integration: MCPIntegration | APIIntegration | RESTIntegration
  ): Promise<void> {
    if (this.clients.has(name)) {
      throw new Error(`Integration ${name} already exists`);
    }

    let client: IntegrationClient;

    switch (integration.type) {
      case "mcp":
        client = new MCPClient(name, integration);
        break;
      case "api":
        client = new OpenAPIClient(name, integration);
        await (client as OpenAPIClient).initialize();
        break;
      case "rest":
        client = new RESTClient(name, integration);
        break;
    }

    this.clients.set(name, client);

    // Update config
    if (this.config) {
      this.config.integrations[name] = integration;
    }
  }

  /**
   * Remove an integration
   */
  async removeIntegration(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.close();
      this.clients.delete(name);

      if (this.config) {
        delete this.config.integrations[name];
      }
    }
  }

  /**
   * Get the current config (for saving/exporting)
   */
  getConfig(): IntegrationsConfig | null {
    return this.config;
  }

  /**
   * Get a summary of available and enabled integrations
   */
  getIntegrationsSummary(): string {
    return getIntegrationsSummary();
  }

  /**
   * Get list of known integrations that could be enabled
   */
  getKnownIntegrations(): string[] {
    return Object.keys(KNOWN_INTEGRATIONS);
  }

  /**
   * Clean up all clients
   */
  async close(): Promise<void> {
    await Promise.all(
      Array.from(this.clients.values()).map((client) => client.close())
    );
    this.clients.clear();
    this.initialized = false;
  }
}

// Singleton instance
let routerInstance: IntegrationRouter | null = null;

/**
 * Get the global IntegrationRouter instance
 */
export function getIntegrationRouter(): IntegrationRouter {
  if (!routerInstance) {
    routerInstance = new IntegrationRouter();
  }
  return routerInstance;
}

/**
 * Reset the global router (useful for testing)
 */
export async function resetIntegrationRouter(): Promise<void> {
  if (routerInstance) {
    await routerInstance.close();
    routerInstance = null;
  }
}
