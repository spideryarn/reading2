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

Mean $0.256 to $0.216, about 16% cheaper. Median wait 30.9 s to 31.3 s: no change. **The expected
"moves little" held, and "cheaper" is smaller than a third**, because a cold write is mostly the
one cache write of the article. The slow after-writes (51.1 s, 45.0 s) are Fuller thinking longer
(2.6k to 3.2k reasoning tokens against about 1k on the fast ones), not anything this change did:
the prompts are the same bytes. Six writes a side cannot show a difference in wait smaller than
that spread.
