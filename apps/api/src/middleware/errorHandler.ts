import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { AppError } from "../lib/errors";
import { ZodError } from "zod";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const requestId = randomUUID();

    if (error instanceof ZodError) {
      reply.status(400).send({
        error_code: "VALIDATION_ERROR",
        message: error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
        request_id: requestId,
      });
      return;
    }

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error_code: error.errorCode,
        message: error.message,
        request_id: requestId,
      });
      return;
    }

    // Fastify itself and its plugins (body-parser 400s, @fastify/rate-limit's
    // 429, etc.) throw errors carrying their own real `statusCode` — this
    // used to always fall through to a hard-coded 500 below regardless,
    // silently turning e.g. "429 Too Many Requests" into "500 Internal
    // Server Error". Caught by actually load-testing the new rate limiter
    // and seeing 500s where 429s were expected, not by reading the code.
    const statusCode = typeof (error as any).statusCode === "number" ? (error as any).statusCode : 500;
    if (statusCode >= 400 && statusCode < 500) {
      reply.status(statusCode).send({
        error_code: (error as any).code ?? "REQUEST_ERROR",
        message: error.message,
        request_id: requestId,
      });
      return;
    }

    request.log.error({ err: error, requestId }, "Unhandled error");
    reply.status(500).send({
      error_code: "INTERNAL_ERROR",
      message: "Something went wrong. Reference the request_id when reporting this.",
      request_id: requestId,
    });
  });
}
