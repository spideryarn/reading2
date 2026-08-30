/**
 * Two small controls that say what the reader's profile did to a piece of
 * generated text — and one of them is not a control.
 *
 * The split is the whole design, and it came out of a review. Greg asked for
 * *"a checkbox (default-true, with fully-explanatory tooltip) in all the places
 * where we're taking into account that we have done so"*. Fable's objection:
 *
 * > It reads as something to set when it records something that happened — the
 * > exact shape the glossary already solved with "a label instead of a warning
 * > triangle". And … flipping it means regenerate-and-wait: a model-call spend
 * > hidden behind the lightest control in the interface.
 * >
 * > — 2026-08-26
 *
 * So the two jobs are separated and each goes where it belongs:
 *
 *  - **`<WrittenForYou>`** is a *label*. It states a fact about the text on
 *    screen — this was written for you, or for a profile you have since
 *    changed — and it never offers to change that text.
 *  - **`<UseProfile>`** is the *checkbox*, and it sits inside the rewrite
 *    affordance beside the button that spends the money. Unticking it and
 *    pressing the button is exactly the "check/uncheck and it regenerates
 *    without this prompt" Greg described; it just does not pretend to be free.
 *
 * **With no profile written, the checkbox is absent** — not disabled, not
 * unchecked. A dead control teaches a reader they have failed at something;
 * absence is honest, because nothing is being taken into account.
 *
 * ## Both of them now open the same panel, and the label is still not a control
 *
 * Each is a trigger for `<ProfilePanel>` — what your profile currently says,
 * and a working link to each of the two places that edit it
 * (docs/plans/profile-panel.md). That does not break the split above: the rule
 * was that a *label* must not offer to regenerate the text it describes, and
 * opening an explanation is not that. It is the question the badge was always
 * being pointed at, and until 2026-08-30 it answered it with a link nobody
 * could click — see ProfilePanel.tsx for the measurement.
 *
 * The **button beside the checkbox is shown whether or not there is a profile**,
 * because that is the state in which a reader most needs to know what any of
 * this means, and the panel's links are how a first profile gets written.
 *
 * docs/project/reader-profile.md.
 */
import { UserRound } from "lucide-react";
import { ProfilePanel } from "./ProfilePanel.js";

/**
 * Whether this reader has a profile at all — the one question both controls
 * ask before rendering anything.
 *
 * Answered by the *presence* of a profile rather than by a fetch of its text:
 * every artefact response already carries `profileChanged`, and the panels know
 * whether the artefact was written with one. A second fetch of `/api/reader`
 * per panel would be three more requests for a boolean.
 */
export interface ProfileState {
  /** The artefact on screen was written from a profile. `false` for a plain one. */
  written: boolean;
  /** …and that profile is not the one the reader has now. */
  changed: boolean;
}

/**
 * "Written for you", or "written for a profile you've changed".
 *
 * Renders nothing when the artefact was written without a profile, which is the
 * common case and is not a state worth a line of interface. Absence here means
 * "this is the ordinary thing", exactly as an unbadged glossary entry does.
 */
export function WrittenForYou({ written, changed, slug }: ProfileState & { slug: string }) {
  if (!written) return null;
  return (
    <ProfilePanel
      slug={slug}
      className={`prof-badge${changed ? " changed" : ""}`}
      label={
        changed
          ? "Written for a profile you have changed since — see what it says now"
          : "Written for your profile — see what it says"
      }
    >
      <UserRound size={11} />
      {changed ? "older profile" : "written for you"}
    </ProfilePanel>
  );
}

/**
 * The checkbox, for beside a button that costs money.
 *
 * `hasProfile` rather than the profile itself: this is offered only to a reader
 * who has written one, and the panels learn that from the artefact or from the
 * page around them.
 */
export function UseProfile({
  checked,
  onChange,
  hasProfile,
  disabled,
  slug,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  hasProfile: boolean;
  disabled?: boolean;
  /** The article, for the half of the profile that is about it. */
  slug: string;
}) {
  return (
    <span className="prof-row">
      {/* **Only the checkbox is conditional.** It used to be the whole of this
          component, so a reader with no profile saw nothing at all here — no
          control, and no way to find out what "your profile" even meant. The
          button below is how a first profile gets written, so it is exactly the
          state it must not disappear in. GPT Sol's review of the plan,
          2026-08-30; docs/plans/profile-panel.md. */}
      {hasProfile && (
        <label className="prof-use">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>Use your profile</span>
        </label>
      )}
      {/* **Outside the `<label>`, and not `disabled`.**

          Outside, because a `<label>` turns every click inside it into a
          toggle: one target doing two things, decided by which pixel.

          Not disabled while a job runs, though the checkbox rightly is — the
          profile is frozen onto a job at its start, so the tick can no longer
          change anything, but *"what am I being written for"* is a question a
          reader asks most while they are waiting for the answer. A dead control
          there teaches them they failed at something. */}
      <ProfilePanel slug={slug} className="prof-open" label="What you're being written for">
        <UserRound size={11} />
        {/* **A word, but only when the checkbox is gone.**

            Beside "Use your profile" the icon needs no label: the words next to
            it say what the subject is, and a second phrase on the same line
            reads as two controls. Alone it is a bare glyph in an empty row, and
            a reader with no profile — the one who most needs this — has nothing
            telling them it is about them. Measured in the browser, 2026-08-30:
            the no-profile row is an icon and a button with a gap between them.
            docs/plans/profile-panel.md. */}
        {!hasProfile && <span>Your profile</span>}
      </ProfilePanel>
    </span>
  );
}
