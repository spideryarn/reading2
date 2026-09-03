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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** One entry: the section's `id` to scroll to, and the heading to print. */
type Entry = { id: string; label: string };

/**
 * How far below the top of the viewport a heading counts as reached.
 *
 * **A few pixels BELOW the sections' `scroll-mt`, not equal to it.** The
 * sections carry `scroll-mt-24` (96px) and `scrollIntoView` honours it, so a
 * clicked section lands with its top at *about* 96 — and "about" is the whole
 * problem. Measured in a browser on 2026-09-03, clicking an entry scrolled
 * correctly and then left the highlight on the entry above: the heading came to
 * rest a fraction over 96, `top <= 96` was false, and the section you had just
 * asked for was the one section not counted as reached. Subpixel layout,
 * fractional device pixel ratios and smooth-scroll rounding all land on that
 * boundary, and a test in jsdom cannot see any of it — every rect there is
 * zero.
 *
 * So this must stay strictly greater than the `scroll-mt` in Metadata.tsx
 * § Section. The slack costs nothing: a heading 4px above the fold is one the
 * reader is plainly in.
 */
const REACHED_PX = 100;

export function PageContents({
  containerRef,
  label,
}: {
  /** The element whose `[data-section]` descendants are the contents. */
  containerRef: RefObject<HTMLElement | null>;
  /** Names the nav for a screen reader — this page has another one in the bar. */
  label: string;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [here, setHere] = useState<string | null>(null);

  /* Re-read the page's sections, now. Called on mount and on every mutation
     inside the container, which is affordable because it is one
     `querySelectorAll` over one subtree — and because the result is only
     committed when it actually differs, so a mutation that changed something
     else does not re-render this. Without that comparison every keystroke in
     the purpose box below would replace the array and repaint the nav. */
  const rescan = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const found = Array.from(root.querySelectorAll<HTMLElement>("[data-section]")).map((el) => ({
      id: el.id,
      label: el.dataset.section ?? "",
    }));
    setEntries((was) =>
      was.length === found.length &&
      was.every((e, i) => e.id === found[i]?.id && e.label === found[i]?.label)
        ? was
        : found,
    );
  }, [containerRef]);

  useEffect(() => {
    rescan();
    const root = containerRef.current;
    if (!root) return;
    const watch = new MutationObserver(rescan);
    watch.observe(root, { childList: true, subtree: true });
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
         crossing 96px, so clicking "Delete this article" left "Technical
         details" marked. This component's own docstring claimed the scroll
         handler avoided the bottom-of-page problem an IntersectionObserver has;
         it had the same problem, by a different route. GPT Sol, 2026-09-03. */
      const root = containerRef.current;
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && root) {
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
        const el = root?.querySelector<HTMLElement>(`#${CSS.escape(entry.id)}`);
        if (el && el.getBoundingClientRect().top <= REACHED_PX) current = entry.id;
      }
      /* Above the first heading, the first entry is still the honest answer —
         `null` would leave the list with nothing marked for the top screenful
         of every visit, which reads as the highlight being broken. */
      setHere(current ?? entries[0]?.id ?? null);
    };
    const onScroll = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    /* **Layout can change without the entry list changing**, and then nothing
       above would fire: opening "Technical details" adds two cards' worth of
       height and moves every heading under it, but the rescan derives the same
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
      resize?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [entries, containerRef]);

  /* Nothing worth navigating. One entry is furniture rather than help, and an
     empty list is the state before the metadata request has landed. */
  if (entries.length < 2) return null;

  return (
    /* **Fixed, in the margin — not a column beside the content.** As a flex
       sibling it would push the prose column off centre on wide windows and
       change nothing on narrow ones, where it is hidden anyway. Fixed leaves
       the page exactly where it already was.

       `xl` because the arithmetic says so: the content is `max-w-3xl` (48rem)
       and centred, so a 1280px window leaves 16rem each side and this is 11rem
       at 1.5rem in. One breakpoint down there is not room, and a contents list
       overlapping the prose is worse than no contents list.

       Vertically centred rather than pinned near the top, which is also what
       keeps it clear of the fixed corner wordmark (`.logo-home`). */
    <nav
      aria-label={label}
      className="tw:hidden tw:xl:block tw:fixed tw:left-6 tw:top-1/2 tw:z-10 tw:w-44 tw:-translate-y-1/2 tw:font-sans"
    >
      <ul className="tw:m-0 tw:list-none tw:p-0">
        {entries.map((entry) => (
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
                containerRef.current
                  ?.querySelector<HTMLElement>(`#${CSS.escape(entry.id)}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              /* `aria-current` as well as the colour: the highlight is the
                 answer to "where am I", and a screen reader is owed it too. */
              aria-current={here === entry.id ? "true" : undefined}
              /* **`tw:font-sans` on the button, not just on the `<nav>`.** The
                 page-scoped reset that fixes this everywhere else
                 (styles.css § metadata) hangs off `.metadata-page`, which is on
                 `<main>` — and this nav is main's *sibling*, so the reset never
                 reaches it. A font-family on the parent cannot win either: the
                 UA stylesheet assigns one to the button element directly. So
                 these entries would have drawn in Arial beside a page of Geist,
                 which is the exact bug this component was shipped alongside a
                 fix for. GPT Sol, 2026-09-03. */
              className={`tw:block tw:w-full tw:cursor-pointer tw:border-0 tw:border-l-2 tw:bg-transparent tw:py-1 tw:pl-3 tw:text-left tw:font-sans tw:text-xs tw:leading-snug tw:transition-colors tw:hover:text-highlight tw:focus-visible:outline-none tw:focus-visible:text-highlight ${
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
