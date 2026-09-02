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

import type { FeedbackRouteKind } from "../types.js";
import { FeedbackDialog } from "./FeedbackDialog.js";
import { useRoute } from "./router.js";

interface Props {
  /** Shown in the dialog, never sent — the server takes the address from the auth gate. */
  readerEmail: string | null;
}

/**
 * The route the reader is on, in the closed vocabulary the table stores.
 *
 * `FEEDBACK_ROUTE_KINDS` in src/types.ts mirrors `Route["kind"]` by hand — the
 * server and src/db/schema.ts import that file and cannot import the router —
 * and the two are held together by the exhaustive map below rather than by
 * hope: add a route and this stops compiling.
 *
 * `unknown` is in the vocabulary on purpose and is never produced here. It is
 * there so that a report from a page added later still has somewhere to land,
 * because a report that cannot be filed because the reader was on a new page is
 * the worst way to lose the one that mattered.
 */
const ROUTE_KINDS: Record<ReturnType<typeof useRoute>["kind"], FeedbackRouteKind> = {
  library: "library",
  read: "read",
  add: "add",
  "add-upload": "add-upload",
  design: "design",
  profile: "profile",
  admin: "admin",
  login: "login",
  callback: "callback",
  /* **The one page that files as `unknown`, deliberately and temporarily.**
     Adding `"privacy"` to the vocabulary means widening the CHECK on
     `feedback.route_kind`, and that migration was written and then held back
     on 2026-09-02: the journal it would land in also carries another agent's
     in-flight migration, so committing mine would publish a journal entry
     whose `.sql` nobody else has. Greg's call — wait for theirs to land.

     `unknown` is exactly what this costs, and the comment above says why it is
     survivable: a report filed under the wrong label is recoverable, a report
     refused by a constraint is not. What it loses is the ability to count bug
     reports from the policy page, which is not a thing anybody wants to count.

     **The follow-up is a one-line migration**: add `'privacy'` to
     `FEEDBACK_ROUTE_KINDS` (src/types.ts), to the CHECK in src/db/schema.ts,
     and change this line. docs/project/website-text.md § What is still open. */
  privacy: "unknown",
};

export function FeedbackButton({ readerEmail }: Props) {
  const route = useRoute();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="fb-button"
        onClick={() => setOpen(true)}
        title="Send feedback about this page"
      >
        <MessageSquareWarning size={15} />
        {/* Given up below the narrow breakpoint, the way the wordmark gives up
            its word — styles.css § feedback. The icon and the title attribute
            carry it from there. */}
        <span className="fb-button-text">Feedback</span>
      </button>
      <FeedbackDialog
        open={open}
        onClose={() => setOpen(false)}
        readerEmail={readerEmail}
        where={{
          routeKind: ROUTE_KINDS[route.kind],
          /* The slug and nothing else off the address. Never `location.href`:
             in this app it carries `?q=` and `?find=`, which are the reader's
             own typing, and `/add/<a whole third-party URL>`, which may carry a
             credential. The plan's § Always — where they were has the argument,
             and src/feedback-payload.ts enforces it a second time. */
          slug: route.kind === "read" ? route.slug : null,
        }}
      />
    </>
  );
}
