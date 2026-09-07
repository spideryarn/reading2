/**
 * The bottom bar, and the drawer that rises out of it.
 *
 * The app's furniture: the things that are about *this article* but are not the
 * article — the questions you have asked, where it came from, what else it can
 * be turned into. Everything here is one click from the reading view and none
 * of it is in the way of it.
 *
 * ## The way home is back, and the honest reason is not the one first offered
 *
 * It was the leftmost button until 2026-08-26, when Greg took it out —
 * *"the way out of a document is not one of the things the document can be"* —
 * and it became the wordmark fixed in the very top-left of the window
 * (HomeLogo.tsx). Since 2026-09-06 it is `DockHome`, at the left-hand end of
 * this bar again, and the corner is being abolished
 * (docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md).
 *
 * **The tempting argument for that is wrong and is written down here so nobody
 * reaches for it again.** I first said a wordmark is a different kind of thing
 * from a `Home` button; Fable called that half invented, and it is. It is still
 * a link out of the article, in the slot Greg emptied.
 *
 * What has actually changed is **the bar**. It had one kind of button then and
 * has three now, one of them explicitly app-level (the experimental switch, the
 * only button in the bar that is about the app rather than about this article).
 * And the modes have grown a hairline frame of their own — `.dock-modes` is
 * what says *these are the things the document can be*, so a control outside
 * that frame is not making the claim Greg objected to. The markup says it three
 * ways: outside the `role="radiogroup"`, a `Link` rather than an `aria-checked`
 * button, and never `.dock-btn.on`. Meanwhile the better place that took the way
 * home off this bar — a free top-left corner — stops existing on these pages.
 *
 * The Feedback button makes the same move at the other end, and both are drawn
 * only where there is a bar to draw them in: every page without a `Dock` keeps
 * its corners exactly as they were.
 *
 * ## Why the bottom
 *
 * This started as a left-hand sidebar, modelled on the original version's icon
 * rail (docs/project/original-version/reading-view-ui.md). Greg, 2026-08-25:
 *
 * > What's the alternative? I suppose we could put it at the bottom? Would that
 * > be simpler to implement? If so, let's do that for now.
 *
 * It is simpler, and for one reason worth stating plainly: **this view's hard
 * problem is horizontal and the bottom edge is vertical.** layout.ts spends its
 * whole length negotiating width — it shrinks the gist columns, and when that
 * is not enough it starts dropping levels. Anything permanent down the left
 * joins that negotiation: a new `--rail-w` term in five CSS rules, a new
 * constant beside `SPINE_W`, a new interaction with the spine's on/off,
 * and a band of window widths where a column is dropped that used to fit. A bar
 * at the bottom takes height, and height is the axis where nothing is scarce —
 * the page simply scrolls. `fitView` never hears about this file.
 *
 * Full reasoning, and the right-hand edge that was offered and turned down:
 * docs/plans/260825c-bottom-bar.md.
 *
 * ## The three things that had to move over
 *
 *  - `.cmt-dialog` sits bottom-right and would have been half under the bar.
 *  - the "there is more over here" fade ran to `bottom: 0`.
 *  - `.tooltip` was at z-index 80, under the drawer — see the note on Z below.
 *
 * ## Three kinds of button, said out loud
 *
 * The bar used to be uniform: every button opened a drawer. It isn't any more.
 * `Tweets` and `Metadata` navigate; `Questions` opens a drawer *on the
 * reading view* and navigates everywhere else; `Hierarchy` / `Summary` /
 * `Glossary` / `Search` / `Chat`
 * choose what the middle of the page **is**. That is three real differences and
 * the markup has to tell the truth about each — a link gets
 * `aria-current="page"`, a drawer trigger gets `aria-expanded`, and the mode
 * switch is a `role="radiogroup"` of `aria-checked` buttons, because exactly one
 * of the three is always true. Using any one of them for another kind announces
 * the wrong thing to a screen reader while looking identical on screen. Hence
 * `DockLink`, `DockTab` and `DockModes` below rather than one component with
 * flags.
 *
 * **The bar looks the same on all three pages and is not the same component
 * twice.** What varies is whether a `drawer` was handed in. Only the reading
 * view has the comments, because only it pays for them: `useComments(slug)`
 * fetches on mount, and a visit to the metadata page should not buy a drawer
 * nobody opened. So off the reading view, Questions is a link back to it with
 * `?panel=questions` — which is also where a question is worth opening, since
 * clicking one scrolls to the passage it is about.
 *
 * The button was `About` and became a link on 2026-08-25, when its drawer panel
 * grew into a page of its own at `/read/<slug>/metadata`. It is labelled
 * `Metadata` now, after the page it opens, rather than after the panel it was.
 * Greg, on what should happen to the panel once the page existed:
 *
 * > We can get rid of the panel, and move all its contents into the new page.
 *
 * So there is no About panel here any more, and the markup it used to render
 * lives in Metadata.tsx. See docs/plans/260825e-metadata-page.md.
 *
 * ## The order, which Greg set by hand
 *
 * Left to right: Hierarchy, Summary, Glossary, Search, Chat, Questions, Tweets,
 * Metadata. Greg, 2026-08-26 — *"Rearrange the buttons in the bottom-bar. It
 * should be Hierarchy, Summary, Glossary, Search, Chat, Questions, Thread
 * (renamed to 'Tweets'), Metadata."*
 *
 * It is not arbitrary, and the shape is worth naming so the next button knows
 * where to go: **the five modes come first, then the things that leave the
 * band.** Inside the modes it runs from the article's own words outwards —
 * Hierarchy and Summary are the article restated, Glossary and Search are ways
 * into it, Chat is a conversation about it. Then Questions (yours), Tweets
 * (the article rewritten for somewhere else) and Metadata (the machinery).
 * A new mode goes in MODES_UI, **and the compiler now asks for it** — a `Mode`
 * with no row there is a typecheck error, not a button nobody notices is
 * missing (`ModesMissingFromDock`). Anything else goes after them.
 *
 * ## And a second rule, which is *whether* a button is drawn at all
 *
 * Since 2026-09-03 the order is not the only question a `MODES_UI` row answers.
 * Some of these rows are behind the experimental-features switch, so the bar
 * draws the rows that are not experimental **plus whichever mode the reader is
 * in**. Every row carries a required `experimental: boolean`, so mode fifteen
 * cannot be added without somebody deciding which side of that line it is on.
 *
 * **Which modes are on which side is not written down here**, and moving one
 * is the flag below and nothing else in this file. The membership and the
 * reason for each is docs/project/experimental-features.md; the independent
 * copy that stops a flag moving unnoticed is
 * tests/dock-experimental-modes.test.tsx § BEHIND_THE_SWITCH. This paragraph
 * named the four and gave a count until 2026-09-06, when promoting Quotes
 * meant editing five comments that were arithmetic rather than reasoning.
 *
 * **Diagram came back out on 2026-09-04**, and the gate went one level down
 * rather than away: the mode is in the default bar, and four of its five
 * pictures are behind the switch instead — `KIND_UI` in DiagramPanel.tsx, which
 * carries the same required flag and shares this file's rule
 * (experimental-visibility.ts). A reader asked for exactly that: *"the only
 * diagram sub-mode that is good enough to show everyone is the sketch mode"*.
 *
 * The rule itself, and why the current mode is retained rather than dropped, is
 * `visibleModes` below. The manual is
 * docs/project/experimental-features.md; the checklist is
 * docs/project/new-mode.md.
 *
 * `Thread` became `Tweets` in the same breath, matching the page's own name
 * (Tweets.tsx, `/read/<slug>/tweets`) and the route the button already pointed
 * at. The label was the only place the old word survived.
 */
/* `useRef` and React's aliased `KeyboardEvent` both went with the mode
   segment's arrow keys on 2026-08-31 — the ref array was the roving tabindex's
   focus-follow, and the aliased type was that handler's parameter. The only
   keyboard listener left in this file is the drawer's Escape, which is on
   `window` and takes the DOM's own type. See `DockModes`.

   `useRef` came back on 2026-09-06, for the drawer's focus rather than the
   bar's — see § the drawer takes focus, and gives it back. The aliased type
   has not. */
import { useEffect, useRef, useId, type ReactNode } from "react";
import {
  AlignLeft,
  BookA,
  Brain,
  ClipboardCheck,
  Lightbulb,
  ChevronUp,
  Clock,
  FlaskConical,
  Focus,
  Globe,
  LoaderCircle,
  Network,
  Info,
  Layers,
  ListOrdered,
  ListTree,
  MessageSquareText,
  MessagesSquare,
  Search,
  TriangleAlert,
  X,
  Quote,
} from "lucide-react";
/* The one name each mode has, and the bar is one of four places that used to
   spell it out for itself. src/title-text.ts imports nothing under src/web/, so
   this direction is safe — the server composes a page title from the same
   record. See `ModeUi` below. */
import { MODE_LABEL } from "../title-text.js";
import type { Comment } from "../types.js";
import { armActivationForMode, armActivationForTweets } from "./activation.js";
import { useDockFit } from "./dock-fit.js";
/* Type only: the bar is *handed* the switch, it does not subscribe to the store
   — see the `experimental` prop. A type import cannot become a subscription. */
import type { ExperimentalSetting } from "./experimental-store.js";
/* The same two sentences the checkbox on /profile says, because there are two
   controls for one setting now. experimental-copy.ts. */
import {
  EXPERIMENTAL_HOW,
  EXPERIMENTAL_IS_OFF,
  EXPERIMENTAL_NAME,
  EXPERIMENTAL_WHAT,
  experimentalIsOn,
  experimentalOffline,
} from "./experimental-copy.js";
/* The one rule both this bar and Diagram's picture chips draw by — see
   `visibleModes` below. experimental-visibility.ts. */
import { shownBehindTheSwitch } from "./experimental-visibility.js";
import type { DiagramKind } from "./diagram.js";
import { DEFAULT_MODE, diagramInSearch, type Mode, type Panel } from "./params.js";
import { Link } from "./Link.js";
/* The trigger only — the dialog and the `open` state stay mounted at the
   signed-in `App` level, where a `Dock` unmounting cannot destroy a draft.
   FeedbackButton.tsx § One dialog, two triggers. */
import { FeedbackTrigger } from "./FeedbackButton.js";
import { type ArticleView, carriedSearch, LIBRARY_HREF, readHref } from "./router.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";
import { useSlow } from "./useSlow.js";
import { InstallHint } from "./InstallHint.js";

/**
 * **The experimental-features switch, as the bar sees it.**
 *
 * It was one field until 2026-09-03 — *is it on* — because all the bar did with
 * the answer was filter `MODES_UI`. The bar now draws the switch itself, so it
 * needs everything that decides how a control is drawn: whether there is a
 * reader to draw it for, whether we have an answer yet, and each of the three
 * ways the answer can be wrong. `since` is the only field of
 * `ExperimentalSetting` left out, and it is left out because *when* you turned
 * it on is a sentence and the bar is eighteen icons — `/profile` says it
 * (SettingsSection.tsx).
 *
 * **Derived from the store's interface rather than restated.** Nine documented
 * fields copied into this file would be a second copy that nothing keeps in
 * step, which is the mistake CLAUDE.md § One source of truth names. Naming them
 * means a renamed field breaks this line, loudly, instead of drifting.
 *
 * **`Pick`, not `Omit`** — the two are the same set today and will not stay
 * that way. `Omit<…, "since">` makes every field the store grows in future
 * automatically part of the bar's required contract, so a field added for
 * `/profile` would start failing four mount sites that have no use for it. This
 * list is what the bar actually reads. (GPT Sol, reviewing stage 3.)
 *
 * A structural type either way, so a mount site hands the hook's result straight
 * over and the compiler checks the fields that are read.
 */
export type DockExperimental = Pick<
  ExperimentalSetting,
  "on" | "signedIn" | "loaded" | "stale" | "saving" | "error" | "loadError" | "set" | "reload"
>;

interface Props {
  /**
   * The slug from the *path*, not `article.meta.slug`.
   *
   * They differ for the committed fixture, whose meta.json names the full
   * article it is an excerpt of — so building a link out of the meta slug would
   * send you to a different article, and one that exists, so nothing would look
   * broken.
   */
  slug: string;
  /** Which of the article's pages this bar is sitting on. */
  view: ArticleView;
  /**
   * Which mode owns the middle band, and how to change it — the reading view
   * only. See params.ts § modeParam and docs/plans/260826a-chat-mode.md.
   *
   * Optional for the same reason `drawer` is: the metadata and thread pages
   * have no middle band to put a mode in, so their Chat button is a link back
   * to the reading view rather than a switch that would have nothing to switch.
   */
  mode?: Mode;
  onMode?(next: Mode): void;
  /**
   * **Whether this reader sees the modes that are still being built** — and
   * therefore how many buttons the bar draws at all. `visibleModes` is the rule.
   *
   * Since 2026-09-03 it also decides **whether the bar draws the switch itself**,
   * and how: `toggleVariant` below turns these fields into the one appearance
   * the button wears. `experimental.signedIn`, not the `signedIn` prop, answers
   * *is there a reader to draw it for* — see that prop for why the two spellings
   * are not interchangeable.
   *
   * **Required, and the bar is told rather than going and getting it.** The
   * store behind `useExperimental()` is shared, so a hook call in here would be
   * safe; it would still be the wrong shape. This file's own header says the
   * page owns the fetches and the bar is handed what it needs — `drawer` is a
   * prop precisely so a visit to the metadata page does not buy a drawer nobody
   * opened — and `signedIn`, `visitor` and `marked` are all passed in the same
   * way. A subscription here would be the first thing in this file to go
   * looking. Fable arbitrated the fork; the reasoning and its cost are in
   * docs/plans/260903c-… § `Dock` is told the answer.
   *
   * The cost, named there and real: four mount sites can each hand-roll
   * `{ on: true }`, so the compiler checks that *a* value arrived and not that it
   * came from the hook. Required-ness is what makes the omission loud instead of
   * silent — see the read of `experimental.on` below, which must never become
   * `experimental?.on`.
   */
  experimental: DockExperimental;
  /**
   * The drawer, on the one page that has one.
   *
   * **Absent everywhere else, and that is the point.** `useComments(slug)`
   * fetches on mount, so a Dock that always took comments would charge a visit
   * to the metadata page a request for a drawer nobody opened. Without this,
   * the Questions button becomes a link back to the reading view with
   * `?panel=questions` — same button, same place, and the questions open where
   * they are useful, which is beside the prose they are about.
   *
   * One object rather than four optional props, so the four cannot be passed
   * apart: they are meaningless individually.
   */
  /**
   * Mode buttons drawn dimmed, because this reader will meet a boundary in
   * them — a visitor on somebody's shared document. Empty for the owner.
   *
   * **They stay pressable, and that is the design rather than an oversight.**
   * The reason a mode is marked must not live only in a hover tooltip: NN/G's
   * rule is that a tooltip may never be the only carrier of information a
   * person needs, and a hover tooltip is unreachable by touch and by keyboard.
   * So pressing a marked mode opens its band and the band carries the sentence
   * in visible text — see `VisitorBand` in PublicChrome.tsx. The dimming and
   * the tooltip line below are the supplement, never the message.
   * docs/research/260828a-public-access-how-others-do-it.md § 2.
   */
  marked?: ReadonlyMap<Mode, string> | undefined;
  /**
   * **There is no `signedIn` prop any more, and this is the note saying so.**
   *
   * It existed to tell the visitor drawer's call to action whether to offer an
   * account, and that call to action went on 2026-09-04 when a shared link
   * began carrying the owner's comments: the drawer shows the comments now, and
   * there is nothing left in it that an account would change.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.
   *
   * **The distinction it recorded is worth keeping**, because the remaining
   * spelling is easy to reach for wrongly. `experimental.signedIn` comes from
   * the store, which knows the session, so it has one answer on every page. The
   * deleted prop was *optional visitor-copy input*, and `Metadata.tsx` and
   * `Tweets.tsx` mounted the bar without it — so any control drawn on it
   * vanished the moment an owner pressed Metadata, present on one page of their
   * own article and gone on the next. (GPT Sol, finding 2; Fable reached the
   * same conclusion independently.) If something here ever needs *is somebody
   * signed in* again, take it from the store, not from a prop the callers may
   * forget.
   */
  /**
   * **Whether this article is theirs**, which is a different question from
   * `signedIn` and the one every other piece of chrome keys on.
   *
   * Needed separately from `drawer` because the drawer's *shape* is not a
   * reliable proxy for footing: the metadata and tweets pages mount the bar
   * without one, and they exist for both readers. Inferring from its absence is
   * what left two of the three visitor pages saying "Your comments".
   */
  visitor?: boolean | undefined;
  drawer?: {
    /** Comments in reading order — App already sorts them, see comment-nav.ts. */
    comments: Comment[];
    /**
     * Has the comments fetch come back, and did it work? `CommentsApi`.
     *
     * Only the empty state needs these, and it needs both: an empty list is
     * what this panel holds *before* the request lands, *after* it came back
     * with nothing, and *after* it failed — and only the middle one of those is
     * "nothing asked yet".
     * docs/project/web-client.md § Empty is not the same as not asked yet.
     */
    loaded: boolean;
    loadFailed: boolean;
    /** Which panel is open, or null for a shut drawer. From `?panel=`. */
    panel: Panel | null;
    onPanel(next: Panel | null): void;
    /** Open a question's dialog and bring its passage into view. */
    onOpenComment(id: string): void;
    /** Never set on this arm — see the visitor arm below. */
    visitor?: false;
  } | {
    /**
     * The drawer a **visitor** gets, and since 2026-09-04 it has the owner's
     * comments in it rather than a sentence about them.
     *
     * Greg's decision: a shared link carries them.
     * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.
     *
     * **Still a separate member of the union**, and the two fields it does not
     * have are the reason. There is no `loaded` and no `loadFailed`, because
     * there was no request: the comments arrived inside the page's own payload,
     * so there is nothing to be waiting for and nothing to have failed.
     * `useComments` is still mounted nowhere on a shared document. That is the
     * same shape `PublicArtefactSet` has against the owner's hooks —
     * src/web/reader-capability.ts § what "visitor" means.
     */
    visitor: true;
    /** The owner's, read-only, in reading order. `visitorComments` derives them. */
    comments: Comment[];
    panel: Panel | null;
    onPanel(next: Panel | null): void;
    /** Open one, exactly as the owner's arm does. Reading is the whole verb. */
    onOpenComment(id: string): void;
  };
}

/**
 * ## The dimmed placeholders are gone, and where the last one went
 *
 * This file used to end with a `SOON` list — ideas built once in the original
 * version, kept as dimmed buttons with a tooltip saying the one thing that
 * project learned the hard way. Greg, 2026-08-25: *"Also see
 * docs/project/original-version/overview.md for ideas - for now, add extra
 * ideas as placeholders with rich tooltips."* The "for now" ran out. Search
 * and Highlights became the Search mode; the last one standing was **Reading
 * time**, and Greg, 2026-08-26:
 *
 * > And get rid of "Reading time" - that should be part of "Metadata".
 *
 * It already was: the metadata page has read time as one of its six stat cards
 * (Metadata.tsx § At a glance), with a tooltip that says it is words ÷ 230 and
 * a flat rate. So the bar was offering a button for something a page already
 * answered. The one thing the placeholder carried that the page did not — that
 * the original version dropped the readability formulas for a model's
 * judgement, then scaled the estimate by how confident the model was — is now
 * written into that card's tooltip, which is where somebody wondering about
 * the number will actually meet it.
 *
 * The convention is not dead: Metadata.tsx keeps its own `SOON` list in the
 * same shape, for things *that page* should say and cannot yet. What died here
 * is the idea that the bar is a good place to advertise unbuilt features — a
 * bar is for pressing.
 *
 * **Both of the features that list used to say we would never build are now
 * buttons in this bar**, and that is worth reading before writing a third
 * refusal anywhere. Tweet threads were "simply not what this is", written a
 * few hours before Greg asked for them. Chat was the stronger objection — its
 * own docs single it out as the one to be most suspicious of, and it sits
 * closest to our anti-goals (vision.md). Neither objection was waved away;
 * both are answered at length, in
 * docs/plans/260825g-tweet-thread-page.md#say-the-awkward-thing-first and in
 * docs/plans/260826a-chat-mode.md#say-the-awkward-thing-first. The chat that was built
 * is not the one that was refused: every claim it makes carries a block id and
 * the article stays on screen beside it.
 */

/**
 * Everything the middle band can be, in the order they sit in the bar.
 *
 * A table rather than hand-written buttons, because a radiogroup's keyboard
 * behaviour has to walk them: "the next mode" is only meaningful if there is a
 * list to be next in. Adding another is a row here — which is exactly what
 * Search and then Summary cost (docs/project/summaries.md).
 *
 * The order is deliberate and is not alphabetical: **Plain first, because it is
 * the default** and the one you come back to — Hierarchy held that place until
 * 2026-08-31 and now sits second, still first among the modes that show you
 * something. Left-to-right in the bar is also the order the arrow keys travel,
 * so the resting state being leftmost means every other mode is reached by
 * going right from the resting state.
 *
 * The other four were reordered by hand on 2026-08-26 — Summary, Glossary,
 * Search, Chat — and the reasoning is in the file header under "The order".
 * Short version: it runs from the article restated, through the ways into it,
 * to the conversation about it, and Chat is last because it is the one furthest
 * from the article's own words.
 *
 * **A new mode is a row here, and the compiler asks for it** — see
 * `ModesMissingFromDock` below. Until 2026-09-02 nothing did: this was annotated
 * `{ mode: Mode; … }[]`, which widened every row's `mode` to the whole union and
 * said only that each entry *is* a mode, never that every mode *is* an entry.
 * The word on the button is not a row here at all any more; it comes from
 * `MODE_LABEL`.
 */
interface ModeUi {
  mode: Mode;
  icon: typeof Info;
  /**
   * One sentence in the tooltip, which is the only per-mode string this table
   * still holds. The **name** is `MODE_LABEL[mode]` (src/title-text.ts) — a
   * total, compiler-checked record that the tab title and the shared-inventory
   * dialog already read, so renaming a mode is one edit and cannot leave the
   * bar and the tab saying different words. It had a `label` field of its own
   * until 2026-09-02, and all thirteen pairs matched, which is what a copy
   * looks like right up until it does not.
   * docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md § T1.2.
   */
  blurb: string;
  /**
   * **Is this mode still being built?** If so it is drawn only for a reader who
   * turned the experimental-features switch on — or who is in it right now.
   * docs/project/experimental-features.md is the operating manual, and
   * `visibleModes` below is the rule.
   *
   * **Required on every row, and not an optional flag on five.**
   * `ModesMissingFromDock` proves each mode has a row; only a required field
   * proves each row *made the decision*, and docs/project/new-mode.md says the
   * author must make it. An optional flag would quietly enrol mode fifteen
   * among the polished ones. (GPT Sol, finding 8.)
   */
  experimental: boolean;
  /**
   * **Keep the word when every other button loses one.**
   *
   * The labels are dropped as soon as the row stops fitting, and again when
   * even the icons are tight, because they are said twice — in the tooltip and
   * in the `aria-label` — so dropping them costs a sighted reader a hover and a
   * screen-reader user nothing (dock-fit.ts, styles.css § the bar's fit
   * ladder). Exactly one button is worth the width anyway: the one
   * that gets you *out*, which a reader is reaching for precisely when they do
   * not want to hover ten icons to find it. So on a phone the row is thirteen
   * glyphs and one word, and the word is the exit.
   */
  keepLabel?: true;
}

/* `satisfies` and deliberately **not** `as const satisfies`, which is what
   `STEP_ORDER` in src/step-order.ts uses for the same check. `satisfies` alone
   already keeps each row's `mode` as its literal — that is the only field
   `ModesMissingFromDock` reads — while `as const` would additionally make the
   element type a union of thirteen distinct shapes, twelve of which have no
   `keepLabel` key at all, so `m.keepLabel` below would stop compiling. */
const MODES_UI = [
  /* **First among the modes, because it is the way out of one.** Greg asked for
     it in those terms —
     *"the first (and largest?) icon in the bottom-bar, to make it easy for the
     user to use that to get out of a mode to the text"*, 2026-08-31 — and it is
     also the default, which is the rule this list already followed when
     Hierarchy was leftmost.

     **"The way out" now means out of a *mode*, not out of the article.** Since
     2026-09-06 the way off this page is `DockHome`, to the left of the segment
     and outside it — so this row is the first of the things the document can
     be, and the exit from the document is not one of them. See the header.

     Not drawn larger, and that is a deliberate departure from the ask. A
     radiogroup of ten peers with one of them enlarged reads as a mistake before
     it reads as emphasis. What it gets instead is its label, kept at narrow
     widths where every other button loses one (styles.css § the bar's fit ladder) —
     so on a phone the bar is eight icons and one word, and the word is the exit.
     Cheap to change to a size bump if it does not read.

     **And since 2026-09-05 it is the only way out**, the `×` in the controls
     bar having gone with the rest of that bar. It inherits the contract the `×`
     was written to keep (GPT Sol, 2026-08-31): closing a band goes to `plain`
     *by name*, never to `DEFAULT_MODE`. They are the same mode today and they
     are different questions — *where a reader lands with no instructions* and
     *what closing a panel means* have no reason to agree — so this row says
     `"plain"` as a literal, and moving the default cannot silently redirect it.

     It is also **not the fix for the problem Greg hit**, and that is worth
     saying here so nobody thinks it was: on a phone the bar this button sits in
     is exactly what an on-screen keyboard covers, and what slides away when you
     scroll. The fix for that is in styles.css § a small device — the bars stay
     while a band is open. docs/plans/plain-mode-and-the-way-out.md. */
  {
    mode: "plain",
    experimental: false,
    icon: AlignLeft,
    blurb: "Just the article — no columns, no panel",
    keepLabel: true,
  },
  {
    mode: "hierarchy",
    experimental: false,
    icon: ListTree,
    blurb: "The article's own shape, one column per level of detail",
  },
  /* Straight after Hierarchy, because it answers the same question — what shape
     is this piece, and where am I in it — with one nested list instead of
     columns you read across. Greg set this order by hand and it runs from the
     article's own words outwards, so the two structural views belong together
     at the near end. docs/plans/260828aw-outline-mode.md. */
  {
    mode: "outline",
    experimental: false,
    icon: Focus,
    blurb:
      "The whole document in one list, with more detail on the part you are reading and less on the rest",
  },
  {
    mode: "summary",
    experimental: false,
    icon: Layers,
    blurb:
      "The article, its parts and its sections, a sentence on each — as deep into the piece as you ask",
  },
  {
    mode: "glossary",
    experimental: false,
    icon: BookA,
    blurb: "The terms this piece uses in a non-obvious way, defined from the piece itself",
  },
  /* Straight after Glossary, because the order runs outwards from the article's
     own words and these two are the same kind of thing pointed at different
     units: a term is a word you look up, an idea is a proposition you hold.
     Greg set this order by hand, so a new mode goes where it belongs in his
     reasoning rather than on the end. */
  {
    mode: "ideas",
    experimental: false,
    icon: Lightbulb,
    blurb: "The propositions this piece needs you to hold — the ones it assumes, and the ones it adds",
  },
  /* Next again, and it belongs at this end of the order for the same reason
     Ideas does: the bar runs outwards from the article's own words, and this is
     the mode that is *closest* to them — every row is a sentence out of the
     piece rather than something a model wrote about it. Greg set this order by
     hand, so a new mode goes where it belongs in his reasoning rather than on
     the end. docs/project/quotes.md.

     **Not experimental since 2026-09-06**, on Greg's call that the mode is
     valuable enough to show everybody — so pressing it starts a paid run
     (activation.ts § MODE_TARGET) for a reader who asked for nothing, as
     Glossary and Ideas already did. Why, in
     docs/project/experimental-features.md. */
  {
    mode: "quotes",
    experimental: false,
    icon: Quote,
    blurb: "The lines worth keeping — the piece's own sentences, chosen and checked against it",
  },
  /* **After Ideas and before Search**, which is Greg's placement (2026-08-31)
     and the reason it lands *here* rather than immediately after the Ideas row:
     Quotes arrived between the two the same day, and "after Ideas" is a
     position in the reasoning — with Glossary and Ideas, as a third "here is one
     dimension of this piece pulled out" — rather than an array index. It is
     further from the article's own words than either of those, and further than
     Quotes, so it goes at the far end of that group.
     docs/plans/260831i-timeline-mode.md § 3. */
  {
    mode: "timeline",
    experimental: true,
    icon: Clock,
    blurb: "When the piece says these things happened, in order — and how sure it actually is",
  },
  /* Search was **two** dimmed placeholders in the `SOON` list this file used to
     carry — `Search` and `Highlights`, side by side — and is one mode now. That
     is the design rather than a tidy-up: highlighting is what search *does to
     the page*, not a separate thing to press. Greg's call; see
     docs/project/search.md.

     The `Highlights` placeholder's note has not been lost. It said overlapping
     highlights need the CSS Custom Highlight API because a library that wraps
     matches in tags cannot nest them — which turned out to be about a wall we
     had already gone round, and the account of that is now at the top of
     annotate.ts where somebody adding a fifth kind of mark will meet it. */
  {
    mode: "search",
    experimental: false,
    icon: Search,
    blurb: "Find a passage by the words it uses, or by what it says",
  },
  /* **Straight after Search, because it is Search's kind of thing** — a pass
     over the piece looking for passages — pointed at somebody who has been
     asked to peer-review it rather than at somebody reading it for themselves.
     Its first sub-mode is very nearly a saved search, which is the argument for
     the placement and also the thing the plan says to watch: if Criteria turns
     out to be Search with extra steps, the honest move is to fold it back.
     docs/plans/260831an-referee-mode-for-peer-reviewers.md.

     `ClipboardCheck` rather than the three other candidates, and the reason is
     the one rule this whole mode obeys: **no verdict, ever.** `Gavel` and
     `Stamp` both draw a judgement being handed down, which is the single thing
     this mode refuses to produce, and an icon that promises it would be the
     mode's own anti-goal sitting in the bar. `ScanSearch` says "search" one
     button along from Search. A clipboard with a tick is the referee *form* the
     venue sends you — the criteria you were asked about — which is what the
     mode is actually for. docs/project/icons.md. */
  {
    mode: "referee",
    experimental: true,
    icon: ClipboardCheck,
    blurb: "Reviewing this for somebody? Your criteria, its claims, and a second look at your own notes",
  },
  /* Diagram sits between the ways *into* the article and the conversation about
     it, next to Summary rather than next to Chat, because it is the same move
     Summary makes — the article restated — with a picture instead of prose.

     **Not experimental since 2026-09-04**, and the flag moved rather than
     went: one of its five pictures is good enough for everybody and four are
     not, so the switch now hides the four (`KIND_UI` in DiagramPanel.tsx).

     **Pressing this button draws the Sketch, since 2026-09-06.** It used to buy
     nothing — the mode landed on an invitation with the price on it and waited
     for a second press — and Greg asked for the second press to go
     (docs/plans/260906b-opening-a-mode-starts-it-generating.md). So this is now
     the most expensive button in the bar that is in front of *every* reader:
     ~$0.20 and about two minutes. Only the Sketch; Illustrated is still its own
     chip inside the mode. activation.ts § MODE_TARGET has the reasoning, and the
     empty state still says the price for anyone who arrives without pressing.

     The blurb names the picture a default reader will actually meet. It used to
     list the three geometries, which are now the hidden ones. */
  {
    mode: "diagram",
    experimental: false,
    icon: Network,
    blurb: "The article's shape as a picture: a model reads the argument and draws it",
  },
  {
    mode: "chat",
    experimental: false,
    icon: MessagesSquare,
    blurb: "Ask about this article — answers point back at the paragraphs they came from",
  },
  /* **After Chat and before Remember**, which is a placement in the ordering
     this list has followed since Greg set it by hand rather than an array
     index: it runs from the article restated, through the ways into it, to the
     conversation about it, and Remember is last because its content comes from
     the READER. Debate's content comes from neither the article nor the reader
     — it is the only mode in this bar whose content is **not in the article at
     all** — so it goes at the far end of the outward run and one step short of
     the reader's own. Greg has not set this one by hand; move it if it is
     wrong.

     **`Globe`, and it is the same word this app already draws for "this came
     from the open web"** — the glossary's web lookup, chat's search, the
     reviewer brief (GlossaryPanel.tsx, ChatPanel.tsx, CandidatesPanel.tsx). No
     other button in this bar is a globe, so it is unmistakable beside Chat's
     two bubbles, which `MessageSquareQuote` would not have been. The glyph's
     other sense in this app — *shared publicly* — appears only on surfaces that
     are about sharing, and the bar is not one. docs/project/icons.md.

     The blurb names the empty case, because it is the commonest one: most
     pieces have no critical reception at all, and a mode that is empty four
     times in five reads as broken unless the button said so first.
     docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md. */
  {
    mode: "debate",
    experimental: true,
    icon: Globe,
    blurb: "What the rest of the web says about this piece — often nobody has written anything, and it says so",
  },
  /* Last, and one step further out than Chat, which is the end of the ordering
     this list has followed since Greg set it by hand: it runs from the article
     restated, through the ways into it, to the conversation about it. Remember
     is the only mode whose content comes from the READER — it cannot be used at
     all until they have read the piece — so it belongs past the point where the
     article's own words run out. docs/plans/260827ah-review-mode.md.

     **The blurb is doing more work here than anywhere else in this list**, and
     it has to keep doing it. "Remember" (renamed from "Review" on 2026-09-01)
     suggests two things this mode is not: saved memories you can go back to,
     and spaced repetition. Neither exists — nothing is stored for later and
     nothing comes back on a schedule; the reader talks, and the model shows
     them where their account and the piece come apart. That is the named cost
     of the rename, so if this line is ever shortened, the denial is the part to
     keep.
     docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md. */
  {
    mode: "remember",
    experimental: true,
    /* `Brain`, not `Speech`, from 2026-09-05. `Speech` was the mode's method — the
       reader talks — and Greg asked for its subject instead: what they kept.
       SPIDERYARN-READING2-25. It is the only brain in the bar, and Lucide has
       exactly one, so there is no second thing it could be confused with. */
    icon: Brain,
    blurb: "Say what you took from this and find out where it holds up — not saved notes or flashcards",
  },
] satisfies readonly ModeUi[];

/**
 * **Every `Mode` that `MODES_UI` above does not give a button.** Always `never`.
 *
 * Add a mode to `MODES` (src/web/params.ts) and forget the row above, and this
 * line goes red naming the mode you forgot: `T extends never` is a constraint,
 * and the default it is checked against stops being `never` the moment a mode
 * has no row. Same idiom, same reasoning as `StepsMissingFromOrder` in
 * src/pipeline.ts.
 *
 * What goes wrong without it is silent rather than loud: the mode is reachable
 * by URL, `MODE_LABEL` names it in the tab title, and the bar simply has no
 * button for it — a mode nobody can press and nothing complains about. The only
 * thing that noticed was a runtime pairing assertion in a *visitor-trace* test.
 *
 * **That test stays**, and this does not replace it: a union discards
 * multiplicity and order, so a duplicated row and Greg's hand-set order are
 * both invisible here. tests/public-network-trace.test.tsx is what holds those.
 *
 * **Exported only so it survives.** `noUnusedLocals` deletes an unreferenced
 * type alias, which would take the check with it; nothing imports this and
 * nothing should.
 */
export type ModesMissingFromDock<
  T extends never = Exclude<Mode, (typeof MODES_UI)[number]["mode"]>,
> = T;

/**
 * **Which of the fourteen the bar actually draws.** Two rules, and the second
 * is the one that is easy to lose.
 *
 * 1. Every row that is not experimental.
 * 2. **Plus whatever mode the reader is in**, experimental or not.
 *
 * The second is not politeness. The mode segment is a `role="radiogroup"` and
 * exactly one button must be checked, so `?mode=timeline` with the switch off
 * and no Timeline button would leave a group announcing *one of these* with
 * none of them on — and the reader stranded in a mode with no way back that the
 * bar could show them. It holds on the loose-link arm too (metadata and tweets),
 * which is where a first draft of the plan stopped short: `carriedSearch`
 * strips only `?panel=`, so `?mode=` is still in the string those links are
 * built from, and the bar there can read it back. GPT Sol, finding 9.
 *
 * It follows that turning the switch **off** while in an experimental mode
 * leaves the reader where they are, with their button still drawn. The
 * operating manual allows falling back to the default mode instead; staying put
 * is less surprising and costs nothing.
 *
 * **Hidden means hidden from the controls, not unreachable** — `MODES`, the URL
 * parser, `MODE_LABEL`, `POLICY` and the band branch in App.tsx all stay total
 * at thirteen, which is what makes that sentence true.
 * docs/project/experimental-features.md.
 *
 * Exported for tests/dock-experimental-modes.test.tsx, which is the only way to
 * ask this question without a DOM.
 *
 * **The rule itself lives in experimental-visibility.ts since 2026-09-04**,
 * because Diagram's picture chips now obey the same one and a shared link has to
 * survive both of them — `visibleKinds` in DiagramPanel.tsx is the other caller.
 */
export function visibleModes(on: boolean, current: Mode | undefined): readonly ModeUi[] {
  return MODES_UI.filter((m) =>
    shownBehindTheSwitch({ experimental: m.experimental, on, current: m.mode === current }),
  );
}

/**
 * The mode named in a carried query string, if it names one this bar has a row
 * for.
 *
 * Off the reading view there is no `mode` prop — the band is elsewhere — so this
 * is how the loose-link arm knows which mode the reader came from. Matched
 * against `MODES_UI` rather than against `MODES` so that an unrecognised word in
 * the URL simply draws nothing extra, the same way `modeParam` falls back to the
 * default rather than throwing (params.ts § modeParam).
 */
function modeInSearch(search: string): Mode | undefined {
  const named = new URLSearchParams(search).get("mode");
  return MODES_UI.find((m) => m.mode === named)?.mode;
}

/**
 * **The one appearance the bar's own switch wears**, or `null` when it is not
 * drawn at all.
 *
 * Six of them, and they are exclusive on purpose: one state, one look, so
 * `fitSignature` can carry *which* button is drawn rather than merely that there
 * is one. GPT Sol, reviewing stage 2: keying the fit on presence alone leaves
 * the bar mis-measured when the warning marker appears, because the marker is a
 * second icon and the row got wider without the signature moving.
 *
 * **The order is the precedence, and `saving` is first.** `SettingsSection.tsx`
 * reports a failed load above a save in flight, which is right for a line of
 * prose: it is telling you what happened. This is a button, and the only
 * question it has to answer is *may I take a press* — so a write in flight wins
 * over everything, because pressing during one is the race the store's
 * one-write-at-a-time rule exists to prevent, and because it is about to resolve
 * the rest anyway.
 *
 * **`!loaded` is last, and cannot be first.** A failed load leaves `loaded`
 * false, and so does an offline copy (experimental-store.ts) — so a `!loaded`
 * test at the top would swallow both, and the reader would get a permanently
 * disabled button with no way to ask again. That is the mistake this ordering
 * is written down to prevent.
 *
 * Exported for tests/dock-experimental-switch.test.tsx, which holds the table.
 */
export type ExperimentalVariant =
  /** A write is in flight. Disabled — and every other state is about to change. */
  | "saving"
  /** The load failed. Enabled, marked, and a press asks again rather than toggling. */
  | "load-failed"
  /** The save failed. The value has already sprung back; the button says so. */
  | "save-failed"
  /** What we last knew, from the offline cache. Disabled, and it says why. */
  | "stale"
  /** No answer yet. Disabled — a switch drawn from a default is a value nobody chose. */
  | "waiting"
  /** A switch, working. */
  | "ready";

/**
 * **What pressing the switch does**, which is three different things and not
 * two.
 *
 * This is the record `aria-pressed` keys on, and that is the point of it rather
 * than a tidiness. The APG rule — written down in this repo already, at
 * `DictationStrip.tsx` § *The button is an action, not a toggle* — is that a
 * control may have a **moving accessible name** or a **fixed name plus
 * `aria-pressed`**, and never both. So `aria-pressed` is drawn exactly where
 * pressing toggles something, and a `retry` press is honestly an action rather
 * than a toggle.
 *
 * **`stale` is `retry`, and getting that wrong was a real dead end.** It was
 * `nothing`: a reader whose page loaded from the offline cache got a disabled
 * switch, and nothing ever asked again — `offline.ts` listens for *going*
 * offline and not for coming back, so the button stayed dead through every
 * navigation until a full page reload or an account change. GPT Sol reproduced
 * it with a one-off test: pressing a stale switch called `reload` zero times.
 * The store has offered `reload()` for a failed **or offline** load all along.
 */
const PRESS = {
  saving: "nothing",
  waiting: "nothing",
  "load-failed": "retry",
  stale: "retry",
  "save-failed": "toggle",
  ready: "toggle",
} as const satisfies Record<ExperimentalVariant, "toggle" | "retry" | "nothing">;

export function toggleVariant(e: DockExperimental): ExperimentalVariant | null {
  /* Nobody to save it for. Not a disabled button either: a signed-out reader is
     forcibly off by decision, and a control they cannot use is an advertisement
     for an account, which is not what the bottom bar is for. */
  if (!e.signedIn) return null;
  if (e.saving) return "saving";
  if (e.loadError !== null) return "load-failed";
  if (e.error !== null) return "save-failed";
  if (e.stale) return "stale";
  if (!e.loaded) return "waiting";
  return "ready";
}

/**
 * What the bar has in it, as one string, so `useDockFit` re-measures when the
 * row's width could have changed and not on every render of the page it sits on.
 *
 * The five things that vary: the modes are one segment on the reading view and
 * loose links elsewhere; Comments is a drawer trigger here and a link
 * elsewhere; its count grows a digit; the bar's own experimental switch is
 * absent, or drawn in one of six appearances; and the Feedback trigger at the
 * end of the row is there for a signed-in reader and not for a stranger.
 *
 * **Feedback is its own term even though it moves with the switch's**, and that
 * is worth saying rather than leaving a reader to notice the redundancy and
 * delete it. `toggleVariant` returns `null` exactly when `signedIn` is false,
 * which is the same condition the Feedback trigger is gated on, so today the
 * two terms cannot disagree. They are two different gates that happen to agree:
 * one is *is there an account to save a setting to*, the other is *is there an
 * account for a report to belong to*. If either moves, the row's width still
 * has a term that follows it.
 *
 * **The switch goes in by variant, not by presence.** `null` for a signed-out
 * reader and one word otherwise, because the six do not draw the same width: a
 * failed load and a failed save each add a warning triangle beside the flask.
 * A signature that only said *there is a toggle* would leave the row overflowing
 * for as long as the marker was up. GPT Sol, reviewing stage 2.
 *
 * **The modes go in by name, not by count.** It was `MODES_UI.length` until
 * 2026-09-03, when the first modes went behind the experimental switch: the bar
 * retains whichever experimental mode the reader is in, so moving between two
 * of them leaves the count unmoved and changes the row's
 * width, because two mode names are not the same width. A signature that
 * counted would not re-run the fit, leaving the bar overflowing after a move to
 * a wider label or its labels dropped with room to spare after a narrower one.
 * GPT Sol, finding 4.
 *
 * **If a change makes the row wider without changing this string, add it here.**
 * There is no backstop for content: the `ResizeObserver` in dock-fit.ts watches
 * the bar's own box, which is `100vw` and does not move when the row inside it
 * grows. What catches the mistake instead is the floor — the bar scrolls rather
 * than clipping — so the cost of forgetting is a draggable row, not a button
 * nobody can press.
 *
 * Its own function rather than four ternaries in `Dock`, which is already at
 * Biome's cognitive-complexity ceiling. Exported for
 * tests/dock-experimental-modes.test.tsx, which is where the identities-not-count
 * rule is held; nothing else imports it.
 */
export function fitSignature(
  visible: readonly ModeUi[],
  mode: Mode | undefined,
  onMode: Props["onMode"],
  drawer: Props["drawer"],
  own: { comments: Comment[] } | null,
  variant: ExperimentalVariant | null,
  feedback: boolean,
): string {
  const shape = mode !== undefined && onMode ? "seg" : "links";
  const modes = visible.map((m) => m.mode).join(",");
  const count = own ? own.comments.length : "";
  /**
   * **Which mode is on, and not only which are drawn.**
   *
   * The identities rule above catches a *different* set of modes. This catches
   * the same set with a different one of them selected, which changed the row's
   * width on 2026-09-05 and had nothing watching it: § the bar's fit ladder
   * gives the open mode its word back at rung 2, so Plain → Summary draws one
   * more label than it did — same `visible` list, same count, same everything
   * else this string knew about. The bar stayed on the rung it was measured for
   * and scrolled where it should have stepped down.
   *
   * **No `shape` guard on it, and the guard was written and then removed.**
   * The obvious version was `shape === "seg" ? mode : ""`, on the reasoning
   * that a loose link is never `.on` so its mode cannot change the row. That is
   * true and the guard is still dead code: `shape` is `"links"` exactly when
   * `mode` is absent in every arrangement `Dock`'s four mount sites produce, so
   * both spellings return the same string for every bar that exists. The test
   * written to defend it could not be made to fail — which is the tell this
   * repo keeps meeting (docs/reusable/silent-success.md) — so the branch went
   * rather than the test being contorted into an unreachable arrangement to
   * justify it. GPT Sol, S1, reviewing the built code.
   *
   * **And the guard would have been actively wrong later**, which is the
   * argument that settles it rather than merely permits it. If the loose links
   * ever gain an `.on` state of their own, the term this string wants is the
   * bar's *effective* mode — `mode ?? modeInSearch(search)` — on both shapes,
   * and a `shape === "seg"` guard would be the thing standing in the way. GPT
   * Sol, second pass.
   */
  const active = mode ?? "";
  return `${modes}|${shape}|${active}|${drawer ? "drawer" : "link"}|${count}|${
    variant ?? "none"
  }|${feedback ? "fb" : "no-fb"}`;
}

export function Dock({
  slug,
  view,
  mode,
  onMode,
  marked,
  visitor,
  drawer,
  experimental,
}: Props) {
  const panel = drawer?.panel ?? null;
  const open = panel !== null;
  /* Narrowed once, so the four reads below are the compiler checking one fact
     rather than four independent tests that could drift apart. */
  const own = drawer && drawer.visitor !== true ? drawer : null;
  /* Either signal says visitor: the prop, or a drawer that declared itself one.
     Two spellings of one fact, and the older one is kept because the reading
     view already passes it that way. */
  const isVisitor = visitor === true || drawer?.visitor === true;
  const pending = own?.comments.filter((c) => c.status === "pending").length ?? 0;

  /**
   * The view state the bar's links carry across, so leaving the article to look
   * at its metadata and coming back returns you to the paragraph you left.
   *
   * Read from `location` at render rather than from `useQueryState`. nuqs
   * writes the URL itself, so `location.search` is always the current one and a
   * subscription here would only be a second copy of it. What makes that safe
   * is that this bar re-renders whenever its page does, and the page is already
   * subscribed to every parameter in the string. If the bar is ever rendered
   * somewhere that is not, this needs to become a real subscription.
   *
   * `?panel=` is dropped on the way — see `carriedSearch` in router.ts.
   *
   * **Above the fit measurement since 2026-09-03**, because which buttons the
   * bar draws now depends on it: off the reading view there is no `mode` prop,
   * and this is where the mode the reader came from is written down.
   */
  const search = carriedSearch(location.search);

  /**
   * Which mode the bar is *about*, in either arm: the prop on the reading view,
   * and the carried `?mode=` on the metadata and tweets pages.
   *
   * **`experimental.on`, never `experimental?.on`.** A mount site that forgot
   * the prop must throw here rather than quietly answering "show everything" —
   * `tests/dock-fit.test.ts` casts `Dock as any`, so optional chaining would
   * make exactly that mistake silent, and silent to strangers. Fable named this
   * as the cost of the prop being a prop; a plain read is what buys it back.
   */
  const visible = visibleModes(experimental.on, mode ?? modeInSearch(search));

  /* Computed once, above the fit measurement, because the same answer decides
     two things: whether the row is one button wider, and what that button
     looks like. Two calls could not disagree, but one call is one fewer place
     for the next change to only half-land. */
  const toggle = toggleVariant(experimental);

  /* **Whether the bar draws a Feedback trigger**, which is one more button's
     width in the row — so it is read here as well as by `DockFeedback`, where
     the condition is argued. Computed once, above the fit measurement, the way
     `toggle` is: two reads could not disagree, but one is one fewer place for
     the next change to only half-land. */
  const feedback = experimental.signedIn;

  /* **How much of itself the bar spells out is measured, not guessed** — the
     row is asked whether it overflows and drops labels until it does not. It
     was a `max-width: 1100px` media query until 2026-09-02, and that number was
     measured when there were six modes; at thirteen the labelled row wants
     1416px, so every window between 1101 and 1416 was showing its labels and
     running off the right-hand end. dock-fit.ts, and Greg's ask: *"more
     automatic/dynamic (so that we don't have to keep tweaking some
     constant)"*. */
  const { ref: dockRef, fitClass } = useDockFit(
    fitSignature(visible, mode, onMode, drawer, own, toggle, feedback),
  );

  /**
   * Escape closes the drawer, and the drawer wins.
   *
   * CommentDialog also listens for Escape on `window`, via `useEscapeToClose`,
   * and both would otherwise fire on one press — closing a dialog the reader
   * could not even see under the dim. Capture phase runs before any
   * bubble-phase listener, so listening here is what makes "the drawer wins" a
   * fact rather than a question of which component mounted first. This effect
   * deliberately does NOT use `useEscapeToClose` itself — see that hook's own
   * comment for why folding this in would break the race.
   *
   * `stopImmediatePropagation`, not `stopPropagation`. The two are identical
   * for a real key press, which targets an element and therefore has a
   * propagation path to cut. They differ when the event's target IS `window`:
   * there is no path, both listeners are on the same node, and plain
   * `stopPropagation` stops nothing — the dialog closes underneath the dim
   * anyway. Nothing in the app dispatches such an event today, and that is
   * exactly the sort of thing that stays true until it doesn't.
   */
  const onPanel = drawer?.onPanel;
  useEffect(() => {
    if (!open || !onPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onPanel(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onPanel]);

  /**
   * ## The drawer takes focus, and gives it back
   *
   * Until 2026-09-06 it did neither: opening left focus on the dock tab, so a
   * keyboard reader pressed Enter and then Tab straight *past* the thing they
   * had just opened, and closing dropped focus on `<body>` — reproduced in
   * Chrome, docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md
   * § Stage 2. One effect for both halves, because they are one fact: the
   * opener is recorded when focus moves in and used when the drawer goes.
   *
   * **The close button is the target**, not the drawer itself: it is a real
   * control, first in the drawer's own tab order, and the reader's way out.
   *
   * **And there is deliberately no trap.** `.dock` sits above the scrim and
   * stays operable with the drawer open, so Tab is meant to leave — which is
   * why `aria-modal` is not on the dialog below. tests/the-dock-drawer-is-not-a-modal.test.tsx
   * holds the whole contract; docs/project/comments.md states it.
   *
   * The cleanup covers all four close paths — Escape, the scrim, the ×, and the
   * same tab pressed again — because every one of them is `open` going false.
   * `isConnected` is the guard for the fifth case, unmounting, where the bar
   * the opener lived in may be on its way out.
   */
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    openerRef.current = opener instanceof HTMLElement ? opener : null;
    closeRef.current?.focus();
    return () => {
      const back = openerRef.current;
      openerRef.current = null;
      if (back?.isConnected) back.focus();
    };
  }, [open]);

  return (
    <>
      {/* The dim. A button rather than a div so closing by clicking away is
          reachable from the keyboard too, and so screen readers are told there
          is something to press rather than being handed a decorative box. */}
      {open && drawer && (
        <button
          type="button"
          className="dock-scrim"
          aria-label="Close panel"
          onClick={() => drawer.onPanel(null)}
        />
      )}

      {panel !== null && drawer && (
        <div
          className="dock-drawer"
          role="dialog"
          /* **No `aria-modal`, and it is not an omission.** It said `true`
             until 2026-09-06, which was a false statement about this drawer:
             the attribute tells assistive technology that everything outside
             the dialog does not exist, while `.dock` sits above the scrim at
             z-index 96 and stays visible, clickable and Tab-reachable. The
             rest of the reader, including the prose, is behind the dim.
             Reproduced in Chrome and written up
             in docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md
             § Stage 2; the contract is docs/project/comments.md. */
          aria-label={own ? TITLES[panel].own : TITLES[panel].visitor}
        >
          <div className="dock-drawer-head">
            {/* The wordmark used to sit here, and the note beside it said the
                app named itself *here and nowhere else* — true at the time, and
                the reason was that the drawer is shut while you read, so the
                brand was present without ever sitting beside the article's own
                title. That sentence stopped being true on 2026-08-26, when the
                logo took the top-left corner of the window (HomeLogo.tsx), and
                two wordmarks on screen at once is one too many.

                **The conclusion survives 2026-09-06 and the reason had to
                move.** The corner is gone on this page; the wordmark it held is
                now `DockHome`, in the bar directly below this drawer and
                visible while the drawer is open (the bar sits above the scrim).
                So the one that is always there is nearer than it was, and a
                second copy in this heading would be a repeat six lines apart. */}
            <h2>{own ? TITLES[panel].own : TITLES[panel].visitor}</h2>
            <button
              type="button"
              className="dock-close"
              /* Where focus lands when the drawer opens — § the drawer takes
                 focus, and gives it back. */
              ref={closeRef}
              onClick={() => drawer.onPanel(null)}
              title="Close (Esc)"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          {/* One panel, so no branch. There were two until the About panel
              became a page; if a second ever comes back, this is where it
              branches. */}
          {/* **One list for both**, since 2026-09-04. This used to branch to a
              `VisitorNotice` carrying `COMMENTS_GAP` — *comments belong to
              whoever added this article* — which was true until a shared link
              started carrying them. Both the gap and the union member behind it
              are gone; there is no state left they could describe.
              docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */}
          <div className="dock-drawer-body">
            {drawer && (
              <Questions
                comments={drawer.comments}
                onOpen={drawer.onOpenComment}
                access={
                  own
                    ? { kind: "owner", loaded: own.loaded, loadFailed: own.loadFailed }
                    : { kind: "visitor" }
                }
              />
            )}
          </div>
        </div>
      )}

      {/* Above the bar rather than in it: it is a sentence, and the bar is thirteen
          icons. Renders nothing at all except on an uninstalled iOS device that
          has not dismissed it — install-hint.ts. */}
      <InstallHint />

      <div className={`dock${fitClass}`} ref={dockRef}>
        {/* **The way off this page, and the first thing in the bar.** See the
            header for why it is back here after 2026-08-26 took it away, and
            why the reason is the bar having changed rather than a wordmark
            being a different kind of thing from a `Home` button. */}
        <DockHome />

        {/* **The modes, as one control, and first among the modes.** Chat and
            Glossary used to be two independent toggles beside each other, with
            `toc` unrepresented — you left a mode by pressing the one you were
            in. That worked and it lied about the shape of the thing: the middle
            band is always in exactly one state, and only some of them had
            buttons.

            Greg, 2026-08-25: *"Yes, make them a radio group, but as buttons,
            with nice icons and tooltips."*

            Giving `toc` a button of its own is what makes the radiogroup
            honest, and it is the trigger the previous note in this file named —
            not the arrival of a third mode, but the third mode being *visible*.
            See DockModes below. Off the reading view there is no band to switch,
            so the same five degrade to links back to it. */}
        {mode !== undefined && onMode ? (
          <DockModes
            slug={slug}
            /* **`diagramInSearch`, not the raw parameter.** A link from August
               saying `?diagram=tree` names a picture that was cut, and
               `diagramParam` opens the Sketch for it — so arming the raw word
               would arm nothing and the press would do nothing, which is the
               behaviour this change exists to remove. params.ts owns the
               degrade rule and both readers take it from there. */
            diagram={diagramInSearch(search)}
            modes={visible}
            mode={mode}
            onMode={onMode}
            marked={marked}
          />
        ) : (
          visible.map((m) => (
            <DockLink
              key={m.mode}
              href={readHref(slug, withMode(search, m.mode), "article")}
              current={false}
              icon={m.icon}
              label={MODE_LABEL[m.mode]}
              /* `dock-mode` says *this is one of the modes* on a page where
                 they are fourteen loose links rather than one segment, so
                 § the bar's fit ladder can take their labels at the mode rung
                 the way it takes the segment's. Without it that rung does
                 nothing on the metadata and tweets pages, and the bar there
                 skips straight from every label to none. GPT Sol, reviewing
                 the design. */
              className={`dock-mode${marked?.has(m.mode) ? ` ${MARKED}` : ""}`}
              keepLabel={m.keepLabel}
              title={`${m.blurb} — back in the article itself`}
            />
          ))
        )}

        {/* Two shapes of the same button. On the reading view it opens the
            drawer in place. Everywhere else it goes back to the reading view
            with the drawer already open — which is where a question is useful
            anyway, since clicking one scrolls to the passage it is about, and
            these pages have no passages. No count off the reading view: this
            page did not fetch the comments, and a number would have to be
            guessed or paid for. */}
        {drawer ? (
          <DockTab
            panel="questions"
            current={panel}
            onPanel={drawer.onPanel}
            icon={MessageSquareText}
            label="Comments"
            className={own ? "" : MARKED}
            title={
              own
                ? "The passages you have marked on this article"
                : "Comments belong to whoever added this article"
            }
          >
            {/* No count for a visitor — there is nothing to count, and a `0`
                would read as "you have none" rather than "these are not
                yours". */}
            {own && own.comments.length > 0 && (
              <span className={`dock-count${pending ? " pending" : ""}`}>
                {own.comments.length}
              </span>
            )}
          </DockTab>
        ) : (
          <DockLink
            href={readHref(slug, withPanel(search, "questions"), "article")}
            current={false}
            icon={MessageSquareText}
            label="Comments"
            /* **Whose, and the visitor pages reach this arm too.**
               `PublicMetadataPage` and `VisitorPage` mount the bar with no
               drawer, which lands here — so two of the three visitor pages went
               on calling somebody else's comments *"Your comments"* after the
               reading view had been corrected. The heading inside the drawer
               was fixed and the link that leads to it was not. GPT Sol, second
               pass, 2026-08-28.

               `signedIn` is not the question; ownership is. A drawer-less bar
               belongs to the owner on the metadata and tweets pages of *their*
               article, and to a visitor on the public stand-ins. */
            title={
              isVisitor
                ? "Comments on this article, back in the article they are about"
                : "Your comments, back in the article they are about"
            }
          />
        )}

        {/* Labelled `Thread` until 2026-08-26, and `Tweets` now — after its own
            page and its own route, which is the same rule that renamed `About`
            to `Metadata`.

            **Pressing this writes the thread, since 2026-09-06** — one model
            call over the whole article, tens of seconds — where before it took
            you to a page with a button on it. Greg's rule about opening a mode
            (activation.ts), applied to the one surface in this bar that is not
            a mode.

            `onNavigate` rather than `onClick`, and that distinction is the
            whole of the care here: a ⌘-click opens the thread in a *new* tab
            and leaves this one where it is, so an `onClick` would mint a token
            in a tab that is not going to the thread. Link.tsx § `onNavigate`.

            The page keeps its button. It is what a reader presses after a
            failure, and after this session has spent its one automatic try. */}
        <DockLink
          href={readHref(slug, search, "tweets")}
          current={view === "tweets"}
          icon={ListOrdered}
          label="Tweets"
          title="The article as a numbered thread of short posts"
          /* **Only for the owner, and only from the reading view's own bar.**
             `isVisitor` is the same capability seam every band uses: a visitor
             cannot write anything, so arming would mint a token nothing can
             ever spend. And `current` keeps a press on the page you are already
             on from arming a second time — that navigation does not happen. */
          onNavigate={
            isVisitor || view === "tweets"
              ? undefined
              : () => armActivationForTweets(slug)
          }
        />

        {/* A link, not a drawer trigger — the details are a page now. Last in
            the bar, which is the right end for it: it is the machinery behind
            the article rather than a way of reading it. */}
        <DockLink
          href={readHref(slug, search, "metadata")}
          current={view === "metadata"}
          icon={Info}
          label="Metadata"
          title="Where this article came from, what shape it is, and what the pipeline wrote"
        />

        {/* **The switch itself, last, and only for somebody who has an account
            to save it to.** Greg, 2026-09-03:

            > And also show a button at the end of the bar to enable
            > "Experimental Features" for logged-in users with tooltip to
            > explain what this does.

            A toggle rather than a link to `/profile`: one press, where the
            effect is — the modes it reveals are three inches to the left of
            it, and since 2026-09-04 the four hidden pictures inside Diagram
            too. `/profile` keeps the checkbox, and keeps the one thing this
            cannot say, which is when you turned it on.

            After Metadata because it is not about this article at all. It is
            the only button in the bar that is about the app. */}
        {toggle !== null && (
          <DockExperimentalSwitch setting={experimental} variant={toggle} />
        )}

        {/* **Feedback, at the far end, and only for somebody a report can
            belong to.** It left the top-right corner on 2026-09-06 for the same
            reason the wordmark left the top-left: the corner is being abolished
            on the pages that have a bar (FeedbackButton.tsx § One dialog, two
            triggers). The dialog it opens is mounted far above this bar and
            survives every navigation the bar does not.

            **After the switch**, because the two are the bar's app-level pair
            and this is the least urgent thing in the row — which is also why
            the fit ladder takes its word first (dock-fit.ts § the rungs).

            The one thing this makes worse, recorded rather than discovered
            later: on a phone the row already overflows and scrolls, and this
            button is at the end a reader has to drag to, where it used to be
            fixed in the corner. Taken anyway — the plan's § The one thing this
            makes worse. If reports from phones fall off, look here first.

            **The gate is inside `DockFeedback` rather than in a `&&` here**,
            and that is Biome rather than taste: this function was already at
            the cognitive-complexity ceiling (see `fitSignature`, which was
            split out of it for the same reason), and one more conditional in
            the markup put it over. The condition itself is unchanged and is
            argued on that component. */}
        <DockFeedback signedIn={feedback} />

        {/* **The trailing gutter, and the ladder's font-metric probe.** It is a
            child rather than the bar's `padding-right` because the fit
            measurement cannot see padding: Chrome leaves a flex container's
            trailing padding out of its scrollable overflow, so the last button
            was free to sit in it — six pixels on a laptop, and `--safe-right`
            on a phone held landscape, which is the cutout the inset exists to
            keep clear. styles.css § the floor, and dock-fit.ts. */}
        <span className="dock-tail" aria-hidden="true" />
      </div>
    </>
  );
}

/**
 * The drawer's heading, and **it cannot be one string.**
 *
 * A visitor saw *"Your comments"* directly above *"Comments belong to whoever
 * added this article"* — the body correct, the heading backwards, and half a
 * second of doubt planted exactly where the copy is working hardest to
 * reassure. Found by a browser pass, 2026-08-28; no test would have caught it,
 * because both strings were individually right and nothing compared them.
 *
 * `Your` is the word that does not survive: true for the owner, whose drawer
 * this is, and false for everybody else.
 */
const TITLES: Record<Panel, { own: string; visitor: string }> = {
  questions: { own: "Your comments", visitor: "Comments" },
};

/**
 * A carried query string with a drawer panel asked for in it.
 *
 * `carriedSearch` has just stripped `?panel=` — deliberately, because a drawer
 * left open across a navigation is not a place you were. This puts one back
 * when the navigation is *for* the drawer, which is the one case where it is.
 */
function withPanel(search: string, panel: Panel): string {
  return search ? `${search}&panel=${panel}` : `panel=${panel}`;
}

/**
 * A carried query string with a mode asked for in it.
 *
 * The sibling of `withPanel`, and needed for the same reason: `carriedSearch`
 * strips view state that should not follow you across a navigation, and this
 * puts one back when the navigation is *for* it.
 *
 * Unlike `withPanel` it must overwrite rather than append — `?mode=` may
 * already be in the carried string, and `mode=toc&mode=chat` is a URL whose
 * meaning depends on which one the parser happens to read first.
 */
export function withMode(search: string, mode: Mode): string {
  const params = new URLSearchParams(search);
  /* **Delete rather than write when it is the default**, since 2026-08-29.
     This used to `set` unconditionally, which meant every navigation through the
     dock stamped `?mode=toc` into a URL a reader could copy and share — so when
     the mode was renamed there really were links in the wild carrying the old
     name, and the first draft of that rename claimed there could not be. They
     survive because an unrecognised mode falls back to the default
     (src/web/params.ts § modeParam), but that is a safety net rather than a
     plan. Omitting the default keeps new URLs canonical and stops the next
     rename inheriting the same problem. GPT Sol, 2026-08-29. */
  if (mode === DEFAULT_MODE) params.delete("mode");
  else params.set("mode", mode);
  return params.toString();
}

/**
 * The mode switch: one button per mode, one control, exactly one of them on.
 *
 * ## Why this is a radiogroup and was not one yesterday
 *
 * It was two independent `aria-pressed` toggles, and a note here argued — at
 * length, and correctly for the time — that a radiogroup would be the *worse*
 * lie: the bar showed Chat and Glossary but not `hierarchy`, so a two-option
 * radiogroup would have asserted that the band was one of two things while it
 * was routinely neither. That note named the trigger for changing it, and the
 * trigger was not a third mode arriving. It was **a Hierarchy button existing**
 * (it was called Contents until 2026-08-29),
 * which is what makes "one of these several" a true sentence.
 *
 * Greg asked for the group on 2026-08-25 and the button came with it, so the
 * condition was met by the same change that needed it.
 *
 * ## What a radiogroup costs, and the promise this one deliberately breaks
 *
 * `role="radiogroup"` is a promise about the keyboard, not a label: a screen
 * reader announces "radio group, thirteen items" and its user will then press an
 * arrow key. The ARIA authoring practice makes that good with a roving tabindex
 * — one tab stop for the group — plus arrows that move *and select* in one
 * gesture, plus focus following the selection. This group had all three, and
 * `nextModeIndex` was the wrapping arithmetic pulled out and unit-tested
 * because an off-by-one in it could only otherwise be caught in a browser.
 *
 * **All of it went on 2026-08-31**, and the reason is that on this page the
 * arrows are already spoken for. ↑ / ↓ step through the article and ← / →
 * choose the level they step by (keynav.ts, listening on `window`,
 * docs/project/keyboard.md). That guard skips keys typed into an INPUT or a
 * TEXTAREA, and a `<button>` is neither — so this group called
 * `stopPropagation` to win the collision, and while focus sat anywhere in the
 * bar all four keys stopped doing the job the reader expects of them. Greg,
 * 2026-08-31:
 *
 * > I don't really like the way the keyboard changes modes or sub-modes, so if
 * > it helps, we can remove that functionality. I'd rather up/down *always*
 * > moves the text, and we can use left/right for mode-specific behaviours?
 *
 * There is a second reason, and it is the one that made this urgent rather than
 * tidy: **selecting a mode now spends money.** Since the auto-run rule
 * (docs/plans/260831ai-…), landing on a mode whose artefact has never been
 * built starts a model call, so holding → was four paid jobs from one keypress.
 * A settle delay was drafted to race that; taking the arrows away removes the
 * race instead, which is the smaller thing to have to be right about.
 *
 * **What replaces it: a tab stop per button.** Tab reaches every mode, Enter,
 * Space or a click selects, and no arrow key is captured anywhere in the bar.
 * The cost is that the segment is fourteen tab stops rather than one, so tabbing
 * past the bar takes longer — accepted, because the alternative is worse in a
 * way a mouse cannot see: a roving tabindex with no arrows leaves thirteen of
 * the fourteen modes unreachable by keyboard altogether.
 *
 * `role="radio"` and `aria-checked` stay. *Exactly one of these is on* is still
 * true, it is what the hairline frame says to a sighted reader (styles.css
 * § the modes segment), and it was never what the arrow keys were for.
 *
 * `.diag-kinds` in DiagramPanel.tsx and the matchers in SearchPanel.tsx copied
 * this pattern and lost it in the same change.
 * tests/arrows-belong-to-the-article.test.tsx holds all three.
 *
 * ## The blur on click, which outlived the arrows
 *
 * Greg, 2026-08-26, when the button was still called Contents:
 *
 * > if I'd just clicked the bottom-bar "Contents" button, say, then left/right
 * > changed within that radio group, rather than the Contents columns (which
 * > should be the priority for those keys)
 *
 * Clicking a bar button is how you *get to* the hierarchy, so the arrows you
 * press next are meant for it — and the reader has no reason to think the
 * button they let go of is still listening. A pointer-driven click therefore
 * blurs the button afterwards (`e.detail > 0`, which is 0 for a click
 * synthesised by Enter or Space). That is still worth keeping: nothing in the
 * bar eats the arrows now, but a focused button still takes Enter and Space,
 * and leaving focus on it after a mouse click is not what the reader asked for.
 */

/**
 * How a marked control is drawn.
 *
 * Desaturated and lower contrast, which is NN/G's own prescription for a
 * control that is not fully available. **Not `aria-disabled`**, and that is not
 * an oversight: the button really does respond to a press — it opens the band
 * that explains itself — so announcing it as disabled would be a lie to exactly
 * the reader who most needs the explanation, and would take it away from them
 * at the same time.
 */
const MARKED = "tw:opacity-55";

function DockModes({
  slug,
  diagram,
  modes,
  mode,
  onMode,
  marked,
}: {
  /** The article a press is about, for the activation token. */
  slug: string;
  /**
   * **Which picture a press on Diagram would land on** — `?diagram=`, or
   * `sketch` where the address bar is silent, which is `diagramParam`'s default.
   *
   * Read here rather than baked into a **fixed** `MODE_TARGET` row, because the
   * answer is not fixed, and arming a fixed one leaves a token that a later Back
   * step can spend: activation.ts § `activationForDiagram` has the sequence.
   * Since 2026-09-06 Diagram *does* have a row — a `delegated` one, whose
   * target function consumes exactly this value, which is why it is still a
   * prop.
   *
   * **Already degraded** — `diagramInSearch` in params.ts, which applies the
   * same rule `diagramParam` does, so an unrecognised `?diagram=` arrives here
   * as `sketch` rather than as itself. Reading the raw parameter instead made a
   * press on an old `?diagram=tree` link arm nothing while the mode opened the
   * Sketch, which is precisely the extra button-click this change removes.
   */
  diagram: DiagramKind;
  /**
   * The rows to draw, already filtered — `visibleModes` above, which is where
   * the two rules live. Handed in rather than read from `MODES_UI` here so that
   * the segment and the loose links cannot disagree about what is in the bar,
   * and so that `fitSignature` is measuring the same set that is drawn.
   */
  modes: readonly ModeUi[];
  mode: Mode;
  onMode(next: Mode): void;
  marked?: ReadonlyMap<Mode, string> | undefined;
}) {
  /**
   * **No keyboard handler, and every button its own tab stop — the arrows
   * belong to the article.**
   *
   * This was a roving tabindex with the radiogroup pattern's arrow keys, which
   * is what the ARIA authoring practice prescribes and what `SearchPanel` and
   * `DiagramPanel` copied. It is gone from all three, and the departure is
   * deliberate. Two reasons, and the second is why it could not wait:
   *
   * **The arrows already mean something on this page.** ↑ / ↓ step through the
   * article and ← / → choose the granularity stride (keyboard.md), and this
   * handler called `stopPropagation`, so while focus was anywhere in the bar
   * all four keys stopped doing their job. Greg, 2026-08-31:
   *
   * > I don't really like the way the keyboard changes modes or sub-modes, so
   * > if it helps, we can remove that functionality. I'd rather up/down
   * > *always* moves the text, and we can use left/right for mode-specific
   * > behaviours?
   *
   * **And selection here spends money.** Since the auto-run rule
   * (docs/plans/260831ai-…), landing on a mode with no artefact starts a model
   * call — so holding → was four paid jobs from one keypress, and the same
   * pattern on `.diag-kinds` put a 121–194 second, ~$0.20 sketch one arrow away.
   * A settle delay was drafted to race that; taking the arrows off removes it
   * instead, which is the smaller thing to have to be right about.
   *
   * **The cost, which is real:** the segment goes from one tab stop to fourteen,
   * so tabbing past the bar takes more presses. That is the price of every mode
   * staying reachable without arrows, and it is the right way round — a roving
   * tabindex with no arrows would leave thirteen of the fourteen unreachable by
   * keyboard, which is worse than what was fixed and invisible to a mouse.
   *
   * `role="radio"` and `aria-checked` stay: *exactly one of these is on* is
   * still true, still what the hairline frame says (styles.css § the modes
   * segment), and not what the arrow keys were for.
   *
   * tests/arrows-belong-to-the-article.test.tsx holds all of it.
   */
  return (
    <div className="dock-modes" role="radiogroup" aria-label="What the middle column shows">
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {modes.map((m) => (
          <Tooltip
            key={m.mode}
            placement="top"
            className="tip-soon"
            content={
              <>
                <div className="tip-soon-head">{MODE_LABEL[m.mode]}</div>
                <p>{m.blurb}</p>
                {/* A supplement, never the message. The sentence that actually
                    explains the boundary is in the band this button opens —
                    see the `marked` prop above for why that distinction is
                    load-bearing rather than fussy. */}
                {/* **The band's own sentence, not a second one saying the same
                    thing.** It was a line of its own here until a browser pass
                    read the pair as copy that had drifted — which it was. The
                    tooltip is a preview of what the press opens now, and there
                    is no second string to keep in step. visitor.ts § markedModes. */}
                {marked?.get(m.mode) && <p>{marked.get(m.mode)}</p>}
              </>
            }
          >
            {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern — a real <input type="radio"> cannot carry an icon beside a label, and styling one as a bar button means hiding the input and faking every state it already had */}
            <button
              type="button"
              role="radio"
              className={`dock-btn${m.mode === mode ? " on" : ""}${marked?.has(m.mode) ? ` ${MARKED}` : ""}`}
              aria-checked={m.mode === mode}
              /* Explicit, because the visible label is `display: none` at
                 narrow widths and an accessible name computed from the text
                 would go with it — leaving a screen reader six radio buttons
                 called nothing at all. */
              aria-label={MODE_LABEL[m.mode]}
              /* Every button, not a roving one. See the note above the
                 radiogroup: with no arrow keys to move within the group, a
                 single tab stop would leave thirteen of the fourteen modes
                 unreachable by keyboard. */
              tabIndex={0}
              onClick={(e) => {
                /* **The one place in the app that knows a mode was pressed**,
                   which is why the token is minted here and not in `onMode` —
                   `setMode` is a query-state setter, and Back and Forward move
                   it too. Five of the fourteen modes open on an artefact
                   nobody has paid for yet, and this is what tells that panel
                   the difference between a press and a pasted link.
                   src/web/activation.ts. */
                /* **One call for all fourteen.** Diagram had an `if` of its own
                   here until 2026-09-06; the table it needed the branch for is
                   now total and executes its own row, so what the bar hands over
                   is what it knows — the picture a Diagram press would land on.
                   activation.ts § `MODE_TARGET`, and see `diagram` on the props
                   above. */
                armActivationForMode(slug, m.mode, { diagram });
                onMode(m.mode);
                // A real click leaves the keyboard to the article; Enter and
                // Space (detail 0) leave focus where the reader put it. See the
                // header — this is Greg's ← / → complaint, 2026-08-26.
                if (e.detail > 0) e.currentTarget.blur();
              }}
            >
              <m.icon size={15} />
              {/* Classed so the stylesheet can drop it on a narrow window.
                  Every one of these buttons already carries its label in the
                  tooltip above and in its accessible name below, so hiding the
                  text costs the sighted reader a hover and costs a screen
                  reader nothing — which is why the label is the thing that
                  gives way rather than the button. See § the bar's fit ladder. */}
              <span className={`dock-btn-label${m.keepLabel ? " always" : ""}`}>{MODE_LABEL[m.mode]}</span>
            </button>
          </Tooltip>
        ))}
      </TooltipGroup>
    </div>
  );
}

/**
 * **The wordmark, and the way home**, at the left-hand end of the bar.
 *
 * Not `HomeLogo` rendered somewhere else: that component is `position: fixed`
 * in the top-left of the window, and a control carrying its own position cannot
 * be re-homed by being moved in the markup. What it shares is its *identity* —
 * the same glyph, the same word, the same `--highlight` — which is the thing
 * Greg's decision to move it turned on: the way home moves from the top-left
 * corner to the bottom-left as you go from the shelf into an article, and it is
 * survivable only because it still looks like itself.
 *
 * ## Three ways this says it is not a fourteenth mode
 *
 * The risk here is colour rather than position: in this bar `--highlight` means
 * *hovered or selected*, so an orange control beside the modes could read as one
 * of them. Fable's arbitration, 2026-09-06, and the answers are cheap:
 *
 *  - **Outside the `role="radiogroup"` entirely** — a sibling of `.dock-modes`,
 *    never a child, so a screen reader is never told it is one of a set. That
 *    frame is also the sighted half of the same claim: the hairline box says
 *    *these are the things the document can be*, and this is outside it.
 *  - **A `Link`, never `aria-checked`, never `.dock-btn.on`.** And **no
 *    `aria-current="page"`**, which `DockLink` does carry: this is not a link to
 *    the page you are on, it is the way off it.
 *  - **`.dock-home`, not `.dock-btn`**, so it does not inherit
 *    `.dock-btn:hover { background: var(--panel) }`. A wash in this bar means
 *    hovered-or-selected, and that is the one thing that would make it look like
 *    a mode. It still hovers — by opacity, the way `.logo-home` does.
 *
 * The glyph helps too, for free: it is an image where every mode is a lucide
 * icon, so it is already a different species. If a screenshot at the last rung
 * still reads as fourteen glyphs, the fix is a hairline `border-right` on this
 * element rather than a divider of its own.
 *
 * ## The word, and which mechanism takes it away
 *
 * In a `dock-btn-label`, so § the bar's fit ladder decides when the brand is
 * affordable — the same rule as every other word in the row, rather than a
 * second mechanism. It is the first word the ladder takes (rung 1, with
 * Feedback's), because these two pay least.
 *
 * **Deliberately not `.logo-text`**, which is what `HomeLogo` wraps its letters
 * in: that class is hidden by the 731px query, which would be a second and
 * invisible authority over a word the ladder is supposed to own. The
 * `.logo-letter` spans inside are kept, because they are what the original
 * app's CSS-only logo animations key on and dropping that file in later is the
 * point of them — docs/project/original-version/design-system.md. Anything
 * animating `.logo-text .logo-letter` will need this element's selector adding.
 */
function DockHome() {
  return (
    <Link
      href={LIBRARY_HREF}
      className="logo dock-home"
      title="Spideryarn — back to the library"
      /* Explicit, for the reason `DockLink` gives: the ladder hides the visible
         word, and an accessible name computed from the text would go with it —
         leaving `title`, which is the long sentence rather than the name. */
      aria-label="Spideryarn"
    >
      {/* `alt=""` and not "Spideryarn": the wordmark beside it already says the
          name, and a screen reader reading it twice is how a decorative image
          becomes noise. HomeLogo.tsx says the same in the corner. */}
      <img className="logo-image" src="/spideryarn-logo.png" alt="" width={20} height={20} />
      <span className="dock-btn-label">
        {"Spideryarn".split("").map((ch, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed string, rebuilt whole
          <span className="logo-letter" key={i}>
            {ch}
          </span>
        ))}
      </span>
    </Link>
  );
}

/**
 * **The bar's Feedback trigger, and the gate on it.**
 *
 * A wrapper around one line of markup, and the reason it is a component is the
 * gate rather than the markup: `VisitorDock` in PublicPages.tsx mounts a bar
 * for a signed-out stranger, and `FeedbackTrigger` has no gate of its own by
 * design — the rule that decides who may file a report is one line in App.tsx,
 * next to the gate that decides everything else about being signed in
 * (FeedbackButton.tsx § Who sees it). Drawn unconditionally in this bar it
 * would hand a stranger a button whose `POST /api/feedback` can only answer
 * 401. GPT Sol, G2.
 *
 * **`experimental.signedIn`, not a new prop**, for the reason § the
 * `experimental` prop gives at length: that field comes from the store, which
 * knows the session, so it has one answer on every page — where a prop is
 * something four mount sites can forget, and a control present on one page of
 * an article and gone on the next is the failure the deleted `signedIn` prop
 * actually caused.
 *
 * The trigger *also* renders nothing when it finds no `FeedbackHost` above it,
 * which for a signed-out reader it does not — so on every page the router can
 * produce these two agree, and a test walking the routes cannot tell them
 * apart. That was measured: deleting this gate left the whole route walk green.
 * They are kept as a pair because they answer different questions, and
 * tests/dock-corner-controls.test.tsx § the bar's Feedback trigger is gated on
 * its own is what stops this one becoming a line nothing has an opinion about.
 */
function DockFeedback({ signedIn }: { signedIn: boolean }) {
  if (!signedIn) return null;
  return <FeedbackTrigger variant="dock" />;
}

/**
 * A bar button that goes somewhere.
 *
 * `aria-current="page"` and not `aria-expanded`: this opens no drawer, and
 * saying it does would announce a state that never changes. No chevron either —
 * the `▾` on a drawer trigger promises something will rise out of the bar.
 */
function DockLink({
  href,
  current,
  icon: Icon,
  label,
  title,
  className = "",
  keepLabel,
  onNavigate,
}: {
  href: string;
  current: boolean;
  icon: typeof Info;
  label: string;
  title: string;
  /** Extra classes — `MARKED` for a mode a visitor cannot have, and
   *  `dock-mode` for the loose mode links off the reading view. */
  className?: string | undefined;
  /**
   * Keep this label on every rung of § the bar's fit ladder — `keepLabel` in
   * `MODES_UI`, which is Plain, the way out.
   *
   * It only reaches here off the reading view, where the modes are fourteen
   * loose links rather than a segment. Passing it was missed until GPT Sol
   * found it: the word survived every narrow window on the reading view and
   * vanished on the metadata page, which is the page you are *most* likely to
   * be looking for the way back from.
   */
  keepLabel?: true | undefined;
  /**
   * **This link is about to replace the page, in this tab.** A pass-through to
   * `Link.onNavigate`, which is where the whole note about why it is not
   * `onClick` lives; one caller, the Tweets link below.
   */
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <Link
      href={href}
      onNavigate={onNavigate}
      className={`dock-btn${current ? " on" : ""}${className ? ` ${className}` : ""}`}
      aria-current={current ? "page" : undefined}
      title={title}
      /* Explicit, for the reason DockModes gives: § the bar's fit ladder hides
         the visible label, and an accessible name computed from the text would go
         with it. `title` would step in as a fallback, but `title` is the long
         sentence — a screen reader would read the whole blurb where the name
         is wanted. Not hypothetical since 2026-08-27: these three lose their
         labels on the last rung too, not just the modes.

         So `title` is now the hover description and **not** the accessible
         name — this attribute is. Anything below claiming otherwise is stale. */
      aria-label={label}
    >
      <Icon size={15} />
      {/* Same class the modes segment gives its label, so § the bar's fit ladder
          can drop all eighteen of the bar's labels with one rule rather than with
          one rule and a bare-element selector that would break the moment
          somebody wrapped the text. The name is still announced: the explicit
          `aria-label` above is the accessible name on both of these, and the
          `title` beside it is the long hover sentence. A comment here used to
          name `title` as the accessible name — it was the fallback before the
          `aria-label` was added, and it stopped being true then. GPT Sol. */}
      <span className={`dock-btn-label${keepLabel ? " always" : ""}`}>{label}</span>
    </Link>
  );
}

function DockTab({
  panel,
  current,
  onPanel,
  icon: Icon,
  label,
  title,
  className = "",
  children,
}: {
  panel: Panel;
  current: Panel | null;
  onPanel(next: Panel | null): void;
  icon: typeof Info;
  label: string;
  title: string;
  /** Extra classes — today, `MARKED` for the drawer a visitor cannot fill. */
  className?: string | undefined;
  children?: ReactNode;
}) {
  const on = current === panel;
  return (
    <button
      type="button"
      className={`dock-btn${on ? " on" : ""}${className ? ` ${className}` : ""}`}
      // This button opens a drawer, so `aria-expanded` is the honest
      // relationship — not `aria-pressed`, which would say these are toggles in
      // a set, and not a tab role, which would promise arrow-key traversal we
      // deliberately do not implement (the arrows belong to the article — see
      // keynav.ts). The bar's *other* buttons navigate, and say so differently:
      // DockLink above.
      aria-expanded={on}
      title={title}
      // Explicit for the same reason as DockLink above — the visible label is
      // hidden on a narrow window and `title` is a sentence, not a name.
      aria-label={label}
      onClick={() => onPanel(on ? null : panel)}
    >
      <Icon size={15} />
      {/* Same class the modes segment gives its label, so § the bar's fit ladder
          can drop all eighteen of the bar's labels with one rule rather than with
          one rule and a bare-element selector that would break the moment
          somebody wrapped the text. The name is still announced: the explicit
          `aria-label` above is the accessible name on both of these, and the
          `title` beside it is the long hover sentence. A comment here used to
          name `title` as the accessible name — it was the fallback before the
          `aria-label` was added, and it stopped being true then. GPT Sol. */}
      <span className="dock-btn-label">{label}</span>
      {children}
      <ChevronUp className={`dock-chev${on ? " open" : ""}`} size={12} />
    </button>
  );
}

/**
 * **The experimental-features switch, at the end of the bar.**
 *
 * The bar's fourth kind of button, and it is its own component for the reason
 * the other three are: what a button *is* decides which ARIA state it carries,
 * and a flag on `DockTab` would have been one component claiming to be two
 * things. `DockLink` navigates and says `aria-current`; `DockTab` opens a
 * drawer and says `aria-expanded`; `DockModes` is a radiogroup and says
 * `aria-checked`. This one is a **toggle** and says `aria-pressed` — not
 * `aria-checked`, which would put it in the modes' set, and it is not one of
 * the modes: it decides how many of them there are.
 *
 * ## Four things it must not do, and the fifth it must
 *
 * **It must not move the setting before we have an answer.** A switch drawn
 * from a default lets a reader send *off* over an *on* nobody had read yet — a
 * setting silently reset by looking at the page it lives on. `waiting` and
 * `saving` are inert for that reason.
 *
 * **It must not swallow a failure.** A dead or lying switch is worse than no
 * switch, and the store exposes `loadError`, `error` and `stale` precisely so a
 * control can draw them. `toggleVariant` is the whole rule; `SWITCH_STATE` is
 * what each one says out loud.
 *
 * **It must not be a dead end.** Every state a reader can land in has a press
 * that does something, or is about to resolve on its own. `stale` was the one
 * that failed this: inert, over a cached answer, with nothing anywhere that
 * asks again when the network comes back. `PRESS` is the fix and the reasoning.
 *
 * **A failure must not be visible only on hover.** The tooltip is the long
 * explanation, never the message: a broken switch draws a warning triangle
 * beside the flask, and the same sentence is in the button's `sr-only`
 * description. NN/G's rule, and the same one the `marked` prop above is written
 * around.
 *
 * **And the inert states must still be hoverable**, which is why this uses
 * `aria-disabled` and a guarded handler rather than the `disabled` attribute. A
 * `disabled` button fires no pointer events in Chrome and takes no focus, so
 * the tooltip explaining *why it will not move* would be unreachable in exactly
 * the states that need explaining. styles.css § `.dock-btn.soon` was written
 * for this argument and this is its first user.
 *
 * Greg asked for it mid-run, 2026-09-03: *"show a button at the end of the bar
 * to enable 'Experimental Features' for logged-in users with tooltip to explain
 * what this does."* docs/plans/260903c-… § stage 3.
 */
function DockExperimentalSwitch({
  setting,
  variant,
}: {
  setting: DockExperimental;
  variant: ExperimentalVariant;
}) {
  const press = PRESS[variant];
  /* The two states with something wrong to show. Kept as one name because three
     things key on it: the marker, the on-state, and `aria-invalid`. */
  const broken = variant === "load-failed" || variant === "save-failed";
  const state = SWITCH_STATE[variant](setting.on);
  /* The state sentence is *described by* rather than named — see `aria-label`
     below for the APG rule that forces the split, and `PRESS` for why. */
  const stateId = useId();
  return (
    <Tooltip
      placement="top"
      className="tip-soon"
      content={
        <ControlTip
          head={EXPERIMENTAL_NAME}
          state={state}
          what={EXPERIMENTAL_WHAT}
          how={EXPERIMENTAL_HOW}
        />
      }
    >
      <button
        type="button"
        /* `dock-experimental` styles nothing. It is how a test and a browser
           pass find this one button among eighteen that are all `dock-btn` —
           the alternative is matching on the label, which is copy and is allowed
           to change. `dock-mode` next door is the same idea doing real work for
           the fit ladder.

           **Not painted as on while something is wrong.** A failed load has told
           us nothing, and a failed save has already sprung the value back — in
           both cases the highlighted "on" frame would be the button asserting a
           state we do not have. `soon` is the dim that goes with
           `aria-disabled`. */
        className={`dock-btn dock-experimental${setting.on && !broken ? " on" : ""}${press === "nothing" ? " soon" : ""}`}
        /* **Only where a press actually toggles.** Two reasons, and they land on
           the same three variants. It is a *toggle button* only where pressing
           it moves the setting — in `load-failed` and `stale` the press asks the
           server again, which is an action. And where there is no answer at all
           (`waiting`) or the read failed, `aria-pressed={false}` would be the
           button telling a screen reader the setting is off, which is the
           silent-default mistake in its most direct form.
           docs/reusable/silent-success.md; `PRESS` above. */
        aria-pressed={press === "toggle" ? setting.on : undefined}
        /* **A supplement, and known to be one.** `aria-invalid` is not among the
           states ARIA lists as supported on `role="button"` — it belongs to the
           input-ish roles — so how much of it survives to a screen reader is not
           something to rely on. It is here because it costs nothing and some
           tooling reads it; the thing that actually carries the failure is the
           description below, plus the triangle a sighted reader can see. If it
           were the only carrier this would be the silent-success shape. */
        aria-invalid={variant === "save-failed" ? true : undefined}
        aria-disabled={press === "nothing" || undefined}
        /* **The name is fixed and the state is a description, never both in the
           name.** The APG allows a moving accessible name *or* a fixed one with
           the state in `aria-pressed`, and not both at once — a name that reads
           "Experimental features — On…" beside `aria-pressed="true"` announces
           the state twice and changes the control's identity as it moves. This
           repo had already learnt it: DictationStrip.tsx § *The button is an
           action, not a toggle*. It was both here for one round; GPT Sol caught
           it. Explicit rather than computed from the text, for the reason
           `DockLink` gives — § the bar's fit ladder hides the visible label. */
        aria-label={EXPERIMENTAL_NAME}
        aria-describedby={stateId}
        onClick={() => {
          /* `aria-disabled` does not stop a click the way `disabled` does, so
             the refusal has to be here. It is not silent: the tooltip and the
             description both say what it is waiting for, which is the trade that
             buys the tooltip back. */
          if (press === "nothing") return;
          /* **The press means different things**, and `PRESS` is where that
             lives. With no answer to toggle — a failed read, or a copy out of
             the offline cache — asking again is the useful act; with one, the
             useful act is moving it. */
          if (press === "retry") setting.reload();
          else setting.set(!setting.on);
        }}
      >
        {/* **The state, for a screen reader, in the one place that does not
            fight `aria-pressed`.** Not the name (see above), not the tooltip
            alone (unreachable by touch and by keyboard), and not the visible
            label (dropped by § the bar's fit ladder at narrow widths). Inside
            the button and `sr-only`; the explicit `aria-label` means it
            contributes nothing to the name. */}
        <span id={stateId} className="sr-only">
          {state}
        </span>
        <FlaskConical size={15} />
        {/* Not `always`: this is the last button in the row and the least
            urgent thing in it, so it is among the first labels the ladder
            should be free to drop. Plain's word is the one that stays. */}
        <span className="dock-btn-label">Experimental</span>
        {/* Visible, and one of three carriers — see the header. `aria-hidden`
            because the sentence it stands for is already in the description. */}
        {broken && (
          <TriangleAlert className="tw:text-highlight" size={12} aria-hidden="true" />
        )}
      </button>
    </Tooltip>
  );
}

/**
 * **What the switch is doing right now**, one sentence per appearance.
 *
 * It is read twice for every button: into the accessible name, and into the
 * tooltip. That is the point — `aria-label` is what a screen reader gets and
 * the tooltip is what a sighted reader gets, and a control that can be broken
 * must say the same thing to both. A state carried only by the dimming would
 * be a state half the readers cannot perceive.
 *
 * `on` is a parameter because two of the six sentences need it: what an offline
 * copy says, and what a working switch says. The other four do not read it.
 */
const SWITCH_STATE: Record<ExperimentalVariant, (on: boolean) => string> = {
  saving: () => "Saving…",
  /* Says what to do, because there is something to do. The press is a retry, not
     a toggle — see the handler. */
  "load-failed": () => "Couldn't load this setting. Press to try again.",
  /* The store has already put the value back where it was, so the button is not
     lying about its position; what it must not do is let that pass quietly.
     experimental-store.ts § set. */
  "save-failed": () => "Not saved. Press to try again.",
  /* **A copy, and a way out of it.** The value itself is not one to move —
     another device may have changed it since — but the reader has to be able to
     ask again, because nothing else will: `offline.ts` listens for going offline
     and not for coming back. See `PRESS`, where `stale` is a retry.

     The sentence itself is the profile page's, from experimental-copy.ts rather
     than retyped: two controls for one setting must not tell a reader two
     stories. */
  stale: (on) => `${experimentalOffline(on)} Press to check again.`,
  waiting: () => "Loading…",
  /* `null` for the date — *when* you turned it on is the one thing `/profile`
     can say and a button in a row of eighteen icons cannot. */
  ready: (on) => (on ? experimentalIsOn(null) : EXPERIMENTAL_IS_OFF),
};

/**
 * The wait before the questions, and nothing at all if the wait is short.
 *
 * Its own component only because `useSlow` is a hook and `Questions` returns
 * early — the same reason `ChatListLoading` is one. `.dock-empty` for the type,
 * so the sentence sits exactly where the one it stands in for would.
 */
function QuestionsLoading() {
  const slow = useSlow(true);
  /* `role="status"` for the same reason the chat panel's has one: the sentence
     arrives 600ms late and would otherwise be announced to nobody. */
  return (
    <p className="dock-empty dock-loading" role="status">
      {slow && (
        <>
          <LoaderCircle className="cmt-spinner" size={13} /> Fetching your comments…
        </>
      )}
    </p>
  );
}

/**
 * Every question asked about this article, in the order you meet them coming
 * down the page.
 *
 * This is the panel that did not exist in any form before. The answers have
 * always been reachable — the dialog carries `‹ 3/7 ›` arrows — but there was
 * no way to *see* what you had asked, which is the thing you want when you come
 * back to a piece a day later. Order comes from comment-nav.ts and therefore
 * from the block index, never from the id string (block-ids.md).
 */
/**
 * **Who is reading this list**, and therefore which empty state is honest.
 *
 * The owner's arm carries the two fetch facts, because their list came from a
 * request that can still be out or have failed. A visitor's came inside the
 * page's payload, so neither state exists for them — and neither does the
 * sentence that tells them how to add one.
 */
type QuestionsAccess =
  | { kind: "owner"; loaded: boolean; loadFailed: boolean }
  | { kind: "visitor" };

function Questions({
  comments,
  access,
  onOpen,
}: {
  comments: Comment[];
  access: QuestionsAccess;
  onOpen(id: string): void;
}) {
  /* Narrowed once, so the three reads below are the compiler checking one fact
     rather than three tests that could drift apart — the same move `own` makes
     in `Dock` above. */
  const loaded = access.kind === "visitor" || access.loaded;
  const loadFailed = access.kind === "owner" && access.loadFailed;
  /* **"Nothing asked yet" is a claim about the reader, and it takes a fetch
     that came back and worked to earn it.** Three states get here with an empty
     list and only the third one may say it.

     Waiting: the drawer opens on a keypress and the fetch is still out behind
     it on a slow connection, so the first thing the reader saw was a flat
     denial of the questions they had opened this to find. Behind `useSlow`, so
     a fetch that beats 600ms draws nothing at all rather than a spinner that
     flashes and vanishes — useSlow.ts.

     Failed: the first version of this fix set `loaded` on the failure path too
     and fell straight through to the same sentence, which is the identical lie
     one beat later. GPT Sol caught it, 2026-08-27. The transport error itself
     is printed in the reading view's status line, which is *behind this
     drawer's scrim* — so saying nothing here would have left the reader with a
     denial and no way to see the reason. */
  if (comments.length === 0 && !loaded) {
    return <QuestionsLoading />;
  }

  /* Owner-only by construction: `loadFailed` is `false` on the visitor arm,
     because there was no request. */
  if (comments.length === 0 && loadFailed) {
    return (
      <p className="dock-empty">
        Couldn't load your comments. Reload to try again.
      </p>
    );
  }

  if (comments.length === 0) {
    /* **Two sentences, because the second half of the owner's is an
       instruction a visitor cannot follow.** *"Select a sentence in the article
       to bookmark it"* is the right thing to say to somebody who can, and a
       dead end for somebody who cannot — the shape
       docs/project/copy.md keeps warning about, where the true half of a
       sentence carries a false half along with it. A visitor is told what the
       absence means and nothing else. */
    return (
      <p className="dock-empty">
        {access.kind === "owner" ? (
          <>
            Nothing marked yet. Select a sentence in the article to bookmark it, and add a
            comment if you want one.
          </>
        ) : (
          <>Whoever added this article hasn't marked anything in it.</>
        )}
      </p>
    );
  }
  return (
    <ol className="dock-questions">
      {comments.map((c) => (
        <li key={c.id}>
          <button type="button" className="dock-question" onClick={() => onOpen(c.id)}>
            <span className="dock-question-quote">{c.quote}</span>
            {/* **The reader's own words beat the model's**, which is the whole
                ordering principle of this feature — and the list read as broken
                without it: a comment somebody had written showed only the
                sentence it was about, so scanning the list told you where you
                had stopped but not what you had thought. Found in the browser
                pass, 2026-08-28.

                A bare bookmark has genuinely nothing to preview, and gets no
                line rather than an empty one — the quote is the whole of it. */}
            {previewOf(c) && (
              <span className={`dock-question-state ${c.status}${c.body ? " own" : ""}`}>
                {previewOf(c)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The one line under a row's quote, in the order that says whose list this is.
 *
 * What the reader wrote, then how the model call is going, then what it said,
 * then — for a bare bookmark — nothing at all. The body comes first even on a
 * comment that also has an answer: they made the mark and wrote the note, and
 * the answer is the thing they can open.
 */
function previewOf(c: Comment): string {
  if (c.body) return firstLine(c.body);
  if (c.status === "pending") return "thinking…";
  if (c.status === "error") return "failed";
  return firstLine(c.answer);
}

/**
 * The opening of a line, for the list — enough to recognise which mark this
 * was, not enough to read instead of opening it.
 *
 * Cut on a word boundary rather than mid-syllable, and only when there is
 * something to cut: a short line is shown whole rather than given an ellipsis
 * it has not earned.
 */
function firstLine(answer: string | undefined): string {
  const text = (answer ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= 120) return text;
  const cut = text.slice(0, 120);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}
