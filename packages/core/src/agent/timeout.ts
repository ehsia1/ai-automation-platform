/**
 * Timeout utilities for agent execution
 *
 * Provides graceful timeout handling with:
 * - AbortController integration for cancellation
 * - Custom timeout errors with context
 * - Utility functions for wrapping async operations
 */

/**
 * Custom error for timeout scenarios
 */
export class AgentTimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    public readonly elapsedMs: number,
    public readonly context?: {
      iteration?: number;
      lastToolCall?: string;
    }
  ) {
    super(message);
    this.name = "AgentTimeoutError";
  }
}

/**
 * Timeout controller for managing agent execution timeouts
 */
export class TimeoutController {
  private startTime: number;
  private abortController: AbortController;
  private timeoutId?: ReturnType<typeof setTimeout>;

  constructor(
    public readonly timeoutMs: number,
    private onTimeout?: () => void
  ) {
    this.startTime = Date.now();
    this.abortController = new AbortController();
  }

  /**
   * Get the abort signal for cancellation
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Check if timeout has been reached
   */
  get isTimedOut(): boolean {
    return this.abortController.signal.aborted;
  }

  /**
   * Get elapsed time in milliseconds
   */
  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get remaining time in milliseconds
   */
  get remainingMs(): number {
    return Math.max(0, this.timeoutMs - this.elapsedMs);
  }

  /**
   * Check if there's enough time remaining for an operation
   */
  hasTimeFor(estimatedMs: number): boolean {
    return this.remainingMs > estimatedMs;
  }

  /**
   * Start the timeout timer
   */
  start(): void {
    if (this.timeoutId) {
      return; // Already started
    }

    this.timeoutId = setTimeout(() => {
      this.abortController.abort();
      this.onTimeout?.();
    }, this.timeoutMs);
  }

  /**
   * Stop the timeout timer (call when agent completes normally)
   */
  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }

  /**
   * Manually trigger timeout
   */
  abort(): void {
    this.stop();
    this.abortController.abort();
  }

  /**
   * Check remaining time and throw if insufficient
   */
  checkTimeout(context?: { iteration?: number; lastToolCall?: string }): void {
    if (this.isTimedOut) {
      throw new AgentTimeoutError(
        `Agent execution timed out after ${this.elapsedMs}ms (limit: ${this.timeoutMs}ms)`,
        this.timeoutMs,
        this.elapsedMs,
        context
      );
    }
  }
}

/**
 * Wrap a promise with a timeout
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Custom error message
 * @returns The promise result or throws on timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new AgentTimeoutError(
          errorMessage || `Operation timed out after ${timeoutMs}ms`,
          timeoutMs,
          timeoutMs
        )
      );
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(error: unknown): error is AgentTimeoutError {
  return error instanceof AgentTimeoutError;
}
