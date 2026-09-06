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
 * docs/research/260828a-public-access-how-others-do-it.md § 2.
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
import { useState } from "react";
import { Lock } from "lucide-react";

import {
  CONTINUE_SIGNED_OUT,
  MAKE_AN_ACCOUNT,
  NOT_SHARED,
  REAUTH_REQUIRED,
  REAUTH_REQUIRED_HEADING,
  SESSION_UNCONFIRMED,
  SESSION_UNCONFIRMED_CHIP,
  SHARED_WITH_YOU,
  SIGN_IN_AGAIN,
  VIEW_ONLY,
} from "../messages.js";
import { FeedbackTrigger } from "./FeedbackButton.js";
import { HomeLogo } from "./HomeLogo.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { LOGIN_HREF } from "./router.js";
import { anAccountWouldHelp, visitorSentence, type VisitorGap } from "./visitor.js";

/**
 * The label, in the sticky controls bar — so it is on screen at every scroll
 * position rather than only on arrival.
 *
 * `.mode` is the bar's class for a word that states rather than acts — it was
 * what "reading"/"outline" and the mode name were drawn with, so this read as
 * one more fact about the page rather than a new kind of thing. Those went on
 * 2026-09-05 (App.tsx § the controls bar) and this chip is now the class's only
 * consumer, which is why styles.css § `.mode` says so: nothing is left to
 * quietly change the shape from underneath it.
 */
export function ViewOnlyChip({ sessionUnconfirmed }: { sessionUnconfirmed: boolean }) {
  return (
    <span
      className="mode on"
      title={sessionUnconfirmed ? SESSION_UNCONFIRMED : SHARED_WITH_YOU}
    >
      <Lock size={11} className="tw:mr-1 tw:inline tw:align-[-1px]" />
      {VIEW_ONLY}
      {/* **The half of the unconfirmed-session state that has to survive a
          narrow window.** `SharedNotice` below carries the sentence and the
          action, and at iPad-portrait and below it is hidden whenever a mode
          band is open (styles.css § a narrow window) — so at that width, with a
          band open, this chip is the only thing left saying why the page has
          gone read-only, and *the action is not reachable at all*. That is a
          stated trade-off rather than an oversight: closing the band brings the
          notice and its button straight back, and the alternative — a third
          piece of chrome that survives the band — is the collision the split
          between these two components exists to avoid.

          Visible text rather than only the `title`, for the reason this file's
          header gives at length: a tooltip is unreachable by touch and by
          keyboard, which is most of the readers who will see this width. */}
      {sessionUnconfirmed && (
        <span className="tw:text-ink-faint"> · {SESSION_UNCONFIRMED_CHIP}</span>
      )}
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
export function SharedNotice({
  signedIn,
  sessionUnconfirmed,
}: {
  signedIn: boolean;
  /**
   * **The owned route answered 401 and the public one answered 200.**
   *
   * Which is to say: this reader's browser still holds a session, we could not
   * get the server to agree it is anybody's, and the article is world-readable
   * regardless. The two facts are independent, so the second one is honoured —
   * the piece stays on screen — and the first is *said*, which is the whole of
   * finding C3. The action is below.
   */
  sessionUnconfirmed: boolean;
}) {
  return (
    /* **`shared-notice` is a hook for one rule and not styling.** In the reading
       view this box sits between the masthead and the controls bar, and at
       iPad-portrait and below `.reader:has(.mode-band) .masthead` is
       `display: none` — the band goes full width and the article's identity
       goes with it (styles.css § a narrow window). Without the same rule here
       the notice became the first element on the page, at `y: 0`, underneath
       the fixed corner logo: measured 2026-08-29 at 820px, logo `(0,0,136,44)`
       against notice `(32,0,768,66)`, both illegible where they crossed.

       Hiding it is right rather than expedient. This is the half of the
       statement that belongs *with the title*, and the title is gone; the half
       that has to survive is the `ViewOnlyChip` in the controls bar, which is
       sticky and stays. That split is why there are two of these at all. */
    <div className="shared-notice tw:mx-auto tw:mb-4 tw:max-w-3xl tw:rounded-md tw:border tw:border-rule tw:bg-surface-raised tw:px-4 tw:py-3 tw:font-sans tw:text-sm tw:text-ink-faint">
      <p className="tw:m-0">{SHARED_WITH_YOU}</p>
      {/* **Beside the statement, not instead of it.** Both sentences are true,
          and the reader arrived for the article rather than for news about
          their session — so the piece is described first and the session
          second. `signedIn` is `true` in this state by construction (the owned
          route is only asked when there is a session), so the `SignUp` block
          below stays hidden: nobody is offered an account they are holding. */}
      {sessionUnconfirmed && (
        <p className="tw:mt-2 tw:mb-0">
          {SESSION_UNCONFIRMED}{" "}
          <ClearDeadSessionButton label={CONTINUE_SIGNED_OUT} />
        </p>
      )}
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
 * **Drop the session this browser is holding, and come back to this address.**
 *
 * The whole action, and it is the same two lines behind both labels — which is
 * why there is one component and a `label` prop rather than two buttons.
 *
 *  - **`scope: "local"`.** Checked against the installed `@supabase/auth-js`
 *    (2.112.4): it removes the stored session even when the revocation call
 *    answers 401, 403 or 404, which is precisely the case we are in. A global
 *    sign-out would also be wrong on the merits — we do not know that anything
 *    is wrong with the *account*, only that this tab cannot prove who it is.
 *  - **The `catch`, and the reload outside it.** A dead session is exactly the
 *    case where a network call may fail, and a throw here would leave the
 *    reader pressing a button that does nothing. The reload is the part that
 *    has to happen; the sign-out is the part that makes it land somewhere new.
 *  - **A reload rather than a re-render**, for `AccountSection`'s reason: it is
 *    the one thing guaranteed to abort every in-flight fetch and drop every
 *    piece of state React is still holding for a reader who has gone.
 *  - **A dynamic import**, so this file's module graph does not reach the
 *    Supabase client. `App.tsx` has already loaded it by the time anybody can
 *    press this, so it costs nothing at run time; what it buys is that
 *    `PublicChrome` can still be rendered on its own by a test — or by anything
 *    else on the visitor path — without a configured project URL.
 *
 * **What it deliberately is not** is an automatic sign-out. A 401 after one
 * refresh is not proof the session is gone (src/web/lib/api.ts says so at the
 * point where it stops retrying), so this is the reader's press or nothing.
 */
function ClearDeadSessionButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { supabase } = await import("./lib/supabase.js");
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      /* Offline, or the auth host is unreachable. The stored session may well
         still be there, and that is survivable: the reload re-asks both routes
         and the reader lands on whichever of these two states is true then. */
    }
    location.reload();
  };
  return (
    <button
      type="button"
      onClick={() => void go()}
      disabled={busy}
      className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-sm tw:font-medium tw:text-highlight tw:underline tw:disabled:opacity-60"
    >
      {label}
    </button>
  );
}

/**
 * **The other row of the C3 table, as a whole page**: the owned route said 401
 * and the public route said 404, so we know neither whose this is nor whether
 * anyone may read it.
 *
 * Its own branch in `ArticlePage` rather than the existing `error` one, which is
 * a corner logo and a `<pre>` with nothing to press — and this is the one state
 * in the app where the reader can actually fix it. Not a link to `/login`
 * either: `App.tsx`'s login route bounces a reader the browser still thinks is
 * signed in straight back to the shelf, which is how this ended up needing a
 * state of its own.
 *
 * Shaped like `NotSharedPage` below on purpose — same logo, same measure, same
 * heading weight — because from the reader's side these are two answers to the
 * same question, and a different-looking page would suggest a different kind of
 * problem.
 */
export function ReauthRequiredPage() {
  /* **Its own tab title, and it took a browser pass to find out why.** This
     borrowed `not-shared` at first, on the reasoning that the tab must not
     confirm an article exists. But *"Not shared"* is itself a claim about the
     document, and this is the one state where we cannot make one — and
     `useDocumentTitle` mirrors the title into an `aria-live` region, so a screen
     reader was announcing it over a page that says something else.
     page-title.ts § reauth-required. */
  useDocumentTitle(pageTitle({ kind: "reauth-required" }));
  return (
    <>
      <HomeLogo />
      {/* **The corner pair, because this page has no bar to put it in.**
          `App.tsx` stopped drawing the corner Feedback trigger on the `read`
          route on 2026-09-06 — the pages that mount a `Dock` draw it in the bar
          — and this is one of the four `ArticlePage` branches that mount none.
          Beside the wordmark rather than inside the `<main>`, because the two
          are a pair: `.logo-home` and `.fb-button` are both fixed in the
          window's top corners, and the bars this page does not have are what
          reserve the room for them (FeedbackButton.tsx § The bars have to
          reserve the space).

          A reader who cannot get past this screen is a plausible reader for a
          bug report, and this is the one state in the app they can actually
          fix — so losing the button here would be losing it exactly where it is
          most likely to be wanted. It draws nothing for a stranger: with no
          session there is no `FeedbackHost` above it. */}
      <FeedbackTrigger variant="corner" />
      <main className="tw:mx-auto tw:max-w-xl tw:px-6 tw:pt-24 tw:font-sans">
        <h1 className="tw:m-0 tw:mb-3 tw:font-prose tw:text-2xl tw:text-foreground">
          {REAUTH_REQUIRED_HEADING}
        </h1>
        <p className="tw:m-0 tw:mb-4 tw:text-sm tw:text-ink-faint">{REAUTH_REQUIRED}</p>
        {/* **The same two lines as *Continue signed out*, under a label that is
            true here and false there.** Signed out at an address nobody has
            shared, the reload reaches `LandingPage` — which draws the sign-in
            controls itself and leaves `/read/:slug` in the address bar, so
            signing in lands the reader back on this piece (auth-return.ts). */}
        <ClearDeadSessionButton label={SIGN_IN_AGAIN} />
        {/* **No `SiteFooter` here, and this comment is the reason it is
            missing.** These two pages have a bottom and would take the row
            happily, and an earlier draft of this change gave it to them: a
            reader told they cannot have this article is a plausible reader for
            "what does this thing do". But they are at a `/read/` address, and
            Greg's exclusion is written about the path — *"NOT on any `/read/*`
            pages"*. A cross-family review called the reinterpretation
            rationalising and was right: the brief is the brief until Greg says
            otherwise, and this is the cheap direction to be wrong in.
            SiteFooter.tsx § Where it goes. */}
      </main>
    </>
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
  /* The tab, which this page did not set until 2026-08-30 — see the
     `not-shared` variant in page-title.ts for what went wrong without it. It
     says what the heading below says and nothing more: the tab must not be the
     thing that confirms an article exists. */
  useDocumentTitle(pageTitle({ kind: "not-shared" }));
  return (
    <>
      <HomeLogo />
      {/* The corner pair, for the reason `ReauthRequiredPage` gives above — and
          here the reader is always signed in (a stranger gets the landing page),
          so the trigger is always drawn. */}
      <FeedbackTrigger variant="corner" />
      <main className="tw:mx-auto tw:max-w-xl tw:px-6 tw:pt-24 tw:font-sans">
        <h1 className="tw:m-0 tw:mb-3 tw:font-prose tw:text-2xl tw:text-foreground">
          Not shared
        </h1>
        <p className="tw:m-0 tw:text-sm tw:text-ink-faint">{NOT_SHARED}</p>
        {/* No footer, for the reason `ReauthRequiredPage` gives above. */}
      </main>
    </>
  );
}
