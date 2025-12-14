/**
 * Known Integrations Registry
 *
 * Pre-configured integrations that auto-enable when their environment
 * variables are present. This enables zero-config setup for popular services.
 *
 * Usage:
 *   Just set PAGERDUTY_TOKEN in your environment → PagerDuty is enabled
 *   No YAML editing required!
 *
 * The YAML config file can still be used to:
 *   - Add custom integrations not in this registry
 *   - Override settings for known integrations
 *   - Disable auto-enabled integrations (set enabled: false)
 */

import type { APIIntegration, RESTIntegration, MCPIntegration } from "./types";

/**
 * Known integration configuration with auto-enable support
 */
export interface KnownIntegration {
  /** Human-readable name */
  displayName: string;
  /** Description of what this integration does */
  description: string;
  /** Environment variable(s) that enable this integration */
  envVars: string[];
  /** The integration configuration */
  config: APIIntegration | RESTIntegration | MCPIntegration;
  /** Key operations for agent prompts */
  keyOperations?: string[];
}

/**
 * Registry of known integrations with pre-configured settings.
 * These auto-enable when their environment variables are set.
 */
export const KNOWN_INTEGRATIONS: Record<string, KnownIntegration> = {
  // ============================================================
  // Incident Management
  // ============================================================

  pagerduty: {
    displayName: "PagerDuty",
    description: "Incident management and on-call scheduling",
    envVars: ["PAGERDUTY_TOKEN"],
    keyOperations: ["listIncidents", "getIncident", "listServices", "listOnCalls"],
    config: {
      type: "api",
      openapi:
        "https://raw.githubusercontent.com/PagerDuty/api-schema/main/reference/REST/openapiv3.json",
      baseUrl: "https://api.pagerduty.com",
      auth: {
        type: "bearer",
        token: "${PAGERDUTY_TOKEN}",
      },
      operations: [
        "listIncidents",
        "getIncident",
        "listServices",
        "getService",
        "listOnCalls",
        "listEscalationPolicies",
      ],
    },
  },

  opsgenie: {
    displayName: "Opsgenie",
    description: "Alerting and incident management",
    envVars: ["OPSGENIE_API_KEY"],
    keyOperations: ["listAlerts", "getAlert", "listSchedules"],
    config: {
      type: "api",
      openapi: "https://docs.opsgenie.com/docs/opsgenie-api",
      baseUrl: "https://api.opsgenie.com/v2",
      auth: {
        type: "header",
        name: "Authorization",
        value: "GenieKey ${OPSGENIE_API_KEY}",
      },
      operations: ["listAlerts", "getAlert", "listSchedules", "listOnCalls"],
    },
  },

  // ============================================================
  // Incident Communication
  // ============================================================

  statuspage: {
    displayName: "Statuspage",
    description: "Public status page and incident communication (Atlassian)",
    envVars: ["STATUSPAGE_API_KEY", "STATUSPAGE_PAGE_ID"],
    keyOperations: ["listIncidents", "createIncident", "updateStatus"],
    config: {
      type: "rest",
      baseUrl: "https://api.statuspage.io/v1",
      auth: {
        type: "header",
        name: "Authorization",
        value: "OAuth ${STATUSPAGE_API_KEY}",
      },
      endpoints: [
        {
          name: "listIncidents",
          method: "GET",
          path: "/pages/${STATUSPAGE_PAGE_ID}/incidents",
          description: "List all incidents",
        },
        {
          name: "getIncident",
          method: "GET",
          path: "/pages/${STATUSPAGE_PAGE_ID}/incidents/{incident_id}",
          description: "Get incident details",
        },
        {
          name: "createIncident",
          method: "POST",
          path: "/pages/${STATUSPAGE_PAGE_ID}/incidents",
          description: "Create a new incident",
        },
        {
          name: "updateIncident",
          method: "PATCH",
          path: "/pages/${STATUSPAGE_PAGE_ID}/incidents/{incident_id}",
          description: "Update an incident",
        },
        {
          name: "listComponents",
          method: "GET",
          path: "/pages/${STATUSPAGE_PAGE_ID}/components",
          description: "List all components",
        },
      ],
    },
  },

  "incident-io": {
    displayName: "incident.io",
    description: "Incident management and response automation",
    envVars: ["INCIDENT_IO_API_KEY"],
    keyOperations: ["listIncidents", "getIncident", "createIncident"],
    config: {
      type: "rest",
      baseUrl: "https://api.incident.io/v2",
      auth: {
        type: "bearer",
        token: "${INCIDENT_IO_API_KEY}",
      },
      endpoints: [
        {
          name: "listIncidents",
          method: "GET",
          path: "/incidents",
          description: "List all incidents",
        },
        {
          name: "getIncident",
          method: "GET",
          path: "/incidents/{id}",
          description: "Get incident details",
        },
        {
          name: "createIncident",
          method: "POST",
          path: "/incidents",
          description: "Create a new incident",
        },
        {
          name: "listSeverities",
          method: "GET",
          path: "/severities",
          description: "List severity levels",
        },
      ],
    },
  },

  firehydrant: {
    displayName: "FireHydrant",
    description: "Incident management and reliability platform",
    envVars: ["FIREHYDRANT_API_KEY"],
    keyOperations: ["listIncidents", "getIncident", "listServices"],
    config: {
      type: "rest",
      baseUrl: "https://api.firehydrant.io/v1",
      auth: {
        type: "bearer",
        token: "${FIREHYDRANT_API_KEY}",
      },
      endpoints: [
        {
          name: "listIncidents",
          method: "GET",
          path: "/incidents",
          description: "List all incidents",
        },
        {
          name: "getIncident",
          method: "GET",
          path: "/incidents/{id}",
          description: "Get incident details",
        },
        {
          name: "listServices",
          method: "GET",
          path: "/services",
          description: "List all services",
        },
        {
          name: "listEnvironments",
          method: "GET",
          path: "/environments",
          description: "List all environments",
        },
      ],
    },
  },

  // ============================================================
  // Monitoring & Observability
  // ============================================================

  datadog: {
    displayName: "Datadog",
    description: "Monitoring, APM, and log management",
    envVars: ["DATADOG_API_KEY", "DATADOG_APP_KEY"],
    keyOperations: ["listMonitors", "queryMetrics", "searchLogs"],
    config: {
      type: "api",
      openapi:
        "https://raw.githubusercontent.com/DataDog/datadog-api-spec/master/spec/v2/openapi.yaml",
      baseUrl: "https://api.datadoghq.com",
      auth: {
        type: "header",
        name: "DD-API-KEY",
        value: "${DATADOG_API_KEY}",
      },
      headers: {
        "DD-APPLICATION-KEY": "${DATADOG_APP_KEY}",
      },
      operations: [
        "listMonitors",
        "getMonitor",
        "queryMetrics",
        "searchLogs",
        "listDashboards",
      ],
    },
  },

  newrelic: {
    displayName: "New Relic",
    description: "Application performance monitoring",
    envVars: ["NEW_RELIC_API_KEY"],
    keyOperations: ["queryNRQL", "listAlerts", "getEntityHealth"],
    config: {
      type: "rest",
      baseUrl: "https://api.newrelic.com/v2",
      auth: {
        type: "header",
        name: "Api-Key",
        value: "${NEW_RELIC_API_KEY}",
      },
      endpoints: [
        {
          name: "listApplications",
          method: "GET",
          path: "/applications.json",
          description: "List all monitored applications",
        },
        {
          name: "getApplication",
          method: "GET",
          path: "/applications/{id}.json",
          description: "Get application details and health",
        },
        {
          name: "listAlertPolicies",
          method: "GET",
          path: "/alerts_policies.json",
          description: "List alert policies",
        },
      ],
    },
  },

  sentry: {
    displayName: "Sentry",
    description: "Error tracking and performance monitoring",
    envVars: ["SENTRY_AUTH_TOKEN", "SENTRY_ORG"],
    keyOperations: ["listIssues", "getIssue", "listProjects"],
    config: {
      type: "rest",
      baseUrl: "https://sentry.io/api/0",
      auth: {
        type: "bearer",
        token: "${SENTRY_AUTH_TOKEN}",
      },
      endpoints: [
        {
          name: "listProjects",
          method: "GET",
          path: "/organizations/${SENTRY_ORG}/projects/",
          description: "List all projects in the organization",
        },
        {
          name: "listIssues",
          method: "GET",
          path: "/projects/${SENTRY_ORG}/{project_slug}/issues/",
          description: "List issues for a project",
        },
        {
          name: "getIssue",
          method: "GET",
          path: "/issues/{issue_id}/",
          description: "Get issue details with events",
        },
        {
          name: "getLatestEvent",
          method: "GET",
          path: "/issues/{issue_id}/events/latest/",
          description: "Get the latest event for an issue",
        },
        {
          name: "listAlerts",
          method: "GET",
          path: "/organizations/${SENTRY_ORG}/alert-rules/",
          description: "List alert rules",
        },
      ],
    },
  },

  splunk: {
    displayName: "Splunk",
    description: "Log management and SIEM platform",
    envVars: ["SPLUNK_HOST", "SPLUNK_TOKEN"],
    keyOperations: ["search", "getSavedSearches", "getAlerts"],
    config: {
      type: "rest",
      baseUrl: "${SPLUNK_HOST}",
      auth: {
        type: "bearer",
        token: "${SPLUNK_TOKEN}",
      },
      endpoints: [
        {
          name: "createSearchJob",
          method: "POST",
          path: "/services/search/jobs",
          description: "Create a search job",
        },
        {
          name: "getSearchResults",
          method: "GET",
          path: "/services/search/jobs/{search_id}/results",
          description: "Get search job results",
        },
        {
          name: "listSavedSearches",
          method: "GET",
          path: "/services/saved/searches",
          description: "List saved searches",
        },
        {
          name: "listAlerts",
          method: "GET",
          path: "/services/alerts/fired_alerts",
          description: "List fired alerts",
        },
      ],
    },
  },

  grafana: {
    displayName: "Grafana Cloud",
    description: "Observability platform (metrics, logs, traces)",
    envVars: ["GRAFANA_API_KEY", "GRAFANA_URL"],
    keyOperations: ["queryMetrics", "listDashboards", "listAlerts"],
    config: {
      type: "rest",
      baseUrl: "${GRAFANA_URL}/api",
      auth: {
        type: "bearer",
        token: "${GRAFANA_API_KEY}",
      },
      endpoints: [
        {
          name: "listDashboards",
          method: "GET",
          path: "/search",
          description: "Search dashboards",
        },
        {
          name: "getDashboard",
          method: "GET",
          path: "/dashboards/uid/{uid}",
          description: "Get dashboard by UID",
        },
        {
          name: "listAlertRules",
          method: "GET",
          path: "/v1/provisioning/alert-rules",
          description: "List alert rules",
        },
        {
          name: "queryDatasource",
          method: "POST",
          path: "/ds/query",
          description: "Query a datasource (Prometheus, Loki, etc.)",
        },
      ],
    },
  },

  dynatrace: {
    displayName: "Dynatrace",
    description: "Full-stack observability and AIOps platform",
    envVars: ["DYNATRACE_API_TOKEN", "DYNATRACE_ENV_URL"],
    keyOperations: ["listProblems", "getMetrics", "getEntities"],
    config: {
      type: "rest",
      baseUrl: "${DYNATRACE_ENV_URL}/api/v2",
      auth: {
        type: "header",
        name: "Authorization",
        value: "Api-Token ${DYNATRACE_API_TOKEN}",
      },
      endpoints: [
        {
          name: "listProblems",
          method: "GET",
          path: "/problems",
          description: "List detected problems",
        },
        {
          name: "getProblem",
          method: "GET",
          path: "/problems/{problemId}",
          description: "Get problem details",
        },
        {
          name: "queryMetrics",
          method: "GET",
          path: "/metrics/query",
          description: "Query metrics",
        },
        {
          name: "listEntities",
          method: "GET",
          path: "/entities",
          description: "List monitored entities",
        },
      ],
    },
  },

  // ============================================================
  // Communication
  // ============================================================

  slack: {
    displayName: "Slack",
    description: "Team messaging and notifications",
    envVars: ["SLACK_BOT_TOKEN"],
    keyOperations: ["postMessage", "listChannels", "searchMessages"],
    config: {
      type: "api",
      openapi:
        "https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json",
      baseUrl: "https://slack.com/api",
      auth: {
        type: "bearer",
        token: "${SLACK_BOT_TOKEN}",
      },
      operations: [
        "chat_postMessage",
        "conversations_list",
        "conversations_history",
        "search_messages",
        "users_list",
      ],
    },
  },

  "microsoft-teams": {
    displayName: "Microsoft Teams",
    description: "Team collaboration and messaging (Microsoft 365)",
    envVars: ["MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    keyOperations: ["sendMessage", "listChannels", "listTeams"],
    config: {
      type: "rest",
      baseUrl: "https://graph.microsoft.com/v1.0",
      auth: {
        type: "bearer",
        token: "${MICROSOFT_ACCESS_TOKEN}", // OAuth2 token obtained via client credentials
      },
      endpoints: [
        {
          name: "listTeams",
          method: "GET",
          path: "/me/joinedTeams",
          description: "List teams the app has access to",
        },
        {
          name: "listChannels",
          method: "GET",
          path: "/teams/{team_id}/channels",
          description: "List channels in a team",
        },
        {
          name: "sendMessage",
          method: "POST",
          path: "/teams/{team_id}/channels/{channel_id}/messages",
          description: "Send a message to a channel",
        },
        {
          name: "listMessages",
          method: "GET",
          path: "/teams/{team_id}/channels/{channel_id}/messages",
          description: "List messages in a channel",
        },
      ],
    },
  },

  discord: {
    displayName: "Discord",
    description: "Community messaging and voice platform",
    envVars: ["DISCORD_BOT_TOKEN"],
    keyOperations: ["sendMessage", "listChannels", "listGuilds"],
    config: {
      type: "rest",
      baseUrl: "https://discord.com/api/v10",
      auth: {
        type: "header",
        name: "Authorization",
        value: "Bot ${DISCORD_BOT_TOKEN}",
      },
      endpoints: [
        {
          name: "listGuilds",
          method: "GET",
          path: "/users/@me/guilds",
          description: "List guilds the bot is in",
        },
        {
          name: "listChannels",
          method: "GET",
          path: "/guilds/{guild_id}/channels",
          description: "List channels in a guild",
        },
        {
          name: "sendMessage",
          method: "POST",
          path: "/channels/{channel_id}/messages",
          description: "Send a message to a channel",
        },
        {
          name: "getMessages",
          method: "GET",
          path: "/channels/{channel_id}/messages",
          description: "Get messages from a channel",
        },
      ],
    },
  },

  // ============================================================
  // Issue Tracking
  // ============================================================

  jira: {
    displayName: "Jira",
    description: "Issue and project tracking",
    envVars: ["JIRA_API_TOKEN", "JIRA_EMAIL", "JIRA_BASE_URL"],
    keyOperations: ["searchIssues", "getIssue", "createIssue"],
    config: {
      type: "rest",
      baseUrl: "${JIRA_BASE_URL}/rest/api/3",
      auth: {
        type: "basic",
        username: "${JIRA_EMAIL}",
        password: "${JIRA_API_TOKEN}",
      },
      endpoints: [
        {
          name: "searchIssues",
          method: "POST",
          path: "/search",
          description: "Search for issues using JQL",
        },
        {
          name: "getIssue",
          method: "GET",
          path: "/issue/{issueIdOrKey}",
          description: "Get issue details",
        },
        {
          name: "createIssue",
          method: "POST",
          path: "/issue",
          description: "Create a new issue",
        },
        {
          name: "listProjects",
          method: "GET",
          path: "/project/search",
          description: "List all projects",
        },
      ],
    },
  },

  linear: {
    displayName: "Linear",
    description: "Modern issue tracking",
    envVars: ["LINEAR_API_KEY"],
    keyOperations: ["listIssues", "getIssue", "createIssue"],
    config: {
      type: "rest",
      baseUrl: "https://api.linear.app/graphql",
      auth: {
        type: "bearer",
        token: "${LINEAR_API_KEY}",
      },
      endpoints: [
        {
          name: "graphqlQuery",
          method: "POST",
          path: "",
          description: "Execute a GraphQL query against Linear API",
        },
      ],
    },
  },

  asana: {
    displayName: "Asana",
    description: "Work management and project tracking",
    envVars: ["ASANA_ACCESS_TOKEN"],
    keyOperations: ["listTasks", "getTask", "createTask", "listProjects"],
    config: {
      type: "rest",
      baseUrl: "https://app.asana.com/api/1.0",
      auth: {
        type: "bearer",
        token: "${ASANA_ACCESS_TOKEN}",
      },
      endpoints: [
        {
          name: "listWorkspaces",
          method: "GET",
          path: "/workspaces",
          description: "List all workspaces",
        },
        {
          name: "listProjects",
          method: "GET",
          path: "/projects",
          description: "List all projects",
        },
        {
          name: "listTasks",
          method: "GET",
          path: "/tasks",
          description: "List tasks in a project or for a user",
        },
        {
          name: "getTask",
          method: "GET",
          path: "/tasks/{task_gid}",
          description: "Get task details",
        },
        {
          name: "createTask",
          method: "POST",
          path: "/tasks",
          description: "Create a new task",
        },
      ],
    },
  },

  shortcut: {
    displayName: "Shortcut",
    description: "Project management for software teams (formerly Clubhouse)",
    envVars: ["SHORTCUT_API_TOKEN"],
    keyOperations: ["listStories", "getStory", "createStory", "searchStories"],
    config: {
      type: "rest",
      baseUrl: "https://api.app.shortcut.com/api/v3",
      auth: {
        type: "header",
        name: "Shortcut-Token",
        value: "${SHORTCUT_API_TOKEN}",
      },
      endpoints: [
        {
          name: "searchStories",
          method: "GET",
          path: "/search/stories",
          description: "Search stories",
        },
        {
          name: "getStory",
          method: "GET",
          path: "/stories/{story_public_id}",
          description: "Get story details",
        },
        {
          name: "createStory",
          method: "POST",
          path: "/stories",
          description: "Create a new story",
        },
        {
          name: "listProjects",
          method: "GET",
          path: "/projects",
          description: "List all projects",
        },
        {
          name: "listEpics",
          method: "GET",
          path: "/epics",
          description: "List all epics",
        },
      ],
    },
  },

  // ============================================================
  // Version Control (Beyond GitHub)
  // ============================================================

  gitlab: {
    displayName: "GitLab",
    description: "Git repository, CI/CD, and DevOps platform",
    envVars: ["GITLAB_TOKEN"],
    keyOperations: ["listProjects", "searchCode", "getFile", "createMR"],
    config: {
      type: "api",
      openapi:
        "https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/openapi/openapi.yaml",
      baseUrl: "${GITLAB_BASE_URL:-https://gitlab.com/api/v4}",
      auth: {
        type: "header",
        name: "PRIVATE-TOKEN",
        value: "${GITLAB_TOKEN}",
      },
      operations: [
        "getProjects",
        "getProject",
        "getRepositoryTree",
        "getRepositoryFile",
        "searchCode",
        "getMergeRequests",
        "createMergeRequest",
      ],
    },
  },

  bitbucket: {
    displayName: "Bitbucket",
    description: "Git repository hosting and CI/CD",
    envVars: ["BITBUCKET_USERNAME", "BITBUCKET_APP_PASSWORD"],
    keyOperations: ["listRepos", "getFile", "searchCode", "createPR"],
    config: {
      type: "api",
      openapi:
        "https://api.bitbucket.org/swagger.json",
      baseUrl: "https://api.bitbucket.org/2.0",
      auth: {
        type: "basic",
        username: "${BITBUCKET_USERNAME}",
        password: "${BITBUCKET_APP_PASSWORD}",
      },
      operations: [
        "getRepositories",
        "getRepository",
        "getSrc",
        "getPullRequests",
        "createPullRequest",
      ],
    },
  },

  "azure-devops": {
    displayName: "Azure DevOps",
    description: "Microsoft DevOps platform (repos, boards, pipelines)",
    envVars: ["AZURE_DEVOPS_PAT", "AZURE_DEVOPS_ORG"],
    keyOperations: ["listRepos", "getFile", "listWorkItems", "listPipelines"],
    config: {
      type: "rest",
      baseUrl: "https://dev.azure.com/${AZURE_DEVOPS_ORG}",
      auth: {
        type: "basic",
        username: "",
        password: "${AZURE_DEVOPS_PAT}",
      },
      endpoints: [
        {
          name: "listProjects",
          method: "GET",
          path: "/_apis/projects",
          description: "List all projects in the organization",
        },
        {
          name: "listRepositories",
          method: "GET",
          path: "/{project}/_apis/git/repositories",
          description: "List repositories in a project",
        },
        {
          name: "getFileContent",
          method: "GET",
          path: "/{project}/_apis/git/repositories/{repositoryId}/items",
          description: "Get file content from a repository",
        },
        {
          name: "listWorkItems",
          method: "POST",
          path: "/{project}/_apis/wit/wiql",
          description: "Query work items using WIQL",
        },
        {
          name: "listPipelines",
          method: "GET",
          path: "/{project}/_apis/pipelines",
          description: "List build/release pipelines",
        },
      ],
    },
  },

  // ============================================================
  // Cloud Providers & Platforms
  // ============================================================

  vercel: {
    displayName: "Vercel",
    description: "Deployment and hosting platform",
    envVars: ["VERCEL_TOKEN"],
    keyOperations: ["listDeployments", "getDeployment", "listProjects"],
    config: {
      type: "api",
      openapi: "https://openapi.vercel.sh/",
      baseUrl: "https://api.vercel.com",
      auth: {
        type: "bearer",
        token: "${VERCEL_TOKEN}",
      },
      operations: [
        "listDeployments",
        "getDeployment",
        "listProjects",
        "getProject",
        "listDomains",
      ],
    },
  },

  render: {
    displayName: "Render",
    description: "Cloud application hosting platform",
    envVars: ["RENDER_API_KEY"],
    keyOperations: ["listServices", "getService", "listDeploys"],
    config: {
      type: "api",
      openapi: "https://api-docs.render.com/openapi/6140fb3daeae351056086186",
      baseUrl: "https://api.render.com/v1",
      auth: {
        type: "bearer",
        token: "${RENDER_API_KEY}",
      },
      operations: ["getServices", "getService", "getDeploys"],
    },
  },

  railway: {
    displayName: "Railway",
    description: "Infrastructure platform for deploying apps",
    envVars: ["RAILWAY_API_TOKEN"],
    keyOperations: ["listProjects", "getDeployments"],
    config: {
      type: "rest",
      baseUrl: "https://backboard.railway.app/graphql/v2",
      auth: {
        type: "bearer",
        token: "${RAILWAY_API_TOKEN}",
      },
      endpoints: [
        {
          name: "graphqlQuery",
          method: "POST",
          path: "",
          description: "Execute a GraphQL query against Railway API",
        },
      ],
    },
  },

  // ============================================================
  // CI/CD Platforms
  // ============================================================

  circleci: {
    displayName: "CircleCI",
    description: "Continuous integration and delivery platform",
    envVars: ["CIRCLECI_TOKEN"],
    keyOperations: ["listPipelines", "getPipeline", "listWorkflows"],
    config: {
      type: "rest",
      baseUrl: "https://circleci.com/api/v2",
      auth: {
        type: "header",
        name: "Circle-Token",
        value: "${CIRCLECI_TOKEN}",
      },
      endpoints: [
        {
          name: "listPipelines",
          method: "GET",
          path: "/project/{project_slug}/pipeline",
          description: "List pipelines for a project",
        },
        {
          name: "getPipeline",
          method: "GET",
          path: "/pipeline/{pipeline_id}",
          description: "Get pipeline details",
        },
        {
          name: "listWorkflows",
          method: "GET",
          path: "/pipeline/{pipeline_id}/workflow",
          description: "List workflows in a pipeline",
        },
        {
          name: "getWorkflow",
          method: "GET",
          path: "/workflow/{id}",
          description: "Get workflow details",
        },
        {
          name: "listJobs",
          method: "GET",
          path: "/workflow/{id}/job",
          description: "List jobs in a workflow",
        },
      ],
    },
  },

  "github-actions": {
    displayName: "GitHub Actions",
    description: "CI/CD built into GitHub (uses GitHub API)",
    envVars: ["GITHUB_TOKEN"],
    keyOperations: ["listWorkflowRuns", "getWorkflowRun", "listArtifacts"],
    config: {
      type: "rest",
      baseUrl: "https://api.github.com",
      auth: {
        type: "bearer",
        token: "${GITHUB_TOKEN}",
      },
      endpoints: [
        {
          name: "listWorkflowRuns",
          method: "GET",
          path: "/repos/{owner}/{repo}/actions/runs",
          description: "List workflow runs for a repository",
        },
        {
          name: "getWorkflowRun",
          method: "GET",
          path: "/repos/{owner}/{repo}/actions/runs/{run_id}",
          description: "Get a workflow run",
        },
        {
          name: "listWorkflowJobs",
          method: "GET",
          path: "/repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
          description: "List jobs for a workflow run",
        },
        {
          name: "downloadWorkflowLogs",
          method: "GET",
          path: "/repos/{owner}/{repo}/actions/runs/{run_id}/logs",
          description: "Download workflow run logs",
        },
        {
          name: "listArtifacts",
          method: "GET",
          path: "/repos/{owner}/{repo}/actions/artifacts",
          description: "List artifacts for a repository",
        },
      ],
    },
  },

  jenkins: {
    displayName: "Jenkins",
    description: "Open source automation server",
    envVars: ["JENKINS_URL", "JENKINS_USER", "JENKINS_API_TOKEN"],
    keyOperations: ["listJobs", "getBuild", "getConsoleOutput"],
    config: {
      type: "rest",
      baseUrl: "${JENKINS_URL}",
      auth: {
        type: "basic",
        username: "${JENKINS_USER}",
        password: "${JENKINS_API_TOKEN}",
      },
      endpoints: [
        {
          name: "listJobs",
          method: "GET",
          path: "/api/json",
          description: "List all jobs",
        },
        {
          name: "getJob",
          method: "GET",
          path: "/job/{name}/api/json",
          description: "Get job details",
        },
        {
          name: "getBuild",
          method: "GET",
          path: "/job/{name}/{build_number}/api/json",
          description: "Get build details",
        },
        {
          name: "getConsoleOutput",
          method: "GET",
          path: "/job/{name}/{build_number}/consoleText",
          description: "Get build console output",
        },
      ],
    },
  },

  // ============================================================
  // Documentation
  // ============================================================

  confluence: {
    displayName: "Confluence",
    description: "Wiki and documentation platform (Atlassian)",
    envVars: ["CONFLUENCE_API_TOKEN", "CONFLUENCE_EMAIL", "CONFLUENCE_BASE_URL"],
    keyOperations: ["searchContent", "getPage", "createPage"],
    config: {
      type: "rest",
      baseUrl: "${CONFLUENCE_BASE_URL}/wiki/rest/api",
      auth: {
        type: "basic",
        username: "${CONFLUENCE_EMAIL}",
        password: "${CONFLUENCE_API_TOKEN}",
      },
      endpoints: [
        {
          name: "searchContent",
          method: "GET",
          path: "/content/search",
          description: "Search content using CQL",
        },
        {
          name: "getPage",
          method: "GET",
          path: "/content/{id}",
          description: "Get page content",
        },
        {
          name: "createPage",
          method: "POST",
          path: "/content",
          description: "Create a new page",
        },
        {
          name: "updatePage",
          method: "PUT",
          path: "/content/{id}",
          description: "Update a page",
        },
        {
          name: "listSpaces",
          method: "GET",
          path: "/space",
          description: "List all spaces",
        },
      ],
    },
  },

  // ============================================================
  // AWS Services
  // ============================================================

  "aws-cloudwatch-metrics": {
    displayName: "AWS CloudWatch Metrics",
    description: "AWS metrics and alarms (requires AWS SDK credentials)",
    envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    keyOperations: ["getMetricData", "listMetrics", "describeAlarms"],
    config: {
      type: "rest",
      baseUrl: "https://monitoring.${AWS_REGION}.amazonaws.com",
      auth: {
        type: "header",
        name: "Authorization",
        value: "AWS4-HMAC-SHA256", // Requires AWS Signature V4
      },
      endpoints: [
        {
          name: "getMetricData",
          method: "POST",
          path: "/",
          description: "Get metric data points",
        },
        {
          name: "listMetrics",
          method: "POST",
          path: "/",
          description: "List available metrics",
        },
        {
          name: "describeAlarms",
          method: "POST",
          path: "/",
          description: "Describe CloudWatch alarms",
        },
      ],
    },
  },

  "aws-xray": {
    displayName: "AWS X-Ray",
    description: "Distributed tracing for AWS applications",
    envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    keyOperations: ["getTraceSummaries", "getTrace", "getServiceGraph"],
    config: {
      type: "rest",
      baseUrl: "https://xray.${AWS_REGION}.amazonaws.com",
      auth: {
        type: "header",
        name: "Authorization",
        value: "AWS4-HMAC-SHA256",
      },
      endpoints: [
        {
          name: "getTraceSummaries",
          method: "POST",
          path: "/TraceSummaries",
          description: "Get trace summaries",
        },
        {
          name: "batchGetTraces",
          method: "POST",
          path: "/Traces",
          description: "Get full traces by ID",
        },
        {
          name: "getServiceGraph",
          method: "POST",
          path: "/ServiceGraph",
          description: "Get service dependency graph",
        },
      ],
    },
  },

  // ============================================================
  // Google Cloud Services
  // ============================================================

  "gcp-logging": {
    displayName: "Google Cloud Logging",
    description: "GCP log management (Stackdriver)",
    envVars: ["GOOGLE_APPLICATION_CREDENTIALS", "GCP_PROJECT_ID"],
    keyOperations: ["listLogs", "readLogEntries"],
    config: {
      type: "rest",
      baseUrl: "https://logging.googleapis.com/v2",
      auth: {
        type: "bearer",
        token: "${GCP_ACCESS_TOKEN}", // OAuth2 token from service account
      },
      endpoints: [
        {
          name: "listLogEntries",
          method: "POST",
          path: "/entries:list",
          description: "List log entries",
        },
        {
          name: "listLogs",
          method: "GET",
          path: "/projects/${GCP_PROJECT_ID}/logs",
          description: "List available logs",
        },
      ],
    },
  },

  "gcp-monitoring": {
    displayName: "Google Cloud Monitoring",
    description: "GCP metrics and alerting",
    envVars: ["GOOGLE_APPLICATION_CREDENTIALS", "GCP_PROJECT_ID"],
    keyOperations: ["queryTimeSeries", "listAlertPolicies"],
    config: {
      type: "rest",
      baseUrl: "https://monitoring.googleapis.com/v3",
      auth: {
        type: "bearer",
        token: "${GCP_ACCESS_TOKEN}",
      },
      endpoints: [
        {
          name: "listTimeSeries",
          method: "GET",
          path: "/projects/${GCP_PROJECT_ID}/timeSeries",
          description: "Query metrics time series",
        },
        {
          name: "listAlertPolicies",
          method: "GET",
          path: "/projects/${GCP_PROJECT_ID}/alertPolicies",
          description: "List alert policies",
        },
      ],
    },
  },

  // ============================================================
  // Azure Services
  // ============================================================

  "azure-monitor": {
    displayName: "Azure Monitor",
    description: "Azure monitoring and logging",
    envVars: ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_SUBSCRIPTION_ID"],
    keyOperations: ["queryLogs", "listMetrics", "listAlerts"],
    config: {
      type: "rest",
      baseUrl: "https://management.azure.com",
      auth: {
        type: "bearer",
        token: "${AZURE_ACCESS_TOKEN}",
      },
      endpoints: [
        {
          name: "queryLogs",
          method: "POST",
          path: "/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.OperationalInsights/workspaces/{workspace_id}/query",
          description: "Query Log Analytics",
        },
        {
          name: "listMetrics",
          method: "GET",
          path: "/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/{resource_group}/providers/{resource_type}/{resource_name}/providers/Microsoft.Insights/metrics",
          description: "Get resource metrics",
        },
        {
          name: "listAlerts",
          method: "GET",
          path: "/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.AlertsManagement/alerts",
          description: "List alerts",
        },
      ],
    },
  },

  // ============================================================
  // MCP Servers (when implemented)
  // ============================================================

  // Notion MCP Server
  "notion-mcp": {
    displayName: "Notion (MCP)",
    description: "Notion workspace via MCP server",
    envVars: ["NOTION_TOKEN"],
    keyOperations: ["search", "getPage", "createPage"],
    config: {
      type: "mcp",
      package: "@notionhq/notion-mcp-server",
      env: {
        OPENAPI_MCP_HEADERS: "Authorization: Bearer ${NOTION_TOKEN}",
      },
    },
  },

  // GitHub MCP Server
  "github-mcp": {
    displayName: "GitHub (MCP)",
    description: "GitHub via MCP server",
    envVars: ["GITHUB_TOKEN"],
    keyOperations: ["searchCode", "getFile", "createPR"],
    config: {
      type: "mcp",
      package: "@modelcontextprotocol/server-github",
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
      },
    },
  },

  // CloudWatch Logs MCP Server
  "cloudwatch-mcp": {
    displayName: "CloudWatch Logs (MCP)",
    description: "Query CloudWatch Logs Insights via MCP server",
    envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
    keyOperations: ["cloudwatch_query_logs", "cloudwatch_list_log_groups"],
    config: {
      type: "mcp",
      package: "@ai-automation/mcp-cloudwatch",
      env: {
        AWS_REGION: "${AWS_REGION:-us-east-1}",
      },
    },
  },

  // ============================================================
  // Testing & Development
  // ============================================================

  httpbin: {
    displayName: "HTTPBin",
    description: "HTTP testing service (for development)",
    envVars: [], // Always available, no auth needed
    keyOperations: ["GET__ip", "GET__headers"],
    config: {
      type: "api",
      openapi:
        "https://raw.githubusercontent.com/APIs-guru/openapi-directory/main/APIs/httpbin.org/0.9.2/openapi.yaml",
      baseUrl: "https://httpbin.org",
      operations: ["GET__ip", "GET__headers", "GET__user-agent"],
    },
  },

  jsonplaceholder: {
    displayName: "JSONPlaceholder",
    description: "Fake REST API for testing",
    envVars: [], // Always available, no auth needed
    keyOperations: ["listPosts", "getPost", "listUsers"],
    config: {
      type: "rest",
      baseUrl: "https://jsonplaceholder.typicode.com",
      endpoints: [
        {
          name: "listPosts",
          method: "GET",
          path: "/posts",
          description: "List all posts",
        },
        {
          name: "getPost",
          method: "GET",
          path: "/posts/{id}",
          description: "Get a specific post",
        },
        {
          name: "listUsers",
          method: "GET",
          path: "/users",
          description: "List all users",
        },
        {
          name: "getUser",
          method: "GET",
          path: "/users/{id}",
          description: "Get a specific user",
        },
      ],
    },
  },
};

/**
 * Check if an integration's required environment variables are set
 */
export function isIntegrationEnabled(name: string): boolean {
  const known = KNOWN_INTEGRATIONS[name];
  if (!known) return false;

  // No env vars required = always enabled (test integrations)
  if (known.envVars.length === 0) return true;

  // Check if at least the primary env var is set
  // (first in the list is considered the primary/required one)
  return !!process.env[known.envVars[0]];
}

/**
 * Get all integrations that should be auto-enabled based on environment
 */
export function getAutoEnabledIntegrations(): string[] {
  return Object.keys(KNOWN_INTEGRATIONS).filter(isIntegrationEnabled);
}

/**
 * Get the configuration for a known integration with env var substitution
 */
export function getKnownIntegrationConfig(
  name: string
): KnownIntegration["config"] | null {
  const known = KNOWN_INTEGRATIONS[name];
  if (!known) return null;

  // Deep clone and substitute env vars
  return substituteEnvVars(JSON.parse(JSON.stringify(known.config)));
}

/**
 * Recursively substitute ${VAR} patterns with environment variable values
 */
function substituteEnvVars<T>(obj: T): T {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || "";
    }) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars) as T;
  }

  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value);
    }
    return result as T;
  }

  return obj;
}

/**
 * Get human-readable summary of available integrations
 */
export function getIntegrationsSummary(): string {
  const enabled = getAutoEnabledIntegrations();
  const available = Object.entries(KNOWN_INTEGRATIONS)
    .filter(([name]) => !enabled.includes(name))
    .map(([name, info]) => `  ${name}: set ${info.envVars.join(", ")}`);

  const lines = [
    "Auto-enabled integrations:",
    ...enabled.map((name) => `  ✓ ${name} (${KNOWN_INTEGRATIONS[name].displayName})`),
    "",
    "Available integrations (set env vars to enable):",
    ...available,
  ];

  return lines.join("\n");
}
