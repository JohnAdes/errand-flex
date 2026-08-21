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
type CacheEntry =
  | { status: "pending"; promise: Promise<unknown> }
  | { status: "done"; result: unknown; expiresAt: number };

const seenKeys = new Map<string, CacheEntry>();
const TTL_MS = 24 * 60 * 60 * 1000;

export function requireIdempotencyKey(req: FastifyRequest): string {
  const key = req.headers["idempotency-key"];
  if (!key || Array.isArray(key)) {
    throw new ValidationError("Idempotency-Key header is required for this operation");
  }
  return key;
}

/**
 * Runs `fn` at most once per idempotency key; concurrent callers with the
 * same key await the same in-flight execution and get its result rather than
 * re-running `fn` themselves. Found by review to previously be a separate
 * getCachedResult/cacheResult read-then-write: two concurrent requests with
 * the same key could both miss the cache before either wrote to it, letting
 * e.g. a payment get authorized twice. This is race-safe because the
 * check-and-claim below (`get` then `set`) has no `await` between them, so
 * no other async task can interleave on Node's single-threaded event loop.
 */
export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>
): Promise<{ result: T; replayed: boolean }> {
  const existing = seenKeys.get(key);
  if (existing) {
    if (existing.status === "pending") {
      return { result: (await existing.promise) as T, replayed: true };
    }
    if (existing.expiresAt >= Date.now()) {
      return { result: existing.result as T, replayed: true };
    }
    seenKeys.delete(key);
  }

  const promise = fn();
  seenKeys.set(key, { status: "pending", promise });
  try {
    const result = await promise;
    seenKeys.set(key, { status: "done", result, expiresAt: Date.now() + TTL_MS });
    return { result, replayed: false };
  } catch (err) {
    seenKeys.delete(key);
    throw err;
  }
}
