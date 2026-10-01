# Glossary: Undo a *Find more*, and say on Metadata whether a run appends or rewrites

Three follow-ups that
[260930e](260930e-metadata-run-it-without-a-confirm-and-start-again-in-the-rerun-section.md) § Deferred
left behind. That work shipped (SPIDERYARN-READING2-64 and -65, notes
[64](../user-feedback/260930_0745-metadata-run-it-without-a-confirm.md) and
[65](../user-feedback/260930_0745-start-again-is-the-rerun-sections-first-row.md)). This is the rest of
it, briefed by the Overseer on 2026-10-01.

Status: **1 and 3 built, on `dev`, not deployed; 2 (Undo) designed and not built** — see § Outcome.

Prior work checked first: `git log origin/dev --since=2026-09-28`, the plans and feedback notes
after 260930e, and `gjd-remote ls`. Nobody else has built any of the three.

## 1. *Start again*'s Retry gets the latch `useStepJob` has

`useResetJob` (src/web/ResetArticle.tsx) answered a confirmed Retry with `void queue.retry(id)`.
The confirm closed at once, the old failure and its Retry button came straight back until a poll
found the new job, and two presses of *Yes, try again* that landed before React committed sent two
retries. The server merges a duplicate reset, so this was untidy rather than costly (Sol's P3 on
260930e).

**Fix:** a `retry` in `useResetJob` copied from `useStepJob.retry`. A ref latch blocks a second
press. `starting` is set before the `await`. The replacement job (the retry route answers with it)
becomes the watched one. A refused retry puts the old failure back. Both `failed.retry` arms now go
through it.

**Tests** (tests/metadata-reset-section.test.tsx), written before the fix:

- Two clicks on *Yes, try again* in one `act` send one retry, and *Starting…* shows with no Retry
  until the new job is in the list. This went red on the old code: Retry came back mid-flight.
- A refused retry restores Retry rather than leaving *Starting…* stuck. This was already green, and
  is kept so the latch cannot strand the button.

## 3. Metadata says, before the press, whether the glossary run will append or rewrite

Taken before 2 because it is cheaper and gives more.

**Today:** the Glossary row on Metadata says *Run it again* with a hedge under it: *"Adds more
terms to an up-to-date list; otherwise writes a new one."* The page cannot know which will happen.
`existingFor` (src/glossary.ts) decides on the server, from the source, the prompt version and the
reader profile.

**Change:** `ArticleMetadata` gains `glossaryRun: "first" | "append" | "rewrite" | null`.

- It is computed in `articleMetadata` (src/store/pg.ts) by a new `glossaryRunKind` in
  src/glossary.ts. That function is written *on top of* `existingFor`, so the run and the page
  cannot reach two different verdicts:
  - `first` means there is no list yet.
  - `append` means `existingFor` accepts the current list.
  - `rewrite` means there is a list and `existingFor` refuses it.
  - `null` means we cannot tell: there is no tree or no blocks, so there is no `articleHash`.
- Its inputs are all already in hand there, so it adds no query:
  - the revision's `glossary`;
  - `articleHash`, the same `articleFingerprint` the glossary stamps;
  - the profile hash a Metadata press would send, which is
    `hashProfile(renderProfile({ profile, purpose }))` over the two fields the method already reads.
- **The profile has to be the one the press sends.** Metadata's run sends no `useProfile`, so
  `POST /api/jobs` resolves the reader's current profile (`resolveProfile`, src/routes.ts), which is
  `renderProfile` of exactly those two fields. A test pins this.
- On the row:

  | `glossaryRun` | button | note under the name |
  |---|---|---|
  | `append` | *Find more terms* | *Adds more terms to this list* |
  | `rewrite` | *Run it again* | *Writes a new list, because the article, the glossary's instructions or your profile has changed* |
  | `first` | *Run it* | none |
  | `null`, or still loading | as today | today's hedge |

  The verdict is re-read every time Metadata re-reads, which it already does when a run finishes.
- **Passed over:** making Metadata's glossary row send the list's own profile setting, as the
  Glossary panel's *Find more* does (`owner.profiled`), so that it always appends. That changes
  what the button does, not what it says. A reader who has just written a profile would then press
  *Run it again* and get a list that ignores it. Saying which one will happen keeps today's
  behaviour, and that behaviour is right.

## 2. Undo for an accidental *Find more* — designed, not built

**Not built.** GPT Sol's plan review (finding 5) argued to defer it, and I agree; the reasoning is
in § Outcome and the Overseer has the recommendation. The design below is kept for if a reader asks.

**What a reader sees.** A *Find more* in the Glossary panel's foot lands and adds, say, nine terms.
The foot then says:

```
  Found 9 more terms.  [Undo]          [🔍 Find more]
```

*Undo* puts the list back exactly as it was before that pass. The nine new entries go, and every
earlier entry keeps its id and its text. Nothing is paid for.

**When it is offered: only in the session that watched the pass finish.** The panel knows the
entry count before and after, and that is all it needs. The offer goes when the panel unmounts or
another run starts.

Passed over: offering Undo for the last pass at any time. The `GET /api/glossary/:slug` behind
every glossary open would then have to walk the revision chain to answer *was the latest change an
append?*. That is a hot read for a rare case, and an accidental press is noticed at once. This is
named as a product call in the message to the Overseer.

**The server: `POST /api/glossary/:slug/undo`**, owner-only, and implemented as
`undoLastGlossaryPass` in src/store/pg-glossary.ts beside `deleteGlossary`. It shares that
function's lock and its 409 rule.

1. Take the article lock, `for update`, as `deleteGlossary` does. Answer 409 if a live job holds a
   draft of the article (`liveJobHoldingADraftQuery`), because that job would publish the appended
   list straight back over the undo.
2. Find **the list before the last pass**. Walk `based_on_revision_id` back from the current
   revision to the first ancestor whose `glossary` differs from the current one. Other modes can
   publish revisions after the glossary's, and each of those carries the glossary unchanged, so the
   immediate parent is not enough. The walk is bounded at 50 steps; past that, answer 409.
3. **Refuse unless the current list is a pure append on that ancestor's list.** All of these must
   hold:
   - the same `sourceHash`, `version` and `profileHash`;
   - `passes` exactly one more than the ancestor's;
   - every ancestor entry id still present;
   - at least one entry added.

   Without this check, an Undo after a *rewrite* (an edit, a prompt change or a profile change)
   would quietly bring back a list written for something else. An Undo pressed twice would also be
   a redo: the parent of an undone revision is the appended one. 409 with a plain sentence.
4. The client sends `{ expectEntries: n }`, the count it is showing. If the server's current count
   differs, it answers 409, because the list has moved since the reader looked.
5. Mint a draft with the existing `beginDraftIn` inside the same transaction. That copies the
   blocks, the columns and the run rows. Then set `glossary` to the ancestor's list, put the
   ancestor's `glossary` run row in place of the copied one (over `STEP_RUN_CARRIED_COLUMNS`), and
   publish with `publishRevisionIn`. The run row matters because Metadata and `stampForStep` read
   it beside the column, and a restored column under the appended run's row would be two facts
   that disagree.
6. Answer `{ removed: n }`. The panel calls `read.refresh()`.

What it leaves alone:

- **Look-ups** (`glossary_lookups`, keyed on article and entry id, with no foreign key) for a
  removed term stay stored and are simply not shown, as after a rewrite.
- A `?term=` link to a removed term stops resolving.

Neither needs saying in the foot. They are terms the reader got a minute ago by accident.

**Passed over: writing the published revision in place**, as `deleteGlossary` does with
`UPDATE … set glossary = null`. That would be cheaper because it copies no blocks. But it would
make a second exception to "published revisions are not written", and it would have to rewrite a
run row in place too. A new revision costs one block copy on a rare press and keeps the history
honest: the appended list is still there, one revision back.

**Tests**, red first:

- `tests/store-glossary-undo-pg.test.ts` (Postgres):
  - an append then an undo restores the earlier list, ids and passes included, and the run row
    matches it;
  - an unrelated mode publishing in between does not stop the undo;
  - an undo after a rewrite is refused;
  - a second undo is refused, not a redo;
  - a live draft-holding job gets 409;
  - a stale `expectEntries` gets 409;
  - another owner gets 404.
- A panel test: Undo shows after a watched *Find more* adds terms, posts once, refreshes, and
  goes; it is absent on first load.

## Docs

- glossary.md § Finding more: the Undo, its scope (this session only) and what it leaves.
- The § Deferred list in 260930e: mark these three done, with a link here.
- ingest-queue.md: only if its re-run section describes the glossary note. Check it.
- The 64 note in docs/user-feedback/: one line saying these were built. Its ending stays *shipped*.

## Stages

1. The Retry latch (1). Done, and green.
2. The verdict (3): `glossaryRunKind`, the field, the row, tests.
3. Undo (2): the store, the route, the client, tests.
4. A browser check (Playwright, in a Sonnet subagent), docs, a Sol code review, then push to
   `dev`.

## Reviews

- **Plan, GPT Sol** ([261001i-glossary-undo-plan-review-sol.md](261001i-glossary-undo-plan-review-sol.md),
  EXIT=0): revise. Stage 1's latch sound. On the verdict: the fingerprint and profile match the job's
  for one snapshot, but the page can go stale (P2) — taken: Metadata reads again after the purpose box
  saves, the one input this page itself changes, and the docs call it a prediction. On Undo: a count is
  not a compare-and-swap (P1), a count rise is not proof this tab ran the pass (P2), the ancestor's run
  row needs validating (P2), and — finding 5 — defer it. All four apply only to Undo, which is deferred.
  Its suggested integration test through `POST /api/jobs`'s own `resolveProfile` was not written:
  `resolveProfile` is not exported, and the Postgres test renders the two boxes the same way
  `resolveProfile` does and fails when the page's profile or fingerprint is changed (both mutations
  checked).

- **Code, GPT Sol** ([261001i-glossary-undo-code-review-sol.md](261001i-glossary-undo-code-review-sol.md),
  EXIT=0, with fixes): *keeps every one already there* was too strong, because deduplication can
  refine an existing entry while keeping its id (taken: the note says *adds more terms*). The refusal
  test passed without the latch (taken: it now proves the refusal releases the latch). A purpose-only
  Postgres case was added, and the Postgres cases were isolated from each other. It also prefixed
  both notes with *With things as they are now*, because the verdict is a prediction: **overruled
  on wording**. The page re-reads after a run and after the purpose saves, which covers what a reader
  changes from this page, and the prefix made both notes harder to read for a race that needs a
  second tab. The docs say it is a prediction. Its "not ready" was only that its sandbox could not
  reach Postgres or run the typecheck wrapper; both were run here.

## Outcome

- **1 — built.** `useResetJob.retry`, with the double-press and refusal tests; the first went red
  without the latch.
- **3 — built.** `glossaryRunKind` and `runProfileHash` in src/glossary.ts (the run now reads its
  profile hash through the same helper), `ArticleMetadata.glossaryRun` from `articleMetadata`, and
  the Metadata row's label and note. Tests: tests/glossary-run-kind.test.ts (red before the function
  existed), tests/store-glossary-run-kind-pg.test.ts (green on arrival; went red when the page was
  given `blocksHash` instead of the article fingerprint, and when it was given no profile), and
  four cases in tests/metadata-rerun-section.test.tsx (red first).
- **2 — not built**, on Sol's finding 5. A *Find more* keeps the list and usually adds terms
  (deduplication may refine an existing entry while keeping its id), the threshold already hides
  low-ranked terms, Stop is on screen for the whole pass, and no reader has asked. Built properly
  it needs an endpoint, an ancestry walk, a run-row swap, a content-hash guard and about ten
  Postgres cases. The Overseer has the recommendation, and the design above is the starting point
  if Greg wants it.

## Checks

- Browser, Playwright in a Sonnet subagent on its own dev server, against local articles in each
  state:
  - `love-spya-kwm06n` read *append*, `pow-spya-fvrt2e` read *rewrite* and `wisdom-spya-vkvttk` read
    *first*, and each row's button and note matched its state.
  - Saving a purpose sent a second metadata read and turned *append* into *rewrite*; clearing it
    turned it back.
  - At 390px the longest note wraps under the name, the button stays on the name's line, and
    nothing overflows.
  - The check ran on Sol's interim wording, which was longer than what shipped:
    [append](261001i-shot-append-390.png), [rewrite](261001i-shot-rewrite-390.png),
    [first](261001i-shot-first-390.png), and the 1280px versions beside them.
- The focused suites (eight files, 186 tests, Postgres included) and `npm run typecheck` (exit 0).
