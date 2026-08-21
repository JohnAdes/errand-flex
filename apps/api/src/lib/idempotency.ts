import type { FastifyRequest } from "fastify";
import { ValidationError } from "./errors";

/**
 * MVP idempotency helper. For endpoints marked "key required" in the API spec,
 * callers must send an `Idempotency-Key` header. This module intentionally
 * uses a simple in-memory map for the starter kit — replace with a
 * `processed_events` Postgres table (already documented in the architecture
 * spec, §7) or a Redis SETNX before relying on this in production, since an
 * in-memory map does not survive a restart or work across multiple instances.
 */
const seenKeys = new Map<string, { result: unknown; expiresAt: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;

export function requireIdempotencyKey(req: FastifyRequest): string {
  const key = req.headers["idempotency-key"];
  if (!key || Array.isArray(key)) {
    throw new ValidationError("Idempotency-Key header is required for this operation");
  }
  return key;
}

export function getCachedResult(key: string): unknown | undefined {
  const entry = seenKeys.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    seenKeys.delete(key);
    return undefined;
  }
  return entry.result;
}

export function cacheResult(key: string, result: unknown) {
  seenKeys.set(key, { result, expiresAt: Date.now() + TTL_MS });
}
