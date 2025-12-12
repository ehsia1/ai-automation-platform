# E2E Test Scenarios

Golden test scenarios for validating the AI Automation Platform pipeline.

## Running Tests

```bash
# Run all tests
npx tsx scripts/e2e-test.ts

# Run a specific scenario
npx tsx scripts/e2e-test.ts --scenario high_cpu_billing

# Verbose output
npx tsx scripts/e2e-test.ts --verbose
```

**Prerequisites:**
- API must be running (`sst dev` or deployed)
- Set `API_URL` environment variable if not using default

## MVP Pass Criteria

| Metric | Target |
|--------|--------|
| Pass Rate | ≥ 80% |
| Average Latency | < 30s |

## Scenario Structure

Each scenario is a JSON file with:

```json
{
  "id": "unique_scenario_id",
  "description": "Human readable description",
  "input": {
    "webhook_payload": { /* Datadog-format webhook */ }
  },
  "expected": {
    "classification": {
      "item_type": "alert",
      "mode": "engineering",
      "priority": ["critical", "high"],  // Any match passes
      "requires_action": true,
      "service": "service-name"
    },
    "triage": {
      "summary_keywords": ["keyword1", "keyword2"],
      "root_cause_keywords": ["cause1", "cause2"],
      "action_keywords": ["action1", "action2"]
    },
    "notification": {
      "should_send": true,
      "severity": ["critical", "high"]
    }
  },
  "timeout_ms": 30000
}
```

## Current Scenarios

| ID | Description | Severity |
|----|-------------|----------|
| high_cpu_billing | High CPU spike on billing service | High |
| memory_leak_auth | Memory leak in auth service | Critical |
| database_connection_failure | DB pool exhausted | Critical |
| 5xx_error_spike | Error rate spike on checkout | Critical |
| latency_degradation | P99 latency increase | High |
| disk_space_warning | Disk usage warning | Medium |
| ssl_cert_expiring | SSL cert expiring soon | High |
| deployment_failure | K8s rollout failed | Critical |
| rate_limiting | API rate limit exceeded | High |
| kafka_consumer_lag | Consumer lag growing | Critical |
| security_failed_logins | Failed login spike | Critical |
| canary_test_failure | Synthetic test failing | High |
| low_priority_info | Info-only alert (no action needed) | Low |

## Adding New Scenarios

1. Create a new JSON file in `engineering/` folder
2. Follow the structure above
3. Run `npx tsx scripts/e2e-test.ts --scenario your_scenario_id` to validate
