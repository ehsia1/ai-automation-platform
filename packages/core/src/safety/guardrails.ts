// Safety guardrails for AI agent actions

// Forbidden SQL patterns that could be destructive
const FORBIDDEN_SQL_PATTERNS = [
  /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW|SCHEMA)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\s+\w+\s*$/i, // DELETE without WHERE
  /\bDELETE\s+FROM\s+\w+\s+WHERE\s+1\s*=\s*1/i, // DELETE WHERE 1=1
  /\bUPDATE\s+\w+\s+SET\s+.*WHERE\s+1\s*=\s*1/i, // UPDATE WHERE 1=1
  /\bALTER\s+TABLE\s+.*DROP\b/i,
  /\bGRANT\s+ALL\b/i,
  /\bREVOKE\b/i,
];

// Forbidden shell patterns
const FORBIDDEN_SHELL_PATTERNS = [
  /\brm\s+-rf?\s+[\/~]/i, // rm -rf / or rm -rf ~
  /\brm\s+-rf?\s+\*/i, // rm -rf *
  /\bchmod\s+777\b/i, // chmod 777
  /\bchmod\s+-R\s+777\b/i, // chmod -R 777
  /\b:\(\)\{\s*:\|\:&\s*\};:/i, // Fork bomb
  /\bmkfs\b/i, // Format filesystem
  /\bdd\s+if=.*of=\/dev/i, // dd to device
  /\b>\s*\/dev\/sd/i, // Overwrite disk
  /\bwget\s+.*\|\s*sh/i, // Download and execute
  /\bcurl\s+.*\|\s*sh/i, // Download and execute
  /\beval\s+\$\(/i, // Eval command substitution
];

// Patterns that might indicate secrets
const SECRET_PATTERNS = [
  /\b(api[_-]?key|apikey)\s*[=:]\s*['"]?[a-z0-9]{20,}/i,
  /\b(secret|password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{8,}/i,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS Access Key ID
  /\b[a-z0-9]{40}\b/i, // Potential secret key (40 char hex)
  /\bghp_[a-zA-Z0-9]{36}\b/, // GitHub Personal Access Token
  /\bsk-[a-zA-Z0-9]{48}\b/, // OpenAI API Key
  /\bxox[baprs]-[a-zA-Z0-9-]+\b/, // Slack Token
  /-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/, // Private keys
];

export interface GuardrailViolation {
  type: "sql" | "shell" | "secret" | "rate_limit";
  pattern: string;
  description: string;
  severity: "warning" | "blocked";
}

export interface GuardrailResult {
  allowed: boolean;
  violations: GuardrailViolation[];
}

// Check for forbidden SQL patterns
export function checkSQLSafety(query: string): GuardrailResult {
  const violations: GuardrailViolation[] = [];

  for (const pattern of FORBIDDEN_SQL_PATTERNS) {
    if (pattern.test(query)) {
      violations.push({
        type: "sql",
        pattern: pattern.toString(),
        description: `Potentially destructive SQL pattern detected: ${pattern.source}`,
        severity: "blocked",
      });
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

// Check for forbidden shell patterns
export function checkShellSafety(command: string): GuardrailResult {
  const violations: GuardrailViolation[] = [];

  for (const pattern of FORBIDDEN_SHELL_PATTERNS) {
    if (pattern.test(command)) {
      violations.push({
        type: "shell",
        pattern: pattern.toString(),
        description: `Dangerous shell command detected: ${pattern.source}`,
        severity: "blocked",
      });
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

// Check for potential secrets in output
export function checkForSecrets(text: string): GuardrailResult {
  const violations: GuardrailViolation[] = [];

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({
        type: "secret",
        pattern: pattern.toString(),
        description: `Potential secret detected in output`,
        severity: "warning",
      });
    }
  }

  return {
    allowed: true, // Secrets are warnings, not blocks
    violations,
  };
}

// Rate limiting state
interface RateLimitState {
  requestCount: number;
  costEstimate: number;
  windowStart: number;
}

const rateLimitState: RateLimitState = {
  requestCount: 0,
  costEstimate: 0,
  windowStart: Date.now(),
};

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_HOUR = 100;
const MAX_COST_PER_HOUR = 50; // $50

// Check rate limits
export function checkRateLimit(estimatedCost: number = 0.01): GuardrailResult {
  const now = Date.now();
  const violations: GuardrailViolation[] = [];

  // Reset window if needed
  if (now - rateLimitState.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.requestCount = 0;
    rateLimitState.costEstimate = 0;
    rateLimitState.windowStart = now;
  }

  // Check request count
  if (rateLimitState.requestCount >= MAX_REQUESTS_PER_HOUR) {
    violations.push({
      type: "rate_limit",
      pattern: `${MAX_REQUESTS_PER_HOUR} requests/hour`,
      description: `Rate limit exceeded: ${rateLimitState.requestCount} requests in the current hour`,
      severity: "blocked",
    });
  }

  // Check cost estimate
  if (rateLimitState.costEstimate + estimatedCost > MAX_COST_PER_HOUR) {
    violations.push({
      type: "rate_limit",
      pattern: `$${MAX_COST_PER_HOUR}/hour`,
      description: `Cost limit exceeded: estimated $${rateLimitState.costEstimate.toFixed(2)} + $${estimatedCost.toFixed(2)}`,
      severity: "blocked",
    });
  }

  // Update state if allowed
  if (violations.length === 0) {
    rateLimitState.requestCount++;
    rateLimitState.costEstimate += estimatedCost;
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

// Get current rate limit status
export function getRateLimitStatus(): {
  requestCount: number;
  costEstimate: number;
  windowRemainingMs: number;
} {
  const now = Date.now();
  const windowRemainingMs = Math.max(
    0,
    RATE_LIMIT_WINDOW_MS - (now - rateLimitState.windowStart)
  );

  return {
    requestCount: rateLimitState.requestCount,
    costEstimate: rateLimitState.costEstimate,
    windowRemainingMs,
  };
}

// Comprehensive safety check for tool arguments
export function checkToolSafety(
  toolName: string,
  args: Record<string, unknown>
): GuardrailResult {
  const allViolations: GuardrailViolation[] = [];

  // Check all string arguments for secrets
  for (const [_key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      const secretCheck = checkForSecrets(value);
      allViolations.push(...secretCheck.violations);
    }
  }

  // Tool-specific checks
  if (toolName === "cloudwatch_query_logs") {
    const query = args.query as string;
    if (query) {
      // No SQL-specific checks for CloudWatch - it uses its own query language
      // But we can check for overly broad queries
      if (query.includes("fields *") && !query.includes("limit")) {
        allViolations.push({
          type: "sql",
          pattern: "fields * without limit",
          description:
            "Overly broad CloudWatch query - consider adding a limit clause",
          severity: "warning",
        });
      }
    }
  }

  // Check rate limit
  const rateCheck = checkRateLimit();
  allViolations.push(...rateCheck.violations);

  const hasBlocking = allViolations.some((v) => v.severity === "blocked");

  return {
    allowed: !hasBlocking,
    violations: allViolations,
  };
}

// Sanitize output to redact potential secrets
export function sanitizeOutput(text: string): string {
  let sanitized = text;

  // Redact AWS keys
  sanitized = sanitized.replace(
    /AKIA[0-9A-Z]{16}/g,
    "AKIA****************"
  );

  // Redact potential API keys (long alphanumeric strings after = or :)
  sanitized = sanitized.replace(
    /(api[_-]?key|secret|password|token)\s*[=:]\s*['"]?[a-z0-9]{20,}/gi,
    "$1=***REDACTED***"
  );

  // Redact GitHub tokens
  sanitized = sanitized.replace(
    /ghp_[a-zA-Z0-9]{36}/g,
    "ghp_************************************"
  );

  return sanitized;
}
