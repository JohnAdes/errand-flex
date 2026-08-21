import { Queue, Worker } from "bullmq";
import { env } from "../env";
import { runOfferExpirySweep } from "./offerExpirySweep.job";
import { runBatchSuggestion } from "./batchSuggestion.job";
import { runDriverDocumentExpirationSweep } from "./driverDocumentExpiration.job";
import { runScheduledPayoutRun } from "./payoutRun.job";

const QUEUE_NAME = "courier-scheduled-jobs";

// BullMQ wants a plain host/port/password object, not a connection string.
function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null as null, // required by BullMQ's blocking-connection contract
  };
}

let queue: Queue | undefined;
let worker: Worker | undefined;

/**
 * Registers the repeatable background jobs from 02-architecture.md §7
 * (offer-expiry sweep, route-batch-suggestion run, driver-document-
 * expiration sweep, payout run) on BullMQ/Redis — previously every one of
 * these was a manually-triggered admin endpoint and nothing else, "designed
 * in the architecture doc, not implemented as actual scheduled jobs" (see
 * README).
 *
 * Tolerant of Redis being unreachable: logs a warning and leaves the API
 * fully functional without scheduled jobs rather than crashing boot — every
 * job's underlying logic also stays reachable via its manual admin endpoint
 * (batch-suggest, payout/run) or can be invoked directly for the two that
 * don't have one (offer-expiry sweep, doc-expiration sweep), same as before
 * this was wired up.
 */
export async function startJobScheduler() {
  try {
    const connection = parseRedisUrl(env.REDIS_URL);
    queue = new Queue(QUEUE_NAME, { connection });

    worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        switch (job.name) {
          case "offer-expiry-sweep":
            return runOfferExpirySweep();
          case "batch-suggestion-run":
            return runBatchSuggestion();
          case "driver-document-expiration-sweep":
            return runDriverDocumentExpirationSweep();
          case "payout-run":
            return runScheduledPayoutRun();
          default:
            throw new Error(`Unknown scheduled job: ${job.name}`);
        }
      },
      { connection }
    );
    worker.on("failed", (job, err) => {
      console.error(`[jobs] "${job?.name}" failed:`, err instanceof Error ? err.message : err);
    });

    // BullMQ v6 moved repeating jobs off `Queue.add({ repeat })` and onto a
    // dedicated job-scheduler API — `upsertJobScheduler` is idempotent (safe
    // to call on every boot without creating duplicate schedules).
    const ONE_MINUTE = 60_000;
    await queue.upsertJobScheduler("offer-expiry-sweep", { every: 30_000 }, { name: "offer-expiry-sweep" });
    await queue.upsertJobScheduler("batch-suggestion-run", { every: 5 * ONE_MINUTE }, { name: "batch-suggestion-run" });
    await queue.upsertJobScheduler(
      "driver-document-expiration-sweep",
      { every: 24 * 60 * ONE_MINUTE },
      { name: "driver-document-expiration-sweep" }
    );
    await queue.upsertJobScheduler("payout-run", { every: 7 * 24 * 60 * ONE_MINUTE }, { name: "payout-run" });

    // eslint-disable-next-line no-console
    console.log("[jobs] Scheduled background jobs registered (offer-expiry sweep, batch-suggestion run, driver-doc-expiration sweep, payout run).");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[jobs] Could not connect to Redis — scheduled background jobs are disabled; trigger the equivalent admin endpoints manually instead. Error:",
      err instanceof Error ? err.message : err
    );
  }
}

export async function stopJobScheduler() {
  await worker?.close();
  await queue?.close();
}
