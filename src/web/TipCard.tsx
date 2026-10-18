/**
 * **The app's card for `data-tip`** — mounted once, in main.tsx, so every page
 * has it: the landing page, the shelf, admin, the reading view.
 *
 * Greg, 2026-10-17 (spya-q04h98):
 *
 * > Look for anywhere we're using regular tooltips (e.g. when hovering over the
 * > search name), and replace with rich tooltips / see tooltips.md / And how can
 * > we ensure this going forwards?
 *
 * So a control that wants a sentence on hover says `data-tip="…"` where it used
 * to say `title="…"`, and this draws it as ours — same panel, same delays, same
 * keyboard reach as a `Tooltip` — instead of the OS's grey box after a second.
 * One panel for every trigger, by delegation (useDelegatedCard.tsx), so a row
 * of a table that repeats a hundred times costs nothing per row.
 * tests/no-native-title-tooltips.test.ts is what keeps `title` from coming back;
 * docs/project/tooltips.md § Prefer the rich card to a native `title` is the rule.
 *
 * A blank line in the words starts a new paragraph (tooltips.md § Short
 * paragraphs or bullets): `"Words\n\nMark only this search"` is two. A single
 * newline is a line break, as it was in a `title`.
 *
 * **Not for a trigger another card owns.** An element that is a `Tooltip`'s
 * trigger (`TOOLTIP_TRIGGERS`, which Tooltip.tsx keeps while it can open) or
 * that sits in one, or in one of BlockLinkCard.tsx's triggers, gets no
 * second card from here.
 *
 * **Describes**, while open, through `aria-describedby`, unless the element
 * says `data-tip-describes="off"` — the gutter's controls, whose sentence is
 * their own name and would be read twice. A `data-tip` is not a name: an
 * icon-only control still needs its `aria-label`.
 *
 * Article markup cannot forge one: the sanitiser drops every `data-*` an article
 * carries bar the few it names (src/sanitize-policy.ts § `ALLOW_DATA_ATTR`), and
 * `data-tip` is not one of them.
 */
import type { ReactNode } from "react";
import { BLOCK_CARD_TRIGGERS } from "./block-link-index.js";
import { TipNote, insideTooltipTrigger } from "./Tooltip.js";
import { useDelegatedCard } from "./useDelegatedCard.js";

/** The words, a paragraph per blank-line-separated run; null for none. */
export function tipParagraphs(raw: string | null): string[] | null {
  const paragraphs = (raw ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return paragraphs.length === 0 ? null : paragraphs;
}

function contentFor(el: Element): ReactNode | null {
  const paragraphs = tipParagraphs(el.getAttribute("data-tip"));
  if (paragraphs === null) return null;
  /* `TipNote` is a `<span>`, so the paragraphs are block spans rather than
     `<p>`s, which a span may not hold. `pre-line`, so a single newline inside
     one is still a line break, as it was in a native `title` — the wordmark's
     build stamp on its own line (library-home-title.ts). */
  return (
    <TipNote>
      {paragraphs.map((p, i) => (
        <span key={i} className={i === 0 ? "tw:block tw:whitespace-pre-line" : "tw:mt-1.5 tw:block tw:whitespace-pre-line"}>
          {p}
        </span>
      ))}
    </TipNote>
  );
}

export function TipCard() {
  const { card } = useDelegatedCard({
    selector: "[data-tip]",
    ignore: (_el, target) => insideTooltipTrigger(target) || target.closest(BLOCK_CARD_TRIGGERS) !== null,
    contentFor,
    describes: (el) => el.getAttribute("data-tip-describes") !== "off",
    observeAttributes: ["data-tip"],
    cardClass: () => "tip-soon",
  });
  return card;
}
