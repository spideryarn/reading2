import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { throttle, useQueryState } from "nuqs";
import type { Article, Block, BlockId, GlossaryEntry } from "../types.js";
import { Library } from "./Library.js";
import { AuthCallback } from "./AuthCallback.js";
import { HomeLogo } from "./HomeLogo.js";
import { SignInPage } from "./SignInPage.js";
import { useSession } from "./useSession.js";
import { DesignPage } from "./DesignPage.js";
import { ProfilePage } from "./ProfilePage.js";
import { AddPage } from "./AddPage.js";
import { type ArticleView, LIBRARY_HREF, navigate, useRoute } from "./router.js";
import { Metadata } from "./Metadata.js";
import { IdeasPanel } from "./IdeasPanel.js";
import { useIdeas } from "./useIdeas.js";
import { Tweets } from "./Tweets.js";
import { sanitizeArticle } from "./sanitize.js";
import { TableView } from "./TableView.js";
import type { TermSelection } from "./annotate.js";
import { formsOf } from "../term-match.js";
import { Spine } from "./Spine.js";
import { CommentDialog } from "./CommentDialog.js";
import { Masthead } from "./Masthead.js";
import { useSlow } from "./useSlow.js";
import { Dock } from "./Dock.js";
import { ChatPanel } from "./ChatPanel.js";
import { GlossaryPanel } from "./GlossaryPanel.js";
import { ProseHoverCard } from "./ProseHoverCard.js";
import { useGlossary, useGlossaryTerms } from "./useGlossary.js";
import { SummaryPanel } from "./SummaryPanel.js";
import { DiagramPanel } from "./DiagramPanel.js";
import { useSummaries } from "./useSummaries.js";
import { SearchPanel } from "./SearchPanel.js";
import { useSearch } from "./useSearch.js";
import { assignSlots } from "./hit-colours.js";
import {
  blockHues,
  blockMatches,
  blockStrength,
  findLiteral,
  hitMarks as buildHitMarks,
  orderFound,
  resolveIdea,
  keepAbove,
  PRIORITY_CONF,
  resolveHits,
  type Found,
} from "./search-hits.js";
import { useChat } from "./useChat.js";
import { Toggle } from "@/components/ui/toggle";
import {
  buildArcColumn,
  buildGeometry,
  buildOutline,
  buildSummaryTree,
  columnLabel,
} from "./tree.js";
import {
  atParam,
  colsParam,
  deepParam,
  diagramParam,
  modeParam,
  noteParam,
  panelParam,
  rungParam,
  sortParam,
  gateParam,
  ideaParam,
  termParam,
  findParam,
  matchParam,
  resolveMatcher,
  orderParam,
  confParam,
  runParam,
  runsParam,
  resolveRuns,
  spineParam,
  textParam,
  threadParam,
} from "./params.js";
import { arrivalTarget, isBlockOnScreen, scrollToBlock, stickyOffset } from "./scroll.js";
import { orderComments, positionOf, stepComment } from "./comment-nav.js";
import {
  activeSectionIndex,
  buildSections,
  sectionDepth,
  type Section,
} from "./position.js";
import { fitView, proseVisible } from "./layout.js";
import { navPlan, useArrowNav } from "./keynav.js";
import { useSwipeNav } from "./swipe.js";
import { useComments } from "./useComments.js";
import { ChatDialog, type ChatTarget } from "./ChatDialog.js";
import { anchored, countByBlock, useChatAnchors } from "./useChatAnchors.js";
import { PILL } from "./pill.js";
import { apiFetch, readJson } from "./lib/api.js";



/**
 * Which page you are on, and nothing else.
 *
 * The path says which article (`/read/<slug>`) and which of its three views
 * (`/metadata`, `/tweets`, or the reading view itself), or that you want the
 * shelf (`/`); the query string says how you are looking at it. See router.ts
 * for that division, and params.js for the parameters themselves.
 */
export function App() {
  const route = useRoute();
  const { user, loading } = useSession();

  /* **The callback is answered before the gate**, and it has to be: the reader
     arriving here is by definition not signed in yet, and sending them to the
     sign-in screen would throw away the code they came back with. */
  if (route.kind === "callback") return <AuthCallback />;

  /* Nothing, not a spinner. This is one frame between page load and the SDK's
     first `INITIAL_SESSION`, and a spinner that flashes on every reload reads
     as slowness rather than as care. */
  if (loading) return null;

  /* **A whole-app gate rather than a route**, because who you are is not view
     state and docs/project/url-state.md says view state is what lives in the
     URL. The address you were at is still in the address bar when you come
     back — which is the point. */
  if (!user) return <SignInPage />;

  // The shelf is home, so it gets no way-home logo — a link to the page you are
  // already on is a dead control, and Library.tsx names the app in its own
  // `<h1>` anyway. Everywhere else, the corner. See HomeLogo.tsx.
  if (route.kind === "library") return <Library />;
  // The corner logo, because this is not home and the reader may have arrived
  // straight here from a bookmarklet with no shelf behind them.
  if (route.kind === "add")
    return (
      <>
        <HomeLogo />
        <AddPage source={{ kind: "url", url: route.url }} />
      </>
    );
  /* The same page, given a file that is already in the object store rather than
     an address to fetch. See AddSource in AddPage.tsx for why it is one
     component and not two. */
  if (route.kind === "add-upload")
    return (
      <>
        <HomeLogo />
        <AddPage source={{ kind: "upload", uploadId: route.uploadId }} />
      </>
    );
  if (route.kind === "design")
    return (
      <>
        <HomeLogo />
        <DesignPage />
      </>
    );
  // Not under /read/, and so not inside `ArticlePage`'s shared shell: this page
  // has no article behind it. docs/project/reader-profile.md.
  if (route.kind === "profile")
    return (
      <>
        <HomeLogo />
        <ProfilePage />
      </>
    );
  /* Signed in, and asking for the sign-in page. There is nothing to show — the
     gate above already returned `SignInPage` for everyone who needs it — so
     this is somebody following a stale link, and the shelf is where they meant
     to end up. `replace`, because a Back button that returns you to a page that
     immediately bounces you again is a trap. */
  if (route.kind === "login") {
    navigate(LIBRARY_HREF, { replace: true });
    return null;
  }

  return (
    <>
      <HomeLogo />
      <ArticlePage slug={route.slug} view={route.view} />
    </>
  );
}

/**
 * One article, fetched **once for all three of its views**.
 *
 * The fetch lives here rather than in the reading view because the metadata and
 * tweet pages need the same payload, and because this component does not
 * remount when only the view changes: stepping out to the metadata page and
 * back is then free, rather than 150KB and a spinner each way. The remount that
 * *does* matter is keyed below, on the slug.
 *
 * Nothing here is `useState` except the article itself, which is derived from
 * the URL rather than part of it. Everything the reader can change lives in the
 * path or the query string — see params.js for why, and for which of these
 * changes push a history entry and which quietly replace one.
 */
function ArticlePage({ slug, view }: { slug: string; view: ArticleView }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The slug is in the path now, so it can change under us — via back/forward,
    // or a pasted link. Guard the response so a slow first fetch can't overwrite
    // a fast second one.
    let live = true;
    setArticle(null);
    setError(null);
    apiFetch(`/api/article/${encodeURIComponent(slug)}`)
      .then((r) => readJson<Article>(r))
      // Sanitised here, at the doorway, and nowhere later. This is the pass that
      // guards the render: stage 3 cleaned this HTML under *jsdom's* parser and
      // we are about to hand it to *Chrome's*. It must happen before anything
      // reads `block.html` — both renderedText and annotateHtml parse it with
      // innerHTML ahead of React. See src/web/sanitize.ts.
      .then((a) => live && setArticle(sanitizeArticle(a)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [slug]);

  /**
   * One more open, for the shelf's tooltip to count.
   *
   * **From here, not from inside `GET /api/article/:slug`.** A GET that writes
   * is a GET that a prefetch, a retry or a health check inflates without
   * anybody deciding to — and the shelf itself does not fetch article payloads,
   * so counting on the server would count a different thing anyway.
   *
   * Its own effect, keyed on the slug alone, so it fires once per article
   * opened rather than once per render. Fire-and-forget: a failed count is not
   * worth a message to a reader who came here to read, and the server logs it.
   *
   * **The ref is not belt-and-braces; without it the number is simply wrong.**
   * `<StrictMode>` is on (main.tsx), and in development React deliberately runs
   * every effect twice — so every article opened counted as two, and the
   * tooltip said "opened 19 times" to somebody who had opened it nine. It would
   * have been right in a production build, which is the worst version of this:
   * a number that is confidently wrong exactly where anybody would look at it.
   * A ref survives StrictMode's simulated remount, so this counts once per slug
   * per mount either way. See docs/reusable/silent-success.md.
   *
   * See src/shelf.ts and docs/project/library.md.
   */
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (counted.current === slug) return;
    counted.current = slug;
    void apiFetch(`/api/library/${encodeURIComponent(slug)}/open`, { method: "POST" }).catch(
      () => {},
    );
  }, [slug]);

  const slow = useSlow(!article && !error);

  if (error) return <pre className="error">{error}</pre>;
  // Silent until the wait is worth mentioning (useSlow.ts owns the threshold),
  // then a line naming what is being waited for rather than "Loading…".
  if (!article)
    return <div className="loading">{slow ? "Fetching the article and its summaries…" : ""}</div>;
  // Keyed on the slug so switching article remounts rather than trying to carry
  // one article's reading position into another's blocks. NOT keyed on the
  // view: switching view is meant to keep the fetch, which is the whole reason
  // it happens up here.
  if (view === "metadata") return <Metadata key={slug} slug={slug} article={article} />;
  if (view === "tweets") return <Tweets key={slug} slug={slug} article={article} />;
  return <Reader key={slug} slug={slug} article={article} />;
}

/** The window width, as state, because the whole layout is computed from it. */
function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/**
 * Reading position, both ways: the URL scrolls the page, and the page writes the
 * URL once the reader stops moving. Returns the one function anything should use
 * to jump somewhere deliberately.
 *
 * `synced` is the whole trick. Scrolling writes the URL and the URL scrolls the
 * page, so without a record of the value both sides already agree on, every
 * scroll bounces off the restore effect and scrolls again. It is set by whichever
 * side moved first; the other then recognises the value as its own and does
 * nothing.
 *
 * The pure half — which block counts as "the section you are in", and why it is
 * a section rather than an offset — is in position.ts. Written by
 * spideryarn2-cd, 2026-08-25.
 */
function useReadingPosition(sections: Section[], layoutKey: string) {
  const [at, setAt] = useQueryState("at", atParam);
  const synced = useRef<BlockId | null>(null);

  // URL → page: first load, back/forward, pasted link.
  useEffect(() => {
    if (at === synced.current) return;
    synced.current = at;
    if (at === null) window.scrollTo({ top: 0 });
    else scrollToBlock(at, "auto");
  }, [at]);

  // Page → URL, once the reader stops moving.
  useEffect(() => {
    const rows = sections.map((s) =>
      document.querySelector<HTMLElement>(`tr[data-block="${CSS.escape(s.blockId)}"]`),
    );
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Above the first section there is no section to name, and saying so keeps
      // ?at= out of the URL until the reader has actually moved.
      if (window.scrollY <= stickyOffset()) {
        if (synced.current === null) return;
        synced.current = null;
        void setAt(null);
        return;
      }
      const tops = rows.map((el) =>
        el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
      );
      const id = sections[activeSectionIndex(tops, stickyOffset() + 1)]?.blockId ?? null;
      if (id === null || id === synced.current) return;
      synced.current = id;
      void setAt(id);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    measure(); // a column toggle reflows every row without the reader scrolling
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, setAt, layoutKey]);

  // A jump is the one scroll that pushes history: Back must not undo scrolling,
  // but flinging yourself across the article is a deliberate act. The debounce is
  // cancelled too, so a click isn't sluggish.
  //
  // `throttle(0)`, not `undefined`: nuqs resolves this option with `??`, so an
  // explicit undefined here falls straight through to atParam's
  // `debounce(POSITION_SETTLE_MS)` and cancels nothing. throttle(0) aborts the
  // pending debounce and writes the URL on the spot. Caught by
  // exactOptionalPropertyTypes — see docs/project/typechecking.md.
  const jumpTo = useCallback(
    (blockId: BlockId) => {
      synced.current = blockId;
      void setAt(blockId, { history: "push", limitUrlUpdates: throttle(0) });
      scrollToBlock(blockId);
    },
    [setAt],
  );

  // `at` goes out as well as `jumpTo` because it is half of the answer to
  // "where should this link land" — the other half being `?note=`, which the
  // caller has and this hook does not. See arrivalTarget in scroll.ts.
  return { at, jumpTo };
}

function Reader({ slug, article }: { slug: string; article: Article }) {
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

  // Gist columns are 0 … leafDepth-1. The leaf column is not user-toggled: it
  // only makes sense in outline mode, where it is the deepest rung of the table
  // of contents, and is meaningless beside the prose it labels.
  const gistDepths = useMemo(
    () => geometry.columnDepths.filter((d) => d < geometry.leafDepth),
    [geometry],
  );

  const [cols, setCols] = useQueryState("cols", colsParam);
  const [showText, setShowText] = useQueryState("text", textParam);

  /**
   * Whether the reader has had a view about the spine — see params.ts §
   * spineParam and layout.ts § showSpine.
   *
   * `null` until they press the pill, and `null` is not the same as `true`:
   * absent means the rail follows the window and the mode as it always has, and
   * that is what the `auto` control puts back.
   */
  const [showSpine, setShowSpine] = useQueryState("spine", spineParam);

  /**
   * Which mode owns the middle band — see params.ts § modeParam, and
   * docs/plans/chat-mode.md.
   *
   * Greg's framing, 2026-08-25: the gist columns are not a fixture with things
   * layered over them, they are *the default mode*, and chat is the second one.
   * So this is a single value the layout reads, not a flag each feature checks.
   */
  const [mode, setMode] = useQueryState("mode", modeParam);
  /* Any mode that is not the table of contents takes the band. Written as
     "not toc" rather than as `chat || glossary` on purpose: the third mode cost
     this line nothing, which is the property the slot was built for, and the
     fourth should cost it nothing either. */
  const inMode = mode !== "toc";

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

  const fit = useMemo(
    () =>
      fitView({
        windowWidth,
        gistDepths,
        leafDepth: geometry.leafDepth,
        showText: proseOn,
        chosen: cols,
        modeBand: inMode,
        showSpine,
      }),
    [windowWidth, gistDepths, geometry.leafDepth, proseOn, cols, inMode, showSpine],
  );

  /**
   * What the L0 column renders — one sentence per part on where the argument
   * stands there, rather than the root node repeated down the whole page.
   * Null until `npm run arc` has been run for this article, and then the column
   * falls back to the root exactly as it used to. See tree.js § the arc.
   */
  const arcCells = useMemo(
    () => buildArcColumn(geometry, article.arc),
    [geometry, article.arc],
  );

  // A string, not the array: a fresh array every render would restart the scroll
  // listener every render. `modeW` is in it because entering a mode moves every
  // row on the page sideways, and the `?at=` tracker holds row elements it
  // measured before the move. `spine` is in it for a stronger reason than
  // sideways: the rail's width is taken out of the prose column's, so hiding it
  // rewraps every paragraph in the article and every row changes height.
  const layoutKey = `${fit.columns.join(",")}|${proseOn}|${windowWidth}|${fit.modeW}|${fit.spine}`;
  const { at, jumpTo } = useReadingPosition(sections, layoutKey);

  /**
   * Comments: selecting prose asks a question of the model, and the answer
   * arrives in a floating dialog. See docs/project/comments.md.
   *
   * Note what is *not* here — no column, no change to `fit`, nothing threaded
   * through the layout arithmetic. That was the point of choosing a dialog.
   */
  const [note, setNote] = useQueryState("note", noteParam);
  const { comments, retry, deepen, remove, error: commentError } = useComments(slug);

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
  const chatAnchors = useChatAnchors(slug);

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
    mode === "chat" ? null : (chatDraft ?? (thread ? { kind: "thread", threadId: thread } : null));

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
   * `useGlossaryTerms` rather than `useGlossary`, which is the whole of why
   * `GlossaryBand` still exists: this is one GET and no job poller. See its
   * docstring.
   */
  const { entries: terms, setEntries: setTerms } = useGlossaryTerms(slug);

  /**
   * The glossary term the reader has *pressed* in the panel, of the many now
   * drawn.
   *
   * **Held here rather than in the glossary band, and that is not where it
   * wants to live.** `useGlossary` fetches on mount and polls the job list, so
   * it has to stay inside a component that only exists in glossary mode —
   * otherwise every reader of every article pays for a list almost none of them
   * open, which is the same reason `ChatBand` exists. But the *marks* are drawn
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
  const openTermInGlossary = useCallback(
    (id: string) => {
      void setTermId(id);
      void setMode("glossary");
    },
    [setTermId, setMode],
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
   * fix. Found by GPT Sol reviewing the plan; docs/plans/ideas-mode.md.
   */
  const [ideaFound, setIdeaFound] = useState<Found[]>([]);
  const [openOccurrence, setOpenOccurrence] = useState<string | null>(null);

  /* Two maps, memoised separately from everything else on the page. `found`
     changes on every keystroke in words mode, and recomputing every comment's
     anchor for an article's worth of blocks at that rate is the one thing that
     would make typing feel slow. Same reasoning as the second map in
     TableView.tsx. */
  /* **One list, chosen by mode, feeding every memo below.** The marks, the
     paragraph bar and the rail must all be about the same passages, and the way
     to guarantee that is for one expression to decide and everything else to
     read it — the same "compute once, hand to both" rule the panel and the
     prose already follow. The two modes are mutually exclusive, so this is a
     pick rather than a merge. */
  const passages = mode === "ideas" ? ideaFound : found;
  const openPassage = mode === "ideas" ? openOccurrence : openHit;
  const hitMarks = useMemo(
    () => buildHitMarks(passages, openPassage),
    [passages, openPassage],
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
   * The bottom drawer — see Dock.tsx, and docs/plans/bottom-bar.md for why the
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
    () => navPlan(geometry.cells, fit.columns, geometry.leafDepth, proseOn, !!arcCells),
    [geometry, fit.columns, proseOn, arcCells],
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

  /**
   * Step to another comment, bringing its passage into view *only if it isn't
   * already*. Two comments in one paragraph are the common case, and jolting the
   * page between them would lose the reader their place for no gain.
   *
   * It scrolls and writes no position state of its own — the listener in
   * useReadingPosition notices and updates `?at=`, exactly as it does for a
   * wheel. Same reasoning as keynav.ts.
   */
  const goToComment = useCallback(
    (id: string | null) => {
      if (id === null) return;
      void setNote(id);
      const target = comments.find((c) => c.id === id);
      if (target && !isBlockOnScreen(target.blockId)) scrollToBlock(target.blockId);
    },
    [comments, setNote],
  );

  /**
   * A `?note=` that arrived in the address bar brings its own passage into view.
   *
   * The gap this closes: `goToComment` above scrolls, so stepping between
   * questions inside the reading view was always fine — but that path needs the
   * comment in hand, and a pasted link has only an id. `/read/<slug>?note=<id>`
   * with no `?at=` beside it therefore opened a dialog about a paragraph that
   * was somewhere off screen, and which one was unguessable. That is exactly the
   * shape of a link you *send someone*, because `?at=` is only ever there if the
   * sender had scrolled. Recorded as open in docs/plans/metadata-page.md.
   *
   * **It waits for the fetch, and it has to.** `useComments` loads over the wire,
   * so at the moment the URL is read we know the note's id and not its block.
   * `arrivalTarget` returns `at` until the comment turns up, which is what the
   * `?at=` restore has already done, so the guard below makes those renders
   * free — and then the comment arrives and this fires once.
   *
   * **Once**, and that is the ref. After the first honoured arrival, moving
   * between comments belongs to `goToComment`, which deliberately holds still
   * when the next passage is already on screen. Re-running this on every change
   * to `note` would be a second thing moving the page, and the two would
   * disagree the moment either changed.
   *
   * `isBlockOnScreen` rather than an unconditional jump, for the same reason
   * `goToComment` uses it: when `?note=` and `?at=` agree — the passage sits in
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

  /** Whether the paragraph-level nav labels are riding beside the prose. */
  const leafOn = showText && fit.columns.includes(geometry.leafDepth);

  /** The gist columns actually on screen — the leaf column isn't one of them. */
  const shownGists = useMemo(
    () => fit.columns.filter((d) => d !== geometry.leafDepth),
    [fit.columns, geometry.leafDepth],
  );

  // Toggling writes the set into the URL, which also takes the columns off
  // automatic — the window should not quietly overrule a choice the reader made.
  // The `auto` control clears it again.
  const toggle = (d: number) => {
    const next = new Set(fit.columns);
    next.has(d) ? next.delete(d) : next.add(d);
    setCols([...next].sort((a, b) => a - b));
  };

  /**
   * The rail, on or off — Greg, 2026-08-26: "a button in the top bar to
   * show/hide the Spine (just as we can with L0, L1, etc)".
   *
   * Rendered in **both** halves of the bar below, unlike the granularity pills.
   * Those are removed in a mode because the columns they name are not there,
   * and a control that looks live and does nothing is worse than no control.
   * The spine is the opposite case: it is on screen in every mode, so the pill
   * that hides it has to be too.
   *
   * `pressed` reads the resolved layout rather than the parameter, so the pill
   * says what is actually on screen — unpressed in outline mode, where nobody
   * chose anything and the rail is gone anyway. Pressing it then writes the
   * explicit `?spine=1` that overrules that.
   */
  const spineToggle = (
    <Toggle
      className={PILL}
      pressed={fit.spine !== "off"}
      onPressedChange={(on) => void setShowSpine(on)}
      title="Show or hide the bird's-eye rail down the left"
    >
      Spine
    </Toggle>
  );

  return (
    <div
      className={`reader spine-${fit.spine}`}
      /* The wrapper must be as wide as its content for the sticky bars inside it
         to have anywhere to slide — a sticky element is clamped to its containing
         block, so one exactly its own width has a sticky range of zero and never
         moves. See docs/reusable/css-sticky-containing-block.md. Set explicitly
         rather than with `max-content`, which a table of prose answers with a
         number in the thousands. */
      style={{ minWidth: fit.minWidth, "--mode-w": `${fit.modeW}px` } as CSSProperties}
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
      <Masthead article={article} />
      <div className="controls">
        {/* The granularity controls belong to the table-of-contents mode, so
            they go with it. Leaving them on screen in another mode would offer
            columns that are not there — a control that looks live, does
            nothing, and gives the reader no way to tell which. The mode's own
            name takes their place so the bar still says what the middle band
            is. */}
        {inMode ? (
          <>
            <span className="controls-label">Mode</span>
            <span className="mode on">{mode}</span>
            <button
              type="button"
              className="linky"
              onClick={() => void setMode("toc")}
              title="Back to the table of contents columns"
            >
              back to contents
            </button>
            {spineToggle}
          </>
        ) : (
          <>
          <span className="controls-label">Granularity</span>
          {gistDepths.map((d) => (
            <Toggle
              key={d}
              className={PILL}
              pressed={shownGists.includes(d)}
              onPressedChange={() => toggle(d)}
              title={`Show or hide the ${columnLabel(d, geometry.leafDepth, d === 0 && !!arcCells).toLowerCase()} column`}
            >
              L{d}
            </Toggle>
          ))}
          {/* The paragraph outline, beside the prose rather than instead of it.
              Only offered in reading mode: in outline mode this column is the
              view, and turning it off would leave nothing. */}
          {showText && (
            <Toggle
              className={PILL}
              pressed={leafOn}
              onPressedChange={() => toggle(geometry.leafDepth)}
              title="One line per paragraph, alongside the full text"
            >
              L{geometry.leafDepth}
            </Toggle>
          )}
          <Toggle
            className={PILL}
            pressed={showText}
            onPressedChange={() => setShowText((v) => !v)}
            title="Hide the text to collapse the table into a whole-article outline"
          >
            Text
          </Toggle>
          {spineToggle}
          {/* `fit` means nothing has been pinned down by hand, so it has to
              watch both parameters: a reader who has hidden the rail but left
              the columns alone is not on automatic, and would otherwise have no
              way back. `auto` clears the pair for the same reason.

              **The pair, deliberately, and it does cost something** — GPT Sol
              named it, 2026-08-26: you cannot hand the rail back to automatic
              while keeping columns you chose. The bar gets one "nothing is
              pinned" affordance rather than one per parameter, because two
              would be two more words in a bar that is already dense, to undo a
              state almost nobody is in. Say `auto` resets the layout, not the
              columns.

              There is no `auto` in a mode, and it is not needed: `fitMode`
              turns the rail off only for an explicit `?spine=0`, so pressing
              the pill back on there is indistinguishable from automatic. */}
          {cols === null && showSpine === null ? (
            <span
              className="mode"
              title="The columns and the spine are following the window width"
            >
              fit
            </span>
          ) : (
            <button
              type="button"
              className="linky"
              onClick={() => {
                void setCols(null);
                void setShowSpine(null);
              }}
              title="Let the columns and the spine follow the window width again"
            >
              auto
            </button>
          )}
          <span className="mode">{showText ? "reading" : "outline"}</span>
          </>
        )}
        {/* The aim, said out loud. The arrows are useless as an experiment if
            you cannot tell what they are pointing at before you press one. */}
        <span
          className="keynav"
          title="Up and down arrows step through this level — left and right arrows, or the pointer, change which level that is"
        >
          ↑↓ {columnLabel(navDepth, geometry.leafDepth, navDepth === 0 && !!arcCells)}
        </span>
        {/* Failures of the comment transport belong here rather than in the
            dialog: if the fetch never landed there is no dialog to put them in. */}
        {commentError && (
          <span className="cmt-transport-error" title={commentError}>
            comments: {commentError}
          </span>
        )}
        <span className="provenance" title={article.tree.generator}>
          {article.tree.version}
        </span>
      </div>
      <TableView
        article={article}
        sections={sections}
        layoutKey={layoutKey}
        geometry={geometry}
        columns={fit.columns}
        layout={fit}
        showText={proseOn}
        navDepth={navDepth}
        arcCells={arcCells}
        onJump={jumpTo}
        comments={comments}
        openComment={note}
        chats={anchored(chatAnchors.summaries)}
        chatCounts={countByBlock(chatAnchors.summaries)}
        openChat={overlay?.kind === "thread" ? overlay.threadId : null}
        onOpenChat={(id) => {
          setChatDraft(null);
          void setNote(null);
          void setThread(id);
        }}
        onChatAbout={(blockId) => {
          /* A conversation anchored to the whole block — the other half of what
             an anchor can be, and the one that draws no mark in the prose. The
             paragraph's opening words go into the composer so the reader can see
             which one they pressed; a six-character id is not something you can
             check you clicked correctly. */
          void setNote(null);
          void setThread(null);
          setChatDraft({
            kind: "draft",
            anchor: { blockId },
            opening: blockText.get(blockId) ?? "",
          });
        }}
        terms={termSelections}
        openTerm={term?.id ?? null}
        hitMarks={hitMarks}
        hitHues={hitHues}
        hitStrength={hitStrength}
        onSelect={(anchor) => {
          if (!anchor) return;
          /* **Nothing is bought here.** Until 2026-08-26 this line spent a model
             call the reader had not asked for; now it opens a box and waits.
             Greg's call — see docs/plans/chat-as-gateway.md. */
          void setNote(null);
          void setThread(null);
          setChatDraft({
            kind: "draft",
            anchor: { blockId: anchor.blockId, quote: anchor.quote, start: anchor.start },
            opening: anchor.quote,
          });
          /* **The browser's selection is deliberately left alone**, which is a
             reversal. It used to be cleared because it sat on top of the mark
             we had just drawn and hid it. There is now no mark to reveal —
             nothing is stored until the reader asks — so clearing it would
             leave them looking at a quote in a box with no idea which words on
             the page it came from. */
        }}
        onOpenComment={(id) => void setNote(id)}
      />
      {overlay && (
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
            setChatDraft(null);
            void setThread(id);
          }}
          onOpenFull={() => {
            /* One id, so this is the whole of it: the band reads the same
               `?thread=` the panel was reading. */
            setChatDraft(null);
            void setMode("chat");
          }}
          onCreated={chatAnchors.add}
          onDropped={chatAnchors.drop}
        />
      )}
      {!overlay && openComment && (
        <CommentDialog
          comment={openComment}
          position={positionOf(ordered, note)}
          total={ordered.length}
          pending={othersPending}
          hasPrev={stepComment(ordered, note, -1) !== null}
          hasNext={stepComment(ordered, note, 1) !== null}
          onPrev={() => goToComment(stepComment(ordered, note, -1))}
          onNext={() => goToComment(stepComment(ordered, note, 1))}
          onClose={() => void setNote(null)}
          onRetry={() => retry(openComment.id)}
          onDeepen={() => deepen(openComment.id)}
          onDiscuss={(question) => {
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
          }}
          onDelete={() => {
            // Step to the neighbour rather than closing outright: deleting one
            // of five is a tidy-up, not a reason to lose the panel.
            const next = stepComment(ordered, note, 1) ?? stepComment(ordered, note, -1);
            remove(openComment.id);
            void setNote(next);
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
        sourceUrl={article.meta.url ?? null}
        blockText={blockText}
        onOpenTerm={openTermInGlossary}
        onJump={jumpTo}
      />

      {/* The mode band. Rendered only in its mode, which is what keeps the
          fetch inside it from being charged to every reader of every article —
          see ChatBand. */}
      {mode === "chat" && (
        <ChatBand slug={slug} blocks={blockText} onJump={jumpTo} />
      )}
      {mode === "glossary" && (
        <GlossaryBand
          slug={slug}
          onJump={jumpTo}
          onSelected={setTerm}
          /* The band holds the fresher list while it is open — the reader may
             have just generated, appended to or reset it — and the underlines
             in the prose are drawn from the copy up here. So it pushes, exactly
             as it pushes the selection. */
          onEntries={setTerms}
        />
      )}
      {mode === "summary" && (
        <SummaryBand slug={slug} article={article} onJump={jumpTo} />
      )}
      {mode === "diagram" && <DiagramBand article={article} onJump={jumpTo} />}
      {mode === "ideas" && (
        <IdeasBand
          slug={slug}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setIdeaFound}
          openKey={openOccurrence}
          onOpenKey={setOpenOccurrence}
        />
      )}
      {mode === "search" && (
        <SearchBand
          slug={slug}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setFound}
          openHit={openHit}
          onOpenHit={setOpenHit}
        />
      )}

      {/* Last in the DOM as well as topmost in z-index: the bar and its drawer
          are drawn over everything, and matching source order to paint order is
          one less thing to reason about when something appears underneath
          something else. */}
      <Dock
        slug={slug}
        view="article"
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
        drawer={{
          comments: ordered,
          panel,
          onPanel: (next) => void setPanel(next),
          onOpenComment: (id) => {
            // Close the drawer on the way through: the dialog it opens would
            // otherwise be underneath the dim, which looks exactly like nothing
            // happening.
            void setPanel(null);
            goToComment(id);
          },
        }}
      />
    </div>
  );
}

/**
 * Ideas, and the fetch that belongs to it.
 *
 * A component of its own for the reason `ChatBand` and `GlossaryBand` are:
 * `useIdeas` fetches on mount, and calling it up in `Reader` would charge every
 * reader of every article a request for a list almost none of them will open.
 *
 * What it pushes up is the **resolved** passages, not the stored occurrences.
 * The panel and the prose have to be showing the same set, and the only way to
 * guarantee that is for one of them to compute it and hand it to the other —
 * the same rule `SearchBand` follows. Resolution can drop occurrences (a block
 * the article no longer has), so a panel counting the stored list would say
 * "2 of 5" and step through three.
 */
function IdeasBand({
  slug,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  slug: string;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  const ideas = useIdeas(slug);
  const [ideaId, setIdeaId] = useQueryState("idea", ideaParam);

  /* The palette slot, assigned over **every** idea rather than only the
     selected one, so an idea's colour does not depend on which one is open —
     the same guarantee `assignSlots` gives saved searches, and the same reason
     App.tsx calls it over all runs rather than the active ones.

     `generatedAt` for every idea, so `inCreationOrder` walks them in the order
     the artefact stores — which src/ideas.ts fixes at write time precisely so
     this cannot reshuffle. Ideas have no clock of their own; the artefact's is
     the honest stand-in, and the index breaks the tie. */
  const slots = useMemo(() => {
    const list = ideas.ideas?.ideas ?? [];
    const at = ideas.ideas?.generatedAt ?? "";
    return assignSlots(list.map((idea, i) => ({ id: idea.id, createdAt: `${at}#${i}` })));
  }, [ideas.ideas]);

  const selected = useMemo(
    () => ideas.ideas?.ideas.find((i) => i.id === ideaId) ?? null,
    [ideas.ideas, ideaId],
  );

  /* Document order, so the stepper's "2 of 4" counts the way the reader moves
     through the article rather than the order the model happened to list them. */
  const found = useMemo(() => {
    if (!selected) return [];
    return orderFound(
      resolveIdea(blocks, {
        id: selected.id,
        slot: slots.get(selected.id) ?? 0,
        occurrences: selected.occurrences,
      }),
      "document",
    );
  }, [selected, blocks, slots]);

  /* **`useLayoutEffect`, not `useEffect`** — a passive effect leaves one
     paintable frame in which the panel shows the new idea and the prose still
     marks the old one. Same reasoning, and the same pairing with an
     unmount-only clear below, as `SearchBand`. */
  useLayoutEffect(() => {
    onFound(found);
  }, [found, onFound]);

  /* An open occurrence that is no longer in the list cannot stay open.
     Regenerating mints new keys for every passage, and a re-extraction can drop
     one — either way the row and its mark both go, while `openKey` survives and
     the stepper reads "– / 3" over a list the reader has not left. `SearchBand`
     has the same effect for the same reason, and it was missing here.
     Keyed on absence from `found`, so ordinary selection changes are left
     alone. GPT Sol, 2026-08-27. */
  useEffect(() => {
    if (openKey && !found.some((f) => f.key === openKey)) onOpenKey(null);
  }, [found, openKey, onOpenKey]);

  /* Standing on the first passage is the state a selected idea is *in* — and it
     is the state whether the reader got there by pressing the row or by opening
     a URL that already had `?idea=` in it. The jump below only fires on a press,
     so a deep link drew three washed passages, emphasised none of them, and put
     "– / 3" in the stepper; the reader's first press of › then took them to
     passage two. Same bug the glossary had, fixed there by deriving rather than
     seeding, and it reaches this panel from the other end. Browser, 2026-08-27.

     **It opens without moving anybody.** A shared URL carries `?at=` too, and
     the reader's own position in the article beats our idea of where they
     should be looking. Only the press earns the scroll. */
  useEffect(() => {
    if (openKey === null && found.length > 0) onOpenKey(found[0]!.key);
  }, [found, openKey, onOpenKey]);

  /* Selecting an idea arrives at its first passage — and it has to be the first
     one that RESOLVED, which cannot be decided in the panel: until the
     selection changes, nothing has resolved that idea's occurrences at all.
     So the press records an intention and this effect spends it once the list
     exists.

     A ref rather than state, so spending it does not cause a render; and
     cleared before the jump rather than after, so a `found` that changes again
     while the reader is reading cannot fling them back to the top. */
  const wantsJump = useRef(false);
  useEffect(() => {
    if (!wantsJump.current || found.length === 0) return;
    wantsJump.current = false;
    const first = found[0]!;
    /* **Open it as well as go to it.** Without this the reader is standing on
       occurrence one — the page has scrolled there and the words are washed —
       while the stepper reads "– / 3", and their first press of › appears to do
       nothing because it moves them to the passage they are already looking at.
       Found in the browser, 2026-08-27; it is exactly the kind of thing that is
       invisible from the code, where "nothing selected yet" and "on the first"
       are two perfectly reasonable states that happen to look identical here. */
    onOpenKey(first.key);
    onJump(first.blockId);
  }, [found, onJump, onOpenKey]);

  /* Unmount only, with no data dependencies: leaving the mode must take the
     marks out of the prose with it, and folding this into the effect above
     would clear them on every change before setting them again — one frame of
     flicker on every keypress-equivalent. */
  useEffect(
    () => () => {
      onFound([]);
      onOpenKey(null);
    },
    [onFound, onOpenKey],
  );

  return (
    <IdeasPanel
      {...ideas}
      ideaId={ideaId}
      onIdea={(next) => {
        void setIdeaId(next);
        /* A new idea means the old occurrence is meaningless — its key names an
           idea nobody is looking at, so the stepper would read "0 / 3". */
        onOpenKey(null);
        /* Only on selecting, never on clearing: pressing the open idea again
           takes the marks away, and throwing the reader down the article as it
           does would be the opposite of what that gesture means. */
        wantsJump.current = next !== null;
      }}
      found={found}
      openKey={openKey}
      onOpenKey={onOpenKey}
      onJump={onJump}
    />
  );
}

/**
 * Chat, and the fetch that belongs to it.
 *
 * A component of its own for one reason: **`useChat` fetches on mount**, and
 * calling it up in `Reader` would charge every reader of every article a
 * request for a conversation almost none of them will open. Hooks cannot be
 * called conditionally, so the condition has to be a component boundary. Same
 * reasoning as the `drawer` prop in Dock.tsx, which exists so the metadata page
 * does not pay for comments it has no use for.
 *
 * `?thread=` lives here too, for the same reason — it is meaningless outside
 * chat mode, and reading it in `Reader` would put a parameter subscription on
 * every render of the reading view for a value only this component uses.
 */
function ChatBand({
  slug,
  blocks,
  onJump,
}: {
  slug: string;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
}) {
  const {
    threads,
    loaded,
    recovering,
    send,
    retry,
    edit,
    stop,
    begin,
    discard,
    rename,
    remove,
    error,
  } = useChat(slug);
  const [thread, setThread] = useQueryState("thread", threadParam);

  /**
   * A counter that goes up whenever a *new* conversation is started, so the
   * composer knows to take focus.
   *
   * A counter and not a boolean, because "start another new chat" has to be
   * distinguishable from the last one — a boolean that is already `true` fires
   * no effect. And a counter rather than focusing from here directly, because
   * the element belongs to the composer: reaching down for it would mean a ref
   * threaded through two components that otherwise share nothing.
   *
   * Deliberately NOT raised when an existing conversation is opened. Focus in
   * the textarea means ↑/↓ stop stepping the article (keynav.ts ignores keys
   * typed into one), so taking it is only right when the reader has just asked
   * for somewhere to type.
   */
  const [focusNonce, setFocusNonce] = useState(0);
  const startNew = useCallback(() => {
    void setThread(begin());
    setFocusNonce((n) => n + 1);
  }, [begin, setThread]);

  /**
   * **An empty chat opens a conversation rather than an empty list.**
   *
   * Greg, 2026-08-26: *"By default, if no existing Chats, start a new one."*
   * The list is worth showing when there is something in it; when there is not,
   * it is a page whose only content is a button, and pressing that button is
   * the only thing anyone was ever going to do.
   *
   * `loaded` is what makes this safe. Without it, "no threads" and "the fetch
   * has not come back" are the same state, so every visit would create a thread
   * before the reader's real ones arrived — and having created one, would not
   * create one on the visit where they genuinely had none. See useChat.ts.
   *
   * It cannot loop: `begin` inserts its conversation into `threads` on the spot,
   * so the condition is false by the next render.
   *
   * **Once per visit to chat mode, and the latch is what makes closing a
   * conversation work at all.** An empty conversation the reader closes is
   * discarded (see `onDiscard` below), which puts the panel back into exactly
   * the state this effect fires on — nothing stored, nothing open — so without
   * the latch the close button would hand them a brand-new empty conversation
   * and read as broken. "By default" means on arrival; a reader who has just
   * closed the only conversation asked for the list.
   *
   * Be exact about "once", because the obvious reading is wrong: the latch is a
   * ref in a component that is unmounted whenever the reader switches to
   * another mode, so coming back to chat starts a conversation again. That is
   * the behaviour we want — arriving in chat mode is the arrival this rule is
   * about — but it does mean the latch does not survive a mode switch, and any
   * future reasoning that assumes it does will be wrong. It is reset on `slug`
   * as well, for the case the panel stays mounted across a change of article.
   *
   * `thread` is deliberately *not* in the condition. `?thread=` can name a
   * conversation that no longer exists — leave chat mode with an empty new one
   * open and the URL keeps its id while the panel takes the conversation with
   * it — and a reader coming back to that URL should get a conversation, not a
   * list they did not ask for. Starting one overwrites the stale id, which is
   * why there is no separate effect clearing it: an effect that cleared the URL
   * whenever the id was missing would also fire in the window between a first
   * question being sent and the server having written it down.
   */
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads nothing, and changing article is exactly when the latch stops meaning anything
  useEffect(() => {
    started.current = false;
  }, [slug]);


  useEffect(() => {
    if (!loaded || started.current) return;
    if (threads.length === 0) {
      started.current = true;
      startNew();
    }
  }, [loaded, threads.length, startNew]);
  /* Read, never written, and not a subscription: `?at=` is already tracked by
     useReadingPosition in the parent, so this component re-renders whenever it
     changes and `location.search` is current. It is passed to the model so that
     "this bit" and "what he just said" resolve to where the reader actually is.
     Same read-at-render trick Dock.tsx uses for its carried query string. */
  const at = new URLSearchParams(location.search).get("at");

  return (
    <ChatPanel
      slug={slug}
      threads={threads}
      threadId={thread}
      onThread={(id) => void setThread(id)}
      onNew={startNew}
      /* Local only — an empty conversation was never written down. See
         `withoutEmpty` in useChat.ts. */
      onDiscard={discard}
      onSend={(question, useProfile) => {
        // `send` returns the thread it went to, minted here when this is a new
        // conversation — so the URL can name it before the request lands.
        const id = send(thread, question, at, useProfile, (corrected) => void setThread(corrected));
        if (id !== thread) void setThread(id);
      }}
      onRename={rename}
      onDelete={(id) => {
        remove(id);
        // Back to the list rather than to a conversation that is not there.
        if (id === thread) void setThread(null);
      }}
      /* All three carry the *open* thread rather than a thread id from the
         panel, because the panel only ever shows one and the id it would send
         back is the one it was given. `thread` is non-null wherever these can
         be pressed — the conversation view is what renders them. */
      onRetry={(messageId) => thread && retry(thread, messageId)}
      onEdit={(messageId, question) => thread && edit(thread, messageId, question, at)}
      onStop={(messageId) => thread && stop(thread, messageId)}
      onJump={onJump}
      recovering={recovering}
      blocks={blocks}
      focusNonce={focusNonce}
      error={error}
    />
  );
}

/**
 * The glossary, and the fetch that belongs to it.
 *
 * A component of its own for the reason `ChatBand` above is: **`useGlossary`
 * fetches on mount** — and polls the job list while it is alive — so calling it
 * up in `Reader` would charge every reader of every article for a list almost
 * none of them will open. Hooks cannot be called conditionally, so the
 * condition has to be a component boundary.
 *
 * `?term=` and `?sort=` live here too, for the same reason: both are
 * meaningless outside glossary mode, and reading them in `Reader` would put two
 * parameter subscriptions on every render of the reading view for values only
 * this component uses.
 *
 * `onSelected` is the one thing that goes back out, and it is the seam
 * described on `term` in `Reader`: the panel knows which entry is selected, the
 * prose is where its underlines are drawn, and those are two different
 * components.
 */
function GlossaryBand({
  slug,
  onJump,
  onSelected,
  onEntries,
}: {
  slug: string;
  onJump(id: BlockId): void;
  onSelected(selection: TermSelection | null): void;
  /** The list itself, up to `Reader`, which is where the prose's marks are drawn. */
  onEntries(entries: GlossaryEntry[]): void;
}) {
  const glossary = useGlossary(slug);
  const [termId, setTermId] = useQueryState("term", termParam);
  const [sort, setSort] = useQueryState("sort", sortParam);
  /* Null is "nobody has touched the threshold", which the panel resolves to
     `PRIORITY_GATE`. Kept as null rather than defaulted here so the default
     stays one number in one file — see `gateParam` in params.ts. */
  const [gate, setGate] = useQueryState("gate", gateParam);

  /* `find` returns the entry object out of `glossary.entries`, so its identity
     is stable across renders until the list itself is refetched — which is what
     keeps the effect below from firing on every render. */
  const selected = glossary.glossary?.entries.find((e) => e.id === termId) ?? null;

  useEffect(() => {
    onSelected(
      selected ? { id: selected.id, forms: formsOf(selected), blocks: selected.blocks } : null,
    );
  }, [selected, onSelected]);

  /* And the list. `glossary.glossary` is a fresh object only when it has
     actually been refetched, so this fires on load and on each of the three
     verbs, not on every render.

     **Keyed on `status`, not on the entries being truthy**, which is a bug fix.
     `reset()` deletes the artefact and sets `glossary` to null while the new
     one is written, so there are no entries to push — and a bare `if (entries)`
     therefore pushed nothing at all, leaving the prose underlined from a list
     the reader had just thrown away, for as long as the regeneration took and
     for ever if it failed. `none` is a real answer and has to be said out loud.
     Found by a GPT Sol review, 2026-08-26.

     `loading` and `error` say nothing, on purpose: neither is a claim that the
     article has no terms, and pushing `[]` for them would blink every underline
     out and back on each mount of the band.

     No cleanup that clears it, unlike the selection below: leaving glossary
     mode must take the *highlight* off the pressed term, but the underlines are
     not a property of the mode any more and must survive the band closing. */
  const status = glossary.status;
  const entries = glossary.glossary?.entries;
  useEffect(() => {
    if (status === "ready" && entries) onEntries(entries);
    else if (status === "none") onEntries([]);
  }, [status, entries, onEntries]);

  /* Leaving glossary mode must take the *highlight* off the pressed term. Not
     the underlines, which since 2026-08-26 are a standing property of the
     article and outlive the band — this comment said otherwise until a GPT Sol
     review noticed it was describing the old behaviour.

     Its own effect, with no dependency on `selected`, so it runs on unmount and
     only on unmount — folding it into the cleanup of the effect above would
     clear the selection on every change and set it again immediately, which is
     a visible flicker. */
  useEffect(() => () => onSelected(null), [onSelected]);

  return (
    <GlossaryPanel
      {...glossary}
      termId={termId}
      onTerm={(id) => void setTermId(id)}
      sort={sort}
      onSort={(next) => void setSort(next)}
      gate={gate}
      onGate={(next) => void setGate(next)}
      onJump={onJump}
    />
  );
}

/**
 * Search, and the fetch that belongs to it.
 *
 * A component of its own for the reason `ChatBand` and `GlossaryBand` above
 * are: **`useSearch` fetches on mount**, so calling it up in `Reader` would
 * charge every reader of every article a request for a list of saved searches
 * almost none of them will open. Hooks cannot be called conditionally, so the
 * condition has to be a component boundary.
 *
 * All four of its URL parameters live here too, for the same reason `?term=`
 * and `?sort=` live in `GlossaryBand`: every one of them is meaningless outside
 * search mode, and reading them in `Reader` would put four parameter
 * subscriptions on every render of the reading view for values only this
 * component uses.
 *
 * ## The two matchers meet here and nowhere else
 *
 * `results` below is the whole of that design: whichever matcher is selected
 * produces a `Found[]`, and from that line onwards the panel, the marks, the
 * bar down each paragraph and the sort control are identical. Adding a third
 * way of matching would be a third arm of this one ternary.
 *
 * The literal matcher runs **in this memo**, on every keystroke, over every
 * block — which sounds alarming and is not: it is one `indexOf` loop over a few
 * hundred short strings, and it is what makes typing feel instant rather than
 * like a search you have to submit. The expensive matcher is the one that
 * already has a button.
 */
function SearchBand({
  slug,
  blocks,
  onJump,
  onFound,
  openHit,
  onOpenHit,
}: {
  slug: string;
  blocks: Article["blocks"];
  onJump(id: BlockId): void;
  /* Out only. The results are computed here and pushed up to `Reader`, which
     owns the prose — the seam described on `found` there. Passing them back
     down would be a second copy of a value this component is the source of. */
  onFound(next: Found[]): void;
  openHit: string | null;
  onOpenHit(next: string | null): void;
}) {
  const { runs, loaded, ask, retry, remove, error } = useSearch(slug);
  const [match, setMatcher] = useQueryState("match", matchParam);
  const [find, setFind] = useQueryState("find", findParam);
  /* `?match=` has no default of its own, so that a URL carrying `?find=` and
     nothing else still opens on the words matcher it was written for. The rule
     lives in params.ts § resolveMatcher; here it is one line. */
  const matcher = resolveMatcher(match, find);
  /* `?run=` is read and never written — the one-search URLs that existed before
     2026-08-26 seed the set, and from then on it is `?runs=`. params.ts §
     resolveRuns has the why. */
  const [run1] = useQueryState("run", runParam);
  const [runIds, setRunIds] = useQueryState("runs", runsParam);
  const active = useMemo(() => resolveRuns(runIds, run1), [runIds, run1]);
  const [order, setOrder] = useQueryState("order", orderParam);
  /* Null until the reader drags it — see confParam, and `gateParam` beside it,
     for why "nobody has touched this" has to stay distinguishable from "the
     reader chose the default". */
  const [chosenConf, setConf] = useQueryState("conf", confParam);
  const gate = chosenConf ?? PRIORITY_CONF;

  /**
   * Which colour each saved search wears.
   *
   * Over **every** saved run, not just the switched-on ones, and that is the
   * point rather than an oversight: a search's colour must not change when the
   * reader unticks the search above it. Assigning over the active set would do
   * exactly that, and it would be the kind of wrong that looks like a rendering
   * glitch — the same three passages, a different colour, every time you touch
   * a box. hit-colours.ts § What the assignment has to be.
   */
  const slots = useMemo(() => assignSlots(runs), [runs]);

  /* One list, two producers, and on the meaning side several searches merged.

     **A `pending` run contributes its hits now**, which is the whole of what
     streaming search buys the reader: since 2026-08-26 the hook appends each
     passage to `run.hits` as it arrives and leaves the status `pending` until
     the authoritative result lands, so filtering on `done` here meant the marks
     appeared in the prose all at once at the end anyway. Everything upstream
     streamed and this line quietly undid it.

     The comment this replaces said a pending run "has no hits", which was true
     when it was written and is the reason to reread a filter rather than trust
     the sentence above it.

     A failed run still contributes nothing, and that half of the original
     reasoning stands: it has no hits worth trusting, and showing an older run's
     marks under a newer run's colour would be the panel and the prose saying
     different things. Stale hits cannot leak in on a retry either — the hook
     writes a fresh `hits: []` before it reopens the stream. */
  const answered = useMemo(
    () =>
      runs
        .filter((r) => active.includes(r.id) && r.status !== "error")
        .map((r) => ({ id: r.id, slot: slots.get(r.id) ?? 0, hits: r.hits })),
    [runs, active, slots],
  );

  /* The ordered results, before the prioritised bar. Kept as its own value
     because the slider needs a denominator: the reader has to be told `3 of 11`
     rather than `3`, or a filter that hides eight things looks like a search
     that found three. */
  const ordered = useMemo(
    () =>
      orderFound(
        matcher === "words" ? findLiteral(blocks, find) : resolveHits(blocks, answered),
        order,
      ),
    [matcher, blocks, find, answered, order],
  );

  /* And after it. **This is the one place the threshold may be applied**, for
     the same reason `ordered` is computed here rather than in the panel: what
     goes to the panel goes to the prose, so the marks in the article are the
     rows in the list and can never be a different set. A filter applied in the
     panel would hide a row and leave its wash on the paragraph. See the
     `hitMarks` prop in TableView.tsx and `found` in Reader above.

     Note it is the whole list back again for every order but this one, so
     `?conf=` sitting in a URL cannot filter a list the reader is not looking
     at a threshold for. */
  const results = useMemo(
    () => (order === "prioritised" ? keepAbove(ordered, gate) : ordered),
    [ordered, order, gate],
  );

  /* A result the bar has hidden cannot stay the open one. Its row and its mark
     both go, so nothing on screen says it is open — but the key survived, and
     dragging the bar back later silently reopened a selection the reader had
     made minutes ago and watched disappear. Cleared rather than remembered:
     "open" is a thing the reader can see, and a hidden one is a claim about the
     page that the page is not making. GPT Sol's review, 2026-08-26.

     Keyed on absence from `results`, so ordinary streaming — where the open row
     is still in the list — leaves it alone. */
  useEffect(() => {
    if (openHit && !results.some((f) => f.key === openHit)) onOpenHit(null);
  }, [results, openHit, onOpenHit]);

  /* Push the results up to `Reader`, which owns the prose. `onFound` is a plain
     setter and therefore stable, so this cannot loop.

     **`useLayoutEffect`, not `useEffect`, and the difference is a frame the
     reader can see.** This component renders the new results list immediately;
     the prose is `Reader`'s, so it only changes once this setter has run and a
     second commit has happened. `useEffect` runs *after* the browser may have
     painted, so there is a window — a tick, a stream frame landing, a matcher
     switch — where the panel shows the new passages and the article still shows
     the old marks. That is the one invariant this feature is built around
     (search-hits.ts § the panel and the prose agree), so a frame of it is worth
     a synchronous commit. `useLayoutEffect` runs before paint, which closes it.

     It is cheap because the expensive half already happened: the memo above has
     computed `results` either way, and this only adds one render before paint.
     Raised by a GPT Sol review, 2026-08-26, which is also right that the real
     fix is one owner for the derived state rather than two — that is a change
     to how all four bands talk to `Reader`, and it is not this change. */
  useLayoutEffect(() => onFound(results), [results, onFound]);

  /* Leaving search mode must take the marks out of the prose with it. Its own
     effect, with no dependency on the results, so it runs on unmount and only
     on unmount — folding it into the cleanup above would clear the marks on
     every keystroke and set them again immediately, which is a visible flicker
     of every highlight on the page. Exactly the trap `GlossaryBand` documents. */
  useEffect(
    () => () => {
      onFound([]);
      onOpenHit(null);
    },
    [onFound, onOpenHit],
  );

  return (
    <SearchPanel
      matcher={matcher}
      onMatcher={(next) => {
        void setMatcher(next);
        /* The selection goes with the matcher, because the row it names belongs
           to the list that is about to be replaced. The ticks do **not**: they
           are the reader's own answer to "what should be marked", and switching
           to words to look something up and back again should return them to
           the article they left rather than to a blank one. That is a change
           from the single-`?run=` version, which cleared it — because there
           "which search is open" was a view state that words mode plainly did
           not have, and a set of ticks is a preference that survives a look
           elsewhere. */
        onOpenHit(null);
      }}
      find={find}
      onFind={(next) => {
        void setFind(next);
        onOpenHit(null);
      }}
      runs={runs}
      loaded={loaded}
      active={active}
      slots={slots}
      onToggle={(id, on) => {
        void setRunIds(on ? [...active, id] : active.filter((x) => x !== id));
        /* Whatever row was open may have belonged to the search just switched
           off, and a highlighted row pointing at a mark that is no longer drawn
           is the panel and the prose disagreeing. Cheap to clear, and the
           reader loses only a highlight. */
        onOpenHit(null);
      }}
      onToggleAll={(on) => {
        void setRunIds(on ? runs.map((r) => r.id) : []);
        onOpenHit(null);
      }}
      onAsk={(criterion) => {
        /* `ask` mints the id, so `?runs=` can name the search before the model
           has said anything — the same trick `?note=` and `?thread=` use.

           And it switches itself on, which is the one exception to
           default-false: a search the reader just paid for and cannot see is
           not a result. */
        void setRunIds([...active, ask(criterion)]);
        onOpenHit(null);
      }}
      onRetry={retry}
      onDelete={(id) => {
        remove(id);
        void setRunIds(active.filter((x) => x !== id));
        onOpenHit(null);
      }}
      found={results}
      all={ordered}
      order={order}
      onOrder={(next) => void setOrder(next)}
      gate={gate}
      gateMoved={chosenConf !== null}
      onGate={(next) => void setConf(next)}
      openKey={openHit}
      onOpen={(key, blockId) => {
        onOpenHit(key);
        // Always jump, even when the block is already on screen — unlike
        // stepping between comments, which deliberately does not. A search
        // result is a place you have not been yet, and "I pressed it and
        // nothing moved" is the complaint that makes a results list feel
        // broken; two comments in one paragraph are the opposite case.
        onJump(blockId);
      }}
      error={error}
    />
  );
}

/**
 * The summaries, and the fetch that belongs to them.
 *
 * A component of its own for the reason `ChatBand` and `GlossaryBand` above
 * are: **`useSummaries` fetches on mount**, and calling it up in `Reader` would
 * charge every reader of every article a request for a panel almost none of
 * them will open. Hooks cannot be called conditionally, so the condition has to
 * be a component boundary.
 *
 * `?len=` and `?deep=` live here too, for the same reason — they are
 * meaningless outside summary mode, and reading them in `Reader` would put two
 * parameter subscriptions on every render of the reading view for values only
 * this component uses.
 *
 * See docs/project/summaries.md.
 */
function SummaryBand({
  slug,
  article,
  onJump,
}: {
  slug: string;
  article: Article;
  onJump(id: BlockId): void;
}) {
  const summaries = useSummaries(slug);
  const [rung, setRung] = useQueryState("len", rungParam);
  const [deep, setDeep] = useQueryState("deep", deepParam);

  /* The join: the tree, plus whatever `summary.json` has for it, matched by
     block range and never by node id — see tree.js § the summaries. Memoised on
     the artefact rather than on the hook, whose object identity changes on
     every poll of the job queue. */
  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks, summaries.summaries),
    [article.tree, article.blocks, summaries.summaries],
  );

  /* Read, never written, and not a subscription: `?at=` is already tracked by
     useReadingPosition in the parent, so this component re-renders whenever it
     changes and `location.search` is current. Same read-at-render trick
     ChatBand uses, and Dock.tsx for its carried query string.

     Turned into a row index here rather than passed down as an id, because the
     panel's question is "is the reader inside this range", and a range is a
     pair of row indices — comparing ids would be comparing random strings for
     order, which is the one thing block-ids.md forbids. */
  const at = new URLSearchParams(location.search).get("at");
  const atRow = useMemo(() => {
    if (at === null) return null;
    const i = article.blocks.findIndex((b) => b.id === at);
    return i === -1 ? null : i;
  }, [at, article.blocks]);

  /* Id to plain text, for the block ids the summaries cite: the panel needs it
     to tell a real id from an invented one, and to put the paragraph in a
     chip's hover card. The same map `Reader` builds for chat — built again
     here rather than threaded down, because this band is rendered only in its
     own mode and a prop would make every reader of every article pay for it. */
  const blockText = useMemo(
    () => new Map(article.blocks.map((b) => [b.id, b.text])),
    [article.blocks],
  );

  return (
    <SummaryPanel
      {...summaries}
      root={root}
      blocks={blockText}
      rung={rung}
      onRung={(next) => void setRung(next)}
      deep={deep}
      onDeep={(next) => void setDeep(next)}
      atRow={atRow}
      onJump={onJump}
    />
  );
}

/**
 * Diagram mode's band — the tree, drawn.
 *
 * Same shape as `SummaryBand` above and for the same reasons: `?diagram=` is
 * read here rather than in `Reader`, because it is meaningless outside this mode
 * and a subscription in the parent would cost every render of the reading view.
 *
 * **It takes no `slug` and fetches nothing.** Every number this panel needs is
 * already on the page — stage 4 wrote a gist onto every internal node, and the
 * block ranges give the sizes — so unlike chat, glossary, search and summary
 * there is no artefact to wait for, no job to run, and nothing to pay a model
 * for. That is the reason `strata` is the default picture: the one thing this
 * mode says that nothing else in the app says (how much of the article a
 * section is) is free on every article that has been through the pipeline at
 * all. See docs/project/diagram.md.
 */
function DiagramBand({
  article,
  onJump,
}: {
  article: Article;
  onJump(id: BlockId): void;
}) {
  const [kind, setKind] = useQueryState("diagram", diagramParam);

  /* No summaries joined in: this panel shows titles, gists and sizes, all of
     which are on the tree. Passing `null` is what keeps a diagram from ever
     being blank on an article nobody has paid for. */
  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks, null),
    [article.tree, article.blocks],
  );

  /* Read, never written — `?at=` is tracked by useReadingPosition in the
     parent, so this re-renders when it changes. Same read-at-render trick
     SummaryBand uses, and turned into a row index for the same reason: the
     question is "which node contains the reader", and containment is a
     comparison of row indices. Block ids carry no order. */
  const at = new URLSearchParams(location.search).get("at");
  const atRow = useMemo(() => {
    if (at === null) return null;
    const i = article.blocks.findIndex((b) => b.id === at);
    return i === -1 ? null : i;
  }, [at, article.blocks]);

  return (
    <DiagramPanel
      root={root}
      kind={kind}
      onKind={(next) => void setKind(next)}
      atRow={atRow}
      onJump={onJump}
      blocks={article.blocks}
    />
  );
}
