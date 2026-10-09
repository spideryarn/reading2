/**
 * **Peer review mode's controller** — what this piece cites, and what others
 * say about it. One band, three sub-modes (`?peer-review=`):
 *
 * ```
 *  ┌ Bibliography 42 │ Reception 3 │ Claims 8 ┐                 (i)
 *  │ CitationsPanel, as the Citations mode drew it  ← Bibliography (default)
 *  │ DebatePanel, as the Debate mode drew it        ← Reception, Claims
 * ```
 *
 * Citations and Debate were two modes, both behind the experimental switch,
 * until 2026-10-09. Greg (spya-vcvxu5): *"let's move this out of
 * experimental, this combined mode. … Maybe peer review, because that, I
 * think, incorporates the idea that it's both internal and external to the
 * article, i.e. what they cite and also what other people say about them."*
 *
 * **A wrapper, not a rewrite.** The two panels are 1,700 and 3,200 lines,
 * each with its own tests; this draws one chip row (`PeerReviewViews`, below)
 * and hands it to whichever panel the sub-mode names as that panel's `head`,
 * so there is exactly one `ModeSurface` on screen, the panel's, with
 * `mode="peer-review"` so its (i) opens with this mode's card. The chips'
 * numbers come from peer-review-counts.ts, the same selectors the panels draw
 * their lists with (GPT Sol's F4).
 *
 * **Every read stays mounted in all three sub-modes**, so each chip can show
 * its count, and **each auto-run is gated on its own sub-mode**: a press that
 * lands on Reception arms the paid search and nothing else, and a press armed
 * for one sub-mode that finds another on screen is retired unspent
 * (useAutoRun.ts § `enabled`). The reads are free GETs.
 *
 * The visitor twin, `VisitorPeerReviewBand`, draws the same chips and panels
 * off the public payload and mounts none of those hooks, so it can neither
 * read the owner's lists nor start anything. Any one of the three artefacts
 * opens the mode for a visitor (visitor.ts § POLICY); a sub-mode with nothing
 * stored says so inside the band.
 *
 * The stored names under it — the `citations`, `debate` and `debate-claims`
 * steps, columns and routes, the panels' file names and CSS — are held until
 * Greg confirms the name (plan § Stage 3).
 * docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md,
 * docs/project/peer-review.md.
 */

import { useQueryState } from "nuqs";
import { useRef } from "react";
import type { BlockId } from "../../../types.js";
import type { PublicCitations, PublicDebate, PublicDebateClaimList } from "../../../public-types.js";
import {
  bearsParam,
  citeBarParam,
  citeOrderParam,
  debateOrderParam,
  debateThreadParam,
  PEER_REVIEW_VIEWS,
  type PeerReviewView,
  peerReviewParam,
} from "../../params.js";
import { PEER_REVIEW_SUB_MODES } from "../../sub-modes.js";
import { armActivationForSubMode } from "../../activation.js";
import { ControlTip, Tooltip, TooltipGroup } from "../../Tooltip.js";
import { useRevealChosen } from "../../useRevealChosen.js";
import { useRenderCount } from "../../perf.js";
import { useCitations, type CitationsRead } from "../../useCitations.js";
import { useDebate } from "../../useDebate.js";
import { useDebateClaims } from "../../useDebateClaims.js";
import { useDebateChecks } from "../../useDebateChecks.js";
import { useCiters } from "../../useCiters.js";
import { type CiteFocus, CitationsPanel } from "../../CitationsPanel.js";
import { type DebateClaimChats, DebatePanel } from "../../DebatePanel.js";
import type { CitedWorkChats } from "../../OriginChat.js";
import type { ItemFocus } from "../../item-focus.js";
import { yearOf } from "../../debate-order.js";
import type { CitableWork, CitedInParagraph } from "../../cited-in-paragraph.js";
import { checkedSources, listedClaims, type PeerReviewCounts, peerReviewCounts } from "../../peer-review-counts.js";

/**
 * **The owner's band.** Every read the three sub-modes need, the chip row, and
 * the panel the sub-mode names.
 *
 * A component of its own for the reason every artefact band is: the hooks
 * fetch on mount and own a job subscription and `useAutoRun`'s token, which
 * must die with the band so a press cannot be spent after the reader has
 * left. The citations' opening read is the exception, mounted once in
 * `OwnedReader` because the prose marks citations in every mode
 * (useCitations.ts § `useCitationsRead`).
 */
export function PeerReviewBand({
  slug,
  citationsRead,
  onJump,
  blockOrder,
  publishedAt,
  articleTitle,
  workChats,
  claimChats,
  citeFocus,
  onCiteFocusTaken,
  claimFocus,
  onClaimFocusTaken,
  onOpenWork,
}: {
  slug: string;
  /** Bibliography's opening read, shared with the prose (useCitations.ts § `useCitationsRead`). */
  citationsRead: CitationsRead;
  /** `passage` is Bibliography's: `citePassageKey(work.id)` when a row names the citing words. */
  onJump(id: BlockId, passage?: string): void;
  /** Each block's position in the article, for Claims' article order (DebatePanel § Props). */
  blockOrder: ReadonlyMap<BlockId, number>;
  /** The article's `Meta.publishedAt`, unread — Reception's *date* marker takes its year. */
  publishedAt: unknown;
  /** The article's title, for Reception's *Who cites it* search (DebatePanel § Props). */
  articleTitle: string | null;
  /** A chat about one cited work (CitationsPanel § `CitationsAccess`). */
  workChats?: CitedWorkChats;
  /** A claim's chat and an angle's (DebatePanel § `DebateClaimChats`). */
  claimChats: DebateClaimChats;
  /** One work to bring into view in Bibliography, once (CitationsPanel § `Props.focus`). */
  citeFocus: CiteFocus | null;
  onCiteFocusTaken(focus: CiteFocus): void;
  /** One claim to bring into view in Claims, once (DebatePanel § `Props.focus`). */
  claimFocus: ItemFocus | null;
  onClaimFocusTaken(focus: ItemFocus): void;
  /** Open Bibliography on one work — Claims' *Cited in this paragraph* (Reader.tsx § `openBibliographyWork`). */
  onOpenWork(workId: string): void;
}) {
  useRenderCount("PeerReviewBand");
  const [view, setView] = useQueryState("peer-review", peerReviewParam);
  const citations = useCitations(slug, citationsRead, view === "bibliography");
  const debate = useDebate(slug, view === "reception");
  /* Claims' own list and its own press (activation.ts § `activationForPeerReview`). */
  const claimList = useDebateClaims(slug, view === "claims");
  /* The reader's claim checks (plan 261008i § 3): read on mount, posted only
     by a press on Check or Dig further. Read in every sub-mode, because the
     Claims chip's count is drawn from them. */
  const checks = useDebateChecks(slug);
  /* Who cites the piece, Reception's *Cited by*: a second read with no job
     under it, so it can never start the search. Plan 261004h. */
  const citers = useCiters(slug, view === "reception");
  const citeControls = useCitationControls();
  const debateControls = useDebateControls();

  const counts = peerReviewCounts({
    works: citations.citations?.citations ?? null,
    debate: debate.debate,
    listed: listedClaims({ kind: "owner", status: claimList.status, claimList: claimList.claimList }),
    checked: claimList.status === "ready" ? checkedSources(checks.checks, claimList.claimList) : 0,
    relevance: debateControls.relevance,
    thread: debateControls.thread,
  });
  const head = <PeerReviewViews view={view} counts={counts} ownerSlug={slug} onView={setView} />;

  if (view === "bibliography")
    return (
      <CitationsPanel
        access={{ kind: "owner", owner: citations, ...(workChats ? { chats: workChats } : {}) }}
        head={head}
        {...citeControls}
        onJump={onJump}
        focus={citeFocus}
        onFocusTaken={onCiteFocusTaken}
      />
    );
  return (
    <DebatePanel
      access={{ kind: "owner", owner: debate, claimList, checks, citers, claimChats }}
      head={head}
      onJump={onJump}
      view={view}
      onView={setView}
      {...debateControls}
      blockOrder={blockOrder}
      articleYear={yearOf(publishedAt)}
      articleTitle={articleTitle}
      focus={claimFocus}
      onFocusTaken={onClaimFocusTaken}
      citedIn={citedInOf(citations.citations?.citations ?? null, onOpenWork)}
    />
  );
}

/**
 * **Bibliography's works for Claims' line** (plan 261009l § C1), or `null`
 * when there is no Bibliography — then Claims draws no line, and opening
 * Claims does not buy one.
 */
function citedInOf(works: readonly CitableWork[] | null, onOpen: (workId: string) => void): CitedInParagraph | null {
  return works === null || works.length === 0 ? null : { works, onOpen };
}

/**
 * **The same band, for somebody who does not own the article.**
 *
 * Each artefact came in the page's own payload, any of them possibly absent
 * (Reader.tsx mounts this when one is there), every address already re-judged
 * at the public boundary (src/public/dto.ts § `publicCitedWork`,
 * `publicDebate`). No hook that reads the owner's lists, starts a job or a
 * search — a second band rather than a flag on the first, because a hook
 * cannot be called conditionally (src/web/reader-capability.ts). The
 * sub-mode, the orders, the bars and the thread are the reader's own URL, so a
 * visitor has them all.
 */
export function VisitorPeerReviewBand({
  citations,
  debate,
  claimList,
  onJump,
  blockOrder,
  publishedAt,
  articleTitle,
  citeFocus = null,
  onCiteFocusTaken,
  onOpenWork,
}: {
  citations: PublicCitations | null;
  debate: PublicDebate | null;
  /** Claims' list, read-only — `PublicDebateClaimList`, src/public-types.ts. */
  claimList: PublicDebateClaimList | null;
  onJump(id: BlockId, passage?: string): void;
  blockOrder: ReadonlyMap<BlockId, number>;
  /** A visitor's meta carries no `publishedAt`, so this is `undefined` today and there is no marker. */
  publishedAt: unknown;
  articleTitle: string | null;
  /** One work to bring into view in Bibliography, once — set by Claims' *Cited in this paragraph*. */
  citeFocus?: CiteFocus | null;
  onCiteFocusTaken?(focus: CiteFocus): void;
  /** Open Bibliography on one work (Reader.tsx § `openBibliographyWork`), which a visitor's band may do too. */
  onOpenWork(workId: string): void;
}) {
  useRenderCount("VisitorPeerReviewBand");
  const [view, setView] = useQueryState("peer-review", peerReviewParam);
  const citeControls = useCitationControls();
  const debateControls = useDebateControls();
  const counts = peerReviewCounts({
    works: citations?.citations ?? null,
    debate,
    listed: listedClaims({ kind: "visitor", claimList }),
    checked: 0,
    relevance: debateControls.relevance,
    thread: debateControls.thread,
  });
  const head = <PeerReviewViews view={view} counts={counts} ownerSlug={null} onView={setView} />;
  if (view === "bibliography")
    return (
      <CitationsPanel
        access={{ kind: "visitor", citations }}
        head={head}
        {...citeControls}
        onJump={onJump}
        focus={citeFocus}
        {...(onCiteFocusTaken ? { onFocusTaken: onCiteFocusTaken } : {})}
      />
    );
  return (
    <DebatePanel
      access={{ kind: "visitor", debate, claimList }}
      head={head}
      onJump={onJump}
      view={view}
      onView={setView}
      {...debateControls}
      blockOrder={blockOrder}
      articleYear={yearOf(publishedAt)}
      articleTitle={articleTitle}
      citedIn={citedInOf(citations?.citations ?? null, onOpenWork)}
    />
  );
}

/** `?citeby=` and `?citebar=`, Bibliography's order and threshold, which both bands share. */
function useCitationControls() {
  const [order, setOrder] = useQueryState("citeby", citeOrderParam);
  /* Null is "nobody has touched the bar", which the panel resolves to
     `CITATION_BAR_DEFAULT` — kept null here so the default is one number in one
     file. */
  const [bar, setBar] = useQueryState("citebar", citeBarParam);
  return { order, onOrder: setOrder, bar, onBar: setBar };
}

/**
 * `?debateby=` (Reception's order, `prioritised` by default), `?bears=`
 * (Claims' relevance bar, null for untouched) and `?debatethread=` (the thread
 * narrowing the list, plan 260930j), which both bands share. Read in every
 * sub-mode, because the Reception and Claims chips count through the bar and
 * the thread.
 */
function useDebateControls() {
  const [order, setOrder] = useQueryState("debateby", debateOrderParam);
  const [relevance, setRelevance] = useQueryState("bears", bearsParam);
  const [thread, setThread] = useQueryState("debatethread", debateThreadParam);
  return {
    order,
    onOrder: setOrder,
    relevance,
    onRelevance: setRelevance,
    thread,
    onThread: setThread,
  };
}

/**
 * **Bibliography | Reception | Claims** — Peer review's three sub-modes, the
 * band's header row. It was Debate's two-way control (`DebateViews`, 2026-10-03,
 * plan 261003o) until 2026-10-09, widened to three, and is built the way
 * Summary's Brief | Fuller | Thread is: a radiogroup of buttons, each its own
 * tab stop, drawn joined so the three read as one choice (mode-band.css § the
 * part-switcher).
 *
 * **Each chip carries the count of what its list draws** (peer-review-counts.ts),
 * so a reader on Bibliography can see there are three replies a press away —
 * Greg read one claim's two sources as the whole debate because nothing told
 * him there were others. Bibliography has no number while there is no list.
 *
 * **What each one is goes in its card, never in a sentence under the row**:
 * docs/project/mode.md bans a description line there (GPT Sol's F8 on
 * 261003o). The words are sub-modes.ts's, which the command bar's rows share,
 * and each leads with one half of the mode's frame: what this piece cites, or
 * what others say.
 *
 * The owner's press arms the chip's own work, the same contract as its
 * command-bar row (activation.ts § `activationForPeerReview`): Bibliography the
 * citations, Reception the paid search, Claims the claims list. A stored list
 * consumes its token without running. A visitor can never arm owner work.
 */
export function PeerReviewViews({
  view,
  counts,
  ownerSlug,
  onView,
}: {
  view: PeerReviewView;
  counts: PeerReviewCounts;
  ownerSlug: string | null;
  onView(view: PeerReviewView): void;
}) {
  const group = useRef<HTMLDivElement>(null);
  useRevealChosen(group, view);
  return (
    <div ref={group} className="summ-views dbt-views" role="radiogroup" aria-label="Peer review view">
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {PEER_REVIEW_VIEWS.map((v) => {
          const words = PEER_REVIEW_SUB_MODES[v];
          const count = countOf(counts, v);
          return (
            <Tooltip
              key={v}
              placement="bottom"
              keepSide
              className="tip-soon"
              content={<ControlTip head={words.label} what={`${words.description}.`} how={VIEW_HOW[v]} />}
            >
              {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s, the call SummaryMode.tsx, StructureMode.tsx and RefereeMode.tsx already make */}
              <button
                type="button"
                role="radio"
                aria-checked={v === view}
                /* The label and the count are two text nodes with no space
                   between them, which a screen reader may run together. */
                aria-label={count === null ? words.label : `${words.label}, ${count.n} ${count.noun}`}
                tabIndex={0}
                className={`summ-view-btn${v === view ? " on" : ""}`}
                onClick={() => {
                  if (ownerSlug !== null) armActivationForSubMode(ownerSlug, { mode: "peer-review", view: v });
                  if (v !== view) onView(v);
                }}
              >
                {words.label}
                {count !== null && <span className="dbt-view-count">{count.n}</span>}
              </button>
            </Tooltip>
          );
        })}
      </TooltipGroup>
    </div>
  );
}

/** One chip's number and what it counts, for its accessible name; `null` when there is no number. */
function countOf(counts: PeerReviewCounts, view: PeerReviewView): { n: number; noun: string } | null {
  const plural = (n: number, one: string) => (n === 1 ? one : `${one}s`);
  switch (view) {
    case "bibliography":
      return counts.bibliography === null
        ? null
        : { n: counts.bibliography, noun: plural(counts.bibliography, "work") };
    case "reception":
      return { n: counts.reception, noun: plural(counts.reception, "source") };
    case "claims":
      return { n: counts.claims.n, noun: plural(counts.claims.n, counts.claims.unit) };
    default: {
      const unhandled: never = view;
      return unhandled;
    }
  }
}

/** The second paragraph of each chip's card: how its rows were got, and what was checked. */
const VIEW_HOW: Record<PeerReviewView, string> = {
  bibliography:
    "Listed by one model call over the article, and kept. Every address shown for a work is one the article itself gave, found by code rather than typed by the model, or else a Scholar search marked as one.",
  reception:
    "Found by a search of the open web, run once and kept. Each page has to link, quote or name this piece, and each quotation is checked against what the search returned.",
  claims:
    "Listed by one model call over the article, with no web search, and kept. Each claim is in the article's own words, checked against the paragraph it names, with a line in the AI's words under it.",
};
