import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolContext } from "../tools/types";

// Hoist mock functions so they're available in vi.mock factory
const { mockGetMetricStatistics, mockListMetrics } = vi.hoisted(() => ({
  mockGetMetricStatistics: vi.fn(),
  mockListMetrics: vi.fn(),
}));

vi.mock("@aws-sdk/client-cloudwatch", () => {
  const MockCloudWatchClient = function (this: Record<string, unknown>) {
    this.send = (command: { _type: string }) => {
      if (command._type === "GetMetricStatisticsCommand") {
        return mockGetMetricStatistics();
      }
      if (command._type === "ListMetricsCommand") {
        return mockListMetrics();
      }
      throw new Error(`Unknown command: ${command._type}`);
    };
  };

  // Commands must be constructor functions (called with 'new')
  function GetMetricStatisticsCommand(this: Record<string, unknown>, params: Record<string, unknown>) {
    Object.assign(this, params);
    this._type = "GetMetricStatisticsCommand";
  }

  function ListMetricsCommand(this: Record<string, unknown>, params: Record<string, unknown>) {
    Object.assign(this, params);
    this._type = "ListMetricsCommand";
  }

  return {
    CloudWatchClient: MockCloudWatchClient,
    GetMetricStatisticsCommand,
    ListMetricsCommand,
    Statistic: {},
  };
});

// Import after mocking
import {
  cloudwatchGetMetricsTool,
  cloudwatchListMetricsTool,
} from "../tools/cloudwatch-metrics";

describe("CloudWatch Metrics Tools", () => {
  const mockContext: ToolContext = {
    investigationId: "test-investigation",
    userId: "test-user",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cloudwatchGetMetricsTool", () => {
    it("should have correct tool properties", () => {
      expect(cloudwatchGetMetricsTool.name).toBe("cloudwatch_get_metrics");
      expect(cloudwatchGetMetricsTool.riskTier).toBe("read_only");
      expect(cloudwatchGetMetricsTool.definition.function.name).toBe("cloudwatch_get_metrics");
    });

    it("should require namespace and metric_name", async () => {
      const result = await cloudwatchGetMetricsTool.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required parameters");
    });

    it("should return no datapoints message when empty", async () => {
      mockGetMetricStatistics.mockResolvedValue({
        Datapoints: [],
      });

      const result = await cloudwatchGetMetricsTool.execute(
        {
          namespace: "AWS/Lambda",
          metric_name: "Invocations",
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("No datapoints found");
      expect(result.metadata?.datapoint_count).toBe(0);
    });

    it("should format datapoints correctly", async () => {
      const now = new Date();
      mockGetMetricStatistics.mockResolvedValue({
        Datapoints: [
          {
            Timestamp: new Date(now.getTime() - 300000), // 5 min ago
            Average: 50.5,
            Maximum: 75.0,
            Minimum: 25.0,
            Sum: 500,
            SampleCount: 10,
          },
          {
            Timestamp: now,
            Average: 60.0,
            Maximum: 80.0,
            Minimum: 30.0,
            Sum: 600,
            SampleCount: 10,
          },
        ],
      });

      const result = await cloudwatchGetMetricsTool.execute(
        {
          namespace: "AWS/EC2",
          metric_name: "CPUUtilization",
          dimensions: { InstanceId: "i-1234567890abcdef0" },
          statistics: ["Average", "Maximum"],
          period: 300,
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("AWS/EC2/CPUUtilization");
      expect(result.output).toContain("InstanceId=i-1234567890abcdef0");
      expect(result.output).toContain("Summary:");
      expect(result.output).toContain("Recent Datapoints:");
      expect(result.metadata?.datapoint_count).toBe(2);
    });

    it("should handle relative time formats", async () => {
      mockGetMetricStatistics.mockResolvedValue({ Datapoints: [] });

      const result = await cloudwatchGetMetricsTool.execute(
        {
          namespace: "AWS/Lambda",
          metric_name: "Duration",
          start_time: "1h",
          end_time: "now",
        },
        mockContext
      );

      expect(result.success).toBe(true);
    });

    it("should handle various relative time formats", async () => {
      mockGetMetricStatistics.mockResolvedValue({ Datapoints: [] });

      // Test different formats
      for (const timeFormat of ["30m", "2h", "1d", "1h ago", "30 minutes ago"]) {
        const result = await cloudwatchGetMetricsTool.execute(
          {
            namespace: "AWS/Lambda",
            metric_name: "Errors",
            start_time: timeFormat,
          },
          mockContext
        );
        expect(result.success).toBe(true);
      }
    });

    it("should handle invalid time format", async () => {
      const result = await cloudwatchGetMetricsTool.execute(
        {
          namespace: "AWS/Lambda",
          metric_name: "Duration",
          start_time: "invalid-time",
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid time format");
    });

    it("should handle API errors gracefully", async () => {
      mockGetMetricStatistics.mockRejectedValue(new Error("Access Denied"));

      const result = await cloudwatchGetMetricsTool.execute(
        {
          namespace: "AWS/Lambda",
          metric_name: "Invocations",
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("GetMetricStatistics failed");
      expect(result.error).toContain("Access Denied");
    });
  });

  describe("cloudwatchListMetricsTool", () => {
    it("should have correct tool properties", () => {
      expect(cloudwatchListMetricsTool.name).toBe("cloudwatch_list_metrics");
      expect(cloudwatchListMetricsTool.riskTier).toBe("read_only");
    });

    it("should return no metrics message when empty", async () => {
      mockListMetrics.mockResolvedValue({ Metrics: [] });

      const result = await cloudwatchListMetricsTool.execute({}, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain("No metrics found");
      expect(result.metadata?.count).toBe(0);
    });

    it("should list metrics grouped by namespace", async () => {
      mockListMetrics.mockResolvedValue({
        Metrics: [
          {
            Namespace: "AWS/Lambda",
            MetricName: "Duration",
            Dimensions: [{ Name: "FunctionName", Value: "my-function" }],
          },
          {
            Namespace: "AWS/Lambda",
            MetricName: "Errors",
            Dimensions: [{ Name: "FunctionName", Value: "my-function" }],
          },
          {
            Namespace: "AWS/EC2",
            MetricName: "CPUUtilization",
            Dimensions: [{ Name: "InstanceId", Value: "i-123" }],
          },
        ],
      });

      const result = await cloudwatchListMetricsTool.execute(
        {
          namespace: "AWS/Lambda",
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Found 3 metrics");
      expect(result.output).toContain("Namespace: AWS/Lambda");
      expect(result.output).toContain("Duration");
      expect(result.output).toContain("Errors");
      expect(result.output).toContain("Namespace: AWS/EC2");
      expect(result.metadata?.count).toBe(3);
    });

    it("should filter by dimension name", async () => {
      mockListMetrics.mockResolvedValue({
        Metrics: [
          {
            Namespace: "AWS/Lambda",
            MetricName: "Duration",
            Dimensions: [{ Name: "FunctionName", Value: "my-function" }],
          },
        ],
      });

      const result = await cloudwatchListMetricsTool.execute(
        {
          dimension_name: "FunctionName",
          dimension_value: "my-function",
        },
        mockContext
      );

      expect(result.success).toBe(true);
    });

    it("should handle API errors gracefully", async () => {
      mockListMetrics.mockRejectedValue(new Error("Throttling"));

      const result = await cloudwatchListMetricsTool.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("ListMetrics failed");
      expect(result.error).toContain("Throttling");
    });
  });
});
