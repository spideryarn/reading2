/**
 * **One section of a page of cards**: a small-caps heading, optionally a
 * disclosure button, and the body under it.
 *
 * It was written for the Metadata page and lived in Metadata.tsx until
 * 2026-10-03, when `/profile` wanted the same folding (Greg, `spya-ka3cau`;
 * docs/plans/261003k-feedback-screenshot-shrinks-to-fit-and-profile-sections-collapse.md).
 * ProfilePage had a private `Section` of its own — the same heading with an
 * icon and no folding — and a second copy of the folding would have been a
 * second chance to write the latch bug this one has a postmortem for (below).
 * So there is one, and the only thing added in the move is `icon`.
 *
 * What a page gets from it without asking: `data-section` and an `id`, which
 * are everything PageContents.tsx needs to draw a contents list, and
 * `data-keywords` for that list's search box.
 */
import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SECTION_REVEAL } from "./PageContents.js";

/**
 * A section's heading turned into an element id, for the contents list to aim at.
 *
 * Deriving it rather than passing one in: an `id` prop is a second name for the
 * section that nothing checks against the first, and the failure is a contents
 * entry that scrolls nowhere. The labels here are short English phrases, so
 * lower-casing and hyphenating is enough — `"Access & sharing"` becomes
 * `"access-sharing"`, and there is no pair of labels on either page that uses it that collide
 * under it.
 */
export function sectionId(label: string): string {
  return `sec-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function Section({
  label,
  icon: Icon,
  aside,
  keywords,
  collapsible,
  keepMounted,
  children,
}: {
  label: string;
  /**
   * **Drawn in place of the highlight bar** — `/profile`'s six headings each
   * had an icon before they were this component, and keep it. Metadata's
   * sections pass none and keep the bar. Any lucide icon; drawn at 12.
   */
  icon?: ComponentType<{ size?: number }>;
  /** One line answering the section's question, on the heading row. */
  aside?: ReactNode;
  /**
   * **Words a reader might search for that the section does not print** — the
   * search box above the contents list reads them (`data-keywords`,
   * page-search.ts). Mostly for the sections that unmount their body when
   * shut, whose words are otherwise not on the page to find. The synonyms
   * the whole Metadata page shares live in page-search.ts § METADATA_SYNONYMS; these
   * are this section's own. Plan 261001s.
   *
   * **Required, and generous**: the words a reader *types* — *regenerate*,
   * *get rid of*, *who can see it* — not the words the section prints. A new
   * section, or a new control in one, comes with its words, and a case in
   * tests/metadata-contents-reveal.test.tsx § the words a reader brings.
   * Greg, `spya-nkjpte`, 2026-10-02 — docs/project/web-client.md, the
   * Metadata.tsx row. Plan 261002c.
   */
  keywords: string;
  collapsible?: boolean;
  /**
   * **Shut hides the children rather than unmounting them.** For *AI
   * processing*, whose rows each hold a `useStepJob` subscription: unmounted,
   * a run that finished while the section was shut would never call
   * `onFinished`, and reopening would not replay it — `useJobs` starts a new
   * subscriber's cursor at the latest completion, and the fallback needs the
   * row's own `startedId`, which went with it. GPT Sol, plan review of
   * docs/plans/260929b-one-place-to-re-run-ai-processing.md, P1.
   */
  keepMounted?: boolean;
  children: ReactNode;
}) {
  /* Local state, not a URL parameter, and the Metadata page's own `at`
     (Metadata.tsx) is the reason that needs saying: url-state.md puts every bit of
     view state in the address bar. A shut section is not view state in that
     sense — it is the same kind of thing as an open drawer, which
     `carriedSearch` deliberately strips on every navigation because a drawer
     you left open is not a place you were. Nothing about a shut section is
     worth linking to, and a `?stages=open` in every shared metadata URL would
     be noise in the one place this app keeps clean. */
  /**
   * **`open` is the reader's toggle; `showing` is what actually renders.**
   *
   * This was `useState(!collapsible)`, and that is a bug that had been live
   * since the section was written, found by tests/metadata-page-order.test.tsx
   * on 2026-09-03. `useState`'s argument is an *initial* value: it is read on
   * the first render and never again. But the one caller that passes a varying
   * `collapsible` computes it from a request that has not answered yet —
   * `collapsible={!provenanceError}` — so the section mounts collapsible,
   * latches `open: false`, and then the request fails.
   *
   * At that moment `collapsible` goes false, which takes the disclosure button
   * away (the heading stops being a control), while `open` is still false. The
   * section was left **shut, with nothing on the page that could open it**, and
   * what was sealed inside was the error message — the exact outcome the rule
   * was written to prevent, by a cross-model review on 2026-08-27 which said
   * "a shut section is exactly where it would have gone". It went there anyway.
   *
   * Deriving it fixes the class rather than the instance: a section that is not
   * collapsible shows its children, whenever it stopped being collapsible and
   * whatever the reader had toggled beforehand. docs/postmortems/260903d-a-collapsible-section-latched-shut-and-sealed-the-error-in.md
   */
  const [open, setOpen] = useState(false);
  const showing = !collapsible || open;
  /* **Opened from outside** — the contents list and its search box send
     `SECTION_REVEAL` to the section they are taking the reader to
     (PageContents.tsx § reveal; Greg, SPIDERYARN-READING2-7Y: *"expand that
     section (if needed)"*). An event on this element rather than lifted state,
     because lifting it would need a list of the page's sections — the second
     list PageContents exists not to have. Opens, never shuts: a reveal of an
     open section leaves it open. A section that is not collapsible is already
     showing, and setting `open` on it changes nothing. */
  const sectionEl = useRef<HTMLElement>(null);
  /* Layout, not passive: a MutationObserver can see this section's committed
     DOM before passive effects run. The arrival hook may dispatch immediately,
     so its listener must exist in the same commit as the element. */
  useLayoutEffect(() => {
    const el = sectionEl.current;
    if (!el) return;
    /* `flushSync` so the body is in the DOM when the event returns: the
       sender scrolls next, and near the foot of the page a shut section may
       not leave the scroll range to bring its heading up. Sol, plan review. */
    const reveal = () => flushSync(() => setOpen(true));
    el.addEventListener(SECTION_REVEAL, reveal);
    return () => el.removeEventListener(SECTION_REVEAL, reveal);
  }, []);
  const head = (
    <>
      {Icon ? (
        <Icon size={12} />
      ) : (
        <span
          aria-hidden="true"
          className="tw:inline-block tw:h-3.5 tw:w-[3px] tw:shrink-0 tw:rounded-full tw:bg-highlight/70"
        />
      )}
      {label}
    </>
  );
  return (
    /* `data-section` is what the contents list in the margin reads, and `id` is
       where it scrolls to — PageContents.tsx, which derives its whole list from
       these rather than from a second array of section names.

       `scroll-mt-24` is 6rem, and "reached" over there is deliberately a
       little MORE than it — the section a click has just scrolled to must be
       the section the list then marks, and setting the two equal put that on a
       knife edge that a browser lost. Since 2026-10-03 it reads this margin off
       the element (`reachedPx`), so changing the 24 needs no second edit —
       and neither does a reader whose rem is not 16px. */
    <section
      ref={sectionEl}
      id={sectionId(label)}
      data-section={label}
      data-keywords={keywords}
      className="tw:mt-8 tw:scroll-mt-24"
    >
      {/* **Every heading can take focus from a script** (`tabIndex={-1}`: not a
          Tab stop), for whatever sends the reader here — *Share…* in
          `TopActions`, which lands on *Access & sharing*, and the contents list
          and its search box, which land on any section (PageContents.tsx §
          reveal). The heading rather than the first control inside, because
          that control changes with the card's state, and a landing that puts
          an action under Enter is the wrong kind of arrival. GPT Sol, plan
          reviews, 2026-09-30 and 261001s. It was one section's `landing` prop
          until the contents list needed the same for all of them. */}
      {/* A collapsible heading's button carries `tap-target`, the finger's
          invisible 40px (tap-target.css), and its 14px line leaves that 13px
          above and below. The 12px under the heading would put the last pixel
          of it over the body's first control, so under a finger the heading
          takes at least 14px instead (1rem when larger). A physical floor
          still holds the 13.5px overhang at the supported 12px root, where
          the chevron stays 13px: the row grows rather than targets overlapping
          (Greg, 2026-10-07; plan 261007h § F5a). */}
      <h2
        tabIndex={-1}
        className={`tw:m-0 tw:mb-3 ${collapsible ? "tw:any-pointer-coarse:mb-[max(1rem,14px)] " : ""}tw:flex tw:items-center tw:gap-2 tw:text-[0.68rem] tw:font-normal tw:uppercase tw:tracking-[0.09em] tw:text-ink-faint`}>
        {collapsible ? (
          /* The heading itself is the control, so the target is the whole line
             rather than a 12px chevron. `aria-expanded` on the button and
             nothing on the section: the button is what opens, and the h2 stays
             a heading so the page's outline is the same shut or open.

             The focus mark is the app's usual outline as well as the colour:
             until 2026-10-07 the outline was off and the colour change was
             the whole mark. Nothing on /profile or Metadata clips it. */
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={showing}
            className="tap-target tw:flex tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:uppercase tw:tracking-[0.09em] tw:cursor-pointer tw:hover:text-highlight-text tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-highlight-text tw:focus-visible:text-highlight-text"
          >
            {head}
            {showing ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          head
        )}
        {/* Shown open or shut, and that is the point of it: shutting the
            section must not take the answer away, only the detail. */}
        {aside && (
          <span
            data-section-aside=""
            className="tw:ml-auto tw:min-w-0 tw:truncate tw:normal-case tw:tracking-normal tw:text-ink-faint"
          >
            {aside}
          </span>
        )}
      </h2>
      {keepMounted ? <div hidden={!showing}>{children}</div> : showing && children}
    </section>
  );
}
