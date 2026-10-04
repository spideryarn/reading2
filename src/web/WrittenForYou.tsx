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
 * ## Always an icon, with a card (2026-10-04)
 *
 * > In remember mode, you don't need the words written for you at the top.
 * > Just the little profile icon should be sufficient with a rich tooltip, and
 * > the same goes for any other modes.
 * >
 * > — Greg, 2026-10-04, `spya-pmjy40`
 *
 * It was words (*written for you*, *older profile*) everywhere until
 * 2026-09-29, when Glossary's became an icon behind a `compact` prop
 * (Greg: *"Perhaps hide "written for you" as a tooltip on something or just an
 * icon"*, SPIDERYARN-READING2-4G; plan 260929a), and mode by mode the rest
 * followed. Quiz was the last with words. The prop is gone, because a switch
 * nobody sets is a second way to draw the badge waiting to be used by accident.
 *
 * GPT Sol's objection to the first icon still holds — *older profile* is a
 * fact a reader would otherwise have to guess from a colour — and three things
 * answer it: `UserRound` against `UserRoundPen` in the warmer `.changed`
 * colour; **the card on hover or focus** (`tip`, drawn by `ProfilePanel`,
 * which owns the button); and the panel's first line (`note`), which is what
 * a finger gets, since a tap opens the panel and never the card.
 * docs/plans/261004f-remember-header-profile-icon-only-and-a-card-on-each-sub-mode-chip.md.
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
  regenerate,
}: ProfileState & {
  slug: string;
  /** The mode's forced run, for the panel's Regenerate. See the header for who passes one. */
  regenerate?: Regenerate | undefined;
}) {
  if (!written) return null;
  const Icon = changed ? UserRoundPen : UserRound;
  /* The boxes' own names, as the panel prints them (ProfilePanel.tsx). */
  const boxes = "About you and Why you're reading this one";
  const shows = "Shows your profile, to read or edit here";
  return (
    <ProfilePanel
      slug={slug}
      changed={changed}
      regenerate={regenerate}
      /* `icon-only` is what the stylesheets size (profile.css, and the finger
         floor in narrow-window.css); it is every badge now. */
      className={`prof-badge icon-only${changed ? " changed" : ""}`}
      tip={{
        head: changed ? "Written for an older profile" : "Written for your profile",
        what: changed
          ? `The AI used an earlier version of your profile when it wrote this: ${boxes}, as they were before you last changed them.`
          : `The AI used both parts of your profile, ${boxes}, when it wrote this.`,
        /* The half nobody could guess, as the Help page has it. */
        how: changed
          ? "Nothing is rewritten by itself when your profile changes."
          : "A profile shapes what is chosen and how it is put to you. It never changes what the article says.",
        press: changed && regenerate ? `${shows}, and offers to write this again for it.` : `${shows}.`,
      }}
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
      <Icon size={13} />
    </ProfilePanel>
  );
}
