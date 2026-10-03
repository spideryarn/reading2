/**
 * **The way back, or the way home, as an icon with a tooltip.**
 *
 * > Can you change the back button text labels at the top of some pages (e.g.
 * > "<- Back to the article" and "<- Library") to icons with tooltips (because
 * > there's already so much text on the page).
 * >
 * > — Greg, 2026-09-29 (SPIDERYARN-READING2-50)
 *
 * One component so the pages that had typed the same arrow-and-words link
 * cannot drift into many sizes. Which pages use it, and the few left as words
 * on purpose, are in
 * docs/plans/260929c-back-links-become-icons-with-tooltips-and-one-animated-wordmark-reused.md;
 * tests/back-link.test.tsx sweeps for any that slipped back.
 *
 * **Two icons, because two different things were written as one arrow.** Most
 * of these go back to where the reader came from — the article, their
 * library — and an arrow says that. The ones on `/contact`, `/privacy`,
 * `/changelog` and `/opensource` go to `/` and said *Home*, deliberately, since
 * 2026-09-08: most people arrive on those pages *sent* rather than from
 * somewhere, so there is often no "back" for them to mean (ContactPage.tsx).
 * An arrow would have quietly undone that decision, so those take a house.
 * GPT Sol, plan review, finding 4.
 *
 * **`label` is the name, and the card says the same words**
 * (docs/project/tooltips.md § Five things, 4): `useRole` wires the card up as
 * `aria-describedby`, so without `aria-label` a screen reader would meet an
 * anonymous link. The cost, accepted: when focus opens the card, a screen
 * reader hears the words as name and then as description. A card saying
 * something *different* would have to invent a second fact, and a back link
 * has none — which is also why it is a `TipNote` and not a `ControlTip`.
 *
 * **To the right, not below.** Every page puts its heading a line under this
 * link, and a card offset 10px below it covered the heading while it was open
 * (GPT Sol, plan review, finding 3). To the right is the rest of an empty line.
 *
 * **On touch the card does not open**, and a tap simply follows the link,
 * which is what a back arrow or a house is expected to do. The hit area grows
 * to 40px under `pointer: coarse`, as the shelf's masthead links do; the
 * negative margin keeps the icon where the old arrow sat, flush with the text
 * column's left edge.
 *
 * `className` is the caller's spacing (a `tw:mb-*`), since each page puts its
 * heading a different distance below.
 */
import { ArrowLeft, House } from "lucide-react";

import { Link } from "./Link.js";
import { TipNote, Tooltip } from "./Tooltip.js";

export function BackLink({
  href,
  label,
  icon = "back",
  className,
}: {
  href: string;
  /** Where it goes: "Back to the article", or "Home". */
  label: string;
  /** `home` for a link that goes to `/` from a page people are sent to. */
  icon?: "back" | "home";
  className?: string;
}) {
  const Icon = icon === "home" ? House : ArrowLeft;
  return (
    <Tooltip placement="right" keepSide content={<TipNote>{label}</TipNote>}>
      <Link
        href={href}
        aria-label={label}
        className={`tw:-ml-1.5 tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-ink-faint tw:no-underline tw:transition-colors tw:hover:text-highlight-text tw:focus-visible:outline-2 tw:focus-visible:outline-highlight tw:pointer-coarse:size-10 ${className ?? ""}`}
      >
        <Icon size={16} aria-hidden="true" />
      </Link>
    </Tooltip>
  );
}
