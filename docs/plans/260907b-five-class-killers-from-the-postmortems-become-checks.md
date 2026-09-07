# Five class-killers from the postmortems become checks

Four of the six items scored in
[260905b § T2.1](260905b-improve-the-codebase-third-sweep.md) — **(d)** the silent `blocked`
fallback, **(a)** `portalDrift`, **(c)** the sanitiser seam, **(e)** the two staleness checks — plus
a fifth that is not from that table: a **conflict-marker check in `npm run check`**, which
[260903b](../postmortems/260903b-the-ledger-took-the-blame-for-a-half-finished-merge.md) calls *"the
widest fix, and the one not yet done"*.

All five are the same move: **a conclusion this repo has already reached, converted into a check**.
That is the argument of [260905b § One level up](260905b-improve-the-codebase-third-sweep.md), and
[260906h](260906h-improve-the-codebase-fourth-sweep.md) re-verified all six of T2.1 against the tree
on 2026-09-06 and found **0 of 6 built**, which is why this exists as its own job rather than as a
line in a fifth sweep.

**Status: all five built, each watched red first.** The receipts are in the appendix.

## The one that mattered most, and it was the review that found it

**Stage 3 as originally planned could not have caught its own incident**, and that is the most
useful thing in this document. The plan proposed confining the `dompurify` import to the three files
that bind it. GPT Sol read the postmortem and pointed out that `0f754742` added its
`purify.addHook(...)` to **`src/web/sanitize.ts`** — *one of the three exempted files*, which holds
its own instance as `const purify = DOMPurify(window)`. The rule would have said nothing about the
line that caused the incident, while refusing a harmless `import type` somewhere else.

A guard that cannot fire on its own incident is worse than no guard, because it is believed. The
check now scans the spelling that actually installs a hook — and it was **watched red by
reintroducing the incident line into that exact file**.

This is the same failure the job was commissioned to prevent, committed inside the plan for it, and
caught only because a second model read the source rather than the summary. It belongs in the record
next to the other one: the author of the brief had "verified" item (b) as missing by checking the
`lint` script, when it had landed as a test.

## Goal

Five red-tests-then-fixes with their own reviews, touching disjoint file sets. Nothing here is a
framework, and nothing changes what a reader sees except (d)'s log line, which no reader sees.

## What is deliberately not in scope

- **T2.1 item (b)**, the biome-config guard. **Already built**, as
  [`tests/biome-config-is-live.test.ts`](../../tests/biome-config-is-live.test.ts) — landed as a
  *test* rather than as the `package.json` line T2.1 proposed, which is why an author checking the
  `lint` script for an assertion found nothing and concluded the wrong thing. Not replaced, not
  duplicated, not "improved".
- **T2.1 item (f)**, `isAdmin` taking a bare id. That table's own text re-scopes it — 11 call sites
  on 2026-09-05, 12 on 2026-09-06, four in the client with no server project to pass — and
  [260828f](../postmortems/260828f-admin-id-was-the-local-one.md) concludes the more useful fix is a
  deploy-time identity check.
- **T2.2** (`sweepAbandonedDrafts` has no caller — it needs a schedule, which is Greg's call) and
  **T3.1** (splitting `src/routes.ts`). Both are sized elsewhere as separate jobs, and both are
  bigger than all five of these together.

## References

- [260905b § T2.1](260905b-improve-the-codebase-third-sweep.md) and
  [260906h § T2.2, § T3.2](260906h-improve-the-codebase-fourth-sweep.md) — the six, scored and then
  re-verified a day later.
- The five postmortems that asked for these:
  [260904b](../postmortems/260904b-a-sentence-written-for-the-reader-was-thrown-away-at-the-seam.md)
  (d),
  [260904a](../postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md)
  (a),
  [260904d](../postmortems/260904d-a-presentation-rule-inside-the-sanitiser-broke-the-one-policy-invariant.md)
  (c), [260827d](../postmortems/260827d-toc-status-never-checked.md) (e),
  [260903b](../postmortems/260903b-the-ledger-took-the-blame-for-a-half-finished-merge.md) (the
  conflict check).
- [silent-success.md](../reusable/silent-success.md) · [static-analysis.md](../project/static-analysis.md)
  · [logging.md](../project/logging.md).

## Principles

**Every one goes red before it goes green**, and where a permanent red test is not the right shape
the red is reproduced by hand and the command and its output are recorded below — the precedent
`npm run cycles` set (*"proved red against a two-file fixture before being switched on"*).

**Nobody is in the chat**, so questions, assumptions and rejected options are written here.

**Ordering.** (d) first, then (a), (c), (e), then the conflict check — the brief's order. A sibling
session owned `src/jobs.ts` for `PublishRefused` reason kinds; **their work was already on
`origin/dev`** (`6d38e979`, `94b9c32b`), verified before starting, so (d) was safe to take first.

---

## Stage 1 — (d): a `blocked` failure that named no way out says so in the log

**From** [260904b](../postmortems/260904b-a-sentence-written-for-the-reader-was-thrown-away-at-the-seam.md)
recommendation 2, *"first among the things not done"*.

`readerFailureOf` has two branches: the throw site declared a sentence, or it did not and gets
`stepGaveUp(kind, step)`. When that fallback lands on **`blocked`**, a step has promised the reader
a way out — that is what `blocked` *means*, the one non-retryable kind that admits one — and named
none. No type can catch it, because the throw may be bare and TypeScript has no checked exceptions.

### Log volume, measured before building it

| | count |
|---|---|
| `readerFailureOf` production call sites | **1** (`src/jobs.ts`, `runStep`) |
| times it can run | once per **failed step** |
| `stageFailure("blocked", { generic })` sites in `src/` | **0** |
| generic `stageFailure` sites that are `ours` / `bug` | 8 / 1 |

So the ceiling is one line per failed step, and **today no throw site in the pipeline can produce
one at all**. This is a tripwire, not a stream — it fires the day somebody reintroduces the class,
which is the whole point. Never any article prose: the line carries the step label and the kind,
both ours, pinned with a sentinel in the test.

### Where the `warn` goes

`src/job-failure.ts` **is in the client bundle** (`src/web/useStepJob.ts` imports
`jobWorthRetrying`), so it may not import `src/log.ts` — and not merely because of Pino:
`tests/client-imports.test.ts` enforces *shared modules stay leaves*, and records that the erasure
argument for relaxing it was made, accepted, and reverted the same afternoon.

So `declaredFailure` is extracted, `readerFailureOf` and `undeclaredBlocked` are both built on it —
they cannot drift — and `src/jobs.ts` owns the `warn` through `noteUndeclaredBlocked`, exported so a
test can drive it with a recording `Log`.

**Rejected, and recorded because it is the tempting one:** changing `readerFailureOf` to return
`{ failure, declared }`. Strongest, and it ripples through 32 calls in 10 files for one `warn`.
(The plan first said "~50 call sites"; GPT Sol counted 33 textual occurrences, 32 calls. The
conclusion is unchanged.)

### A branch that turned out not to need testing

`noteUndeclaredBlocked` is called under `if (!stopped)`. GPT Sol observed that a unit test cannot
prove that guard, since cancellation is decided inside the private `runStep`. It turns out the guard
is **belt and braces**: when `stopped`, `reader` is `INTERRUPTED` or `STEP_STOPPED`, both of which
are `retry`, so `undeclaredBlocked` is false on the kind alone. Pinned in the test rather than left
as an untested branch.

---

## Stage 2 — (a): a sixth Portal feature cannot go unnoticed

**From** [260904a](../postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md).
`portalDrift` compared five features with hand-written `if`s. The SDK (`stripe@22.6.1`) declares
exactly those five, so the comparison was complete **by coincidence of nobody having upgraded**. A
sixth going unnoticed is precisely how `subscription_update` was missed, at the cost of a paying
customer unable to upgrade for a month — the only item in T2.1 with a known customer-facing cost.

Two routes, and only one of them is a compile:

- **The SDK grows one.** `FEATURE_DRIFT`, a `Record<keyof …Features, (f, desired) => string[]>`. A
  sixth key cannot compile without a decision. **The map is load-bearing** — `portalDrift` iterates
  it rather than naming its members — because a key added only to satisfy the compiler, holding a
  function that returns `[]`, would be a list saying *compared* over a comparison nobody wrote.
  Each entry is driven to produce drift, and driven again against a correct configuration to produce
  none.
- **The live API returns one the SDK has not heard of.** `uncomparedFeatures`, with the known set
  **derived from `FEATURE_DRIFT`** rather than written out again (a second list of the same five is
  the exact bug this file exists to fix — GPT Sol).

### The finding this turned up, which was sitting in the test data

`liveConfig` in `tests/billing-portal-setup.test.ts` has carried
`subscription_pause: { enabled: false }` since it was written, and the SDK's `Features` **does not
declare it**. So the repository already held a live-shaped example of the second route, uncompared,
in its own fixture.

That is why the rule is **switched on**, not **unrecognised**. `portalDrift`'s output is a blocking
`✗` in `stripe:check`, under a line telling the reader to run `stripe:setup --apply` — and an apply
cannot remove a legacy key Stripe keeps on the object. Reporting every unrecognised key would make
that command permanently red under advice that cannot work. An inert `{ enabled: false }` exposes no
control to any reader; a feature that is **on** is a Portal control nobody costed.

The guard is exhaustive over feature **names**, not over the fields inside each one —
`payment_method_update` also carries `payment_method_configuration` and only `enabled` is compared.
Stated so it is not mistaken for more than it is.

---

## Stage 3 — (c): every DOMPurify hook is installed by one file

**From** [260904d](../postmortems/260904d-a-presentation-rule-inside-the-sanitiser-broke-the-one-policy-invariant.md).
See *The one that mattered most* above for what the first design got wrong.

The check scans tracked source for `\.addHook\s*\(` and requires the only file with a hit to be
`src/sanitize-policy.ts` — the untrusted-HTML seam [security-map.md](../project/security-map.md)
names. `\.addHook` and not the bare word, because `src/web/sanitize.ts` discusses `addHook` in prose
in its own header, and a comment explaining the rule must not be the thing that breaks it.

**Not a biome rule.** Biome has no `no-restricted-syntax`, and the import-scoped rule that *is*
available is the one that would have missed the incident. A test is also cheaper: no subprocess, no
whole-repo lint, and no probe file written into a tree other agents share — which GPT Sol separately
flagged, noting that `tests/fixtures/biome-live-probe.ts` documents that exact first attempt as
unacceptable debris.

**Narrow, and its own postmortem says so about this shape.** It does not stop a second config or a
presentation rule written another way, and it ranks below the parity invariant in
`tests/sanitize-client.test.ts`, which caught the real incident correctly and immediately. Parity
says *the two passes disagree*; this says *and here is the line*.

---

## Stage 4 — (e): one function answers "is the hierarchy run current"

**From** [260827d](../postmortems/260827d-toc-status-never-checked.md), whose named class is: *when
"is this row good" is answered by an inline expression at each call site rather than one function
both sites call, the question can be answered two different ways and nothing will say so.* The
postmortem asks for `isTocCurrent`; `toc` was renamed `hierarchy` afterwards, so the name follows
the step.

### Characterised first — and the two agree today

The third sweep cites `src/store/pg.ts:659`, which is stale; the check is at `:2544`–`:2548`
combined with `:2782`.

| | `pg.ts` (`articleMetadata`) | `pg-revisions.ts` (`reasonsNotToPublish`) |
|---|---|---|
| no run row | `false` | *"there is no record of the hierarchy step running"* |
| `running` | `false` | *"has not finished"* |
| `error` | `false` | *"ended in error"* |
| hash differs | `false` | *"the tree was built from different blocks"* |
| done, hash matches | `true` | no reason |

**They agree on every state.** Independently verified by GPT Sol, which also closed the cases the
table does not enumerate: `input_hash` is `NOT NULL`; an empty hash cannot equal `hashBlocks`, which
returns 16 hex characters; `NO_INPUT_HASH` is `"unstamped"` and differs; and a second `hierarchy`
row is impossible because `(revisionId, stepName)` is the primary key, so `runs[0]` is safe.

### What changes for an article currently on one side of the disagreement

**Nothing, for any article, because there is no disagreement.** That is the finding, and it is worth
stating rather than smoothing over in the other direction: the parity `260827d` says *"nothing
enforced"* has in fact been **true** since `e18ac5f` on 2026-08-27. What has not existed for those
eleven days is anything that would say so if it stopped being true. This is a **structural** change
with a proved-empty behavioural delta.

Had they disagreed, that would have been a finding to write up rather than a detail. It is not one,
and the truth table plus GPT Sol's independent reading is the evidence.

### The shape

A discriminated `HierarchyCurrency` rather than a boolean, because `pg-revisions.ts` needs *which*
of four things went wrong in four different sentences and `pg.ts` needs only the verdict — a boolean
would have left those sentences derived a second time from the same row.

The `different-blocks` variant **carries the hash it ran against**. Without it, the one caller that
writes a sentence about that case reaches back into the row through an optional chain that can never
be undefined there — a case that reads as though somebody had thought about it, and is not one. The
result is now self-sufficient: a caller needs nothing but the verdict to write its sentence.

`blocksHash` is **non-null `string`**, on GPT Sol's amendment: *"there are no blocks"* is a
different question, and both callers answer it before they get here (`articleMetadata` on a null
`blocksHash`, `reasonsNotToPublish` with its own earlier no-blocks/no-tree reasons). Without that
constraint the five-row table is not by itself a complete proof.

One claim from the first draft was overstated and is corrected: a fifth `why` forces the
**publication** switch to change; the metadata caller reads only `.current` and would not need to.

---

## Stage 5 — a conflict marker in a tracked file fails `npm run check`

**From** [260903b](../postmortems/260903b-the-ledger-took-the-blame-for-a-half-finished-merge.md),
recommendation 3. **Half of that recommendation was already built and was not redone**: `db:chain`
is `drizzle-kit check` and `scripts/check.ts` already runs it as a gate.

### The false-positive story, which is the whole design

Measured over all **3,935** tracked files: **30** files match a run of seven marker characters
anywhere on a line; **zero** match one anchored at column zero. Every legitimate quotation in this
repo is inline inside backticks (`git-resolve-merge-conflicts.md`, `database.md`) or `+`-prefixed
inside a quoted diff (`260902g-…-review-prompt.md`). `src/link-summary.ts`'s fencing is runs of
**three** `=`, nowhere near seven.

Three rules:

1. **Column zero, followed by a space or the line's end** — what git writes.
2. **`<`, `>` and `|` always fail. `=` only in a file that already carries one of those**, because
   a line of `=` is a valid Markdown setext heading underline and there are 1,541 tracked Markdown
   files.
3. **Seven *or more***, since `conflict-marker-size` is configurable and diff3 adds `|||||||`.

**Rule 2 was wrong in the first draft and GPT Sol caught it.** The draft made *both* `=` and `|`
conditional on an opening marker, on the argument that "a real conflict always brings the opening
marker with it" — which is false for the class under discussion, *interrupted* resolution.
`tests/migration-journal.test.ts` tests exactly a half-finished resolution leaving only
`||||||| base`, and `scripts/migration-ledger.ts` calls that case out. A lone `|` now fails.

### Three blind spots, each pinned as a test

A blind spot nothing asserts is indistinguishable from one nobody noticed, so all three are tests
that the next author has to delete before "fixing" one.

1. **A lowered `conflict-marker-size`.** GPT Sol's code review caught the comment justifying `{7,}`
   *"because configurable"* — backwards, since the option is configurable **downwards** and a
   four-character marker passes. The floor stays at seven anyway, and this is the deliberate part:
   it is the identical limit `readJournal` has, and `database.md` already calls that *"a good first
   line rather than a fence"*. Lowering it on a gate every agent runs would start reporting `====`
   dividers and `<<<<` in prose. Nothing in this repo sets the option.
2. **A lone `=======`.** The price of rule 2, and not the incident's shape — the journal contained
   `<<<<<<< HEAD` (`database.md`).
3. **A marker quoted at column zero inside a fenced code block** is reported, and once one has, a
   legitimate setext underline in the same file is reported alongside it. Telling a fence from a
   conflict needs a Markdown parser; GPT Sol's plan review said outright that parsing fences, HTML
   and captured-output formats would be over-building, and the plan review and code review agree.
   Quote a marker by indenting it, prefixing it as a diff line, or building it with `repeat()`.

**Binary detection is ours, not git's, and wider than git's.** `git grep -I` does **not** skip
`evals/pdf/much-harder/source.pdf`: it reads it as text and reports 69 lines beginning `<<`. The
first version copied git's first-8 KB window — and GPT Sol found that **two** tracked PDFs carry no
NUL that early, so both would still have been scanned as text. The whole buffer is already in memory
by then, so it is scanned entire. Still a heuristic, not identification.

**CRLF**: the scanner splits on `/\r?\n/` rather than anchoring with `$`, or a bare `=======\r\n`
would never match. Also GPT Sol's, from the same neighbouring suite.

**Neither the script nor its test contains a literal run of seven** — the patterns use `{7,}`
quantifiers and the fixtures use `repeat()`. Not tidiness: `260903b`'s receipts record the first
journal-guard fixture tripping `git diff --check` inside the very test that guards against markers.

**Gate, not advisory**, on `scripts/check.ts`'s own rule: green today, no database, no network,
~400 ms.

### One thing to know about its scope

It scans **tracked files only**, and that is a real limit rather than a detail. Proved by accident
while watching it fail: a marker written into this plan doc was **not** reported, because the file
was untracked at the time. That is the right scope — an agent's scratch file is not the tree's
problem — but somebody expecting it to police their working directory should know it does not.

---

## What the code review changed

The plan review found two blocking problems; the **code** review found six more, which is the
argument for weighting the second one higher.

| finding | what it was | what changed |
|---|---|---|
| **Two hand-copied lists in Stage 2's own test** | the name census and the driven cases were separate arrays, so a sixth feature could be added to the map, added to the census, and left out of the driven list — a map entry comparing nothing, passing both. *The exact class the map exists to close, reintroduced in its test.* | the driven cases are derived from `FEATURE_DRIFT` |
| **Stage 3 missed a multi-line call** | `purify.addHook` with its bracket on the next line, and `?.` — a per-line scan sees neither | scans whole-file text, and the spellings it still cannot reach (`p["addHook"]`, an alias) are asserted so the promise matches the code |
| **Stage 3 skipped `.mts`/`.mjs`** | 26 and six tracked files in the scanned roots, so the guard had a hole where the evals live | one regex over the extensions this repo actually uses |
| **The `{7,}` comment was backwards** | see blind spot 1 above | comment corrected, limit named, test added |
| **8 KB NUL window** | two tracked PDFs pass it | whole-buffer scan |
| **`name in FEATURE_DRIFT`** | `in` walks the prototype, so a feature Stripe named `toString` would read as compared | `Object.hasOwn` |
| **"switched on" overclaimed** | an ahead-of-SDK value that is primitive or lacks `enabled` fails closed, correctly, but was described as switched on | the message says which of the two it saw |
| **Stale hard-coded counts** | 3,935 and 30 went stale the moment `origin/dev` was merged | counts live here with their date; the run prints today's |

Two smaller things it confirmed rather than changed: `> 200` is a sane positive control (the scanner
universe is 648 files, and losing `src` would leave 144), and moving the inactive-configuration drift
to the front of `portalDrift`'s array changes presentation order, not any assertion's meaning.

**One finding was stale rather than wrong.** The review said the belt-and-braces cancel property was
claimed but not pinned; it had been pinned between the diff being cut and the review landing. Both
`STEP_STOPPED` and `INTERRUPTED` are driven through `noteUndeclaredBlocked` with a `blocked` error
now.

**And one thing the review could not do**, stated so nobody reads its verdict as wider than it is:
the sandbox refused nested `spawnSync git` with `EPERM` and had no Postgres, so the two whole-tree
tests and the database-backed Stage 1 and 4 suites did not run there. They ran here.

## Rejected, and why

- **A biome `noRestrictedImports` rule for `dompurify`** — could not fire on its own incident.
  Stage 3.
- **Changing `readerFailureOf`'s return type** — 32 call sites for one `warn`. Stage 1.
- **Reporting every unrecognised Portal feature** — would make `stripe:check` permanently red under
  advice that cannot work. Stage 2.
- **A boolean `isHierarchyCurrent`** — would leave the four refusal sentences derived a second time
  from the same row. Stage 4.
- **A two-line `grep` for conflict markers** — 1,541 Markdown files, a tracked PDF that git reads as
  text, and a repo that quotes conflicts in its own docs. Stage 5.

## Appendix — the reds, as they were watched

| stage | the red | what was seen |
|---|---|---|
| 1 (d) | new test before `undeclaredBlocked` existed | `TypeError: noteUndeclaredBlocked is not a function`, 5 of 6 red |
| 2 (a) | new test before `FEATURE_DRIFT` existed | 6 red, 51 pre-existing green |
| 2 (a) | a sixth key added to the map | `TS2561: Object literal may only specify known properties, but 'subscription_pause' does not exist in type 'Record<keyof Features, …>'` |
| 2 (a) | a declared feature removed from the map | `TS2741: Property 'invoice_history' is missing … but required in type 'Record<keyof Features, …>'` |
| 2 (a) | `uncomparedFeatures` call commented out | *reports one that is on, because it is a control nobody costed* — 1 red |
| 3 (c) | the incident line put back into `src/web/sanitize.ts` | `expected [ 'src/web/sanitize.ts' ] to deeply equal []` |
| 4 (e) | the status arms deleted from `hierarchyCurrency` | **7 red, and 4 of them are pre-existing publication-guard tests** — *refuses a tree whose hierarchy run errored, however well its hash matches* |
| 4 (e) | a fifth `why` added to `HierarchyCurrency` | `TS2322: Type '{ current: false; why: "abandoned" \| … }' is not assignable to type 'never'` — the publication switch refuses to compile |
| 5 | markers written into `drizzle/meta/_journal.json`, the incident's own file | `drizzle/meta/_journal.json:4/7/10`, exit 1, with the `db:chain` advice |

Every probe was reverted immediately and the tree confirmed clean afterwards.

**One accident worth keeping.** The first attempt to watch stage 5 fail wrote markers into *this
plan doc* and the gate reported nothing — because the file was untracked at the time. That is the
right scope, and it is also exactly the shape of a check passing while doing nothing, found by
watching it fail rather than by reasoning about it.
