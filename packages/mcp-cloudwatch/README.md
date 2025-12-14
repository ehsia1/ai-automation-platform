# CloudWatch Logs MCP Server

An MCP (Model Context Protocol) server that provides AWS CloudWatch Logs Insights querying capabilities.

## Installation

```bash
npm install @ai-automation/mcp-cloudwatch
```

Or run directly with npx:

```bash
npx @ai-automation/mcp-cloudwatch
```

## Configuration

### Environment Variables

- `AWS_REGION` - AWS region (default: us-east-1)
- `AWS_ACCESS_KEY_ID` - AWS access key (or use IAM role)
- `AWS_SECRET_ACCESS_KEY` - AWS secret key (or use IAM role)

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cloudwatch": {
      "command": "npx",
      "args": ["-y", "@ai-automation/mcp-cloudwatch"],
      "env": {
        "AWS_REGION": "us-east-1"
      }
    }
  }
}
```

### AI Automation Platform

Add to your `config/integrations.yaml`:

```yaml
integrations:
  cloudwatch-mcp:
    type: mcp
    package: "@ai-automation/mcp-cloudwatch"
    env:
      AWS_REGION: ${AWS_REGION:-us-east-1}
```

## Tools

### cloudwatch_query_logs

Query CloudWatch Logs Insights to search and analyze log data.

**Parameters:**
- `log_group` (required): The CloudWatch Log Group to query
- `query` (required): CloudWatch Logs Insights query
- `start_time`: Start time (ISO 8601 or relative like "1h", "30m", "1d"). Default: "1h"
- `end_time`: End time (ISO 8601 or "now"). Default: "now"

**Example:**
```json
{
  "log_group": "/aws/lambda/my-function",
  "query": "fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20",
  "start_time": "2h"
}
```

### cloudwatch_list_log_groups

List available CloudWatch Log Groups.

**Parameters:**
- `prefix`: Optional prefix to filter log groups
- `limit`: Maximum number of log groups (default: 50)

**Example:**
```json
{
  "prefix": "/aws/lambda"
}
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```
