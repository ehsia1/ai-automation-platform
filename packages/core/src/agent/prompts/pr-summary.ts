/**
 * PR Summary Agent Prompt
 *
 * An agent that analyzes GitHub Pull Requests and generates comprehensive summaries.
 * Can be triggered by PR webhooks or manually.
 */

export const PR_SUMMARY_PROMPT = `You are an expert code reviewer and technical writer. Your goal is to analyze GitHub Pull Requests and generate clear, actionable summaries that help reviewers understand changes quickly.

## Your Capabilities

You have access to the following tools:

### GitHub Tools
1. **github_get_file** - Read file contents from a repository. Use this to understand the context of changed files.
2. **github_list_files** - List files in a directory. Use this to explore the repo structure if needed.
3. **github_search_code** - Search for related code patterns in the repository.

### Service Registry (Optional)
4. **service_lookup** - Look up service information if the PR affects a known service.

## Analysis Process

### Step 1: Understand the PR Context
You will be provided with:
- PR title and description
- Files changed with their diffs
- PR metadata (author, branch names, etc.)

Read through the PR description and diff carefully to understand:
- What problem is being solved?
- What approach was taken?
- What files are being modified?

### Step 2: Analyze Code Changes
For each changed file, identify:
- **Type of change**: New feature, bug fix, refactor, documentation, tests, config change
- **Risk level**: Low (docs, tests), Medium (logic changes), High (security, DB, infra)
- **Key modifications**: What specifically changed and why

### Step 3: Look for Potential Issues
Check for common problems:
- Missing error handling
- Security concerns (hardcoded secrets, SQL injection, XSS)
- Breaking changes to public APIs
- Missing tests for new functionality
- Performance implications
- Incomplete refactoring (old code left behind)

### Step 4: Generate Summary

Produce a structured summary with these sections:

## Summary Format

\`\`\`markdown
## PR Summary

**Type**: [Feature | Bug Fix | Refactor | Docs | Tests | Config | Mixed]
**Risk Level**: [Low | Medium | High]
**Review Priority**: [Routine | Standard | Careful Review Needed]

### Overview
[1-2 sentence description of what this PR accomplishes]

### Changes

#### [Category 1, e.g., "Core Logic"]
- Change description 1
- Change description 2

#### [Category 2, e.g., "Tests"]
- Change description 1

### Key Considerations
- [Important point for reviewers]
- [Potential concern or question]

### Testing Notes
[What should be tested and how]

### Checklist for Reviewers
- [ ] [Specific thing to verify]
- [ ] [Another verification item]
\`\`\`

## Guidelines

1. **Be Concise**: Focus on what matters. Don't describe obvious changes.
2. **Be Specific**: Reference actual file names, function names, and line numbers when relevant.
3. **Highlight Risks**: Call out anything that could cause problems in production.
4. **Be Constructive**: If you spot issues, suggest fixes rather than just pointing out problems.
5. **Consider Context**: Understand the codebase patterns before critiquing style choices.

## Output

Your final output should be the markdown-formatted PR summary ready to be posted as a GitHub comment. Start your response with the summary - do not add preamble like "Here's the summary:".`;

export interface PRSummaryContext {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  description: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  files: Array<{
    filename: string;
    status: "added" | "modified" | "removed" | "renamed";
    additions: number;
    deletions: number;
    patch?: string; // The diff
  }>;
  // Pre-fetched diffs if available
  fullDiff?: string;
}

export function buildPRSummaryPrompt(context: PRSummaryContext): string {
  const parts: string[] = [PR_SUMMARY_PROMPT];

  parts.push("\n## Pull Request Details\n");
  parts.push(`**Repository**: ${context.owner}/${context.repo}`);
  parts.push(`**PR #${context.pullNumber}**: ${context.title}`);
  parts.push(`**Author**: ${context.author}`);
  parts.push(`**Branch**: ${context.headBranch} → ${context.baseBranch}`);

  if (context.description) {
    parts.push("\n### PR Description");
    parts.push("```");
    parts.push(context.description);
    parts.push("```");
  }

  parts.push("\n### Files Changed");
  parts.push(`Total: ${context.files.length} files\n`);

  // Group files by type
  const added = context.files.filter((f) => f.status === "added");
  const modified = context.files.filter((f) => f.status === "modified");
  const removed = context.files.filter((f) => f.status === "removed");
  const renamed = context.files.filter((f) => f.status === "renamed");

  if (added.length > 0) {
    parts.push(`**Added** (${added.length}):`);
    for (const f of added) {
      parts.push(`  + ${f.filename} (+${f.additions})`);
    }
  }
  if (modified.length > 0) {
    parts.push(`**Modified** (${modified.length}):`);
    for (const f of modified) {
      parts.push(`  M ${f.filename} (+${f.additions}/-${f.deletions})`);
    }
  }
  if (removed.length > 0) {
    parts.push(`**Removed** (${removed.length}):`);
    for (const f of removed) {
      parts.push(`  - ${f.filename} (-${f.deletions})`);
    }
  }
  if (renamed.length > 0) {
    parts.push(`**Renamed** (${renamed.length}):`);
    for (const f of renamed) {
      parts.push(`  R ${f.filename}`);
    }
  }

  // Add diffs for each file (limited to reasonable size)
  parts.push("\n### Diffs\n");

  let totalPatchLength = 0;
  const maxTotalPatchLength = 50000; // Limit total diff size

  for (const file of context.files) {
    if (!file.patch) continue;

    if (totalPatchLength + file.patch.length > maxTotalPatchLength) {
      parts.push(`\n... (remaining diffs truncated for size)\n`);
      break;
    }

    parts.push(`#### ${file.filename}`);
    parts.push("```diff");
    parts.push(file.patch);
    parts.push("```\n");
    totalPatchLength += file.patch.length;
  }

  // If we have a full unified diff, add it
  if (context.fullDiff && !context.files.some((f) => f.patch)) {
    parts.push("#### Full Diff");
    parts.push("```diff");
    parts.push(
      context.fullDiff.length > maxTotalPatchLength
        ? context.fullDiff.substring(0, maxTotalPatchLength) + "\n... (truncated)"
        : context.fullDiff
    );
    parts.push("```");
  }

  parts.push("\n---");
  parts.push("\nAnalyze this PR and generate a comprehensive summary following the format specified above.");

  return parts.join("\n");
}
