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
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryState } from "nuqs";
import type { Article, BlockId, GlossaryEntry } from "../../types.js";
import { useExperimental } from "../useExperimental.js";
import { addressWithout, useAddress } from "../router.js";
import { IdeasBand, VisitorIdeasBand } from "../modes/ideas/IdeasMode.js";
import { TimelineBand, VisitorTimelineBand } from "../modes/timeline/TimelineMode.js";
import { QuotesBand, VisitorQuotesBand } from "../modes/quotes/QuotesMode.js";
import { useQuoteMarks } from "./useQuoteMarks.js";
import { DebateBand } from "../modes/debate/DebateMode.js";
import { GlossaryBand, VisitorGlossaryBand } from "../modes/glossary/GlossaryMode.js";
import { SearchBand, VisitorSearchBand } from "../modes/search/SearchMode.js";
import { StructureBand } from "../modes/structure/StructureMode.js";
import { SummaryBand } from "../modes/summary/SummaryMode.js";
import { DiagramBand } from "../modes/diagram/DiagramMode.js";
import { RefereeBand } from "../modes/referee/RefereeMode.js";
import { ConversationBand, RememberBand } from "../modes/conversation/ConversationModes.js";
import { FeatureBoundary } from "../FeatureBoundary.js";
import { TableView } from "../TableView.js";
import type { SelectionAnchor } from "../selection.js";
import type { TermSelection } from "../annotate.js";
import { formsOf } from "../../term-match.js";
import { horizontalInset, safeAreaInsets } from "../safe-area.js";
import { Spine } from "../Spine.js";
import { AnnotateDialog } from "../AnnotateDialog.js";
import { CommentDialog } from "../CommentDialog.js";
import { Masthead } from "../Masthead.js";
import { Dock } from "../Dock.js";
import { gateToReveal, PRIORITY_GATE } from "../GlossaryPanel.js";
import { ProseHoverCard } from "../ProseHoverCard.js";
import { buildNoteIndex, type NoteMarker, type NoteReturn } from "../notes-view.js";
import {
  blockHues,
  blockMatches,
  blockStrength,
  hitMarks as buildHitMarks,
  type Found,
} from "../search-hits.js";
import { Toggle } from "@/components/ui/toggle";
import {
  buildArcColumn,
  buildGeometry,
  buildOutline,
  columnHint,
  columnLabel,
} from "../tree.js";
import {
  colsParam,
  modeParam,
  noteParam,
  panelParam,
  sortParam,
  gateParam,
  refScaleParam,
  termParam,
  spineParam,
  textParam,
  threadParam,
  type Mode,
} from "../params.js";
import { arrivalTarget, isBlockOnScreen, scrollToBlock } from "../scroll.js";
import { orderComments, positionOf, stepComment } from "../comment-nav.js";
import { jumpToComment, stepToComment } from "../comment-jump.js";
import { buildSections, sectionDepth } from "../position.js";
import { bandCoversProse, barHasContent, fitView, offerableGists, proseVisible } from "../layout.js";
import { navPlan, useArrowNav } from "../keynav.js";
import { paragraphLabelNotice, paragraphPill } from "../nav-labels.js";
import { ReturnChip } from "../ReturnChip.js";
import { ViewportProbe } from "../ViewportProbe.js";
import { useSwipeNav } from "../swipe.js";
import { ChatDialog, type ChatTarget } from "../ChatDialog.js";
import { anchored, countByBlock, helpThreadFor, threadFor } from "../useChatAnchors.js";
import { PILL } from "../pill.js";
import { pageTitle, useDocumentTitle } from "../page-title.js";
import {
  NO_SEARCHES,
  NO_TERMS,
  NO_THREADS,
  OWNER_HAS_EVERYTHING,
  type ReaderCapability,
} from "../reader-capability.js";
import { markedModes, visitorGap } from "../visitor.js";
import { SharedNotice, ViewOnlyChip, VisitorBand } from "../PublicChrome.js";
import { SmallScreenHint } from "../SmallScreenHint.js";
import { useRenderCount } from "../perf.js";
import { FEEDBACK_BLOCK_IDS, setFeedbackArticleContext } from "../feedback-context.js";
import { useWindowWidth, useRootFontPx } from "./measure.js";
import { useReadingPosition } from "./useReadingPosition.js";
import { proseFound, selectPassages } from "./passages.js";

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
 * **No gist-column depths.** Plain mode hands it to `fitView` as `chosen`, which
 * is the whole of how that mode empties the table — see `plainCols` below. (The
 * Outline band used it too, to ask `useColumnContext` for no rects; that band
 * is Structure's list face since 2026-09-10 and `StructureBand` keeps its own
 * copy.)
 *
 * Module-level so its identity is stable. A fresh `[]` each render would be a
 * new dependency each render, which restarts the hook's effect — and that
 * effect adds a scroll listener and a `ResizeObserver`. Same reason `layoutKey`
 * below is a string rather than the array it describes.
 */
const EMPTY_DEPTHS: number[] = [];

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
  onRenamed?: ((slug: string, title: string) => void) | undefined;
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
   * the metadata page and the tweets page cannot disagree for the length of a
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
   * Every gist depth this article has, 0 … leafDepth-1 — what `fitView` asks
   * for, and it asks for all of them.
   *
   * The leaf column is not one: it only makes sense in outline mode, where it
   * is the deepest rung of the table of contents, and is meaningless beside the
   * prose it labels — so it gets its own pill below rather than a place here.
   */
  const gistDepths = useMemo(
    () => geometry.columnDepths.filter((d) => d < geometry.leafDepth),
    [geometry],
  );

  /**
   * The subset a reader may actually open — 1 … leafDepth-1, because depth 0
   * stopped being a column on 2026-09-05.
   *
   * Separate from `gistDepths` on purpose: `fitView` documents its input as the
   * article's *full* depth range and applies the same rule itself, so handing it
   * a pre-filtered list would quietly make the two disagree about what they are
   * saying. One rule, `offerableGists` in layout.ts; two callers that need
   * different things from it. This one is the pill inventory — a pill for a
   * column the fit will never open is a control that does nothing.
   */
  const offerableGistDepths = useMemo(() => offerableGists(gistDepths), [gistDepths]);

  const [cols, setCols] = useQueryState("cols", colsParam);
  /* Read-only since 2026-09-05: the `Text` pill that wrote it went with the
     rest of the controls bar, so `?text=0` is something a reader arrives with
     rather than something they can ask for here. Outline mode itself is
     unchanged — docs/project/url-state.md § `?text=`. */
  const [showText] = useQueryState("text", textParam);

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

  /* The tab: the article first, then the mode — and nothing for whichever mode
     is the default, which is the one most tabs are in and so the one that
     distinguishes nothing. `plain` since 2026-08-31; the rule is about the
     default rather than about any particular mode. See src/web/page-title.ts. */
  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view: "article", mode }));
  /* **Any mode that is not the hierarchy has no gist columns, and forces the
     prose on.** Written as "not hierarchy" rather than as `chat || glossary` on
     purpose: the third mode cost this line nothing, which is the property the
     slot was built for, and the tenth cost it nothing either.

     It is not the same question as "is a panel open" — `bandOpen` below is, and
     Plain is where they differ. */
  const inMode = mode !== "hierarchy";
  /**
   * **Is there a panel in the middle band?** — which is a narrower question than
   * `inMode`, and since Plain arrived on 2026-08-31 they have different answers.
   *
   * Plain is a mode with no band and no gist columns: the spine, the article,
   * and nothing else. So it answers `inMode` the same way every other mode does
   * — *the granularity controls do not apply here, and the prose is on whatever
   * `?text=` says* — and answers this one the way `hierarchy` does.
   *
   * Two names rather than one `mode === …` test at each site, because the last
   * time this file had one rule doing two jobs the two drifted: `proseVisible`
   * exists in layout.ts precisely because "in a mode the prose is on" was
   * asserted in the arithmetic and not in the component, which rendered a chat
   * panel beside an entirely empty table. Naming both questions is what stops
   * the third caller having to guess which one it wanted.
   */
  const bandOpen = inMode && mode !== "plain";

  /**
   * What stands between a visitor and the mode they have opened, if anything.
   *
   * `null` for the owner and `null` for `hierarchy`, which is the mode the whole
   * feature is about: the table of contents, the granularity zoom and the spine
   * are drawn from the tree in the payload the visitor already holds, so they
   * cost nothing and a stranger gets all of them. visitor.ts.
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

  /**
   * An absent `cols` means "whatever fits", not "all of them". All of them is
   * 70rem of table, so on any laptop the obvious default buries a column
   * permanently under the pinned prose. The arithmetic lives in layout.ts, where
   * it can be tested without a DOM. An explicit `cols=` still wins outright, so a
   * pasted link shows exactly what it says.
   */
  /**
   * Whether the prose is on screen — see layout.ts § proseVisible. In a mode it
   * always is, whatever `?text=` says, because outline mode is a way of reading
   * the table of contents and a mode has none. Passed to `fitView` AND to
   * TableView from one place: reading them apart is the bug this fixes.
   */
  const proseOn = proseVisible(showText, inMode);

  /**
   * **The columns `fitView` is asked for, which in Plain is none of them.**
   *
   * Plain is `?cols=none` with a name, and it is expressed here rather than in
   * layout.ts on purpose: `fitView`'s non-mode arm already handles an empty
   * `chosen` exactly right — no gist columns, no leaf column, and `detailW`
   * relaxing to the whole available width — so the mode costs that file nothing
   * and cannot introduce a fourth width negotiation for somebody to get wrong.
   *
   * **The reader's own `?cols=` is not overwritten, only overridden.** It stays
   * in the URL untouched, so leaving Plain for the hierarchy puts back the
   * columns they had rather than the ones the window would have picked — the
   * same property `?cols=` already has on a trip through chat (layout.ts
   * § fitView).
   */
  const plainCols = mode === "plain" ? EMPTY_DEPTHS : cols;

  const fit = useMemo(
    () =>
      fitView({
        windowWidth,
        gistDepths,
        leafDepth: geometry.leafDepth,
        showText: proseOn,
        chosen: plainCols,
        modeBand: bandOpen,
        rootFontPx,
        showSpine,
      }),
    [windowWidth, rootFontPx, gistDepths, geometry.leafDepth, proseOn, plainCols, bandOpen, showSpine],
  );

  /**
   * The arc — one sentence per part on where the argument stands there — keyed
   * by the row each part starts on.
   *
   * **Structure's list face is the only thing that reads this now**, as its
   * rung 4 (`OutlinePanel` § `row.arc`) — Outline mode's, until Outline became
   * that face on 2026-09-10. It used to draw Hierarchy's L0 column as
   * well; that column went on 2026-09-05 with the rest of the declutter
   * (layout.ts § `offerableGists`) and the artefact did not — `src/arc.ts`, the
   * `arc` job step and `arc.json` are all untouched.
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

  // A string, not the array: a fresh array every render would restart the scroll
  // listener every render. `modeW` is in it because entering a mode moves every
  // row on the page sideways, and the `?at=` tracker holds row elements it
  // measured before the move. `spine` is in it for a stronger reason than
  // sideways: the rail's width is taken out of the prose column's, so hiding it
  // rewraps every paragraph in the article and every row changes height.
  const layoutKey = `${fit.columns.join(",")}|${proseOn}|${windowWidth}|${fit.modeW}|${fit.spine}`;
  const { at, jumpTo, rowOf } = useReadingPosition(sections, article.blocks, layoutKey);

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
   * twin answer `metadata` and `tweets` with their own pages, so this component
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
      level: fit.columns.length,
      blockCount: article.blocks.length,
      rootBlockId: article.tree.nodes[article.tree.rootId]?.range[0] ?? null,
      blockIds: article.blocks.slice(from, from + FEEDBACK_BLOCK_IDS).map((b) => b.id),
    });
    return () => setFeedbackArticleContext(null);
  }, [slug, article, mode, fit.columns.length, at]);


  /**
   * Comments: selecting prose asks a question of the model, and the answer
   * arrives in a floating dialog. See docs/project/comments.md.
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
           a Remember conversation — chat's UI, chat's composer, no stance picker, and the
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
  const terms: GlossaryEntry[] =
    glossaryRead?.glossary?.entries ?? artefacts?.glossary?.entries ?? NO_TERMS;

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
   * Point at a term in the prose and press "in the glossary": open the band on
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
   * rather than grouping it, so pressing "in the glossary" on a low-scoring
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
      void setMode("glossary");
    },
    [setTermId, setMode, setGate, gate, sort, terms],
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
  const quotes = useQuoteMarks(
    article.blocks,
    capability.kind === "owner" ? capability.quotes.quotes : (artefacts?.quotes ?? null),
  );
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
     show nothing at all in words mode. search-hits.ts § Why `null` survives. */
  const hitBlocks = useMemo(() => blockMatches(passages), [passages]);

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
   * column the pointer is sitting in — see keynav.ts. It writes no state of its
   * own: it scrolls, and the listener above notices, exactly as it would for a
   * wheel. Off any tagged column the stride falls back to the section, which is
   * the unit `?at=` already stores.
   *
   * ← / → move that aim across the columns, so the level can be chosen without
   * touching the mouse — Greg, 2026-08-26: "so that I can choose the level of
   * granularity with keyboard when jumping up/down". The rungs they step
   * between are the columns actually on screen, which is why the ladder is
   * built here, beside `fit`, rather than inside the hook.
   *
   * Suspended while the drawer is open. A reader looking at their questions is
   * not reading, and the article scrolling away underneath the dim — silently,
   * because they cannot see it move — is the kind of thing you only notice
   * afterwards, when you have lost your place.
   */
  const nav = useMemo(
    () => navPlan(geometry, fit.columns, proseOn),
    [geometry, fit.columns, proseOn],
  );
  const navDepth = useArrowNav(
    nav,
    article.blocks,
    sectionDepth(geometry),
    !drawerOpen,
  );

  /**
   * The same step, taken with a finger — Greg, 2026-08-26: "jumps step-by-step
   * if I scroll within a column, kinda like the up/down buttons". A swipe over
   * a gist column moves one item at that column's level; the prose column keeps
   * ordinary iPad scrolling, which is the point rather than a limitation. See
   * swipe.ts and docs/project/touch.md.
   *
   * Reading mode only. Outline mode is gist columns all the way across, so
   * there would be nothing left that scrolls continuously.
   */
  useSwipeNav(nav, article.blocks, proseOn && !drawerOpen);

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
    },
    [setNote, setThread],
  );

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

  const selectProse = useCallback(
    /* Always a real anchor since 2026-09-05: `readSelection` now distinguishes
       a drag it refused from no drag at all, and TableView stops on the first
       without calling in here. src/web/selection.ts § SelectionRead. */
    (anchor: SelectionAnchor) => {
      /* **The one control a visitor meets by accident**, since selecting prose
         is something people do while reading rather than a button they chose to
         press. So it is silent: they keep their selection and the page does not
         grow a box about an account. The ask lives where they went looking for
         something — the marked modes and the notice under the title. */
      if (!owner) return;
      /* **Nothing is bought here.** Until 2026-08-26 this line spent a model
         call the reader had not asked for; then it opened an ask box; since
         2026-08-28 it opens a *comment* box, where saving is free and the model
         is a tick-box. Greg's call — see
         docs/plans/260828a-comments-and-bookmarks.md. */
      void setNote(null);
      void setThread(null);
      setChatDraft(null);
      setAnnotating({ blockId: anchor.blockId, quote: anchor.quote, start: anchor.start });
      /* **The browser's selection is deliberately left alone**, which is a
         reversal. It used to be cleared because it sat on top of the mark we had
         just drawn and hid it. There is now no mark to reveal — nothing is
         stored until the reader asks — so clearing it would leave them looking
         at a quote in a box with no idea which words on the page it came from. */
    },
    [owner, setNote, setThread],
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
  const openCommentDialog = useCallback((id: string) => void setNote(id), [setNote]);

  /**
   * The whole address, subscribed to — the input to the block permalinks.
   *
   * The only subscription in this file that is not a `useQueryState`, and it is
   * here because those are key-isolated and this needs *all* of them. Pathname
   * as well as query, because `blockHref` uses both. See the `linkBase` prop on
   * `TableView` below.
   */
  const address = useAddress();

  /** Whether the paragraph-level nav labels are riding beside the prose. */
  const leafOn = showText && fit.columns.includes(geometry.leafDepth);

  /**
   * What stands where the `Paragraphs` pill would be when there is nothing for
   * it to open, or `null` in the ordinary case — nav-labels.ts owns the rule.
   *
   * Read here for the bar below. Structure's band draws the same labels (its
   * list face's rung 5, its columns' paragraph rows) and makes the same decision
   * off the same `article` with `paragraphLabelsReady` (StructureMode.tsx), and
   * `TableView` asks for itself.
   */
  const paragraphNotice = paragraphLabelNotice(article.navLabelStatus);

  /**
   * **Is the controls bar drawn at all?** Not since 2026-09-08, on most reading
   * views — see `barHasContent` in layout.ts for what is left in it and why so
   * little, and the plan for the reader who reported the empty strip.
   *
   * The CSS half is `:root:not(:has(.controls))` in shell.css § the bar that
   * leaves while you read, which lets `--bar-bottom` fall to the status-bar
   * inset when this is false. Nothing in `scroll.ts` needs telling: both
   * `stickyOffset` and `stickyDestination` already answer `--safe-top` for an
   * absent bar.
   */
  const showBar = barHasContent({
    owner: owner !== null,
    inMode,
    offerableGists: offerableGistDepths.length,
    showText,
  });

  /** The gist columns actually on screen — the leaf column isn't one of them. */
  const shownGists = useMemo(
    () => fit.columns.filter((d) => d !== geometry.leafDepth),
    [fit.columns, geometry.leafDepth],
  );

  // Toggling writes the set into the URL, which also takes the columns off
  // automatic — the window should not quietly overrule a choice the reader made.
  // **And there is no way back to automatic** since the `auto` control went with
  // the rest of the bar on 2026-09-05: only deleting `?cols=` by hand restores
  // it. Deliberate — the pills are how a reader says what they want, and a
  // control whose whole job is undoing them was part of what made this bar
  // unreadable (docs/plans/260905d-declutter-the-reading-view-top-bars.md).
  const toggle = (d: number) => {
    const next = new Set(fit.columns);
    next.has(d) ? next.delete(d) : next.add(d);
    setCols([...next].sort((a, b) => a - b));
  };

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
   * `plain` and `hierarchy` return `null` explicitly: they are modes with no
   * band, not a default that would silently accept a fifteenth mode.
   *
   * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md
   * § Stage 4b, and docs/project/new-mode.md.
   */
  function band(): ReactNode {
    switch (mode) {
      /* **The two modes with no band at all**, said rather than fallen into.
         Plain is the way out to the article and the hierarchy is the gist
         columns; neither has anything to put in the middle. */
      case "plain":
      case "hierarchy":
        return null;
      case "chat":
        /* **The key is inert today, and it is kept for the day it is not.**
           It was written when one `ConversationBand` was mounted by two modes
           — `{(mode === "chat" || mode === "review") && <ConversationBand
           key={mode} …/>}`, commit 2dd63119 — where it is what stopped Remember
           inheriting chat's open conversation, focus nonce and stance. Remember
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
          <ConversationBand
            key={mode}
            slug={slug}
            blocks={blockText}
            onJump={jumpTo}
            kind="chat"
            onMode={setMode}
          />
        ) : null;
      /* **Remember is two bands behind one mode**, and the choice between them
         is `?remember=`. The wrapper exists so that the parameter and its
         collision with `?thread=` are decided in one place rather than in each
         half — see `RememberBand`. */
      case "remember":
        return owner ? (
          <RememberBand slug={slug} blocks={blockText} onJump={jumpTo} onMode={setMode} />
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
              onJump={jumpTo}
              onSelected={setTerm}
              onMode={setMode}
            />
          );
        return artefacts?.glossary ? (
          <VisitorGlossaryBand
            glossary={artefacts.glossary}
            onJump={jumpTo}
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
            article={article}
            leafDepth={geometry.leafDepth}
            sections={sections}
            layoutKey={layoutKey}
            supplementOf={geometry.supplementOf}
            arcByRow={arcCells}
            /* `modeW` is 0 exactly when the band covers the prose instead of
               sitting beside it (layout.ts) — a phone, since 2026-09-06; it was
               iPad portrait and below until the crossover fell to 700. That is
               the condition paragraph rows are not permissible under, in either
               face, and reading it from the layout rather than from a width
               guessed here is why that move cost this line nothing but its
               example. */
            proseBeside={fit.modeW > 0}
            onJump={jumpTo}
          />
        );
      case "summary":
        return <SummaryBand article={article} onJump={jumpTo} />;
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
            onJump={jumpTo}
          />
        );
      /* **The first mode that may break on its own.** One boundary around both
         Ideas branches — the controller as well as its panel, which is why the
         controller had to leave this file — so a throw in there costs the
         reader Ideas and not the article.
         docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md.

         **Inside the case, so the boundary exists only where it can catch
         anything.** Wrapping the two branches while leaving the element itself
         unconditional worked, but it put a live activation subscription in the
         other thirteen modes for no reason. That gate is also why `mode` is
         **not** in the key: it cannot change while this boundary is alive, and
         a feature that has a genuine sub-mode would not change the top-level
         `mode` either — so it appends that sub-mode's own identity here, not
         this. Sol, 2026-09-06, F18. */
      case "ideas":
        return (
          <FeatureBoundary
            name="Ideas"
            slug={slug}
            /* A visitor's band never auto-runs, so there is no press to retire. */
            target={owner ? "ideas" : null}
            resetKey={`${slug}|${owner ? "owner" : "visitor"}`}
            onPlain={() => void setMode("plain")}
          >
            {owner && (
              <IdeasBand
                slug={slug}
                blocks={article.blocks}
                onJump={jumpTo}
                onFound={setIdeaFound}
                openKey={openOccurrence}
                onOpenKey={setOpenOccurrence}
              />
            )}
            {!owner && artefacts?.ideas && (
              <VisitorIdeasBand
                ideas={artefacts.ideas}
                blocks={article.blocks}
                onJump={jumpTo}
                onFound={setIdeaFound}
                openKey={openOccurrence}
                onOpenKey={setOpenOccurrence}
              />
            )}
          </FeatureBoundary>
        );
      /* **Neither band publishes anything any more.** The marks are
         `useQuoteMarks` above, drawn in every mode; what is left down here is
         the panel, its three controls and — for the owner — the job machinery
         that must not be mounted anywhere else. QuotesMode.tsx. */
      case "quotes":
        if (owner) return <QuotesBand slug={slug} read={owner.quotes} onJump={jumpTo} />;
        return artefacts?.quotes ? (
          <VisitorQuotesBand quotes={artefacts.quotes} onJump={jumpTo} />
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
              onJump={jumpTo}
              onFound={setTimelineFound}
              openKey={openTimelineKey}
              onOpenKey={setOpenTimelineKey}
            />
          );
        return artefacts?.timeline ? (
          <VisitorTimelineBand
            timeline={artefacts.timeline}
            blocks={article.blocks}
            onJump={jumpTo}
            onFound={setTimelineFound}
            openKey={openTimelineKey}
            onOpenKey={setOpenTimelineKey}
          />
        ) : null;
      /* **The owner alone, and there is deliberately no visitor twin yet.**
         Debate is meant to be shared — it is the artefact whose whole value is
         that somebody else can check it — but a visitor's row must pass
         `publicCitationUrl` at the boundary, where a refusal drops the whole
         row, and that contract is Stage 4. Building the branch first is what a
         GPT Sol review (F23) refused. Until then `POLICY.debate` is
         `owners-only`, so a visitor meets the boundary sentence rather than an
         empty band.
         docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md § Stage 4.

         **The second mode that may break on its own**, in Ideas' shape: one
         boundary at the composition point, around the whole of `DebateBand` —
         `useDebate`'s read, job poll and `useAutoRun` as well as the panel —
         so a throw in any of it costs the reader Debate and not the article,
         and a press that met the throw is retired rather than left for a later
         Back to spend on two web searches. The key carries the access class for
         the day Stage 4 adds the visitor child beside the owner's.
         docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § B. */
      case "debate":
        return (
          <FeatureBoundary
            name="Debate"
            slug={slug}
            target={owner ? "debate" : null}
            resetKey={`${slug}|${owner ? "owner" : "visitor"}`}
            onPlain={() => void setMode("plain")}
          >
            {owner && <DebateBand slug={slug} onJump={jumpTo} />}
          </FeatureBoundary>
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
            onJump={jumpTo}
            onFound={setFound}
            openHit={openHit}
            onOpenHit={setOpenHit}
          />
        ) : (
          <VisitorSearchBand
            searches={searches}
            blocks={article.blocks}
            onJump={jumpTo}
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
            onJump={jumpTo}
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

  return (
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
         beside the `--mode-w` it is derived from. `fit.modeW === 0` is also
         true when no band is open at all, which is why every rule keyed off
         this class also names `.mode-band` — styles.css § a band with no room,
         tests/spine-width.test.ts. */
      className={`reader spine-${fit.spine}${fit.alone ? " text-alone" : ""}${
        fit.modeW === 0 ? " band-covers" : ""
      }`}
      /* **Which column ← / → are pointed at** — styles.css § the aimed column,
         keyboard.md. It is here rather than on the table for two reasons, and
         the first is the one that forced it: the fisheye panels are `position:
         fixed` elements *beside* the table, they are opaque, and in Hierarchy
         they cover every gist column — so the surface that has to carry the tint
         is not inside the table at all. `.reader` is the nearest thing that
         holds both. The second is that `TableView` is `memo`ised over ~2,200
         cells and no longer takes `navDepth` as a prop, so moving the pointer
         re-renders nothing below this element. */
      data-aim={navDepth}
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
          /* The table's own width, so the masthead can be as wide as the
             reading column when it is centred over it (styles.css § plain,
             centred) without a second copy of `PROSE_ALONE_MAX_REM` in CSS. */
          "--table-w": `${fit.tableW}px`,
        } as CSSProperties
      }
    >
      {fit.spine !== "off" && (
        <Spine
          outline={outline}
          layoutKey={layoutKey}
          matches={hitBlocks}
          onJump={jumpTo}
        />
      )}
      {/* Everything constant about the article — see Masthead.tsx for why
          constant is the word that decides it belongs here and not in a
          column. */}
      <Masthead article={article} slug={slug} onRenamed={onRenamed} />
      {/* The statement, where a visitor's eye already is on arrival. The
          *persistent* half of it is the chip in the bar below, which is sticky;
          this is the sentence and the ask, which belong with the title. Not
          dismissible: it is what this page is, not a notification.
          PublicChrome.tsx. */}
      {!owner && <SharedNotice signedIn={signedIn} sessionUnconfirmed={sessionUnconfirmed} />}
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
          the URL still carries `?spine=`, `?text=` and `?cols=` for anybody who
          wants to pin the layout by hand (docs/project/url-state.md). */}
      {/* **And since 2026-09-08 it is not drawn at all when that leaves it
          empty**, which on a reading view is most of the time: `showBar` above,
          `barHasContent` in layout.ts, and shell.css for the 44px that then
          stops being reserved. It was no longer "the one piece of chrome that
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
      {showBar && (
        <div className="controls">
          {/* First of all: what footing you are reading on outranks every control
              that follows. */}
          {!owner && <ViewOnlyChip sessionUnconfirmed={sessionUnconfirmed} />}
          {/* The granularity controls belong to the table-of-contents mode, so
              they go with it. Leaving them on screen in another mode would offer
              columns that are not there — a control that looks live, does
              nothing, and gives the reader no way to tell which. Nothing takes
              their place: the mode's name is on the Dock, and saying it twice is
              what this bar was full of.
  
              **They wear the column's full name now** — `Parts`, `Sections`,
              `Paragraphs` rather than `L1`, `L2`, `Para`. The numbers were
              defensible while the table's own header row said the words above
              each column; that row lost its height on 2026-09-05
              (TableView.tsx § the head), so this is the only place a column is
              named at all. tree.ts § `columnLabel`. */}
          {!inMode && (
            <>
              {offerableGistDepths.map((d) => (
                <Toggle
                  key={d}
                  className={PILL}
                  pressed={shownGists.includes(d)}
                  onPressedChange={() => toggle(d)}
                  title={columnHint(d, geometry.leafDepth)}
                >
                  {columnLabel(d, geometry.leafDepth)}
                </Toggle>
              ))}
              {/* The paragraph outline, beside the prose rather than instead of
                  it. Only offered in reading mode: in outline mode this column is
                  the view, and turning it off would leave nothing.
  
                  **And only while there are labels to draw.** Where there are
                  not, the control is replaced by the sentence saying why rather
                  than disabled with the sentence in its tooltip — a touch reader
                  cannot open a tooltip, which is the argument that took the pills
                  from `L3` to `Paragraphs` in the first place (tree.ts §
                  `columnLabel`). A pill that opened a column of blank cells is
                  the failure nav-labels.ts exists to prevent; a pill that opened
                  a column of one repeated notice would be worse still.
  
                  **`|| leafOn` is the door back out, and it is not a hedge.**
                  `toggle` is the only caller of `setCols` in this file, so
                  replacing the control replaces the only way to *close* the
                  column as well as the only way to open it. The leaf depth can
                  already be on without this pill — `?cols=` naming it, shared or
                  bookmarked — and such a reader was left with a wide column of
                  one repeated sentence and nothing to shut it with: for ever, if
                  the status is `failed`. So the notice stands in for the pill
                  only while the column is shut, which is the case it was written
                  for; once the column is open the pill comes back, because the
                  column itself is already carrying the sentence
                  (TableView § `withheldLeafCell`) and what the reader needs from
                  the bar is the way out. GPT Sol's F2 on stage 1, 2026-09-06. */}
              {showText &&
                (paragraphPill(article.navLabelStatus, leafOn) === "toggle" ? (
                  <Toggle
                    className={PILL}
                    pressed={leafOn}
                    onPressedChange={() => toggle(geometry.leafDepth)}
                    title={columnHint(geometry.leafDepth, geometry.leafDepth)}
                  >
                    {columnLabel(geometry.leafDepth, geometry.leafDepth)}
                  </Toggle>
                ) : (
                  <span className="pill-note">{paragraphNotice}</span>
                ))}
            </>
          )}
          {/* **Failures of the comment transport left this bar on 2026-09-08**,
              for the Dock's Comments button — which is the control they are about,
              and which is on screen whether or not this bar is. They were here
              because "if the fetch never landed there is no dialog to put them
              in", and that is still true: the Dock is the answer to it now.
  
              They could not stay: this bar is drawn only when it has content
              (`showBar` above), so a refused delete would have summoned 44px of
              chrome and pushed the article down mid-read. **Not deleted** — GPT
              Sol's G3 on 260905g refused that, because `error` is not the
              drawer's `loadFailed`: that one is about the fetch that fills the
              list and is only drawn when the list is empty, while this carries
              every failed *change*, including one whose row has scrolled off.
              Dock.tsx § the Comments button. */}
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
        sections={sections}
        layoutKey={layoutKey}
        /* The permalink base — this page's whole address, including every
           parameter added after this line was written, minus the one the link
           is about to set.

           **`useAddress` rather than a bare read of `location`**, and the
           difference is the whole correctness of this: reading the global here
           would be right only if `Reader` re-rendered on every URL change, and
           it does not. nuqs subscriptions are key-isolated, so ten reading
           parameters owned by child components — `deep`, `diagram`, `dhue`,
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
        columns={fit.columns}
        layout={fit}
        showText={proseOn}
        /* **`navDepth` is not passed here any more**, and that is a small win
           rather than an omission. It used to light a `<th>`, so every pointer
           move re-rendered a memoised table of ~2,200 cells to change one
           underline. The aim is now `data-aim` on `.reader` above and a rule in
           styles.css § the aimed column, so it costs one attribute write. */
        onJump={jumpTo}
        notes={notes}
        noteReturn={noteReturn}
        onFollowNote={followNote}
        comments={comments}
        openComment={note}
        chats={chats}
        chatCounts={chatCounts}
        openChat={overlay?.kind === "thread" ? overlay.threadId : null}
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
        terms={termSelections}
        openTerm={term?.id ?? null}
        hitMarks={hitMarks}
        hitHues={hitHues}
        hitStrength={hitStrength}
        onSelect={selectProse}
        onOpenComment={openCommentDialog}
      />
      {owner && annotating && (
        <AnnotateDialog
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
          onCancel={() => setAnnotating(null)}
          onSave={(id, body, ask, mark) => {
            const anchor = annotating;
            setAnnotating(null);
            /* **The free thing is stored first, and the paid thing waits for
               it.** If the chat call fails, or the reader closes the panel
               before sending, their words are already on disk. The reverse
               order — open the chat, save afterwards — loses the comment for
               exactly the reader who typed the most into it. */
            void owner.comments.create({
              id,
              blockId: anchor.blockId,
              quote: anchor.quote,
              start: anchor.start,
              ...(body ? { body } : {}),
              /* The referee's placement rides along with the free save, so a
                 placement is never a second request that can fail on its own. */
              mark,
            }).then((stored) => {
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
          onCreated={owner.chatAnchors.add}
          onDropped={owner.chatAnchors.drop}
        />
      )}
      {/* **Mounted for a visitor too, since 2026-09-04**, with an `access` of
          `{ kind: "visitor" }` — which carries none of the eight verbs below,
          so there is nothing on that arm for a later edit to reach.
          docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */}
      {!owner && !overlay && openComment && (
        <CommentDialog
          comment={openComment}
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
          position={positionOf(ordered, note)}
          total={ordered.length}
          hasPrev={stepComment(ordered, note, -1) !== null}
          hasNext={stepComment(ordered, note, 1) !== null}
          onPrev={() => stepToNeighbouringComment(stepComment(ordered, note, -1))}
          onNext={() => stepToNeighbouringComment(stepComment(ordered, note, 1))}
          onClose={() => void setNote(null)}
          access={{
            kind: "owner",
            pending: othersPending,
            onRetry: () => owner.comments.retry(openComment.id),
            onDeepen: () => owner.comments.deepen(openComment.id),
            onEdit: (body) => void owner.comments.edit(openComment.id, body),
            placing: mode === "referee",
            onPlace: (mark) => void owner.comments.place(openComment.id, mark),
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
            setChatDraft({
              kind: "draft",
              anchor: {
                blockId: openComment.blockId,
                quote: openComment.quote,
                start: openComment.start,
              },
              opening: openComment.quote,
              question,
            });
              void setNote(null);
              void setThread(null);
            },
            onDelete: () => {
              // Step to the neighbour rather than closing outright: deleting one
              // of five is a tidy-up, not a reason to lose the panel.
              const next = stepComment(ordered, note, 1) ?? stepComment(ordered, note, -1);
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

          Placed above the real bands rather than woven into each of their
          conditions, so that a mode added later cannot arrive without one:
          `visitorGap` reads a `Record<Mode, VisitorPolicy>`, so a mode with no
          row is a compile error rather than a mode that quietly opens. */}
      {/* **Only when there is a gap**, and since slice 1b there usually is not:
          a visitor whose article has a glossary opens the glossary, and
          `visitorGap` answers `null`. What is left here is a mode the pipeline
          never ran for this piece, and the ones that cost a model call —
          `POLICY` in visitor.ts says which, so no count lives here. */}
      {!owner && gap && <VisitorBand gap={gap} signedIn={signedIn} />}
      {band()}

      {/* **The way back from a jump**, drawn only on an entry a jump stamped —
          ReturnChip.tsx, which owns that rule and the words. It takes the
          sections this component already built rather than resolving the
          origin block itself: the label is a section title, and there must be
          one answer to "which section is this block in" on the page. */}
      <ReturnChip sections={sections} rowOf={rowOf} />

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
        onMode={(next) => {
          void setMode(next);
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
          if (
            (next === "search" || next === "ideas") &&
            mode !== next &&
            showSpine === false
          ) {
            void setShowSpine(null);
          }
        }}
        /* Which mode buttons are drawn dimmed. Empty for the owner, so the bar
           is exactly what it was; derived from `MODES` for a visitor, so a mode
           added later is marked whether or not whoever adds it remembers.
           visitor.ts § markedModes. */
        marked={marked}
        drawer={
          owner
            ? {
                comments: ordered,
                loaded: owner.comments.loaded,
                loadFailed: owner.comments.loadFailed,
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
      <ViewportProbe />
    </div>
  );
}
