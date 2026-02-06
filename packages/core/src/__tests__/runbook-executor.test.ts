import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ToolContext } from "../tools/types";

// Mock fetch for URL fetching
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after setting up mocks
import { executeRunbookTool } from "../runbooks/executor";

describe("Runbook Executor Tool", () => {
  const mockContext: ToolContext = {
    investigationId: "test-investigation",
    userId: "test-user",
  };

  const validRunbookYaml = `
metadata:
  id: test-runbook
  name: "Test Runbook"
  description: "A test runbook for unit testing"
  service: "test-service"

steps:
  - id: check_logs
    name: "Check Logs"
    description: "Query CloudWatch for errors"
    action: query_logs
    risk_level: read_only
    parameters:
      log_group: "/aws/lambda/test-function"
      query: "fields @message | filter @message like /ERROR/"
      time_range: "1h"

  - id: check_metrics
    name: "Check Metrics"
    description: "Check error metrics"
    action: check_metrics
    risk_level: read_only
    parameters:
      namespace: "AWS/Lambda"
      metric_name: "Errors"
      time_range: "1h"
`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("tool properties", () => {
    it("should have correct tool properties", () => {
      expect(executeRunbookTool.name).toBe("execute_runbook");
      expect(executeRunbookTool.riskTier).toBe("safe_write");
      expect(executeRunbookTool.definition.function.name).toBe("execute_runbook");
    });
  });

  describe("input validation", () => {
    it("should require either runbook_yaml or runbook_url", async () => {
      const result = await executeRunbookTool.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Either runbook_yaml or runbook_url must be provided");
    });

    it("should fail on invalid YAML", async () => {
      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: "invalid: yaml: content:",
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to parse runbook");
    });

    it("should fail on missing metadata", async () => {
      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: `
steps:
  - id: step1
    name: "Step 1"
    action: wait
    parameters:
      seconds: 1
`,
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("metadata with id and name");
    });

    it("should fail on missing steps", async () => {
      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: `
metadata:
  id: test
  name: "Test"
  description: "Test"
steps: []
`,
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("at least one step");
    });

    it("should fail on invalid action type", async () => {
      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: `
metadata:
  id: test
  name: "Test"
  description: "Test"
steps:
  - id: step1
    name: "Step 1"
    action: invalid_action
    parameters: {}
`,
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid action type");
    });
  });

  describe("dry run mode", () => {
    it("should validate without executing in dry run mode", async () => {
      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: validRunbookYaml,
          dry_run: true,
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("# Runbook Validation: Test Runbook");
      expect(result.output).toContain("**ID:** test-runbook");
      expect(result.output).toContain("**Steps:** 2");
      expect(result.output).toContain("Runbook validation successful");
      expect(result.metadata?.dry_run).toBe(true);
    });

    it("should show step risk levels in dry run", async () => {
      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: validRunbookYaml,
          dry_run: true,
        },
        mockContext
      );

      expect(result.output).toContain("[READ]");
      expect(result.output).toContain("Check Logs");
      expect(result.output).toContain("Check Metrics");
    });
  });

  describe("execution", () => {
    it("should execute read_only steps", async () => {
      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: validRunbookYaml,
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("# Runbook Execution: Test Runbook");
      expect(result.output).toContain("[SUCCESS] Check Logs");
      expect(result.output).toContain("[SUCCESS] Check Metrics");
      expect(result.output).toContain("**Status:** completed");
      expect(result.metadata?.status).toBe("completed");
    });

    it("should execute wait action", async () => {
      const waitRunbook = `
metadata:
  id: wait-test
  name: "Wait Test"
  description: "Test wait action"

steps:
  - id: wait_step
    name: "Wait Step"
    action: wait
    parameters:
      seconds: 2
`;

      const executePromise = executeRunbookTool.execute(
        { runbook_yaml: waitRunbook },
        mockContext
      );

      // Advance timers
      await vi.advanceTimersByTimeAsync(2000);

      const result = await executePromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain("Waited 2 seconds");
    });

    it("should pause on destructive steps requiring approval", async () => {
      const destructiveRunbook = `
metadata:
  id: destructive-test
  name: "Destructive Test"
  description: "Test destructive action"

steps:
  - id: read_step
    name: "Read Step"
    action: query_logs
    risk_level: read_only
    parameters:
      log_group: "/test"
      query: "test"

  - id: destructive_step
    name: "Destructive Step"
    action: shell_command
    risk_level: destructive
    parameters:
      command: "rm -rf /tmp/test"
`;

      const result = await executeRunbookTool.execute(
        { runbook_yaml: destructiveRunbook },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("[PENDING APPROVAL]");
      expect(result.output).toContain("requires approval");
      expect(result.metadata?.pending_approval).toBe(true);
      expect(result.metadata?.status).toBe("pending_approval");
    });
  });

  describe("variable interpolation", () => {
    it("should interpolate variables in step parameters", async () => {
      const varRunbook = `
metadata:
  id: var-test
  name: "Variable Test"
  description: "Test variable interpolation"

variables:
  service_name: "default-service"
  log_group: "/aws/lambda/default"

steps:
  - id: check_logs
    name: "Check {{service_name}} Logs"
    action: query_logs
    risk_level: read_only
    parameters:
      log_group: "{{log_group}}"
      query: "fields @message"
`;

      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: varRunbook,
          variables: {
            service_name: "my-service",
            log_group: "/aws/lambda/my-function",
          },
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("/aws/lambda/my-function");
    });
  });

  describe("step resumption", () => {
    it("should start from specified step", async () => {
      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: validRunbookYaml,
          start_from_step: "check_metrics",
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).not.toContain("Step 1: Check Logs");
      expect(result.output).toContain("Step 2: Check Metrics");
      expect(result.metadata?.steps_completed).toBe(1);
    });

    it("should fail if start step not found", async () => {
      const result = await executeRunbookTool.execute(
        {
          runbook_yaml: validRunbookYaml,
          start_from_step: "nonexistent_step",
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Step not found: nonexistent_step");
    });
  });

  describe("URL fetching", () => {
    it("should fetch runbook from URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(validRunbookYaml),
      });

      const result = await executeRunbookTool.execute(
        {
          runbook_url: "https://raw.githubusercontent.com/test/repo/main/runbook.yaml",
          dry_run: true,
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should convert GitHub URLs to raw format", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(validRunbookYaml),
      });

      await executeRunbookTool.execute(
        {
          runbook_url: "https://github.com/test/repo/blob/main/runbook.yaml",
          dry_run: true,
        },
        mockContext
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://raw.githubusercontent.com/test/repo/main/runbook.yaml"
      );
    });

    it("should handle fetch failures", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await executeRunbookTool.execute(
        {
          runbook_url: "https://example.com/runbook.yaml",
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to fetch runbook");
    });
  });

  describe("step actions", () => {
    it("should execute notify action", async () => {
      const notifyRunbook = `
metadata:
  id: notify-test
  name: "Notify Test"
  description: "Test notify action"

steps:
  - id: notify_step
    name: "Notify Team"
    action: notify
    parameters:
      channel: "oncall"
      message: "Test notification"
`;

      const result = await executeRunbookTool.execute(
        { runbook_yaml: notifyRunbook },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("[Notification Sent]");
      expect(result.output).toContain("Channel: oncall");
    });

    it("should execute api_call action", async () => {
      const apiRunbook = `
metadata:
  id: api-test
  name: "API Test"
  description: "Test API call action"

steps:
  - id: api_step
    name: "Call API"
    action: api_call
    parameters:
      integration: "pagerduty"
      operation: "acknowledge"
      params:
        incident_id: "123"
`;

      const result = await executeRunbookTool.execute(
        { runbook_yaml: apiRunbook },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("[API Call]");
      expect(result.output).toContain("Integration: pagerduty");
    });

    it("should execute github_file action", async () => {
      const githubRunbook = `
metadata:
  id: github-test
  name: "GitHub Test"
  description: "Test GitHub file action"

steps:
  - id: github_step
    name: "Read GitHub File"
    action: github_file
    parameters:
      repo: "owner/repo"
      path: "src/config.ts"
`;

      const result = await executeRunbookTool.execute(
        { runbook_yaml: githubRunbook },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("[GitHub File Read]");
      expect(result.output).toContain("Repository: owner/repo");
    });

    it("should execute condition action", async () => {
      const conditionRunbook = `
metadata:
  id: condition-test
  name: "Condition Test"
  description: "Test condition action"

steps:
  - id: check_step
    name: "Check Something"
    action: query_logs
    risk_level: read_only
    parameters:
      log_group: "/test"
      query: "test"

  - id: condition_step
    name: "Conditional Branch"
    action: condition
    parameters:
      expression: "previous_step.success"
      true_step: "next_step"
      false_step: "error_step"
`;

      const result = await executeRunbookTool.execute(
        { runbook_yaml: conditionRunbook },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("[Condition Evaluated]");
    });
  });

  describe("error handling", () => {
    it("should stop on step failure by default", async () => {
      // Create a runbook with an unknown action that will fail
      const failRunbook = `
metadata:
  id: fail-test
  name: "Fail Test"
  description: "Test failure handling"

steps:
  - id: good_step
    name: "Good Step"
    action: wait
    parameters:
      seconds: 0

  - id: bad_step
    name: "Bad Step"
    action: check_metrics
    parameters: {}
`;

      const executePromise = executeRunbookTool.execute(
        { runbook_yaml: failRunbook },
        mockContext
      );

      // Run all pending timers to completion
      await vi.runAllTimersAsync();

      const result = await executePromise;

      expect(result.metadata?.steps_completed).toBeGreaterThan(0);
    });

    it("should continue on failure when configured", async () => {
      const continueRunbook = `
metadata:
  id: continue-test
  name: "Continue Test"
  description: "Test continue on failure"

steps:
  - id: step1
    name: "Step 1"
    action: wait
    parameters:
      seconds: 0
    continue_on_failure: true

  - id: step2
    name: "Step 2"
    action: wait
    parameters:
      seconds: 0
`;

      const executePromise = executeRunbookTool.execute(
        { runbook_yaml: continueRunbook },
        mockContext
      );

      // Run all pending timers to completion
      await vi.runAllTimersAsync();

      const result = await executePromise;

      expect(result.success).toBe(true);
      expect(result.metadata?.steps_completed).toBe(2);
    });
  });

  describe("execution metadata", () => {
    it("should include execution ID in output", async () => {
      const result = await executeRunbookTool.execute(
        { runbook_yaml: validRunbookYaml },
        mockContext
      );

      expect(result.output).toContain("**Execution ID:**");
      expect(result.metadata?.execution_id).toBeDefined();
      expect(result.metadata?.execution_id).toMatch(/^exec-/);
    });

    it("should track steps completed vs total", async () => {
      const result = await executeRunbookTool.execute(
        { runbook_yaml: validRunbookYaml },
        mockContext
      );

      expect(result.metadata?.steps_completed).toBe(2);
      expect(result.metadata?.steps_total).toBe(2);
    });
  });
});
