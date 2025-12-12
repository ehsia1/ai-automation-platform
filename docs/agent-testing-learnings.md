# Agent Testing Learnings

## What Was Accomplished

### Full Agent Flow Test (December 2025)

Successfully tested the complete DevOps Investigator agent flow:

```
Alert → Log Query → Repo Exploration → Code Analysis → PR Creation
```

**Test Run Results:**
- **Iterations**: 5 (including 1 self-correction)
- **Tool Calls**: 4 total
  1. `github_list_files` → explored repo structure
  2. `github_get_file` → read buggy calculator.py (1216 bytes)
  3. `github_create_single_file_pr` → FAILED (only passed 123 chars)
  4. `github_create_single_file_pr` → SUCCESS (full file content)
- **PR Created**: https://github.com/ehsia1/ai-oncall-test/pull/9

### Key Improvements Made

1. **Simpler Tool Definition** (`github_create_single_file_pr`)
   - Flat parameters instead of nested `files[]` array
   - Easier for smaller LLMs to call correctly
   - File: `packages/core/src/tools/github.ts:785-877`

2. **Content Validation**
   - Rejects PRs where file content is significantly smaller than original
   - Provides helpful error message showing what the file should start with
   - Prevents accidental file truncation

3. **Tool Call Rescue Logic**
   - Detects when LLM outputs tool calls as JSON text instead of function calling
   - Parses and executes the tool call anyway
   - File: `packages/core/src/agent/loop.ts:74-215`

4. **Agent Continuation Logic**
   - Re-prompts LLM when it stops prematurely without completing the flow
   - Tracks progress: logs queried → files listed → file read → PR created
   - File: `packages/core/src/agent/loop.ts:614-655`

---

## Key Learnings

### 1. Small Local LLMs Struggle with Agentic Tool Use

**Problem**: Models like `hermes3` and `llama3.1:8b` frequently:
- Output tool calls as JSON text instead of using function calling
- Pass partial content (just the changed function, not the whole file)
- Stop mid-flow and narrate next steps instead of executing them

**Mitigations Applied**:
- Tool call rescue logic (parse JSON from text)
- Content validation with helpful errors
- Continuation prompts when flow is incomplete
- Simpler flat parameter schemas

**What Still Doesn't Work Well**:
- Models still struggle with large file content in tool calls
- Retry logic helps but adds iterations and latency

### 2. Prompt Engineering Has Diminishing Returns

We tried many prompt improvements:
- `<rule>` tags with explicit instructions
- Examples of wrong vs correct behavior
- Step-by-step checklists
- Warnings about common mistakes

**Reality**: Small models often ignore these instructions. The agent loop logic (validation, rescue, continuation) was more effective than prompt changes.

### 3. Model Switching is Disruptive

During testing, we switched between:
- `llama3.1:8b` - Fast but poor tool calling
- `hermes3` - Better instruction following, still struggles with large content
- `qwen2.5:7b` - Never finished downloading

**Problem**: Each model has different strengths/weaknesses. No systematic way to compare.

### 4. Testing Workflow is Manual and Slow

Current workflow:
1. Edit code/prompt
2. Run `npx tsx scripts/test-agent.ts`
3. Wait 1-3 minutes for agent to complete
4. Read console output
5. Repeat

**Pain Points**:
- No way to replay the same scenario with different models
- No metrics/scoring of agent performance
- No way to test just one part of the flow

---

## Recommended Iteration Strategy

### Short Term: Improve Local Testing

1. **Create evaluation dataset** with expected outcomes:
   ```typescript
   // scripts/evals/scenarios.ts
   export const scenarios = [
     {
       name: "divide-by-zero-fix",
       input: "Fix divide by zero bug in ehsia1/ai-oncall-test",
       expectedTools: ["github_list_files", "github_get_file", "github_create_single_file_pr"],
       expectedOutcome: "PR created with zero-check in divide function",
       maxIterations: 6,
     },
   ];
   ```

2. **Create model comparison script**:
   ```bash
   # Run same scenario with different models
   npx tsx scripts/eval-agent.ts --scenario=divide-by-zero --models=hermes3,llama3.1:8b,qwen2.5
   ```

3. **Add structured logging for analysis**:
   - Time per iteration
   - Token usage
   - Tool call success/failure reasons
   - Content validation failures

### Medium Term: Use Better Models for Complex Tasks

Options:
1. **Anthropic Claude** - Much better at tool calling, costs money
2. **Larger local models** - `llama3.1:70b`, `codellama:34b` (need more RAM/GPU)
3. **Hybrid approach** - Small model for triage, large model for PR creation

### Long Term: Agent Architecture Improvements

1. **Multi-step planning** - Have LLM output a plan first, then execute steps
2. **Specialized sub-agents** - Different prompts/models for different tasks
3. **Human-in-the-loop checkpoints** - Pause for review before PR creation
4. **Memory/context management** - Summarize long file contents

---

## Decision: How to Choose Models

| Use Case | Recommended Model | Why |
|----------|-------------------|-----|
| Quick iteration during dev | `hermes3` (local) | Fast, free, good enough for testing flow |
| Production investigations | Claude Sonnet | Reliable tool calling, worth the cost |
| Testing prompt changes | Local model first | Don't burn API credits on broken prompts |
| Evaluating agent quality | Both local + Claude | Compare to establish baseline |

### Model Configuration

```bash
# .env for local dev
LLM_PROVIDER=ollama
OLLAMA_MODEL=hermes3

# .env for production
LLM_PROVIDER=anthropic
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

---

## Next Steps

1. [ ] Create `scripts/eval-agent.ts` with scenario-based testing
2. [ ] Add structured JSON logging to agent loop
3. [ ] Set up Anthropic API key for production testing
4. [ ] Create 5-10 evaluation scenarios covering different failure modes
5. [ ] Document model comparison results

---

## Test Repositories

| Repo | Purpose |
|------|---------|
| `ehsia1/ai-oncall-test` | Buggy calculator.py for PR testing |
| `ehsia1/ai-agent-test` | General agent testing |

Both are **private** repos to avoid exposing test data.
