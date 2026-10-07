/**
 * Help — `/help`, the contents, and `/help/<page>`, one page of it: a topic, a
 * mode, a guide, or the questions together.
 *
 * Greg, SPIDERYARN-READING2-85, 2026-10-01:
 *
 * > Provide a Help or FAQ page for users that want to understand all of
 * > Spideryarn's features. Make sure it has a nice table of contents and search
 * > bar, and lots of anchor links (so we can link directly to places). And
 * > include it in footer.
 *
 * And `spya-ucftjt`, 2026-10-06, which is why it is pages and not one page:
 *
 * > the help page is really long. I wonder if it would make it more sense to
 * > break it up by modes and themes and stuff like that, with lots and lots of
 * > linking between. … And that way the help page could sort of have a nice
 * > table of contents that'd be nicely structured so you could navigate around
 * > it as a user.
 *
 * The words are Markdown files under pages/, gathered by help-content.tsx, and
 * the anchors and what an address means are in help-anchors.ts; this file is
 * only what draws them. docs/plans/261002b-help-page.md, and for the pages
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md.
 *
 * ## One component for every address under `/help`
 *
 * It asks the router which page (router.ts § the `help` variant) and draws
 * that. App.tsx mounts it once, under one `routeKey`, for all of them, so
 * moving from one Help page to the next keeps what is in the search box and
 * where the contents list is scrolled to, and nothing is torn down to change
 * the words in the middle.
 *
 * ## Its own contents list, not `PageContents`
 *
 * `PageContents` (Metadata) is a flat list scanned off the DOM, sized for that
 * page's margin and hidden entirely below `lg`, search box included. Help's is
 * drawn from the typed group list: grouped, sticky in a left column at `lg`,
 * and above the page on a narrow screen, where the search box stays in view
 * and the list folds shut. Only the search itself, `searchSections`, is
 * shared, with Help's own synonym table. GPT Sol, plan review of 261002b, R1.
 *
 * ## Arriving
 *
 * Getting to a Help page is the router's ordinary `navigate`, which scrolls to
 * the top. Three things are left for this page to do, and `arrive` is the one
 * place it does them:
 *
 * - **An address that has moved is replaced with where it went**: `/help#spine`,
 *   which is what every link said until 2026-10-07, becomes `/help/spine`; a
 *   retired mode's page becomes its successor's; a question asked for as a
 *   page becomes its place on the questions' page. Replaced, never pushed: the
 *   reader asked for one place, and Back should not visit its old name.
 * - **A question's fragment is scrolled to and flashed.** The page is lazily
 *   loaded (App.tsx § loadHelp), so on a direct load the browser looks for
 *   `#faq-…` before the section exists and gives up.
 * - **A link to a question from the questions' page itself** is taken by
 *   `onClickCapture` before the router's `Link` sees it. `navigate` would
 *   push the address and scroll to the top, and the route would not change,
 *   so nothing would bring the page back down.
 *
 * **The effect is keyed on the page, and that is the whole of what makes an
 * in-app move work.** The component is not remounted between Help pages, and
 * the router's `pushState` fires no `hashchange`, so an effect that ran only
 * on mount would arrive once, at the first page, and never again: a link from
 * a topic to a question would open the questions' page at the top. GPT Sol,
 * plan review of 261007e, R5. The other choice was to put the page in App's
 * `routeKey` and remount; that loses the search box's words on every move for
 * the sake of an effect dependency.
 */
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { DocumentPage } from "../DocumentPage.js";
import { scrollToAndFlash } from "../flash.js";
import { isImeComposing } from "../key-chord.js";
import { Link } from "../Link.js";
import { SignedInReader } from "../lib/made-for.js";
import { pageTitle, useDocumentTitle } from "../page-title.js";
import { searchSections, type SearchableSection } from "../page-search.js";
import { FEATURES_HREF, HELP_HREF, navigate, useRoute } from "../router.js";
import { SiteFooter } from "../SiteFooter.js";
import {
  HELP_QUESTIONS_HREF,
  helpHref,
  isFaqId,
  resolveHelpAnchor,
  resolveHelpPage,
  type HelpAnchor,
  type HelpPageAnchor,
  type HelpView,
} from "./help-anchors.js";
import {
  HELP_GROUPS,
  HELP_LINK_CLASS,
  HELP_QUESTIONS_GROUP,
  HELP_SYNONYMS,
  helpBody,
  helpEntry,
  helpPlace,
  helpSearchText,
} from "./help-content.js";
import { HelpAsk, useHelpAsk } from "./HelpAsk.js";
import { HelpSub, PageLink } from "./help-parts.js";

/**
 * What the search box searches, in contents order so ties keep it. Built on
 * the first search and kept: reading every page's words means parsing every
 * file, which a reader who came for one page should not wait for.
 */
let searchable: readonly SearchableSection[] | null = null;

function searchHelp(query: string): HelpAnchor[] {
  searchable ??= HELP_GROUPS.flatMap((g) =>
    g.anchors.map((a) => {
      const e = helpEntry(a);
      return { id: a, label: e.title, keywords: e.search.keywords, aside: e.search.aside, body: helpSearchText(a) };
    }),
  );
  return searchSections(query, searchable, HELP_SYNONYMS) as HelpAnchor[];
}

/**
 * **How many frames to wait for a question's section to exist** before giving
 * up on a fragment. The sections render with the page, so in practice the
 * first look finds it; this is for a slow first paint, and a cap so a bad
 * fragment does not poll for ever.
 */
const MAX_WAIT_FRAMES = 30;

/** A press that means "follow this link here", and not a new tab or a download. */
function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}

/**
 * **What is drawn**: a view with `moved` taken out, because an address that
 * has moved draws the page it moved to. The address is corrected a moment
 * later by `arrive`; drawing the destination at once means there is no frame
 * of anything else in between.
 */
type Shown = Exclude<HelpView, { kind: "moved" }>;

function shownFor(view: HelpView): Shown {
  if (view.kind !== "moved") return view;
  return isFaqId(view.to) ? { kind: "questions" } : { kind: "page", anchor: view.to };
}

/** The tab's first words for each view; none for the contents (page-title.ts § `help`). */
function titleOf(shown: Shown): string | undefined {
  switch (shown.kind) {
    case "contents":
      return undefined;
    case "page":
      return helpEntry(shown.anchor).title;
    case "questions":
      return HELP_QUESTIONS_GROUP.title;
    case "missing":
      return "Not found";
    default: {
      const never: never = shown;
      return never;
    }
  }
}

/**
 * Help keeps its search and answer while a reader moves between Help pages,
 * but never while the signed-in reader changes. The keyed child removes A's
 * words before B's first paint and unmounts `useHelpAsk`, whose cleanup aborts
 * A's paid request. `null` is the one signed-out reader.
 */
export function HelpPage() {
  const readerId = useContext(SignedInReader);
  return <HelpPageForReader key={readerId ?? "signed-out"} />;
}

function HelpPageForReader() {
  const route = useRoute();
  /* Mounted only for the `help` route (App.tsx); anything else is a frame of
     leaving, and the contents are as good a thing to draw in it as any. */
  const page = route.kind === "help" ? route.page : undefined;
  const view = useMemo(() => resolveHelpPage(page), [page]);
  const shown = shownFor(view);
  const title = titleOf(shown);
  useDocumentTitle(pageTitle(title === undefined ? { kind: "help" } : { kind: "help", page: title }));

  const [query, setQuery] = useState("");
  const results = useMemo(() => (query.trim() === "" ? null : searchHelp(query)), [query]);
  /** `arrive`, kept where a click handler can reach it. Set by the effect. */
  const arriveRef = useRef<() => void>(() => {});

  /* **Arrival.** See the header, § Arriving, for the three jobs and for why
     this is keyed on the page. A layout effect, so that an old address is
     corrected before the browser paints the contents it would otherwise show
     for a frame at `/help#spine`. */
  useLayoutEffect(() => {
    /* The address this run belongs to. A later `hashchange` on another page is
       that page's own run's to answer. */
    const here = location.pathname;
    let cancelScroll: (() => void) | null = null;
    let frame = 0;
    /* Only once there is a frame to cancel: in practice the first look finds
       the section, and jsdom without `pretendToBeVisual` has no rAF at all. */
    const stopWaiting = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    };
    function arrive(): void {
      cancelScroll?.();
      cancelScroll = null;
      stopWaiting();
      if (location.pathname !== here) return;
      if (view.kind === "moved") {
        navigate(helpHref(view.to), { replace: true });
        return;
      }
      const asked = location.hash;
      if (asked === "" || asked === "#") return;
      const anchor = resolveHelpAnchor(asked);
      if (anchor === null) return;
      /* `/help#spine`: every link into Help was this shape until 2026-10-07. */
      if (view.kind === "contents") {
        navigate(helpHref(anchor), { replace: true });
        return;
      }
      /* A fragment means something only on the questions' page, and only a
         question's. */
      if (view.kind !== "questions" || !isFaqId(anchor)) return;
      let tries = 0;
      const land = () => {
        const el = document.getElementById(anchor);
        if (el) {
          cancelScroll = scrollToAndFlash(el);
          return;
        }
        tries += 1;
        if (tries < MAX_WAIT_FRAMES) frame = requestAnimationFrame(land);
      };
      land();
    }
    arriveRef.current = arrive;
    arrive();
    /* Back and Forward between two questions, and a fragment typed into the
       address bar: neither changes the route, so neither re-runs this. */
    window.addEventListener("hashchange", arrive);
    return () => {
      window.removeEventListener("hashchange", arrive);
      cancelScroll?.();
      stopWaiting();
      arriveRef.current = () => {};
    };
  }, [view]);

  /**
   * **Go to an anchor from inside Help**: a search result taken with Enter, or
   * a link `onClickCapture` kept from the router. Everywhere but one case it
   * is `navigate`. The case is a question from the questions' page: the
   * address gains its fragment without the page being sent to the top, and
   * `arrive` scrolls once. The same question again pushes nothing and still
   * flashes, which is the acknowledgement a click on the place you are
   * already at would otherwise lack.
   */
  const go = (anchor: HelpAnchor) => {
    if (shown.kind !== "questions" || !isFaqId(anchor)) {
      navigate(helpHref(anchor));
      return;
    }
    const hash = `#${anchor}`;
    if (window.location.hash !== hash) {
      history.pushState(history.state, "", `${location.pathname}${location.search}${hash}`);
    }
    arriveRef.current();
  };

  /** See the header, § Arriving, third point. Every other link is the router's. */
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (shown.kind !== "questions" || !isPlainClick(e)) return;
    const href = (e.target as Element).closest?.("a[href]")?.getAttribute("href") ?? "";
    const prefix = `${HELP_QUESTIONS_HREF}#`;
    if (!href.startsWith(prefix)) return;
    const anchor = resolveHelpAnchor(href.slice(prefix.length));
    if (anchor === null || !isFaqId(anchor)) return;
    e.preventDefault();
    go(anchor);
  };

  const search = (
    <SearchBox
      query={query}
      onQuery={setQuery}
      results={results}
      onEnter={(anchor) => {
        setQuery("");
        go(anchor);
      }}
    />
  );
  /* Taking a result clears the box, so what comes back is the contents with
     the new page marked in it, and on a phone the page is not left under a
     list of matches. */
  const found = results === null ? null : <Results results={results} onTake={() => setQuery("")} />;
  /* *Ask about Spideryarn*: held here, so the answer survives a move from the
     contents page, where the box is under the search, to a page, where it is
     in the column (HelpAsk.tsx § `useHelpAsk`). Plan 261007k, F10. */
  const askState = useHelpAsk();

  return (
    /* The corner logo signed in, `SiteNav` signed out — DocumentPage.tsx,
       which also says why the sticky bar clears the contents column and the
       section anchors below. */
    <DocumentPage
      here="help"
      floor
      onClickCapture={onClickCapture}
      className="tw:mx-auto tw:flex tw:max-w-5xl tw:flex-col tw:px-6 tw:font-sans"
    >
      {shown.kind === "contents" || shown.kind === "missing" ? (
        <div className="tw:max-w-2xl">
          {shown.kind === "missing" && (
            <p
              role="alert"
              className="tw:mt-0 tw:mb-6 tw:rounded-md tw:border tw:border-rule tw:px-3 tw:py-2 tw:text-sm tw:leading-relaxed tw:text-foreground"
            >
              There is no Help page at this address. Every page Help has is listed below.
            </p>
          )}
          <h1 className={H1_CLASS}>Help</h1>
          <p className="tw:mt-2 tw:mb-6 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
            How to get the most out of Spideryarn, and how to read what it shows you. For what it does
            and why, see <Link href={FEATURES_HREF} className={HELP_LINK_CLASS}>Features</Link>.
          </p>
          {search}
          {found}
          <HelpAsk state={askState} className="tw:mt-6" />
          {found === null && <ContentsPage />}
        </div>
      ) : (
        <>
          <Crumb shown={shown} />
          <div className="tw:mt-6 tw:grid tw:grid-cols-1 tw:gap-8 tw:lg:grid-cols-[15rem_minmax(0,1fr)]">
            <HelpSidebar current={shown} box={search} found={found} ask={<HelpAsk state={askState} className="tw:mt-5" />} />
            {shown.kind === "questions" ? <QuestionsView /> : <PageView anchor={shown.anchor} />}
          </div>
        </>
      )}

      <div className="tw:flex-1" />
      <SiteFooter />
    </DocumentPage>
  );
}

const H1_CLASS = "tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground";

/**
 * **How a page's words are styled**: plain elements — p, ul, strong, kbd,
 * code, table — styled here once rather than by a class on each, since they
 * come out of Markdown with none (help-markdown.tsx § What a file may contain).
 */
const WORDS_CLASS =
  "tw:flex tw:flex-col tw:gap-3 tw:text-sm tw:leading-relaxed tw:text-muted-foreground tw:[&_p]:m-0 tw:[&_ul]:m-0 tw:[&_ul]:pl-5 tw:[&_li]:mt-1 tw:[&_li:first-child]:mt-0 tw:[&_strong]:font-semibold tw:[&_strong]:text-foreground tw:[&_kbd]:rounded tw:[&_kbd]:border tw:[&_kbd]:border-rule tw:[&_kbd]:px-1 tw:[&_kbd]:font-sans tw:[&_kbd]:text-xs tw:[&_kbd]:text-foreground tw:[&_code]:font-mono tw:[&_code]:text-xs tw:[&_code]:break-all";

/** The small tag beside an experimental mode's name. */
const TAG_CLASS =
  "tw:rounded tw:border tw:border-rule tw:px-1.5 tw:py-px tw:font-sans tw:text-[0.6875rem] tw:font-medium tw:text-ink-faint tw:no-underline";

/**
 * **The way back to the contents**, and which part of Help this page is in:
 * "Help › Reading an article". On every page but the contents itself.
 */
function Crumb({ shown }: { shown: Extract<Shown, { kind: "page" | "questions" }> }) {
  const group = shown.kind === "questions" ? null : helpPlace(shown.anchor).group;
  return (
    <nav aria-label="Breadcrumb" className="tw:text-sm tw:text-muted-foreground">
      <Link href={HELP_HREF} className={HELP_LINK_CLASS}>
        Help
      </Link>
      {group !== null && (
        <>
          <span aria-hidden="true" className="tw:mx-1.5 tw:text-ink-faint">
            ›
          </span>
          {group.title}
        </>
      )}
    </nav>
  );
}

/**
 * One page: its title, its words, what to read beside it, and the pages
 * either side of it in its group.
 */
function PageView({ anchor }: { anchor: HelpPageAnchor }) {
  const e = helpEntry(anchor);
  const body = useMemo(() => helpBody(anchor), [anchor]);
  const { previous, next } = helpPlace(anchor);
  return (
    <article className="tw:min-w-0 tw:max-w-2xl">
      <h1 className={`${H1_CLASS} tw:mb-4 tw:flex tw:flex-wrap tw:items-baseline tw:gap-2`}>
        <span>{e.title}</span>
        {/* A link to the page that says how to turn it on, so no mode's page
            has to repeat that itself. */}
        {e.experimental && (
          <Link href={helpHref("experimental-features")} className={`${TAG_CLASS} tw:hover:text-highlight-text`}>
            Experimental
          </Link>
        )}
      </h1>
      <div className={WORDS_CLASS}>{body}</div>
      <SeeAlso related={e.related} />
      {(previous !== null || next !== null) && (
        <nav
          aria-label="Previous and next page"
          className="tw:mt-8 tw:flex tw:justify-between tw:gap-4 tw:border-t tw:border-rule tw:pt-4 tw:text-sm"
        >
          {/* An empty span holds the other's side when there is only one. */}
          {previous === null ? (
            <span />
          ) : (
            <Link href={helpHref(previous)} rel="prev" className={HELP_LINK_CLASS}>
              ← {helpEntry(previous).title}
            </Link>
          )}
          {next === null ? (
            <span />
          ) : (
            <Link href={helpHref(next)} rel="next" className={`${HELP_LINK_CLASS} tw:text-right`}>
              {helpEntry(next).title} →
            </Link>
          )}
        </nav>
      )}
    </article>
  );
}

/** *See also*: the pages a file's `related` names. Nothing for none. */
function SeeAlso({ related }: { related: readonly HelpAnchor[] }) {
  if (related.length === 0) return null;
  return (
    <div className={`${WORDS_CLASS} tw:mt-8`}>
      <HelpSub>See also</HelpSub>
      <ul>
        {related.map((a) => (
          <li key={a}>
            <PageLink href={helpHref(a)}>{helpEntry(a).title}</PageLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * **The questions, together**: each a section under its own `faq-…` id, with a
 * `#` beside its heading.
 *
 * `scroll-mt` so the heading lands below the corner logo (signed in) or the
 * site bar (signed out) rather than under it. `DocumentPage` adds the safe
 * top inset to this clearance signed out, as on Privacy's sections.
 * `data-section` is the attribute the Metadata page's sections carry, kept
 * for the same reader: anything that walks a page's sections.
 */
function QuestionsView() {
  return (
    <article className="tw:min-w-0 tw:max-w-2xl">
      <h1 className={H1_CLASS}>{HELP_QUESTIONS_GROUP.title}</h1>
      {HELP_QUESTIONS_GROUP.anchors.map((a) => (
        <Question key={a} anchor={a} />
      ))}
    </article>
  );
}

function Question({ anchor }: { anchor: HelpAnchor }) {
  const e = helpEntry(anchor);
  const body = useMemo(() => helpBody(anchor), [anchor]);
  return (
    <section id={anchor} data-section className="tw:group tw:mt-7 tw:scroll-mt-20">
      <h2 className="tw:m-0 tw:mb-2 tw:flex tw:items-baseline tw:gap-2 tw:font-prose tw:text-lg tw:leading-snug tw:text-foreground">
        <span>{e.title}</span>
        {/* **Shown on hover or focus, and always on a touch screen**, where
            there is no hover to reveal it — the same pair of variants
            TitleEditor.tsx uses. Copying a link to one question is the point
            of it (Greg: "lots of anchor links"), so the href is the whole
            address; the press itself is `onClickCapture`'s. */}
        <a
          href={helpHref(anchor)}
          aria-label={`Link to ${e.title}`}
          className="tw:font-sans tw:text-base tw:text-ink-faint tw:no-underline tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:hover:text-highlight-text tw:hover-none:opacity-100 tw:any-pointer-coarse:opacity-100"
        >
          #
        </a>
      </h2>
      <div className={WORDS_CLASS}>{body}</div>
      <SeeAlso related={e.related} />
    </section>
  );
}

/**
 * **The contents page's list**: every group, and under it each page's title
 * and its one line. A question has no line of its own: it is one.
 */
function ContentsPage() {
  return (
    <nav aria-label="Help contents" className="tw:mt-8">
      {HELP_GROUPS.map((group) => (
        <section key={group.id} className="tw:mb-10">
          <h2 className="tw:m-0 tw:mb-3 tw:border-b tw:border-rule tw:pb-2 tw:font-prose tw:text-xl tw:leading-snug tw:text-foreground">
            {group.together ? (
              <Link href={HELP_QUESTIONS_HREF} className="tw:text-inherit tw:no-underline tw:hover:underline">
                {group.title}
              </Link>
            ) : (
              group.title
            )}
          </h2>
          <ul className="tw:m-0 tw:list-none tw:p-0">
            {group.anchors.map((a) => {
              const e = helpEntry(a);
              return (
                <li key={a} className="tw:mt-3 tw:first:mt-0">
                  <span className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-2">
                    <Link href={helpHref(a)} className={`${HELP_LINK_CLASS} tw:text-sm tw:font-medium`}>
                      {e.title}
                    </Link>
                    {e.experimental && <span className={TAG_CLASS}>Experimental</span>}
                  </span>
                  {e.summary !== null && (
                    <p className="tw:m-0 tw:mt-0.5 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">{e.summary}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/**
 * The search box, with its status line. One box for the contents page and for
 * every page's left column; what is shown under it is the caller's.
 */
function SearchBox({
  query,
  onQuery,
  results,
  onEnter,
}: {
  query: string;
  onQuery: (q: string) => void;
  /** Null while the box is empty. */
  results: readonly HelpAnchor[] | null;
  /** Enter, with the best match. */
  onEnter: (anchor: HelpAnchor) => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && query !== "") e.stopPropagation();
    /* A key an input method is using is not ours: its Enter accepts a
       candidate and its Escape dismisses the list. A `type="search"` box is
       also emptied by the browser itself on Escape (measured in Chrome,
       2026-10-07), so that default is cancelled. */
    if (isImeComposing(e)) {
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    if (e.key === "Enter" && results !== null && results[0] !== undefined) {
      e.preventDefault();
      onEnter(results[0]);
    } else if (e.key === "Escape" && query !== "") {
      /* Only when there is something to clear, as on Metadata's box
         (PageContents.tsx), so an empty box's Escape reaches whoever else
         listens — the command bar, the feedback dialog. */
      e.preventDefault();
      onQuery("");
    }
  };
  return (
    <>
      {/* `any-pointer-coarse:text-[max(1rem,16px)]` — iOS zooms the page in on
          a field under 16px, and the app-wide rule that prevents it cannot
          reach a `tw:text-*` utility (narrow-windows.md § the utilities layer
          is out of reach). A bare `text-base` is only `1rem`, which is still
          under the threshold when the reader's root type is smaller; the
          separate `leading-6` retains that utility's touch line height. This
          box was `text-sm` with nothing over it until 2026-10-07, found while
          giving PageContents.tsx's box the same. */}
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search Help"
        enterKeyHint="search"
        aria-label="Search Help"
        className="tw:box-border tw:block tw:w-full tw:rounded-md tw:border tw:border-border tw:bg-transparent tw:px-3 tw:py-1.5 tw:font-sans tw:text-sm tw:text-foreground tw:any-pointer-coarse:text-[max(1rem,16px)] tw:any-pointer-coarse:leading-6 tw:placeholder:text-ink-faint tw:focus-visible:border-highlight-text tw:focus-visible:outline-none"
      />
      {/* Mounted before the first keystroke, for PageContents.tsx's reason: a
          live region inserted with its first message is not announced
          reliably. Seen only when nothing matches; heard always.

          It used to end by pointing at the browser's Find, "which searches
          the text of every section". That was true of one long page and is
          false of fifty short ones, so the search reads the words itself now
          (page-search.ts) and the line stops there. GPT Sol, plan review of
          261007e, R4. */}
      <p
        role="status"
        aria-atomic="true"
        className={
          results !== null && results.length === 0
            ? "tw:mt-3 tw:mb-0 tw:px-2 tw:text-sm tw:leading-relaxed tw:text-muted-foreground"
            : "tw:sr-only"
        }
      >
        {results === null
          ? ""
          : results.length === 0
            ? `Nothing in Help matches “${query.trim()}”. Try other words.`
            : `${results.length} ${results.length === 1 ? "page matches" : "pages match"}.`}
      </p>
    </>
  );
}

const ROW_CLASS =
  "tw:block tw:rounded tw:px-2 tw:py-0.5 tw:text-sm tw:leading-snug tw:text-muted-foreground tw:no-underline tw:hover:bg-surface-raised tw:hover:text-foreground";
/** The row for the page that is open: `aria-current="page"`, and seen as well as said. */
const CURRENT_ROW_CLASS = `${ROW_CLASS} tw:bg-surface-raised tw:font-medium tw:text-foreground`;

/**
 * **A page's left column**: the search box, the matches if it has any, the
 * *Ask about Spideryarn* box, and the contents with this page marked.
 *
 * **The contents list is drawn twice, and only one is ever displayed**: open
 * in the sticky column at `lg`, and folded inside a `<details>` above the
 * page below it, shut by default so the first screen on a phone is the page
 * and not a list of fifty rows. A `<details>` cannot be held open by a
 * stylesheet, so one element doing both jobs would need a resize listener;
 * two lists of plain links need nothing, and the hidden one is
 * `display: none`, so a screen reader meets only one.
 */
function HelpSidebar({
  current,
  box,
  found,
  ask,
}: {
  current: Extract<Shown, { kind: "page" | "questions" }>;
  /** The search box. */
  box: ReactNode;
  /** The matches, or null while the box is empty and the contents show. */
  found: ReactNode;
  /**
   * *Ask about Spideryarn*, under the search and above the contents, where
   * the column's first screen shows it. Drawn whether or not a search is
   * open, so an answer arriving is not unmounted by a keystroke there.
   */
  ask: ReactNode;
}) {
  const column = useRef<HTMLElement>(null);
  const at = current.kind === "page" ? current.anchor : null;
  /* **Bring this page's row into the column's own view on arriving.** The list
     is longer than the column is tall, and a mode's row is below its fold.
     Only when the row is out of sight, so a reader working down the list by
     clicking does not have it move under the pointer. Below `lg` the open
     list is not displayed, the row has no box, and this does nothing. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `at` is the signal; the row is found in the DOM it just changed.
  useEffect(() => {
    const scroller = column.current;
    const row = scroller?.querySelector<HTMLElement>('nav [aria-current="page"]');
    if (!scroller || !row || row.offsetParent === null) return;
    const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (top < 0 || top > scroller.clientHeight - row.offsetHeight) {
      scroller.scrollTop += top - scroller.clientHeight / 2;
    }
  }, [at]);
  return (
    <aside
      ref={column}
      className="tw:lg:sticky tw:lg:top-[calc(3.5rem_+_var(--safe-top))] tw:lg:max-h-[calc(100dvh_-_4.5rem_-_var(--safe-top))] tw:lg:self-start tw:lg:overflow-y-auto"
    >
      {box}
      {found}
      {ask}
      {found === null && (
        <>
          <details className="tw:mt-3 tw:lg:hidden">
            <summary className="tw:cursor-pointer tw:text-sm tw:text-muted-foreground">Contents</summary>
            <ContentsList current={current} />
          </details>
          <nav aria-label="Help contents" className="tw:mt-4 tw:hidden tw:lg:block">
            <ContentsList current={current} />
          </nav>
        </>
      )}
    </aside>
  );
}

function ContentsList({ current }: { current: Extract<Shown, { kind: "page" | "questions" }> }) {
  const heading = "tw:m-0 tw:mb-1 tw:px-2 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase";
  return (
    <div className="tw:mt-2">
      {HELP_GROUPS.map((group) => (
        <div key={group.id} className="tw:mb-3">
          {/* The questions' heading is the link to their page, and is what is
              marked when that page is open: no one question is "the page". */}
          {group.together ? (
            <p className={heading}>
              <Link
                href={HELP_QUESTIONS_HREF}
                aria-current={current.kind === "questions" ? "page" : undefined}
                className="tw:text-inherit tw:no-underline tw:hover:text-foreground tw:aria-[current=page]:text-foreground"
              >
                {group.title}
              </Link>
            </p>
          ) : (
            <p className={heading}>{group.title}</p>
          )}
          <ul className="tw:m-0 tw:list-none tw:p-0">
            {group.anchors.map((a) => {
              const isCurrent = current.kind === "page" && current.anchor === a;
              return (
                <li key={a}>
                  <Link
                    href={helpHref(a)}
                    aria-current={isCurrent ? "page" : undefined}
                    className={isCurrent ? CURRENT_ROW_CLASS : ROW_CLASS}
                  >
                    {helpEntry(a).title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The matches, best first — or nothing, and the status line above says so. */
function Results({ results, onTake }: { results: readonly HelpAnchor[]; onTake: () => void }) {
  if (results.length === 0) return null;
  return (
    <ul aria-label="Search results" className="tw:m-0 tw:mt-3 tw:list-none tw:p-0">
      {results.map((a) => (
        <li key={a}>
          <Link
            href={helpHref(a)}
            className={ROW_CLASS}
            onClick={(e) => {
              /* Not on a ⌘-click: that opens a tab, and the list should still
                 be here for the next one. */
              if (isPlainClick(e)) onTake();
            }}
          >
            {helpEntry(a).title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
