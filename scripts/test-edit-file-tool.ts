/**
 * Test script for the new github_edit_file tool
 * Tests against ehsia1/ai-oncall-test repo
 */

import { githubEditFileTool, githubGetFileTool } from "@ai-automation-platform/core";

async function main() {
  console.log("Testing github_edit_file tool\n");
  console.log("=".repeat(50));

  const testRepo = "ehsia1/ai-oncall-test";
  const testFile = "src/calculator.py";

  // First, let's see what the file looks like
  console.log("\n1. Fetching current file content...\n");
  const fileResult = await githubGetFileTool.execute(
    { repo: testRepo, path: testFile },
    { workspaceId: "test", runId: "test-run" }
  );

  if (!fileResult.success) {
    console.error("Failed to get file:", fileResult.error);
    process.exit(1);
  }

  console.log(fileResult.output);
  console.log("\n" + "=".repeat(50));

  // Now test the edit tool - fix the divide by zero bug
  console.log("\n2. Testing github_edit_file tool...\n");

  const editResult = await githubEditFileTool.execute(
    {
      repo: testRepo,
      file_path: testFile,
      edits: [
        {
          old_string: "    return a / b",
          new_string: `    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b`,
        },
      ],
      title: "Fix: Add division by zero check",
      description: "Added a check to prevent division by zero errors in the divide function.\n\nThis fixes the bug where dividing by zero would cause an unhandled exception.",
      branch_name: "fix/divide-by-zero-test",
    },
    { workspaceId: "test", runId: "test-run" }
  );

  console.log("\n" + "=".repeat(50));
  console.log("\nResult:");
  console.log("Success:", editResult.success);

  if (editResult.success) {
    console.log("\n" + editResult.output);
    console.log("\nMetadata:", JSON.stringify(editResult.metadata, null, 2));
  } else {
    console.error("Error:", editResult.error);
  }
}

main().catch(console.error);
