/**
 * Integration configuration loader
 *
 * Loads integrations.yaml and resolves environment variables
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import type { IntegrationsConfig, Integration, AuthConfig } from "./types";

/**
 * Load integrations config from a YAML file
 */
export async function loadIntegrationsConfig(
  configPath: string
): Promise<IntegrationsConfig> {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    console.warn(`Integrations config not found at ${absolutePath}, using empty config`);
    return { integrations: {} };
  }

  const content = fs.readFileSync(absolutePath, "utf-8");
  const config = yaml.parse(content) as IntegrationsConfig;

  // Resolve environment variables in the config
  return resolveEnvVariables(config);
}

/**
 * Resolve ${VAR} and $VAR patterns in config values
 */
function resolveEnvVariables(config: IntegrationsConfig): IntegrationsConfig {
  const resolved: IntegrationsConfig = {
    version: config.version,
    integrations: {},
  };

  for (const [name, integration] of Object.entries(config.integrations)) {
    resolved.integrations[name] = resolveIntegration(integration);
  }

  return resolved;
}

function resolveIntegration(integration: Integration): Integration {
  switch (integration.type) {
    case "mcp":
      return {
        ...integration,
        env: integration.env
          ? resolveEnvObject(integration.env)
          : undefined,
      };

    case "api":
      return {
        ...integration,
        openapi: resolveEnvString(integration.openapi),
        baseUrl: integration.baseUrl
          ? resolveEnvString(integration.baseUrl)
          : undefined,
        auth: integration.auth
          ? resolveAuth(integration.auth)
          : undefined,
      };

    case "rest":
      return {
        ...integration,
        baseUrl: resolveEnvString(integration.baseUrl),
        auth: integration.auth
          ? resolveAuth(integration.auth)
          : undefined,
      };
  }
}

function resolveAuth(auth: AuthConfig): AuthConfig {
  switch (auth.type) {
    case "bearer":
      return { ...auth, token: resolveEnvString(auth.token) };

    case "basic":
      return {
        ...auth,
        username: resolveEnvString(auth.username),
        password: resolveEnvString(auth.password),
      };

    case "header":
      return {
        ...auth,
        name: resolveEnvString(auth.name),
        value: resolveEnvString(auth.value),
      };

    case "api_key":
      return {
        ...auth,
        key: resolveEnvString(auth.key),
        name: resolveEnvString(auth.name),
      };
  }
}

function resolveEnvObject(
  obj: Record<string, string>
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    resolved[key] = resolveEnvString(value);
  }
  return resolved;
}

function resolveEnvString(value: string): string {
  // Match ${VAR} or ${VAR:-default} patterns
  return value.replace(
    /\$\{([^}:-]+)(?::-([^}]*))?\}/g,
    (_, varName, defaultValue) => {
      const envValue = process.env[varName];
      if (envValue !== undefined) {
        return envValue;
      }
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      console.warn(`Environment variable ${varName} not set`);
      return "";
    }
  );
}

/**
 * Validate integrations config
 */
export function validateConfig(config: IntegrationsConfig): string[] {
  const errors: string[] = [];

  for (const [name, integration] of Object.entries(config.integrations)) {
    switch (integration.type) {
      case "mcp":
        if (!integration.package) {
          errors.push(`Integration "${name}": MCP integration requires "package"`);
        }
        break;

      case "api":
        if (!integration.openapi) {
          errors.push(`Integration "${name}": API integration requires "openapi" URL`);
        }
        break;

      case "rest":
        if (!integration.baseUrl) {
          errors.push(`Integration "${name}": REST integration requires "baseUrl"`);
        }
        break;

      default:
        errors.push(`Integration "${name}": Unknown type "${(integration as Integration).type}"`);
    }
  }

  return errors;
}

/**
 * Get default config path
 */
export function getDefaultConfigPath(): string {
  // Check multiple locations
  const candidates = [
    "./integrations.yaml",
    "./config/integrations.yaml",
    "../integrations.yaml",
    process.env.INTEGRATIONS_CONFIG_PATH,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.resolve(candidate))) {
      return candidate;
    }
  }

  return "./integrations.yaml";
}

/**
 * Watch for config changes (for development)
 */
export function watchConfig(
  configPath: string,
  onChange: (config: IntegrationsConfig) => void
): () => void {
  const absolutePath = path.resolve(configPath);

  const watcher = fs.watch(absolutePath, async (eventType) => {
    if (eventType === "change") {
      try {
        const config = await loadIntegrationsConfig(configPath);
        onChange(config);
      } catch (error) {
        console.error("Failed to reload integrations config:", error);
      }
    }
  });

  return () => watcher.close();
}
