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
 * screen — this was written for you, or for a profile you have since changed.
 * docs/plans/260913a-drop-the-use-your-profile-checkbox.md.
 *
 * ## It opens the profile panel — and since 2026-10-02 the panel has controls
 *
 * The badge is a trigger for `<ProfilePanel>` (docs/plans/260830c-profile-panel.md).
 * Until 2026-10-02 that panel only showed the two boxes, with a link to each
 * page that edits them, and this docstring said the badge "never offers to
 * change that text": *a label must not offer to regenerate the text it
 * describes*. **Greg has asked for exactly that, so it is now a recorded
 * exception, not a rule broken by accident:**
 *
 * > Make that a reusable component that shows up in any modes where the output
 * > is personalised. And if possible, allow them to edit the text inline …
 * > I suppose if they do edit or if the profile has changed since the mode
 * > generated, then it should show a handy "Regenerate" button in that mode's
 * > "This was written for your profile" panel.
 * >
 * > — Greg, 2026-10-01, `[SPIDERYARN-READING2-7S]`
 *
 * What survives of Fable's objection is where the spend sits. The *badge* is
 * still a label — pressing it opens a panel and spends nothing — and the paid
 * call is a button inside, named for what it does, offered only when the server
 * says the profile changed, and never pressed for the reader. Both boxes are
 * edited in the panel itself; ProfilePanel.tsx says how it keeps the words safe
 * and when Regenerate shows.
 *
 * **`regenerate` is the mode's own forced run**, passed only by a mode whose
 * forced run *replaces* (Summary, Ideas, Tweets, Sketch) or, for the Glossary,
 * rewrites because the profile no longer matches. Quotes passes none: its
 * forced run appends to a current list and keeps the first pass's stamp, so it
 * would lengthen the list and leave the badge saying *changed*. Plan 261002b
 * § Deferred.
 *
 * ## `compact`: an icon without words, in Glossary and Summary (2026-09-29)
 *
 * > Perhaps hide "written for you" as a tooltip on something or just an icon.
 * >
 * > — Greg, 2026-09-29, `[SPIDERYARN-READING2-4G]`
 *
 * **Originally Glossary only**, because the phone-space argument was made about Glossary,
 * and because an icon alone says less than the words: *older profile* is a
 * fact a reader would otherwise have to guess from a colour. GPT Sol's review
 * of the plan made that point and it holds, so Quotes, Ideas and Tweets keep
 * their words. The two states stay apart without them — `UserRound` for
 * *written for you*, `UserRoundPen` in the warmer `.changed` colour for the
 * other — and **the panel says which one it is, in words, at its top**
 * (`note`), because the panel is where a compact badge's reader goes to find
 * out, and until now it only described the profile as it is today. There is
 * still no hover `title`: ProfilePanel.tsx says why.
 * docs/plans/260929a-compact-glossary-header-and-kind-icons.md.
 *
 * **And Summary's plain words, since 2026-10-01**, for the same space argument
 * made harder: Greg asked for Summary's controls in one row with no wasted
 * vertical space (SPIDERYARN-READING2-7A), and the badge sits at that row's
 * end. A changed profile is also said in words there — a *Write it again*
 * button appears under the paragraphs — so the colour is not the only signal.
 * docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md.
 *
 * docs/project/reader-profile.md.
 */
import { UserRound, UserRoundPen } from "lucide-react";
import { ProfilePanel, type Regenerate } from "./ProfilePanel.js";

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
export function WrittenForYou({
  written,
  changed,
  slug,
  compact = false,
  regenerate,
}: ProfileState & {
  slug: string;
  compact?: boolean;
  /** The mode's forced run, for the panel's Regenerate. See the header for who passes one. */
  regenerate?: Regenerate | undefined;
}) {
  if (!written) return null;
  const Icon = compact && changed ? UserRoundPen : UserRound;
  return (
    <ProfilePanel
      slug={slug}
      changed={changed}
      regenerate={regenerate}
      className={`prof-badge${changed ? " changed" : ""}${compact ? " icon-only" : ""}`}
      label={
        changed
          ? "Written for a profile you have changed since — see what it says now"
          : "Written for your profile — see what it says"
      }
      note={
        changed
          ? "This was written for your profile as it was before you last changed it."
          : "This was written for your profile."
      }
    >
      <Icon size={compact ? 13 : 11} />
      {!compact && (changed ? "older profile" : "written for you")}
    </ProfilePanel>
  );
}
