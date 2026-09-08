# More commands in the command bar, and the button beside the logo

**Status:** planned, 2026-09-08. From feedback report `SPIDERYARN-READING2-2D`, filed by Greg from
the reading view of *after-work-we'll-have-each-other*, build `c0fb04a4`, 2026-09-07 17:37 UTC.

> Add Library, Feedback, Metadata, Tweets, Homepage, Profile, and a few more likely/useful commands
> to Command Bar. And move Command bar to the left of the Dock, just after the logo.
>
> — Greg, 2026-09-07

The sender is `ADMIN_USER_ID_PROD`, so [feedback-reports.md § Who sent it](../project/feedback-reports.md)
says build it, simplest version first, and do not stop to ask whether it is worth doing. What is left
to decide is *how*, and there are three real decisions here rather than a list to type in.

The note for the report is [`docs/user-feedback/260907_1737-more-commands-in-the-command-bar.md`](../user-feedback/260907_1737-more-commands-in-the-command-bar.md).

## What is there now

The bar is [`src/web/CommandBar.tsx`](../../src/web/CommandBar.tsx), the ranking is
[`src/web/command-match.ts`](../../src/web/command-match.ts), and the shape of both is four product
calls Greg made on 2026-09-06 and amended on 2026-09-07
([260906h](260906h-mode-catalog-and-a-command-bar.md) § The four product calls). It offers fourteen
modes and exactly one page, `/changelog`, and it is mounted — button and dialog together — only
where there is a band to change: `mode !== undefined && onMode !== undefined && !isVisitor`, which is
the reading view, for the owner.

Two things in the existing code decide most of this plan, and both are worth quoting because they
were written *before* this report and they anticipate it.

**`Command` refuses new verbs, and says which ones.** command-match.ts § `Command`: a passage jump,
an "ask this article", a generation row *"each need a **verb the bar would have to invent**"*. The
2026-09-07 changelog row was allowed through because `navigate` is *"the verb every `<Link>` in the
app already has"* — nothing was designed, an existing operation was reached for.

**And the `generates` marker already names the day this plan arrives.** CommandBar.tsx, on why no
page row can carry it:

> The fix, on the day a spending page is proposed, is to move "does this start work?" into `Command`
> itself and render off the property — not to add a second name to this condition. (GPT Sol, 2026-09-07)

Tweets is that page. Pressing the Dock's Tweets button arms a model call over the whole article
(`armActivationForTweets`), so a Tweets row that did not carry the marker would be the bar
under-warning on exactly the row Sol predicted.

## The three decisions

### 1. Library and Homepage are one row, not two

`LIBRARY_HREF` is `/`, and for a signed-in reader `/` **is** the library — the shelf is the home
page. The bar is owner-only, so every reader who can open it is signed in. Two rows would therefore
be two names for one destination, and worse than merely redundant: `commandId` is `page:${href}`, so
two rows at `/` would share a React key and an `aria-activedescendant` target, which
command-match.ts § `commandId` calls *"two rows the keyboard and a screen reader cannot tell apart"*.

**So: one row, labelled `Library`, with `home` and `homepage` among its aliases.** Typing either of
Greg's two words gets you there; only one row appears. This is the tweak
[feedback-reports.md](../project/feedback-reports.md) § What a report is not expects — the request is
honoured, the shape is ours.

### 2. Metadata and Tweets are article rows, and they cannot be stranded

The brief asks what a Metadata command does on a page with no article. The answer here is *it does
not exist*, by construction rather than by an empty state: the bar is mounted only on the reading
view, so `slug` is always in hand, and the two rows are built from an `article` prop that is
`undefined` everywhere else. No row, no sentence to write, nothing to keep true.

That is worth saying out loud because it is a **fact about today's gate, not about the rows**. The
day the bar is offered on the metadata page or the library — which this plan does not do,
§ Deliberately deferred — is the day those rows need either an article to point at or a reason to be
absent, and the `article === undefined` branch is where that argument will go.

Two consequences fall out of the same gate:

- **`view` is always `"article"`** when the bar is open, so the Tweets row always arms, and the
  `current`/`isVisitor` guards the Dock's own Tweets link carries are already discharged by the gate.
  The row calls `armActivationForTweets(slug)` and then navigates, which is *exactly* what the Dock
  button does — product call 1's surviving half, applied to a link rather than a mode.
- **The Tweets row carries `generates`.** See above.

### 3. Feedback is the one new verb, and it is worth it

Greg named Feedback, and it is not a page: it opens a `<dialog>` that
[`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) mounts once, for the life of the page, and
offers through a context. So this is the first row that is neither *go there* nor *change the band*.

It is admitted, and the honest accounting is that `Command` grows a third arm — `action`, with a
`run()`. What that costs is one more branch in `CommandBar` § `activate` and one more prefix in
`commandId`. What it buys is the row Greg asked for, and a shape for every future control-shaped
command instead of a special case for this one.

**`FeedbackButton.tsx` grows one export** — a `useFeedbackOpen()` hook returning the context's
`open` or `null` — because the context is currently private to that file. That file is plausibly
`fb2c-feedback-button-on-homepage`'s ground this week; the addition is ten lines and adds no
behaviour, so a merge conflict there is a paragraph to reconcile rather than a design to
re-litigate.

**A missing host means no row**, not a dead one: `useFeedbackOpen()` returns `null` when nothing
above has mounted the host, which is the same rule `FeedbackTrigger` already follows
(*"a trigger with no host above it renders nothing"*).

## The rows

Seven new, in this order, below the fourteen modes. Article-scoped first because they are about the
thing in front of you, then the app's own pages, then the one action.

| Row | Kind | Where it goes | Notes |
| --- | --- | --- | --- |
| `Metadata` | page | `readHref(slug, search, "metadata")` | only with an article |
| `Tweets` | page | `readHref(slug, search, "tweets")` | only with an article; **generates** |
| `Library` | page | `/` | aliases carry `home`, `homepage`, `shelf` |
| `Add an article` | page | `/add` | the app's primary verb, and reachable from the shelf |
| `Profile` | page | `/profile` | aliases carry `settings`, `account`, `plan` |
| `Public shelf` | page | `/read/public` | what other readers have made public |
| `What's new` | page | `/changelog` | **unchanged**, and it moves to the end |
| `Feedback` | action | opens the dialog | the new verb |

`Add an article` and `Public shelf` are the *"few more likely/useful"* half of the ask, and they are
chosen against the brief's own rule — **destinations the reader can already reach by other means**,
not new capability. Both are links on the shelf today.

**What was considered and left out**, so the next agent does not re-derive it:

- **The footer's five** — Features, Pricing, Privacy, Contact, and now `/opensource`. CommandBar
  § `PAGES` already argues this and the argument stands: *"the footer is the site's own navigation
  … none of which a reader mid-article is reaching for a keyboard to get to"*. Sharing that array
  would put five rows in the bar to keep a promise nobody made.
- **Comments** — genuinely likely, and a *fourth* shape: on the reading view it opens a drawer
  (`drawer.onPanel`), off it, it is a link. One command with two behaviours depending on where you
  are is the kind of thing that reads fine in a plan and confuses a reader, and the button is three
  inches away. Deferred with the reason, not forgotten.
- **Admin and Design** — both would need an admin check the bar has never had, for two rows only
  Greg can use. `/admin` is one keystroke in the address bar for the one person who wants it.
- **Sign out, and the experimental switch** — both are actions with consequences, and a bar whose
  Enter key is one row away from signing you out is a bar you press more carefully. The switch also
  has state, which no row here draws.

## The placement

`DockCommands` moves from inside the `TooltipGroup` that holds Comments / Tweets / Metadata to
between `DockHome` and the modes — *"just after the logo"*, which is what Greg asked for and which
is also where the button now belongs: it stopped being *the other door into the modes* the moment it
grew rows that are not modes.

**One thing gets slightly worse, and it is named rather than discovered later.** Inside that group
the card opened instantly once any neighbouring card had opened (`TooltipGroup` is
`FloatingDelayGroup`); alone, it waits its own 300 ms every time. That is the correct trade — it is
one button and it is no longer part of that group's subject — but the comment in Dock.tsx that
records the button joining the group *on 2026-09-08* has to be corrected in the same edit rather
than left describing a row it is no longer in.

**The fit ladder is unaffected**, and this is a claim rather than a hope: `useDockFit` measures the
row's total scroll width against its client width and walks
[the rungs](../../src/web/dock-fit.ts) by class, so DOM order is not an input. What does change is
*which* label sits second on a narrow bar — `Commands` rather than a mode — and rung 1 drops
`.dock-home` and `.dock-feedback` labels only, so `Commands` keeps its word one rung longer than the
logo beside it. [narrow-windows.md](../project/narrow-windows.md): the bar scrolls rather than
clips, so the floor under the ladder is a row you can drag, and this button is now at the end you
start from rather than the end you drag to.

**The chord does not move.** ⌘/Ctrl-K is `useCommandBarChord` on the `Dock`, bound to the window and
not to the button, so [keyboard.md](../project/keyboard.md) § The one chord that is not an arrow
needs no change at all — the key opens the same dialog wherever the button sits.

## The simpler option this passed over

**Six hand-written rows in `PAGES` and a `<DockCommands>` moved up ten lines** — no new `Command`
arm, no `article` prop, no hook exported. It fails on three of the six rows: Metadata and Tweets need
a slug that `PAGES` (a module constant) cannot see, and Feedback is not a page at all. The version
that avoids the type change is the version that quietly drops half of what was asked for.

The other simpler option, **letting the Tweets row navigate without arming**, is worse in a way a
reader would feel: they would land on the thread page with a button to press, having just been told
by the row's own `generates` marker that pressing Enter would start something.

## Stages

1. **The type and the ranking.** `Command` grows an `action` arm and a `generates` flag; `commandId`
   grows an `action:` prefix; `commandText` stops special-casing one kind. Tests in
   `tests/command-match.test.ts` for the new arm's ranking and id. No UI change yet.
2. **The rows.** `PAGES` becomes a function of `{ article, openFeedback }`; the seven rows land;
   `CommandBar` renders `generates` off the property rather than off `kind === "mode"`; the
   `useFeedbackOpen` hook is exported and `DockCommandBar` passes `slug`, `search` and the opener
   down. Tests in `tests/command-bar.test.tsx`: the article rows appear with an article and not
   without one, Tweets arms, Feedback runs, Library appears once for both words.
3. **The placement**, and the two comments that describe it, and the Commands button's own tooltip
   copy, which currently promises *"Type a mode's name"* and names only the changelog beside them.
4. **The docs** — reading-view-overview.md § The command bar, which currently states as a rule that
   *a generation row … needs a verb this bar does not have*. That is one of the seven entry points,
   so [edit-important-docs.md](../reusable/edit-important-docs.md) applies: the before and the after
   go in § The entry-point edit below rather than in a chat nobody is reading.

A GPT Sol review after each stage, and the code review at the end weighted higher than this plan's.

## Deliberately deferred

- **The bar off the reading view.** Now that it offers Library, Profile and Feedback, it would be
  useful on the metadata page, the tweets page and the shelf — but the gate is `onMode !== undefined`
  precisely because `activateMode` does not exist there, and lifting it means deciding what fourteen
  mode rows do on a page with no band. That is its own plan.
- **The draft surviving a close**, still (260906h § Deliberately deferred).
- **Fuzzy matching.** Twenty-two rows is still not enough to need it, and command-match.ts § the
  five tiers says where a sixth would go.

## The entry-point edit

Filled in at stage 4, with the before and the after, because
[edit-important-docs.md](../reusable/edit-important-docs.md) asks for an approved set and there is
nobody in the chat of an unattended run to approve one.
