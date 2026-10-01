/**
 * **The two units the quota is counted in, and the wall between them.**
 *
 * Three prices, each set by something Greg said:
 *
 * - a currently-public article costs **half** what a private one does, because
 *   sharing is worth something to us and therefore worth something to the
 *   reader (Greg, 2026-09-04, docs/project/billing.md § *A public article counts
 *   half*);
 * - a paper added with only its title, authors and abstract read costs **a
 *   hundredth** of one —
 *
 *   > Let's say that papers for which we have done minimal AI processing (i.e.
 *   > you've uploaded but it's basically just extracted authors & abstract, or
 *   > something like that) cost 0.01x an AI-processed paper. So uploading 1000
 *   > papers with minimal AI-processing would use up 10 paper-slots.
 *   >
 *   > — Greg, 2026-10-01
 *
 *   (docs/project/billing.md § *A minimal paper costs a hundredth*);
 * - High-powered AI costs one more article's worth, half while public.
 *
 * Fractions do not go anywhere near money, so the arithmetic is done in
 * **points, 200 to an article**: a private ingest costs 200, a currently-public
 * one 100, a minimal paper 2, and a tier's budget is its article allowance times
 * 200. Greg's sentence needs a hundredth of a *private* article, which is why the
 * unit is 200 and not 100. `usageOf`'s `Number.isInteger` assertion — which
 * exists to stop a silent *"this account has used nothing"* — keeps working
 * untouched. That is the argument for points rather than fractions, and not a
 * stylistic preference. Until 2026-10-01 the unit was half-units, 2 to an
 * article; every rule below was written for those and survives as it was, at a
 * hundred times the scale.
 *
 * ## Why two branded types rather than one number and a comment
 *
 * `billing_accounts.quota_limit_delta` is **a signed count of whole ingests**:
 * Researcher's 150 with a stored delta of −117 means an allowance of 33.
 * Converting the tier *before* `limitForPeriod` turns that row into
 * `30000 − 117` points where the right answer is `(150 − 117) × 200` — a budget
 * of nearly a hundred and fifty articles for somebody entitled to thirty-three.
 * GPT Sol found the half-unit version in the design review, 2026-09-04, and
 * rated it the one that would have cost real money.
 *
 * So **every tier, delta, proration and clamp stays in article units**,
 * `limitForPeriod` is called unchanged, and `budgetFor` is applied only at the
 * admission/usage seam. Neither branded number is assignable to the other, so
 * that mistake is a compile error rather than a review comment. Both are still
 * assignable *to* `number`, which is deliberate: a count on its way to a sentence
 * or a log needs no ceremony, and the direction that costs money is the one the
 * brand blocks. **No stored delta is migrated**, then or now.
 *
 * ## Where the brand stops, said rather than implied
 *
 * `QuotaRules.allowanceFor`, `QuotaRules.maxAllowance` and `QuotaAdjustment.delta`
 * were plain `number` until 2026-09-05, so the sentence above was a description
 * of how the code happened to be written rather than something the compiler held
 * anybody to: either brand is assignable to `number`, so a count in the
 * enforcement unit could reach a delta or a clamp with no cast (GPT Sol). They
 * are `Articles` now, and the four places a plain number becomes one are named —
 * `allowanceForPrice` and `quotaRules` in ./tiers.ts, where a `billing_tiers` row
 * arrives, and the two reads of `billing_accounts.quota_limit_delta`, in
 * ./sync.ts and ../store/pg-billing.ts.
 *
 * **It stops at the wire and at the database, and that is deliberate.**
 * `ReaderPlan` and `AdminUser` carry plain numbers because src/billing-plan.ts
 * imports nothing at all — that is what lets the browser have it — and a drizzle
 * column is a `number` because the driver says so. Nothing downstream of either
 * does arithmetic that could confuse the units: the wire shapes are printed, and
 * the column is converted on the line it is read.
 *
 * ## Nothing here divides for display
 *
 * There is no rounding rule that makes a reader-facing count correct: with
 * public articles, `ceil(5/2)` says *"3 of 3 used"* while the wall still admits
 * one, and `floor` says *"2 of 3"* while two and a half are gone; a hundredth
 * is worse. So points are never divided for display. The marketed limit stays
 * in articles, the enforcement budget is a separately named field, and any
 * surface that must show usage is handed integer counts it can add up itself.
 * The two divisions in this file, `ingestHeadroom` and `minimalHeadroom`, are
 * **exact rather than rounded** — each counts the adds the wall would admit —
 * and say so at their own doc comments.
 *
 * ## The wall is the predicates below, and nothing else spells it
 *
 * Four questions, four functions, one module (GPT Sol's plan review, P1): the
 * pg-billing locked paths, `/profile`'s `atLimit`, the sharing offer, the
 * voucher and admin read-outs all ask these rather than comparing numbers of
 * their own. A comparison written out anywhere else is a second rule waiting to
 * disagree with the first — and every comparison left in half-units on
 * 2026-10-01 would have silently ignored minimal papers (Opus's review).
 */

declare const UNIT: unique symbol;

/**
 * A count of whole articles — what a tier sells, what a reader is shown, and
 * what `quota_limit_delta` adjusts.
 */
export type Articles = number & { readonly [UNIT]: "articles" };

/**
 * The enforcement currency. A private ingest costs {@link PRIVATE_INGEST_COST},
 * a currently-public one {@link PUBLIC_INGEST_COST}, a minimal paper
 * {@link MINIMAL_COST}, and a budget is {@link budgetFor} of an article
 * allowance.
 */
export type Points = number & { readonly [UNIT]: "points" };

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

/** The same, for a number already counted in points. */
export function points(n: number): Points {
  return n as Points;
}

/**
 * **What an ingest reservation costs**, and it is full price on purpose.
 *
 * Nobody knows yet whether the article a job is about to produce will be shared,
 * so an in-flight ingest is charged as private. It fails safe: the cheaper guess
 * would let a burst of twenty concurrent adds through a budget that only fits ten.
 * The row becomes cheap the moment the article it produced is made public, which
 * is the same live recomputation everything else here does.
 */
export const PRIVATE_INGEST_COST: Points = 200 as Points;

/** What a charged ingest costs while the article it produced is public. */
export const PUBLIC_INGEST_COST: Points = 100 as Points;

/**
 * **What a minimal paper costs: a hundredth of a private article, always.**
 *
 * Never priced by visibility. A minimal article cannot be shared, so its row is
 * never public; the delete trigger freezes it `'private'`; and once *Read this*
 * has paid for the paper in full the row is superseded and costs nothing
 * (`ingest_events.superseded_by`). In flight it costs the same 2.
 */
export const MINIMAL_COST: Points = 2 as Points;

/**
 * **The one overdraft the ingest wall admits: half an article, once.**
 *
 * The ingest wall was `used < budget` in half-units, which a private add at two
 * could overshoot by one — five-of-six admits an ingest that settles at seven.
 * The money-safe rule would make Greg's own sentence false (*"free users can
 * make 6 Public articles"*), so the overdraft was taken knowingly
 * (docs/project/billing.md § *A public article counts half*). Multiplied out
 * into points it is this constant, and {@link admitsIngest} is the same rule.
 */
export const INGEST_OVERDRAFT: Points = PUBLIC_INGEST_COST;

/**
 * The enforcement budget for an article allowance.
 *
 * **Called at the admission and usage seam only.** Everything upstream of it —
 * the tier row, `limitForPeriod`, the stored delta, the clamp — is in articles.
 * See the header for the row that makes that ordering worth £-something.
 */
export function budgetFor(limit: Articles): Points {
  return (limit * PRIVATE_INGEST_COST) as Points;
}

/* ------------------------------------------------------------ the wall --- */

/**
 * **May an ordinary article be added?** A URL, a single upload, a retry of
 * either: `used + 200 <= budget + 100`.
 *
 * Today's `used < budget` in half-units, multiplied out. With `used` a multiple
 * of 100 — every account before minimal papers existed — the two are exactly
 * the same rule, which `tests/billing-points.test.ts` checks over a range. With
 * minimal papers in `used` the old spelling would be wrong: at `budget − 98` it
 * admits a private add that settles at `budget + 102`, past the one half-article
 * of overdraft (GPT Sol's plan review, P1).
 */
export function admitsIngest(used: Points, budget: Points): boolean {
  return used + PRIVATE_INGEST_COST <= budget + INGEST_OVERDRAFT;
}

/**
 * **What *Read this* on a minimal paper is credited**: that paper's own 2
 * points, when its minimal row is charged inside the window `used` counts and
 * not yet superseded — otherwise nothing. Never a constant (Opus's review): a
 * paper added last month on a paid plan is not in this month's `used`, so
 * crediting it would be crediting something not charged.
 */
export type UpgradeCredit = 0 | 2;

/** The credit a paper whose minimal row counts is given — its own {@link MINIMAL_COST}. */
export const MINIMAL_CREDIT: UpgradeCredit = 2;

/**
 * **May *Read this* run on a minimal paper?** The ingest wall, crediting what
 * the paper already paid: `used + (200 − credit) <= budget + 100`.
 *
 * The 198 appears only here. The charge itself is an ordinary ingest row, and
 * the publication that settles it supersedes the minimal row, so the paper
 * totals exactly one ingest.
 */
export function admitsUpgrade(used: Points, budget: Points, credit: UpgradeCredit): boolean {
  if (credit !== 0 && credit !== MINIMAL_CREDIT) {
    /* The type says this cannot happen; a number from a query could. */
    throw new Error(`an upgrade credit of ${String(credit)} points is not one a paper can have`);
  }
  return used + (PRIVATE_INGEST_COST - credit) <= budget + INGEST_OVERDRAFT;
}

/**
 * **May a minimal paper be added?** It must fit whole: `used + 2 <= budget`.
 *
 * No overdraft, like High-powered AI. The overdraft exists for one sentence
 * about public articles; a batch of a thousand papers must never step past the
 * wall, one paper at a time.
 */
export function admitsMinimal(used: Points, budget: Points): boolean {
  return used + MINIMAL_COST <= budget;
}

/**
 * **May High-powered AI be switched on?** It must fit whole:
 * `used + cost <= budget`, where `cost` is an ingest of the same article —
 * {@link PRIVATE_INGEST_COST} or {@link PUBLIC_INGEST_COST}.
 */
export function admitsHighPower(used: Points, budget: Points, cost: Points): boolean {
  return used + cost <= budget;
}

/**
 * **How many more private articles this account can still add** — exact, not
 * rounded: `max(0, floor((budget + 100 − used) / 200))`.
 *
 * The admitted adds from `u` are the `k ≥ 0` with `u + 200(k + 1) <= budget +
 * 100`, which is that floor. Worked through at a free budget of 600: from 0 it
 * is 3, from 400 it is 1, and from 500 it is 1 — the last being the
 * knowingly-accepted overdraft, where the add is admitted and settles at 700.
 *
 * So this divides, and the header says points are never divided for display.
 * The rule it does not break is the one behind that sentence: this is not a
 * rounding of a ratio into a prettier number, it is the wall's own answer to a
 * different question, and `tests/billing-points.test.ts` checks it against
 * {@link admitsIngest} rather than against arithmetic.
 */
export function ingestHeadroom(used: Points, budget: Points): Articles {
  return Math.max(0, Math.floor((budget + INGEST_OVERDRAFT - used) / PRIVATE_INGEST_COST)) as Articles;
}

/**
 * **How many more minimal papers this account can still add** — exact, not
 * rounded: `max(0, floor((budget − used) / 2))`. What the refusal for a batch
 * says (`minimalQuotaReached` in src/messages.ts). A count of papers, not of
 * articles, so it is a plain number.
 */
export function minimalHeadroom(used: Points, budget: Points): number {
  return Math.max(0, Math.floor((budget - used) / MINIMAL_COST));
}
