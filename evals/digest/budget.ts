import { type Budget, BudgetHalted, BudgetRefused, paidStep } from "../dig-deeper/budget.js";

/* Only reservations made by this process can settle while we wait. */
const active = new WeakMap<Budget, Set<string>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reserve the call's worst case before it is dispatched. If the cap has no
 * room while other calls are in flight, wait for them to settle; if it has no
 * room with nothing in flight, that is the hard stop.
 */
export async function withReservation<T>(
  budget: Budget,
  step: { id: string; label: string; boundUsd: number },
  ledger: Parameters<typeof paidStep>[2],
  fn: () => Promise<T>,
) {
  let live = active.get(budget);
  if (!live) {
    live = new Set();
    active.set(budget, live);
  }
  for (;;) {
    const s = budget.state();
    if (s.halted) throw new BudgetHalted(`the run is halted: ${s.halted}`);
    const abandoned = Object.keys(s.reserved).filter((id) => !live.has(id));
    if (abandoned.length) throw new BudgetRefused(`unsettled reservations from an earlier process: ${abandoned.join(", ")}; inspect budget.json before resuming`);
    const outstanding = Object.values(s.reserved).reduce((n, r) => n + r.usd, 0);
    if (s.spentUsd + outstanding + step.boundUsd <= budget.cap) {
      /* `paidStep` reserves synchronously, before its first await — so nothing
         can slip in between this check and the reservation. */
      live.add(step.id);
      try {
        return await paidStep(budget, step, ledger, fn);
      } finally {
        live.delete(step.id);
      }
    }
    if (outstanding === 0) {
      throw new BudgetRefused(
        `HARD STOP before ${step.label}: $${s.spentUsd.toFixed(4)} spent + its worst case ` +
          `$${step.boundUsd.toFixed(4)} would pass the $${budget.cap.toFixed(2)} cap`,
      );
    }
    await sleep(2000);
  }
}

/** Keep the budget lock until every dispatched worker has settled, even on failure. */
export async function drain<T>(work: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(work);
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return results.map((r) => (r as PromiseFulfilledResult<T>).value);
}
