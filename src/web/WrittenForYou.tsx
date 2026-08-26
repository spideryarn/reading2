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
 *    changed — and it carries the explanation. It is not pressable.
 *  - **`<UseProfile>`** is the *checkbox*, and it sits inside the rewrite
 *    affordance beside the button that spends the money. Unticking it and
 *    pressing the button is exactly the "check/uncheck and it regenerates
 *    without this prompt" Greg described; it just does not pretend to be free.
 *
 * **With no profile written, both are absent** — not disabled, not unchecked. A
 * dead control teaches a reader they have failed at something; absence is
 * honest, because nothing is being taken into account.
 *
 * docs/project/reader-profile.md.
 */
import { UserRound } from "lucide-react";
import { Link } from "./Link.js";
import { Tooltip } from "./Tooltip.js";

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
export function WrittenForYou({ written, changed }: ProfileState) {
  if (!written) return null;
  return (
    <Tooltip
      placement="top"
      content={
        <div className="tip-profile">
          <p>
            {changed
              ? "This was written for the profile you had at the time, and yours has changed since."
              : "This was written for your profile — what you said about your background and what you're after."}
          </p>
          {/* The promise, said where the claim is made. It is the thing that
              makes a personalised summary safe to read, and it is enforced in
              the prompt rather than here — src/profile.ts § PROFILE_RULES. */}
          <p>
            A profile changes what gets explained and how much. It never changes what the article
            says, and never its proportions.
          </p>
          <p>
            <Link href="/profile">Edit your profile →</Link>
          </p>
        </div>
      }
    >
      {/* A span, not a button. It records something that happened; there is
          nothing here to set. `tabIndex` so the tooltip is reachable by
          keyboard without claiming to be actionable. */}
      <span className={`prof-badge${changed ? " changed" : ""}`} tabIndex={0}>
        <UserRound size={11} />
        {changed ? "older profile" : "written for you"}
      </span>
    </Tooltip>
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
}: {
  checked: boolean;
  onChange(next: boolean): void;
  hasProfile: boolean;
  disabled?: boolean;
}) {
  if (!hasProfile) return null;
  return (
    <label className="prof-use">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>Use your profile</span>
    </label>
  );
}
