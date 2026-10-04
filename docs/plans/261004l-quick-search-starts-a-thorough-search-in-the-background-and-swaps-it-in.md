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

So a settled quick search goes from **about $0.0006 to about $0.06: roughly a hundred times
more**, six cents a question. The limits of that number: 25 and 16 calls is a small sample; `search`
counts every meaning search, chat's tool included; a long article's quick search is several calls;
and a typed question is three to six quick calls but still one thorough one. Local dev, on shorter
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

**[Q-orphan] If you change the words while a thorough search is out, its answer is thrown away
when it lands.** Built that way because you asked earlier that obsolete rows not pile up. The other
choice is to keep it as an unticked saved row, since it was paid for. Recommended: as built.

## Log

- 2026-10-04: plan written; cost measured from `ai_calls`.
- 2026-10-04: GPT Sol's plan review ([prompt](261004l-auto-thorough-plan-review-prompt.md),
  [answer](261004l-auto-thorough-plan-review-sol.md)): **build with the changes named**, nine P1
  and one P2. Taken: F1 (Enter's own signal), F2 (never swap or launch over an unasked edit), F3
  (keep the place), F4 (colour at swap), F5 (a discarded pair waits for its request), F6 (hidden
  rows still count as running), F7 (quiet failure), F10 (the cost table's limits). F9 answered by
  dropping the reuse shortcut. **F8 overruled in part**: no server-side check; the swap requires
  the quick row `done` in this tab, and the trim paragraph was corrected.
