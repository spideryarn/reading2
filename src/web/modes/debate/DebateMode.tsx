/**
 * **Debate mode's controller.** One band, and no passage hook underneath it: a
 * row here is a page on the web rather than a passage in the article, so there
 * is nothing to resolve, keep in step or colour. The docblock below says why that
 * is the design and not a stub.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established a day earlier: a mode's controller, its visitor twin and its hook
 * move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 *
 * **And a visitor twin since 2026-09-29**, `VisitorDebateBand`: the stored
 * debate off the public payload, every row's address already re-judged at the
 * boundary (src/public/dto.ts § `publicDebate`), with no `useDebate`,
 * `useAutoRun` or `useStepJob` under it — so it can neither read the owner's
 * debate nor start a search, which is two metered web searches at ~$0.27. It
 * was `owners-only` until that boundary was built (SPIDERYARN-READING2-56,
 * docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md).
 *
 * **Two sub-modes since 2026-10-03**, `?debate=`: Reception, the search about
 * the piece, and Claims, the search about what it claims. Both draw the one
 * stored debate, so switching between them fetches and spends nothing.
 * docs/plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md.
 *
 * **And a second read for the owner since 2026-10-04**, `useCiters`: the papers
 * that cite the piece, from OpenAlex, for Reception's *Cited by*. Not the
 * stored debate's, free, and with no job: it is asked for on arrival and can
 * start nothing.
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md.
 */

import { useQueryState } from "nuqs";
import type { BlockId } from "../../../types.js";
import type { PublicDebate } from "../../../public-types.js";
import { bearsParam, debateOrderParam, debateParam, debateThreadParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { useDebate } from "../../useDebate.js";
import { useCiters } from "../../useCiters.js";
import { type DebateClaimChats, DebatePanel } from "../../DebatePanel.js";
import { yearOf } from "../../debate-order.js";

/**
 * The debate, and the fetch that belongs to it.
 *
 * A component of its own for the reason `TimelineBand` and `IdeasBand` are:
 * `useDebate` fetches on mount, so calling it up in `Reader` would charge every
 * reader of every article a request for a web search almost none of them will
 * open.
 *
 * **The shortest band in this file, and that is the design rather than a stub.**
 * The passage rules its neighbours follow — `usePassageLifecycle`, three of
 * them — are about marks in the prose, and Debate has none: a row is a page on
 * the web, not a passage in the article, so there is no `Found` to resolve, no
 * `openKey` to keep in step and no colour slot to assign. It is also why Debate
 * answers `NO_FOUND` in `selectPassages` (reader/passages.ts) rather than
 * carrying a slot. What it hands down, besides the reader's settings, is
 * `onJump`, because a claim row names the block whose claim it answers and has
 * to offer the way there. Marks
 * are the first thing to add — the plan's § Deliberately not in v1 — and adding
 * them is what would bring the hook and a passage slot with it.
 *
 * **The owner's band.** `VisitorDebateBand` below is the other one, and it is
 * a second component rather than a flag on this one because a hook cannot be
 * called conditionally.
 */
export function DebateBand({
  slug,
  onJump,
  blockOrder,
  publishedAt,
  articleTitle,
  claimChats,
}: {
  slug: string;
  onJump(id: BlockId): void;
  /** Each block's position in the article, for Claims' article order (DebatePanel § Props). */
  blockOrder: ReadonlyMap<BlockId, number>;
  /**
   * The article's `Meta.publishedAt`, unread — the year for *date*'s marker is
   * taken from it here, so `Reader` does not import the debate's ordering code.
   */
  publishedAt: unknown;
  /** The article's title, for Reception's *Who cites it* search (DebatePanel § Props). */
  articleTitle: string | null;
  /**
   * A claim's chat: the reading view's thread summaries, and the two things a
   * claim can do with them (DebatePanel § `DebateClaimChats`). The owner's
   * band only; `VisitorDebateBand` below takes none, so a visitor's claims
   * have neither the button nor the mark.
   */
  claimChats: DebateClaimChats;
}) {
  useRenderCount("DebateBand");
  const articleYear = yearOf(publishedAt);
  /* `?debate=`, Reception unless it says `claims`. */
  const [view, setView] = useQueryState("debate", debateParam);
  const debate = useDebate(slug, view === "reception");
  /* `?debateby=`, Reception's order, defaulting to `prioritised` (*as found*);
     the panel draws what the rows can support (debate-order.ts §
     `effectiveReceptionOrder`). */
  const [order, setOrder] = useQueryState("debateby", debateOrderParam);
  /* `?bears=`, Claims' relevance bar — null is untouched, `loosely` in the panel. */
  const [relevance, setRelevance] = useQueryState("bears", bearsParam);
  /* `?debatethread=`, the thread narrowing the list — plan 260930j. */
  const [thread, setThread] = useQueryState("debatethread", debateThreadParam);
  /* **Who cites the piece**, Reception's *Cited by* — a second read with no job
     under it, so it can never start the search above. Wanted when the panel
     draws the section: with Reception, and before any search is stored
     (DebatePanel.tsx § `citedBy`). Plan 261004h. */
  const citers = useCiters(slug, view === "reception" || debate.status === "none");
  return (
    <DebatePanel
      access={{ kind: "owner", owner: debate, citers, claimChats }}
      onJump={onJump}
      view={view}
      onView={setView}
      order={order}
      onOrder={setOrder}
      blockOrder={blockOrder}
      relevance={relevance}
      onRelevance={setRelevance}
      articleYear={articleYear}
      thread={thread}
      onThread={setThread}
      articleTitle={articleTitle}
    />
  );
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * The debate came in the page's own payload. No `useDebate`, so no read of
 * `/api/debate/:slug`, no job and no search — a second band rather than a flag
 * on the first, because a hook cannot be called conditionally
 * (src/web/reader-capability.ts; `VisitorTimelineBand` is the sibling). The
 * sub-mode, the order, the relevance bar and the thread are the reader's own
 * URL, so a visitor has all four.
 */
export function VisitorDebateBand({
  debate,
  onJump,
  blockOrder,
  publishedAt,
  articleTitle,
}: {
  debate: PublicDebate;
  onJump(id: BlockId): void;
  blockOrder: ReadonlyMap<BlockId, number>;
  /** A visitor's meta carries no `publishedAt`, so this is `undefined` today and there is no marker. */
  publishedAt: unknown;
  articleTitle: string | null;
}) {
  useRenderCount("VisitorDebateBand");
  const articleYear = yearOf(publishedAt);
  const [view, setView] = useQueryState("debate", debateParam);
  const [order, setOrder] = useQueryState("debateby", debateOrderParam);
  /* A visitor's rows carry `bears` since 2026-10-01 (plan 261001b, 5P), so the
     relevance bar works for them as for the owner. */
  const [relevance, setRelevance] = useQueryState("bears", bearsParam);
  /* And the synthesis since the same day (6M) — absent when the boundary
     withheld a row, and then there are no threads for this to name. */
  const [thread, setThread] = useQueryState("debatethread", debateThreadParam);
  return (
    <DebatePanel
      access={{ kind: "visitor", debate }}
      onJump={onJump}
      view={view}
      onView={setView}
      order={order}
      onOrder={setOrder}
      blockOrder={blockOrder}
      relevance={relevance}
      onRelevance={setRelevance}
      articleYear={articleYear}
      thread={thread}
      onThread={setThread}
      articleTitle={articleTitle}
    />
  );
}
