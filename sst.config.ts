/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "ai-automation-platform",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    // DynamoDB Tables
    const itemsTable = new sst.aws.Dynamo("Items", {
      fields: {
        workspace_id: "string",
        item_id: "string",
      },
      primaryIndex: { hashKey: "workspace_id", rangeKey: "item_id" },
    });

    const alertsTable = new sst.aws.Dynamo("Alerts", {
      fields: {
        workspace_id: "string",
        alert_id: "string",
        trigger_id: "string",
        created_at: "string",
      },
      primaryIndex: { hashKey: "workspace_id", rangeKey: "alert_id" },
      globalIndexes: {
        byTrigger: { hashKey: "trigger_id", rangeKey: "created_at" },
      },
    });

    const tasksTable = new sst.aws.Dynamo("Tasks", {
      fields: {
        workspace_id: "string",
        task_id: "string",
      },
      primaryIndex: { hashKey: "workspace_id", rangeKey: "task_id" },
    });

    const agentRunsTable = new sst.aws.Dynamo("AgentRuns", {
      fields: {
        workspace_id: "string",
        run_id: "string",
        trigger_id: "string",
        created_at: "string",
      },
      primaryIndex: { hashKey: "workspace_id", rangeKey: "run_id" },
      globalIndexes: {
        byTrigger: { hashKey: "trigger_id", rangeKey: "created_at" },
      },
    });

    // EventBridge Bus
    const bus = new sst.aws.Bus("Bus");

    // Environment variables for functions
    const llmEnv = {
      LLM_PROVIDER: process.env.LLM_PROVIDER || "ollama",
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      OLLAMA_MODEL: process.env.OLLAMA_MODEL || "llama3.1:8b",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    };

    // Notification environment variables
    const notificationEnv = {
      SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || "",
      RESEND_API_KEY: process.env.RESEND_API_KEY || "",
      ALERT_EMAIL_TO: process.env.ALERT_EMAIL_TO || "",
      ALERT_EMAIL_FROM: process.env.ALERT_EMAIL_FROM || "onboarding@resend.dev",
    };

    // API (defined early so it can be linked to subscribers)
    const api = new sst.aws.ApiGatewayV2("Api");

    // Classification subscriber - triggered by item.created events
    bus.subscribe("classification", {
      handler: "packages/functions/src/classification/classify.handler",
      link: [itemsTable, alertsTable, bus],
      environment: llmEnv,
      timeout: "60 seconds",
    }, {
      pattern: {
        detailType: ["item.created"],
      },
    });

    // Alert triage subscriber - triggered by alert.created events
    bus.subscribe("alert-triage", {
      handler: "packages/functions/src/agents/alert-triage.handler",
      link: [alertsTable, agentRunsTable, itemsTable],
      environment: { ...llmEnv, ...notificationEnv },
      timeout: "120 seconds",
    }, {
      pattern: {
        detailType: ["alert.created"],
      },
    });

    // Notification dispatcher subscriber
    bus.subscribe("notifications", {
      handler: "packages/functions/src/notifications/dispatcher.handler",
      environment: notificationEnv,
      timeout: "30 seconds",
    }, {
      pattern: {
        detailType: ["notification.requested"],
      },
    });

    // DevOps Investigator agent subscriber
    bus.subscribe("devops-investigator", {
      handler: "packages/functions/src/agents/devops-investigator.handler",
      link: [alertsTable, agentRunsTable, itemsTable, api],
      environment: {
        ...llmEnv,
        ...notificationEnv,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
      },
      timeout: "120 seconds",
      permissions: [
        {
          actions: [
            "logs:StartQuery",
            "logs:GetQueryResults",
            "logs:DescribeLogGroups",
          ],
          resources: ["*"],
        },
      ],
    }, {
      pattern: {
        detailType: ["investigation.requested"],
      },
    });

    // Agent Resume subscriber - triggered when approval is decided
    bus.subscribe("agent-resume", {
      handler: "packages/functions/src/agents/agent-resume.handler",
      link: [agentRunsTable, api],
      environment: {
        ...llmEnv,
        ...notificationEnv,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
      },
      timeout: "120 seconds",
      permissions: [
        {
          actions: [
            "logs:StartQuery",
            "logs:GetQueryResults",
            "logs:DescribeLogGroups",
          ],
          resources: ["*"],
        },
      ],
    }, {
      pattern: {
        detailType: ["approval.decided"],
      },
    });

    // Health check
    api.route("GET /", {
      handler: "packages/functions/src/api/health.handler",
    });

    // Webhooks (ingestion)
    api.route("POST /webhooks/datadog", {
      handler: "packages/functions/src/ingestion/datadog.handler",
      link: [itemsTable, bus],
    });

    api.route("POST /ingest/email", {
      handler: "packages/functions/src/ingestion/email.handler",
      link: [itemsTable, bus],
    });

    // Alerts API
    api.route("GET /alerts", {
      handler: "packages/functions/src/api/alerts.list",
      link: [alertsTable],
    });

    api.route("GET /alerts/{id}", {
      handler: "packages/functions/src/api/alerts.get",
      link: [alertsTable, agentRunsTable],
    });

    // Items API
    api.route("GET /items", {
      handler: "packages/functions/src/api/items.list",
      link: [itemsTable],
    });

    api.route("GET /items/{id}", {
      handler: "packages/functions/src/api/items.get",
      link: [itemsTable],
    });

    // Tasks API
    api.route("GET /tasks", {
      handler: "packages/functions/src/api/tasks.list",
      link: [tasksTable],
    });

    // Agent runs API
    api.route("GET /agent-runs", {
      handler: "packages/functions/src/api/agent-runs.list",
      link: [agentRunsTable],
    });

    api.route("GET /agent-runs/{id}", {
      handler: "packages/functions/src/api/agent-runs.get",
      link: [agentRunsTable],
    });

    // Manual agent trigger
    api.route("POST /agents/{agentKey}/run", {
      handler: "packages/functions/src/api/agents.runAgent",
      link: [bus],
    });

    // Investigation API
    api.route("POST /investigate", {
      handler: "packages/functions/src/api/investigate.handler",
      link: [bus],
    });

    // Approval API endpoints
    api.route("GET /approvals", {
      handler: "packages/functions/src/api/approvals.list",
      link: [agentRunsTable],
    });

    api.route("POST /approvals/{id}/approve", {
      handler: "packages/functions/src/api/approvals.approve",
      link: [agentRunsTable, bus],
    });

    api.route("POST /approvals/{id}/reject", {
      handler: "packages/functions/src/api/approvals.reject",
      link: [agentRunsTable, bus],
    });

    return {
      api: api.url,
    };
  },
});
