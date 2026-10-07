/**
 * `/help` — how to use Spideryarn, section by section, with a contents list,
 * a search box, and a link to every section.
 *
 * Greg, SPIDERYARN-READING2-85, 2026-10-01:
 *
 * > Provide a Help or FAQ page for users that want to understand all of
 * > Spideryarn's features. Make sure it has a nice table of contents and search
 * > bar, and lots of anchor links (so we can link directly to places). And
 * > include it in footer.
 *
 * The words are in help-content.tsx and the anchors in help-anchors.ts; this
 * file is only the page that draws them. docs/plans/261002b-help-page.md, whose
 * last section (GPT Sol's plan review) is what shaped the three decisions below.
 *
 * ## Its own contents list, not `PageContents`
 *
 * `PageContents` (Metadata) is a flat list scanned off the DOM, sized for that
 * page's margin and hidden entirely below `lg`, search box included. Help's is
 * drawn from the typed group list: grouped, sticky in a left column at `lg`,
 * and above the sections on a narrow screen, where the search box stays in
 * view and the list folds shut. Only the search itself, `searchSections`, is
 * shared, with Help's own synonym table. R1.
 *
 * ## One owner for fragments
 *
 * Every link to a place on this page — a contents row, a search result, a
 * heading's `#`, a cross-reference inside a section — is a plain
 * `<a href="#id">`, so reload and modified clicks retain the browser's link
 * semantics. For an ordinary same-tab click, the page prevents the browser's
 * own fragment scroll, pushes the address itself, then calls `arrive`; otherwise
 * the native jump and `arrive`'s smooth scroll would both move the page. Mount
 * and Back/Forward arrive through the effect and `hashchange`. In every path,
 * `arrive` below is the one thing that scrolls and flashes. R3.
 *
 * The router does not get in the way: `useRoute` subscribes to the *pathname*
 * (router.ts § useRoute), so a fragment change re-renders nothing, and only
 * `navigate()` scrolls to the top — which a fragment link never calls.
 *
 * ## Arriving needs us, not just the browser
 *
 * The page is lazily loaded (App.tsx § loadHelp), so on a direct load of
 * `/help#spine` the browser looks for `#spine` before the section exists and
 * gives up. And an old anchor (`#mode-trajectory`) names no element at all —
 * `resolveHelpAnchor` turns it into its successor, and the address is
 * corrected to match so a copy of it is the live one.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { MODE_CATALOG } from "../../mode-catalog.js";
import type { Mode } from "../../modes.js";
import { MODE_LABEL } from "../../title-text.js";
import { DocumentPage } from "../DocumentPage.js";
import { scrollToAndFlash } from "../flash.js";
import { isImeComposing } from "../key-chord.js";
import { Link } from "../Link.js";
import { pageTitle, useDocumentTitle } from "../page-title.js";
import { searchSections, type SearchableSection } from "../page-search.js";
import { FEATURES_HREF } from "../router.js";
import { SiteFooter } from "../SiteFooter.js";
import { HELP_ANCHORS, resolveHelpAnchor, type HelpAnchor } from "./help-anchors.js";
import {
  HELP_FAQ,
  HELP_GROUPS,
  HELP_LINK_CLASS,
  HELP_MODES,
  HELP_SYNONYMS,
  HELP_TOPICS,
  type HelpSection,
} from "./help-content.js";

/**
 * **One section as the page draws and searches it**, whichever table it came
 * from. A mode's title and lede come from the catalog (help-content.tsx says
 * why); a topic's or a question's are its own.
 */
interface Entry {
  anchor: HelpAnchor;
  title: string;
  /** What the search box reads besides the title. */
  search: { keywords: string; aside: string };
  experimental: boolean;
  body: ReactNode;
}

function topicOrFaq(anchor: HelpAnchor): HelpSection | null {
  if (Object.hasOwn(HELP_TOPICS, anchor)) return HELP_TOPICS[anchor as keyof typeof HELP_TOPICS];
  if (Object.hasOwn(HELP_FAQ, anchor)) return HELP_FAQ[anchor as keyof typeof HELP_FAQ];
  return null;
}

/** A small subheading inside a mode's section. */
function Sub({ children }: { children: ReactNode }) {
  return <h4 className="tw:m-0 tw:mt-1 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">{children}</h4>;
}

function modeEntry(anchor: HelpAnchor, mode: Mode): Entry {
  const catalog = MODE_CATALOG[mode];
  const extra = HELP_MODES[mode];
  return {
    anchor,
    title: MODE_LABEL[mode],
    search: {
      /* The mode's id as well as its label: they differ for none today, but a
         renamed mode keeps its id in old links and in a reader's memory. */
      keywords: [extra.keywords, ...catalog.aliases, mode].join(" "),
      aside: catalog.description,
    },
    experimental: catalog.experimental,
    body: (
      <>
        {/* The band's own (i) card, word for word — BandAbout.tsx § AboutMode. */}
        <p className="tw:text-foreground">{catalog.description}.</p>
        <p>{catalog.how}</p>
        {extra.whenToUse !== null && (
          <>
            <Sub>When to use it</Sub>
            {extra.whenToUse}
          </>
        )}
        {extra.reading !== null && (
          <>
            <Sub>Reading it</Sub>
            {extra.reading}
          </>
        )}
      </>
    ),
  };
}

function entryFor(anchor: HelpAnchor): Entry {
  const own = topicOrFaq(anchor);
  if (own !== null) {
    return {
      anchor,
      title: own.title,
      search: { keywords: own.keywords, aside: "" },
      experimental: false,
      body: own.body,
    };
  }
  /* Neither a topic nor a question, so `mode-<id>` — `HelpAnchor` has no
     fourth member. */
  return modeEntry(anchor, anchor.slice("mode-".length) as Mode);
}

/** Every section, by anchor. Built once: the words are constants. */
const ENTRIES: ReadonlyMap<HelpAnchor, Entry> = new Map(HELP_ANCHORS.map((a) => [a, entryFor(a)]));

function entry(anchor: HelpAnchor): Entry {
  const found = ENTRIES.get(anchor);
  /* Unreachable while `HELP_ANCHORS` and the groups agree, which
     tests/help-page.test.tsx holds; a throw here is louder than a blank. */
  if (!found) throw new Error(`No Help section for ${anchor}`);
  return found;
}

/** The groups the page draws — a group with nothing in it yet is left out. */
const DRAWN_GROUPS = HELP_GROUPS.filter((g) => g.anchors.length > 0);

/** What the search box searches, in page order so ties keep it. */
const SEARCHABLE: readonly SearchableSection[] = DRAWN_GROUPS.flatMap((g) =>
  g.anchors.map((a) => {
    const e = entry(a);
    return { id: a, label: e.title, keywords: e.search.keywords, aside: e.search.aside };
  }),
);

/**
 * **How many frames to wait for a section to exist** before giving up on a
 * fragment. The sections render with the page, so in practice the first look
 * finds it; this is for a slow first paint, and a cap so a bad fragment does
 * not poll for ever.
 */
const MAX_WAIT_FRAMES = 30;

export function HelpPage() {
  useDocumentTitle(pageTitle({ kind: "help" }));
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => (query.trim() === "" ? null : (searchSections(query, SEARCHABLE, HELP_SYNONYMS) as HelpAnchor[])),
    [query],
  );
  /** `arrive`, kept where a click handler can reach it. Set by the effect. */
  const arriveRef = useRef<() => void>(() => {});

  /* **Arrival: the one place this page scrolls.** See the header, § One owner
     for fragments. */
  useEffect(() => {
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
      const asked = window.location.hash;
      if (asked === "" || asked === "#") return;
      const anchor = resolveHelpAnchor(asked);
      if (anchor === null) return;
      /* An old anchor: put the live one in the address, so a link copied from
         here is the one that will keep working. A replace, not a push — the
         reader asked for one place, and Back should not visit its old name. */
      if (asked !== `#${anchor}`) {
        history.replaceState(history.state, "", `${location.pathname}${location.search}#${anchor}`);
      }
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
    window.addEventListener("hashchange", arrive);
    return () => {
      window.removeEventListener("hashchange", arrive);
      cancelScroll?.();
      stopWaiting();
      arriveRef.current = () => {};
    };
  }, []);

  /** Change the address without a native fragment scroll, then arrive once. */
  const go = (anchor: HelpAnchor) => {
    const hash = `#${anchor}`;
    if (window.location.hash !== hash) {
      history.pushState(history.state, "", `${location.pathname}${location.search}${hash}`);
    }
    arriveRef.current();
  };

  /**
   * **One owner for an ordinary fragment click.** Keep the real href for
   * copy/open-in-new-tab, but stop the browser's own fragment scroll in the
   * same tab. `pushState` supplies the history entry without scrolling, then
   * `go` arrives exactly once. The same-hash case gets no new history entry but
   * does flash again, which is the visible acknowledgement a native same-hash
   * click would otherwise lack.
   */
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.("a[href^='#']");
    const anchor = resolveHelpAnchor(a?.getAttribute("href") ?? "");
    if (anchor === null) return;
    e.preventDefault();
    go(anchor);
  };

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
      <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">Help</h1>
      <p className="tw:mt-2 tw:mb-0 tw:max-w-2xl tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
        How to get the most out of Spideryarn, and how to read what it shows you. For what it does
        and why, see <Link href={FEATURES_HREF} className={HELP_LINK_CLASS}>Features</Link>.
      </p>

      <div className="tw:mt-8 tw:grid tw:grid-cols-1 tw:gap-8 tw:lg:grid-cols-[15rem_minmax(0,1fr)]">
        <HelpContents query={query} onQuery={setQuery} results={results} onGo={go} />
        <div className="tw:min-w-0 tw:max-w-2xl">
          {DRAWN_GROUPS.map((group) => (
            <div key={group.id} className="tw:mb-10">
              <h2 className="tw:m-0 tw:mb-1 tw:border-b tw:border-rule tw:pb-2 tw:font-prose tw:text-xl tw:leading-snug tw:text-foreground">
                {group.title}
              </h2>
              {group.anchors.map((a) => (
                <HelpSectionView key={a} entry={entry(a)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="tw:flex-1" />
      <SiteFooter />
    </DocumentPage>
  );
}

/**
 * One section: its heading with a `#` beside it, and its words.
 *
 * `scroll-mt` so the heading lands below the corner logo (signed in) or the
 * site bar (signed out) rather than under it. `DocumentPage` adds the safe
 * top inset to this clearance signed out, as on Privacy's sections.
 * `data-section` is the attribute the Metadata page's sections carry, kept
 * for the same reader: anything that walks a page's sections.
 */
function HelpSectionView({ entry: e }: { entry: Entry }) {
  return (
    <section id={e.anchor} data-section className="tw:group tw:mt-7 tw:scroll-mt-20">
      <h3 className="tw:m-0 tw:mb-2 tw:flex tw:items-baseline tw:gap-2 tw:font-prose tw:text-lg tw:leading-snug tw:text-foreground">
        <span>{e.title}</span>
        {/* A link to the section that says how to turn it on, so no mode's
            section has to repeat that itself. */}
        {e.experimental && (
          <a
            href="#experimental-features"
            className="tw:rounded tw:border tw:border-rule tw:px-1.5 tw:py-px tw:font-sans tw:text-[0.6875rem] tw:font-medium tw:text-ink-faint tw:no-underline tw:hover:text-highlight-text"
          >
            Experimental
          </a>
        )}
        {/* **Shown on hover or focus, and always on a touch screen**, where
            there is no hover to reveal it — the same pair of variants
            TitleEditor.tsx uses. Copying a link to any place on this page is
            the point of it (Greg: "lots of anchor links"). */}
        <a
          href={`#${e.anchor}`}
          aria-label={`Link to ${e.title}`}
          className="tw:font-sans tw:text-base tw:text-ink-faint tw:no-underline tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:hover:text-highlight-text tw:hover-none:opacity-100 tw:any-pointer-coarse:opacity-100"
        >
          #
        </a>
      </h3>
      {/* The sections' words are plain elements — p, ul, strong, kbd, code,
          table — styled here once rather than by a class on each. */}
      <div className="tw:flex tw:flex-col tw:gap-3 tw:text-sm tw:leading-relaxed tw:text-muted-foreground tw:[&_p]:m-0 tw:[&_ul]:m-0 tw:[&_ul]:pl-5 tw:[&_li]:mt-1 tw:[&_li:first-child]:mt-0 tw:[&_strong]:font-semibold tw:[&_strong]:text-foreground tw:[&_kbd]:rounded tw:[&_kbd]:border tw:[&_kbd]:border-rule tw:[&_kbd]:px-1 tw:[&_kbd]:font-sans tw:[&_kbd]:text-xs tw:[&_kbd]:text-foreground tw:[&_code]:font-mono tw:[&_code]:text-xs tw:[&_code]:break-all">
        {e.body}
      </div>
    </section>
  );
}

/**
 * The search box, and under it either the contents or the matches.
 *
 * **The contents list is drawn twice, and only one is ever displayed**: open
 * in the sticky column at `lg`, and folded inside a `<details>` above the
 * sections below it, shut by default so the first screen on a phone is the
 * page and not a list of thirty rows. A `<details>` cannot be held open by a
 * stylesheet, so one element doing both jobs would need a resize listener;
 * two lists of plain links need nothing, and the hidden one is
 * `display: none`, so a screen reader meets only one.
 */
function HelpContents({
  query,
  onQuery,
  results,
  onGo,
}: {
  query: string;
  onQuery: (q: string) => void;
  /** Null while the box is empty — the contents show instead. */
  results: readonly HelpAnchor[] | null;
  onGo: (anchor: HelpAnchor) => void;
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
      onGo(results[0]);
    } else if (e.key === "Escape" && query !== "") {
      /* Only when there is something to clear, as on Metadata's box
         (PageContents.tsx), so an empty box's Escape reaches whoever else
         listens — the command bar, the feedback dialog. */
      e.preventDefault();
      onQuery("");
    }
  };
  return (
    <aside className="tw:lg:sticky tw:lg:top-[calc(3.5rem_+_var(--safe-top))] tw:lg:max-h-[calc(100dvh_-_4.5rem_-_var(--safe-top))] tw:lg:self-start tw:lg:overflow-y-auto">
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
          reliably. Seen only when nothing matches; heard always. */}
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
            ? `Nothing in Help matches “${query.trim()}”. Try other words, or your browser’s Find (Ctrl-F, or ⌘-F on a Mac), which searches the text of every section.`
            : `${results.length} ${results.length === 1 ? "section matches" : "sections match"}.`}
      </p>
      {results !== null ? (
        <Results results={results} />
      ) : (
        <>
          <details className="tw:mt-3 tw:lg:hidden">
            <summary className="tw:cursor-pointer tw:text-sm tw:text-muted-foreground">Contents</summary>
            <ContentsList />
          </details>
          <nav aria-label="Help contents" className="tw:mt-4 tw:hidden tw:lg:block">
            <ContentsList />
          </nav>
        </>
      )}
    </aside>
  );
}

const ROW_CLASS =
  "tw:block tw:rounded tw:px-2 tw:py-0.5 tw:text-sm tw:leading-snug tw:text-muted-foreground tw:no-underline tw:hover:bg-surface-raised tw:hover:text-foreground";

function ContentsList() {
  return (
    <div className="tw:mt-2">
      {DRAWN_GROUPS.map((group) => (
        <div key={group.id} className="tw:mb-3">
          <p className="tw:m-0 tw:mb-1 tw:px-2 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
            {group.title}
          </p>
          <ul className="tw:m-0 tw:list-none tw:p-0">
            {group.anchors.map((a) => (
              <li key={a}>
                <a href={`#${a}`} className={ROW_CLASS}>
                  {entry(a).title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The matches, best first — or nothing, and the status line above says so. */
function Results({ results }: { results: readonly HelpAnchor[] }) {
  if (results.length === 0) return null;
  return (
    <ul aria-label="Matching sections" className="tw:m-0 tw:mt-3 tw:list-none tw:p-0">
      {results.map((a) => (
        <li key={a}>
          <a href={`#${a}`} className={ROW_CLASS}>
            {entry(a).title}
          </a>
        </li>
      ))}
    </ul>
  );
}
