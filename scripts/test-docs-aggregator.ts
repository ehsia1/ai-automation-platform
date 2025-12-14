/**
 * Test script for GitHub docs aggregation
 *
 * Tests fetching documentation from GitHub repositories and indexing into RAG.
 *
 * Prerequisites:
 * - GITHUB_TOKEN environment variable set
 * - Ollama running locally with nomic-embed-text model (for RAG indexing)
 *
 * Usage:
 * npx tsx scripts/test-docs-aggregator.ts
 */

// Load environment variables
import * as dotenv from "dotenv";
dotenv.config();

import {
  GitHubDocsLoader,
  DEFAULT_DOCS_CONFIG,
  type FetchedDoc,
} from "../packages/core/src/docs";
import { getRagClient } from "../packages/core/src/rag";

async function main() {
  console.log("📚 GitHub Docs Aggregation Test\n");

  // Check for GitHub token
  if (!process.env.GITHUB_TOKEN) {
    console.error("❌ GITHUB_TOKEN environment variable is required");
    process.exit(1);
  }

  // Test repositories - using the test repos from CLAUDE.md
  const testRepos = [
    { repository: "ehsia1/ai-oncall-test", serviceName: "ai-oncall-test" },
    { repository: "ehsia1/ai-agent-test", serviceName: "ai-agent-test" },
  ];

  console.log("📋 Default docs config:");
  console.log(`   Patterns: ${DEFAULT_DOCS_CONFIG.patterns.slice(0, 3).join(", ")}...`);
  console.log(`   Directories: ${DEFAULT_DOCS_CONFIG.directories.join(", ")}`);
  console.log(`   Extensions: ${DEFAULT_DOCS_CONFIG.extensions.join(", ")}`);
  console.log(`   Max file size: ${DEFAULT_DOCS_CONFIG.maxFileSize / 1024}KB`);
  console.log(`   Max files per repo: ${DEFAULT_DOCS_CONFIG.maxFilesPerRepo}\n`);

  try {
    // Initialize loader
    const loader = new GitHubDocsLoader();

    // Test fetching from repos
    console.log("🔍 Fetching docs from test repositories...\n");

    const results = await loader.fetchFromRepos(testRepos);

    let totalDocs = 0;
    let totalSize = 0;
    const allDocs: FetchedDoc[] = [];

    for (const result of results) {
      console.log(`\n📂 ${result.repository} (${result.serviceName || "no service"}):`);
      console.log(`   Docs found: ${result.docsCount}`);
      console.log(`   Total size: ${(result.totalSize / 1024).toFixed(1)}KB`);

      if (result.errors.length > 0) {
        console.log(`   ⚠️  Errors: ${result.errors.join(", ")}`);
      }

      if (result.docs.length > 0) {
        console.log("   Files:");
        for (const doc of result.docs) {
          console.log(`     - ${doc.path} (${doc.type}, ${doc.size} bytes)`);
          allDocs.push(doc);
        }
      }

      totalDocs += result.docsCount;
      totalSize += result.totalSize;
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total repos: ${results.length}`);
    console.log(`   Total docs: ${totalDocs}`);
    console.log(`   Total size: ${(totalSize / 1024).toFixed(1)}KB`);

    // Test RAG indexing if we found docs
    if (allDocs.length > 0) {
      console.log("\n\n🔍 Testing RAG indexing...\n");

      const ragClient = getRagClient();
      await ragClient.initialize();

      // Convert docs to RAG documents
      const ragDocs = allDocs.map((doc) => ({
        id: `${doc.repository}:${doc.path}`,
        content: doc.content,
        metadata: {
          source: doc.type,
          service: doc.serviceName,
          path: doc.path,
          title: extractTitle(doc.content) || doc.path,
        },
      }));

      console.log(`📄 Indexing ${ragDocs.length} documents...`);
      const chunks = await ragClient.indexDocuments(ragDocs);
      console.log(`   Created ${chunks} chunks`);

      // Test search
      const stats = await ragClient.stats();
      console.log(`\n📊 RAG stats: ${stats.totalDocuments} docs, ${stats.totalChunks} chunks`);

      // Run a test search
      const testQuery = "README";
      console.log(`\n🔎 Test search: "${testQuery}"`);
      const searchResults = await ragClient.search(testQuery, { limit: 3 });

      if (searchResults.length > 0) {
        for (const result of searchResults) {
          console.log(
            `   [${(result.score * 100).toFixed(1)}%] ${result.chunk.metadata.path}`
          );
        }
      } else {
        console.log("   No results found");
      }
    }

    console.log("\n\n✅ Docs aggregation test completed!");
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

/**
 * Extract title from markdown content (first H1)
 */
function extractTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

main();
