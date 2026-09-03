/**
 * "Feedback", fixed in the top-right of the window, and the dialog behind it.
 *
 * Greg, 2026-08-31: *"I want to add a `Feedback` button somewhere, perhaps
 * top-right."* The mirror image of HomeLogo.tsx in the opposite corner, and it
 * borrows that file's mechanism wholesale — read its header first, because the
 * argument for reserving the space is made there in full and only summarised
 * here.
 *
 * ## Who sees it
 *
 * **Signed-in readers only**, and the condition is written in App.tsx rather
 * than here, so that "who may file a report" is one visible line next to the
 * gate that decides everything else about being signed in. A stranger reading a
 * shared article has nowhere for a report to go — the row is owner-scoped — and
 * the route answers them 401 whatever the client renders.
 *
 * **A hidden button is not a gate**, which is why there are two tests and not
 * one: that this does not render for an anonymous reader, and that
 * `POST /api/feedback` still refuses them. GPT Sol asked for both.
 *
 * ## The bars have to reserve the space
 *
 * The reading view's masthead and controls bar are `100vw`-wide sticky bars that
 * run to the right edge, and the article's own title reaches that edge on any
 * window narrow enough. A fixed button in the corner with nothing reserved for
 * it lands **on top of the title** — the same failure HomeLogo.tsx describes on
 * the left, in the same two bars, and the fix is the same shape:
 * `padding-right` that makes room for `--feedback-w`.
 *
 * It is simpler than the left-hand expression, and the reason is worth stating
 * so nobody adds the missing terms back. The left one subtracts `--spine-w` and
 * `--mode-w` because those bars are *positioned* at
 * `left: calc(--spine-w + --mode-w)`, so the wordmark only reaches into them by
 * whatever is left over. Nothing is positioned against the right edge but
 * `--safe-right`, which both the bar and this button already sit inside, so the
 * button reaches exactly `--feedback-w` in and there is nothing to subtract.
 *
 * **The space is reserved whether or not the button is rendered**, and that is a
 * decision rather than an oversight. The alternative — a class on `<html>` that
 * the button sets in an effect — is a component reaching up out of itself to
 * change the page's layout.
 *
 * **The cost is larger than an earlier draft of this comment admitted**, and it
 * is worth stating at its real size rather than at a flattering one: above the
 * narrow breakpoint that is `--feedback-w` = 7.5rem, about **120 CSS pixels** of
 * right-hand gutter held open on a page that has no button in it — an anonymous
 * reader on a shared article. Not "a few millimetres", and not reliably just one
 * earlier word wrap. GPT Sol, 2026-09-01, and it was right to insist.
 *
 * It is still the trade to take, because the failure it buys off is worse than a
 * wide gutter: an unreserved corner puts a control on top of the article's own
 * title, which is the thing the page exists for. If shared articles ever become
 * a common way in rather than an occasional link, that is the moment to revisit
 * it — and the fix then is a rule scoped to the signed-out shell, not an effect.
 */
import { useState } from "react";
import { MessageSquareWarning } from "lucide-react";

import { FeedbackDialog } from "./FeedbackDialog.js";
import { useRoute } from "./router.js";
import { ControlTip, Tooltip } from "./Tooltip.js";

interface Props {
  /** Shown in the dialog, never sent — the server takes the address from the auth gate. */
  readerEmail: string | null;
}

/**
 * **Where they were, as the address bar has it.**
 *
 * This was a `Record<Route["kind"], FeedbackRouteKind>` until 2026-09-02 — an
 * exhaustive map from the router's union onto a ten-value vocabulary that the
 * server, `src/types.ts` and a SQL CHECK each held their own copy of. Greg
 * removed it: *"I think it's fine (and even advantageous) to store the url with
 * the Feedback - if that means we can get rid of the route_kind and simplify
 * things"*.
 *
 * The exhaustive map was doing one job well — adding a route to the app was a
 * compile error until somebody said what a report from it should be called —
 * and one badly, which was costing a database migration per page. `/privacy`
 * shipped filing its reports as `unknown` rather than pay it. The compile error
 * is gone with it, and nothing replaces it, because there is nothing left to
 * decide: every page has an address.
 *
 * `location.href` and not a reconstruction, because the point of it is to be
 * what the reader was actually looking at, query string and all. The server
 * still refuses anything that is not an `http(s)` address (`isWebUrl`), and
 * docs/project/privacy.md § What a bug report carries tells the reader this
 * happens.
 */

export function FeedbackButton({ readerEmail }: Props) {
  const route = useRoute();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* **A card rather than the `title` attribute it replaced**, on Greg's ask
          of 2026-09-03. `title` waits about a second, cannot be styled,
          truncates at the OS's idea of a line, and does not exist on a touch
          device at all — docs/project/tooltips.md § `ControlTip`, whose rule
          against `title` two other test files already assert; this one is the
          third (tests/feedback-button-tooltip.test.tsx).

          `keepSide` because this button is hard against the right edge, and a
          22rem card that cannot centre on it would otherwise be thrown onto the
          cross axis and land *left* of the button, over the article's title.
          Bottom, because there is nothing above it. */}
      <Tooltip
        placement="bottom"
        keepSide
        className="tip-soon"
        content={
          <ControlTip
            head="Feedback"
            what="Opens a box for a bug or a suggestion about whatever you were just doing."
            /* The unguessable half, and it is the half a reader hesitates
               over: what rides along with their words.

               **Three things go, on three different conditions, and an earlier
               draft of this line collapsed them into two.** The address and the
               email are unconditional; the diagnostics blob is the tick-box's
               and nothing else's; the screenshot is sent whenever the reader
               attached one, tick-box or not (FeedbackDialog.tsx builds the body
               with `screenshot` outside the `consented` branch). GPT Sol caught
               the version that promised the box covered the screenshot too —
               and a tooltip that over-promises about privacy is worse than one
               that says nothing, because the reader acts on it.
               docs/project/privacy.md § What a bug report carries. */
            how="It carries this page's address and your email address, so we can write back. Extra diagnostics go only if you tick the box, and a screenshot only if you attach one."
          />
        }
      >
        <button
          type="button"
          className="fb-button"
          onClick={() => setOpen(true)}
          /* **The accessible name, now that `title` is not supplying one.**
             Below the narrow breakpoint the word is `display: none`, which
             takes it out of the accessibility tree as well as off the screen —
             so without this the button is an unlabelled icon on exactly the
             widths where a tooltip cannot be opened either. */
          aria-label="Feedback"
        >
          <MessageSquareWarning size={15} />
          {/* Given up below the narrow breakpoint, the way the wordmark gives
              up its word — styles.css § feedback. The icon and the
              `aria-label` carry it from there. */}
          <span className="fb-button-text">Feedback</span>
        </button>
      </Tooltip>
      <FeedbackDialog
        open={open}
        onClose={() => setOpen(false)}
        readerEmail={readerEmail}
        where={{
          url: location.href,
          /* **The slug stays, beside the URL rather than inside it.** It is
             validated, it is the join onto an article, and "how many reports
             mention this piece" should be a `WHERE` rather than a `LIKE` over
             an address — docs/project/sql.md. Deriving it from the URL later
             would be a second parser for a fact the client already has. */
          slug: route.kind === "read" ? route.slug : null,
        }}
      />
    </>
  );
}
