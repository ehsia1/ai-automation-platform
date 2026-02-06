# AI Automation Platform

An AI-powered automation platform with autonomous agents for DevOps investigation and personal productivity.

## Features

- **AI On-Call Engineer** - Autonomous agent that investigates production issues, diagnoses root causes, and proposes fixes via draft PRs
- **Tool Calling** - LLM-powered tool execution with safety guardrails
- **Approval Workflow** - Tiered risk system with human-in-the-loop for destructive actions
- **Multi-Provider LLM** - Support for Ollama (local) and Anthropic Claude

## Tech Stack

| Component | Technology |
|-----------|------------|
| Infrastructure | SST v3 (Ion) |
| Database | DynamoDB |
| Events | EventBridge |
| API | API Gateway v2 |
| Compute | Lambda (Node.js 20) |
| LLM (Dev) | Ollama (llama3.1:8b) |
| LLM (Prod) | Anthropic Claude |
| Email | Resend |
| Language | TypeScript |

## Project Structure

```
ai-automation-platform/
├── packages/
│   ├── core/                    # Shared business logic
│   │   └── src/
│   │       ├── agent/           # Agent loop and prompts
│   │       ├── llm/             # LLM providers (Ollama, Anthropic)
│   │       ├── tools/           # Agent tools (CloudWatch, GitHub)
│   │       ├── safety/          # Guardrails, audit, approvals
│   │       └── notifications/   # Email, Slack
│   │
│   └── functions/               # Lambda handlers
│       └── src/
│           ├── agents/          # Agent Lambda handlers
│           ├── api/             # REST API handlers
│           └── ingestion/       # Webhook handlers
│
├── scripts/                     # Development scripts
│   └── test-agent.ts           # Local agent testing
│
├── sst.config.ts               # SST infrastructure config
└── .env                        # Environment variables (not committed)
```

## Prerequisites

- Node.js 20+
- npm 9+
- AWS CLI configured (for deployments)
- Ollama running locally (for local LLM)

## Local Development Setup

### 1. Clone and Install

```bash
git clone <repo-url>
cd ai-automation-platform
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory:

```bash
# LLM Configuration
# Options: ollama, anthropic
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Anthropic (optional - better tool calling)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Notifications
RESEND_API_KEY=re_xxx
ALERT_EMAIL_TO=your@email.com
ALERT_EMAIL_FROM=onboarding@resend.dev

# GitHub (for code search and PR creation)
GITHUB_TOKEN=ghp_xxx

# API URL (populated by sst dev)
API_URL=
```

### 3. Start Ollama (for local LLM)

```bash
# Install Ollama: https://ollama.ai
ollama pull llama3.1:8b
ollama serve
```

### 4. Run Local Agent Test

The fastest way to test the agent without deploying to AWS:

```bash
npx tsx scripts/test-agent.ts
```

This runs the DevOps Investigator agent directly against the configured LLM and GitHub API.

## Running with AWS (SST)

### Start Development Mode

```bash
npm run dev
# or
sst dev
```

This deploys a development stack to AWS with live Lambda reloading.

### Deploy to Production

```bash
sst deploy --stage production
```

### Remove Stack

```bash
sst remove --stage <stage>
```

## API Endpoints

Once deployed, the following endpoints are available:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/investigate` | POST | Start autonomous investigation |
| `/agent-runs` | GET | List all agent runs |
| `/agent-runs/{id}` | GET | Get specific agent run |
| `/approvals` | GET | List pending approvals |
| `/approvals/{id}/approve` | POST | Approve pending action |
| `/approvals/{id}/reject` | POST | Reject pending action |
| `/webhooks/datadog` | POST | Ingest Datadog alerts |
| `/webhooks/pagerduty` | POST | Ingest PagerDuty incidents (V3 webhook) |
| `/webhooks/opsgenie` | POST | Ingest OpsGenie alerts |
| `/alerts` | GET | List all alerts |

### Example: Trigger Investigation

```bash
curl -X POST $API_URL/investigate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Investigate division by zero errors in the calculator service",
    "context": {
      "service": "calculator",
      "errorMessage": "ZeroDivisionError"
    }
  }'
```

## Available Tools

The agent can use these tools during investigation:

| Tool | Risk Tier | Description |
|------|-----------|-------------|
| `cloudwatch_query_logs` | read_only | Query CloudWatch Logs Insights |
| `github_search_code` | read_only | Search code in repositories |
| `github_get_file` | read_only | Get file contents from GitHub |
| `github_list_files` | read_only | List files in a directory |
| `github_create_draft_pr` | safe_write | Create draft PR with fixes |

### Risk Tiers

- **read_only** - Auto-executes (logs, search, read)
- **safe_write** - Auto-executes (draft PRs, comments)
- **destructive** - Requires human approval (merge, deploy, delete)

## Testing

### Local Agent Test (Recommended)

```bash
npx tsx scripts/test-agent.ts
```

### Unit Tests

```bash
# Run tests in a package
cd packages/core && npm test

# Run specific test
cd packages/core && npm test -- llm/client.test.ts
```

### With SST Bindings

```bash
# Tests with Lambda environment variables
npm test
```

## Development Workflow

1. **Make changes** to code in `packages/core` or `packages/functions`
2. **Test locally** with `npx tsx scripts/test-agent.ts`
3. **Type check** with `npm run typecheck`
4. **Deploy to dev** with `sst dev` (only when needed)
5. **Deploy to prod** with `sst deploy --stage production`

## Configuration

### Switching LLM Providers

**Local development (Ollama):**
```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
```

**Production (Anthropic):**
```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Anthropic Claude is recommended for production due to better tool calling accuracy.

## Cost Management

This project uses AWS free tier during development. Guidelines:

- Prefer `npx tsx scripts/test-agent.ts` over `sst dev`
- Don't leave `sst dev` running unnecessarily
- Clean up unused stacks with `sst remove`
- Batch changes before deploying

## Documentation

- [CLAUDE.md](./CLAUDE.md) - AI assistant guidelines and project conventions
- [Notion](https://notion.so) - Detailed architecture docs and task tracking

## License

Private - All rights reserved
