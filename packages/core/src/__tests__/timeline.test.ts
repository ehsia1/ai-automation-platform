import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolContext } from "../tools/types";

// Hoist mock functions so they're available in vi.mock factory
const { mockStartQuery, mockGetQueryResults, mockGetMetricStatistics } = vi.hoisted(() => ({
  mockStartQuery: vi.fn(),
  mockGetQueryResults: vi.fn(),
  mockGetMetricStatistics: vi.fn(),
}));

vi.mock("@aws-sdk/client-cloudwatch-logs", () => {
  const MockCloudWatchLogsClient = function (this: Record<string, unknown>) {
    this.send = (command: { _type: string }) => {
      if (command._type === "StartQueryCommand") {
        return mockStartQuery();
      }
      if (command._type === "GetQueryResultsCommand") {
        return mockGetQueryResults();
      }
      throw new Error(`Unknown command: ${command._type}`);
    };
  };

  // Commands must be constructor functions (called with 'new')
  function StartQueryCommand(this: Record<string, unknown>, params: Record<string, unknown>) {
    Object.assign(this, params);
    this._type = "StartQueryCommand";
  }

  function GetQueryResultsCommand(this: Record<string, unknown>, params: Record<string, unknown>) {
    Object.assign(this, params);
    this._type = "GetQueryResultsCommand";
  }

  return {
    CloudWatchLogsClient: MockCloudWatchLogsClient,
    StartQueryCommand,
    GetQueryResultsCommand,
    QueryStatus: {
      Complete: "Complete",
      Running: "Running",
      Failed: "Failed",
    },
  };
});

vi.mock("@aws-sdk/client-cloudwatch", () => {
  const MockCloudWatchClient = function (this: Record<string, unknown>) {
    this.send = (command: { _type: string }) => {
      if (command._type === "GetMetricStatisticsCommand") {
        return mockGetMetricStatistics();
      }
      throw new Error(`Unknown command: ${command._type}`);
    };
  };

  // Commands must be constructor functions (called with 'new')
  function GetMetricStatisticsCommand(this: Record<string, unknown>, params: Record<string, unknown>) {
    Object.assign(this, params);
    this._type = "GetMetricStatisticsCommand";
  }

  return {
    CloudWatchClient: MockCloudWatchClient,
    GetMetricStatisticsCommand,
  };
});

// Import after mocking
import { buildIncidentTimelineTool } from "../tools/timeline";

describe("Timeline Tool", () => {
  const mockContext: ToolContext = {
    investigationId: "test-investigation",
    userId: "test-user",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildIncidentTimelineTool", () => {
    it("should have correct tool properties", () => {
      expect(buildIncidentTimelineTool.name).toBe("build_incident_timeline");
      expect(buildIncidentTimelineTool.riskTier).toBe("read_only");
      expect(buildIncidentTimelineTool.definition.function.name).toBe("build_incident_timeline");
    });

    it("should require start_time", async () => {
      const result = await buildIncidentTimelineTool.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("start_time is required");
    });

    it("should handle invalid time format", async () => {
      const result = await buildIncidentTimelineTool.execute(
        {
          start_time: "invalid-time",
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid time format");
    });

    it("should handle relative time formats", async () => {
      // No log_group or metrics, so no AWS calls needed
      const result = await buildIncidentTimelineTool.execute(
        {
          start_time: "1h",
          end_time: "now",
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("# Incident Timeline");
      expect(result.output).toContain("No events found");
    });

    it("should query logs and return events", async () => {
      mockStartQuery.mockResolvedValue({ queryId: "query-123" });
      mockGetQueryResults.mockResolvedValue({
        status: "Complete",
        results: [
          [
            { field: "@timestamp", value: "2024-01-15T10:00:00.000Z" },
            { field: "@message", value: "ERROR: Database connection failed" },
            { field: "@logStream", value: "app-stream-1" },
          ],
          [
            { field: "@timestamp", value: "2024-01-15T10:01:00.000Z" },
            { field: "@message", value: "WARN: Retry attempt 1" },
            { field: "@logStream", value: "app-stream-1" },
          ],
        ],
      });

      const result = await buildIncidentTimelineTool.execute(
        {
          log_group: "/aws/lambda/my-function",
          start_time: "1h",
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("# Incident Timeline");
      expect(result.output).toContain("Events Found:** 2");
      expect(result.output).toContain("Database connection failed");
      expect(result.output).toContain("[ERROR]");
      expect(result.output).toContain("[WARN]");
      expect(result.metadata?.event_count).toBe(2);
    });

    it("should query metrics with threshold crossings", async () => {
      const now = new Date();
      mockGetMetricStatistics.mockResolvedValue({
        Datapoints: [
          {
            Timestamp: new Date(now.getTime() - 300000),
            Average: 50,
            Maximum: 60,
          },
          {
            Timestamp: new Date(now.getTime() - 120000),
            Average: 85,
            Maximum: 95, // Exceeds threshold of 80
          },
        ],
      });

      const result = await buildIncidentTimelineTool.execute(
        {
          start_time: "1h",
          metric_queries: [
            {
              namespace: "AWS/Lambda",
              metric_name: "Duration",
              threshold: 80,
              threshold_type: "above",
            },
          ],
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("exceeded threshold");
      expect(result.output).toContain("Value: 95");
      expect(result.metadata?.event_count).toBe(1);
    });

    it("should classify log severity correctly", async () => {
      mockStartQuery.mockResolvedValue({ queryId: "query-123" });
      mockGetQueryResults.mockResolvedValue({
        status: "Complete",
        results: [
          [
            { field: "@timestamp", value: "2024-01-15T10:00:00.000Z" },
            { field: "@message", value: "CRITICAL: System panic" },
          ],
          [
            { field: "@timestamp", value: "2024-01-15T10:01:00.000Z" },
            { field: "@message", value: "FATAL error occurred" },
          ],
          [
            { field: "@timestamp", value: "2024-01-15T10:02:00.000Z" },
            { field: "@message", value: "Exception thrown in handler" },
          ],
          [
            { field: "@timestamp", value: "2024-01-15T10:03:00.000Z" },
            { field: "@message", value: "Warning: timeout approaching" },
          ],
          [
            { field: "@timestamp", value: "2024-01-15T10:04:00.000Z" },
            { field: "@message", value: "Request completed successfully" },
          ],
        ],
      });

      const result = await buildIncidentTimelineTool.execute(
        {
          log_group: "/aws/lambda/test",
          start_time: "1h",
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("[CRITICAL]");
      expect(result.output).toContain("[ERROR]");
      expect(result.output).toContain("[WARN]");
      expect(result.output).toContain("[INFO]");
      expect(result.metadata?.events_by_severity).toEqual({
        critical: 2,
        error: 1,
        warning: 1,
        info: 1,
      });
    });

    it("should combine logs and metrics in timeline", async () => {
      const now = new Date();

      mockStartQuery.mockResolvedValue({ queryId: "query-123" });
      mockGetQueryResults.mockResolvedValue({
        status: "Complete",
        results: [
          [
            { field: "@timestamp", value: new Date(now.getTime() - 180000).toISOString() },
            { field: "@message", value: "ERROR: Service unavailable" },
          ],
        ],
      });

      mockGetMetricStatistics.mockResolvedValue({
        Datapoints: [
          {
            Timestamp: new Date(now.getTime() - 120000),
            Maximum: 100, // Exceeds threshold
          },
        ],
      });

      const result = await buildIncidentTimelineTool.execute(
        {
          log_group: "/aws/lambda/test",
          start_time: "1h",
          metric_queries: [
            {
              namespace: "AWS/Lambda",
              metric_name: "Errors",
              threshold: 50,
            },
          ],
          service_name: "my-service",
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Service:** my-service");
      expect(result.output).toContain("Events Found:** 2");
      expect(result.output).toContain("Service unavailable");
      expect(result.output).toContain("exceeded threshold");
    });

    it("should handle log query errors gracefully", async () => {
      mockStartQuery.mockRejectedValue(new Error("AccessDeniedException"));

      const result = await buildIncidentTimelineTool.execute(
        {
          log_group: "/aws/lambda/test",
          start_time: "1h",
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Failed to query logs");
      expect(result.output).toContain("AccessDeniedException");
    });

    it("should handle metric query errors gracefully", async () => {
      mockGetMetricStatistics.mockRejectedValue(new Error("Throttling"));

      const result = await buildIncidentTimelineTool.execute(
        {
          start_time: "1h",
          metric_queries: [
            {
              namespace: "AWS/Lambda",
              metric_name: "Duration",
            },
          ],
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Failed to query metric");
      expect(result.output).toContain("Throttling");
    });

    it("should respect various relative time formats", async () => {
      const timeFormats = ["30m", "2h", "1d", "1h ago", "30 minutes ago"];

      for (const format of timeFormats) {
        const result = await buildIncidentTimelineTool.execute(
          {
            start_time: format,
          },
          mockContext
        );
        expect(result.success).toBe(true);
      }
    });

    it("should handle below threshold type for metrics", async () => {
      const now = new Date();
      mockGetMetricStatistics.mockResolvedValue({
        Datapoints: [
          {
            Timestamp: new Date(now.getTime() - 120000),
            Average: 10,
            Maximum: 15, // Below threshold of 50
          },
        ],
      });

      const result = await buildIncidentTimelineTool.execute(
        {
          start_time: "1h",
          metric_queries: [
            {
              namespace: "AWS/Lambda",
              metric_name: "Invocations",
              threshold: 50,
              threshold_type: "below",
            },
          ],
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("dropped below threshold");
    });

    it("should limit events to 30 in output", async () => {
      mockStartQuery.mockResolvedValue({ queryId: "query-123" });

      // Create 40 events
      const results = Array.from({ length: 40 }, (_, i) => [
        { field: "@timestamp", value: new Date(Date.now() - i * 60000).toISOString() },
        { field: "@message", value: `ERROR: Event ${i}` },
      ]);

      mockGetQueryResults.mockResolvedValue({
        status: "Complete",
        results,
      });

      const result = await buildIncidentTimelineTool.execute(
        {
          log_group: "/aws/lambda/test",
          start_time: "2h",
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("and 10 more events");
      expect(result.metadata?.event_count).toBe(40);
    });

    it("should use custom filter pattern", async () => {
      mockStartQuery.mockResolvedValue({ queryId: "query-123" });
      mockGetQueryResults.mockResolvedValue({
        status: "Complete",
        results: [],
      });

      await buildIncidentTimelineTool.execute(
        {
          log_group: "/aws/lambda/test",
          start_time: "1h",
          filter_pattern: "CustomError OR SpecificException",
        },
        mockContext
      );

      expect(mockStartQuery).toHaveBeenCalled();
    });
  });
});
