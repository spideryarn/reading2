/**
 * **Sources mode's controller** — what this piece cites, and what others
 * say about it. One band, six sub-modes (`?sources=`):
 *
 * ```
 *  ┌ Bibliography 42 │ Not cited 18 │ Links 61 │ Reception 3 │ Claims 8 │ Investigate ┐  (i)
 *  │ BibliographyPanel, as the Citations mode drew it  ← Bibliography (default)
 *  │ NotCitedPanel, OpenAlex's search on the owner's press  ← Not cited (owner only)
 *  │ LinksPanel, read from the article's markup                    ← Links
 *  │ ReceptionAndClaimsPanel, as the Debate mode drew it        ← Reception, Claims
 *  │ InvestigatePanel, questions handed to Chat                     ← Investigate (owner only)
 * ```
 *
 * Citations and Debate were two modes, both behind the experimental switch,
 * until 2026-10-09. Greg (spya-vcvxu5): *"let's move this out of
 * experimental, this combined mode. … Maybe peer review, because that, I
 * think, incorporates the idea that it's both internal and external to the
 * article, i.e. what they cite and also what other people say about them."*
 * It was called Peer review until later that day, when the clash with Referee
 * was put to him: *"B Sources. Rename comprehensively, eg including docs,
 * code, database etc"* (spya-egmn6r).
 *
 * **A wrapper, not a rewrite.** The five panels each own their list; this
 * draws one chip row (`SourcesViews`, below)
 * and hands it to whichever panel the sub-mode names as that panel's `head`,
 * so there is exactly one `ModeSurface` on screen, the panel's, with
 * `mode="sources"` so its (i) opens with this mode's card. The chips'
 * numbers come from sources-counts.ts, the same selectors the panels draw
 * their lists with (GPT Sol's F4).
 *
 * **Every read stays mounted in all six sub-modes**, so each chip can show
 * its count, and **each auto-run is gated on its own sub-mode**: a press that
 * lands on Reception arms the paid search and nothing else, and a press armed
 * for one sub-mode that finds another on screen is retired unspent
 * (useAutoRun.ts § `enabled`). The reads are free GETs. Not cited's read, like
 * *Cited by*'s, is not asked until its chip is first shown, and its search is
 * only ever the panel's button (plan 261011ac, F1).
 *
 * The visitor twin, `VisitorSourcesBand`, draws the same chips and panels
 * off the public payload and mounts none of those hooks, so it can neither
 * read the owner's lists nor start anything. It has no Not cited or Investigate chip,
 * and reads `?sources=not-cited` and `?sources=investigate` as Bibliography (params.ts
 * § `visitorSourcesView`). Any one of the three artefacts
 * opens the mode for a visitor (visitor.ts § POLICY); a sub-mode with nothing
 * stored says so inside the band.
 *
 * The stored names under it are renamed after the sub-modes in stages of plan
 * 261009w: Bibliography's (`citations` until then) in Stage 2; the `debate`
 * and `debate-claims` steps, columns and routes, and their panels' file names
 * and CSS, in Stage 3.
 * docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md,
 * docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md,
 * docs/project/sources.md.
 */

import { useQueryState } from "nuqs";
import { type ComponentProps, useEffect, useMemo, useRef } from "react";
import type { BlockId } from "../../../types.js";
import type { PublicBibliography, PublicReception, PublicSourcesClaimList } from "../../../public-types.js";
import {
  bearsParam,
  citeBarParam,
  citeOrderParam,
  receptionOrderParam,
  receptionThreadParam,
  SOURCES_VIEWS,
  type SourcesView,
  sourcesParam,
  VISITOR_SOURCES_VIEWS,
  visitorSourcesView,
} from "../../params.js";
import { SOURCES_SUB_MODES } from "../../sub-modes.js";
import { armActivationForSubMode } from "../../activation.js";
import { ControlTip, Tooltip, TooltipGroup } from "../../Tooltip.js";
import { useRevealChosen } from "../../useRevealChosen.js";
import { useRenderCount } from "../../perf.js";
import { useBibliography, type BibliographyRead } from "../../useBibliography.js";
import { useReception } from "../../useReception.js";
import { useSourcesClaims } from "../../useSourcesClaims.js";
import { useSourcesClaimChecks } from "../../useSourcesClaimChecks.js";
import { useCiters } from "../../useCiters.js";
import { type CiteFocus, BibliographyPanel } from "../../BibliographyPanel.js";
import { type ReceptionAndClaimsChats, ReceptionAndClaimsPanel } from "../../ReceptionAndClaimsPanel.js";
import type { CitedWorkChats } from "../../OriginChat.js";
import type { ItemFocus } from "../../item-focus.js";
import { yearOf } from "../../reception-order.js";
import type { CitableWork, CitedInParagraph } from "../../cited-in-paragraph.js";
import { checkedSources, listedClaims, type SourcesCounts, sourcesCounts } from "../../sources-counts.js";
import { type LinkableWork, type LinkedBlock, type OutboundLink, outboundLinks } from "../../outbound-links.js";
import { LinksPanel } from "../../LinksPanel.js";
import { useRelatedWork } from "../../useRelatedWork.js";
import { NotCitedPanel } from "../../NotCitedPanel.js";
import { InvestigatePanel, type SourcesInvestigateChats } from "../../InvestigatePanel.js";
import { useExperimental } from "../../useExperimental.js";
import { useSituate } from "../../useSituate.js";

/** The article's own hyperlinks, worked out once per blocks array for the Links chip and its panel. */
function useOutboundLinks(blocks: readonly LinkedBlock[], sourceUrl: string | null): OutboundLink[] {
  return useMemo(() => outboundLinks(blocks, sourceUrl), [blocks, sourceUrl]);
}

const NO_WORKS: readonly LinkableWork[] = [];

/**
 * **The owner's band.** Every read the six sub-modes need, the chip row, and
 * the panel the sub-mode names.
 *
 * A component of its own for the reason every artefact band is: the hooks
 * fetch on mount and own a job subscription and `useAutoRun`'s token, which
 * must die with the band so a press cannot be spent after the reader has
 * left. The citations' opening read is the exception, mounted once in
 * `OwnedReader` because the prose marks citations in every mode
 * (useBibliography.ts § `useBibliographyRead`).
 */
export function SourcesBand({
  slug,
  blocks,
  sourceUrl,
  fromPdf,
  bibliographyRead,
  onJump,
  blockOrder,
  publishedAt,
  articleTitle,
  workChats,
  claimChats,
  investigateChats,
  citeFocus,
  onCiteFocusTaken,
  claimFocus,
  onClaimFocusTaken,
  findingFocus = null,
  onFindingFocusTaken,
  onOpenWork,
}: {
  slug: string;
  /** The article's blocks, for Links (outbound-links.ts). */
  blocks: readonly LinkedBlock[];
  /** Where the article came from (`meta.url`), or `null` for an upload. */
  sourceUrl: string | null;
  /** `meta.source === "pdf"`, for Links' empty sentence. */
  fromPdf: boolean;
  /** Bibliography's opening read, shared with the prose (useBibliography.ts § `useBibliographyRead`). */
  bibliographyRead: BibliographyRead;
  /** `passage` is Bibliography's: `citePassageKey(work.id)` when a row names the citing words. */
  onJump(id: BlockId, passage?: string): void;
  /** Each block's position in the article, for Claims' article order (ReceptionAndClaimsPanel § Props). */
  blockOrder: ReadonlyMap<BlockId, number>;
  /** The article's `Meta.publishedAt`, unread — Reception's *date* marker takes its year. */
  publishedAt: unknown;
  /** The article's title, for Reception's *Who cites it* search (ReceptionAndClaimsPanel § Props). */
  articleTitle: string | null;
  /** A chat about one cited work (BibliographyPanel § `BibliographyAccess`). */
  workChats?: CitedWorkChats;
  /** A claim's chat (ReceptionAndClaimsPanel § `ReceptionAndClaimsChats`). */
  claimChats: ReceptionAndClaimsChats;
  /** Investigate's senders and the way back (InvestigatePanel.tsx § `SourcesInvestigateChats`). */
  investigateChats: SourcesInvestigateChats;
  /** One work to bring into view in Bibliography, once (BibliographyPanel § `Props.focus`). */
  citeFocus: CiteFocus | null;
  onCiteFocusTaken(focus: CiteFocus): void;
  /** One claim to bring into view in Claims, once (ReceptionAndClaimsPanel § `Props.focus`). */
  claimFocus: ItemFocus | null;
  onClaimFocusTaken(focus: ItemFocus): void;
  /** One Situate finding to bring into view in Investigate's dossier, once (plan 261024o; SituateDossier § `focus`). */
  findingFocus?: ItemFocus | null;
  onFindingFocusTaken?: (focus: ItemFocus) => void;
  /** Open Bibliography on one work — Claims' *Cited in this paragraph* (Reader.tsx § `openBibliographyWork`). */
  onOpenWork(workId: string): void;
}) {
  useRenderCount("SourcesBand");
  const [view, setView] = useQueryState("sources", sourcesParam);
  const bibliography = useBibliography(slug, bibliographyRead, view === "bibliography");
  const reception = useReception(slug, view === "reception");
  /* Claims' own list and its own press (activation.ts § `activationForSources`). */
  const claimList = useSourcesClaims(slug, view === "claims");
  /* The reader's claim checks (plan 261008i § 3): read on mount, posted only
     by a press on Check or Dig further. Read in every sub-mode, because the
     Claims chip's count is drawn from them. */
  const checks = useSourcesClaimChecks(slug);
  /* Who cites the piece, Reception's *Cited by*: a second read with no job
     under it, so it can never start the search. Plan 261004h. */
  const citers = useCiters(slug, view === "reception");
  /* Not cited's stored answer, read when its chip is first shown and when
     Bibliography changes, then kept for its count; its search is the panel's
     button alone. Plan 261011ac. */
  const related = useRelatedWork(slug, view === "not-cited", bibliography.bibliography);
  const citeControls = useCitationControls();
  const receptionAndClaimsControls = useReceptionAndClaimsControls();
  const links = useOutboundLinks(blocks, sourceUrl);

  const counts = sourcesCounts({
    works: bibliography.bibliography?.citations ?? null,
    notCited: related.result,
    links,
    reception: reception.reception,
    listed: listedClaims({ kind: "owner", status: claimList.status, claimList: claimList.claimList }),
    checked: claimList.status === "ready" ? checkedSources(checks.checks, claimList.claimList) : 0,
    relevance: receptionAndClaimsControls.relevance,
    thread: receptionAndClaimsControls.thread,
  });
  const head = <SourcesViews view={view} counts={counts} ownerSlug={slug} onView={setView} />;

  switch (view) {
    case "bibliography":
      return (
        <BibliographyPanel
          access={{ kind: "owner", owner: bibliography, ...(workChats ? { chats: workChats } : {}) }}
          head={head}
          {...citeControls}
          onJump={onJump}
          focus={citeFocus}
          onFocusTaken={onCiteFocusTaken}
        />
      );
    case "not-cited":
      return <NotCitedPanel related={related} head={head} />;
    case "links":
      return (
        <LinksPanel
          links={links}
          fromPdf={fromPdf}
          works={bibliography.bibliography?.citations ?? NO_WORKS}
          head={head}
          onJump={onJump}
          onOpenWork={onOpenWork}
        />
      );
    /* Claims' list only while it is current, as Claims hands its rows a
       sender only then (ReceptionAndClaimsPanel.tsx § `ListedClaims`); Investigate
       never buys it (plan 261020n). */
    case "investigate":
      return (
        <InvestigateBand
          slug={slug}
          onJump={onJump}
          head={head}
          chats={investigateChats}
          claims={
            claimList.stale
              ? null
              : listedClaims({ kind: "owner", status: claimList.status, claimList: claimList.claimList })
          }
          works={bibliography.bibliography?.citations ?? null}
          findingFocus={findingFocus}
          onFindingFocusTaken={onFindingFocusTaken}
        />
      );
    case "reception":
    case "claims":
      return (
        <ReceptionAndClaimsPanel
          access={{ kind: "owner", owner: reception, claimList, checks, citers, claimChats }}
          head={head}
          onJump={onJump}
          view={view}
          onView={setView}
          {...receptionAndClaimsControls}
          blockOrder={blockOrder}
          articleYear={yearOf(publishedAt)}
          articleTitle={articleTitle}
          focus={claimFocus}
          onFocusTaken={onClaimFocusTaken}
          citedIn={citedInOf(bibliography.bibliography?.citations ?? null, onOpenWork)}
        />
      );
    default: {
      const unhandled: never = view;
      return unhandled;
    }
  }
}

type InvestigateProps = Omit<ComponentProps<typeof InvestigatePanel>, "situate" | "findingFocus" | "onFindingFocusTaken"> & {
  /** Only with the switch on is there a dossier to land in; off, it is handed back unserved. */
  findingFocus: ItemFocus | null;
  onFindingFocusTaken: ((focus: ItemFocus) => void) | undefined;
};

/**
 * **Investigate, with *Where this piece sits* when the experimental switch is
 * on** (plan 261024o; docs/project/experimental-features.md). Only the owner's
 * band reaches here, and only with the switch on is `useSituate` mounted, so
 * an owner with it off, like a visitor, never asks for the dossier or polls
 * for its job. Flipping the switch while on Investigate remounts the panel;
 * the arrival's reopening of the newest chat then runs once more, which
 * opens a stored conversation and sends nothing.
 */
function InvestigateBand({ slug, findingFocus, onFindingFocusTaken, ...props }: InvestigateProps & { slug: string }) {
  const { on } = useExperimental();
  /* With the switch off there is no dossier, so a finding's focus has nowhere
     to land: hand it back, so it cannot wait for the switch. */
  useEffect(() => {
    if (!on && findingFocus) onFindingFocusTaken?.(findingFocus);
  }, [on, findingFocus, onFindingFocusTaken]);
  return on ? (
    <InvestigateWithSituate
      slug={slug}
      {...props}
      findingFocus={findingFocus}
      onFindingFocusTaken={onFindingFocusTaken}
    />
  ) : (
    <InvestigatePanel {...props} situate={null} />
  );
}

function InvestigateWithSituate({ slug, ...props }: InvestigateProps & { slug: string }) {
  const situate = useSituate(slug);
  return <InvestigatePanel {...props} situate={situate} />;
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
 * `publicReception`). No hook that reads the owner's lists, starts a job or a
 * search — a second band rather than a flag on the first, because a hook
 * cannot be called conditionally (src/web/reader-capability.ts). The
 * sub-mode, the orders, the bars and the thread are the reader's own URL, so a
 * visitor has them all.
 */
export function VisitorSourcesBand({
  blocks,
  sourceUrl,
  bibliography,
  reception,
  claimList,
  onJump,
  blockOrder,
  publishedAt,
  articleTitle,
  citeFocus = null,
  onCiteFocusTaken,
  onOpenWork,
}: {
  /** The article's blocks, for Links — the same markup the visitor's prose draws. */
  blocks: readonly LinkedBlock[];
  /** Where the article came from (`meta.url`), or `null` for an upload. */
  sourceUrl: string | null;
  bibliography: PublicBibliography | null;
  reception: PublicReception | null;
  /** Claims' list, read-only — `PublicSourcesClaimList`, src/public-types.ts. */
  claimList: PublicSourcesClaimList | null;
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
  useRenderCount("VisitorSourcesBand");
  const [named, setView] = useQueryState("sources", sourcesParam);
  /* Not cited and Investigate are the owner's: a shared `?sources=not-cited` or
     `?sources=investigate` draws Bibliography, and the address is left as it is (plan
     261011ac, F6; plan 261020n § Visitors). */
  const view = visitorSourcesView(named);
  const citeControls = useCitationControls();
  const receptionAndClaimsControls = useReceptionAndClaimsControls();
  const links = useOutboundLinks(blocks, sourceUrl);
  const counts = sourcesCounts({
    works: bibliography?.citations ?? null,
    links,
    reception,
    listed: listedClaims({ kind: "visitor", claimList }),
    checked: 0,
    relevance: receptionAndClaimsControls.relevance,
    thread: receptionAndClaimsControls.thread,
  });
  const head = <SourcesViews view={view} counts={counts} ownerSlug={null} onView={setView} />;
  switch (view) {
    /* `not-cited` and `investigate` never reach here (`visitorSourcesView`); named so
       the switch is exhaustive and a new sub-mode has to say what a visitor
       gets. */
    case "bibliography":
    case "not-cited":
    case "investigate":
      return (
        <BibliographyPanel
          access={{ kind: "visitor", bibliography }}
          head={head}
          {...citeControls}
          onJump={onJump}
          focus={citeFocus}
          {...(onCiteFocusTaken ? { onFocusTaken: onCiteFocusTaken } : {})}
        />
      );
    case "links":
      return (
        <LinksPanel
          links={links}
          fromPdf={false}
          works={bibliography?.citations ?? NO_WORKS}
          head={head}
          onJump={onJump}
          onOpenWork={onOpenWork}
        />
      );
    case "reception":
    case "claims":
      return (
        <ReceptionAndClaimsPanel
          access={{ kind: "visitor", reception, claimList }}
          head={head}
          onJump={onJump}
          view={view}
          onView={setView}
          {...receptionAndClaimsControls}
          blockOrder={blockOrder}
          articleYear={yearOf(publishedAt)}
          articleTitle={articleTitle}
          citedIn={citedInOf(bibliography?.citations ?? null, onOpenWork)}
        />
      );
    default: {
      const unhandled: never = view;
      return unhandled;
    }
  }
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
 * `?receptionby=` (Reception's order, `prioritised` by default), `?bears=`
 * (Claims' relevance bar, null for untouched) and `?receptionthread=` (the thread
 * narrowing the list, plan 260930j), which both bands share. Read in every
 * sub-mode, because the Reception and Claims chips count through the bar and
 * the thread.
 */
function useReceptionAndClaimsControls() {
  const [order, setOrder] = useQueryState("receptionby", receptionOrderParam);
  const [relevance, setRelevance] = useQueryState("bears", bearsParam);
  const [thread, setThread] = useQueryState("receptionthread", receptionThreadParam);
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
 * **Bibliography | Not cited | Links | Reception | Claims | Investigate** — Sources'
 * six sub-modes, the band's header row; four for a visitor, who has no Not
 * cited and no Investigate (`VISITOR_SOURCES_VIEWS`). It was Debate's two-way control
 * (`DebateViews`, 2026-10-03, plan 261003o) until 2026-10-09, widened to
 * three, then four and five on 2026-10-11, and six on 2026-10-20 (plan
 * 261020n), and is built the way
 * Summary's Brief | Fuller | Thread is: a radiogroup of buttons, each its own
 * tab stop, drawn joined so they read as one choice (mode-band.css § the
 * part-switcher).
 *
 * **Each chip carries the count of what its list draws** (sources-counts.ts),
 * so a reader on Bibliography can see there are three replies a press away —
 * Greg read one claim's two sources as the whole debate because nothing told
 * him there were others. Bibliography has no number while there is no list,
 * Not cited none until a stored search has been read, and Investigate never one:
 * there is nothing to count before a press.
 *
 * **What each one is goes in its card, never in a sentence under the row**:
 * docs/project/mode.md bans a description line there (GPT Sol's F8 on
 * 261003o). The words are sub-modes.ts's, which the command bar's rows share,
 * and each leads with one half of the mode's frame: what this piece cites, or
 * what others say.
 *
 * The owner's press arms the chip's own work, the same contract as its
 * command-bar row (activation.ts § `activationForSources`): Bibliography the
 * citations, Not cited, Links and Investigate nothing, Reception the paid search, Claims the claims list. A stored list
 * consumes its token without running. A visitor can never arm owner work.
 */
export function SourcesViews({
  view,
  counts,
  ownerSlug,
  onView,
}: {
  view: SourcesView;
  counts: SourcesCounts;
  ownerSlug: string | null;
  onView(view: SourcesView): void;
}) {
  const group = useRef<HTMLDivElement>(null);
  useRevealChosen(group, view);
  return (
    <div ref={group} className="summ-views rcp-views" role="radiogroup" aria-label="Sources view">
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {(ownerSlug === null ? VISITOR_SOURCES_VIEWS : SOURCES_VIEWS).map((v) => {
          const words = SOURCES_SUB_MODES[v];
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
                  if (ownerSlug !== null) armActivationForSubMode(ownerSlug, { mode: "sources", view: v });
                  if (v !== view) onView(v);
                }}
              >
                {words.label}
                {count !== null && <span className="rcp-view-count">{count.n}</span>}
              </button>
            </Tooltip>
          );
        })}
      </TooltipGroup>
    </div>
  );
}

/** One chip's number and what it counts, for its accessible name; `null` when there is no number. */
function countOf(counts: SourcesCounts, view: SourcesView): { n: number; noun: string } | null {
  const plural = (n: number, one: string) => (n === 1 ? one : `${one}s`);
  switch (view) {
    case "bibliography":
      return counts.bibliography === null
        ? null
        : { n: counts.bibliography, noun: plural(counts.bibliography, "work") };
    case "not-cited":
      return counts.notCited === null ? null : { n: counts.notCited, noun: plural(counts.notCited, "paper") };
    case "links":
      return { n: counts.links, noun: counts.links === 1 ? "address" : "addresses" };
    case "reception":
      return { n: counts.reception, noun: plural(counts.reception, "source") };
    case "claims":
      return { n: counts.claims.n, noun: plural(counts.claims.n, counts.claims.unit) };
    case "investigate":
      return null;
    default: {
      const unhandled: never = view;
      return unhandled;
    }
  }
}

/** The second paragraph of each chip's card: how its rows were got, and what was checked. */
const VIEW_HOW: Record<SourcesView, string> = {
  bibliography:
    "Listed by one model call over the article, and kept. Every address shown for a work is one the article itself gave, found by code rather than typed by the model, or else a Scholar search marked as one.",
  /* Checked against src/related-work.ts: `openAlexRelatedUrl` (semantic search
     on the `related-work/2` query, the year filter), `notInBibliography` (the
     identifier, title and entry tiers, run on every read against the current
     Bibliography, never the prose), `isThisPiece`, and the POST being the only
     path that asks OpenAlex. */
  "not-cited":
    "Found by OpenAlex's search on this piece's title and opening, only when you press Search, and kept; no AI. Each paper is checked against the bibliography Spideryarn listed, by DOI or arXiv number, by title, and by the article's own reference text, and left out if it matches. A paper the piece mentions in its text but not in its bibliography can still be listed, so judge each one yourself.",
  links:
    "Read off the article's own markup in your browser: no model, no search, nothing fetched. One row for each web address, whatever words the article links it with.",
  reception:
    "Found by a search of the open web, run once and kept. Each page has to link, quote or name this piece, and each quotation is checked against what the search returned.",
  claims:
    "Listed by one model call over the article, with no web search, and kept. Each claim is in the article's own words, checked against the paragraph it names, with a line in the AI's words under it.",
  /* Checked against InvestigatePanel.tsx: the fixed questions are ours, the claims
     are Claims' stored list, the works Bibliography's `relevance`, and every
     row and the box go through Reader's `handToChat` with `send`. */
  investigate:
    "Nothing runs until you press a question. Then Chat opens and asks it with a web search. The suggested questions are fixed; the claims and works are taken from Claims and Bibliography once they exist.",
};
