/**
 * "Feedback" — the dialog, mounted once, and the two triggers that open it.
 *
 * Greg, 2026-08-31: *"I want to add a `Feedback` button somewhere, perhaps
 * top-right."* It began as the mirror image of HomeLogo.tsx in the opposite
 * corner and borrowed that file's mechanism wholesale — read its header first,
 * because the argument for reserving the space is made there in full and only
 * summarised here.
 *
 * ## One dialog, two triggers, and why it is not one component any more
 *
 * It was one component until 2026-09-06: a button that owned the `open` state
 * *and* mounted `FeedbackDialog`. That shape cannot survive the dialog's own
 * rule, which FeedbackDialog.tsx states at the top of itself — it **is mounted
 * for the whole life of the page**, open or shut, because that is what lets a
 * half-written report, an attached screenshot and an in-flight send survive
 * anything else on the page changing. Put such a component inside the `Dock`
 * and the Dock's own unmounts destroy all three: loading → ready, article →
 * metadata → tweets.
 *
 * So it splits, and the split is the whole of GPT Sol's P0 on
 * docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md:
 *
 *  - **`FeedbackHost`** wraps the signed-in app, holds the `open` state and the
 *    dialog, and offers `open()` through a context whose value is stable, so a
 *    press does not re-render every consumer.
 *  - **`FeedbackTrigger`** is a button and its hover card, in one of two
 *    shapes, and does nothing but call `open()`.
 *
 * **Not a portal**, which is the other way a single component could have been
 * rendered in the bar. The Dock's slot does not exist on the render that would
 * need it, so a portal costs a second render — and hands `useDockFit` a bar
 * with the button missing to measure, which leaves the row on a rung chosen for
 * a narrower bar than the one on screen (dock-fit.ts § when it re-measures).
 *
 * ## Who sees it
 *
 * **Signed-in readers only**, and the condition is written in App.tsx rather
 * than here, so that "who may file a report" is one visible line next to the
 * gate that decides everything else about being signed in. A stranger reading a
 * shared article has nowhere for a report to go — the row is owner-scoped — and
 * the route answers them 401 whatever the client renders.
 *
 * That line is now the **host's** mount point rather than the button's, and the
 * rule survives the move intact: a trigger with no host above it renders
 * nothing (see `FeedbackTrigger`). `VisitorDock` in PublicPages.tsx draws a bar
 * for a signed-out stranger, so the bar's trigger carries its own explicit gate
 * as well — Dock.tsx § the app cluster.
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
 *
 * **And on the pages that mount a `Dock` the trigger has left the corner while
 * the reservation has not yet followed it.** That is the intended intermediate
 * state of stage 1 rather than an oversight: those pages currently hold
 * ~120px of right-hand gutter open for a button that is now in the bar at the
 * bottom. Stage 2 of the plan above is where the reservation comes out, and it
 * is the visible half of the work.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
/* Type only, so that the two `placement` strings in `FEEDBACK_SHAPE` below are
   checked against the vocabulary `Tooltip` actually accepts rather than being
   two hopeful literals. */
import type { Placement } from "@floating-ui/react";
import { MessageSquareWarning } from "lucide-react";

import { FeedbackDialog } from "./FeedbackDialog.js";
import { useRoute } from "./router.js";
import { ControlTip, Tooltip } from "./Tooltip.js";

/** What a trigger may do, and it is the whole of the contract: open the box. */
interface FeedbackApi {
  open(): void;
}

/**
 * `null` means **there is no host above this trigger**, which is the ordinary
 * signed-out case rather than a mistake — App.tsx mounts the host below the
 * signed-in gate. A trigger that finds `null` renders nothing.
 *
 * Deliberately not exported. A second consumer would be a second way to open
 * the box, and the two shapes below are already every way there is.
 */
const FeedbackContext = createContext<FeedbackApi | null>(null);

/**
 * **The dialog, mounted once for the whole life of the signed-in app.**
 *
 * A wrapper rather than a sibling, because a context provider has to be an
 * ancestor of the things that read it. What it wraps is every signed-in page,
 * so a navigation inside the app — including the reading view's article →
 * metadata → tweets loop, which unmounts the `Dock` — leaves the dialog and its
 * draft exactly where they were.
 */
export function FeedbackHost({ children }: { children: ReactNode }) {
  const route = useRoute();
  const [open, setOpen] = useState(false);
  /* **Stable**, so that opening the box does not re-render the bar and every
     button in it. `setOpen` is itself stable, so an empty dependency list is
     honest rather than a lie the linter happens to accept. */
  const api = useMemo<FeedbackApi>(() => ({ open: () => setOpen(true) }), []);
  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {/* **Where they were, as the address bar has it.**

          This was a `Record<Route["kind"], FeedbackRouteKind>` until 2026-09-02
          — an exhaustive map from the router's union onto a ten-value
          vocabulary that the server, `src/types.ts` and a SQL CHECK each held
          their own copy of. Greg removed it: *"I think it's fine (and even
          advantageous) to store the url with the Feedback - if that means we
          can get rid of the route_kind and simplify things"*.

          The exhaustive map was doing one job well — adding a route to the app
          was a compile error until somebody said what a report from it should
          be called — and one badly, which was costing a database migration per
          page. `/privacy` shipped filing its reports as `unknown` rather than
          pay it. The compile error is gone with it, and nothing replaces it,
          because there is nothing left to decide: every page has an address.

          `location.href` and not a reconstruction, because the point of it is
          to be what the reader was actually looking at, query string and all.
          The server still refuses anything that is not an `http(s)` address
          (`isWebUrl`), and docs/project/privacy.md § What a bug report carries
          tells the reader this happens.

          **Computed here and not in a trigger**, since the split: the host
          reads `useRoute()` once, so two triggers on one page cannot disagree
          about which article a report is against. */}
      <FeedbackDialog
        open={open}
        onClose={() => setOpen(false)}
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
    </FeedbackContext.Provider>
  );
}

/**
 * Which of the two shapes a trigger wears.
 *
 * **`corner`** is the original: `position: fixed` in the top-right of the
 * window, `--feedback-w` wide, with the bars holding that width open for it.
 * Every page that does not mount a `Dock` draws this one.
 *
 * **`dock`** is a button in the bottom bar, on the pages that do. It is
 * not the corner button rendered somewhere else — a control that carries its
 * own `position: fixed` cannot be re-homed by being moved in the markup, and
 * dropped into the bar it would paint in the top-right corner exactly as it
 * does now, with a "one trigger per route" test passing over a visibly wrong
 * bar. So it takes the bar's own classes, which is also what puts its label
 * under § the bar's fit ladder rather than under the 731px query the corner
 * button's word answers to.
 */
export type FeedbackVariant = "corner" | "dock";

/**
 * **The two shapes, as a table rather than as three ternaries in the markup.**
 *
 * Everything that differs between them is here, and it is four things: the
 * classes the button wears, the class its word wears, which way its card opens,
 * and whether that card may flip onto the cross axis.
 *
 * A table because each row is a claim somebody has to be able to check, and two
 * of them are claims a browser is needed to falsify — `placement` and
 * `keepSide` decide where a card is painted, and jsdom has no layout to paint
 * in. Written down here they can at least be *read* by a test
 * (tests/feedback-button-tooltip.test.tsx), which is the difference between a
 * decision that is recorded and one that is only implied by an argument list.
 *
 * `--feedback-w` appears in neither row, deliberately. It is the corner's
 * reservation and it comes from `.fb-button`; the bar's copy is content-sized,
 * because a 7.5rem labelled exception in the row could make a last-rung bar
 * scroll where it would otherwise have fitted. GPT Sol, G7.
 */
export const FEEDBACK_SHAPE = {
  corner: {
    button: "fb-button",
    word: "fb-button-text",
    /* Downwards: this button is at the top of the window and there is nothing
       above it. */
    placement: "bottom",
    /* Hard against the right edge, so a 22rem card that cannot centre on it
       would otherwise be thrown onto the cross axis and land *left* of the
       button, over the article's title. */
    keepSide: true,
  },
  dock: {
    button: "dock-btn dock-feedback",
    word: "dock-btn-label",
    /* Upwards: this one is at the *bottom* of the window, and a `bottom` card
       would be drawn under the bar it belongs to. */
    placement: "top",
    /* Inside the row, with room either side, so the ordinary flip is right. */
    keepSide: false,
  },
} as const satisfies Record<
  FeedbackVariant,
  { button: string; word: string; placement: Placement; keepSide: boolean }
>;

export function FeedbackTrigger({ variant }: { variant: FeedbackVariant }) {
  const api = useContext(FeedbackContext);
  /* **No host, no button** — a signed-out reader, for whom App.tsx mounts no
     host. Rendering nothing rather than throwing, because that reader is the
     ordinary case and not a programming error: `ArticlePage`'s loading and
     error screens are drawn for strangers on a shared link, and they ask for
     this trigger unconditionally. The gate is still App.tsx's one line; this is
     what makes it reach the triggers it cannot see. */
  if (api === null) return null;
  const shape = FEEDBACK_SHAPE[variant];
  return (
    /* **A card rather than the `title` attribute it replaced**, on Greg's ask
       of 2026-09-03. `title` waits about a second, cannot be styled,
       truncates at the OS's idea of a line, and does not exist on a touch
       device at all — docs/project/tooltips.md § `ControlTip`, whose rule
       against `title` two other test files already assert; this one is the
       third (tests/feedback-button-tooltip.test.tsx).

       Where it opens and whether it may flip are `FEEDBACK_SHAPE`'s, above,
       which is where both are argued. */
    <Tooltip
      placement={shape.placement}
      keepSide={shape.keepSide}
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
        /* **`dock-feedback` styles nothing on its own**, the way
           `dock-experimental` next to it does not: it is how § the bar's fit
           ladder finds this button, and how a test finds one button among
           twenty that are all `dock-btn`. No `--feedback-w` here — that width
           is the corner's reservation, and a 7.5rem labelled exception in the
           row would make a last-rung bar scroll where it would otherwise have
           fitted. GPT Sol, G7. */
        className={shape.button}
        onClick={api.open}
        /* **The accessible name, now that `title` is not supplying one.**
           Both shapes hide the word at some width — the corner's under the
           731px query, the bar's under the fit ladder — and `display: none`
           takes it out of the accessibility tree as well as off the screen, so
           without this the button is an unlabelled icon on exactly the widths
           where a tooltip cannot be opened either. */
        aria-label="Feedback"
      >
        <MessageSquareWarning size={15} />
        {/* Given up when the space runs out, the way the wordmark gives up its
            word — styles.css § feedback for the corner, § the bar's fit ladder
            for the bar. The icon and the `aria-label` carry it from there. */}
        <span className={shape.word}>Feedback</span>
      </button>
    </Tooltip>
  );
}
