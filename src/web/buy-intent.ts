/**
 * Which plan the reader pressed before we asked them to sign in.
 *
 * A stranger on `/pricing` presses *Get Reader*, signs in with Google, comes
 * back — and the button they pressed has to still mean something, or the whole
 * point of putting a button on the pricing page is lost. This is the one fact
 * that has to survive that round trip.
 *
 * ## Not in the URL, and that is a security decision rather than a tidiness one
 *
 * The first draft of the plan carried it as `/pricing?buy=reader`, and the GPT
 * Sol review (docs/plans/260904b-pricing-page-and-public-showcase-review-sol.md)
 * found two separate faults with that:
 *
 * - **It would not have worked.** `SignInControls` calls
 *   `rememberReturn(location.pathname + location.search)` immediately before
 *   OAuth (SignInControls.tsx), so a sign-in that happens anywhere other than
 *   `/pricing` overwrites the destination with its own address. The mechanism
 *   that replaces it is not this file at all: the pricing page carries its own
 *   sign-in panel, so the reader signs in **on `/pricing`** and the existing
 *   `remember()` captures it, with no second OAuth path.
 * - **A query parameter is not consent.** `/pricing?buy=researcher`, pasted or
 *   sent by somebody else, would have been enough to make an authenticated
 *   browser POST `/api/billing/checkout`, create or reuse a Stripe customer,
 *   open a Checkout Session and navigate off our origin — an external state
 *   change triggered by a GET-shaped address. It cannot charge by itself, and
 *   it is still not a thing an address should be able to do.
 *
 * So the tier rides beside the destination in `sessionStorage`, which is
 * tab-scoped and dies with the tab, and it is written **only** by a press of a
 * button on our own page.
 *
 * ## The same three rules as auth-return.ts
 *
 * Deliberately a separate key rather than a field on `spideryarn:auth-return`:
 * the two have different lifetimes and different readers, and a destination that
 * quietly grew a side effect is exactly the shape of thing nobody re-reads.
 * Everything else is copied from it on purpose —
 *
 * 1. **Every access is wrapped**, because `sessionStorage` throws outright in
 *    some privacy modes rather than answering null. A thrown exception here
 *    would take the pricing page down for the reader least able to work around
 *    it.
 * 2. **It expires.** A tier chosen an hour ago in a tab left open is not what
 *    this reader is doing now.
 * 3. **Read-and-delete, in one breath.** This is the load-bearing one. The
 *    marker is consumed *before* the checkout POST is sent, so a React
 *    `<StrictMode>` double mount, a real remount, and pressing Back from
 *    Stripe all find nothing and post nothing. A read-then-delete-on-success
 *    would buy a second Checkout Session for anybody who bounced.
 *
 * ## What consuming on mount does **not** give you
 *
 * It is once-per-mount-per-tab, and that is not exact-once. Two known gaps,
 * both from the GPT Sol review of 2026-09-04
 * (docs/plans/260904b-stage1-code-review-sol.md, finding 4), both left standing
 * on purpose — the next reader should not think this is stronger than it is:
 *
 * - **A remount between the read and the summary landing loses a valid
 *   purchase.** The marker is gone and the only remaining copy is a ref in the
 *   component, so a reload — or an A→B account switch, which re-keys the page —
 *   drops it. The reader lands on `/pricing` with the cards in front of them and
 *   presses the button again. That is the cost of consuming early, and it is the
 *   right way round: a lost press costs one click, a duplicated one costs money.
 * - **Two tabs are each once-safe, which is twice.** Two markers — two presses,
 *   or a tab duplicated after storage was written — can produce two Checkout
 *   Sessions, and the server permits that deliberately (src/billing/checkout.ts).
 *
 * Closing either needs an idempotency mechanism — a key minted with the intent
 * and honoured by the checkout route — and we are not building one for a flow
 * whose worst case is a reader who paid twice getting a refund. Written down
 * rather than fixed.
 */

/** `sessionStorage` throws outright in some privacy modes. Never take the page down for this. */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const KEY = "spideryarn:buy-intent";

/**
 * Long enough for Google's consent screen and an account chooser, short enough
 * that a tab left open over lunch does not open Stripe when it is touched.
 * `auth-return.ts` picked ten minutes for the same round trip; this rides in the
 * same one, so it expires with it rather than on a number of its own.
 */
const TTL_MS = 10 * 60 * 1000;

/**
 * A plan somebody pressed, and when they pressed it.
 *
 * **The time comes back with the tier**, since 2026-09-04, and it is not
 * bookkeeping: `takeBuyIntent` runs on mount and the POST it feeds happens
 * whenever `/api/billing/usage` answers, which is a gap of unbounded length. GPT
 * Sol held that read pending for eleven minutes, resolved it, and watched an
 * expired intent open Stripe. Age checked at the read alone is age unchecked.
 */
export interface BuyIntent {
  readonly tierId: string;
  /** `Date.now()` at the press. Re-checked with `buyIntentIsFresh` before use. */
  readonly createdAt: number;
}

/** Remember which plan was pressed, on the way out to the sign-in panel. */
export function rememberBuyIntent(tierId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ tierId, createdAt: Date.now() }));
  } catch {
    /* Quota, or a mode that allows reads and refuses writes. The cost is that
       the reader lands back on `/pricing` and presses the button again, with
       the cards in front of them — which is a worse afternoon than a thrown
       exception is, for nobody. */
  }
}

/**
 * Is this intent still young enough to act on?
 *
 * Asked **again**, immediately before the POST — `takeBuyIntent` has already
 * refused an intent that was stale when it was read, and this is the same
 * question at the only moment that decides anything. Exported rather than folded
 * into the caller so that one file owns the window.
 */
export function buyIntentIsFresh(intent: BuyIntent, now = Date.now()): boolean {
  return now - intent.createdAt <= TTL_MS;
}

/**
 * The plan they pressed, **and forget it in the same breath**.
 *
 * `null` when there is nothing, when it is too old, or when the stored value is
 * not the shape this file wrote. The caller still has to decide whether the
 * reader may buy that tier at all — this says only what was asked for, never
 * that it is allowed, and never that it is *still* current: see PricingPage.tsx,
 * which checks `buyIntentIsFresh` again alongside `summary.purchase` — the same
 * list the cards are drawn from, so a marker cannot buy something the page would
 * not have offered — before anything is posted.
 */
export function takeBuyIntent(): BuyIntent | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(KEY);
    /* Removed whether or not it parses, and before anybody looks at it: a value
       that survives one read is a value that opens Stripe on the next one. */
    store.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const { tierId, createdAt } = JSON.parse(raw) as { tierId?: unknown; createdAt?: unknown };
    if (typeof tierId !== "string" || tierId === "") return null;
    if (typeof createdAt !== "number") return null;
    const intent: BuyIntent = { tierId, createdAt };
    /* Already too old to have been worth reading. The caller asks the same
       question again when it is about to act on it. */
    if (!buyIntentIsFresh(intent)) return null;
    return intent;
  } catch {
    return null;
  }
}
