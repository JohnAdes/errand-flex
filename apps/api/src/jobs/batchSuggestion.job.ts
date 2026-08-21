import { suggestRouteBatches } from "../modules/dispatch/batching.service";

/**
 * Route-batch-suggestion run (02-architecture.md §7 / §9). The algorithm
 * itself (batching.service.ts) was already real and admin-triggerable via
 * `POST /v1/internal/dispatch/batches/suggest`; this just puts it on a
 * schedule instead of requiring a human to remember to call it.
 */
export async function runBatchSuggestion() {
  const created = await suggestRouteBatches();
  return { batchesCreated: created.length };
}
