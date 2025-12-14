#!/usr/bin/env npx tsx
/**
 * AI Agent CLI
 *
 * Commands:
 *   add <owner/repo>      Add a service/repo to the registry
 *   list                  List registered services
 *   test                  Run agent test (default: divide-by-zero fix)
 *   index [repo]          Index docs from repos into RAG
 *   search <query>        Search indexed docs
 *
 * Usage:
 *   npx tsx scripts/ai-agent.ts add ehsia1/my-service --name my-service
 *   npx tsx scripts/ai-agent.ts list
 *   npx tsx scripts/ai-agent.ts test --repo ehsia1/ai-oncall-test
 *   npx tsx scripts/ai-agent.ts index
 *   npx tsx scripts/ai-agent.ts search "payment timeout"
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getServiceRegistry } from "../packages/core/src/services";
import { GitHubDocsLoader, DocsAggregator } from "../packages/core/src/docs";
import { getRagClient, resetRagClient } from "../packages/core/src/rag";
import { runAgentLoop, type AgentConfig } from "../packages/core/src/agent/loop";
import { buildInvestigationPrompt } from "../packages/core/src/agent/prompts/devops-investigator";
import "../packages/core/src/tools/index";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "add":
      await addService();
      break;
    case "list":
      await listServices();
      break;
    case "test":
      await testAgent();
      break;
    case "index":
      await indexDocs();
      break;
    case "search":
      await searchDocs();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
AI Agent CLI

Commands:
  add <owner/repo>      Add a service/repo to the registry
                        Options: --name <service-name>
                                 --log-groups <group1,group2>

  list                  List registered services

  test [--prompt <p>]   Run agent test
                        Options: --prompt <custom prompt>
                                 --repo <owner/repo>

  index [repo]          Index docs from repos into RAG
                        If repo specified, index only that repo
                        Otherwise, index all registered services

  search <query>        Search indexed docs

Examples:
  npx tsx scripts/ai-agent.ts add ehsia1/my-service --name my-service
  npx tsx scripts/ai-agent.ts list
  npx tsx scripts/ai-agent.ts test --repo ehsia1/ai-oncall-test
  npx tsx scripts/ai-agent.ts index
  npx tsx scripts/ai-agent.ts search "payment timeout errors"
`);
}

async function addService() {
  const repo = args[1];
  if (!repo || !repo.includes("/")) {
    console.error("Usage: add <owner/repo> [--name <service-name>]");
    process.exit(1);
  }

  // Parse options
  let name: string | undefined;
  let logGroups: string[] = [];

  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) {
      name = args[i + 1];
      i++;
    } else if (args[i] === "--log-groups" && args[i + 1]) {
      logGroups = args[i + 1].split(",");
      i++;
    }
  }

  // Default name to repo name if not provided
  if (!name) {
    name = repo.split("/")[1];
  }

  const registry = getServiceRegistry();
  registry.register({
    name,
    repository: repo,
    logGroups: logGroups.length > 0 ? logGroups : undefined,
  });

  console.log(`✅ Added service: ${name}`);
  console.log(`   Repository: ${repo}`);
  if (logGroups.length > 0) {
    console.log(`   Log groups: ${logGroups.join(", ")}`);
  }

  // Show current registry
  console.log(`\n📋 Registry now has ${registry.getAll().size} service(s)`);
}

async function listServices() {
  const registry = getServiceRegistry();
  const services = registry.getAll();

  if (services.size === 0) {
    console.log("No services registered.");
    console.log("\nAdd a service with:");
    console.log("  npx tsx scripts/ai-agent.ts add <owner/repo> --name <service-name>");
    return;
  }

  console.log(`📋 Registered Services (${services.size}):\n`);

  for (const [name, config] of services) {
    console.log(`  ${name}`);
    console.log(`    Repository: ${config.repository}`);
    if (config.logGroups && config.logGroups.length > 0) {
      console.log(`    Log groups: ${config.logGroups.join(", ")}`);
    }
    if (config.team) {
      console.log(`    Team: ${config.team}`);
    }
    if (config.language) {
      console.log(`    Language: ${config.language}`);
    }
    console.log();
  }
}

async function testAgent() {
  // Parse options
  let prompt: string | undefined;
  let repo = "ehsia1/ai-oncall-test";

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--prompt" && args[i + 1]) {
      prompt = args[i + 1];
      i++;
    } else if (args[i] === "--repo" && args[i + 1]) {
      repo = args[i + 1];
      i++;
    }
  }

  // Default prompt
  if (!prompt) {
    prompt = `Investigate the divide by zero error in the calculator service. The repo is ${repo} and has a bug in the divide function that needs fixing. Please explore the repo structure first, read the calculator file, and create a PR to fix the bug.`;
  }

  const alertContext = {
    service: repo.split("/")[1],
    errorMessage: "ZeroDivisionError: division by zero",
  };

  const config: AgentConfig = {
    maxIterations: 10,
    systemPrompt: buildInvestigationPrompt(alertContext),
  };

  console.log("🤖 Starting DevOps Investigator agent...\n");
  console.log(`📝 Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}`);
  console.log("\n" + "=".repeat(60) + "\n");

  const state = await runAgentLoop(
    prompt,
    config,
    { runId: `cli-test-${Date.now()}`, workspaceId: "local" },
    undefined,
    async (event) => {
      switch (event.type) {
        case "iteration_start":
          console.log(`\n--- Iteration ${event.iteration} ---`);
          break;
        case "tool_call":
          console.log(`\n🔧 ${event.toolName}`);
          break;
        case "tool_result":
          const status = event.result.success ? "✅" : "❌";
          console.log(`   ${status} ${event.result.output.slice(0, 200)}${event.result.output.length > 200 ? "..." : ""}`);
          break;
        case "completed":
          console.log("\n✅ Agent completed");
          break;
        case "failed":
          console.log(`\n❌ Error: ${event.error}`);
          break;
      }
    }
  );

  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 Final state: ${state.status}`);
  console.log(`   Iterations: ${state.iterations}`);
  if (state.result) {
    console.log(`\n📝 Result:\n${state.result}`);
  }
  if (state.error) {
    console.log(`\n❌ Error:\n${state.error}`);
  }
}

async function indexDocs() {
  const specificRepo = args[1];

  if (specificRepo) {
    // Index specific repo
    if (!specificRepo.includes("/")) {
      console.error("Invalid repo format. Use: owner/repo");
      process.exit(1);
    }

    console.log(`📚 Indexing docs from ${specificRepo}...\n`);

    const loader = new GitHubDocsLoader();
    const result = await loader.fetchFromRepo(specificRepo);

    console.log(`   Found ${result.docsCount} docs (${(result.totalSize / 1024).toFixed(1)}KB)`);

    if (result.errors.length > 0) {
      console.log(`   ⚠️  Errors: ${result.errors.join(", ")}`);
    }

    if (result.docs.length > 0) {
      const ragClient = getRagClient();
      await ragClient.initialize();

      const ragDocs = result.docs.map((doc) => ({
        id: `${doc.repository}:${doc.path}`,
        content: doc.content,
        metadata: {
          source: doc.type,
          service: doc.serviceName,
          path: doc.path,
          title: extractTitle(doc.content) || doc.path,
        },
      }));

      const chunks = await ragClient.indexDocuments(ragDocs);
      console.log(`   ✅ Indexed ${ragDocs.length} docs (${chunks} chunks)`);
    }
  } else {
    // Index all registered services
    const registry = getServiceRegistry();
    const services = registry.getAll();

    if (services.size === 0) {
      console.log("No services registered. Add some with 'add' command first.");
      return;
    }

    console.log(`📚 Indexing docs from ${services.size} registered service(s)...\n`);

    const aggregator = new DocsAggregator();
    const result = await aggregator.aggregateFromRegistry();

    console.log(`\n📊 Results:`);
    console.log(`   Repos processed: ${result.reposProcessed}`);
    console.log(`   Docs found: ${result.docsFound}`);
    console.log(`   Docs indexed: ${result.docsIndexed}`);
    console.log(`   Chunks created: ${result.chunksCreated}`);
    console.log(`   Duration: ${result.durationMs}ms`);

    if (result.errors.size > 0) {
      console.log(`\n⚠️  Errors:`);
      for (const [repo, errors] of result.errors) {
        console.log(`   ${repo}: ${errors.join(", ")}`);
      }
    }
  }
}

async function searchDocs() {
  const query = args.slice(1).join(" ");
  if (!query) {
    console.error("Usage: search <query>");
    process.exit(1);
  }

  console.log(`🔎 Searching for: "${query}"\n`);

  resetRagClient();
  const ragClient = getRagClient();
  await ragClient.initialize();

  const results = await ragClient.search(query, { limit: 5 });

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  console.log(`Found ${results.length} result(s):\n`);

  for (let i = 0; i < results.length; i++) {
    const { chunk, score } = results[i];
    const source = chunk.metadata.path || chunk.documentId;
    const title = chunk.metadata.title || "(no title)";

    console.log(`[${i + 1}] ${title}`);
    console.log(`    Source: ${source}`);
    console.log(`    Type: ${chunk.metadata.source}`);
    console.log(`    Relevance: ${(score * 100).toFixed(1)}%`);
    console.log(`    Preview: ${chunk.content.slice(0, 150).replace(/\n/g, " ")}...`);
    console.log();
  }
}

function extractTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
