/**
 * **"How Referee mode works"** — the one card that says what the whole mode is
 * for, before any sub-mode is pressed.
 *
 * Greg met the mode as *"very confusing"*, 2026-09-02, and stage 2 answered the
 * half of that which is per-control: thirty controls that now say what they do
 * when you hover them. This is the other half, and a tooltip cannot be it — a
 * card only opens on a control you already suspected, and the thing a
 * first-time referee does not know is what the mode refuses to do and what the
 * colours in the paper are saying.
 * docs/plans/260902f-make-referee-mode-understandable.md § Stage 3.
 *
 * ## Where it sits, and why not in `.ref-brief`
 *
 * At the top of `.ref-panel`, under the sub-mode chips — **not** in `.ref-brief`
 * with the confidentiality notice and the injection scan. Those two are capped
 * at 40% of the band and neither may ever be dismissed. A closable card sitting
 * beside a non-closable one invites closing the wrong one, and would teach a
 * referee that the box above it ought to close too. Here it is in the scroller,
 * where everything is transient by construction.
 *
 * ## Shut once, shut on the next paper
 *
 * The bit lives in `localStorage` — src/web/referee-card.ts carries the whole
 * argument for that, including the distinction against
 * docs/project/url-state.md, which this is the second exception to. The header's
 * "How this works" button flips the same bit, so dismissing and reopening are
 * one thing rather than two discoveries.
 *
 * **Not a dialog.** No focus trap, no backdrop, no `role="dialog"`: it is a
 * paragraph of explanation in the flow of the panel, and a referee who tabs
 * past it should reach the panel underneath. The close button is a real button
 * with a real name; so is the one that brings it back.
 *
 * ## The words: two things, and nothing else on screen says either
 *
 * - **The refusal**, because it is the whole design. *Nothing here scores the
 *   paper or drafts your review* — the mode's first rule, and the reason it
 *   exists in this shape at all.
 * - **What the colours mean.** docs/project/colour-scales.md forbids colour
 *   being the only carrier of a good/bad judgement, and the panel's own key
 *   (`TheKey` in CriteriaPanel.tsx) states the mapping where the judgements are.
 *   This says it once more, in prose, for the referee who met the paper before
 *   the panel. It states the *shape* of the rule and never names red and green:
 *   `?refscale=br` paints the same two directions blue and red.
 *
 * ## What was cut, and the measurement that cut it
 *
 * The card shipped with a **four-line list of the sub-modes** as well, and a
 * cross-family review, 2026-09-02, called the whole card a net loss on the cold
 * screen. It was right about the substance, and the reason is an artefact of the
 * order the two stages landed in: stage 2 put a `ControlTip` on each of the four
 * sub-mode chips, three feet above this card, so by the time this was written
 * every one of those four lines had a second copy that opens on the chip it is
 * about. The list went; the two things above stayed, because nothing else on the
 * screen says either of them.
 *
 * **Short on purpose: a card longer on screen than the panel underneath it has
 * failed at the thing it is for** — and this one had, by 140px. Measured in
 * Chrome at 1280×900 on an article with no criteria written yet,
 * `?mode=referee&referee=criteria`, reading `getBoundingClientRect().height` out
 * of the live DOM rather than off a screenshot:
 *
 * | | height |
 * |---|---|
 * | the card, with the four sub-mode lines | **409.5px** |
 * | the card, without them | **203.1px** |
 * | the Criteria composer under it, empty state (form + *"Nothing yet…"*) | 269.9px |
 * | the whole empty Criteria panel (`.crit`) | 277.9px |
 *
 * So it went from half again the height of the tool it explains to three
 * quarters of it. The rule it broke is the one written in the line above.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { howCardDismissed, rememberHowCard } from "./referee-card.js";

/**
 * **The one bit, and every read and write of it in one place.**
 *
 * The band renders the card and the header button in two different parts of the
 * DOM, so the state cannot live in either of them — but it can live in one
 * hook, and that is what keeps "shut it" and "bring it back" the same bit
 * rather than two. The alternative — a `useState` in `RefereeBand` with the two
 * `localStorage` calls written out at the two call sites — invites a press that
 * changes the screen and forgets to write, which looks completely correct until
 * the next paper.
 *
 * **The initialiser is lazy**, `InstallHint`'s reason: it touches
 * `localStorage`, and this band re-renders on every scroll of the article.
 *
 * The environment is read once per mount and not watched. Nothing else in this
 * tab writes the key, and a second tab writing it is a case the card would not
 * be improved by noticing — a `storage` listener here would make an explanation
 * appear or vanish under somebody mid-sentence.
 */
export function useHowCard(): {
  open: boolean;
  show(open: boolean): void;
  /**
   * Put on `RefereeHowButton`, so that closing the card can hand the reader
   * back to it. Here rather than in either component for the same reason the
   * open/shut bit is: the two are in different parts of the DOM, and the hook
   * is the one place that sees both.
   */
  buttonRef: RefObject<HTMLButtonElement | null>;
} {
  const [open, setOpen] = useState(() => !howCardDismissed());
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * ## Closing the card gives the keyboard back
   *
   * The card's own ✕ is inside the card, so pressing it unmounts the element
   * the reader is standing on and focus falls to `<body>` — the next Tab then
   * starts again from the top of the document. Invisible with a mouse, and this
   * card is **open by default** until it is dismissed once, so closing it is
   * close to the first thing a keyboard referee does.
   *
   * **The `activeElement` test is the part that matters**, and it is
   * `EditableTitle`'s, in TitleEditor.tsx § the pencil and the input swap:
   * rescue only the case where focus went nowhere. A reader who dismissed the
   * card by pressing the header button is already standing on that button, and
   * one who clicked a link in the paper has gone somewhere real — grabbing
   * focus back in either case would be worse than the bug.
   *
   * Found by GPT Sol (F41, 2026-09-07) in a focus inventory that had **excluded
   * this card for being in flow**. Being in flow removes the requirement to trap
   * Tab; it does not remove the requirement to give focus back.
   * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-focus-inventory.md
   */
  const was = useRef(open);
  useEffect(() => {
    const closed = was.current && !open;
    was.current = open;
    if (!closed) return;
    const at = document.activeElement;
    if (at === null || at === document.body) buttonRef.current?.focus();
  }, [open]);

  return {
    open,
    buttonRef,
    show(next: boolean) {
      setOpen(next);
      /* **Both ways.** Reopening clears the dismissal rather than opening it for
         this mount only — see `rememberHowCard`. */
      rememberHowCard(!next);
    },
  };
}

/**
 * **The button in the mode header that brings the card back.**
 *
 * In the header rather than beside the card, because when the card is shut
 * there is no card to put it beside — which is the whole failure this is
 * against: an explanation dismissed on the first paper and unfindable on the
 * second.
 *
 * `aria-expanded` and no `aria-controls`: the card is not rendered while it is
 * shut, so `aria-controls` would name an element that is not there.
 */
export function RefereeHowButton({
  open,
  onToggle,
  buttonRef,
}: {
  open: boolean;
  onToggle(): void;
  /** From `useHowCard`. Optional so the button still works anywhere it is used alone. */
  buttonRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      className="ref-how-btn"
      aria-expanded={open}
      onClick={onToggle}
    >
      How this works
    </button>
  );
}

export function RefereeHowCard({ onClose }: { onClose(): void }) {
  return (
    <div className="ref-how-card">
      <div className="ref-how-head">
        <h3>How Referee mode works</h3>
        {/* Named for what it does to the card, not "close": a referee who has
            just read a confidentiality notice they cannot dismiss should not be
            offered two identical-sounding × buttons with different powers. */}
        <button
          type="button"
          className="ref-how-close"
          aria-label="Hide this explanation"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <p className="ref-how-p">
        You are the referee. Nothing here scores the paper or drafts your review — a tool that
        hands you a verdict makes you lenient, and the research has measured it.
      </p>

      {/* **The four sub-mode lines were here, and they are gone**, 2026-09-02:
          stage 2 had already put a `ControlTip` on each of the four chips
          directly above this card, so each line was a second copy of a card that
          opens on the chip it is about. A card that repeats what is three feet
          above it is what made this one taller than the panel it explains. */}

      {/* **The plan's wording named red and green, and stage 1 made that false
          half the time.** `?refscale=br` paints the same two directions blue and
          red, so a card that said "red counts against" would be exactly wrong
          on it — the failure `TheKey` in CriteriaPanel.tsx already refuses by
          drawing swatches instead of naming colours. This says the shape of the
          rule and sends the reader to the key, which is printed beside the
          criteria whenever a for/against one is on and cannot drift from the
          rows. */}
      <p className="ref-how-p">
        <b>What the colours mean.</b> On a for/against criterion, colour is direction rather than
        identity: one end of the scale counts against, the other counts for, in the panel and the
        paper alike. The panel prints the key, and each mark carries − or + as well. Every other
        colour just says <i>which</i> of your criteria or claims made a mark, and carries no
        judgement.
      </p>
    </div>
  );
}
