/**
 * **The reader just pressed this.** One fact, recorded by the control that is
 * in a position to know it, and read by the panel that is about to decide
 * whether to spend a model call.
 *
 * The controls include artefact-backed mode buttons in the bar and the
 * sub-mode controls for Diagram, Learn, Referee and Summary (including
 * their command-bar rows). Several gestures may arm the same target: Summary's
 * bar button, its Brief and Fuller segments and their command rows all arm
 * `simple`.
 * The bar's Tweets link armed a token from 2026-09-06 to 2026-09-15, when the
 * thread page began writing on arrival instead
 * (useAutoRun.ts § `useAutoRunOnArrival`). The thread is Summary's third view
 * since 2026-10-03 and still writes on arrival, so nothing that opens it arms
 * anything — § `activationForSummary`.
 * Greg's rule is *"if the user **clicks** a mode that
 * hasn't been run yet, automatically run it"*, and the word that carries the
 * money is **clicks**.
 *
 * That started as five surfaces in 2026-09-02 and reached this list on
 * 2026-09-06, when Greg asked for the rest of them:
 *
 * > By opening the mode, the user is implicitly indicating that they want
 * > what's already generated, or to generate it if needed.
 *
 * **What did not change is which gesture counts.** Every one of the five that
 * arrived that day went through the same token rather than firing from a mount,
 * for the reason the next section gives — and two of them, Tweets and
 * Candidates, had been cut back to a button precisely because an earlier version
 * fired on mount. docs/plans/260906b-opening-a-mode-starts-it-generating.md.
 *
 * ## Why a mount is not a click
 *
 * The first version of this feature fired from `status === "none"` after mount,
 * on the reasoning that with the arrow keys gone from the radiogroups
 * (docs/plans/260831ai-…, stage 0) "selection is always an explicit gesture".
 * That is false, and GPT Sol found it. A panel mounts with nobody having
 * pressed anything when:
 *
 *  - a `?mode=ideas` link is pasted, bookmarked or shared;
 *  - Back or Forward walks through mode entries — `?mode=` is `history: "push"`;
 *  - the metadata page (or, until 2026-09-29, the tweets page) links in through `withMode`;
 *  - a history entry predates the feature entirely.
 *
 * So the press is made into data rather than inferred from the state that
 * follows it. Everything else shows the empty state and its button, and spends
 * nothing.
 *
 * ## Why a boolean will not do
 *
 * The token is `{nonce, sessionEpoch, slug, target, owner}`, and every field is
 * load bearing:
 *
 *  - **`nonce`** so that pressing the mode you are already in mints something
 *    new. Without it, a reader whose first press met a failed GET could never
 *    ask again without leaving the mode and coming back — the mode did not
 *    change, so no effect would re-run and nothing at all would happen.
 *  - **`sessionEpoch`** — `jobEngine.epoch()`, which moves whenever the tab's
 *    reader changes — so a press made by the previous reader cannot be spent by
 *    the next one.
 *  - **`slug`** so a press that navigates to a *different* article cannot arm a
 *    panel there.
 *  - **`target`** so that clicking Ideas and then Quotes within a second does
 *    not let the second overwrite and lose the first. They are separate
 *    entries; neither disturbs the other.
 *  - **`owner`** so that the press can only ever be spent by the mount that was
 *    on screen when it was made — § A press belongs to the band that was on
 *    screen, which is the whole of it.
 *
 * And consumption is **synchronous and atomic** — a `delete` that reports
 * whether it removed anything — because React `<StrictMode>` invokes every
 * effect twice, and two invocations reading a token and then clearing it would
 * both pass.
 *
 * ## A press belongs to the band that was on screen
 *
 * **`owner`** is the fifth field, and it is the one that makes the rule true
 * rather than nearly true. The first mount of that panel to see a token
 * **claims** it, and from then on no other mount can ever spend it: a later
 * arrival at the same band finds the token owned by a mount that is gone,
 * retires it, and spends nothing.
 *
 * This is a reversal. Until 2026-09-02 a token whose panel unmounted before its
 * GET settled was deliberately *kept*, so that the press would be honoured the
 * next time that band was on screen. GPT Sol showed what that buys: press
 * Ideas, press Quotes over it, and then reach Ideas again by **Back** — and the
 * Back step starts a paid job. *"The later Back step is still what causes the
 * paid request."* The three bounds the old note offered — one attempt per
 * `(slug, step)`, the session epoch, the tab's life — cap what it can cost and
 * none of them ties the spending to the navigation that authorised it, which is
 * the actual rule: **only a click auto-runs; Back and Forward spend nothing.**
 *
 * The cost, said out loud and chosen: a press whose GET is still in flight when
 * the reader navigates away is **dropped**, so Ideas → Quotes inside a second
 * runs only Quotes. That is a failure to spend, which is the safe direction of
 * the two; the design it replaces took the other one.
 *
 * **Ownership is claimed, not released**, and that is deliberate: React
 * `<StrictMode>` runs every effect's setup, then its cleanup, then its setup
 * again, so a cleanup that retired the token would retire it on mount and the
 * feature would never fire in development. Nothing here runs on teardown.
 * Retirement happens at the moment a *different* mount asks, which is the only
 * moment at which it matters.
 *
 * ## What else retires a token
 *
 * The panel consumes it as soon as its own GET **settles** with an answer:
 * `none` (run it) or `ready` (there is one already). A GET that **failed** is
 * not an answer, and keeps the press — src/web/useAutoRun.ts § A failed read is
 * not an answer. That used to be dangerous, because a kept token could fire
 * against whatever mounted next; `owner` is what makes it safe, since the only
 * mount that can spend it is the one still looking at the error.
 *
 * **And, since 2026-09-05, a band whose very first render threw.**
 * `retireActivation` below is called from `FeatureBoundary`'s
 * `componentDidCatch` (src/web/FeatureBoundary.tsx) with the identity the
 * caught render was holding — that file says exactly why "the render that
 * threw" is not quite the right phrase. That case was previously invisible
 * here: the effect that claims a token never runs if the render before it
 * throws, so the token was left `owner: null` — unclaimed, un-retired, and
 * spendable by whichever mount of that band came next. A later Back could
 * therefore start a paid job nobody pressed for, which is the bug `owner` was
 * introduced to close.
 *
 * Retiring it at the point of failure rather than leaving it to
 * `claimActivation` is earlier and stronger. `claimActivation` only retires a
 * stale token when a **different mount asks**, so the token survives until
 * something arrives to spend it — and the arrival is the thing we are trying to
 * make safe. The boundary knows the moment the press became unspendable, so it
 * says so then. docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md.
 *
 * ## What this module is deliberately not
 *
 * It is not a queue of work and it is not permission to spend. It says only
 * *the reader pressed this control, once, just now*. Whether that costs
 * anything is the panel's own question, answered against its own GET, and
 * capped by `jobEngine.beginAutoAttempt` — one automatic attempt per
 * `(slug, target)` per tab session, so a failure cannot loop.
 *
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 2b.
 */
import type { Mode } from "../modes.js";
import type { AutoRunTarget } from "./auto-run-targets.js";
import type { DiagramKind } from "./diagram.js";
import type { LearnView, SourcesView, SummaryView } from "./params.js";
import type { RefereeView } from "./referee-views.js";
import type { SubMode } from "./sub-modes.js";
import type { StepName } from "../types.js";
import { jobEngine } from "./jobEngine.js";

/**
 * The vocabulary moved to [`auto-run-targets.ts`](./auto-run-targets.ts) on
 * 2026-09-06 and is re-exported here, so every importer that already says
 * `from "./activation.js"` is unchanged. It had to move because
 * `jobEngine.beginAutoAttempt` is keyed on the same union and cannot import this
 * module, which imports it.
 */
export type { AutoRunTarget };

/**
 * **What a press on each mode's bar button arms.** Total over `MODES`, so a new
 * word there is a typecheck error here until somebody has answered the money
 * question — which is the point of it. This table was `Partial`, and under a
 * `Partial` an omitted row and a considered "nothing" are the same thing, so a new
 * artefact-backed mode could be wired end to end with nobody ever asked whether
 * pressing it should start generating.
 * docs/plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md
 * § Stage 4.
 *
 * Three answers, and the second is the one that has to carry a function:
 *
 *  - **`fixed`** — the press arms one named target, always. The five rows that
 *    were the whole of this table before.
 *  - **`delegated`** — opening the mode may start work, but the press's target
 *    is not fixed. The row carries a function that **names the target**, or
 *    answers `null` when the mounted surface starts its own work instead;
 *    `armActivationForMode` below does any arming.
 *    **Not a name, and not a string.** `{ kind: "delegated"; owner: "…" }` was
 *    the round-one draft and GPT Sol refused it: nothing consumes a string, so a
 *    fifteenth mode could write one, typecheck, and have no arming path anywhere
 *    in the app — documentation wearing a type's clothes. A function is the
 *    difference between a row that claims to arm something and one that does.
 *
 *    **It answers rather than acts**, and that is the second round's change:
 *    the row used to be handed `(slug, ctx)` and call `armActivation` itself,
 *    which let a delegated row arm *any* number of targets, for *any* slug,
 *    while the bar's own `MODE_TARGET[mode]` said one thing. A sweep that
 *    watches what a press posts cannot see a token nothing has mounted to
 *    claim — GPT Sol, F12, 2026-09-06. Returning `AutoRunTarget | null` keeps
 *    everything the function bought (it is consumed, so a row that names a
 *    target the app cannot run is a compile error) and makes the *quantity*
 *    structural: one arm per press, or none, decided in one place below.
 *  - **`none`** — nothing to arm, with the reason written out. The reasons were
 *    prose in this docblock until the type asked for them by name.
 *
 * **`debate` is the dearest press in the app** — a metered call that goes
 * out to the open web, up to ~$0.14 and rising with the length of the article
 * (two such calls until `debate/7`, 2026-10-08, when the claims search left
 * the press). **Delegated since that day**: a press landing on Reception arms
 * the search, one landing on Claims arms the claims list — one call and no
 * search. Since 2026-10-09 it is one of Sources' three sub-modes, out of
 * the experimental switch, and **the mode opens on Bibliography**, so a press
 * on the Sources button buys the search only when the address already
 * names Reception (§ `activationForSources`). No navigation buys it; a
 * deliberate press can, again and again, as every paid step can (plan
 * 261009l § Reception's spend).
 *
 * A fourth answer, **`arrival`**, stood here from 2026-09-29 to 2026-10-03 for
 * the one mode whose band starts its own work when it mounts: Tweets. The
 * thread is Summary's Thread view now and still writes on arrival, which a
 * `delegated` row already says — its function answers `null` for the thread, as
 * Diagram's does for the pictures that buy an embedding on mount — so no mode
 * needs the fourth kind (GPT Sol, F7 of the 261003l review).
 */
export type ModeActivation =
  | { kind: "fixed"; target: AutoRunTarget }
  | { kind: "delegated"; target: (ctx: PressContext) => AutoRunTarget | null; why: string }
  | { kind: "none"; reason: string };

/**
 * **What the bar knew at the moment of the press**, for the rows that cannot
 * decide without it.
 *
 * Each field is deliberately the *answer* rather than the raw query string:
 * the bar has already run `diagramInSearch` (params.ts), so an unrecognised
 * `?diagram=` arrives here as `sketch`, exactly as `diagramParam` would open
 * it. This module knows nothing about URLs and must not start to —
 * `activationForDiagram` below says what reading the raw value cost.
 */
export interface PressContext {
  /** Which picture a Diagram press is about to land on. */
  diagram: DiagramKind;
  /**
   * Which of Summary's views a Summary press is about to land on.
   *
   * **On the reading view this is the parsed React state that picks the band,
   * never `location.search` read at render.** nuqs updates React at once and
   * the address up to ~50ms later, so in that gap the address still names the
   * view the reader has just left: choose Thread, then at once take the
   * command bar's Summary row, and a context read from the old address arms
   * `simple` while the thread is what is mounted. Nothing claims that token,
   * and Back to Brief then spends it on a navigation (GPT Sol, F1 of the
   * 261003l review, P0). Dock.tsx § `summary` is where the two sources are
   * told apart.
   */
  summary: SummaryView;
  /**
   * Which of Sources' sub-modes a Sources press is about to land on
   * — the reading view's parsed `?sources=`, for `summary`'s reason
   * above. Each sub-mode's press buys only its own work (§
   * `activationForSources`).
   */
  sources: SourcesView;
}

const MODE_TARGET: Record<Mode, ModeActivation> = {
  glossary: { kind: "fixed", target: "glossary" },
  ideas: { kind: "fixed", target: "ideas" },
  quotes: { kind: "fixed", target: "quotes" },
  timeline: { kind: "fixed", target: "timeline" },
  /* **Delegated**, as Debate's row was since 2026-10-08 (plan 261008i, GPT
     Sol's F1): each sub-mode has its own work, and a press that lands on one
     must not buy another's. Citations' and Debate's rows until 2026-10-09
     (plan 261009l). § `activationForSources`. */
  sources: {
    kind: "delegated",
    target: (ctx) => activationForSources(ctx.sources),
    why: "the sub-mode a press lands on is whatever `?sources=` says: Bibliography arms the citations, Reception the search, Claims the claims list",
  },
  faq: { kind: "fixed", target: "faq" },
  /* The target is the route even when the job it starts writes the Quotes
     first (`precededBy`, src/web/useSkim.ts): the press is for this
     mode's artefact, and the token is keyed on it. */
  skim: { kind: "fixed", target: "skim" },
  /* **One job writes every plain-words level**, so whichever length the band
     opens on, the press arms `simple` — as the band's own Brief and Fuller
     segments and their command-bar rows do one level down (SummaryMode.tsx §
     `SummaryControls`). Until 2026-10-01 Summary opened on the tree's gists,
     which were free; that outline went
     (docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md), and
     until 2026-10-02 the press then armed nothing and the band waited on its
     "Write it". Greg: *"When I open any of the Summary submodes, if they
     haven't already been generated, automatically kick off the generation."*
     (7T, docs/plans/261002a-summary-generates-on-open.md). "Write it" stays,
     for an arrival, which arms nothing here as for every mode.

     **Delegated since 2026-10-03**, when the thread became the third view: a
     press that lands on it arms nothing, because its band writes on arrival
     (§ `activationForSummary`). A `fixed` row would mint a `simple` token with
     no `useSimple` mounted to claim it. */
  summary: {
    kind: "delegated",
    target: (ctx) => activationForSummary(ctx.summary),
    why: "the view a press lands on is whatever `?summary=` says: a length arms `simple`, the thread nothing",
  },

  /* The first delegated row, and the reason the variant carries a function at
     all: the picture a Diagram press lands on is whatever `?diagram=` says, so
     a fixed row would be a lie about half the presses — and an expensive one,
     which `activationForDiagram` below spells out step by step. */
  diagram: {
    kind: "delegated",
    target: (ctx) => activationForDiagram(ctx.diagram),
    why: "the picture a press lands on is whatever `?diagram=` says, not a fixed target",
  },

  /* Free: no model call behind any of them, because the tree they read is
     already there by the time the article is on screen. */
  plain: { kind: "none", reason: "the article and nothing else — there is nothing to generate" },
  structure: { kind: "none", reason: "reads the tree the pipeline already built; no model call" },
  /* Everything else the column shows is read and never made; the relation
     words are its own, and **the column asks for them when it is shown**, not
     when it is pressed (src/web/useRelations.ts § `useAutoRunOnArrival`). Greg,
     2026-10-05: *"generate linking words when Marginalia mode is opened"*. A
     press could not carry it: the first-open default turns the column on with
     nobody pressing anything. So the press arms nothing, as a Summary press
     that lands on the thread arms nothing, and the row is `delegated` rather
     than `none` so the command bar still says the row may start work. Not
     `fixed`: that would mint a `relations` token no hook is mounted to claim,
     and put the step back on the import's list (auto-modes.ts).
     docs/plans/261005d-marginalia-out-of-the-experimental-switch.md. */
  marginalia: {
    kind: "delegated",
    target: () => null,
    why: "the column writes its relation words when it is shown, whatever showed it; a press has nothing left to arm",
  },
  /* Nothing exists to fill until the reader has typed. */
  search: { kind: "none", reason: "stores nothing until the reader types a query" },
  chat: { kind: "none", reason: "stores nothing until the reader asks something" },

  /* **These two arm nothing *as modes*, and that is the honest answer rather
     than a gap.** Each opens on a sub-mode that waits on somebody's own words —
     Referee on Criteria, which has nothing to run until the referee has written
     a criterion; Learn on Recall, which has nothing to run until the reader
     has said what they took from the piece. There is no empty artefact for the
     press to fill, and their opening surfaces do not generate on arrival
     either. Their chips arm
     for themselves, one level down: Referee's through
     `armActivationForRefereeView` below, Learn's inline in
     `LearnSubModeToggle` (QuizPanel.tsx), which is the same call
     `DiagramPanel`'s picture chips make. */
  referee: {
    kind: "none",
    reason:
      "opens a panel without starting a model call; only the Claims chip can arm a run",
  },
  learn: {
    kind: "none",
    reason: "opens on Recall, which waits on the reader's own words (so do Tutorial and Explore); the Quiz chip arms itself",
  },
};

/**
 * **Would opening this mode start work?** One bit, read-only, and the whole of
 * what anything outside this module is allowed to ask `MODE_TARGET`.
 *
 * ## Why it exists
 *
 * So the command bar can be **honest about which of its rows spend**. The Dock
 * discloses by shape — an icon in a fixed place that you reach for, with the
 * mode's own sentence in the tooltip. The bar replaces that with a typed prefix
 * and a reflex Enter, and Fable's arbitration on 2026-09-07 is that what the
 * bar is missing is not a price but exactly this one bit: *does this row start
 * work*. Each row whose answer is `true` carries a muted trailing `generates`.
 * docs/plans/260906h-mode-catalog-and-a-command-bar.md § F1, and its § Review
 * record, which is where GPT Sol's P0 was partly upheld and partly overruled.
 *
 * ## Why it is derived rather than written down
 *
 * `MODE_TARGET` is already **total** over `Mode`, so mode fifteen has to answer
 * the money question before it compiles — and this reads that answer instead of
 * asking for a second one. A hand-maintained list of "the paid ones" beside it
 * would be a fact stated twice, and the copy that goes stale is always the one
 * nothing is watching. **Mode fifteen therefore cannot arrive unmarked**, which
 * is the property, and tests/command-bar.test.tsx holds it.
 *
 * ## What it deliberately does NOT say
 *
 *  - **How much.** No figure, no range. Readers hold slots rather than paying
 *    per call, and the Dock button beside this one says nothing either — a bar
 *    with a price on it and a button without would be *more* disclosed than the
 *    Dock, which reverses a decision Greg made on 2026-09-06
 *    (docs/plans/260906b-opening-a-mode-starts-it-generating.md).
 *  - **Whether the artefact is already there.** So it **over-warns**: open
 *    Glossary on an article whose glossary was built last week and nothing is
 *    spent, while the row still said `generates`. That imprecision is recorded
 *    rather than fixed — the exact answer needs a readiness adapter 260906h is
 *    deliberately not building, and the Dock *under*-warns in the identical
 *    case. Both are acceptable for v1.
 *
 * `delegated` counts as `true` even though its function can return `null` for a
 * given press: the row's honest answer is *this may start work*, and the three
 * Diagram geometries that arm nothing buy an embedding on mount anyway
 * (§ `activationForDiagram`). A marker that went quiet for those would be wrong
 * in the direction that costs money.
 */
export function modeGenerates(mode: Mode): boolean {
  return MODE_TARGET[mode].kind !== "none";
}

/**
 * **The pipeline step this mode makes**, or `null` when it makes none or the
 * answer depends on the press.
 *
 * The second thing `MODE_TARGET` may be asked, for the add page's *generate the
 * main modes* box (src/web/auto-modes.ts): it needs the step names themselves,
 * not the one bit `modeGenerates` gives. Derived for `modeGenerates`'s reason —
 * a second list of "the step each mode makes" would be the copy nobody watches.
 *
 * `delegated` is `null` because the step is the press's, not the mode's
 * (Diagram's picture comes from `?diagram=`, Summary's view from `?summary=`);
 * the two stream targets are `null` because they have no job row. **So a
 * delegated mode drops out of the add page's list unless that file names its
 * steps itself**, which it does for Summary (auto-modes.ts §
 * `DELEGATED_MODE_STEPS`; GPT Sol, F2 of the 261003l review).
 * docs/plans/260930c-auto-generate-the-main-modes-after-import.md.
 */
export function modeStep(mode: Mode): StepName | null {
  const row = MODE_TARGET[mode];
  if (row.kind !== "fixed") return null;
  return row.target === "claims" || row.target === "candidates" ? null : row.target;
}

/**
 * **What each of Referee's chips arms**, which is `MODE_TARGET` one level
 * down. A total `Record` since 2026-10-07, when the fifth chip arrived and GPT
 * Sol's review of plan 261007h pointed out that a `Partial` let it be left out
 * in silence: now a sixth view is a red compile here, and `null` is an answer
 * somebody wrote.
 *
 * `criteria` and `mirror` arm nothing because neither has anything to generate
 * until the referee has written a criterion or left a comment — there is no
 * empty artefact for a press to fill. `hidden` arms nothing because the source
 * scan it shows has already run, and calls no model.
 *
 * **`candidates` armed its run from 2026-09-06 to 2026-10-03, and is `null` on
 * purpose.** Its first turn may run a web search, which sends terms drawn from
 * an unpublished manuscript to a search engine — a third party the model
 * provider's notice does not cover. While the chip started it, that warning had
 * to be on screen before any chip was pressed, so it was drawn above the chips
 * in all four sub-modes; Greg met the result as a mode that buries its actions
 * under warnings (`spya-vbeyse`). A tooltip on the chip could not stand in: a
 * touch device has no hover. So the chip opens the panel and the panel's own
 * button starts the turn, with the sentence beside it (CandidatesPanel.tsx §
 * `StartBrief`).
 *
 * `useAutoRun(slug, "candidates", …)` in `CandidatesBand` is left in place and
 * has no producer: putting the row back is then the whole of undoing this, and
 * whether to is an open question for Greg ([Q-candidates-press] in
 * docs/plans/261003k-referee-mode-puts-the-actions-first-and-the-notices-behind-one-button.md).
 * If it comes back, the warning above the chips comes back with it.
 *
 * docs/plans/260906b-opening-a-mode-starts-it-generating.md § Stage 4.
 */
const REFEREE_TARGET: Record<RefereeView, AutoRunTarget | null> = {
  criteria: null,
  claims: "claims",
  mirror: null,
  candidates: null,
  hidden: null,
};

/**
 * **One mount of one panel.** Compared by reference and never read, so nothing
 * about the panel leaks into this module and nothing here can be forged by a
 * value that happens to be equal.
 */
export type ActivationOwner = symbol;

interface Activation {
  /** Distinct per press, so pressing the same button twice is two presses. */
  nonce: number;
  /** `jobEngine.epoch()` when it was minted. A different reader cannot spend it. */
  sessionEpoch: number;
  slug: string;
  target: AutoRunTarget;
  /**
   * The mount that may spend it, claimed by the first one to look, and `null`
   * only in the gap between the click and that panel's first effect — which is
   * one commit, because the click changes the mode and the panel mounts with
   * it. See § A press belongs to the band that was on screen.
   */
  owner: ActivationOwner | null;
}

/**
 * One pending press per `(slug, target)`.
 *
 * A `Map` rather than a single slot: see § Why a boolean will not do. Two rapid
 * presses on different modes are two intents, and the reader made both.
 */
const pending = new Map<string, Activation>();
const subscribers = new Set<() => void>();
let nonces = 0;

const keyOf = (slug: string, target: AutoRunTarget) => `${slug}\u0000${target}`;

const emit = () => {
  for (const fn of [...subscribers]) fn();
};

/**
 * **The reader pressed the control for this target.** Called from a real press,
 * and from nowhere else.
 *
 * Not from `setMode` or any other query-state setter: that is what Back and
 * Forward move, and history must never manufacture an activation.
 *
 * **A press is not always an `onClick`, and has not been since 2026-09-08.**
 * That sentence read *"called from a real `onClick`"* until the command bar
 * arrived: its mode rows arm from the `Enter` that takes them, so an arming can
 * come from a keypress in a modal dialog. The rule the wording was protecting is untouched — it is
 * *deliberate act versus navigation*, and Enter on a row a reader chose is as
 * deliberate as a click on the button beside it. What is still forbidden is the
 * thing history does. 260908e.
 */
export function armActivation(slug: string, target: AutoRunTarget): void {
  nonces += 1;
  pending.set(keyOf(slug, target), {
    nonce: nonces,
    sessionEpoch: jobEngine.epoch(),
    slug,
    target,
    owner: null,
  });
  emit();
}

/**
 * **A press on one of the bottom bar's mode buttons**, whatever that mode turns
 * out to arm — which, for several of them, is nothing.
 *
 * The `switch` is exhaustive and ends on a `never`, so a fourth variant cannot
 * be added to `ModeActivation` without a branch here. And because the table is
 * total, this is the **one** call the bar makes for every mode: Dock.tsx
 * carried an `if (m.mode === "diagram")` branch until 2026-09-06, which was a
 * special case the type could not oblige anybody else to write, and is the
 * whole reason the delegated row holds a function rather than a name.
 */
export function armActivationForMode(slug: string, mode: Mode, ctx: PressContext): void {
  const decision = MODE_TARGET[mode];
  switch (decision.kind) {
    case "fixed":
      armActivation(slug, decision.target);
      return;
    case "delegated": {
      /* **The sole arm for a delegated row, and it is here rather than in the
         row**, so that "one press, at most one token" is a property of this
         function instead of a promise each row makes separately. */
      const target = decision.target(ctx);
      if (target !== null) armActivation(slug, target);
      return;
    }
    case "none":
      return;
    default: {
      const unhandled: never = decision;
      throw new Error(`unhandled activation: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * **What a press that lands on one of Summary's views arms**: `simple` for
 * either length, and nothing for the thread.
 *
 * One answer for the three places that must agree — the bar's delegated row,
 * the band's own segments and their command-bar rows (`subModeTarget`), and the
 * token the boundary retires (`bandTarget`).
 *
 * **The thread arms nothing because its band writes on arrival**, not on a
 * press: `useTweets` calls `useAutoRunOnArrival`, which claims no token
 * (Greg, 2026-09-12: *"automatically start generating … when opened (without
 * having to click a button to kick it off)"*, kept on 2026-10-03 with *"keep
 * all of the tweet thread. Functionality and UI"*). A token minted here would
 * be `simple`'s, with `TweetsBand` mounted and no `useSimple` to claim it — a
 * spend still owed, which Back onto Brief would then collect.
 * docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md §
 * Decision 6.
 */
export function activationForSummary(view: SummaryView): AutoRunTarget | null {
  return view === "thread" ? null : "simple";
}

/**
 * **What a press that lands on one of Sources' sub-modes arms**: the
 * `citations` list for Bibliography, the `debate` search for Reception, and
 * the `debate-claims` list for Claims.
 *
 * One answer for the three places that must agree, as `activationForSummary`
 * is: the bar's delegated row, the command bar's sub-mode rows
 * (`subModeTarget`), and the token the boundary retires (`bandTarget`). The
 * band's own chips arm through `subModeTarget` too (SourcesMode.tsx §
 * `SourcesViews`). Bibliography's arm was Citations' fixed row until
 * 2026-10-09 (plan 261009l).
 *
 * **Two targets, never one** (2026-10-08). Until `debate/7` both sub-modes
 * armed the one `debate` run, which searched for both; the press now searches
 * for Reception only, so a Claims press arming it would buy Reception for a
 * reader who asked for claims (GPT Sol's F1 on plan
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md). Claims' own work
 * is the list of the article's claims, one call and no search (that plan's
 * § 2), and each hook spends only its own target and only while its sub-mode
 * is showing (useDebate.ts, useDebateClaims.ts), so neither press can buy the
 * other's work.
 */
export function activationForSources(view: SourcesView): AutoRunTarget {
  switch (view) {
    /* Citations' fixed target until 2026-10-09: the list of works cited. */
    case "bibliography":
      return "citations";
    case "reception":
      return "debate";
    case "claims":
      return "debate-claims";
    default: {
      const unhandled: never = view;
      throw new Error(`unhandled Sources view: ${String(unhandled)}`);
    }
  }
}

/**
 * **Which picture a press on the bar's Diagram button is about to land on**,
 * as an `AutoRunTarget` — or `null` for the three that have no artefact behind
 * them. Whatever `?diagram=` currently says, `sketch` by default.
 *
 * It **answers**; `armActivationForMode` above does the arming. See
 * `ModeActivation` § `delegated` for why that split, and for what it was
 * before 2026-09-06.
 *
 * This is what `MODE_TARGET`'s **delegated** Diagram row calls, rather than a
 * `fixed` target beside the other five, and the reason is a bug a fixed row
 * would have. GPT Sol found it in the plan for this change, 2026-09-06:
 *
 *  1. open Diagram and press the Illustrated chip, so `?diagram=illustrated`;
 *  2. leave for Plain — `?diagram=` survives, it is query state;
 *  3. press Diagram in the bar. A row saying `diagram: "sketch"` mints a
 *     **sketch** token, but `IllustratedView` is what mounts, so nothing claims
 *     it and it stays in the map, unowned;
 *  4. walk **Back** to a history entry whose `?diagram=` was `sketch`;
 *  5. `SketchView` mounts, finds an unowned token, claims it, and spends $0.20
 *     on a navigation nobody made a press for.
 *
 * Nothing expires an unclaimed token — `claimActivation` retires one only when a
 * *different* mount asks — so the fix has to be at the mint: arm the target that
 * is going to mount, and it is claimed on the next commit like every other.
 *
 * ## The three geometries arm nothing, which is **not** the same as costing
 * nothing
 *
 * That sentence used to end *"cost nothing and are instant"*, and it was false.
 * GPT Sol found it, F11, 2026-09-06, along with the reason nothing caught it:
 * the money sweep in tests/every-mode-draws-its-surface.test.tsx was written from
 * this paragraph, and recorded only `POST /api/jobs`.
 *
 * What is true is that Force, Drift and Trail have **no artefact to generate**,
 * so there is no job to post and nothing here to arm — the tree they are drawn
 * from is already on the page. But the pictures themselves buy an embedding:
 * `useSimilar` POSTs `/api/similar` for **Force**, and `useProjection` POSTs
 * `/api/projection` for **Drift** and **Trail** (DiagramPanel.tsx § `similar`
 * and § `projection`; src/similar.ts meters it to the ledger).
 *
 * Those two fetches are gated on the picture being on screen and on the reader
 * owning the article — **and on nothing else, a press included**. So arming
 * them here would buy nothing anyway: the hook has already asked by the time a
 * token could be claimed. It also means a reader reaches them *without*
 * pressing, by a pasted or bookmarked `?mode=diagram&diagram=force` or by Back
 * onto one. That is known and deliberate — useSimilar.ts § `enabled` is the
 * whole gate weighs it, and `NEEDS_AN_EXPLICIT_PRESS` in last-view.ts is what
 * stops a *restore* from making the request — but it is the one paid request in
 * the reading view that this module does not stand in front of, and the reason
 * this paragraph now says so out loud.
 *
 * Only `sketch` and `illustrated` are runs this module can start, and both are
 * named in `AutoRunTarget`, so this narrowing is the same one `DiagramPanel`'s
 * chips make — a sixth picture with an artefact behind it cannot be armed here
 * until it is a target there.
 *
 * @param kind which picture the reader will be looking at after the press —
 *   **already degraded** by `diagramInSearch` (params.ts), so an unrecognised
 *   `?diagram=` arrives as `sketch`, exactly as `diagramParam` would open it.
 *   Handing this the raw query value is a bug rather than a shortcut: a link
 *   from August saying `?diagram=tree` would arm nothing while the mode opened
 *   the Sketch, so the press would do nothing at all. The bar does the reading,
 *   so this module needs to know nothing about URLs.
 */
export function activationForDiagram(kind: DiagramKind): AutoRunTarget | null {
  return kind === "sketch" || kind === "illustrated" ? kind : null;
}

/**
 * The same, for a press on one of Referee's sub-mode chips. All but Claims
 * arm nothing — `REFEREE_TARGET` says which and why.
 *
 * Called from the chip's own `onClick` in `RefereeViews`, and from nowhere
 * else. **Not from the `?referee=` setter beside it**, which is what
 * Back and Forward move: retracing your steps through the chips must not buy a
 * claims run. Same rule, same reason, as `armActivationForMode`.
 */
export function armActivationForRefereeView(slug: string, view: RefereeView): void {
  const target = REFEREE_TARGET[view];
  if (target) armActivation(slug, target);
}

/**
 * **What a press on one sub-mode arms**, or `null` — the same answer each
 * sub-mode's own chip gives, gathered into one function for the command bar's
 * sub-mode rows (src/web/sub-modes.ts; Greg, SPIDERYARN-READING2-77). Each arm
 * is the chip's rule, read from where that rule already lives:
 *
 *  - Learn: Quiz arms `quiz`, Recall nothing (QuizPanel.tsx §
 *    `LearnSubModeToggle`);
 *  - Diagram: `activationForDiagram` of the picture **the row names** — never of
 *    whatever `?diagram=` said before the press, which is the orphaned-token bug
 *    that function's docblock walks through;
 *  - Referee: `REFEREE_TARGET`;
 *  - Summary: `activationForSummary` of the view **the row names** — `simple`
 *    for Brief and Fuller, nothing for Thread (SummaryMode.tsx §
 *    `SummaryControls`, and `bandTarget` below);
 *  - Sources: `activationForSources` of the sub-mode **the row
 *    names** — `citations` for Bibliography, `debate` for Reception,
 *    `debate-claims` for Claims.
 *
 * `bandTarget` below gives the same answer for the band that mounts, which is
 * what lets a token armed here be claimed — tests/command-bar-sub-modes.test.tsx holds
 * that the two agree for every sub-mode.
 */
export function subModeTarget(sub: SubMode): AutoRunTarget | null {
  switch (sub.mode) {
    case "learn":
      return sub.view === "quiz" ? "quiz" : null;
    case "diagram":
      return activationForDiagram(sub.view);
    case "referee":
      return REFEREE_TARGET[sub.view];
    case "summary":
      return activationForSummary(sub.view);
    /* Nothing to generate in either view: the tree is in the page's payload. */
    case "structure":
      return null;
    /* **Bibliography's row arms the citations, Reception's the `debate`
       search, Claims' the claims list** — the mode row's own answer
       (`activationForSources`). The band's own chips arm through here too
       (SourcesMode.tsx § `SourcesViews`). */
    case "sources":
      return activationForSources(sub.view);
    default: {
      const unhandled: never = sub;
      throw new Error(`unhandled sub-mode: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** A press on a sub-mode row: arm what its chip would arm, or nothing. */
export function armActivationForSubMode(slug: string, sub: SubMode): void {
  const target = subModeTarget(sub);
  if (target !== null) armActivation(slug, target);
}

/**
 * **Would opening this sub-mode start work?** — `modeGenerates`, one level
 * down, for the command bar's `generates` marker. Every Diagram picture says
 * yes, for the reason `modeGenerates` gives the delegated row: Force, Drift and
 * Trail arm nothing but buy an embedding on mount, and a marker that went quiet
 * for them would be wrong in the direction that costs money. **Summary's Thread
 * says yes by name for the same reason**: its row arms nothing and its band
 * writes the thread on arrival.
 */
export function subModeGenerates(sub: SubMode): boolean {
  if (sub.mode === "diagram") return true;
  if (sub.mode === "summary" && sub.view === "thread") return true;
  return subModeTarget(sub) !== null;
}

/**
 * **Which of these presses the band now on screen would claim** — the one
 * token its error boundary must retire if the band throws before `useAutoRun`'s
 * effect has run. src/web/reader/ModeBoundary.tsx is the one caller.
 *
 * It has to be the press's own answer and not a second guess at it, because
 * `retireActivation` compares identities: a boundary holding `sketch` while the
 * bar armed `illustrated` retires nothing, and the token waits for a later mount
 * to spend it. So each arm below reads the table the press itself read — the
 * bar's `MODE_TARGET` for a mode press, `REFEREE_TARGET` for a Referee chip, and
 * the literal `"quiz"` the Learn toggle arms (QuizPanel.tsx §
 * `LearnSubModeToggle`). A Diagram chip arms `activationForDiagram` of the
 * picture it lands on and a Summary segment `activationForSummary` of its view,
 * which are the delegated rows' answers too.
 *
 * `sub` is the sub-mode each band is showing, **already parsed** the way the
 * band parses it — this module knows nothing about URLs, for the reason
 * `activationForDiagram` gives.
 */
export function bandTarget(
  mode: Mode,
  sub: {
    diagram: DiagramKind;
    referee: RefereeView;
    learn: LearnView;
    summary: SummaryView;
    sources: SourcesView;
  },
): AutoRunTarget | null {
  if (mode === "referee") return REFEREE_TARGET[sub.referee];
  if (mode === "learn") return sub.learn === "quiz" ? "quiz" : null;
  const decision = MODE_TARGET[mode];
  switch (decision.kind) {
    case "fixed":
      return decision.target;
    case "delegated":
      return decision.target({ diagram: sub.diagram, summary: sub.summary, sources: sub.sources });
    /* No press was armed, so there is none to retire. */
    case "none":
      return null;
    default: {
      const unhandled: never = decision;
      throw new Error(`unhandled activation: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The pending nonce for this panel, or null. `useSyncExternalStore`'s snapshot.
 *
 * A number rather than the token, so the snapshot is a primitive React can
 * compare without a memo, and so nothing downstream can hold a reference to a
 * token it has not consumed.
 */
export function pendingActivation(slug: string, target: AutoRunTarget): number | null {
  return pending.get(keyOf(slug, target))?.nonce ?? null;
}

/**
 * **Exactly which press**, for a caller that has to be able to say later that
 * it means *that one and no other*.
 *
 * The two fields are the whole of the identity a retirement is allowed to act
 * on. `slug` and `target` are not in it because they are the key it is looked
 * up under, and a value that carried its own key would let the two disagree.
 */
export interface ActivationIdentity {
  nonce: number;
  sessionEpoch: number;
}

/**
 * The full identity of the press whose `nonce` the caller just observed, or
 * `null` if the slot has changed since.
 *
 * **A plain read, not a snapshot.** `pendingActivation` stays the thing
 * `useSyncExternalStore` subscribes to, because a snapshot that returned a
 * fresh object on every call would never compare equal and would loop; this is
 * what a caller then asks to fill the primitive out.
 *
 * **It takes the nonce the caller observed** rather than reading whichever
 * token happens to be there now — GPT Sol, 2026-09-05. Between the subscription
 * waking a component and that component rendering, the press can have been
 * spent and a newer one armed; returning the newer one's epoch under the older
 * one's nonce would mint an identity that never existed. So the nonce is the
 * question, and a mismatch is `null`.
 */
export function activationIdentity(
  slug: string,
  target: AutoRunTarget,
  nonce: number,
): ActivationIdentity | null {
  const held = pending.get(keyOf(slug, target));
  if (!held || held.nonce !== nonce) return null;
  return { nonce: held.nonce, sessionEpoch: held.sessionEpoch };
}

/**
 * **This press is unspendable; take it away.** Compare-and-retire, and the
 * comparison is the whole of it.
 *
 * Called from `FeatureBoundary.componentDidCatch` when a band's render threw —
 * see § What else retires a token. It deletes only when **both** the stored
 * `nonce` and the stored `sessionEpoch` match, so it cannot erase a newer press
 * (different nonce), a different reader's press (different epoch) or another
 * target's token (different key, so nothing is even looked at).
 *
 * **`owner` is deliberately not compared.** Both states a failed render can
 * leave the token in are wrong to keep: unclaimed, because the effect that
 * would have claimed it never ran; and claimed, because the mount that claimed
 * it is the one that has just been torn down. Neither can ever be spent by
 * anybody who should be allowed to.
 *
 * Returns whether it deleted anything, so a caller can assert the case it meant
 * to be in rather than assume it. `emit()` fires only on a real deletion — a
 * no-op notification would wake every subscriber to tell them nothing changed.
 */
export function retireActivation(
  slug: string,
  target: AutoRunTarget,
  identity: ActivationIdentity,
): boolean {
  const key = keyOf(slug, target);
  const held = pending.get(key);
  if (!held) return false;
  if (held.nonce !== identity.nonce) return false;
  if (held.sessionEpoch !== identity.sessionEpoch) return false;
  pending.delete(key);
  emit();
  return true;
}

/**
 * **This mount, and no other, may spend this press.** Called before anything
 * else, on every run of the panel's auto-run effect.
 *
 * Three answers in one boolean, and the false ones are different:
 *
 *  - **no such token** — nothing pressed, or it has already been spent;
 *  - **owned by another mount** — the press was made while a different mount of
 *    this panel was on screen and that mount is gone. The token is **retired
 *    here**, which is the whole of the fix for the Back-spends-a-press bug;
 *  - **ours** — claimed on the first call and idempotent afterwards, which is
 *    what makes `<StrictMode>`'s setup / cleanup / setup harmless.
 */
export function claimActivation(
  slug: string,
  target: AutoRunTarget,
  nonce: number,
  owner: ActivationOwner,
): boolean {
  const key = keyOf(slug, target);
  const held = pending.get(key);
  if (!held || held.nonce !== nonce) return false;
  if (held.owner === null) {
    held.owner = owner;
    return true;
  }
  if (held.owner === owner) return true;
  /* Somebody else's press, and its panel is not this one. Retire it rather than
     leave it lying about for the next mount to ask the same question of. */
  pending.delete(key);
  emit();
  return false;
}

/**
 * **Spend it, once.** True exactly once per press, to exactly one caller.
 *
 * Synchronous, and the delete happens before this function returns, which is
 * what makes `<StrictMode>`'s double-invoked effect harmless: the second
 * invocation finds nothing.
 *
 * `nonce` is checked so that a press which arrived *after* this render — the
 * reader pressing again while the GET was still in flight — is not spent by an
 * effect that was about to run for the older one. `owner` is checked for the
 * same reason `claimActivation` checks it, and belt-and-braces: the only caller
 * claims first, and a second caller that did not would otherwise be spending a
 * press made on a screen it was never on.
 */
export function consumeActivation(
  slug: string,
  target: AutoRunTarget,
  nonce: number,
  owner: ActivationOwner,
): boolean {
  const key = keyOf(slug, target);
  const held = pending.get(key);
  if (!held || held.nonce !== nonce) return false;
  if (held.owner !== null && held.owner !== owner) return false;
  pending.delete(key);
  /* **The session it was minted in, checked at the last moment rather than at
     mint time.** The reader can sign out between the press and the GET
     settling, and the engine's generation is the one thing that knows. The
     token is dropped either way — it is spent or it is stale, and neither
     leaves it lying about. */
  const live = held.sessionEpoch === jobEngine.epoch();
  emit();
  return live;
}

export function subscribeActivations(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/** Back to a fresh store. For tests, and for nothing else. */
export function resetActivations(): void {
  pending.clear();
  nonces = 0;
  emit();
}
