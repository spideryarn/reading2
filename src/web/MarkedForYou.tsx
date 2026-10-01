/**
 * **"Marked for you"** — the glossary's label for the owner's personal layer,
 * and unlike `<WrittenForYou>` it has an action.
 *
 * The glossary is written for any reader now, because a visitor to a public
 * article reads it (plan 261001m). What is written for the owner is a few
 * marks on top: the terms most worth *their* attention, with one line each,
 * stored beside the glossary and never shown to anyone else. This label sits at
 * the glossary's head and says which state those marks are in:
 *
 * - **Marked for you** — opens `<ProfilePanel>`, what the profile says and
 *   where to change it, exactly as `<WrittenForYou>` does;
 * - **Marked for an older profile** — the reader has changed their profile
 *   since, so the marks are about somebody they were; **Mark again** queues the
 *   `glossaryForYou` step alone, which rewrites the marks and not the glossary;
 * - **Not marked for you** — the last attempt failed (the glossary was kept);
 *   **Mark again** tries once more.
 *
 * **Why not `<WrittenForYou>` with a button added** (GPT Sol's finding 9): that
 * component is a label by design and its header says why — a label must not
 * offer to regenerate the text it describes, because that text is the shared
 * glossary. Here the thing the button rewrites is the marks, and only the
 * marks, which is a different promise in a different component.
 *
 * Arriving spends nothing: the label only ever *offers* a run.
 * docs/project/glossary.md § Marked for you.
 */
import { RotateCw, UserRound, UserRoundPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GlossaryForYouView } from "../types.js";
import { ProfilePanel } from "./ProfilePanel.js";

export function MarkedForYou({
  view,
  slug,
  marking,
  onMarkAgain,
}: {
  view: GlossaryForYouView;
  slug: string;
  /** A `glossaryForYou` run is queued or going: the button waits for it. */
  marking: boolean;
  onMarkAgain(): void;
}) {
  const again = view.failed || view.marksProfileChanged;
  const words = view.failed
    ? "Not marked for you"
    : view.marksProfileChanged
      ? "Marked for an older profile"
      : view.marks.length > 0
        ? "Marked for you"
        : "Nothing marked for you";
  const Icon = again ? UserRoundPen : UserRound;
  return (
    <span className="for-you-label">
      <ProfilePanel
        slug={slug}
        className={`prof-badge${again ? " changed" : ""}`}
        label={`${words} — see what your profile says`}
        note={
          view.failed
            ? "The terms worth your attention could not be marked this time. The glossary itself is unaffected."
            : view.marksProfileChanged
              ? "The marked terms were picked for your profile as it was before you last changed it."
              : "The marked terms were picked for your profile. Nobody else sees them."
        }
      >
        <Icon size={11} />
        {words}
      </ProfilePanel>
      {again && (
        <Button type="button" variant="outline" size="xs" disabled={marking} onClick={onMarkAgain}>
          <RotateCw size={11} />
          {marking ? "Marking…" : "Mark again"}
        </Button>
      )}
    </span>
  );
}

/** The small mark beside a marked entry's name. */
export function ForYouMark() {
  return (
    <span className="for-you-mark">
      <UserRound size={10} aria-hidden="true" />
      for you
    </span>
  );
}

/** The one line under a marked entry's gloss — the note written for this reader. */
export function ForYouNote({ note }: { note: string }) {
  return (
    <span className="for-you-note">
      <span className="tw:sr-only">For you: </span>
      {note}
    </span>
  );
}
