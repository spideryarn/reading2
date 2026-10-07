/**
 * **One owner for the first open of an article the add page marked** — plan
 * 261007j § After the plan review, F4.
 *
 * Two things used to decide a first open independently. `useLastView`
 * (last-view.ts § The first-open default) replaced a bare address with
 * Summary as soon as the settings store answered, and `PurposePrompt` showed
 * its modal once the purpose read answered, if the add page had left its mark
 * (ask-purpose.ts) and no reason was stored. The guide changes that: where a
 * band fits beside the text, a reader with no reason should arrive in the
 * guide, whose greeting holds the same box, rather than at a modal over
 * Summary. Which of the two wins cannot be settled by whichever lands first,
 * so this holds the first-open default while the mark is pending and makes
 * the one decision when both halves are in, in either order:
 *
 * | the purpose read         | a band fits                  | no band (a phone) |
 * |--------------------------|------------------------------|-------------------|
 * | a reason is stored       | the ordinary default         | the article alone |
 * | definitively none        | the guide, no modal          | the modal         |
 * | failed / purposeFailed   | the ordinary default         | the article alone |
 *
 * **A failed read keeps the mark and decides nothing about the question**:
 * the ordinary default applies, as it would have without the mark, and
 * `PurposePrompt` leaves the mark for the next load — which is not a first
 * open, so a retry that finds no reason asks with the modal, as it always did.
 * Holding the default until a read that may never succeed would leave the
 * reader at the bare article for no reason.
 *
 * **Only a claimed first open is held.** A link that says anything is left as
 * sent (`claimFirstOpen`), so nothing is held, and the mark's question is the
 * modal as before. The guide replaces the modal only where Summary would have
 * been put on screen.
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

/** The guide on a first open: Chat's band, opened on the guide, and the notes if the ordinary default had them. */
export const GUIDE_FIRST_OPEN = "?mode=chat&guide=1";

/**
 * **The decision, pure.** `ordinary` is what `firstOpenSearch` gave for this
 * window — `""` where a band would cover the prose — and is the width rule
 * the guide shares, so the two cannot disagree about whether a band fits.
 */
export function firstOpenWithPurpose(ordinary: string, outcome: PurposeOutcome): { search: string; modal: boolean } {
  if (outcome !== "none") return { search: ordinary, modal: false };
  if (ordinary === "") return { search: "", modal: true };
  /* `ordinary` was measured beside Summary's roomy band, while this opens
     Chat's standard one. The marginalia admission in layout.ts § `fitBoth`
     happens before `bandWidth` sees that shape, so `.both` — and therefore
     this flag — is identical for the two. Carrying the flag also states F4's
     product rule: keep Marginalia wherever the ordinary default had it. */
  const margin = new URLSearchParams(ordinary).get("margin") === "1";
  return { search: margin ? `${GUIDE_FIRST_OPEN}&margin=1` : GUIDE_FIRST_OPEN, modal: false };
}

type Hold = {
  slug: string;
  readerId: string | null;
  /** `firstOpenSearch`, measured once when the first open was claimed. */
  ordinary: string;
  /** The first answer from the purpose read; later ones are the same decision repeated (StrictMode). */
  outcome: PurposeOutcome | null;
  /** Set once `useLastView` can apply this arrival: puts a search on the address, if it still says nothing. */
  apply: ((search: string) => void) | null;
  applied: boolean;
};

let hold: Hold | null = null;

function run(h: Hold): void {
  if (h.applied || h.outcome === null || h.apply === null) return;
  h.applied = true;
  h.apply(firstOpenWithPurpose(h.ordinary, h.outcome).search);
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

/** Whether this slug and reader's first-open default is waiting on the purpose read. */
export function firstOpenHeld(slug: string, readerId: string | null): boolean {
  return hold !== null && hold.slug === slug && hold.readerId === readerId;
}

/**
 * **`useLastView`, once this arrival can be applied**, in place of applying
 * the ordinary default itself. A held arrival registers immediately so an
 * unrelated settings failure cannot strand it. Applies at once if the purpose
 * read has already answered.
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
