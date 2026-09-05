/**
 * **Run a CLI command with the ledger open**, so that a paid command line is
 * money that appears in `npm run cost` rather than money that vanishes.
 *
 * One line at each CLI's `isMain`, rather than a `collectSpend` folded into
 * bespoke `main()` bodies. Leaving CLI calls unscoped is why `recordSpend`
 * warns about them, and a warning on every local run is a warning nobody reads.
 *
 * **There is one caller left, and that is the point of the file rather than a
 * sign it is dying.** The stage CLIs went through the queue on 2026-09-05
 * (`scripts/stage.ts`), where `runStep` opens a `scopeKind: "job_step"`
 * collector per step — so a stage run from a terminal is scoped by the same
 * mechanism that scopes it when a reader presses Add, and a CLI that *also*
 * wrapped the run in `withLedger("cli", …)` would scope one purchase twice.
 * What is left is `npm run eval:pdf-read`, which is not a stage runner at all
 * but the PDF extraction-quality tool, and which spends per chunk.
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
import { loadEnvLocal } from "./env.js";
import { isMain } from "./is-main.js";
import { environmentOwnerId } from "./owner.js";
import { costStore } from "./store/ai-calls.js";

/**
 * **The whole tail of a paid stage CLI, in one line.**
 *
 * ```ts
 * await stageCli(import.meta.url, main);
 * ```
 *
 * Three things had to be remembered separately, and the two that were forgotten
 * cost money: the entrypoint guard, `withLedger("cli", …)` around it, and
 * `loadEnvLocal()` before it. `npm run labels` and `npm run pdf` (now
 * `npm run eval:pdf-read`) each spent for
 * weeks with no ledger open — docs/plans/260828aj-simplification-wave-2.md §0.1 — and
 * `npm run pdf` also answered *"OPENROUTER_API_KEY is not set"* with the key
 * sitting unread in `.env.local`. Every one of those is a line somebody did not
 * copy off the stage next door. Folded in here they are not a thing to remember.
 *
 * ## Order, and why it is this order
 *
 * The guard first, so nothing below runs when the module is merely imported —
 * that is why `loadEnvLocal()` being in here is not the thing the note in
 * `src/ideas.ts` refuses. It refuses reading `.env.local` on *import*, which
 * would be a no-op under the dev server (`vite.config.ts` has already done it)
 * and would pull `node:fs` into a path with no use for it. This call is inside
 * the guard, so an imported module never reaches it.
 *
 * Then the environment, **then** the ledger — because the failure the Tier 1
 * review found is a `loadEnvLocal()` that runs after the spending has started,
 * which reads as correct and is useless. Here there is no ordering to get
 * wrong.
 *
 * The CLIs in `tests/paid-cli-ledger.test.ts` still call `loadEnvLocal()` at the
 * top of `main` themselves, and that gate still requires it. The call memoises,
 * so the second one does nothing.
 *
 * **This paragraph used to end *"when `src/hierarchy.ts` moves too, the
 * in-`main` calls and the rule that checks for them can go"*. It moved, on
 * 2026-09-05, and they stayed** — deliberately. The rule is stated over
 * `PAID_CLIS`, not over `stageCli`, so it covers the *next* CLI on the day
 * somebody lists it rather than on the day somebody remembers this note. The
 * cost of keeping it is one memoised call.
 *
 * **There is one of them now, and there were eight.** The seven article-reading
 * stage CLIs — `arc`, `tweets`, `glossary`, `ideas`, `quotes`, `timeline`,
 * `quiz` — were deleted on 2026-09-01: re-running one stage against one article
 * is a job (`{ slug, steps, force }`), and a second way to do it was a second
 * thing to keep in step. docs/plans/260831b-finish-the-database-move.md §
 * sub-stage I. `hierarchy` and `labels` followed on 2026-09-05, by the two
 * routes described above.
 *
 * `await`ed by the caller rather than `void`ed, so flushing the ledger and any
 * failure in it stay part of the command finishing (§0.1).
 *
 * @param entry the calling module's `import.meta.url`
 * @param main  the CLI's entry function, run only if this module is the entry file
 */
export async function stageCli(entry: string, main: () => Promise<void>): Promise<void> {
  if (!isMain(entry)) return;
  loadEnvLocal();
  await withLedger("cli", main);
}

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
