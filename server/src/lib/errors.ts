export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'bad_request'
  | 'internal';

/**
 * Base class for errors that map cleanly onto an HTTP response.
 *
 * Throwing one of these from anywhere (route, service, or hook) lets the single
 * error handler in lib/http.ts render the standard `{ error: { code, message } }`
 *  with the correct status code. Status codes live in ONE place instead of
 * being hand-written per route — which is how the original four inconsistent
 * codes (200-with-error, `{success:false}`, etc.) crept in.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, 'conflict', message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(422, 'validation', message);
  }
}
