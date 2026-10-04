# Stop writing the Simple summary level

Up: [plans.md](../project/plans.md) · owning doc: [summaries.md](../project/summaries.md)

> we've removed that middle level of Summary, and we're not going to add it back
>
> — Greg, 2026-10-04, answering [Q-simple-level] (relayed by the Overseer)

> we only want to write it once, i.e. when we first open the mode (or perhaps before that if it's
> part of the import process). the only time we'd rewrite it is if we click Rerun in Metadata.
>
> — Greg, 2026-10-04, on when Summary is written (relayed by the Overseer)

## What this is for

Summary shows two lengths, Brief and Fuller, and a Thread
([261003l](261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md)). The `simple` step
still writes a third, middle level, called Simple, that nobody is shown. Each write therefore pays
for one model call and one fidelity check nobody reads, and because the step stores every level or
none, a Simple that fails makes Brief and Fuller fail with it.

After this, a write produces Brief and Fuller only, and the middle level is gone from the code
rather than switched off.

**A naming trap.** Three things are called "simple": the pipeline **step** (`simple`), the stored
**artefact** (`SimpleSummary`, the `simple_summary` column), and the middle **level**. Only the
level goes. The step and the artefact keep their names; renaming them is a different, much larger
job and is not proposed.

## What changes

1. **The level list.** `SIMPLE_LEVELS` in `src/types.ts` becomes `["brief", "fuller"]`, so
   `SimpleLevel` is `"brief" | "fuller"`, and `SIMPLE_LIMITS.simple` goes. Every
   `Record<SimpleLevel, …>` narrows with it, and the compiler finds each reader.
2. **The writer** (`src/simple-summary.ts`). Two calls a write: Fuller first with the article
   marked for the cache, Brief once Fuller's stream has begun, as today. The mechanism
   (`FIRST_LEVEL`, `firstBegun`, all-or-none, the one retry, the fidelity guard) is unchanged; it
   loops over the list. The Simple-only prompt pieces go: `PITCH.simple`, and the `simple` entries
   of `NOTCH_UP`, `KEY_RULE`, `LIST_RULE`, `KNOWN_WORDS`, `AFTER_PROFILE`.
3. **The public payload** (`src/public/dto.ts`, `PublicSimpleSummary`). It is rebuilt field by
   field, so it stops carrying `levels.simple` for old rows as well as new ones.
4. **The export's count** (`src/store/export-bundle.ts`): the "plain-words paragraphs (simple)" row
   goes. The export itself writes the stored JSON whole, so an old row's Simple text still leaves
   in an export.
5. **The pipeline's log line**: paragraph and word counts read `2/5`, not `2/4/5`.
6. **Words on the landing page**: "brief, simple or a little fuller" becomes "brief or a little
   fuller". It has been untrue since 2026-10-03.
7. **Evals and probes** that name the level are edited only as far as the typecheck requires. They
   are records of past measurements; their result files are not touched.
8. **Docs**: `summaries.md` (the "still written" bullet and the levels section), and
   `prompt-caching.md`'s two mentions of three calls.

## What does not change, and how that is checked

- **Brief's and Fuller's prompts, byte for byte.** A test pins the SHA-256 of each system prompt as
  it is on dev today (brief `d492501b…5bd9595`, fuller `9bad8d90…6713258b`), written before the
  edit and green both sides of it. So `SIMPLE_PROMPT_VERSION` stays `simple-prompt/7`: nothing a
  reader sees is worded differently, no stored summary becomes `outdated`, and nothing is
  rewritten. This is what keeps Greg's "write it once" rule.
- **The stored shape's version stays `simple/2`.** See the next section.
- **`?summary=simple` reads as Brief** (`src/web/params.ts`, already tested in
  `tests/simple-panel.test.tsx`).
- **The door rule**: unchanged, no client code that decides when to write is touched.
- **The step's name, the route, the column, the cost category.**

## Stored rows

`article_revisions.simple_summary` is JSON. A row written before this has
`levels: { brief, simple, fuller }` and, when the guard ran, `check.levels: { brief, simple, fuller }`.
A row written after has two keys in each.

- **No migration, no rewrite.** Nothing in the database changes.
- **Old rows read cleanly.** `isSimpleLevels` and `isSimpleCheck` loop over `SIMPLE_LEVELS`, so
  they ask about Brief and Fuller and never look at the extra key. An old row is usable exactly
  when its Brief and Fuller are. A test stores an old three-level row and reads it.
- **One loosening, on purpose.** Today an old row whose *Simple* level is over its limits is
  unusable as a whole. After this it is usable, because the level that broke it is no longer read.
- **The owner's GET still returns the stored JSON whole**, so an old row's Simple paragraphs still
  reach the owner's browser, where nothing draws them. Stripping them on read would be a second
  shape for one artefact, for no reader's benefit.

### The option passed over: a new shape version

Bumping to `simple/3` would make the two shapes distinct by name. It was not taken: every read
boundary requires an exact version match, so either every stored summary would read as absent and
be paid for again on the next open (against Greg's rule above), or each boundary would learn to
accept two versions, which is more machinery than "ignore one key".

### The cost of not bumping: a rollback

Code from before this change requires all three levels. If production were rolled back, a summary
written in between would read as absent to the old code: the owner would see the empty state and
*Write it*, and a press would write a three-level one. Nothing is lost or corrupted, and the API
and the client deploy together, so there is no window in an ordinary deploy.

## Cost and wait

Before, from the six presses already on file (`evals/results/simple/high-none-fbazc1|c2`, the
shipped `simple-prompt/7`, guard on, Opus, three articles of 8.6k to 12.6k body words):
**$0.236 to $0.275 a press, 29.3 to 41.2 s**.

Expected after: one fewer writer call and one fewer check. The wait should move little, since
Fuller is the slowest call and still goes first; a press no longer waits for a Simple retry (one of
the six before needed one). Measured after the build on the same three articles, two presses each,
through `evals/simple/probe.ts`, and written into this plan and `summaries.md`. About $1 of calls.

## Stages

One stage; the change is small and has no safe halfway point.

1. Red first: the prompt-hash pin (green before and after), then tests that fail today — a write
   makes exactly two writer calls and stores exactly two levels; a stored three-level row is
   usable and its public projection has no `simple`; an old row with a broken Simple level is
   usable.
2. The edit, led by the typecheck.
3. Mutation check: put `"simple"` back in the list and see the new tests go red.
4. `npm test`, `npm run typecheck`, lint on touched files; the measurement; docs.
5. GPT Sol code review (write-capable), its diff read, gates re-run, commit, push to `dev`.

Done means: no writer or checker call for a Simple level; old rows read; the two prompts unchanged;
gates green; the measurement recorded.

## Not in this plan

- **qi-nec8qqzc** (show Brief as soon as it is written; a longer Fuller). It waits on Greg's
  [Q-summary-fuller-length]. This change makes it easier: with two levels the press is "Brief, then
  Fuller", so there is no third level to decide about when storing or showing a partial result.
- Renaming the step or the artefact.
- Deleting old rows' Simple text.

## Stage 2: show Brief as soon as it is written, then a longer Fuller

Added 2026-10-04, after stage 1 landed (`c9900a0e2`, `a27ebd3ad`). Not in this plan when it was
first reviewed; reviewed on its own before it is built.

> Q-summary-fuller-length D and C
>
> — Greg, 2026-10-04 (relayed by the Overseer). D is stage 1. C is option C of
> [261004a](../investigations/261004a-summary-fuller-longer-and-bold-and-bullets-prompt-eval.md):
> a Fuller of about 490 words, with Brief shown as soon as it is written.

The queue item (qi-nec8qqzc), as the Overseer relayed it: *"Store and show each level as it lands
(Brief first), then raise Fuller's ask to about 500 (two numbers in PITCH.fuller,
src/simple-summary.ts; the limits already allow it)."*

### What it is for

A reader who opens Summary sees nothing until both levels are written, about 30 s today. A Fuller
of about 500 words took 55 s when it was tried, which is why it was not shipped. Brief on its own
is ready much sooner, and it is the level Summary opens on. So: show Brief the moment it is
written and checked, let Fuller arrive when it does, and then Fuller can be longer.

### Two facts that decide the design (each checked in the code)

1. **A step cannot publish its artefact before it returns** (it can write a checkpoint; see S6
   below). It is handed a reads-only store
   (`src/jobs.ts`: `run(ctx, session.reads, session.checkpoints)`), and its `parts` are written to
   a draft revision that is published only when the job ends (`src/store/session.ts` § `commit`).
   The owner's read looks at the published revision, so a mid-run read finds nothing.
2. **Nothing a step says reaches the reader until the step ends.** `ctx.report` sets `step.detail`
   in memory (`src/jobs.ts`, "In memory only"); the job row is written at step start and step end
   (`note()` → `noteProgress`), and the browser polls that row every second.

### The design: Brief rides on the live job; both are stored at the end

```
 press ──► job row: simple running                       browser polls the job each second
            │
            ├─ Fuller call starts (article cached) ─────────────────────────────┐
            ├─ Brief call ─► valid ─► checked ─► ctx.preview(brief)             │
            │                              │                                    │
            │                 job row: step.preview = Brief's paragraphs        │
            │                              └──► the band draws Brief  (~15 s?)  │
            │                                                                   ▼
            └─ both levels ─► stored together, as today ──► the band re-reads, Fuller is there
```

- **One new optional field on a job step**: `JobStep.preview`, holding Brief's paragraphs. A step
  sets it through a new `ctx.preview(...)`, which writes the job row once with the existing
  `noteProgress`. A failed write is swallowed: the preview is a courtesy, never a reason to fail a
  paid step.
- **`generateSimpleSummary` gets `onLevel(level, paragraphs)`**, called once for a level when that
  level is final: valid, checked, and past any retry. Only Brief is forwarded to the preview.
- **The band**: with nothing stored and a running job that has a preview, Brief draws the preview's
  paragraphs with the progress row under them; Fuller draws the progress row and one line saying
  Brief is ready and Fuller is still being written. When the job ends the band re-reads and draws
  the stored summary, whose Brief is the same paragraphs, so nothing moves.
- **What is stored does not change**: both levels or none, the same shape, the same guards. So
  the public payload, the export, Metadata, the *make public* dialog and every read boundary are
  untouched, and a rollback reads every row.
- **The preview is cleared when the step succeeds**, so the reader's summary lives in one place.
  It is the owner's (jobs are owner-scoped), never logged, never sent to a visitor.

### Where this departs from the queue item's words, on purpose

The item says "store and show". This **shows** Brief as it lands and **stores** both at the end.

**The option passed over: store a Brief-only row mid-run.** It needs a write path around the
draft-and-publish rule (fact 1), a "partial" answer at every one of the ten places that read the
artefact, an optional Fuller in the public payload, and a way to resume a write that has Brief and
not Fuller. That is most of a second storage model, for one difference the reader can see:

**What is given up: if Fuller then fails, Brief is not kept.** Fuller gets its one retry first. If
it still fails, the job fails, nothing is stored, and the failed job still carries the preview, so
Brief stays on screen beside the failure and *Try again*. Pressing that writes both again, so the
reader may see a differently worded Brief, and pays for Brief twice (about a cent). In the 24
writes measured across this plan and 261004b, none failed. If it turns out to happen, the
follow-up is to bank Brief as a step checkpoint (the structure step's pattern,
`src/store/checkpoints.ts`), which costs one additive migration.

This is a product-visible trade-off, so it goes in the debrief as **[Q-brief-kept-on-failure]**
with the recommendation to leave it.

### The longer Fuller

`PITCH.fuller` goes to the arm 261004b measured and Sol's fidelity pass judged (`fbaza1|a2`):
"Five to eight paragraphs", about 500 words, never more than 600. That is three values, not the
item's two: the shape line asked for four to seven paragraphs and would fight the word count.
`SIMPLE_LIMITS.fuller` (8 paragraphs, 850 words) already allows it. Brief's prompt does not change.

- `SIMPLE_PROMPT_VERSION` becomes `simple-prompt/8`, by the file's own rule. Every stored summary
  becomes *outdated*, which is silent: the band draws it as before and nothing is rewritten on
  open (the door rule fires only with nothing stored). Metadata's Rerun writes the longer one.
- The hash pin in `tests/simple-two-levels.test.ts` keeps Brief's hash and takes Fuller's new one.
- The copy "usually in about half a minute" in the empty state is rewritten to match.

### Does write-once still hold

Yes. A write still happens only on the door (nothing stored) or a forced rerun. The preview is not
a second write: it is the same Brief that is stored a few seconds later. The one exception is the
failure case above, which is an explicit press.

### Measuring it

`evals/simple/probe.ts` records `briefReadyMs` and `fullerReadyMs` through `onLevel`. Three
articles, two cold writes each:

- **before**: `onLevel` built, Fuller still asked for 350 (stage 1's prompt);
- **after**: Fuller asked for 500.

Reported: the wait to Brief and to Fuller in each, and cost. This also answers what stage 1 could
not: whether the slow writes are Fuller's.

### Build order (one stage)

Red first:

1. `tests/simple-summary.test.ts`: `onLevel` is called once per level, with the paragraphs that
   are then stored; Brief's call comes before Fuller resolves; a level whose attempt was flagged is
   announced once, with the kept text; not called at all for a level that fails.
2. A jobs test: a step that calls `ctx.preview(x)` makes the stored job row carry it while the
   step is running; a `noteProgress` that throws does not fail the step; the preview is gone from
   the row after the step succeeds and still there after it fails.
3. `tests/simple-panel.test.tsx`: nothing stored, running job with a preview: Brief draws the
   paragraphs and the progress row; Fuller draws the progress row and the "still being written"
   line and none of Brief's text; a failed job with a preview keeps Brief beside the failure; a
   visitor never gets a preview.
4. `tests/simple-two-levels.test.ts`: Brief's hash unchanged, Fuller's new, version `/8`.

Then: `src/types.ts` (`JobStep.preview`), `src/pipeline.ts` (`StepContext.preview`, the `simple`
step passes `onLevel`), `src/jobs.ts` (set, write, swallow, clear on success),
`src/simple-summary.ts` (`onLevel`, `PITCH.fuller`, the version), `src/web/useSimple.ts` and
`src/web/SimplePanel.tsx`, `evals/simple/probe.ts`, `docs/project/summaries.md`, the help page if
it states the wait. Browser check on the box with Playwright, in a Sonnet subagent: press Summary
on an article with none, see Brief arrive before Fuller.

Done means: Brief is on screen before Fuller is written, with nothing stored early; a failed
Fuller leaves Brief visible and stores nothing; Fuller comes back at about 500 words; the two
waits are measured; gates green; Sol's code review read and its fixes committed.

### Sol's review of this stage's plan (refuse), and what changed

[The review](261004f-stop-writing-the-simple-summary-level-stage-2-plan-review-sol.md). It agreed
with the design ("Brief on the owner's job row, ordinary artifact publication unchanged") and
refused on three P1s. **Where the text above and this section disagree, this section wins.**

- **S1 (P1), taken, and it is a fix of its own.** An unforced job that includes `simple` rewrites
  a stored summary whenever the prompt version has moved, because `stepIsDone` compares stamps
  and the stamp carries the prompt version. The Summary door never does this (it writes only with
  nothing stored), but the add page's *Generate the main modes* box queues `simple` unforced. That
  was already true of every earlier bump; `/8` would make every stored summary eligible, against
  Greg's "the only time we'd rewrite it is if we click Rerun in Metadata". **Fix**: the `simple`
  step's expected stamp takes the prompt version of the summary already stored, when there is
  one, so an unforced run never rewrites for the prompt's age. It still rewrites when the article
  itself moved, and a forced run always writes. The owner's read and Metadata compare against the
  current version on their own (`src/store/pg.ts`), so *outdated* and Rerun are unchanged. Test
  first: a stored `/7` summary is done for an unforced run under `/8`, and not done when its
  `sourceHash` no longer matches.
- **S2 (P1), not taken here; it goes to Greg.** Summary has two presses of its own that force a
  rewrite: *Write it again* under a stale notice or a changed profile, and the profile badge's
  action. Read strictly, Greg's rule leaves only Metadata's Rerun. They are explicit presses, they
  predate this plan, this stage does not touch them, and removing a button a reader has is a
  product change nobody asked for. **[Q-summary-write-it-again]** in the debrief.
- **S3 (P1), taken.** The band cannot draw the preview only "while the job is running": when the
  job finishes, the job leaves the hook a render before the stored summary arrives, and a failed
  job is not exposed at all. **Fix**: `useSimple` remembers the last preview it saw, with the id
  of the job it came from. It keeps drawing it until the stored summary has loaded, drops it when
  a different job starts for this article, and so still has it when the job fails. It lives in the
  page's memory only: after a reload a failed write shows its failure without Brief.
- **S4 (P1, reasoned), taken.** `noteProgress` replaces the whole `steps` array, so a preview
  write still in flight when the step settles could land afterwards and put back an old `steps`.
  **Fix**: `ctx.preview` keeps the promise of its write, and the step runner awaits it before it
  settles the step on either path. Tested with the write deliberately delayed.
- **S5 (P2), taken.** A requeued attempt keeps a step's other fields, so the preview is deleted
  when a step starts, beside `error`.
- **S6 (P2), taken as a correction.** Fact 1 is narrower than written: a step cannot *publish its
  artefact* before it returns. It can write a checkpoint mid-run, which is why banking Brief there
  is the named follow-up and not an escape hatch.
- **S7 (P2), taken, and simpler than clearing on success only.** The preview is on the job row
  **only while the step is running**: deleted when it succeeds and when it fails. So nothing of
  the summary is retained on a job row, and nothing is missing from an export. On a forced rewrite
  with a summary already on screen, the old summary stays until both new levels are stored; the
  preview is drawn only when nothing is stored.

Build order, amended: `src/web/useStepJob.ts` is not changed; `src/pipeline.ts` § `simple.stamp`
is; the jobs test covers start, success, failure and a delayed write; the client test drives the
real hook through a deferred completion read, a failure, a retry and a successor job.

## Ledger

### Sol's plan review (approve)

[The review](261004f-stop-writing-the-simple-summary-level-plan-review-sol.md). No P0 or P1. Three
P2s, all taken:

- **F1**: `scripts/simple-check-report.ts` looped over `SIMPLE_LEVELS`, so narrowing the list would
  have dropped old records' middle-level flags from its tally while the ledger half still counted
  their calls. It now reads every level a record holds, from a list of its own.
- **F2**: `tests/store-export-bundle.test.ts` pinned the removed count row. Updated, and its fixture
  kept as a three-level row so the export is proven to carry one whole.
- **F3**: `evals/simple/probe.ts` would have printed `undefined paragraphs` and a `**simple**`
  heading over nothing. It prints Brief and Fuller, and the heading only for an old result.

### What landed (stage 1)

As planned, with these differences:

- **`evals/simple/fanout-spike.ts` lost its paid half.** Every arm was a three-level press built
  from production's level prompts, so none could run. `report` still reads the results; an arm
  now refuses and names the commit that has the code.
- **`tests/public-dto.test.ts` and `tests/store-export-bundle.test.ts` keep three-level fixtures**,
  as rows from before the change: the first proves a visitor gets no middle level from one, the
  second that an export carries it whole and the page does not count it.
- **`tests/simple-summary.test.ts` and `tests/simple-panel.test.tsx`** used the middle level as the
  vehicle for most validation cases. An Opus subagent moved each onto Brief or Fuller with that
  level's real limits; no case was deleted, and three lost assertions that were about the middle
  level's own prompt.

### Gates

- New tests red first: 4 of 8 in `tests/simple-two-levels.test.ts` failed on the unchanged code
  (the level list, two calls and two checks, building from two answers, an old row with a broken
  middle level); the other 4 are preservation and passed both sides.
- Mutation: `SIMPLE_LEVELS` with `"simple"` put back fails `simple-two-levels` and `public-dto`;
  `SIMPLE_LIMITS.brief.maxParagraphs` 3 to 4 fails two cases in `simple-summary`.
- `npm run typecheck`: clean.
- `npm test` (55 minutes on a busy box): 1541 files passed, 7 failed. One was this change's: a
  link in `summaries.md` to a section not yet written, since written. Five are the fresh-worktree
  ones that need `npm run build` or `build:fleet` (`cold-start-lazy-imports`, `pdf-bundle-trace`,
  `fleet-composed-access`, `fleet-decisions-route`, `fleet-reports-route`). The seventh,
  `overseer-daemon-reports`, fails alone in this worktree too and touches nothing here; reported,
  not chased.

### Cost and wait, measured

Two cold writes on each of three articles, before (`high-none-fbazc1|c2`) and after
(`high-none-nosimple1|3`); `nosimple2` ran inside the cache's five minutes and is kept apart.

| article (body words) | before $ | after $ | before s | after s |
|---|---|---|---|---|
| s41598 (8.8k) | 0.239, 0.236 | 0.202, 0.200 | 29.3, 29.8 | 28.1, 27.9 |
| entropy (8.6k) | 0.258, 0.256 | 0.175, 0.211 | 41.2, 39.8 | 28.7, 45.0 |
| scaling-hypothesis (12.6k) | 0.275, 0.274 | 0.257, 0.252 | 31.7, 30.1 | 51.1, 33.9 |

Mean $0.256 to $0.216, about 16% cheaper in these six cold writes. Median wait 30.9 s to 31.3 s
moved little, but mean wait rose from 33.7 s to 35.8 s and the maximum from 41.2 s to 51.1 s.
The slow after-writes (51.1 s, 45.0 s) recorded 2.6k to 3.2k total reasoning tokens against about
1k on the fast ones. Those totals cover every writer and checker call; the files do not record
per-level timings, so they cannot attribute the delay to Fuller or rule out an effect from this
change. Identical retained prompts establish prompt preservation, not unchanged latency.
Six writes a side are too few to settle a latency effect. `nosimple2` is kept apart because it
ran within the cache's five minutes; its 87.2 s Fuller retry remains evidence that a retained
level can still stall the press.

### Stage 2: what landed

Built by an Opus subagent from § Stage 2 as amended by Sol's S1 to S7; I read the diff.

- `JobStep.preview` (`StepPreview`, one kind: `simple-brief`), `StepContext.preview`, and
  `stepPreviews` in `src/jobs.ts`: set and written once, awaited and deleted before the step
  settles on either path, deleted at step start and on a skip. Every failure of the write is
  swallowed, a stale attempt included: the step's own fenced commit says so if the claim moved.
- `simple.stamp` expects the stored summary's own prompt version (S1).
  `tests/freshness-deciders-agree.test.ts` asserted the queue and Metadata agree on a stale
  prompt version; they now differ on purpose for `simple`, pinned as an exact pair.
- `useSimple.preview`, held in the page's memory with its job id; `EarlyBrief` in `SimplePanel`.
- `PITCH.fuller`: five to eight paragraphs, about 500 words, never more than 600;
  `simple-prompt/8`. Brief's prompt hash is unchanged.
- New reader-facing words: "Brief is ready. Fuller is still being written."; "Fuller was not
  written, so nothing has been kept yet."; the empty state's "Brief appears first. Fuller follows,
  and can take up to about a minute."

Red first: six jobs cases, five panel cases and three prompt pins failed before the code. The S1
cases were written after the stamp line and proven by mutation. Mutations: no await of the preview
write fails the delayed-write case; a stamp that always returns the current version fails the S1
case; dropping the preview when the job leaves fails four panel cases.

### Stage 2: cost and wait, measured

Three articles, two cold writes each. `timed350a|b` is stage 1's prompt with per-level timing;
`timed500a|b` is the longer Fuller. Seconds from the start of the write to each level being final.

| article | Brief s, 350 | Fuller s, 350 | Brief s, 500 | Fuller s, 500 | Fuller words, 500 |
|---|---|---|---|---|---|
| s41598 | 17.0, 22.8 | 23.7, 37.9 | 13.8, 14.9 | 35.5, 34.3 | 505, 513 |
| entropy | 14.3, 12.3 | 27.2, 50.5 | 13.6, 12.3 | 28.6, 28.4 | 511, 490 |
| scaling-hypothesis | 26.1, 13.4 | 33.3, 63.5 | 26.4, 23.6 | 35.1, 36.8 | 438, 481 |

Median wait to Brief 15.6 s at 350 and 14.3 s at 500, computed from the unrounded milliseconds.
Median wait to Fuller 35.6 s and 34.7 s;
its range was 23.7 to 63.5 s at 350 and 28.4 to 36.8 s at 500. Mean cost $0.220 and $0.217.

What this does and does not show:

- Brief is final at 12.3 to 26.4 s in all twelve writes. These are generator timings;
  the job's start-up, preview write and browser polling add to the reader's wait.
- The slow writes are Fuller's: in every one of the twelve, Fuller was final last, and the two
  slowest (50.5 s and 63.5 s) had Brief at 12.3 s and 13.4 s. Stage 1's write-up could not say
  this.
- The longer Fuller had a lower median and mean wait here (mean 39.4 s at 350, 33.1 s at 500).
  261004b measured 55 s for it. The 63.5 s 350 write retried Fuller after a fidelity flag
  (`timed350b/scaling-hypothesis.json`: two attempts, stored attempt 2); none of the six 500
  writes retried. The 50.5 s 350 write records one attempt. Both slow writes belong in the
  end-to-end comparison, because readers wait for retries too, but this is not a controlled
  comparison of length alone. Six writes per arm do not bound the size of a latency effect
  or show that the longer Fuller costs no wait.
- One real press in a browser, a fourth article, through the job: Brief on screen at 26.3 s,
  Fuller stored at 55.9 s (517 words, eight paragraphs). The job's own start-up and one-second
  polling are in both numbers; one sample.

### Stage 2: the browser check

A Sonnet subagent with Playwright on the box, one paid press on an article with no summary. Brief
appeared with the progress row under it; Fuller's tab showed "Brief is ready. Fuller is still being
written." and none of Brief's text; across completion, 186 samples at 300 ms saw no empty band and
no change of wording; after a reload both levels loaded with no new job; no overflow at 390 px; no
page errors. Not seen: the empty state's new hint, because the press started the job at once.

### Stage 2: Sol's code review (approve), and its fixes

[The review](261004f-stop-writing-the-simple-summary-level-stage-2-code-review-sol.md). Five P1s,
all found and fixed by the reviewer inside the stage; I read the diff and ran the database-backed
tests it could not.

- **F8**: on Fuller, after the job ended and before the stored read landed, the band was empty.
  It now says the summary has not loaded yet, with a read-only retry.
- **F9**: retrying a failed read hid the remembered Brief while the status was `loading`.
- **F10**: a deadline pause, an expiry, a requeue and a cancel rebuild `steps` in SQL from the
  stored row, so a preview could outlive a settled step there. `settledSteps` in
  `src/store/pg-jobs.ts` now removes it. Postmortem
  [261004j](../postmortems/261004j-a-preview-spans-two-lifetimes-but-only-ordinary-endings-were-tested.md).
- **F11**: a requeue of the same job kept the last attempt's Brief on screen. The hook now tells
  attempts apart by `requeues` and takes a live preview only from a running step.
- **F12**: S1's rule had a hole: an unforced job still rewrote a stored summary whose recorded
  model differed from today's. The stamp now takes the stored model as well as the stored prompt
  version. Only the article moving, or a forced run, writes again.
- **F13 (P2)**: my measurement write-up claimed more than six writes a side can show, and left out
  that the 63.5 s write at 350 words had retried Fuller after a fidelity flag. Corrected.

Mine, after the review: a fixture uuid shared with another test file, and two header markers the
store-migration registry requires on a converted test file. Both were red in the full suite.

Gates at the end: typecheck clean; the 14 affected files, 669 tests, pass, Postgres ones included.
The full `npm test` ran while the reviewer was editing: 1539 files passed and 11 failed. Two of
the eleven files held the reviewer's own new tests, caught mid-fix, and one was a worktree test
that passes alone; the two above are fixed; the last six are the five fresh-worktree build tests
and `overseer-daemon-reports`, as in stage 1. It was not run again after the fixes.
