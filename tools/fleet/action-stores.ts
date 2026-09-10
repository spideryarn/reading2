/**
 * The public composition boundary for the fleet dashboard's action stores.
 *
 * `quarantine.ts` owns the existing process-wide book that every send producer
 * already reaches. The implementation stays beside that singleton so the
 * legacy `openSharedQuarantine()` can use exactly the same state without an
 * import cycle; new callers come through this deliberately broader name.
 *
 * docs/plans/260910d § The stores, and who owns them.
 */
export {
  openFleetActionStores,
  resetFleetActionStoresForTests,
  sharedReceiptJournal,
  type FleetActionStores,
  type OpenFleetActionStoresOptions,
} from "./quarantine.js";
