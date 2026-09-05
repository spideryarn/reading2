/**
 * **The two units the quota is counted in, and the wall between them.**
 *
 * A currently-public article costs **half** what a private one does, because
 * sharing is worth something to us and therefore worth something to the reader
 * (Greg, 2026-09-04, docs/project/billing.md § *A public article counts half*).
 * Halves do not go anywhere near money, so the arithmetic is done in **half-units**:
 * a private ingest costs 2, a currently-public one costs 1, and a tier's budget is
 * its article allowance doubled. `usageOf`'s `Number.isInteger` assertion — which
 * exists to stop a silent *"this account has used nothing"* — keeps working
 * untouched. That is the argument for half-units rather than fractions, and not a
 * stylistic preference.
 *
 * ## Why two branded types rather than one number and a comment
 *
 * `billing_accounts.quota_limit_delta` is **a signed count of whole ingests**:
 * Researcher's 150 with a stored delta of −117 means an allowance of 33. Doubling
 * the tier *before* `limitForPeriod` turns that row into `300 − 117 = 183`
 * half-units where the right answer is `(150 − 117) × 2 = 66` — a budget of
 * ninety-one articles for somebody entitled to thirty-three. GPT Sol found it in
 * the design review, 2026-09-04, and rated it the one that would have cost real
 * money.
 *
 * So **every tier, delta, proration and clamp stays in article units**,
 * `limitForPeriod` is called unchanged, and `budgetFor` is applied only at the
 * admission/usage seam. Neither branded number is assignable to the other, so
 * that mistake is a compile error rather than a review comment. Both are still
 * assignable *to* `number`, which is deliberate: a count on its way to a sentence
 * or a log needs no ceremony, and the direction that costs money is the one the
 * brand blocks. **No stored delta is migrated.**
 *
 * ## Where the brand stops, said rather than implied
 *
 * `QuotaRules.allowanceFor`, `QuotaRules.maxAllowance` and `QuotaAdjustment.delta`
 * were plain `number` until 2026-09-05, so the sentence above was a description
 * of how the code happened to be written rather than something the compiler held
 * anybody to: either brand is assignable to `number`, so a `HalfUnits` could
 * reach a delta or a clamp with no cast (GPT Sol). They are `Articles` now, and
 * the four places a plain number becomes one are named — `allowanceForPrice` and
 * `quotaRules` in ./tiers.ts, where a `billing_tiers` row arrives, and the two
 * reads of `billing_accounts.quota_limit_delta`, in ./sync.ts and
 * ../store/pg-billing.ts.
 *
 * **It stops at the wire and at the database, and that is deliberate.**
 * `ReaderPlan` and `AdminUser` carry plain numbers because src/billing-plan.ts
 * imports nothing at all — that is what lets the browser have it — and a drizzle
 * column is a `number` because the driver says so. Nothing downstream of either
 * does arithmetic that could confuse the units: the wire shapes are printed, and
 * the column is converted on the line it is read.
 *
 * ## Nothing here divides
 *
 * There is no rounding rule that makes a reader-facing count correct: `ceil(5/2)`
 * says *"3 of 3 used"* while the wall still admits one, and `floor` says
 * *"2 of 3"* while two and a half are gone. So half-units are never divided for
 * display. The marketed limit stays in articles, the enforcement budget is a
 * separately named field, and any surface that must show usage is handed integer
 * counts it can add up itself. The one division in this file, `privateHeadroom`,
 * is **exact rather than rounded** and says so at its own doc comment.
 */

declare const UNIT: unique symbol;

/**
 * A count of whole articles — what a tier sells, what a reader is shown, and
 * what `quota_limit_delta` adjusts.
 */
export type Articles = number & { readonly [UNIT]: "articles" };

/**
 * The enforcement currency. A private ingest costs {@link PRIVATE_INGEST_COST},
 * a currently-public one {@link PUBLIC_INGEST_COST}, and a budget is
 * {@link budgetFor} of an article allowance.
 */
export type HalfUnits = number & { readonly [UNIT]: "half-units" };

/**
 * Label a plain number as a count of articles.
 *
 * At the boundaries where one arrives untyped — a `billing_tiers` row, a wire
 * field, a test fixture — and nowhere else. A cast that is easy to write is a
 * cast somebody writes in the middle of the arithmetic, which is what the brand
 * is here to stop, so this is the only one and it has a name you can grep for.
 */
export function articles(n: number): Articles {
  return n as Articles;
}

/** The same, for a number already counted in half-units. */
export function halfUnits(n: number): HalfUnits {
  return n as HalfUnits;
}

/**
 * **What a reservation costs**, and it is full price on purpose.
 *
 * Nobody knows yet whether the article a job is about to produce will be shared,
 * so an in-flight ingest is charged as private. It fails safe: the cheaper guess
 * would let a burst of twenty concurrent adds through a budget that only fits ten.
 * The row becomes cheap the moment the article it produced is made public, which
 * is the same live recomputation everything else here does.
 */
export const PRIVATE_INGEST_COST: HalfUnits = 2 as HalfUnits;

/** What a charged ingest costs while the article it produced is public. */
export const PUBLIC_INGEST_COST: HalfUnits = 1 as HalfUnits;

/**
 * The enforcement budget for an article allowance.
 *
 * **Called at the admission and usage seam only.** Everything upstream of it —
 * the tier row, `limitForPeriod`, the stored delta, the clamp — is in articles.
 * See the header for the row that makes that ordering worth £-something.
 */
export function budgetFor(limit: Articles): HalfUnits {
  return (limit * PRIVATE_INGEST_COST) as HalfUnits;
}

/**
 * **How many more private articles this account can still add** — exact, not
 * rounded.
 *
 * The wall is `used < budget` (see `refusalFor` in src/store/pg-billing.ts), and
 * a private add costs 2, so the admitted adds from `u` are the `k ≥ 0` with
 * `u + 2k < budget`, of which there are `ceil((budget − u) / 2)`. Worked through
 * at a budget of 6: from 0 that is 3, from 4 it is 1, and from 5 it is 1 — the
 * last being the knowingly-accepted half-unit overdraft, where the sixth add is
 * admitted and settles at seven.
 *
 * So this divides, and the header says half-units are never divided for display.
 * The rule it does not break is the one behind that sentence: this is not a
 * rounding of a ratio into a prettier number, it is the wall's own answer to a
 * different question, and `tests/billing-half-units.test.ts` checks it against the
 * wall rather than against arithmetic.
 */
export function privateHeadroom(used: HalfUnits, budget: HalfUnits): Articles {
  if (used >= budget) return 0 as Articles;
  return Math.ceil((budget - used) / PRIVATE_INGEST_COST) as Articles;
}
