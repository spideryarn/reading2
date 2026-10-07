/**
 * **Type a word, press Enter, be in that mode** — or on that page, or with that
 * dialog open. Spotlight for the modes and for the page and action rows beside
 * them. Most of those other rows arrived on 2026-09-08; their exact count now
 * depends on whether this Dock has an article, a Comments drawer and a Feedback
 * host.
 *
 * Greg asked for it on 2026-09-05:
 *
 * > I'd also like to have a command bar where I can type (or even talk) and it
 * > would open the appropriate mode (a bit like Spotlight/Alfred on the Mac)
 *
 * and the four product calls that shape this file were his, made on 2026-09-06
 * before any of it was written (docs/plans/260906h-mode-catalog-and-a-command-bar.md
 * § The four product calls). **Two of them he has since changed** — on
 * 2026-09-07 and again on 2026-09-08 — which is marked on each rather than
 * tidied away, because the reasoning that produced them is still the reasoning
 * that keeps the bar small:
 *
 *  1. **Modes only** — *until 2026-09-07*, when Greg asked for the changelog
 *     here too: *"add the Changelog to the footer (e.g. of the Homepage, and
 *     also as a command from the Command Bar."* And widened again on
 *     2026-09-08, when he asked for six more by name
 *     (SPIDERYARN-READING2-2D, and docs/plans/260908e-more-commands-in-the-command-bar-and-the-button-beside-the-logo.md):
 *
 *     > Add Library, Feedback, Metadata, Tweets, Homepage, Profile, and a few
 *     > more likely/useful commands to Command Bar.
 *
 *     Two of those are pages about *this* article and one is not a place at
 *     all, so `besideTheModes` below is a function of where the bar was opened
 *     rather than the constant it used to be, and `Command` in command-match.ts
 *     grew a third arm to hold the one that opens a dialog. **What the original
 *     call refused is still refused**, and for the reason it gave: a passage
 *     jump and an "ask this article" would each need the bar to grow an
 *     *argument*, and it has one text box and it is the filter.
 *
 *     **And on 2026-10-01, sub-modes** (SPIDERYARN-READING2-77): *"In the
 *     Command bar, include sub-modes, e.g. Quiz mode, Illustrated diagram,
 *     etc."* A fourth arm, `submode`, drawn after the mode rows and before the
 *     pages, which opens its mode with that chip pressed — armed as the chip
 *     arms, never as the mode does. `subModeRows` below, src/web/sub-modes.ts,
 *     and docs/plans/261001d-command-bar-lists-sub-modes.md.
 *
 *     On the reading view, a mode row's Enter opens it **exactly as pressing
 *     its Dock button does** — same activation, same generate-on-open, same
 *     cost. On the Metadata page it follows the mode link drawn there and arms
 *     nothing, which is likewise exactly what that surface's control does
 *     (Dock.tsx § `useActivateMode`). A non-mode row could spend too: Tweets
 *     was plain navigation to the thread page (until it became a mode,
 *     2026-09-29), which wrote on owner arrival when empty, and the row wore
 *     the `generates` marker for that consequence.
 *  2. It is reachable by **⌘/Ctrl-K and by a button in the Dock**, because
 *     ⌘-K does not exist on a phone. The Dock keeps every mode button it has —
 *     this is an additional door, never a replacement. **The button moved to
 *     the left-hand end of the bar on 2026-09-08**, just after the wordmark, on
 *     Greg's ask in the same report; the chord did not move and could not,
 *     since it is bound to the window rather than to the button
 *     (Dock.tsx § `useCommandBarChord`).
 *  3. **No match says `No command matches.` and nothing else.** That overrode
 *     the recommendation put to him, which was to offer the article search as a
 *     fallback row. An honest empty state was preferred to a helpful guess.
 *     **Since 2026-10-03 a signed-in reader is also told that Enter will ask
 *     what they meant** (spya-t0dg9u, plan 261003k): a sentence that names no
 *     row goes to a fast model, which answers with one of this bar's own rows
 *     or with nothing. Still no guess — nothing is asked or drawn until that
 *     Enter, or a press on the button that says so (2026-10-05, `ASK_LABEL`:
 *     a phone may have no on-screen Enter after dictation). `ask` below, and
 *     src/command-pick.ts.
 *  4. **The bar's mode rows are exactly what the Dock offers, directly or
 *     under its More button** — narrowed from *the bar lists exactly what the
 *     Dock lists* by the 2026-09-07 change, since the rest are the bar's own,
 *     and reworded on 2026-10-07, when five modes left the Dock's buttons for
 *     its More menu and had to stay one ⌘K away (plan 261007c, D5). The
 *     surviving half is still true *by construction* rather than by agreement:
 *     the reachable modes arrive as a prop, computed once by `visibleModes` in
 *     Dock.tsx — the same array the Dock then splits into buttons and menu —
 *     so there is no second copy of the experimental-switch rule to keep in
 *     step. Everything else is appended **after** that prop, never mixed into
 *     it, which is what keeps the halves separable — and
 *     tests/command-bar.test.tsx asserts both halves rather than the old
 *     single one.
 *
 * ## It does not import from `Dock.tsx`, and that is a hard constraint
 *
 * `Dock.tsx` imports *this*, so an import back would close a dependency cycle —
 * GPT Sol's F3, and a real catch, because the obvious way to write this file is
 * `import { visibleModes } from "./Dock.js"`. Everything the bar needs about
 * the Dock arrives as a prop: the list, and the one callback that opens a mode.
 *
 * ## A native `<dialog>`, following FeedbackDialog.tsx
 *
 * `showModal()` gives the focus trap, the focus restore, the inert background
 * and Escape without any of them being written here. There is no shadcn
 * `Dialog` and no `cmdk` in this repo, and this is not the change that should
 * add one.
 *
 * **`showModal()` is not enough on a phone**, which is the other thing copied
 * from FeedbackDialog: iOS does not shrink the layout viewport for its
 * keyboard, it pans a smaller *visual* viewport over one that is still full
 * height, so a dialog placed by CSS sits under the keys. `useVisualViewport`
 * says the whole of it; the two numbers on the `style` below are the fix.
 *
 * ## Where the styling is
 *
 * In `tw:` utilities on the elements, not in a sheet under `src/web/styles/`,
 * and that is a deliberate exception worth flagging rather than a shortcut. By
 * docs/project/design-css-overview.md § Which mechanism owns what, a component
 * that reads as a *system* belongs in its own sheet — but a new sheet has to be
 * `@import`ed from `src/web/styles.css` at a chosen position, because the
 * import order **is** the cascade order (tests/styles-entry-is-imports-only.test.ts),
 * and that file is another agent's ground this week. The semantic class names
 * are all here (`cmdbar`, `cmdbar-row`, …) so the move is a cut and paste when
 * the ground is free; web-client.md § Never delete a semantic class name is why
 * they are on the elements even while they carry no rules.
 */
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type ArgumentKind,
  COULD_NOT_TELL,
  MAX_SENTENCE,
  type PickAnswer,
  type PickRequest,
  RUN_AT_ONCE,
  sameKey,
} from "../command-pick.js";
import {
  LENS_DESCRIPTION,
  SUGGESTING,
  SUGGEST_DESCRIPTION,
  SUGGEST_HEADING,
  SUGGEST_LABEL,
  SUGGEST_NOTHING,
  SUGGEST_NO_REASON,
  type SuggestRequest,
  type Suggestions,
  lensLabel,
} from "../command-suggest.js";
import { PUBLIC_SHELF_LABEL } from "../messages.js";
import { MODE_LABEL } from "../title-text.js";
import { modeGenerates, subModeGenerates } from "./activation.js";
import { useFeedbackOpen } from "./FeedbackButton.js";
import {
  commandId,
  commandText,
  modeCommand,
  parseArgumentQuery,
  pickKey,
  rankCommands,
  subModeCommand,
  type ActionOutcome,
  type ArgumentQuery,
  type Command,
} from "./command-match.js";
import { askForPick } from "./command-pick-client.js";
import { REASON_NOT_READ } from "../messages.js";
import { askForSuggestions, useReasonForReading } from "./command-suggest-client.js";
import {
  type CommandExecutor,
  type ProposalRunners,
  type ProposedRow,
  GENERATES_MARKER,
  NOT_HERE,
  canRun,
  formatProposalToken,
  proposalWords,
  resolveArgument,
  rowWords,
  runProposal,
} from "./command-proposal.js";
import { type TagsControl, tagRunners } from "./command-runners.js";
import { Button } from "./components/ui/button.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { keepDictation } from "./dictation-keep.js";
import { type DictationContext, useReaderTranscriber } from "./dictation-upload.js";
import { setAppearance, useAppearance } from "./appearance.js";
import { appearanceRows } from "./appearance-commands.js";
import type { ExperimentalSaveOutcome, ExperimentalSetting } from "./experimental-store.js";
import { isImeComposing } from "./key-chord.js";
import { useDictationField } from "./useDictationField.js";
import { type MetadataSection, type Mode, type LearnView, modeParam, learnInSearch, withSection } from "./params.js";
import { METADATA_RERUN_STEPS, RERUN_LANDS_IN, rerunCommand } from "./rerun-commands.js";
import { SECTION_ROWS, archiveCommand, exportCommand, sectionCommand } from "./article-commands.js";
import { downloadExport } from "./export-download.js";
import type { ArchiveControl } from "./useArchive.js";
import {
  type ArticleView,
  CHANGELOG_HREF,
  CHANGELOG_LABEL,
  HELP_HREF,
  LIBRARY_HREF,
  PROFILE_HREF,
  PUBLIC_LIBRARY_HREF,
  navigate,
  readHref,
  searchWithoutAny,
} from "./router.js";
import { type UseJobs, useJobs } from "./useJobs.js";
import { stepRunRequest } from "./useStepJob.js";
import { shownBehindTheSwitch } from "./experimental-visibility.js";
import type { DiagramKind } from "./diagram.js";
import { subModesOf, subModeWords, type SubMode } from "./sub-modes.js";
import { useVisualViewport } from "./useVisualViewport.js";
import { voiceClass } from "./voice.js";
import { FIND_MORE_MODES, findMoreCommand } from "./find-more.js";

/**
 * **The article the bar was opened over**, or `undefined` where there is none.
 *
 * The two fields are the Dock's own — the slug from the *path* and the query
 * string worth carrying between an article's views (`carriedSearch` in
 * router.ts), so that going to the metadata page and coming back returns you to
 * the paragraph you left. Handed over rather than recomputed for the reason the
 * mode list is: the Dock has both in hand and a second copy is a second thing
 * to keep in step.
 *
 * **It is optional even though today it is never absent.** The bar is mounted
 * only by the Dock, for the owner — the reading view and, since 2026-09-30,
 * the metadata page (SPIDERYARN-READING2-66) — so every reader who can open the
 * bar is standing on an article. The option is here because that is a fact
 * about the *gate*, not about the rows: the day the bar is offered on the shelf
 * (260908e § Deliberately deferred) is the day this is `undefined`, and the
 * answer then is the one
 * `besideTheModes` gives now — **no row at all**, rather than a row that has to
 * say something about an article that is not there.
 */
export interface CommandBarArticle {
  readonly slug: string;
  /** Already through `carriedSearch`; `readHref` adds the `?`. */
  readonly search: string;
  /**
   * **Which of the article's pages the bar is open over** — the Dock's own
   * `view`. Read by one decision only, since 2026-10-02: where an accepted
   * *Run again* takes the reader (`rerunRows`). From the reading view that is
   * a step to the Metadata page; on the Metadata page it is the section
   * below, in place.
   */
  readonly view: ArticleView;
  /**
   * **Where the Help row goes from here** — the page of Help for the mode the
   * band is in, already built by the Dock (`helpHrefFor` in Dock.tsx) and
   * handed down, for the reason `slug` and `search` are: the Dock's Help link
   * and this row then cannot open different pages. A finished href rather than
   * the mode, because this file imports nothing from Dock.tsx (see the import
   * there) and the rule for which page is the Dock's to own.
   *
   * Optional, and the row falls back to Help's contents at `/help` without it,
   * so a caller that knows nothing about modes still gets a Help row that works.
   */
  readonly help?: string | undefined;
  /**
   * **What the bar may do to the reader's own shelf row** — Archive and Export,
   * since 2026-10-02 (plan 261002c, stage B) — or `undefined` where there is no
   * row to act on.
   *
   * Absent means no Archive row and no Export row, and that is a statement
   * about the request rather than about the page: both are calls against the
   * reader's shelf row (`PATCH /api/library/:slug`, `GET /api/export/:slug`),
   * and with no row each could only 404 — *a control that can only fail is
   * worse than no control, because pressing it is how you find out* (Metadata.tsx
   * § `hasShelfRow`). So the pages that know there is one hand it in: the
   * reading view for the owner (Reader.tsx, from `OwnedArticle`, which exists
   * only because the server said the article is theirs), and the Metadata page
   * unless it is showing the fixture.
   *
   * **The Metadata page does not wait for its provenance request first**, as
   * its own Export section does (`hasShelfRow`). That gate is about the page
   * drawing controls before it has heard anything; the bar is opened over an
   * article the server has already answered as the reader's own, which is the
   * fact the gate waits to learn.
   *
   * One object rather than the controller alone, so that what the bar may do
   * here is one decision at the call site — and a third row of the same kind
   * is a field, not another optional prop beside this one.
   */
  readonly shelfRow?: ShelfRow | undefined;
  /**
   * **What the reading view can do with an argument row** — jump in the
   * prose, open or ask the glossary — and the glossary it may match words
   * against (command-proposal.ts § `CommandExecutor`). Since 2026-10-03, plan
   * 261003f.
   *
   * The reading view's alone: the Metadata page has no prose to jump in and no
   * glossary read (GPT Sol's F1), so there it is absent and those rows are
   * never drawn — not drawn and refused. Tags are not in it; they come with
   * `shelfRow`, on both pages.
   *
   * **And, since 2026-10-04, which bands' *Find more* it may press**
   * (`findMoreRows`, plan 261004k) — for the same reason the reading view's
   * alone: there is no band on the Metadata page.
   */
  readonly executor?: CommandExecutor | undefined;
}

/**
 * **The reader's own shelf row, as the bar may act on it** — the archive
 * controller `OwnedArticle` keeps above both views (useArchive.ts), so a press
 * in the bar and the buttons on the page are one state and cannot disagree.
 * Export needs nothing but the slug the bar already has; its presence is
 * this object's.
 *
 * **`tags`, since 2026-10-03** (plan 261003f, GPT Sol's F4): the tags
 * controller the *Add the tag* / *Remove the tag* rows press. The Metadata
 * page hands in its `TagEditor`'s own save, so the editor on the page updates
 * with the bar's press; the reading view, which draws no editor, hands in a
 * plain `editArticleTags`.
 */
export interface ShelfRow {
  readonly archive: ArchiveControl;
  readonly tags: TagsControl;
}

/**
 * **The experimental switch, as the bar's row needs it** — the store's own
 * fields (experimental-store.ts), picked rather than restated, for the reason
 * Dock.tsx § `DockExperimental` gives.
 */
export type CommandBarExperimental = Pick<ExperimentalSetting, "on" | "loaded" | "signedIn" | "saving" | "set">;

/**
 * **Everything the bar offers that is not a mode**, built fresh for the state
 * the bar was opened in.
 *
 * A function since 2026-09-08, and a `PAGES` constant before that, because two
 * of Greg's seven rows are about *this* article and one of them opens a dialog
 * — none of which a module constant can see. His ask
 * (SPIDERYARN-READING2-2D, 260908e):
 *
 * > Add Library, Feedback, Metadata, Tweets, Homepage, Profile, and a few more
 * > likely/useful commands to Command Bar.
 *
 * The list lives here rather than in command-match.ts for one mechanical
 * reason: naming an href means importing router.ts, router.ts imports React,
 * and that module's first claim about itself is that it imports no React. It
 * ranks a row; it does not know which rows there are.
 *
 * ## The order, which is the order they appear in
 *
 * **This article first, then the app, then the one thing that is neither.**
 * `rankCommands` breaks ties on input order and does nothing else with it
 * (command-match.ts), so this arrangement *is* the empty-query list a reader
 * sees under the fourteen modes — closest to where you are standing at the top.
 *
 * ## Library and Homepage are one row, not two
 *
 * Greg named both. `LIBRARY_HREF` is `/`, and for a signed-in reader `/` **is**
 * the library — the shelf is the home page, and the bar is owner-only, so
 * everybody who can open it is signed in. Two rows would be two names for one
 * destination, and worse than redundant: `commandId` is `page:${href}`, so both
 * would carry the id `page:/` — *"two rows the keyboard and a screen reader
 * cannot tell apart"* (command-match.ts § `commandId`). So `home` and
 * `homepage` are aliases on the one row, and typing either of his words gets
 * you there.
 *
 * ## What is deliberately not here
 *
 * **The footer's row** — Features, Pricing, Privacy, Contact, Open source. That
 * argument is unchanged by this widening and is the same one SiteFooter.tsx
 * § `LINKS` makes from the other side: the footer is the site's own navigation,
 * and none of those is a thing a reader mid-article reaches for a keyboard to
 * get to. Sharing one array would make five rows appear here to keep a promise
 * nobody made.
 *
 * **`/add`** — because a bare `/add` is not a page. router.ts § the add route
 * sends it to the shelf, *"the shelf is where the add box is"*, so a row called
 * *Add an article* would take you somewhere with a different name on it. It is
 * an **alias on Library** instead, which is both shorter and true.
 *
 * **Admin and Design**, which would need an admin check the bar has never had,
 * for two rows one person can use; and **sign out**, because a bar whose Enter
 * key is one row from signing you out is a bar you press more carefully.
 * 260908e § What was considered and left out.
 *
 * **The experimental switch was left out by the same paragraph, and came in on
 * 2026-10-03** when Greg asked for it by name (spya-wh2xys: *"a command to turn
 * on the experimental features or off"*). It is typed-only, so the bar opens
 * on the same list, and it is built beside this rather than in it
 * (`experimentalRows`), because it is about the reader, not the page.
 *
 * Exported for tests/command-match-arguments.test.ts, whose collision matrix
 * runs the argument parser over every label and alias this returns.
 */
export function besideTheModes({
  article,
  openComments,
  openFeedback,
  queue,
}: {
  article: CommandBarArticle | undefined;
  /** The Dock drawer's `onPanel`, already bound to `"questions"`, or absent. */
  openComments: (() => void) | undefined;
  /** `useFeedbackOpen()`'s answer — `null` where no host is mounted above. */
  openFeedback: (() => void) | null;
  /** The job queue the *Run again* rows post through — `RerunQueue`. */
  queue: RerunQueue;
}): readonly Command[] {
  return [
    ...(article === undefined ? [] : articleRows(article)),
    /* After the article's own page and before everything else: these are about
       this article too. Typed-only, so the list the bar opens on is unchanged
       (command-match.ts § `CommandWords.typedOnly`). The Metadata rows first —
       a section, Archive, Export — then the fourteen *Run again*: on a tie the
       one-of-a-kind row is the likelier meaning. */
    ...(article === undefined ? [] : metadataRows(article)),
    /* Before the *Run again* rows: for `glossary`, adding to the list is the
       likelier and the gentler meaning than writing it again. */
    ...(article === undefined ? [] : findMoreRows(article)),
    ...(article === undefined ? [] : rerunRows(article, queue)),
    helpRow(article?.help),
    ...(openComments === undefined
      ? []
      : [
          {
            kind: "action",
            id: "comments",
            /* **"Comments", never a name that moves with its state** — the rule
               Dock.tsx § the Comments button states at length, and the reason
               is a reader driving this by voice is asking for the thing called
               Comments. No count either: the bar is a list of what you can ask
               for, and a number on one row would be the only row that reported
               anything. */
            label: "Comments",
            description: "Your bookmarks and notes on this piece, in the drawer.",
            aliases: ["notes", "bookmarks", "annotations", "questions"],
            /* The drawer reads what is already stored; nothing here calls a
               model. `generates` is required on every row that is not a mode —
               command-match.ts § `CommandWords` says why saying `false` out
               loud is the point rather than the noise. */
            generates: false,
            /* The drawer, and nothing else. */
            opensOnly: true,
            run: () => {
              openComments();
              return CLOSE;
            },
          } as const,
        ]),
    ...APP_PAGES,
    ...(openFeedback === null
      ? []
      : [
          {
            kind: "action",
            id: "feedback",
            label: "Feedback",
            /* What the box is for, in the voice docs/project/copy.md asks for:
               the reader's problem is ours, and the sentence says what happens
               rather than what they should feel about it. */
            description: "Tell us what is wrong, or what you wish it did.",
            aliases: ["bug", "report", "problem", "contact", "help", "suggestion"],
            generates: false,
            /* The dialog, empty; sending a report is a press inside it. */
            opensOnly: true,
            run: () => {
              openFeedback();
              return CLOSE;
            },
          } as const,
        ]),
  ];
}

/**
 * **The row that is about the article in front of you** — two until Tweets
 * became a mode on 2026-09-29 and its row became a mode row — and it exists
 * only when there is one — see `CommandBarArticle` for why that is a statement
 * about the gate rather than about these rows.
 *
 * It goes exactly where the Dock button of the same name goes, `search` and
 * all, so a reader who has learned one door has learned the other.
 */
function articleRows({ slug, search }: CommandBarArticle): readonly Command[] {
  return [
    {
      kind: "page",
      href: readHref(slug, search, "metadata"),
      label: "Metadata",
      description: "Where this came from, how long it is, and every step that built it.",
      /* The second line is what you go there to *do* — the page has the only
         controls for each. Greg, `spya-nkjpte`, 2026-10-02: *"I tried searching
         for "regenerate" … and nothing matched"*. Plan 261002c.

         **`share` and `download` left on stage B of the same plan**, to the
         rows that do those things (`metadataRows`). Each would tie with that
         row's own alias, and this row, coming first, would win the tie — the
         page above the act it was typed for. The words left here either lose
         to a direct row's *label* (`export`, `archive`, `ai processing`,
         `high-powered`, all a label prefix there) or have no direct row, and
         `export` and `archive` still find the page where those rows are
         withheld. */
      aliases: [
        "about", "details", "source", "reading time", "stats",
        "regenerate", "rerun", "re-run", "redo", "reprocess", "ai processing", "high-powered",
        "cost", "price", "export", "archive", "delete",
      ],
      /* The metadata page shows what the pipeline already wrote; opening it
         runs nothing. */
      generates: false,
    },
  ];
}

/**
 * **The two things the *Run again* rows need from the job queue** — posting a
 * run, and why the last post failed. A narrowing of `UseJobs` rather than the
 * whole of it, handed to a module function so that what the rows can do is
 * readable at the call: they start a job and read the refusal, and nothing
 * else.
 */
type RerunQueue = Pick<UseJobs, "run" | "lastFailure">;

/**
 * **What the bar says when a run was refused and the server gave no reason** —
 * `useStepJob`'s own fallback for the same failure, so the bar and the
 * Metadata row say one thing.
 */
const RUN_NOT_STARTED = "Couldn't start the job.";

/**
 * **The answer of an action that cannot fail** — Comments opening its drawer,
 * Feedback its dialog. Returned rather than implied, so the type says every
 * action decided (command-match.ts § `ActionOutcome`).
 */
const CLOSE: ActionOutcome = { kind: "close" };

/**
 * **One *Run again* row per step Metadata offers** — Greg, 2026-10-01
 * (SPIDERYARN-READING2-8D): *"Add a lot more Metadata functionality to
 * Commands, e.g. to reprocess (a particular mode)"*. The words, the label and
 * which steps are rerun-commands.ts's; this is what Enter does.
 *
 * ## Enter posts the run Metadata's row posts, and waits for the answer
 *
 * `stepRunRequest(slug, step, { force: true })` — the body `useStepJob.start`
 * sends for `RerunRow`, from the same function, so the bar cannot force a
 * different set of steps than the page does. Through `useJobs().run`, the
 * shared engine's own action, so the post pokes the poller and the row on the
 * Metadata page finds the job on its next look.
 *
 * **A refusal keeps the bar open with the server's sentence**, read from
 * `lastFailure()` the moment the post comes back — not from `error`, which the
 * poll the post itself starts clears a few milliseconds later (useJobs.ts §
 * `lastFailure`; GPT Sol's F2 on plan 261002c).
 *
 * ## And then the reader goes to Metadata's *AI processing*, never to the mode
 *
 * **This is the finding that shaped the feature** (GPT Sol's F1): a mode
 * opened with no artefact starts an unforced run of its own on arrival, and
 * `force` is part of the work key on the server, so the band's run and this
 * one would be two jobs — two paid runs for one press. In *AI processing* the
 * step's `RerunRow` watches the queue (`useStepJob` matches any job for the
 * slug that runs its step), so the run shows there with its progress, its
 * Stop and its Retry. Landing in the band itself is deferred until there is a
 * way to tell a mode's auto-run *this job satisfies you*.
 *
 * From the reading view that is a step to the Metadata page, pushed so Back
 * returns to the paragraph. On the Metadata page it is the same address with
 * `?section=` added, **replaced** and without the jump to the top — the page
 * does not change, it opens the section and scrolls there itself
 * (PageContents.tsx § `useRevealOnArrival`).
 */
function rerunRows(article: CommandBarArticle, queue: RerunQueue): readonly Command[] {
  return METADATA_RERUN_STEPS.map((step) =>
    rerunCommand(step, async (): Promise<ActionOutcome> => {
      const job = await queue.run(stepRunRequest(article.slug, step, { force: true }));
      if (job === null) return { kind: "stay", message: queue.lastFailure() ?? RUN_NOT_STARTED };
      return goToSection(article, RERUN_LANDS_IN);
    }),
  );
}

/**
 * **A *Find more* row for each band that offers one right now** — Greg,
 * 2026-10-04 (spya-rbxrgc): *"There are lots of cases where we have a sort of
 * find more button, for example in the glossary mode. Let's make that be part
 * of the command bar as well."* The words are find-more.ts's; which bands, and
 * the press, are the reading view's (`CommandExecutor.findMore`).
 *
 * **Drawn only while the list can be added to** (GPT Sol's F3 on plan
 * 261004k): the reading view names a band here only when its own read says an
 * append is on offer, so there is no row on an article with no list, on one
 * whose run would rewrite, on a full list, for a visitor, or on the Metadata
 * page, which hands in no executor. No row, never a row that opens a band and
 * does nothing.
 *
 * **Enter posts nothing.** Unlike `rerunRows` below, the press leaves a
 * hand-off and opens the band, and the band presses its own button — in the
 * list's own profile setting, which only the band's hook has read
 * (find-more.ts § Why this is not a word on the *Run again* row).
 *
 * **`find more …` is also the `find` verb's**, so for those words the bar
 * draws these rows and then *Find “more …” in this article* after them
 * (`matched` below). The one declared exception to the collision matrix.
 */
function findMoreRows(article: CommandBarArticle): readonly Command[] {
  const presses = article.executor?.findMore;
  if (presses === undefined) return [];
  return FIND_MORE_MODES.flatMap((mode) => {
    const press = presses[mode];
    return press === undefined ? [] : [findMoreCommand(mode, press)];
  });
}

/**
 * **Open one of Metadata's sections, from wherever the bar is** — the landing
 * the *Run again* rows were given first, and the whole of what a section row
 * does.
 *
 * From the reading view it is a step to the Metadata page with `?section=`,
 * pushed so Back returns to the paragraph (the carried `search` keeps `?at=`).
 * On the Metadata page it is the same address with the section added,
 * **replaced** and without the jump to the top: the page does not change, it
 * opens the section and scrolls there itself, and takes the parameter off
 * once it has (PageContents.tsx § `useRevealOnArrival`).
 */
function goToSection(article: CommandBarArticle, section: MetadataSection): ActionOutcome {
  const href = readHref(article.slug, withSection(article.search, section), "metadata");
  if (article.view === "metadata") navigate(href, { replace: true, scroll: false });
  else navigate(href);
  return CLOSE;
}

/**
 * **What the Metadata page does, from the bar** — three of its sections,
 * Archive and Export. Greg, 2026-10-01 (SPIDERYARN-READING2-8D): *"Add a lot
 * more Metadata functionality to Commands"*. The words, and why each waits for
 * a query and none spends, are article-commands.ts's; this is what Enter does.
 *
 * Archive and Export only with a shelf row to act on (`CommandBarArticle` §
 * `shelfRow` says which pages hand one in), and Archive only while the
 * controller knows which way round the article is.
 */
function metadataRows(article: CommandBarArticle): readonly Command[] {
  const own = article.shelfRow;
  return [
    ...SECTION_ROWS.map((row) => sectionCommand(row, () => goToSection(article, row.section))),
    ...(own === undefined ? [] : [...archiveRows(own.archive), exportRow(article.slug)]),
  ];
}

/**
 * **What the bar says when an archive press found another already out** — a
 * press from the masthead or the page, sharing this controller. Nothing was
 * sent; that one's answer is on its way, and the row's label will follow it.
 */
const ARCHIVE_BUSY = "Still saving the last change to this article — a moment.";

/**
 * **Archive, or Put back — never while nobody knows which** (GPT Sol's F6).
 *
 * `at === undefined` is useArchive.ts's *we do not know*: the request is out,
 * or it failed, or a write failed and could not be re-read. Either label could
 * be false then, and the press would do the opposite of what the row says, so
 * there is no row — the rule the page's own buttons follow.
 *
 * **The press goes through the shared controller**, `set`, the same function
 * the masthead's mark and the page's two buttons call; so its single-flight
 * guard is theirs too, and the state it leaves is the one they all draw. Its
 * answer decides the bar: shut on success — nothing navigates, an archived
 * article stays readable where it is — and stay open with a sentence on a
 * press refused for being second (`ARCHIVE_BUSY`) or a write that could not
 * be confirmed. *Couldn't confirm* rather than *couldn't*, because a failed
 * request is not proof nothing was written (useArchive.ts § the catch); the
 * controller has re-read by the time this returns, so the row under the box
 * already says which way round the article now is.
 *
 * A `busy` controller is turned away here as well as inside `set`: the state
 * says so a render before the ref does, and a press that cannot go anywhere
 * should not wait for one.
 */
function archiveRows(archive: ArchiveControl): readonly Command[] {
  const { at } = archive;
  if (at === undefined) return [];
  const archived = at !== null;
  return [
    archiveCommand(archived, async (): Promise<ActionOutcome> => {
      if (archive.busy) return { kind: "stay", message: ARCHIVE_BUSY };
      const result = await archive.set(!archived);
      switch (result.kind) {
        case "done":
          return CLOSE;
        case "busy":
          return { kind: "stay", message: ARCHIVE_BUSY };
        case "failed":
          return { kind: "stay", message: `Couldn't confirm that. ${result.message}` };
        default: {
          const never: never = result;
          return never;
        }
      }
    }),
  ];
}

/**
 * **Export this article** — the download Metadata's Export button starts, from
 * the same function (export-download.ts), so the file, its name and the
 * sentence on a refusal are one. A refusal keeps the bar open with that
 * sentence; a second press for a zip already being built — from the page's
 * button, under the bar — says so rather than starting another.
 */
function exportRow(slug: string): Command {
  return exportCommand(async (): Promise<ActionOutcome> => {
    const result = await downloadExport(slug);
    switch (result.kind) {
      case "downloaded":
        return CLOSE;
      case "busy":
        return { kind: "stay", message: "This article's zip is already being built — it will download when it's ready." };
      case "failed":
        return { kind: "stay", message: result.message };
      default: {
        const never: never = result;
        return never;
      }
    }
  });
}

/**
 * **The search parameters a words search is made of**, and the ones of the
 * same kind that a new search replaces rather than sits beside — the block
 * last-view.ts § `NEVER_REMEMBERED` names for the same reason: they are one
 * search, and a stale `?run=` beside a new `?find=` is two.
 */
const SEARCH_KEYS = new Set(["mode", "match", "find", "run", "runs", "order", "conf"]);

/**
 * **`find <words>`, as a row** — Search in words mode, the words lit up in the
 * prose (`?mode=search&match=words&find=…`, the address the shelf's passage
 * links already make: library-hits.ts § `libraryHitHref`). Greg's
 * *"do they talk about X?"* (SPIDERYARN-READING2-8D).
 *
 * **Free and instant**, so `generates: false`: a words search is a literal
 * match in the browser. *Meaning* search is a model call and is pressed, not
 * arrived at, so this never opens that one. The search that does call a model
 * is a row of its own, in front of this one (`quickSearchRow` below).
 *
 * Built from the query rather than ranked against it — `argumentRows` below.
 * **A page row, not a runner**, and the one argument row that is: it is an
 * address, so it needs no executor and is offered from the Metadata page too,
 * always going to the reading view, where the prose is. Its words are the
 * `find` proposal's (command-proposal.ts § `proposalWords`).
 *
 * The rest of the carried query string is kept — `?at=` above all, so the
 * search opens where the reader was — edited as text for `carriedSearch`'s
 * reason (router.ts).
 */
function findRow(article: CommandBarArticle, words: string): Command {
  const { label, description, generates } = proposalWords({ id: "find", words });
  return {
    kind: "page",
    href: findHref(article.slug, article.search, words),
    label,
    description,
    aliases: [],
    generates,
  };
}

/**
 * **The quick search for the same words, drawn in front of the find row** —
 * since 2026-10-05 (plan 261005i; Greg's Q-bar-3, option B: the bar opens
 * quick search and the Dock's icon stays). `null` where nothing here can run
 * one: a visitor, or the Metadata page, which has no band — the exact-words
 * row is then alone, as it was.
 *
 * **First, so Enter runs it; exact words is one arrow-key down.** It runs the
 * Enter of the Dock's own quick-search box (`CommandExecutor.quickSearch`), so
 * the two ways in are one search.
 *
 * **It spends, so it says so** (`generates: true`, GPT Sol's F1 on the plan):
 * a quick search is a model call and a saved row. And like every argument row
 * it is drawn and pressed, never run from the words alone (`opensOnly: false`,
 * plan 261003k F2) — which is what keeps a model's `find` answer a proposal.
 */
function quickSearchRow(article: CommandBarArticle, words: string): Command | null {
  const quickSearch = article.executor?.quickSearch;
  if (quickSearch === undefined) return null;
  return {
    kind: "action",
    /* Unique per search and no whitespace: it ends up in an `id` attribute. */
    id: `quick-search:${encodeURIComponent(words)}`,
    label: `Quick search “${words}”`,
    description: "Search mode, a fast first pass for the passages about this.",
    aliases: [],
    generates: true,
    typedOnly: true,
    opensOnly: false,
    run: () => quickSearch(words),
  };
}

/**
 * **The row that asks for a short list from why you are reading** (plan
 * 261005k, B) — drawn first, on an empty box, on an article the reader owns
 * that has a reason for reading. Greg, 2026-10-03: *"if they fill in the why
 * you're reading this, then somehow that should inform things."*
 *
 * **Its press is the bar's own (`suggest` in `CommandBar`), not this `run`**:
 * an action's outcome is *close* or *stay with a sentence*, and this row's is
 * a third thing, a list drawn in the bar. `run` is here because a `Command`
 * must have one, and says nothing.
 *
 * **No `generates` mark**, as *Ask what you meant* has none: the mark is for a
 * row that starts work on the article and keeps what it made. This asks a
 * small model one question and keeps nothing on the server. No price either;
 * what a call costs is an administrator's business.
 */
const SUGGEST_ROW: Command = {
  kind: "action",
  id: "suggest-from-why-reading",
  label: SUGGEST_LABEL,
  description: SUGGEST_DESCRIPTION,
  aliases: [],
  generates: false,
  typedOnly: true,
  opensOnly: false,
  run: () => ({ kind: "stay", message: "" }),
};

/**
 * **A suggested lens, as a row** — the reading view's own handoff (Reader.tsx
 * § `suggestedLensInChat`, the one that waits), so the question lands in Chat's box and
 * nothing is sent until the reader presses Send there. `generates: false` for
 * that reason: this press spends nothing.
 */
function lensRow(askThroughLens: (lens: string) => ActionOutcome, lens: string): Command {
  return {
    kind: "action",
    /* Unique per lens and no whitespace: it ends up in an `id` attribute. */
    id: `ask-lens:${encodeURIComponent(lens)}`,
    label: lensLabel(lens),
    description: LENS_DESCRIPTION,
    aliases: [],
    generates: false,
    typedOnly: true,
    opensOnly: false,
    run: () => askThroughLens(lens),
  };
}

/**
 * **One row as the bar draws it.** A plain command for every ordinary row; a
 * suggested row carries the model's `why` for its second line and the model's
 * own words inside the label, so they can be set in the model's face
 * (docs/project/fonts.md).
 *
 * `rowId` rather than `commandId` alone, because a suggested mode is *the
 * bar's existing command for that mode* and so is drawn twice while the list
 * is up: once under the heading and once in its ordinary place.
 */
interface ShownRow {
  readonly command: Command;
  readonly rowId: string;
  /** `suggest`: the one row whose press is the bar's own request. */
  readonly press: "activate" | "suggest";
  readonly suggested?: { readonly why: string; readonly said?: string };
}

/**
 * **A row's label, with a model's own words inside it set in the model's
 * face** (docs/project/fonts.md): *Quick search “…”* is ours, what is between
 * the quotes is not. `said` is absent on every row a model did not word.
 */
function RowLabel({ label, said }: { label: string; said: string | undefined }) {
  const at = said === undefined ? -1 : label.indexOf(said);
  if (said === undefined || at < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, at)}
      <span className={voiceClass("ai")}>{said}</span>
      {label.slice(at + said.length)}
    </>
  );
}

const ordinaryRow = (command: Command): ShownRow => ({ command, rowId: commandId(command), press: "activate" });

/**
 * **A kept list, as rows of today's bar** — and the only place a suggestion
 * becomes something that can be pressed.
 *
 *  - a search is the quick-search row a typed `find` makes (`quickSearchRow`);
 *  - a mode is looked up in the list the bar holds *now*, by id and label, and
 *    only among its `mode` and `submode` rows (GPT Sol's F1): what a press
 *    arms and what mark it wears are that row's, and a key that is not a mode
 *    here today is not drawn;
 *  - the lens is drawn only where the page handed in the handoff and the Dock
 *    draws Chat.
 *
 * Nothing here runs anything. Each row waits for its own press.
 */
function suggestionRows(
  list: Suggestions,
  commands: readonly Command[],
  article: CommandBarArticle,
  chatReachable: boolean,
): readonly ShownRow[] {
  const rows: ShownRow[] = [];
  const add = (command: Command, why: string, said?: string) =>
    rows.push({
      command,
      rowId: `suggested:${commandId(command)}`,
      press: "activate",
      suggested: said === undefined ? { why } : { why, said },
    });
  for (const search of list.searches) {
    const row = quickSearchRow(article, search.words);
    if (row !== null) add(row, search.why, search.words);
  }
  for (const mode of list.modes) {
    const command = commands.find(
      (c) => (c.kind === "mode" || c.kind === "submode") && sameKey(pickKey(c, article.slug), mode.key),
    );
    if (command !== undefined) add(command, mode.why);
  }
  const askThroughLens = article.executor?.askThroughLens;
  if (list.lens !== null && askThroughLens !== undefined && chatReachable) {
    add(lensRow(askThroughLens, list.lens.words), list.lens.why, list.lens.words);
  }
  return rows;
}

/**
 * **The address a words search for `words` is** — the find row's, and the one
 * chat's *Find “X”* chip goes to (Reader.tsx § `chatCommands`), so the two
 * cannot open different searches. `carried` is already through `carriedSearch`.
 */
export function findHref(slug: string, carried: string, words: string): string {
  const kept = searchWithoutAny(carried, SEARCH_KEYS);
  const search = [kept, "mode=search", "match=words", `find=${encodeURIComponent(words)}`]
    .filter(Boolean)
    .join("&");
  return readHref(slug, search, "article");
}

/**
 * **The rows a query with an argument offers** (plan 261003f, Stage 1) —
 * appended after the ranked rows, as the find row has been since 2026-10-02.
 *
 * Parse (command-match.ts § `parseArgumentQuery`), resolve against what is
 * here (command-proposal.ts § `resolveArgument`), then one row per proposal
 * **this page can run**: the reading view's executor, plus the tags runners
 * from the shelf row on either page. A proposal with no runner here is no
 * row, never a row that fails — the Metadata page offers no jump and no
 * glossary (GPT Sol's F1). A `find` is the one proposal with two rows: a quick
 * search in front of it, where one can be run (`quickSearchRow`).
 *
 * A refused row (an invalid tag, a term the glossary's ask would refuse) is
 * still drawn when its command is offered here, and its Enter keeps the bar
 * open with the reason — the reader learns why rather than watching the row
 * vanish.
 */
function argumentRows(article: CommandBarArticle, query: string): readonly Command[] {
  return argumentRowsFor(article, parseArgumentQuery(query));
}

/**
 * **The rows for arguments already parsed** — `argumentRows` without the verb
 * table, so that a sentence a model read (`suggestedRows` below, plan 261003k)
 * lands on exactly the rows its verb would have made: the same resolution, the
 * same runners, the same refusals. One path to "what does this ask for".
 */
function argumentRowsFor(article: CommandBarArticle, queries: readonly ArgumentQuery[]): readonly Command[] {
  const runners = runnersHere(article);
  const sources = article.executor?.sources ?? {};
  return queries
    .flatMap((argument) => resolveArgument(argument, sources))
    .flatMap((row) => {
      const command = argumentCommand(article, runners, row);
      if (command === null) return [];
      /* A `find` is two rows where a quick search can be run: that first, the
         exact words second (`quickSearchRow`). */
      const quick =
        row.kind === "ready" && row.proposal.id === "find" ? quickSearchRow(article, row.proposal.words) : null;
      return quick === null ? [command] : [quick, command];
    });
}

/** What can be run on this page: the reading view's executor, and the tags from the shelf row on either page. */
function runnersHere(article: CommandBarArticle): ProposalRunners {
  return {
    ...article.executor?.runners,
    ...(article.shelfRow === undefined ? {} : tagRunners(article.shelfRow.tags)),
  };
}

/**
 * **The argument commands a sentence may be answered with here** — the ones
 * `argumentCommand` would draw a row for, so the model is never offered a
 * command this page would then refuse to draw. Find is an address, offered
 * wherever there is an article; a glossary look-up needs a glossary read.
 */
function argumentKindsHere(article: CommandBarArticle | undefined): readonly ArgumentKind[] {
  if (article === undefined) return [];
  const runners = runnersHere(article);
  const glossary =
    article.executor?.sources.glossary !== undefined &&
    (canRun(runners, "glossary-open") || canRun(runners, "glossary-ask"));
  return [
    "find",
    ...(canRun(runners, "jump-first") ? (["jump-first"] as const) : []),
    ...(glossary ? (["glossary"] as const) : []),
    ...(canRun(runners, "tag-add") ? (["tag-add"] as const) : []),
    ...(canRun(runners, "tag-remove") ? (["tag-remove"] as const) : []),
  ];
}

/**
 * **A model's answer, as rows of today's bar** — and the only place an answer
 * becomes something that can be pressed (plan 261003k, GPT Sol's F5).
 *
 * A `row` answer is keys; each is looked up in the list the bar holds *now*,
 * by id **and** label, so what runs is always today's row and its runner. A
 * key that is no longer there is simply not drawn — if *Archive* became *Put
 * back* while the answer was out, the suggestion is gone rather than reversed.
 * An `argument` answer goes the way a typed verb goes (`argumentRowsFor`), so
 * an alias two glossary entries share is two rows (F3) and an invalid tag is a
 * row that says why.
 */
function suggestedRows(
  answer: PickAnswer,
  commands: readonly Command[],
  article: CommandBarArticle | undefined,
): readonly Command[] {
  switch (answer.kind) {
    case "none":
      return [];
    case "row":
      return [answer.key, ...answer.others].flatMap((key) => {
        const command = commands.find((c) => sameKey(pickKey(c, article?.slug), key));
        return command === undefined ? [] : [command];
      });
    case "argument":
      return article === undefined ? [] : argumentRowsFor(article, [{ kind: answer.argument, words: answer.words }]);
    default: {
      const never: never = answer;
      return never;
    }
  }
}

/** The ordered rows a reader has been shown, including an argument's resolved target. */
function suggestionSignature(rows: readonly Command[]): string {
  return JSON.stringify(rows.map((row) => [commandId(row), commandText(row).label]));
}

/** One argument row as a bar row, or `null` where nothing here can run it. */
function argumentCommand(article: CommandBarArticle, runners: ProposalRunners, row: ProposedRow): Command | null {
  if (row.kind === "ready" && row.proposal.id === "find") return findRow(article, row.proposal.words);
  const id = row.kind === "ready" ? row.proposal.id : row.id;
  if (!canRun(runners, id)) return null;
  const { label, description, generates } = rowWords(row);
  return {
    kind: "action",
    /* The token without its brackets: unique per proposal, and no whitespace,
       since it ends up in an `id` attribute (`commandId`). */
    id:
      row.kind === "ready"
        ? formatProposalToken(row.proposal).slice(1, -1)
        : `refused:${row.id}:${encodeURIComponent(row.shown)}`,
    label,
    description,
    aliases: [],
    generates,
    typedOnly: true,
    /* Never, whatever the proposal: an argument row is made of words nobody
       has confirmed, so it is always drawn and pressed (plan 261003k, F2). */
    opensOnly: false,
    run:
      row.kind === "refused"
        ? () => ({ kind: "stay", message: row.reason })
        : () => runProposal(runners, row.proposal) ?? { kind: "stay", message: NOT_HERE },
  };
}

/**
 * **The experimental switch, as a row** — Greg, 2026-09-29 (spya-wh2xys): *"a
 * command to turn on the experimental features or off … turning on the
 * experimental features might be disabled if it's already on."*
 *
 * **One row whose label follows the state**, rather than two with one greyed:
 * the rule Archive / Put back already follows, so there is never a row to
 * press that does nothing. Typed-only, found by `experimental` and `labs`.
 * Exported for the collision matrix (tests/command-match-arguments.test.ts).
 */
export function experimentalCommand(on: boolean, run: () => ActionOutcome | Promise<ActionOutcome>): Command {
  return {
    kind: "action",
    id: "experimental",
    label: on ? "Turn experimental features off" : "Turn experimental features on",
    description: on
      ? "Hide the modes and features still being built."
      : "Show the modes and features still being built, too.",
    aliases: ["experimental", "experimental features", "labs"],
    /* Saving a preference calls no model. */
    generates: false,
    typedOnly: true,
    /* It saves a setting on the reader's account. */
    opensOnly: false,
    run,
  };
}

/**
 * **The row, where it can do what it says** (GPT Sol's F5 on plan 261003f).
 *
 * Absent until the store has an answer (`loaded`) — either label could be
 * false before then — for nobody signed in, who has no setting to save, and
 * **while a save is out**: the store flips optimistically and drops a second
 * `set` while one is in flight, so the inverse row would do nothing. The press
 * is the store's own `set`, the one the Dock's switch and /profile call,
 * awaited: a refusal keeps the bar open with the reason.
 *
 * Exported for tests/command-pick-catalogue.test.ts, as `subModeRows` is.
 */
export function experimentalRows(experimental: CommandBarExperimental): readonly Command[] {
  const { on, loaded, signedIn, saving, set } = experimental;
  if (!loaded || !signedIn || saving) return [];
  return [
    experimentalCommand(on, async (): Promise<ActionOutcome> => experimentalOutcome(await set(!on))),
  ];
}

function experimentalOutcome(result: ExperimentalSaveOutcome): ActionOutcome {
  switch (result.kind) {
    case "saved":
      return CLOSE;
    case "failed":
      return { kind: "stay", message: `Couldn't save that. ${result.message}` };
    case "not-sent":
      return {
        kind: "stay",
        message:
          result.why === "busy"
            ? "Still saving the last change to that switch — a moment."
            : "Sign in to turn experimental features on or off.",
      };
    case "abandoned":
      return { kind: "stay", message: "The account changed before that was saved." };
    default: {
      const never: never = result;
      return never;
    }
  }
}

/**
 * **The Help page, opened at the part about where you are standing** —
 * docs/plans/261002b-help-page.md § After GPT Sol's plan review, R8: the
 * footer, this row and the Dock's Help link were the three ways in, and are
 * again: the Dock's link is on every bar since 2026-10-07, after three days
 * on a visitor's only (Dock.tsx § `DockHelp`, plans 261004j and 261007e). A
 * visitor has no command bar, so for them the link is the one in the bar.
 *
 * Not in `APP_PAGES` because its href is not the same everywhere: it is the
 * page of Help for the mode the band is in (`CommandBarArticle` § `help`),
 * though every one of those is the same row to the server
 * (command-match.ts § `pickKey`). And
 * placed **straight after this article's own rows** rather than among the app
 * pages, because that is what it is about on an empty query — the thing on
 * screen — and because the app pages end with the changelog, whose place
 * directly above the Feedback action is pinned (tests/command-bar.test.tsx §
 * the Feedback action last).
 *
 * **`help` ranks this row first and still reaches Feedback**, which keeps
 * `help` as an alias: somebody typing it may mean *something is wrong*. That
 * order is the ranking's, not a special case — a label prefix beats an alias
 * prefix (command-match.ts § `TIERS`). The aliases are the other words for a
 * manual, plus `faq`, which ranks the FAQ *mode* above this on a label prefix;
 * that is right, since the mode is the likelier meaning in an article.
 */
function helpRow(href: string | undefined): Command {
  return {
    kind: "page",
    href: href ?? HELP_HREF,
    label: "Help",
    description: "How Spideryarn works, open at the part about the mode you are in.",
    aliases: ["faq", "how do i", "manual", "guide", "documentation", "docs", "instructions"],
    /* `/help` is words the build shipped; opening it runs nothing. */
    generates: false,
  };
}

/**
 * **The app's own pages, which are the same wherever the bar is opened.**
 *
 * A module constant because nothing in it depends on where you are standing —
 * the half of the old `PAGES` that survives unchanged, plus the three rows Greg
 * asked for that are addresses.
 */
const APP_PAGES: readonly Extract<Command, { kind: "page" }>[] = [
  {
    kind: "page",
    href: LIBRARY_HREF,
    label: "Library",
    /* The sentence carries the add box, because `add` is an alias and a reader
       who types it needs to see why the row that came back says *Library*. */
    description: "Your shelf, and the box you paste a new article into.",
    /* Greg's `Homepage`, and the four other words for the same place. `add` and
       `add an article` because a bare `/add` lands here anyway — see the
       docblock above. Sparse elsewhere, for the reason that still limits the
       mode aliases (docs/project/reading-view-overview.md § The command bar): the cost of a
       loose alias is not a missed match, it is the wrong row ranked first. */
    aliases: ["home", "homepage", "shelf", "my articles", "add", "add an article"],
    generates: false,
  },
  {
    kind: "page",
    href: PROFILE_HREF,
    label: "Profile",
    description: "Your account, your plan, and the settings that follow you around.",
    aliases: ["settings", "account", "plan", "billing", "preferences"],
    generates: false,
  },
  {
    kind: "page",
    href: PUBLIC_LIBRARY_HREF,
    /* **`PUBLIC_SHELF_LABEL`, the same string the page's `<h1>` and the footer
       row draw**, since 2026-09-16 — src/messages.ts.

       It was the literal *"Public shelf"* until then, "named for what it is
       rather than for its address", taken from what docs/project/public-shelf.md
       calls the page. Both halves of that reasoning were wrong in the same way:
       public-shelf.md is the **internal** name — the mistake `CHANGELOG_LABEL`
       exists to record, where *Changelog* is what we call the process that
       writes the page and not a word a reader has ever heard — and "shelf"
       means the reader's *own* library everywhere else here, including the
       `shelf` alias on the Library row above. It became visible the day the
       footer linked this page too, because then one page had two navigation
       names.

       Nothing is lost: *public shelf* is an alias below, and an alias is what
       this bar matches on. */
    label: PUBLIC_SHELF_LABEL,
    /* *Anybody*, not *other readers*: public-shelf.md § It is not the owner's
       shelf narrowed — the page lists every article anybody has shared, the
       reader's own included, and describing it as other people's would be the
       one distinction that page exists to make, got backwards. */
    description: "Every article anybody has shared, yours included.",
    /* *public shelf* joined these on 2026-09-16, when it stopped being the
       label — somebody who knew the old name must still find the row by it. */
    aliases: ["public", "public library", "public shelf", "shared", "browse"],
    generates: false,
  },
  {
    kind: "page",
    href: CHANGELOG_HREF,
    /* "What's new" rather than "Changelog", the same call SiteFooter.tsx makes
       and for the same reason: the latter is the internal name for the process
       that writes the page (docs/project/changelog.md), and a reader has never
       heard of it. So the word a reader *would* type is an alias below rather
       than the name here. */
    label: CHANGELOG_LABEL,
    description: "Every release since launch, newest first.",
    /* `changelog` because it is what the address says and what a developer
       reaches for. `releases` and `updates` are the two other words for the
       same thing.

       **Then the label itself, twice more, because there are three ways to type
       it and only one of them is the label.** `canonical` deliberately does not
       fold punctuation (command-match.ts § `canonical` says why), and the label
       carries the typographic `’`, so a reader who types the words in front of
       them matches only if their keyboard happened to produce that character.
       A phone's does — iOS substitutes `’` automatically — and a desktop's
       usually does not, which makes `what's new` with a straight apostrophe the
       single likeliest spelling of all and the one this list shipped without
       until GPT Sol caught it. `whats new` covers dropping it entirely. */
    aliases: ["changelog", "releases", "updates", "what's new", "whats new"],
    /* `/changelog` reads a file the build already shipped. */
    generates: false,
  },
];

/* `GENERATES_MARKER` — the one plain verb a row that would start work carries —
   is command-proposal.ts's since 2026-10-03, because chat's chips draw it too.
   Which rows carry it is `commandGenerates` below. */
export { GENERATES_MARKER };

/**
 * **Whether pressing this row may start a model call**, and the one place that
 * question is answered for every kind of row.
 *
 * Until 2026-09-08 the renderer asked `kind === "mode" && modeGenerates(mode)`,
 * with a comment saying exactly what would go wrong and when:
 *
 * > **No page row can carry it, and that is a limitation rather than a fact
 * > about pages.** … a page that *did* spend would ship silently under-warning:
 * > the check would go on excluding it and no test could see the difference.
 * > (GPT Sol, 2026-09-07)
 *
 * The Tweets row is that page — since 2026-09-15 it navigates to a page that
 * starts the run on owner arrival rather than arming one itself — so the fix is
 * the one that comment prescribed: the answer is a **property on the command**,
 * and this function is what puts the two arms on one footing rather than adding
 * a second name to the old condition.
 *
 * The mode arm stays a table lookup rather than a copied flag, because
 * `MODE_TARGET` is already total and a duplicated boolean per mode is fourteen
 * chances to disagree with it.
 */
function commandGenerates(command: Command): boolean {
  switch (command.kind) {
    case "mode":
      return modeGenerates(command.mode);
    /* Its chip's answer, from the same table that arms it (activation.ts §
       `subModeTarget`), for the reason the mode arm is a lookup. */
    case "submode":
      return subModeGenerates(command.sub);
    default:
      return command.generates === true;
  }
}

/** A row's `marker`, which only a row with words of its own can carry. */
function commandMarker(command: Command): string | undefined {
  return command.kind === "page" || command.kind === "action" ? command.marker : undefined;
}

/**
 * **Whether pressing this row does nothing but take the reader somewhere** —
 * the one question that decides whether a row a model picked from a sentence
 * may run without a second Enter (plan 261003k § The line, applied).
 *
 * A mode, a sub-mode or a page moves the reader unless opening it starts work
 * (`commandGenerates`). An action is a closure, so it says for itself
 * (`opensOnly`, required: command-match.ts § `Command`). Everything else —
 * Archive, Export, the Experimental switch, a *Run again*, every argument row
 * — is drawn and waits, **whatever the model's confidence**: every model in
 * the eval picked Archive for some request that should have been nothing, at
 * up to 0.98 (docs/investigations/261003e-…).
 */
function onlyMovesTheReader(command: Command): boolean {
  if (commandGenerates(command)) return false;
  switch (command.kind) {
    case "mode":
    case "submode":
    case "page":
      return true;
    case "action":
      return command.opensOnly;
    default: {
      const never: never = command;
      return never;
    }
  }
}

/**
 * **The sub-mode rows to offer**: every sub-mode of every mode the Dock offers
 * (as a button or under More), in Dock order and then chip order — and, inside
 * a mode, only the chips that mode would draw with the switch as it is (Diagram's pictures and Learn's
 * Explore: experimental-visibility.ts, the rule `visibleKinds` in DiagramPanel.tsx
 * and `visibleModes` in Dock.tsx share). A mode the Dock does not offer has
 * no sub-mode row at all, so the experimental switch is decided once, upstream.
 *
 * **Plus the picture `?diagram=` names**, experimental or not — the chip row's
 * own second rule, so with the switch off and a shared `diagram=trail` link
 * open, the bar offers Trail exactly where the chips do. GPT Sol, plan review.
 * **And the part of Learn currently open**, since 2026-10-05, when Explore
 * became the second kind of sub-mode behind the switch: the chips' own rule
 * again (sub-modes.ts § `visibleLearnViews`). The caller passes `undefined`
 * outside Learn; a retained `learn=explore` is a last view, not an open
 * Explore. Metadata uses the mode in its carried address.
 *
 * Exported for tests/command-pick-catalogue.test.ts, which writes the list the
 * command-pick eval measures against from the functions the bar itself calls.
 */
export function subModeRows(
  modes: readonly Mode[],
  experimentalOn: boolean,
  current: { readonly diagram: DiagramKind; readonly learn: LearnView | undefined },
): readonly Command[] {
  return modes.flatMap((mode) =>
    subModesOf(mode)
      .filter((sub) =>
        shownBehindTheSwitch({
          experimental: subModeWords(sub).experimental,
          on: experimentalOn,
          current:
            (sub.mode === "diagram" && sub.view === current.diagram) ||
            (sub.mode === "learn" && sub.view === current.learn),
        }),
      )
      .map(subModeCommand),
  );
}

/**
 * **The empty state, exactly as Greg specified it and nothing beside it.**
 *
 * A `const` rather than a literal in the markup so that the test asserting the
 * bar says this *and only this* is comparing against the same string the reader
 * sees. docs/project/copy.md is the home for reader-facing failure messages;
 * this is not one — nothing failed, and the sentence is about the query rather
 * than about the app.
 */
export const NO_MATCH = "No command matches.";

/**
 * **What follows it, since 2026-10-03, for a signed-in reader who has typed
 * something**: a sentence that names no row can be asked about (plan 261003k).
 * Greg's call 3 — an honest empty state over a guessed fallback — still holds:
 * nothing is guessed until the reader asks for it.
 *
 * **A button, with Enter as its other route, since 2026-10-05** (spya-qem46c,
 * plan 261005f). It was a sentence, *Press Enter to ask what you meant.*, and
 * Greg dictated a question on an iPhone: *"there was no way to kick off that
 * action on an iPhone because I don't have an enter key."* A dictation can
 * finish with no phone keyboard on screen, so the offer has to be something a
 * finger can press.
 */
export const ASK_LABEL = "Ask what you meant";
/** Beside the button where the main pointer is not a finger. Enter works either way. */
export const ASK_OR_ENTER = "or press Enter";
/**
 * The same button under `COULD_NOT_TELL`, where *Ask what you meant* would read
 * as the bar contradicting itself (`offerToAsk`). That state is also a timeout
 * or a dropped connection, and Enter was its only retry.
 */
export const ASK_AGAIN_LABEL = "Try again";
/** A local, deterministic refusal: retrying unchanged cannot help. */
export const ASK_TOO_LONG = "That sentence is too long. Shorten it and try again.";

/** The line under the box while the sentence is with the model. */
const ASKING = "Working out what you meant…";

/** The one-line heading over rows a model suggested, so they are not mistaken for a match on what was typed. */
const SUGGESTED_HEADING = "Did you mean";

interface Props {
  /**
   * The modes to offer, in Dock order, **already filtered** by
   * `visibleModes` — which is the whole of requirement 4. The bar never asks
   * whether the experimental switch is on; it draws what it was handed.
   */
  modes: readonly Mode[];
  /**
   * **Opening a mode, and the same function the Dock button calls** — `Dock` §
   * `activateMode`. It arms and it moves the band, in that order. This
   * component adds only its own presentation afterwards: close, and clear.
   */
  activateMode(next: Mode): void;
  /**
   * **Opening a mode with one of its sub-modes chosen** — `Dock` §
   * `activateSubMode`, the sub-mode rows' counterpart of `activateMode`, and
   * like it the one place the arming and the move are paired.
   */
  activateSubMode(sub: SubMode): void;
  /**
   * **The reader's experimental switch** — `on` for the one decision `modes`
   * cannot carry, which experimental sub-modes to offer (`subModeRows`), and
   * the rest for the row that turns it on or off (`experimentalRows`, since
   * 2026-10-03).
   */
  experimental: CommandBarExperimental;
  /**
   * **The picture the address names**, already degraded by `diagramInSearch`
   * (params.ts) — the chip row shows it whatever the switch says, so the bar
   * does too.
   */
  diagram: DiagramKind;
  /**
   * **The article the bar is standing on**, or `undefined` — see
   * `CommandBarArticle`, which carries the whole of why this is optional when
   * today it is always given.
   */
  article?: CommandBarArticle | undefined;
  /**
   * **How to open the Dock's Comments drawer**, or absent where there is none.
   *
   * Bound to the panel by the caller rather than taken as an `onPanel(panel)`,
   * so this component never learns that a drawer is a thing with more than one
   * side to it. `Dock` § `DockCommandBar` is the one binding.
   */
  openComments?: (() => void) | undefined;
  open: boolean;
  /** Reopen after an asynchronous action was dismissed but came back refused. */
  onOpen(): void;
  onClose(): void;
}

export function CommandBar({
  modes,
  activateMode,
  activateSubMode,
  experimental,
  diagram,
  article,
  openComments,
  open,
  onOpen,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const [draft, setDraft] = useState("");
  /**
   * **Which row Enter would take**, as an index into `shown` below.
   *
   * The first row is selected whenever the filter changes — reset in the input
   * handler rather than in an effect, so that "the selection follows what you
   * typed" is one statement in the one place the filter can change. It is also
   * **clamped at render**, because `modes` can shrink underneath it: the
   * experimental switch is three inches away and turning it off takes five rows
   * out of the list while the bar is open.
   */
  const [selected, setSelected] = useState(0);

  /**
   * **The line under the box** — `Starting…` while an action is out, `Working
   * out what you meant…` while a sentence is with the model (`ask`), or the
   * sentence either came back with when it kept the bar open (a refused run,
   * a sentence nobody could place). One value, so no two can show at once;
   * `null` is an empty line.
   * Cleared by typing and by an ordinary opening of the bar. The one exception
   * is a refusal that reopens a bar the reader dismissed while its request was
   * out: that opening exists to show the sentence.
   */
  const [said, setSaid] = useState<
    { kind: "pending" } | { kind: "asking" } | { kind: "message"; text: string } | null
  >(null);
  /**
   * **One action at a time, held before the first render can show it.** Two
   * Enters — or an Enter and a click — can both reach `activate` before React
   * commits the pending state, and every action that is asynchronous today
   * starts a paid run. Set synchronously on the way in, cleared when the
   * action settles. `RerunRow` in Metadata.tsx guards its own button the same
   * way, for the same two-presses reason.
   */
  const inFlight = useRef(false);
  /**
   * **Which opening of the bar an outstanding action belongs to.** An action
   * can settle after the reader has shut the bar and opened it again. A success
   * must not shut that later opening; a refusal still has to be said somewhere,
   * or the old request reports success by silence. Bumped every time the bar
   * opens.
   */
  const opening = useRef(0);
  /**
   * A refusal that arrives after Escape still belongs to the reader. Reopening
   * runs the ordinary fresh-open reset below, so carry that one sentence
   * across the reset rather than relying on state-update ordering.
   */
  const reopeningWith = useRef<string | null>(null);

  /**
   * **A sentence, asked about** (plan 261003k): what the model answered, held
   * as an answer and not as rows — what is drawn is looked up again at every
   * render (`suggestedRows`), in whatever the row list is by then.
   */
  const [suggested, setSuggested] = useState<{ answer: PickAnswer; rowsSignature: string } | null>(null);
  /**
   * **The request revision** (GPT Sol's F5): bumped by every edit to the box
   * and every opening or closing of the bar. An answer that comes back to a
   * later revision is thrown away — it was about a sentence the reader has
   * since changed, or a bar they have since shut. The third thing that makes
   * an answer stale, the row list changing while it is out, is `signature`
   * below.
   */
  const revision = useRef(0);
  /** The ask that is out, so the next revision can stop it rather than wait for it. */
  const asking = useRef<AbortController | null>(null);
  /**
   * **Drop whatever was asked or suggested** — the one thing an edit, an
   * opening and a closing all do. The request is aborted (the server stops the
   * model call when the connection closes) and `inFlight` is released at once,
   * so a new sentence can be asked without waiting for the old one to fail.
   */
  const dropAsk = useCallback(() => {
    revision.current += 1;
    if (asking.current !== null) {
      asking.current.abort();
      asking.current = null;
      inFlight.current = false;
    }
    setSuggested(null);
  }, []);

  /* Navigation can unmount the Dock without closing its dialog first. Stop
     the request and invalidate its continuation even if fetch ignores abort. */
  useLayoutEffect(() => () => {
    revision.current += 1;
    asking.current?.abort();
    asking.current = null;
    suggestTurn.current += 1;
    suggestOut.current?.abort();
    suggestOut.current = null;
  }, []);

  /**
   * **Where a short list from why you are reading can be offered** (plan
   * 261005k, B): somebody is signed in, the article is theirs (`shelfRow`,
   * which only the owner's pages hand in) and this is the reading view, where
   * a quick search can run. `undefined` anywhere else — a visitor, the
   * Metadata page — and then nothing is read, offered or kept.
   */
  const suggestSlug =
    experimental.signedIn && article?.shelfRow !== undefined && article.executor?.quickSearch !== undefined
      ? article.slug
      : undefined;
  /** Whether there is a reason for reading, and the fingerprint of what a list would be written from. */
  const { reason, saves, version: reasonVersion, heard: reasonHeard } = useReasonForReading(suggestSlug, open);
  /**
   * **The list, kept for the visit** — state of its own and not the pick's
   * `suggested` (GPT Sol's F2): that one is dropped by every opening, closing
   * and keystroke, and is hidden whenever the box matches a row, as an empty
   * box does. This survives all three.
   *
   * Words and keys, never rows: what is drawn is built again from today's
   * commands at every render (`suggestionRows`). Kept under the article and
   * the fingerprint of what the model read; `keptList` below is where it
   * stops being shown.
   */
  const [list, setList] = useState<{ slug: string; readFrom: string; suggestions: Suggestions } | null>(null);
  /** The request is out. Its own state, not `said`, which an opening and a keystroke both clear. */
  const [suggestWaiting, setSuggestWaiting] = useState(false);
  const suggestOut = useRef<AbortController | null>(null);
  /** Which request an answer belongs to; bumped to disown one that is out. */
  const suggestTurn = useRef(0);
  /**
   * **A save drops the list, and disowns a request that is out** (F3). The
   * model read both boxes, so a list written before either changed is about
   * somebody the reader no longer says they are. `saves` counts this tab's
   * saves of *About you* and of any reason for reading (profile-saved.ts).
   */
  const savesSeen = useRef(saves);
  useLayoutEffect(() => {
    if (savesSeen.current === saves) return;
    savesSeen.current = saves;
    setList(null);
    if (suggestOut.current !== null) {
      suggestTurn.current += 1;
      suggestOut.current.abort();
      suggestOut.current = null;
      inFlight.current = false;
      setSuggestWaiting(false);
    }
  }, [saves]);
  /* **And so does no longer being the owner here.** Signing out passes
     through this, so a list can never be carried from one reader to the next
     in a tab that stayed open. */
  useLayoutEffect(() => {
    if (suggestSlug !== undefined) return;
    setList(null);
    if (suggestOut.current !== null) {
      suggestTurn.current += 1;
      suggestOut.current.abort();
      suggestOut.current = null;
      inFlight.current = false;
      setSuggestWaiting(false);
    }
  }, [suggestSlug]);

  /**
   * **The way into the Feedback dialog**, or `null` where no host is mounted
   * above this — which is the ordinary signed-out case rather than a mistake
   * (FeedbackButton.tsx § `useFeedbackOpen`). No opener, no row.
   *
   * A hook, so it is called unconditionally at the top and not inside the memo
   * below, where the rules of hooks would not have it.
   */
  const openFeedback = useFeedbackOpen();

  /**
   * **The job queue the *Run again* rows post through**, subscribed `quiet` —
   * the bar is not a surface anybody watches the queue on, so being mounted
   * keeps no idle poll going (useJobs.ts § `QueueCadence`).
   *
   * Read through a ref by a wrapper made once, because `useJobs` hands back a
   * fresh object every render, and the row list below is memoised on what the
   * rows are built from: a queue in its dependencies would rebuild the list on
   * every poll for nothing. `lastFailure` is a ref inside `useJobs` and so the
   * same function across renders — the wrapper reads the newest anyway.
   *
   * **The cost, said out loud**: the subscription re-renders the bar when the
   * job list changes, about once a second while a job runs. The bar is a few
   * dozen rows and nothing below it is expensive; the day that shows up in a
   * profile, the rows can move into a child mounted only while the bar is open.
   */
  const jobs = useJobs("quiet");
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const queue = useMemo<RerunQueue>(
    () => ({
      run: (request) => jobsRef.current.run(request),
      lastFailure: () => jobsRef.current.lastFailure(),
    }),
    [],
  );

  /**
   * **The Dock's modes, then everything else** — and the concatenation is what
   * makes call 4 in the header true. `modes` arrives already filtered and is
   * spread rather than merged into, so the mode rows remain exactly the prop,
   * in exactly its order; a tie between a mode and anything else therefore
   * falls to the mode, because `rankCommands` breaks ties on input order.
   *
   * **The dependency list is the four things a row can be built out of**, and
   * `besideTheModes` is a pure function of exactly those.
   *
   * **What it does not do is stop this recomputing**, which is worth saying
   * because the list looks like it should. `openFeedback` is stable by
   * construction (`FeedbackHost` § `api`, a `useMemo` with no dependencies),
   * but the Dock mints `article` as an object literal and `openComments` as a
   * closure on every render, so in practice this rebuilds whenever the Dock
   * does. **That is fine and is not worth machinery to fix**: the work is a
   * `map` over fourteen modes and two spreads, `rankCommands` below is
   * memoised on the same value, and nothing downstream holds the array's
   * identity — `selected` is an index, clamped at render.
   *
   * So the memo earns its keep against re-renders that change none of these,
   * and it is here mainly because the dependency list is the honest statement
   * of what the list is a function of. Memoising the two churning values at the
   * call site would make it bite, and the day the Dock's own renders get
   * expensive is the day to do that rather than now.
   */
  /* The appearance in force, for which of its three rows is marked `current`
     (appearance-commands.ts). The store's own hook, as /profile reads it. */
  const appearance = useAppearance();
  const commands = useMemo(
    () => [
      ...modes.map(modeCommand),
      /* After every mode and before every page: the mode rows stay exactly the
         Dock's, first, and a sub-mode loses a tie to its own mode. */
      ...subModeRows(modes, experimental.on, {
        diagram,
        learn: modeParam.parse(new URLSearchParams(article?.search ?? "").get("mode") ?? "") === "learn"
          ? learnInSearch(article?.search ?? "")
          : undefined,
      }),
      ...besideTheModes({ article, openComments, openFeedback, queue }),
      /* Typed-only, so where it sits matters only on a tie — and there the
         page's own rows should win. */
      ...experimentalRows(experimental),
      /* Typed-only too, and last for the same reason. No gate of their own:
         the choice is the device's, and the write is synchronous. */
      ...appearanceRows(appearance, setAppearance),
    ],
    [modes, experimental, diagram, article, openComments, openFeedback, queue, appearance],
  );
  /**
   * **The ranked rows, and the argument rows after them when the query has
   * one** — `find`, since 2026-10-02, and jump, glossary and tags since
   * 2026-10-03 (`argumentRows`).
   *
   * After, not first: a query that both names a row and parses as an argument
   * should go where it names — and the collision matrix
   * (tests/command-match-arguments.test.ts) holds that no label or alias the
   * bar offers parses as one at all, bar the two *Find more* rows' `find
   * more …`, which is where this order shows. Not ranked, because each row's label is
   * made of the query; ranking it against itself would always hit.
   */
  const matched = useMemo(() => {
    const ranked = rankCommands(draft, commands);
    return article === undefined ? ranked : [...ranked, ...argumentRows(article, draft)];
  }, [draft, commands, article]);

  /**
   * **The rows as the server knows them**, and their signature — the row list
   * reduced to what an answer can name. The keys are what a sentence is asked
   * over; the signature is how an answer knows the list it was asked over is
   * still the list when it lands (F5). A changed list also clears drawn
   * suggestions: removing a row must not move Enter to its neighbour.
   */
  const keys = useMemo(() => commands.map((c) => pickKey(c, article?.slug)), [commands, article?.slug]);
  const signature = JSON.stringify([keys, article?.slug, article?.view, argumentKindsHere(article), experimental.signedIn]);
  const previousSignature = useRef(signature);
  useLayoutEffect(() => {
    if (previousSignature.current === signature) return;
    previousSignature.current = signature;
    dropAsk();
    setSaid((was) => (was?.kind === "asking" ? null : was));
  }, [signature, dropAsk]);
  /* What an answer needs when it lands, a render or several later. Refs, for
     `jobsRef`'s reason: the `.then` below must read today's, not the ones its
     closure was made with. */
  const now = useRef({ signature, commands, article });
  now.current = { signature, commands, article };

  /**
   * **What a model suggested, as today's rows** — drawn only while nothing
   * the reader typed matches; their own match always wins.
   */
  const resolvedSuggestions = useMemo(
    () => (suggested === null ? [] : suggestedRows(suggested.answer, commands, article)),
    [suggested, commands, article],
  );
  const suggestionsChanged = suggested !== null && suggested.rowsSignature !== suggestionSignature(resolvedSuggestions);
  const offered = suggestionsChanged ? [] : resolvedSuggestions;
  /* Argument resolution can change without changing the catalogue's keys
     (for example, a glossary refresh removes one of two matching terms). */
  useLayoutEffect(() => {
    if (suggestionsChanged) dropAsk();
  }, [suggestionsChanged, dropAsk]);
  const suggesting = matched.length === 0 && offered.length > 0;
  const results = suggesting ? offered : matched;
  /**
   * **Whether Enter on nothing asks** — somebody is signed in (the route is
   * signed-in only; `experimental.signedIn` is the store's answer, the one
   * fact about the reader the bar is handed) and there is a sentence.
   *
   */
  const canAsk = experimental.signedIn && draft.trim() !== "";
  /**
   * **The offer is not made straight under a refusal.** `COULD_NOT_TELL`
   * stays up until the box changes, and *Press Enter to ask* beneath it read
   * as the bar contradicting itself (the browser check, 2026-10-03). Enter
   * still asks again — a timeout deserves a second try — it is only the
   * invitation that waits for a changed sentence.
   */
  const askMessage = said?.kind === "message" ? said.text : null;
  const offerToAsk = canAsk && askMessage !== COULD_NOT_TELL && askMessage !== ASK_TOO_LONG;
  /* A timeout may recover; an unchanged over-limit sentence cannot. */
  const showAskButton = canAsk && askMessage !== ASK_TOO_LONG;
  /**
   * **The kept list, while it is still about this reader and this article** —
   * the same article, still the owner's, and the fingerprint the server sent
   * with it still the one the profile reads as now. A read that says the
   * profile changed elsewhere (another tab, another device) hides it without
   * a save being heard here.
   */
  const keptList =
    list !== null && suggestSlug === list.slug && reason.state === "has" && reason.readFrom === list.readFrom
      ? list.suggestions
      : null;
  /**
   * **Drawn above the ordinary rows while the box is empty, hidden while the
   * reader types, back when they clear it** (F2). A list none of whose rows
   * can be drawn today is no list, and the row that asks is offered again.
   */
  const emptyBox = draft.trim() === "";
  const chatReachable = modes.includes("chat");
  const suggestedNow = useMemo(
    () =>
      emptyBox && keptList !== null && article !== undefined
        ? suggestionRows(keptList, commands, article, chatReachable)
        : [],
    [emptyBox, keptList, commands, article, chatReachable],
  );
  const offerSuggest =
    emptyBox &&
    suggestSlug !== undefined &&
    (reason.state === "has" || reason.state === "failed") &&
    suggestedNow.length === 0;
  const reasonFailure = emptyBox && reason.state === "failed" && !suggestWaiting ? REASON_NOT_READ.message : null;
  const shown = useMemo<readonly ShownRow[]>(
    () => [
      ...(offerSuggest ? [{ command: SUGGEST_ROW, rowId: commandId(SUGGEST_ROW), press: "suggest" } as const] : []),
      ...suggestedNow,
      ...results.map(ordinaryRow),
    ],
    [offerSuggest, suggestedNow, results],
  );
  /** Where the ordinary rows start, for the rule drawn between the list and them. */
  const firstOrdinary = shown.length - results.length;
  const index = Math.min(selected, Math.max(0, shown.length - 1));
  const active = shown[index];
  /* A profile read may insert or remove rows while the reader is choosing.
     Keep their highlighted command, rather than applying its index to a new
     list. A new suggestion answer, save and fresh opening still select row zero.
     An unknown reason keeps the last save generation until its read lands. */
  const previousReasonRows = useRef({ open, reason, list, saves, rowId: active?.rowId });
  useLayoutEffect(() => {
    const previous = previousReasonRows.current;
    previousReasonRows.current = {
      open, reason, list,
      saves: reason.state === "unknown" ? previous.saves : saves,
      rowId: active?.rowId,
    };
    if (!open || !previous.open || (previous.reason === reason && previous.list === list)) return;
    /* A new answer deliberately selects its first suggestion. */
    if (list !== null && previous.list !== list) return;
    /* A save restarts the choice; a removed row has no neighbour to confirm. */
    const at = previous.saves === saves ? shown.findIndex((row) => row.rowId === previous.rowId) : -1;
    const next = at >= 0 ? at : 0;
    if (next !== index) setSelected(next);
  }, [open, reason, list, saves, shown, index, active?.rowId]);

  /* Lightbox.tsx § closingOurselves, and the same trap: `close()` fires the
     same `close` event a reader's Escape does, so without this the shutting we
     asked for comes back as a second `onClose`. */
  const closingOurselves = useRef(false);

  /**
   * **`useLayoutEffect` for the same reason FeedbackDialog gives**: a passive
   * effect runs after paint, so a state change that also shuts the dialog gets
   * one painted frame of the new state inside a dialog that is still open.
   * jsdom cannot tell the two apart, which is why that file says so out loud
   * rather than claiming its test proves the timing.
   */
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      /* **Cleared here, before `showModal()`, and not in the passive effect
         below.** It was there until GPT Sol's F1 on stage 2: Escape and a
         backdrop click close the dialog without clearing, so the *next* open
         painted one frame of the last query's results — or of
         `No command matches.` — before a passive effect could reset it. A
         layout effect runs before that paint, so there is no frame to see. */
      setDraft("");
      setSelected(0);
      /* Before `inFlight` is read just below: an ask from the last opening
         is stopped, not waited for. */
      dropAsk();
      /* Still `Starting…` if the last opening's action is out: a press here
         would be refused until it settles, and an empty line would not say
         why. */
      const message = reopeningWith.current;
      reopeningWith.current = null;
      /* A suggestion that is out holds `inFlight` too, and has its own line
         (`suggestWaiting`), so it is not also `Starting…`. */
      setSaid(
        message === null
          ? inFlight.current && suggestOut.current === null
            ? { kind: "pending" }
            : null
          : { kind: "message", text: message },
      );
      opening.current += 1;
      closingOurselves.current = false;
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingOurselves.current = true;
      dialog.close();
    }
    /* Shut by any route — our own close, Escape, the backdrop — a sentence
       still being asked about is nobody's any more. */
    if (!open) dropAsk();
  }, [open, dropAsk]);

  /**
   * **A fresh bar every time, and the draft does not survive a close.**
   *
   * The design brief proposed keeping an unfinished command across a close and
   * reopen; v1 clears, deliberately (260906h § Deliberately deferred). One
   * `useState`, no identity question, and no half-typed command surviving a
   * change of reader.
   *
   * The focus is here rather than on an `autoFocus` attribute because the
   * element is inside a `<dialog>` that was not in the top layer when React
   * mounted it: `showModal()` moves focus itself, to the first focusable child,
   * and asking explicitly is what makes that a fact rather than a coincidence
   * of child order.
   */
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  /* The reader can see less than CSS thinks on iOS — see the header, and
     useVisualViewport.ts, which owns the whole argument. */
  const visible = useVisualViewport(open);

  /**
   * **The box changing, by a key or by a dictation** — the one place the
   * filter changes, so the three things that follow it cannot drift between
   * the two: back to the first row (otherwise Enter points at whatever is
   * fourth in a list the reader has not looked at), and a refusal's sentence
   * goes — it was about the row the reader had. `Starting…` stays; the run is
   * still out.
   */
  const changeDraft = useCallback(
    (value: string) => {
      setDraft(value);
      setSelected(0);
      /* An answer on its way, or already drawn, was about the old words. */
      dropAsk();
      setSaid((was) => (was?.kind === "pending" ? was : null));
    },
    [dropAsk],
  );

  /**
   * **The microphone, on the bar's box** — Greg's *"type (or even talk)"* from
   * the bar's first day (2026-09-05), and the three lines
   * docs/project/dictation.md § Adding it to a box says any box needs (plan
   * 261003f, Stage 1.5). `context` is the article when there is one, so the
   * transcript is primed with its glossary and names.
   *
   * **Only kept while open**, FeedbackDialog's reason: the bar is mounted for
   * the life of the page, so a keeper while shut could hold a recording where
   * nobody can see it.
   */
  /** `enter`, as of the latest render: it is made below the hook that calls it. */
  const enterNow = useRef<() => void>(() => {});
  const transcribe = useReaderTranscriber();
  const dictate = useDictationField<DictationContext>({
    value: draft,
    onChange: changeDraft,
    box: inputRef,
    context: article === undefined ? { kind: "profile" } : { kind: "article", slug: article.slug },
    transcribe,
    ...(open ? { keep: keepDictation("commands") } : {}),
    /* **A double press on Stop presses Enter when the words arrive** — Greg,
       2026-10-05: *"yes for the command bar"* (plan 261005a; dictation.md § A
       double press on Stop also sends). `enter` below, the key's own function,
       so it runs the row the phrase names or asks what it meant, and nothing
       Enter would not. Not when shut: the bar stays mounted, and the key makes
       shutting it withdraw the wish even if it is opened again. Not offered
       while a run is starting either, when Enter is refused. */
    ...(said?.kind === "pending"
      ? {}
      : {
          onDone: () => {
            if (open) enterNow.current();
          },
        }),
    doneKey: open ? "open" : "shut",
  });
  /**
   * **Nothing is pressed while the microphone is involved** — `armed` (still
   * listening) as well as `readOnly` (the words on their way), the pair
   * dictation.md calls the guard everybody forgets: Enter mid-sentence would
   * take whichever row the half-heard words happened to select.
   */
  const dictationBusy = dictate.busy;
  /**
   * **When a press on the ask button would be refused** — `ask`'s own guards,
   * as the reader can see them: a sentence already out, a run starting, the
   * microphone on or its words on their way. `ask` is still the lock; this is
   * the row's `aria-disabled` again, for the same reason.
   */
  const askRefused = dictationBusy || said?.kind === "asking" || said?.kind === "pending";
  /* **The bar stays mounted when it closes**, so the hook's cleanup never runs
     and a microphone left on would go on recording behind a shut bar.
     `dictation.toggle`, not the field's, which would put the focus back into a
     box no longer on screen. dictation.md § Adding it to a box. */
  const { armed, toggle: toggleMicrophone } = dictate.dictation;
  useEffect(() => {
    if (!open && armed) toggleMicrophone();
  }, [open, armed, toggleMicrophone]);

  /**
   * **Enter, and the one thing it must not do**: activate when there is nothing
   * selected. `results` is empty for a query that matches nothing, and a bar
   * that opened *something* on Enter after saying `No command matches.` would
   * be worse than one that did nothing.
   */
  const activate = useCallback(
    (command: Command) => {
      /* **Nothing while an action is out** — not even a mode row, which would
         close the bar over a run whose refusal then had nowhere to be said.
         `inFlight` says why it is a ref. */
      if (inFlight.current) return;
      /* **Nor while the microphone is on or its words are on their way** —
         `dictationBusy` says why. Here rather than on the key alone, so a
         click on a row is refused too. */
      if (dictationBusy) return;
      const finish = () => {
        setDraft("");
        setSelected(0);
        setSaid(null);
        onClose();
      };
      const applyOutcome = (outcome: ActionOutcome) => {
        switch (outcome.kind) {
          case "close":
            finish();
            return;
          case "stay":
            if (ref.current?.open === true) {
              setSaid({ kind: "message", text: outcome.message });
            } else {
              /* Escape cannot turn a server refusal into silent success. The
                 request has already happened, so put its explanation back in
                 front of the reader. */
              reopeningWith.current = outcome.message;
              onOpen();
            }
            return;
          default: {
            /* A new outcome must decide its UI here; it cannot silently inherit
               `stay` merely because it happens to carry a message too. */
            const never: never = outcome;
            return never;
          }
        }
      };
      /* **Three verbs, and the switch is the whole of the difference between
         the kinds of row** — a sub-mode is the mode verb with a chip already
         pressed (2026-10-01). A mode is armed exactly as its Dock button
         arms it (call 1); a page is navigated to exactly as a `<Link>`
         navigates — `navigate` is what Link.tsx calls once it has decided the
         reader wants to stay in this tab, which a reader pressing Enter in a
         modal dialog has; an action runs its closure, which is 2026-09-08 and
         is argued in command-match.ts § `Command` rather than here.

         **No ⌘-click into a new tab**, which a real `<a>` would give and this
         does not. Deferred rather than missed: an `<a>` inside `role="option"`
         puts an interactive element inside an interactive role, and the rows
         are `div`s precisely because Biome is right to refuse that. The bar is
         a keyboard instrument; the footer link is the one to ⌘-click. */
      switch (command.kind) {
        case "mode":
          activateMode(command.mode);
          break;
        /* A mode with its chip already pressed — the chip's arming, never the
           mode's (activation.ts § `subModeTarget` says why that matters for
           Diagram). */
        case "submode":
          activateSubMode(command.sub);
          break;
        case "page":
          navigate(command.href);
          break;
        case "action": {
          /* **An action says how it went** (command-match.ts §
             `ActionOutcome`). A plain answer is acted on now, so the drawer
             and the dialog open and the bar shuts in one step, as they always
             did. A promise is a request in flight: the bar says so, refuses a
             second press, and shuts only on `close` — a refusal stays, with
             its sentence under the box (GPT Sol's F2 on plan 261002c). */
          const outcome = command.run();
          if (!(outcome instanceof Promise)) {
            applyOutcome(outcome);
            return;
          }
          inFlight.current = true;
          const at = opening.current;
          setSaid({ kind: "pending" });
          void outcome
            /* A thrown action is a failed one, said as plainly as any other —
               the bar is not where an exception should end up unseen. */
            .catch((): ActionOutcome => ({ kind: "stay", message: RUN_NOT_STARTED }))
            .then((settled) => {
              inFlight.current = false;
              if (at !== opening.current) {
                /* A success must not shut a later opening. A refusal is
                   different: dropping the server's explanation would report
                   success by silence, so show it in the opening now visible. */
                if (settled.kind === "stay") applyOutcome(settled);
                else setSaid((now) => (now?.kind === "pending" ? null : now));
                return;
              }
              applyOutcome(settled);
            });
          return;
        }
        default: {
          /* A fourth kind fails to compile here rather than silently doing
             nothing — which is what an `else` would have given it. */
          const never: never = command;
          return never;
        }
      }
      finish();
    },
    [activateMode, activateSubMode, onOpen, onClose, dictationBusy],
  );
  const activateNow = useRef(activate);
  activateNow.current = activate;

  /**
   * **Enter on a sentence that matched nothing: ask what it meant** (plan
   * 261003k). One post; the answer is one of the keys sent, or words from the
   * sentence, or nothing.
   *
   * **What runs without a second Enter is decided here and nowhere else**: a
   * `row` answer, at or above `RUN_AT_ONCE`, whose row is in today's list and
   * `onlyMovesTheReader`. Everything else that resolves to a row is drawn,
   * first row selected, and waits for a fresh press; nothing at all, a
   * failure or a timeout says `COULD_NOT_TELL` and leaves the bar open.
   *
   * `inFlight` is the lock an asynchronous action already uses, so two Enters
   * post once and no row is pressed while the sentence is out.
   */
  const ask = useCallback(() => {
    if (!canAsk || inFlight.current || dictationBusy) return;
    const sentence = draft.trim();
    /* The route would refuse it; a paragraph is not a command. */
    if (sentence.length > MAX_SENTENCE) {
      setSaid({ kind: "message", text: ASK_TOO_LONG });
      return;
    }
    const request: PickRequest = { sentence, rows: keys, argumentKinds: argumentKindsHere(article) };
    const controller = new AbortController();
    const at = revision.current;
    inFlight.current = true;
    asking.current = controller;
    setSuggested(null);
    setSaid({ kind: "asking" });
    void askForPick(request, controller.signal).then((answer) => {
      /* The box changed, or the bar shut: `dropAsk` has already let go. */
      if (at !== revision.current) return;
      asking.current = null;
      inFlight.current = false;
      const today = now.current;
      /* The rows changed under the question (F5). Not an answer about this
         list, so not shown — and not a failure either. */
      if (today.signature !== signature) {
        setSaid(null);
        return;
      }
      const rows = answer === null ? [] : suggestedRows(answer, today.commands, today.article);
      const [first] = rows;
      if (answer === null || first === undefined) {
        setSaid({ kind: "message", text: COULD_NOT_TELL });
        return;
      }
      setSaid(null);
      if (
        answer.kind === "row" &&
        answer.confidence >= RUN_AT_ONCE &&
        sameKey(pickKey(first, today.article?.slug), answer.key) &&
        onlyMovesTheReader(first)
      ) {
        activateNow.current(first);
        return;
      }
      setSelected(0);
      setSuggested({ answer, rowsSignature: suggestionSignature(rows) });
    });
  }, [canAsk, dictationBusy, draft, keys, signature, article]);

  /**
   * **The press on *Suggest what to do here*** (plan 261005k, B): one post, and
   * the bar stays open under a waiting line until the list is drawn.
   *
   * **Nothing the answer names is run** — it is kept as words and keys and
   * drawn as rows, each waiting for a press of its own, whatever the model
   * said and however sure it sounded.
   *
   * `inFlight` is the lock the pick and every asynchronous action use, so two
   * presses post once and no row is pressed while this is out. The answer is
   * kept even if the bar has been shut meanwhile, which is the point of
   * keeping it; a failure that lands on a shut bar is not said, since the row
   * is still there to press.
   *
   * The body is the keys of the mode and sub-mode rows the bar has now. The
   * server keeps only those kinds whatever is sent (F1); sending only those is
   * the same rule on this side, so the reply is re-read against a list with
   * nothing else in it.
   */
  const suggest = useCallback(() => {
    if (suggestSlug === undefined || inFlight.current || dictationBusy) return;
    const slug = suggestSlug;
    const request: SuggestRequest = {
      rows: commands.filter((c) => c.kind === "mode" || c.kind === "submode").map((c) => pickKey(c, slug)),
    };
    const readVersion = reasonVersion();
    const controller = new AbortController();
    const mine = ++suggestTurn.current;
    inFlight.current = true;
    suggestOut.current = controller;
    setSaid(null);
    setSuggestWaiting(true);
    void askForSuggestions(slug, request, controller.signal).then((reply) => {
      /* Disowned: a save, a sign-out or an unmount has already let go. */
      if (mine !== suggestTurn.current) return;
      suggestOut.current = null;
      inFlight.current = false;
      setSuggestWaiting(false);
      const barOpen = ref.current?.open === true;
      if (!reply.ok) {
        if (barOpen) setSaid({ kind: "message", text: reply.message });
        return;
      }
      if (reply.answer.kind === "nothing") {
        if (reply.answer.why === "no-reason") {
          /* A later read may already have found a reason. Do not contradict it. */
          if (reasonVersion() !== readVersion) return;
          reasonHeard(null, readVersion);
        }
        if (barOpen) {
          setSaid({ kind: "message", text: reply.answer.why === "no-reason" ? SUGGEST_NO_REASON : SUGGEST_NOTHING });
        }
        return;
      }
      const { kind: _kind, readFrom, ...suggestions } = reply.answer;
      setSelected(0);
      reasonHeard(readFrom, readVersion);
      setList({ slug, readFrom, suggestions });
    });
  }, [suggestSlug, dictationBusy, commands, reasonHeard, reasonVersion]);

  /** A row's press, by Enter or by a finger: the bar's own request for the one row that is one, `activate` for the rest. */
  const pressRow = (row: ShownRow): void => {
    if (row.press === "suggest") suggest();
    else activate(row.command);
  };

  /**
   * **What Enter does**: take the selected row, or with none, ask. One
   * function for the key and for a double press on Stop (`onDone` above), so
   * the two cannot come to run different things.
   */
  const enter = () => {
    if (active !== undefined) pressRow(active);
    else ask();
  };
  enterNow.current = enter;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click handled here is the backdrop, whose keyboard equivalent is Escape — which <dialog> implements itself. Lightbox.tsx carries the same ignore for the same handler; FeedbackDialog.tsx does not only because its ⌘/Ctrl+Enter listener happens to satisfy the rule
    <dialog
      ref={ref}
      className="cmdbar tw:fixed tw:inset-0 tw:m-0 tw:h-full tw:max-h-full tw:w-full tw:max-w-full tw:border-0 tw:bg-black/50 tw:p-0"
      aria-label="Commands"
      /**
       * **The box the reader can see, rather than the one CSS believes in** —
       * the same three numbers FeedbackDialog places itself with, and the same
       * reasoning: `inset: 0` above is the *layout* viewport, and on iOS the
       * keyboard does not touch that, it pans a smaller *visual* viewport over
       * it. `bottom: auto` because `inset-0` set it, and with `top`, `bottom`
       * and `height` all given the browser drops one of them — which one is not
       * a thing to leave to a rule of precedence.
       *
       * `undefined` when there is no `visualViewport` (jsdom, an old browser),
       * which leaves the utilities above standing exactly as written.
       */
      style={
        visible === null
          ? undefined
          : { top: `${visible.offsetTop}px`, height: `${visible.height}px`, bottom: "auto" }
      }
      onClose={() => {
        if (closingOurselves.current) return;
        onClose();
      }}
      onClick={(e) => {
        /* The backdrop. Its keyboard equivalent is Escape, which <dialog>
           implements itself — so no handler here needs to. */
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="cmdbar-panel tw:mx-auto tw:mt-[12vh] tw:flex tw:max-h-[70%] tw:w-[min(34rem,92vw)] tw:flex-col tw:overflow-hidden tw:rounded-lg tw:border tw:border-rule tw:bg-surface-raised tw:shadow-lg">
        {/* The box and its microphone on one line, the rule under both. */}
        <div className="cmdbar-box tw:flex tw:items-center tw:gap-1 tw:border-b tw:border-rule tw:pr-2">
        <input
          ref={inputRef}
          type="text"
          className="cmdbar-input tw:min-w-0 tw:flex-1 tw:border-0 tw:bg-transparent tw:px-4 tw:py-3 tw:text-base tw:text-ink tw:outline-none"
          /* Closed while a dictation's words are on their way — the hook's
             `readOnly`, the same as every other box with a microphone. */
          readOnly={dictate.readOnly}
          /* The visible label would be one more thing on screen in a bar whose
             whole argument is speed; the placeholder is the hint and this is the
             name. */
          aria-label="Type a command"
          /* "a command" rather than "a mode" since 2026-09-07: the bar stopped
             being modes-only (call 1), and a placeholder that names one of the
             two kinds tells the reader the other one is not here. */
          placeholder="Type a command…"
          /* **The soft keyboard's Enter key says Go**, because that is what it
             does: it takes you to the selected command — into a mode, or to a
             page. Not `search` — the search
             is the typing, and Enter does not run one — and not `send`, which
             in this app means posting something into a conversation.
             docs/project/touch.md § What the Enter key promises, and
             tests/what-the-enter-key-promises.test.tsx, which is a sweep of the
             source and so finds a box that never asked the question. */
          enterKeyHint="go"
          value={draft}
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          /* Which row Enter would take, announced without moving focus off the
             box the reader is typing in — the listbox pattern's own answer. */
          aria-activedescendant={active === undefined ? undefined : `${listId}-${active.rowId}`}
          autoComplete="off"
          spellCheck={false}
          /* Back to the first row, and a refusal's sentence gone — `changeDraft`
             says why, and is what a dictation calls too. */
          onChange={(e) => changeDraft(e.target.value)}
          onKeyDown={(e) => {
            /* **A key an input method is using was never a press of this
               bar**: its Enter finishes a word and its arrows walk its own
               candidate list. Asked first, before any `preventDefault`, so the
               key reaches the input method untouched. */
            if (isImeComposing(e)) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              /* Clamped rather than wrapped, at both ends. Wrapping is fine in a
                 long list you scroll; in fourteen rows it means holding an arrow
                 quietly cycles, and every row here can spend money. */
              setSelected(Math.min(index + 1, shown.length - 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected(Math.max(index - 1, 0));
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              /* **Only a fresh press** (GPT Sol's F4 on plan 261003k). A key
                 held down repeats, and the first Enter may have asked a
                 question whose answer is now a row that spends: the repeat
                 must not confirm it. */
              if (e.repeat) return;
              enter();
            }
          }}
        />
        {/* Hidden where the browser cannot open a microphone, as in every
            other box. */}
        {dictate.dictation.supported && (
          <DictationButton
            dictation={dictate.dictation}
            toggle={dictate.toggle}
            again={dictate.again}
            sendingAfter={dictate.sendingAfter}
            done="enter"
          />
        )}
        </div>

        {/* **What an action came to, under the box** — `Starting…`, or the
            sentence a refused run came back with. Always in the tree and only
            its text changing, because a live region that is mounted with its
            message is one a screen reader may not announce; padded only when
            there is something in it, so an empty one takes no room.
            `role="status"` is polite: the reader is told when they pause, not
            interrupted mid-word. */}
        <p
          role="status"
          className={`cmdbar-status tw:m-0 tw:text-sm ${
            said === null && reasonFailure === null ? "" : "tw:border-b tw:border-rule tw:px-4 tw:py-2"
          } ${said?.kind === "message" ? "tw:text-ink" : "tw:text-muted-foreground"}`}
        >
          {said === null ? reasonFailure ?? "" : said.kind === "pending" ? "Starting…" : said.kind === "asking" ? ASKING : said.text}
        </p>
        {/* **The wait for a short list from why you are reading**, a line of
            its own: `said` above is cleared by every opening and keystroke,
            and this request outlives both. Always in the tree, for the reason
            the status line is. */}
        <p
          role="status"
          className={`cmdbar-suggesting tw:m-0 tw:text-sm tw:text-muted-foreground ${
            suggestWaiting ? "tw:border-b tw:border-rule tw:px-4 tw:py-2" : ""
          }`}
        >
          {suggestWaiting ? SUGGESTING : ""}
        </p>
        {/* The microphone's own strip — the timer, the transcript on its way, a
            refusal. **After the bar's status line, not before it**: the strip
            carries a live region of its own (DictationStrip.tsx), and the
            bar's is the one a reader and every test here looks for first. */}
        <DictationStrip dictation={dictate.dictation} sendingAfter={dictate.sendingAfter} done="enter" />

        {shown.length === 0 ? (
          /* Greg's answer 3: no search fallback, no list of everything, and
             nothing guessed. Beside it, for a signed-in reader who has typed
             something, only the offer to ask (`ASK_LABEL`) — which does
             nothing until they press it, or Enter. */
          <p className="cmdbar-empty tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:px-4 tw:py-4 tw:text-sm tw:text-muted-foreground">
            {NO_MATCH}
            {showAskButton && (
              <>
                {" "}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  /* 44px for a finger (narrow-windows.md § the finger floor). */
                  className={`cmdbar-ask tw:pointer-coarse:min-h-11 ${askRefused ? "tw:cursor-default tw:opacity-50" : ""}`}
                  /* `aria-disabled`, not `disabled`: a disabled button takes no
                     mousedown, so a press on it would pull the focus out of
                     the box. `ask` refuses, and this says so. */
                  aria-disabled={askRefused || undefined}
                  /* **The focus stays in the box.** At a desk the arrows and
                     Enter go on working on the rows that come back; on a phone
                     the keyboard stays as it was, up or down. The click still
                     fires. */
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    /* Enter and Space activate a focused button with a
                       zero-detail click. Put focus back on the combobox before
                       suggestions replace this button; a finger tap must not
                       summon the phone keyboard. */
                    const fromKeyboard = e.detail === 0 && document.activeElement === e.currentTarget;
                    ask();
                    if (fromKeyboard && !askRefused) inputRef.current?.focus({ preventScroll: true });
                  }}
                >
                  {offerToAsk ? ASK_LABEL : ASK_AGAIN_LABEL}
                </Button>
                {/* Three words a phone has no use for. `pointer`, the main
                    one, as the size rules ask (touch.md): a touchscreen laptop
                    keeps them. */}
                {offerToAsk && (
                  <span className="cmdbar-or-enter tw:pointer-coarse:hidden">
                    {" "}
                    {ASK_OR_ENTER}
                  </span>
                )}
              </>
            )}
          </p>
        ) : (
          <>
          {/* Rows a model suggested are the bar's ordinary rows, under one
              muted line saying they were not found by what was typed. */}
          {suggesting && (
            <p className="cmdbar-suggested tw:m-0 tw:px-4 tw:pt-3 tw:text-sm tw:text-muted-foreground">
              {SUGGESTED_HEADING}
            </p>
          )}
          {/* **`div`s rather than a `ul`/`li`**, on Biome's own advice: an
             interactive ARIA role on a non-interactive element is an error
             (`noNoninteractiveElementToInteractiveRole`), and a listbox of
             options is exactly that. The semantics a screen reader reads come
             from the roles either way. */}
          <div
            id={listId}
            className="cmdbar-list tw:m-0 tw:overflow-y-auto tw:p-1"
            role="listbox"
            /* "Commands", not "Modes", since a page row is neither a mode nor
               a lie the reader should have to reconcile. */
            aria-label="Commands"
          >
            {shown.map((row, at) => {
              const { command } = row;
              return (
              <Fragment key={row.rowId}>
              {/* The list a model wrote from why you are reading, under one
                  muted line saying so, and a rule where the bar's ordinary
                  rows begin again. Neither is an option: the arrows pass
                  over them. */}
              {row.suggested !== undefined && shown[at - 1]?.suggested === undefined && (
                <div role="presentation" className="cmdbar-from-why tw:px-3 tw:pb-1 tw:pt-2 tw:text-sm tw:text-muted-foreground">
                  {SUGGEST_HEADING}
                </div>
              )}
              {at === firstOrdinary && at > 0 && shown[at - 1]?.suggested !== undefined && (
                <div role="presentation" className="cmdbar-rest tw:mx-3 tw:my-1 tw:border-t tw:border-rule" />
              )}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard equivalent is on the input above — Up/Down move the selection and Enter takes it, which is the listbox pattern; a key handler here would need focus on the row, and focus stays in the box the reader is typing in */}
              <div
                id={`${listId}-${row.rowId}`}
                className={`cmdbar-row tw:flex tw:items-baseline tw:gap-2 tw:rounded tw:px-3 tw:py-2 tw:text-sm ${
                  /* A suggested row has a second line, and words nobody
                     capped to a phone's width: it wraps where the bar's own
                     short labels never need to (narrow-windows.md). */
                  row.suggested !== undefined ? "cmdbar-row-suggested tw:flex-wrap" : ""
                } ${
                  dictationBusy ? "tw:cursor-default tw:opacity-50" : "tw:cursor-pointer"
                } ${
                  at === index ? "on tw:bg-accent tw:text-ink" : "tw:text-ink-soft"
                }`}
                role="option"
                aria-selected={at === index}
                /* The activation guard is the lock; this is the reader-facing
                   half of it. A highlighted row that silently ignores Enter
                   while the microphone is involved looks broken. */
                aria-disabled={dictationBusy || undefined}
                /* **Which kind of row this is, readable from the outside.** Not
                   styling — the two kinds are drawn identically on purpose, so
                   that going somewhere and changing the band feel like one
                   instrument. It is here so that tests/command-bar.test.tsx can
                   state the surviving half of call 4 ("the *mode* rows are
                   exactly what the Dock offers") without inferring the kind from
                   a row's label or from an href's leading slash. */
                data-kind={command.kind}
                /* **`-1`, and not a tab stop.** Focus stays in the box the
                   reader is typing in — which is the whole reason the input
                   carries `aria-activedescendant` — so a row is reached by the
                   arrows rather than by Tab. The attribute is here because an
                   element with an interactive role and no `tabIndex` at all is
                   reachable by nothing, which Biome is right to refuse. */
                tabIndex={-1}
                /* A mouse or a finger selects **and** activates, in one press.
                   Selecting first is what makes the highlight follow the press
                   rather than lag a frame behind it. */
                onClick={() => {
                  setSelected(at);
                  pressRow(row);
                }}
              >
                {/* A sub-mode says which mode it is in, muted, before its own
                    name — `Learn › Quiz` — so *Simple* is not a mystery and
                    the pictures read as Diagram's. Outside `cmdbar-name`, which
                    stays the row's own label. */}
                {command.kind === "submode" && (
                  <span className="cmdbar-parent tw:shrink-0 tw:text-muted-foreground">
                    {MODE_LABEL[command.sub.mode]} ›
                  </span>
                )}
                <span
                  className={`cmdbar-name tw:font-medium tw:text-ink ${
                    row.suggested !== undefined ? "tw:min-w-0 tw:max-w-full tw:break-words" : ""
                  }`}
                >
                  <RowLabel label={commandText(command).label} said={row.suggested?.said} />
                </span>
                {/* A suggested row's sentence is never cut: it takes a line of its
                    own and wraps, at every width. Beside a long label it was cut
                    to "Pu…" on a desktop and "Nothing is sent u…" on a phone, so
                    the Chat row lost the half that says a press sends nothing
                    (seen in the browser, 2026-10-06, plan 261005k). */}
                <span
                  className={`cmdbar-what tw:min-w-0 tw:text-muted-foreground ${
                    row.suggested !== undefined ? "tw:basis-full" : "tw:flex-1 tw:truncate"
                  }`}
                >
                  {commandText(command).description}
                </span>
                {/* One bit, after the sentence rather than before it: the row is
                    still about what the row gives you, and this is a note on
                    the end. `GENERATES_MARKER` says why it is a word, and
                    `commandGenerates` — which took the `kind` check's place on
                    2026-09-08, on the day the spending page it warned about
                    arrived — is the one place any row's answer comes from. */}
                {commandGenerates(command) && (
                  <span className="cmdbar-generates tw:shrink-0 tw:text-xs tw:text-ink-faint">
                    {GENERATES_MARKER}
                  </span>
                )}
                {/* The same kind of note, about the reader rather than the
                    row: `current` on the appearance in force (command-match.ts
                    § `CommandWords.marker`). */}
                {commandMarker(command) !== undefined && (
                  <span className="cmdbar-marker tw:shrink-0 tw:text-xs tw:text-ink-faint">
                    {commandMarker(command)}
                  </span>
                )}
                {/* **Why the model proposed it**, as the row's second line and
                    in the model's face. Absent when it gave none worth
                    keeping (src/command-suggest.ts § `whyOf`). */}
                {row.suggested !== undefined && row.suggested.why !== "" && (
                  <span className={`cmdbar-why tw:basis-full tw:text-xs tw:text-muted-foreground ${voiceClass("ai")}`}>
                    {row.suggested.why}
                  </span>
                )}
              </div>
              </Fragment>
              );
            })}
          </div>
          </>
        )}
      </div>
    </dialog>
  );
}
