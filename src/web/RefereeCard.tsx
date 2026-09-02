/**
 * **"How Referee mode works"** — the one card that says what the whole mode is
 * for, before any sub-mode is pressed.
 *
 * Greg met the mode as *"very confusing"*, 2026-09-02, and stage 2 answered the
 * half of that which is per-control: thirty controls that now say what they do
 * when you hover them. This is the other half, and a tooltip cannot be it — a
 * card only opens on a control you already suspected, and the thing a
 * first-time referee does not know is what the four chips are *for* and what the
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
 * ## The words
 *
 * They are the plan's, and they have been corrected once already — the first
 * draft said marks appear when a criterion runs (the tick is what paints) and
 * that every row is a door into the prose (Mirror's coverage row deliberately
 * has none). Two rules they are written under, and both are load-bearing:
 *
 * - **The first sentence is the refusal**, because it is the whole design.
 *   *Nothing here scores the paper or drafts your review* — the mode's first
 *   rule, and the reason it exists in this shape at all.
 * - **The colour paragraph is not decoration.** docs/project/colour-scales.md
 *   forbids colour being the only carrier of a good/bad judgement, and the
 *   panel's own key (`TheKey` in CriteriaPanel.tsx) states the mapping where the
 *   judgements are. This says it once more, in prose, for the referee who met
 *   the paper before the panel.
 *
 * Short on purpose: a card longer on screen than the panel underneath it has
 * failed at the thing it is for.
 */
import { useState } from "react";
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
export function useHowCard(): { open: boolean; show(open: boolean): void } {
  const [open, setOpen] = useState(() => !howCardDismissed());
  return {
    open,
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
export function RefereeHowButton({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button type="button" className="ref-how-btn" aria-expanded={open} onClick={onToggle}>
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

      <ul className="ref-how-list">
        <li>
          <b>Criteria</b> — write what you have been asked to judge against. A criterion marks its
          passages while its tick is on, and a new run turns its tick on for you.
        </li>
        <li>
          <b>Claims</b> — what the paper says it shows, and where it takes each claim up. Whether a
          passage carries the claim is your call, not the model's.
        </li>
        <li>
          <b>Mirror</b> — the model reads your own comments, never the paper, and flags ones an
          author could not act on.
        </li>
        <li>
          <b>Candidates</b> — for editors: who could review this, each name with a link a web
          search returned.
        </li>
      </ul>

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
        identity: one end of the scale counts against, the other counts for, and the panel and the
        paper use the same one. The panel prints the key, and each mark in the paper carries − or +
        as well, so the colour is never the only thing saying it. Every other colour just says{" "}
        <i>which</i> of your criteria or claims made a mark; it carries no judgement.
      </p>
    </div>
  );
}
