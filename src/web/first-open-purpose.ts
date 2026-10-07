/**
 * **One owner for the first open of an article the add page marked** — plan
 * 261007j § After the plan review, F4, and since 2026-10-07 plan 261007p.
 *
 * Two things decide a first open. `useLastView` (last-view.ts § The
 * first-open default) replaces a bare address with the default, and
 * `PurposePrompt` shows its modal once the purpose read answers, if the add
 * page left its mark (ask-purpose.ts) and no reason is stored. Where a band
 * fits, the default is the guide, whose greeting holds the same box, so the
 * modal must not also appear; where none fits, the modal is the only place to
 * ask. That is the decision this module makes, whichever half lands first:
 *
 * | the purpose read         | a band fits      | no band (a phone) |
 * |--------------------------|------------------|-------------------|
 * | a reason is stored       | the guide        | the article alone |
 * | definitively none        | the guide        | the modal         |
 * | failed / purposeFailed   | the guide        | the article alone |
 *
 * **Where the reader lands no longer waits for the purpose read** (plan
 * 261007p: the guide is every first open's default, not only a reasonless
 * one's), so a held arrival is applied the moment `useLastView` can apply it.
 * It is still held, rather than handed to the ordinary path, for one reason
 * (GPT Sol's F4 on 261007p): the ordinary path waits for the settings store,
 * and a settings read that fails or serves an offline copy would then leave
 * the modal suppressed and the guide never opened.
 *
 * **A failed read keeps the mark and decides nothing about the question**:
 * `PurposePrompt` leaves the mark for the next load — which is not a first
 * open, so a retry that finds no reason asks with the modal, as it always did.
 *
 * **Only a claimed first open is held.** A link that says anything is left as
 * sent (`claimFirstOpen`), so nothing is held, and the mark's question is the
 * modal as before. The guide replaces the modal only where the default put
 * the guide on screen.
 *
 * **Nothing is sent.** The guide is opened by `?mode=chat&guide=1`, which Chat's
 * band turns into the stored guide or one new conversation (params.ts §
 * `guideParam`); its greeting is drawn, not asked for.
 *
 * Module state rather than context, because the two halves live on either
 * side of the auth branches: `useLastView` in `App`, `PurposePrompt` inside
 * `OwnedReader`. There is one article on screen per tab, so one hold.
 */

/** What the owner's purpose read said. `unknown` is a failed read, an unreadable shelf, or no owner's read at all. */
export type PurposeOutcome = "stored" | "none" | "unknown";

/** The guide on a first open: Chat's band, opened on the guide (last-view.ts § `firstOpenSearch` adds the notes). */
export const GUIDE_FIRST_OPEN = "?mode=chat&guide=1";

/**
 * **The decision, pure.** `ordinary` is what `firstOpenSearch` gave for this
 * window — the guide, or `""` where a band would cover the prose. Where the
 * reader lands is `ordinary` whatever the read said; the read decides only
 * the modal, which asks where there is no guide on screen to ask instead.
 */
export function firstOpenWithPurpose(ordinary: string, outcome: PurposeOutcome): { search: string; modal: boolean } {
  return { search: ordinary, modal: ordinary === "" && outcome === "none" };
}

type Hold = {
  slug: string;
  readerId: string | null;
  /** `firstOpenSearch`, measured once when the first open was claimed. */
  ordinary: string;
  /** The first answer from the purpose read; later ones are the same decision repeated (StrictMode). Decides only the modal. */
  outcome: PurposeOutcome | null;
  /** Set once `useLastView` can apply this arrival: puts a search on the address, if it still says nothing. */
  apply: ((search: string) => void) | null;
  applied: boolean;
};

let hold: Hold | null = null;

/* Where the reader lands does not depend on the read (`firstOpenWithPurpose`),
   so a held arrival is applied as soon as it can be, answered or not. */
function run(h: Hold): void {
  if (h.applied || h.apply === null) return;
  h.applied = true;
  h.apply(h.ordinary);
}

/**
 * **`useLastView`, on every arrival**: hold this first open (its claim, and
 * the add page's mark for this slug, both present), or drop whatever was held
 * for an earlier arrival. Called on each arrival so a hold never outlives the
 * visit it was made for.
 */
export function holdFirstOpen(next: { slug: string; readerId: string | null; ordinary: string } | null): void {
  hold = next === null ? null : { ...next, outcome: null, apply: null, applied: false };
}

/** Whether this slug and reader have the marked first-open decision, independent of settings readiness. */
export function firstOpenHeld(slug: string, readerId: string | null): boolean {
  return hold !== null && hold.slug === slug && hold.readerId === readerId;
}

/**
 * **`useLastView`, once this arrival can be applied**, in place of applying
 * the ordinary default itself. A held arrival registers immediately so an
 * unrelated settings failure cannot strand it, and is applied then.
 */
export function releaseWhenDecided(slug: string, readerId: string | null, apply: (search: string) => void): void {
  if (!firstOpenHeld(slug, readerId) || hold === null) return;
  hold.apply = apply;
  run(hold);
}

/**
 * **`PurposePrompt`, once the purpose read has answered** (and the visitor's
 * view, with `unknown`, so a stale mark cannot hold a stranger's default).
 * The reader id is the one that component was mounted for, so an old request
 * cannot settle a same-slug hold made after an account change.
 * Returns whether to show the modal. With nothing held for this slug — a link
 * that carried state, a later load — the answer is today's: ask when there is
 * definitively no reason. Idempotent: a second call gives the first answer.
 */
export function settleFirstOpen(
  slug: string,
  readerId: string | null,
  outcome: PurposeOutcome,
): { modal: boolean } {
  /* A hold for somebody else is proof this is a late answer from an arrival
     that has already gone. It must neither release the current reader's
     default nor put the old reader's modal over their page. With no hold at
     all, this is an ordinary later/link visit and the modal keeps its old
     behavior. */
  if (hold !== null && (hold.slug !== slug || hold.readerId !== readerId)) return { modal: false };
  if (hold === null) return { modal: outcome === "none" };
  hold.outcome ??= outcome;
  const decided = firstOpenWithPurpose(hold.ordinary, hold.outcome);
  run(hold);
  return { modal: decided.modal };
}
