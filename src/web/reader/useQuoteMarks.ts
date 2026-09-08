/**
 * **The quotes, as the article wears them — in every mode, and computed rather
 * than published.**
 *
 * Greg, 2026-09-08 (SPIDERYARN-READING2-2P):
 *
 * > Always show the quotes (highlighted with a border around them), if there are
 * > any that have been generated. Always show them in the text view, even if
 * > we're not in quotes mode.
 *
 * The marks used to be *pushed up* by `useQuotesMode` through
 * `usePassageLifecycle`, which meant they lived exactly as long as the band did
 * and vanished the moment the reader pressed Plain. Everything they are made of
 * — the artefact, `?quote=`, `?rank=`, `?bar=`, the blocks — is state `Reader`
 * holds, so there was never anything for the band to *know* that `Reader` does
 * not. This hook is that observation, and the whole publication protocol went
 * with it. docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md.
 *
 * ## Why a memo is enough, where the band needed a layout effect
 *
 * `usePassageLifecycle`'s `derived` shape existed for quotes alone, and for one
 * property: the marks and the ring had to reach `Reader` in **one** layout
 * effect, so that no paint could show the ring on one quote and the washes of
 * another set. A memo has that for free. Both values come out of the same
 * render, a React commit carries both or neither, an abandoned or suspended
 * render commits nothing, and StrictMode cannot commit half a memo. There is no
 * second commit left to be wrong in. Confirmed against the installed React by
 * GPT Sol, 2026-09-08.
 *
 * ## What it deliberately does not decide
 *
 * **Which of these marks the prose actually draws** — that is `proseFound` in
 * passages.ts, and the distinction is the whole of the change. The quotes join
 * the *marks* in every mode; they join the paragraph bar, the spine rail and the
 * ring **only in quotes mode**, by being that mode's slot. See `proseFound` for
 * what goes wrong if they join the other three: a quote's `confidence` is
 * `null`, so `blockStrength` would paint every quote-bearing paragraph's bar at
 * full strength over the model's own hedged confidence, and every quote's
 * `slot` is `0`, which is the *first saved search's* colour.
 */
import { useEffect, useMemo } from "react";
import { useQueryState } from "nuqs";

import type { Block, Quote } from "../../types.js";
import { barParam, quoteParam, rankParam } from "../params.js";
import { effectiveRank, markedQuotes, quoteTier } from "../QuotesPanel.js";
import { quoteMarkKey, resolveQuotes } from "../search-hits.js";
import type { PassageSlot } from "./passages.js";

/**
 * A module constant rather than a fresh `[]`, for the reason `NO_FOUND` is one:
 * the memos below key on it by identity, and an article with no quotes is the
 * ordinary case rather than the exception.
 */
const NO_QUOTES: Quote[] = [];

/**
 * The quotes' passage slot: what is marked, and which one is rung.
 *
 * `quotes` is `{ quotes: Quote[] } | null` so that an owner's `QuotesRead` and a
 * visitor's `PublicQuotes` are the same shape here — `PublicQuotes.quotes` is a
 * `Quote[]`, the projection being field-by-field (src/public-types.ts).
 */
export function useQuoteMarks(
  blocks: Block[],
  quotes: { quotes: Quote[] } | null,
): PassageSlot {
  const [quoteId, setQuoteId] = useQueryState("quote", quoteParam);
  const [rank] = useQueryState("rank", rankParam);
  /* Null is "nobody has touched the bar", which `markedQuotes` resolves to
     `QUOTE_BAR_DEFAULT`. Kept as null rather than defaulted here so the default
     stays one number in one file — see `barParam` in params.ts. */
  const [bar] = useQueryState("bar", barParam);

  const all = quotes?.quotes ?? NO_QUOTES;

  /**
   * **The list the panel is drawing** — the rows, and the marks.
   *
   * `markedQuotes` is the panel's own three lines (`snapToStop`,
   * `effectiveRank`, `rankQuotes`), called here rather than repeated here, so
   * that a row hidden by the bar can never keep its mark on the paragraph —
   * which is precisely the failure src/web/threshold.ts exists to prevent.
   */
  const listed = useMemo(() => markedQuotes(all, rank, bar), [all, rank, bar]);

  /**
   * **A quote the bar has hidden cannot stay selected.** The prioritised rank
   * hides what is below the bar rather than grouping it, and `?quote=` resolves
   * against the whole artefact independently of what the panel is drawing.
   *
   * **This rule is no longer scoped to the band, and that is a real change**
   * rather than a move. It used to live in `useQuotesMode`, where it was right:
   * while the marks died with the mode, a dormant `?bar=` sitting in a URL had no
   * business clearing a selection in a list nobody was looking at. Now the bar
   * hides a mark in Plain too, so the selection it hides is a selection with
   * nothing on screen to justify it wherever the reader is standing. GPT Sol
   * named the difference, 2026-09-08.
   *
   * Still scoped to `prioritised`, because that is the only rank with a bar —
   * and, second, because `listed` is empty while the artefact is being fetched,
   * so an unguarded "is my quote in the visible list" would strip a shared
   * `?quote=` link out of the URL before its own data arrived.
   */
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
     stored offset is measured in `block.text` and this resolution happens in the
     rendered text. It is still on the artefact, because it is what
     `inDocumentOrder` sorts two quotes from one paragraph by.

     The tier is attached here rather than inside `resolveQuotes`, so the
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

  /* One object, memoised on its two halves, so `selectPassages`' promise that a
     slot's marks and ring travel together survives being handed a fresh object
     on every render — and so `Reader`'s downstream memos key on it by identity
     the way they do on every other slot. */
  return useMemo(() => ({ found, openKey }), [found, openKey]);
}
