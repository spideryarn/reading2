/**
 * **The read-only chrome**: what a visitor sees instead of the controls they do
 * not have, and the one action that is available across the boundary.
 *
 * Every sentence here comes from src/messages.ts and every decision about
 * *which* sentence comes from visitor.ts. This file is the drawing.
 *
 * ## Two rules from the research, and they pull in opposite directions
 *
 * **Say it out loud.** Only Google Docs uses a literal, persistent, non-dismissible
 * read-only label — *"View only"*. Notion and Craft communicate read-only-ness
 * by what is *missing* from the chrome, which is no use to a stranger who has
 * never seen the editable version and has no baseline to notice an absence. So
 * there is a label, it is a statement rather than a notification, and there is
 * no way to close it.
 *
 * **The reason must not live only in a tooltip.** NN/G: *"Important information
 * should always be on the screen; therefore, tooltips shouldn't be essential for
 * the tasks users need to accomplish."* Worse for a marked control specifically:
 * a hover tooltip is unreachable by touch and by keyboard, so on a phone a
 * dimmed button with its explanation in a `title` is a dead thing with no
 * explanation at all. For a signed-in reader meeting *not built yet* a tooltip
 * is a supplement to something they already understand; for a stranger meeting
 * *not yours yet* it is the entire message.
 * docs/research/public-access-how-others-do-it.md § 2.
 *
 * So a marked mode here is still **pressable**, and pressing it opens a band
 * carrying the sentence in visible text. That is what makes the reason
 * reachable by touch, by keyboard and by a screen reader — the three routes a
 * tooltip closes off — and it beats a dimmed control that answers a press with
 * nothing.
 *
 * ## Where the sign-up line goes
 *
 * Beside the specific thing the visitor has just found they could not do, and
 * nowhere else. Not a banner across the top, which the eye stops seeing. The
 * ask is *"make a free account"* rather than *"unlock this page"*: the New York
 * Times' own reported figure is that free registration lifted paid conversion by
 * more than 40%, ahead of any change to the meter, and Substack pitches the
 * ongoing free thing rather than the one document.
 *
 * And it is **withheld** where an account would not in fact help —
 * `anAccountWouldHelp` in visitor.ts. An offer that would not have worked is
 * worse than no offer.
 */
import { Lock } from "lucide-react";

import {
  MAKE_AN_ACCOUNT,
  NOT_SHARED,
  SHARED_WITH_YOU,
  VIEW_ONLY,
} from "../messages.js";
import { HomeLogo } from "./HomeLogo.js";
import { Link } from "./Link.js";
import { LOGIN_HREF } from "./router.js";
import { anAccountWouldHelp, visitorSentence, type VisitorGap } from "./visitor.js";

/**
 * The label, in the sticky controls bar — so it is on screen at every scroll
 * position rather than only on arrival.
 *
 * `.mode` is the bar's existing class for a word that states rather than acts;
 * it is what "reading"/"outline" and the mode name are already drawn with, so
 * this reads as one more fact about the page instead of a new kind of thing.
 */
export function ViewOnlyChip() {
  return (
    <span className="mode on" title={SHARED_WITH_YOU}>
      <Lock size={11} className="tw:mr-1 tw:inline tw:align-[-1px]" />
      {VIEW_ONLY}
    </span>
  );
}

/**
 * The fuller statement, under the masthead, where a visitor's eye already is on
 * arrival.
 *
 * Not dismissible and not a toast: it is what this page *is*, and a control to
 * make it go away would say otherwise.
 */
export function SharedNotice({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="tw:mx-auto tw:mb-4 tw:max-w-3xl tw:rounded-md tw:border tw:border-rule tw:bg-surface-raised tw:px-4 tw:py-3 tw:font-sans tw:text-sm tw:text-ink-faint">
      <p className="tw:m-0">{SHARED_WITH_YOU}</p>
      {/* **What an account actually gets them**, and it is not this article.
          The offer used to promise chat, a glossary and a shelf entry *for this
          piece* — none of which an account provides until stage 3 lets a second
          reader hold the same document. GPT Sol, 2026-08-28. */}
      {!signedIn && <SignUp reason="to read your own articles this way" />}
    </div>
  );
}

/**
 * The band a marked mode opens.
 *
 * Deliberately shaped like the panels it stands in for — same `.mode-band`
 * shell, same width, same place — so pressing Glossary moves the layout exactly
 * as it would for a reader who has one. A mode that answered a press by doing
 * nothing at all would read as broken.
 */
export function VisitorBand({ gap, signedIn }: { gap: VisitorGap; signedIn: boolean }) {
  return (
    <aside className="mode-band" aria-label="Not available on a shared link">
      <div className="tw:flex tw:flex-1 tw:flex-col tw:justify-center tw:gap-3 tw:px-4 tw:py-6 tw:text-sm tw:text-ink-faint">
        <p className="tw:m-0 tw:text-ink">{visitorSentence(gap)}</p>
        {offerAnAccount(gap, signedIn) && <SignUp reason="to read your own articles this way" />}
      </div>
    </aside>
  );
}

/**
 * The same sentence, for the two places that are not a mode band: the drawer
 * where the owner's comments would be, and the tweets page.
 */
export function VisitorNotice({ gap, signedIn }: { gap: VisitorGap; signedIn: boolean }) {
  return (
    <div className="tw:flex tw:flex-col tw:gap-3 tw:px-1 tw:py-4 tw:font-sans tw:text-sm tw:text-ink-faint">
      <p className="tw:m-0 tw:text-ink">{visitorSentence(gap)}</p>
      {offerAnAccount(gap, signedIn) && <SignUp reason="to read your own articles this way" />}
    </div>
  );
}

/**
 * **Whether to put the offer in front of this particular reader**, which is two
 * questions and not one.
 *
 * `anAccountWouldHelp` asks whether an account is the fix *for this gap* — it
 * is not, for an artefact waiting on slice 1b or for somebody else's comments.
 * This adds the second: whether the reader has one already. Both have to be
 * true, and they fail for different reasons — the first would be a promise we
 * break, the second an offer of something they are holding.
 *
 * Note what is NOT gated on `signedIn`: the sentence. The reason a control is
 * unavailable is shown to everybody, because it is a fact about the page rather
 * than a pitch. Only the ask is conditional.
 */
function offerAnAccount(gap: VisitorGap, signedIn: boolean): boolean {
  return !signedIn && anAccountWouldHelp(gap);
}

/**
 * The ask.
 *
 * `reason` is the half that makes it specific — *"Make a free account to ask
 * this article questions"* rather than a standing pitch. It is rendered as
 * visible text beside the link and not as its `title`, for the same reason
 * every other explanation on this page is.
 */
export function SignUp({ reason }: { reason: string }) {
  return (
    <p className="tw:m-0">
      <Link href={LOGIN_HREF} className="tw:font-medium tw:text-highlight">
        {MAKE_AN_ACCOUNT}
      </Link>{" "}
      {reason}.
    </p>
  );
}

/**
 * **The third sentence, as a whole page**: signed in, and this document is not
 * shared with anybody.
 *
 * A stranger never reaches this — they get the landing page, exactly as they do
 * at every other address they are not entitled to, so there is one signed-out
 * page rather than two (App.tsx). Somebody signed in has already proved they
 * are a person, so there is nothing left to protect by showing them the pitch
 * instead of the answer.
 *
 * It does not confirm that the article exists, and `NOT_SHARED` is written so
 * that the advice it gives is conditional for the same reason: a slug you do not
 * own is a 404 rather than a 403, and that rule does not stop applying because
 * the reader is friendly.
 */
export function NotSharedPage() {
  return (
    <>
      <HomeLogo />
      <main className="tw:mx-auto tw:max-w-xl tw:px-6 tw:pt-24 tw:font-sans">
        <h1 className="tw:m-0 tw:mb-3 tw:font-prose tw:text-2xl tw:text-foreground">
          Not shared
        </h1>
        <p className="tw:m-0 tw:text-sm tw:text-ink-faint">{NOT_SHARED}</p>
      </main>
    </>
  );
}
