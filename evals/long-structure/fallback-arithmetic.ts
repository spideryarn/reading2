/**
 * How often a long document is left with the plain headings tree, before and
 * after plan 261005j § Stage 1a, **as arithmetic about assumptions and not as
 * a measurement**. No failure rate has been measured: the slices path has no
 * recorded failure to count (the plan's § What was measured before designing).
 * Free; it calls nothing.
 *
 *   npx tsx evals/long-structure/fallback-arithmetic.ts
 *
 * The assumptions, all of them generous to the arithmetic and none checked:
 *
 * - **Independence.** Every question fails with the same probability `p`,
 *   whatever the others did and whatever it did when asked before. Real
 *   failures cluster (a provider's bad minute, one slice no answer fits), so
 *   the "after" column is neither an estimate nor a bound on the real rate.
 * - `p` is the chance one question fails **after** the re-ask its answer
 *   already gets when it does not pass (src/structure-slices.ts § `ask`).
 * - Before 1a, the document is plain if any of its `n` slices or its one root
 *   call fails: 1 - (1 - p)^(n + 1).
 * - After 1a, a slice is lost only if it fails in both passes, taken as p * p;
 *   the root call is asked as before. 1 - (1 - p^2)^n * (1 - p). The second
 *   pass asks once, without the re-ask, so its effective rate may differ from
 *   `p`. Using the same rate for both is an additional simplifying assumption;
 *   halving and refills no longer counting are also left out.
 * - Running out of time, a joined tree that will not build, and a section the
 *   labels step cannot ask about are not modelled. Stage 1a changes none of
 *   them.
 */
const RATES = [0.01, 0.03, 0.1];
const SLICES = [4, 8, 20, 45];

const today = (p: number, n: number): number => 1 - (1 - p) ** (n + 1);
const slicesOnly = (p: number, n: number): number => 1 - (1 - p * p) ** n * (1 - p);
/* With the root asked for once more too (2026-10-06): every question gets two tries. */
const after = (p: number, n: number): number => 1 - (1 - p * p) ** (n + 1);
const percent = (x: number): string => `${(100 * x).toFixed(1)}%`;

console.log("Share of long documents left wholly plain: before -> slices asked twice -> the root too.");
console.log("Arithmetic about assumptions, not a measurement. Each slice pass and the root");
console.log("question are assumed to fail independently with the same probability.\n");
console.log(`| assumed per-pass failure | ${SLICES.map((n) => `${n} slices`).join(" | ")} |`);
console.log(`|---|${SLICES.map(() => "---").join("|")}|`);
for (const p of RATES) {
  console.log(`| ${percent(p)} | ${SLICES.map((n) => `${percent(today(p, n))} -> ${percent(slicesOnly(p, n))} -> ${percent(after(p, n))}`).join(" | ")} |`);
}
console.log("\nWithin this model, the root failure rate was a floor on the second figure; it is not on the third.");
