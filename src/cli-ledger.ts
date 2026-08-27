/**
 * **Run a CLI command with the ledger open**, so that `npm run toc` is money
 * that appears in `npm run cost` rather than money that vanishes.
 *
 * One line at each stage's `isMain`, rather than a `collectSpend` folded into
 * seven bespoke `main()` bodies. Leaving CLI calls unscoped is why `recordSpend`
 * warns about them, and a warning on every local run is a warning nobody reads.
 *
 * ## This did not work until the store stopped dragging the read layer in
 *
 * A stage importing [`src/store/ai-calls.ts`](store/ai-calls.ts) used to reach
 * `store/pg.ts` → `api.ts` → `glossary.ts` → `arc.ts`, which is a stage: an
 * import cycle, and `npm run cycles` is a **gate** rather than advice. It bit
 * three of the seven stages and not the other four, which is worse than either.
 * The whole edge was one symbol — `ownedSlug` — and moving it to
 * [`store/owned-slug.ts`](store/owned-slug.ts) removed it. Written down because
 * the first attempt at this file was deleted rather than fixed, and the fix
 * turned out to be four lines.
 *
 * `environmentOwnerId()`, not `currentOwnerId()`: there is no reader here, and
 * the environment's owner is the only answer there is (src/owner.ts).
 *
 * The total goes to `console.log`, because this is the CLI — the rule in
 * docs/project/logging.md is the destination, not the function name.
 */

import { collectSpend, formatNanos, totalSpend } from "./ai-spend.js";
import { environmentOwnerId } from "./owner.js";
import { costStore } from "./store/ai-calls.js";

export async function withLedger(
  scopeKind: "cli" | "eval",
  fn: () => Promise<void>,
): Promise<void> {
  const { report } = await collectSpend(fn, {
    attribution: { scopeKind, ownerId: environmentOwnerId() },
    sink: (row) => costStore.record(row),
  });
  if (report.calls.length === 0) return;
  const { nanos, unpriced } = totalSpend(report.calls);
  console.log(
    `\nSpent: ${formatNanos(nanos)} over ${report.calls.length} model call(s)` +
      (unpriced > 0 ? ` — ${unpriced} reported no cost` : "") +
      (report.writeFailures > 0
        ? ` — ${report.writeFailures} could not be written down`
        : "") +
      `\n       recorded in ${costStore.describe()}`,
  );
}
