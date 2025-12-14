/**
 * Service Registry
 *
 * Maps service names from alerts to GitHub repositories and metadata.
 * Enables the agent to know which codebase to investigate for a given alert.
 *
 * Features:
 * - YAML-based configuration
 * - Fuzzy matching for service name variations
 * - Alias support for common naming patterns
 */

import fs from "fs/promises";
import path from "path";
import * as yaml from "yaml";
import type {
  ServiceConfig,
  ServiceRegistryConfig,
  ServiceLookupResult,
} from "./types";

export class ServiceRegistry {
  private services: Map<string, ServiceConfig> = new Map();
  private aliases: Map<string, string> = new Map();
  private initialized = false;

  /**
   * Load services from a YAML config file
   */
  async loadFromFile(configPath: string): Promise<void> {
    const content = await fs.readFile(configPath, "utf-8");
    const config = yaml.parse(content) as ServiceRegistryConfig;

    if (!config?.services) {
      throw new Error("Invalid service registry config: missing 'services'");
    }

    this.loadFromConfig(config);
  }

  /**
   * Load services from a config object
   */
  loadFromConfig(config: ServiceRegistryConfig): void {
    this.services.clear();
    this.aliases.clear();

    for (const [name, serviceConfig] of Object.entries(config.services)) {
      this.services.set(name.toLowerCase(), serviceConfig);

      // Auto-generate aliases
      this.generateAliases(name, serviceConfig);
    }

    this.initialized = true;
  }

  /**
   * Generate common aliases for a service
   */
  private generateAliases(name: string, config: ServiceConfig): void {
    const lowerName = name.toLowerCase();

    // Add variations: my-service → myservice, my_service
    this.aliases.set(lowerName.replace(/-/g, ""), lowerName);
    this.aliases.set(lowerName.replace(/-/g, "_"), lowerName);
    this.aliases.set(lowerName.replace(/_/g, "-"), lowerName);

    // Add repo name as alias (payment-service → payment-service)
    if (config.repository) {
      const repoName = config.repository.split("/").pop()?.toLowerCase();
      if (repoName && repoName !== lowerName) {
        this.aliases.set(repoName, lowerName);
      }
    }

    // Add without common suffixes: payment-service → payment
    for (const suffix of ["-service", "-api", "-lambda", "-worker"]) {
      if (lowerName.endsWith(suffix)) {
        const shortened = lowerName.slice(0, -suffix.length);
        this.aliases.set(shortened, lowerName);
      }
    }
  }

  /**
   * Look up a service by name (supports fuzzy matching)
   */
  lookup(serviceName: string): ServiceLookupResult | null {
    const query = serviceName.toLowerCase().trim();

    // 1. Exact match
    if (this.services.has(query)) {
      return {
        name: query,
        config: this.services.get(query)!,
        matchType: "exact",
      };
    }

    // 2. Alias match
    const aliasTarget = this.aliases.get(query);
    if (aliasTarget && this.services.has(aliasTarget)) {
      return {
        name: aliasTarget,
        config: this.services.get(aliasTarget)!,
        matchType: "alias",
      };
    }

    // 3. Fuzzy match - find services that contain the query
    for (const [name, config] of this.services) {
      if (name.includes(query) || query.includes(name)) {
        return {
          name,
          config,
          matchType: "fuzzy",
        };
      }
    }

    // 4. Check if query matches a repository name
    for (const [name, config] of this.services) {
      if (config.repository.toLowerCase().includes(query)) {
        return {
          name,
          config,
          matchType: "fuzzy",
        };
      }
    }

    return null;
  }

  /**
   * Get all services
   */
  getAll(): Map<string, ServiceConfig> {
    return new Map(this.services);
  }

  /**
   * Get service by exact name
   */
  get(serviceName: string): ServiceConfig | undefined {
    return this.services.get(serviceName.toLowerCase());
  }

  /**
   * Check if a service exists
   */
  has(serviceName: string): boolean {
    return this.services.has(serviceName.toLowerCase());
  }

  /**
   * Register a new service
   */
  register(config: ServiceConfig & { name: string }): void {
    const name = config.name.toLowerCase();
    const { name: _, ...serviceConfig } = config;
    this.services.set(name, serviceConfig as ServiceConfig);
    this.generateAliases(name, serviceConfig as ServiceConfig);
    this.initialized = true;
  }

  /**
   * Get services by team
   */
  getByTeam(team: string): Map<string, ServiceConfig> {
    const result = new Map<string, ServiceConfig>();
    const lowerTeam = team.toLowerCase();

    for (const [name, config] of this.services) {
      if (config.team?.toLowerCase() === lowerTeam) {
        result.set(name, config);
      }
    }

    return result;
  }

  /**
   * Get services by language
   */
  getByLanguage(language: string): Map<string, ServiceConfig> {
    const result = new Map<string, ServiceConfig>();
    const lowerLang = language.toLowerCase();

    for (const [name, config] of this.services) {
      if (config.language?.toLowerCase() === lowerLang) {
        result.set(name, config);
      }
    }

    return result;
  }

  /**
   * Find services that depend on a given service
   */
  getDependents(serviceName: string): string[] {
    const lowerName = serviceName.toLowerCase();
    const dependents: string[] = [];

    for (const [name, config] of this.services) {
      if (config.dependencies?.map((d) => d.toLowerCase()).includes(lowerName)) {
        dependents.push(name);
      }
    }

    return dependents;
  }

  /**
   * Get repository for a service (convenience method)
   */
  getRepository(serviceName: string): string | null {
    const result = this.lookup(serviceName);
    return result?.config.repository ?? null;
  }

  /**
   * Get log groups for a service (convenience method)
   */
  getLogGroups(serviceName: string): string[] {
    const result = this.lookup(serviceName);
    return result?.config.logGroups ?? [];
  }

  /**
   * Get summary of registered services
   */
  getSummary(): string {
    if (this.services.size === 0) {
      return "No services registered.";
    }

    const lines = ["Registered services:"];
    for (const [name, config] of this.services) {
      const repo = config.repository;
      const team = config.team ? ` (${config.team})` : "";
      lines.push(`  - ${name}: ${repo}${team}`);
    }

    return lines.join("\n");
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get count of services
   */
  get size(): number {
    return this.services.size;
  }
}

// Singleton instance
let registryInstance: ServiceRegistry | null = null;

/**
 * Get the global ServiceRegistry instance
 */
export function getServiceRegistry(): ServiceRegistry {
  if (!registryInstance) {
    registryInstance = new ServiceRegistry();
  }
  return registryInstance;
}

/**
 * Get default config path
 */
export function getDefaultServiceRegistryPath(): string {
  return path.join(process.cwd(), "config", "service-registry.yaml");
}

/**
 * Initialize the global registry from the default config file
 */
export async function initializeServiceRegistry(
  configPath?: string
): Promise<ServiceRegistry> {
  const registry = getServiceRegistry();
  const filePath = configPath || getDefaultServiceRegistryPath();

  try {
    await registry.loadFromFile(filePath);
    console.log(
      `[ServiceRegistry] Loaded ${registry.size} services from ${filePath}`
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(
        `[ServiceRegistry] No config found at ${filePath}, starting empty`
      );
    } else {
      throw error;
    }
  }

  return registry;
}

/**
 * Reset the global registry (useful for testing)
 */
export function resetServiceRegistry(): void {
  registryInstance = null;
}
