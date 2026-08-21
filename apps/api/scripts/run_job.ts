// Runs one scheduled job once, immediately, without waiting for its BullMQ
// interval — useful for local testing/debugging. Usage:
//   npx tsx scripts/run_job.ts offer-expiry-sweep
//   npx tsx scripts/run_job.ts batch-suggestion-run
//   npx tsx scripts/run_job.ts driver-document-expiration-sweep
//   npx tsx scripts/run_job.ts payout-run
import { runOfferExpirySweep } from "../src/jobs/offerExpirySweep.job";
import { runBatchSuggestion } from "../src/jobs/batchSuggestion.job";
import { runDriverDocumentExpirationSweep } from "../src/jobs/driverDocumentExpiration.job";
import { runScheduledPayoutRun } from "../src/jobs/payoutRun.job";

const jobs: Record<string, () => Promise<unknown>> = {
  "offer-expiry-sweep": runOfferExpirySweep,
  "batch-suggestion-run": runBatchSuggestion,
  "driver-document-expiration-sweep": runDriverDocumentExpirationSweep,
  "payout-run": runScheduledPayoutRun,
};

const jobName = process.argv[2];
const job = jobName ? jobs[jobName] : undefined;
if (!job) {
  console.error(`Usage: npx tsx scripts/run_job.ts <${Object.keys(jobs).join("|")}>`);
  process.exit(1);
}

job()
  .then((result) => {
    console.log(`[${jobName}] result:`, result);
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[${jobName}] failed:`, e);
    process.exit(1);
  });
