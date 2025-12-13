/**
 * Integrations Module
 *
 * Provides a unified interface for external service integrations.
 * Supports MCP servers, OpenAPI specs, and simple REST APIs.
 */

// Types
export type {
  Integration,
  MCPIntegration,
  APIIntegration,
  RESTIntegration,
  AuthConfig,
  BearerAuth,
  BasicAuth,
  HeaderAuth,
  ApiKeyAuth,
  IntegrationsConfig,
  IntegrationClient,
  IntegrationTool,
  IntegrationCallResult,
  RESTEndpoint,
} from "./types";

// Config loading
export {
  loadIntegrationsConfig,
  validateConfig,
  getDefaultConfigPath,
  watchConfig,
} from "./config";

// Router
export {
  IntegrationRouter,
  getIntegrationRouter,
  resetIntegrationRouter,
} from "./router";

// API Clients
export { OpenAPIClient, RESTClient } from "./dynamic-api";

// Agent tools
export { apiCallTool, listIntegrationsTool } from "./tool";
