/**
 * Retry utility with exponential backoff for LLM API calls
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Add jitter to prevent thundering herd (default: true) */
  jitter?: boolean;
  /** Custom function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback fired before each retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "isRetryable" | "onRetry">> =
  {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
  };

/**
 * Errors that should trigger a retry
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

/**
 * Check if an error is retryable based on common patterns
 */
export function isRetryableError(error: unknown): boolean {
  // Network errors
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }

  // Connection errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("socket hang up") ||
      message.includes("network") ||
      message.includes("timeout")
    ) {
      return true;
    }
  }

  // RetryableError (explicitly marked)
  if (error instanceof RetryableError) {
    return true;
  }

  // Check for HTTP status code patterns
  if (error instanceof Error && error.message.includes("API error:")) {
    const statusMatch = error.message.match(/(\d{3})/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      // Retry on rate limits (429) and server errors (5xx)
      return status === 429 || (status >= 500 && status < 600);
    }
  }

  return false;
}

/**
 * Extract retry-after delay from error if available
 */
function getRetryAfterMs(error: unknown): number | undefined {
  if (error instanceof RetryableError && error.retryAfterMs) {
    return error.retryAfterMs;
  }
  return undefined;
}

/**
 * Calculate delay for the next retry attempt with exponential backoff
 */
function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, "isRetryable" | "onRetry">>,
  retryAfterMs?: number
): number {
  // Use retry-after header if provided
  if (retryAfterMs) {
    return Math.min(retryAfterMs, options.maxDelayMs);
  }

  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  let delay =
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, options.maxDelayMs);

  // Add jitter (±25%) to prevent thundering herd
  if (options.jitter) {
    const jitterFactor = 0.75 + Math.random() * 0.5; // 0.75 to 1.25
    delay = Math.floor(delay * jitterFactor);
  }

  return delay;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const checkRetryable = opts.isRetryable ?? isRetryableError;

  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= opts.maxRetries || !checkRetryable(error)) {
        throw error;
      }

      // Calculate delay
      const retryAfterMs = getRetryAfterMs(error);
      const delayMs = calculateDelay(attempt, opts, retryAfterMs);

      // Fire onRetry callback
      if (opts.onRetry) {
        opts.onRetry(error, attempt + 1, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // Should not reach here, but just in case
  throw lastError;
}

/**
 * Wrap a fetch call to throw RetryableError on retryable HTTP status codes
 */
export async function fetchWithRetryableErrors(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const errorText = await response.text();

    // Check if this is a retryable status
    if (response.status === 429 || response.status >= 500) {
      // Try to parse retry-after header
      const retryAfter = response.headers.get("retry-after");
      let retryAfterMs: number | undefined;

      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) {
          retryAfterMs = seconds * 1000;
        }
      }

      throw new RetryableError(
        `API error: ${response.status} - ${errorText}`,
        response.status,
        retryAfterMs
      );
    }

    // Non-retryable error
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response;
}
