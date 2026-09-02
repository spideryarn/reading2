# Codebase rework: what is worth doing next — 2026-09-02

The first run of [improve-the-codebase.md](../reusable/improve-the-codebase.md), written the same
day. This is the umbrella doc that skill asks for: everything found, clustered, scored, and tiered —
**not** a commitment to do all of it. Tier 3's job here is to be named and sized, then left alone.

Produced by two Sonnet sweeps over `src/` (the "codebase already knows" grep and the duplication
genre sweep), plus `npm run check`, plus a churn × complexity ranking. **Every finding below was
re-verified by hand** at today's line numbers before it was scored — per the skill's own rule, and
because both previous waves' first drafts were materially wrong in places.

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

## Tier 0 — a live defect, pending one confirmation

### 0.1 Six of seven job-backed read hooks lack the race guard the seventh has

**Verified.** `useGlossary.ts` carries a `generation` / `inFlight` / `trailing` guard so a slower
opening GET cannot overwrite a job's completion GET. Grepping the whole genre:

| hook | guard refs |
|---|---|
| `useGlossary.ts` | 40 |
| `useIdeas.ts`, `useQuotes.ts`, `useTimeline.ts` | 1 each — all the substring "re*generation*" in prose |
| `useSketch.ts`, `useArc.ts`, `useQuiz.ts` | 0 |

So six hooks have nothing. The three that scored 1 share a byte-identical comment line, which is the
copy-paste lineage showing through.

**And the drift direction is the trap the skill names.** The commit that gave `useGlossary` its
guard is `d5a4e03`, titled *"Three copies of a paragraph, one of which knew something the others did
not"* — the fix landed in one copy after the others were taken, which is exactly how this class is
minted.

**Not yet promoted to a confirmed reader-facing bug.** The reachability claim — that opening one of
these panels while a job for the same article runs elsewhere can silently lose the finished result —
is the subagent's, and I have not reproduced it. **Reproduce it first**; if it fires, this is Tier 0
and gets a red test before anything else. If it cannot fire, the durable fix is still 2.1.
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

### 1.2 The migrations schema and table are two copies of one fact — **doing this run**
`src/migration-digest.ts:169-170` exports `MIGRATIONS_SCHEMA` / `MIGRATIONS_TABLE`;
`drizzle.config.ts:36-37` hardcodes the same two strings independently. `migration-digest.ts`'s own
comment says the migrator "silently starts a FRESH history" if they disagree. Nothing compares them.
Low probability of an edit, severe and silent when it happens.
**Effort** S · **Value** medium-high · **Risk** low.

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
Wave 2 §2.2, never built (`grep "stageCall\|articleSystem" src` is empty), and **grown from 5 sites
to 10**: `arc.ts`, `glossary.ts`, `ideas.ts`, `quotes.ts`, `labels.ts`, `tweets.ts`, `hierarchy.ts`,
`quiz.ts`, `timeline.ts`, `sketch.ts`, each with its own `cache_control` blocks. Home already
chosen: `article-prompt.ts`. Design already worked out in wave 2 — don't re-litigate it, build it.
**Effort** M–L · **Value** high · **Risk** medium.

## Tier 3 — named and sized, then left alone

### 3.1 Split `src/routes.ts`
Top of churn × complexity, 18 postmortem mentions, and causal at least once (a `$`-anchored regex
that failed silently on any query string). Structurally it is **one export (`handleApi`) and one
importer (`src/vercel.ts`)**: ~5,200 lines of handlers, then a ~1,350-line dispatcher whose own
comment already calls itself "five hundred lines". The handlers group cleanly by resource — comments,
chat, search, quiz, referee, export. Wave 1 named this as its Tier 3.1 and named the prerequisite:
**a route/method matrix test first**, because the existing route tests do not cover all branches.
With that test, this becomes a Tier 2 pure extraction. Nothing currently owns it.
**Effort** L · **Value** high · **Risk** medium (low once the matrix test exists).

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

1. **Stage 1 — Tier 1.1 + 1.2** (this run). One cluster, one shape: make two written invariants
   checkable. Red-first: each test must be seen to fail against a deliberate break.
2. **Stage 2 — reproduce 0.1** and promote or demote it. Not started.
3. **Stage 3 — 2.1**, which is 0.1's durable fix. Not started.
4. Tier 3 stays named and unstarted.

Stopping after Stage 1 leaves the tree better and coherent: an invariant that was prose is now
checked, three copies are one, and everything else is written down here for whoever picks it up.

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
