import { APIGatewayProxyHandler } from "aws-lambda";
import { randomUUID } from "crypto";
import { createHmac } from "crypto";
import { Resource } from "sst";
import { EventBridge } from "@aws-sdk/client-eventbridge";

const eventbridge = new EventBridge({});

// Default workspace for MVP (single-tenant)
const DEFAULT_WORKSPACE_ID = "default";

/**
 * GitHub Pull Request Webhook Payload (simplified)
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
 */
interface GitHubPullRequestPayload {
  action: string; // "opened", "synchronize", "reopened", "closed", etc.
  number: number;
  pull_request: {
    id: number;
    number: number;
    state: "open" | "closed";
    title: string;
    body: string | null;
    user: {
      login: string;
      id: number;
    };
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
    merged: boolean;
    mergeable: boolean | null;
    draft: boolean;
    additions: number;
    deletions: number;
    changed_files: number;
    html_url: string;
    diff_url: string;
    patch_url: string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
    };
    html_url: string;
  };
  sender: {
    login: string;
    id: number;
  };
}

/**
 * GitHub file from list-files API
 */
interface GitHubPRFile {
  sha: string;
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

/**
 * Verify GitHub webhook signature
 */
function verifyGitHubSignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  return signature === expectedSignature;
}

/**
 * Fetch PR files from GitHub API
 */
async function fetchPRFiles(
  owner: string,
  repo: string,
  pullNumber: number,
  token: string
): Promise<GitHubPRFile[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "ai-automation-platform",
      },
    }
  );

  if (!response.ok) {
    console.error(`Failed to fetch PR files: ${response.status} ${response.statusText}`);
    return [];
  }

  return response.json() as Promise<GitHubPRFile[]>;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Get the GitHub event type from header
    const eventType = event.headers["x-github-event"] || event.headers["X-GitHub-Event"];

    // Only process pull_request events
    if (eventType !== "pull_request") {
      console.log(`Ignoring GitHub event: ${eventType}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: `Ignored event type: ${eventType}`,
        }),
      };
    }

    // Verify signature if secret is configured
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    const signature = event.headers["x-hub-signature-256"] || event.headers["X-Hub-Signature-256"];

    if (webhookSecret && event.body) {
      if (!verifyGitHubSignature(event.body, signature, webhookSecret)) {
        console.warn("Invalid GitHub webhook signature");
        return {
          statusCode: 401,
          body: JSON.stringify({
            success: false,
            error: "Invalid signature",
          }),
        };
      }
    }

    // Parse the webhook payload
    const body = event.body ? JSON.parse(event.body) : {};
    const payload = body as GitHubPullRequestPayload;

    // Only process "opened", "synchronize", or "reopened" actions
    const processableActions = ["opened", "synchronize", "reopened"];
    if (!processableActions.includes(payload.action)) {
      console.log(`Ignoring PR action: ${payload.action}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: `Ignored PR action: ${payload.action}`,
        }),
      };
    }

    // Skip draft PRs unless configured otherwise
    if (payload.pull_request.draft && process.env.SKIP_DRAFT_PRS !== "false") {
      console.log(`Skipping draft PR #${payload.pull_request.number}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Skipped draft PR",
        }),
      };
    }

    const pr = payload.pull_request;
    const repo = payload.repository;

    console.log(`Processing PR #${pr.number}: ${pr.title} (action: ${payload.action})`);

    // Fetch PR files with diffs
    const githubToken = process.env.GITHUB_TOKEN;
    let files: Array<{
      filename: string;
      status: "added" | "modified" | "removed" | "renamed";
      additions: number;
      deletions: number;
      patch?: string;
    }> = [];

    if (githubToken) {
      const prFiles = await fetchPRFiles(repo.owner.login, repo.name, pr.number, githubToken);
      files = prFiles.map((f) => ({
        filename: f.filename,
        status: normalizeFileStatus(f.status),
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      }));
    } else {
      console.warn("GITHUB_TOKEN not configured - cannot fetch PR files");
    }

    // Generate run ID
    const runId = randomUUID();

    // Emit event to trigger PR Summary agent
    await eventbridge.putEvents({
      Entries: [
        {
          EventBusName: Resource.Bus.name,
          Source: "ai-automation-platform",
          DetailType: "pr.summary.requested",
          Detail: JSON.stringify({
            workspaceId: DEFAULT_WORKSPACE_ID,
            runId,
            owner: repo.owner.login,
            repo: repo.name,
            pullNumber: pr.number,
            title: pr.title,
            description: pr.body || "",
            author: pr.user.login,
            baseBranch: pr.base.ref,
            headBranch: pr.head.ref,
            files,
            postComment: true, // Automatically post summary as PR comment
          }),
        },
      ],
    });

    console.log(`Triggered PR Summary for ${repo.full_name}#${pr.number} (runId: ${runId})`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        runId,
        message: `PR Summary triggered for #${pr.number}`,
      }),
    };
  } catch (error) {
    console.error("Error processing GitHub webhook:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};

/**
 * Normalize GitHub file status to our simplified set
 */
function normalizeFileStatus(
  status: GitHubPRFile["status"]
): "added" | "modified" | "removed" | "renamed" {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "removed";
    case "renamed":
      return "renamed";
    case "modified":
    case "changed":
    case "copied":
    case "unchanged":
    default:
      return "modified";
  }
}
