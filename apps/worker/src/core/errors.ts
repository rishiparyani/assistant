// Typed errors thrown by services; adapters map them to HTTP (and later MCP) errors.
import type { ContentfulStatusCode } from "hono/utils/http-status";

const STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  ambiguous: 409,
  rate_limited: 429,
  internal: 500,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof STATUS;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  get status(): ContentfulStatusCode {
    return STATUS[this.code];
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) },
    };
  }
}
