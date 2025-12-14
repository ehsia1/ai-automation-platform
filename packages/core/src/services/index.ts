/**
 * Services Module
 *
 * Service registry and related utilities for mapping alerts to repositories.
 */

export type {
  ServiceConfig,
  ServiceRegistryConfig,
  ServiceLookupResult,
} from "./types";

export {
  ServiceRegistry,
  getServiceRegistry,
  getDefaultServiceRegistryPath,
  initializeServiceRegistry,
  resetServiceRegistry,
} from "./service-registry";
