# Fewer top-level modes: Tweets becomes Summary's Thread

Report `spya-thpsnd`, Greg (admin), 2026-10-03, from the Feedback button. His words in full are in
[the note](../user-feedback/261003_1010-fewer-top-level-modes-tweets-under-summary.md). The part
this plan builds:

> I was thinking about putting the tweet thread as a submode of summary, because they kind of serve
> related purposes. In the summary, if we did that, maybe we get rid of the slider. Not sure. I was
> thinking that I quite like, of the three versions of the summary length that we have, I quite like
> the shortest and the longest, so what is that, briefer and fuller. So it could just be briefer,
> fuller, and tweet thread as three buttons somehow. Not buttons, like group buttons. Not radio
> buttons exactly, but like, you know, a sense that you can have one of those three. I think I'd
> like to try that. … keep all of the tweet thread. Functionality and UI, just put it within as a
> submode within summary.
>
> — Greg, 2026-10-03

And the frame around it, which he is unsure about and wants pushback on:

> I would like to have fewer modes, and I can't figure out how to do that. You know, if a new user
> comes to Spideryarn, they're going to be overwhelmed.

## What is there today

- **Summary** is a mode with one control: a three-stop slider, Brief · Simple · Fuller, with a small
  icon button at each end. `?summary=brief|simple|fuller`, Brief the default. One job (`simple`)
  writes all three levels, all or none. Roomy band (28rem).
- **Tweets** is a top-level mode beside it in the bar: the article as a numbered thread, wide band
  (34rem / 42% share), its own step (`tweets`), no URL parameters. It is the one mode that writes
  **on arrival** rather than on a press, and for that reason a last-view restore drops it.

## What we build (v1)

One stage. The bar loses a button; Summary gains a third choice.

```
 before                                after
 bar:  … Summary  Tweets  Diagram …     bar:  … Summary  Diagram …

 Summary band:                          Summary band:
   ▤ ○──●──○ ▤▤                           [ Brief | Fuller | Thread ]
   paragraphs                             paragraphs, or the thread
```

1. **`tweets` leaves `MODES`** and goes into `RETIRED_MODES` → `summary`, by
   [mode.md § Retiring a mode](../project/mode.md#retiring-a-mode). `?mode=tweets` and the older
   `/read/<slug>/tweets` both land on `?mode=summary&summary=thread` (a `lift…` rewrite in
   `router.ts`, beside `liftLegacyTweets`).
2. **Summary's view is `brief | fuller | thread`** (`SUMMARY_VIEWS`, a new vocabulary; `brief` still
   the default and absent from the address). `?summary=simple` degrades to `brief`, like every
   unknown value.
3. **The slider goes; a three-way segmented control replaces it** — one of three, labelled in words
   (Brief, Fuller, Thread), built the way Remember's and Structure's sub-mode toggles are. It sits in
   the same one row. Each segment's press arms what it shows (below).
4. **Thread shows the existing thread panel unchanged** — copy buttons, block links, the (i) with
   counts, the profile badge, stale banner, visitor twin — with the segmented control as a row above
   it. The band is the **wide** shape while Thread is showing and **roomy** otherwise:
   `bandShapeFor(mode, summaryView)`.
5. **The Simple level is still written and stored, but not shown.** Nothing in the `simple` step,
   its prompt, its stored shape or the public DTO changes. This is deliberate: Greg is trying this
   out, and leaving the data alone makes going back a client-only revert. Stopping the third call
   (about a third of a Summary press) is a follow-up question for him, queued, not built.
6. **The thread still writes itself when its owner opens it, however they arrived** — Greg's
   2026-09-12 rule, kept (see § Decision 6 below; the first draft of this plan changed it and Sol's
   review, F7, showed the smaller way). `useTweets` and `useAutoRunOnArrival` are untouched. So a
   press on Thread arms **nothing**: Summary's `MODE_TARGET` row becomes `delegated` on a new
   `PressContext.summary` (`thread` → `null`, else `simple`), and `subModeTarget` and `bandTarget`
   give the same answer. The `arrival` kind leaves `ModeActivation` (no mode has it now), and
   `subModeGenerates` says yes for Thread by name, as it does for Diagram's pictures, so the command
   bar still marks the row `generates`. A last-view restore must not open the thread: `last-view.ts`
   drops `mode` from a restore when it is `summary` **and** the remembered `summary` is `thread`
   (the `tweets` entry in `NEEDS_AN_EXPLICIT_PRESS` goes; `?summary=thread` itself stays remembered
   and dormant, as `?diagram=` does). Pressing the Summary bar button while it is already showing
   still closes the band and arms nothing (F6).
   **`PressContext.summary` comes from the same parsed React state that picks the band, never from
   `location.search` at render** (F1): nuqs flushes the address late, and a context read from the
   old address would arm `simple` while Thread is on screen, leaving a token for Back to spend.
7. **The add page queues what it queued yesterday.** `autoModes()` derives from `MODES` through
   `modeStep`, which answers `null` for a delegated row and no longer sees `tweets` at all, so the
   change would silently drop **both** `simple` and `tweets` from *Generate the main modes* (F2).
   Both stay, and `autoModesDetail()` still names Summary. The test asserts the whole request list.
8. **Words and the places that name the mode.**
   - Command bar: the sub-mode rows are Brief, Fuller, Thread. **Typing "tweets" (or `thread`,
     `twitter`, `x`, `social`) and pressing Enter opens Thread**, not Summary at Brief (F3): the
     aliases belong to the Thread row, with precedence over Summary's own row, not to
     `MODE_CATALOG.summary`. Summary's `description` and `how` are rewritten for two lengths and a
     thread.
   - Re-run commands: `RERUN_MODE.tweets` goes with the mode, and "rerun tweets" must still force
     the `tweets` step while "rerun summary" forces `simple` and never a thread (F5).
   - Old addresses: `?mode=tweets` and `/read/<slug>/tweets` land on Thread on a cold load, on a
     client navigation and on Back/Forward between query entries on one article (F4). The legacy
     spelling wins over any carried `summary=brief|fuller`, leaves no duplicate `summary` pair, and
     keeps unrelated state. Tested with a public article that has a thread and no summary.
   - Help page: Tweets' section folds into Summary's. `FeaturesPage.tsx`'s Tweets tile points at
     Summary's Thread.
   - Sharing: the owner's *make public* inventory still lists the thread **when one is stored** and
     not otherwise — a presence-sensitive entry of its own, since `POLICY.summary` is `available`
     and cannot say. A visitor reads a stored thread through `VisitorTweetsBand`; with none stored
     the Thread view says so in a line.
9. **Docs**: `tweets.md`, `summaries.md`, `mode.md` (the arrival exception goes),
   `reading-view-overview.md`, `url-state.md`, `help-page` tables.

### Decision 6: the thread keeps writing on arrival

On 2026-09-12 Greg asked that the thread *"automatically start generating … when opened (without
having to click a button to kick it off)"*, and in this report *"keep all of the tweet thread.
Functionality and UI"*. So it is kept.

**The option passed over**: make the thread follow the ordinary rule (a press spends, arriving does
not) and delete `useAutoRunOnArrival` and the `arrival` kind — one rule everywhere. The first draft
chose it, arguing the exception needed more machinery inside Summary than it does. Sol's F7 showed it
does not: a delegated row may already answer `null`, as Diagram's free pictures do, and the restore
exception is one condition. Converting the thread's generation lifecycle during a grouping trial
would also have taken away something Greg asked for by name. It goes to Greg as a question in the
debrief: unify later, or leave it.

### Not built, and why

- **Dropping the Simple level from the step** — a prompt-and-schema change for a UI trial; queued as
  a question.
- **A layout that does not jump** when moving between Fuller (roomy) and Thread (wide). The band
  widens by up to 6rem and the control stays at its left edge. Accepted for v1; the browser check
  reports how it feels.
- **Marginalia as an umbrella for Glossary, Ideas and Quotes**, and any other amalgamation — a
  proposal below, not built.
- **The command bar taking the reader's goal**, and **steering Debate** — sessions
  `fb-command-bar-nl` and `fb-debate-2610`. How they connect is below.

## Tests

Red first where a behaviour changes: the lift (`?mode=tweets` → summary's thread), the parser
(`simple` → `brief`, `thread` parses), the press (a Thread segment press arms nothing and the band's arrival run posts the one `tweets` step; a second press before the
address flushes leaves no token armed and Back posts nothing), last-view (a restore never opens the
thread), the band
shape, the whole `autoModeSteps()` list, "tweets" + Enter in the command bar opening Thread, "rerun
tweets" and "rerun summary", and the old addresses on a tweets-only public article. Then the tables [mode.md § Retiring a mode](../project/mode.md#retiring-a-mode) lists, and
the whole suite, because four of them are keyed on `string` and only the suite sees them.

Browser check (Sonnet, Playwright on the box): desktop, iPad portrait and landscape, phone — the
control's fit in one row, the band's width change, the thread's copy buttons and links, a visitor's
view of a public article with and without a stored thread, dark and light.

## The wider question: fewer modes for a new reader (proposal, not built)

Greg's idea was sub-modes inside Marginalia:

> you can imagine putting glossary and ideas and quotes and stuff like that all within the
> marginalia mode, so that you could say, I only want... Yeah, submodes within that.

An Opus subagent was asked for a product opinion on 2026-10-03 (read-only; its counts are from
`MODE_CATALOG` and `MODES_UI`). What it said, and what this plan takes from it:

**The count.** 18 modes today: 10 on everybody's bar, 8 more with the experimental switch on. This
plan's v1 makes that 9 and 17.

**Glossary, Ideas and Quotes inside Marginalia: not as stated.** Marginalia is not a band. It is a
column to the *right* of the prose (`?margin=1`) that stands beside whichever band is open, sits
outside the bar's one-of-many group, and is given up on a narrow window. Glossary, Ideas and Quotes
are sortable lists in the band on the *left*. Folding them in would break the split
[interface-vision.md](../project/interface-vision.md) is built on (left is about the whole piece,
right is anchored to a passage), would take those lists away on a phone, and would blur "opening
Marginalia spends almost nothing".

**What the wish is probably after, in two smaller pieces:**

1. **One bar button for the list modes** — call it *Extracts* — that opens a labelled menu of
   Quotes, Glossary and Ideas (and FAQ, Timeline, Citations with the switch on). The modes, their
   addresses, bands and controls do not change; only the bar does. Default bar 9 → 7.

   ```
   bar today:  Plain Structure Summary Skim Quotes Glossary Ideas Search Chat
   proposed:   Plain Structure Summary Skim Extracts▾ Search Chat
                                              ├ Quotes
                                              ├ Glossary
                                              └ Ideas
   ```

   Cost: a bar-only change, plus deciding what the button shows while one of its modes is open
   (the bar already draws a hidden mode's button while you are in it). It gives up one-press reach
   to Glossary and Quotes, the two list modes whose marks are in the prose in every mode anyway.
2. **A filter on the kinds of note in Marginalia** ("I only want glossary notes") — a small feature
   inside the column, separate from the bar.

**What it would not do**, with the reason: a bar chosen by the reader's goal (different per article,
unpredictable, hard to test — the most complexity of anything here); using the experimental switch
as an "advanced" tier (it means *unfinished*, and Greg took Skim and Quotes out of it on
2026-09-28); nesting Diagram under Structure or Debate under Referee (sub-sub-modes; different
jobs).

**Is merging the right fix at all?** Only where the things are alternatives of one thing, as a
summary and a thread are. Elsewhere it moves the clutter one level in and costs the whole
[mode.md](../project/mode.md) checklist per mode. The cheapest real reduction is the overflow menu
above, which is also interface-vision.md's own step 4, and the command bar is what makes it safe
rather than a fix in itself: a new reader does not know what to type.

**One point where Opus was wrong about today's behaviour:** it advised that Thread "keep Tweets'
own empty state and consent, not inherit Summary's auto-run", reading the catalog's *"a thread exists
only where somebody asked for one"*. Tweets has no consent step today: it writes on arrival. Decision
6 above makes it write on a press, which is the stricter of the two.

All of this goes to Greg as questions in the debrief; none of it is built here.

## How the other two parts connect

- **Command bar in natural language** (`fb-command-bar-nl`): the fewer buttons the bar shows, the
  more the command bar has to be the way to reach the rest, so the sub-mode rows (Brief, Fuller,
  Thread) and their aliases are what that session's matcher will rank. Nothing here changes its
  inputs beyond one mode word becoming a sub-mode row.
- **Debate steering** (`fb-debate-2610`): independent of this stage.

## Ledger

- 2026-10-03 — plan written. `git log` on the area: nobody has started this; `fb-fewer-modes` is
  this session's queue entry (`qi-h99jjy25`).
- 2026-10-03 — Opus product opinion (read-only subagent): build Brief | Fuller | Thread; keep Simple
  generated during the trial; not Marginalia as an umbrella. Folded into § The wider question.
- 2026-10-03 — GPT Sol plan review,
  [261003l-fewer-modes-plan-review-sol.md](261003l-fewer-modes-plan-review-sol.md): *build with
  changes*. F1 (P0, reasoned: stale press context) → decision 6's last paragraph. F2 (P1: the queue
  would also lose `simple`) → decision 7. F3 (P1: aliases on Summary open Brief) → decision 8.
  F4 (P1: a boot-only rewrite) → decision 8. F5 (P1: re-run commands) → decision 8. F6 (P1: the
  closing press) → decision 6. F7 (P2: keeping arrival is smaller) → **accepted, and it reversed
  decision 6**. Its two closing notes (FeaturesPage; a presence-sensitive sharing entry) → decision
  8. Its note that the hidden Simple level can still fail the all-or-none store is true today as
  well and is part of the question to Greg about dropping it. All seven checked against the code
  before accepting.
