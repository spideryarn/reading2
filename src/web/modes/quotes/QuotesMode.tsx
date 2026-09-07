/**
 * **Quotes mode's controller.** The band an owner gets, the band a visitor
 * gets, and the hook underneath both: `?quote=`, `?rank=`, `?bar=`, and the
 * marked lines the panel and the prose have to agree on.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established a day earlier: a mode's controller, its visitor twin and its hook
 * move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */

import { useEffect, useMemo } from "react";
import { useQueryState } from "nuqs";
import type { Block, BlockId, Quote } from "../../../types.js";
import type { PublicQuotes } from "../../../public-types.js";
import { quoteMarkKey, resolveQuotes, type Found } from "../../search-hits.js";
import { barParam, quoteParam, rankParam } from "../../params.js";
import { usePassageLifecycle } from "../../passage-lifecycle.js";
import { useRenderCount } from "../../perf.js";
import { useQuotes } from "../../useQuotes.js";
import { effectiveRank, markedQuotes, quoteTier, QuotesPanel } from "../../QuotesPanel.js";

/**
 * Quotes, and the fetch that belongs to it.
 *
 * A component of its own for the reason `GlossaryBand` and `IdeasBand` are:
 * `useQuotes` fetches on mount, and calling it up in `Reader` would charge every
 * reader of every article a request for a list almost none of them will open.
 *
 * What it pushes up is the **resolved** passages, not the stored quotes. The
 * panel and the prose have to be choosing from the same list, and the only way
 * to guarantee that is for one function to decide it — `markedQuotes`, called
 * by both — which is the rule `SearchBand` and `IdeasBand` both follow.
 *
 * **Resolution can still drop one**, when the article no longer has the block a
 * quote names, and that is the one place the list and the marks legitimately
 * differ: the row stays in the panel with no wash beside it. Kept rather than
 * hidden, because a list quietly shorter than the artefact is the failure
 * docs/reusable/silent-success.md keeps catching, and the `stale` banner above
 * it is already saying the article moved. GPT Sol's first finding, 2026-09-05.
 */
export function QuotesBand({
  slug,
  blocks,
  onJump,
  onFound,
  onOpenKey,
}: {
  slug: string;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("QuotesBand");
  const quotes = useQuotes(slug);
  const band = useQuotesMode({ quotes: quotes.quotes, blocks, onFound, onOpenKey });
  return (
    <QuotesPanel
      access={{ kind: "owner", owner: quotes, quotes: quotes.quotes }}
      {...band}
      onJump={onJump}
    />
  );
}

/**
 * A module constant rather than a fresh `[]`, for the reason `NO_TERMS` is one:
 * the memos in `useQuotesMode` key on it by identity.
 */
const NO_QUOTES: Quote[] = [];

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useQuotes` and therefore no `useJobs`: the list came in the page's own
 * payload. See `VisitorGlossaryBand` for why this is a second band and not a
 * second panel.
 */
export function VisitorQuotesBand({
  quotes,
  blocks,
  onJump,
  onFound,
  onOpenKey,
}: {
  quotes: PublicQuotes;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("VisitorQuotesBand");
  const band = useQuotesMode({ quotes, blocks, onFound, onOpenKey });
  return <QuotesPanel access={{ kind: "visitor", quotes }} {...band} onJump={onJump} />;
}

/**
 * Everything the quotes band does that is not a fetch: `?quote=`, `?rank=`,
 * `?bar=`, and the resolved passage it pushes up.
 *
 * **Every quote the panel is showing is marked, not only the selected one** —
 * since 2026-09-05, and it is the whole of one feedback report. The memo below
 * returned `[]` unless a row was selected, so quotes mode drew nothing at all on
 * the page until you pressed something and the `?bar=` slider changed the list
 * without changing the article. Greg asked to be able to *"skim through it just
 * reading the stuff that is marked"*, and search has always done exactly this
 * through the identical pipe.
 *
 * **What is marked is `markedQuotes`, which is what the panel lists.** One
 * function, called by both, so the rows and the washes cannot come apart — and
 * so the bar doubles as the highlight-density control, which is what makes it
 * the thing Greg described rather than a filter on a list. The one exception is
 * a quote whose block the article has lost: `resolveQuotes` drops it and the
 * row stays — see `QuotesBand` above.
 *
 * **No colour slot to assign**, which is the one thing this hook does not share
 * with `useIdeasMode`. Ideas paint every idea its own lane so a colour does not
 * depend on which one is open; the quotes are **one source** — the categorical
 * palette answers *which search found this*, and there is one thing here that
 * found anything — so they share a slot and a run id, and `resolveQuotes` owns
 * both. It is still a *real* slot rather than `null`, because `blockHues` drops
 * `null` slots and a quote without one would paint the rail and leave the
 * paragraph bar blank, which looks like a rendering bug and is not one.
 */
function useQuotesMode({
  quotes,
  blocks,
  onFound,
  onOpenKey,
}: {
  quotes: { quotes: Quote[] } | null;
  blocks: Block[];
  onFound(found: Found[]): void;
  /**
   * Which mark wears the ring — `mark.hit[data-hit-open]`, the thing search
   * uses to say *this washed phrase is the row you pressed*.
   *
   * Quotes did without one until the whole list was marked, and the old comment
   * in `Reader` said why: a quote is exactly one passage, so there was nothing
   * to step between and nothing to leave open. With sixteen marks on the page
   * the ring is the only thing that distinguishes the reader's own selection
   * from the fifteen the mode drew for them.
   */
  onOpenKey(key: string | null): void;
}) {
  const [quoteId, setQuoteId] = useQueryState("quote", quoteParam);
  const [rank, setRank] = useQueryState("rank", rankParam);
  /* Null is "nobody has touched the bar", which the panel resolves to
     `QUOTE_BAR_DEFAULT`. Kept as null rather than defaulted here so the default stays
     one number in one file — see `barParam` in params.ts. */
  const [bar, setBar] = useQueryState("bar", barParam);

  /**
   * **A quote the bar has hidden cannot stay selected**, which since 2026-09-03
   * is a state the reader can reach: the prioritised rank hides what is below
   * the bar rather than grouping it, and `?quote=` resolves against the whole
   * artefact independently of what the panel is drawing. Without this a raised
   * bar took the row away and left the line marked in the prose and in the
   * rail, and lowering the bar later silently reopened a selection the reader
   * had watched disappear. The same rule search holds at `SearchBand`.
   *
   * Scoped to `prioritised`, because that is the only rank with a bar. Two
   * reasons, and the second is why the guard survived the rewrite below: a
   * `?bar=` sitting in a URL must not clear a selection in a list nobody is
   * looking at a threshold for — and while the artefact is still being fetched
   * `listed` is empty, so an unguarded "is my quote in the visible list" would
   * strip a shared `?quote=` link out of the URL before its own data arrived.
   */
  const all = quotes?.quotes ?? NO_QUOTES;
  /**
   * **The list the panel is drawing** — the rows, and now the marks.
   *
   * `markedQuotes` is the panel's own three lines (`snapToStop`,
   * `effectiveRank`, `rankQuotes`), called here rather than repeated here. They
   * *were* repeated, in `hiddenSelection` below, which was safe while all they
   * decided was whether to clear a selection; it is not safe now that they
   * decide what the article is wearing.
   */
  const listed = useMemo(() => markedQuotes(all, rank, bar), [all, rank, bar]);
  const hiddenSelection = useMemo(() => {
    if (quoteId === null) return false;
    if (effectiveRank([...all], rank) !== "prioritised") return false;
    return !listed.some((q) => q.id === quoteId);
  }, [all, rank, listed, quoteId]);
  useEffect(() => {
    if (hiddenSelection) void setQuoteId(null);
  }, [hiddenSelection, setQuoteId]);

  const selected = useMemo(
    () => (hiddenSelection ? null : (all.find((q) => q.id === quoteId) ?? null)),
    [all, quoteId, hiddenSelection],
  );

  /* **`start` is not passed on**, and `resolveQuotes` does not take it — the
     stored offset is measured in `block.text` and this resolution happens in
     the rendered text. It is still on the artefact, because it is what
     `inDocumentOrder` sorts two quotes from one paragraph by. */
  /* The tier is attached here rather than inside `resolveQuotes`, so the
     resolver stays a thing that turns text into spans and never learns what a
     score is — and so `search-hits.ts`, which the node tests load, does not have
     to import a React module to find `quoteTier`. */
  const found = useMemo(
    () => resolveQuotes(blocks, listed.map((quote) => ({ ...quote, tier: quoteTier(quote) }))),
    [listed, blocks],
  );

  /* The ring, computed from the selection rather than looked up in `found`: a
     quote whose block the article has lost resolves to nothing, and the honest
     answer then is a key that matches no mark rather than the *previous*
     quote's. `quoteMarkKey` so the shape lives in one file. */
  const openKey = useMemo(
    () => (selected ? quoteMarkKey(selected.id, selected.blockId) : null),
    [selected],
  );

  /* **The rules every passage producer follows**, in src/web/passage-lifecycle.ts
     rather than here: publish before paint, and clear on the way out.

     **`derived`, which is a shape of its own and not `keyed` with a flag.** The
     marks and the ring go up in **one** layout effect, so no paint can ever show
     the ring on one quote and the washes of another set; and there is no
     drop-an-invalid-key rule, because this key is recomputed rather than
     remembered — a quote whose block the article has lost resolves to a key
     matching no mark, which is the honest answer, and that rule would null it.
     `?bar=` hiding the selected row is a different trigger and is the effect
     above. */
  usePassageLifecycle({ kind: "derived", found, openKey, onFound, onOpenKey });

  return { quoteId, onQuote: setQuoteId, rank, onRank: setRank, bar, onBar: setBar };
}
