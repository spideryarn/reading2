/**
 * "Feedback" — the dialog, mounted once, and the triggers that open it.
 *
 * Greg, 2026-08-31: *"I want to add a `Feedback` button somewhere, perhaps
 * top-right."* It began as the mirror image of HomeLogo.tsx in the opposite
 * corner and borrowed that file's mechanism wholesale — read its header first,
 * because the argument for reserving the space is made there in full and only
 * summarised here.
 *
 * ## One dialog, several triggers, and why it is not one component any more
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
 *  - **`FeedbackTrigger`** is a button and its hover card, in one of three
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
 * ## The bars used to reserve the space, and stopped on 2026-09-06
 *
 * The reading view's masthead and controls bar are `100vw`-wide sticky bars that
 * run to the right edge, and the article's own title reaches that edge on any
 * window narrow enough. A fixed button in the corner with nothing reserved for
 * it lands **on top of the title**, so both bars held `--feedback-w + 1.5rem` of
 * right-hand padding open — the mirror of what they held on the left for the
 * wordmark (HomeLogo.tsx).
 *
 * **Both reservations are gone**, because the trigger they were for is in the
 * Dock on the one page those bars are drawn on. What it cost while it stood is
 * worth keeping at its real size rather than a flattering one: 7.5rem above the
 * narrow breakpoint, about **120 CSS pixels** of right-hand gutter, held open on
 * every reading view including ones with no button in them at all — an anonymous
 * reader on a shared article, who has never been offered this dialog. GPT Sol
 * priced it on 2026-09-01 and was right to insist; stage 2 of the plan above is
 * where it came out, together with the 148px on the other side.
 *
 * The trade was still the right one while the button was in the corner, and the
 * reasoning is kept because it is what to reach for if a corner control ever
 * goes back on a page with a sticky bar: an unreserved corner puts a control on
 * top of the article's own title, which is the thing the page exists for, and
 * the alternative to reserving in CSS — a class on `<html>` that the button sets
 * in an effect — is a component reaching up out of itself to change the page's
 * layout.
 *
 * **`.fb-button` still draws in the corner on every page that has no chrome of
 * its own**, and nothing reserves anything for it there, which is safe for the
 * reason HomeLogo.tsx now gives on its own side: those pages have no sticky
 * bars, so there is nothing for a fixed corner to land on top of. Their top
 * spacing is each page's own and there is no shared number — see that file,
 * which carries the whole note.
 *
 * **That set is "no `Dock`" minus the shelf, since 2026-09-08.** The shelf has
 * a masthead cluster of its own, so a fixed corner there was a second top-right
 * competing with the page's first — see `FEEDBACK_SHAPE.masthead`, which has
 * the report that said so. App.tsx names both exclusions in one line.
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
 * the box, and the shapes below are already every way there is.
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
 * Which of the three shapes a trigger wears.
 *
 * **`corner`** is the original: `position: fixed` in the top-right of the
 * window, `--feedback-w` wide. Every page that does not mount a `Dock` draws
 * this one. **The bars no longer hold that width open for it** — they did until
 * stage 2 of the plan above, and the two pages the bars belong to are the two
 * this variant is not drawn on any more, so the reservation had nothing left to
 * reserve for.
 *
 * **`dock`** is a button in the bottom bar, on the pages that do. It is
 * not the corner button rendered somewhere else — a control that carries its
 * own `position: fixed` cannot be re-homed by being moved in the markup, and
 * dropped into the bar it would paint in the top-right corner exactly as it
 * does now, with a "one trigger per route" test passing over a visibly wrong
 * bar. So it takes the bar's own classes, which is also what puts its label
 * under § the bar's fit ladder rather than under the 731px query the corner
 * button's word answers to.
 *
 * **`masthead`** is the shelf's, since 2026-09-08, and it exists for the same
 * reason `dock` does one page further on: the shelf has a chrome cluster of its
 * own, and a fixed corner beside it reads as a second one. The row above
 * `FEEDBACK_SHAPE.masthead` has the report that prompted it.
 */
export type FeedbackVariant = "corner" | "dock" | "masthead";

/**
 * **The three shapes, as a table rather than as ternaries in the markup.**
 *
 * Everything that differs between them is here, and it is six things: the class
 * a test counts this trigger by, the classes the button wears, the class its
 * word wears, how big its glyph is, which way its card opens, and whether that
 * card may flip onto the cross axis.
 *
 * A table because each row is a claim somebody has to be able to check, and two
 * of them are claims a browser is needed to falsify — `placement` and
 * `keepSide` decide where a card is painted, and jsdom has no layout to paint
 * in. Written down here they can at least be *read* by a test
 * (tests/feedback-button-tooltip.test.tsx), which is the difference between a
 * decision that is recorded and one that is only implied by an argument list.
 *
 * **`hook` is the one field that is not about appearance**, and it is here
 * because of what went wrong when the second shape arrived. The rule that there
 * is never more than one trigger on a screen is asserted by counting elements
 * (tests/dock-corner-controls.test.tsx), and that count was a hand-written
 * selector listing the shapes that existed when it was written. A third shape
 * added without touching it would not have broken the test — it would have made
 * the test stop covering a page, silently and greenly, which is the failure
 * docs/reusable/silent-success.md is about. `FEEDBACK_TRIGGER_SELECTOR` below
 * is built from this column, so a fourth shape is counted by existing.
 *
 * `--feedback-w` appears in no row, deliberately. It is the corner button's own
 * width, set on `.fb-button`, and nothing else reads it now; the bar's copy is
 * content-sized, because a 7.5rem fixed-width exception in the row could make a
 * last-rung bar scroll where it would otherwise have fitted. GPT Sol, G7 and T2.
 */
export const FEEDBACK_SHAPE = {
  corner: {
    hook: "fb-button",
    button: "fb-button",
    word: "fb-button-text",
    icon: 15,
    /* Downwards: this button is at the top of the window and there is nothing
       above it. */
    placement: "bottom",
    /* Hard against the right edge, so a 22rem card that cannot centre on it
       would otherwise be thrown onto the cross axis and land *left* of the
       button, over the article's title. */
    keepSide: true,
  },
  dock: {
    hook: "dock-feedback",
    button: "dock-btn dock-feedback",
    word: "dock-btn-label",
    icon: 15,
    /* Upwards: this one is at the *bottom* of the window, and a `bottom` card
       would be drawn under the bar it belongs to. */
    placement: "top",
    /* Inside the row, with room either side, so the ordinary flip is right. */
    keepSide: false,
  },
  /**
   * **The shelf's own masthead row**, since 2026-09-08 — the third shape, and
   * the first that is not chrome fixed to an edge of the window.
   *
   * Greg, 2026-09-07 (SPIDERYARN-READING2-2C): *"Show the Feedback button in
   * the top right of the logged in Homepage"* — filed about a button that was
   * already drawn there. The corner variant was on that page, at every width,
   * with nothing painted over it. What it was not was *findable*: a 15px
   * `--ink-faint` glyph fixed in the window's corner, while the shelf's own
   * `Profile`/`Admin` links — the same colour, the same icon-and-label shape —
   * sat in a cluster about 130px to its left and 20px below. Two top-rights,
   * and the one Greg looked at was the page's.
   *
   * So it takes its neighbours' classes verbatim rather than getting a `fb-`
   * rule of its own. That is the whole point of the row: this control is not
   * meant to be distinguishable from `Profile` beside it, and a stylesheet rule
   * here would be a second place for the two to drift apart.
   * docs/plans/260908e-feedback-button-in-the-shelf-masthead.md.
   *
   * **`word` is empty, and that is a decision rather than an omission.** Both
   * other shapes give the word up when their space runs out — the corner's
   * under the 731px query, the bar's under the fit ladder — and this row does
   * not: it wraps instead (Library.tsx's `flex-wrap`), so the label survives at
   * every width. That is worth having here, because the label is most of what
   * makes this findable at all, and losing it was half of what went wrong with
   * the corner on a phone.
   *
   * `icon` is 13 rather than 15 to match `Profile` and `Admin`, which is the
   * same argument as the classes: it belongs to the row, not to the feature.
   */
  masthead: {
    hook: "fb-masthead",
    /* **`p-0` is not tidiness — it is the difference between matching the row
       and nearly matching it.** The global button reset in tailwind.css takes a
       `<button>`'s border, background and font, deliberately not its
       `line-height` (the note there says why), and **not its padding either**.
       So this button kept the UA's `padding: 1px 6px` while the `<a>`s beside
       it have none: measured on 2026-09-08 at 18px tall against their 16, and
       6px of dead space at each end, which in a right-aligned row shows up as a
       22px gap where every other gap is `gap-4`'s 16.

       The vertical px never mattered — the text baselines aligned exactly
       either way, because the row is `items-baseline` and the glyph is shorter
       than the line box. The horizontal 6px did.

       **And `pointer-coarse:min-h-10` is what `p-0` then owes a finger.** The
       corner button this replaces was 38x44 on a phone; the row's natural
       height is 16. 2.5rem is the floor the dock has had since 2026-08-28 on
       Greg's own ask, and `pointer` rather than `any-pointer` is the
       convention narrow-window.css § a coarse pointer argues — sizes on the
       primary pointer, so an iPad with a trackpad is not given 40px of chrome
       it will never touch. `Profile` and `Admin` carry the same class for the
       reason that file gives about the two order rows: a floor given to one
       control in a row is a bug report about the one beside it. GPT Sol, P2. */
    button:
      "fb-masthead tw:inline-flex tw:items-center tw:gap-1.5 tw:p-0 tw:text-xs tw:text-ink-faint tw:pointer-coarse:min-h-10 tw:hover:text-highlight",
    word: "",
    icon: 13,
    /* Downwards, like the `Profile` and `Admin` cards it shares a
       `TooltipGroup` with — this row is at the top of the page. */
    placement: "bottom",
    /* Its neighbours' setting too. The row is right-aligned and this is its
       last control, so a 22rem card that cannot centre would otherwise flip
       onto the cross axis and land over the shelf's own heading. */
    keepSide: true,
  },
} as const satisfies Record<
  FeedbackVariant,
  { hook: string; button: string; word: string; icon: number; placement: Placement; keepSide: boolean }
>;

/**
 * **Every shape's hook class, as one selector** — the way to ask a rendered
 * page "how many Feedback triggers are on this screen?" without hand-listing
 * the shapes that happened to exist when the question was written.
 *
 * Derived rather than typed out, so the "never two, never none" rule in
 * tests/dock-corner-controls.test.tsx keeps covering every variant as variants
 * are added. See `hook` on the table above for the failure this closes.
 */
export const FEEDBACK_TRIGGER_SELECTOR = Object.values(FEEDBACK_SHAPE)
  .map((shape) => `.${shape.hook}`)
  .join(", ");

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
        /* **Every shape's class string carries its `hook`**, and two of the
           three hooks style nothing on their own — `dock-feedback` the way
           `dock-experimental` next to it does not, and `fb-masthead` not at
           all. They are how a count finds this button among the twenty
           `dock-btn`s or the three masthead controls, which is the rule
           `FEEDBACK_TRIGGER_SELECTOR` above is built on; `dock-feedback` is
           additionally how § the bar's fit ladder finds it.

           No `--feedback-w` outside the corner — that is the corner button's
           own width and nothing else reads it, and a 7.5rem fixed-width
           exception in the bar's row would make a last-rung bar scroll where it
           would otherwise have fitted. GPT Sol, G7 and T2. */
        className={shape.button}
        onClick={api.open}
        /* **The accessible name, now that `title` is not supplying one.**
           Two of the three shapes hide the word at some width — the corner's
           under the 731px query, the bar's under the fit ladder — and
           `display: none` takes it out of the accessibility tree as well as off
           the screen, so without this the button is an unlabelled icon on
           exactly the widths where a tooltip cannot be opened either.

           **The masthead shape never hides it**, and still carries this: the
           name is then the same string twice, which is what a screen reader
           would read anyway, and making the attribute conditional on the
           variant would put a decision in the markup that the table above
           exists to hold. It is also the one thing here that must not depend on
           a `word` class staying non-empty. */
        aria-label="Feedback"
      >
        <MessageSquareWarning size={shape.icon} />
        {/* Given up when the space runs out, the way the wordmark gives up its
            word — styles.css § feedback for the corner, § the bar's fit ladder
            for the bar. The icon and the `aria-label` carry it from there.

            **The masthead shape keeps it at every width**, so its `word` class
            is the empty string: that row wraps rather than shedding controls,
            and the label is most of what makes this one findable. */}
        <span className={shape.word}>Feedback</span>
      </button>
    </Tooltip>
  );
}
