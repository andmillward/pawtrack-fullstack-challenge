import type { FastifyInstance, FastifyReply, FastifyError } from 'fastify';
import { AppError, type ErrorCode } from './errors.js';

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * The single success schema: `{ data }` for a resource, or `{ data, meta }`
 * for a paginated collection. Every successful response goes through here so the
 * schema can't be different per route.
 */
export function sendData<T>(
  reply: FastifyReply,
  data: T,
  statusCode = 200,
  meta?: PageMeta,
): FastifyReply {
  return reply.code(statusCode).send(meta ? { data, meta } : { data });
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
): FastifyReply {
  return reply.code(statusCode).send({ error: { code, message } });
}

/**
 * Centralises every error (and unknown route) into one
 * `{ error: { code, message } }` schema:
 *   - AppError    -> its own status + code (404/409/422/401/...)
 *   - schema fail -> 422 validation (Fastify defaults these to 400)
 *   - other <500  -> bad_request, status preserved
 *   - everything else -> 500 with no internal detail leaked
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return sendError(reply, error.statusCode, error.code, error.message);
    }

    // Fastify decorates JSON-schema failures with `validation` (defaults to 400 → 422).
    const fastifyError = error as FastifyError;
    if (fastifyError.validation) {
      return sendError(reply, 422, 'validation', fastifyError.message);
    }

    const statusCode = fastifyError.statusCode ?? 500;
    if (statusCode < 500) {
      return sendError(reply, statusCode, 'bad_request', fastifyError.message);
    }

    request.log.error(error);
    return sendError(reply, 500, 'internal', 'Internal Server Error');
  });

  app.setNotFoundHandler((_request, reply) => {
    return sendError(reply, 404, 'not_found', 'Route not found');
  });
}
