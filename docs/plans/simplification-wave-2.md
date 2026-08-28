# Simplification, wave 2 — 2026-08-28

A second pass over the same ground as
[simplification-audit.md](simplification-audit.md), two days later. Four agents read four areas
against the repo's own tools (`npm run knip`, `npm run dupes`, `npm run complexity`), then every
claim in here was re-checked by hand.

**Read wave 1 first.** This is a continuation, not a replacement. Wave 1's Tier 0, most of Tier 1,
and §2.7 landed; 1.4, 1.5, 1.6, 1.8, the rest of Tier 2 and all of Tier 3 are still open, and
several items below are those items made concrete rather than new discoveries.

## The through-line this time

Wave 1's was *the codebase already knew*. This one is narrower and more uncomfortable:

**A fix applied to one copy does not reach the others, and nothing notices.** Four of the six
findings in Tier 0 are the same event — a guard, a ledger line, or a test that exists in the
original and is missing from the copy that was taken from it. In two cases the copy was taken
*days* before the fix landed in the original, so the drift was created by the act of fixing.

That is not an argument for extracting everything. It is an argument for extracting **the places
where a fix has already failed to propagate once**, and leaving alone the places where the
duplication has been stable.

## Wave 1's Rule 1 was right a third time — and then a fourth, against me

Wave 1 said: *"grep the genre, not this list"*, because its own first draft undercounted every
duplication it found. Wave 1's corrected numbers are still low. Counted by hand this time — and one
of my own counts was low too, for exactly the reason the rule names:

| | wave 1 said | actually |
|---|---|---|
| Fence-stripping parsers (§2.2) | "five, not four" | **eight** — `arc:193`, `ideas:723`, `glossary:1006`, `labels:782`, `search:417`, `summarise:587`, `toc:324`, `tweets:312` |
| Postgres readiness probe (§2.1) | "six copies and a variant" | **34 test files** (I first said 29 — see below) |
| `partsOf` imported out of `arc.ts` (§1.5) | two files | **three** — `glossary:44`, `ideas:51`, `tweets:32` |
| Entrypoint guard (§1.6) | "12 sites, four spellings" | 41 `import.meta.url` sites; **five** spellings of the guard |

And one documentation number is simply stale: `CLAUDE.md`, `architecture.md:15-17` and
`database.md` all say **two** of seven stages cache on a content hash. It is **four** — tweets,
glossary, summary and ideas, all reaching the one `hashBlocks` in `src/source-hash.ts:49`. This is
documentation drift, not a correctness divergence; the four agree, and `ideas` differs on purpose
(`source-hash.ts:66-80`).

## What the GPT Sol review changed, 2026-08-28

Reviewed before anything was built
([simplification-wave-2-review-sol.md](simplification-wave-2-review-sol.md)). Verdict: **revise
before building.** It was right on every point I checked, and three of them mattered:

1. **0.1 was under-scoped. `npm run pdf` leaks spend too** — `pdf-read.ts:377` calls
   `openRouterJson`, and its entrypoint at `:1274` is a bare `void main()`. Two paid CLIs, not one.
   Fixing only `labels` would have shipped a gate memorialising a second false "all paid CLIs"
   claim.
2. **0.4's headline claim was false.** `tests/search-stream.test.ts:411` *does* exercise the
   clean-abort branch — it is the test about "cancelling once the text is already complete still
   produces a `done`". Three guards are unexercised, not four. My check was too weak: I greped for
   `timeoutMs`/`stallMs`, found none, and inferred all four guards from that. The clean-abort guard
   does not need either symbol to be exercised. **Absence of the setup I expected is not absence of
   coverage.**
3. **2.4 proposed re-introducing a reverted change.** `pipeline.ts:1083` is headed *"**No `stamp`,
   and it is not an oversight — one was written and withdrawn on 2026-08-27.** Read this before
   adding one"*, and explains that a re-run `toc` silently drops range-attached `arc` and `summary`
   entries. `59e8e3a` had the stamp, with tests, and was reverted. The pipeline trawl read the
   generic `stamp` docstring at `:350-364` and never saw the ToC-specific warning 700 lines below.

And **Rule 1 landed on me, in the document where I wrote that it kept landing on wave 1.** My "29
readiness probes" is itself an undercount — it is **34**. I greped one spelling of the genre
(`to_regclass`) and missed five files that probe differently: `owner-isolation`,
`public-visibility-pg`, `store-revision-policy`, `store-shelf-pg`, `store-shelf-reads`.

One more stale justification, also Sol's: **`writeAtomic` has three copies, not two.**
`store/artifacts-fs.ts:307` says *"The same recipe as `writeAtomic` in src/toc.ts and
src/labels.ts"*, while `labels.ts:1572` still calls itself *"The twin of `writeAtomic` in
src/toc.ts"* and argues from *"the two copies"*. Wave 1 declined this item on the strength of a
justification that had already stopped being true. Do not act on it yet — the artefact-store
migration should absorb the stage writes — but the reason for declining it is gone.

## Status, 2026-08-28

Seven commits. Four live defects fixed, each red-first with the control checked against the broken
state.

| | |
|---|---|
| **0.1** two paid CLIs outside the ledger | `a1d397a` — `await withLedger("cli", main)` in `labels.ts` and `pdf-read.ts`, plus a new AST gate. Hardened again in `b2992a9`, see below. |
| **0.2 + 0.3** the reader's list, and a false failure | `47a3959` — the revalidation guard in `useIdeas`, `useSummaries` and `Tweets.tsx`; `useIdeas`'s "did not reach the server" replaced with `queue.error`. Eight tests. |
| **0.5 + 0.6** a dead function, two false headers | `ca1bf40` — `glossaryIsCurrent` deleted with six references corrected; `store/revisions.ts` rewritten to say nothing is wired. |
| the plan and its first review | `3806b25` |
| **0.6 again** | `02933b5` — the header was still wrong a third way; see below. |
| **the Tweets copy** | `7468327` — `THREAD_RECHECK_FAILED` in `messages.ts`; the raw error goes to the console. |
| **0.1's gate, hardened** | `b2992a9` — it could be beaten three ways. |

Then Greg read the questions at the end of the code review and said: go on with everything that is
clear-cut, ask at the end about anything that is not. Tier 1 from there.

| | |
|---|---|
| the held-back doc line | `9dad75a` — `src/store/artifacts.ts`, once the peer finished in that file. |
| **1.8** the Sentry packages | `91680a1` — `@sentry/node-core` and `@sentry/core` declared, `@sentry/node` dropped, thirteen packages out of the lockfile. `@babel/types` and `@tanstack/table-core` swept up with them; knip's "Unlisted dependencies" is now empty. |
| **1.7** the stale comment | In the tree, under **a peer's** commit `01b55b2` — they were in `src/library-search.ts` for the block-policy work and their `git add` took my hunks with it. Nothing lost; see the note in 1.7. |
| **1.10** `.env.local`, unread | `c5ac05a` — `src/pdf-read.ts` spent without ever reading it; the gate that already knows which CLIs spend now holds the rule for all eight. Found by checking 1.5's claim about a stale comment. |
| **1.3** the readiness probe | `2a43831` — one `pgReady`, 32 suites, and the discovery that the "loud skip" they were built around had been silent under `npm test` all along, because vitest swallows a module-load `console.warn` from a file whose tests then skip. |
| **1.4** `fetchOk` | `2765523` — six sites into `src/web/lib/api.ts`, not a new module; eleven others left alone with reasons. The missing piece was a test on the error path, and its control shows 207 existing tests pass against the break. |
| **1.1 + 1.2** the JSON helpers | `5794e2a` — `stripFence` and `readJsonOrNull` in `src/parse-json.ts`, with the merged fifteen-line reasoning and `labels.ts`'s extra paragraph about `redact` being path-based. Four call sites in; five are held, tangled with a peer's supplement work. |
| **1.5** ten exports, two false comments | `e65d754` — five status types, `spineWidth`, `GUTTER_PX`; the "can move without unmounting" claim rewritten in `useSimilar` and `useProjection`, guards kept. |
| **1.6** dead code knip cannot see | `0a4e0db` — `editTurn` and the stale `JobStore`, plus **nine** citations of `editTurn` rather than the two the plan counted. `preview-colour.tsx` refused; see 1.6. |
| **1.9** the origins list | `0e75064` — `ownOrigins()` reads `VERCEL_PROJECT_PRODUCTION_URL` and `VERCEL_URL`, so nobody has to set anything. Two red-first tests; `.env.example` and `security.md` say what the gap was. |

| **the Tier 1 review** | `b709d26` — [`simplification-wave-2-tier1-review-sol.md`](simplification-wave-2-tier1-review-sol.md). One medium finding: the `.env.local` gate accepted a call that runs *after* the spending. Fixed, and it then found `src/labels.ts` in the same shape. |

### What the Tier 1 review changed

**The medium finding was a gate of mine giving a false guarantee rather than a weak one.** `main() {
await spend(); loadEnvLocal(); }` passed. So did `if (false) loadEnvLocal()`, a call after an early
`return`, and `const { loadEnvLocal } = helpers`. The rule asked whether the call is *there*, which
is not the property. Three requirements now — a statement of `main` itself, nothing awaiting or
returning before it, and the name bound to the `./env.js` import through any binding form — plus
five controls.

**It then paid for itself.** `src/labels.ts` read two artefacts before calling it, and
`src/pdf-read.ts` had the same shape until this morning. Neither read spends, so nothing was broken;
but a rule that has to except the harmless awaits is not a rule. Both moved up, and the eight are
uniform.

**Three refused-write tests overclaimed.** One was named "instead of letting the row look deleted"
and started from an empty list. Seeded now, each asserting the seed arrived, and asserting what
really happens: `remove` does not roll back where `create` does, and that asymmetry is pinned by a
test rather than described.

**Sol was right about production and wrong about the tree, once.** It found a seventh `fetchOk` site
— `writeThread` in `chat/effects.ts`, an exact duplicate. Migrating it reddens two tests in
`tests/chat-cancel-before-begin.test.ts`, which mocks `lib/api.js` with `importActual` and overrides
`apiFetch`: `fetchOk` closes over the *real* `apiFetch` inside the module, so the writes that suite
counts stop arriving. Tried, watched it break, reverted, and written into `fetchOk`'s docstring as a
fourth thing it is not for.

**Two comments were too broad and one of them was false.** `readJsonOrNull` claimed V8's quotation is
"never built"; it is built, and what holds is that it never escapes. `ownOrigins` claimed Vercel sets
its variables "with no configuration"; there is a project setting for it, on by default for newer
projects.

**Tier 1 is done.** 0.4 (the three streaming tests) and all of Tier 2 are not, and Tier 2 was never
in the clear-cut half.

### Tier 2, split by the plan's own risk lines — 2026-08-28

Greg: *"Do at least the safe ones from Tier 2. Get input from GPT Sol about the others, and a
review."* So the split is the risk column above, taken at its word:

| | risk, as written above | |
|---|---|---|
| **2.1** `useStepJob` | low — "pure lift-and-shift of already-identical code" | building |
| **2.4** `stamp` for tweets + summary | low | building |
| **2.5** `stageCli` | low **with** tests, high without — so tests first, then callers | building |
| **2.2** `stage-call.ts` | medium | [asked Sol](simplification-wave-2-tier2-input-prompt.md) |
| **2.3** `roundClock` / `endOfStream` | real, and 0.4 is not done | asked Sol |
| **2.6** `useArtefactRead` | medium, and it "wants its own review before it is built" | asked Sol |

**One thing 2.4 needed checking before it could be called safe, and it holds.** `stepIsDone`
compares against `store.stampFor(...)`, which reads *a separate record* on the face of it — and if
it were separate, migrating `tweets` and `summary` off `isDone` would leave every existing artefact
unstamped, fail the comparison, and re-run both stages on every article at model cost. It is not
separate: `stampFor` reads the three fields **out of the artefact itself**, and `STAMP_SOURCE`
(`store/artifacts.ts:528`) already names `tweets` and `summary`. `threadIsCurrent` and
`summariesAreCurrent` compare `sourceHash`/`version`/`generator`; so does `sameStamp`. The migration
is genuinely equivalent and costs nothing. `isStale` and `readSummaries` stay — the API routes use
them at the other end.

**The tree is the constraint, not the work.** Six other sessions are in this checkout, and at the
time of writing `src/pipeline.ts`, `src/summarise.ts`, `src/arc.ts`, `src/toc.ts`, `src/glossary.ts`,
`src/ideas.ts` and `src/web/Tweets.tsx` all hold uncommitted peer work — between 18 and 124 lines
each, all touched within the hour. That is most of 2.4's file set and one of 2.1's four hooks. So:
2.1 migrates the three clean hooks and names `Tweets.tsx` in the new module as the fourth, held;
2.5 builds and tests the helper first and migrates only clean callers; 2.4 waits for
`pipeline.ts` to go quiet. Rule 3 above already says the line numbers are stale — this is the same
fact with a cost attached.

**2.5 has one interaction the plan does not mention.** `tests/paid-cli-ledger.test.ts` is an AST
gate requiring a direct `await withLedger("cli", main)` in the executed main branch. Migrating
callers to `stageCli(...)` breaks it, and the wrong repair is to loosen it to "the call is
somewhere" — that is the defeatable shape the Tier 1 review already caught once. The right repair
makes it stronger: require the entrypoint to *be* `stageCli(import.meta.url, main)`, and assert
separately that `stageCli` opens the ledger. It has to accept both forms while the migration is
partial, and still reject every way of getting it wrong.


### What the code review changed, and it earned its keep

The project weights the second review higher than the plan review because a plan-stage review cannot
catch a fix that is wrong in the code. That is exactly what happened.

**The gate I wrote to catch a bug that hides could itself be beaten three ways.** It checked the
wrapper's spelling and first argument, never the second argument or the binding. So
`withLedger("cli", async () => {}).then(main)` passed it — the money leaves, `main` runs outside the
collector, the gate goes green. I reproduced that against the committed gate before changing
anything.

**And the way it looked caught is the part worth keeping.** Running the bypass *did* turn one test
red — but that was the mutation control noticing its own string-replace had stopped matching, not
the gate. "Something went red" is not "the gate caught it", and only reading *which* test failed
showed the difference.

**Its header overclaimed**, in a commit whose subject was headers that overclaim.
`npm run eval:dictation-vocab` spends through `transcribeWith` → `openRouterJson` with no ledger —
declared `unscoped`, so not a leak, but the sentence was false. The header now names the eight it
checks, says what it cannot see, and cross-checks the `unscoped` declarations.

**`revisions.ts` was wrong a third time.** My rewrite said publication would start succeeding "with
no change to this file". `begin` takes `opts.job` and `RevisionHandle` drops it, so `publish` and
both failure paths have no token to fence on and a failed draft keeps `jobs.draft_revision_id`. The
step 11 acceptance condition now includes carrying the fence through publish/fail and clearing that
pointer atomically.

**The Tweets copy violated `copy.md`** by interpolating `"Failed to fetch"` into reader-facing text.

### Two findings from the review that are NOT fixed, and feed Tier 2

- **The reload tests serialize away the same-slug race.** All three loaders can have an opening GET
  and an `onFinished` GET in flight together; if the post-job response lands first, the older
  opening response overwrites it permanently. Every new test settles the opening request before
  firing the job. `useGlossary` solves this with `generation`/trailing fetches and the other three
  have none of it. **This is 2.6, and it means the Tier 0 verification is narrower than it looks.**
- **`queue.error` is not durable.** It is shared polling state: the failed POST sets it, then
  `finally` starts a poll and any successful poll clears it, so 0.3's fix can fall back to
  "Couldn't start the job" before the server's reason paints. The test's static mock has no poll, so
  it proves the ternary and not the sequence. **Fold into 2.1.**

### Three times I was wrong in the same way

Worth recording together, because it is one habit rather than three slips, and it is the same habit
this whole wave is about.

1. **"Four guards never fire."** Greped for the setup symbols, found none, inferred all four. Three.
   *Absence of the setup I expected is not absence of coverage.*
2. **"29 readiness probes."** Greped one spelling of the genre. It is 34.
3. **"Every paid CLI opens the ledger."** Shipped a header claiming more than the check does.

Each is a claim that agrees with itself and was never asked to fail.

### One outstanding edit, held back on purpose

`src/store/artifacts.ts` still says the Postgres artefact adapter "is not written yet", though
`artifacts-pg.ts` exists. The fix is written but not committed: a peer has an unfinished
`hasEarlierBlocks` in that file, and `git commit -- <path>` commits the working tree of that path
and would take their work with it. Land it once their refactor settles.

---

## Tier 0 — six items; three are current reader-facing defects

0.1–0.3 are live product defects. 0.4 is a coverage gap. 0.5 and 0.6 are false statements in the
source that would be believed. Each gets the treatment AGENTS.md requires: a failing test first,
then the fix.

### 0.1 Two paid CLIs spend money outside the ledger — `labels` and `pdf`

`src/labels.ts` ends with:

```ts
if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {
  await main();
}
```

No `withLedger("cli", …)`. **It is the only one of the seven *stage* CLIs without it** — `arc`,
`glossary`, `ideas`, `summarise`, `toc` and `tweets` all have it — but it is not the only paid CLI
without it; see below. `main()` (`labels.ts:1601`) calls
`generateLabels`, which calls `streamMessage` per batch (`labels.ts:1141`), so
`npm run labels -- <dir>` makes N paid calls that never reach `npm run cost`, and
`unscopedCalls()` (`ai-spend.ts:460`) counts them as fallen on the floor.

`src/cli-ledger.ts:1-7` states the intent it misses:

> **Run a CLI command with the ledger open**, so that `npm run toc` is money that appears in
> `npm run cost` rather than money that vanishes. One line at each stage's `isMain`, rather than a
> `collectSpend` folded into seven bespoke `main()` bodies.

**And it is not the only one.** `npm run pdf` (`package.json:20`) leaks the same way:
`pdf-read.ts:377` calls `openRouterJson("pdf", …)` and its entrypoint at `:1274` is a bare
`void main()`. **Two paid CLIs are outside the ledger, not one** — found by the review, after I had
written "the only one of the seven". Fix both together, or the gate below memorialises a second
false claim.

**This is the concrete cost of the duplication: the files that did not copy the shared tail are the
ones that leak.**

**Why the existing gate did not catch it.** `tests/no-undeclared-spend.test.ts` asks *"does this
file have the capability to spend money, and is it declared?"*. It does not ask *"does this
entrypoint open the ledger?"*. Different questions; it structurally cannot see the second.

**Do:**
- `await withLedger("cli", main)` in both files — `await`, not a floating `void`, so ledger
  flushing and failures stay part of CLI completion.
- **Not** the proximity-grep gate this plan first proposed. Sol is right that it is exactly the
  check that goes quiet when defeated — a comment, a dead branch, an unrelated wrapper or a
  transitively-reached paid call all beat it. Instead: an explicit list of paid CLI entry modules,
  AST-checked so that the executed `main` branch directly invokes the wrapper. **Test the detector
  against a deliberately unwrapped fixture** before trusting it.
- Keep a generic `isMain` separate from the metered helper. Not every importable CLI spends money.

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

### 0.4 Three guards in the search stream have never been seen to fire

`tests/search-stream.test.ts` never passes `timeoutMs` or `stallMs` — verified, the file contains
zero occurrences of either — and never asserts a non-2xx. `tests/explain.test.ts` has no non-2xx
test either.

**Corrected by the review: three guards are unexercised, not four.** The clean-abort race guard
*is* covered, by the test at `tests/search-stream.test.ts:411` about cancelling once the text is
already complete. What is genuinely never executed is `findPassagesStream`'s **deadline**, its
**restartable stall clock** (including a clean cancellation by that clock), and **ordinary premature
EOF**. My original claim over-reached: I greped for the setup symbols, found none, and inferred all
four guards. The clean-abort guard needs neither symbol to fire.

This is precisely the shape that already cost this repo a postmortem:
`docs/postmortems/converse-stall-misfiled-as-incomplete.md` — guard 2 existed in `explain.ts` and
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

**Done, `5794e2a`, and the experiment was re-run rather than cited.** Eighteen inputs in the test,
twenty-one checked here including `search.ts`'s exact spelling — the one with no trailing `.trim()`,
which the plan had not distinguished. Zero disagreements. `tests/parse-json.test.ts` keeps both old
spellings and the whole input list, plus a control proving the comparison can fail: a stripper that
only trims agrees on "no fence at all" and disagrees everywhere a fence exists.

**Five call sites are held back**, not skipped: `arc.ts`, `toc.ts`, `summarise.ts`, `glossary.ts`
and `ideas.ts` picked up a peer's supplement work — `splitBlocks`, `appendSupplement`,
`isSupplementNode`, `previousGlossaryFrom` — while this was being written, and one of their new
functions already calls `readJsonOrNull`. Good for the code, awkward for the commit.

**Effort** S · **Value** medium · **Risk** very low.

*Bonus, and the real prize:* the ~15-line comment explaining the privacy reasoning is copy-pasted
verbatim into `arc.ts`, `glossary.ts`, `toc.ts` and `tweets.ts`, and `labels.ts` has its own longer
version. Those paragraphs collapse into the one module that is actually about it.

### 1.2 `readJson<T>` — four byte-identical copies into `src/parse-json.ts`

`glossary.ts:710`, `summarise.ts:781`, `ideas.ts:497`, `tweets.ts:111`. Six lines, byte-identical.
Leave `api.ts:100` (collects unreadable paths) and `store/import.ts:155` (returns `undefined`) —
genuinely different.

**Effort** XS · **Value** low-medium · **Risk** none.

### 1.3 The Postgres readiness probe — 34 copies, and three of them still carry the bug

Wave 1 §2.1 called this "six copies and a variant". It is **34 test files** — I first counted 29
by greping `to_regclass`, and the review found five more that probe differently (`owner-isolation`,
`public-visibility-pg`, `store-revision-policy`, `store-shelf-pg`, `store-shelf-reads`). Measured
over the 29 that share the `to_regclass` spelling:

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
- ~~**`src/web/preview-colour.tsx`**~~ — **refused, 2026-08-28, and this is the interesting one.**
  Its header says *"Delete when the check is done; it is not in the router and nothing links to
  it."* Two things about that were wrong, and both took one grep.

  **Something does link to it.** `preview-colour.html` sits at the repo root, is tracked, and
  carries `<script type="module" src="/src/web/preview-colour.tsx">`. knip called the `.tsx` an
  unused file because knip does not read HTML. Deleting the `.tsx` alone would have left a page that
  loads nothing — dead code replaced by a broken entry point.

  **And the check is not done.** `docs/plans/search-row-colour.md:315` says the browser pass was
  never made: *"Greg asked for a Claude-in-Chrome pass and the extension was not connected … so
  there is no honest way to claim it."* Two things only a real browser can judge are still
  unverified — where Floating UI puts the panel at the narrowest band, and whether the two rings
  read as two different things at 1.35rem. This page is the tool for exactly that pass. Deleting it
  would delete the instrument for an outstanding check and leave the check outstanding.

  Three more things a subagent found that sharpen it:

  - **`tests/doc-links.test.ts` would go red.** `search-row-colour.md:324` links the file as
    markdown, and that test checks every such link points at a file that exists. Checked against the
    broken state rather than assumed: the test currently fails with exactly 8 entries, none of them
    this one, and deleting would make 9.
  - **`npm run build` would not break.** `vite.config.ts` sets no `rollupOptions.input`, so
    `index.html` is the only build entry. The damage would have been dev-only — which is worse for
    finding it, not better.
  - **It is now the only intact one.** `rename-preview.html` was the other worked example of this
    pattern and it was already dangling; it has been deleted. So the repo has exactly one page that
    mounts a real component outside the auth gate, and it is this one. That matters more than usual
    because dodging the auth gate is how any component gets looked at in a browser here.

  So it stays until somebody makes the pass. **A question for Greg**, not a piece of work to take:
  the pass itself is a job, and doing it would close the item properly — the file could then go, with
  `preview-colour.html` and the markdown link, in one commit.
- **Four `editTurn` citations: fixed, `d15f8cc`.** They named the deleted function as "the server"
  in `src/web/useChat.ts`, `src/web/chat/model.ts`, `src/web/chat/reduce.ts` and
  `tests/chat-reduce.test.ts`. Finding their owner cost more than the fix did: two peer sessions were
  asked and both said the files were not theirs, so the answer was to stop hunting and wait for
  `git status` to go quiet on the four, which it did within the hour once the third session
  committed. They now name `withEdit` (`src/chat.ts:681`), which is where the rule they cite — the
  first question names the thread, so rewriting it renames the thread — actually lives. The mentions
  under `docs/postmortems/` and in the other plans stay as they are: they are records of what was
  true at the time, and rewriting a record to match today is how you lose the history.
- **`grantIsOver` and `MAX_UPLOAD_BYTES` re-export lines** in `upload-records.ts:119,182`. The
  functions stay; only the unreferenced re-exports go. **Do not touch `source.ts:186`'s re-export of
  `MAX_UPLOAD_BYTES`** — `pipeline.ts:41` uses it.

**Three things I asked about specifically came back clean**, and they are worth recording because a
wrong answer would have been a hole: the embed allowlist **is** applied (`sanitize-policy.ts:82` →
`:505`); the upload size cap **is** enforced; and the pricing correction **is** applied
(`US_INFERENCE_MULTIPLIER` at `pricing.ts:372`, `MODEL_ALIASES` at `:254`, `PRICE_CHECKED` stamped
into `priceVersion` at `:447`). knip was flagging re-exports and citations, not unenforced policy.

**Effort** S · **Value** medium · **Risk** low, given a re-grep before each delete.

### 1.7 Two notions of "matches" — and I read the wrong comment. **Done, 2026-08-28**

**The first draft of this section was wrong, and wrong in the way this whole plan keeps warning
about.** It said the code declares one notion of "matches" and the wiring fails to deliver it. What
the code actually declares is *two* notions, deliberately, with the reason written down — and I
found the stale half of the comment first and stopped reading.

`src/library-search.ts:60` said:

> Exported, along with `fold` and `occurrences` below, for src/chat-tools.ts … a reader typing words
> into the library box and asking chat about the same words must get the same notion of "matches",
> and the way to be sure of that is not to have two notions.

`src/chat-tools.ts:481` says the opposite, and says it later:

> **Where it deliberately differs from the library box: this one matches whole words.**
> `occurrences` over there is a substring scan, which is fine for a list a person reads — they can
> see the highlighted result and judge it. It is not fine here, because what goes back to the model
> is a *count* presented as exact, and a substring scan finds `AI` three times in "he said the claim
> was fair" and ranks that paragraph above one that actually says AI. A model told "these counts are
> exact and cover the whole article" believes it. Caught by a GPT-5.6 review, 2026-08-26, and
> verified before it was fixed.

So the split is a fix, not a fault, and it is two days old. What the two sides share is `parseQuery`
and `fold` — the notion of what a *query* is. What they do not share is the matching rule. The
`library-search.ts` comment predates the split, was never updated, and named `occurrences` as
something chat imports when chat does not.

**Done.** The comment now says what is shared, what is not, and why, and records that its earlier
version was believed. `occurrences` is no longer exported — its only caller is `searchLibrary` in
the same file, which is also why knip flagged it; that flag was correct and this section's first
draft called it a wiring bug.

**It landed under somebody else's name.** The plan was to hold it until the peer's `isSearchable`
work was committed and then commit it cleanly. What happened instead is that their `git add
src/library-search.ts` took my hunks with theirs, so both halves are in `01b55b2` — as is the
`src/ideas.ts` comment fix from 1.10. This is the third face of the shared-index coin and it is
written up in memory; the point worth repeating here is that **nothing was lost**, so the answer is
to notice and move on rather than to try to unpick history that peers are already committing onto.

**What is left is a real question, and it is Greg's.** The library box ranks with
`score += occurrences(...)` (`library-search.ts:231`) and includes on `count === 0` (`:227`), so the
substring scan is not only a displayed number — it decides which articles come back and in what
order. Measured over both matchers on the same folded text:

| needle | text | library box | chat |
|---|---|---|---|
| `cat` | The category of cat food is broad. | **2** | 1 |
| `cat` | Categories, categorically. | **2** | 0 |
| `art` | The art of starting a cart. | **3** | 1 |
| `one` | Money, phone, one. | **3** | 1 |
| `use` | Uses, used, user, use. | **4** | 2 |
| `read` | Reading, reader, already read. | **4** | 1 |

`chat-tools.ts`'s justification — a person can see the highlighted hit and judge it — answers the
*count*, not the *ranking*. Row 4 is the one to look at: for the query `one`, a paragraph saying
"money" and "phone" outranks one that says "one". Three ways to go, and none is free:

- **Whole words**, the rule chat uses. Clean, but typing `extract` stops finding `extraction`;
  `term-match.ts`'s `SUFFIX` allows a plural and nothing more.
- **Substrings**, as today. Keeps the accidental stemming, keeps the bad ranking.
- **Word-start**: match where the needle starts a word, run on to any ending. `extract` finds
  `extraction`; `one`, `art` and `read` stop matching mid-word. It does **not** fix `cat`/`category`,
  because `category` does start with `cat`.

Word-start is the only one that improves reader-facing results without losing anything, and it would
give the two searches a shared rule again while leaving `term-match.ts`'s whole-word rule where it
belongs — underlining a glossary term, where you do not want `cat` underlining `category`.
**Not done, because it changes search results.**

**Effort** S · **Value** medium · **Risk** the comment fix is none; the matcher change is
product-facing.

### 1.10 One paid CLI never read `.env.local`, and the comment about it named the wrong files. **Done, `c5ac05a`**

**Not in the plan — found by checking one sentence in 1.5.** 1.5 says the comment at
`src/ideas.ts:910-919` claims a gap that has closed: *"The other pipeline stages do NOT do this, and
that is a real gap rather than a convention."* The claim is that all six now call `loadEnvLocal()`.
Checking it turned up seven, not six — and an eighth CLI that spends and still did not.

`src/pdf-read.ts` reads `process.env.OPENROUTER_API_KEY` at `:357` and never called
`loadEnvLocal()`, so `npm run pdf x.pdf` from a shell without an exported key stopped at
"OPENROUTER_API_KEY is not set" with the key sitting in `.env.local`. **The comment was stale in a
way that hid the one remaining case**: it described the gap as belonging to "the other pipeline
stages", named none of them, and `pdf-read` is not one of the seven anybody thinks of under that
phrase.

**The rule lives in `tests/paid-cli-ledger.test.ts`, and that is the point of it.** `PAID_CLIS` is
already the set of modules that spend, and a module that spends is one that needs a key — so the
new `envOffence()` shares the list, the parser, the walker and the binding check, and
`ledgerLocalName` became a one-line call on a general `importedLocalName(body, module, export)`.

Red first, which mattered more here than usual: a rule written over eight files where seven already
comply is a check with nothing behind it. Eight controls, plus a mutation control on the real
`src/pdf-read.ts`.

**Effort** S · **Value** medium · **Risk** none.

### 1.8 The two Sentry packages we import are undeclared; the one we declare is unused

`src/monitoring.ts:67` imports `@sentry/node-core/light`; `src/monitoring-scrub.ts:18` imports
`@sentry/core`. Neither is in `package.json`. Both resolve only as transitive dependencies of
`@sentry/node` — which nothing imports, and which `monitoring.ts:108-121` explains at length is
deliberately not imported because it drags in OpenTelemetry and costs ~80 ms of cold start.

So a Sentry release that reshuffles its own dependency tree breaks production error reporting, with
no local signal. **Swap `@sentry/node` for explicit `@sentry/node-core` + `@sentry/core`.** Same
class, lower stakes and test-only: `@tanstack/table-core` and `@babel/types`.

**Effort** XS · **Value** medium · **Risk** none.

### 1.9 `SPIDERYARN_ORIGINS` was never set, so half a doubled defence was inert. **Done, `0e75064`**

`sanitize-policy.ts:292` read it to decide whether an absolute URL is our own API. It appeared in
one test and was **not** in `.env.example` or `deployment.md`, so server-side `isOwnApi` could not
recognise the production origin and fell through to the localhost fallback at `:297`.

The plan offered two ways out — set it on Vercel and document it, or write in the file that the
server pass cannot do this one — and **both were worse than the third one**, which is that Vercel
already tells every deployment its own host. `VERCEL_PROJECT_PRODUCTION_URL` and `VERCEL_URL` are
set with no configuration, and `src/monitoring.ts:182` already reads a sibling, so they were known
to arrive. `ownOrigins()` reads both; `SPIDERYARN_ORIGINS` stays as the override for a custom
domain and is now written down in `.env.example`.

Two tests, one per variable, red first. **The direction of failure is the reason this was safe to
do without asking:** `isOwnApi` returning true *removes* the attribute, so an origin wrongly counted
as ours costs a stripped link, never a leaked request.

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
- **`arc` and `toc` get nothing. Do not add stamps to either.** This plan originally proposed it
  and it was the largest error in the draft. `pipeline.ts:1083` is headed *"**No `stamp`, and it is
  not an oversight — one was written and withdrawn on 2026-08-27.** Read this before adding one"*:
  `arc` and `summary` join the tree by exact block-**range** pair, and an entry whose range matches
  no node is dropped from the reading view without a word, so a re-run `toc` silently loses content
  that still looks current. `59e8e3a` had the stamp, with tests, and was reverted for that reason.
  `arc` is not four lines either — `store/artifacts.ts:243` records that `tree.json` and `arc.json`
  carry no source hash, and arc depends on both the blocks *and* the tree, so a blocks-only hash is
  insufficient. Reopening this needs consumer invalidation and a structure-aware fingerprint
  designed first; it is not a tidy-up.

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

## The three scratch files: gone, 2026-08-28

`scratch-redact.mts`, `scratch-tok2.mts` and `rename-preview.html` were untracked at the repo root.
Wave 1 said "ask Greg" about `scratch-tok2.mts`, both of its reviewers flagged it independently, and
this plan said the same about all three. Greg's answer: check they are unused and obsolete, and if
so remove them. They were, and each for a different reason:

- **`scratch-redact.mts`** — twelve lines probing whether `new URL()` can strip a password out of a
  Postgres connection string, over six awkward inputs. That function shipped: `withoutPassword` at
  [`src/db/ssl.ts:115`](../../src/db/ssl.ts), same three lines of logic. The probe had already done
  its job.
- **`scratch-tok2.mts`** — **kept, and I had deleted it before the check came back.** Fourteen lines
  counting the tokens in a `tree.json`'s nav labels against its structure nodes. I reasoned that a
  probe whose answer has been written down has done its job. The Sonnet audit found the answer and
  it is more specific than I realised: [toc-scaling.md § 61](toc-scaling.md) cites *"about 40 tokens
  each"* for nav labels and *"17.7 tokens per block on the constitution, 25.2 on the test article"*
  for structure — numbers this script computes and nothing else in the repo does. Those two numbers
  are the whole argument for taking labels out of the structure call, which is a live design, and
  this is the only way to re-measure them when the prompt changes.

  Restored from the copy taken before deleting. **The lesson is about me, not the file:** Greg's
  instruction was to have a subagent check the three and remove what was obsolete, and I ran the
  check myself while the subagent was still working, then acted on my own answer. Two of three
  agreed. The third did not, and it is the one three separate documents had already flagged as
  needing its owner's say-so — which should have been the signal to wait rather than the thing to
  discharge.
- **`rename-preview.html`** — not merely unused: **broken**. It loads
  `<script src="/rename-preview.tsx">`, and that file does not exist anywhere in the tree. It was
  the orphan half of a preview page whose other half had already gone;
  [worktrees.md:57](worktrees.md) records `rename-preview.tsx` as a typecheck complaint back when it
  still existed.

Copies were taken before deleting, which is the only reason the third one could come back.
`knip.jsonc`'s comment about root-level globs still names `scratch-tok2.mts`, correctly: it is still
there and still reported, and the point it was making — that a file out of scope looks exactly like
a file with nothing wrong with it — is why any of this was visible at all.

**`src/web/preview-colour.tsx` is a different case and is still here.** See 1.6.

## Baseline, 2026-08-28

`npm test` → **269 of 270 files pass**. The one red file is `tests/store-jobs-parity.test.ts`,
which has 111 uncommitted insertions from another agent against an unmodified `src/store/pg-jobs.ts`
— somebody's red-first work in progress, not a regression. `npm run typecheck` is clean. Local
Postgres is up on :54362, so the pg suites genuinely run rather than skip.

One trap worth writing down: `npm test 2>&1 | tail` **exits 0 even when tests fail**, because the
pipe takes `tail`'s status. Check the summary line, not the exit code.
