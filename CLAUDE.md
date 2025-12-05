# AI Automation Platform - Claude Code Guidelines

## Project Overview

This is an AI-powered automation platform with two primary modes:
1. **Engineering Mode (AI On-Call Engineer)** - Autonomous agent that investigates production issues, diagnoses root causes, and proposes fixes
2. **Personal Mode** - Daily digest, task extraction, and personal automation (future)

## Project Structure

```
ai-automation-platform/
├── packages/
│   ├── core/                    # Shared business logic
│   │   └── src/
│   │       ├── agent/           # Agent loop and prompts
│   │       │   ├── loop.ts      # Multi-step agent execution
│   │       │   └── prompts/     # Agent system prompts
│   │       ├── llm/             # LLM providers and client
│   │       │   ├── client.ts    # LLM client with tool calling
│   │       │   └── providers/   # Ollama, Anthropic providers
│   │       ├── notifications/   # Email, Slack, Teams
│   │       ├── safety/          # Guardrails, audit, approvals
│   │       ├── tools/           # Agent tools (CloudWatch, GitHub, etc.)
│   │       │   ├── registry.ts  # Tool registration and execution
│   │       │   ├── cloudwatch.ts
│   │       │   └── github.ts
│   │       └── types/           # Shared TypeScript types
│   │
│   └── functions/               # Lambda handlers
│       └── src/
│           ├── agents/          # Agent Lambda handlers
│           │   ├── alert-triage.ts
│           │   └── devops-investigator.ts
│           ├── api/             # API route handlers
│           │   ├── alerts.ts
│           │   ├── agent-runs.ts
│           │   ├── approvals.ts
│           │   └── investigate.ts
│           ├── classification/  # Item classification
│           ├── ingestion/       # Webhook handlers (Datadog, email)
│           └── notifications/   # Notification dispatcher
│
├── sst.config.ts               # SST infrastructure config
├── .env                        # Environment variables (not committed)
└── claude.md                   # This file
```

## Where to Put New Code

| Type of Code | Location |
|-------------|----------|
| New agent tool | `packages/core/src/tools/` - create file, register in `index.ts` |
| New agent prompt | `packages/core/src/agent/prompts/` |
| New agent Lambda | `packages/functions/src/agents/` + add to `sst.config.ts` |
| New API endpoint | `packages/functions/src/api/` + add route to `sst.config.ts` |
| New notification provider | `packages/core/src/notifications/` |
| New LLM provider | `packages/core/src/llm/providers/` |
| Safety/guardrail logic | `packages/core/src/safety/` |
| Shared types | `packages/core/src/types/` |

## Tool Risk Tiers

When creating new agent tools, assign appropriate risk tiers:

| Tier | Auto-Execute | Examples |
|------|--------------|----------|
| `read_only` | Yes | Log queries, code search, file read, metrics |
| `safe_write` | Yes | Draft PRs, comments, issue creation |
| `destructive` | No - requires approval | Merge PRs, deploy, modify infrastructure, delete |

## Key Patterns

### Adding a New Tool

1. Create tool file in `packages/core/src/tools/`:
```typescript
import type { Tool, ToolResult, ToolContext } from "./types";
import type { ToolDefinition } from "../llm/providers/types";

const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "my_tool",
    description: "What this tool does",
    parameters: {
      type: "object",
      properties: { /* ... */ },
      required: ["param1"],
    },
  },
};

export const myTool: Tool = {
  name: "my_tool",
  description: definition.function.description,
  riskTier: "read_only", // or "safe_write" or "destructive"
  definition,
  execute: async (args, context) => {
    // Implementation
    return { success: true, output: "result" };
  },
};
```

2. Register in `packages/core/src/tools/index.ts`:
```typescript
import { myTool } from "./my-tool";
toolRegistry.register(myTool);
```

### Adding a New Agent

1. Create prompt in `packages/core/src/agent/prompts/`
2. Create Lambda handler in `packages/functions/src/agents/`
3. Add EventBridge subscriber in `sst.config.ts`
4. (Optional) Add API trigger endpoint

## Environment Variables

Required in `.env`:
```bash
LLM_PROVIDER=ollama              # or "anthropic"
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
RESEND_API_KEY=re_xxx            # For email notifications
ALERT_EMAIL_TO=your@email.com
GITHUB_TOKEN=ghp_xxx             # For GitHub tools
API_URL=https://xxx.execute-api.us-east-1.amazonaws.com  # From SST dev output
```

## Postman Collection

API endpoints are documented in a Postman collection for easy testing.

### Collection Details

| Property | Value |
|----------|-------|
| Collection Name | AI Automation Platform API |
| Workspace | Evan personal |
| Collection ID | `812a6ff9-b5d1-4b0d-b94c-5afef2ec514d` |
| Collection UID | `2483021-812a6ff9-b5d1-4b0d-b94c-5afef2ec514d` |

### Folders & Endpoints

| Folder | Endpoints |
|--------|-----------|
| Investigation | `POST /investigate` - Start AI investigation |
| Agent Runs | `GET /agent-runs` - List runs, `GET /agent-runs/:runId` - Get run details, `POST /agents/:agentKey/run` - Run agent manually |
| Approvals | `GET /approvals` - List pending, `POST /approvals/:id/approve`, `POST /approvals/:id/reject` |
| Alerts | `GET /alerts` - List alerts, `GET /alerts/:id` - Get alert details |
| Items | `GET /items` - List items, `GET /items/:id` - Get item details |
| Tasks | `GET /tasks` - List tasks |
| Webhooks | `POST /webhooks/datadog`, `POST /ingest/email` |
| (root) | `GET /` - Health check |

### Keeping Postman Updated

When adding new API endpoints:
1. Add the endpoint to `sst.config.ts`
2. Create the handler in `packages/functions/src/api/`
3. Add the request to the Postman collection using MCP tools:
   - Use `mcp__postman__createCollectionRequest` with collectionId `812a6ff9-b5d1-4b0d-b94c-5afef2ec514d`
   - Place in appropriate folder using `folderId`

Folder IDs for reference:
- Investigation: `a69166eb-e241-bdff-6c95-ce44098eb47c`
- Agent Runs: `bf9621ad-30df-a7ed-0e56-d1234b80feac`
- Approvals: `2f870162-8d96-6d39-c878-c06ea86030ac`
- Alerts: `2488ddde-5821-4daf-680a-d7b8b24e9ad0`
- Items: `b628af05-bc5a-7367-dcf7-8472d8d58f74`
- Tasks: `8a129252-292a-2b29-b496-b2a1fe381fe2`
- Webhooks: `68584e8e-5fdb-ed3c-3a43-75977bb03a4e`

## Notion Integration

### Keep Notion Updated

This project uses Notion as the source of truth for:
- **Tasks** - Track implementation progress
- **Integrations** - Document available integrations
- **Agents** - Document agent capabilities
- **Architecture docs** - System design

### Notion Resources

| Resource | URL/ID |
|----------|--------|
| Parent Page | `🚀 AI Automation Platform` |
| Tasks Database | `collection://2baac729-2af3-80df-afb6-000bb57bdd11` |
| AI On-Call Engineer Doc | `https://www.notion.so/2bbac7292af381fcab11f53804df6e58` |

### Task Schema

When creating tasks in Notion:
```typescript
{
  "Task Name": "string (title)",
  "Status": "Not Started" | "In Progress" | "Blocked" | "In Review" | "Done",
  "Category": "Core Platform" | "Engineering Mode" | "Personal Mode" | "UI/Frontend" | "Backend" | "Integrations" | "Infrastructure",
  "Mode": "Shared" | "Engineering" | "Personal",
  "Priority": "Low" | "Medium" | "High" | "Critical",
  "Effort": "S" | "M" | "L" | "XL",
  "Notes": "string",
  "Due Date": "YYYY-MM-DD" (optional)
}
```

### When to Update Notion

- **New feature completed** → Mark task as Done, add notes
- **New feature started** → Create task or mark as In Progress
- **Architecture change** → Update relevant doc page
- **New integration added** → Add to Integrations database
- **New agent created** → Add to Agents database, create doc page

## AWS Cost Management

**Important**: This project uses AWS free tier credits during development. Be conservative with AWS resource usage.

### Guidelines

- **Prefer local testing** over deploying to AWS when possible
  - Use `npx tsx scripts/test-agent.ts` for agent testing
  - Use Ollama locally instead of Lambda → Anthropic for iteration
- **Avoid frequent deploys** - batch changes and deploy once rather than deploying after every small change
- **Don't leave `sst dev` running** unnecessarily - it provisions real AWS resources
- **Clean up after testing** - remove unused stacks with `sst remove`
- **Watch for expensive resources**:
  - Lambda invocations (free tier: 1M/month)
  - API Gateway requests (free tier: 1M/month)
  - DynamoDB read/write (free tier: 25 GB storage, 25 WCU/RCU)
  - CloudWatch Logs (can accumulate quickly)

### When to Deploy to AWS

- Testing Lambda-specific functionality (EventBridge, API Gateway integration)
- End-to-end testing that requires the full stack
- Verifying SST configuration changes
- Demos or sharing with others

## Test Repositories

For testing GitHub-related agent functionality (PR creation, code search, etc.), use these private test repos:

| Repo | Owner | Purpose |
|------|-------|---------|
| `ai-oncall-test` | `ehsia1` | Contains buggy `src/calculator.py` for divide-by-zero fix testing |
| `ai-agent-test` | `ehsia1` | General agent testing |

**Important**: Always create test repos as **private** to avoid exposing test data publicly.

### Local Agent Testing

Run the agent locally (bypasses Lambda, connects directly to LLM):
```bash
npx tsx scripts/test-agent.ts
```

## Commands

```bash
# Start local dev
sst dev

# Deploy to AWS
sst deploy --stage production

# Type check
npx tsc --noEmit

# Trigger investigation
curl -X POST $API_URL/investigate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "...", "context": {"logGroup": "..."}}'

# Check agent run
curl $API_URL/agent-runs/{runId}

# List pending approvals
curl $API_URL/approvals
```

## Current Status

### Implemented
- LLM tool calling (Ollama)
- Tool registry with risk tiers
- CloudWatch Logs tool
- GitHub tools (search, get file, list files, create draft PR)
- Agent loop with state management
- DevOps Investigator agent
- Safety guardrails and audit logging
- Approval workflow API
- Email notification for approvals (Resend)
- Agent resume after approval
- Postman collection for API testing

### Next Priority
- Test with real log groups
- Database query tool
- Improve PR creation (full file content handling)
