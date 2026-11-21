'use strict';
/**
 * Preserve the monetization hold contract across the production CLI -> queue handoff.
 * Exit 42 is reserved by scripts/production-queue.js for a batch-wide safety hold.
 */
function productionExitCode(result = {}) {
  if (result.status === 'held_for_monetization_review' || result.monetizationSafety?.autoHold === true) return 42;
  if (result.status === 'blocked') return 2;
  return 0;
}
function queueExitCode(result = {}) {
  if (result.status === 'held' || result.batchStopped === true) return 42;
  if (result.status === 'failed') return 2;
  return 0;
}
module.exports = { productionExitCode, queueExitCode };
