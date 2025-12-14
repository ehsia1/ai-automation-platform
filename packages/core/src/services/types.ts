/**
 * Service Registry Types
 *
 * Maps service names (from alerts) to their repositories and metadata.
 * This enables the agent to:
 * - Find the right codebase to investigate
 * - Know which log groups to query
 * - Understand the service's technology stack
 */

export interface ServiceConfig {
  /** GitHub repository in owner/repo format */
  repository: string;
  /** Primary programming language */
  language?: string;
  /** Team that owns this service */
  team?: string;
  /** Service description */
  description?: string;
  /** CloudWatch log group(s) for this service */
  logGroups?: string[];
  /** Related services (dependencies) */
  dependencies?: string[];
  /** Runbook or documentation URL */
  runbookUrl?: string;
  /** On-call schedule identifier (PagerDuty, Opsgenie) */
  oncallSchedule?: string;
  /** Custom metadata */
  metadata?: Record<string, string>;
}

export interface ServiceRegistryConfig {
  /** Version of the config schema */
  version?: string;
  /** Map of service name to configuration */
  services: Record<string, ServiceConfig>;
}

export interface ServiceLookupResult {
  /** Service name */
  name: string;
  /** Service configuration */
  config: ServiceConfig;
  /** How the match was found (exact, alias, fuzzy) */
  matchType: "exact" | "alias" | "fuzzy";
}
