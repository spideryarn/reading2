/**
 * **Type a word, press Enter, be in that mode** — or on that page, or with that
 * dialog open. Spotlight for the fourteen modes, and for the eight rows that
 * are not modes: **seven of them arrived on 2026-09-08** and `What’s new` was
 * already there, which is the arithmetic this sentence got wrong at first and
 * GPT Sol caught.
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
 *     The half of the call that has never changed: a mode row's Enter opens it
 *     **exactly as pressing its Dock button does** — same activation, same
 *     generate-on-open, same cost. Since 2026-09-08 that holds for the rows
 *     that are not modes too: Tweets arms a run over the whole article on its
 *     way to the thread page, exactly as the Dock's Tweets button does, and
 *     wears the `generates` marker for it.
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
 *  4. **The bar's mode rows are exactly what the Dock lists** — narrowed from
 *     *the bar lists exactly what the Dock lists* by the 2026-09-07 change,
 *     since the rest are the bar's own. The surviving half is still true *by
 *     construction* rather than by agreement: the visible modes arrive as a
 *     prop, computed once by `visibleModes` in Dock.tsx, so there is no second
 *     copy of the experimental-switch rule to keep in step. Everything else is
 *     appended **after** that prop, never mixed into it, which is what keeps
 *     the halves separable — and tests/command-bar.test.tsx asserts both halves
 *     rather than the old single one.
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
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { armActivationForTweets, modeGenerates } from "./activation.js";
import { useFeedbackOpen } from "./FeedbackButton.js";
import {
  commandId,
  commandText,
  modeCommand,
  rankCommands,
  type Command,
} from "./command-match.js";
import type { Mode } from "./params.js";
import {
  CHANGELOG_HREF,
  CHANGELOG_LABEL,
  LIBRARY_HREF,
  PROFILE_HREF,
  PUBLIC_LIBRARY_HREF,
  navigate,
  readHref,
} from "./router.js";
import { useVisualViewport } from "./useVisualViewport.js";

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
 * only where there is a band to change — `mode !== undefined &&
 * onMode !== undefined && !isVisitor`, which is the reading view, for the owner
 * — so every reader who can open the bar is standing on an article. The option
 * is here because that is a fact about the *gate*, not about the rows: the day
 * the bar is offered on the shelf or the metadata page (260908e § Deliberately
 * deferred) is the day this is `undefined`, and the answer then is the one
 * `besideTheModes` gives now — **no row at all**, rather than a row that has to
 * say something about an article that is not there.
 */
export interface CommandBarArticle {
  readonly slug: string;
  /** Already through `carriedSearch`; `readHref` adds the `?`. */
  readonly search: string;
}

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
 * for two rows one person can use; and **sign out** and the **experimental
 * switch**, because a bar whose Enter key is one row from signing you out is a
 * bar you press more carefully. 260908e § What was considered and left out.
 */
function besideTheModes({
  article,
  openComments,
  openFeedback,
}: {
  article: CommandBarArticle | undefined;
  /** The Dock drawer's `onPanel`, already bound to `"questions"`, or absent. */
  openComments: (() => void) | undefined;
  /** `useFeedbackOpen()`'s answer — `null` where no host is mounted above. */
  openFeedback: (() => void) | null;
}): readonly Command[] {
  return [
    ...(article === undefined ? [] : articleRows(article)),
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
            run: openComments,
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
            run: openFeedback,
          } as const,
        ]),
  ];
}

/**
 * **The two rows that are about the article in front of you**, and they exist
 * only when there is one — see `CommandBarArticle` for why that is a statement
 * about the gate rather than about these rows.
 *
 * Both go exactly where the Dock button of the same name goes, `search` and
 * all, so a reader who has learned one door has learned the other.
 */
function articleRows({ slug, search }: CommandBarArticle): readonly Command[] {
  return [
    {
      kind: "page",
      href: readHref(slug, search, "metadata"),
      label: "Metadata",
      description: "Where this came from, how long it is, and every step that built it.",
      aliases: ["about", "details", "source", "reading time", "stats"],
      /* The metadata page shows what the pipeline already wrote; opening it
         runs nothing. */
      generates: false,
    },
    {
      kind: "page",
      href: readHref(slug, search, "tweets"),
      label: "Tweets",
      description: "The article rewritten as a thread you could post.",
      aliases: ["thread", "twitter", "x", "social"],
      /**
       * **This row spends, and it is the row CommandBar.tsx predicted.**
       *
       * Pressing the Dock's Tweets button arms a run over the whole article
       * (Dock.tsx § the Tweets link) rather than taking you to a page with a
       * button on it, and this does the same — *"a row opens its mode exactly
       * as pressing that button here does"*, applied to a link. The alternative
       * considered and rejected: navigate without arming, which would land the
       * reader on the thread page with a button to press, having just been told
       * by the marker below that Enter would start something.
       *
       * **The Dock guards this with `isVisitor || view === "tweets"` and this
       * does not, because the bar's mount gate has already discharged both**:
       * no visitor sees the bar at all, and `mode !== undefined` is only true
       * on the reading view, so `view` is always `"article"` here. If the bar
       * is ever offered off the reading view — 260908e § Deliberately deferred
       * — this is the line that has to grow the second guard back.
       */
      onNavigate: () => armActivationForTweets(slug),
      generates: true,
    },
  ];
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
       docblock above. Sparse elsewhere, for the reason the mode aliases are
       (docs/project/reading-view-overview.md § The command bar): the cost of a
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
    /* Named for what it is rather than for its address: `/read/public` is a
       shelf of other people's articles, and *Public shelf* is what
       docs/project/public-shelf.md calls it. */
    label: "Public shelf",
    /* *Anybody*, not *other readers*: public-shelf.md § It is not the owner's
       shelf narrowed — the page lists every article anybody has shared, the
       reader's own included, and describing it as other people's would be the
       one distinction that page exists to make, got backwards. */
    description: "Every article anybody has shared, yours included.",
    aliases: ["public", "public library", "shared", "browse"],
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

/**
 * **What a reader is told about a row that would start work**, and it is one
 * plain verb rather than a glyph or a figure.
 *
 * Fable's reasoning, 2026-09-07, arbitrating GPT Sol's F1: a glyph needs a
 * tooltip to mean anything and *"a tooltip is not read by anybody in a hurry"*
 * (this repo's own words, 260906b); a coin would make it about money, which
 * readers do not pay per call since they hold slots; a spark would read as "AI
 * magic", which is the flattening voice vision.md rejects. `generates` names
 * what happens.
 *
 * Which rows carry it is `commandGenerates` below. For a mode that is
 * `modeGenerates` in activation.ts, derived from a table that is already total
 * — so mode fifteen gets its marker decided by the row it must already write.
 * That docblock has what the marker deliberately does not say, and where it
 * over-warns.
 */
export const GENERATES_MARKER = "generates";

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
 * The Tweets row is that page — it arms a run over the whole article on the way
 * to the thread — so the fix is the one that comment prescribed: the answer is
 * a **property on the command**, and this function is what puts the two arms on
 * one footing rather than adding a second name to the old condition.
 *
 * The mode arm stays a table lookup rather than a copied flag, because
 * `MODE_TARGET` is already total and a duplicated boolean per mode is fourteen
 * chances to disagree with it.
 */
function commandGenerates(command: Command): boolean {
  return command.kind === "mode" ? modeGenerates(command.mode) : command.generates === true;
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
  onClose(): void;
}

export function CommandBar({
  modes,
  activateMode,
  article,
  openComments,
  open,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const [draft, setDraft] = useState("");
  /**
   * **Which row Enter would take**, as an index into `results` below.
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
   * **The way into the Feedback dialog**, or `null` where no host is mounted
   * above this — which is the ordinary signed-out case rather than a mistake
   * (FeedbackButton.tsx § `useFeedbackOpen`). No opener, no row.
   *
   * A hook, so it is called unconditionally at the top and not inside the memo
   * below, where the rules of hooks would not have it.
   */
  const openFeedback = useFeedbackOpen();

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
  const commands = useMemo(
    () => [
      ...modes.map(modeCommand),
      ...besideTheModes({ article, openComments, openFeedback }),
    ],
    [modes, article, openComments, openFeedback],
  );
  const results = useMemo(() => rankCommands(draft, commands), [draft, commands]);
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const active = results[index];

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
      closingOurselves.current = false;
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingOurselves.current = true;
      dialog.close();
    }
  }, [open]);

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
   * **Enter, and the one thing it must not do**: activate when there is nothing
   * selected. `results` is empty for a query that matches nothing, and a bar
   * that opened *something* on Enter after saying `No command matches.` would
   * be worse than one that did nothing.
   */
  const activate = useCallback(
    (command: Command) => {
      /* **Three verbs, and the switch is the whole of the difference between
         the three kinds of row.** A mode is armed exactly as its Dock button
         arms it (call 1); a page is navigated to exactly as a `<Link>`
         navigates — `navigate` is what Link.tsx calls once it has decided the
         reader wants to stay in this tab, which a reader pressing Enter in a
         modal dialog has; an action runs its closure, which is 2026-09-08 and
         is argued in command-match.ts § `Command` rather than here.

         **`onNavigate` before `navigate`, in that order**, and it is the order
         `Link.tsx` uses for the same pair: the Tweets row arms a run and then
         goes to the page that will show it, and arming *after* the navigation
         would be arming in a component the navigation has unmounted.

         **No ⌘-click into a new tab**, which a real `<a>` would give and this
         does not. Deferred rather than missed: an `<a>` inside `role="option"`
         puts an interactive element inside an interactive role, and the rows
         are `div`s precisely because Biome is right to refuse that. The bar is
         a keyboard instrument; the footer link is the one to ⌘-click. */
      switch (command.kind) {
        case "mode":
          activateMode(command.mode);
          break;
        case "page":
          command.onNavigate?.();
          navigate(command.href);
          break;
        case "action":
          command.run();
          break;
        default: {
          /* A fourth kind fails to compile here rather than silently doing
             nothing — which is what an `else` would have given it. */
          const never: never = command;
          return never;
        }
      }
      setDraft("");
      setSelected(0);
      onClose();
    },
    [activateMode, onClose],
  );

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
        <input
          ref={inputRef}
          type="text"
          className="cmdbar-input tw:w-full tw:border-0 tw:border-b tw:border-rule tw:bg-transparent tw:px-4 tw:py-3 tw:text-base tw:text-ink tw:outline-none"
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
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          /* Which row Enter would take, announced without moving focus off the
             box the reader is typing in — the listbox pattern's own answer. */
          aria-activedescendant={active === undefined ? undefined : `${listId}-${commandId(active)}`}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            /* **Back to the first row on every filter change.** Otherwise a
               reader who arrowed down to row four and then typed one more
               letter has Enter pointing at whatever is fourth in a list they
               have not looked at. */
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              /* Clamped rather than wrapped, at both ends. Wrapping is fine in a
                 long list you scroll; in fourteen rows it means holding an arrow
                 quietly cycles, and every row here can spend money. */
              setSelected(Math.min(index + 1, results.length - 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected(Math.max(index - 1, 0));
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (active !== undefined) activate(active);
            }
          }}
        />

        {results.length === 0 ? (
          /* Exactly this, and nothing beside it — Greg's answer 3. No search
             fallback, no "did you mean", no list of everything. */
          <p className="cmdbar-empty tw:m-0 tw:px-4 tw:py-4 tw:text-sm tw:text-muted-foreground">
            {NO_MATCH}
          </p>
        ) : (
          /* **`div`s rather than a `ul`/`li`**, on Biome's own advice: an
             interactive ARIA role on a non-interactive element is an error
             (`noNoninteractiveElementToInteractiveRole`), and a listbox of
             options is exactly that. The semantics a screen reader reads come
             from the roles either way. */
          <div
            id={listId}
            className="cmdbar-list tw:m-0 tw:overflow-y-auto tw:p-1"
            role="listbox"
            /* "Commands", not "Modes", since a page row is neither a mode nor
               a lie the reader should have to reconcile. */
            aria-label="Commands"
          >
            {results.map((command, at) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard equivalent is on the input above — Up/Down move the selection and Enter takes it, which is the listbox pattern; a key handler here would need focus on the row, and focus stays in the box the reader is typing in
              <div
                key={commandId(command)}
                id={`${listId}-${commandId(command)}`}
                className={`cmdbar-row tw:flex tw:cursor-pointer tw:items-baseline tw:gap-2 tw:rounded tw:px-3 tw:py-2 tw:text-sm ${
                  at === index ? "on tw:bg-accent tw:text-ink" : "tw:text-ink-soft"
                }`}
                role="option"
                aria-selected={at === index}
                /* **Which kind of row this is, readable from the outside.** Not
                   styling — the two kinds are drawn identically on purpose, so
                   that going somewhere and changing the band feel like one
                   instrument. It is here so that tests/command-bar.test.tsx can
                   state the surviving half of call 4 ("the *mode* rows are
                   exactly what the Dock lists") without inferring the kind from
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
                  activate(command);
                }}
              >
                <span className="cmdbar-name tw:font-medium tw:text-ink">
                  {commandText(command).label}
                </span>
                <span className="cmdbar-what tw:min-w-0 tw:flex-1 tw:truncate tw:text-muted-foreground">
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
              </div>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}
