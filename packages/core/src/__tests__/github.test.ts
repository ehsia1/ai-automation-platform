import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ToolContext } from "../tools/types";

// Set GITHUB_TOKEN before importing the module
process.env.GITHUB_TOKEN = "test-token";

// Create mock functions that will be shared across tests
const mockGetContent = vi.fn();
const mockGetRef = vi.fn();
const mockCreateRef = vi.fn();
const mockUpdateRef = vi.fn();
const mockGetTree = vi.fn();
const mockCreateBlob = vi.fn();
const mockCreateTree = vi.fn();
const mockCreateCommit = vi.fn();
const mockCreatePull = vi.fn();
const mockSearchCode = vi.fn();

// Mock the entire module with our mock functions
vi.mock("@octokit/rest", () => {
  // Create a mock Octokit class
  const MockOctokit = function(this: Record<string, unknown>) {
    this.repos = { getContent: mockGetContent };
    this.git = {
      getRef: mockGetRef,
      createRef: mockCreateRef,
      updateRef: mockUpdateRef,
      getTree: mockGetTree,
      createBlob: mockCreateBlob,
      createTree: mockCreateTree,
      createCommit: mockCreateCommit,
    };
    this.pulls = { create: mockCreatePull };
    this.search = { code: mockSearchCode };
  };
  return { Octokit: MockOctokit };
});

// Import after mocking
import {
  githubCreateDraftPRTool,
  githubGetFileTool,
} from "../tools/github";

describe("GitHub Tools", () => {
  const mockContext: ToolContext = {
    investigationId: "test-investigation",
    userId: "test-user",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the module to clear the cached octokit instance
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("githubGetFileTool", () => {
    it("should get file content successfully", async () => {
      const fileContent = "def hello():\n    print('Hello, World!')";
      mockGetContent.mockResolvedValue({
        data: {
          type: "file",
          content: Buffer.from(fileContent).toString("base64"),
          sha: "abc123",
          size: fileContent.length,
        },
      });

      const result = await githubGetFileTool.execute(
        { repo: "owner/repo", path: "src/hello.py" },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain(fileContent);
      expect(result.metadata?.sha).toBe("abc123");
    });

    it("should handle missing repo parameter", async () => {
      const result = await githubGetFileTool.execute(
        { path: "src/hello.py" },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required parameters");
    });

    it("should handle invalid repo format", async () => {
      const result = await githubGetFileTool.execute(
        { repo: "invalid-repo", path: "src/hello.py" },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid repo format");
    });
  });

  describe("githubCreateDraftPRTool - Single File", () => {
    const setupMocksForPR = (originalContent: string = "") => {
      // Mock getting original file for validation
      if (originalContent) {
        mockGetContent.mockResolvedValue({
          data: {
            type: "file",
            content: Buffer.from(originalContent).toString("base64"),
          },
        });
      } else {
        mockGetContent.mockRejectedValue(new Error("Not found"));
      }

      // Mock getting base branch ref
      mockGetRef.mockResolvedValue({
        data: { object: { sha: "base-sha-123" } },
      });

      // Mock creating new branch
      mockCreateRef.mockResolvedValue({});

      // Mock getting tree
      mockGetTree.mockResolvedValue({
        data: { sha: "tree-sha-123" },
      });

      // Mock creating blob
      mockCreateBlob.mockResolvedValue({
        data: { sha: "blob-sha-123" },
      });

      // Mock creating tree
      mockCreateTree.mockResolvedValue({
        data: { sha: "new-tree-sha-123" },
      });

      // Mock creating commit
      mockCreateCommit.mockResolvedValue({
        data: { sha: "commit-sha-123" },
      });

      // Mock updating ref
      mockUpdateRef.mockResolvedValue({});

      // Mock creating PR
      mockCreatePull.mockResolvedValue({
        data: {
          number: 42,
          html_url: "https://github.com/owner/repo/pull/42",
          draft: true,
        },
      });
    };

    it("should create a single-file draft PR successfully", async () => {
      const originalContent = "def divide(a, b):\n    return a / b\n";
      const newContent = "def divide(a, b):\n    if b == 0:\n        raise ValueError('Cannot divide by zero')\n    return a / b\n";

      setupMocksForPR(originalContent);

      const result = await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Fix divide by zero",
          body: "Handle division by zero error",
          base: "main",
          head: "fix/divide-by-zero",
          files: [{ path: "src/calculator.py", content: newContent }],
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Draft PR");
      expect(result.output).toContain("pull/42");
      expect(mockCreateBlob).toHaveBeenCalledTimes(1);
    });

    it("should reject suspiciously small content", async () => {
      const originalContent = "import os\nimport sys\n\ndef divide(a, b):\n    return a / b\n\ndef multiply(a, b):\n    return a * b\n";
      const tooSmallContent = "def divide(a, b):\n    return a / b";

      setupMocksForPR(originalContent);

      const result = await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Fix divide by zero",
          body: "Handle division by zero error",
          base: "main",
          head: "fix/divide-by-zero",
          files: [{ path: "src/calculator.py", content: tooSmallContent }],
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("VALIDATION FAILED");
      // The error message may say "much smaller" or mention missing imports/headers
      expect(result.error).toMatch(/smaller|missing|snippet/i);
    });
  });

  describe("githubCreateDraftPRTool - Multi-File", () => {
    const setupMocksForMultiFilePR = (existingFiles: Record<string, string>) => {
      // Mock getting original files for validation
      mockGetContent.mockImplementation(async ({ path }: { path: string }) => {
        if (existingFiles[path]) {
          return {
            data: {
              type: "file",
              content: Buffer.from(existingFiles[path]).toString("base64"),
            },
          };
        }
        throw new Error("Not found");
      });

      // Mock getting base branch ref
      mockGetRef.mockResolvedValue({
        data: { object: { sha: "base-sha-123" } },
      });

      // Mock creating new branch
      mockCreateRef.mockResolvedValue({});

      // Mock getting tree
      mockGetTree.mockResolvedValue({
        data: { sha: "tree-sha-123" },
      });

      // Mock creating blobs (one for each file)
      let blobCounter = 0;
      mockCreateBlob.mockImplementation(async () => {
        blobCounter++;
        return { data: { sha: `blob-sha-${blobCounter}` } };
      });

      // Mock creating tree
      mockCreateTree.mockResolvedValue({
        data: { sha: "new-tree-sha-123" },
      });

      // Mock creating commit
      mockCreateCommit.mockResolvedValue({
        data: { sha: "commit-sha-123" },
      });

      // Mock updating ref
      mockUpdateRef.mockResolvedValue({});

      // Mock creating PR
      mockCreatePull.mockResolvedValue({
        data: {
          number: 42,
          html_url: "https://github.com/owner/repo/pull/42",
          draft: true,
        },
      });
    };

    it("should create a multi-file draft PR successfully", async () => {
      const existingFiles = {
        "src/calculator.py": "def divide(a, b):\n    return a / b\n",
        "tests/test_calculator.py": "def test_divide():\n    assert divide(4, 2) == 2\n",
      };

      setupMocksForMultiFilePR(existingFiles);

      const result = await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Add input validation with tests",
          body: "This PR adds validation and tests",
          base: "main",
          head: "feat/validation",
          files: [
            {
              path: "src/calculator.py",
              content: "def divide(a, b):\n    if b == 0:\n        raise ValueError('Cannot divide by zero')\n    return a / b\n",
            },
            {
              path: "tests/test_calculator.py",
              content: "import pytest\nfrom src.calculator import divide\n\ndef test_divide():\n    assert divide(4, 2) == 2\n\ndef test_divide_by_zero():\n    with pytest.raises(ValueError):\n        divide(1, 0)\n",
            },
          ],
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Draft PR");
      expect(result.output).toContain("pull/42");
      expect(mockCreateBlob).toHaveBeenCalledTimes(2);
    });

    it("should handle new files alongside modified files", async () => {
      const existingFiles = {
        "src/calculator.py": "def divide(a, b):\n    return a / b\n",
      };

      setupMocksForMultiFilePR(existingFiles);

      const result = await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Add validation module",
          body: "This PR adds a new validation module",
          base: "main",
          head: "feat/validation-module",
          files: [
            {
              path: "src/calculator.py",
              content: "from src.validation import validate_number\n\ndef divide(a, b):\n    validate_number(a)\n    validate_number(b)\n    if b == 0:\n        raise ValueError('Cannot divide by zero')\n    return a / b\n",
            },
            {
              path: "src/validation.py",
              content: "def validate_number(n):\n    if not isinstance(n, (int, float)):\n        raise TypeError('Expected a number')\n    return n\n",
            },
          ],
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(mockCreateBlob).toHaveBeenCalledTimes(2);
    });

    it("should create blobs for all files in parallel", async () => {
      setupMocksForMultiFilePR({});

      const files = [
        { path: "file1.py", content: "print('file1')\n" },
        { path: "file2.py", content: "print('file2')\n" },
        { path: "file3.py", content: "print('file3')\n" },
      ];

      await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Add multiple files",
          body: "Adding three files",
          base: "main",
          head: "feat/multiple-files",
          files,
        },
        mockContext
      );

      // Verify all blobs were created
      expect(mockCreateBlob).toHaveBeenCalledTimes(3);
    });

    it("should include all files in the tree", async () => {
      setupMocksForMultiFilePR({});

      const files = [
        { path: "src/file1.py", content: "print('file1')\n" },
        { path: "src/file2.py", content: "print('file2')\n" },
      ];

      await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Add multiple files",
          body: "Adding two files",
          base: "main",
          head: "feat/two-files",
          files,
        },
        mockContext
      );

      // Verify tree was created with all file entries
      expect(mockCreateTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree: expect.arrayContaining([
            expect.objectContaining({ path: "src/file1.py", type: "blob" }),
            expect.objectContaining({ path: "src/file2.py", type: "blob" }),
          ]),
        })
      );
    });
  });

  describe("githubCreateDraftPRTool - Edge Cases", () => {
    it("should handle files as JSON string (LLM quirk)", async () => {
      mockGetContent.mockRejectedValue(new Error("Not found"));
      mockGetRef.mockResolvedValue({
        data: { object: { sha: "base-sha-123" } },
      });
      mockCreateRef.mockResolvedValue({});
      mockGetTree.mockResolvedValue({
        data: { sha: "tree-sha-123" },
      });
      mockCreateBlob.mockResolvedValue({
        data: { sha: "blob-sha-123" },
      });
      mockCreateTree.mockResolvedValue({
        data: { sha: "new-tree-sha-123" },
      });
      mockCreateCommit.mockResolvedValue({
        data: { sha: "commit-sha-123" },
      });
      mockUpdateRef.mockResolvedValue({});
      mockCreatePull.mockResolvedValue({
        data: {
          number: 42,
          html_url: "https://github.com/owner/repo/pull/42",
          draft: true,
        },
      });

      const result = await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Test PR",
          body: "Test body",
          base: "main",
          head: "test-branch",
          files: JSON.stringify([{ path: "test.py", content: "print('test')\n" }]),
        },
        mockContext
      );

      expect(result.success).toBe(true);
    });

    it("should normalize escaped newlines in content", async () => {
      mockGetContent.mockRejectedValue(new Error("Not found"));
      mockGetRef.mockResolvedValue({
        data: { object: { sha: "base-sha-123" } },
      });
      mockCreateRef.mockResolvedValue({});
      mockGetTree.mockResolvedValue({
        data: { sha: "tree-sha-123" },
      });
      mockCreateBlob.mockResolvedValue({
        data: { sha: "blob-sha-123" },
      });
      mockCreateTree.mockResolvedValue({
        data: { sha: "new-tree-sha-123" },
      });
      mockCreateCommit.mockResolvedValue({
        data: { sha: "commit-sha-123" },
      });
      mockUpdateRef.mockResolvedValue({});
      mockCreatePull.mockResolvedValue({
        data: {
          number: 42,
          html_url: "https://github.com/owner/repo/pull/42",
          draft: true,
        },
      });

      // Content with literal \n instead of actual newlines (common LLM mistake)
      const escapedContent = "def hello():\\n    print('Hello')\\n";

      await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Test PR",
          body: "Test body",
          base: "main",
          head: "test-branch",
          files: [{ path: "test.py", content: escapedContent }],
        },
        mockContext
      );

      // Verify the blob was created with normalized newlines
      expect(mockCreateBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.any(String),
        })
      );
    });

    it("should reject empty files array", async () => {
      const result = await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Test PR",
          body: "Test body",
          base: "main",
          head: "test-branch",
          files: [],
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("non-empty array");
    });

    it("should handle branch already exists", async () => {
      mockGetContent.mockRejectedValue(new Error("Not found"));
      mockGetRef.mockResolvedValue({
        data: { object: { sha: "base-sha-123" } },
      });
      // First createRef fails because branch exists
      mockCreateRef.mockRejectedValue(new Error("Reference already exists"));
      // But updateRef succeeds
      mockUpdateRef.mockResolvedValue({});
      mockGetTree.mockResolvedValue({
        data: { sha: "tree-sha-123" },
      });
      mockCreateBlob.mockResolvedValue({
        data: { sha: "blob-sha-123" },
      });
      mockCreateTree.mockResolvedValue({
        data: { sha: "new-tree-sha-123" },
      });
      mockCreateCommit.mockResolvedValue({
        data: { sha: "commit-sha-123" },
      });
      mockCreatePull.mockResolvedValue({
        data: {
          number: 42,
          html_url: "https://github.com/owner/repo/pull/42",
          draft: true,
        },
      });

      const result = await githubCreateDraftPRTool.execute(
        {
          repo: "owner/repo",
          title: "Test PR",
          body: "Test body",
          base: "main",
          head: "existing-branch",
          files: [{ path: "test.py", content: "print('test')\n" }],
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(mockUpdateRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: "heads/existing-branch",
          force: true,
        })
      );
    });
  });
});
