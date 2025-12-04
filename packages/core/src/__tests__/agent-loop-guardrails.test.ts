import { describe, it, expect, vi, beforeEach } from "vitest";

// Test the validatePRFilesWereRead helper function
// This mirrors the implementation in loop.ts

describe("Agent Loop Guardrails", () => {
  describe("PR file validation logic", () => {
    // Helper function to test (matches the one in loop.ts)
    // IMPORTANT: Only EXISTING files need to be read before modification.
    // New files (not in knownExistingFiles) can be created without reading.
    function validatePRFilesWereRead(
      prArgs: Record<string, unknown>,
      successfullyReadFiles: Record<string, boolean>,
      knownExistingFiles: Record<string, boolean>
    ): { valid: boolean; missingFiles: string[]; newFiles: string[] } {
      const repo = prArgs.repo as string;
      let files = prArgs.files as Array<{ path?: string; filename?: string }> | string | undefined;

      // Handle files passed as JSON string
      if (typeof files === "string") {
        try {
          files = JSON.parse(files) as Array<{ path?: string; filename?: string }>;
        } catch {
          return { valid: false, missingFiles: ["(invalid files array)"], newFiles: [] };
        }
      }

      if (!Array.isArray(files) || files.length === 0) {
        return { valid: false, missingFiles: ["(no files specified)"], newFiles: [] };
      }

      const missingFiles: string[] = [];
      const newFiles: string[] = [];

      for (const file of files) {
        const path = file.path || file.filename;
        if (!path) continue;

        const key = `${repo}:${path}`;
        const fileExists = knownExistingFiles[key];
        const fileWasRead = successfullyReadFiles[key];

        if (fileExists && !fileWasRead) {
          // File exists but wasn't read - this is the dangerous case we want to block
          missingFiles.push(path);
        } else if (!fileExists) {
          // File doesn't exist (new file) - that's fine, just track it
          newFiles.push(path);
        }
        // else: File exists and was read - good to go
      }

      return {
        valid: missingFiles.length === 0,
        missingFiles,
        newFiles,
      };
    }

    it("should pass when all existing files have been read", () => {
      const prArgs = {
        repo: "owner/repo",
        files: [
          { path: "src/calculator.py", content: "..." },
          { path: "tests/test_calculator.py", content: "..." },
        ],
      };
      const successfullyReadFiles = {
        "owner/repo:src/calculator.py": true,
        "owner/repo:tests/test_calculator.py": true,
      };
      const knownExistingFiles = {
        "owner/repo:src/calculator.py": true,
        "owner/repo:tests/test_calculator.py": true,
      };

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(true);
      expect(result.missingFiles).toHaveLength(0);
      expect(result.newFiles).toHaveLength(0);
    });

    it("should fail when existing files have not been read", () => {
      const prArgs = {
        repo: "owner/repo",
        files: [
          { path: "src/calculator.py", content: "..." },
          { path: "src/oncall.py", content: "..." },
        ],
      };
      const successfullyReadFiles = {
        // Only calculator.py was read, not oncall.py
        "owner/repo:src/calculator.py": true,
      };
      const knownExistingFiles = {
        // Both files exist in the repo
        "owner/repo:src/calculator.py": true,
        "owner/repo:src/oncall.py": true,
      };

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(false);
      expect(result.missingFiles).toContain("src/oncall.py");
    });

    it("should allow new files without reading first", () => {
      const prArgs = {
        repo: "owner/repo",
        files: [
          { path: "src/calculator.py", content: "..." }, // existing, was read
          { path: "src/new_file.py", content: "..." }, // new file
        ],
      };
      const successfullyReadFiles = {
        "owner/repo:src/calculator.py": true,
      };
      const knownExistingFiles = {
        // Only calculator.py exists, new_file.py is new
        "owner/repo:src/calculator.py": true,
      };

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(true);
      expect(result.missingFiles).toHaveLength(0);
      expect(result.newFiles).toContain("src/new_file.py");
    });

    it("should fail when existing file not read but allow new file", () => {
      const prArgs = {
        repo: "owner/repo",
        files: [
          { path: "src/calculator.py", content: "..." }, // existing, NOT read
          { path: "src/new_file.py", content: "..." }, // new file
        ],
      };
      const successfullyReadFiles = {};
      const knownExistingFiles = {
        "owner/repo:src/calculator.py": true,
      };

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(false);
      expect(result.missingFiles).toContain("src/calculator.py");
      expect(result.newFiles).toContain("src/new_file.py");
    });

    it("should pass for all-new files without reading", () => {
      const prArgs = {
        repo: "owner/repo",
        files: [
          { path: "src/brand_new_file.py", content: "..." },
          { path: "tests/test_new_file.py", content: "..." },
        ],
      };
      const successfullyReadFiles = {};
      const knownExistingFiles = {};

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(true);
      expect(result.missingFiles).toHaveLength(0);
      expect(result.newFiles).toHaveLength(2);
    });

    it("should handle files passed as JSON string", () => {
      const prArgs = {
        repo: "owner/repo",
        files: JSON.stringify([{ path: "src/calculator.py", content: "..." }]),
      };
      const successfullyReadFiles = {
        "owner/repo:src/calculator.py": true,
      };
      const knownExistingFiles = {
        "owner/repo:src/calculator.py": true,
      };

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(true);
    });

    it("should handle files with filename key instead of path", () => {
      const prArgs = {
        repo: "owner/repo",
        files: [{ filename: "src/calculator.py", content: "..." }],
      };
      const successfullyReadFiles = {
        "owner/repo:src/calculator.py": true,
      };
      const knownExistingFiles = {
        "owner/repo:src/calculator.py": true,
      };

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(true);
    });

    it("should fail gracefully with invalid JSON files string", () => {
      const prArgs = {
        repo: "owner/repo",
        files: "not valid json",
      };
      const successfullyReadFiles = {};
      const knownExistingFiles = {};

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(false);
      expect(result.missingFiles).toContain("(invalid files array)");
    });

    it("should fail with empty files array", () => {
      const prArgs = {
        repo: "owner/repo",
        files: [],
      };
      const successfullyReadFiles = {};
      const knownExistingFiles = {};

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(false);
      expect(result.missingFiles).toContain("(no files specified)");
    });

    it("should require exact repo:path match for existing files", () => {
      const prArgs = {
        repo: "owner/repo",
        files: [{ path: "src/calculator.py", content: "..." }],
      };
      // Read from different repo
      const successfullyReadFiles = {
        "other/repo:src/calculator.py": true,
      };
      const knownExistingFiles = {
        "owner/repo:src/calculator.py": true,
      };

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(false);
      expect(result.missingFiles).toContain("src/calculator.py");
    });

    it("should track file as existing if successfully read (even without explicit list)", () => {
      // This tests the behavior where github_get_file also marks the file as existing
      const prArgs = {
        repo: "owner/repo",
        files: [{ path: "src/calculator.py", content: "..." }],
      };
      const successfullyReadFiles = {
        "owner/repo:src/calculator.py": true,
      };
      // File is known to exist because it was successfully read
      // (in the real impl, github_get_file updates both maps)
      const knownExistingFiles = {
        "owner/repo:src/calculator.py": true,
      };

      const result = validatePRFilesWereRead(prArgs, successfullyReadFiles, knownExistingFiles);
      expect(result.valid).toBe(true);
    });
  });
});
