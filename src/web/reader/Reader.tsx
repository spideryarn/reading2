/**
 * **The reading view itself** — the prose, the spine, the granularity zoom, the
 * dock, and the band the modes take turns in. One component for the owner and
 * for a visitor; what differs is the `capability` prop.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape the mode
 * controllers established a day earlier: a unit with its own reason to change
 * moves into a file of its own, keeping its code byte-for-byte, so `App.tsx`
 * stops knowing what is inside it. `App.tsx` is left with route choice, the
 * session and the persistent services; who may read this article is in
 * article/, one level up from here. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md
 * and docs/project/reading-view-overview.md.
 */

import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryState, useQueryStates } from "nuqs";
import type { Article, BlockId, CitedWork, GlossaryEntry } from "../../types.js";
import { marginaliaNotes, arcAt, headBlock, headPath } from "../marginalia/notes.js";
import {
  MarginaliaHead,
  MarginNotesSlot,
  type MarginFeed,
  NO_OWNER_FEED,
  OwnerMarginFeed,
  useMarginLayout,
} from "../marginalia/MarginaliaColumn.js";
import { MODE_CATALOG } from "../../mode-catalog.js";
import { useExperimental } from "../useExperimental.js";
import { shownBehindTheSwitch } from "../experimental-visibility.js";
import { OnScreenLinksStyle } from "../OnScreenLinksStyle.js";
import { blocksOnScreenNow } from "../on-screen.js";
import { ReadingTimeStyle } from "../ReadingTimeStyle.js";
import type { ReadSoFar } from "../read-filter.js";
import { countsTowardReadingTime } from "../../block-policy.js";
import { addressWithout, carriedSearch, navigate, useAddress } from "../router.js";
import { IdeasBand, VisitorIdeasBand } from "../modes/ideas/IdeasMode.js";
import { TimelineBand, VisitorTimelineBand } from "../modes/timeline/TimelineMode.js";
import { QuotesBand, VisitorQuotesBand } from "../modes/quotes/QuotesMode.js";
import { quoteCardQuotes, useQuoteMarks } from "./useQuoteMarks.js";
import { DebateBand, VisitorDebateBand } from "../modes/debate/DebateMode.js";
import { CitationsBand, VisitorCitationsBand } from "../modes/citations/CitationsMode.js";
import { FaqBand, VisitorFaqBand } from "../modes/faq/FaqMode.js";
import {
  armSkimOpening,
  firstSkimArrival,
  SkimBand,
  VisitorSkimBand,
  type SkimArrival,
  type SkimControl,
} from "../modes/skim/SkimMode.js";
import { SkimDoor } from "../SkimPanel.js";
import { type CardTarget, modeForCardTarget } from "../stop-card.js";
import type { Quote } from "../../types.js";
import { GlossaryBand, VisitorGlossaryBand } from "../modes/glossary/GlossaryMode.js";
import { SearchBand, VisitorSearchBand } from "../modes/search/SearchMode.js";
import { StructureBand } from "../modes/structure/StructureMode.js";
import { BarStuckSentinel } from "../BarStuckSentinel.js";
import { HeadingsCrumbs } from "../HeadingsCrumbs.js";
import { isCrumbSection } from "../crumbs.js";
import { SummaryBand, VisitorSummaryBand } from "../modes/summary/SummaryMode.js";
import { DiagramBand } from "../modes/diagram/DiagramMode.js";
import type { FollowJump } from "../DiagramPanel.js";
import { RefereeBand } from "../modes/referee/RefereeMode.js";
import {
  type ChatHandoff,
  ConversationBand,
  RememberBand,
} from "../modes/conversation/ConversationModes.js";
import { askAboutSummaryParagraph, askAboutTerm } from "../chat-handoff.js";
import type { QuizArrival } from "../QuizPanel.js";
import { QuizInProse } from "../QuizInProse.js";
import { questionsByAnchor } from "../quiz-anchors.js";
import { MODE_CONTAINMENT, ModeBoundary } from "./ModeBoundary.js";
import { type HeraldPress, ModeHerald } from "../ModeHerald.js";
import { TableView } from "../TableView.js";
import { sameAnchor, selectAnchor, type SelectionAnchor } from "../selection.js";
import type { CiteSelection, TermSelection } from "../annotate.js";
import { formsOf } from "../../term-match.js";
import { horizontalInset, safeAreaInsets } from "../safe-area.js";
import type { ArchiveControl } from "../useArchive.js";
import { Spine } from "../Spine.js";
import { AnnotateDialog, annotateKey } from "../AnnotateDialog.js";
import { TouchSelectionChip } from "../TouchSelectionChip.js";
import { CommentDialog } from "../CommentDialog.js";
import { DEFAULT_HIGHLIGHT, isPristineHighlight, spansOverlap } from "../fresh-highlight.js";
import type { CommentsApi } from "../useComments.js";
import { mintId } from "../../ids.js";
import { Masthead } from "../Masthead.js";
import { Dock } from "../Dock.js";
import { gateToReveal, PRIORITY_GATE } from "../GlossaryPanel.js";
import { type CiteActions, ProseHoverCard, type QuoteCardSource } from "../ProseHoverCard.js";
import type { CiteFocus } from "../CitationsPanel.js";
import { shownEntries } from "../glossary-shown.js";
import { editArticleTags } from "../article-tags.js";
import { chatExecutor, readingExecutor, type TagsControl } from "../command-runners.js";
import { type FindMoreMode, glossaryAppendOnOffer, quotesAppendOnOffer } from "../find-more.js";
import { ChatCommands } from "../CommandChip.js";
import { findHref } from "../CommandBar.js";
import { buildNoteIndex, type NoteMarker, type NoteReturn } from "../notes-view.js";
import {
  blockHues,
  blockMatches,
  blockStrength,
  hitMarks as buildHitMarks,
  type Found,
} from "../search-hits.js";
import { buildArcColumn, buildGeometry, buildOutline, buildSummaryTree, nodeLabel } from "../tree.js";
import {
  marginParam,
  modeParam,
  noteParam,
  panelParam,
  sortParam,
  gateParam,
  refScaleParam,
  termParam,
  ideaParam,
  eventParam,
  spineParam,
  threadParam,
  rememberParam,
  diagramParam,
  refereeParam,
  summaryParam,
  structureParam,
  debateParam,
  type BandMode,
  type Mode,
} from "../params.js";
import { returnToSubMode, subModeParams } from "../sub-modes.js";
import { isMarginaliaModeWord } from "../../modes.js";
import { arrivalTarget, clearArrivalAnchor, isBlockOnScreen, scrollToBlock } from "../scroll.js";
import { orderComments, positionOf, stepComment } from "../comment-nav.js";
import { jumpToComment, stepToComment } from "../comment-jump.js";
import { readerRowComments } from "../quote-band-rows.js";
import { buildSections, sectionDepth } from "../position.js";
import { marginaliaPress, notesFit } from "../marginalia/press.js";
import { arrivalBringsRailBack, modePress } from "./mode-press.js";
import {
  bandCoversProse,
  bandShapeFor,
  BLOCK_CHAT_IN_COLUMN,
  CHAT_CARD_HOST_ATTR,
  chatCard,
  chatDock,
  fitView,
  NARROW_WINDOW_MAX,
} from "../layout.js";
import { isFolded, subscribeFold } from "../fold.js";
import { media } from "../media.js";
import { navPlan, useArrowNav } from "../keynav.js";
import { ReturnChip } from "../ReturnChip.js";
import { BandBackChip } from "../BandBackChip.js";
import { MODE_LABEL } from "../../title-text.js";
import { BlockLinkProvider, buildBlockLinkIndex } from "../BlockLinkCard.js";
import { xrefTarget, type XrefResolver } from "../xref.js";
import { flushPendingFlash, resetFlash, type JumpAim } from "../flash.js";
import { ViewportProbe } from "../ViewportProbe.js";
import { type ChatCardPlace, ChatDialog, type ChatTarget } from "../ChatDialog.js";
import {
  anchored,
  askedBesideCard,
  askedQuestions,
  countByBlock,
  helpThreadFor,
  threadFor,
} from "../useChatAnchors.js";
import { pageTitle, useDocumentTitle } from "../page-title.js";
import {
  NO_SEARCHES,
  NO_TERMS,
  NO_WORKS,
  NO_THREADS,
  OWNER_HAS_EVERYTHING,
  type ReaderCapability,
} from "../reader-capability.js";
import { markedModes, visitorGap } from "../visitor.js";
import { SharedNotice, ViewOnlyChip, VisitorBand } from "../PublicChrome.js";
import { webSource } from "../SourceLink.js";
import { SmallScreenHint } from "../SmallScreenHint.js";
import { useRenderCount } from "../perf.js";
import { makeBlockBookmarker } from "../block-bookmark.js";
import { FEEDBACK_BLOCK_IDS, setFeedbackArticleContext } from "../feedback-context.js";
import { useWindowWidth, useRootFontPx } from "./measure.js";
import { useReadingPosition } from "./useReadingPosition.js";
import { useModeFlashOwnership } from "./mode-flash.js";
import { proseFound, railFound, selectPassages } from "./passages.js";
import { quoteAlphaByBlock } from "../spine-marks.js";
import { stepQuote } from "../QuotesPanel.js";
import type { OnRenamed } from "../TitleEditor.js";

/** A module constant for `NO_QUOTES`'s reason: the visitor's Skim band keys memos on it by identity. */
const NO_PUBLIC_QUOTES: Quote[] = [];

/**
 * The owner's `marked` map: nothing is marked, and it is one object for the
 * life of the module so the bar's props do not change identity every render.
 *
 * A map since 2026-08-28 because each entry now carries the sentence the band
 * will show, so the bar's tooltip and the band cannot say the same fact in two
 * slightly different ways. visitor.ts § markedModes.
 */
const EVERY_MODE_AVAILABLE: ReadonlyMap<Mode, string> = new Map();

/**
 * The reading view — **one reading view, for the owner and for a visitor.**
 *
 * That was the goal from the first draft of the plan and it has not changed:
 * the prose, the tree, the spine, the granularity zoom and the keyboard are the
 * product, they cost nothing to serve, and a stranger gets all of them. What
 * differs is the `capability` prop, and the difference is not cosmetic — the
 * hooks a visitor must not mount are not mounted anywhere below this line,
 * because they were never called. They live in `OwnedReader`, one component up.
 * reader-capability.ts says why a boolean could not have done it.
 *
 * ## A known follow-up, measured rather than guessed
 *
 * `noExcessiveCognitiveComplexity` scores this function **50** against a
 * threshold of 25 (measured 2026-09-10). It was **38** before the capability
 * seam, **49** after it and **54** by the time the dispatch was extracted, and
 * over the threshold at every one of those, so this is not a line that was
 * crossed here — but the gates are worth a number and the number keeps going
 * up. `band()` below took eight off it when it was extracted, has crept back
 * since, and is scored **50** in its own right — 46 until Debate's boundary
 * added its owner/visitor branches — which is the honest arithmetic: a
 * switch over every mode is not simpler than one `&&` per mode to a counter of
 * branches. What it is instead is *checked*, and that was the point.
 *
 * The extraction this docblock proposed was a `<ModeBands>` component taking
 * about sixteen props, and it is **not** what happened. The audit priced it
 * properly — twenty-one props with the passage state bundled, thirty-four
 * without — and a sixteen-value bag is not a smaller interface than sixteen
 * arguments. What landed on 2026-09-06 is `band()` below: a local function with
 * an exhaustive `switch (mode)`, closing over this scope, threading **zero**
 * props, calling no hooks. `selectPassages` (reader/passages.ts) is the same
 * move for the other half of the dispatch. Recorded here rather than in a plan
 * file because this is where somebody will be standing when they wonder.
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */
export function Reader({
  slug,
  article,
  capability,
  onRenamed,
  archive,
}: {
  slug: string;
  article: Article;
  /** Whether this article is yours, and what comes with it. reader-capability.ts. */
  capability: ReaderCapability;
  /**
   * Passed straight through to the masthead’s pencil — see Masthead.tsx.
   *
   * Absent for a visitor, and the masthead reads that absence as *do not offer
   * the pencil*. A rename is a PATCH against a shelf row a visitor does not
   * have, so the button could only ever fail, and a button that can only fail is
   * worse than no button because pressing it is how you find out.
   */
  onRenamed?: OnRenamed | undefined;
  /** The owner's controller, kept above the article/metadata view switch. */
  archive?: ArchiveControl | undefined;
}) {
  useRenderCount("Reader");
  /**
   * The owner's half of the capability, or `null`.
   *
   * Narrowed once, here, so that every `owner ? … : …` below is the compiler
   * checking the same fact rather than eight independent comparisons that could
   * drift apart. The visitor's `available` is read the same way.
   */
  const owner = capability.kind === "owner" ? capability : null;
  /** The same fact as a boolean, for a hook that needs only that — `owner` is a new object every render. */
  const isOwner = owner !== null;
  /**
   * The visitor's half, read the same way and for the same reason.
   *
   * `artefacts` is what slice 1b added: the glossary, the summaries, the ideas
   * and the tweet thread, as **data** rather than as a loader, because they
   * arrived inside the payload this page is already drawing.
   * reader-capability.ts.
   *
   * `available` is the same fact as five booleans and it is no longer nullable:
   * there is no second request to have failed, so there is nothing to be unsure
   * about. For the owner it is `EVERYTHING`, which nothing reads — every gate
   * below is on `owner` first.
   */
  const artefacts = capability.kind === "visitor" ? capability.artefacts : null;
  const available = capability.kind === "visitor" ? capability.available : OWNER_HAS_EVERYTHING;
  /* Only the call to action reads this — see reader-capability.ts § signedIn.
     `true` for the owner is never consulted, since none of the chrome it gates
     is drawn for them. */
  const signedIn = capability.kind === "visitor" ? capability.signedIn : true;
  /* And only the read-only chrome reads this: the notice under the masthead and
     the chip in the bar below it, neither of which is drawn for an owner.
     PublicChrome.tsx § SharedNotice for why it is two things and not one. */
  const sessionUnconfirmed = capability.kind === "visitor" && capability.sessionUnconfirmed;
  /**
   * **Whether this reader sees the modes that are still being built**, handed
   * down to the bar rather than fetched by it.
   *
   * The page owns the fetches and the bar is told — Dock.tsx's own header says
   * so, and `drawer`, `marked` and `signedIn` all already work that way. The
   * store behind this hook is shared and session-bound, so the reading view,
   * and the metadata page cannot disagree for the length of a
   * toggle (experimental-store.ts).
   *
   * **This is what makes a signed-in reader ask `GET /api/reader` on a reading
   * view at all** — the store is lazy, and through stage 1 nothing on this page
   * subscribed. tests/public-network-trace.test.tsx pins that at one, and pins a
   * stranger's at zero.
   */
  const experimental = useExperimental();
  const geometry = useMemo(
    () => buildGeometry(article.tree, article.blocks),
    [article],
  );
  // Three levels, not two: the rail itself only ever draws L1 and L2, but a
  // band's hover tooltip lists the sub-sections inside it, and it can only do
  // that if they were built. See BandCard in Spine.tsx.
  const outline = useMemo(
    () => buildOutline(article.tree, article.blocks, 3),
    [article],
  );
  const sections = useMemo(
    () => buildSections(geometry, article.blocks),
    [geometry, article.blocks],
  );
  const windowWidth = useWindowWidth();
  const rootFontPx = useRootFontPx();

  /**
   * Whether the reader has had a view about the spine — see params.ts §
   * spineParam and layout.ts § showSpine.
   *
   * `null` means the rail is on, which is what it means for everybody who has
   * never touched the parameter — the pill that wrote it went on 2026-09-05.
   * Nothing on this page writes it any more except the one line below that puts
   * `null` *back* when Search or Ideas opens with the rail hidden, and that
   * still needs the third state: "nobody has touched this" is what it restores.
   */
  const [showSpine, setShowSpine] = useQueryState("spine", spineParam);

  /**
   * Which mode owns the middle band — see params.ts § modeParam, and
   * docs/plans/260826a-chat-mode.md.
   *
   * Greg's framing, 2026-08-25: the gist columns are not a fixture with things
   * layered over them, they are *the default mode*, and chat is the second one.
   * So this is a single value the layout reads, not a flag each feature checks.
   */
  const [mode, setMode] = useQueryState("mode", modeParam);
  /* **Which of Summary's views is showing** — Brief, Fuller or Thread. Read
     here, beside the mode, because three things outside the band depend on it
     and must agree with the band in every frame: the band's shape (the thread
     is the wide one, layout.ts § `bandShapeFor`), and what a Summary press
     from the bar arms (`<Dock summary>`). The band reads the same nuqs state,
     so this is the state that picks it, not a second parse of the address —
     which lags a press by up to ~50ms (activation.ts § `PressContext`).
     docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md. */
  const [summaryView] = useQueryState("summary", summaryParam);
  /**
   * **Whether Marginalia's column of notes is on**, right of the prose — a
   * switch of its own beside `mode` since 2026-10-01, so the notes can sit
   * beside a band. `mode` never says `marginalia` (`BandMode`); the Dock's
   * Marginalia button toggles this instead.
   * docs/plans/261001i-annotations-column-beside-a-band-mode.md.
   */
  const [margin, setMargin] = useQueryState("margin", marginParam);
  /* **A `?mode=marginalia` link, or an old `?mode=annotations` one** (the
     mode was called Annotations, and was a value of `?mode=`, for its first
     day) reads as Plain through `modeParam`; this turns the notes on for it
     and drops the word, in one replaced entry so Back does not return to it.
     Read from `location` because `modeParam` has already discarded it; which
     words count is `isMarginaliaModeWord` (src/modes.ts, 261001n). The
     Marginalia press that swaps the band out writes both through this too, so
     one Back undoes it (261001k). */
  const [, setModeAndMargin] = useQueryStates({
    mode: modeParam,
    margin: marginParam,
  });
  useEffect(() => {
    if (isMarginaliaModeWord(new URLSearchParams(location.search).get("mode")))
      void setModeAndMargin({ mode: null, margin: true }, { history: "replace" });
  }, [setModeAndMargin]);
  /* The pasted Skim stop belongs to this article arrival, not to each
     mount of its band. `ModeBoundary key={mode}` remounts the band on re-entry
     while leaving mode-specific query state in the URL; the first band mount
     claims this mailbox, then owns the token while its data resolves. */
  const skimArrival = useRef<SkimArrival>(firstSkimArrival(mode));
  /* A centred arrival belongs to this layout. A mode switch can remove the
     passage marks and Skim's door without scrolling a pixel, so end the
     hold before the new band can ask where the reader is. The first setup also
     drops module state left by a reading view that just unmounted. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mode` is the layout-change trigger; the effect deliberately reads no mode value.
  useLayoutEffect(() => {
    clearArrivalAnchor();
  }, [mode]);

  /* The tab: the article first, then the mode — and nothing for whichever mode
     is the default, which is the one most tabs are in and so the one that
     distinguishes nothing. `plain` since 2026-08-31; the rule is about the
     default rather than about any particular mode. See src/web/page-title.ts. */
  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view: "article", mode }));
  /**
   * **Is there a panel in the middle band?** Every mode but Plain has one.
   * (Until 2026-09-29 Hierarchy had none either — its gist columns were part
   * of the table — and an `inMode` beside this said whether the granularity
   * controls applied. Both went with that mode:
   * docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md.)
   */
  const bandOpen = mode !== "plain";
  /**
   * **Marginalia draws a column to the RIGHT of the prose**, beside whatever
   * band is open or none (layout.ts § `fitMargin`, `fitBoth`). It opens no
   * band, so everything that asks `bandOpen` — the band covering the prose on
   * a phone, the herald, the reading-time "is the prose on screen" — sees the
   * band's page or Plain's. Where there is no room for both, the band wins.
   * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md,
   * docs/plans/261001i-annotations-column-beside-a-band-mode.md.
   */
  const marginOpen = margin === true;
  /**
   * **The band has stepped aside from the prose** — on a narrow window, where
   * it lies over the whole article (`band-covers`), after the reader follows a
   * passage link out of any band (`bandJump` below, since 2026-09-29) or presses
   * a Skim row (since 2026-09-28; its ‹ › and depth buttons did too until
   * 2026-10-03, spya-kudr63). The band stays mounted, so everything
   * in it survives; only its paint goes (narrow-window.css § a band that has
   * stepped aside). `BandBackChip` offers it back, as does Skim's door
   * (SkimPanel.tsx § SkimDoor).
   *
   * Component state, not the URL: it is about this window at this moment, and
   * a reload or a shared link should open the band. Cleared whenever the mode
   * changes and on any press of the Dock — pressing the mode you are in is
   * how you ask for its band back. The plan's F4.
   */
  const [bandAway, setBandAway] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mode` is the trigger, not an input — a new mode brings its band back.
  useEffect(() => {
    setBandAway(false);
  }, [mode]);
  /**
   * **Open a band from somewhere that is not the Dock** — a card in the prose,
   * the command bar, a hand-off to Chat. The band asked for may be the one
   * already open and stepped aside, and then the effect above never runs:
   * the mode has not changed. So anything that names a band as its
   * destination calls this rather than `setMode`, and the two lines cannot be
   * written apart. The citation card had only the second (plan 261004b), then
   * the term card (qi-fs4qzzfm, plan 261004g).
   *
   * No write when the mode is already there: `nuqs` does not elide a
   * same-value push, so it would add a history entry that changes nothing
   * (the Dock's press says the same, below).
   */
  const showBand = useCallback(
    (target: BandMode) => {
      setBandAway(false);
      if (target !== mode) void setMode(target);
    },
    [mode, setMode],
  );
  /* **Browser Back does not bring the band back**, deliberately. A `popstate`
     rule was in the plan and GPT Sol took it out: while the band is away the
     reader can make further pushes of their own (a footnote jump, a Skim
     depth), and Back should undo *those*, not reopen a band. `BandBackChip` is
     the way back. docs/plans/260929g-on-a-phone-a-band-link-closes-the-band.md. */
  /**
   * **The mode the reader has just pressed, for `ModeHerald` to name.**
   *
   * Set by the Dock's `onMode` and the shared Search opener below. The Dock's
   * buttons and command-bar picks reach them; a pasted `?mode=`, a Back step
   * and a reload do not. The same *a mount is not a click* line activation.ts draws.
   *
   * **Component state and not the URL**, which is url-state.md applying rather
   * than being excepted: the URL is for what a link or a reload should
   * reproduce, and this is the one thing a reload must not.
   * docs/plans/260915e-the-mode-names-itself-briefly-when-a-reader-opens-it.md.
   */
  const [herald, setHerald] = useState<HeraldPress | null>(null);
  /* A press whose mode is no longer the one on screen — Back inside the three
     seconds — is over, rather than waiting to reappear if Forward comes back. */
  useEffect(() => {
    if (herald !== null && herald.mode !== mode) setHerald(null);
  }, [herald, mode]);

  /**
   * **Open Search for the command bar's *Quick search “X”* row** (plan
   * 261005i) — `showBand`, plus the arrival rule the Dock's press runs for
   * Search: its herald names the mode, and a rail the reader had put away comes
   * back, since that is where the hits are drawn (`arrivalBringsRailBack`; F2
   * on the plan). The Dock's Search arrival calls this same opener.
   */
  const openQuickSearch = useCallback(() => {
    showBand("search");
    setHerald((prev) => ({ mode: "search", nonce: (prev?.nonce ?? 0) + 1 }));
    if (arrivalBringsRailBack({ next: "search", current: mode, showSpine })) void setShowSpine(null);
  }, [showBand, mode, showSpine, setShowSpine]);

  /**
   * What stands between a visitor and the mode they have opened, if anything.
   *
   * `null` for the owner, and for every mode drawn from the payload the visitor
   * already holds — Plain, Structure, Summary: they cost nothing, so a stranger
   * gets all of them. visitor.ts.
   */
  const gap = owner ? null : visitorGap(mode, available);
  /* The dimmed buttons in the bottom bar. Memoised because it builds a Set and
     `Dock` takes it by identity; empty for the owner, which is the same object
     every render. */
  const marked = useMemo(
    () => (owner ? EVERY_MODE_AVAILABLE : markedModes(available)),
    [owner, available],
  );
  /* The bar's Comments drawer needs it for the same one reason the bands do. */

  /* One answer for both the live fit and the Marginalia press's hypothetical
     fit. Keeping the value shared stops the press swapping columns at a
     threshold different from the layout it is about to draw. */
  const bandShape = bandShapeFor(mode, summaryView);

  const fit = useMemo(
    () =>
      fitView({
        windowWidth,
        modeBand: bandOpen,
        /* Which band each mode gets, and why: layout.ts § `bandShapeFor`. */
        bandShape,
        margin: marginOpen,
        rootFontPx,
        showSpine,
      }),
    [windowWidth, rootFontPx, bandOpen, marginOpen, showSpine, bandShape],
  );
  /* **Where the notes would fit**, for the Marginalia press: beside the band
     that is open, and with no band. A press reads both to decide whether it
     swaps the band out (`marginaliaPress`, 261001k). */
  const wouldFit = useMemo(
    () =>
      notesFit(
        {
          windowWidth,
          bandShape,
          rootFontPx,
          showSpine,
        },
        bandOpen,
      ),
    [windowWidth, rootFontPx, bandOpen, showSpine, bandShape],
  );

  /**
   * The arc — one sentence per part on where the argument stands there — keyed
   * by the row each part starts on.
   *
   * **Structure's list face is the only thing that reads this now**, as its
   * rung 4 (`OutlinePanel` § `row.arc`) — Outline mode's, until Outline became
   * that face on 2026-09-10. It used to draw Hierarchy's L0 column as
   * well, until that column went on 2026-09-05.
   *
   * **The owner's live arc, falling back to the payload's.** An owner may have
   * arrived without one and had it written while they read, so theirs comes
   * from `useArc` — which also returns `null` for an arc it knows to be stale,
   * rather than showing sentences whose ranges no longer match. A visitor has
   * only the payload. src/web/useArc.ts.
   */
  const liveArc = capability.kind === "owner" ? (capability.arc.arc ?? undefined) : article.arc;
  const arcCells = useMemo(
    () => buildArcColumn(geometry, liveArc),
    [geometry, liveArc],
  );

  /**
   * **The headings breadcrumb's tree** — the one Structure draws, cut at the
   * section depth so the path never names a paragraph. HeadingsCrumbs.tsx,
   * crumbs.ts.
   */
  const crumbsRoot = useMemo(
    () =>
      experimental.on
        ? buildSummaryTree(article.tree, article.blocks, sectionDepth(geometry))
        : null,
    [experimental.on, article.tree, article.blocks, geometry],
  );
  /**
   * **Is a band lying over the prose?** A band is open and there is no room
   * for it beside the article (`fit.modeW === 0`), so it is the whole window —
   * a phone with a mode open. **Not `fit.modeW === 0` alone**: that is also
   * true with no band open at all (Plain on a phone).
   *
   * Declared once, here, above everything that asks. Until 2026-10-04 it was
   * declared below two of its own re-derivations and written out again in
   * four more places. Still true while the band has stepped aside — that is
   * `bandBack`, below.
   */
  const bandCovers = bandOpen && fit.modeW === 0;
  /**
   * **Is the breadcrumb drawn?** For a reader with Experimental features on,
   * at every scroll position — Greg, 2026-09-29 (spya-m3pteb): *"always
   * present if experimental features are turned on, and invisible if not"*.
   *
   * **Not while a band covers the prose** (a phone with a mode open): the
   * shell's guard would pin the bar over the band, and the band is what is on
   * screen. That includes the band *stepped aside* (`bandAway`), deliberately
   * for v1: drawing the bar the moment a band link is followed would push the
   * prose down by the bar's height in the middle of that jump, before its
   * position write has landed (GPT Sol, plan review of 261002h, finding 2).
   *
   * **Not for a tree with nothing to name** either, or the bar is a blank
   * strip. A tree where no part has a title or a navLabel is the case.
   *
   * **On a narrow window it also sets the bar's height**: three lines, in a
   * taller bar, while this is true (crumbs.css § a narrow window) — which is
   * why it is in `layoutKey` below.
   *
   * **Not while Structure or Marginalia's head is on screen** — Greg,
   * 2026-10-04 (spya-rx43ku): *"We don't need to show that horizontal rail when
   * either structure or annotations mode are on, because they both provide
   * that information too."* Structure's band has its own "you are here";
   * Annotations is Marginalia, whose head ordinarily names the part and the section. For
   * Marginalia "on" means *drawn*: `?margin=1` on a window with no room for the
   * column shows no head, so the breadcrumb stays there. For an owner the bar
   * goes with it (`showBar` below), which `layoutKey` already hears. The plan
   * records the empty-head and contained-failure exceptions; the commonest
   * empty head, the rows above the first part, was closed by 261004l
   * (notes.ts § `headBlock`), and a gap further down the tree still draws none.
   * docs/plans/261004k-hide-the-headings-rail-while-structure-or-marginalia-is-on.md
   *
   * The tree itself is not built while the switch is off. `Reader` renders for
   * every scroll-independent state change, and an experimental feature should
   * not add a full block map and tree walk for readers who cannot see it.
   */
  /** Marginalia's column is on screen: switched on, and the window has room for it. */
  const marginRoom = marginOpen && fit.margW > 0;
  const showCrumbs =
    experimental.on &&
    !bandCovers &&
    mode !== "structure" &&
    !marginRoom &&
    (crumbsRoot?.children.some((c) => isCrumbSection(c) && nodeLabel(c, c.title) !== null) ?? false);
  /**
   * **Is the controls bar drawn at all?** For a visitor, whose read-only chip
   * is in it, and since 2026-10-02 for anybody it holds the breadcrumb for.
   * The Parts / Sections / Paragraphs pills that were the rest of it went
   * with the Hierarchy mode on 2026-09-29
   * (docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md § 7). On
   * a narrow mode view the chip is the only thing telling a visitor they are
   * read-only, so the bar stays for it.
   *
   * The CSS half is `:root:not(:has(.controls))` in shell.css § the bar that
   * leaves while you read, which lets `--bar-bottom` fall to the status-bar
   * inset when this is false. Nothing in `scroll.ts` needs telling: both
   * `stickyOffset` and `stickyDestination` already answer `--safe-top` for an
   * absent bar, and measure a present one.
   */
  const showBar = owner === null || showCrumbs;

  // A string, so it compares by value: a fresh object every render would restart the scroll
  // listener every render. `modeW` is in it because entering a mode moves every
  // row on the page sideways, and the `?at=` tracker holds row elements it
  // measured before the move. `spine` is in it for a stronger reason than
  // sideways: the rail's width is taken out of the prose column's, so hiding it
  // rewraps every paragraph in the article and every row changes height.
  // `tableW` and `margReserve` since 2026-10-01: Marginalia moves and narrows
  // the prose with `modeW` still 0, so without them switching into it at a
  // medium width rewrapped the article under an unchanged key (GPT Sol, F2 on
  // docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md).
  //
  // `showBar` since 2026-10-02: the controls bar is in flow above the table
  // (`--bar-h`, 44px by default), and it now comes and goes with the
  // experimental switch, which loads after the article and can be pressed
  // mid-read. That moves every row down without resizing the table, so the
  // table's ResizeObserver hears nothing (GPT Sol, plan review of 261002h,
  // finding 1).
  //
  // `tallCrumbsBar` since 2026-10-03: on a narrow window the bar is taller
  // while it holds the breadcrumb (crumbs.css § a narrow window), so its
  // height follows this state rather than `showBar`. A signed-in reader of
  // somebody else's article keeps the View-only chip's bar while the
  // breadcrumb comes and goes, and the rows move under an unchanged `showBar`
  // (GPT Sol, plan review of 261003n, F1).
  //
  // The width predicate is the CSS media query's, not `windowWidth`: that
  // value is the page beside a classic scrollbar, while media queries ask the
  // viewport. Raw `showCrumbs` was briefly keyed here and made a wide visitor's
  // one-line breadcrumb look like a reflow, restoring `?at=` and moving them to
  // the section start under an unchanged 44px bar (261003h postmortem).
  const tallCrumbsBar =
    showCrumbs && media(`(max-width: ${NARROW_WINDOW_MAX}px)`);
  const layoutKey = `${windowWidth}|${fit.modeW}|${fit.spine}|${fit.tableW}|${fit.margReserve}|${showBar ? 1 : 0}|${tallCrumbsBar ? 1 : 0}`;

  /**
   * **Is the prose on screen, for the reading-time recorder** — only this
   * component knows. No band lying over it: `fit.modeW === 0`
   * alone is also true with no band open at all (Plain on a phone), which is
   * why `.band-covers` could not be the test.
   * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md
   * § What counts as a second.
   */
  const setReadingCounting = owner?.readingTime.setCounting;
  /* A band that has stepped aside (`bandAway`) is not lying over anything. */
  const bandOverProse = bandCovers && !bandAway;
  const proseOnScreen = !bandOverProse;
  useEffect(() => {
    setReadingCounting?.(proseOnScreen);
  }, [setReadingCounting, proseOnScreen]);
  /* **What chat is told is on screen**, read once per question — the same
     `proseOnScreen` the recorder above trusts, so a band lying over the prose
     on a phone reports nothing rather than the rows hidden under it.
     docs/plans/261001q-chat-knows-the-blocks-on-screen.md. */
  const chatOnScreen = useCallback(
    (): readonly BlockId[] => (proseOnScreen ? blocksOnScreenNow() : []),
    [proseOnScreen],
  );
  /* **A jump made while a band lay over the prose flashes when the prose comes
     back** — the band closed or stepped aside. flash.ts holds it until then,
     reading the same fact off the DOM (`.band-covers`, a `.mode-band`, no
     `.band-away`), which this effect runs after. Sol F2 on
     docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md. */
  useEffect(() => {
    if (!bandOverProse) flushPendingFlash();
  }, [bandOverProse]);
  /* **A held flash belongs to the mode that made it.** Since Skim's ‹ › stopped
     stepping a covering band aside (spya-kudr63, plan 261003l) a flash can sit
     held for as long as the reader walks the route. Leaving for Plain plays it,
     above, which is the point. Leaving for *another covering band* must not
     keep it: the prose can be moved from there by a path that never passes
     `beginJump` and so never drops it (comment-jump.ts § `stepToComment`, for
     one), and the next time the prose is exposed the old stop would wash,
     wherever the reader had got to. A change which exposes the prose skips the
     drop (`bandOverProse` is false), then the passive effect above plays it.
     Only on a real change of mode, never on mount; the hook's layout effect runs
     before an incoming child's passive landing effect, so that new flash survives. */
  useModeFlashOwnership(mode, bandOverProse);
  /* A held or live flash belongs to this article. ArticlePage keys the reader
     by slug, so leaving it unmounts here; clear both the pending id and the live
     removal timer rather than retaining a detached prose cell for 1.2s. */
  useEffect(() => resetFlash, []);
  const { at, jumpTo, rowOf } = useReadingPosition(sections, article.blocks, layoutKey);
  /* The quiz's "Where to look again" names the same sections the reader sees
     here — docs/plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again.md. */
  const quizSections = useMemo(() => ({ sections, rowOf }), [sections, rowOf]);
  /**
   * **A jump that starts inside a band.** The same `jumpTo`, and then — where
   * the band lies over the whole article, which on a phone it does — the band
   * steps aside, so the paragraph the reader asked for is what they see.
   *
   * > close the panel on link tap on phone for all modes
   * >
   * > — Greg, 2026-09-29
   *
   * *Steps aside* (`bandAway`) rather than `?mode=plain`: the band stays mounted,
   * so a Chat draft, a Quiz answer half-typed and a Search query survive, and the
   * "back to ⟨mode⟩" pill (`BandBackChip`) puts it back exactly as it was.
   * Skim did this alone from 2026-09-28; this is the same state for every
   * mode. Handed to bands only — the spine, the table, the chat dialog and the
   * hover card keep plain `jumpTo`, since none of them is under a band.
   * docs/plans/260929g-on-a-phone-a-band-link-closes-the-band.md.
   */
  const bandBack = bandAway && bandCovers;
  /**
   * **Where focus was in the band when it stepped aside**, so it goes back
   * there when the band returns. A band that goes `display: none` takes a
   * keyboard or screen-reader user's focus with it; `BandBackChip` takes it in
   * the meantime. GPT Sol, plan review, 2026-09-29.
   */
  const bandFocus = useRef<HTMLElement | null>(null);
  const rememberBandFocus = useCallback(() => {
    const focused = document.activeElement;
    bandFocus.current =
      focused instanceof HTMLElement && focused.closest(".mode-band") !== null ? focused : null;
  }, []);
  /* Skim cannot use `bandJump` because it also jumps on opening, so its
     deliberate `onAway` path shares the focus handoff separately. */
  const bandStepsAside = useCallback(() => {
    /* A door can advance Skim while the band is already away. Preserve
       the band control that should receive focus when it eventually returns. */
    if (!bandAway) rememberBandFocus();
    setBandAway(true);
  }, [bandAway, rememberBandFocus]);
  const bandJump = useCallback(
    /* `aim`: a passage key (Skim, Citations), or the quotation a chip in a
       model's answer follows, to be painted on landing — flash.ts § `JumpAim`. */
    (blockId: BlockId, aim?: JumpAim) => {
      jumpTo(blockId, aim);
      if (!bandCovers) return;
      rememberBandFocus();
      setBandAway(true);
    },
    [jumpTo, bandCovers, rememberBandFocus],
  );
  /* **The Diagram walking the picture**: plain `jumpTo`, which does not step
     the band aside, and with the step's `ended` put in `jumpTo`'s third
     parameter rather than its second, which is a flash aim. The step buttons
     need to hear that their jump is over — keynav.ts § `Chain`. */
  const followTo = useCallback<FollowJump>((blockId, ended) => jumpTo(blockId, undefined, ended), [jumpTo]);
  useEffect(() => {
    if (bandBack) return;
    const was = bandFocus.current;
    bandFocus.current = null;
    if (was?.isConnected) was.focus({ preventScroll: true });
  }, [bandBack]);

  /**
   * **Tell the Feedback dialog where the reader is.** feedback-context.ts.
   *
   * Module state rather than props: the button is at the top level of the
   * window and every fact here is eight components down, so the alternative is
   * drilling six values up through the whole tree for one dialog. Ids only —
   * the slug, the tree's first block and the run of blocks around the reading
   * position — never a word of the article; the reasoning is
   * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md
   * § Article identifiers, not article prose.
   *
   * The view is `"article"` by construction: `OwnedArticle` and its visitor
   * twin answer `metadata` with its own page, so this component
   * is only ever mounted for the reading view.
   *
   * The cleanup clears it, so a report filed from the shelf a moment later does
   * not name an article the reader has already left.
   */
  useEffect(() => {
    const row = at === null ? -1 : article.blocks.findIndex((b) => b.id === at);
    const from = row < 0 ? 0 : row;
    setFeedbackArticleContext({
      slug,
      revisionId: null,
      view: "article",
      mode,
      /* No gist columns since 2026-09-29, so no granularity level to report. */
      level: null,
      blockCount: article.blocks.length,
      rootBlockId: article.tree.nodes[article.tree.rootId]?.range[0] ?? null,
      blockIds: article.blocks.slice(from, from + FEEDBACK_BLOCK_IDS).map((b) => b.id),
    });
    return () => setFeedbackArticleContext(null);
  }, [slug, article, mode, at]);


  /**
   * Comments and highlights: selecting prose opens the free annotation box.
   * Ask AI is an explicit second action, and its conversation arrives in the
   * separate floating chat dialog. See docs/project/comments.md.
   *
   * Note what is *not* here — no column, no change to `fit`, nothing threaded
   * through the layout arithmetic. That was the point of choosing a dialog.
   *
   * **Nothing here is fetched for a visitor.** `useComments` is mounted by
   * `OwnedReader`; what arrives here is its result, or the module-level empty
   * list — which is a constant rather than a fresh `[]` because half a dozen
   * memos below key on it by identity. reader-capability.ts.
   */
  const [note, setNote] = useQueryState("note", noteParam);
  /* **Either arm's comments, and the fallback is no longer `NO_COMMENTS`.**
     A visitor's come in the page's payload rather than from `useComments`, so
     this is the one line where the two sources meet — everything downstream
     (`ordered`, the gutter marks, the dialog's arrows) works on the result and
     does not know which it got. `NO_COMMENTS` is still what an owner gets
     before their fetch lands. src/web/reader-capability.ts.
     docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */
  const comments =
    capability.kind === "owner" ? capability.comments.comments : capability.comments;
  const commentError = owner?.comments.error ?? null;
  /* **A visitor's saved searches, and there is no owner arm to meet.** Unlike
     the comments above, the owner's searches are fetched inside `SearchBand`
     itself rather than held here — so this is not a seam between two sources,
     it is the one source there is, and `NO_SEARCHES` stands in where the
     question does not arise. A module constant rather than a fresh `[]`,
     because the band memoises on it by identity. reader-capability.ts § searches. */
  const searches = capability.kind === "visitor" ? capability.searches : NO_SEARCHES;
  /**
   * The floating chat, and the passage it is about.
   *
   * **One id, not two.** `?thread=` says which conversation is open and `mode`
   * says how it is drawn — full width in chat mode, floating over the article
   * anywhere else. An earlier draft of the plan added a `?chat=` beside it; a
   * GPT-5.6 review pointed out it carries nothing `mode` does not already
   * carry, and two ids that can disagree is a bug waiting to be written.
   *
   * `chatDraft` is the moment before there is a conversation at all: a passage
   * the reader selected, or a paragraph they pressed, with nothing stored and
   * nothing spent. It is component state rather than a parameter because there
   * is nothing to link to — and because the quote is the reader's selection,
   * which docs/project/logging.md and chat-handoff.ts both say does not belong
   * in an address.
   */
  const [thread, setThread] = useQueryState("thread", threadParam);
  const [chatDraft, setChatDraft] = useState<ChatTarget | null>(null);
  /**
   * **A question on its way into chat mode from another mode.** Two senders:
   * the glossary's *Ask in chat*, for a term the article does not contain, and
   * (since 2026-10-04) the button on a Summary paragraph, which carries the
   * paragraph across, quoted
   * (docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md).
   *
   * Not `chatDraft`, and that is Greg's call rather than tidiness: asked on
   * 2026-09-11 whether the question should go into the conversation already
   * there or a new one, he said *"fresh"*. `chatDraft` is the floating panel's
   * draft about a passage, and it is left exactly as it was — suppressed in chat
   * mode, back when the reader leaves. This one lives for one commit: the chat
   * band takes it, opens a new conversation with it in the box, and clears it.
   * `ChatHandoff` in ConversationModes.tsx says what else it guards against.
   */
  const [chatHandoff, setChatHandoff] = useState<ChatHandoff | null>(null);
  /* The one body both senders share: the text is ready-made, and the handoff
     and the mode are set in one event so they arrive in one commit. */
  const handToChat = useCallback(
    (question: string) => {
      setChatHandoff({ slug, question });
      showBand("chat");
    },
    [slug, showBand],
  );
  const askInChat = useCallback((term: string) => handToChat(askAboutTerm(term)), [handToChat]);
  const askAboutSummary = useCallback(
    (paragraphText: string) => handToChat(askAboutSummaryParagraph(paragraphText)),
    [handToChat],
  );
  const handoffTaken = useCallback(() => setChatHandoff(null), []);
  /* **And a handoff chat mode never took does not wait for the next visit.** The
     band takes it in the commit that switches mode, so this is the case where
     the switch did not happen, or the reader was elsewhere before it could —
     without it, the question would open a conversation the next time they
     pressed Chat, about a word they had long stopped asking about. The mode
     and the handoff are set in one event, so they arrive in one commit and
     this cannot fire in between. */
  useEffect(() => {
    if (mode !== "chat") setChatHandoff(null);
  }, [mode]);
  /**
   * **A quiz question pressed in the prose**, for Quiz to open at — `QuizArrival`
   * in QuizPanel.tsx, and SPIDERYARN-READING2-6V. The chat handoff's shape: set
   * in the same event as the navigation, taken by the band, cleared here — and
   * cleared if the reader leaves Remember before the band took it, so it cannot
   * wait for a later visit.
   */
  const [quizArrival, setQuizArrival] = useState<QuizArrival | null>(null);
  const quizArrivalTaken = useCallback(
    /* Only if it is still the one handed over: StrictMode hands it back twice,
       and a second press may have replaced it in between. */
    (taken: QuizArrival) => setQuizArrival((was) => (was === taken ? null : was)),
    [],
  );
  useEffect(() => {
    if (mode !== "remember") setQuizArrival(null);
  }, [mode]);
  /* **Mode, sub-mode and thread in one pushed entry** — Remember's rule 1
     (ConversationModes.tsx § RememberBand): `thread` cleared on the way to Quiz,
     so there is no frame in which the URL says both, and one Back undoes the
     whole trip. Not a press of the Quiz chip, so it arms nothing and can buy
     nothing: a line in the prose exists only because a quiz already does.

     **And no entry at all when Quiz is already open**: which question is open
     is not in the URL, so a second entry would hold the same address and cost
     the reader a Back that does nothing (the 260930i browser check). Read
     through a ref so that `openQuizAt` keeps its identity — it is in
     `quizAfter`'s memo, and a new one would re-render `TableView`. */
  const [quizNav, setQuizNav] = useQueryStates({
    mode: modeParam,
    remember: rememberParam,
    thread: threadParam,
  });
  /* **A mode and one of its sub-modes, in one pushed entry** — the command
     bar's sub-mode rows (Dock.tsx § `useActivateSubMode`; Greg, 2026-10-01,
     SPIDERYARN-READING2-77). One write so one Back undoes the trip, and so no
     band mounts on the old sub-mode for a frame. Which keys, and that Quiz
     clears `thread`, is `subModeParams` in sub-modes.ts — the same answer the
     metadata page builds its href from. */
  const [subNav, setSubNav] = useQueryStates({
    mode: modeParam,
    remember: rememberParam,
    thread: threadParam,
    diagram: diagramParam,
    referee: refereeParam,
    summary: summaryParam,
    structure: structureParam,
    debate: debateParam,
  });
  const inQuiz = useRef(false);
  const nowInQuiz = quizNav.mode === "remember" && quizNav.remember === "quiz" && quizNav.thread === null;
  useEffect(() => {
    inQuiz.current = nowInQuiz;
  }, [nowInQuiz]);
  const openQuizAt = useCallback(
    (batchId: string, questionId: BlockId) => {
      setQuizArrival({ batchId, questionId });
      if (!inQuiz.current)
        void setQuizNav({ mode: "remember", remember: "quiz", thread: null }, { history: "push" });
      /* A band that had stepped aside on a narrow window comes back: the reader
         has asked to answer. */
      setBandAway(false);
    },
    [setQuizNav],
  );
  /**
   * The passage the reader has just selected, before they have saved anything.
   *
   * Component state rather than a URL parameter for the same two reasons
   * `chatDraft` is: there is nothing to link to yet, and the quote is the
   * reader's selection, which docs/project/logging.md says does not belong in
   * an address.
   */
  const [annotating, setAnnotating] = useState<
    { blockId: BlockId; quote: string; start: number } | null
  >(null);
  /* `useChatAnchors` is mounted by `OwnedReader` too. A visitor gets the empty
     list, so no mark is drawn and `overlay` below can never resolve to a
     conversation — but the dialog is also gated on `owner` explicitly, because
     "the list happens to be empty" is a much weaker guarantee than "the branch
     does not exist". */
  const chatSummaries = owner?.chatAnchors.summaries ?? NO_THREADS;

  /* Memoised, and this is a performance fix rather than tidiness. Both of these
     build a fresh array and a fresh Map, so calling them inline in the JSX
     handed `TableView` two new object identities on **every** Reader render —
     including the ones caused by something with nothing to do with chat. That
     invalidated `marksByBlock` inside TableView, which re-derived the marks and
     could take the article-wide re-annotation with it: an O(article) job
     charged to an unrelated state change.

     Keyed on `summaries`, which is the only input either one reads, so the work
     now happens when a conversation is added, renamed or deleted and at no
     other time. Found by a GPT Sol review, 2026-08-27. */
  const chats = useMemo(() => anchored(chatSummaries), [chatSummaries]);
  const chatCounts = useMemo(() => countByBlock(chatSummaries), [chatSummaries]);

  /**
   * What is in the floating slot, decided in one place.
   *
   * `note` and `thread` are independent parameters and a pasted URL can carry
   * both, so "opening one closes the other" is a statement about clicks and not
   * about state. Chat wins, matching how an overlapping mark resolves.
   *
   * Suppressed in chat mode, where the band already shows that conversation and
   * a floating copy on top of itself is nonsense. The parameter stays, so
   * leaving the mode brings the panel back where the reader left it.
   */
  const overlay: ChatTarget | null =
    /* **`!owner` first, and it is not redundant.** A visitor's `chatDraft` is
       never set and their summary list is empty, so both arms below already
       resolve to `null` — but that is an argument from two other pieces of
       state staying empty, and this is an argument from the branch not
       existing. The floating chat dialog fetches a conversation on mount. */
    !owner || mode === "chat" || mode === "remember"
      ? null
      : (chatDraft ??
        /* **Only a chat may be opened here, and that is not a tidy-up.**
           `?thread=` survives leaving the mode, so a pasted
           `?mode=toc&thread=<a Remember thread>` used to mount this dialog over
           a Remember conversation — chat's UI and composer rather than Remember's, and the
           next question answered with chat's prompt. Nothing on screen would
           have said so. Gating on the summary's `kind` is what `ThreadSummary.kind`
           exists for; a Remember thread with no matching summary simply opens
           nothing,
           which is the same thing a stale id already did. GPT Sol's review of
           docs/plans/260827ah-review-mode.md, finding 7. */
        /* **A positive test, not a negative one.** `?.kind !== "remember"`
           (spelled `review` at the time) was
           the first version and had its default backwards: an *unknown* thread
           — summaries not fetched yet, or a stale id — came out as a chat, so a
           Remember URL opened the floating chat dialog for a moment on every
           load, and a missing thread sat on "Starting…" forever. Asking for
           `=== "chat"` means the overlay opens only for a thread we can see is
           one. GPT Sol's review of the built code, finding 3. */
        (thread && chatSummaries.find((t) => t.id === thread)?.kind === "chat"
          ? { kind: "thread" as const, threadId: thread }
          : null));

  /**
   * **The block the floating panel is about**, for the prose to mark
   * (`td.text.chat-open`) — the panel is fixed to the window, docked or not, so
   * its position says nothing about which paragraph it belongs to.
   *
   * A draft carries its anchor. A thread's is on its summary, the same list
   * `overlay` has just looked the thread up in, and a conversation about the
   * whole piece has none: `null`, and no mark. Derived from `overlay`, so it
   * is `null` in the two conversation modes and for a visitor without saying
   * so again. A string, so `memo(TableView)` holds while it does not change.
   */
  const chatOpenBlock: BlockId | null =
    overlay === null
      ? null
      : overlay.kind === "draft"
        ? overlay.anchor.blockId
        : (chatSummaries.find((t) => t.id === overlay.threadId)?.anchor?.blockId ?? null);

  /**
   * **Every** glossary term, so every one of them can be underlined in the
   * prose — in any mode, and whether or not the band has ever been opened.
   *
   * Greg's call, 2026-08-26: *"Glossary entries should always be underlined in
   * the verbatim text column, even outside Glossary mode, and hover should show
   * a rich tooltip."* That reverses a decision this file used to state in the
   * comment on `term` below and styles.css still explains at length — the marks
   * used to appear only while a term was pressed, so that the article acquired
   * annotation on the reader's initiative rather than the model's. What carries
   * that principle now is the *card*: the line is quiet and standing, and the
   * explanation still only arrives when the reader points at something.
   *
   * **One read, shared with the band.** `useGlossaryRead` is the opening fetch
   * — the list and the three facts about whether it still describes the article
   * and the reader — and `GlossaryBand` layers the job poller and the verbs on
   * top of it rather than starting from `loading` of its own. Until 2026-08-27
   * it fetched the same URL again, so the panel said "Looking for a glossary…"
   * while the list it wanted was already on screen, underlined, in the prose
   * behind it. docs/plans/260827am-glossary-read-latency.md.
   *
   * The band does still *revalidate* when it opens — see `useGlossaryRead` for
   * why it has to — but behind the list, never in front of it.
   *
   * `GlossaryBand` still exists for the reason it always did, which was never
   * the opening fetch: subscribing to the job engine puts it on its idle
   * cadence, and a reader who never opens the band should not pay for that.
   */
  const glossaryRead = owner?.glossary ?? null;
  /* **A visitor's terms are underlined too**, and that is the whole of what
     slice 1b bought here: the list is in the payload, so the dotted underlines
     and the hover cards are a standing property of a shared article exactly as
     they are of the owner's. `PublicGlossaryEntry` is a `GlossaryEntry` with
     the owner's lookup absent (src/public-types.ts), so the same scan reads
     both. `NO_TERMS` is a module constant rather than a fresh `[]`, because
     half a dozen memos below key on it by identity — reader-capability.ts. */
  const allTerms: GlossaryEntry[] =
    glossaryRead?.glossary?.entries ?? artefacts?.glossary?.entries ?? NO_TERMS;
  /* **Without the ones the owner hid** — the one visible list
     (src/web/glossary-shown.ts), so a hidden term has no underline, no card
     and no G, in every mode. The same array when nothing is hidden, so the
     memos below keyed on it do not rebuild. A visitor's list never carries
     `hidden`. Plan 261002c § 2. */
  const terms = useMemo(() => shownEntries(allTerms), [allTerms]);

  /**
   * The glossary term the reader has *pressed* in the panel, of the many now
   * drawn.
   *
   * **Held here rather than in the glossary band, and that is not where it
   * wants to live.** `useGlossary` fetches on mount and polls the job list, so
   * it has to stay inside a component that only exists in glossary mode —
   * otherwise every reader of every article pays for a list almost none of them
   * open, which is the same reason `ConversationBand` exists. But the *marks* are drawn
   * in the prose, which is `TableView`'s, and that is here.
   *
   * So the band pushes the selection up as it changes, and clears it on the way
   * out. The state is a plain setter, which is stable, so the effect that does
   * the pushing cannot loop. It is one line more than lifting the whole hook,
   * and it is the line that keeps the fetch where it belongs.
   *
   * Since every term is underlined, being selected can no longer mean *having*
   * a mark. It means a **different** mark — `mark.term[data-term-open]` — which is
   * the same thing the open comment and the pressed search hit already do.
   */
  const [term, setTerm] = useState<TermSelection | null>(null);

  /**
   * The whole list, as the prose needs it: spellings and the blocks to look in.
   *
   * Memoised on the entries and **deliberately not on which one is pressed**,
   * which is the whole point of it being separate from `term` below. This is
   * the input to a scan of the article — `termMarks` in annotate.ts — and
   * folding the pressed id in here meant every press re-compiled every pattern
   * and re-parsed every block that has a term in it, to change one attribute.
   * A GPT Sol review measured that at 44–135ms on a 400-block, 60-term article.
   * `TableView` takes the pressed id as its own prop and applies it at the end.
   */
  const termSelections = useMemo<TermSelection[]>(
    () =>
      terms.map((entry) => ({
        id: entry.id,
        forms: formsOf(entry),
        blocks: entry.blocks,
      })),
    [terms],
  );

  /**
   * **The works the piece cites, as the prose needs them**: an id and the
   * verified places, and nothing else.
   *
   * Greg, 2026-09-12 (SPIDERYARN-READING2-3M): *"just as we do with quotes and
   * glossary … once generated, we should always visually indicate Citations
   * somehow in the main text"*. So this is the whole list, in every mode,
   * whether or not the band has ever been opened — `citeMarks` in annotate.ts.
   *
   * **The prose marks and their cards stay owner-only.** A visitor does have a
   * public projection of the list in the Citations band since 260929c, but this
   * prose path deliberately has no `?? artefacts?.citations` fallback, unlike
   * `terms` above. So `works` is empty for them, and the card's owner-only
   * `inSpideryarn` line has the named `showInSpideryarn` lock as well.
   * docs/project/citations.md § Who sees it.
   *
   * **Every work, not only those above the threshold bar**, which departs from
   * what quotes mode does and follows what the glossary does. `?citebar=` is
   * reachable only inside Citations mode while these marks are visible from
   * every mode, so barring them here would change a paragraph's appearance
   * from a control the reader has no way to see. Fable, 2026-09-16.
   *
   * `mentions` and `reference` together, and `start` deliberately dropped on the
   * way: the stored offset is in `block.text`'s space and these marks live in
   * the rendered text's. `CiteSelection` says why that is a property of the type
   * rather than a habit of this call site.
   */
  /**
   * The list itself, for the hover card — the marks need only ids and places,
   * but the card draws the whole work.
   *
   * `NO_WORKS` is a module constant rather than a fresh `[]` because two memos
   * below key on it by identity, and an article with no citations is the
   * ordinary case. Empty for a visitor: the prose marks are owner-only even
   * though a visitor's band now has a public projection (260929c) — see
   * `citeSelections`. Not the only lock: `showInSpideryarn` below names the
   * owner-only part of the card.
   */
  const works: readonly CitedWork[] = owner?.citations.citations?.citations ?? NO_WORKS;

  /**
   * **Point at a citation in the prose and press *Dig deeper*** — Greg,
   * 2026-10-03 (report `spya-c2qmbg`): *"What I was hoping is that it would
   * have a button for dig deeper in the tooltip."* Plan 261004b.
   *
   * Starts the row's own *Dig deeper* and opens Citations on that row, where
   * the answer streams — `openTermInGlossary`'s shape, one feature over. The
   * verb and its state are on the citations read since the same plan, because
   * the band that used to hold them is not mounted in the mode the reader
   * pressed from. `citeFocus` is a one-shot the band hands back once the row is
   * in view (CitationsPanel.tsx § `Props.focus`); it is state rather than a URL
   * parameter because nothing about it should survive a reload.
   *
   * `null` for a visitor, whose arm has no read: no button is drawn.
   */
  const [citeFocus, setCiteFocus] = useState<CiteFocus | null>(null);
  /* Only the request that was served: a second press may have replaced it. */
  const citeFocusTaken = useCallback(
    (taken: CiteFocus) => setCiteFocus((now) => (now?.n === taken.n ? null : now)),
    [],
  );
  const investigateCitation = owner?.citations.investigate ?? null;
  const citationDigging = owner?.citations.investigating ?? null;
  const citeActions = useMemo<CiteActions | null>(
    () =>
      investigateCitation === null
        ? null
        : {
            digging: citationDigging,
            dig: (id) => {
              void investigateCitation(id);
              setCiteFocus((was) => ({ id, n: (was?.n ?? 0) + 1 }));
              /* A passage jump can leave this very mode mounted but hidden
                 on a narrow window: `showBand`. */
              showBand("citations");
            },
          },
    [investigateCitation, citationDigging, showBand],
  );

  const citeSelections = useMemo<CiteSelection[]>(
    () =>
      works.map((work) => ({
        id: work.id,
        places: [...work.mentions, ...(work.reference ? [work.reference] : [])].map((p) => ({
          blockId: p.blockId,
          quote: p.quote,
        })),
      })),
    [works],
  );

  /**
   * Point at a term in the prose and press "Open glossary": open the band on
   * that entry.
   *
   * The `?term=` subscription that `GlossaryBand` deliberately keeps to itself
   * is not duplicated here — this writes the parameter through the same nuqs
   * setter the band reads, and the band picks it up when it mounts. Two setters
   * on one parameter is fine; two *subscriptions* were what that comment was
   * about.
   */
  const [, setTermId] = useQueryState("term", termParam);
  /**
   * And the threshold, for one reason only: **a term the bar is hiding cannot
   * be opened.**
   *
   * Since 2026-09-03 the prioritised glossary hides what is below the gate
   * rather than grouping it, so pressing "Open glossary" on a low-scoring
   * term would take the reader to a band with no such row in it — the panel
   * asked to select something it is not drawing. `gateToReveal` answers the
   * gate that puts it back, and null when the current one already shows it.
   *
   * **Lowered, not cleared**, and not swapped for `document` order: the reader
   * stays in the order they chose, and the slider visibly moves, so nothing
   * happens behind their back. Written through the same nuqs setter the band
   * reads, exactly as `?term=` above is — two setters on one parameter is fine.
   */
  const [gate, setGate] = useQueryState("gate", gateParam);
  /**
   * And the order, read here for one reason: **a gate nothing is hiding with
   * must not be lowered.**
   *
   * `?sort=document&gate=0.80` is a perfectly ordinary URL — the gate is
   * dormant, no slider is on screen, and no term is hidden. Lowering it there
   * would set a threshold the reader never chose and never saw, waiting for
   * them the next time they picked the prioritised order. So the decision is
   * `gateToReveal`'s, and it takes the sort. GPT Sol's third finding on the
   * built code, 2026-09-03.
   */
  const [sort] = useQueryState("sort", sortParam);
  const openTermInGlossary = useCallback(
    (id: string) => {
      void setTermId(id);
      const lowered = gateToReveal(terms, id, sort, gate ?? PRIORITY_GATE);
      if (lowered !== null) void setGate(lowered);
      showBand("glossary");
    },
    [setTermId, showBand, setGate, gate, sort, terms],
  );

  /**
   * **A link on Skim's stop card** — into Glossary on `?term=`, Ideas on
   * `?idea=`, or Timeline on `?event=` when that experimental control is
   * available. A term goes through `openTermInGlossary` for the gate it may
   * need to lower; the other two are the same two writes, through setters on
   * the parameters those bands read, exactly as `?term=` above is.
   * src/web/stop-card.ts.
   */
  const [, setIdeaId] = useQueryState("idea", ideaParam);
  const [, setEventId] = useQueryState("event", eventParam);
  const canOpenFromStopCard = useCallback(
    (target: CardTarget) => {
      /* A term the owner hid has no row to open on. stop-card.ts already
         leaves hidden terms off the card; this is the second lock, for a card
         gathered before the hide landed (GPT Sol's plan review, finding 2). */
      if (target.kind === "term" && allTerms.some((e) => e.id === target.id && e.hidden)) return false;
      const targetMode = modeForCardTarget(target);
      return shownBehindTheSwitch({
        experimental: MODE_CATALOG[targetMode].experimental,
        on: experimental.on,
        current: mode === targetMode,
      });
    },
    [experimental.on, mode, allTerms],
  );
  const openFromStopCard = useCallback(
    (target: CardTarget) => {
      /* The event stays useful scrapbook text while Timeline's control is
         hidden. Guard the action too, across the render where the switch flips. */
      if (!canOpenFromStopCard(target)) return;
      switch (target.kind) {
        case "term":
          openTermInGlossary(target.id);
          return;
        case "idea":
          void setIdeaId(target.id);
          void setMode("ideas");
          return;
        case "event":
          void setEventId(target.id);
          void setMode("timeline");
          return;
        default: {
          const never: never = target;
          return never;
        }
      }
    },
    [canOpenFromStopCard, openTermInGlossary, setIdeaId, setEventId, setMode],
  );

  /**
   * The search results whose marks are drawn in the prose, and which of them
   * the reader last pressed.
   *
   * Held here for exactly the reason `term` above is, and the comment there is
   * the full version: `useSearch` fetches on mount, so it has to live inside a
   * component that only exists in search mode, but the *marks* are drawn by
   * `TableView`, which is here. So the band pushes its results up as they
   * change and clears them on the way out.
   *
   * Note what is pushed: the **ordered, resolved** results, not the raw hits.
   * The panel and the prose must be showing the same set — see the `hitMarks`
   * prop in TableView.tsx — and the only way to guarantee that is for one of
   * them to compute it and hand it to the other.
   */
  const [found, setFound] = useState<Found[]>([]);
  const [openHit, setOpenHit] = useState<string | null>(null);

  /**
   * The selected idea's passages — **its own state, deliberately not `found`.**
   *
   * Ideas resolves into the same `Found[]` search does and draws through the
   * same marks, so sharing one piece of state looks like the obvious economy.
   * It is a bug, and a silent one. `SearchBand` pushes into `found` from a
   * **layout** effect and clears it from a **passive** unmount cleanup, and both
   * of those are deliberate (see the comments there). Passive cleanups flush
   * *after* paint and layout effects run *before* it, so switching search →
   * ideas would run:
   *
   *   IdeasBand's layout push   → passages written   (before paint)
   *   SearchBand's passive clear → passages wiped    (after paint)
   *
   * The outgoing mode tidies up on top of the incoming one, and nothing errors.
   * It does not happen today between glossary and search only because those two
   * clear different state. Two states and one `mode` test below is the whole
   * fix. Found by GPT Sol reviewing the plan; docs/plans/260826ac-ideas-mode.md.
   */
  const [ideaFound, setIdeaFound] = useState<Found[]>([]);
  const [openOccurrence, setOpenOccurrence] = useState<string | null>(null);
  /**
   * **The quotes, and they are not a state at all** — since 2026-09-08.
   *
   * Every other slot on this page is a `useState` a band writes into, because a
   * band holds the fetch and `Reader` holds the prose. The quotes stopped
   * working that way when Greg asked for them to be marked *"even if we're not
   * in quotes mode"* (SPIDERYARN-READING2-2P): marks published by a band live
   * exactly as long as the band, and everything the quote marks are made of —
   * the artefact, `?quote=`, `?rank=`, `?bar=`, the blocks — is state this
   * component already holds. So there was nothing for the band to tell us.
   *
   * The publication protocol went with it: no `setQuoteFound`, no
   * `setQuoteOpenKey`, and no `derived` arm on `usePassageLifecycle`, whose only
   * caller this was. What that arm bought — the marks and the ring landing in
   * one commit, so no paint can show the ring on one quote and the washes of
   * another set — a memo has by construction.
   * docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md.
   */
  const quoteSource =
    capability.kind === "owner" ? capability.quotes.quotes : (artefacts?.quotes ?? null);
  const allQuotes = quoteSource?.quotes ?? NO_PUBLIC_QUOTES;
  const quotes = useQuoteMarks(article.blocks, quoteSource);
  /* **A fourth state, for the reason the second and third have their own**, and
     not because Timeline needs anything ideas do not: two modes sharing one
     `Found[]` clear each other on the way out, and which one wins is an
     accident of whether the outgoing mode's cleanup is passive and the incoming
     mode's push is layout. Unlike quotes, this one keeps an `openKey` — an
     event mentioned in two paragraphs is rare (26 of 26 on the test article
     have one) but it is real, because the article recounts the same three
     months once per civilisation. */
  const [timelineFound, setTimelineFound] = useState<Found[]>([]);
  const [openTimelineKey, setOpenTimelineKey] = useState<string | null>(null);
  /* **A fifth state, for the reason the second, third and fourth have their
     own**: two modes sharing one `Found[]` clear each other on the way out, and
     which one wins is an accident of whether the outgoing mode's cleanup is
     passive and the incoming mode's push is layout.

     **And an `openKey` of its own since 2026-09-02**, which it did not have and
     should have: pressing a criterion result jumped to the *block*, and the
     phrase the row was about was never distinguished, while Search's identical
     rows have always got the `mark.hit[data-hit-open]` ring. That is the
     panel→prose direction a referee actually travels, and it matters more now
     the stripe carries a direction rather than an identity — the ring is what
     says *this red phrase is the row you pressed*. GPT Sol's finding 2;
     docs/plans/260902f-make-referee-mode-understandable.md. */
  const [refereeFound, setRefereeFound] = useState<Found[]>([]);
  const [openRefereeKey, setOpenRefereeKey] = useState<string | null>(null);
  /* **A sixth, for Skim's current stop**, for the reason the others have
     their own. It holds one passage — the quote the reader is standing on —
     and `proseFound` sees that it is the quote's own mark and draws it once.
     docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
     § Prose (F9). */
  const [skimFound, setSkimFound] = useState<Found[]>([]);
  const [openSkimKey, setOpenSkimKey] = useState<string | null>(null);
  /* **And the band's handle**, for the two things outside it that step the
     route: ← / → (`useArrowNav` below) and the door after the stop's block
     (`TableView`'s `afterBlock`). `SkimControl` says why it is stable. */
  const [skimControl, setSkimControl] = useState<SkimControl | null>(null);
  /* **The quiz's ← / →**, handed up by `QuizPanel` while it is mounted and
     `null` once it is not — so Recall, or any other mode, leaves ← / → with the
     browser (keyboard.md § ← / → in Quiz). One stable function
     for the panel's life; the setter wraps it because a function passed to a
     state setter is an updater. */
  const [quizKeys, setQuizKeys] = useState<((dir: -1 | 1) => boolean) | null>(null);
  const onQuizKeys = useCallback(
    (handler: ((dir: -1 | 1) => boolean) | null) => setQuizKeys(() => handler),
    [],
  );

  /* Two maps, memoised separately from everything else on the page. `found`
     changes on every keystroke in words mode, and recomputing every comment's
     anchor for an article's worth of blocks at that rate is the one thing that
     would make typing feel slow. Same reasoning as the second map in
     TableView.tsx. */
  /* **One list, chosen by mode, feeding every memo below.** The marks, the
     paragraph bar and the rail must all be about the same passages, and the way
     to guarantee that is for one expression to decide and everything else to
     read it — the same "compute once, hand to both" rule the panel and the
     prose already follow. The modes are mutually exclusive, so this is a pick
     rather than a merge.

     **One call rather than two ternary chains, since 2026-09-06.** The chains
     agreed only because both tested `mode` in the same order, and both ended in
     Search's slot — so every mode with no passage producer was reading
     Search's, and were correct only for as long as `SearchBand`'s unmount
     cleared it. (That clear became a layout cleanup earlier the same day, which
     is what removed the frame this used to paint on the way into Plain.)
     `selectPassages` is total over `Mode` and hands back one slot's *pair*, so
     the marks and the ring cannot come from different bands.
     reader/passages.ts. */
  const { found: passages, openKey: openPassage } = selectPassages(mode, {
    ideas: { found: ideaFound, openKey: openOccurrence },
    quotes,
    timeline: { found: timelineFound, openKey: openTimelineKey },
    referee: { found: refereeFound, openKey: openRefereeKey },
    search: { found, openKey: openHit },
    skim: { found: skimFound, openKey: openSkimKey },
  });
  /**
   * **The marks under the phrases are the open mode's passages PLUS the
   * quotes; the three block-level projections below are the open mode's
   * alone.**
   *
   * This is the one place the two questions differ, and `proseFound` in
   * reader/passages.ts carries the argument — briefly: a quote has no
   * `confidence`, so `blockStrength` would paint its paragraph's bar at full
   * over a hedged search's, and every quote has `slot: 0`, which is the first
   * saved search's colour. In quotes mode the two are the same array and
   * `proseFound` hands it straight back.
   */
  const proseMarked = useMemo(() => proseFound(passages, quotes.found), [passages, quotes.found]);
  /* **One ramp for the whole of Referee mode**, read here because this is where
     the marks are built. `?refscale=` and not `referee_criteria.scale`: the two
     ramps put red at opposite ends of the truth, so a per-criterion choice
     would have meant one red underline meaning opposite verdicts in one
     document. `refScaleParam` in params.ts has the whole argument.

     Read unconditionally rather than inside the referee branch — a hook cannot
     be conditional — and it costs nothing in every other mode, where no passage
     carries a valence and the scale is never consulted. */
  const [refScale] = useQueryState("refscale", refScaleParam);
  const hitMarks = useMemo(
    () => buildHitMarks(proseMarked, openPassage, refScale),
    [proseMarked, openPassage, refScale],
  );
  const hitStrength = useMemo(() => blockStrength(passages), [passages]);
  const hitHues = useMemo(() => blockHues(passages), [passages]);
  /* The same facts again, for the rail rather than for the prose — which
     searches matched where, plus how many times. Kept as its own memo beside
     the other two for the reason given on them: `found` changes on every
     keystroke in words mode, and this is the cheap half.

     Note it is `blockMatches` and not `hitHues`. A literal match has no palette
     slot, so `blockHues` drops it — right for the paragraph bar, which falls
     back to the one fixed search hue, and wrong for the rail, which would then
     show nothing at all in words mode. search-hits.ts § Why `null` survives.

     **Less any quote** (passages.ts § `railFound`), since 2026-10-02: the
     quotes have a strip of their own, so in a lane they would be drawn twice,
     in a search's colour, and counted as search matches. */
  const hitBlocks = useMemo(() => blockMatches(railFound(passages)), [passages]);
  /* **The quotes in the rail, in every mode** — their own strip down the left
     edge (spine-marks.ts § `quoteRailMarks`; Greg, 2026-09-10, spya-yd2c47).
     From `proseMarked`, what the prose actually fills, and not from
     `quotes.found`: Skim's stop can be a quote the bar hides from the band,
     resolved afresh and filled all the same (passages.ts § `proseFound`).
     `quoteAlphaByBlock` keeps only what carries the quote-painting field. */
  const quoteRail = useMemo(() => quoteAlphaByBlock(proseMarked), [proseMarked]);

  /**
   * The bottom drawer — see Dock.tsx, and docs/plans/260825c-bottom-bar.md for why the
   * bottom rather than the left.
   *
   * Note what is *not* here, for the same reason the comment dialog isn't:
   * nothing threaded through `fit`, no term added to the layout arithmetic. The
   * drawer is an overlay and the bar takes height, and height is the axis where
   * this view has nothing to ration.
   */
  const [panel, setPanel] = useQueryState("panel", panelParam);
  const drawerOpen = panel !== null;

  /**
   * ↑ / ↓ step through one level of the tree, and *which* level is whichever
   * zone the pointer is over — the spine steps by part, the prose by paragraph;
   * see keynav.ts. It writes no state of its own: it scrolls, and the listener
   * above notices, exactly as it would for a wheel. **Off any tagged zone the
   * stride is one block too**, since 2026-10-01 — it was the section, so over a
   * mode's band ↓ jumped a section while over the prose it stepped a paragraph.
   * Greg, spya-b2wzjf: "up and down should always do the same thing, i.e. jump
   * to the next block in the text". The section stride moved to ← / → in
   * Structure. docs/plans/261001q-structure-fisheye-expanded-and-arrow-keys.md.
   *
   * Suspended while the drawer is open. A reader looking at their questions is
   * not reading, and the article scrolling away underneath the dim — silently,
   * because they cannot see it move — is the kind of thing you only notice
   * afterwards, when you have lost your place.
   */
  const nav = useMemo(() => navPlan(geometry), [geometry]);
  /* **← / → step Skim's stops while it is the mode** — keyboard.md §
     ← / → in Skim. The handler is the band's own `step`, so the keys, the
     band's arrows and the door are one rule. `null` in every other mode, where
     ← / → are the browser's. */
  const skimKeys =
    mode === "skim" && skimControl ? skimControl.step : null;
  /* …and the quiz's questions while Remember's Quiz half is showing — `quizKeys`
     is only ever set while `QuizPanel` is mounted. */
  const quizStepKeys = mode === "remember" ? quizKeys : null;
  /* …and the quotes while Quotes is the mode — Greg, 2026-09-11 (spya-mtyquy):
     *"use left/right to navigate between quotes"*. `stepQuote` is the band's
     ‹ › rule too, so the keys can do no more than the buttons; `null` from it
     (→ on the last) answers "took nothing" and the key goes to the browser.
     keyboard.md § ← / → in Quotes. */
  const {
    steppable: steppableQuotes,
    selectedId: selectedQuote,
    select: selectQuote,
    reveal: revealQuote,
  } = quotes;
  const goToQuote = useCallback(
    (quote: Quote, jump: (id: BlockId) => void) => {
      selectQuote(quote.id);
      jump(quote.blockId);
    },
    [selectQuote],
  );
  const quoteKeys = useCallback(
    (dir: -1 | 1) => {
      const next = stepQuote(steppableQuotes, selectedQuote, dir);
      if (!next) return false;
      goToQuote(next, bandJump);
      return true;
    },
    [steppableQuotes, selectedQuote, goToQuote, bandJump],
  );
  const quoteStepKeys = mode === "quotes" ? quoteKeys : null;
  /* **The card on a quote in the prose** (ProseHoverCard.tsx § `QuoteCard`).
     Its ‹ › walk **down the page**, in document order, where the band and the
     keys walk the band's list. The two agree in the default order and in
     *prioritised*; under *most important* the band's order is invisible from
     the prose, and "next" jumping back up the page would be a surprise (GPT
     Sol's plan review, P2). `quoteCardQuotes` reads the actual prose marks, not
     only the band's list: Skim may fill its current quote after the Quotes bar
     has hidden it. Only marked quotes enter the map, so no step lands on
     nothing. `jumpTo` and not `bandJump`: the reader is in the prose already.
     Opening Quotes selects the quote first, so the band opens on its row. */
  const quoteCard = useMemo<QuoteCardSource | null>(() => {
    const { listed, byKey } = quoteCardQuotes(allQuotes, proseMarked);
    if (listed.length === 0) return null;
    return {
      listed,
      byKey,
      inQuotesMode: mode === "quotes",
      generatedAt: quoteSource?.generatedAt,
      onGo: (quote) => goToQuote(quote, jumpTo),
      onOpenInQuotes: (quote) => {
        revealQuote(quote.id);
        void setMode("quotes");
      },
    };
  }, [allQuotes, proseMarked, mode, goToQuote, jumpTo, revealQuote, setMode, quoteSource?.generatedAt]);
  useArrowNav(
    nav,
    article.blocks,
    geometry.leafDepth,
    !drawerOpen,
    skimKeys ?? quizStepKeys ?? quoteStepKeys,
    /* …and the lowest-level sections while Structure is the mode — the unit
       `?at=` stores, and the stride ↓ took over the band until 2026-10-01.
       keyboard.md § ← / → in Structure. */
    mode === "structure" ? sectionDepth(geometry) : null,
  );

  /* **The door after the current stop's block** — SkimPanel.tsx §
     SkimDoor. Memoised on the control, which changes only with the stop
     and the door's words, so `memo(TableView)` holds between them. It also
     offers the band back while it has stepped aside on a narrow window. */
  const afterBlock = useMemo(() => {
    if (mode !== "skim" || !skimControl?.blockId) return null;
    return {
      blockId: skimControl.blockId,
      node: (
        <SkimDoor
          door={skimControl.door}
          onNext={skimControl.advance}
          onDeeper={skimControl.deeper}
          onRoute={bandBack ? () => setBandAway(false) : null}
        />
      ),
    };
  }, [mode, skimControl, bandBack]);

  /**
   * **The quiz's questions, in the prose, in every mode** — Greg, 2026-09-30
   * (SPIDERYARN-READING2-6V): *"if you've generated quiz questions, it should
   * always show them in situ in the text, whether you're in quiz mode or not."*
   * Each after the block holding its last evidence passage (quiz-anchors.ts);
   * in Skim that puts it just above the door, which is the whole of the
   * Skim half. docs/plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md.
   *
   * **Memoised on the quiz, its staleness, the blocks and a stable handler, and
   * nothing that moves while you scroll** — `memo(TableView)` holds only while
   * every prop keeps its identity. Owner-only by construction: a visitor's
   * payload carries no quiz, and marking is an owner's POST. A stale quiz is
   * not drawn: its passages may no longer be the prose. An outdated one is.
   */
  const quizRead = owner?.quiz ?? null;
  const drawnQuiz = quizRead?.status === "ready" && !quizRead.stale ? quizRead.quiz : null;
  const quizAfter = useMemo(() => {
    if (!drawnQuiz || drawnQuiz.questions.length === 0) return null;
    const byBlock = questionsByAnchor(
      drawnQuiz.questions,
      article.blocks.map((b) => b.id),
    );
    const out = new Map<BlockId, ReactElement>();
    for (const [blockId, questions] of byBlock) {
      out.set(
        blockId,
        <QuizInProse batchId={drawnQuiz.batchId} questions={questions} onOpen={openQuizAt} />,
      );
    }
    return out;
  }, [drawnQuiz, article.blocks, openQuizAt]);

  /**
   * **Marginalia: the notes beside each block** — MarginaliaColumn.tsx.
   *
   * The ideas are the owner's stored list (read by `OwnerMarginFeed` beside
   * the column's head, never made) or the visitor's payload. Drawn only while the
   * window has room for the column (`fit.margW`); on a narrow one the head
   * says why there is nothing. Memoised on the notes alone, so scrolling does
   * not re-render `TableView`.
   */
  const [ownerFeed, setOwnerFeed] = useState<MarginFeed>(NO_OWNER_FEED);
  const marginaliaIdeas = owner ? ownerFeed.ideas : (artefacts?.ideas?.ideas ?? null);
  /* **Other modes' items, already stored** (report 82, plan 261002b): the
     owner's FAQ and Debate from the feed's read-only reads, a visitor's from
     their payload. **Citations are the owner's, and only a fresh list** —
     never `artefacts.citations`, because the prose's citation marks are
     owner-only (citations.md § Who sees it) and the margin is not the place to
     reverse that quietly. Comments are the one list both arms already share. */
  const marginaliaFaq = owner ? ownerFeed.faq : (artefacts?.faq?.questions ?? null);
  const marginaliaTimeline = owner ? ownerFeed.timeline : (artefacts?.timeline?.events ?? null);
  const marginaliaClaims = owner ? ownerFeed.claims : (artefacts?.debate?.claims.rows ?? null);
  const marginaliaCitations =
    owner && owner.citations.status === "ready" && !owner.citations.stale
      ? (owner.citations.citations?.citations ?? null)
      : null;
  /* Whether the block chat panel sits over the column rather than over the
     prose, and the room it has there — layout.ts § `chatDock`. From the same
     `fit` the column is drawn from, so the two cannot disagree about whether
     there is one. Computed whether or not a panel is open: it is two
     subtractions, and the panel must get a new value on a resize without
     being remounted. */
  const chatDockRoom = chatDock(fit, windowWidth);
  /**
   * **The block chat as a card in the column, level with its block** —
   * docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md. On
   * trial; `BLOCK_CHAT_IN_COLUMN` is the switch, read here and nowhere else,
   * and on `"dock"` everything below is `null` and the panel is 261003p's.
   *
   * **Never nothing** (§ 3). The card needs all of: the switch, the column
   * showing with room (`chatCard`), a chat anchored to a block, that block not
   * folded away, and a host element actually in hand. Any one missing and
   * `ChatDialog` is handed no card, so it is docked if `chatDockRoom` says so
   * and floating otherwise — an unanchored thread, a block the table is not
   * drawing, and the one commit before the host's ref lands all show the
   * panel they showed before.
   *
   * **A fold hides a cell with `display: none` and unmounts nothing**
   * (fold.ts § `foldCss`), so "is there a host" cannot be the test for it: the
   * host would still be in hand, inside a cell nobody can see. Asked of the
   * fold store directly, and subscribed, because folding re-renders nothing
   * here otherwise (GPT Sol on the plan, F4). A boolean, so a fold elsewhere
   * in the article does not wake `Reader`.
   */
  const chatCardWidth =
    BLOCK_CHAT_IN_COLUMN === "card" && marginRoom ? chatCard(fit, windowWidth, rootFontPx) : null;
  const chatBlockFolded = useSyncExternalStore(
    subscribeFold,
    () => chatOpenBlock !== null && isFolded(chatOpenBlock),
    () => false,
  );
  /** The block whose cell gets the card's host, or `null` for no card. */
  const chatCardBlock = chatCardWidth !== null && !chatBlockFolded ? chatOpenBlock : null;
  /* The host's DOM node, handed up by its ref. A `useState` setter, so the ref
     is one function for the life of the reader and `marginNotes` below can
     depend on it without ever changing because of it. */
  const [chatCardHost, setChatCardHost] = useState<HTMLDivElement | null>(null);
  const chatCardPlace: ChatCardPlace | null =
    chatCardBlock !== null && chatCardHost !== null && chatCardWidth !== null
      ? { host: chatCardHost, width: chatCardWidth }
      : null;
  /* The conversation the card is showing, so the margin can leave out its own
     line for it (§ 6). From `chatCardBlock`, not the host: the line and the
     card swap in one render rather than the line outliving it by a commit. */
  const chatCardThread = chatCardBlock !== null && overlay?.kind === "thread" ? overlay.threadId : null;
  /**
   * **A count of the presses that asked for a conversation to be open** —
   * `ChatDialog.reopen`. The chip, the "?", a mark and the drawer only write
   * `?thread=`, so a press that names the conversation already open changes
   * nothing the panel could see, and a card the reader had collapsed would sit
   * there ignoring it (GPT Sol on the plan, F1). Only the setter is used by
   * the callbacks below, so none of them changes identity because of it.
   */
  const [chatReopen, setChatReopen] = useState(0);
  /* `marginNotes` itself is built below `openAskedFromDrawer`, because the
     questions the reader asked sit in the margin too and open through it
     (plan 261002j). */

  /**
   * Reading order, not ask order — the panel's arrows walk you *down the
   * article*, not back through your own afternoon. See comment-nav.ts, and note
   * that the order comes from the block index and never from the id string
   * (block-ids.md).
   */
  const ordered = useMemo(
    () => orderComments(comments, article.blocks),
    [comments, article.blocks],
  );
  const openComment = ordered.find((c) => c.id === note) ?? null;

  /**
   * How many *other* questions are still with the model. Several can be in
   * flight at once — that is the point of firing one and reading on — so the
   * panel has to be able to say that work is happening somewhere you can't see.
   */
  const othersPending = ordered.filter(
    (c) => c.status === "pending" && c.id !== note,
  ).length;

  /* ------------------------------------------ moving to a comment, twice --
     **These were one function until 2026-09-06, and that was the bug.** The
     drawer's list and the dialog's arrows want opposite things from the history
     stack: choosing a question out of a list is an arbitrary jump and pushes,
     while stepping between them is traversal and must not — twenty questions
     cannot cost twenty presses of Back. The argument, and why the split is
     better than either half alone, is comment-jump.ts. GPT Sol F9. */

  /**
   * **The owner's highlights, for the Quotes band** — rows among the model's
   * quotes (QuotesPanel.tsx § ReaderHighlights; plan 261003h).
   *
   * **From `owner.comments`, never from `comments` above**: that variable is
   * either arm's list, and on a shared link it is the sharer's public comments,
   * which carry colours too. Passing it would quietly turn on "a visitor sees
   * the sharer's highlights in Quotes", which is deferred and unworded. Only
   * `QuotesBand` (the owner's) takes this; `VisitorQuotesBand` has no prop for
   * it. tests/quotes-yours-rows.test.tsx holds the line.
   *
   * Pressing one is the drawer's jump, with `bandJump` so a narrow window's
   * band steps aside as it does for a quote. The panel clears `?quote=` in the
   * same tick.
   */
  const ownerComments = owner?.comments.comments;
  const quoteHighlights = useMemo(
    () => ({
      rows: ownerComments ? readerRowComments(ownerComments) : [],
      blocks: article.blocks,
      onOpen: (id: string) => jumpToComment(ownerComments ?? [], id, setNote, bandJump),
    }),
    [ownerComments, article.blocks, setNote, bandJump],
  );

  /** The drawer's list: a jump, so there is a way back from it. */
  const openCommentFromDrawer = useCallback(
    (id: string) => jumpToComment(comments, id, setNote, jumpTo),
    [comments, jumpTo, setNote],
  );

  /**
   * The dialog's arrows: traversal, writing no position state of their own —
   * the listener in `useReadingPosition` notices the scroll and updates `?at=`,
   * exactly as it does for a wheel. Same reasoning as keynav.ts.
   */
  const stepToNeighbouringComment = useCallback(
    (id: string | null) => stepToComment(comments, id, setNote),
    [comments, setNote],
  );

  /**
   * A `?note=` that arrived in the address bar brings its own passage into view.
   *
   * The gap this closes: the two above move the reader, so opening or stepping
   * between questions inside the reading view was always fine — but they need the
   * comment in hand, and a pasted link has only an id. `/read/<slug>?note=<id>`
   * with no `?at=` beside it therefore opened a dialog about a paragraph that
   * was somewhere off screen, and which one was unguessable. That is exactly the
   * shape of a link you *send someone*, because `?at=` is only ever there if the
   * sender had scrolled. Recorded as open in docs/plans/260825e-metadata-page.md.
   *
   * **It waits for the fetch, and it has to.** `useComments` loads over the wire,
   * so at the moment the URL is read we know the note's id and not its block.
   * `arrivalTarget` returns `at` until the comment turns up, which is what the
   * `?at=` restore has already done, so the guard below makes those renders
   * free — and then the comment arrives and this fires once.
   *
   * **Once**, and that is the ref. After the first honoured arrival, moving
   * between comments belongs to `comment-jump.ts`, which on both paths
   * deliberately holds still when the next passage is already on screen —
   * `passageToBringIntoView`. Re-running this on every change
   * to `note` would be a second thing moving the page, and the two would
   * disagree the moment either changed.
   *
   * `isBlockOnScreen` rather than an unconditional jump, for the same reason
   * comment-jump.ts uses it: when `?note=` and `?at=` agree — the passage sits in
   * the section the link restored — the reader is already looking at it, and a
   * jolt would cost them their place to move them nowhere.
   *
   * Smooth rather than instant, unlike the `?at=` restore. That one runs before
   * the reader has seen anything, so animating it would be theatre; this one
   * lands after the page is up and being looked at, and the travel is what says
   * the article moved rather than was replaced. It is also the safer of the two
   * here: `glide` gives way to a wheel or a touch (scroll.ts), so a reader who
   * started reading during the fetch is not dragged off their line.
   */
  const arriving = useRef({ at, note });
  useEffect(() => {
    const { at: wasAt, note: wasNote } = arriving.current;
    if (wasNote === null) return;
    const target = arrivalTarget(wasAt, wasNote, comments);
    // `target === wasAt` is the two harmless cases at once: the comments have
    // not landed, and the note is anchored to the very block the link already
    // restored. Both mean the `?at=` restore has this covered.
    if (target === null || target === wasAt) return;
    arriving.current = { at: wasAt, note: null };
    if (!isBlockOnScreen(target)) scrollToBlock(target);
  }, [comments]);

  /**
   * Every block this article has, id to its plain text — for chat's citations.
   *
   * A Map rather than a scan per citation: an answer can carry a dozen ids and
   * every one is checked on every keystroke of the stream. The text rides along
   * because a citation chip shows the paragraph it points at on hover, and
   * building a separate Set of ids beside this would be a second copy of the
   * same fact.
   *
   * Since 2026-08-27 the hover card on the article's *own* links reads it too,
   * for the same reason and with the same words: an in-article `#fragment` is
   * the one link whose destination we can actually show, because it is on this
   * page. ProseHoverCard.tsx.
   */
  const blockText = useMemo(
    () => new Map(article.blocks.map((b) => [b.id, b.text])),
    [article.blocks],
  );

  /**
   * **What the reader has read, for the quiz** —
   * docs/plans/260930e-quiz-only-asks-about-what-you-have-read.md. The owner's
   * reading-time levels, whether they can be believed yet, and the body's words
   * to measure a share in. Undefined when reading time is off, which the quiz
   * must not mistake for "read nothing".
   */
  const bodyWords = useMemo(
    () => new Map(article.blocks.filter(countsTowardReadingTime).map((b) => [b.id, b.words] as const)),
    [article.blocks],
  );
  const readingLevels = owner?.readingTime.levels;
  const readingStatus = owner?.readingTime.status ?? "off";
  const readSoFar = useMemo<ReadSoFar | undefined>(
    () =>
      readingLevels && readingStatus !== "off"
        ? { levels: readingLevels, status: readingStatus, bodyWords }
        : undefined,
    [readingLevels, readingStatus, bodyWords],
  );

  /**
   * **Each block's position in the article** — Debate's Claims sub-mode puts
   * its claims in the order the piece makes them, and the artefact does not
   * carry that; the blocks do. Built once here and handed to both debate
   * bands. docs/plans/260929h-debate-mode-clearer-sources-and-orders.md F8.
   */
  const blockOrder = useMemo(
    () => new Map(article.blocks.map((b, i) => [b.id, i])),
    [article.blocks],
  );
  /* …and the article's own publication date, for the *date* order's marker;
     the band takes the year from it. Read off `object` because a visitor's
     meta has no `publishedAt` in its type (it does not cross the public
     boundary), and then there is simply no marker. */
  const publishedAt = (article.meta as { publishedAt?: unknown }).publishedAt;

  /**
   * **What every block link's card says** — each block's text and the section
   * it sits in, in one pass (BlockLinkCard.tsx). Memoised on the article alone,
   * so the provider's value is the same object while the reader scrolls and
   * nothing under it re-renders for it, `memo(TableView)` included.
   */
  const blockLinks = useMemo(
    () => buildBlockLinkIndex(article.blocks, sections),
    [article.blocks, sections],
  );

  /**
   * **The cross-references the prose draws, and how the card finds where one
   * goes** — docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md.
   *
   * Each arm brings its own: the owner's from `useCrossrefs`, a visitor's off
   * the public payload (since 2026-10-01, plan 261001b). Both are already null
   * when the artefact is stale — the hook decides it for the owner, the public
   * reader for a visitor, by the same `isStale`.
   *
   * The resolver is `xrefTarget` bound to the same array TableView marks with,
   * so the card and the click can never disagree about a mark's target. Its
   * identity changes only when the links do.
   */
  const xrefs = capability.crossrefs;
  const resolveXref = useCallback<XrefResolver>((el) => xrefTarget(el, xrefs), [xrefs]);

  /**
   * The article's footnotes: which blocks make up each note, and which passages
   * cite it. Built once here because two consumers need the same answer — the
   * hover card, which shows a note's whole range, and the table, which marks the
   * back-link the reader arrived by. src/web/notes-view.ts.
   */
  const notes = useMemo(() => buildNoteIndex(article.blocks), [article.blocks]);

  /**
   * The passage the reader left when they followed a footnote marker.
   *
   * One note can be marked thirteen times, so its thirteen back-links are
   * identical apart from where they go; without this the reader lands in the
   * notes with no way to tell which one is theirs.
   *
   * It survives every other kind of jump and is replaced only when another
   * marker is followed, which is deliberate: the mark answers "where did I come
   * from", and that stays true after the reader has been back and read on. The
   * one stale case — following a marker and never returning — leaves a mark on
   * a passage the reader really did leave.
   */
  const [noteReturn, setNoteReturn] = useState<NoteReturn | null>(null);
  /* **The marker, not its destination block.** The passage and the note are
     stored together and come off one `NoteMarker`, so there is no way to pair
     the passage the reader left with a note they did not follow — which is what
     went wrong when only the block id was kept. src/web/notes-view.ts §
     `markReturnPath`. GPT Sol, F7. */
  const followNote = useCallback(
    (from: BlockId | null, marker: NoteMarker) => {
      setNoteReturn(from ? { from, noteId: marker.note.id } : null);
      jumpTo(marker.blockId);
    },
    [jumpTo],
  );

  /* ------------------------------------------- TableView's four callbacks --
     Lifted out of the JSX, and the only reason is identity.

     `TableView` is wrapped in `memo`, so a render of `Reader` that changes none
     of its 29 props must not produce new ones — and an arrow written inline in
     the JSX is a new function on every render, which alone would defeat the
     whole thing. The other 24 props were already stable (memos, `useState`
     setters, primitives); these four were not.

     That matters here more than it usually would, because `useReadingPosition`
     writes `?at=` as the reader scrolls, which re-renders `Reader` 77-79 times
     during one scroll of a long article. Each of those used to reconcile 551
     rows. See docs/plans/260904a-more-scroll-cpu-wins.md.

     Everything each of them closes over is itself stable: `useState` setters,
     nuqs setters (`useQueryState` returns a `useCallback` whose own dependencies
     are memoised — nuqs 2.10.0, dist/index.js:724), `blockText` (a memo) and
     `owner`, which is a prop of `Reader`.

     `startChatAboutBlock` below is the exception to the heading rather than to
     the rule: it goes to the floating panel, not to `TableView`, and it is a
     `useCallback` because `chatAboutBlock` — which does — is built on it. */

  const openChatThread = useCallback(
    (id: BlockId) => {
      setChatDraft(null);
      void setNote(null);
      void setThread(id);
      setChatReopen((n) => n + 1);
    },
    [setNote, setThread],
  );

  /**
   * **The questions the reader asked from a passage**, for the Comments drawer —
   * docs/plans/260930f-gutter-questions-listed-in-the-comments-drawer.md.
   *
   * Opening one is the drawer's jump, the same function a comment row goes
   * through (comment-jump.ts): it is generic over `{ id, blockId }` and takes
   * the opener as a parameter, so the *here / away / nowhere* check is the
   * comment row's exactly. `openChatThread` writes `?thread=` and clears
   * `?note=` in the same tick, so they land with any jump on at most one entry,
   * and exactly one when the passage was away. Remember is
   * the deliberate extra case: even for a passage already here (or gone), its
   * switch into Chat is itself one pushed entry, so Back can return to Remember.
   * The thread, panel close and any jump are still batched into that one entry.
   *
   * **Where it opens depends on the mode**, because `overlay` above is
   * suppressed in two of them: in Chat mode the band shows `?thread=` already,
   * and in Remember it would be a chat inside the Remember band (or wiped by
   * Quiz's cleanup), so the press follows it into Chat mode — the rule the
   * band's own `onThread` keeps (ConversationModes.tsx). Every other mode gets
   * the floating dialog. GPT Sol's plan review, finding 1.
   *
   * **Minus the chats a comment already points at.** *Also ask the AI* on a
   * comment makes an anchored chat and records it as the comment's `threadId`,
   * so without this the drawer would list that one question twice. Finding 3.
   */
  const askedList = useMemo(
    () => askedQuestions(chatSummaries, comments),
    [chatSummaries, comments],
  );
  const openAskedFromDrawer = useCallback(
    (id: string) => {
      /* In Chat the mode does not change, but its band may have stepped aside
         on a narrow window, and the floating panel is suppressed there: the
         thread would open where nobody can see it (GPT Sol, plan review
         261004g F1). In any other mode the floating panel takes it. */
      if (mode === "remember" || mode === "chat") showBand("chat");
      jumpToComment(askedList, id, openChatThread, jumpTo);
    },
    [askedList, openChatThread, jumpTo, mode, showBand],
  );

  /**
   * **Marginalia: the notes beside each block** — MarginaliaColumn.tsx; the
   * inputs are gathered above, where `marginRoom` is.
   *
   * The owner's comments **and the questions they asked**, each stamped with
   * its kind, open through the drawer's own press (SPIDERYARN-READING2-9H,
   * plan 261002j). A visitor's payload has no chats, so `askedList` is empty
   * for them and there is nothing to open.
   */
  const marginViewer = capability.kind === "owner" ? "owner" : "visitor";
  const openAskedFromMargin = marginViewer === "owner" ? openAskedFromDrawer : undefined;
  const marginNotes = useMemo(() => {
    if (!marginRoom) return null;
    const byBlock = marginaliaNotes(article.tree, article.blocks, marginaliaIdeas, {
      faq: marginaliaFaq,
      timeline: marginaliaTimeline,
      /* The owner's only: a visitor's payload does not carry them (plan 261003f). */
      relations: isOwner ? ownerFeed.relations : null,
      claims: marginaliaClaims,
      citations: marginaliaCitations,
      comments,
      /* Less the conversation drawn as a card on its block, which would
         otherwise say *Question* directly above itself (plan 261004k § 6). */
      asked: marginViewer === "owner" ? askedBesideCard(askedList, chatCardThread) : null,
    });
    const cardHost = (
      <div
        ref={setChatCardHost}
        className="chat-card-host"
        {...{ [CHAT_CARD_HOST_ATTR]: "" }}
        data-marg-note=""
      />
    );
    const out = new Map<BlockId, ReactElement>();
    for (const [blockId, notes] of byBlock)
      out.set(
        blockId,
        <>
          {blockId === chatCardBlock ? cardHost : null}
          <MarginNotesSlot notes={notes} viewer={marginViewer} onOpenAsked={openAskedFromMargin} />
        </>,
      );
    /* **The card's host: first in its block's cell, above the block's own
       notes**, so the card is the thing level with the paragraph and an opened
       note cannot push the chat away from it (GPT Sol on the plan, F3). Where
       an earlier block's notes already run down past this one, the card is
       pushed below them like any note.

       `data-marg-note` is what `useMarginLayout` collects, so the notes after
       it are pushed below the card and come back when it collapses or closes;
       its ResizeObserver already re-runs as a streamed answer grows. The host
       is the positioned, measured box (dialogs.css § `.chat-card-host`) and
       `ChatDialog` attaches its panel inside it, in flow, so the host's height
       is the card's. Nothing here depends on the panel's callbacks, which
       change on every render: the memo holds, and `memo(TableView)` with it. */
    /* Keep the notes at the same React child position with or without a
       host, so showing the card does not close an opened note on the block. */
    if (chatCardBlock !== null && !out.has(chatCardBlock)) {
      out.set(chatCardBlock, cardHost);
    }
    return out;
  }, [
    marginRoom,
    article.tree,
    article.blocks,
    marginaliaIdeas,
    marginaliaFaq,
    marginaliaTimeline,
    isOwner,
    ownerFeed.relations,
    marginaliaClaims,
    marginaliaCitations,
    comments,
    askedList,
    marginViewer,
    openAskedFromMargin,
    chatCardBlock,
    chatCardThread,
  ]);
  useMarginLayout(marginRoom, marginNotes);

  /* **A *new* conversation anchored to the whole block** — the other half of
     what an anchor can be, and the one that draws no mark in the prose. The
     paragraph's opening words go into the composer so the reader can see which
     one they pressed; a six-character id is not something you can check you
     clicked correctly.

     **Split out of `chatAboutBlock` on 2026-09-05**, when the chip started
     reopening. It is a branch and a door: the branch is what a paragraph with
     no conversation still gets, and the door is `onNewConversation` on the
     panel, which has to be able to force a fresh draft from inside a thread —
     so it cannot go through `chatAboutBlock`, which would reopen the very
     thread the reader is trying to leave.

     **Handed over only to an owner, and that is the whole gate.** `onChatAbout`
     used to go to everybody with an `if (!owner) return;` inside it, so a
     visitor got a chat button on every paragraph whose press did nothing. The
     absent callback is what makes the button absent (BlockGutter.tsx), and the
     sentence about what chat costs is still one press away in the Chat band.
     The place a visitor meets the boundary is `onSelect` below, which they
     reach by accident and which stays silent for that reason.

     The `owner ?` ternary stays at the call site rather than moving in here, so
     that the prop is `undefined` — not a function that does nothing — and the
     button is genuinely absent. It is identity-stable either way, because
     `owner` is. */
  const startChatAboutBlock = useCallback(
    (blockId: BlockId) => {
      void setNote(null);
      void setThread(null);
      setChatDraft({
        kind: "draft",
        anchor: { blockId },
        opening: blockText.get(blockId) ?? "",
      });
    },
    [blockText, setNote, setThread],
  );

  /**
   * **The chip opens what it is counting.**
   *
   * A press used to land on `startChatAboutBlock` unconditionally, so the blue
   * mark saying *"(3 already)"* handed the reader an empty composer — the chip
   * advertised state it would not show them. Reported by Greg, 2026-09-05;
   * docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md
   * § stage 1.
   *
   * The rule about **which** conversation, and why a whole-block one outranks a
   * newer selection, lives with the query in `threadFor` rather than here.
   *
   * **A new conversation is still reachable**, from the panel this now opens —
   * `onNewConversation` below, which is `startChatAboutBlock` unwrapped so that
   * it cannot simply reopen the thread the reader is standing in.
   *
   * The same before-the-list-has-arrived tolerance `helpAboutBlock` documents
   * at length applies here, and costs less: a press in the first few hundred
   * milliseconds opens a composer instead of a transcript, and buys nothing.
   */
  const chatAboutBlock = useCallback(
    (blockId: BlockId) => {
      const existing = threadFor(chatSummaries, blockId);
      if (existing) {
        setChatDraft(null);
        void setNote(null);
        void setThread(existing.id);
        /* It may be the one already open, collapsed in the column. */
        setChatReopen((n) => n + 1);
        return;
      }
      startChatAboutBlock(blockId);
    },
    [chatSummaries, setNote, setThread, startChatAboutBlock],
  );

  /**
   * **One press, one model call, and the reader keeps reading.**
   *
   * The "?" beside a paragraph. Everything about it is the same conversation
   * the chat button starts — same anchor, same thread, no fourth `ThreadKind`
   * (the plan says why at length) — except that nobody stops to type: the
   * question is `HELP_QUESTION` and `ChatDialog` sends it on mount.
   *
   * ## Pressing it twice must not cost twice, and there are two ways it can
   *
   * **A conversation that already exists is opened, not repeated.** Pressing
   * "?" on a paragraph you asked about ten minutes ago should show you the
   * answer you already bought. Only whole-block anchors count: a conversation
   * about a phrase you *selected* is about that phrase, and reopening it for
   * somebody asking about the paragraph would answer a question they did not
   * ask. The newest wins, on the same reasoning — it is the one whose context
   * is closest to where they are now.
   *
   * **And two taps are one press without a latch here, because the send does
   * not happen here.** This function only sets a draft; `ChatDialog` mounts on
   * it and its effect is what spends. So two taps that both land before that
   * mount collapse into one draft and one send, and two taps that straddle it
   * are caught by the dialog's own ref — the structure does the work, not a
   * guard.
   *
   * There *was* a `helpArming` ref here, added against the iPad double-tap on
   * the reasoning that two taps in one tick both read the same `chats` array.
   * It came out on 2026-09-05, when GPT Sol pointed out it was untested, and
   * testing it showed why: with the real App mounted and the "?" clicked twice
   * inside one `act`, the POST count stays at one with the ref deleted, and
   * with the reopen above deleted, and with the dialog's latch deleted — any
   * two of the three cover it. A guard whose absence cannot be observed is a
   * guard nobody can maintain, so the honest version is the two that a test can
   * redden. `tests/public-network-trace.test.tsx` § spends once when the "?" is
   * double-tapped.
   *
   * ## What this deliberately does not do
   *
   * **A press before the summaries have arrived mints a new conversation even
   * if one exists.** `chatSummaries` is a separate fetch from the article, and
   * `chatAnchors.loaded` exists precisely because *"no conversation with this
   * id" and "the list has not arrived" are the same state without it* — so
   * during that window `helpThreadFor` cannot tell them apart either.
   *
   * Left alone on purpose, and it is smaller than it was: the arriving list no
   * longer *deletes* what the reader did while it was in the air
   * (`foldInLocalWrites` in useChatAnchors.ts), which was the version of this
   * that actually cost money. What remains is that a press in the first few
   * hundred milliseconds cannot see a conversation stored on a previous visit.
   * Refusing the press would give a dead button on a page that looks ready;
   * queueing it adds state whose only job is a race nobody has hit. The cost
   * when it happens is a second conversation about a paragraph — which is what
   * pressing "?" and forgetting you had asked already does anyway.
   */
  const helpAboutBlock = useCallback(
    (blockId: BlockId) => {
      const existing = helpThreadFor(chatSummaries, blockId);
      if (existing) {
        setChatDraft(null);
        void setNote(null);
        void setThread(existing.id);
        /* As the chip: the answer they already bought may be collapsed. */
        setChatReopen((n) => n + 1);
        return;
      }
      void setNote(null);
      void setThread(null);
      setChatDraft({
        kind: "draft",
        anchor: { blockId },
        opening: blockText.get(blockId) ?? "",
        help: true,
      });
    },
    [blockText, chatSummaries, setNote, setThread],
  );

  /**
   * **One press, and the paragraph is bookmarked** — the gutter's bookmark
   * button. Greg, 2026-09-12: *"so you could just say, that would just somehow,
   * yeah, bookmark that block as being really interesting."*
   *
   * A whole-block comment: no quote, so no mark in the prose, and the gutter
   * mark is the whole of it (`CommentAnchor` in src/types.ts). Free, and
   * optimistic like every comment save — `create` removes the row again if the
   * server refuses. Resolves to whether it was stored, so the gutter's live
   * region says what happened.
   *
   * **Handed to the table only once the opening read has landed, and landed
   * well** — at the prop, below. Before that `comments` is `[]` for every block,
   * so every paragraph would offer the button: a press could be erased by the
   * list arriving, or bookmark a paragraph that already had a note nobody had
   * fetched yet. GPT Sol, reviewing the plan, 2026-09-12; `AnnotateDialog`'s
   * Save waits on the same flag for the same reason.
   *
   * **The id survives an uncertain response.** A POST can commit and lose its
   * response; `create` then removes the optimistic row and this button returns.
   * `makeBlockBookmarker` reuses that id on the next press, which is what lets
   * the store recognise the retry instead of saving a second row. It also
   * coalesces two presses while the first write is live.
   *
   * Memoised on `create`, which is stable for one slug, so the retry memory and
   * callback survive renders without making memoised `TableView` redraw.
   *
   * **And then the comment box opens on it**, since 2026-10-02 — Greg,
   * SPIDERYARN-READING2-9C: *"it should be possible to comment on a block
   * without wanting an AI-chat-response."* It always was, by pressing the mark
   * afterwards, and nobody found it. The bookmark is still stored by the one
   * press; the dialog is the invitation to add words, which are free, and
   * closing it leaves a bare bookmark. Only once the store has confirmed, so
   * the dialog never opens on a row that is about to vanish. Plan 261002j.
   *
   * **And only if nothing else has opened since the press, and no later press
   * has been made.** The store answers after a round trip, and in that time
   * the reader may have opened a comment, a chat, the selection box, a drawer,
   * Marginalia or a mode band — an answer arriving then must not replace what
   * they chose. The mode-specific parameters are included too: moving from
   * Recall to Quiz is a new foreground choice even though `mode` stays
   * `remember`. GPT Sol, P1 on the plan and code review of 261002j.
   *
   * **Hover cards and modals are deliberately not in it.** Sol's code review
   * also checked the DOM for any new `role="dialog"`; that was taken out,
   * because the prose's hover cards are dialogs too, so a pointer drifting
   * over a glossary term during the round trip would silently cancel the box.
   * Nor does the comment box replace either: it sits beside a card or under a
   * modal, and the reader's choice is still on screen.
   *
   * **Published in a layout effect, never during render.** A concurrent render
   * may be abandoned; writing a ref from it would let an uncommitted surface
   * cancel (or authorise) the async result. The effect runs only for a committed
   * view, before the browser can accept another press.
   */
  const surface = useRef<readonly unknown[]>([]);
  useLayoutEffect(() => {
    surface.current = [
      note,
      thread,
      chatDraft,
      annotating,
      panel,
      mode,
      margin,
      bandAway,
      subNav.remember,
      subNav.diagram,
      subNav.referee,
      subNav.summary,
      subNav.structure,
    ];
  }, [
    note,
    thread,
    chatDraft,
    annotating,
    panel,
    mode,
    margin,
    bandAway,
    subNav.remember,
    subNav.diagram,
    subNav.referee,
    subNav.summary,
    subNav.structure,
  ]);
  const bookmarkPress = useRef(0);
  const createComment = owner?.comments.create;
  const bookmarkBlock = useMemo(() => {
    if (!createComment) return undefined;
    const bookmark = makeBlockBookmarker(createComment);
    return async (blockId: BlockId): Promise<boolean> => {
      const mine = ++bookmarkPress.current;
      const before = surface.current;
      const id = await bookmark(blockId);
      const unchanged = surface.current.every((v, i) => Object.is(v, before[i]));
      if (id !== null && mine === bookmarkPress.current && unchanged) void setNote(id);
      return id !== null;
    };
  }, [createComment, setNote]);

  /**
   * **What the command bar's argument rows can do on this page** — *Jump to
   * the first “X”*, *Glossary: “term”*, *Look up “X” in this article* — and,
   * for chat's chips in Stage 2, the bookmark. Plan 261003f, Stage 1; who gets
   * which is command-runners.ts § `readingExecutor`.
   *
   *  - `jump` is **`jumpTo`**, the deliberate jump that pushes history and
   *    feeds the return chip (GPT Sol's F3) — not `bandJump`, since the bar is
   *    not under a band, and never a write to `?at=`.
   *  - `terms` is the **visible** list (F2), and `ready` is the owner's
   *    glossary read having settled with a glossary in it (F1): loading, an
   *    error and no glossary at all each offer no ask.
   *  - `openGlossary` is the **plain** mode setter, never the Dock's press,
   *    which arms generate-on-open (F1). The term travels in the one-shot
   *    hand-off (glossary-ask-handoff.ts), not the address.
   *  - `bookmark` under the same gate as the prose's own bookmark button (F6).
   *  - `findMore` names a band **only while its list can be added to**, as the
   *    read mounted here says (find-more.ts § `glossaryAppendOnOffer`,
   *    `quotesAppendOnOffer`; plan 261004k, GPT Sol's F3) — and only a band
   *    the Dock draws. The opener is the plain mode setter here too: the bar's
   *    press leaves a hand-off (find-more-handoff.ts) and the band presses its
   *    own Find more.
   *  - `openQuickSearch` is **the owner's**, the cut the bar's own box makes
   *    (Dock.tsx § `hasQuickSearch`): a visitor's band cannot ask. Plan
   *    261005i.
   */
  const glossaryReady = glossaryRead?.status === "ready" && glossaryRead.glossary !== null;
  const canBookmark = owner !== null && owner.comments.loaded && owner.comments.loadError === null;
  const dockDraws = (target: FindMoreMode) =>
    shownBehindTheSwitch({
      experimental: MODE_CATALOG[target].experimental,
      on: experimental.on,
      current: mode === target,
    });
  const moreTerms = owner !== null && glossaryAppendOnOffer(owner.glossary) && dockDraws("glossary");
  const moreQuotes = owner !== null && quotesAppendOnOffer(owner.quotes) && dockDraws("quotes");
  const executor = useMemo(
    () =>
      readingExecutor({
        slug,
        blocks: article.blocks,
        jump: jumpTo,
        glossary: isOwner
          ? {
              ready: glossaryReady,
              terms,
              openTerm: openTermInGlossary,
              openGlossary: () => showBand("glossary"),
            }
          : undefined,
        bookmark: canBookmark ? bookmarkBlock : undefined,
        findMore: isOwner
          ? {
              glossary: moreTerms ? () => showBand("glossary") : undefined,
              quotes: moreQuotes ? () => showBand("quotes") : undefined,
            }
          : undefined,
        openQuickSearch: isOwner ? openQuickSearch : undefined,
      }),
    [
      slug,
      article.blocks,
      jumpTo,
      isOwner,
      glossaryReady,
      terms,
      openTermInGlossary,
      showBand,
      canBookmark,
      bookmarkBlock,
      moreTerms,
      moreQuotes,
      openQuickSearch,
    ],
  );
  /**
   * **The reader's tags on this article, for the bar** (`ShelfRow.tags`). The
   * reading view draws no tag editor, so there is nothing on screen to keep in
   * step and a plain `editArticleTags` is the whole controller; the Metadata
   * page hands in its editor's own save instead (F4).
   */
  const tagsControl = useMemo<TagsControl>(
    () => ({ edit: (change) => editArticleTags(slug, change) }),
    [slug],
  );
  /**
   * **What a command chip in a chat answer presses through** (plan 261003f,
   * Stage 2; CommandChip.tsx) — `executor` above, plus the tags and a find,
   * which the bar gets from its shelf row and from an address. One per surface
   * because the jump differs: the band's steps a covering band aside, the
   * dialog's does not. Who gets what is command-runners.ts § `chatExecutor`.
   *
   * The find reads the address at the press, not at the render: it carries
   * `?at=`, which the reader's scrolling rewrites.
   */
  const chatCommands = useMemo(() => {
    const find = (words: string) => navigate(findHref(slug, carriedSearch(window.location.search), words));
    const forJump = (jump: (blockId: BlockId) => void) =>
      chatExecutor({ reading: executor, blocks: article.blocks, jump, tags: tagsControl, find });
    return { band: forJump(bandJump), dialog: forJump(jumpTo) };
  }, [slug, executor, article.blocks, tagsControl, bandJump, jumpTo]);

  /**
   * ## Selecting applies the highlight, and the box customises or removes it
   *
   * > how about if selecting text automatically applies the highlight and also
   * > pops up the fuller box to allow the user to customise (or remove) it, and
   * > they can just click off if they're happy with the highlighting
   * >
   * > — Greg, 2026-10-04
   *
   * Outside Referee mode a selection **writes its row at once** — a comment in
   * `DEFAULT_HIGHLIGHT` — and the box that opens is the comment's own,
   * `CommentDialog`. That is `bookmarkBlock`'s pattern above (create, then
   * open the box on the row) with the same three guards, applied to words
   * instead of a paragraph. There is no provisional mark and no draft: the
   * paint is the ordinary mark of an ordinary row, and a create that fails
   * takes the row, the paint and the box away together (`useComments.create`).
   * docs/plans/261004f-selecting-applies-the-highlight-and-the-box-customises-or-removes-it.md
   * § GPT Sol's plan review, which is where the design changed to this.
   *
   * **`fresh` is the box a selection opened on the comment it made**, and only
   * that box gets the fresh rules (CommentDialog.tsx § `FreshBox`): a press
   * elsewhere closes it, Delete reads *Remove highlight*, Copy can take the
   * highlight off again. It ends when that box closes or shows another
   * comment — the effect below — so the same comment opened later from its
   * mark is an ordinary box.
   *
   * **`freshTouched`** is whether the reader has done anything to the fresh
   * row. Said by the dialog at the press, because a colour or an edit is not
   * in the stored row until the server answers, and the overlap rule below
   * must not remove a highlight the reader had just changed.
   *
   * **`closedFresh` is the fresh row, remembered for one gesture.** Set by the
   * `pointerdown` outside its box — which closes nothing yet: the box goes
   * when that press ends, and only if it still shows this row (CommentDialog.tsx
   * § The press outside is only recorded) — held until that mouse
   * gesture's `mouseup`, and also cleared by the next `pointerdown` as a stale
   * guard (the capture listener below runs before the dialog's own). A mouse
   * drag is one gesture, so a selection whose `mouseup` finds this set is the
   * reader correcting the words they just highlighted — see `selectProse`.
   * Touch and pen have no compatibility `mouseup` guarantee, so their
   * `pointerup` clears it; this stops a later keyboard activation inheriting
   * either kind of completed gesture.
   */
  const [fresh, setFresh] = useState<{
    id: string;
    anchor: SelectionAnchor;
    input: "mouse" | "touch";
  } | null>(null);
  const freshTouched = useRef(false);
  const closedFresh = useRef<{ id: string; anchor: SelectionAnchor; touched: boolean } | null>(null);
  /**
   * **Has this gesture already opened a comment's box?** The fresh box closes
   * when the press outside it ends, and by then the same press may have made a
   * new highlight or landed on another mark, whose box is the one now wanted.
   * The dialog checks the id it is showing and the close itself is conditional
   * on `?note=`, but neither is enough alone: both read state that a commit not
   * yet flushed has not reached. This is set in the handler, so it is always
   * current. Forgotten at the next `pointerdown`.
   */
  const openedThisGesture = useRef(false);
  /* A clipboard answer can arrive after its fresh box has closed. Every
     reader change protects the row here, above any one dialog instance, and a
     successful answer claims the id before deleting so two pending copies
     cannot both remove it. */
  const copyOnlyProtected = useRef(new Set<string>());
  /** `bookmarkPress`'s twin: only the newest selection may open its box late. */
  const selectPress = useRef(0);
  /* What `selectProse` reads without depending on it — the function is
     `memo(TableView)`'s `onSelect` and must keep its identity (see its
     dependency list). Published from a committed render, as `surface` is. */
  const commentsNow = useRef<CommentsApi | null>(null);
  const refereeNow = useRef(false);
  useLayoutEffect(() => {
    commentsNow.current = owner?.comments ?? null;
    refereeNow.current = mode === "referee";
  });
  /* Fresh ends when its box does. `freshShown` is there because the row can
     be made fresh a beat before `?note=` names it. */
  const freshShown = useRef<string | null>(null);
  useEffect(() => {
    if (!fresh) {
      freshShown.current = null;
      return;
    }
    if (note === fresh.id) {
      freshShown.current = fresh.id;
      return;
    }
    if (freshShown.current === fresh.id) setFresh(null);
  }, [note, fresh]);
  useEffect(() => {
    const nextGesture = () => {
      closedFresh.current = null;
      openedThisGesture.current = false;
    };
    const gestureEnded = () => {
      closedFresh.current = null;
    };
    const nonMouseGestureEnded = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") closedFresh.current = null;
    };
    window.addEventListener("pointerdown", nextGesture, true);
    window.addEventListener("pointerup", nonMouseGestureEnded);
    window.addEventListener("mouseup", gestureEnded);
    window.addEventListener("pointercancel", gestureEnded);
    return () => {
      window.removeEventListener("pointerdown", nextGesture, true);
      window.removeEventListener("pointerup", nonMouseGestureEnded);
      window.removeEventListener("mouseup", gestureEnded);
      window.removeEventListener("pointercancel", gestureEnded);
    };
  }, []);
  /**
   * **A mouse keeps its words selected.** The paint replaces the paragraph's
   * nodes, which collapses the selection the reader has just made — and a
   * reader who selected in order to copy would press ⌘C on nothing. So once
   * the fresh row is painted the selection is put back over it, and a native
   * copy then both works and takes the highlight off (CommentDialog.tsx § a
   * native copy).
   *
   * **Twice, and then never again**: the paragraph is painted once for the
   * row and once more when `?note=` names it and the mark gains its open ring,
   * so the effect runs for each. Only while the box is the fresh one — keyed
   * on `note` being this row — so the paint that takes the ring *off* when the
   * box closes does not put a selection back over a reader who has moved on.
   *
   * Not by touch: there the button press clears the selection on purpose, to
   * put the OS handles and callout away (`selectProse`). And not over a
   * selection that is still live, which is the reader's and may be a new one.
   */
  const freshOpen = fresh !== null && note === fresh.id;
  /* A passive effect, and of this component: it runs after the table's new
     markup is committed and after `CommentDialog`'s own mount effect has moved
     focus to its close button. Chrome leaves a selection alone when a button
     is focused; jsdom collapses it, and nothing promises the rest do not. */
  useEffect(() => {
    if (!fresh || fresh.input !== "mouse") return;
    /* The first paint comes before `?note=` has caught up; the second with it. */
    if (!freshOpen && freshShown.current === fresh.id) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    selectAnchor(fresh.anchor);
  }, [fresh, freshOpen]);

  const selectProse = useCallback(
    /* Always a real anchor since 2026-09-05: `readSelection` now distinguishes
       a drag it refused from no drag at all, and TableView stops on the first
       without calling in here. src/web/selection.ts § SelectionRead. */
    (anchor: SelectionAnchor, input: "mouse" | "touch" = "mouse") => {
      /* **The one control a visitor meets by accident**, since selecting prose
         is something people do while reading rather than a button they chose to
         press. So it is silent: they keep their selection and the page does not
         grow a box about an account. The ask lives where they went looking for
         something — the marked modes and the notice under the title. */
      if (!isOwner) return;
      const api = commentsNow.current;
      if (!api) return;
      /* **Nothing is bought here.** Until 2026-08-26 this line spent a model
         call the reader had not asked for; then it opened an ask box; from
         2026-08-28 a comment *draft* box; since 2026-10-04 it stores a free
         highlight. The model is only ever asked from a button. */
      if (refereeNow.current) {
        /* **Referee mode keeps the draft box, exactly as it was.** A selection
           there is evidence for a criterion: it opens on No colour, the
           placement is part of the one save, and nothing is stored until the
           referee says. AnnotateDialog.tsx § Referee only.

           The browser's selection is left alone here: there is no stored mark
           yet, so clearing it would leave a quote in a box with no sign of
           which words on the page it came from. */
        void setNote(null);
        void setThread(null);
        setChatDraft(null);
        setAnnotating({ blockId: anchor.blockId, quote: anchor.quote, start: anchor.start });
        return;
      }
      /* **Overlap means correction** (GPT Sol, E3). The fresh box was closed
         by the press that began this very drag, in the same paragraph, over
         some of the same characters: the reader is fixing which words, not
         asking for two highlights. The first goes, if it is still exactly what
         the selection wrote — read from the stored row *now*, and from
         `touched` for anything the store has not answered yet. A mouse only:
         by touch the second selection is a new long-press, a new gesture. */
      const closed = closedFresh.current;
      /* **The very words of the fresh highlight are not a new selection.** A
         mouse keeps them selected while the box is open (§ A mouse keeps its
         words selected), and a click on selected text does not collapse the
         selection until after its `mouseup` — so a click on the highlight
         arrives here as its own anchor again. It is a click away: leave the
         row alone, leave `closedFresh` for `openCommentDialog`, and let the
         box close as the press ends. Before the close moved to the end of the
         gesture, the repaint at `pointerdown` had collapsed the selection and
         this could not arise. */
      if (input === "mouse" && closed && sameAnchor(closed.anchor, anchor)) return;
      closedFresh.current = null;
      if (input === "mouse" && closed && !closed.touched && spansOverlap(closed.anchor, anchor)) {
        const row = api.comments.find((c) => c.id === closed.id);
        if (row && isPristineHighlight(row)) api.remove(row.id);
      }

      const id = mintId();
      const mine = ++selectPress.current;
      const before = surface.current;
      /* Read before `create`, which is what decides which of the two paths
         below this is: with the list in, the row is drawn in this same turn. */
      const listIn = api.loaded;
      const stored = api.create({
        id,
        blockId: anchor.blockId,
        quote: anchor.quote,
        start: anchor.start,
        colour: DEFAULT_HIGHLIGHT,
      });
      const openFreshBox = (rowId: string) => {
        openedThisGesture.current = true;
        freshTouched.current = false;
        setFresh({ id: rowId, anchor, input });
        /* One panel in the slot, and the box is drawn only when no chat is. */
        void setThread(null);
        setChatDraft(null);
        setAnnotating(null);
        void setNote(rowId);
      };
      /* **As soon as its row exists.** With the list loaded that is now. */
      if (listIn) openFreshBox(id);
      void stored.then((comment) => {
        if (comment === null) {
          /* Refused, or removed by the reader meanwhile. The row is gone and
             the box with it; do not leave `?note=` naming nothing. */
          if (listIn) void setNote((current) => (current === id ? null : current));
          return;
        }
        if (listIn) {
          /* The server may mint a different id; follow the row. */
          if (comment.id !== id) {
            setFresh((current) => (current?.id === id ? { ...current, id: comment.id } : current));
            void setNote((current) => (current === id ? comment.id : current));
          }
          return;
        }
        /* **Held behind the opening read**, the first seconds of a page: there
           was no row to open a box on until now. `bookmarkBlock`'s two guards:
           not over anything the reader opened while waiting, and not for a
           selection that is no longer the newest. The highlight is stored and
           painted either way. */
        const unchanged = surface.current.every((v, i) => Object.is(v, before[i]));
        if (mine === selectPress.current && unchanged) openFreshBox(comment.id);
      });
      /* **A finger's selection is put away; a mouse's is left alone** (GPT
         Sol, E4). On touch this takes the OS handles and callout off the words
         the paint now marks. A mouse's stays for the reader to copy. */
      if (input === "touch") window.getSelection()?.removeAllRanges();
    },
    /* **`isOwner`, not `owner`.** The capability is a new object on every
       render of `OwnedReader` (ArticlePage.tsx), and a reading-time step is one
       of those — so depending on the object made this a new function each
       time, and it is `memo(TableView)`'s `onSelect`. GPT Sol's F2 on
       docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md;
       tests/spine-reading.test.ts verifies a reach update leaves TableView's
       render count unchanged, including with marginalia open. The comments
       api and the mode come through refs for the same reason. */
    [isOwner, setNote, setThread],
  );
  /** The chip's press: the same call, said to be a finger's. */
  const selectProseByTouch = useCallback(
    (anchor: SelectionAnchor) => selectProse(anchor, "touch"),
    [selectProse],
  );

  /**
   * Open a comment's dialog and **move nothing** — the third `onOpenComment`,
   * and the one that is not a jump.
   *
   * `TableView`'s inline mark and gutter bookmark are controls attached to the
   * block the reader is looking at, so the passage is on screen by
   * construction; there is nothing to scroll to and nothing to push. The
   * drawer's two closures go through `openCommentFromDrawer` instead, and the
   * dialog's four arrows through `stepToNeighbouringComment` (comment-jump.ts).
   *
   * **`string`, not `BlockId`**: what arrives is a *comment* id, read off
   * `data-comment`. It compiled as `BlockId` only because that is an alias for
   * `string`, so the annotation was a lie a reader would have believed. GPT Sol
   * F24, 2026-09-06.
   */
  const openCommentDialog = useCallback(
    (id: string) => {
      /* **A click on the words just highlighted is a click away**, not a
         request to open them. Its `pointerdown` marked the fresh box to close
         when the press ends (`closedFresh`); this `mouseup`, landing on that
         highlight's own mark, comes just before that close, and without this
         it would name the same comment again and the box would open straight
         back up as an ordinary one.
         The next press on the mark is a new gesture and opens it as usual. */
      if (closedFresh.current?.id === id) return;
      openedThisGesture.current = true;
      void setNote(id);
    },
    [setNote],
  );

  /**
   * The whole address, subscribed to — the input to the block permalinks.
   *
   * The only subscription in this file that is not a `useQueryState`, and it is
   * here because those are key-isolated and this needs *all* of them. Pathname
   * as well as query, because `blockHref` uses both. See the `linkBase` prop on
   * `TableView` below.
   */
  const address = useAddress();

  /**
   * **The band the modes take turns in — one switch, and the compiler checks
   * it.**
   *
   * It was seventeen sibling `{mode === "…" && <Band/>}` expressions until
   * 2026-09-06, which is a dispatch nothing checks: a mode added to `MODES`
   * simply had no branch, and a reader pressing its button got an empty band
   * and no error anywhere. The `never` default below is what makes that a
   * compile error instead — the idiom in visitor.ts § `visitorGap`, and the
   * same one `selectPassages` uses for the other half of this decision.
   *
   * **A local function rather than a `<ModeBands>` component**, which the
   * docblock at the top of this file used to propose and the audit priced at
   * twenty-one props if the passage state were bundled and thirty-four if not.
   * This closes over `Reader`'s scope, so it threads **zero** props; it calls no
   * hooks, so it is not a component and the rules-of-hooks question does not
   * arise. Every gate below is the one the sibling expression had — the
   * owner/visitor pairs and their `artefacts?.x` tests, the single `access`
   * branch, the owner-only bands, and `key={mode}` on `ConversationBand`, which
   * is correctness rather than tidiness.
   *
   * `plain` returns `null` explicitly: it is a mode with no band, not a
   * default that would silently accept a fifteenth mode.
   *
   * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md
   * § Stage 4b, and docs/project/mode.md.
   *
   * **And every band it returns is inside one error boundary**, put there by
   * `band()` below rather than case by case — ModeBoundary.tsx.
   */
  function modeBand(): ReactNode {
    switch (mode) {
      /* **The mode with no band at all**, said rather than fallen into. Plain
         is the way out to the article; it has nothing to put in the middle. */
      case "plain":
        return null;
      case "chat":
        /* **The key is inert today, and it is kept for the day it is not.**
           It was written when one `ConversationBand` was mounted by two modes
           — `{(mode === "chat" || mode === "review") && <ConversationBand
           key={mode} …/>}`, commit 2dd63119 — where it is what stopped Remember
           inheriting chat's open conversation and focus nonce. Remember
           has had a wrapper of its own since, so this arm renders for one mode
           and `mode` is the constant `"chat"`; the arms return different
           top-level types, so React discards the outgoing subtree with or
           without it. GPT Sol proved that against the installed React on
           2026-09-06 (stage 4b, F2) after a mutation that deleted the key left
           every test green — which was not a hole in the tests, because there
           was nothing to catch.

           Left in place rather than deleted because a constant key costs
           nothing and the condition that made it matter can come back in one
           edit: the moment two modes return `<ConversationBand>` from this
           switch, the reader carries the other conversation across. See
           ConversationBand. */
        return owner ? (
          /* Chat's answers may carry command chips; Remember's and
             Candidates' prompts never ask for one, so only this arm and the
             chat dialog below are given the executor. CommandChip.tsx. */
          <ChatCommands executor={chatCommands.band}>
            <ConversationBand
              key={mode}
              slug={slug}
              blocks={blockText}
              onJump={bandJump}
              kind="chat"
              onScreen={chatOnScreen}
              handoff={chatHandoff}
              onHandoffTaken={handoffTaken}
            />
          </ChatCommands>
        ) : null;
      /* **Remember is two bands behind one mode**, and the choice between them
         is `?remember=`. The wrapper exists so that the parameter and its
         collision with `?thread=` are decided in one place rather than in each
         half — see `RememberBand`. */
      case "remember":
        return owner ? (
          <RememberBand
            slug={slug}
            quizRead={owner.quiz}
            quizArrival={quizArrival}
            onQuizArrivalTaken={quizArrivalTaken}
            blocks={blockText}
            readSoFar={readSoFar}
            sections={quizSections}
            onJump={bandJump}
            onQuizKeys={onQuizKeys}
          />
        ) : null;
      case "glossary":
        /* `glossaryRead ?` rather than `owner ?`, and it is the same test: the
           read is non-null exactly when the article is yours. Written this way
           because it is also the narrowing the band needs — a band with no read
           to hand it has nothing to draw.

           The visitor's arm is one of **the visitor's three bands, and they are
           the slice.** Each is the same panel as the owner's with its data
           injected and no hooks behind it — the list arrived in this page's own
           payload, so there is nothing to fetch and nothing to poll. A separate
           component per mode because a hook cannot be called conditionally,
           which is the same reason `OwnedReader` exists one level up; a separate
           *panel* would be two designs for one list. reader-capability.ts, and
           GlossaryPanel.tsx § GlossaryOwner.

           Gated on the artefact itself rather than on `available`, so the branch
           that renders the band and the flag that decides the sentence cannot
           disagree: an absent key means `visitorGap` said `not-built` and the
           `VisitorBand` above is showing instead. */
        if (glossaryRead)
          return (
            <GlossaryBand
              slug={slug}
              read={glossaryRead}
              onJump={bandJump}
              onSelected={setTerm}
              onAskChat={askInChat}
            />
          );
        return artefacts?.glossary ? (
          <VisitorGlossaryBand
            glossary={artefacts.glossary}
            onJump={bandJump}
            onSelected={setTerm}
          />
        ) : null;
      /* **One structural band with two faces, and it owns its own hooks.**
         `StructureBand` builds the tree and runs the focus sampler itself, and
         is only mounted here — so nothing of this mode's is measured or built
         while the reader is in any other one. It chooses between Structure's
         two columns and Outline's nested list by the band's own width
         (StructureMode.tsx § `structureFace`); Outline was a mode of its
         own until 2026-09-10, with its tree and sampler up in this component.

         No owner/visitor pair, and that is the point rather than an omission:
         both faces are drawn from the tree in the payload every reader already
         holds, reach no artefact, and cost nothing — so a visitor gets the
         whole of it, exactly as they get the table of contents. `visitorGap`
         has to be told that explicitly, because it fails closed. */
      case "structure":
        return (
          <StructureBand
            slug={slug}
            /* Only for the line a headings tree draws: the owner's is the one
               with *Try again* on it (StructureNotice.tsx). */
            owner={isOwner}
            article={article}
            leafDepth={geometry.leafDepth}
            sections={sections}
            layoutKey={layoutKey}
            supplementOf={geometry.supplementOf}
            arcByRow={arcCells}
            rootFontPx={rootFontPx}
            /* `modeW` is 0 exactly when the band covers the prose instead of
               sitting beside it (layout.ts) — a phone, since 2026-09-06; it was
               iPad portrait and below until the crossover fell to 700. That is
               the condition paragraph rows are not permissible under, in either
               face, and reading it from the layout rather than from a width
               guessed here is why that move cost this line nothing but its
               example. */
            proseBeside={fit.modeW > 0}
            onJump={bandJump}
          />
        );
      /* The plain-words levels are an artefact, so since 2026-09-30 this is an
         owner/visitor pair — the visitor's band takes the stored paragraphs off
         the payload and fetches nothing.
         docs/plans/260930i-simple-summaries-eli15-sub-mode.md.

         **And the thread, since 2026-10-03**: Summary's third view, a mode of
         its own (Tweets) before. The band picks between the two artefacts by
         `?summary=`, and is the wide one while the thread shows (`bandShape`
         above). No passages either way: each post's links are jumps.
         docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md. */
      case "summary":
        if (!owner)
          return (
            <VisitorSummaryBand
              slug={slug}
              simple={artefacts?.simpleSummary}
              thread={artefacts?.tweets}
              article={article}
              onJump={bandJump}
            />
          );
        /* `onAskChat` on the owner's band only: a visitor has no chat, and
           `VisitorSummaryBand` above has no such prop to be handed. */
        return <SummaryBand slug={slug} article={article} onJump={bandJump} onAskChat={askAboutSummary} />;
      /* **Mounted for a visitor too, since 2026-09-04** — one branch rather
         than the owner/visitor pair the artefact modes have, because there is
         no artefact to carry and no second component to build: the default
         picture is drawn from the tree the page already holds. What differs is
         the `access` prop, which pins the picture to Force and turns off all
         three of the panel's fetching hooks.
         docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 2. */
      case "diagram":
        return (
          <DiagramBand
            /* The visitor arm carries the drawing itself, out of the payload —
               `artefacts.sketch` is absent when nobody has drawn one, which is the
               ordinary case and is a sentence rather than a missing picture.
               docs/plans/260904c-more-modes-on-a-shared-link.md § Sketch. */
            access={owner ? { kind: "owner" } : { kind: "visitor", sketch: artefacts?.sketch }}
            /* Which of the five picture chips the row draws — the same answer the
               bar below is given, from the same hook, so the two cannot disagree
               about what this reader is being shown.
               DiagramPanel.tsx § `visibleKinds`. */
            experimental={experimental.on}
            slug={slug}
            article={article}
            at={at}
            onJump={bandJump}
            /* Walking the picture follows it in the prose without stepping the
               band aside — DiagramPanel.tsx § `onFollow`. */
            onFollow={followTo}
          />
        );
      /* **The first mode that could break on its own**, 2026-09-05 — the
         controller had to leave this file for a boundary to enclose it, which
         is the shape every band now has. The boundary itself is `band()`'s.
         docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md. */
      case "ideas":
        if (owner)
          return (
            <IdeasBand
              slug={slug}
              blocks={article.blocks}
              onJump={bandJump}
              onFound={setIdeaFound}
              openKey={openOccurrence}
              onOpenKey={setOpenOccurrence}
            />
          );
        return artefacts?.ideas ? (
          <VisitorIdeasBand
            ideas={artefacts.ideas}
            blocks={article.blocks}
            onJump={bandJump}
            onFound={setIdeaFound}
            openKey={openOccurrence}
            onOpenKey={setOpenOccurrence}
          />
        ) : null;
      /* **Neither band publishes anything any more.** The marks are
         `useQuoteMarks` above, drawn in every mode; what is left down here is
         the panel, its three controls and — for the owner — the job machinery
         that must not be mounted anywhere else. QuotesMode.tsx. */
      case "quotes":
        if (owner)
          return (
            <QuotesBand
              slug={slug}
              read={owner.quotes}
              onJump={bandJump}
              steps={steppableQuotes}
              yours={quoteHighlights}
            />
          );
        return artefacts?.quotes ? (
          <VisitorQuotesBand quotes={artefacts.quotes} onJump={bandJump} steps={steppableQuotes} />
        ) : null;
      /* **The owner/visitor pair the ideas and the quotes have, since
         2026-09-04.** It was one branch until then, and the comment here said
         there was deliberately no `VisitorTimelineBand` waiting for a payload
         field that did not exist. The field exists now.
         docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 1.

         Gated on the artefact itself rather than on `available`, like the
         glossary above: an absent key means `visitorGap` said `not-built` and
         the `VisitorBand` is showing instead, so the branch that renders and
         the flag that decides the sentence cannot disagree. */
      case "timeline":
        if (owner)
          return (
            <TimelineBand
              slug={slug}
              blocks={article.blocks}
              onJump={bandJump}
              onFound={setTimelineFound}
              openKey={openTimelineKey}
              onOpenKey={setOpenTimelineKey}
            />
          );
        return artefacts?.timeline ? (
          <VisitorTimelineBand
            timeline={artefacts.timeline}
            blocks={article.blocks}
            onJump={bandJump}
            onFound={setTimelineFound}
            openKey={openTimelineKey}
            onOpenKey={setOpenTimelineKey}
          />
        ) : null;
      /* **The owner/visitor pair, since 2026-09-29** — Stage 4, which built the
         boundary a visitor's row must pass: every row's address re-judged by
         `publicCitationUrl` (a refusal drops the row, counted), and the
         article's own address inside a direct row judged as the masthead's is
         (src/public/dto.ts § `publicDebate`). Gated on the debate itself, like
         the timeline's: an absent key means `visitorGap` said `not-built` and
         the `VisitorBand` is in the slot. `VisitorDebateBand` mounts no
         `useDebate`, so nothing here can start a search.
         docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md § Stage 4,
         docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md. */
      case "debate":
        if (!owner)
          return artefacts?.debate ? (
            <VisitorDebateBand
              debate={artefacts.debate}
              onJump={bandJump}
              blockOrder={blockOrder}
              publishedAt={publishedAt}
              articleTitle={article.meta.title}
            />
          ) : null;
        return (
          <DebateBand
            slug={slug}
            onJump={bandJump}
            blockOrder={blockOrder}
            publishedAt={publishedAt}
            articleTitle={article.meta.title}
          />
        );
      /* **The owner/visitor pair, since 2026-09-29.** It was the owner alone
         until a public article's stored Skim was refused to a signed-out
         reader (SPIDERYARN-READING2-56); a stored list is the same case. The
         visitor's rows arrive with every address re-judged by
         `publicCitationUrl` (src/public/dto.ts § `publicCitedWork`), and the
         branch is gated on the list itself, like the timeline's: an absent key
         means `visitorGap` said `not-built` and the `VisitorBand` is in the
         slot. No passages — the row's "first cited" is a jump, not a selection.
         docs/plans/260911g-citations-mode.md,
         docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md. */
      case "citations":
        if (!owner)
          return artefacts?.citations ? (
            <VisitorCitationsBand citations={artefacts.citations} onJump={bandJump} />
          ) : null;
        return (
          <CitationsBand
            slug={slug}
            read={owner.citations}
            onJump={bandJump}
            focus={citeFocus}
            onFocusTaken={citeFocusTaken}
          />
        );
      /* **The owner/visitor pair, since 2026-09-29**, for the citations' reason
         above. No passages: each passage under a question is a jump, not a
         selection. docs/plans/260916d-faq-mode.md,
         docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md. */
      case "faq":
        if (!owner) return artefacts?.faq ? <VisitorFaqBand faq={artefacts.faq} onJump={bandJump} /> : null;
        return <FaqBand slug={slug} onJump={bandJump} />;
      /* **The owner/visitor pair, since 2026-09-29.** A passage producer (the
         current stop) and a controller (← / → and the door after the stop's
         block), both published up here and both cleared when the band
         unmounts — for either band, since they share `useSkimMode`.
         docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md.

         The visitor's branch is gated on the route itself, like the timeline's:
         an absent key means `visitorGap` said `not-built` and the `VisitorBand`
         is in the slot. It was the owner alone until SPIDERYARN-READING2-56,
         when a public article's stored route was refused to a signed-out
         reader. docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md. */
      case "skim":
        if (!owner)
          return artefacts?.skim ? (
            <VisitorSkimBand
              route={artefacts.skim}
              quotes={artefacts.quotes?.quotes ?? NO_PUBLIC_QUOTES}
              glossary={artefacts.glossary}
              ideas={artefacts.ideas}
              timeline={artefacts.timeline}
              blocks={article.blocks}
              tree={article.tree}
              quoteMarks={quotes.found}
              covers={bandCovers}
              away={bandBack}
              onAway={bandStepsAside}
              onJump={jumpTo /* not `bandJump`: Skim jumps on opening, and steps aside itself (`onAway`) — Sol, 260929g */}
              onFound={setSkimFound}
              openKey={openSkimKey}
              onOpenKey={setOpenSkimKey}
              onControl={setSkimControl}
              onOpen={openFromStopCard}
              canOpen={canOpenFromStopCard}
              arrival={skimArrival.current}
            />
          ) : null;
        return (
          <SkimBand
            slug={slug}
            blocks={article.blocks}
            tree={article.tree}
            quotes={owner.quotes}
            quoteMarks={quotes.found}
            covers={bandCovers}
            away={bandBack}
            onAway={bandStepsAside}
            onJump={jumpTo /* not `bandJump`: see the visitor arm above */}
            onFound={setSkimFound}
            openKey={openSkimKey}
            onOpenKey={setOpenSkimKey}
            onControl={setSkimControl}
            glossary={owner.glossary}
            onOpen={openFromStopCard}
            canOpen={canOpenFromStopCard}
            arrival={skimArrival.current}
          />
        );
      /* **The owner/visitor pair, since 2026-09-04.** It was the owner alone
         until then, because search is the one mode where the reader's own
         question is the artefact. Greg drew the line at *making* one: a
         visitor gets the list, the ticks and the marks, and no way to ask.
         docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4.

         Not gated on there being any, unlike the artefact modes above: an
         article nobody has searched is an article nobody has searched, which
         is a sentence the panel draws rather than a missing artefact
         `visitorGap` should be standing in front of.
         src/public-types.ts § PublicArticle.searches. */
      case "search":
        return owner ? (
          <SearchBand
            slug={slug}
            blocks={article.blocks}
            onJump={bandJump}
            onFound={setFound}
            openHit={openHit}
            onOpenHit={setOpenHit}
          />
        ) : (
          <VisitorSearchBand
            searches={searches}
            blocks={article.blocks}
            onJump={bandJump}
            onFound={setFound}
            openHit={openHit}
            onOpenHit={setOpenHit}
          />
        );
      /* **The owner alone, like every other mode that spends money**, and it is
         the gate rather than a decoration: Criteria, Claims and Mirror all
         call a model, so a band a visitor could open would be
         spend on somebody else's paper with nobody's press behind it. `visitorGap`
         fails closed and already answers `owners-only` for this mode, so a
         visitor pressing the button gets the boundary sentence and not a blank
         band. src/web/visitor.ts. */
      case "referee":
        return owner ? (
          <RefereeBand
            slug={slug}
            blocks={article.blocks}
            /* **The byline, for Candidates and for nothing else** — the one call
               in Referee mode that legitimately sees who wrote the paper, and only
               so that they can be left out of its own suggestions.
               docs/project/referee-mode.md, rule 4. */
            byline={article.meta.byline}
            /* **The referee's own placements, for Criteria and for nothing
               else** — the ones carrying a `criterionId`. Passed rather than
               fetched again so the panel and the gutter cannot disagree about a
               judgement; `useComments` is already mounted for the page.
               docs/project/referee-mode.md § the referee's own mark. */
            comments={comments}
            onJump={bandJump}
            onFound={setRefereeFound}
            /* Which marked passage the referee last pressed, so the prose rings
               the exact phrase rather than washing the whole block. Search's
               `openHit` exactly, and threaded rather than held in the band for the
               same reason that one is: `TableView` draws the ring and it lives up
               here. */
            openKey={openRefereeKey}
            onOpenKey={setOpenRefereeKey}
          />
        ) : null;
      default: {
        /* The compiler being made to say that every mode has been given a band
           or an explicit `null`. A fifteenth mode in `MODES` goes red here
           rather than opening an empty band nobody notices — which is the whole
           reason this stopped being seventeen `&&` expressions. */
        const unhandled: never = mode;
        return unhandled;
      }
    }
  }

  /**
   * **The band, inside the boundary that lets it break on its own.** One call
   * site for every mode, so a band is contained because it is a band — the two
   * modes with none are exempt by name, in `MODE_CONTAINMENT`.
   *
   * `key={mode}` gives each mode a boundary of its own, so a broken Quotes
   * does not follow the reader into Timeline. What the boundary cannot protect
   * is anything computed up here and handed down — ModeBoundary.tsx § What the
   * boundary encloses. docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § B.
   */
  function band(): ReactNode {
    /* `VisitorBand` is the band when policy or a missing artefact stands in
       front of the mode's own component. It belongs under the same boundary:
       leaving it beside this function would make the public half of eight
       modes the one visible band that could still take the article with it. */
    const content = !owner && gap ? <VisitorBand gap={gap} signedIn={signedIn} /> : modeBand();
    if (MODE_CONTAINMENT[mode].kind === "exempt") return content;
    return (
      <ModeBoundary
        key={mode}
        mode={mode}
        slug={slug}
        owner={owner !== null}
        onPlain={() => void setMode("plain")}
      >
        {content}
      </ModeBoundary>
    );
  }

  /**
   * **Marginalia's column, apart from its notes** — the head pinned at the top
   * of the column and the read of the owner's ideas: what is not anchored to a
   * block (the notes are in the table's cells, `marginNotes`). Beside the band
   * rather than in it since 2026-10-01, inside a boundary of its own so a
   * broken head cannot take the band or the article with it; its way out
   * turns the notes off.
   *
   * **No narrow-window line under a covering band**: the band is the whole
   * window there, and a line about notes over a Glossary list is noise. Nor
   * where that band has stepped aside: the pill that brings it back sits
   * where the line would (the browser check, 2026-10-01), and it is the way
   * on from there anyway.
   */
  function marginColumn(): ReactNode {
    if (!marginOpen) return null;
    /* One block for the path and the arc both, so they cannot name different
       parts; above the first part it is the first part's first block
       (notes.ts § `headBlock`, qi-2ymfq3ek). */
    const headAt = headBlock(article.tree, rowOf, at ?? article.blocks[0]?.id ?? null);
    return (
      <ModeBoundary
        mode="marginalia"
        slug={slug}
        owner={owner !== null}
        onPlain={() => void setMargin(null)}
      >
        {owner && <OwnerMarginFeed slug={slug} onFeed={setOwnerFeed} />}
        {!bandCovers && (
          <MarginaliaHead
            room={fit.margW > 0}
            beside={bandOpen}
            path={headPath(article.tree, rowOf, headAt)}
            arc={arcAt(liveArc, rowOf, headAt)}
          />
        )}
      </ModeBoundary>
    );
  }

  return (
    /* Every block link inside — panels, chips, the chat dialog through its
       portal — reads its card and its "is this block real" answer from here.
       BlockLinkCard.tsx. */
    <BlockLinkProvider index={blockLinks} resolveXref={resolveXref} readingTimeFor={owner?.readingTime.timeFor}>
    <div
      /* `text-alone` says the article is the only thing on the page, so the
         stylesheet can centre the reading column and put the masthead over it
         rather than leaving both against the left edge of a window neither
         fills. It is `fit.alone` and nothing computed here on purpose — the
         same fact under two definitions is how `proseVisible` came to exist.
         layout.ts § `Fit.alone`, styles.css § plain, centred. */
      /* `band-covers` is the same idea and exists for a sharper reason: it is
         the *stylesheet's* only way to know that the mode band has no room
         beside the prose and is lying over it instead. That crossover is
         `MODE_MIN + MODE_PROSE_FLOOR` against the window **minus the rail**, so it
         moves with `?spine=0` — and a media query cannot see a query
         parameter. (It was `MODE_MIN + PROSE_MIN` until 2026-09-06, which is
         the pair the widths below are in.) It was one for six days (`@media (max-width: 843px)`), and
         from 832 to 843 with the rail off the two disagreed: layout.ts
         squeezed the table to make room for a band the stylesheet had already
         thrown over the article.

         So the fact is written here, from the one number that computes it,
         beside the `--mode-w` it is derived from. **`fit.modeW === 0`, not
         `bandCovers`**: it is also true when no band is open at all, and one
         rule wants exactly that — narrow Marginalia in Plain hides the
         small-screen banner with `.band-covers:has(.mode-band, .marg-narrow)`
         (styles/narrow-window.css). So every rule keyed off this class also
         names what is lying over the prose: `.mode-band`, or there
         `.marg-narrow` — styles.css § a band with no room,
         tests/spine-width.test.ts, tests/layout-margin.test.ts. */
      className={`reader spine-${fit.spine}${fit.alone ? " text-alone" : ""}${
        fit.modeW === 0 ? " band-covers" : ""
      }${bandBack ? " band-away" : ""}`}
      /* The wrapper must be as wide as its content for the sticky bars inside it
         to have anywhere to slide — a sticky element is clamped to its containing
         block, so one exactly its own width has a sticky range of zero and never
         moves. See docs/reusable/css-sticky-containing-block.md. Set explicitly
         rather than with `max-content`, which a table of prose answers with a
         number in the thousands. */
      /* `+ horizontalInset(...)`: `fit.minWidth` is the spine plus the table,
         computed from a width that already had the notch taken out of it, and
         `box-sizing: border-box` means this number has to cover `.reader`'s
         padding too — which now includes those same insets (styles.css § shell).
         Without the term the table's last column is squeezed out of the content
         box and the page scrolls sideways by the notch. */
      style={
        {
          minWidth: fit.minWidth + horizontalInset(safeAreaInsets()),
          "--mode-w": `${fit.modeW}px`,
          /* The width `fitView` was given — the page beside the scrollbar,
             notch already out — for the two sticky bars, which were `100vw`
             and so 15px wider than the page beside a classic scrollbar
             (measure.ts § `pageWidth`, postmortem 261002a). One number for
             the layout and the bars, rather than CSS guessing it again. */
          "--page-w": `${windowWidth}px`,
          /* The table's own width, so the masthead can be as wide as the
             reading column when it is centred over it (styles.css § plain,
             centred) without a second copy of `PROSE_ALONE_MAX_REM` in CSS. */
          "--table-w": `${fit.tableW}px`,
          /* Marginalia's column, and the room `.reader` keeps for it on its
             right — layout.ts § `fitMargin`. Both 0 in every other mode. */
          "--marg-w": `${fit.margW}px`,
          "--marg-reserve": `${fit.margReserve}px`,
          "--marg-left": `${fit.margLeft}px`,
        } as CSSProperties
      }
    >
      {fit.spine !== "off" && (
        <Spine
          outline={outline}
          layoutKey={layoutKey}
          matches={hitBlocks}
          reading={owner?.readingTime.reach}
          quotes={quoteRail}
          onJump={jumpTo}
        />
      )}
      {owner && <ReadingTimeStyle levels={owner.readingTime.levels} />}
      {/* The band's links to the paragraphs on screen, lit — for every mode,
          and only while a band and the prose are both painted (Sol, plan
          review of 261001n). OnScreenLinksStyle.tsx. */}
      <OnScreenLinksStyle enabled={bandOpen && fit.modeW > 0} layoutKey={layoutKey} />

      {/* Everything constant about the article — see Masthead.tsx for why
          constant is the word that decides it belongs here and not in a
          column. */}
      <Masthead article={article} slug={slug} onRenamed={onRenamed} archive={archive} />
      {/* The statement, where a visitor's eye already is on arrival. The
          *persistent* half of it is the chip in the bar below, which is sticky;
          this is the sentence and the ask, which belong with the title. Not
          dismissible: it is what this page is, not a notification.
          PublicChrome.tsx. */}
      {/* **And the banner**: where it came from, the takedown offer, the
          training promise — plan 261002g. `webSource` is the masthead's own
          check on the address, so the two lines cannot disagree about it. */}
      {!owner && (
        <SharedNotice
          signedIn={signedIn}
          sessionUnconfirmed={sessionUnconfirmed}
          source={{ url: webSource(article.meta), guess: article.sourceGuess }}
        />
      )}
      {/* **Why the article and the mode panel are never both on screen here**,
          on a narrow touch window, once per device. Below it the reader is
          about to press a mode button and watch the text disappear; this is the
          sentence that says the way back is Plain.

          After the visitor's notice, not before: what footing you are reading
          on outranks a note about the shape of the window. Before the controls
          bar, because the bar is what the note is about — and because the bar
          is sticky and this is not, so a banner underneath it would slide out
          from behind the thing it names.

          **`bandCoversProse` rather than a width, and `showSpine` rather than
          `fit.spine`.** The banner is about one layout decision and has to fire
          exactly where that decision does — which moves with the rail, since
          the rail is 12px of the window the band is negotiating for. The raw
          parameter, not the resolved `fit.spine`, because this is a question
          about a band that is *not open yet*: `fitView` turns the rail off in
          outline mode, where there is no band, and reading that would make the
          banner blink in and out as an iPad reader switched modes. layout.ts §
          `modeSpine` is where the two resolutions were made one.

          Asking layout.ts is also what keeps it live without a listener of its
          own: `useWindowWidth` above re-measures on `resize` and
          `orientationchange`, and this recomputes with it. SmallScreenHint.tsx. */}
      <SmallScreenHint bandCovers={bandCoversProse(windowWidth, showSpine)} />
      {/* **What is left of this bar after 2026-09-05**, and the list of what
          went is the point — Greg: *"The top bars are really crowded and
          confusing … They're all unnecessary and confusing."* Gone: the `Spine`
          toggle (the rail is simply on now — layout.ts § `spine`), the `Mode`
          and `Granularity` labels, the mode-name chip, the `×`, the `Text`
          pill, `fit`/`auto`, the `reading`/`outline` chip, the `↑↓` readout and
          the tree-version chip. Every one of them was defensible on its own and
          the sum was unreadable; the reasoning for each is in the git history
          and in docs/plans/260905d-declutter-the-reading-view-top-bars.md.

          Two things say what the old chrome said, more quietly: the Dock at the
          foot of the page names the open mode and is the way out of it, and
          the URL still carries `?spine=` for anybody who wants to pin the rail
          by hand (docs/project/url-state.md). */}
      {/* **And since 2026-09-08 it is not drawn at all when that leaves it
          empty**, which on a reading view is most of the time: `showBar` above
          decides whether the element exists, and shell.css then stops reserving
          its height (44px, or more on a narrow window while it holds the
          breadcrumb). It was no longer "the one piece of chrome that
          is on screen at every scroll position" — the sentence below is kept
          because it is still the ordering rule for what goes *in* the bar, and
          the Dock is what that claim is now true of.

          **The element itself, rather than `display: none` or a `:empty` rule**
          — which would both work for the layout, and were weighed rather than
          missed. `scroll.ts` asks the DOM four times whether there is a bar and
          a present-but-unpainted one answers yes to all four; and `:empty` is
          one stray `{" "}` away from drawing the strip again with nothing to
          say so. docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md
          § The simpler options passed over. */}
      {/* Directly before the bar, and only for a bar that holds the breadcrumb:
          BarStuckSentinel.tsx. */}
      {showCrumbs && <BarStuckSentinel />}
      {showBar && (
        <div className="controls">
          {/* First of all: what footing you are reading on outranks every control
              that follows. */}
          {!owner && <ViewOnlyChip sessionUnconfirmed={sessionUnconfirmed} />}
          {/* Where in the structure the reader is — `showCrumbs` above. */}
          {showCrumbs && (
            <HeadingsCrumbs
              root={crumbsRoot}
              sections={sections}
              layoutKey={layoutKey}
              onJump={jumpTo}
            />
          )}
          {/* **Failures of the comment transport left this bar on 2026-09-08**,
              for the Dock's Comments button — which is the control they are about,
              and which is on screen whether or not this bar is. They were here
              because "if the fetch never landed there is no dialog to put them
              in", and that is still true: the Dock is the answer to it now.
  
              They could not stay: this bar is drawn only when it has content
              (`showBar` above), so a refused delete would have summoned a bar of
              chrome and pushed the article down mid-read. **Not deleted** — GPT
              Sol's G3 on 260905g refused that, because `error` is not the
              drawer's `loadError`: that one is about the fetch that fills the
              list, while this carries every failed *change*, including one
              whose row has scrolled off. The load warning stays above a later
              saved comment too — Dock.tsx § Questions. */}
          {/* **The tree's version sat here, in a dashed monospace chip, on every
              article.** It went on 2026-09-05 with the glossary's and the
              quotes' provenance lines, which are the same fact in the same voice
              — Greg: *"those are all confusing and unnecessary"*, then *"and any
              other modes as needed"*. This one is the controls bar rather than a
              mode, and it is the most-seen of the three, which is the argument
              for rather than against. `hierarchy/4` tells a reader nothing they
              can act on; `Metadata` is where an owner sees it
              (Metadata.tsx § `StageRow`). The narrow breakpoint already hid it,
              which was the first sign it was not carrying its space. */}
        </div>
      )}
      <TableView
        article={article}
        /* The route's slug, not `article.meta.slug` — TableView.tsx § `slug`
           has the reason, and it is the same one `Origin` gives in
           Metadata.tsx. */
        slug={slug}
        /* The permalink base — this page's whole address, including every
           parameter added after this line was written, minus the one the link
           is about to set.

           **`useAddress` rather than a bare read of `location`**, and the
           difference is the whole correctness of this: reading the global here
           would be right only if `Reader` re-rendered on every URL change, and
           it does not. nuqs subscriptions are key-isolated, so ten reading
           parameters owned by child components — `summary`, `diagram`, `dhue`,
           `referee`, `remember` and five more — change the address without
           waking this component at all. Until `TableView` was memoised, `?at=`
           re-rendered it once a second and hid that; it does not any more.
           router.ts § `watchHistoryWrites`. Found by GPT Sol, 2026-09-04.

           No `useMemo`: it is a string, and strings compare by value. A render
           caused only by `?at=` produces an equal one, so `memo(TableView)`
           holds; any other parameter produces a different one and it correctly
           does not. TableView.tsx § `Props.linkBase`. */
        linkBase={addressWithout(address, "at")}
        geometry={geometry}
        layout={fit}
        onJump={jumpTo}
        notes={notes}
        noteReturn={noteReturn}
        onFollowNote={followNote}
        comments={comments}
        openComment={note}
        chats={chats}
        chatCounts={chatCounts}
        /* A visitor is handed the owner's notes, and the gutter's mark must not
           call them theirs — BlockGutter.tsx § `notesBy`. */
        notesBy={owner ? "you" : "owner"}
        openChat={overlay?.kind === "thread" ? overlay.threadId : null}
        chatOpenBlock={chatOpenBlock}
        onOpenChat={openChatThread}
        /* The gate, and only the gate — the body is `chatAboutBlock` above,
           which explains why it is `undefined` rather than a no-op here. */
        onChatAbout={owner ? chatAboutBlock : undefined}
        /* **One press, and it spends.** `helpAboutBlock` above either reopens
           the conversation this block already has or mints a draft carrying
           `help: true`, and `ChatDialog` sends that on mount — no composer, no
           confirmation. The button's own copy names the AI for exactly this
           reason (BlockGutter.tsx), and the accidental tap is a cost Greg
           accepted on 2026-09-04 because one press was the point.

           **This comment said the opposite until 2026-09-05**, describing the
           stage-2 behaviour — "opens the same pre-filled draft and spends
           nothing" — for a day after stage 3 landed and made it send. A comment
           saying a button is free when it is not is the one direction this
           particular mistake must never run. Found by GPT Sol.

           The seam is a `ChatTarget` variant rather than a handler hoisted up
           here, because a token arriving in this component re-renders the whole
           article. Gated on `owner` for the reason above; the two doors are one
           capability. */
        onHelp={owner ? helpAboutBlock : undefined}
        afterBlock={afterBlock}
        quizAfter={quizAfter}
        margin={marginNotes}
        /* The owner's, and only once the opening read has landed without error
           — `bookmarkBlock` says why. */
        onBookmark={
          owner && bookmarkBlock && owner.comments.loaded && owner.comments.loadError === null
            ? bookmarkBlock
            : undefined
        }
        terms={termSelections}
        cites={citeSelections}
        xrefs={xrefs}
        openTerm={term?.id ?? null}
        hitMarks={hitMarks}
        hitHues={hitHues}
        hitStrength={hitStrength}
        onSelect={selectProse}
        onOpenComment={openCommentDialog}
      />
      {/* **A finger's selection gets no `mouseup`**, so the `onSelect` above
          never hears of it on an iPad; this is the button it gets instead, and
          it calls the same `selectProse`, saying it was a finger — which is
          what applies the highlight and then clears the selection. Two gates, both decided here because
          here is where they are known. `owner &&`: a visitor's selection is
          silent (`selectProse`'s early return), and a chip that appears and
          then does nothing is not silent. `suppressed`: the three conditions
          are the render conditions of the three boxes below, so it is never
          over an open one. It is not in `surface.current` and owns no Escape —
          it is a button, not a surface. The key drops every held anchor and
          document listener on an article or mode change, even if WebKit sends
          no selectionchange for the old DOM. docs/project/touch.md § A
          finger's selection gets a button; the wiring is read by
          tests/touch-selection-chip.test.tsx. */}
      {owner && (
        <TouchSelectionChip
          key={`${slug}:${mode}`}
          suppressed={Boolean(annotating || overlay || openComment)}
          onSelect={selectProseByTouch}
        />
      )}
      {owner && annotating && (
        <AnnotateDialog
          /* **Referee mode's box, since 2026-10-04** — `selectProse` sets
             `annotating` nowhere else.

             **One box per passage, by key.** A new selection unmounts the box
             that was open, whose cleanup stores its draft against its own
             passage, and mounts an empty one — AnnotateDialog.tsx §
             `annotateKey`. Read by tests/annotate-dialog-keeps-a-draft.test.tsx. */
          key={annotateKey(annotating)}
          anchor={annotating}
          /* **Referee mode only**, and all four of its sub-modes: the criteria
             are fetched inside the section rather than lifted out of the
             Criteria panel, which only mounts on one of them. */
          placing={mode === "referee"}
          /* **Escape belongs to whatever is in front of this box**, and two
             things can be: `CommentDialog`, whose arm below renders on
             `openComment`, and `ChatDialog`, whose arm renders on `overlay`.
             Both are reachable with a selection still live — clicking a comment
             mark goes through `openCommentDialog`, which clears nothing, and
             `chatAboutBlock`/`helpAboutBlock` clear `note` but not `annotating`
             — and until 2026-09-07 one press closed the box in front *and* this
             one, discarding a half-typed annotation.

             The two conditions are repeated here rather than lifted into a
             `somethingInFront` variable on purpose: they are the render
             conditions of the two arms below, and a reader checking that this
             is right should be comparing them with those, not with a third
             name. Stage 3 of
             docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md;
             the pairs are tests/one-escape-closes-one-surface.test.tsx. */
          escapeEnabled={!openComment && !overlay}
          /* Save waits for the comment list: its answer replaces the list, and
             a comment saved before it landed was wiped from the tab.
             tests/opening-read-gates-writes.test.tsx reads this line. */
          loaded={owner.comments.loaded}
          onCancel={() => setAnnotating(null)}
          onSave={({ anchor, id, body, ask, mark, colour, leaving }) => {
            /* **The box's anchor, never `annotating`**: a draft stored because
               the reader selected something else arrives after that state has
               moved on to the new passage. */
            const comment = {
              id,
              blockId: anchor.blockId,
              quote: anchor.quote,
              start: anchor.start,
              ...(body ? { body } : {}),
              /* The referee's placement rides along with the free save, so a
                 placement is never a second request that can fail on its own. */
              mark,
              /* And the highlight colour, for the same reason. */
              ...(colour ? { colour } : {}),
            };
            /* The page is going (`pagehide`): the request that survives it, and
               nothing else — the box stays as it is, because the page may yet
               come back from the back/forward cache. */
            if (leaving) {
              owner.comments.createOnLeave(comment);
              return;
            }
            /* **Close only the box that saved.** For the same reason as the
               anchor: an unconditional `null` here closed the box the new
               selection had just opened. */
            setAnnotating((cur) => (cur && annotateKey(cur) === annotateKey(anchor) ? null : cur));
            /* **The free thing is stored first, and the paid thing waits for
               it.** If the chat call fails, or the reader closes the panel
               before sending, their words are already on disk. The reverse
               order — open the chat, save afterwards — loses the comment for
               exactly the reader who typed the most into it. */
            void owner.comments.create(comment).then((stored) => {
              if (!ask || !stored) return;
              /* The conversation opens on the same words, pre-filled with what
                 they wrote. `sourceComment` travels with it so the *server*
                 can write the link once it knows the real thread id — the
                 client's is a guess it only learns was wrong if it was. */
              void setThread(null);
              setChatDraft({
                kind: "draft",
                anchor: {
                  blockId: anchor.blockId,
                  quote: anchor.quote,
                  start: anchor.start,
                },
                opening: anchor.quote,
                sourceCommentId: stored.id,
                ...(body ? { question: body } : {}),
              });
            });
          }}
        />
      )}
      {/* `owner &&` as well as `overlay &&`, and the compiler wants it for the
          same reason the comment on `overlay` above gives: the narrowing has to
          be visible at the branch, not inferred from two other pieces of state
          being empty. */}
      {owner && overlay && (
        <ChatCommands executor={chatCommands.dialog}>
          <ChatDialog
            slug={slug}
            target={overlay}
            at={at}
            blocks={blockText}
            onJump={jumpTo}
            onClose={() => {
              setChatDraft(null);
              void setThread(null);
            }}
            onThread={(id) => {
              /* The draft has become a conversation. Cleared in the same commit
                 that names the thread, so the slot never holds both — the panel
                 becomes the conversation rather than closing and reopening. */
              /* **And the comment learns which conversation it started.** The
                 link itself was written by the server, which is the only place a
                 real thread id exists; this is the browser catching up, so the
                 mark and the dialog are right *now* rather than after a reload.
                 Read `chatDraft` before it is cleared — it is the only thing that
                 knows this conversation came from a comment. Fires again with the
                 server's correction if the id we guessed was overruled, and the
                 last word wins. */
              const from = chatDraft?.kind === "draft" ? chatDraft.sourceCommentId : undefined;
              if (from) owner.comments.noteThread(from, id);
              setChatDraft(null);
              void setThread(id);
            }}
            onOpenFull={() => {
              /* One id, so this is the whole of it: the band reads the same
                 `?thread=` the panel was reading. */
              setChatDraft(null);
              void setMode("chat");
            }}
            /* **The draft branch, on purpose**, not `chatAboutBlock` — which
               would find this very conversation and reopen it, so the button
               would do nothing. ChatDialog.tsx § `onNewConversation`. */
            onNewConversation={startChatAboutBlock}
            dockRoom={chatDockRoom}
            /* The card in the column, when there is one to draw in; it wins
               over the room, and the room is what it falls back to. */
            card={chatCardPlace}
            reopen={chatReopen}
            onCreated={owner.chatAnchors.add}
            onDropped={owner.chatAnchors.drop}
          />
        </ChatCommands>
      )}
      {/* **Mounted for a visitor too, since 2026-09-04**, with an `access` of
          `{ kind: "visitor" }` — which carries none of the eight verbs below,
          so there is nothing on that arm for a later edit to reach.
          docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */}
      {!owner && !overlay && openComment && (
        <CommentDialog
          comment={openComment}
          paragraph={blockText.get(openComment.blockId)}
          access={{ kind: "visitor" }}
          position={positionOf(ordered, note)}
          total={ordered.length}
          hasPrev={stepComment(ordered, note, -1) !== null}
          hasNext={stepComment(ordered, note, 1) !== null}
          onPrev={() => stepToNeighbouringComment(stepComment(ordered, note, -1))}
          onNext={() => stepToNeighbouringComment(stepComment(ordered, note, 1))}
          onClose={() => void setNote(null)}
        />
      )}
      {owner && !overlay && openComment && (
        <CommentDialog
          comment={openComment}
          paragraph={blockText.get(openComment.blockId)}
          position={positionOf(ordered, note)}
          total={ordered.length}
          hasPrev={stepComment(ordered, note, -1) !== null}
          hasNext={stepComment(ordered, note, 1) !== null}
          onPrev={() => stepToNeighbouringComment(stepComment(ordered, note, -1))}
          onNext={() => stepToNeighbouringComment(stepComment(ordered, note, 1))}
          onClose={() => void setNote(null)}
          /* **Only the box the selection opened on its own new highlight** —
             § Selecting applies the highlight, above `selectProse`. The drawer,
             a mark, the margin and a pasted `?note=` all arrive with no
             `fresh`, or with one that names another comment. Read by
             tests/selecting-applies-the-highlight.test.tsx. */
          fresh={
            fresh?.id === openComment.id
              ? {
                  /* Two halves since the browser check of 2026-10-04: the
                     press is remembered while the button is down, and the box
                     closes when it comes up — and only if `?note=` still names
                     this row, because the same gesture may have opened the
                     next highlight's box. */
                  onPressOutside: () => {
                    closedFresh.current = {
                      id: fresh.id,
                      anchor: fresh.anchor,
                      touched: freshTouched.current,
                    };
                  },
                  onClickOff: () => {
                    if (openedThisGesture.current) return;
                    const id = fresh.id;
                    void setNote((current) => (current === id ? null : current));
                  },
                  onTouched: () => {
                    freshTouched.current = true;
                    copyOnlyProtected.current.add(openComment.id);
                  },
                  onCopiedOnly: () => {
                    const id = openComment.id;
                    const api = commentsNow.current;
                    const row = api?.comments.find((comment) => comment.id === id);
                    if (!api || !row || !isPristineHighlight(row)) return;
                    if (copyOnlyProtected.current.has(id)) return;
                    copyOnlyProtected.current.add(id);
                    api.remove(id);
                    void setNote((current) => (current === id ? null : current));
                  },
                }
              : undefined
          }
          access={{
            kind: "owner",
            pending: othersPending,
            onRetry: () => {
              copyOnlyProtected.current.add(openComment.id);
              owner.comments.retry(openComment.id);
            },
            onDeepen: () => {
              copyOnlyProtected.current.add(openComment.id);
              owner.comments.deepen(openComment.id);
            },
            onEdit: (body) => {
              copyOnlyProtected.current.add(openComment.id);
              void owner.comments.edit(openComment.id, body);
            },
            onTouched: () => {
              copyOnlyProtected.current.add(openComment.id);
            },
            placing: mode === "referee",
            onPlace: (mark) => {
              copyOnlyProtected.current.add(openComment.id);
              void owner.comments.place(openComment.id, mark);
            },
            onRecolour: (colour) => {
              copyOnlyProtected.current.add(openComment.id);
              void owner.comments.recolour(openComment.id, colour);
            },
            error: owner.comments.error,
          /* **Offered only when the conversation is really there.** The link on
             a comment is advisory — a reader can delete the chat and keep the
             note — so the summary list, not the stored id, decides whether
             there is anywhere to go. Passing a button that leads to
             "that conversation no longer exists" would be worse than passing
             none. */
            onOpenThread:
              openComment.threadId && chatSummaries.some((c) => c.id === openComment.threadId)
                ? () => {
                    const id = openComment.threadId;
                    if (!id) return;
                    setChatDraft(null);
                    void setNote(null);
                    void setThread(id);
                  }
                : undefined,
            onDiscuss: (question) => {
            copyOnlyProtected.current.add(openComment.id);
            /* **Into the floating panel, not into chat mode.** The follow-up
               box has always handed the reader to a conversation rather than
               growing a transcript in this dialog — Greg's call, chat-handoff.ts
               — and since 2026-08-26 that conversation floats over the article
               instead of replacing it.

               It carries the comment's own anchor, so the new chat is tied to
               the same words the explanation was about: the passage keeps a mark
               and the model is told what "this" refers to on every turn, not
               just the first. The question itself is not sent yet — it is
               pre-filled, and the reader presses send — because a follow-up
               typed into one box and fired from another is a model call they did
               not quite ask for, which is the whole thing this change is about.

               The dialog closes on the way through: one panel in the slot. */
            /* A whole-block bookmark hands chat the whole-block anchor, which
               is `ChatAnchor`'s other arm — and the paragraph as the opening,
               because there are no selected words to quote. */
            setChatDraft({
              kind: "draft",
              anchor:
                openComment.quote === undefined
                  ? { blockId: openComment.blockId }
                  : {
                      blockId: openComment.blockId,
                      quote: openComment.quote,
                      start: openComment.start,
                    },
              opening: openComment.quote ?? blockText.get(openComment.blockId) ?? "",
              question,
            });
              void setNote(null);
              void setThread(null);
            },
            onDelete: () => {
              // Step to the neighbour rather than closing outright: deleting one
              // of five is a tidy-up, not a reason to lose the panel.
              /* **Except from the fresh box**, where the press is *Remove
                 highlight*: the reader is undoing the selection they just
                 made, and a neighbour's box opening in its place would read as
                 the removal having gone somewhere else. */
              const next =
                fresh?.id === openComment.id
                  ? null
                  : (stepComment(ordered, note, 1) ?? stepComment(ordered, note, -1));
              owner.comments.remove(openComment.id);
              void setNote(next);
            },
          }}
        />
      )}
      {/* The card that appears when the pointer rests on an underlined term or
          on one of the article's own hyperlinks. One panel for the whole page
          rather than one per target — they are injected HTML and there are
          hundreds of them. ProseHoverCard.tsx.

          Outside the mode band below on purpose: the underlines and the links
          are in the prose in every mode, so the thing that explains them has to
          be there in every mode too. */}
      <ProseHoverCard
        entries={terms}
        works={works}
        /* Which article this is, and it is the *permission* for the third
           lookup rather than part of its question: `GET /api/link-preview`
           refuses to fetch a URL until it has proved this reader owns this
           article and that this article really points at that URL.
           ProseHoverCard.tsx § slug, src/link-previews.ts. */
        slug={slug}
        sourceUrl={article.meta.url ?? null}
        /* A visitor's card describes a link and asks nobody about it. The
           lookups behind this are `GET /api/library`, which is authenticated,
           and Wikipedia, which leaves our origin — and until GPT Sol found it
           on 2026-08-28 both fired on any hover, in a slice whose acceptance
           test is that a signed-out browser leaves `/api/public/` never.
           ProseHoverCard.tsx § lookUpLinks. */
        lookUpLinks={owner !== null}
        /* And the same answer to a different question. A visitor has no shelf
           to add to, so the button is not drawn and `useJobs` is not called —
           which matters as much as the button does, since a mounted subscriber
           sets the job engine's polling cadence. Derived from `owner !== null`
           beside the line above rather than from it: the two mean different
           things (ProseHoverCard.tsx § canAddToShelf) and today's shared
           condition is a coincidence worth keeping visible. */
        canAddToShelf={owner !== null}
        /* The citation half's "already an article here" line: owner-only,
           named here as the band names it (plan 261001i). */
        showInSpideryarn={owner !== null}
        /* *Dig deeper* and *Hide* on a term: the owner's read, which carries
           both verbs (plan 261002c § 3). Null for a visitor, whose arm has no
           read to pass — the enforcement is that there is nothing here. */
        termActions={glossaryRead}
        /* *Dig deeper* on a cited work: built over the owner's citations read
           (plan 261004b). Null for a visitor, for `termActions`' reason. */
        citeActions={citeActions}
        quotes={quoteCard}
        blockText={blockText}
        notes={notes}
        onOpenTerm={openTermInGlossary}
        onJump={jumpTo}
        onFollowNote={followNote}
      />

      {/* The mode band. Rendered only in its mode, which is what keeps the
          fetch inside it from being charged to every reader of every article —
          see ConversationBand. Which band that is, is `band()` above. */}
      {/* **A visitor gets one band and it is a sentence.** Not a dimmed button
          that answers a press with nothing, and not a tooltip — NN/G's rule is
          that a tooltip may never be the only place needed information lives,
          and a hover tooltip is out of reach of touch and keyboard entirely.
          So the marked mode still opens its band, in the same slot at the same
          width, and the band says which boundary this is — `VisitorGap` in
          visitor.ts is the set of them.
          PublicChrome.tsx, visitor.ts.

          Chosen once in `band()` rather than woven into each real band's
          condition, so that a mode added later cannot arrive without one:
          `visitorGap` reads a `Record<Mode, VisitorPolicy>`, so a mode with no
          row is a compile error rather than a mode that quietly opens. Keeping
          this choice inside `band()` also keeps the visitor sentence under the
          same failure boundary as the mode it stands in for. */}
      {/* **Only when there is a gap**, and since slice 1b there usually is not:
          a visitor whose article has a glossary opens the glossary, and
          `visitorGap` answers `null`. What is left here is a mode the pipeline
          never ran for this piece, and the ones that cost a model call —
          `POLICY` in visitor.ts says which, so no count lives here. */}
      {band()}
      {marginColumn()}

      {/* **Over the top of the band, for three seconds after a press** —
          ModeHerald.tsx. After the band in source order so it paints above it
          at the same z-index. Only while a band is open: Plain and Hierarchy
          have no *"top of the mode column"* to stand on. */}
      <ModeHerald
        press={bandOpen && !bandAway && herald !== null && herald.mode === mode ? herald : null}
        onDone={() => setHerald(null)}
      />

      {/* **The way back from a jump**, drawn only on an entry a jump stamped —
          ReturnChip.tsx, which owns that rule and the words. It takes the
          sections this component already built rather than resolving the
          origin block itself: the label is a section title, and there must be
          one answer to "which section is this block in" on the page. */}
      {/* **While a band has stepped aside, "back" means the band** —
          BandBackChip.tsx. The section chip would go back in history with the
          band still hidden, and two pills saying "back" to two places is one
          too many. docs/plans/260929g-on-a-phone-a-band-link-closes-the-band.md. */}
      {bandBack ? (
        <BandBackChip
          label={MODE_LABEL[mode]}
          takeFocus={bandFocus.current !== null}
          onBack={() => setBandAway(false)}
        />
      ) : (
        <ReturnChip sections={sections} rowOf={rowOf} />
      )}

      {/* Last in the DOM as well as topmost in z-index: the bar and its drawer
          are drawn over everything, and matching source order to paint order is
          one less thing to reason about when something appears underneath
          something else. */}
      <Dock
        slug={slug}
        view="article"
        /* Which modes the bar draws at all — Dock.tsx § experimental, and the
           hook call at the top of this component. */
        experimental={experimental}
        mode={mode}
        margin={marginOpen}
        summary={summaryView}
        /* The same state the Diagram band's chips read (`diagramParam`), not
           the address, which lags a chip press — Dock.tsx § Props `diagram`. */
        diagram={subNav.diagram}
        onMode={(next, sub, toggle = false) => {
          /* The callback itself is proof of a press. Arm before `setMode`:
             nuqs updates React now but may leave `location.href` on the old
             entry for ~50ms, so inferring intent from the address races. Back
             and Forward never call this callback and therefore never arm. */
          /* **Marginalia is a switch, not a band** (`BandMode`): its press
             turns the column on or off and leaves the band, the herald and a
             stepped-aside band exactly as they were — unless the two do not
             fit together, when the notes, pressed last, swap the band out
             (`marginaliaPress`, Greg's 7P). */
          if (next === "marginalia") {
            const press = marginaliaPress({
              margin: marginOpen,
              bandOpen,
              bothFit: wouldFit.both,
              aloneFit: wouldFit.alone,
            });
            /* The bar's own Marginalia button is a toggle; the command bar
               names a destination, as it does for every band. If the notes
               are already on and there is no useful swap to make, choosing
               them there is therefore idempotent. Keep the narrow-window
               swap, though: `closeBand` means `?margin=1` is on but hidden
               behind the band, and naming Marginalia should bring that
               destination on screen.
               docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md. */
            if (!toggle && marginOpen && !press.closeBand) return;
            if (press.closeBand) {
              void setModeAndMargin({ mode: null, margin: true }, { history: "push" });
              setBandAway(false);
            } else {
              void setMargin(press.margin ? true : null);
            }
            return;
          }
          /* **Plain closes both columns, and a second press closes the band**
             (`modePress`, Greg's 96). Both are one push, so one Back puts it
             all back; neither is a press on a band, so neither names one in
             the herald. A sub-mode row always moves to its sub-mode. */
          if (sub === undefined) {
            const press = modePress({ next, current: mode, bandBack, toggle });
            if (press === "plain") {
              /* Already at the destination, with nothing left for Plain to
                 close. `nuqs` does not elide a same-value push, so calling the
                 setter here would add an invisible history entry and make the
                 reader press Back twice to leave the article. */
              if (mode === "plain" && !marginOpen) return;
              void setModeAndMargin({ mode: "plain", margin: null }, { history: "push" });
              setBandAway(false);
              return;
            }
            if (press === "close") {
              void setMode("plain");
              return;
            }
          }
          armSkimOpening(skimArrival.current, mode, next);
          /* One Search arrival for its Dock button, quick box and command row.
             The toggle-to-close above has already handled a second mode press. */
          if (next === "search" && sub === undefined) {
            openQuickSearch();
            return;
          }
          /* A sub-mode row has already armed its chip's press (Dock.tsx §
             `useActivateSubMode`); this only moves the band, sub-mode and all. */
          /* A command naming the mode already open, or the bar bringing a
             stepped-aside band back, changes no URL state. Avoid a same-value
             `nuqs` write: it still pushes a history entry even though the
             address and the rendered mode do not move. The activation and
             recovery paths do not depend on that write — the token minted in
             Dock is their signal. */
          if (sub === undefined) {
            if (next !== mode) {
              /* **`mode` alone, with one exception**: returning to Remember
                 while `remember=quiz` is still in the address is a navigation
                 to Quiz, so it clears `thread` in the same pushed entry rather
                 than mounting the Quiz over Chat's conversation for
                 `RememberBand` to repair (sub-modes.ts § `returnToSubMode`). */
              const back = returnToSubMode(next, { remember: subNav.remember });
              if (back === null) void setMode(next);
              else void setSubNav(back, { history: "push" });
            }
          } else void setSubNav(subModeParams(sub), { history: "push" });
          /* Pressing the mode you are in brings its band back if it had stepped
             aside — `bandAway` above. */
          setBandAway(false);
          /* A new nonce every press, so pressing the mode you are in while it
             has stepped aside names it again as it comes back. */
          setHerald((prev) => ({ mode: next, nonce: (prev?.nonce ?? 0) + 1 }));
          /* Search draws its results down the rail, so entering search mode
             brings the rail back if the reader had put it away — Greg,
             2026-08-26: *"show the Spine by default when Search mode is
             active"*.

             `null`, not `true`: the rail goes back to following the window and
             the mode, which in a mode means on. Writing `true` would pin it,
             and the reader would find it still there in outline mode later
             with no memory of having asked for that.

             On the transition and **not** as a standing effect, which is the
             part worth getting right. A rule that re-asserted the rail whenever
             search mode was open would make the `Spine` pill dead in exactly
             the mode this is about: press it off, and it comes straight back.
             "By default" is a fact about arriving, not a fact about staying —
             hence `mode !== "search"` as well, since the dock calls this for a
             press on the mode you are already in.

             **The cost, stated because it is real**: the reader's `?spine=0`
             was a choice about the page, and this throws it away rather than
             suspending it — come back to reading mode afterwards and the rail
             is there. Suspending it would mean `?spine=` growing a per-mode
             shape, which is a lot of machinery for one bit; and the alternative
             of leaving it alone means a reader who has hidden the rail opens
             search and finds half the feature drawn somewhere they cannot see.
             The pill is one press away. docs/project/search.md § The rail. */
          /* Ideas paints one lane down the rail for the selected idea, and
             the rail is the only place that can show an idea's *shape* — is
             this threaded through the piece, or concentrated in one section?
             So it earns the same arrival rule search has, for the same reason
             and with the same `null` rather than `true`. */
          if (arrivalBringsRailBack({ next, current: mode, showSpine })) {
            void setShowSpine(null);
          }
        }}
        /* Which mode buttons are drawn dimmed. Empty for the owner, so the bar
           is exactly what it was; derived from `MODES` for a visitor, so a mode
           added later is marked whether or not whoever adds it remembers.
           visitor.ts § markedModes. */
        marked={marked}
        /* The command bar's Archive and Export (CommandBar.tsx §
           `CommandBarArticle.shelfRow`). `archive` arrives only from
           `OwnedArticle`, which exists only for the reader's own article —
           so its presence is the shelf row's, and a visitor gets neither —
           nor the tag rows that come with it (`tagsControl`). */
        shelfRow={archive === undefined ? undefined : { archive, tags: tagsControl }}
        /* The bar's argument rows — `executor` above. */
        executor={executor}
        drawer={
          owner
            ? {
                comments: ordered,
                paragraphs: blockText,
                loaded: owner.comments.loaded,
                loadError: owner.comments.loadError,
                /* A refused write, retry or delete. It was a chip in the
                   controls bar until 2026-09-08 and moved here when that bar
                   stopped being drawn on a reading view that had nothing else
                   to put in it — Dock.tsx § the Comments button, and
                   docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md. */
                error: commentError,
                panel,
                onPanel: (next) => void setPanel(next),
                onOpenComment: (id) => {
                  // Close the drawer on the way through: the dialog it opens
                  // would otherwise be underneath the dim, which looks exactly
                  // like nothing happening.
                  void setPanel(null);
                  openCommentFromDrawer(id);
                },
                asked: {
                  questions: askedList,
                  loaded: owner.chatAnchors.loaded,
                  error: owner.chatAnchors.error,
                  blocks: article.blocks,
                  onOpen: (id) => {
                    // Closed first, as a comment row does — the dialog would
                    // otherwise open underneath the dim.
                    void setPanel(null);
                    openAskedFromDrawer(id);
                  },
                },
              }
            : /* **The same drawer, with the owner's comments in it**, since
                 2026-09-04. It used to open onto a sentence about whose
                 comments these would be; a shared link carries them now.
                 docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.

                 `onOpenComment` is the same closure as the owner's, and that is
                 the point rather than a shortcut: opening a comment closes the
                 drawer and brings its passage into view, which is reading, and
                 reading is the whole of what a visitor may do here. */
              {
                visitor: true,
                comments: ordered,
                paragraphs: blockText,
                panel,
                onPanel: (next) => void setPanel(next),
                onOpenComment: (id) => {
                  void setPanel(null);
                  openCommentFromDrawer(id);
                },
              }
        }
      />

      {/* **`?probe=1` only, and `null` for everybody else** — the viewport
          diagnostic that stage 4 of
          docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md
          exists to get a measurement from. Inside `.reader` because that is
          where `--mode-w` and `--spine-w` resolve, and after the `Dock` so it
          is over the bars it is measuring. ViewportProbe.tsx. */}
      <ViewportProbe laidOutWidth={windowWidth} />
    </div>
    </BlockLinkProvider>
  );
}
