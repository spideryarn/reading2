# The pipeline writes to Postgres, and then the importer goes

> Do we only need import once for legacy stuff? If so, I'm tempted to ditch it. There's basically
> nothing in the current files/data/database that I care about losing. Or tell me if I'm
> misunderstanding.
>
> — Greg, 2026-08-27

> Ok, great, proceed as per your recommendation. I don't care about preserving/importing existing
> data. Let's aim for the long-term-best approach.
>
> — Greg, 2026-08-27

He is right about where this ends up and wrong about one word. `db:import` is not *legacy* — it is
the **only** way an article's content reaches Postgres today. [`src/jobs.ts:49`](../../src/jobs.ts)
hardwires `fsArtifacts` and runs every stage through it, and the only content-bearing `insert` into
`article_revisions` outside [`src/store/import.ts:559`](../../src/store/import.ts) is `beginDraftIn`,
which copies from a previous row or mints an empty draft. So the importer cannot be deleted; it has
to be **replaced**, and the replacement is [transactional-stage-runner.md](transactional-stage-runner.md)
landings B–D, which we need anyway.

What Greg's answer changes is not *whether* but *how much*. This document is the re-sequencing, and
**[GPT Sol's input round](delete-the-importer-review-sol.md) returned NO-SHIP on its first draft**
with eleven findings. Ten are folded in below and every one of them was checked against the code
before it was accepted. Two of them killed things I had just written down as answers, which is the
useful kind of review.

---

## Where it stands, 2026-08-28

Seventeen commits. **All of C is done and reviewed; C1 was built and withdrawn.** Five of
them were live bugs found on the way, which is the pattern worth noticing: **every one came out of
reading code near something else**, not out of the work item that was planned.

| | what | why it is here |
|---|---|---|
| `e18ac5f` | **The ToC status hole.** `publishRevision` compared the `toc` run's `input_hash` and never read its `status`, so a table of contents that ran and *failed* published. A step records its hash when it **starts**, so the hash agreed precisely in the failing case. | A live bug, found by Sol reviewing this document. Fixed first and alone, because the source-reference gate is a second guard of the same shape and would have inherited it. |
| `fd30c5d` | **A schema comment claiming a guard.** `src/db/schema.ts` said the raw-source rule was one *"which `publishRevision` enforces"*. It never has — and nothing writes those columns yet, so the claim was **vacuous**, not merely wrong. My comment, from last week. | The second such comment in one day. § What this has taught us. |
| `2a2cf7f` | The [postmortem](../postmortems/toc-status-never-checked.md) for the first, which found the part I had not. | |
| `5d8ed19` | **The importer's replacement, and a latent bug it exposed.** `tests/helpers/artefacts.ts` copies an article between two `ArtifactStore`s; calling `ArtifactStore.write` for the first time failed, because `writeAtomic` never created its directory. | § The replacement, and § What this has taught us. |
| `9e28f8c` | **The adapter's shape, settled** by a second Sol round that returned NO-SHIP on two of my three answers. | § The adapter's shape, settled. |
| `59e8e3a` | **C1 — `toc` gets a real stamp.** Built. | Withdrawn four commits later; § The build order for C. |
| `1f624e6` | **The copy helper completes its steps**, rather than only writing them. | § What the second review changed, finding 2. |
| `4da9bcf` | **C2 — `beginStepRun` and `finishStepRun`**, the first writer and first reader of `revision_step_runs.attempt_id`. The sentinels move to `artifacts.ts` to break an import cycle the linter refused. | § The build order for C. |
| `414f3f9` | **C1 withdrawn, and three holes in C2's fence closed** — a stale claimant could finish a step for a job that had already failed; a token could reopen a run it had ended; the copy helper finished half-copied steps. | § What the review of the built code changed. |
| `c6ceed5` | The plan, brought up to date with what the built code taught. | |
| `f40461c` | **C3 — the map, `readArtefact` and `stampForStep`**, plus a third Sol round that returned NO-SHIP on three of my answers and took the `toc` case out of C4 before it was written. | § What the third review changed. |
| `cca945b` | **C4 and C5 — `has`, `interrupted`, `write`, and the two store views.** The seam now has a working Postgres adapter for everything but `raw`. | § The build order for C. |
| `4fe11f7` | **The corpus backfilled** — the objects were already on disk, so this stores them rather than re-fetching. | § Where it stands. |
| `056c46e` + `4038291` | **A live bug with nothing to do with this plan**, and the guard for its class. | [the-config-file-is-not-the-bucket.md](../postmortems/the-config-file-is-not-the-bucket.md). |
| `85e76b0` | **The review of the built landing, acted on** — five real bugs, including one that would have refused every uploaded document. | § What the code review of C found. |
| `5dc3b32` | **Not mine.** `src/library-scalars.ts`, committed because the commit before it had already imported it — see below. | |
| `a635cef` | **C6's two columns**, once the schema went quiet. `raw_filename` and the manifest's stored fields — the adapter had been writing to a schema that did not have them. | § C6. |
| `3fc74f7` | **`loadArticleIntoPg`**, the importer's replacement for tests, and the carry-forward that was faking its evidence. | § C7. |
| `a0b2c14` | **C7 — the three suites off the importer**, the corpus wiped so the comparison means something, and a permanent data-loss bug in `db:export` found by doing the review's homework. | § C7, and [the postmortem](../postmortems/export-never-wrote-the-readers-purpose.md). |

**Done:** C2 through C7, all reviewed as built. **Withdrawn:** C1 — and the consequence I drew from
withdrawing it was itself wrong, which is § lesson 7.
**Not started:** B3, then D, the demolition, E. And one thing this document has never named, which
now goes in front of D: § Stage 3 carries block ids in a file.

**The corpus is done, and it was a backfill rather than a re-ingest.** All seven manifests now carry
`storedSha256` and `storedBytes`, and each object was verified against the bucket afterwards —
read back, hashed, and compared with the file on disk — rather than trusted from the script's own
report. Re-fetching was the plan's word for it and would have been worse: the bytes were never gone,
and a re-fetch stamps today's `fetchedAt` onto an article fetched weeks ago, which the shelf sorts
on. `scripts/backfill-raw-manifests.ts`.

**And it found a live bug that had nothing to do with this plan.** Every HTML fetch had been throwing
a 415 for seven hours: the local `sources` bucket still allowed only `application/pdf`, because
declaring a bucket in `supabase/config.toml` does not change one that already exists, and the comment
beside that declaration claimed — as a *measurement* — that the allowlist could not stop a
service-role upload. The storage container's whole request log contains no such upload; the probe's
bytes went to the filesystem blob store instead.
[the-config-file-is-not-the-bucket.md](../postmortems/the-config-file-is-not-the-bucket.md) has both
halves, and `bucketDrift` in `scripts/deploy-checks.ts` is the guard for the class.

**I committed another session's work under my message, and this is the second time this repo has
recorded it.** `git add src/store/pg-revisions.ts` stages that file *whole*, and a peer's rename of
`REVISION_COLUMN_POLICY` and their extraction of `deriveLibraryScalars` into a new module went in
under `cca945b`. I checked the diffstat and not the diff. The repair was additive — `5dc3b32` adds
the new module, because without it `cca945b` imports a file nothing tracks and does not build.
Unpicking it would have meant editing a file another session is in the middle of.
[version-control.md](../project/version-control.md) already says to run `git diff --cached` on every
shared file; the diffstat is not that.

**C6 is blocked, and not by anything in this plan.** It needs two new columns, and `src/db/schema.ts`
has 127 uncommitted lines of somebody else's ai-spend work plus an ungenerated migration.
`drizzle-kit generate` diffs the *whole* schema, so running it now would sweep their tables into my
migration — the same accident as the paragraph above, in the one place where it cannot be repaired by
adding a file. Everything in C6 that needs no column is done; the columns wait for the schema to go
quiet.

**One thing has moved earlier.** The re-ingest of the corpus was going to happen at the demolition.
It has to happen **before C7** instead: all seven checked-in manifests predate `storedSha256`, so
C6's refusal breaks every fixture that has not been re-fetched.

**Nothing is at risk from the re-ingest.** All three eval PDFs are tracked in git and both upload
fixtures are the same file as `evals/pdf/easy`. § What it does not delete has the table.

## What this has taught us, so far

Written down because several of these are the same shape — a check, a comment or a conclusion that
looks like evidence and is not.

**1. A check proves nothing along any dimension it shares with the code it checks** — and that
includes checks on checks. Not *nothing at all*: an assertion can be sound about one thing and blind
about another, and the trap is assuming the sound half covers the blind one. Three times in two days:

- The first version of `tests/artefact-copy.test.ts` compared `readParts(source)` against
  `readParts(destination)` — **the function under test on both sides of the equals**. Deleting a kind
  deleted it from both readings, and all thirteen assertions stayed green. The fix is a written-out
  list of expected files, which cannot agree with a bug in the code it checks.
- Measuring lint complexity by copying the file to a scratch directory reported *nothing* — for the
  known-bad version too. The check was blind, and only running it against the state I knew was broken
  showed that.
- The habit that catches all of them costs a minute and is now used on every fix here: disable the
  one line, run the single test by name, restore. Every fix in this document has been through it.

**2. A comment is where a rule goes to look enforced.** Two in one day, in two files, both asserting
a guard nothing implemented, neither catchable by any test — one of them because the columns it
constrained had no writer, so there was no case it could have been false about. The
[postmortem](../postmortems/toc-status-never-checked.md) has the general form: when *"is this row
good"* is answered by an inline expression at each call site rather than one function both sites
call, two answers can exist and nothing will say so.

**3. An unexercised path is unproven.** `ArtifactStore.write` had no production caller and failed on
its first call, because it never created its directory — every stage `mkdir`s for itself, and landing
D deletes exactly those. `beginStep`, twenty lines further down, has always done it: the method with
a caller learned, the method without one did not.

*Narrowed after review.* The first version of this lesson said *"the method with no caller is the one
that does not work"*, which one instance does not support. The defensible claim is the weaker and
more useful one above — and it earns its place by predicting where to look next, not by explaining
what already happened.

**4. A fixture that has everything gives a skip-case nothing to run on.** `data/writes` has been
through every stage, so *"a step with nothing is skipped"* had no case at all and passed against code
that did the opposite. Any test about absence needs a fixture that is actually missing something.

**5. Where an ORM's behaviour is genuinely ambiguous, measure it.** I wrote down as a trap that
`recordStepRun`'s upsert would clobber `attempt_id`. Sol said otherwise; a rolled-back transaction
against the local database settled it in two minutes — the token survived while status and hash
updated. The lesson is not "reading code is not evidence", which is too strong and would make every
review worthless. It is that `set: values` has two plausible readings, and a claim resting on the
one you happen to prefer had already reached a committed document.

**6. Checking half of a finding is worse than not checking it.** Sol said C1 would orphan `toc`'s
consumers. I checked, found they key on **block-id ranges** rather than tree node ids, wrote
*"a rebuilt tree over unchanged blocks orphans nothing"*, and narrowed the finding in the plan and in
a commit message.

Keying by range answers a different question from the one asked. It stops an entry attaching to the
**wrong** node; it says nothing about an entry matching **no** node, which is what a rebuilt tree
with different boundaries produces — and `src/web/tree.ts` states that outright in a comment I read
while confirming the half I got right. The verification felt more thorough than accepting the
finding, and it was less.

The habit that would have caught it is the same one as lesson 1, pointed at my own conclusion: state
what would have to be true for the finding to be *right*, and check that, rather than checking the
first mechanism that comes to hand.

**7. A withdrawal has consequences, and I got mine backwards.** Withdrawing C1 was right. What I then
wrote into C4 — *"with no stamp to compare, `has` must carry an explicit `toc` case comparing the run
row's `input_hash` against the stored blocks"* — was wrong in three separate ways, and I put it in
the plan, in a commit message, and in a comment on `STEPS.toc`.

- It is a **freshness rule**, in the one function two rounds of review had just finished carving
  freshness out of.
- It walks **back into the hazard C1 was withdrawn for**. `has` false makes `stepIsDone` false makes
  `toc` re-run makes the tree's boundaries move makes `arc` and `summary` silently lose entries. A
  different door into the same room.
- It could **never have matched**. `beginStepRun` writes `NO_INPUT_HASH` on purpose, and
  `finishStepRun` leaves it there for a step that declares no input — so `toc`'s `input_hash` would
  have been the string `"unstamped"` for every article the pipeline ever wrote, and `has` would have
  answered false for ever.

And the same paragraph contained the disproof: four lines below, it says `has` should be **true** for
a carried `toc`. I wrote both and did not notice they contradict.

What makes this different from lesson 6 is that nothing here needed checking against the code. It
needed reading twice.

**8. Two stamps are not one stamp.** Falling out of lesson 7, and it is the more useful half.
`PipelineStep.stamp` is the *expected* stamp, computed before a step runs, and `toc` must not have
one. The `input_hash` a completed run **records** is a different thing, and `toc` must have that —
because `reasonsNotToPublish` compares it against the stored blocks and refuses the publication when
they differ. Leaving it as `NO_INPUT_HASH` would have made every article the new runner produced
unpublishable, and the symptom would have been a refusal naming the tree.

**9. `git add <file>` is not `git add <my changes to file>`.** See § Where it stands. The rule was
already written down; what was missing was doing it. A diffstat is not a diff.

**10. The check that would have caught it was a comment.** Not this landing's bug, but found by it,
and it belongs here because it is lesson 2 taken one step further. `supabase/config.toml` carried a
*measurement* — that a bucket's mime allowlist does not stop a service-role upload — and it was false
when it was written, because the probe's bytes had gone to the filesystem blob store instead. Nothing
re-ran it, so it stayed true-looking for a day while the thing it described sat there refusing every
HTML fetch. This repo's rule is *a check you have never seen fail is not evidence*; this is its
mirror image, a check seen to pass once and then converted into prose.
[the-config-file-is-not-the-bucket.md](../postmortems/the-config-file-is-not-the-bucket.md).

**11. "Safe because of the transaction" is not the same as "fails before doing work".** Two of the
code review's findings were this, and both of my originals were genuinely safe: a late refusal rolls
everything back. They were still wrong, because between the work and the refusal any *other* error
can be raised — and that error is what somebody reads, instead of the refusal that explains it. Take
the lock before the work.

## What the second review changed

[The third Sol round](delete-the-importer-review-2-sol.md) read this document *plus* the five commits
and returned **NO-SHIP** with three criticals. Each was checked against the code before being
accepted, and **one did not survive that check** — recorded here rather than quietly dropped,
because the reason it failed is a fact about this codebase worth knowing.

**Checked and narrowed: re-running `toc` does not orphan its consumers.** The finding was that C1
adds a reason for `toc` to run that `cascadeForce` knows nothing about, leaving *"a new tree beside
an old arc"*. The reasoning assumed downstream artefacts are keyed to the tree. **They are not.** A
summary entry is keyed by a **block-id range** — `{"range": ["spya-hqt79k", "spya-zz20s6"], "depth":
0, …}` in `data/writes/summary.json` — so a rebuilt tree over unchanged blocks orphans nothing. And
where blocks *have* changed, `toc` rewrites `data/<slug>/blocks.json` as part of its own run, which
is what `inputHashFor` reads, so every blocks-stamped consumer goes stale by itself.

What is left of the finding is real but older than C1: **`arc` declares no stamp at all**, so it
never re-runs on staleness whatever changes. That is a pre-existing gap, not one C1 opened, and it
belongs on its own line rather than as a reason to hold C1.

**Accepted, and fixed immediately:**

- **The copy helper never completed a step.** It called `write` alone. On the filesystem that nearly
  passes for a copy, because `has` parses the artefacts and says yes; the Postgres adapter cannot be
  so forgiving, since carry-forward means a value can be present without this step having produced
  it. `copyArtefacts` now runs `beginStep` → `write` → `finishStep`, which is also the runner's own
  order — a fixture that shortcuts the seam stops proving the seam works.

**Accepted, and folded into the landings below:**

- **B2 is *not* "mostly built".** `RawManifest.bytes` is the length of what the network sent
  (`doc.bytes.byteLength`, [`src/fetch.ts`](../../src/fetch.ts)), while `raw_sources.bytes` describes
  the object at the *stored* hash — and for any non-UTF-8 page those differ, for exactly the reason
  the two hashes do. The manifest computes `storedBytes` and then records only its hash. C6 must
  carry the stored length too.
- **`uploadId` is not durably "already on `jobs`".** Publication clears the job's draft link,
  revisions carry no job id, and finished jobs can be deleted. So an uploaded revision's identity
  cannot be reconstructed later, and § The raw provenance is wrong to lean on `jobs.upload_id`.
  Either a revision-level column or an explicit dropping of that promise.
- **Every checked-in manifest lacks `storedSha256`** — all seven. So C6's refusal would make C7 fail
  the moment it lands. The fixtures have to be re-fetched first, which the re-ingest covers anyway;
  it just has to happen *before* C7 rather than at the demolition.
- **C4's stated test contradicts C4's stated definition** — see the landing.
- **C2's red test would have stayed green.** See the landing, and note that this is lesson 1 catching
  the plan's own mutation habit failing: the state I proposed to build already fails the *status*
  half of the fence, so deleting the attempt half changes nothing.
- **Importer rows are smoke data, not an oracle** for C3. The importer stores `extractedHtml: null`,
  stamps every inferred step with the same fingerprint where `ideas` uses blocks-plus-tree, and has
  no source reference. Agreeing with it would prove importer-plus-adapter behaviour, not correctness.

## What the review of the built code changed

[The fourth Sol round](c1-c2-code-review-sol.md) read C1 and C2 **as built** and returned NO-SHIP.
This repo weights a review of built code above a plan review, and this round is why: the two row
conditions in `finishStepRun` look complete on their own, and a plan could not have shown otherwise.

- **C1 withdrawn.** § The build order for C has the reasoning and lesson 6 has the mistake.
- **`finishStepRun` took the row's word for it.** `failExpired` clears a lapsed job's token without
  touching its step runs, so a swept worker found its row still `running` under its own token and
  would have committed `done` for a job that had already failed. Both callers now share one
  `requireLiveJobOwnsDraft`.
- **`beginStepRun` let a token reopen a run it had already ended** — `done/A` back to `running/A`,
  `finished_at` cleared, the recorded hash replaced with `unstamped`. A *different* attempt reopening
  is legitimate and stays allowed; only the same token is refused.
- **`copyArtefacts` finished half-copied steps.** All of a step's products, or a loud refusal.
- **A comment of mine claimed every caller takes the job and article locks in one order.** They do
  not: `openOrBeginJobDraft` takes job-then-article, `publishRevision` and `failRevision` take
  article-then-job. That inversion is real, predates this work, and is now written down at
  `beginStepRun` rather than left as a fourth false claim in a comment.

Two things it checked and passed, worth recording because they were deliberate choices: writing
`NO_INPUT_HASH` on begin is honest (a crashed row stays non-`done`, and `articleMetadata` gates on
that), and `rowCount !== 1` is correct because `(revision_id, step_name)` is the primary key, so
concurrent finishes serialise.

## What the third review changed — the design of C3 and C4, before either was built

[The fifth Sol round](artifacts-pg-has-sol.md) was asked one question: is the `toc` case in C4 wrong?
It said yes, and then said NO-SHIP on three more of my answers. Every finding was checked against the
code before being acted on.

- **The `toc` case is deleted**, for the three reasons in lesson 7. So is the now-false consequence
  I had written onto `STEPS.toc`.
- **But the runner must still record `toc`'s input hash**, or nothing publishes. Lesson 8; written
  where it will be read, at `STEPS.toc` and at `writeArtefacts`.
- **A stamp the row and the artefact disagree about is refused, not resolved.** My design let the
  artefact silently win. The artefact is the *authority* — the file adapter reads it and nothing else
  — but a disagreement is a fact, and picking the one that looks current is how a stale artefact gets
  served for ever. `stampForStep` returns `null` and warns; `writeArtefacts` refuses the write, which
  is where the disagreement can still be prevented.
- **The row may not fill a field the artefact has no room for.** `arc.json` carries no `sourceHash`,
  and `revision_step_runs.input_hash` is NOT NULL and always populated — so a merge that filled the
  gap would give Postgres freshness evidence the filesystem does not have, and the same article would
  be current in one store and stale in the other. The row contributes exactly one field:
  `implementation_version`, which no artefact carries. **My own test could not see this**: it only
  ever set the field the correct rule allows.
- **A raw document whose source reference and stored bytes are different kinds is corruption**, and
  is refused rather than resolved. I had the reference winning.
- **Meta absence is `title === null`, not falsy.** An empty title means extraction ran and produced
  nothing usable; null means nothing was recorded. Reading the first as the second reports an article
  as never extracted.
- **And one premise of mine was simply wrong:** `raw_filename` is the *reader's* name for an uploaded
  file, not `RawManifest.file`, which is derived from the kind and always has been.

**It also grew C6, and this one is a NO-SHIP on the plan rather than on the code.** After `raw_bytes`
is dropped, `RawManifest.bytes` — the count of what the network sent — has **nowhere to live**.
`raw_sources.bytes` is the *stored* count and answers a different question, and adding `storedBytes`
to the manifest (which C6 already planned) does not preserve the other one. So C6 needs two columns,
not one. § The build order for C.

## What the code review of C found

[The sixth Sol round](landing-c-code-review-sol.md) read C3 through C6 as built and returned
**NO-SHIP** with five real bugs. This repo weights a review of built code above a plan review, and
this round is the clearest case yet: **not one of these was reachable from the plan.** Each was
verified against the code before being acted on, and each fix was watched red on its own.

- **Every uploaded document would have been refused.** `src/pipeline.ts` calls `storeRawSource`,
  discarded the digest it returns, and wrote a manifest naming no object — so C6's refusal would
  have fired on every upload. The test called *"writes the same manifest a fetch writes"* was green
  throughout, because it checked six fields and not the two that had just become load-bearing.
- **`writeRawSource` certified an object it had never seen.** It set `verified_at` to `now()` on a
  row whose meaning is *"when the bytes at this key were last shown to hash to it"* — on the strength
  of a file. Sol found it by noticing that the tests invent hashes and never put an object behind
  them. It now dates a new row from the manifest's `fetchedAt`, which is when `storeRawSource` did
  the verifying, and leaves an existing row alone. And because that row is **shared**, a manifest
  that disagrees with it about `bytes` or `content_type` is refused rather than ignored.
- **`readRaw` ignored the two columns C6 had just added for it**, and the test asserted the `bytes: 0`
  that resulted — a fixture that had stopped being an oracle and become a record of the bug.
- **A stamp clash returned `null`, which every caller reads as "re-run".** `copyArtefacts` turns a
  null stamp into `{}` and copies the artefact anyway, resolving the clash in the artefact's favour
  with nothing saying so. It throws now.
- **`has` validated its arguments after reading the database**, so whether a `(step, kind)` pair was
  valid depended on whether the step had run.

Two orderings moved, both from "safe because of the transaction" to "fails before doing work":
`write` locks the step-run row before touching any artefact table, and the backfill script writes
through a rename, refuses a manifest whose kind, filename and bytes disagree, and re-verifies an
object it is about to call *"already done"*.

**And one I found while writing the test for it:** importing that script ran it. A bare `void main()`
meant importing one pure function started a run that reads `data/` and talks to the bucket — under
vitest it began and the process exited first, so it left no trace at all.

---

## What the decision deletes

Three pieces of designed-but-unbuilt work stop existing. A fourth thing I claimed it deleted, it does
not — see § What it costs.

**1. The verifying backfill.** [raw-bytes-in-storage.md § The backfill can put the wrong bytes under
a hash](raw-bytes-in-storage.md) is the most dangerous page in that plan, and restating why is what
makes deleting it worth so much. There are two hashes: `article_revisions.raw_sha256` is the hash of
what the network sent; `raw_sources.sha256` is the hash of what we actually stored. For any page that
was not already UTF-8 they differ, because `writeRaw` stores the decoded string. A backfill that
trusts the stored `raw_sha256` therefore uploads bytes that **do not hash to their own key**, and
content addressing is broken permanently and silently — a later `putIfAbsent` returns `already-there`
and nobody ever looks.

The safe version of that backfill has to hash what it reads rather than what the row claims, handle
null hashes, and record degraded provenance where the two disagree. All of it goes. A revision
written by the live pipeline computes its hash from the bytes it just wrote, in the same function, so
the two values cannot drift apart in the first place.

**2. Three import-only test files.** `store-import-prune`, `store-import-revision`,
`store-import-convergence` — 14 test blocks. (The first draft said four; there are three. The other
three importer users are suites that need *replacing*, not deleting, which is the distinction § What
it costs is about.)

**3. Migrating anything.** No corpus walk, no verification pass, no per-environment rollout.

## What it does not delete — and the correction that matters most

The first draft said *"existing rows keep working; deleting the importer only stops new articles
arriving."* **The first half is not true once the publication gate is on**, and this is the finding I
would least have liked to discover during the demolition.

Every revision the importer wrote has a `fetch` step row with `status = 'done'`
([`src/store/import.ts:800-837`](../../src/store/import.ts)) and a null `raw_source_sha256`, because
the importer does not write the new reference. And `beginDraftIn` copies the step-run rows **row for
row, status included** ([`src/store/pg-revisions.ts:593-611`](../../src/store/pg-revisions.ts)) while
carrying the null source pair. So the moment the gate is on, *any* later job on an existing article
— a glossary run, an ideas run, a re-ToC, anything that does not itself re-fetch — arrives at
publication with `fetch = done` and no reference, and is refused.

That is not "existing rows keep working". It is **every existing article frozen against further
work** until it is re-ingested.

Greg's answer covers the underlying loss, so the resolution is the boring one and it is stated here
as the assumption this plan runs on:

> **Assumption.** At the demolition, the existing corpus is **re-ingested** through the new path
> rather than migrated, and articles not worth re-ingesting are dropped. There are eight articles in
> the local database and eleven directories on disk; this is an afternoon, not a project.

Said out loud because "I don't care about the data" and "every article stops accepting new work" are
not obviously the same sentence, and Greg agreed to the first without being shown the second.

**And the check that afternoon needs has been done — nothing is at risk.** Every raw source in the
corpus is recoverable, which is a better answer than the question expected:

| article | source | recoverable from |
|---|---|---|
| `fowler-phrenology` | `evals/pdf/much-harder/source.pdf` | **tracked in git** |
| `ball-lightning` | `evals/pdf/harder/source.pdf` | **tracked in git** |
| `coolabah-memory` | `evals/pdf/easy/source.pdf` | **tracked in git** |
| `source`, `source-2` | uploads, both 144,779 bytes | the same file as `evals/pdf/easy` — tracked in git |
| `revistes-ub-30977` | `revistes.ub.edu/…/30977` | the web |
| `writes` | `paulgraham.com/writes.html` | the web |
| `constitution`, `example` | no `raw.json`, no raw file | nothing to lose |
| `noema-mythology-of-conscious-ai` | a bare `raw.html`, **176,736 bytes**, and no manifest | ⚠ see below |

Greg offered the `much-harder` PDF as the one file he still had. All three are in the repository, so
the re-ingest is three local paths and two URLs.

> **The `noema` row said "nothing to lose" and was wrong.** GPT Sol found it reviewing C7,
> 2026-08-28. The article has a real 176,736-byte `raw.html` on disk and no `raw.json` beside it —
> hand-assembled before manifests existed. The `raw` step's artefact **is** the manifest, so nothing
> copies the document, nothing writes a source reference, and `db:export` has no object to write.
> `db:import` read the bare file straight into `article_revisions.raw_bytes`, and C6 dropped that
> column. So this is a loss the migration *makes*, not one it found, and it is currently asserted as
> expected behaviour by `tests/store-roundtrip.test.ts`.
>
> **Not backfilled here, and the reason is the one Sol gave against option (c) last time: a manifest
> is provenance, and this one would have to invent a `fetchedAt`.** `storedSha256` and `bytes` can be
> computed from the file; when it was fetched cannot be recovered from anything, and `meta.fetchedAt`
> is stage 2's clock (see the two-clock note below), so copying it in would put a fabricated fetch
> time in the one field the shelf sorts on.
>
> **The class is closed going forward** — both acquisition paths in `src/pipeline.ts` call
> `storeRawSource` and write a manifest — so this is one legacy dev fixture, not a live risk.
> **Greg's call**, and the options are: re-fetch the URL (`meta.json` has it), accept the loss and
> drop the file, or write a manifest marked `backfilled` with an explicitly null fetch time, which
> would need `RawManifest.fetchedAt` to become optional.

## What it costs

Forty-five test blocks call `importArticle`, across six files: `store-parity` (10),
`store-roundtrip` (10), `chat-anchor` (11), `store-import-prune` (7), `store-import-revision` (4),
`store-import-convergence` (3). A seventh, `store-export-isolation` (1), uses only the export half.
Three of the six are load-bearing:

- **[`tests/store-parity.test.ts`](../../tests/store-parity.test.ts)** — *"the test the whole
  migration rests on"*, in its own words. It compares the **wire form** of `fsArticleReader` against
  `pgArticleReader`: the `Article` shape, block order, the library listing, derived counts, and how a
  traversal slug is refused.
- **[`tests/store-roundtrip.test.ts`](../../tests/store-roundtrip.test.ts)** — files → import →
  export → files, artefact by artefact. This is the one that was quietly not checking raw documents
  at all until 2026-08-27, when total loss of every raw source passed it.
- **[`tests/chat-anchor.test.ts`](../../tests/chat-anchor.test.ts)** — not a store test at all. It
  uses import→export as a *vehicle* for the [block-id contract](../project/block-ids.md), and its own
  header says the way to watch it go red is to drop the `blockIdentities` insert from `importArticle`.

### The replacement, after two wrong answers

**Wrong answer 1.** I said the replacement was already on the list: item 2 of
[transactional-stage-runner.md § What has to be true](transactional-stage-runner.md), one set of
cases over `fsArtifacts` and the Postgres adapter. That suite is worth having and it replaces **none**
of the three. `store-parity` is a *reader* comparison, one whole layer above the artefact store; an
`ArtifactStore` suite does not reach a single one of its assertions. Sol's mutation test makes it
concrete: delete `byline` from `metaFrom`, or reverse `blocksFor`, and adapter parity stays green
while reader parity fails.

**Wrong answer 2.** I then said the adapter *itself*, used as a fixture loader, replaces all three.
Closer, and still short. `ArtifactStore` deliberately excludes the reader's own state — comments,
chat, searches, glossary lookups, shelf ([`src/store/artifacts.ts:62-65`](../../src/store/artifacts.ts))
— and `store-roundtrip` checks that `db:export` preserves all of it. Driving the adapter cannot
cover what the adapter is defined not to hold.

**What actually replaces them is three suites, not one:**

| suite | what it proves | how it gets an article into Postgres |
|---|---|---|
| **adapter parity** | `fsArtifacts` and the Postgres adapter store and return the same thing, kind by kind | writes fixtures through both |
| **reader contract** | `fsArticleReader` and `pgArticleReader` agree on the wire, including library order and optional artefacts | through each store's production coordinator/adapter, then publish |
| **export** | `db:export` still preserves reader state | production path in, live Postgres reader stores for the state, export, compare files |

Plus a fourth, standing alone, for the contract `chat-anchor` was really guarding — § The block
identity test.

The tempting shortcut — a stripped-down importer kept as a test fixture loader — stays rejected. It
would be a second implementation of files → Postgres, free to drift from the production write path,
and the drift would be invisible because tests would be the only thing exercising it. Reading a
fixture directory into `ArtifactParts` and calling the production `write` is a different thing: about
thirty lines with no Postgres knowledge in them at all.

**The sequencing rule: those suites land in C, and the importer is not deleted until they are
green.** No window of reduced coverage, which is the whole reason not to delete the importer first.

## The raw provenance has nowhere to go — and one column fixes most of it

Sol's critical, and it is right that the plan promised something the schema cannot hold.
`RawManifest` carries `origin`, `uploadId`, `filename`, the server's claimed content type, the
detected encoding and the network-byte hash. `article_revisions` gained only `raw_source_sha256` and
`raw_source_kind`; `raw_sources` holds shared object facts.

Taken field by field, the gap is smaller than three columns:

| field | where it goes |
|---|---|
| `origin` | **derivable, no column.** `requested_url` and `final_url` are both null exactly when the document was uploaded. A derived answer that cannot drift beats a column that can. |
| `uploadId` | already on `jobs.upload_id` ([`src/db/schema.ts:816`](../../src/db/schema.ts)) |
| `filename` | **genuinely homeless, and reader-facing** — it is the name an uploaded PDF should download as. One new column, `raw_filename`. |

**And the three old raw columns stay.** The first draft floated dropping `raw_content_type`,
`raw_encoding` and `raw_sha256` alongside `raw_bytes` because their names rhyme. They answer
different questions from anything in `raw_sources`: what the origin server *claimed*, what decoding
we *chose*, and what the network *sent*. Sol put it better than I would have:

> keeping two clearly typed hashes is not the trap. Using the wrong one as the object key is.

Only `raw_bytes` goes.

## The publication gate, as a truth table

The first draft reduced it to one condition — a done `fetch` and a null reference is a refusal — and
that is not a complete truth table. A revision whose fetch **failed** carries a perfectly good
inherited reference from `beginDraftIn` and passes.

The same hole was already **live** in the ToC guard — a real bug found in passing. It read the `toc`
step run, compared `input_hash`, and never looked at `status`, so a run that ended in error published
as long as the hash matched. It matched *especially* in that case: a step records its hash when it
starts.

**Fixed first and on its own, `e18ac5f`**, precisely so the source gate would not be written on top
of it. `tests/store-publish-guards.test.ts` was watched red, and checked again after the refactor by
disabling the branch — three red, four green with it back. The guards now live in
`reasonsNotToPublish`, which is where the source condition below goes.

| `fetch` run in the lineage | rule |
|---|---|
| none | no source requirement — a draft that only ever had `meta` is not refused *for this reason* (the existing no-blocks/no-tree checks still refuse it, and the test must assert that distinction rather than expect a successful publish) |
| `done` | a non-null `raw_source_sha256` is required |
| `running` or `error` | publication refused outright |

*Lineage*, not "this revision fetched", because `beginDraftIn` copies step rows and a later revision
legitimately inherits a `fetch` it did not perform — Sol's earlier round, and unchanged.

## The order

Unchanged from [transactional-stage-runner.md](transactional-stage-runner.md) except where marked.
**A is done. B piece 1 is done.**

### B2 — the raw product carries a reference, not bytes — **mostly already built**

The original piece 2 said *"a store-neutral raw product carries provenance **and** payload"*, because
`article_revisions.raw_bytes` needed bytes. It does not any more, and the consequence is bigger than
"the payload moves": **`RawManifest` is already the product.** It carries `kind`, `storedSha256`,
`contentType` and `bytes` ([`src/fetch.ts:93-149`](../../src/fetch.ts)), which is exactly the
reference, and `ArtifactMap["raw"]` is already declared as a `RawManifest`. The payload reaches the
bucket before the stage returns, because [`storeRawSource`](../../src/store/blobs.ts) is called
inside `writeRaw` rather than at its call sites. Both landed 2026-08-27, for other reasons.

What is left of piece 2 is one honest gap and one column. **`storedSha256` is optional**, and absent
means *this document is not in the bucket* — true of every manifest written before 2026-08-27. The
Postgres adapter cannot write a reference it does not have, so it must **refuse** such a manifest
rather than write a null reference beside a done `fetch`, which is exactly the state the gate exists
to catch. One refusal, at the adapter, watched red. The column is `raw_filename`, above.

This is also the runner plan's largest stated cost disappearing: *"every part is live in memory
together until the commit"* was written against a 32 MiB raw payload. Nothing 32 MiB wide now enters
the transaction.

### B3 — the checkpoint store — **a prerequisite, not an open note**

`labels-progress.json` and `pdf-chunks/` survive failed attempts on purpose, and D removes the `dir`
they live in. So D cannot start until this exists: an interface, a durable backing store, ownership
and cleanup rules, and a test that a retry on a **different store instance** does not buy a
checkpoint twice. A small Postgres table keyed by revision, step and key is the boring answer, and it
must stay **outside** the artefact/job transaction — preserving failed work is the entire point of
it.

#### B3's key is not the revision, and that would have made the table useless

The paragraph above says *"A small Postgres table keyed by revision, step and key is the boring
answer."* **The revision is the wrong key**, and it would have failed in the quiet way: the table
gets written on every run and read on none, and the only symptom is a larger bill.

A checkpoint exists so that a retry does not pay twice. **A retry is a new job**
([`src/jobs.ts:209`](../../src/jobs.ts)), and a new job begins a new draft revision. Key the
checkpoint on the revision and the retry looks under an id that did not exist when the work was done.
Every lookup misses, `usableCheckpoint` returns an empty map, and the run buys every batch again.

Both existing checkpoints already say what the key is, and neither is the revision:

| checkpoint | what gates reuse at all | what identifies one entry | what losing it costs |
|---|---|---|---|
| `labels-progress.json` — [`src/labels.ts:650`, `667-694`](../../src/labels.ts) | `version`, `generator`, `slug` and `sourceHash`, all four exact | a per-batch `fingerprint` — the prompt that asked the question | one paid labelling call per batch; the comment at [`src/toc.ts:717-722`](../../src/toc.ts) puts it as "a 429 eight batches into a book costs the one batch rather than the eight" |
| `pdf-chunks/<key>.json` — [`src/pdf-read.ts:753`, `774-787`](../../src/pdf-read.ts) | nothing outside the key | a sha256 over `rawSha256`, the chunk's pages, its context, the prompt fingerprint, the reader id and `maxTokens` | one paid page-reading call per chunk, and these are the expensive ones |

Both are addressed by **what the work was about**, never by which attempt happened to be running.
That is the property to keep. A content address means a checkpoint written by an attempt that died is
usable by any later attempt asking the identical question, and *unusable* the moment the question
changes — which is the same sentence, and the reason nothing has to invalidate anything. Keying on
the revision throws that away and keeps only the half that does not matter.

So the interface takes a namespace and an opaque content key, and the store never interprets either.
Ownership and cleanup follow from the same fact: an entry is dead when nothing will ever ask its
question again, which is a time-based sweep rather than a cascade from a revision.

Two more things the inventory turned up:

- **Size is not a problem.** The largest real one on disk is `data/ball-lightning/pdf-chunks` at
  100 KB over five files. A Postgres table is right; nothing here needs the bucket.
- **`tweets` decides it is done by reading its own output.** `isDone: (ctx) => threadIsCurrent(ctx.dir)`
  compares a `sourceHash` stored in `tweets.json` ([`src/pipeline.ts:1206`](../../src/pipeline.ts),
  [`src/tweets.ts:140`](../../src/tweets.ts)). That is not a checkpoint and does not belong in B3 —
  it is an `isDone` over a finished artefact, and the Postgres side already answers it from the step
  run's stamp. It needs porting in D, and it is listed here because a sweep for "reads a file it
  wrote last time" finds it and it is the wrong drawer.

### C — the Postgres artefact adapter, plus the three replacement suites

The `raw` kind writes a `raw_sources` row and the revision's reference columns rather than seven
columns including an 11 MiB `bytea`. The suites are part of this landing, not a follow-up: they are
what makes deleting the importer safe, so they cannot trail behind it.

**What the adapter must get right**, from a sweep of the existing write path, so none of it is
rediscovered the hard way. `import.ts` is the reference implementation for the *write* half and is
worth reading before starting, not after.

| trap | the rule |
|---|---|
| `revision_blocks.fts` is `generatedAlwaysAs` | never name it in an insert, and never bare-`select()` a row you intend to hash |
| two composite FKs need `article_id` | `revision_blocks` carries it for both `(article_id, revision_id)` and `(article_id, block_id)`, so every write resolves slug → article → draft |
| identities first, never deleted | upsert `block_identities`, then `delete` this revision's rows, then insert with `ordinal` from the array index. `revision_blocks_revision_ordinal` is unique, so delete-before-insert is required |
| carry-forward means present ≠ produced | `beginDraftIn` copies carried columns, block rows **and** step-run rows. So `has()` must consult `revision_step_runs` and compare the stamp — a non-null column reports a carried glossary as this step's output |
| `implementation_version = "imported"` is the importer's | it scopes the importer's own withdrawal `DELETE`. Nothing the adapter writes may use that string, or `db:import` deletes pipeline records |
| unstamped steps still need values | `input_hash` and `implementation_version` are NOT NULL and `fetch`/`extract`/`blocks` have no stamp. Use `NO_INPUT_HASH` and `PIPELINE_RUN`, never the draft's block hash — that claims a step ran against blocks it never saw |
| `labels` is not a step | the `revision_step_runs_step` CHECK rejects it; it is a `toc` output |
| `attempt_id` has no writer, and `recordStepRun` is the wrong primitive for one | ~~its upsert clobbers the column~~ — **wrong, and measured**: `set: values` omits `attempt_id`, so an update leaves it untouched. The real hazard is that a generic upsert keyed only on `(revision_id, step_name)` can overwrite a *newer* attempt once it is taught to write one. `beginStep`/`finishStep` want their own fenced statements |
| an empty blocks array | the importer silently keeps the old rows. The adapter must decide, out loud, whether empty means delete-all or no-op |
| null is a real value in a stamp | `StepStamp.profileHash` uses `null` to mean *written deliberately without a profile*, and `exactOptionalPropertyTypes` is on, so absent and null are different answers |

The transaction convention is already settled and should be copied rather than reinvented: a private
`…In(tx, opts)` with the public function opening the transaction around it, exactly as
`beginRevision`/`beginDraftIn` are split. Lock order is job row `for update` first, then article,
and must not be deviated from.

#### The adapter's shape, settled

[A second input round](artifacts-pg-shape-sol.md) put three questions to Sol — how the store is
addressed, how it joins the one transaction, and what `has` honestly means — and returned **NO-SHIP
on two of my three answers**. What it settled:

**It binds an already-resolved reference, not a resolver.** My proposal copied the *surface* of
`createFsArtifactStore(locate)` and missed that its resolver is pure and deterministic, while
`openOrBeginJobDraft` locks, may mint a revision, and fences a live job. That must run **once per
advance**, not lazily behind a store method. And `{ articleId, revisionId }` is too little: the
reference is

```ts
interface JobDraftRef { slug; articleId; revisionId; jobId; attemptId }
```

— `articleId` for the two composite block foreign keys, `jobId` and `attemptId` because
`revision_step_runs.attempt_id` *is* the job attempt token and `beginStep`, the final write and the
job transition all fence on it. `slug` stays in every method signature as a mandatory assertion
against the bound reference: construct a store for draft A, call any method with slug B, and it must
throw **before** reading or writing anything.

**Transaction membership is a construction-time capability, never an argument.** One implementation
bound to `ref` plus a `Db | Tx`, exposed as two capability views: a preflight one (reads,
`interrupted`, `beginStep`) and a transaction-bound one (reads, `write`, `finishStep`). Critically,
**the executor must not default to `getDb()`** — a default makes forgetting the caller's transaction
compile *and* succeed. An optional `tx` on `write` is rejected outright: it is the exact silent split
this landing exists to prevent. And the `…In(tx)` boundary belongs around the coordinator's *whole*
atomic operation, because an artefact-only transaction can still commit before the job fence.

My "two modes are read and write" framing was also wrong: the preflight side writes (`beginStep`) and
the transaction side reads (its own uncommitted work, for `assertProduced`).

**`has` answers presence and completion, never freshness.** The plan's earlier phrase — *"consult
`revision_step_runs` and compare the stamp"* — was too broad: `has` is handed no expected stamp, and
what counts as current is step-specific (`ideas` hashes blocks *and* tree). Teaching the adapter that
would put pipeline logic in storage. So `has` means: every requested value reconstructs and passes
the same shallow shape checks the filesystem decoder applies, **and** a matching `revision_step_runs`
row exists with `status = 'done'`. Freshness stays with `stampFor` + `sameStamp` in `stepIsDone`,
where it already lives. There is one documented primitive-level difference from the filesystem, and a
documented difference beats a false parity claim — this repo produced two of those yesterday.

**~~And `toc` gets a real stamp~~ — tried, and it cannot.** This round's recommendation was to give
`toc` an ordinary stamp so the adapter would not need a private freshness rule for it. That was
right about the adapter and wrong about what a stamp costs elsewhere: a `toc` that can report itself
stale re-runs, a re-run may move the tree's boundaries, and `arc` and `summary` are joined to it by
exact block-**range** pair and silently lose any entry matching no node. Built as `59e8e3a`,
withdrawn in `414f3f9`; § The build order for C has the whole reasoning.

So the third status-and-hash test the postmortem warns about **does** have to exist, in C4, and the
mitigation is that it is written down as a deliberate exception rather than discovered later:
for `toc`, `has` compares the stored run row's `input_hash` against the stored block rows. A
documented difference beats a false parity claim.

**Empty blocks means delete-all, authoritatively.** The importer's `if (blocks.length)` encloses both
the delete and the insert, so an empty array leaves inherited rows in place. For the adapter that is
a silent success of the worst kind: the stage returns `[]`, the old article survives, and the run
reports done. Identities upsert (zero is fine), then delete *always*, then insert only when non-empty.
Whether an article with no blocks may publish is a separate question that `reasonsNotToPublish`
already answers.

**`stampFor` must merge two sources.** `revision_step_runs` has no `profile_hash` column;
`ideas.profileHash` lives only in the JSON artefact, and `null` there is a real recorded value
meaning *written deliberately without a profile*. So the stamp is row fields plus artefact-embedded
fields, and `NO_INPUT_HASH` must never be handed back as though it were a real recorded hash.

#### The build order for C, commit by commit

Seven commits, each green on its own, ordered so that the thing most likely to be wrong is proved
earliest and nothing depends on an unproven piece.

**C1. `toc` gets a real stamp — built, then withdrawn.** `59e8e3a` added it; the review of the built
code took it out again, and the reason is the most useful thing this landing produced.

The stamp worked. What it exposed is that **`toc` re-running silently drops artefacts that are still
marked current.** `arc` and `summary` are joined to the tree by exact block-**range** pair
(`buildArcColumn` and the summary column in [`src/web/tree.ts`](../../src/web/tree.ts)), and an entry
matching no node is dropped from the reading view without a word. A rebuilt tree may legitimately
choose different boundaries. So `arc`, which has no stamp at all, stays "done" and loses entries; and
`summary`, which hashes only the blocks, does the same wherever the blocks did not change.

**I got this wrong twice and the second time is the instructive one.** Sol's third round said C1
would orphan consumers; I checked, found that consumers key on block ranges rather than tree node
ids, and narrowed the finding to "arc has no stamp". That was half the check. Keying by range
prevents an entry attaching to the *wrong* node; it does nothing about the entry matching *no* node.
`src/web/tree.ts` has said so in a comment all along — *"ids are positional and a re-run of `npm run
toc` renumbers them"* — and I read that comment while confirming the half I got right.

A stamp here needs consumer invalidation first, and there is none: `cascadeForce` is computed once
from explicit force flags when the job is created, and cannot hear a step deciding at run time that
it is stale. That is a change to `src/jobs.ts` and belongs with D.

*What survives:* a long comment on `STEPS.toc` saying why there is no stamp and what has to land
first, so the next person to notice the gap finds the reasoning instead of repeating it. And a
consequence for C4: with no stamp to compare, the adapter's `has` cannot answer "is the toc current"
the way it does for other steps, and must carry an **explicit, documented** `toc` case rather than
pretending to parity.

**C2. `beginStepRun` and `finishStepRun` as fenced statements — done, `4da9bcf` + `414f3f9`.** Two
functions in `src/store/pg-revisions.ts` beside `recordStepRun` rather than inside it —
`recordStepRun` stays for the importer and for CLI runs, which have no attempt and never will. They
are the first writer and first reader `revision_step_runs.attempt_id` has ever had.

**Four guards, not the two the plan named.** The two extra came from the review of the built code:

| guard | refuses |
|---|---|
| `attempt_id = $token` on the row | somebody else's claim — and a null token too, which falls out of SQL rather than being special-cased |
| `status = 'running'` on the row | a step that has already ended; finishing twice would overwrite the first ending's stamp |
| `requireLiveJobOwnsDraft` | a claimant whose **job** has been swept. The row conditions cannot see this: `failExpired` clears the job's token without touching its step runs, so the row still looks perfectly held |
| `setWhere` on the begin upsert | the same token reopening a run it has already ended. A *different* attempt reopening is legitimate — that is what a re-run is |

*Red first, and the obvious version of this test does not work.* Sol caught it in the plan: a
step-run *that has ended* already fails the `status = 'running'` half, so deleting the `attempt_id`
condition changes nothing and the test stays green. That is lesson 1 catching this document's own
mutation habit. All four guards were watched red **individually**: removing the attempt condition
fails exactly two tests, the status condition one, the job fence two, the reopen guard one, and no
removal touches another's.

*Two other things that landed with it.* `NO_INPUT_HASH`/`PIPELINE_RUN` moved from `revisions.ts` to
`artifacts.ts` — importing them the other way made a cycle the linter refused, and `artifacts.ts` is
a leaf that already defines what a step stamp is. And the job cases run inside transactions that roll
back: `jobs_only_one_running` is global, so every suite wanting a running job is mutually exclusive
with every other, and `store-job-draft` and `store-jobs-parity` already fail against each other under
parallel vitest. This suite waits its turn and leaves nothing behind rather than becoming a third
contender.

**C3. The kind ↔ storage map, and the read half — done, `f40461c`.**
[`src/store/artifacts-pg.ts`](../../src/store/artifacts-pg.ts): `STORAGE` (the exact counterpart of
`PATHS`), `readArtefact`, `stampForStep`. It binds a resolved `JobDraftRef`, and its executor is
`Db | Tx` with **no default**.

**Its oracle is explicit mapping fixtures, not importer-written rows** — the first draft had that
wrong. Agreeing with the importer would prove importer-plus-adapter behaviour, and the importer is
known to store `extractedHtml: null`, to stamp every inferred step with the same fingerprint where
`ideas` uses blocks-plus-tree, and to hold no source reference. There is one parity oracle that is
neither: the two storage maps must cover the same `(step, kind)` pairs, and a test compares them.

*Three things moved into `artifacts.ts` so both adapters share one copy* — the shape checks
(`whyUnusable`), `STAMP_SOURCE` and `stampOf`, and later `assertStampAgrees`. Two lists that agree on
the day they are written are not a parity claim.

*Two of my own checks were watched passing against the bug they name.* The fixture's block ids sorted
the same way as the ordinals, so `order by block_id` left the ordering test green; and with three
rows Postgres answers from the `(revision_id, ordinal)` index, so deleting the `ORDER BY` altogether
was green too. The fixture ids now sort backwards, and there is a second case that runs with index
scans off. A third passed alone and failed in the suite, because `onConflictDoUpdate`'s `set` writes
only the keys it is given and the previous case's `prompt_version` was still sitting there.

**C4. `has` and `interrupted` — done, `cca945b`. There is no `toc` case.** `has` means: every
requested kind reads back and passes the shared shape check, **and** `revision_step_runs` holds a row
with `status = 'done'`. No comparison against an expected stamp, for any step. The `toc` case this
heading used to promise is deleted — lesson 7, and § What the third review changed.

The run row is the half the filesystem cannot ask, and it is what `beginDraftIn` makes necessary: a
carried column is present without this step having produced it. `interrupted` is the same row,
`status = 'running'` — a row that ended in `error` is not interrupted, it finished badly, and
`stepIsDone` treats those differently.

*Red first:* the run-row requirement was watched red over a revision whose columns are all present
and whose run was never recorded — which is exactly the shape carry-forward produces. The
`status = 'done'` half was isolated separately, over a run that errored beside every artefact it
declares.

**C5. `write` — done, `cca945b`.** Takes a `Tx`, and there is **no overload taking a `Db`**: a write
that could commit on its own would commit before the job fence and the step transition it belongs
with, which is the whole reason this landing exists, and the typechecker is where that is said.

Four things in order: the job fence (`requireLiveJobOwnsDraft`, taken here as well as in the
`finishStepRun` that follows, because *"the write is safe because the call after it checks"* holds
until somebody calls the write alone); the stamp checked against **all** the artefacts before any of
them is written; the artefacts, one `UPDATE` for every column-shaped part; and then the stamp onto
the running row.

**Empty blocks means delete-all**, and it is the one importer behaviour deliberately not copied:
`src/store/import.ts` puts its delete *inside* `if (blocks.length)`, so an empty write leaves the
inherited rows in place, the old article survives, and the run reports done.

*What the tests taught.* The stamp fence could not be one statement with the update: three steps
declare no stamp at all and an `UPDATE` with nothing to set is an error, so folding the fence in
would have made the fence **conditional on the step having a stamp** — backwards, since those are the
steps whose completion nothing else can check. It locks the row `for update`, then writes if there is
anything to write. And one test passed for the wrong reason: a bare `rejects.toThrow()` was green
with the job fence deleted, because the stamp update refuses an unrecognised token anyway.

*Also in this commit:* the two views. `readOnlyPgArtifacts(ref, Db | Tx)` for the four questions
`stepIsDone` asks, and `pgArtifactsIn(ref, tx)` for the whole `ArtifactStore`. `beginStep` returns
`ref.attemptId` rather than minting a token — `revision_step_runs.attempt_id` **is** `jobs.attempt_id`,
which the interface predicted would "end up being literally the same value". `finishStep` is stricter
than the interface allows for, and says why: the filesystem tolerates finishing a step it never saw
start because every CLI run is in that state, and nothing on this path can be.

**C6. `raw` — built, and its migration cannot be committed yet.** All five parts are done in the
working tree and the columns exist in the local database.

1. ✅ **`RawManifest` gains `storedBytes`** — `82aba18`. `bytes` is the length of what the
   network sent; `raw_sources.bytes` describes the object at the *stored* hash, and for any non-UTF-8
   page those differ for exactly the reason the two hashes do. `writeRaw` already computed the number
   and recorded only its hash.
2. ✅ **`raw_byte_count`, for the network byte count.** Sol's NO-SHIP on this section: `RawManifest.bytes` is
   required, its only home today is `length(raw_bytes)`, and `raw_bytes` is dropped at the demolition.
   `storedBytes` does not preserve it — it answers the other question.
3. ✅ **`raw_filename` on `article_revisions`**, classified `carry`. It is the **reader's own name** for
   an uploaded file, not `RawManifest.file`, which is derived from the kind. Both new columns must be
   classified or `REVISION_CARRY_POLICY`'s exhaustive check throws at module load, which is the
   schema forcing the decision.
4. ✅ **The `raw_sources` row and the reference pair**, written for the first time by anything.
   `verified_at` is refreshed on conflict, and the row's `bytes` and `content_type` are deliberately
   **not** overwritten — the row is shared with every other revision pointing at that object.
5. ✅ **Two refusals, not one.** A manifest with no `storedSha256` names no object. A manifest with a
   stored hash and no `storedBytes` would put the *network* count on a shared row, and those are two
   different numbers for any page that was not already UTF-8.

**And one thing the ownership question forced, which the plan had not seen.** `meta.json` and
`raw.json` both carry `url`, `fetchedAt` and `rawSha256`, so `write` had two claimants for three
columns. They belong to `fetch`: `src/extract.ts` sets `meta.fetchedAt` to **its own `new Date()`**,
and the shelf sorts on that column, so letting `extract` write it would send every re-extracted
article to the top of the library. `META_COLUMNS` is therefore shorter than `meta.json`, `readMeta`
reports the three it does not write, and a test watches `extract` fail to overwrite them.

**The migration is generated, applied locally, and cannot be committed.** `drizzle-kit generate`
produced exactly two nullable `ADD COLUMN`s and nothing else — checked by running it into a scratch
copy of `drizzle/` first, which is also how I established that the other sessions' schema work was
already fully migrated and would *not* be swept in.

What blocks the commit is the **ledger**, not the schema. `drizzle/meta/_journal.json` now holds
`0020_comment_body` and `0021_ai_calls_ledger` from two other sessions, both untracked, and mine is
`0022`. Migrations are strictly ordered, so committing `0022` means committing theirs. And committing
`src/db/schema.ts` would make `HEAD` stop building, because the ai-spend consumers that match its new
`ai_calls` shape are uncommitted too.

**The tree is already incoherent this way**, which is worth recording rather than fixing quietly:
`_journal.json` at `HEAD` names `0020_comment_body`, whose `.sql` file is untracked — so a fresh
clone cannot run `db:migrate` today. This needs one person to land the three sets together.

**And the refusal has a scheduling consequence.** All seven checked-in manifests predate
`storedSha256`, so turning it on breaks every fixture that has not been re-fetched. The re-ingest
therefore happens **before C7**, not at the demolition.


**C7. The three replacement suites**, and they need more than a swapped call. `copyArtefacts` moves
what the *artefact store* owns, which is deliberately less than the importer moved. Each suite has to
be given the rest explicitly:

| what the copy does not carry | how C7 supplies it |
|---|---|
| reader state — comments, chat, searches, lookups, shelf | written through the live Postgres reader stores, which is how production gets it too |
| the raw payload bytes, which `store-roundtrip` compares by name and length | the blob store, once C6 writes the reference |
| a historical `createdAt` — library parity leans on the blocks file's mtime where `fetchedAt` is absent, and a draft minted today is not that | set explicitly in the fixture, and say so, rather than letting "today" pass for history |
| an honest `extractedHtml` — stage 3 overwrote stage 2's file, so copying it puts post-stage-3 HTML in the stage-2 column, where the importer records the loss | record the loss the same way, or the round trip asserts a value neither store really has |

`chat-anchor` gets the standalone block-identity test in § The block identity test. Green here is the
gate on deleting the importer, and nothing before this commit removes anything.

#### What the loader found, before a single suite was rewritten

`tests/helpers/load-article.ts` is the replacement: a running `jobs` row → `openOrBeginJobDraft` →
`copyArtefacts` → `publishRevision` → the job released. It is the real write path with a fixture on
the front of it, and pointing it at all seven `data/` articles surfaced three things this document
had not predicted. None of them is a bug in the adapter.

**`constitution` cannot be published, and the refusal is correct.** `STAMP_SOURCE.toc` is `labels`,
so `toc`'s `input_hash` is `labels.json`'s `sourceHash` — and that file predates the field:

```
constitution   sourceHash= None  keys= ['batches','generator','labels','slug','version']
every other    sourceHash= <hex> keys= [...,'sourceHash','structureHash']
```

So the copy leaves `NO_INPUT_HASH` on the row and `reasonsNotToPublish` says *"the tree was built from
different blocks (toc ran against unstamped …)"*. `importArticle` never met this because it wrote
`hashBlocks(blocks)` for every step whether or not the artefact could support the claim — the exact
dishonesty § What the decision deletes is about. Worth being clear that **only legacy filesystem data
can reach this state**: stage 4 has written `sourceHash` for a long time, and after the demolition
there is no path that produces a labels file without one.

**`meta.fetchedAt` genuinely differs between the two stores, and always will.**

```
fowler-phrenology   meta.json 17:26:00.108Z   raw.json 17:17:48.176Z
source              meta.json 22:04:06.043Z   raw.json 22:03:20.693Z
writes              meta.json 11:09:34.025Z   raw.json 11:09:34.025Z   (one pipeline run)
```

[`src/extract.ts`](../../src/extract.ts) sets `meta.fetchedAt` to **its own `new Date()`**, so the
filesystem's number is when *extraction* last ran. That is why `META_COLUMNS` excludes it — and the
consequence, which the ownership note stopped one step short of, is that the parity suite cannot
assert equality on that field for any article extracted in a later run than it was fetched. It has to
be exempted and the exemption paid for: Postgres's value equals `raw.json`'s, the filesystem's equals
`meta.json`'s, both asserted.

**And the evidence for the whole exercise was contaminated, which is the most useful of the three.**
The first sweep reported `noema-mythology-of-conscious-ai` — an article with **no `raw.json` at all**,
whose `fetch` step is therefore skipped entirely — as byte-identical across the two stores. It cannot
be: nothing writes `final_url` or `fetched_at` for it. The database still held what an earlier
`importArticle` run had published, and `beginDraftIn` **carries those columns forward into the new
draft**, so a column the artefact path never touches read back perfectly.

Proved by cloning the fixture to a slug the database had never seen (`data/test-c7-clean`) rather than
by deleting anything, which is also the cheaper experiment:

```
copied: extract, blocks, toc, arc, tweets, glossary, summary, ideas   published: true
DIFF meta:
  fs: {…, "fetchedAt":"2026-08-26T12:16:43.473Z", …, "url":"https://www.noemamag.com/…"}
  pg: {…                                          }        ← no url, no fetchedAt
```

This is the third face of [lesson 1](#what-this-has-taught-us-so-far), and the sharpest: **carry-forward
makes a fixture load look like a successful write.** Any parity or round-trip claim made against a
database that has ever been imported into is measuring the importer as much as the adapter. Every
suite in C7 therefore has to run against an article the database has not seen before, or prove it
another way.

#### What the review of the loader changed — [c7-fixture-loader-sol.md](c7-fixture-loader-sol.md)

**PROCEED-WITH-CHANGES**, with ten findings against a helper I had already watched work end to end.
Four of them would have produced a *green* suite proving nothing, which is the whole reason a test
helper got a review of its own — and then a suite of its own, `tests/helpers-load-article.test.ts`,
with each fix watched to fail before it was made.

| what was wrong | why it would not have shown up |
|---|---|
| **It stored no bytes.** `copyArtefacts` moves `raw.json`, which is a *reference*; the adapter writes the reference without checking the object exists | the corpus had been backfilled, so every fixture's object was already in the bucket. A fixture whose bytes were new would have produced a revision pointing at nothing, and every read still succeeded. `storeRawSource` now runs first, the way stage 1 runs it |
| **`createdAt` set the wrong table.** The library sorts on `coalesce(article_revisions.fetched_at, articles.created_at)`, and the option wrote `article_revisions.created_at` | nothing reads the column it was setting, so the option silently did nothing. Proved by mutating it back: the assertion reads today's date where 2019 was asked for |
| **A copy that moved zero steps still published** | carry-forward means the draft already holds the published revision's blocks and tree, so publishing republishes the old article and reports success. A misspelled slug was indistinguishable from a load that worked |
| **`publish: "try"` caught every error** | a lost fence or a dropped connection read as "the gate said no". Only `PublishRefused` is caught now |
| **`ownerId` did not control ownership.** `beginDraftIn` stamps `articles.owner_id` from `currentOwnerId()` | a caller naming an owner got a *job* belonging to one person and an *article* belonging to another. The whole load runs inside `runAsOwner` now |
| **The job was marked `done` in a `finally`** | it claimed success for a body that threw, could overwrite a job something else had already failed, and left synthetic ingest history. It is deleted instead — a row this function created never existed |
| **`cause.constraint` read one level deep** | Drizzle wraps, so a contended running-slot could rethrow as a bug. `violatesConstraint` walks the chain |

Two findings are recorded rather than fixed, and saying which is which matters:

- **`extractedHtml` still gets stage 3's HTML.** The filesystem store maps both `extractedHtml` and
  `stampedHtml` to `output/<slug>.html`, because stage 3 overwrites stage 2's file in place. Nothing
  reads that column — `Article` does not expose it and `db:export` writes `stamped_html` — so a
  loader that nulled it would be inventing a policy the pipeline does not have. On the real path the
  column is honest, because `extract` writes it before `blocks` overwrites the file.
- **The single transaction around the whole copy is not production's boundary**, which is one step
  per transaction so each invocation commits its own work. Every *statement* is the production
  statement; the transaction around them is the fixture's, and the claim in the file now says so.

And one about the gate itself, which is D's rather than C's: `reasonsNotToPublish` implements the
core and `toc` rows of the truth table but **not the fetch-lineage rows** — a revision whose `fetch`
run is `running` or `error`, or which is `done` with no source reference, publishes today.

#### `db:export` reads the bucket now, and refuses twice

`writeRawDocument` read `article_revisions.raw_bytes` and returned `[]` when it was null. After C6
that column is null for everything the pipeline writes, so export was about to stop producing source
documents with no signal at all — in the one tool whose whole job is "you can always get your data
back out". It resolves `raw_source_sha256` + `raw_source_kind` through the blob store, re-hashes what
comes back, and throws `MissingRawObject` or `CorruptRawObject` rather than falling through to the
legacy column. The kind now comes from the column rather than from sniffing the body, which is what
`rawFileName`'s comment asked for when it said *"there is no `raw_kind` column"*.

The manifest gains `storedSha256`, `storedBytes` and `filename`, and takes `bytes` from
`raw_byte_count`. Without the first two an exported directory is one **the adapter refuses to load**
(`NoStoredDocument`) — a round trip that looks complete and is not. `tests/store-export-raw.test.ts`
is built on the real loader for that reason: a hand-built row would prove the export reads two
columns, not that what the adapter writes and what the export reads are the same thing. Both refusals
were watched to fire by deleting each guard in turn.

#### C7 — the three suites, on the real write path

The swap was one line; everything else the suite needed was the four things `copyArtefacts`
deliberately does not carry. What it took, and what it found:

**The rows have to be forgotten first, and it is the whole claim rather than hygiene.** `basedOn` is
`articles.current_revision_id`, so the suite nulls the pointer and deletes every revision behind it
before each load, then asserts `basedOn === null` for all six articles. Without that the comparison
is measuring whatever put the last revision there. Watched to fail: with the wipe removed, *"built
every article from nothing, rather than carrying one forward"* goes red on the first run and nothing
else does.

**Revisions and not the article**, which is a change from the first version. Deleting the article row
cascades through comments, chat, searches and block identities — and vitest runs test files
concurrently, so an article that vanishes for two seconds fails whoever else was reading it for a
reason that has nothing to do with them. (I proved that on myself: two of these mutation runs
overlapped a foreground run of the same file and produced fourteen failures that meant nothing.)

**Reader state is seeded, by something that says it is a seeder.**
[`tests/helpers/seed-reader-state.ts`](../../tests/helpers/seed-reader-state.ts) writes the shelf
columns and the comments rows straight from the files. Through the live stores is not achievable and
pretending otherwise would seed *different* state: `pgShelfStore.patch` cannot set `opens` to 874 or
archive with last week's date, and `pgCommentStore.create` makes a current unanswered comment when
half the corpus's are answered. `loadArticleIntoPg` must never call it — Sol's ruling, and the reason
is that a loader which can also restore reader state is the importer growing back one field at a
time. Watched to fail: with both seeders removed, seven tests go red — every archived article is back
on the Postgres shelf and every comment count is zero.

**The exemptions, and what each one is paid for with.** Three differences survive a clean load. Each
is asserted positively in both directions rather than normalised away:

| what differs | Postgres | the filesystem |
|---|---|---|
| `meta.fetchedAt`, and `addedAt` on the card | `raw.json`'s `fetchedAt` — when the document was fetched | `meta.json`'s, which `src/extract.ts` stamps with **its own clock** on every run |
| `meta.url` on an article with no `raw.json` | absent: stage 1's fact, and there was no stage 1 | present, because stage 2 copies what it was handed |
| one comment on `writes` anchored to `zzzz00` | impossible — `comments_identity_fk` | counted |

Measured, not assumed: four of the six articles have fetch and extract times minutes apart, and
`writes` has them identical to the millisecond. That last one is why the suite also asserts *at least
one* fixture genuinely differs — an exemption every fixture happens to satisfy trivially is dead
normalisation, and Sol asked for the guard by name.

**Postgres is the one that is right here.** The filesystem's "fetched at" is really "extracted at",
so re-extracting an article silently moves it to the top of the library. `META_COLUMNS` already
refuses to let `extract` write that column; the importer papered over the difference by writing
`meta.fetchedAt` into `article_revisions.fetched_at`, which is how a permanent divergence stayed
invisible for the whole migration.

**And `constitution` moved out of the corpus into a test of its own**, per Sol's decision 1: assert
its `labels.json` has no `sourceHash`, that the copy really moved `toc`, that publication is refused,
and that the refusal names the unstamped ToC. If somebody regenerates the fixture it goes red, and
the fix is to retire the case rather than restore the stale file.

One bug in the rewrite, found by the suite itself: the first version subtracted the unanchored comment
from **both** sides of the library comparison, which cancels out and asserts nothing. The red said
`9` where it should have said `10`.

#### The other two suites, and what the swap cost

`store-roundtrip` and `chat-anchor` came off `importArticle` in the same commit, and they had to:
`importArticle` derives its article id from the slug, while `beginDraftIn` mints a random one — so the
moment parity's articles existed with minted ids, every `importArticle` call for the same slug hit
`articles_slug_unique`. There is no half-migrated state to stop in.

**`store-roundtrip`** is Sol's split in practice: the artefact half goes through `loadArticleIntoPg`,
and the reader's own state — chat, comments, searches, lookups, the shelf — is seeded beside it by
something that says it is a seeder. It found the same two-clock divergence in a sharper place: **a
round trip through Postgres rewrites `meta.fetchedAt`** from the extraction time to the fetch time.
That is `db:export` telling the truth, but it is a rollback tool, so it is worth knowing that a
restored directory is not byte-identical to the one you started with.

It also found a real loss, and this one the migration is making rather than finding:

> **An article with a raw document but no `raw.json` beside it does not survive the round trip.**

The `raw` step's artefact *is* the manifest — it names the object in the bucket by `storedSha256`,
and that reference is what the revision stores. `noema-mythology-of-conscious-ai` has a bare
`raw.html` and no manifest, so no `fetch` step is copied and the export has nothing to write.
`db:import` read the bare file into `article_revisions.raw_bytes`, and C6 dropped that column.
Confined to legacy filesystem data — both acquisition paths in `src/pipeline.ts` call
`storeRawSource` before writing a manifest — and now asserted rather than skipped, so the day
something starts exporting it, somebody has to decide what happened.

And it stopped naming `constitution`: the scan excludes any article whose `labels.json` has no
`sourceHash`, and a test asserts each exclusion really has that defect. A regenerated fixture rejoins
the corpus on its own.

**`chat-anchor`** clones the smallest article in `data/` into a scratch slug, and the clone was
incomplete in a way `db:import` tolerated and `copyArtefacts` does not. Three fixes, each of which is
the same fix:

- `output/<slug>.html` and `output/<slug>.blocks.json` have to be copied too. They are the second
  product of `extract` and the only product of `blocks`, and a step is copied whole or refused.
- The `slug` field inside every copied JSON has to be rewritten, or the filesystem store decodes the
  clone as an article that is not there.
- The source article has to be one that can actually publish, which `constitution` — the smallest —
  cannot.

Its `if (!source) return` became a throw at the same time. The selector now asks for four things
rather than two, so "nothing qualifies" became much more likely at exactly the moment it became much
less obvious, and a `return` reads as a pass. The mutation its own header documents still produces
the same red, now against the seeder rather than against the importer.

**One suite at a time may load the corpus.** Both suites wipe and reload the same articles, vitest
runs files concurrently, and two processes can run them at once. Parity wipes, roundtrip publishes,
parity loads and finds `basedOn` pointing at roundtrip's revision — the carry-forward assertion
fires, correctly, and says nothing useful.
[`tests/helpers/corpus-lock.ts`](../../tests/helpers/corpus-lock.ts) is a Postgres advisory lock on a
connection of its own; `jobs_only_one_running` already stops two *loads* overlapping, but the window
that matters is between one suite's wipe and its assertions. Proved by holding the lock in a separate
process for thirty seconds and watching the suite wait rather than fail.

#### What the review of the three suites changed — [c7-suites-sol.md](c7-suites-sol.md)

**STOP**, with six findings, and three of them were things a green suite was hiding. That is the
second review in a row where the *helper* was the thing worth attacking.

| finding | what was wrong | why nothing caught it |
|---|---|---|
| **the comments seeder minted no identities** | `comments_identity_fk` points at `block_identities`, and a comment may name a block this revision no longer has — the whole point of ids. Writing the blocks mints identities for the blocks that are *in* the revision, which is a different set. The insert would fail on the FK **after** the delete, leaving the article with no comments at all | every `comments.json` in `data/` anchors to blocks that are still there — *and* identities are never deleted, so every fixture's anchors already had one from an earlier `db:import`. The same carry-forward, for the third time |
| **`store-roundtrip` never loaded from nothing** | it loaded over the current revision, so a previous importer revision could carry artefacts and fetch columns into the export. The corpus lock stops two suites overlapping and does nothing about contamination | the export looked complete because it was completed by whatever ran last |
| **the `addedAt` exemption was under-asserted** | for an article with no manifest it asserted only "older than a minute ago", which any stale `articles.created_at` passes. The test's name claimed more than the code | it is the half of an exemption that is supposed to pay for the other half |
| **`noema`'s raw document really is lost** | see the ⚠ above — the plan said "nothing to lose" about an article with a real 176,736-byte `raw.html` | nobody had looked at the directory, only at whether it had a `raw.json` |
| **the library-order test asserted a non-invariant** | it required the two orders to be equal while its own comment explained they are computed from different clocks and may legitimately differ | it happens to hold over this corpus |
| **a missing `labels.json` read as a legacy one** | an accidentally deleted file was reported as "predates sourceHash" and quietly dropped from the corpus | there is no article with a deleted labels file |

Everything except the raw-document loss is fixed. The identity gap got a suite of its own —
[`tests/helpers-seed-reader-state.test.ts`](../../tests/helpers-seed-reader-state.test.ts), with a
fixture built to carry the awkward comment, on a slug the database has never seen — and both of its
tests go red with the minting removed. The `store-roundtrip` wipe throws out of `beforeAll` naming
the revision it was loaded on top of, watched by deleting the wipe.

`forgetRevisions` is now shared rather than copied, and the order test asserts what is actually true
of both stores: the same articles, each list newest first by its own `addedAt`, ties compared as ties.

#### And one bug found by doing the review's homework

Sol's sixth question was *"does the seeder write the same rows `db:import` did?"*. Checking that field
by field found the answer was **yes except for one, and the exception is a bug in the exporter**:
`db:export` never wrote `shelf.purpose` — the reader's own *"why you're reading this one"* — and
decided whether to write `shelf.json` **at all** from a hand-written copy of the object's other four
keys. So an article whose only shelf state was a purpose exported no shelf file.

This is the rollback tool, so the loss was permanent, and no test could see it: every assertion in
`store-roundtrip` compares against `data/`, and no `shelf.json` in `data/` has a purpose.
[The postmortem](../postmortems/export-never-wrote-the-readers-purpose.md) has the root cause — a
condition written as a second list beside the data it describes — and what would have caught the
class.

**What is deliberately *not* in C:** the coordinator that opens the transaction and calls
`write` + `finishStep` + the job transition together. That is D's, and putting it here would mean
building the atomic boundary before there is a stage returning products to put inside it.

### The metadata page — **not the blocker I said it was**

The first draft called `src/api.ts` a blocker before D and proposed a new `ArtifactStore` method to
answer per-step byte weights. **Both were wrong, and the second was about to rebuild something that
exists.** `articleMetadata` is already store-specific on the `ArticleReader` contract, and the
Postgres implementation is already written ([`src/store/pg.ts:592-701`](../../src/store/pg.ts)): it
derives `done` from the step run, takes `ranAt` from `revision_step_runs.finished_at`, and returns
`bytes: null` — a loss already accepted on that side. `src/api.ts` is the *filesystem*
implementation, and it stops typechecking only when `outputs`/`dir`/`htmlFile` leave the filesystem
path.

So the answer is: logical names from `produces`, presence from the adapter, byte size and mtime kept
as a filesystem-specific inspection result. One thing does need fixing —
`STEP_STORAGE.fetch = ["article_revisions.raw_bytes"]` ([`src/store/pg.ts:336`](../../src/store/pg.ts))
would otherwise have the page advertising a dropped column.

### Three stages carry identity in a file — **and D takes the file away**

Not in any earlier draft. I found one of these; [the review](blocks-carry-forward-sol.md) found the
other two and narrowed my claim about the first, which was too broad.

[block-ids.md](../project/block-ids.md) is the one contract everything else depends on. Ids survive
re-extraction because a stage matches this run's output against the previous run's — and **three
stages get the previous run by reading a file on disk**, which is the thing D removes.

| stage | what it reads | what it is for | what breaks without it |
|---|---|---|---|
| **blocks** | `output/<slug>.blocks.json` — [`src/blocks.ts:911-918`](../../src/blocks.ts) | carrying a paragraph's id across a re-extraction | every anchor: comments, saved searches, the ToC, scroll position |
| **glossary** | `glossary.json` — [`src/glossary.ts:1078`](../../src/glossary.ts) | *both* appending to the existing list and inheriting its ids | "find more terms" silently becomes "replace the glossary", history resets, every `?term=` link dies |
| **ideas** | `ideas.json` — [`src/ideas.ts:764`](../../src/ideas.ts) | inheriting ids, and only when `sourceHash` matches | every surviving `?idea=` link |

The glossary one is worth reading, because **the file already carries the postmortem for the bug D
would reintroduce**: *"without it, `taken` is empty, every id is re-minted, every `?term=` link"* —
somebody fixed exactly this, wrote down why, and D undoes it from the other end.

`tweets` and `summary` also read their own output, but only to ask whether it is stale
(`threadIsCurrent`), and D replaces that with the step run's stamp. The ToC's `labels-progress.json`
and the PDF chunk cache are checkpoints, and they are B3's. So the sweep finds five self-reads and
they fall into three different drawers; only the three above are identity.

#### What the blocks failure actually is — narrower than I first wrote

I claimed every id re-mints on every run. That is wrong, and the correction matters because it names
the thing D has to decide. Ids **already present in the HTML are reused directly**
([`src/blocks.ts:750-757`](../../src/blocks.ts)), with no previous blocks needed. So:

> After D, a stage-3 run whose input is **stage 2's HTML** re-mints every id unless previous blocks
> come from the store. A run over **already-stamped HTML** keeps them from the document itself.

Which means D must say **which HTML stage 3 consumes**, and Postgres deliberately holds both:
`extractedHtml` is stage 2's, with no ids in it at all, and `stampedHtml` is stage 3's own previous
output. Reading the wrong one turns identity loss on and off invisibly. "Read the HTML from the
store" is not a specification.

**Nothing is deleted; everything comes loose.** Re-ingesting a slug reuses the article row —
`beginDraftIn` inserts `onConflictDoNothing` on `articles.slug` and re-reads
([`src/store/pg-revisions.ts:490-500`](../../src/store/pg-revisions.ts)) — so comments, chat threads,
saved searches and the shelf keep their `article_id` and stay in the database. It is their **block**
ids that stop naming anything in the current revision. The reader does not lose their notes. They
lose the passages the notes were attached to, all at once, and what is left cannot say which
paragraph it meant.

Counted from `data/` rather than from the local database, whose numbers moved twice in an hour under
six sessions: **43 comment anchors, 91 saved search hits and 1,912 ToC entries**, over fifteen
article directories.

#### The fix, and the three things the review changed about it

Stage 3 takes its previous blocks from the store instead of from a path. It is a parameter and a
store read — no schema change, no new artefact — and it is a **prerequisite for D rather than an
addition to it**.

**Read the draft's own carried rows, before writing them.** `beginDraftIn` copies the published
revision's block rows into the new draft before any stage runs
([`src/store/pg-revisions.ts:525`](../../src/store/pg-revisions.ts)), so by the time stage 3 runs the
baseline is already sitting there. That is not matching against itself: before the first write those
rows *are* the previous published blocks, a failed computation has not replaced them, and a
deliberate second stage-3 run matching the immediately preceding result is correct idempotence. Use
`store.read` and not `has` — carried completion rows make `has` answer a different question, which is
the distinction C4 exists for.

**`revision_blocks` is sufficient, and the review corrected what "sufficient" means.** I worried that
`html` would have to be byte-identical. It does not: for a block with text `exactKey` uses only the
tag and the whitespace-collapsed text, and the folded pass uses only the tag and the normalised words
([`src/blocks.ts:328-351`](../../src/blocks.ts)). `html` is read for **textless** blocks only, to
recover the `src` of an image or a rule. So serialisation differences cannot break ordinary paragraph
matching, and the table below is complete rather than fragile.

| what the matcher reads | `revision_blocks` |
|---|---|
| `id` | `block_id` |
| `tag` | `tag` |
| `text` | `text` |
| `html` — textless blocks only, for `src` | `html` |
| the previous document's order | `ordinal` |

**Three cases, not two, and the third one fails.** My first version said only that "no previous
revision" and "I could not read it" must not share a branch. The review's cut is better and it is the
one to build:

| | what it means | what to do |
|---|---|---|
| no `basedOn` | a genuine first ingest | mint, quietly |
| `basedOn` exists, its copied baseline is missing or unusable | the carry-forward did not happen | **fail the stage** |
| the store read throws | an infrastructure fault | **propagate, fail the stage** |

Never warn and mint. That converts a database hiccup into permanent identity loss, and the reader
finds out by scrolling. The missing piece to build is carrying `basedOn` — or an equivalent
baseline-state signal — into D, because today the stage cannot tell case 1 from case 2.

#### The guard, and why my first answer was not one

The existing warning is unreachable after D. `previousBlockCount` counts blocks in **two files on
disk** ([`src/pipeline.ts:453-457`](../../src/pipeline.ts)), so it returns `0`, and the clause that
keeps a first ingest quiet —

```ts
if (previousBlocks > 0 && kept === 0 && minted > 0) {
  … `blocks ${ctx.slug}: all ${minted} ids re-minted — ${previousBlocks} previous ids lost, anchors orphaned`
```

[`src/pipeline.ts:1059-1062`](../../src/pipeline.ts) — keeps **every** ingest quiet. The warning goes
silent at the exact moment it becomes true.

I proposed replacing it with a count of comment and search anchors that still resolve. The review
says that is an audit and not a guard, and gives four reasons I had not thought through: it misses
chat anchors; search hits are generated data that is *allowed* to go stale; comments deliberately
point at `block_identities` rather than at the current revision; and **an article with no reader
anchors would let a completely broken matcher pass**. That last one is
[silent-success.md](../reusable/silent-success.md) again — a measure that reports success because
there was nothing there to measure. So, three protections rather than one:

1. **At runtime**, compare the baseline's ids with the output's. A non-empty baseline and a non-empty
   output that share *nothing* stops the stage, unless something explicitly asked for a
   whole-article replacement.
2. **An integration test on the Postgres path**: published blocks → copied draft → fresh stage-2
   HTML → stage 3 → the unchanged paragraphs still hold their exact ids. Plus: a failed baseline read
   throws rather than minting.
3. **The anchor audit as a one-off corpus check** at the re-ingest, comparing exact anchor *sets*
   rather than totals — because an aggregate that matches can still be made of different anchors.

### The switchover, and what "preserve what we have" costs

Greg asked, 2026-08-28, whether there is one destructive switchover and how much work it is to keep
what is already there. Three things came out of answering it, and the first two correct this
document.

**Production is already Postgres.** `src/store/index.ts:162-182` refuses to boot the filesystem store
under `NODE_ENV=production` or on Vercel, because it has no owner column. So there is no switchover
of the deployed install to do. What is still on files is **the local development corpus** — the
fifteen directories under `data/` — and that is the thing the re-ingest assumption is about.

**The re-ingest assumption has a consequence nobody wrote down.** § What it does not delete records
the assumption and the check behind it, and both are about *raw documents*: every source is
recoverable, three from git and two from the web. That check is sound and it is not the whole
question. Re-ingesting an article runs stage 3 again, and the section above is what stage 3 does once
its file is gone. **The re-ingest is the event that orphans the anchors** — not a later accident, but
the planned afternoon itself. Fix stage 3 first and the same afternoon costs nothing.

**Only `raw_bytes` is irreversible, and it is now empty.** Measured on the local database: five
revisions carry a source reference and **none carries `raw_bytes`**. Demolition step 5 drops a column
holding nothing. That is the step this plan called out as the one-way door, and it has quietly become
the cheapest one.

So the work to preserve what we have is not a migration. It is:

1. **The three identity carry-forwards move to the store** — blocks, glossary and ideas, above. A
   prerequisite for D rather than an addition to it.
2. **`db:export` fails closed** — § `db:export` must fail closed. It is the rollback tool, and on
   2026-08-28 it was found silently dropping `shelf.purpose`
   ([the postmortem](../postmortems/export-never-wrote-the-readers-purpose.md)). A backup nobody has
   watched fail is not a backup.
3. **`noema`'s raw document** — one decision, still Greg's, in § What it does not delete.

**And the order changes.** The review's sixth finding is that the re-ingest cannot simply be moved
earlier; several things have to be true before it happens at all, and the source route is one of them
because this document already says it moves *no later than D*. The sequence:

1. the three identity fixes, the zero-overlap guard, and **B3**
2. **D**, including the source route
3. **delete the importer** — the replacement suites are already green, C7
4. **enable the publication gate**
5. **the re-ingest** — and it is safe only after 1, because it is the event that would otherwise
   orphan every anchor
6. the compatibility release, then validating the export and source paths
7. **drop `raw_bytes`**, later, and it is the only irreversible step — currently holding nothing on
   any revision

### D — the stages, **and the source route**

Unchanged, plus one thing the first draft missed entirely. `sendSource` authorises through the
selected store and then reads `data/<slug>/raw.json` and the file beside it **unconditionally**
([`src/routes.ts:203-236`](../../src/routes.ts)). D removes those filesystem writes, so an article
ingested through the Postgres runner returns 404 from a route whose object demonstrably exists.

It moves to the reference-backed signed URL **no later than D**, keeping the filesystem fallback for
old articles through the mixed window. Note also that dropping `raw_bytes` is not what breaks this
route — it has never read that column.

### The demolition — five steps, not one commit

The first draft bundled everything into one commit on the reasoning that splitting them leaves a
state where the gate refuses what the importer writes. **The reasoning was wrong**: delete the
importer first and there is nothing left for the gate to reject. And a git commit cannot atomically
combine an application deploy with a migration, which is the part that actually matters here.

The rollback hazard is concrete. `beginDraftIn` renders `raw_bytes` into its `INSERT … SELECT` via
the carry policy ([`src/store/pg-revisions.ts:165-172`, `546-561`](../../src/store/pg-revisions.ts)).
Deploy the drop, roll the application back one commit, and every ingest fails with *column raw_bytes
does not exist* — and re-adding the column does not bring its contents back.

1. **Delete the importer**, after D and the replacement suites are green.
2. **Enable the gate** (and fix the ToC status hole first, separately, with its own red test).
3. **A compatibility release** that stops writing, copying, exporting or referencing `raw_bytes`
   while the column still exists.
4. **Rewrite the source and export paths**, and validate them.
5. **Drop the column**, in a later migration, once the release before it is known to work with the
   column absent.

Only step 5 is materially irreversible. Everything else is a git revert.

### E — the CLIs

Unchanged, and last.

## The window between now and step 1, and why it must be short

Once D can publish, **leaving `db:import` runnable is actively unsafe rather than merely redundant.**
Re-import an article that D has already published and, if the block text is unchanged, the importer
updates the current revision in place ([`src/store/import.ts:453-468`, `509-561`](../../src/store/import.ts)).
`revisionValues` rewrites `raw_bytes`, `raw_content_type`, `raw_encoding`, `raw_sha256` and both URLs
— and **omits** `rawSourceSha256` and `rawSourceKind`. The reference survives while everything around
it is replaced from files. The both-or-neither CHECK and the composite FK stay green throughout,
because the pair is still a valid pair; they cannot see that it now points at bytes from a different
acquisition.

So: **the importer refuses an article whose current revision carries a reference**, from the commit D
lands in. One condition, fails loudly, and it goes in before the window opens rather than after.

Also true in the window, and each cheap: new D-written rows have `raw_bytes = null`, so today's
`db:export` silently omits their raw document ([`src/store/export.ts:147-160`](../../src/store/export.ts));
`sendSource` fails as above; `REVISION_COLUMNS` is safe throughout because it excludes `rawBytes` and
picks the new reference up automatically, but its destructuring and
`tests/store-revision-columns.test.ts` both change at the drop.

## The block identity test

`chat-anchor` proves more than three columns: its anchor names a block **absent from the current
revision**, and import succeeds only because identities are inserted first and never deleted.
Adapter parity over a current `blocks` value does not prove that. The replacement stands alone and
needs no import or export:

1. Write and publish revision 1 through the Postgres adapter, with block `B`.
2. Begin revision 2, replace its blocks with a set that does not contain `B`, publish.
3. Assert `block_identities` still holds `B`.
4. Create an anchored chat naming `B` through `pgChatStore`, and read it back.

## `db:export` must fail closed

If export survives, it has a hole today that the rewrite would inherit. `scripts/db-export.ts`
imports [`src/store/export.js`](../../src/store/export.ts) directly, never
[`src/store/index.ts`](../../src/store/index.ts), where the credentials-and-project-pair refusal
lives. And `blobStore()` falls back to filesystem blobs when either Supabase credential is absent.
Point `DATABASE_URL` at the remote, unset `SUPABASE_SERVICE_ROLE_KEY`, and the rewritten export reads
`data/_blobs` rather than the bucket the rows refer to — omitting every source, or erroring as though
the objects were missing.

So a rewritten export requires both credentials and runs `projectMismatch` itself, or goes through a
shared "Postgres plus a matching blob store" constructor. The second is better; there is only one
such pair.

## What has to be true before this is believable

Each pinned to a way of being wrong, and each watched red first — the habit this repo keeps
relearning ([silent-success.md](../reusable/silent-success.md)).

1. **The three replacement suites are green** before the importer is deleted. Adapter parity watched
   red by breaking one adapter's round trip for one kind; reader parity watched red by Sol's own
   mutation (drop `byline` from `metaFrom`).
2. **The gate refuses a fetched revision with no source.** Build the state directly — a `done` fetch
   run and a null `raw_source_sha256` — and watch `publishRevision` throw. Watched red with the
   condition deleted. Reaching that state through the happy path proves nothing, which is the mistake
   this body of work has now made four times.
3. **The gate refuses a failed fetch**, even with a good inherited reference.
4. **The gate is silent about a draft that never fetched** — refused by the block/tree checks, and
   the reason strings say so.
5. ✅ **The ToC guard refuses an errored `toc` run** with a matching `input_hash` — done, `e18ac5f`.
   This one was a live bug, not a new rule.
6. ✅ **Only the attempt that began a step may end it, and only while its job is live** — done,
   `4da9bcf` + `414f3f9`, four guards each watched red on its own. § The build order for C.
7. ✅ **`has` refuses a step whose artefacts are all present and whose run was never recorded** —
   done, `cca945b`. This is carry-forward's shape exactly, and it is the one question the filesystem
   adapter cannot ask.
8. ✅ **Writing no blocks deletes the blocks** — done, `cca945b`, watched red by moving the delete
   back inside `if (blocks.length)` where the importer keeps it.
9. ✅ **A stamp the row and the artefact disagree about is refused at the write** — done, `cca945b`.
   The read side refuses it too, which is the legacy half.
10. **The importer refuses an article carrying a reference**, from the commit D lands in.
11. **The adapter refuses a manifest with no `storedSha256`** rather than writing a null reference.
12. **Block identities outlive the revision that dropped them**, through the production path.
13. **`db:export` refuses to run against Postgres without matching blob credentials.**
14. **A retry does not buy a checkpoint twice**, on a different store instance.

## Open

1. **Does `db:export` survive?** Without an importer it is a one-way dump. Its two plausible jobs are
   data portability and feeding `SPIDERYARN_STORE=files` from a Postgres corpus, and neither has been
   asked for. Recommendation: keep it, rewritten and fail-closed, because "get my data out" is the
   kind of thing whose absence is noticed at the worst possible moment — and say plainly in the docs
   that it is no longer a round trip and that nothing imports its output.
2. **Where the checkpoint table lives**, exactly — § B3 names the shape and not the schema.

## See also

- [delete-the-importer-review-sol.md](delete-the-importer-review-sol.md) — the NO-SHIP input round on
  this document's first draft, and the source of most of what is above
- [blocks-carry-forward-sol.md](blocks-carry-forward-sol.md) — NO-SHIP on five of seven, and the
  round that found glossary and ideas carrying identity in a file too
  ([the prompt](blocks-carry-forward-prompt.md))
- [transactional-stage-runner.md](transactional-stage-runner.md) — the landings this re-sequences
- [raw-bytes-in-storage.md](raw-bytes-in-storage.md) — where `storeRawSource`, `raw_sources` and the
  project-pair check come from, and whose backfill this deletes
- [raw-bytes-in-storage-input-3-sol.md](raw-bytes-in-storage-input-3-sol.md) — the round that found
  the publication gate written but not built
- [durable-queue-and-uploads.md](durable-queue-and-uploads.md) · [postgres-migration.md](postgres-migration.md)
- [../project/database.md](../project/database.md) · [../project/block-ids.md](../project/block-ids.md) ·
  [../reusable/silent-success.md](../reusable/silent-success.md)
