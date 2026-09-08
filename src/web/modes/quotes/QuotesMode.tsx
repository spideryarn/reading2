/**
 * **Quotes mode's controller.** The band an owner gets, the band a visitor
 * gets, and the hook underneath both: `?quote=`, `?rank=` and `?bar=`.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established a day earlier: a mode's controller, its visitor twin and its hook
 * move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 *
 * **Two things left on 2026-09-08**, and both because the quotes are now marked
 * in the prose in every mode rather than only while this band is open
 * (docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md):
 *
 * - **the opening fetch**, up to `OwnedReader` as `useQuotesRead`, leaving the
 *   job poller and the verbs here — the glossary's split, for the glossary's
 *   reason (src/web/useQuotes.ts § QuotesRead);
 * - **the marks**, to `useQuoteMarks` in src/web/reader/useQuoteMarks.ts. This
 *   band is no longer a passage producer, which is why nothing below mentions
 *   `usePassageLifecycle`.
 */

import { useQueryState } from "nuqs";
import type { BlockId } from "../../../types.js";
import type { PublicQuotes } from "../../../public-types.js";
import { barParam, quoteParam, rankParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { useQuotes, type QuotesRead } from "../../useQuotes.js";
import { QuotesPanel } from "../../QuotesPanel.js";

/**
 * Quotes, and the job machinery that belongs to it.
 *
 * A component of its own for the reason `GlossaryBand` is, and it is no longer
 * the opening fetch: `useStepJob` subscribes to the job engine and so holds it
 * to its idle cadence, and `useAutoRun`'s owner must die with the band so a
 * Quotes press cannot be spent after the reader has left it. Both would be
 * wrong mounted in `OwnedReader`, which is why only the *read* went up.
 * src/web/useQuotes.ts § QuotesRead.
 */
export function QuotesBand({
  slug,
  read,
  onJump,
}: {
  slug: string;
  /** The opening read, mounted in `OwnedReader`. src/web/useQuotes.ts § QuotesRead. */
  read: QuotesRead;
  onJump(id: BlockId): void;
}) {
  useRenderCount("QuotesBand");
  const quotes = useQuotes(slug, read);
  const band = useQuotesMode();
  return (
    <QuotesPanel
      access={{ kind: "owner", owner: quotes, quotes: quotes.quotes }}
      {...band}
      onJump={onJump}
    />
  );
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useQuotes` and therefore no `useJobs`: the list came in the page's own
 * payload. See `VisitorGlossaryBand` for why this is a second band and not a
 * second panel.
 */
export function VisitorQuotesBand({
  quotes,
  onJump,
}: {
  quotes: PublicQuotes;
  onJump(id: BlockId): void;
}) {
  useRenderCount("VisitorQuotesBand");
  const band = useQuotesMode();
  return <QuotesPanel access={{ kind: "visitor", quotes }} {...band} onJump={onJump} />;
}

/**
 * Everything the quotes band does that is not a fetch or a mark: `?quote=`,
 * `?rank=`, `?bar=`, and nothing else.
 *
 * **It stopped being a passage producer on 2026-09-08**, and that is the whole
 * of Greg's feedback report SPIDERYARN-READING2-2P — *"always show them in the
 * text view, even if we're not in quotes mode"*. The marks used to be resolved
 * here and pushed up through `usePassageLifecycle`, which meant they lived
 * exactly as long as this band did. They are now `useQuoteMarks` in
 * src/web/reader/useQuoteMarks.ts, computed by `Reader` from state `Reader`
 * already holds — the artefact, the three parameters below, the blocks — so
 * there was never anything for this band to know that `Reader` does not.
 *
 * What is left is the reader's hand on the three controls. The panel reads the
 * same three parameters through the same parsers, and `markedQuotes` is still
 * the one function deciding what is listed *and* what is marked, so the rows and
 * the strokes cannot come apart. docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md.
 */
function useQuotesMode() {
  const [quoteId, setQuoteId] = useQueryState("quote", quoteParam);
  const [rank, setRank] = useQueryState("rank", rankParam);
  /* Null is "nobody has touched the bar", which the panel resolves to
     `QUOTE_BAR_DEFAULT`. Kept as null rather than defaulted here so the default stays
     one number in one file — see `barParam` in params.ts. */
  const [bar, setBar] = useQueryState("bar", barParam);

  return { quoteId, onQuote: setQuoteId, rank, onRank: setRank, bar, onBar: setBar };
}
