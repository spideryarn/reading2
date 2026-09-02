# Codebase rework: what is worth doing next — 2026-09-02

The first run of [improve-the-codebase.md](../reusable/improve-the-codebase.md), written the same
day. This is the umbrella doc that skill asks for: everything found, clustered, scored, and tiered —
**not** a commitment to do all of it. Tier 3's job here is to be named and sized, then left alone.

Produced by two Sonnet sweeps over `src/` (the "codebase already knows" grep and the duplication
genre sweep), plus `npm run check`, plus a churn × complexity ranking.

**Scope, stated because the review caught what it excluded:** `src/` only. That leaves out `scripts/`
entirely, which holds `gjd-remote.ts` (2,721 lines, 22 commits in 90 days), `deploy.ts` (1,514/14)
and `deploy-checks.ts` (1,085/13) — operational code that ships and breaks like any other. It also
leaves out anything only visible at runtime: static sweeps cannot see a race, which is why 0.1 came
from reading control flow and not from a grep.

The first draft of this doc said every finding had been re-verified by hand. **That was itself an
unverified claim**, and the GPT Sol review found several that had not been — see below. The table
that follows the numbers records which survived.

## What the numbers say

Churn × complexity over 90 days, top of the list:

| file | commits/90d | lines | product |
|---|---|---|---|
| `src/routes.ts` | 66 | 6,671 | 440k |
| `src/web/App.tsx` | 93 | 4,734 | 440k |
| `src/types.ts` | 54 | 2,947 | 159k |
| `src/db/schema.ts` | 45 | 2,999 | 135k |
| `src/pipeline.ts` | 46 | 2,753 | 127k |

Two files lead by a factor of three, and they are the same shape: one file with many reasons to
change. `npm run check`: typecheck, build, cycles and committed all clean; **test fails** (~14 of
477 files, the known state the worktree setup script warns about); 89 complexity findings, 259
clones, knip and lint non-empty by design.

**Size on its own is weak evidence and is not why these are here** — across ~45 postmortems, not one
names file length as the cause. `routes.ts` earns its place because it is *also* edited 66 times a
quarter and named in 18 postmortems; `types.ts` at 2,947 lines is declaration-only and fine.

## What the two GPT Sol reviews changed — 2026-09-02

Both reviews are in the tree
([plan](260902e-codebase-rework-umbrella-review-sol.md),
[code](260902e-stage1-code-review-sol.md)). The plan review's verdict was *"the prioritisation is
not right"*, and it was correct on every point I checked. What it changed:

| Sol's finding | Verified? | What changed |
|---|---|---|
| 0.1 is reachable and "pending reproduction" is a dodge — wave 2 already proved it and left a test recipe | yes | Promoted to confirmed Tier 0, below |
| The count is 7 of **8**, not 6 of 7 — `Tweets.tsx` too | yes — `useStepJob.ts:31` names eight surfaces; `Tweets.tsx` has 0 guard refs | Corrected |
| A missed Tier 0: `PATCH /api/chat/:slug/:threadId` 500s on a `null` body | yes — reproduced, red test first | **Fixed this run**, see 0.2 |
| 2.3 resurrects `stageCall`, which wave 2 explicitly rejected | yes — wave 2:193 says *"Do not build `stage-call.ts` or `stageCall`"* | `stageCall` deleted from the map |
| 1.2 is overvalued | yes — `db-migrate.ts:41` already imports both constants | Downgraded to low |
| "One export, one importer" for `routes.ts` is false | yes — 13 exports, 21 test files import them | Rewritten, prerequisite widened |
| The sweeps excluded `scripts/`, and missed a better `App.tsx` seam | yes — `App.tsx:3044` names five duplicated effects | Added below |

The code review said **keep the extraction** — behaviour-preserving, right home, no new dependency
edge, and don't build it on `blockHashQuery` because resolving the revision separately would let a
publication land between the two statements. But it found the new test **overstated what it proved**:
see 0.3.

## Tier 0

### 0.2 `PATCH /api/chat/:slug/:threadId` answered a malformed body with 500 — **DONE this run**

`routes.ts` destructured `readBody`'s result without checking it was an object. A body of bare
`null` is valid JSON, destructuring it throws a `TypeError`, and the generic handler reports that as
a **500** — a malformed request answered as a server fault, which is the shape a client bug takes
and would have been reported as ours.

**The codebase already knew, in as many words.** The search `PATCH` twenty lines away carries a
comment dated 2026-08-27 saying *"the same hole is latent in the other PATCH routes here"*. It was,
for six days, and the sentence was the only thing enforcing itself.

Rule 1 on the genre — all seven `PATCH` routes — gives the real shape: **four hand-written copies of
the identical four-line guard** (`patchShelf`, `patchReader`, the search and criterion PATCHes) and
**one route that needed it and had none**. Not "a hole in the others", as the comment said.

Fixed as one `objectBody()` beside `fields()`, which already owns "read this body as fields" and is
deliberately different — it coerces a non-object to `{}`, which is right where an absent key means
something and wrong where the field is required. Red test first: `null` gave 500, and `[]`, `"3"`
and `7` already gave 400, so the test covers the class and one member of it was failing.

### 0.3 The new SQL assertions pinned the words, not the relationship — **DONE this run**

The code review broke `sourceHashQuery` in one move — no `where` at all, and
`on articles.current_revision_id = articles.id` — and **all four new assertions passed** over a query
that would hash blocks from unrelated articles. `toContain('"current_revision_id"')` and
`/inner join/i` were both satisfied and neither meant anything: silent-success inside the test I had
just written to prevent it.

Now pinned as the whole `on` clause plus `where "articles"."id" = $1` and `toSQL().params`. The
broken query above was re-run against them and fails two.

### 0.1 Seven of eight job-backed read surfaces lack the race guard the eighth has

**Verified.** `useGlossary.ts` carries a `generation` / `inFlight` / `trailing` guard so a slower
opening GET cannot overwrite a job's completion GET. Grepping the whole genre:

| hook | guard refs |
|---|---|
| `useGlossary.ts` | 40 |
| `useIdeas.ts`, `useQuotes.ts`, `useTimeline.ts` | 1 each — all the substring "re*generation*" in prose |
| `useSketch.ts`, `useArc.ts`, `useQuiz.ts` | 0 |

So six of these seven have nothing, and `src/web/Tweets.tsx` — the eighth surface, missed in the
first draft — has nothing either. The three that scored 1 share a byte-identical comment line, which
is the copy-paste lineage showing through.

**And the drift direction is the trap the skill names.** The commit that gave `useGlossary` its
guard is `d5a4e03`, titled *"Three copies of a paragraph, one of which knew something the others did
not"* — the fix landed in one copy after the others were taken, which is exactly how this class is
minted.

**Confirmed Tier 0, and my "pending reproduction" hedge was wrong.** The plan review showed the race
is reachable by control flow — the opening effect starts `load()` while `useStepJob` can call the
same function on job completion, `useJobs` drains completions after commit, and nothing orders the
two responses — and, decisively, **wave 2 had already reached that conclusion and left a
deterministic test recipe** (`260828aj-simplification-wave-2.md:225` and `:239`). Treating it as an
unverified subagent claim ignored work already done and reviewed.

**And the count was wrong.** `useStepJob.ts:31` names **eight** surfaces, not seven — the eighth is
`src/web/Tweets.tsx`, which has the same unguarded opening load and completion reload and zero guard
references. So it is **seven of eight exposed**. Rule 1 caught me a second time in the same document,
and that docstring even carries a note about how a quantity a file asserts and nothing measures is a
perfectly good reason to believe something false.

**Still not fixed here.** The next stage is wave 2's reproduction, then 2.1 for all eight surfaces.
**Effort** M · **Value** high · **Risk** medium.

## Tier 1 — cheap, mechanical, evidence in hand

These three are one shape: **a comment states an invariant, and nothing checks it** —
[written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md).

### 1.1 `sourceHashFor` ×3 — **DONE this run, and it was not what the plan said**

The plan above said "add a parity test comparing the three copies". **That was the wrong fix**, and
finding out why is the most useful thing this run did.

First, Rule 1. The three comments each say "the third copy of this query". Greping the genre rather
than the list — `asc(revisionBlocks.ordinal)` and `treatment: revisionBlocks.treatment` — gives
**8 sites in 6 files**, not 3. Five of those are a different query (the 14-column render read) and
were correctly left alone. But the eighth is `blockHashQuery` at `pg.ts:1002`: **the same four-column
read, already extracted, already exported, and already tested** by `tests/store-block-reads.test.ts`,
which builds the SQL through `QueryBuilder` and needs no database. It was created after a GPT Sol
finding and the three copies were never migrated onto it.

So this was never "three copies wanting a test". It was **an unfinished extraction with the
destination already built**. A parity test would have been machinery whose only job was to protect
duplication — the exact over-engineering the skill warns about, and it would have felt productive.

What landed instead: `sourceHashQuery` and `sourceHashFor` exported from `src/store/pg.ts`, beside
`blockHashQuery`, which already owns this invariant — and which the three copies' own comments
already pointed at. All three files now import it; all three private copies are gone, along with the
imports that went dead with them (the typechecker found those, not me).

**Source −46 lines, tests +52.** Four new assertions on the generated SQL: the four columns, no HTML
or `fts`, `order by ordinal`, and the join reaching `current_revision_id`. Each was **proven able to
fail** — the order-by, the `role` column and the join column were each broken on purpose and the
matching assertion went red, then the break was reverted.

### 1.1b The original 1.1, as first written — kept for the record
`pg-searches.ts:139`, `pg-referee-claims.ts:124`, `pg-referee-criteria.ts:134`. Each one's own
comment says it is "the third copy of this query" and names the two things that must not drift: the
four columns `id,text,role,treatment`, and `order by ordinal`. They agree today. `grep -rn
sourceHashFor tests/` returns **0**. A drift makes `isStale` wrong for searches, criteria and claims
with nothing to say why.
**Effort** S · **Value** high · **Risk** low.

### 1.2 The migrations schema and table are two copies of one fact — **downgraded to low, not done**
`src/migration-digest.ts:169-170` exports `MIGRATIONS_SCHEMA` / `MIGRATIONS_TABLE`;
`drizzle.config.ts:36-37` hardcodes the same two strings independently. `migration-digest.ts`'s own
comment says the migrator "silently starts a FRESH history" if they disagree. Nothing compares them.
**The plan review was right that this is overvalued.** `scripts/db-migrate.ts:41` already imports
both constants and passes them to `migrate()`, and `npm run db:migrate` runs that script, not Drizzle
Kit — so the live path is already single-source. The only remaining copy is in a config file that
Drizzle Kit reads and that deliberately carries no credentials. Worth making `drizzle.config.ts`
import the constants; not worth a parity test, which would check a mostly inactive relationship and
could falsely imply the live migration call was protected by it.
**Effort** S · **Value** low · **Risk** low.

### 1.3 Two reader-facing strings bypass `messages.ts`, and their own comments say so
`referee-claims-run.ts:170` (`CLAIMS_UNUSABLE`) and `referee-criteria-run.ts:440`
(`ANSWER_UNUSABLE`) both say, near-verbatim, that they belong in `src/messages.ts` per
[copy.md](../project/copy.md), that this is known debt, and that `ai-unusable` should be registered
in `CODE_KINDS`. Neither is done. The comments also say skipping it has no symptom today — so this
is tidiness with a recipe already written, not a bug.
**Effort** S · **Value** medium · **Risk** low.

## Tier 2 — the extractions worth doing

### 2.1 `useArtefactRead` — the read half of seven hooks
Wave 2 §2.6, still unbuilt, and **grown from the 3–4 hooks that plan scoped to 7**. Each hook
re-derives status state, a `load()` of `apiFetch` → `readJson` → the don't-blank-a-good-list guard,
and pairs with `useStepJob`. This is the durable fix for 0.1: extract the *mechanism* (generations,
one in-flight read, `reload`/`refresh`), **not** a shared state shape —`useSketch`'s `faults` and
`useArc`'s `fromPayload` seed are real differences. Home: beside `useStepJob.ts`, which already owns
the job half. Needs browser checking.
**Effort** M–L · **Value** high · **Risk** medium.

### 2.2 `fetchOk` — 14 raw `!res.ok` sites left
Wave 2 §1.4, mid-migration: `fetchOk` is used in 5 files, and 14 other sites still hand-roll it
(`preview-live.tsx:78`, `link-facts.ts:276`, `SourceLink.tsx:133`, `FeedbackDialog.tsx:279,347`,
`live/useLiveConversation.ts:456,1264`, `live/wiring.ts:88,112`, `lib/supabase.ts:109`,
`Metadata.tsx:1008`, `chat/effects.ts:301,428`, `dictation-upload.ts:101`). One feature per commit,
as that plan already says.
**Effort** S per site · **Value** medium · **Risk** low.

### 2.3 `stageCall` / `articleSystem` — 10 hand-rolled `streamMessage` call sites
**`stageCall` is struck out. Wave 2 considered it and explicitly rejected it** — *"build
`articleSystem` in `article-prompt.ts`. Do not build `stage-call.ts` or `stageCall`"*
(`260828aj-simplification-wave-2.md:193`). My draft cited that plan as settling the design and then
proposed the thing it refused, which is the run's worst over-engineering failure: counting ten calls
to one API is not evidence of one abstraction. `labels` caches a batch prefix, `hierarchy` supplies a
prebuilt system/user pair, and the rest split between `articleText` and `articleWithIds`.

What survives is the narrow `articleSystem` candidate only, and its callers need re-counting before
anyone builds it.
**Effort** M · **Value** medium · **Risk** medium.

## Tier 3 — named and sized, then left alone

### 3.1 Split `src/routes.ts`
Top of churn × complexity, 18 postmortem mentions, and causal at least once (a `$`-anchored regex
that failed silently on any query string). ~5,200 lines of handlers, then a ~1,350-line dispatcher
whose own comment already calls itself "five hundred lines". The handlers group by resource —
comments, chat, search, quiz, referee, export.

**This plan's first draft said "one export (`handleApi`) and one importer (`src/vercel.ts`)". That
was false**, and it is the clearest verify-before-scoring failure in the run: I greped `src/` for
importers, found one, and never counted the exports at all. `grep -cE "^export " src/routes.ts` is
**13** — including test seams (`serveAuthenticatedApi`), parsers (`parseVisibilityRequest`,
`parseJobRequest`), `heartbeat`, `inTurnOrder`, and four orphan-grace constants — and 21 test files
import from it.

A route/method matrix is therefore **necessary and nowhere near sufficient**. It protects dispatch
only. It does not protect the request-wide owner and spend scopes (`routes.ts:5265`), the auth and
error/logging envelope (`serveAuthenticatedApi`), order-sensitive overlaps such as `/library/search`
against a valid `search` slug, or the module-level process state the resources own — `answering`,
`liveMessages`, `liveRuns`, and their sweeps.

So it stays Tier 3, and the prerequisite is bigger than one test: **inventory the exported seams,
the shared module state, the wrapper boundaries and the overlapping routes first**, then extract one
resource family per green commit, keeping the outer request envelope where it is. It wants its own
plan, not a line in this one.
**Effort** L · **Value** high · **Risk** medium — *not* "low once a matrix exists".

### 2.4 `App.tsx`'s five timeline effects are a second copy of the ideas rules
`App.tsx:3044` says so itself: the same five rules, and *"every one of them was got wrong once in the
ideas panel before it was got right"*. A shared hook is named there as the intended follow-up. The
plan review is right that this is a far better seam into `App.tsx` than "split a 4,734-line file",
and it should be tried before 3.2.
**Effort** M · **Value** high · **Risk** medium — needs browser checking.

### 3.2 `src/web/App.tsx`
4,734 lines and **93 commits in 90 days — the most-edited file in the tree**. Higher value than 3.1
and higher risk: it is UI, it needs browser verification at several widths, and it is the file peers
are most likely to have open. Do 3.1 first and learn from it.
**Effort** L · **Value** high · **Risk** high.

### 3.3 Delete the filesystem store
37 `SPIDERYARN_STORE` references across 14 `src/` files and 36 test files. **Already owned** by
[260831b-finish-the-database-move.md](260831b-finish-the-database-move.md) — listed here only so the
map is complete. Do not start it from this doc.

## Declined, with reasons

- **`useCriteria.ts` / `useClaims.ts`** are near-identical and should stay that way. Both headers
  already say what they kept and dropped from their source and why; the differences (tombstone,
  minted id, merge-vs-replace) are load-bearing. This is honest duplication.
- **Splitting `src/types.ts`** (2,947 lines) — declaration-only and browser-safe on purpose. Long,
  one reason to change.
- **The 259 jscpd clones and 89 complexity findings as a worklist.** Both tools' own banners say to
  read before acting. They fed the sweeps; they are not a backlog.

## A process finding from running this

I read `npm run check`'s summary through `| tail -40`, saw *"A gate failed"* next to `exited with
code 0`, and briefly believed the script's exit code was broken. It is not — `scripts/check.ts:219`
is `process.exit(gateFailed ? 1 : 0)`, and re-running without the pipe gives `REAL EXIT: 1`. The 0
was `tail`'s.

This repo already has a postmortem for exactly this (`260831c`, exit status belonging to `tee`
rather than the command), and the trap still caught a fresh reader of it. Worth knowing that reading
a gate through a pipe destroys the one thing you are reading it for.

## Stages, and where this run stops

**Landed, in this order:**

1. **1.1** — `sourceHashFor` ×3 into `pg.ts` beside `blockHashQuery`, with SQL assertions. `4726a94`.
2. **0.2 + 0.3**, both from the reviews — the chat PATCH 500, fixed with one `objectBody()` across
   five sites; and the SQL assertions strengthened after the review passed a broken query through
   them. `3fe721c`.
3. **The postmortem for 0.2, and the prevention it recommends** — a table over all seven PATCH
   routes × four non-object bodies, seen to fail against the reverted fix. `e632953`.

**Not started, in the order the plan review argued for:**

4. **Reproduce 0.1** with wave 2's recipe, then **2.1** for all eight surfaces — its durable fix.
5. **2.4**, `App.tsx`'s five duplicated timeline effects: the better seam into that file.
6. **2.2** (`fetchOk`, 14 sites) and the narrowed **2.3** (`articleSystem` only, callers re-counted).
7. **1.2** as a direct import in `drizzle.config.ts`, scored low. **1.3**, the two strings that
   bypass `messages.ts`.
8. **Tier 3** stays named and unstarted, and 3.1 now wants its own plan with the wider prerequisite.

Stopping here leaves the tree coherent: a live 500 is fixed and has a test that fails without it,
three copies of a query are one, four copies of a guard are one, a false claim in three files is
corrected, and everything not done is written down above with what is actually known about it.

## Stage 1, as it actually went — 2026-09-02

**Landed:** 1.1, in the form described above rather than the form planned. 1.2 and 1.3 were **not**
done and stay open — the run stopped at one cluster on purpose.

**Checks.** `npm run typecheck` clean. `tests/store-block-reads.test.ts` 16 passed, and the four new
assertions were each seen to fail against a deliberate break before being trusted. The referee,
criteria, searches and store-parity suites: 123 passed.

Full suite: **5 failed of 505 files, 8,685 tests passed.** All five are environmental in a fresh
worktree, and none touches the block-hash query:

| suite | why |
|---|---|
| `shelf.test.ts` | `data/test-store-wiring-fixture/blocks.json` is truncated mid-file |
| `store-roundtrip.test.ts` | the fixture corpus has no article carrying `quiz.json` |
| `store-artefact-manifest.test.ts` | same corpus gap |
| `doc-links.test.ts` | a 2026-08-28 plan links `../../data/reader.json`, absent from the worktree's fixture `data/` |
| `pdf-bundle-trace.test.ts` | needs a build to inspect |

`store-parity.test.ts` is worth a separate note: it **fails alone and passes in a batch**, on a
glossary-lookup assertion. `sourceHashFor` is used only by searches, claims and criteria, so it is
not this change; it is test isolation against the shared local Postgres, which is what
`260902c-make-the-test-suite-pass-reliably` is being written about elsewhere.

### What the run taught about the skill

- **Rule 1 was the whole value of the run.** Following the plan as written would have produced a
  parity test pinning three copies together. Greping the genre found the copies had a home already
  built and tested. The doc's instruction to count every instance before planning the fix is what
  turned a mediocre change into a good one.
- **"Verify each finding before you score it" was right, and one level short.** I verified the
  finding (three identical copies, no tests — all true). I had not verified *the proposed fix*, and
  that is where it was wrong. The doc should say the fix is a claim too.
- **The typechecker found the dead imports, not me.** Three files, six imports, all invisible in the
  diff I had just read.
- **I walked into a trap this repo has already written up.** See the process finding above.
