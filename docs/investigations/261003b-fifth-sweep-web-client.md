# The web client: fifth sweep investigation

This is the depth stage of the fifth codebase sweep for `src/web/`, the React client. It asks three
questions:

- which mode-panel patterns are copy-paste siblings that have drifted;
- which decisions live inside components with no seam a test can reach;
- whether the wiring a new mode needs is getting better or worse.

It also checks one specific lead, the repeated heading in the spine's hover card. Its parent is
[261003f-fifth-codebase-sweep-umbrella.md](../plans/261003f-fifth-codebase-sweep-umbrella.md). Nothing here
has been built. Each finding names its cheapest fix and the files that fix touches, so that the
clusters in § 8 can be handed to separate agents.

Tree: `dev` @ `59bd41171`, 2026-10-03. Read-only. The only writes were scratch scripts outside the
repo and this file.

## 1. Scope, and what the method is blind to

**Read properly:**

- `Spine.tsx` (BandCard and `measure`) and `where.ts`
- the six threshold-slider copies
- `lib/sse.ts` and every hand-rolled `readEvents` loop
- the artefact read hooks (`useFaq`, `useIdeas` and siblings) and `useAutoRun`
- `Reader.tsx`'s passage slots and its layout predicates
- `Metadata.tsx`'s private helpers
- the clipboard writers
- `mode.md`, and its history as `new-mode.md`

**Delegated to two Opus readers, and spot-checked:**

- `live/useLiveConversation.ts`
- `annotate.ts`, `AnnotateDialog.tsx`, `Library.tsx` and `library-hits.ts`. There is no
  `src/web/ActionButtons.tsx`; see W13's scope note.

**Skimmed for structure only:** `Dock.tsx` (4,206 lines, 17 components; its pure helpers are already
exported and tested).

**Skipped:** `DiagramPanel`, `ChatPanel` and `chat/`, `useDictation`, `ProseHoverCard`, `TableView`,
`router.ts` and `params.ts`, and the CSS beyond the slider families.

**Measured:**

- 418 files and 176,199 lines under `src/web`.
- Churn × fixes since 2026-09-08. The command is
  `git log --since=2026-09-08 --no-merges --name-only --format="@@%s" -- src/web`, counting a
  commit as a fix when its subject matches fix, bug, broke, regress or wrong.

| File | Commits | Fix commits |
|---|---:|---:|
| `Reader.tsx` | 86 | 15 |
| `Metadata.tsx` | 52 | 9 |
| `Dock.tsx` | 51 | 8 |
| `CitationsPanel.tsx` | 36 | 9 |
| `Library.tsx` | 36 | 6 |
| `params.ts` | 35 | 6 |
| `TrajectoryPanel.tsx` | 29 | 9 |

- One read against the **local** database: 66 articles, read-only, inside `BEGIN READ ONLY`.
  Production was not read.

**Blind to:**

- Behaviour in a real browser. No browser was driven.
- Anything a test run would show. No `npm test` was run.
- Panels not read end to end. The drift found is a lower bound.

## 2. Findings

Tiers: T0 is a live defect, T1 is cheap and mechanical, T2 is an extraction that needs a test first,
and T3 is a rearchitecture, named and sized only.

### W1 — The spine card's first bullet repeats a heading the outline already shows

T0 (cosmetic) · effort S · value medium · risk low. This is the lead the sweep was asked to check.

**What the reader sees.** Hover a part's first section on the spine. The card shows:

- the part's row;
- the section's row;
- the section's gist;
- a first bullet that is the part's heading again.

On any other section, the first bullet is that section's own heading, one line under its own row.

**Why.** The sub-section list is `BandCard`'s `kids`, in `src/web/Spine.tsx`, built from
`band.entry.children`. A hit's children are depth-3 *leaves*, one per block (`buildOutline` in
`tree.ts`, `depthLimit` 2 counted from depth 1). It works like this:

1. A heading block is a leaf like any other.
2. Its `navLabel` is the author's heading, copied verbatim (`navLabelVoice` in `tree.ts`, citing
   `labels.ts` § `parseLabels`).
3. `childLabel` returns that `navLabel` as the bullet's text.
4. A part has no leaf of its own, because its children partition its range. So the part's heading
   block lands inside its **first section**, as that section's first leaf.
5. The where-outline (`whereForBand`, plan 261003d) now draws the part and the section as rows
   directly above, so the repeat sits two lines below the row it copies.

This predates `bffc03c7a`: the old crumb line (*PART · 1 of 3*) and title line repeated the same
way. The new outline makes the repeat easier to see.

**Counted against local data.** The command was a scratch script reading
`spideryarn.article_revisions.tree` and `revision_blocks`, latest revision per article.

| Count | Value |
|---|---:|
| Articles | 66 |
| Hit sections (depth 2 under a part) | 1,321 |
| …whose first leaf is a heading block | 531 |
| …whose first leaf's text equals the part's title exactly | 120 (of 244 first-sections) |
| …whose first leaf's text equals the section's own title | 199 |
| Exact repeats in all | about 319, so about **24% of cards lead with a repeat** |
| First-leaf headings that match no row (a model-retitled section, or an article-title h1) | 213 |
| Heading leaves later in a section | 257 |

The heading leaves later in a section are sometimes the section's own heading, after the part's,
and sometimes a real sub-heading such as `Cellular Automatons` (h5).

Evidence: proved from the code, and reproduced on local data.

**Minimal fix.** Drop a bullet whose text is already a row on the card. Filter before counting, so
`+ n more` stays honest:

```tsx
const shown = new Set(where.flatMap((r) => (r.kind === "node" ? [r.title] : [])));
const kids = children
  .map((c) => ({ id: c.node.id, ...childLabel(c) }))
  .filter((c) => c.label !== "" && !shown.has(c.label));
```

In the fallback branch (`where` is empty), add `bandLabel(band).text` to `shown`.

**The test that goes red first.** Add it to `tests/spine-card.test.tsx`. Its fixture is the reason
nothing caught this: every `leaf()` is a paragraph, and no heading leaf exists. Mount a one-part
outline whose first section's children are, in order:

- `leaf("h0", "What feeling is for")`, the part's heading;
- `leaf("h1", "The body as a model")`, the section's own;
- `leaf("k1", "the retina sends less than it receives")`.

Then assert:

```ts
expect(kidText(openCard(0))).toEqual(["the retina sends less than it receives"]);
```

Today that returns all three bullets.

**Rejected alternatives:**

- **Filter on `startsAtHeading`.** It would also drop the 257 real sub-headings later in sections,
  which are among the most useful bullets.
- **Drop the leading run of heading leaves.** This is structural, but it also hides 213 author
  headings that match no row, for example *"3. Philosophical tensions"* under the model's *"Two
  philosophical tensions"*. Whether those should go is a product call for Greg, not part of this
  fix.

**Files:** `src/web/Spine.tsx` and `tests/spine-card.test.tsx`.

### W2 — A failed read is a dead end in seven bands; FAQ's fix reached four hooks

T0 · effort S–M · value medium · risk low.

**The fix that went to FAQ.** GPT Sol's D1 on the FAQ found that *"a transient GET failure leaves the
reader with no in-product way to recover"* on a direct `?mode=` arrival
(`docs/plans/260916d-faq-mode-code-review-2-findings.md`). The reason is that `useAutoRun` retries
the read only while a Dock press is armed. The fix, in `418a3d57f`, was a read-only `retryRead` and a
*Try again* button.

**Where it reached.** `git grep -ln retryRead -- src/web` finds it in:

- the hooks `useFaq`, `useSimple`, `useSkim` and `useTweets`;
- their panels.

**Where it did not.** `useAutoRun.ts`'s own header still says *"Ideas, Quotes and Timeline draw no
button at all in their error state"*. Each of these panels draws a bare `<p>` with no control:

| Panel | Line, located by content |
|---|---|
| Ideas | `IdeasPanel.tsx:245` |
| Timeline | `TimelinePanel.tsx:433` |
| Quotes | `QuotesPanel.tsx:867` |
| Debate | `DebatePanel.tsx:1146` |
| Glossary | `GlossaryPanel.tsx:440` |
| Citations | `CitationsPanel.tsx:763` |
| Quiz | `QuizPanel.tsx:899` |

The grep was `grep -nE "owner\??\.error &&"` over each panel.

Evidence: the call path is proved from the code. The opening GET fails, `status` becomes `"error"`,
there is no armed press, and the band shows the sentence and nothing else. It was not reproduced in
a browser.

**Fix.** Two parts:

1. Add a `retryRead` to each hook. It is the four-line `useFaq` version, and it keeps a loaded list
   while it retries.
2. Add one small `ReadError({ error, onRetry })` component. FAQ's markup moves into it, and all
   eleven panels use it.

**The test that goes red first.** A table-driven test that mounts each artefact panel with a failing
GET and asks for a button named *Try again*. Seven rows go red today. Extend
`tests/artefact-read-hooks.test.tsx`, or add a new file.

This is not the broad `useArtefactRead`. GPT Sol put that on "do not do" in
`260828aj-…-review-sol.md:197`, and this keeps error presentation per domain, as that review asked.

**Files:**

- the seven hooks and seven panels in the table;
- a new `src/web/ReadError.tsx`;
- `FaqPanel.tsx`;
- one test.

### W3 — The threshold slider: six copies of one row, and two track shapes

T1 for two of the copies, T2 for the rest. The open item is DOC #1.

`git grep -n 'type="range"' -- src/web` finds the shared `ThresholdSlider.tsx:85`, plus copies in:

| Copy | Line | How it differs from `ThresholdSlider` |
|---|---|---|
| Citations | `CitationsPanel.tsx:957` | None in its markup: same `gloss-gate-*` classes, same props. Only the id, the title and the noun differ |
| Glossary | `GlossaryPanel.tsx:1193` | None in its markup. The shared component's header says its four decisions are this one's |
| Search | `SearchPanel.tsx:1490` | A fixed `max={100}` and an integer `CONF_STEP`, deliberately (*"a moving `max` on a live range input is a real bug"*, Sol, 2026-08-26). The `srch-gate-*` CSS family is byte-identical to `gloss-gate-*` |
| Quotes | `QuotesPanel.tsx:1135` | The track is an **index into `stops`**, the scores the list actually contains, so *"every drag changes the list"* (`1b3f4258b`, 2026-09-03). Uses the `quotes-bar-*` family and the label "bar" |
| Debate | `DebatePanel.tsx:1391` | The same index-into-`stops` track, over named levels rather than numbers. Uses the `dbt-bar-*` family |

(`SummaryMode.tsx:322` is a level picker, not a threshold.)

**Drift is proved.**

- Quotes' index track solves a problem the score-track copies still have: dead travel between
  sparse scores. It reached Quotes and Debate only.
- Search's fixed-max reasoning is written only beside Search.

The four CSS families are still in step. Their `:focus-visible` rules are identical; the selector
list was compared per family.

**Fix, in two steps.**

1. **T1, effort S.** Point Glossary's `GateSlider` and Citations' `BarSlider` at `ThresholdSlider`.
   Each loses about 40 lines of markup, keeping its own `visibleX`/`note` pass. Browser-check both
   bands, as the component's header asks.
2. **T2, effort M.** Give `ThresholdSlider` a
   `track: { kind: "score"; max; step } | { kind: "stops"; stops }` and a `format(value)`, then move
   Search, Quotes and Debate onto it. This deletes three CSS families, about 35 rules.

**The warning for step 2.** Postmortem
`261003a-consolidating-duplicate-controls-keeps-the-survivors-omissions.md` applies: the survivor
must carry the stops track, Search's fixed max and Debate's word labels.

**A test first.** A small matrix in a new `tests/threshold-slider.test.tsx`, covering both tracks and
the reset, `aria-valuetext` and note in each.

**Files.** Step 1: `GlossaryPanel.tsx`, `CitationsPanel.tsx` and `ThresholdSlider.tsx` (comment
only). Step 2 adds `SearchPanel.tsx`, `QuotesPanel.tsx`, `DebatePanel.tsx`, `glossary.css`,
`quotes.css` and `debate.css`.

### W4 — Two private copies of `readAnswerStream`'s contract

T2 · effort S · value low. The open item is DOC #6, re-verified.

`readAnswerStream` (`lib/sse.ts`) has two callers, `useGlossary` and `useCitations`. Eight files
loop over `readEvents` by hand (`git grep -n "readEvents(" -- src/web`, outside `sse.ts`). They split
into two groups.

**Six are a different protocol and should stay hand-written.** They stream items rather than one
answer:

- `useClaims` sends `claim` frames;
- `useCriteria` sends `result` frames;
- `useSearch`;
- `useComments`;
- `chat/effects`;
- `link-facts`.

`useClaims` and `useCriteria` each throw on a body that ends without `done`. Their errors arrive as
`done` with `status: "error"` (`referee-claims-run.ts:223`), so ignoring an `error` frame is not a
defect.

**Two are the answer contract re-typed.**

- `useQuiz.ts` § `readMark`. `sse.ts`'s own comment says it is "the same shape".
- `useMirror.ts` § `readRun`.

Both are correct today, and both read the error frame as `(event.data as {error?}).error` with no
null guard. `readAnswerStream` writes it `| null)?.`. A `data: null` frame would throw a TypeError
instead of the sentence. Evidence: hypothesis only, since no server sends one.

`readMark` carries the partial text on its error (`MarkStopped`), and `readAnswerStream` does not.
Migrating it would need the caller to hold the last `delta` text. It is not worth a stage on its
own; fold it in when either hook is next touched.

### W5 — "Does the band cover the prose?" is derived five times in `Reader.tsx`

T1 · effort S · value medium · risk low.

`grep -n "fit.modeW === 0" src/web/reader/Reader.tsx` finds:

- `showCrumbs` (`!(bandOpen && fit.modeW === 0)`);
- `bandOverProse` at 591;
- `bandCovers` at 637, which is the named one, declared *after* the two above that re-derive it;
- `covered` at 2659;
- bare `fit.modeW === 0` at 2503, 2504, 2523, 2524 and 2709.

The bare ones drop the `bandOpen` half. That is correct only because `modeW` is also 0 when no band
is open, which is the same braid `proseVisible` in `layout.ts` exists to name once (web-client.md §
The middle is a slot).

Evidence: proved from the code. No current divergence was found.

**Fix.** Hoist `bandCovers` above line 540 and use it at all nine sites. Better, add a pure
`bandCoverage(bandOpen, fit, bandAway)` to `layout.ts` returning `{ covers, away, overProse }`,
with a unit test next to the existing `proseVisible` tests.

**Files:** `Reader.tsx`, `layout.ts`, and the layout test.

### W6 — Six parallel `found`/`openKey` state pairs in `Reader.tsx`

T2 · effort M · value medium · risk medium.

`Reader.tsx` (around lines 1183–1262) holds one `useState` pair per passage-producing mode:

- `found`/`openHit` for Search;
- `ideaFound`/`openOccurrence` for Ideas;
- `timelineFound`/`openTimelineKey` for Timeline;
- `refereeFound`/`openRefereeKey` for Referee;
- `skimFound`/`openSkimKey` for Skim.

Each pair carries a comment that repeats why it is separate. That reason is real: an outgoing band's
passive clear lands after the incoming band's layout push, so two bands sharing one state wipe each
other. But the cure is *separate keys*, not *separate `useState`s*.

**Proposed fix.** One `usePassageSlots()` returning `{ slots, setSlot(slot, found, openKey) }`. It
would be a reducer keyed by `PassageSlot`, and each band writes only its own key with a functional
update. That keeps the isolation by construction.

A new passage mode would then add one key to a union the compiler checks against `selectPassages`,
instead of two `useState`s, a prop thread and another copy of the comment.

**A test first.** Extend `tests/a-mode-switch-does-not-wipe-the-next-modes-marks`, or its existing
equivalent (grep `ideaFound`), to switch search → ideas → timeline under the keyed store.

**Files:** `Reader.tsx` and `reader/passages.ts`.

### W7 — `Metadata.tsx` keeps private copies of two shared helpers

T1 · effort S · value low. The open item is DOC #2, re-verified.

- **`ago()` at `Metadata.tsx:3901`.** It has drifted from `relative-time.ts` § `relativeAgo`:
  - it does not clamp a future time, so it can say *"in 4 seconds"*, which `relativeAgo` exists to
    prevent;
  - it never switches to a date;
  - it uses the browser's locale.

  It has 3 callers (`grep -n "ago(" src/web/Metadata.tsx`).
- **`withPanel(search)` at `Metadata.tsx:3922`.** It is a single-purpose copy of `Dock.tsx:2544`'s
  `withPanel(search, panel)`.

**Fix.** Replace the first with `timeAgo` plus `useNow`, and export the Dock helper.

**Files:** `Metadata.tsx` and `Dock.tsx` (an export only).

### W8 — Eight clipboard writers, one of them silently doing nothing

T1 · effort S · value low.

`git grep -l "\.writeText(" -- src/web` finds 8 files and 13 sites. Five of them carry the same
statement-form guard and an explanatory comment, which says why the optional chain is wrong:
AnnotateDialog, BlockGutter, ChatPanel, ShelfEntry and AccessSharing.

`ViewportProbe.tsx:482` still writes `navigator.clipboard?.writeText(t).then(…)`. Where there is no
clipboard, the whole chain short-circuits and the probe says neither "copied" nor "refused". This is
the silent-success shape the other five comments describe. It is a debugging instrument, so the
value is low.

**Fix.** A `copyText(text): Promise<"copied" | "unavailable" | "refused">` in `src/web/lib/`, with
one unit test. The eight sites keep their own feedback. This also retires web-client.md's
*"No shared copy button"* admission.

### W9 — Fifty-one client tests sleep on real time for a hover delay

T1 · effort M · value medium · risk low.

`git grep -hoE "setTimeout\(r(esolve)?, *[0-9]+" -- 'tests/*.tsx'` gives:

| Length | Count |
|---|---:|
| 300 ms | 15 |
| 350–500 ms | 38 |
| 1–200 ms | 27 |
| 0 ms (ticks, which are fine) | 73 |

That is about **22 s of wall-clock sleep** per run. Most of it waits out `Tooltip`'s `DELAY`
(240 ms, not exported) or `HOVER_DELAY` (320 ms) with a magic 400.

The heaviest files:

| File | Sleeps |
|---|---:|
| `diagram-panel-hover` | 12 |
| `shelf-action-touch` | 10 |
| `skim-panel` | 9 |
| `illustrated-view` | 9 |

On a contended box, a 400 ms margin over a 240 ms timer is the flake shape the postgres-contention
memory describes. A real-time sleep is also a test whose margin nobody checked.

`spine-card` and `spine-hover` already show the house way: `vi.useFakeTimers()` plus
`advanceTimersByTime(AFTER_THE_OPEN_DELAY)`.

**Fix.**

1. Export `DELAY` from `Tooltip.tsx`.
2. Add one helper in `tests/helpers/`, `openTip(el)`, that advances fake timers.
3. Convert file by file.

The worst single case is outside the tooltip family: `tests/live-tail-handoff.test.tsx:391` polls
for up to 5 s through the real 2.5 s hang-up grace (W10).

### W10 — The live-conversation hook: decisions without a seam (delegated, spot-checked)

T2 · effort M · value medium.

`live/useLiveConversation.ts` (2,547 lines) has already moved much of its logic out into pure
siblings: `stall.ts`, `exchanges.ts`, `tool-responses.ts`, `meter.ts` and `mic-placement.ts`. Five
decisions remain inside effects and callbacks:

| Decision | Where | Proposed pure function | Value |
|---|---|---|---|
| a. Tap-to-talk error recovery: four branches mapping (event kind, mode) to (mode, mic, notice, owed) | lines around 1299–1344 | `tapErrorRecovery` | the highest |
| b. The tap state machine: `talk`, `doneTalking`, `enterTapToTalk`, and the `TAP_MIN_MS` clear-or-commit choice | lines around 2447–2508 | `tapStep` | |
| c. The caps tick | 2319–2338 | `capVerdict({ now, lastHeard, began, midSentence })` | |
| d. The hang-up grace loop | 1503–1540 | `graceVerdict` | it would let `live-tail-handoff` stop sleeping |
| e. The connection-state policy | 1912–1932 | | the smallest |

Today (c) is tested only through 4–10 minutes of fake time in `live-session-flow.test.tsx`.

Moving (a)–(c) is about 150 lines with no behaviour change, tested in a new
`tests/live-talk-mode.test.ts`.

**No live defect was found.** Three suspected paths were traced and each was guarded by the epoch
or `sameSession()`.

**Smells:**

- `doneTimer` (2501) is not cleared in `stop` or on unmount. A guard makes it a no-op; a one-line
  `clearTimeout` in `stop` would say the same thing more honestly.
- `setTimeout(stop, 0)` at 964 is untracked.
- The abort reason *"took too long"* is shared by a real timeout and a hang-up.

The one raw `fetch` (2214) is the SDP exchange with OpenAI, not our API, so it is legitimately not
`apiFetch`.

### W11 — A shelf passage link highlights nothing for an accented or ligature word

T0 · effort S · value medium · risk low. Found by the delegated reader and spot-checked here.

**The path.** `libraryHitHref` (`src/web/library-hits.ts`) chooses its `find` term with
`queryTerms(query).find((t) => fold(hit.text).includes(t))`. That sends the **folded** term:
`café` becomes `cafe`, `Gödel` becomes `godel`, and the ligature `ﬃ` becomes `ffi`.

The reading view matches `find` with `findLiteral` (`search-hits.ts`), which folds **case only**
(`foldCase`). So a press on a `Passage` in `Library.tsx` goes to
`?mode=search&find=godel&match=words`, and the search finds nothing in an article that says
"Gödel". The reader lands on the right paragraph with an empty search panel and no error. That is
the exact outcome the function's own header says it exists to prevent: *"right paragraph, nothing
highlighted, no error. This is the one that was missing."*

**The test pins the bug.** `tests/library-hits.test.ts` expects `find` to be `"cafe"` for the query
`"café"`. The function and its test arrived together in `25a81860a` (2026-08-26).

**Evidence.** Reproduced by the delegated reader. Its script ran `libraryHitHref` and then
`findLiteral` over the same text:

| Word | Matches |
|---|---:|
| Gödel | 0 |
| café | 0 |
| "efficient" against the ligature text "eﬃcient" | 0 |
| "plain" (control) | 1 |

Here I confirmed only the two sources and the test's expectation.

**Fix.** Send the hit's **own spelling** of the term. `foldWithMap` already maps folded offsets back
to the original text, so `find` becomes the original-text slice under the folded match.

The alternative is to make `findLiteral` accent-fold. That would change what find-on-page means
everywhere, and the comment above `findLiteral` argues against it.

**The test that goes red first.** In `tests/library-hits.test.ts`, a round trip: for a hit with the
text `"a café in paris"` and the query `café`, `findLiteral([block(hit.text)], find)` is non-empty.
Then change the pinned `"cafe"` to `"café"`.

**Smaller and also reproduced:**

- The browser's `fold` lowercases one character at a time, while the server's `fold`
  (`src/library-search.ts:103`) lowercases the whole string. So a word-final Greek `Σ` folds
  differently: `ΟΔΟΣ` does not match `οδος` in the card filter. The impact is low.
- `library-hits.ts`'s header still says there is "no React test runner". That is stale.

**Files:** `src/web/library-hits.ts` and `tests/library-hits.test.ts`.

### W12 — A copy button's per-press token reached two of six copies

T1 · effort S · value low. This is drift, and it folds into W8.

`b57dde403` (2026-09-05, found with `git log -S"press.current === mine"`) gave `AnnotateDialog`'s
copy a per-press token, so an older press's result cannot overwrite a newer one. The same commit
stopped a failed copy drawing an ✕ next to the dialog's Close ✕. `BlockGutter` already had the
token.

These copies still lack the token:

- `Tweets.tsx` § `CopyButton`
- `ChatPanel.tsx` § `CopyAnswer`
- `ShelfEntry.tsx:621`
- `AccessSharing.tsx:874`

Tweets and ChatPanel still draw an ✕ for a failure. ShelfEntry and AccessSharing start an
uncancelled `setTimeout(…, 1500)`.

Evidence: proved from the code by the delegated reader. Here I confirmed the token in
`AnnotateDialog.tsx:456` and `BlockGutter.tsx:384`, and that no copy file other than those two
matches `press.current === mine`.

This makes W8's `copyText` worth a little more. Better still is a `useCopy()` hook that owns the
token and the reset timer.

### W13 — Shelf and annotation logic with no seam

T2 · effort S–M · value medium. Delegated, and its last item spot-checked here.

**`Library.tsx`.**

- The snippet window inside `marked` (around line 1387) is untested arithmetic. Only `foldWithMap`
  beneath it is tested.
- "Is there a search?" is asked three different ways (around 447–463):
  - `queryTerms(query).length > 0`
  - `trim().length >= MIN_QUERY`, which is 3
  - `trim().length > 0`
- The fixes since 2026-09-08 cluster on exactly these inline memos and gates: 261002b's
  `19b513144` and `62d4b2227`, both reviewer fixes.
- `nothingLeft` and `shelfScope` are already pure but not exported, and no test names them.

Proposed: a pure `searchState(query, passages)` and a pure `snippetWindow(text, query)`, both tested
in `tests/library-hits.test.ts`, with `nothingLeft` and `shelfScope` exported and tested.

**`annotate.ts`.** The rule deciding which classes and attributes a run gets (around 480–760, inside
the 400-line `annotate`) is reachable only through `annotateHtml`'s output. Two fixes, `7bbc132d8`
and `3e2d0b9a8`, both changed which comment wins an overlap. Proposed: a pure
`runAttributes(covering, runEnd)`. `shareStripes` is unexported and untested.

**Dictation.** `dictate.readOnly || dictate.dictation.armed` is written out 7 times in 5 files
(AnnotateDialog, CommentDialog, ChatPanel, QuizPanel, IllustratedView). It wants to be a `busy` field
on the dictation hook. This is T1, effort S.

**Scope note.** The brief's `ActionButtons.tsx` exists only as `tools/fleet/web/src/ActionButtons.tsx`,
which is the fleet dashboard and not the reader. It is out of this area, so `AnnotateDialog.tsx` was
read in its place.

## 3. Two ways to do one thing, and drift that is proved

| Thing | Ways | Drift proved? |
|---|---|---|
| Threshold row | 6 copies, 2 track shapes, 4 CSS families (W3) | Yes. Quotes' stops track (`1b3f4258b`) reached Quotes and Debate only |
| Read-failure recovery | `retryRead` with *Try again* in 4 bands, a bare sentence in 7 (W2) | Yes. FAQ's D1 (`418a3d57f`) |
| Answer-stream terminal contract | `readAnswerStream` plus `readMark` and `readRun` (W4) | Partial: the null guard |
| "The band covers the prose" | 5 derivations (W5) | Not yet |
| Relative time | `relativeAgo`/`timeAgo` and Metadata's `ago` (W7) | Yes: no future clamp, no date switch |
| `withPanel` | Dock's and Metadata's (W7) | No |
| Clipboard write | 8 writers, 2 guard spellings, 2 of 6 with a press token (W8, W12) | Yes: ViewportProbe kept the optional chain; `b57dde403`'s token reached 2 of 6 |
| Text folding | the shelf's `fold` (accents, ligatures, per character) vs find-on-page's `foldCase` vs the server's whole-string `fold` (W11) | Yes, and it is a live defect |
| "Is there a search?" | 3 tests in `Library.tsx` (W13) | Not yet |
| Stale banner | 13 copies of `gloss-stale` + `TriangleAlert` + `run(label, true)`, each with the same *"No banner for an outdated list"* comment (`git grep -n 'className="[a-z]*-stale"' -- src/web`) | No. They are consistent. See § 6 |
| Tooltip-delay waits in tests | Fake timers in the spine tests, real 400 ms sleeps elsewhere (W9) | — |

## 4. Testability

**Logic with no seam:**

- **The spine card's choice of bullets** is inside `BandCard`. It is reachable only by mounting
  `Spine` with stubbed geometry, which is why the fixture never contained a heading leaf. After W1,
  `kids` could be a pure `cardKids(entry, where)` exported beside `childLabel`, and the W1 test could
  then be a two-line unit test.
- **The live hook's tap and caps decisions** (W10).
- **`Reader.tsx`'s layout predicates** (W5), and the passage-slot isolation (W6), which today is
  tested only as an ordering accident of React effects.

**`Reader.tsx` overall.** It is one 3,250-line component with 109 hook calls
(`grep -c "useState\|useEffect\|useMemo\|useCallback\|useRef"`). It has the most churn and the most
fixes in the client (86 commits, 15 fixes). Its pure parts have been leaving steadily:
`passages.ts`, `measure.ts`, `useReadingPosition.ts`, `layout.ts`. W5 and W6 are the next two.

**Tests that wait on fixed time:** 51 sleeps of 300–500 ms and 27 of 1–200 ms (W9), plus the 5 s
poll in `live-tail-handoff`.

## 5. Product simplifications (PRODUCT, not to be built without Greg)

- **P1 — the spine card's bullet list.** Of 1,321 hit cards, every child is a paragraph's
  `navLabel` or a heading, and the card can show at most five. Now that the card has the outline and
  the gist, the bullet list may be the least useful line on it.
  - Removing it removes `childLabel`, `MAX_CHILDREN` and W1 entirely.
  - The reader loses a peek at the first five paragraph labels of a section they have not reached.
- **P2 — one slider vocabulary.** The rows say "threshold", "bar" and "confidence" for the same
  control. Choosing one word, and one track (stops everywhere), makes W3's step 2 a deletion rather
  than a parameterisation.
  - The reader loses Search's fixed 0–100, which Sol argued for because hits stream in.

## 6. Considered and rejected

- **A second fetch wrapper.** None exists. There are three raw `fetch`es outside `lib/api.ts`, each
  deliberate:
  - `supabase.ts:168`, the auth settings;
  - `link-facts.ts:433`, Wikipedia, cookie-less and referrer-less;
  - `public-api.ts:103`, the closed public namespace with `credentials: "omit"`.

  Of the 30 hand-rolled `!res.ok` checks (`git grep -nE "!\s*(res|r|response|resp)\.ok\b"`), 11 are
  stream opens that already route through the shared `failure()`. The rest are the open item 2.2
  from `260902e`, unchanged in kind.
- **Retry-After parsing in the client.** It has 0 hits in `src/web`. The "13 files" in the prior
  digest are server-side.
- **Migrating the six item-stream loops to `readAnswerStream`.** They are a different protocol
  (W4).
- **A broad `useArtefactRead` hook.** The status and parse glue is still copied in 13 hooks (the
  `was === "loading" ? "error" : was` guard: `git grep -ln` gives 13). But GPT Sol put the broad
  form on "do not do", and `useOrderedRead` already took the mechanism. W2 is the narrow piece that
  matters.
- **A `StaleBanner` component.** There are 13 copies, but they are consistent, and the banner's
  action is the panel's own `run()`, whose state the 261003a postmortem says must not be
  reconstructed. Revisit when one drifts.
- **Splitting `Dock.tsx` or `Metadata.tsx` by file.** Size alone is weak evidence. Dock's decisions
  are already exported and tested (`visibleModes`, `groupStarts`, `fitSignature`, `hasQuickSearch`,
  `withMode`).
- **B-knowledge #15, `Tooltip.tsx`'s "workaround no longer needed" as dead code.** It is false.
  - The line 589 note is history about `--ink-soft` in a doc comment, not code.
  - The line 423 `FloatingTree` wrap is live, and `@floating-ui/react` is still pinned at `^0.27.20`.
- **A mode registry.** Refused in 260902o. Not re-proposed.

## 7. One level up: is the approach sound, and is per-mode wiring improving?

**Mostly sound.** The client's direction is right: pure modules split out of components, total
tables over `Mode` checked by the compiler, and a shared surface (`ModeSurface`, `ModeBoundary`,
`useStepJob`, `useOrderedRead`, `useAutoRun`).

**Per-mode wiring is better checked but wider.** From `docs/project/mode.md`'s history (it was
`new-mode.md` until 2026-10-01):

| Date | Compiler-checked tables | Checklist bullets | "*Nothing*" (unchecked) items | Lines |
|---|---:|---:|---:|---:|
| 2026-09-05 | 5 | 14 | 9 | 182 |
| 2026-09-07 | 8 | 20 | 10 | 277 |
| 2026-09-30 | 11 | 22 | 10 | 376 |
| 2026-10-03 | 11 | 35 | 11 | 586 |

What the numbers say:

- What the compiler checks has doubled.
- The unchecked residue has held at about 10.
- The conventions a new mode must *know* have more than doubled, mostly product rules: the (i),
  no description line, voices, thresholds, marginalia.

Files touched by the client half of a new mode:

| Commit | Mode | `src/` files |
|---|---|---:|
| `0e947eb40` | FAQ, 2026-09-16 | 16 |
| `64595ca96` | Trajectory, 2026-09-28 | 22 |
| `897020835` | Tweets, 2026-09-29, a conversion | about 27 |

So the per-mode cost is flat to slightly rising. It is safer per edit, but not smaller.

**Where the leverage is.** The leverage is not a registry. It is the drift class this sweep found
three times (W2, W3, W12): **a fix lands in the mode being built and stays there**. A mode-matrix test turns
that class red:

- every artefact band has a *Try again* on a failed read;
- every threshold row uses `ThresholdSlider`.

`tests/every-mode-draws-its-surface.test.tsx` is already that shape, so these would be two more
columns, not a new framework. Size: effort M, about one table per contract.

No T3 is proposed.

## 8. Ranked list, by ease × value, in clusters with disjoint file sets

| Rank | Finding | Tier | Effort | Cluster |
|---:|---|---|---|---|
| 1 | W1: spine card repeats a heading | T0 | S | **A**: `Spine.tsx`, `tests/spine-card.test.tsx` |
| 1= | W11: shelf link highlights nothing for an accented word | T0 | S | **I**: `library-hits.ts`, `tests/library-hits.test.ts` |
| 2: read-failure dead end in 7 bands, plus `ReadError` and the matrix test | T0 | S–M | **B**: the 7 hooks and panels, `FaqPanel.tsx`, new `ReadError.tsx`, one test |
| 3 | W5: one `bandCoverage` | T1 | S | **C**: `reader/Reader.tsx`, `layout.ts`, layout test |
| 4 | W3 step 1: Glossary and Citations onto `ThresholdSlider` | T1 | S | **D**: `GlossaryPanel.tsx`, `CitationsPanel.tsx`, `ThresholdSlider.tsx` |
| 5 | W7: Metadata's `ago` and `withPanel` | T1 | S | **E**: `Metadata.tsx`, `Dock.tsx` (export) |
| 6 | W9: fake-timer tooltip helper and conversions | T1 | M | **F**: `Tooltip.tsx` (export), `tests/helpers/`, the ~15 test files |
| 7 | W10 a–c: live-hook pure decisions | T2 | M | **G**: `src/web/live/*`, new test |
| 8 | W6: keyed passage slots | T2 | M | **C** (after W5; same file) |
| 9 | W3 step 2: one slider with two tracks | T2 | M | **D** (after step 1) plus Search, Quotes, Debate and their CSS |
| 10 | W8 and W12: `useCopy` (token, timer, result) | T1 | S | **H**: the 8 clipboard files, a new `src/web/lib/copy.ts` |
| 10= | W13: `searchState`/`snippetWindow`, `runAttributes`, dictation `busy` | T2/T1 | S–M | **I** (after W11) for `Library.tsx`; `annotate.ts` alone; the dictation hook and its 5 callers |
| 11 | W4: `readMark`/`readRun` onto `readAnswerStream` | T2 | S | fold into whoever next touches `useQuiz`/`useMirror` |

**Overlaps:**

- B and D share `GlossaryPanel.tsx` and `CitationsPanel.tsx` at different lines (the error `<p>`
  against the slider). Build them in sequence, or give both to one agent.
- C holds `Reader.tsx` alone; nothing else here touches it.

**Finding counts:**

| Tier | Count | Findings |
|---|---:|---|
| T0 | 3 | W1, W2, W11 |
| T1 | 7 | W3 step 1, W5, W7, W8, W9, W12, W13's dictation `busy` |
| T2 | 5 | W3 step 2, W4, W6, W10, W13 |
| T3 | 0 | |
| PRODUCT | 2 | P1, P2 |
