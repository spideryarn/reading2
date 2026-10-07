/**
 * A contents list for a long page of sections, in the margin beside it.
 *
 * Greg, 2026-09-03, on the Metadata page:
 *
 * > Provide a contents page for the various sections (ideally in a side-tab)
 *
 * ## It reads the page rather than being told about it
 *
 * The obvious build is a `SECTIONS` array beside the page's markup — one entry
 * per section, in the same order. That is the near-miss pair this repo keeps
 * walking into: two lists of one fact, nothing keeping them in step, and it
 * fails *quietly* — a section renamed in the markup keeps its old name in the
 * contents, and a section added is simply missing from it. Worse here than
 * usual, because half of Metadata's sections are conditional (no "How well we
 * read the PDF" for a web page, no sharing switch on the fixture, no "In one
 * sentence" before the arc has run), so the array would need every one of
 * those conditions written out a second time.
 *
 * So this scans the DOM for `[data-section]` instead. What is on the page is
 * the only list there is, and it cannot disagree with itself. The cost is a
 * `MutationObserver`, because those conditions resolve after the metadata
 * request lands — the first paint has fewer sections than the second.
 *
 * ## Which one you are in is a scroll handler, not an IntersectionObserver
 *
 * An observer tells you what is *visible*, and three sections are visible at
 * once on a tall window — turning that into a single "you are here" needs
 * ratio thresholds and tie-breaks, and it still gets the bottom of the page
 * wrong, because the last section is short and never wins. "The last heading
 * that has gone past the top" is one comparison, it is what a reader means by
 * the question, and it is stable. Measured inside `requestAnimationFrame` so
 * the scroll handler itself never touches layout.
 *
 * ## A click opens, scrolls and flashes; and a search box finds the section
 *
 * Greg, 2026-10-01 (SPIDERYARN-READING2-7Y, then -83):
 *
 * > If I click on the Table of Contents in the left-hand of the Metadata page,
 * > expand that section (if needed) and flash to show where it is in the page.
 *
 * > Add a Search box (above the left-hand table-of-contents) … and then should
 * > scroll to the right place, expand the section, flash it, etc (reusing
 * > machinery).
 *
 * Both go through one verb, `reveal`: tell the section to open
 * (`SECTION_REVEAL`, which PageSection.tsx § Section listens for), scroll to it,
 * and flash it once the scroll has stopped (flash.ts § scrollToAndFlash, the
 * reading view's flash). The search itself is page-search.ts, which reads the
 * same `[data-section]` elements this list does, plus their `data-keywords`.
 * docs/plans/261001s-metadata-contents-opens-and-flashes-its-section-and-a-search-box-above-it.md.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { scrollToAndFlash } from "./flash.js";
import { isImeComposing } from "./key-chord.js";
import { searchSections, type SearchableSection, type SynonymTable } from "./page-search.js";

/**
 * The event a section listens for to open itself — sent to the `[data-section]`
 * element by `reveal`. A DOM event rather than lifted state, because lifting it
 * would need the list of sections this component reads off the page instead.
 */
export const SECTION_REVEAL = "section-reveal";

/**
 * **The section with this id, inside `root` and nowhere else.** Two of these
 * pages mounted at once (tests do) share section ids, because they are derived
 * from labels. Not `root.querySelector("#id")`: jsdom answers an id selector
 * from the document's id table — the *first* element with that id — and then
 * checks it is inside `root`, so the second page's lookup came back empty. A
 * browser does not do that, but the test that pins this property runs in
 * jsdom, and walking the `[data-section]` elements is right in both.
 */
function sectionIn(root: HTMLElement | null, id: string): HTMLElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLElement>("[data-section]")) {
    if (el.id === id) return el;
  }
  return null;
}

/**
 * Open the section, scroll to it, put focus on its heading, flash it. Resolved
 * inside `root`, for the duplicate-ids reason the click handler below gives.
 */
function reveal(root: HTMLElement | null, id: string): (() => void) | null {
  const el = sectionIn(root, id);
  if (!el) return null;
  /* The section commits its open state synchronously on this event
     (PageSection.tsx § Section, `flushSync`), so its body is in the DOM before the
     scroll is asked for — near the foot of the page a shut section may not
     leave the scroll range to bring its heading up. Sol, plan review. */
  el.dispatchEvent(new CustomEvent(SECTION_REVEAL));
  const cancel = scrollToAndFlash(el);
  /* **Focus follows the eye**: the heading, which every section makes
     focusable from a script, without a second scroll. Otherwise a keyboard or
     screen-reader user is left in the margin while the page has moved. */
  el.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  return cancel;
}

/**
 * **Reveal the section an address names, once it exists** — `?section=` on
 * the Metadata page (params.ts § `sectionParam`), which the command bar's *Run
 * again* rows write (docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md).
 * The same `reveal` the contents list uses, so arriving by a link opens,
 * scrolls, focuses and flashes exactly as a click there does.
 *
 * **`onRevealed` is called only once `reveal` has found the section**, and is
 * where the caller takes the parameter off the address. That order is GPT
 * Sol's F4 on the plan: a page whose sections arrive with a request reveals
 * nothing on first render, and a parameter consumed then would be a press that
 * silently did nothing. So it is tried once the page has committed, and again
 * on every change under `containerRef` (a `MutationObserver`, the mechanism
 * the contents list itself uses to notice sections arriving) until it finds
 * one. Accepted ids are a closed list whose members are checked against the
 * page's real sections, so a timer that gives up would turn a slow mount into a
 * successful navigation that never visibly arrives. The observer is stopped
 * on success, id change or unmount.
 *
 * **Tried from a timer and from the observer, never inside the effect.** The
 * section opens itself with `flushSync` (PageSection.tsx § Section), and React
 * will not flush from inside its own effect pass.
 *
 * A reveal already under way is left to finish when the id goes to `null` —
 * which is what taking the parameter off does, a moment after it started — and
 * cancelled only on unmount.
 */
export function useRevealOnArrival(
  containerRef: RefObject<HTMLElement | null>,
  id: string | null,
  onRevealed: () => void,
): void {
  const reported = useRef(onRevealed);
  reported.current = onRevealed;
  const underway = useRef<(() => void) | null>(null);
  useEffect(() => () => underway.current?.(), []);
  useEffect(() => {
    if (id === null) return;
    let finished = false;
    let observer: MutationObserver | null = null;
    let first: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      finished = true;
      observer?.disconnect();
      clearTimeout(first);
    };
    const attempt = () => {
      if (finished) return;
      const cancel = reveal(containerRef.current, id);
      if (cancel === null) return;
      stop();
      underway.current?.();
      underway.current = cancel;
      reported.current();
    };
    first = setTimeout(attempt, 0);
    const root = containerRef.current;
    if (root && typeof MutationObserver === "function") {
      observer = new MutationObserver(attempt);
      observer.observe(root, { childList: true, subtree: true });
    }
    return stop;
  }, [containerRef, id]);
}

/** Whether a mutation can change the labels, keywords or asides in the index. */
function changesIndex(record: MutationRecord): boolean {
  if (record.type === "attributes") return true;
  const parent = record.target instanceof Element ? record.target : record.target.parentElement;
  if (parent?.closest("[data-section-aside]")) return true;
  if (record.type !== "childList") return false;
  return [...record.addedNodes, ...record.removedNodes].some((node) => {
    if (!(node instanceof Element || node instanceof DocumentFragment)) return false;
    return (
      (node instanceof Element && node.matches("[data-section], [data-section-aside]")) ||
      node.querySelector("[data-section], [data-section-aside]") !== null
    );
  });
}

/**
 * One entry: the section's `id` to scroll to, the heading to print, and the two
 * other things the search box reads — its `data-keywords` and its heading's
 * one-line answer (`[data-section-aside]`). Kept here, rather than read at
 * search time, so a cost or a stage count that lands while a query is typed
 * re-ranks the results without another keystroke.
 */
type Entry = SearchableSection;

/**
 * How far below the top of the viewport a heading counts as reached.
 *
 * **A few pixels BELOW the section's own `scroll-margin-top`, not equal to
 * it.** `scrollIntoView` honours the margin, so a clicked section lands with
 * its top at *about* the margin — and "about" is the whole problem. Measured in
 * a browser on 2026-09-03, clicking an entry scrolled correctly and then left
 * the highlight on the entry above: the heading came to rest a fraction over
 * the margin, `top <= margin` was false, and the section you had just asked for
 * was the one section not counted as reached. Subpixel layout, fractional
 * device pixel ratios and smooth-scroll rounding all land on that boundary.
 * The slack costs nothing: a heading 4px above the fold is one the reader is
 * plainly in.
 *
 * **Read off the element, not written here as a number.** It was `100`, beside
 * a note that it had to stay above the `scroll-mt-24` in Metadata.tsx
 * § Section — and that class is **6rem, not 96px**. The app sets no root font
 * size, so a reader whose browser is set to large text (20px) has a 120px
 * margin, the note was false for them, and the list marked the section above
 * the one they had clicked. A computed length is always in pixels, whatever
 * unit the stylesheet used, so there is no rem to convert. Sweep item XZ-X12,
 * docs/plans/261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md § 4.
 *
 * `FALLBACK_REACHED_PX` is for a section with no margin to read: jsdom, which
 * applies no stylesheet, and a page that mounts this list without giving its
 * sections one.
 */
const REACHED_SLACK_PX = 4;
const FALLBACK_REACHED_PX = 100;

function reachedPx(section: HTMLElement): number {
  const margin = Number.parseFloat(getComputedStyle(section).scrollMarginTop);
  return Number.isFinite(margin) && margin > 0 ? margin + REACHED_SLACK_PX : FALLBACK_REACHED_PX;
}

/**
 * **The class a page's `<main>` wears to make room for this list.** The list is
 * fixed in the left margin (the `<nav>` below says why), so the page has to
 * step right where its centred margin is too narrow to hold it. A page that
 * mounts `PageContents` without this puts the list over its own text between
 * 1024px and 1152px wide. One copy, here beside the widths it answers to, so
 * Metadata and `/profile` cannot drift apart.
 *
 * It is `mx-auto`'s own left margin for a 48rem column (`max-w-3xl`, which the
 * page supplies), but never less than 12rem plus the left safe inset: the list
 * ends at 12.5rem plus that inset (it is fixed chrome, so it adds it —
 * tokens.css § safe areas), and the column's text starts 1.5rem inside it, so
 * a 1rem gap. The `max` picks the centred margin from 1152px plus twice the
 * left inset of containing-block width (a little more window width with a
 * classic scrollbar, since `100%` is the width beside it). Below that the page
 * sits right of centre — by up to 4rem when the inset is zero — so an iPad in
 * landscape gets the list. Greg, SPIDERYARN-READING2-9M, 2026-10-01: *"not
 * visible on my iPad, even in landscape mode, even though there's quite a lot
 * of space on either side."*
 * docs/plans/261002a-metadata-contents-on-an-ipad-in-landscape.md.
 */
export const CONTENTS_MARGIN =
  "tw:lg:ml-[max(calc(12rem_+_var(--safe-left)),calc((100%_-_48rem)/2))]";

export function PageContents({
  containerRef,
  label,
  synonyms,
}: {
  /** The element whose `[data-section]` descendants are the contents. */
  containerRef: RefObject<HTMLElement | null>;
  /** Names the nav for a screen reader. */
  label: string;
  /** This page's vocabulary; omitted, the search keeps Metadata's table. */
  synonyms?: SynonymTable;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [here, setHere] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /* One navigation owns one settle wait. A quick second click cancels the
     first one's timers and listener, so the old section cannot flash after the
     reader has already chosen another one. The unmount cleanup matters too:
     the ceiling otherwise leaves a window listener alive for 1.5 seconds. */
  const cancelReveal = useRef<(() => void) | null>(null);
  /** The section the reader last went to from here — `measure` at the page foot. */
  const chosen = useRef<string | null>(null);
  /** Ask for a `measure` — set by the effect that owns it, below. A reveal of a
      section already in place neither scrolls nor resizes anything. */
  const remeasure = useRef<(() => void) | null>(null);
  const revealSection = useCallback(
    (id: string) => {
      chosen.current = id;
      cancelReveal.current?.();
      cancelReveal.current = reveal(containerRef.current, id);
      remeasure.current?.();
    },
    [containerRef],
  );
  useEffect(() => () => cancelReveal.current?.(), []);

  /* Re-read the page's sections, now. Called on mount and when the observer
     sees a section, keyword or aside change. The result is only committed when
     it actually differs, so an equivalent update does not repaint the nav. */
  const rescan = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const found = Array.from(root.querySelectorAll<HTMLElement>("[data-section]")).map((el) => ({
      id: el.id,
      label: el.dataset.section ?? "",
      keywords: el.dataset.keywords ?? "",
      aside: el.querySelector("[data-section-aside]")?.textContent ?? "",
    }));
    setEntries((was) =>
      was.length === found.length &&
      was.every((e, i) => {
        const f = found[i];
        return (
          f !== undefined &&
          e.id === f.id &&
          e.label === f.label &&
          e.keywords === f.keywords &&
          e.aside === f.aside
        );
      })
        ? was
        : found,
    );
  }, [containerRef]);

  useEffect(() => {
    rescan();
    const root = containerRef.current;
    if (!root) return;
    const watch = new MutationObserver((records) => {
      if (records.some(changesIndex)) rescan();
    });
    /* `characterData` because an aside can change by its text node alone (a
       cost arriving), and the keywords attribute because a section could
       change its own. */
    watch.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-keywords", "data-section"],
    });
    return () => watch.disconnect();
  }, [containerRef, rescan]);

  /* Which section the reader is in. `frame` guards against queueing a second
     measurement while one is already pending: scroll fires far more often than
     the screen redraws, and measuring once per frame rather than once per
     event is the whole point of deferring it. */
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (entries.length === 0) return;
    const measure = () => {
      frame.current = null;
      /* **At the bottom of the document, the last entry — unconditionally.**
         The rule below cannot reach it: a short last section stops scrolling
         while its heading is still near the *bottom* of the viewport, never
         crossing the margin, so clicking "Archive this article" left "Technical
         details" marked. This component's own docstring claimed the scroll
         handler avoided the bottom-of-page problem an IntersectionObserver has;
         it had the same problem, by a different route. GPT Sol, 2026-09-03. */
      const root = containerRef.current;
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && root) {
        /* **Unless the reader has just chosen a section that is on screen.**
           Clicking *Technical details* on a page too short to bring it to the
           top lands at the bottom, and the rule above then marked *Delete
           this article* beside a flash on the section they asked for — the
           browser pass for plan 261001s. While the chosen heading is in view
           it is the honest answer; scroll it away and the rule returns. */
        const chosenTop = chosen.current
          ? sectionIn(root, chosen.current)?.getBoundingClientRect().top
          : undefined;
        if (
          chosen.current &&
          chosenTop !== undefined &&
          chosenTop >= 0 &&
          chosenTop < window.innerHeight
        ) {
          setHere(chosen.current);
          return;
        }
        setHere(entries[entries.length - 1]?.id ?? null);
        return;
      }
      let current: string | null = null;
      for (const entry of entries) {
        /* Resolved inside the container, not with `document.getElementById`.
           Two of these pages mounted at once — which tests do — share section
           labels and therefore share ids, and a document-wide lookup hands the
           second page's list the first page's sections. The scan is already
           scoped; this is the half that was not. */
        const el = sectionIn(root, entry.id);
        if (el && el.getBoundingClientRect().top <= reachedPx(el)) current = entry.id;
      }
      /* Above the first heading, the first entry is still the honest answer —
         `null` would leave the list with nothing marked for the top screenful
         of every visit, which reads as the highlight being broken. */
      setHere(current ?? entries[0]?.id ?? null);
    };
    const onScroll = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(measure);
    };
    remeasure.current = onScroll;
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    /* **Layout can change without the entry list changing**, and then nothing
       above would fire: opening a collapsed section adds content and moves
       every heading under it, but the rescan derives the same
       entries, so this effect does not re-run and no scroll happens. Watching
       the container's box catches that and anything else that reflows it —
       an image loading, the purpose box growing a line. GPT Sol, 2026-09-03.

       Guarded on the constructor existing, rather than stubbed in the test
       setup: jsdom has no `ResizeObserver`, and a global fake would be a second
       thing claiming to be a browser — the sort of stand-in that reports
       success while doing nothing (docs/reusable/silent-success.md). The
       scroll and resize listeners above are what the tests exercise; this is
       the extra trigger, and losing it under jsdom costs them nothing. */
    const root = containerRef.current;
    const resize =
      root && typeof ResizeObserver === "function" ? new ResizeObserver(onScroll) : null;
    if (root && resize) resize.observe(root);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      remeasure.current = null;
      resize?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [entries, containerRef]);

  /* **What the search box matched, best first; `null` while it is empty.**
     Recomputed when the entries change too, so a section that arrives while a
     query is typed joins the results. */
  const matches = useMemo(() => {
    if (query.trim() === "") return null;
    const ids = searchSections(query, entries, synonyms);
    return ids.flatMap((id) => entries.filter((e) => e.id === id));
  }, [query, entries, synonyms]);

  /* Nothing worth navigating. One entry is furniture rather than help, and an
     empty list is the state before the metadata request has landed. */
  if (entries.length < 2) return null;

  const shown = matches ?? entries;

  return (
    /* **Fixed, in the margin — not a column beside the content.** As a flex
       sibling it would push the prose column off centre on wide windows and
       change nothing on narrow ones, where it is hidden anyway. Fixed keeps
       the nav out of the page's layout: the page stays centred wherever its
       margin holds the list, and Metadata moves it only where that is needed.

       `lg` (1024px), the width of the smallest full-screen landscape iPad.
       The list is 11rem at 1.5rem in, plus the left safe inset (tokens.css §
       safe areas — the installed app, and a phone's notch in landscape); the
       content is `max-w-3xl` (48rem) and centred. With no left safe inset its
       margin holds the list from 1152px up; an inset raises that threshold by
       twice its width. Below it the page steps its column right just far enough
       to clear the list (`CONTENTS_MARGIN`, above) —
       so this nav assumes its page wears that, and a page that mounts it
       without it would put the list over the prose. It was `xl` until Greg,
       SPIDERYARN-READING2-9M, 2026-10-01: *"not visible on my iPad, even in
       landscape mode"*. Plan 261002a.

       **A fixed top, not vertically centred** — centred it was until the
       search box arrived (plan 261001s), and then every keystroke that
       filtered the list shrank the box and moved the input under the
       reader's cursor. 6rem down, level with the page's first sections; the
       Metadata's corner wordmark moved into the dock on 2026-09-06;
       Profile keeps its wordmark above the list.
       The list scrolls inside a column that stops short of the dock, so a
       long page's contents never run under it. Sol, plan review. */
    <nav
      aria-label={label}
      className="tw:hidden tw:lg:flex tw:lg:flex-col tw:fixed tw:left-[calc(1.5rem_+_var(--safe-left))] tw:top-[calc(6rem_+_var(--safe-top))] tw:max-h-[calc(100vh_-_6rem_-_var(--safe-top)_-_var(--dock-space)_-_1rem)] tw:z-10 tw:w-44 tw:font-sans"
    >
      {/* **Above the list, in the same column** — where Greg asked for it.
          Typing filters the list below to what matches, best first; Enter
          takes you to the first; Escape empties the box and puts the whole
          list back. `type="search"` for the platform's clear button and the
          right on-screen keyboard. */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          /* A key an input method is using is not ours: its Enter accepts a
             candidate and its Escape dismisses the list. A `type="search"`
             box is also emptied by the browser itself on Escape (measured in
             Chrome, 2026-10-07), so that default is cancelled. */
          if (isImeComposing(e)) {
            if (e.key === "Escape") e.preventDefault();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const first = matches?.[0];
            if (first) revealSection(first.id);
          } else if (e.key === "Escape" && query !== "") {
            /* Only when there is something to clear, so an Escape in an empty
               box still reaches whatever else on the page listens for it. */
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }
        }}
        placeholder="Search this page"
        enterKeyHint="search"
        aria-label="Search this page's sections"
        className="tw:mb-3 tw:block tw:w-full tw:shrink-0 tw:rounded-md tw:border tw:border-border tw:bg-transparent tw:px-2 tw:py-1 tw:font-sans tw:text-xs tw:text-foreground tw:placeholder:text-ink-faint tw:focus-visible:border-highlight-text tw:focus-visible:outline-none"
      />
      {/* Kept mounted before the first keystroke: a live region inserted with
          its first message is not announced consistently. Sighted readers only
          need the empty result; a screen reader also needs to know that a
          filtered list has, say, two choices rather than the original twelve. */}
      <p
        role="status"
        aria-atomic="true"
        className={
          matches !== null && matches.length === 0
            ? "tw:m-0 tw:pl-3 tw:text-xs tw:text-ink-faint"
            : "tw:sr-only"
        }
      >
        {matches === null
          ? ""
          : matches.length === 0
            ? "Nothing on this page matches."
            : `${matches.length} section${matches.length === 1 ? "" : "s"} match.`}
      </p>
      <ul className="tw:m-0 tw:min-h-0 tw:list-none tw:overflow-y-auto tw:p-0">
        {shown.map((entry) => (
          <li key={entry.id}>
            {/* A button, not `<a href="#id">`. This app routes its own anchors
                (Link.tsx), and a bare hash href would both go through that and
                write a `#` into an address bar this app keeps deliberately
                clean (url-state.md). Which section you scrolled to is not a
                place you were, and is not worth linking to. */}
            <button
              type="button"
              onClick={() => {
                /* Scoped to the container for the same reason `measure` is:
                   ids are derived from headings, so two of these pages mounted
                   at once carry duplicates and a document-wide lookup scrolls
                   to the wrong one. */
                revealSection(entry.id);
              }}
              /* `aria-current` as well as the colour: the highlight is the
                 answer to "where am I", and a screen reader is owed it too. */
              aria-current={here === entry.id ? "true" : undefined}
              /* **`tw:font-sans` on the button, not just on the `<nav>`.** The
                 page-scoped reset this was written beside hung off
                 `.metadata-page`, on `<main>` — and this nav is main's
                 *sibling*, so it never reached here. That reset is app-wide
                 now (tailwind.css § the bit of preflight we need), so this is
                 belt and braces rather than the only fix. Before that reset, a
                 font-family on the parent could not win: the UA stylesheet
                 assigned one to the button element directly. So these entries
                 would have drawn in Arial beside a page of Geist, which is the
                 exact bug this component was shipped alongside a fix for. GPT
                 Sol, 2026-09-03. */
              /* **The focus mark is an outline drawn inside the button.** The
                 entry fills the list's width and the list scrolls, so a mark
                 outside the box would be cut off at the list's edges. Until
                 2026-10-07 the outline was off and focus changed only the
                 text colour, which on the entry already marked as "here" was
                 no visible change at all. */
              className={`tw:block tw:w-full tw:cursor-pointer tw:border-0 tw:border-l-2 tw:bg-transparent tw:py-1 tw:pl-3 tw:text-left tw:font-sans tw:text-xs tw:leading-snug tw:transition-colors tw:hover:text-highlight-text tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-highlight-text tw:focus-visible:text-highlight-text ${
                here === entry.id
                  ? "tw:border-highlight tw:text-foreground"
                  : "tw:border-border tw:text-ink-faint"
              }`}
            >
              {entry.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
