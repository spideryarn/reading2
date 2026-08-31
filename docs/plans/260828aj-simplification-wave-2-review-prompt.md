# Review request: a second simplification wave for Spideryarn

You are reviewing a **plan**, before any of it is built. Be adversarial. Your job is to find the
items that are wrong, mis-scoped, or dangerous — and to say which of them I should not do at all.

## Context you need

Spideryarn is an AI-assisted reading app: TypeScript + ESM, one server process, Postgres, React
client. Several agents edit the same working tree concurrently, so changes must be small and
independently committable.

Two days ago a first simplification audit ran (`docs/plans/260826m-simplification-audit.md`, attached
below in full). Six agents, reviewed twice — once by Fable, once by you. Its Tier 0, most of Tier 1
and §2.7 landed. Items 1.4, 1.5, 1.6, 1.8, the rest of Tier 2 and all of Tier 3 are still open.

I have just run a second wave: four agents over four areas, against the repo's own tools
(`npm run knip`, `npm run dupes` = jscpd, `npm run complexity` = biome cognitive complexity). I
re-checked every claim by hand before writing it down. The plan is attached.

## What I most want from you

1. **Which Tier 0 items are actually bugs, and which are me misreading the code?** I care most about
   being wrong here, because these are the ones I will fix first. In particular:
   - 0.1 says `npm run labels` spends money outside the ledger. Is the fix really one line, and is
     the proposed gate the right shape — or will a test that greps for `withLedger` near an
     `isMain` guard be the kind of check that goes quiet when defeated?
   - 0.2 says a failed background reload blanks the reader's list in ideas and tweets. I reasoned
     from render conditions and the call graph, not from a browser. Is the reasoning sound? Is
     `useSummaries` really only latent?
   - 0.4 says four guards in the search stream have never been executed by a test. Verified by
     grep (`tests/search-stream.test.ts` has zero occurrences of `timeoutMs`/`stallMs`). Is adding
     five tests the right first move, or is there a cheaper way to get the same assurance?
   - 0.6 says a documented seam is wired to nothing. I am proposing to fix only the comment and
     leave the wiring, because it is another agent's tracked work. Is that the right call, or is
     leaving `sweep()` uncalled a thing that needs escalating now?

2. **Which Tier 2 extraction would you refuse?** Wave 1 got this wrong in both directions — it
   declined a streaming transport it should have scheduled, and it proposed a two-panel merge both
   reviewers rejected. I would rather cut one than build one that has to be unpicked. My own
   instinct is that 2.6 (`useArtefactRead`) is the riskiest and 2.2 (`stage-call.ts`) is the one
   whose value I am most confident in — tell me if that is backwards.

3. **Is the ordering right?** Specifically: is it correct to make 0.4's five tests a hard
   precondition for 2.3, and to make 0.2/0.3 a precondition for 2.1?

4. **What have I missed that is in the same genre?** Wave 1's Rule 1 was "grep the genre, not this
   list", and its own numbers were still low on all four counts I re-measured (fence parsers 5→8,
   readiness probe 7→29, `partsOf` 2→3, entrypoint guard 4→5 spellings). Assume I have undercounted
   again and tell me where.

5. **Anything in "What not to do" that I should in fact do**, or vice versa.

## Things to know about my evidence

- The fence-parser equivalence claim in 1.1 is from an actual experiment: I ran both spellings over
  eight awkward inputs (bare fence, `json` fence, CRLF, backticks inside a string, missing close
  fence, prose before, prose after, no fence) and they agreed on all eight. I am confident in that
  one.
- The readiness-probe table in 1.3 is a measured count over all 29 files, not an estimate.
- The 0.2 timeline is from `git log`: `useSummaries` 2026-08-26 (`4f0b781`), `useIdeas` 2026-08-27
  (`2ce519d`), the glossary guard 2026-08-28 (`43a8285`).
- Baseline: `npm test` gives 269/270 files passing; the one red file has another agent's
  uncommitted red-first work in it. `npm run typecheck` clean. Local Postgres up.
- I have NOT run a browser. Anything depending on what a reader actually sees is reasoned, not
  observed, and I have said so where it applies.

Be specific and name files and line numbers. If a finding is wrong, say so plainly rather than
softening it. If an item is right but the proposed fix is wrong, the fix is what I want corrected.

---
# ATTACHMENT 1 — the new plan (docs/plans/260828aj-simplification-wave-2.md)
---

# Simplification, wave 2 — 2026-08-28

A second pass over the same ground as
[260826m-simplification-audit.md](260826m-simplification-audit.md), two days later. Four agents read four areas
against the repo's own tools (`npm run knip`, `npm run dupes`, `npm run complexity`), then every
claim in here was re-checked by hand.

**Read wave 1 first.** This is a continuation, not a replacement. Wave 1's Tier 0, most of Tier 1,
and §2.7 landed; 1.4, 1.5, 1.6, 1.8, the rest of Tier 2 and all of Tier 3 are still open, and
several items below are those items made concrete rather than new discoveries.

## The through-line this time

Wave 1's was *the codebase already knew*. This one is narrower and more uncomfortable:

**A fix applied to one copy does not reach the others, and nothing notices.** Three of the five
findings in Tier 0 are the same event — a guard, a ledger line, or a test that exists in the
original and is missing from the copy that was taken from it. In two cases the copy was taken
*days* before the fix landed in the original, so the drift was created by the act of fixing.

That is not an argument for extracting everything. It is an argument for extracting **the places
where a fix has already failed to propagate once**, and leaving alone the places where the
duplication has been stable.

## Wave 1's Rule 1 was right a third time

Wave 1 said: *"grep the genre, not this list"*, because its own first draft undercounted every
duplication it found. Wave 1's corrected numbers are still low. Counted by hand this time:

| | wave 1 said | actually |
|---|---|---|
| Fence-stripping parsers (§2.2) | "five, not four" | **eight** — `arc:193`, `ideas:723`, `glossary:1006`, `labels:782`, `search:417`, `summarise:587`, `toc:324`, `tweets:312` |
| Postgres readiness probe (§2.1) | "six copies and a variant" | **29 test files** |
| `partsOf` imported out of `arc.ts` (§1.5) | two files | **three** — `glossary:44`, `ideas:51`, `tweets:32` |
| Entrypoint guard (§1.6) | "12 sites, four spellings" | 41 `import.meta.url` sites; **five** spellings of the guard |

And one documentation number is simply stale: `CLAUDE.md`, `architecture.md:15-17` and
`database.md` all say **two** of seven stages cache on a content hash. It is **four** — tweets,
glossary, summary and ideas, all reaching the one `hashBlocks` in `src/source-hash.ts:49`. This is
documentation drift, not a correctness divergence; the four agree, and `ideas` differs on purpose
(`source-hash.ts:66-80`).

---

## Tier 0 — five live defects

Each gets the treatment AGENTS.md requires: a failing test first, then the fix.

### 0.1 `npm run labels` spends money outside the ledger

`src/labels.ts` ends with:

```ts
if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {
  await main();
}
```

No `withLedger("cli", …)`. **It is the only one of the seven stage CLIs without it** — `arc`,
`glossary`, `ideas`, `summarise`, `toc` and `tweets` all have it. `main()` (`labels.ts:1601`) calls
`generateLabels`, which calls `streamMessage` per batch (`labels.ts:1141`), so
`npm run labels -- <dir>` makes N paid calls that never reach `npm run cost`, and
`unscopedCalls()` (`ai-spend.ts:460`) counts them as fallen on the floor.

`src/cli-ledger.ts:1-7` states the intent it misses:

> **Run a CLI command with the ledger open**, so that `npm run toc` is money that appears in
> `npm run cost` rather than money that vanishes. One line at each stage's `isMain`, rather than a
> `collectSpend` folded into seven bespoke `main()` bodies.

**This is the concrete cost of the duplication: the one file that did not copy the shared tail is
the one that leaks.**

**Why the existing gate did not catch it, and this is the important half.**
`tests/no-undeclared-spend.test.ts` asks *"does this file have the capability to spend money, and
is it declared?"*. It does not ask *"does this entrypoint open the ledger?"*. Those are different
questions and the gate structurally cannot see the second one. So the fix is two things:

- **Do:** add `withLedger("cli", main)` to `labels.ts`.
- **And:** a test that every `src/*.ts` file with an `isMain`-style guard *and* a paid call routes
  its `main` through `withLedger`. That is what catches the class. Watch it go red against
  `labels.ts` before fixing it — a gate that has never been seen to fail is not evidence.

**Effort** S · **Value** high · **Risk** none.

### 0.2 A failed background reload blanks the reader's list — ideas and tweets

`useGlossary.ts:224` carries a guard and a paragraph explaining it:

> **A failed revalidation must not take the list away.** … a reader who opened the band over a
> perfectly good list, on a flaky connection, watched it vanish and be replaced by a message — the
> opposite of "revalidate behind what is on screen". Only the opening read has nothing to fall back
> on. GPT Sol, reviewing the built code.

```ts
setStatus((was) => (was === "loading" ? "error" : was));
```

`useIdeas.ts:108-111`, `useSummaries.ts:111-114` and `Tweets.tsx:123-125` all do the unguarded
thing instead — `setStatus("error")`.

`load()` is not only the opening read: `useIdeas.ts:124-129` calls it again from `onFinished` every
time an ideas-writing job completes. So: reader is in ideas mode with a list on screen → a job
finishes → `load()` → that GET fails → `setStatus("error")` → `IdeasPanel.tsx:171` renders the list
only under `status === "ready"`, so **the list disappears**. The `ideas` state is still populated
underneath; nothing draws it.

`Tweets.tsx` is live in the same way (`Tweets.tsx:268`). `useSummaries` is **latent** —
`SummaryPanel.tsx:230` keys off `summaries !== null` rather than `status`, and says so at
`:226-229` — but it is one edit from becoming live, so fix it too.

**The timeline is the finding.** `useSummaries` was written 2026-08-26 (`4f0b781`), `useIdeas`
2026-08-27 (`2ce519d`), and the glossary guard landed 2026-08-28 (`43a8285`). The fix arrived in
the original **after** both copies were taken. Nothing propagated it and nothing could have
noticed.

**Effort** S · **Value** high · **Risk** none. The red-first tests already exist to copy:
`tests/glossary-one-fetch.test.tsx:369` *"keeps the list when a background revalidation fails"* and
`:386` *"still reports a failure that leaves us with nothing"*. There is no test file for
`useIdeas` or `useSummaries` at all, so this is also the first one.

### 0.3 `useIdeas` tells the reader something false about a refused job

`useIdeas.ts:193`:

```ts
failed: postFailed ? "The request did not reach the server." : stopped,
```

The other three all say `postFailed ? (queue.error ?? "Couldn't start the job.") : stopped`
(`useGlossary.ts:620`, `useSummaries.ts:204`, `Tweets.tsx:230`). `postFailed` is `started === null`,
and `useJobs.run` returns `null` via `act` (`useJobs.ts:422-433`) for **any** throw — including
`readJson` throwing on a 4xx/5xx from `POST /api/jobs`.

So a job the server **received and refused** — quota, auth, a bad step — is reported to the reader
as *"The request did not reach the server."*, which is a false claim about what happened, and the
server's own `{ error }` message is thrown away.

This is the same shape as wave 1's `kind` bug: *a rule can be documented, implemented and tested
and still not reach the screen.* The `queue.error`-at-render-time trick is written out twice
(`useSummaries.ts:198-203`, `useGlossary.ts:615-619`) as something *"Learned on the thread page,
met again in the glossary"*. `useIdeas` never learned it.

**Effort** XS · **Value** medium-high · **Risk** none.

### 0.4 Four guards in the search stream have never been seen to fire

`tests/search-stream.test.ts` never passes `timeoutMs` or `stallMs` — verified, the file contains
zero occurrences of either — and never asserts a non-2xx. So `findPassagesStream`'s deadline, its
restartable stall clock, its clean-abort race guard and its premature-EOF guard have **never been
executed by a test**. `tests/explain.test.ts` has no non-2xx test either.

This is precisely the shape that already cost this repo a postmortem:
`docs/postmortems/260826e-converse-stall-misfiled-as-incomplete.md` — guard 2 existed in `explain.ts` and
not in `converse.ts` for four months, with a plan sentence noting the gap and nothing tracking it.
`converse.ts:1631-1640` says so in the file itself.

**Do:** five tests, copied from the ones that already exist for the other two paths — deadline
(`tests/explain.test.ts:236-243`), stall (`:260-272`, a body that opens and says nothing; a mock
made of whole frames cannot produce this), premature EOF (`:146-153` plus the `finish_reason`
second witness at `:155-163`), non-2xx (`tests/converse-stop.test.ts:593-620`), and the missing
non-2xx for explain.

**This is the precondition for everything in Tier 2's streaming work** — it is the net. Do it
first even if none of the extraction happens.

**Effort** S · **Value** high · **Risk** none — tests only.

### 0.5 A false comment is protecting dead code

`pipeline.ts:1256-1257`:

> That function is still exported from src/glossary.ts because its CLI uses it; nothing in the
> pipeline calls it any more.

`glossaryIsCurrent` (`glossary.ts:735`) is **not** called by glossary's `main()` (`:1283-1331`).
Its only callers are `tests/glossary.test.ts:419-443`, which is why knip cannot see it — the tests
keep it alive.

Left alone, the comment stops the next person deleting it, and it will be believed. Either delete
the function with the `stamp` migration (2.4 below) or correct the comment. **Correct the comment
now** regardless, because it is wrong today and costs nothing.

**Effort** XS · **Value** medium · **Risk** none.

### 0.6 The revision seam says it is wired, and nothing calls it

**Not ours to fix — someone else's step 11 — but the doc must not stand.**

`src/store/revisions.ts:24-52` says:

> **Wired:** a job opens a draft, records each step it runs against it, and publishes or fails it.
> Real rows, real carry-forward, real publication guard.
>
> **Not wired: the artefacts.** … So under `SPIDERYARN_STORE=postgres` an ingest today ends with
> one `warn` line and a failed draft, and the reader stays on the revision they had.

No job opens a draft. `revisionLifecycle` (`revisions.ts:267`) is referenced by exactly one thing in
the repo — `tests/store-guarded.test.ts:78`. `src/jobs.ts` contains the word "draft" once, in a
comment about something else. So the carefully-reasoned half-wired state the header describes —
the empty draft, the refused publish, the warn line — **cannot happen**, because nothing calls
`begin()`.

`src/store/artifacts-pg.ts` (1275 lines) is the same: no production importer. `src/jobs.ts:57`
imports `fsArtifacts` unconditionally, with no `STORE` switch — though `jobs.ts:101` *does* switch
the **job** store on `STORE`, so the two halves disagree.

The sting is in the commit that created the seam, `457fa74` — *"Give the revision adapter a seam,
because nothing was calling it"*:

> pg-revisions.ts already had beginRevision, recordStepRun, publishRevision, failRevision and
> sweepAbandonedDrafts, and no caller anywhere. **That is the worst state in this migration: the
> work looks finished from the outside and the running code has never once gone through it.**

The commit names the failure exactly, and then produces another instance of it one level up. Its
`--stat` is one file, 259 insertions, and no change to `jobs.ts`.

Consequence beyond the doc: `sweep()` for abandoned drafts (`revisions.ts:217`) has no production
caller either, and `ABANDONED_DRAFT_MS`'s own note says *"Each abandoned draft carries a full copy
of the article's `revision_blocks`, so this is storage rather than tidiness."* That is currently
masked by nothing creating drafts — **wiring the seam makes the leak live**, so the two must land
together.

**Do now:** correct the header so it says what is true. **Do not** attempt the wiring — it is
tracked as step 11 on somebody else's list and they are editing those files. Flagged here, as wave
1 flagged the split store, so it is not lost.

**Effort** XS for the doc · **Value** high · **Risk** none.

---

## Tier 1 — cheap, mechanical, evidence in hand

### 1.1 `stripFence` — eight copies into `src/parse-json.ts`

Eight sites, two spellings: `.replace(/```$/, "").trim()` and `.replace(/\s*```$/, "")`.

**Checked by experiment rather than by eye** — both spellings were run against eight awkward
inputs (bare fence, `json` fence, CRLF, backticks inside a string, a missing close fence, prose
before, prose after, no fence at all) and they agree on every one. The divergence is accidental,
not meaningful, so unifying is a pure dedup with **no behaviour change**.

All eight already feed `parseJsonFrom` (or, in `search.ts`, a `JSON.parse` wrapped so the input
cannot escape), so wave 1's §1.3 privacy sweep is intact and this changes nothing about it.

`src/parse-json.ts` is the right home — wave 1's Rule 2, and its 60-line header already owns the
invariant.

**Effort** S · **Value** medium · **Risk** very low.

*Bonus, and the real prize:* the ~15-line comment explaining the privacy reasoning is copy-pasted
verbatim into `arc.ts`, `glossary.ts`, `toc.ts` and `tweets.ts`, and `labels.ts` has its own longer
version. Those paragraphs collapse into the one module that is actually about it.

### 1.2 `readJson<T>` — four byte-identical copies into `src/parse-json.ts`

`glossary.ts:710`, `summarise.ts:781`, `ideas.ts:497`, `tweets.ts:111`. Six lines, byte-identical.
Leave `api.ts:100` (collects unreadable paths) and `store/import.ts:155` (returns `undefined`) —
genuinely different.

**Effort** XS · **Value** low-medium · **Risk** none.

### 1.3 The Postgres readiness probe — 29 copies, and three of them still carry the bug

Wave 1 §2.1 called this "six copies and a variant". It is **29 test files**. Measured:

| | count | files |
|---|---|---|
| Still on the **2s** timeout the incident was about | **3** | `db-schema`, `db-schema-drift`, `admin-store` |
| Skip **silently** — no `console.warn` at all | **5** | `admin-store`, `db-schema`, `store-job-draft`, `store-jobs-parity`, `store-uploads-parity` |
| Both at once | **2** | `admin-store`, `db-schema` |

`store-parity.test.ts:196-201` is the file that records why 10s, and it is worth quoting because
two of the silent five are themselves parity suites:

> At 2s this probe timed out under nothing worse than a dev server holding connections, and the
> whole suite skipped — inside a run that still printed a green "1103 passed". A parity suite that
> opts itself out when the machine is busy is worse than one that fails, because the signal it
> gives is indistinguishable from success.

**Do:** a *parameterised* probe — the table name and the extra check differ legitimately
(`admin-store` also needs `auth.users` readable, `store-shelf-pg` probes the `fts` column). It must
preserve module-load timing, and it must warn. Migrate a few files per commit.

**Effort** M · **Value** high · **Risk** low — the DB is up locally, so this is verifiable.
Note `store-jobs-parity.test.ts` currently has 111 lines of another agent's uncommitted work;
leave that file until last.

### 1.4 `fetchOk` — wave 1 §1.4, still unlanded

`src/web/lib/http.ts` does not exist. 17 hand-rolled `if (!r.ok)` sites across 11 files under
`src/web/`. Wave 1's scoping stands unchanged, including the exclusions (the streaming variants).
**Migrate one feature per commit.**

### 1.5 The five knip exports, and two false comments

- Drop the five unused status-type exports (`useGlossary.ts:31`, `useIdeas.ts:30`,
  `useProjection.ts:35`, `useSimilar.ts:37`, `useSummaries.ts:33`). Five near-identical types at
  near-identical line numbers in five files is the copy-paste tell, not a coincidence.
- `spineWidth` (`layout.ts:116`) and `GUTTER_PX` (`ContextPanel.tsx:53`) — wave 1 §1.7 held these
  back because another agent had the files open. Both are still flagged. Re-check the files are
  quiet, then drop the `export` (both are used inside their own file, so this is `export` removal,
  not deletion).
- **Correct, do not delete**, the comments at `useSimilar.ts:62-68` and `useProjection.ts:71-76`.
  They claim *"the reader can move to another article without this component unmounting"*. That is
  **false as the app is wired**: `App.tsx:565` keys the article components on the slug, so a slug
  change remounts. Keep the code — it is cheap and correct — but a false claim about reachability
  will be believed.
- `ideas.ts:910-919` says `loadEnvLocal()` is a gap the other stages have — all six now call it.
  The gap closed; the comment did not.

**Effort** S · **Value** medium · **Risk** none, given the re-grep.

### 1.6 Dead code knip cannot see, because only tests keep it alive

knip counts `tests/**` as a consumer, so anything imported only by a test is invisible to it. That
is where these were found.

- **`src/store/contracts.ts:259` `JobStore` is a stale duplicate of a superseded API.** Two
  `JobStore` interfaces exist. The live one is `src/store/jobs.ts:116`. This one is imported by
  nobody and declares a *different* API — `claim(attemptId, leaseMs)`, `rescueExpired()`,
  `get(id)` — against the real `claim(id, owner, attempt, leaseMs)`, `failExpired()`,
  `get(id, owner)`. Actively misleading. **Delete** (~40 lines with its doc block).
- **`src/chat.ts:698` `editTurn` is the *unsafe* version of a rule that was deliberately moved.**
  No caller. Superseded by `fsChatStore.edit` (`store/fs.ts:245-283`), which does the same work
  **plus** the `expectedTailId` tail check inside the mutex — the guard `editTurn` lacks, and whose
  absence is the exact bug `store/fs.ts:246-254` records GPT Sol finding. A dead function wearing
  the obvious name, missing the safety check. **Delete** (~50 lines), and fix the stale references
  at `routes.ts:1222` and `store/fs.ts:247`.
- **`src/web/preview-colour.tsx`** — its own header says *"Delete when the check is done; it is not
  in the router and nothing links to it."* Tracked in git, so recoverable. Delete the file, not the
  habit — the throwaway preview page is a pattern worth keeping.
- **`grantIsOver` and `MAX_UPLOAD_BYTES` re-export lines** in `upload-records.ts:119,182`. The
  functions stay; only the unreferenced re-exports go. **Do not touch `source.ts:186`'s re-export of
  `MAX_UPLOAD_BYTES`** — `pipeline.ts:41` uses it.

**Three things I asked about specifically came back clean**, and they are worth recording because a
wrong answer would have been a hole: the embed allowlist **is** applied (`sanitize-policy.ts:82` →
`:505`); the upload size cap **is** enforced; and the pricing correction **is** applied
(`US_INFERENCE_MULTIPLIER` at `pricing.ts:372`, `MODEL_ALIASES` at `:254`, `PRICE_CHECKED` stamped
into `priceVersion` at `:447`). knip was flagging re-exports and citations, not unenforced policy.

**Effort** S · **Value** medium · **Risk** low, given a re-grep before each delete.

### 1.7 Two notions of "matches", where the code says there must be one

`src/library-search.ts:60` states the contract:

> Exported, along with `fold` and `occurrences` below, for src/chat-tools.ts — chat's
> `search_article_words` runs this same matcher over the one article the reader has open. It imports
> them rather than reimplementing them… a reader typing words into the library box and asking chat
> about the same words must get the same notion of "matches", and the way to be sure of that is not
> to have two notions.

`src/chat-tools.ts:59` imports `{ fold, parseQuery }` — **not `occurrences`**. It counts with
`termPattern` regexes instead (`chat-tools.ts:528`, `term-match.ts:75`), which apply
`BEFORE`/`SUFFIX`/`AFTER` boundary guards. `occurrences` (`library-search.ts:110`) is a bare
`indexOf` substring scan. So "cat" in the library box counts hits inside "category"; asking chat
the same words does not.

This is why knip called `occurrences` unused: the export exists *to guarantee* one notion, and the
caller it was exported for does not use it. **A wiring bug, not dead code.**

Not confirmed end-to-end — no failing case was built, so treat the severity as open. **Do:**
build the failing case first. Then either route `chat-tools` through `occurrences`, or decide the
boundary-guarded count is the right one for both and say so where the comment now claims otherwise.

**Effort** S to confirm · **Value** medium-high · **Risk** low.

### 1.8 The two Sentry packages we import are undeclared; the one we declare is unused

`src/monitoring.ts:67` imports `@sentry/node-core/light`; `src/monitoring-scrub.ts:18` imports
`@sentry/core`. Neither is in `package.json`. Both resolve only as transitive dependencies of
`@sentry/node` — which nothing imports, and which `monitoring.ts:108-121` explains at length is
deliberately not imported because it drags in OpenTelemetry and costs ~80 ms of cold start.

So a Sentry release that reshuffles its own dependency tree breaks production error reporting, with
no local signal. **Swap `@sentry/node` for explicit `@sentry/node-core` + `@sentry/core`.** Same
class, lower stakes and test-only: `@tanstack/table-core` and `@babel/types`.

**Effort** XS · **Value** medium · **Risk** none.

### 1.9 `SPIDERYARN_ORIGINS` is never set, so half a doubled defence is inert

`sanitize-policy.ts:292` reads it to decide whether an absolute URL is our own API. It appears in
one test and is **not** in `.env.example` or `deployment.md`. So server-side, `isOwnApi` cannot
recognise the production origin and falls through to the localhost fallback at `:297`.

The defence still holds at render time — the browser pass uses `location.origin` (`:296`), which is
exact. But the file's own header calls out this failure mode: *"two half-policies… looks like
defence in depth"*. **Either set it on Vercel and document it, or say in the file that the server
pass cannot do this one.** Not a live hole; do not report it as one.

**Effort** XS · **Value** low-medium · **Risk** none.

---

## Tier 2 — the extractions worth doing

Ordered so that each one's net is in place before the next depends on it.

### 2.1 `useStepJob` — the job half of four hooks

`useGlossary`, `useIdeas`, `useSummaries` and `Tweets.tsx` each contain the same five pieces in the
same order: a `writesX(job)` predicate, an `onFinished` wrapper, a `useJobs(...)`, a `job` memo,
and `postFailed`/`startedId`/`stopped`/`failed`. Byte-identical apart from the step name.
jscpd finds three of the four copies; it misses `Tweets.tsx` because that one is inline in a
component.

```ts
export function useStepJob(slug: string, step: StepName, onFinished: () => void): StepJob;
```

Deletes ~120 lines of code and about as much again of duplicated prose — the poll-cost paragraph,
the "two quite different silences" paragraph, and the `queue.error`-at-render trap all get written
once. **0.3 stops being possible to get wrong.**

Careful: `force` must stay `force: [step]` naming the step, not a bare boolean, because `ideas` is
in `FORCE_ONLY_WHEN_NAMED` (`useIdeas.ts:156-166`).

**Effort** M · **Value** high · **Risk** low — pure lift-and-shift of already-identical code. Do
0.2 and 0.3 first; their tests are this extraction's net.

### 2.2 `src/stage-call.ts` — the article-reading model call

Five stages hand-roll the same request and response handling. This is wave 1 §2.2 made concrete,
and it is bigger than §2.2 described: concerns C–G in the trawl, ~400 lines across seven files
down to ~130.

Two functions — `articleSystem(...)` for the system blocks and `stageCall(...)` for the call — with
`onTruncated` as a parameter so `labels.ts` keeps its `BatchIncomplete` and the 25 lines at
`labels.ts:1180` arguing for it.

**The reason to do this is not the line count.** Four separate copies of *"the article block goes
first, and carries `cache_control` only when asked"* is a `cache_read_input_tokens: 0` waiting to
happen, and `article-prompt.ts:12-36` is a postmortem about exactly that failure being invisible.
`ARTICLE_RENDERER` (`models.ts:815`) records which stage sends ids and which sends text, and
`tests/article-cache-group.test.ts:52` asserts the table agrees with itself — but **nothing asserts
that `ideas.ts` actually calls `articleWithIds`**. A shared helper that reads the table turns a
comment into a fact.

**Write the test first and watch it go red against a deliberately broken version.** The failure
modes here are all silent: system blocks reordered → cache never hits, no error, bigger bill;
`cacheArticle` dropped → same; `wasRefused` lost → a refusal becomes an empty-but-valid artefact.
Nothing in `tests/` mocks `src/messages-stream.js` today, and none of the five stage test files
calls the generate function at all.

**Effort** M-L · **Value** high · **Risk** medium — mitigated entirely by writing the test first.

### 2.3 `roundClock()` and `endOfStream()` in `src/openrouter-stream.ts`

Wave 1 §3.4, narrowed. Part of §3.4 has since landed: `src/ai-call.ts` now owns the key, endpoint,
headers, provider errors and the spend record, and §0.1's stall guard shipped. What is left is the
layer between transport and billing — the clocks, and the three post-loop guards — which is exactly
the layer that drifted, because it belongs to neither module.

- `roundClock(signal, deadline, stallMs)` — the two-clock setup, byte-identical in `explain` and
  `search`, and split across two places in `converse` on purpose (a tool taking eight seconds is
  not a stalled stream, `converse.ts:1168-1177`). **The deadline is a parameter, not created
  inside** — that is what lets converse keep one deadline per turn and a fresh clock per round.
- `endOfStream(...)` — the three post-loop guards, 22 lines × 3. **This is the one worth doing**:
  it is where the bug actually happened, and it needs only two callbacks.
- Bundle `collectCitation()` with the first: `explain.ts:564-574` and `converse.ts:1487-1497` are
  character-for-character identical, and are the largest single clone in the repo.

**Do 0.4 first.** Extend `openrouter-stream.ts` rather than minting a module (Rule 2); pass the
logger in as a parameter so it stays free of `src/log.ts`.

**Effort** M · **Value** high · **Risk** real — these are the highest-stakes paths in the app,
which is why 0.4 comes first.

### 2.4 Finish the `stamp` migration, and give `arc` one

Not duplication, but the cheapest correctness win in the pipeline, and `pipeline.ts:350-364`
already specifies it: `stamp` was meant to replace `isDone`, the reason both remain has "gone", and
what is left is one line here and one deletion in each stage.

- `tweets` and `summary`: `isDone` → `stamp`; delete `threadIsCurrent` and `summariesAreCurrent`.
- `arc` and `toc` have **no** freshness check at all — they are "cached" by the file existing.
  `arc` needs `PROMPT_VERSION` exported (`arc.ts:45`, currently module-private) and a four-line
  `stamp`. The `PipelineStep.stamp` docstring already says this is "four lines rather than a whole
  function".

Flagged, not scheduled: the glossary's `stamp` has no `profileHash`, but `existingFor`
(`glossary.ts:360`) compares one to decide whether the list may be appended to — so the pipeline
can call a glossary current that the stage itself would refuse to append to. And `effortFor` reads
`SPIDERYARN_PIPELINE_EFFORT` (`models.ts:823`), which changes the answer and is in no stamp.
Dev-only, but it means `SPIDERYARN_PIPELINE_EFFORT=low npm run glossary` writes an artefact every
freshness check calls current.

**Effort** M · **Value** medium-high · **Risk** low — `tests/pipeline-artifact-store.test.ts`
covers the freshness wiring.

### 2.5 `stageCli` and one `isMain`

Wave 1 §1.6, and 0.1 is the argument for it. Five spellings across 41 sites; the
`endsWith(basename)` form at `fetch.ts:1314` and `toc-flatten.ts:92` is the one that six other
files' comments explicitly call wrong.

`stageCli(import.meta.url, main)` folds the guard and `withLedger` into one line, which makes 0.1
structural rather than a thing to remember.

**Wave 1's warning is the important part: a faulty helper makes every CLI silently do nothing.**
Unit-test same-basename files, paths with spaces, URL-encoding and a missing `argv[1]` **before**
migrating any caller.

**Effort** S + tests · **Value** medium · **Risk** low with tests, high without.

### 2.6 `useArtefactRead` — the read half

Deletes ~90 lines and closes the same-slug race that `useIdeas`, `useSummaries` and `Tweets` have
none of. `useGlossary.ts:64-78` states the problem precisely — *"`live` guards a slug change. It
cannot order two operations on one slug"* — and glossary is the only one of the four that handles
it, via `generation`/`inFlight`/`trailing`.

Collapsing the six `useState`s to one `data` also makes `useSummaries`' 404 branch forgetting two
fields structurally impossible.

**Do 2.1 first.** This one changes behaviour — three hooks gain dedupe, trailing fetches and
generation guards they never had — so it wants its own review before it is built.

**Effort** L · **Value** high · **Risk** medium.

---

## What not to do

Taken seriously, and declined:

- **One parameterised `converseOrExplain()`.** Wave 1 §3.4 says so and is right. The three verbs
  make three different promises to the reader about the stop button, and unifying them would be a
  false unification. The stop policy alone: chat stores a zero-length stopped answer as `done`;
  explain throws because there is no stop button; search has three documented outcomes and a
  `READER_LEFT` sentence deliberately outside the `[ai-*]` family.
- **The catch classification in the three streaming paths.** Four callbacks for ~35 lines × 3 is
  past the point where a shared function is harder to read than the copies. Revisit after 2.3 has
  lived in the tree.
- **`buildExplainMessages` / `buildSearchMessages` / `buildConverseMessages`.** The genuinely
  shared part is already extracted as `articleWithIds` (`article-prompt.ts:98`). What is left is
  twelve lines of shape around three different systems.
- **The success log lines in the three streaming paths.** Each is a different alarm, each
  documented as such.
- **`useComments` / `useSearch`'s `send()`.** Three of jscpd's four hits between them are the
  streaming half, which must not be unified. Only the mount effect and `put()` are safely
  shareable, and the value ÷ effort is much worse than 2.1.
- **`writeAtomic`'s two copies.** `labels.ts:1570` argues the duplication and the argument holds.
- **`glossary.ts:255` (`toEntries`) and `toc.ts:428` (`visit`) complexity.** Both are model-output
  validators doing per-field salvage over untrusted JSON. The complexity *is* the defensiveness and
  every branch names the failure it caught.
- **`summarise`'s shape.** Batching, a bounded retry that feeds the parse error back, partial
  salvage, and the article inside `renderPrompt` rather than a system block. It can use
  `stageCall`'s response half and nothing else.
- **The three spellings of the three-state answer** in the client. `web-client.md:420-426` blesses
  them explicitly.

## Order of work

1. **0.1** (the one line, then the gate that catches the class), **0.5** and **0.6** (the two false
   comments — both cost nothing and both would be believed).
2. **0.2** and **0.3** together — same files, red-first from the glossary tests.
3. **0.4** — the five streaming tests. Nothing else in Tier 2's streaming work starts before this.
4. **1.1**, **1.2**, **1.5**, **1.6**, **1.8** — mechanical, one commit each.
5. **1.7** — build the failing case before deciding anything.
6. **1.3**, a few files per commit. **1.4**, one feature per commit. **1.9** once Greg says which
   half he wants.
7. **2.1**, then **2.4**. **2.5** with its tests.
8. **2.2** with its test written first. **2.3** after 0.4.
9. **2.6** last, and re-reviewed before it is built.

## Rules carried forward from wave 1, because all three earned it again

1. **Grep the genre, not this list.** Wave 1 wrote this after undercounting every duplication in its
   first draft. Wave 1's own corrected numbers were then low on all four counts above.
2. **Put the shared piece where the invariant already lives.** `parse-json.ts` for 1.1 and 1.2,
   `openrouter-stream.ts` for 2.3 — not new homes, and never `types.ts`, which is declaration-only
   and browser-safe on purpose.
3. **The line numbers here are already stale** and several target files are dirty with other agents'
   work. Locate by content, re-grep immediately before committing.

And one this wave adds:

4. **A check you have never seen fail is not evidence.** 0.1's gate, 0.2's guard and 0.4's four
   guards are all cases where something existed, or was believed to exist, and nothing had ever
   watched it work. Every fix here goes red first.

## Do not delete these

`scratch-redact.mts`, `scratch-tok2.mts` and `rename-preview.html` are untracked at the repo root.
They read as finished one-off probes and are almost certainly disposable, but git has no copy and
they are somebody's work. **Ask Greg.** Wave 1 said the same thing about `scratch-tok2.mts` and both
of its reviewers flagged it independently.

After each: `npm test`, `npm run typecheck`, `npm run check`, and a browser pass on anything under
`src/web`. Many small commits — several agents are editing this tree.

## Baseline, 2026-08-28

`npm test` → **269 of 270 files pass**. The one red file is `tests/store-jobs-parity.test.ts`,
which has 111 uncommitted insertions from another agent against an unmodified `src/store/pg-jobs.ts`
— somebody's red-first work in progress, not a regression. `npm run typecheck` is clean. Local
Postgres is up on :54362, so the pg suites genuinely run rather than skip.

One trap worth writing down: `npm test 2>&1 | tail` **exits 0 even when tests fail**, because the
pipe takes `tail`'s status. Check the summary line, not the exit code.

---
# ATTACHMENT 2 — wave 1 (docs/plans/260826m-simplification-audit.md)
---

# Simplification audit, 2026-08-26

Six agents read the whole codebase against the static-analysis tools installed the same day
([static-analysis.md](../project/static-analysis.md)), looking for dead code, duplication, complexity
with a simpler shape, and boundaries in the wrong place. The result was then reviewed by **Fable**
and **GPT Sol**, both of which found the first draft materially wrong in places. This is the revised
plan.

**The through-line of almost every finding worth doing: the codebase already knew.** The best items
here are not discoveries. They are places where a comment, a doc, or a postmortem *says* two things
must stay in step, and nothing makes them. `security.md` predicted the `assertSlug` spread.
`useChat.ts` names the bug a shared `r.ok` check would have prevented — twice. `searches.ts` says
"this is the third file to carry this bug" and names the durable fix that was never made.
And the plan behind explain's streaming rewrite wrote down, in as many words, a guard `converse.ts`
was missing — then nothing tracked it for four months. Most of the work below is finishing sentences
the repo already started.

## Status, 2026-08-26

Done, each with the tests green before it was committed:

| | |
|---|---|
| **0.1** converse's missing stall guard | `753c741` — red test first, then the guard, plus a postmortem |
| **0.2** search retry reminting | `99bde25` — confirmed real; the fix keys on **id and criterion**, not id alone (see below) |
| **1.1** `Block` declared twice | `675d399` |
| **1.2** `assertSlug` ×5 | `2c43273` — one `src/slug.ts`; overrides a written decision in `shelf.ts`, and says so |
| **1.3** provider-error leak (6 sites) | `e95c5de` — with **2.7** folded in, as the review advised |
| **1.7** dead code and needless exports | `7359bdb` — minus `spineWidth`/`GUTTER_PX`, whose files another agent has open |

**2.7** (the provider-order constant) landed inside `e95c5de` too, as the review advised — same
files, same invariant. `2230249` then fixed five things GPT Sol found in the work above.

**The two most useful things that happened while implementing**, both the same shape:

*0.2's fix, exactly as its postmortem proposed it, turned an existing test red* — one that sends the
same id with a *different criterion* and requires a fresh id back, because that is what stops a stray
id overwriting a saved search. **The change that makes your new red test green is not automatically
the right change, and the test that objects may be the one holding the requirement.**

*And that corrected fix was still wrong.* Same id and same criterion proves "same question", never
"this is a retry" — a double-clicked POST, a stale tab, or a replay all match both, and would have
reset a `pending` or `done` row, destroying an answer and paying for another call. It needed a third
condition: the run must have **failed**. Two rounds of review to get one four-line predicate right.

Sol also found a **seventh** provider-leak site after the count had already gone three → six:
`search.ts` rethrew `response.json()`'s `SyntaxError`, and V8 quotes the first characters of the
offending input inside that message. Rule 1 again, one level further out than anyone had looked.

Still open: 1.4 (18 sites), 1.5, 1.6, 1.8, Tier 2 apart from 2.7, all of Tier 3.

### Then Greg answered the appendix, and a second review found the answers wrong

Appendix A went to Greg; he settled A.2–A.5 and said to use my judgment on the rest. What landed
(`0728fa1`, `6a94b4e`, `ce6ebfc`, `b59f9c5`) then went back to GPT Sol, which found five real
defects in it. Fixed in `935a0d1`, `072cb52` and `f3f187e`:

| What was wrong | Why it mattered |
|---|---|
| 403 folded in with 401, reported as a bad key | OpenRouter also returns 403 for guardrails, spend limits and model allowlists — wrong cause, and it claimed every AI feature was down when one call had been refused |
| 413 fell through to "trying again is worth a go" | The same request, resent, is the same size |
| `saidNothing("content_filter")` explained the refusal | As misread quoted material — which we do not know, cannot check, and a reader might repeat |
| **`kind` discarded one line after it was computed** | `providerRefused` throws `new Error(failure.message)`, so the UI put a Retry button under "trying again will not help" — the exact mistake copy.md was written to prevent, made by the interface rather than the copy |
| `JobProgress` used Tailwind's `animate-spin`, and dropped `flex-wrap` | icons.md rejects that spinner **by name**. Consolidating three spinners that each honoured reduced motion produced one that ignored it |

Plus a false invariant: `slug.ts` claimed `data/_jobs/` could not be reached through a slug because
`jobs.ts` builds its own path. True, and the wrong direction — nothing was arriving *from* the queue,
the risk was arriving *at* it. `_jobs` is reserved now, and the test checks both directions instead
of one.

**The lesson worth keeping is the shape of the `kind` bug.** Every part of it was written down
correctly: the taxonomy, the four rules, the sentence saying retrying will not help. The one line
that connected the decision to the interface threw it away, and nothing tested that connection —
because the tests checked the messages, and the messages were fine. *A rule can be documented,
implemented and tested and still not reach the screen.*

The fix keys the retry decision on the message's own bracketed code rather than a new persisted
field, which is a **narrow widening of what that code is for** — copy.md introduces it as something a
reader can quote. What makes it safe is not care but `tests/messages.test.ts`, which round-trips every
message and fails if a code stops agreeing with its kind.

### Then it went round twice more, and Rule 1 caught me out

Fable and GPT Sol both reviewed the fixes, and between them found enough to be worth recording as a
pattern rather than a list.

**The provider-error leak was seven sites. It was thirteen.** Six pipeline stages — arc, labels,
summarise, toc, glossary, tweets — each threw
`` `Model refused: ${JSON.stringify(message.stop_details)}` `` on Anthropic's refusal, and `jobs.ts`
copies a failed step's error onto the job, which the ingest card renders. **Rule 1 below says grep
the genre, not the list**, and it was written after this same plan undercounted every duplication in
it. I greped the OpenRouter genre and stopped; these are the Anthropic SDK's version of the identical
moment. `MODEL_REFUSED` is the one sentence now.

**Two safety properties were claimed in comments and false in the code.** The streaming extractor's
docstring said "a miss costs a late hit, never a wrong one" — the entire justification for using a
brace counter rather than a parser — while it keyed on *the first array at depth 1*, so a sibling
array could preview a hit the stored result did not contain. And `slug.ts` reserved `_jobs`
case-sensitively on APFS, where `data/_JOBS/` and `data/_jobs/` are the same directory. **A comment
claiming a safety property is not the property.**

**`validateHits` mapped `{hits: null}` to "nothing in this article matches"** — a broken reply stored
as a legitimate answer, which `parseHits`'s own docstring calls the one failure a reader could not
possibly diagnose. There was a test blessing it.

**And one line quietly undid the whole feature.** `App.tsx` filtered the runs feeding the prose marks
on `status === "done"`, so hits streamed to the panel and never reached the article until the end.
Everything upstream streamed; the last filter did not. The comment above it — "a run that has not
answered yet has no hits" — had been true when written.

Two review-process notes worth keeping. **A test can stop testing and stay green**: the rule "only
invite another go when retrying can work" matched a hand-written list of phrases, so rewording a
message dropped it out of the check silently. And **two agents returned nothing and looked exactly
like agents that found nothing** — the re-dispatch that wrote its answer to a file was what
recovered it.

## Three rules for whoever implements this

All three come from the review, and they are the difference between this plan working and
half-working.

**1. Grep the genre, not this list.** The first draft undercounted every duplication it found —
`assertSlug` 3 when it is 5, the `r.ok` check 4 when it is 18 across 12 files, the provider-error
leak 3 sites when it is 6, the fence-stripping parser 4 when it is 5. Six agents each read one slice,
so each saw the copies inside its slice and none saw the outermost ones. This repo grows by copying
the nearest module of the same genre, comments included. **Before fixing any instance, grep the whole
tree for the idiom.** A dedup that leaves two copies alive is worse than none: the next reader
believes it is done.

**2. Put the shared piece where the invariant already lives.** Do not mint new homes.
`src/parse-json.ts` already owns JSON parsing (its 40-line header is the reasoning);
`src/openrouter-stream.ts` already owns what the streaming paths must agree on. And **not
`src/types.ts`** — that file is declaration-only and browser-safe on purpose.

**3. Line numbers here are already stale**, and several target files are dirty with other agents'
work. Locate every item by content, and re-grep immediately before committing.

## What was deliberately *not* changed

The auditors were told some duplication is honest, and they took it seriously. They declined:
`App.tsx` (1312 lines, second-most-churned — read in full, judged load-bearing; its churn is every
new mode touching one seam by design); the four `*Band` components; the five
`useKeyWithClickEvents` findings ([a documented trade](#a1-the-keyboard-only-reader));
`annotateHtml`'s complexity of 46 (the function [search.md](../project/search.md) credits with
already solving the overlapping-marks problem); `useComments.send`'s 69; `writeAtomic`'s deliberate
two copies; `db/schema.ts`'s Drizzle column boilerplate; `params.ts`'s seven parsers; the
chat/comments/searches storage triplication; and `handleApi`'s 77, which is **branch count, not
convolution** — 27 flat one-line `if (matched && method) { …; return true }` blocks.

Two Knip findings are **false positives**, checked by hand: `DEFAULT_MODEL` in three files is
`export const DEFAULT_MODEL = OPENROUTER_MODEL` used as each function's own default parameter —
`models.ts` really is the single source of truth — and likewise the four timeout constants and
`citedBlockIds`. Knip cannot see cross-file self-use.

## Not ours: the split store

`260826e-postgres-storage-implementation.md:363` already records it: chat, searches and glossary lookups
have tables and an importer but no Postgres store, so in `postgres` mode **their writes still go to
files**. The two glossary writes refuse loudly with a 501; chat and search writes do not.
`store/index.ts`'s own header calls that "the worst available outcome: it reports success and loses
the data."

~~The cheap mitigation is to extend `notMigrated` to chat and search writes.~~ **Checked
2026-08-26, and it cannot be done.** `notMigrated` can only refuse a call that comes through
`src/store/index.ts`, and these do not: `src/routes.ts` imports the chat and search writes straight
from `src/chat.ts` and `src/searches.ts`, which use `node:fs/promises` and never read `STORE`. The
glossary writes are refused loudly only because they go through the store.

**Fixed twice the same day, and the second fix deleted the first.** The interim was a 501 from
`save()` in each of those two modules, from a new leaf module `src/store/live.ts` that both they and
the store can import without closing a cycle. Then step 10 landed — `chatStore` and `searchStore`
wired through `src/store/index.ts`, routes.ts calling them — and the two guards came out again.
`live.ts` stayed, because the cycle it exists to avoid is still there.

What survived is the test, and only because it was rewritten to stop pinning the scaffolding:
`tests/store-writes-land-in-postgres.test.ts` asserts the write comes back out of Postgres **and
that no file appears**, which is what both fixes had in common and what any third would have to
satisfy too. Its predecessor asserted "the write is refused" and went red when the proper fix
landed — a test describing *how* a bug was avoided rather than that it was.

The lesson generalises past this bug: **a guard can only be written where the call goes.** Two
documents proposed extending a guard to calls that never reach it, and both were written by people
reading the store's own header, which said what it refuses without saying what never arrives.

It is not in this plan because it is item 10 on someone else's tracked list and they are editing
those files now. Flagged here so it is not lost.

---

## Tier 0 — two real bugs the audit found

These come first because they are defects, not tidying, and because **§2.4 must not be built on top
of the second one.** Both get the treatment [AGENTS.md](../../AGENTS.md) requires: a failing test
first, a root-cause subagent, and a postmortem under `docs/postmortems/`.

### 0.1 `converse` misfiles a stalled stream that ends cleanly
`explain.ts` has two post-loop guards; `converse.ts` has one. `converse`'s `timedOut`/`stalled`
reporting lives **inside its `catch`** — the error path only. When one of our own clocks ends the
stream *cleanly* (`sseChunks` cancels the reader, and a cancelled read resolves `{done: true}`
rather than throwing), `converse` falls through to `!end.terminated && finishReason === null` and
files a stall as "the answer stopped arriving before it was finished".

`explain.ts`'s comment on the guard `converse` is missing describes the exact cost: both messages end
in "try again", so the reader never notices; what is lost is the log line, which says
`ended without finishing` instead of `stalled: true` — the line somebody reads when explanations
start failing and they want to know whether to blame the network or the provider.

**Correction to this section's first draft.** It said `explain.ts`'s comment pointed at
`converse.ts` for a guard `converse.ts` lacks. That is wrong: the comment saying so sits on *guard 1*
(`readerAborted`), which `converse` does have. Guard 2's comment cites `tests/explain.test.ts` and
does not mention `converse` at all.

The truth is better evidence for §3.4, not worse. The gap was **written down and left**: the plan
behind the commit that gave `explain` guard 2 says *"`src/converse.ts` has the same shape, guarded
only for the reader's signal"* ([260826l-explain-deeper-answers.md § 2](260826l-explain-deeper-answers.md)) — and
nothing tracked it afterwards. Two copies of one invariant plus a note in a plan is not a mechanism;
a shared transport is.

**Do:** the failing test first, mirroring `tests/explain.test.ts` § "says a silence is a silence".
Then the guard. Then §3.4 stops it recurring.

### 0.2 Search retry may leave a stuck run and a wrong `?run=`
Reported by GPT Sol, **under investigation, not yet confirmed**: a retry sends an already-used id
(`useSearch.ts:160`); the server deliberately remints a taken id (`searches.ts:165`); the client
replaces the old row with `pending` and then appends the reminted row without removing the old one
(`useSearch.ts:95`). If real: a stuck pending run, a duplicate, and `?run=` pointing at the wrong id.

**Confirmed**, and written up in
[260826f-search-retry-remints-instead-of-resetting.md](../postmortems/260826f-search-retry-remints-instead-of-resetting.md).
Introduced by `cb1f269`, the single commit that created `searches.ts` and `useSearch.ts` by copying
`comments.ts`/`useComments.ts`: it carried the delete-tombstone across and dropped the other half of
the contract.

**`useComments` was checked and is clean.** `createComment` has the reset-in-place branch, so the
server never remints a comment's own id on a retry — which means the `begin`-frame remap in
`useComments.ts` that looks like the fix is actually dead code for the retry case.

**§2.4 stays blocked until this is done.** Extracting `useTombstonedList` now would enshrine the
asymmetry, because `useComments`'s safety comes from a server contract `useSearch` did not have.

---

## Tier 1 — small, safe, each closes a gap the repo already named

### 1.1 `Block` and `BlockKind` are declared twice
`src/blocks.ts:49-50,65-81` keeps private copies; every other consumer (35+ import sites) uses
`src/types.ts:15-16,22-34`. Field-identical **today**, with nothing enforcing it. `blocks.ts`
produces `blocks.json`, which [architecture.md](../project/architecture.md) calls the spine. Add a
field to `types.ts`'s `Block` and `runBlocks` silently does not emit it — `pipeline.ts` uses only
`run.stats`, so there is no assignment point where drift would surface.

Verified: nothing imports `Block`/`BlockKind` **from** `blocks.js` (only `runBlocks` and
`splitIntoBlocks`), so the local declarations and their `export` keywords can both go. The
browser-safety reason `types.ts:5` gives for keeping declarations separate does not apply — an
`import type` is erased.

**Do:** delete the local declarations, `import type { Block, BlockKind } from "./types.js"`.
**Effort** S · **Value** high · **Risk** none — a compile-time no-op, and the typecheck proves it.

### 1.2 `assertSlug` is byte-identical in **five** files
`comments.ts:42`, `searches.ts:52`, `chat.ts:48`, `glossary-lookups.ts:57`, `shelf.ts:57` — each
joins a slug onto a filesystem path. (The audit found three; a whole-tree grep found five. Rule 1.)
[security.md](../project/security.md) named this risk when there was one copy:

> `isSlug` and `assertSlug` are two different definitions of a slug… a codebase with two answers…
> will eventually be asked the question by something that only checks one of them.

Six definitions now: five identical `assertSlug`s plus the stricter `isSlug`
(`^[a-z0-9][a-z0-9-]*$`) in `ingest.ts`.

**Do:** one `src/slug.ts`, imported by all five. Then [A.3](#a3-one-definition-of-a-slug-or-two).
**Effort** S · **Value** high · **Risk** none (identical bodies).

### 1.3 Provider error text reaches the log and the client — **six sites, not three**
`explain.ts:549`, `converse.ts:463`, `search.ts:421` throw
`Error(\`OpenRouter ${status}: ${detail.slice(0, 400)}\`)` on non-2xx. Sol found three more on
*successful* responses: `converse.ts:488`, `explain.ts:571`, and non-streaming `search.ts:431`.

The comment above the first says why it is wrong: *"The status, not the body. OpenRouter's error text
is the one place a provider might echo part of what we sent back at us, and what we sent is the whole
article plus the reader's selection."* The **log line** obeys that; the **throw** does not, and
`handleApi`'s outer catch does `send(res, status, { error: (err as Error).message })` and hands the
raw error to `errorFields`. `searches.ts:231` says *"This is the third file to carry this bug… the
durable fix is at the throw site, not here."*

Scope honestly: behind a one-email beta gate the reader receiving the message is the person who
supplied the article, so this is not a cross-user breach. It is a straight violation of this repo's
hard rule — *never put any article prose in a log* ([logging.md](../project/logging.md)).

**Do**, per Sol, and note two corrections to the first draft:
- **Discard the detail at the provider boundary.** Do not park it on a "non-logged" field — that is
  sensitive data waiting for a future serializer to find it. Keep a fixed public message, the status,
  and safe diagnostics only.
- **Do not add a local catch to `lookUpTerm`.** It has no pending row to reconcile, and a catch there
  risks erasing its existing 409 (`api.ts:417`). Sanitise at the throw site and let the route catch.
- Keep the status **in** the fixed message, so [A.5](#a5-what-the-reader-sees-when-a-model-call-fails)
  can later distinguish "busy, retry" from "broken" without another change.
- Privacy tests first.

**Effort** S · **Value** high · **Risk** low — but it changes client-visible error text, so ship the
interim wording and say so in the commit.

### 1.4 The `r.ok` check is copy-pasted — **18 sites across 12 files**
`useComments`, `useSearch`, `useChat`, `useShelf`, `useLibrarySearch`, `useJobs`, `useGlossary`,
`useSummaries`, `App.tsx`, `Metadata.tsx`, `Library.tsx`, `Tweets.tsx`. `useChat.ts:566` explains the
cost of the version that omits it:

> a bare `.catch()` on these calls reported success for every error the server could return… This app
> has been bitten by exactly that before — see the note on `forget` in useComments.ts, where a DELETE
> that 500'd removed a comment from the screen and said nothing.

Two independent bugs, one missing check. `useSearch` already imports `describeFetchFailure` from
`useComments.js`, so this continues a direction the repo started.

**Do:** `fetchOk(url, init?)` in `src/web/lib/http.ts`. Callers keep their own `try/catch` and
message. **Exclude the streaming variants** (`useChat.ts:376`, `useComments.ts:205`) — different
shape. **Migrate one feature per commit**; the list is the grep, not this paragraph.
**Effort** S per feature · **Value** medium-high · **Risk** very low.

### 1.5 `partsOf` is imported out of another stage's implementation file
`glossary.ts:44` and `tweets.ts:32` both `import { partsOf } from "./arc.js"` — a pure `Tree` walk
with nothing to do with the arc, and the one real violation of
[architecture.md § Stage ownership](../project/architecture.md#stage-ownership) the audit found.

**Do:** a new `src/tree.ts` for server-side tree behaviour — `partsOf`, plus the range resolution
from 1.8. **Not `types.ts`**, which is declaration-only and browser-safe. Note `src/web/tree.ts`
already exists and is the client's; pick a name that does not invite confusion.
**Effort** S · **Value** medium · **Risk** none.

### 1.6 One entrypoint guard, spelled four ways — **12 sites, and it needs tests**
`fetch.ts:1129` and `toc-flatten.ts:92` still use
`import.meta.url.endsWith(path.basename(process.argv[1]))`. Seven stages use the resolved-path form,
and `arc.ts:359` says why: the basename form also matches when a *different* file with the same name
imports the module, running `main()` as a side effect. `evals/` and `scripts/` add two more
spellings.

**Do:** one shared `isMain()`. **Sol's warning is the important part: a faulty helper makes every
CLI silently do nothing.** Unit-test same-basename files, paths with spaces and URL-encoding, and a
missing `argv[1]`, before migrating any caller.
**Effort** S+tests · **Value** medium · **Risk** low with tests, high without.

### 1.7 Dead code and needless exports
- `src/web/components/ui/collapsible.tsx` — zero importers, orphaned when the masthead `▾` became a
  hand-written drawer. **Delete** — and update the component inventory at `web-client.md:37`, which
  still lists it. Re-grep immediately before committing.
- `converse.ts:677` re-exports `readerAborted` with a comment claiming `tests/converse-stop.test.ts`
  imports it; that test imports only `stoppedByReader`, and both `converse.ts:56` and
  `explain.ts:63` import it straight from `openrouter-stream.js`. **Drop it.** Note the comment gives
  a *second* reason (discoverability — "this is where a reader looking for them will come"), so this
  overrides a written decision rather than correcting an error; say so in the commit.
- `jobs.ts:38` re-exports `JobStatus`/`StepStatus`, imported nowhere. **Drop those two names**, keep
  `Job`/`JobStep`/`StepName`.
- Drop `export` where nothing outside the file uses it: `owner.ts:63`, `db/ssl.ts:28`,
  `Cited.tsx:104`, `ContextPanel.tsx:52`, `params.ts:46,184,391,476`, `lib/sse.ts:52`,
  `layout.ts:110`, plus type-only `MarkKind`, `Tier`, `SpineMode`, `GlossaryStatus`,
  `SummariesStatus`, `ProseSection` — **and** the ones the first draft missed: `comments.update`,
  `TextPart`, `Annotation`, `SummaryRung`, `buttonVariants`, `toggleVariants`.
- `store/contracts.ts:24` names `ChatStore` and `SearchStore` as seams in that file; neither exists.
  **Fix the comment.**
- **`scratch-tok2.mts`: do not delete.** It is untracked in a tree several agents share; ask its
  owner first. (Both reviewers flagged this independently.)

**Correction to the first draft:** this will *not* leave Knip near-empty, so Knip does not become
promotable to a gate on the strength of it.
**Effort** S · **Value** medium · **Risk** none, except the delete — hence the re-grep.

### 1.8 The same range-resolution guard, twice
`tree.ts:230` and `:318`, verbatim including *"Index lookup, never string comparison — block ids
carry no order"* — the [block-ids.md](../project/block-ids.md) invariant spelled out twice. Fold into
the shared tree module from 1.5. **Effort** S · **Value** low · **Risk** very low.

---

## Tier 2

### 2.1 The Postgres readiness probe, six copies and a variant
`store-parity`, `store-import-convergence`, `store-roundtrip`, `store-comments`,
`store-export-isolation` use a 10s pool + `to_regclass`. But `store-shelf-pg.test.ts:98` probes the
`fts` **column** with its own message, and `db-schema.test.ts:41` still uses the **old 2s timeout**
and keeps its pool for the tests rather than closing it. So: **a parameterised readiness probe, not
one fixed probe** — and it must preserve module-load timing, because `store-parity.test.ts:105`
records why:

> At 2s this probe timed out under nothing worse than a dev server holding connections, and the whole
> suite skipped — inside a run that still printed a green '1103 passed'.

That `db-schema.test.ts` still carries the 2s timeout the incident was about is itself a finding.
**Effort** M · **Value** high · **Risk** low (needs `DATABASE_URL` to verify — run with the local
stack up).

### 2.2 Five stages hand-roll the same model-call parts
`arc`, `glossary`, `tweets`, `summarise`, `toc`. **Corrections to the first draft:** there are five
fence-stripping parsers, not four; they are *not* byte-identical (different return types and
labels); `src/parse-json.ts` already exists and owns `parseJsonFrom`, so the wrappers belong **there**
as `parseJsonFenced(raw, source)` — not in a new `src/model-call.ts`; and `summarise`'s `parseJson`
being exported is **not drift** — `tests/parse-json.test.ts:171` dynamically imports it by name, so
de-exporting breaks that test.

Genuinely shared and worth extracting: article-input loading, text-block extraction, throttled
character progress. **Do not build a broad `handleStopReason(...)` options machine** — `summarise`
has batching, repair and partial salvage, and does not share arc/tweets/glossary's request shape.
**Leave the `messages.stream(...)` call sites alone.**
**Effort** M · **Value** high · **Risk** low — each stage has its own test file.

### 2.3 `useGlossary` / `useSummaries` / **`Tweets`**: share the scaffolding, not the verbs
Both reviewers endorsed the split, and both said the first draft scoped it too small: `Tweets.tsx:94`
has the same loading/job/failure lifecycle a third time.

The **verbs stay separate** — glossary's `find`/`more`/`reset` because the step *appends*, summaries'
`write` because it *replaces*. The **scaffolding** is not domain logic. But it is **not
byte-identical**, as the first draft claimed: `useGlossary`'s `load` parses a third flag, `outdated`,
which `useSummaries` has no equivalent for. So the shared hook returns the **raw parsed response**
and each caller derives its own flags.

**Do:** `useJobArtefact<T>(slug, loadUrl, stepName)` → `{ status, response, error, job, failed,
reload, run, cancel }`. Glossary keeps `look`/`looking`/`lookFailed` (not job-backed).
**Effort** M · **Value** high · **Risk** medium — the `job`/`failed`/`stopped` timing is a
closure-vs-render read both files flag as learned the hard way. Manual check: start a job, kill the
server, confirm the failure banner still appears in all three.

### 2.4 `useComments` / `useSearch` — **blocked on 0.2**
Extract the tombstoned-list scaffolding, not `send()` (comments reads `begin`/`delta`/`done` frames
and remaps a reminted id; search is a plain POST). But **fix 0.2 first**, with a red test — and the
abstraction needs an explicit `remap(oldId, newId)`, or a server contract guaranteeing
reset-in-place, otherwise it hard-codes today's identity confusion.
**Effort** M after 0.2 · **Value** medium · **Risk** medium.

### 2.5 The `Progress` job-runner, three copies — **the reviewers disagree; verify before doing**
`GlossaryPanel.tsx:1284`, `SummaryPanel.tsx:626`, `Tweets.tsx:331`. `SummaryPanel`'s docstring says
*"The same component the glossary panel has, and the same reasoning."*

- **Fable**: the differences are parameterisable. Give `<JobProgress>` a `buttonClass` prop, keep each
  panel's class, and the change is invisible — Tweets joins now and [A.4](#a4-two-button-styles)
  dissolves into a pure aesthetic question blocking nothing.
- **Sol**: the differences go past class names — fallback text, step names, icons — so a shared
  component either grows a bag of styling parameters or visibly unifies them. Do all three after
  deciding the design, or none.

They agree on one thing: **do not do the partial two-panel merge the first draft proposed.** Measure
the real difference (`gloss-btn` vs `summ-btn` differ in hover colour and disabled opacity) and
decide. **Effort** S–M · **Value** high · **Risk** low logically, but product-facing if the styles
diverge more than the props can absorb.

### 2.6 `store/export.ts` re-queries what `pg.ts` already has
`export.ts:100-107` re-writes `pg.ts`'s `currentRevision` join; `export.ts:145-155` re-writes
`blocksFor`'s row mapping, comments included. A new block column must be added twice — in the code
that is explicitly the **rollback path** out of a bad cutover.
**Effort** S · **Value** medium-high · **Risk** low; parity tests cover it.

### 2.7 The provider-order block, three copies
`converse.ts:408`, `explain.ts:514`, `search.ts:395` — `provider: { order: ["anthropic"] }` plus nine
identical comment lines. Routing policy in three places, nothing checking they agree.
**Do:** one exported constant in `openrouter-stream.ts` (the module that already owns what these
paths must agree on). **Fold into the 1.3 commit** — same files, same invariant, and doing 1.3 as
three separate edits re-creates the drift surface.
**Effort** S · **Value** medium · **Risk** none.

---

## Tier 3

### 3.1 Split `handleApi` at its existing resource boundaries
Not a route table — the flat shape is defensible and the order-sensitive matches are documented.
Group the 27 branches into the clusters the header already names, as five or six `handle*Routes`
functions called in sequence. **Sol: add a route/method matrix test first** — the existing route
tests do not cover all 27 branches. With that, this is Tier 2.
**Effort** M · **Value** medium · **Risk** low as pure extraction.

### 3.2 Break up `importArticle`
`store/import.ts` — one 460-line transaction body, complexity 72, already delimited by its own
comments. Extract the sections as `tx`-taking helpers. Covered end-to-end by the store tests —
**but only if the local Postgres stack is running**, otherwise they skip. And `store/*` is the most
actively edited area in the tree right now, so "quiet tree" applies here most, not least.
**Effort** M · **Value** medium · **Risk** low with a DB up.

### 3.3 Extract `TableView`'s cell-rendering closure
Complexity 46 — arc-column and gist-column branches inline in the row loop. Extract `ArcCell` and
`GistCell`. **Stays in Tier 3**: the file is dirty with another agent's work, nothing tests this
path, and `rowSpan`/keys/conditional classNames are exactly what fails into "a plausible wrong
article" that [granularity-zoom.md](../project/granularity-zoom.md) warns about. Browser check at
narrow and wide widths, reading and outline mode.
**Effort** M · **Value** medium · **Risk** medium.

### 3.4 A shared OpenRouter streaming transport — **scheduled; the first draft was wrong to decline**
The first draft kept `converse` and `explain` apart because a comment said to. **0.1 is the evidence
that the comment is now documenting drift rather than protecting clarity**: the same clean-cancellation
race is classified correctly in one path and wrongly in the other, and `explain`'s comment points at
`converse` for a guard it lacks. `converse.ts:12` also still claims explain "returns an answer or
throws", though explain now streams.

**Not** one parameterised `converseOrExplain()`. Extract a transport that owns: key, endpoint,
headers and **safe** provider errors (1.3); the timeout and restartable stall clocks; SSE completion,
finish-reason and clean-abort detection (0.1); and text/citation/model/usage accumulation. Prompt
construction, stop-button semantics, empty-answer policy, block citations and success logging stay in
the two verbs. Search belongs in this too.

**Add identical stall, timeout, premature-EOF and non-2xx tests to both callers first.**
**Effort** L · **Value** high · **Risk** real — the highest-stakes paths in the app.

### 3.5 `summarise`'s concurrency pool — **do not change**
The first draft suggested replacing the hand-rolled 20-line ordered pool with `p-queue`. Sol is
right that this is wrong: it saves almost nothing and changes failure and scheduling semantics on
working, well-commented code. **Dropped.**

---

## Order of work

1. **0.1** — test, guard, postmortem. **0.2** — confirm, test, fix, postmortem.
2. **1.3 + 2.7 together** (same files, same invariant), privacy tests first.
3. **1.2** → one `slug.ts`. **1.1** → `Block`. **1.5 + 1.8** → the shared tree module.
4. **1.6** with its tests. **1.7** the sweep, minus the scratch file.
5. **1.4**, one feature per commit.
6. **2.1, 2.2, 2.6.**
7. **2.3** (three callers). **2.5** once measured. **2.4** only after 0.2.
8. **3.1** with its matrix test; **3.2** with a DB up; **3.4** when there is room; **3.3** last.

After each: `npm run check`, and a browser pass on anything under `src/web`. Many small commits, not
one per tier — several agents are editing this tree.

---

## Appendix A — deferred, needs Greg's input

Everything above is internal: done right, no reader notices. These are not.

### A.1 The keyboard-only reader
The five `useKeyWithClickEvents` findings are a deliberate trade, and `ContextList.tsx`'s header
explains it: making every entry focusable would put three columns of forty sections — a hundred-plus
tab stops — in front of the prose, when the keyboard model is ↑/↓ stepping by level
([keyboard.md](../project/keyboard.md)). The residual is real: a reader with no pointer cannot jump
directly to an arbitrary landmark or open its tooltip card. Do nothing, a roving tabindex over the
current column, or a "jump to section" command? **Product decision.**

### A.2 `JobStore` — resolved: keep it
Both reviewers said keep. It is the future multi-process queue contract (`contracts.ts:158`), the
Postgres migration is visibly in flight, and Sol notes deleting it would throw away a written spec.
`ChatStore`/`SearchStore` are a storage-correctness task belonging to that migration, not to this
plan. Tier 1.7 only fixes the misleading comment. **No decision needed — recorded as closed.**

### A.3 One definition of a slug, or two?
Both reviewers reclassified this. Fable checked the disk: every slug under `data/` already satisfies
the strict rule, and slugs are *minted* through `isSlug` (`jobs.ts:679`), so a nonconforming one
could only be historical. **Plan:** do 1.2 with the loose rule, then query the remote `articles`
table; if it comes back clean, collapse to strict. Only an actual nonconforming slug makes this
yours.

### A.4 Two button styles
`Tweets.tsx`'s `Progress` uses the shadcn `Button`; `GlossaryPanel` and `SummaryPanel` use
hand-written `gloss-btn`/`summ-btn`, which differ from each other in hover colour and disabled
opacity. Unifying `<JobProgress>` across all three means picking one.
[web-client.md § Tailwind and shadcn](../project/web-client.md#tailwind-and-shadcn-components)
records what is deliberately staying hand-written, and also points toward shadcn for chrome.
**Which way?**

### A.5 What the reader sees when a model call fails
Fixing 1.3 changes the text in the error the client receives — today it can be raw provider output.
Removing the leak is not your call; the replacement wording is. The real choice is whether to
distinguish "the model is busy, try again" from "this is broken" — which maps cleanly onto the HTTP
status, so 1.3 keeps the status in the interim message to leave that door open. A reading app whose
principle is *augment, don't replace* probably wants the reader to know which. **Wording is Greg's.**

### A.6 Two features make the reader wait without streaming
Sol's finding, and new: semantic search and glossary term-lookup both make a reader wait on a
non-streaming request, which sits awkwardly against what
[AGENTS.md](../../AGENTS.md) says about helping the reader read efficiently. This is not a bug and it
is not in the plan — but it means the current client shapes of those two features should not be
treated as permanent abstraction boundaries (relevant to 2.3 and 2.4). **Worth deciding before those
extractions harden.**
