# Quick search starts a thorough search in the background, and swaps it in

Up: [plans.md](../project/plans.md)

> The quick searches seem much worse than the thorough searches, so I wonder if the
> best-of-all-worlds approach is to run a quick search immediately, and and also kick off a thorough
> search in the background that will finish a few seconds later.
>
> — Greg, 2026-10-04

Follows [261003i](261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md)
(the *thorough* button replaces a quick row) and
[261004k](261004k-quick-search-lower-floors-so-more-shows-up.md), where Greg said this.
Background: [search.md § Quick search](../project/search.md#quick-search-a-meaning-search-in-about-a-second).

## What a reader gets

A quick search shows its paragraphs in about a second, as now. Once the words have settled, the
thorough (meaning) search for the same words starts by itself. The quick row says so quietly. When
the thorough answer is complete it takes the quick row's place: same colour, same tick, same place
in the list, no press and no reload. If it fails, the quick row simply stays.

```
 t=0     type "arguments against"           (nothing yet)
 t=0.6s  pause  → quick asks
 t=1.1s  quick row: 6 passages  ⚡ quick
 t=3.1s  still the same words → thorough starts, unseen
         quick row: 6 passages  ⚡ quick  ⟳ thorough…     ← the quiet sign
 t≈12s   thorough is done → the row becomes the thorough one:
         quotes outlined in the prose, a reason on each result
```

## What it costs (measured)

From `ai_calls` in production, the 30 days to 2026-10-04, successful calls, one row per provider
call (`purpose`; mean and median of `coalesce(credits_used_nanos, computed_cost_nanos)`):

| purpose | calls | mean | median | 90th centile | time (median) |
|---|---|---|---|---|---|
| `search-quick` | 16 | $0.0006 | $0.0006 | $0.0008 | 0.4 s |
| `search` (meaning) | 25 | $0.059 | $0.060 | $0.113 | 9.1 s |

So each thorough search this starts adds **about six cents** (mean, per provider call) to a quick
search that cost about $0.0006 a call: roughly a hundred times more per call. That is not a
per-question ratio. The limits: 25 and 16 calls is a small sample; `search` counts every meaning
search, chat's tool included; a long article's quick search is several calls; a typed question is
three to six quick calls; and **each settled answer starts its own thorough search**, so somebody
who pauses for more than two seconds between words pays for one per pause (usually one, sometimes
two or three). Local dev, on shorter
fixture articles: thorough mean $0.026 over 75 calls. Greg asked for this; the number is here for
him to see, and it decides the design question below.

## The one real decision: when the thorough search starts

Quick search asks at every 600 ms pause while typing, three to six times for a typed question. A
thorough search cannot be cancelled once begun (it runs to the end even if the tab closes) and is
never revised. Starting one at every pause would cost $0.20–0.35 a question and leave paid answers
to half-typed words.

**So: one thorough search per settled quick answer.** A quick row this tab's typing made is
*upgraded* when:

- its quick answer has **landed** (`done`; a failed quick search is not upgraded, it has its own
  retry), and
- **Enter or *find* was pressed on those words: at once.** Otherwise, **the row has stayed `done`
  with the same words for `SETTLE_MS` (2 s)**, and
- **the box does not hold an edit that has not been asked yet** (the typing session owns the row
  and the box's words differ from the row's). If it does, look again in another `SETTLE_MS`.
- No thorough search for the same words is already out from this tab (`isRunning`), and this row
  has not already been tried with these words (a failure is not retried by itself).

An old finished thorough row for the same words is **not** reused: it asks again. Reuse needs to
know the saved answer is current, which the opening GET cannot say (useSearch.ts § fingerprint);
passed over for v1 at the price of a second six cents and a duplicate row when the same words are
typed on another day.

## How, in the browser only

No server change, no migration.

A new file, `src/web/modes/search/auto-thorough.ts`:

- **A pure function**, `settleThorough`, over pairs `{ meaningId, quickId, words, discard }`. For
  each pair: `wait` while the thorough row is `pending` (**always**, even when discarded, so its
  request keeps the duplicate guard until it finishes: review F5); `swap` when it is `done`, not
  discarded, and the quick row is still there, `done`, with the same words, and the box holds no
  unasked edit for it; otherwise `drop` (remove the thorough row, leave the quick row alone).
- **A hook**, `useAutoThorough`, which owns the watch list, the timers and the pairs.

In `SearchBand`:

- The typing session's `start` reports the row id it minted (the watch list), and a wrapper round
  `typing.flush` records the words Enter or *find* submitted, **whether or not the session then
  asks anything** (review F1: Enter after a pause with unchanged words emits no ask).
- `useTypingSession` gains `owns(id)`, so the hook can tell an unasked edit (review F2).
- **Launch** is `ask(words, "meaning", …)` with a new *quiet* option: not ticked, and its transport
  failure neither sets nor clears the panel's shared error line (review F7).
- **The pending thorough row is hidden** from the `runs` given to `useSearchMode`: no second row,
  no half-arrived hits drawn, colours and counts over visible rows only. The hidden rows are passed
  to the panel separately so its "already running" keys still include them (review F6: *find* on
  the meaning matcher for the same words stays disabled, not silently refused).
- **Swap**: recolour the thorough row to the slot the quick row is drawn in *now* (review F4: not
  the slot at launch); replace the quick id by the thorough id in `?runs=` where it was (an
  unticked quick row gives an unticked thorough row); remember the quick row's `createdAt` for the
  thorough id in a tab-local map applied to the visible rows, so it keeps its place in the list,
  which is sorted by `createdAt` (review F3; after a reload it sorts by its own time);
  `typing.rowGone(quickId)`; `remove(quickId)`.
- **A quick row that changes words, goes pending or is deleted** marks its pairs `discard`.
- A `begin` that renames the thorough row (`onRenamed`) is followed in the pairs.
- Leaving Search mode or the article clears the timers and forgets the pairs.

In `SearchPanel`: the set of quick row ids being upgraded. On such a row the *thorough* button is
replaced by a small spinner and the word *thorough…*, with a title saying a thorough search is
running and will replace this row. Nothing else moves.

**The reader's place.** Nothing calls `onJump`, so the article does not scroll; search marks never
change the line box (search.md § An outline). The results list changes under the reader, since a
thorough answer is a different set of passages. A result that was pressed open closes, as it does
on any change of list.

## The simpler options passed over

- **Start thorough at every quick ask.** Costs three to six times as much and leaves answers to
  half-words.
- **Delete the quick row when thorough starts** (what the *thorough* button does). No hidden row,
  no pairs. But the quick results would vanish for ten seconds, which is the opposite of the ask.
- **Show the pending thorough row as an ordinary second row.** Simpler, but two rows for one
  question, appearing and vanishing at every settled pause.

## What the earlier review said replace-on-success needs, and why this does not

261003i's plan review said a *server-side* replace needs trim protection, a status check at delete
time and a stored link between the two rows. Those were for a promise that held across tabs,
reloads and retries. This promise is smaller: **the swap happens only in the tab that asked, while
Search mode stays open.** What that gives up:

- **Leave Search mode, reload or close the tab mid-search**: the thorough search still finishes on
  the server, and usually both rows are in the list afterwards, the thorough one unticked. That is
  what *flesh out* did until 2026-10-03. Untidy, not wrong.
- **The 30-row trim** drops the oldest *finished* rows past 30 when any search starts, by
  `createdAt`, and a revised quick row keeps its first `createdAt`. So with 30 saved searches a
  quick row could be trimmed on the server while this tab still shows it; the swap's delete then
  names a row already gone, which is harmless.
- **Another tab** (this plan's review, F8): the swap deletes the quick row without the server
  checking it is still the answer this tab saw. The swap requires the row to be `done` here, and
  another tab cannot reset a `done` quick row (a retry resets only a failed one, and a revision
  comes only from the tab whose typing made the row). **Sol's F8 is overruled to that extent**:
  the atomic server-side check is the machinery this version exists to avoid.
- **Thorough fails**: its row is removed and nothing is said. The quick row has its *thorough*
  button back, which is the manual retry.

## Where else quick search runs

- **The box in the bottom bar** (`DockQuickSearch`): it drives the band's own typing session, so it
  gets this with no change.
- **The command bar's *find***: opens `?match=words`, not quick. Unchanged. (The `bar-quick-search`
  session is working there; this plan touches none of `CommandBar.tsx`, `command-*.ts`.)
- **Chat's search tools**: call the meaning search directly. Unchanged.
- **A visitor**: cannot ask. Unchanged.

## Stages

One stage.

1. Red first: `tests/auto-thorough.test.ts` for `settleThorough` (wait; swap; drop on failure;
   drop when the quick row is gone, pending, failed or has other words; a discarded pending pair
   still waits; no swap over an unasked edit), and `tests/search-auto-thorough.test.tsx` for the
   band: Enter starts thorough once quick lands; pause then Enter with unchanged words starts it
   (F1); a pause alone starts it only after the settle; an edit just before the deadline or just
   before completion is not lost (F2); the pending row is not listed and its hits are not drawn;
   done swaps, keeping tick, place among other rows (F3) and the colour as recoloured meanwhile
   (F4); A → B → A asks A's thorough once (F5); *find* on meaning is disabled for the hidden
   words (F6); an HTTP failure, a dropped stream and a model failure each leave the quick row and
   no error line (F7); a failed quick search starts nothing.
2. Build it.
3. `docs/project/search.md`: § Quick search and § Thorough replaces the quick row; the cost row
   in § The one decision; `/help` (`src/web/help/help-modes.tsx`).
4. Gates: the test files, `npm test`, `npm run typecheck`, lint on touched files.
5. GPT Sol code review, write-capable.
6. Browser check by a Sonnet subagent at desktop, iPad and phone widths.

## Questions for Greg

**[Q-settle] How long should the words sit still before the thorough search starts?** Built: 2 s
after the quick answer lands, at once on Enter. Shorter feels more immediate and pays more often
for words you were still typing ($0.06 each time). Recommended: leave it, and change the one
constant if it feels slow.

**Decided: 2 s, as built** — Greg, 2026-10-05:

> ok let's go with 2s and see how it feels

**[Q-orphan] If you change the words while a thorough search is out, its answer is thrown away
when it lands.** Built that way because you asked earlier that obsolete rows not pile up. The other
choice is to keep it as an unticked saved row, since it was paid for. Recommended: as built.

**Decided: thrown away, as built** — Greg, 2026-10-05:

> yes throw it away, as built

**[Q-reload] A reload or leaving Search mode mid-search leaves both rows.** Greg, 2026-10-05:

> I do find having a quick and a thorough next to each other slightly annoying, but I can live with it if it gets tidied up after leaving Search mode

So the pair is to be tidied once you have left Search mode; dispatched to session `search-pair-tidy`.

## Follow-up: a pair left behind is tidied when the list is next loaded

For Q-reload above. In the browser only: no server change, no migration.

**The first design, and why it was dropped.** Read the pair off the loaded rows alone: a finished
thorough row with the same words as an earlier finished quick row replaces it. GPT Sol's design
review ([prompt](261004l-pair-tidy-design-review-prompt.md),
[answer](261004l-pair-tidy-design-review-sol.md)) said do not build it, and two findings stand:

- **T2.** A reader who asks quick and thorough for the same words by hand, then unticks the
  thorough one because they prefer the quick answer, leaves exactly the rows an abandoned pair
  leaves. The rule would delete the row they chose.
- **T1.** Quick A, thorough A starts, the words change to B and back to A, then the reader leaves.
  The tab that asked had marked that thorough answer to be thrown away; the rule would swap it in.

The saved rows do not say which thorough row the app started for which quick row. Only the tab
that launched it knows.

**So the pair is written down.** When a thorough search is started by itself, the browser records
`{ slug, quickId, meaningId, words }` in `localStorage` (`src/web/modes/search/stored-pairs.ts`).
The record is removed when the pair is settled in that tab (swapped, dropped) and the moment its
answer is marked to be thrown away (the quick row changed words, went back to searching, or was
deleted). Revisions, retries and deletions revoke it at the call, before an effect or departure;
a tick or press on the thorough row revokes it too, even if the reader unticks it afterwards, and
so does *select all*, which ticks it. A gesture on the quick row keeps the record: its tick is what
the thorough row inherits. A row that `begin` answers under another id has its record removed
rather than rewritten under the new id, so that rare pair is not tidied after a reload.
Leaving Search mode, reloading or closing the tab removes nothing, so what is still
written is exactly the pairs left behind.

**One storage key per pair**, named by the thorough row's id. The first build kept one list under
one key, and the code review found the hole in that (R1): two tabs each read the list, change it and
write it back, so a tab can write back an older list and revive a record the reader cancelled, and
a later load then deletes a quick row they kept. The reviewer's fix was a Web Lock round every read
and write, which made the whole module asynchronous and needed a fallback for browsers without
locks and a "distrust storage" mode for a failed write. With a key each there is no list to write
back: forgetting is one `removeItem`, and nothing another tab writes can undo it. Not covered: a
`removeItem` that throws, in a storage that can still be read later.

**When it is tidied.** Once, when Search mode opens and the saved list arrives. Each record for
this article is checked against the loaded rows by a pure function, `tidyPair` in
`auto-thorough.ts`:

- **swap** when both rows are there, of the kinds recorded, **finished**, and both still hold the
  recorded words, and the thorough row is **not ticked**. A thorough search started by itself is
  never ticked, so a tick is the reader's: they have seen both and chosen, and both stay.
- **keep the record** when either row is still running. Nothing is touched; the next load looks
  again.
- **forget the record, leave both rows** for anything else: a row gone, a row failed, the quick
  row's words changed.

A swap is exactly the in-tab one, through the same `wiring.swap`: the thorough row takes the colour
the quick row is drawn in, takes its place in `?runs=` (ticked if it was, unticked if not), is
listed at the quick row's time, and the quick row is deleted.

**What this does not do.**

- A pair with no record is never touched: one left behind before this shipped, one launched in
  another browser or device, or one whose storage was cleared. Both rows stay, as before.
- Come back to Search within the few seconds the thorough search is still running, and both rows
  show, the thorough one as still searching, until the list is next loaded. A row loaded as
  running gets no later news in that tab; that is older than this work.
- Offline (`navigator.onLine` false), or when the opening response carries
  `x-spideryarn-offline: copy`, nothing is tidied and the record is kept (Sol's T4).
  The latter matters when the browser believes it is online but the server could not be reached.
- A failed thorough row left behind stays in the list. In the tab that asked it would have been
  removed unseen.

**The cross-tab case (review F8, and T3 of this one).** Still no server-side check. `localStorage`
is shared between tabs, so a second tab opening Search on the same article reads the first tab's
record. While the thorough search runs, it keeps it and does nothing. The window is the moment the
answer lands: the first tab settles the pair within milliseconds, and a second tab whose list
loaded in that moment may act too. If both swap, the result is the same swap done twice, which is
harmless. If the first tab is throwing the answer away (an unasked edit in its box) or revising the
quick row just then, the second tab can delete a quick row that has just changed, or both rows can
be lost. That needs one reader with the same article's Search open in two tabs, one loading in the
instant the other's thorough answer lands with an edit in hand. What is lost costs a second, or six
cents, to ask again. **Accepted, as F8 was.** Sol's fix is a DELETE that carries what the browser
expects the row to be and is refused if it is not; it closes the changed-row half and not the
both-lost half, and is the server-side check this plan set out to avoid.

**Options passed over.** Have the server's GET delete the quick row: it cannot keep the tick (only
the URL knows it) or the colour (an automatic colour is worked out in the browser). Store the link
on the row: a migration, and the server still cannot do the swap. Poll a row loaded as running so
the pair is tidied without a second load: a timer and a second read for a case that fixes itself.


## Log

- 2026-10-04: plan written; cost measured from `ai_calls`.
- 2026-10-04: GPT Sol's plan review ([prompt](261004l-auto-thorough-plan-review-prompt.md),
  [answer](261004l-auto-thorough-plan-review-sol.md)): **build with the changes named**, nine P1
  and one P2. Taken: F1 (Enter's own signal), F2 (never swap or launch over an unasked edit), F3
  (keep the place), F4 (colour at swap), F5 (a discarded pair waits for its request), F6 (hidden
  rows still count as running), F7 (quiet failure), F10 (the cost table's limits). F9 answered by
  dropping the reuse shortcut. **F8 overruled in part**: no server-side check; the swap requires
  the quick row `done` in this tab, and the trim paragraph was corrected.
- 2026-10-04: built by an Opus subagent, red first (21 of 21 band cases failed before the wiring),
  five mutations each caught; commit `b896b0668`. Two things it built that the plan did not spell
  out: `remove` also takes *quiet* (the clean-up DELETE of a hidden row must not raise an error
  line), and a refusal because the same words are already running is final for that row and words.
  A → B → A in one session throws A's first answer away and leaves the row quick, as Q-orphan says.
- 2026-10-04: GPT Sol's code review ([prompt](261004l-auto-thorough-code-review-prompt.md),
  [answer](261004l-auto-thorough-code-review-sol.md)) of `b896b0668`: **land after the fixes I
  made.** C1 (P1, fixed red first): Enter was remembered by words for the whole mount, so a later
  row with the same words skipped the settle; it is now remembered per row. C2 (P2): the cost
  sentence mixed per-call and per-search; corrected here and in search.md. C3 (P3): the help
  sentence. C4 (P2, left): the F2 deadline test has a 100 ms real-timer margin and could flake on
  a loaded box.
- 2026-10-04: full `npm test` on `6dd0f645b`: 1575 files passed, 5 failed, all five the
  fresh-worktree "no build" files (`api-dist/` and the fleet client), none of them this work.
- 2026-10-04: browser check by a Sonnet subagent (Playwright, the local dev server, real model
  calls), twice. At 1440, 1024, 820 and 390 wide: quick shows, the sign appears about 2 s after
  the quick answer (at once after Enter), the swap lands 4 to 12 s later with `scrollY` unchanged
  and no reload, one row throughout, same colour and tick. From the bottom bar's box: the same.
  Editing the words with the sign showing, focus kept in the box: one row throughout, the first
  thorough answer thrown away, the longer words swapped in 8 s later. **One fault found and
  fixed**: the sign read "thorough…" beside its spinner and was 22px wider than the button, so
  at 390 the row grew 47px to 64px while it showed
  ([before](261004l-shot-upgrading-390.png)). It is now the spinner alone, in a box the button's
  size ([after](261004l-shot-sign-390.png)): row height identical at 390 and 1024. The recheck
  measured the box 2px taller than the button; `line-height: normal` was added for that and has
  **not** been looked at in a browser since. Also seen, and as the plan says: a reload while the
  sign was showing left both rows in the list.
- 2026-10-04: thorough took 4 to 12 s in these runs, and 9 s median in production. The reader-facing
  words "about half a minute" (the button's title, /help) and search.md's "15–40 seconds" are
  older and now look long; not changed here.
- 2026-10-05: **the follow-up for Q-reload, built** (§ Follow-up). In order:
  - GPT Sol's design review ([prompt](261004l-pair-tidy-design-review-prompt.md),
    [answer](261004l-pair-tidy-design-review-sol.md)) of the first design, pairing by the loaded
    rows alone: **do not build.** T1 and T2 taken, which is why the pair is written down. T3
    (cross-tab) accepted and described. T4 taken as "nothing offline, nothing from a saved copy".
  - Built red first; nine deliberate breakages of the rule each turned a test red.
  - Sol's code review, write-capable ([prompt](261004l-pair-tidy-code-review-prompt.md),
    [answer](261004l-pair-tidy-code-review-sol.md)): **do not land**, with its own checks never
    run (it timed out on a shared lock during a box overload; its first run was killed for memory
    and left only tests). R2 (revoke at the gesture) and R3 (the saved-copy header) kept as it
    wrote them. R1 was real, and its fix, a Web Lock round an asynchronous store with a fallback
    and a distrust mode, was **replaced by one storage key per pair**. Its `loaded`-per-slug change
    to `useSearch` was reverted; the tidy effect leaves `slug` out of its dependencies instead. Its
    postmortem for the locking fix was deleted with the fix. R4 accepted. Two of its test cases
    were not taken: pressing the quick row does not cancel the tidy.
  - Sol's second pass, read-only ([prompt](261004l-pair-tidy-code-review-2-prompt.md),
    [answer](261004l-pair-tidy-code-review-2-sol.md)): **land with two changes**, both made. S1: a
    renamed row's record is removed, not rewritten. S2: *select all* cancels the tidy.
  - Gates: `tests/auto-thorough.test.ts` and `tests/search-auto-thorough.test.tsx` 89 of 89,
    `tests/use-search.test.ts` and `tests/doc-links.test.ts` green, `npm run typecheck` clean.
    One run had the F2 deadline case red at load 74; it passed alone (C4 above).
    **The full `npm test` was not run**: the Overseer asked for targeted files only while the box
    was overloaded. The breakage checks were not repeated on the one-key-per-pair storage.
  - Browser check by a Sonnet subagent (Playwright, 1440 wide, real model calls). Reload with the
    spinner showing: two rows ([before](261004l-shot-pair-tidy-A-before.png)), and after the
    thorough search finished and one more reload, one thorough row, ticked, the quick row's colour,
    `?runs=` naming it, no record left, no error line
    ([after](261004l-shot-pair-tidy-A-after.png)). Leave for Glossary for 30 s and come back: one
    row, the same way ([shot](261004l-shot-pair-tidy-B-after.png)). The ordinary in-tab swap
    leaves no record. Not looked at: the marks in the prose after the tidy, and an unticked quick
    row (both are in the band tests).
- 2026-10-06: the flaky case "leave Search mode mid-search, come back after it finished: one row"
  (the Overseer, 2026-10-05: 2 red in 4) was the test harness, not the tidy. The case before it
  ends while nuqs is still holding a `?runs=` write, in a queue that belongs to the page and that
  unmounting does not cancel; about 20 ms into the next case it landed on the fresh URL, so that
  case opened with the last case's row ticked and failed at its *first* `?runs=` check, before it
  had left Search mode or tidied anything. The app is not open to it: `src/web/main.tsx` calls
  `enableHistorySync()`, which makes nuqs drop a held write when anything else writes `history`,
  and this test file did not. It does now, with a guard case ("the harness") that is red without
  it, 10 of 10. The failing sequence, 30 runs: 17 red before, 0 after; the whole file 4 of 4.
  GPT Sol's review agreed it is not a product race and found the first guard passed falsely when
  the unmount was awaited; the guard now unmounts without a yield. **Not done:**
  `tests/search-as-you-type.test.tsx` and 29 other test files mount the same adapter without the
  call. None is known to flake.
