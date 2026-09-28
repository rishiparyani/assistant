// Errors thrown inside Durable Objects. Workers RPC keeps an error's message but not its
// class or fields, so the code and details travel inside the message and are decoded at
// the HTTP edge (toAppError).
import { AppError, type ErrorCode } from "../errors.ts";

const PREFIX = "[object-error]";

export class ObjectError extends Error {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(`${PREFIX}${JSON.stringify({ code, message, details })}`);
    this.name = "ObjectError";
  }
}

/** Turns an error from an object call into the API's error, or returns null if it isn't one. */
export function toAppError(err: unknown): AppError | null {
  const text = err instanceof Error ? err.message : String(err);
  const at = text.indexOf(PREFIX);
  if (at === -1) return null;
  try {
    const { code, message, details } = JSON.parse(text.slice(at + PREFIX.length)) as {
      code: ErrorCode;
      message: string;
      details?: unknown;
    };
    return new AppError(code, message, details);
  } catch {
    return null;
  }
}
