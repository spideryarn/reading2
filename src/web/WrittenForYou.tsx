/**
 * The one thing on screen that says what the reader's profile did to a piece
 * of generated text — and it is a label, not a control.
 *
 * **There used to be a control beside it.** Greg asked for *"a checkbox
 * (default-true, with fully-explanatory tooltip) in all the places where we're
 * taking into account that we have done so"*, and Fable's objection split that
 * in two:
 *
 * > It reads as something to set when it records something that happened — the
 * > exact shape the glossary already solved with "a label instead of a warning
 * > triangle". And … flipping it means regenerate-and-wait: a model-call spend
 * > hidden behind the lightest control in the interface.
 * >
 * > — 2026-08-26
 *
 * So a label went on the text and a *Use your profile* checkbox, with a button
 * into the profile panel, went in a row beside every button that spends. **The
 * whole row was removed on 2026-09-13**, on Greg's request:
 *
 * > Just always have it as on. So just assume that we're always going to use
 * > the profile, and we don't need to include it in the UI to ask them. So the
 * > UI is a bit tidier and more compact.
 * >
 * > — Greg, 2026-09-12
 *
 * Every new run now uses the profile, and Find more continues a list in the
 * setting it was written with (useGlossary.ts § `more`). The label's half of
 * the split still stands: **`<WrittenForYou>`** states a fact about the text on
 * screen — this was written for you, or for a profile you have since changed —
 * and never offers to change that text. The profile itself is edited on
 * /profile and the metadata page, and the Command bar's Profile row reaches
 * the first. docs/plans/260913a-drop-the-use-your-profile-checkbox.md.
 *
 * ## It opens the profile panel, and it is still not a control
 *
 * The badge is a trigger for `<ProfilePanel>` — what your profile currently
 * says, and a working link to each of the two places that edit it
 * (docs/plans/260830c-profile-panel.md). That does not break the rule above: a
 * *label* must not offer to regenerate the text it describes, and opening an
 * explanation is not that. It is the question the badge was always being
 * pointed at, and until 2026-08-30 it answered it with a link nobody could
 * click — see ProfilePanel.tsx for the measurement.
 *
 * docs/project/reader-profile.md.
 */
import { UserRound } from "lucide-react";
import { ProfilePanel } from "./ProfilePanel.js";

/**
 * The two provenance facts the badge needs before rendering anything.
 *
 * Answered by the *presence* of a profile rather than by a fetch of its text:
 * every artefact response already carries `profileChanged`, and the panels know
 * whether the artefact was written with one. Fetching `/api/reader` here as
 * well would add one request per mounted caller merely to recover a boolean.
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
