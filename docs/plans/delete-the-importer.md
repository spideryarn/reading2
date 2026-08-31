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

## Parked after D1b, 2026-08-30 — and what it would take to restart

> This pipeline work seems to be taking forever. I am wondering whether there's an easier v1 we
> could be aiming for, e.g. maybe we keep the state in the browser, and only send the required
> end-results up when the pipeline has finished. This doesn't meet our end-goals (e.g.
> idempotent/resumable, moving things more fully into the database), but if it simplifies things
> dramatically and works as a stepping stone, I'd consider it...
>
> — Greg, 2026-08-30

**Stopped after D1b, deliberately, in favour of [v1-imports-on-vercel.md](v1-imports-on-vercel.md).**
D2 through D5, the demolition and E are not abandoned; they are waiting for something to need them.

**This is a safe place to stop, by construction rather than by luck.** Nothing switches over.
[`src/jobs.ts:57`](../../src/jobs.ts) still imports `fsArtifacts`, every stage is still on
`LEGACY_UNCONVERTED_STEPS`, and the Postgres session would refuse all ten of them if it were wired in.
So what is committed is a store adapter, a transactional session and fifteen tests that no production
path reaches. It cannot rot, because nothing depends on it.

### Why the browser-state idea was not taken

It answers the right question — the only thing blocking imports is that each `/advance` may land on a
different Vercel instance with an empty disk — but it is the more expensive of the two answers.

| | needs a transport | needs the stages converted | works today |
|---|---|---|---|
| **one invocation per job** (v1 stage 3) | no | **no** | yes — worst measured job ~520s against an 800s ceiling |
| browser holds the state | yes, artefacts down and back up each step | **yes** | yes, with a trust boundary and the tab kept open |
| artefacts in Postgres (D2–D5) | no | yes | the end state |

**The decisive point is the middle column.** All ten stages still write their own files inside `run`.
For the browser to hold artefacts, every stage would have to *return* its product instead — and that
conversion **is** D3–D5. So browser-state skips the work that is already finished (the adapter, the
session) and still requires the work that remains. The cheaper variant, shipping the whole scratch
directory to the client and back, avoids the conversion but moves megabytes per step to do what one
invocation does with nothing.

Browser-state only starts to win when a job cannot fit in one invocation. It does not yet.

### What would restart this

Any one of these, and the first is the one to watch:

1. **An article that will not fit in one invocation.** `toc` alone is 320.4s measured; the ceiling is
   800s. A longer piece, a slower model, or a sixth default step and one invocation stops being
   enough. `tests/jobs-lease-budget.test.ts` fails when the sum exceeds it, which is the alarm.
2. **Wanting a job to survive a crash.** One invocation means a killed instance loses the whole job,
   not one step. That is the resumability D exists for.
3. **Reader data outgrowing the filesystem** — a second instance, a second region, or anything that
   needs two processes to see the same article.
4. **Deleting the importer**, which is still the only way content reaches Postgres and is still
   unsafe to leave runnable once D can publish.

### Trigger 5 fired on 2026-08-30, in production, before any of the four above

**The safety claim at the top of this section is false as stated.** "Nothing switches over" is true
of the D work — the Postgres session is still unwired and cannot rot. What it misses is that the
**reader** half switched over long ago: `SPIDERYARN_STORE=postgres` swaps every reader store through
[`src/store/index.ts`](../../src/store/index.ts), while [`src/jobs.ts:57`](../../src/jobs.ts) still
imports `fsArtifacts` directly and so the pipeline's reads never join that selection. Parking left a
**mixed** deployment, and a mixed deployment has a hole in it that neither half has on its own.

The hole: a job whose `steps` list does not include the stages that produce its inputs has nothing to
read. `POST /api/jobs { slug, steps: ["tweets"] }` on an already-published article gets a fresh
job-scoped `/tmp`, no earlier step runs, and the stage opens `data/<slug>/blocks.json` off an empty
directory. All six late stages read `blocks.json`, `tree.json` and `meta.json` off `ctx.dir` this way;
only `blocks` reads through the store.

Three failures in eleven minutes on 2026-08-30, deployment `dpl_2ydtHC76pndcgjsAnucrCXgvQsdE`
(commit `1ed4407`) — one `tweets`, two `arc`, on two different slugs:

```
ENOENT: no such file or directory, open
'/tmp/spideryarn/<owner>/spya-bpcjus/data/nagel-bat/blocks.json'
  at async generateTweets … at async runStep … at async advanceJobWith
```

**It is invisible in every error view.** The step failure is caught and the request answers 200, so
neither Sentry nor `get_runtime_errors` shows it. The runtime log is the only record, and it is
retained for a day.

**So the fifth restart trigger is: any job that does not run the whole pipeline.** That is not a
future article too large for one invocation — it is `tweets`, `glossary`, `summary`, `ideas`,
`sketch` and `arc`, every one of which is asked for on its own by design
(`DEFAULT_INGEST_STEPS` deliberately excludes them), and every one of which has been broken on the
deployed path since the reader moved to Postgres.

The work is scoped in [late-steps-read-the-store.md](late-steps-read-the-store.md), with a red repro
at `tests/late-step-on-a-cold-instance.test.ts` and a GPT Sol review
([late-steps-read-the-store-review-sol.md](late-steps-read-the-store-review-sol.md)) that returned
NO-SHIP on the first design. It needs the **read** half of D3 and none of the write half, so it does
not undo D1b and does not commit this plan to restarting. Two of Sol's findings belong to this
document rather than to that one:

- **The stamp fingerprints must be completed before, not after.** `tweets`, `glossary` and `summary`
  consume the tree and the meta but stamp only the blocks hash; `ideas` and `sketch` consume the meta
  and omit it. Today an incomplete stamp is harmless because the read returns `null` and the step
  runs anyway. The moment the reads succeed, an incomplete stamp lets a **stale published artefact
  skip**. § *D3* already says fingerprints must cover every real input; this is what makes it a
  prerequisite rather than a tidy-up.
- **`assertProduced` must keep reading the scratch alone.** Give it a view that can see the published
  artefact and a stage that wrote nothing passes its own postcondition.

### Where to pick it up

**D2 is the next stage and it is scoped** — see § *D2 scoped*. It is also the cheapest, because
`pdf-read.ts` has no boundary crossing at all. **D3 is six stages, not five** — `assets` was missing
from this plan entirely until 2026-08-29. And the reviews are the map: `delete-the-importer-d1b-sol.md`
confirms the transaction is correct and says what D3 must do — convert the six late stages to return
`parts` and `stamp`, remove each legacy exemption, and test real products through the injected
Postgres session. *"D3 should undo none of D1b."*

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

### A note from another session, 2026-08-28 — one thing D does not cover

Left here rather than sent, because I could not tell which of eight live sessions is yours. **I have
changed nothing in your stage**; this is evidence and a finding, and both are yours to judge.

**The wall is confirmed live, with an HTML URL rather than an upload.** Greg pasted a Stephen Wolfram
article into the production site and got `ENOENT: no such file or directory, mkdir '/var/data'` from
step `fetch` (job `spya-xbe8a9`, 12:39:52Z); a second attempt died the same way at step `ideas` on
`constitution`. So this is not the PDF path and not the upload path — it is every document, and it is
exactly the wall D removes. Stages 1 and 2 run fine on that article locally, so nothing about the
content is involved.

**The finding, from a GPT Sol round on the incident**
([html-ingest-var-data-sol.md](html-ingest-var-data-sol.md)): three functions on the **live enqueue
path** read the filesystem, and nothing in C or D as written covers them.

    freeSlug()          jobs.ts:1293
      └─ articleExists()  pipeline.ts:574  →  readFile(data/<slug>/meta.json)
      └─ urlForSlug()     pipeline.ts:597  →  readFile(data/<slug>/meta.json)

On Vercel that read can never succeed, so `articleExists` always returns **false**. Harmless today,
because nothing can be ingested at all — and *reachable the moment D lands*: a real Postgres article
with no local `meta.json` will read as an unused slug, so a different URL deriving the same slug
could be handed an existing article's identity. Sol called it NO-SHIP on the claim that D alone
closes this out.

Worth a glance at the comment sitting directly above `articleExists`, which warns about a silent
success "arriving through the one door that function does not watch". This is that door.

Two smaller things from the same round, for whatever they are worth: `/tmp` is not a shortcut
(`advanceJob` is one step per invocation, and a warm instance would sometimes serve a *stale* file to
`stepIsDone`), and the plan's own ordering — B3 and the block-id carry-forward before D — was
confirmed as right rather than cautious.

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

**And it is many rows per step, not one slot.** Both checkpoints are *collections*: the labels file
holds an array of batch entries, and `pdf-chunks/` is one file per chunk. A table with one row per
`(revision, step)` would hold the last entry and lose the rest — which is the same "written on every
run, read on none" failure arriving by a different door. `(revision_id, step, key)` with `key` an
opaque caller-supplied string, and the store never interprets it.

**Concurrency is designed for, not hypothetical.** [`src/store/artifacts-fs.ts:349-352`](../../src/store/artifacts-fs.ts)
ties it to the browser-driven advance endpoint letting two processes advance the same article.
`labels.ts` already handles it: each run mints a random `runId`, stamps every write with it, and
`clearCheckpoint` refuses to delete a file that is not its own. `pdf-chunks` handles it by having a
pure content-hash key, so two attempts converge on the same bytes.

Two more things the inventory turned up:

- **Size is not a problem.** The largest real one on disk is `data/ball-lightning/pdf-chunks` at
  100 KB over five files, ~20 KB a chunk, and `MAX_PAGES = 100` bounds the worst case to the low
  hundreds of KB. The largest labels file is 47.8 KB. A Postgres table is right; nothing here needs
  the bucket.
- **The `.running` attempt markers are not B3's.** `data/<slug>/steps/<step>.running`
  ([`src/store/artifacts-fs.ts:441`](../../src/store/artifacts-fs.ts)) looks like scratch state and is
  not — it already maps onto `revision_step_runs.status` and `attempt_id`, which C2 built. Named here
  so that nobody designs it a second home.
- **Nothing has ever deleted a pdf chunk**, on success or failure, so retention today is unbounded
  and undecided. B3 should say out loud which it is rather than inheriting the silence.
- **Moving to a row fixes a corruption class for free**, because a row cannot be half-written. That
  is a side benefit of the migration and not its purpose, but it is the second time this plan has
  found the destination better than the origin. The filesystem version of that bug was live and is
  now fixed on its own —
  [pdf-chunk-cache-corrupt-entry.md](../postmortems/pdf-chunk-cache-corrupt-entry.md), where a
  killed process left an entry that made one article permanently unreadable.
- **`tweets` decides it is done by reading its own output.** `isDone: (ctx) => threadIsCurrent(ctx.dir)`
  compares a `sourceHash` stored in `tweets.json` ([`src/pipeline.ts:1206`](../../src/pipeline.ts),
  [`src/tweets.ts:140`](../../src/tweets.ts)). That is not a checkpoint and does not belong in B3 —
  it is an `isDone` over a finished artefact, and the Postgres side already answers it from the step
  run's stamp. It needs porting in D, and it is listed here because a sweep for "reads a file it
  wrote last time" finds it and it is the wrong drawer.

#### Built, 2026-08-29 — the store, both adapters, and the three decisions

Nothing calls it yet; porting `labels.ts` and `pdf-read.ts` onto it is landing D. What exists is the
seam D writes through.

| | |
|---|---|
| [`src/store/checkpoints.ts`](../../src/store/checkpoints.ts) | the contract, the key rule, the retention constant. A **leaf** |
| [`src/store/checkpoints-fs.ts`](../../src/store/checkpoints-fs.ts) | `<dir>/checkpoints/<namespace>/<key>.json`, and the sweep |
| [`src/store/checkpoints-pg.ts`](../../src/store/checkpoints-pg.ts) | the `checkpoints` table, and the sweep |
| [`scripts/checkpoints-sweep.ts`](../../scripts/checkpoints-sweep.ts) | the sweep's one caller. Reports by default |
| `drizzle/0028_foamy_cassandra_nova.sql` | one table, one FK, one index, two CHECKs |
| [`tests/store-checkpoints.test.ts`](../../tests/store-checkpoints.test.ts) | 25 cases, every one watched failing |

##### 1. Scope and ownership — **the article is in the key, and there is no owner column**

The plan says *content-addressed*, and the obvious reading of that is a globally shared row: two
readers who upload the same PDF share one transcription. **That is not what was built**, and the
reason is that it would have been an addition rather than a preservation. Both existing checkpoints
are already article-scoped — `labels-progress.json` gates on `slug`
([`src/labels.ts:683`](../../src/labels.ts)), and `pdf-chunks/` lives inside `data/<slug>/` — so
removing the article would have *added* cross-reader sharing, which nobody asked for and which needs
its own argument about what a cache hit tells a stranger about a document they already hold.

`article_id` costs nothing the plan wanted. **A retry is a new revision, not a new article**, so
every reuse that matters still lands: every retry, and every re-run of the same article. The only
reuse it gives up is the one nobody has ever had.

**Two readers therefore cannot land on the same row**, and the question of an owner column does not
arise as a security question at all. It does not arise as a cleanup question either: `article_id` is
`not null`, so every row belongs to an article, and `articles.owner_id` is the owner. That is the
rule [`src/owner.ts`](../../src/owner.ts) states and `revision_blocks`, `revision_step_runs` and
`block_identities` all follow — carrying the owner twice is a second copy to disagree with the first.
`ai_calls` is the documented exception, and both of its reasons are absent here: its `article_id` is
`on delete set null`, and half its rows have no article.

**The step that makes the whole argument work, checked rather than assumed:
`articles.slug` is globally unique** — `slug: text("slug").notNull().unique()`,
[`src/db/schema.ts:142`](../../src/db/schema.ts), with no owner in the key, and the comment above it
says why: it is the URL contract. So an article id maps to exactly one owner, one owner's article
cannot share a slug with another's, and the `slug` gate already in `usableCheckpoint` was *already*
keeping the labels checkpoint per-reader before any of this. `src/owner.ts` notes the consequence
that two people ingesting the same URL is an open question rather than a thing that works; nothing
here changes that either way.

##### What `article_id` in the primary key costs, said out loud

It is not free, and the schema should not be left to imply it. **The same PDF ingested as two
articles pays for its chunks twice.** Two readers who upload the same paper each buy the whole
transcription; so does one reader who ingests it twice under two slugs.

That is the right price, for three reasons and in this order:

1. **It is not a regression.** `pdf-chunks/` already lives inside `data/<slug>/`, so the filesystem
   version pays twice for exactly the same case, today. Keying on content alone would be *adding*
   cross-article reuse, not preserving it.
2. **It is what makes "no owner column" safe** rather than merely convenient. A shared row is one
   reader's paid model output served to another, and defending that needs an argument about what a
   cache hit tells a stranger — a reader who possesses the bytes learns that somebody else possessed
   them too, which is a real if small thing to have to argue. Scoping to the article removes the
   question instead of answering it.
3. **`on delete cascade` makes deletion honest.** A checkpoint holds a transcription of the reader's
   own document. With the article in the key, deleting the article takes the transcription with it,
   in the same statement, with no sweeper to run and nothing to get wrong. A content-only row would
   outlive the article that paid for it and would have to be reasoned about — *whose* is a row two
   readers both reference?

The saving given up is a duplicate upload, which nobody has ever had and which is not a case this
tool is for. The cost avoided is a shared cache of model output derived from readers' documents.

What the two keys actually contain, checked rather than assumed:

| | what is in it |
|---|---|
| `labels` | `PROMPT_VERSION`, the model, the effort, the system prompt, the batch's block ids, `setStarts`, the sibling sets, and the rendered prose. Gated separately on version, generator, **slug** and `sourceHash` |
| `pdf-chunks` | a sha256 over `rawSha256`, the chunk's pages, its context, the prompt fingerprint, `reader.id` and `maxTokens` |

**One correction to this plan's own text.** It describes the `pdf-chunks` key as containing *"the
reader id"*, which reads as a person. It is `PdfReader.id`
([`src/pdf-read.ts:330`](../../src/pdf-read.ts)) — `model/promptVersion`, the vision model's own
name. **Neither key has a person in it**, which is correct today because neither piece of work
depends on one.

That is the rule the store cannot enforce and D must keep:

> **Every input the work depends on has to be in the key. Including the reader's own, if there ever
> is one.**

`ideas` already carries a `profileHash`. A future checkpoint over anything shaped by
`reader_profiles` has to hash the profile in, or two attempts at different times answer each other's
question. Rows are per-article and an article has one owner, so today that is a correctness rule
rather than a privacy one — and it stops being only that the day anything un-scopes these rows.

`on delete cascade` is the last piece, and it is doing **privacy** work rather than tidiness: a
checkpoint holds a transcription of the reader's own document, so deleting the article has to take it
along rather than leave it for a sweep to find in ninety days.

##### 2. Retention — **ninety days on `last_used_at`, swept by hand, and nothing schedules it**

Today's answer is *unbounded, by silence*. This is the answer instead.

An entry is dead when nothing will ever ask its question again — the prompt version moves, the model
moves, or the text moves. All three are in the key, so a dead entry stops being *read* the instant it
dies and nothing has to invalidate anything. What is left is only storage, and the sweep is a proxy:
if nothing has asked in ninety days, probably nothing will. The number is a judgement — long enough
that coming back to an article next quarter still hits, short enough that a year of superseded prompt
versions does not pile up — and it is one constant.

**`last_used_at` rather than `created_at`, and that is the half that had to exist on day one.** An
entry hit every week is not old however long ago it was written, and a sweep on `created_at` deletes
exactly the entries that were earning their keep — invisibly, with the bill as the only symptom.
Adding the column later would not repair it, because the first sweep after it was added could not
know which rows were hot. So `read` stamps it, in the same statement that serves the value, so a hit
cannot be served without being recorded.

**The sweep is not the retention policy, and an earlier draft of this section overstated it.**
`on delete cascade` is the policy for the only case with a deadline. An article being deleted takes
its checkpoints with it, in the same statement, and that is the case that matters — a transcription
of the reader's own document must not outlive the article by ninety days waiting for a cron nobody
wrote. The filesystem side gets the same thing for free, because the entries live inside
`data/<slug>/`.

**And there are no orphans**, in either store: the FK is `not null` with a cascade, and on disk the
entries are inside the directory. So what is actually left for the sweep is one narrow case —

> a **live** article whose checkpoints are dead because the question changed: the prompt version was
> bumped, the model was swapped, or the text was re-extracted.

Those rows are never read again and nothing will ever delete them by itself. That is a much smaller
claim than "the sweep is the retention policy", and it is the honest one.

**Nothing runs it, and that is stated rather than inherited.** `scripts/checkpoints-sweep.ts` is the
one caller and it reports by default; `--delete` is the opt-in, because a sweep whose cutoff nobody
has ever seen the effect of is one you find out about by paying for the work again. What makes no
schedule safe is that **every row costs a paid model call to create**, so the table cannot grow
faster than the bill — and the deletion with a deadline is already automatic, above. Housekeeping
nobody runs leaves a growing table, not a broken one.

##### 3. The interface — `CheckpointStore`, two methods, and no `delete`

```ts
read<T>(slug, namespace, keys): Promise<Map<string, T>>
write(slug, namespace, key, value): Promise<void>
```

- **`read` is batched** because both callers know every key before they start — `labels.ts` computes
  a fingerprint per batch from its plan, `pdf-read.ts` a key per chunk from its chunk list. One round
  trip, and no single-key method, because a caller with one key passes an array of one.
- **`write` is singular** because surviving a crash *mid-run* is the point.
- **`slug` on every method** is the mandatory assertion against the bound article, the same thing a
  review asked of `JobDraftRef` in `artifacts-pg.ts`: build a store for A, call it for B, and it
  throws before reading or writing anything.
- **The namespace is not a `StepName`.** `labels` is not a step — the `revision_step_runs_step` CHECK
  rejects it, and this plan has been bitten by that once — so it is a closed set of its own,
  `'toc-labels' | 'pdf-chunk'`, with a CHECK to match. See below: closing it is arguable.
- **`read` returns the value as written and does not check its shape.** `usableCheckpoint` and
  `checkChunk` are the real gates and are stricter than anything a store could be; teaching the store
  what a batch is would put pipeline logic in storage. A miss and an unreadable entry are the same
  answer here — *buy it again* — which is the only thing a caller can do about either. (That is the
  opposite of `readBaseline` on the artefact store, deliberately: there, absent and corrupt lead to
  *opposite* decisions.)
- **No `has`, no `describe`, no `delete`.**

**The missing `delete` is the one worth arguing.** `labels.ts` today mints a random `runId`, stamps
every write with it, and has `clearCheckpoint` refuse to delete a file that is not its own. That
machinery exists because *the unit of deletion was larger than the unit of work*: one file held every
batch, so clearing it could destroy a live run's paid work. **One row per entry removes the hazard
instead of guarding it**, and D drops the `runId` along with the file. The file also had to be
cleared or it would carry stale entries forward for ever — the code says so — and rows do not have
that problem, because each is addressed independently and a stale one is simply never asked for.

So there is a behaviour change for D to make deliberately: **the labels checkpoint stops being
deleted on success.** It is not correctness — `usableCheckpoint` plus a fingerprint match means a
stale entry can never be used wrongly — and it buys something, since a later re-run of `toc` over the
same tree resumes for free rather than re-buying every batch. Retention is the sweep. If D finds it
genuinely needs a `delete`, that is one method to add then.

##### The closed namespace, argued both ways

`checkpoints_namespace` is `in ('toc-labels','pdf-chunk')`, and that sits against this plan's own
sentence — *"the interface takes a namespace and an opaque content key, and the store never
interprets either"*. Worth being explicit about, because it is a real tension and not a slip.

**Against closing it.** Adding a third checkpoint costs a migration, which is a chore in the way of a
small change; and the plan asked for the store not to interpret the namespace.

**For closing it, which is what was built.** The two are not the same claim. *Interpreting* a
namespace would be branching on it — a different table, a different lifetime, a different shape per
namespace — and **nothing does that**: `nsDir` uses it as a path segment, the Postgres adapter binds
it as a `where` value and an insert value, and no code path anywhere reads it to decide behaviour.
What the CHECK does is refuse a namespace nobody declared, which is the same thing
`revision_step_runs_step` does one table over and for the same reason: a typo would otherwise open a
namespace that is written to and never read from, which is this landing's signature failure and the
one that shows up only as a bill.

The cost is one migration per new checkpoint, and that is the right moment to be made to think —
a new checkpoint needs somebody to decide what its key contains, which is the rule the store cannot
enforce. **If it ever becomes a nuisance, drop the CHECK and keep the TypeScript union**: the union
is what makes a typo a compile error, and the CHECK is only the second line.

##### And the key format, proved rather than agreed with

`checkpoints_key_format` is `^[a-z0-9][a-z0-9_-]{0,127}$` — no dot at all, so `..` cannot be spelt;
no `/`; lower case only, because macOS filesystems are case-insensitive and `AB`/`ab` would be one
file and two rows. It is narrower than "any string" and a real key that failed it would land cleanly
now and break in D, which is the worst available shape.

So both real keys are checked **against the expressions that actually mint them**, not against a copy
written into a test:

| | what it emits | how it is proved |
|---|---|---|
| `batchFingerprint` ([`src/labels.ts`](../../src/labels.ts)) | `createHash("sha256")…digest("hex").slice(0, 16)` — 16 lower-case hex | `tests/labels-batching.test.ts` imports the real function and asserts every batch of a whole plan |
| the chunk key ([`src/pdf-read.ts`](../../src/pdf-read.ts)) | the same construction over `rawSha256`, pages, context, prompt fingerprint, `reader.id` and `MAX_TOKENS` | it is **inline and not exported**, so `tests/pdf-read.test.ts` runs the stage over the real fixture PDF with a stub reader and asserts the file names it actually wrote |

Both were watched red: digesting to `base64` instead of hex, upper-casing the hex, and — the one
worth naming, because it is the plausible future edit — giving the chunk key a readable `chunk:`
prefix. Each reddened its test and nothing else.

Two notes for D. `reader.id` is `${model}/${PROMPT_VERSION}` and **contains a `/`**, which the key
constraint would reject — it is safe only because it goes into the *hash input* and never into the
key. And the pdf key being unexported is the one seam worth opening: a test can only reach it by
running the whole stage, so **D should extract it into an exported function** and have the caller and
the test share it. This repo has already paid for the other arrangement — see the memory about
testing the value that crosses the seam.

##### And the concurrency property, kept two different ways

**The last write wins**, both adapters: `rename` on the filesystem, and `onConflictDoUpdate` setting
`value` as well as `last_used_at` in Postgres. Two attempts answering one content-addressed question
produce interchangeable answers — the PDF reader is nondeterministic, so they will not be
byte-identical and it does not matter which survives — and since `write` is only ever reached after a
failed read, the newest one is always the better-informed.

This section originally said the *first* write wins, and the review found what that cost; the
reasoning is in § What the code review found below, and it is worth reading before anybody proposes
it again.

**Outside the transaction, with a test that proves it.** The Postgres adapter uses `getDb()` — the
pool — so a write lands on a different connection from any transaction the coordinator holds. There
is no `tx` parameter anywhere in the file and adding one would silently undo the whole point; *a
checkpoint survives the rollback of the attempt that wrote it* is the test that would go red.

##### What the tests were watched failing against

Thirty-three cases, of which **thirty have been watched red** against a named mutation applied to the
real source and reverted; the table and the three exceptions are in the file's header. An earlier
version of this line said "every one", over a list of exceptions — the two halves contradicted each
other and the review caught it by counting. The two that matter:

- *a retry after a new revision does not buy the work twice* — mutated by making the store prefix
  every key with the article's newest revision id, which is the design the plan warned about. It
  fails with **`expected 5 to be 3`**: the retry re-bought all three batches on top of the two
  already paid for. That is the bug's exact signature, and it is why the test **counts paid calls**
  rather than asserting a row exists — the row exists either way.
- *a checkpoint survives the rollback of the attempt that wrote it* — mutated by writing through the
  test's own transaction instead of the store.

Three cases have no mutation. Two would need DDL — *the database refuses a key the code refuses*
(which carries its own `IT WAS ACCEPTED` control instead) and *deleting the article takes its
checkpoints with it* (which has none, and is the weakest assertion in the file). The third,
*returns an empty map for an empty key list*, is unobservable on the filesystem by construction: the
loop it guards is empty either way. Its Postgres twin is observable and has its own test.

#### What the code review found — [b3-checkpoints-sol.md](b3-checkpoints-sol.md)

**NO-SHIP, and the first finding was a bug I introduced in the name of concurrency.** Worth writing
out, because the wrong answer sounded better than the right one.

**A broken entry could never heal, and the sweep protected it.** The store used `link()` so the
*first* write would win. A half-written entry reads as a miss, so the caller re-bought the work — and
then could not store the answer, because `link` refuses with `EEXIST` when the file is there. The
`EEXIST` branch bumped the file's mtime, so the sweep, the one thing that would eventually have
removed it, was taught the entry was hot. Every attempt paid again, for ever, and nothing errored.

That is **strictly worse than what it replaced**. The postmortem this design cites,
[pdf-chunk-cache-corrupt-entry.md](../postmortems/pdf-chunk-cache-corrupt-entry.md), is about a
corrupt entry that wedged an article *loudly* — a bug you find in an afternoon. A quiet permanent
charge is one you find in the billing. And `src/pdf-read.ts` has always used a plain `rename`, so the
`link` was not preserving today's behaviour either; it was inventing new behaviour and getting it
wrong.

**The fix is `rename` and `set: { value, … }` — last write wins, both adapters** — and the argument
is one fact about the callers:

> **`write` is only ever called by a caller that has just failed to read.**

Both read first and buy only on a miss. So a write is never a second opinion about a good entry; it
is always somebody reporting that what was there was *not usable*, and paying to find out. Keeping
the older value discards exactly those answers. **And nothing was lost by giving first-write-wins
up**: whole-or-absent is bought by the temp file and the rename, not by refusing to overwrite. All
the refusal added was stopping one valid answer replacing another valid answer, and those are
interchangeable by construction — the hazard it guarded against did not exist.

The other four, and what each turned into:

| finding | what it was | what changed |
|---|---|---|
| `write(…, undefined)` wrote the word `undefined` | `JSON.stringify(undefined)` is `undefined`, and a template literal makes nine characters of it. The file parses as nothing and reads as a miss for ever; Postgres refused the same value, so the two stores disagreed about a legal write | one shared `checkpointJson`, called by **both** adapters, and called *before* `mkdir` so a refusal leaves nothing behind |
| filesystem faults were swallowed | `.catch(() => null)` turned `EACCES`/`EIO` into "no checkpoint", and `readdir(root).catch(() => [])` made an unreadable root report `{swept: 0}` and a success line — identical to a healthy tree with nothing old in it | `ENOENT` only; everything else goes up. `utimes` stays best-effort but now logs |
| the empty-key test proved half its name | deleting either early return left it green | renamed to what it proves; the Postgres half got a real test that uses a non-uuid `articleId` so the database itself is the witness |
| the regex accepts Windows reserved names | `con`, `nul`, `com1` | **not handled**, deliberately: there is no Windows path, and dead code that reads like a live rule is worse. Instead the contract now says the regex is the rule and 16-character hex is the practice |

##### And a green report over a red gate — a third way, and it is not either of the two we had written down

`npm run typecheck` was **red in a file I had created**, and I reported it clean. Worth the paragraph,
because the two failure modes this repo already documents did not cause it and would not have caught
it.

What [typechecking.md](../project/typechecking.md) already warns about: run the **gate**, not the
tool it wraps — `npx tsc -p tsconfig.json` misses the other two projects and reports clean; and read
all three results rather than stopping at the first name you recognise. **Neither applies here.** I
ran the real gate, on all three projects, and read it correctly.

**The mistake was that I edited source afterwards and never re-ran it.** The last gate run was before
the final fix; the report went out after. The result was true when it was produced and stale when it
was quoted, which is a state no amount of reading the output more carefully would have revealed.

Two things let it travel that far, and both are worth fixing as habits rather than as facts:

1. **My standard gate command hid the evidence.** I ran `npm run typecheck 2>&1 | grep -E "^✓|^✗"`.
   The per-error lines are *indented*, so that filter prints `✗ tests/tsconfig.json (607 files, 1
   errors)` — a count with **no file name** — and drops every name beneath it. The repo's rule is
   *filter the output, don't narrow the input*; this filtered so hard it removed the thing the filter
   was for. A count told me "one error, and I know which one", and knowing which one came from a
   separate `tsc -p … | head -5` whose `head` would have truncated a longer list.
2. **186 tests were green across six suites while the gate was red**, because vitest does not
   typecheck. Every check I ran after the offending edit was a check that could not see it. That is
   [silent-success.md](../reusable/silent-success.md) exactly: the natural check shares an assumption
   with the code — here, that a test run says something about types.

The rule that covers it: **the gate must be the last thing you run before you report, not the last
thing you remember running.** An edit after a gate run invalidates the gate run, including —
especially — a one-line edit made to satisfy a *different* gate. The offending edit was the fix for
`tests/fixture-ids.test.ts`, and it dropped a required field while replacing an object literal.

And two the review did not raise, both from doing the work:

- **`guardDbStore` is applied now, not left to D.** The header used to say D must do it — a
  protection that expires the moment somebody wires the store up, and the person wiring it up reads
  the call site rather than the header. `tests/store-guarded.test.ts` asks the object.
- **Wrapping it exposed a second problem.** `guardDbStore`'s pass-through list is an allowlist, so it
  scrubbed the store's *own* argument refusals — a bad key, the wrong slug — into "this app asked its
  database for something it would not do", and logged `database call failed` for a call that was
  never made. `CheckpointRequestError` now joins `ChatConflict`, `StaleAttemptError` and
  `IllegalTransition` on that list, with its own test there, because the existing coverage for those
  entries lives in a suite that skips itself without a database.

Two of the failures found along the way were the tests defeating themselves rather than the store
failing, and both are recorded in the file: reusing a key across Postgres cases (first-write-wins
returned the earlier test's value), and checking "still there" **through the store** in the sweep
test — which stamps `last_used_at`, so the check made the entry it was checking survive the sweep.

##### One thing the drift guard did, unprompted

Adding the table to `src/db/schema.ts` turned `tests/db-schema-drift.test.ts` red before the
migration was applied anywhere, naming all six columns. That is the guard working as designed and
worth recording as a datum rather than a chore: schema-drift-guard.md's mechanism caught a real
undeclared-in-the-database table on its first outing after the plan that built it.

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
and the PDF chunk cache are checkpoints, and they are B3's.

So the sweep finds five self-reads in three different drawers, and **the drawer these three belong to
had no name**. It is not a stage reading the previous *stage's* output, which is what D converts. It
is not retry state within one attempt, which is what B3 is for. It is **a stage reading the article's
own prior published output, across revisions, to keep identity stable** — and because it had no name,
neither plan assigned it a landing and neither checklist tested it. That is the whole reason it
survived four reviews.

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

#### Two decisions taken while building it

**Stage 3 consumes `extractedHtml`, never `stampedHtml`.** Both are in Postgres on purpose and the
choice is not cosmetic: `stampedHtml` is stage 3's own previous output and still carries its ids, so
reading it would make the stage appear to work while the baseline read was doing nothing — ids would
survive because they were never removed, and the day a genuine re-extraction happened they would all
go at once. Reading stage 2's output means the ids are *absent* from the input, so the baseline is
load-bearing on every run and a broken one fails immediately rather than eventually. The rule is the
same one as everywhere else here: prefer the arrangement where the thing you depend on is exercised,
not the one where it is quietly optional.

**The zero-overlap guard has no escape hatch, and that is deliberate.** `force` cannot be one — it
means "re-run this step", which is the ordinary idempotent path, so it would disable the guard on
exactly the runs that most need it. And there is no other whole-article-replacement operation in the
repo.

That leaves a stage that refuses when a run keeps none of the previous ids, with no way to override.
Consider when zero overlap actually happens: the URL now serves a different article, a re-fetch
picked up a paywall page, an extraction went wrong. **In every one of those, refusing is the correct
outcome** — it is precisely the moment when re-minting silently would be the damage. The legitimate
case, a piece genuinely rewritten end to end, is rare, and making it stop and ask a person is the
safe side to be wrong on. The exemption gets added when somebody actually meets one, deliberately,
rather than existing in advance for a case nobody has had.

What the refusal owes in return is a message that can be acted on: what was compared, how many ids
each side had, that nothing has been written, and that a real whole-article rewrite is the thing
somebody has to allow on purpose.

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

#### Built, 2026-08-28 — the blocks stage only

Stage 3 is done; `glossary` and `ideas` followed it on the same day and are below. What landed,
and the four things the code decided that the section above left open:

- **`ArtifactStore` grew one method**, `hasEarlierBlocks(slug)`, and it is the "baseline-state
  signal" this section said had to be carried in. It is not `basedOn`, because **there is no
  `based_on_revision_id` column** — the name appears in `REVISION_CARRY_POLICY`'s comment as a
  column that *would* be harmful to carry, not as one that exists. Postgres answers with
  `articles.current_revision_id`, which is exactly the value `beginDraftIn` read as `basedOn` when it
  made the draft, and a published revision cannot exist without blocks (`publishRevision` refuses
  one). The filesystem answers with stage 4's `data/<slug>/blocks.json` — the second file
  `previousBlockCount` used to read, for the same reason.
- **`runBlocks`'s `previous` argument is required**, not optional. An optional one is exactly what
  landing D could drop while still compiling.
- **`PipelineStep.run` now takes the store**, like `isDone` and `stamp`, with no default — the
  reason `stepIsDone` gives. `blocks` is the only step that reads it today.
- **The filesystem's behaviour changes in one case**, and it is the case the old warn covered:
  stage 3's copy missing while stage 4's copy is present now **fails** instead of warning and
  minting. That is the table above applied to disk, and the recovery is to restore the file.

**No explicit whole-article-replacement operation exists**, so the zero-overlap guard has no
exemption. `force` on a step means *run it again*, which is the ordinary idempotent path and must
keep its ids, so it cannot double as one. The consequence is real and is left standing deliberately:
a publisher who genuinely rewrote every paragraph makes the stage refuse until somebody adds a flag
on purpose. `assertIdsCarried` in [`src/blocks.ts`](../../src/blocks.ts) is where it would be
honoured.

`tests/blocks-baseline.test.ts` is the suite, with the mutation each case was watched failing
against written at the top of it.

#### Glossary and ideas — built, reviewed, and one finding worth the round trip

The same fix, and the seam generalised: `ArtifactStore.readBaseline<K>` returns
`{state:"ok",value} | {state:"absent"} | {state:"unusable"}` and both adapters share one rule table,
so the two stores cannot drift about what a usable baseline is.

**Where these two differ from blocks, and it is the whole job.** Blocks always wants its baseline.
Glossary and ideas gate on a `sourceHash` match, and a mismatch **legitimately** means *do not
inherit* — the text changed, so the old ids describe text that is gone. So there are four states, and
two of them end in minting:

| state | correct |
|---|---|
| no previous artefact | mint |
| previous artefact, `sourceHash` differs | mint — correct, not an error |
| previous artefact present but **unusable** | **fail** |
| the store read throws | **propagate** |

**The review found the classifier could not tell the third from the second, and that is the finding
to keep.** `SHAPE.glossary` asked only whether `entries` was an array; `sourceHash` was never
validated anywhere. So `{entries: [...]}` with no hash classified as **usable**, failed the ordinary
staleness comparison, and was handled as *the text changed* — minting every entry id, resetting
`passes`, overwriting the baseline, and reporting success. **Unusable arriving disguised as stale.**
Missing and duplicated ids passed the same way; a duplicate is the quieter half, because
first-writer-wins means the second holder loses its id and every `?term=` link that meant it now
resolves to the wrong entry.

Fixed with a per-kind `BaselineRule` naming which field carries the staleness hash and which array
carries identity, checked by `whyUnusableAsBaseline` and shared by both adapters. Restoring the
shallow check reddens **seven** tests across both stores, two of which assert the refusal happens
*before* the model call and before the write — so a broken baseline costs neither money nor the
artefact that is still there.

**The general form outlived the feature** and is now in
[silent-success.md](../reusable/silent-success.md): *the check that decides "this is broken" cannot
be shallower than the decision it protects* — whatever field the decision reads, the usability check
must read too. Three instances landed in one day, in three different files. A second session hit the
same shape independently, in a fingerprint that ignored the field its policy was stated on.

And the review's second finding is the reason the first survived: the "wrong shape" tests asserted
exactly what the production validator asserted — that the field was an array — so they **repeated its
assumption** and stayed green through the data-loss path. A test derived from the implementation only
proves the implementation is itself.

> **Not yet committed**, and not for any reason to do with the work. Another session's in-flight
> `stripFence` de-duplication sits in `src/glossary.ts` and `src/ideas.ts`, and one of my hunks
> contains a line of theirs inside it — take-both-or-neither at hunk granularity. Unpicking it would
> mean hand-restoring lines their refactor deleted, which is what
> [version-control.md](../project/version-control.md)'s two recorded accidents both were. Waiting.

#### What the baseline landing leaves owed

Named here because they were found by the person who built it, when asked what they were unsure
about, and an unowned risk in a report is a risk nobody meets again. Worst first.

**`htmlCarriesItsIds` stops working under Postgres, and this one is a D-time hazard rather than a
caveat.** The `blocks` step's `isDone` compares the stamped HTML against the block rows. After stage
2 re-runs under Postgres, `stamped_html` and the rows are *still last revision's matching pair*, so
`isDone` answers "done" and **stage 3 skips entirely**. That is a different and quieter failure than
re-minting: no ids change, nothing warns, and the article simply keeps the previous run's blocks over
new text. Its own comment calls it "the one check that can tell `extractedHtml` from `stampedHtml`",
and under Postgres it stops being able to. D must replace it, and the replacement needs its own red.

**The `articles.current_revision_id` proxy has a race, accepted on purpose.** If another job publishes
this slug between `beginDraftIn` creating a first-ingest draft and stage 3 running, `hasEarlierBlocks`
answers true for a draft that has no baseline, and a legitimate first ingest fails. It needs two
concurrent ingests of one article and it **fails safe** — refusing, not minting. The real fix is a
`based_on_revision_id` column on the draft, which is the same column § the fix above found does not
exist and which D can add.

**The CLI still swallows its baseline read.** `previousBlocksInFile` catches everything, so
`npm run blocks -- output/x.html` on a machine where the file is present but unreadable re-mints
silently. Deliberate — the CLI has no store to ask — and `assertIdsCarried` catches it immediately
afterwards. On the record rather than only in a comment, because a swallow that is currently harmless
is how the original bug got in.

**Two smaller ones.** The filesystem warn→fail change can stop a local re-run for somebody who
cleaned `output/` but kept `data/`; the recovery is to restore the file or delete both. And
`assertIdsCarried` labels its error with the HTML file's basename, which is the slug only because the
layout happens to be `output/<slug>.html`.

#### Built, 2026-08-28 — glossary and ideas

The other two stages in the table, on the seam stage 3 opened. `previousGlossaryFrom` in
[`src/glossary.ts`](../../src/glossary.ts) and `previousIdeasFrom` in
[`src/ideas.ts`](../../src/ideas.ts) read the previous artefact from the store; `generateGlossary`
and `generateIdeas` take it as a **required** `previous`, for the reason `runBlocks` does.
`tests/glossary-ideas-baseline.test.ts` is the suite, with the mutation each case was watched failing
against written at the top of it.

**These two have four states, not three, and that is the whole difference from stage 3.** Stage 3
wants its baseline unconditionally. These two inherit ids *only when `sourceHash` matches*, so a
mismatch is a legitimate refusal to inherit rather than a fault:

| | what it means | what to do |
|---|---|---|
| no previous artefact | a first run | mint, quietly |
| one whose `sourceHash` differs | the article's text moved | mint, quietly — **correct, not an error** |
| one the store cannot read | we cannot tell which of the two it would have been | **fail the stage** |
| the store read throws | an infrastructure fault | **propagate, fail the stage** |

Rows two and three are the pair that has to stay apart, and folding either into the other is the bug
`36dadcc` fixed in the blocks version arriving through a different door. Row two is decided
downstream, by `existingFor` and `idsByTerm`, which is why `previousGlossaryFrom` hands back the
artefact rather than a decision: those two have three answers — *append*, *rewrite keeping the ids*,
*start again* — where a caller-side gate could only have one.

**`ArtifactStore` grew a general tri-state read, not two more siblings of `hasEarlierBlocks`.**
`readBaseline(slug, step, kind)` returns `ok` / `absent` / `unusable`, from the `readOutcome` the file
adapter already had and from an unflattened `readArtefact` in the Postgres one. The reason it is
general where `hasEarlierBlocks` is specific: stage 3 cannot ask its question of its own artefact,
because that artefact **is** the baseline and a missing one could only ever report itself missing —
so it has to ask a second source, which is stage 4's copy on disk and the published-revision pointer
in Postgres, and those two have nothing in common but the answer. Glossary and ideas have one copy
each, so the honest second question is about that same copy. Two shapes of question because there are
two shapes of artefact; collapsing them would make one of the two lie. `hasEarlierBlocks` is
unchanged.

**The append half is the trap this landing had that stage 3 did not.** `glossary.json` does two jobs
— `existingFor` decides whether "Find more terms" *adds to* the list, and `idsByTerm` lends its ids to
a rewrite — and a fix that restored the ids while quietly turning a top-up into a replacement would
pass every id assertion there is. It is watched red on its own: making `generateGlossary` ignore
`opts.previous` for `existingFor` alone reddens **exactly** the two append tests and nothing else.

**What this leaves owed.**

- **Postgres cannot detect a carry-forward that did not happen**, the way stage 3 can. Glossary and
  ideas are columns copied by `beginDraftIn`'s single `INSERT … SELECT`, so they carry or the
  statement fails; there is no equivalent of "the pointer says there were blocks and the rows are
  gone". If a future change moves either artefact out of `article_revisions` into a table of its own,
  that stops being true and this stage needs the `hasEarlierBlocks` treatment.
- **Both CLIs still swallow their baseline read**, exactly as `previousBlocksInFile` does and for the
  same reason — no store to ask. The blast radius is smaller than stage 3's (a top-up that starts a
  fresh list, in a directory a person named by hand) and there is no `assertIdsCarried` behind it.
- **The Postgres half of the new suite exercises the read and not the write**, deliberately: these
  stages take no job claim to read, and inserting one would have put every assertion behind the
  database's single `running` slot. It cost four failures in a full-suite run before it came out.
  `store.write` for these kinds is covered by `tests/store-artefacts-pg.test.ts`.

#### And a second bug, found by reading the column the baseline work walked past

`Meta.rawSha256` is **PDFs only** — it is the hash of the file a person uploaded, and the round-trip
test compares an absent key against a null one. `article_revisions.raw_sha256` is a different thing
wearing the same name: stage 1's hash of whatever it fetched, and **every** fetch has one. Three
places read the column straight into the field — [`src/store/pg.ts`](../../src/store/pg.ts)'s
`metaFrom`, the same reassembly in [`src/store/artifacts-pg.ts`](../../src/store/artifacts-pg.ts),
and [`src/store/export.ts`](../../src/store/export.ts) — so every web page that came back out of
Postgres carried a PDF-only field, and `db:export` wrote it into the `meta.json` of every HTML
article it touched.

`metaRawSha256(row)` in [`src/store/artifacts.ts`](../../src/store/artifacts.ts) is the one rule now,
`row.source === "pdf" ? row.rawSha256 : null`, and all three call it. It is here rather than in its
own commit because it is the same seam: the null-versus-absent contract that the baseline work had to
write down is exactly what makes this a bug rather than a spare field.

**Why no test caught it.** The fidelity suite round-trips the fixtures we have, and no HTML fixture
had a `raw_sha256` worth noticing — the same shape as
`docs/reusable/silent-success.md` § *a corpus cannot report what it lacks*. The new case in
`tests/store-artefacts-pg.test.ts` makes the state instead of borrowing it.

#### The ten lines in this commit that are not mine

`src/glossary.ts` and `src/ideas.ts` each carry a third session's conversion to `stripFence` /
`readJsonOrNull` — an import, a read and a parse call, six lines in total, interleaved with mine at
hunk granularity so there was no honest way to split them. They sat untouched for fifteen hours while
this landing waited on them; `src/parse-json.ts` already had both exports in `HEAD`, so committing
them breaks nothing. Recorded here because the commit message cannot be the only place it is said.

### Greg's steer, 2026-08-28 — and what it does *not* remove

> **Re-fetch is fine. Or even drop it. I don't care much about the data we have so far. I just want
> to get to the long-term-best design/state soon, and from then on we'll treat production data with
> great care.**
>
> — Greg, 2026-08-28

That settles `noema` and more besides, and the section below is now answering a question nobody is
asking. **The local corpus does not need preserving.** So: no migration, no careful switchover, no
audit of anchors before and after. The re-ingest the plan has always assumed is simply fine, and
`noema` is re-fetched if convenient and dropped if not. Its URL was checked on the day and still
returns 200, so either is available.

**What the steer does not remove, and the distinction is the useful part.**

- **The three identity fixes stay, and are more clearly right than before.** They were never really
  about today's fifteen directories; they are about every article ingested from the demolition
  onwards, which is exactly the data Greg has just said will be treated with great care. A pipeline
  that re-mints every id on re-extraction cannot treat anything with care. Doing them *before* D
  remains correct.
- **B3 stays.** A checkpoint is not about preserving a corpus, it is about not buying the same
  labelling and page-reading calls twice after a failure. That cost is the same whatever we think of
  the data.
- **The demolition's five steps stay, and it is worth being explicit about why**, because "I don't
  care about the data" reads at first like it collapses them. It does not: those steps are about
  **uptime and rollback**, not about the corpus. Production runs on Vercel against Postgres and
  refuses the filesystem store at boot ([`src/store/index.ts`](../../src/store/index.ts)). Deploy the
  column drop, roll the application back one commit, and every ingest fails on a column that no
  longer exists — which is an outage, not a data loss, and the sequence exists to prevent it.
  Step 5 is still the only irreversible one, and it is now dropping a column that holds nothing on
  any revision.

So the plan gets shorter by one section and none of its stages. What follows is kept because it
records how the question was answered, not because the work is owed.

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

#### The inventory, 2026-08-29 — and the three things it changed

Before drawing D's stage boundaries I had the whole surface swept. Three findings changed the plan;
the rest confirmed it. Each was checked against the code before being written down here.

**1. `store.write` has no production caller at all.** `beginStep` and `finishStep` are wired
([`src/jobs.ts:351`, `:390`](../../src/jobs.ts)) and the read side is partly live, but every call to
`write` in this repo is in a test. **The write half of the seam has never run in anger.** That
reframes D: it is not nine conversions of a working mechanism, it is the first real exercise of one.
Expect the writes to be the expensive part and the reads to be routine — which is the opposite of how
the earlier sections of this plan read.

**2. `htmlCarriesItsIds` does not stop working under Postgres. It inverts, silently.** This plan said
it "stops working", which implied a break somebody would see. It compiles and runs: it already reads
`blocks/blocks` and `blocks/stampedHtml` through the store. What changes is what the answer *means*.
On disk `extractedHtml` and `stampedHtml` are one file, so "are the recorded ids in the HTML" detects
a re-extraction that wiped them. In Postgres they are two columns — a re-extraction writes a new
`extracted_html` and leaves `stamped_html` alone — so the check reads **stage 3's own previous
output**, finds its own ids, and returns `true`. The guard that exists to catch silent id loss becomes
a silent success itself.

The question it is really asking is *was stage 3's output derived from the stage-2 HTML that is there
now?*, and in Postgres that is a stamp. But `STAMP_SOURCE`
([`src/store/artifacts.ts:565`](../../src/store/artifacts.ts)) has no `fetch`, `extract` or `blocks`
entry, so **`blocks` records `NO_INPUT_HASH` and no stamp at all**. That gap has to close *before* any
of the later stages move, or everything after it is built on an identity guarantee Postgres cannot
check. This is why D now starts with stamps rather than with a stage.

**3. A deploy gate asserts the existence of what D deletes.**
`GATE_FIXTURES = ["data", "output", …]` ([`scripts/deploy-checks.ts:582`](../../scripts/deploy-checks.ts)),
iterated by [`scripts/deploy.ts:620`](../../scripts/deploy.ts). Nothing in this plan mentioned it. It
gets folded into whichever stage first breaks it rather than left to the demolition: a red deploy gate
in the middle of a sequence is the kind of thing that gets forced past, and this repo already has a
note about a force-gate forgiving the next failure.

Two smaller corrections. The metadata page's `STEP_STORAGE.fetch` line is at
[`src/store/pg.ts:752`](../../src/store/pg.ts), not 336 as written above; and `provenance.dir` is
rendered as a relative path ([`src/web/Metadata.tsx:405`](../../src/web/Metadata.tsx)) with a fixture
check `provenance?.dir === "example"`, which breaks the moment `dir` stops being a path.
`tests/owner-isolation.test.ts:610` pins that `sendSource` calls the store for authorisation
**before** it touches `fsLocations`, so any rewrite of that route has to keep the ordering.

#### The stages, and what makes each one safe to stop at

**The numbering below is the first draft's and is superseded** by § *What the plan review changed*, which
adds the runner as D1 and pushes the rest along. The reasoning in each entry still holds; read the
label as the old name in brackets. D0 → D0, D1 → D2, D2 → D3, D3 → D4, D4 → D5.

The ordering principle: **remove code before adding it, and close the identity gap before moving
anything that depends on identity.**

**D0 — the stamps. No store conversion at all.** Give `tweets` and `summary` a `stamp:` and delete
`threadIsCurrent` and `summariesAreCurrent`; record an `input_hash` for `blocks` over the stage-2
HTML, and replace `htmlCarriesItsIds` with the stamp comparison. Those two `…IsCurrent` functions ask
`sameStamp`'s question in four hand-written steps, and `glossary` and `ideas` already do it the short
way. First because it is the only part of D that *deletes* code, because it is fully testable on the
filesystem store today, and because finding 2 means nothing else should move until it is done.
**Safe to stop after:** nothing has been converted, two `isDone`s became stamps, and the existing
suites cover both.

**D2 (was D1) — the two checkpoint callers.** `pdf-read.ts` first (near drop-in; the key is already the right
16-hex digest, and the batched `read` replaces a `readFile` per chunk inside the loop), then
`labels.ts`, which *deletes* the `serialise()` mutex, the `kept[]` pruning, `runId` and
`clearCheckpoint` — all four exist only because the unit of deletion was a whole file. `usableCheckpoint`
splits rather than disappearing: its per-entry validation stays as the caller-side gate the store
delegates, and its four manifest comparisons go, but **`sourceHash` must be checked against
`batchFingerprint`'s inputs before it is deleted** — three of the four are already inside the key and
that one is not obviously subsumed. **Safe to stop after:** a checkpoint is working state, so a wrong
answer costs money and never correctness, and both callers already treat a miss as *buy it again*.
This is the cheapest possible place to find out whether B3's interface is right.

**D3 (was D2) — the six uniform late stages**, one commit each: `arc`, `tweets`, `summary`, `glossary`,
`ideas` — **and `assets`**. The first five read `toc/blocks`, `toc/tree` and `extract/meta` and write
one artefact. `arc` goes first because it has neither a baseline nor a stamp, which makes it the
smallest possible first production caller of `store.write`. **Safe to stop after each:** they are
independent, only `arc` and `assets` are in `DEFAULT_INGEST_STEPS`, and a half-converted set still
runs because each stage's I/O is self-contained.

**`assets` was written as five and is six**, corrected 2026-08-29 — see § *What D1b's design review
changed*, last paragraph. It arrived after this document was written, and an explicit name list
enumerates a newcomer *out* rather than quietly covering it, which is the failure mode of every list
in this plan. `assets` reads differently from the other five — it collects images rather than reading
the tree — so do not assume its conversion is mechanical because the other five are.

**D4 (was D3) — `toc`, with `labels` already moved.** Three artefacts written in one call, an input that is
stage 3's copy rather than stage 4's, and the deliberate `blocks` duplication in `PATHS`
([`src/store/artifacts-fs.ts:91`](../../src/store/artifacts-fs.ts)) that has to survive the move. Its
own stage because it is the one place where *write everything at once* has an atomicity story the
filesystem adapter cannot honour and Postgres can.

**D5 (was D4) — `fetch`, `extract`, `blocks`, and the source route.** Bytes rather than JSON; two acquisition
paths, including the inline duplicate at [`src/pipeline.ts:742`](../../src/pipeline.ts) that bypasses
`writeRaw` entirely; the `extractedHtml`/`stampedHtml` split becoming real; and `sendSource` moving
onto the reference. **Last, because it is the only part of D where getting it wrong loses a reader's
document rather than costing a model call** — and because by then D0's stamp is actually checking the
thing.

**Not D, but before `data/` can go.** The slug-allocation path reads `raw.json` through
`readRaw(contextPaths(candidate).dir)` before an article has a store at all (`articleExists`,
`urlForSlug`, [`src/jobs.ts:1377`](../../src/jobs.ts) `slugIsSpokenFor`); `src/store/slug-is-taken.ts`
exists and nothing in that path calls it. Two independent `readdir(data/)` walks enumerate the library
([`src/library-search.ts:207`](../../src/library-search.ts), [`src/api.ts:1005`](../../src/api.ts)).
And **reader state is a different drawer entirely** — comments, chat, searches, shelf, glossary
lookups and the reader profile all build their own `data/` paths and never touch the artefact store.
`data/` does not disappear at the end of D, and this plan should stop implying that it does.

**One hazard to name rather than discover.** Three CLI `main()`s default `dataDir` to
`data/<slug>` ([`src/fetch.ts:1286`](../../src/fetch.ts), [`src/toc.ts:675`](../../src/toc.ts),
[`src/pdf-read.ts:1329`](../../src/pdf-read.ts), and `src/extract.ts`'s
`opts.dataDir ?? path.join("data", slug)`). That default is the dangerous shape: forget to pass a
store and you get a *working filesystem write* rather than an error — the same hazard the required
`store` argument on `stepIsDone` was introduced to remove. `previousBlocksInFile`
([`src/blocks.ts:1148`](../../src/blocks.ts)) is the same thing: the deleted bug still in the file,
with a comment saying so, live for the CLI. Both need a decision in D rather than a second door left
open into the removed behaviour.

#### Two things D0 must not break, found while checking whether the stamp holds on a first run

The first-run question answered itself and is closed already: `stepIsDone`
([`src/pipeline.ts:503`](../../src/pipeline.ts)) asks `store.has` *before* it computes a stamp, so
freshness can only narrow presence and never widen it; and `sameStamp`
([`src/store/artifacts.ts:621`](../../src/store/artifacts.ts)) returns **false** both for a `null`
recorded stamp and for an expected stamp with no defined keys, on the stated grounds that *"yes,
current" would otherwise mean "nobody checked anything"*. For `tweets` and `summary` the change is a
true refactor: the filesystem `stampFor` reads `sourceHash`/`version`/`generator` off the artefact
itself, which is the same three fields the two hand-written `…IsCurrent` functions compare.

Asking it turned up two things that are not symmetric, and both were checked against the code.

**`blocks` has nowhere on the filesystem to keep a stamp.** `blocksArtefact`
([`src/blocks.ts:947`](../../src/blocks.ts)) returns `{ sanitizer, blocks }` — none of the three
stamp fields. So adding `blocks` to `STAMP_SOURCE` hands `stampOf` an artefact with nothing in it,
`sameStamp({}, {inputHash})` is false, and **stage 3 re-runs on every job for ever**: `{ steps:
["blocks"] }` could never skip, and the metadata page would report `blocks` permanently not-done. It
costs no model call, which is exactly what would let it survive unnoticed.

The fix is to write the stamp into the artefact — `sourceHash: hash(extractedHtml)` alongside
`sanitizer`, which is the move [`src/blocks.ts:1195`](../../src/blocks.ts) already argues for. Older
`blocks.json` files lack the field, so each article gets one free re-run of stage 3, which carries its
ids over and costs nothing. The alternative — give Postgres the stamp and leave the filesystem on
`htmlCarriesItsIds` — is the private freshness rule in the storage layer that the `toc` note at
[`src/pipeline.ts:1120`](../../src/pipeline.ts) already rejected, arriving through a different door.
It does change the shape of `blocks.json`, so the artefact contract and `SHAPE` need a look in the
same commit.

**`htmlCarriesItsIds` does two jobs, and a stamp only replaces one.** Besides the id-membership test
it returns false on `!file?.blocks?.length`, and that half is eight days old: *"No ids at all is not
'all of them are there'. `every` over an empty array is true"* — GPT Sol, 2026-08-28,
[`src/pipeline.ts:413`](../../src/pipeline.ts). It is reachable on a **first ingest**, where the
runtime guard in `src/blocks.ts` has no baseline to refuse against: a paywall or an error page
extracts to no prose, and `{"blocks":[]}` satisfies `SHAPE.blocks`, which takes any array.

A stamp over `hash(extractedHtml)` does not reproduce it — an empty blocks array written against the
current HTML has a *matching* stamp and reports done. So D0 must keep that half, and the better home
is a **write-time refusal beside `assertIdsCarried`** rather than a residual `isDone`: refuse to write
the empty artefact at all instead of catching it on the next skip check. Note that
`assertIdsCarried`'s own `produced.length === 0` exemption was removed on 2026-08-28 for the
*baseline* case; this is the first-run case, which nothing guards yet.

Both are "the check goes quiet at the moment it becomes true", so both get a red test first.

**And D0 needs no edit to `src/summarise.ts`**, which is the file another session is live in.
`PROMPT_VERSION` is already exported there and in `src/tweets.ts`, so both `stamp:` closures are built
inside `src/pipeline.ts` from `inputHashFor` and the imported constant. The only edit that would land
in `summarise.ts` is deleting the dead `summariesAreCurrent` — one importer, no test references — and
that waits for a one-line follow-up once the peer commits. The real test cost is `tweets`:
`tests/tweets.test.ts` has a six-assertion `describe("threadIsCurrent")` block to rewrite against the
stamp, and both of those files are clean.

#### What the plan review changed — [delete-the-importer-d-plan-sol.md](delete-the-importer-d-plan-sol.md)

**NO-SHIP, seven findings, and one of them is a stage this plan never had.** Each was checked against
the code before being accepted.

**There is no runner conversion anywhere in D, and without it `arc` cannot be the first production
caller of `store.write`.** [`src/jobs.ts:57`](../../src/jobs.ts) imports `fsArtifacts as
pipelineStore` — one hardcoded line, whose own comment says it is *"the single line that picks
Postgres instead"* and defers that to a step this plan later reorganised away. Meanwhile the Postgres
adapter's `write` takes `tx` and **not** `Db | Tx`, deliberately
([`src/store/artifacts-pg.ts:1133`](../../src/store/artifacts-pg.ts)): a write that could run outside
the transaction would commit artefacts and then find the job fence refusing, leaving a revision full
of a dead worker's output with nothing owning it. But a stage makes model calls, so no transaction can
be held open across one.

Those two facts together are a stage in their own right, and it is the shape of the whole conversion
rather than a wiring detail: **a stage stops doing its own I/O and instead returns a product; a short
transaction afterwards writes it, checks it, finishes the step and advances the job.** That is what
makes every later stage conversion mechanical, and it lands on the filesystem runner so nothing
switches over. It goes immediately after D0 and before anything else, and the note that a partial D2
is *"safe to leave for a week"* is only true under the filesystem runner — not after a cutover.

**The `blocks` stamp as I wrote it does not work on either adapter.** On the filesystem
`extract.extractedHtml` and `blocks.stampedHtml` are **the same path**
([`src/store/artifacts-fs.ts:119`, `:123`](../../src/store/artifacts-fs.ts) — both `at.htmlFile`), so
a stamp over the stage-2 HTML self-invalidates the moment stage 3 overwrites that file: hash recorded,
file replaced, never current again. And on Postgres, recording the run row's `input_hash` does not
help either, because `stampForStep` treats the **artefact** as the freshness authority and does not
fill a missing artefact hash from the row ([`src/store/artifacts-pg.ts:750`](../../src/store/artifacts-pg.ts)).
So the fingerprint has to go in the `blocks` artefact itself, and the validation has to be honestly
adapter-specific — Postgres compares the stamp; the filesystem keeps `htmlCarriesItsIds` unless the
two HTML paths are split, which is the alternative worth pricing. Three red-first tests on **both**
adapters: first run, second-run skip, re-extraction invalidation.

**The five late stages need a fingerprint over everything they read, before D3.** The shared one
hashes blocks only ([`src/pipeline.ts:524`](../../src/pipeline.ts)), while `arc`, `tweets`, `summary`,
`glossary` and `ideas` all read blocks *and* tree *and* metadata. The code already warns that turning
on `toc` freshness before consumer invalidation can make summaries and arcs disappear when ranges move
([`src/pipeline.ts:1094`](../../src/pipeline.ts)). Metadata is a real prompt input, so blocks-plus-tree
is still short.

**The deploy-gate finding was half right, and the wrong half is the dangerous one.** `GATE_FIXTURES`
does require `data/` — but D deliberately leaves reader state there, so the directory survives, the
gate passes, and it stops meaning anything the moment the article fixtures beneath it are gone. A
directory check that cannot fail is another silent success. It needs named article fixtures, and the
old gate has to be watched failing before it is changed.

**The CLI `dataDir` defaults are an undecided second write path, not a hazard to mention.** Decided
here: every slug CLI requires an explicit store mode, a filesystem run requires an explicit path, and
`previousBlocksInFile` stops swallowing — only `ENOENT` may mean *first run*, and a corrupt or
unreadable baseline must fail rather than remint.

**D4 has no seam to move to yet.** `RawSourceStore` exposes an object `get`
([`src/store/blobs.ts:59`](../../src/store/blobs.ts)) and there is no download-signing or
owner-filtered reference resolution. D4 must specify a source-reader operation that authorises and
resolves the revision *first* and then proxies or signs — preserving the ordering
`tests/owner-isolation.test.ts:610` pins — and it must land in the **same commit** that stops relying
on raw files.

**And `toc`'s one-call write is not atomic on the filesystem.** The adapter loops and renames each
part separately ([`src/store/artifacts-fs.ts:506`](../../src/store/artifacts-fs.ts)). The interrupted
marker stops a later *done*, but a concurrent reader can still see mixed generations. The honest
contract, written down rather than implied: Postgres has transaction-wide atomicity; the filesystem
has whole-file writes plus interrupted-run detection, and not atomic visibility across a set. Test an
interruption after each part.

**So D is six stages, not five:** D0 the stamps (corrected as above), **D1 the runner**, D2 the
checkpoint callers, D3 the five uniform late stages with a fingerprint that covers their real inputs,
D4 `toc`, D5 the bytes and the source route. The review agreed D0 is still the right first stage once
its contract is fixed.

#### The `blocks` check — priced twice, and it belongs in D5, not D0

The review left this open: put the stage-2 fingerprint in the `blocks` artefact, and either keep
`htmlCarriesItsIds` on the filesystem or split the two HTML paths. Both halves were priced before
anything was built. Both answers came back no, and the second one moves the work to a different stage.

**The path split had already been rejected once, on the same evidence.**

> **The HTML collision is closed by binding, not by moving the file.** Giving `extractedHtml` and
> `stampedHtml` distinct paths was the review's first suggestion and would have changed the layout on
> disk, the importer, the exporter and the manifest test. Instead `blocks` gained the one check that
> can tell the two apart.
>
> — [postgres-storage-implementation.md](postgres-storage-implementation.md), 2026-08-26

So `htmlCarriesItsIds` is not the fallback design; it is the considered one. The pricing added one
fact that decision did not have: **an existing article cannot be backfilled.** Stage 3 destroyed the
unstamped copy the first time it ran, for every article in `data/` and all eighteen checked-in
`output/*.html` fixtures. A split leaves every existing article's new extracted slot empty — the one
state Postgres guarantees cannot exist — or fills it with the stamped file, which is wrong data
wearing the right name.

**And the generation token the code names as the stronger version does not help.** A token written by
stage 3 into both `blocks.json` and the HTML survives a re-extraction on Postgres untouched, because
the re-extraction writes `extracted_html` and never touches `stamped_html`. Anything written into
stage 3's *output* is blind to a change in stage 3's *input*, on that adapter, by construction.

**Then the field itself turned out to have nowhere to live.** Postgres stores blocks as **rows** in
`revision_blocks`, one per block ([`src/store/artifacts-pg.ts:436`, `:1213`](../../src/store/artifacts-pg.ts)) —
there is no per-artefact JSON column, and `writeBlocks` takes `value.blocks` and drops everything
beside it. `sanitizer` already disappears through that path and gets away with it only because it is a
global constant the exporter re-stamps. A per-run hash is not reconstructible, so it would not.
`blocksArtefact` is also a choke point called from three sites, and two of them — stage 4's copy at
[`src/toc.ts:836`](../../src/toc.ts) and the exporter at
[`src/store/export.ts:439`](../../src/store/export.ts) — have no value to supply and today silently
drop fields they do not name. Stage 3 would write the field and stage 4 would lose it on the next run,
with nothing going red.

**The right home was a column that already exists.** `revision_step_runs.input_hash`, which `blocks`
currently fills with the sentinel `NO_INPUT_HASH`. That removes the JSON shape change entirely: the
filesystem answers by id-membership and needs no stored hash at all, and Postgres answers from the
run row. It also removes a name collision — `sourceHash` already means *a `hashBlocks` fingerprint of
blocks* on five other artefacts, and reusing it for *sha256 of HTML* would give one field name two
algorithms.

**But it cannot be read through `stampForStep`, and that is not an obstacle — it is the reason this
moves to D5.** Rule 2 of that function is explicit: the row *"may not fill in `inputHash` where the
artefact has none … letting the row supply one would give Postgres freshness evidence the filesystem
does not have, so the same article would be current in one store and stale in the other"*
([`src/store/artifacts-pg.ts:760`](../../src/store/artifacts-pg.ts)). That rule is right, and `blocks`
is the case it was not written for: here each store has *different* evidence for the *same* event, and
both detect a re-extraction. So the question goes on the store by name — the shape `hasEarlierBlocks`
already has, and not the private rule the `toc` note rejects at
[`src/pipeline.ts:1120`](../../src/pipeline.ts) — with the filesystem answering by id-membership and
Postgres by comparing the run row's `input_hash` against the current `extracted_html`.

**Writing that hash requires `blocks` to write through the store, which nothing does until D5.** So
D0 cannot close this, and neither of the two ways to fake it is acceptable: a Postgres side that
throws breaks the metadata page, which calls `stepIsDone` with its own store; one that returns `false`
re-runs stage 3 on every job for ever and reports `blocks` permanently not-done — and because stage 3
costs no model call, that is exactly the kind of wrong answer that survives unnoticed.

**So the correction to the review's sequencing:** the gap has to close before the **Postgres cutover**,
not before D2. Nothing between here and there runs on Postgres, and no later stage depends on
`blocks` freshness — the five late stages read stage 4's copy, not stage 3's. `blocks` converts in D5
and the cutover is in the demolition after it, so the constraint is met by the order already written
down. **`htmlCarriesItsIds` stays exactly as it is until D5**, where the store question and the
Postgres answer land in the same commit that makes `blocks` write through the store.

**What that leaves in D0:** the two stamps, and the empty-blocks half of `htmlCarriesItsIds` becoming
a **write-time refusal beside `assertIdsCarried`** — refuse to write the artefact at all rather than
catch it on the next skip check. The `isDone` guard stays as well, because `blocks.json` files already
on disk can be empty and nothing will rewrite them.

#### D1 — the runner, designed before it is built

The review's second finding is a stage, and this is its shape. Everything the design needs already
exists; what is missing is the seam between them.

**What the runner does today**, [`src/jobs.ts:351-390`](../../src/jobs.ts): `beginStep`, then
`STEPS[name].run(ctx, pipelineStore)` — and the stage does its own writing inside `run` — then
`assertProduced`, then `finishStep`. Four store calls, each of which commits on its own. On the
filesystem that is fine, because there is nothing to commit. On Postgres each one would be its own
transaction, and the first of them writes the artefacts.

**What Postgres needs** is the opposite: the write, the postcondition and the step transition in one
transaction with the job fence taken inside it — and every model call *outside* it. Those two
requirements are not in tension once you notice they are about different halves of the step. So:

> **A stage stops writing. It returns a product. A short transaction afterwards writes the product,
> checks it, and finishes the step.**

**The seam.** A `StoreSession`, made once per job, with three members:

- `reads` — an `ArtifactStore` for the run phase, outside any transaction. On Postgres that is
  `readOnlyPgArtifacts(ref, db)` plus `readBaseline` and `hasEarlierBlocks`; on the filesystem it is
  `fsArtifacts` itself.
- `beginStep(slug, step)` → attempt token, unchanged.
- `commit(slug, step, attempt, fn)` — the short transaction. On Postgres,
  `db.transaction((tx) => fn(pgArtifactsIn(ref, tx)))`, which is the factory that already exists at
  [`src/store/artifacts-pg.ts:1358`](../../src/store/artifacts-pg.ts) and already takes a `Tx` and
  nothing else. On the filesystem, `fn(fsArtifacts)` and no transaction at all.

The runner then reads, in full:

```
const attempt = await session.beginStep(slug, step);
const product = await collectSpend(() => STEPS[step].run(ctx, session.reads), …);
await session.commit(slug, step, attempt, async (store) => {
  if (product.parts) await store.write(slug, step, product.parts, product.stamp ?? {});
  await assertProduced(STEPS[step], ctx, store);
  await store.finishStep(slug, step, attempt);
});
```

**`run`'s return type changes from `string` to `{ detail, parts?, stamp? }`** — which is why this is
a stage rather than a wiring commit, and why it has to come before the nine conversions rather than
during them.

**The job's own progress note stays outside the transaction, deliberately.** `revision_step_runs` is
the authority for *is this step done*; `note()` is a progress bar. Pulling the job row into the
artefact transaction would widen it for a field nothing decides anything on, and a progress bar that
lags a crash by one step is a cosmetic wrong answer where a revision half-written is not.

**`parts` is optional, and that is the migration path — with a guard, not a hope.** An unconverted
stage returns `{ detail }` alone and keeps writing its own files during `run`; under the filesystem
runner that behaves exactly as it does today, which is what makes D3, D4 and D5 landable one stage at
a time. Under a *Postgres* session the same stage would write nothing and report success — the
silent-success shape this whole plan exists to remove. So a transactional session **refuses a step
that returned no `parts`**, by name and loudly. That refusal is what makes the review's warning
enforceable rather than remembered: a partial conversion is safe under the filesystem runner and is a
hard error under Postgres, and nobody has to keep the list in their head.

**Nothing switches over in D1.** `src/jobs.ts:57` keeps importing the filesystem store; what changes
is that it reaches it through a session. The Postgres session is written and tested in this stage and
wired in the demolition, so the line that picks Postgres stays one line.

**Safe to stop after:** every stage still writes its own artefacts, the runner has grown a bracket
that currently brackets nothing, and both sessions are covered — including a red-first test that a
transactional session refuses an unconverted stage.

#### What D1a's code review changed — [delete-the-importer-d1a-sol.md](delete-the-importer-d1a-sol.md)

**NO-SHIP, and the first finding is the one this plan should be most embarrassed by: nothing tested
the write.** Ten mutations had been run and every one went red, and not one of them touched the line
the stage exists to add. Deleting `store.write` from `commit` left all eight session tests green —
verified here rather than taken on trust. The reason is plain once seen: **every test written was a
refusal**, and refusals are negative cases. `{ parts: {} }`, a missing key, an absent `parts` — every
one asserts that nothing is written. The positive case, a complete product written over a carried
artefact, was never written at all. The real-blocks job test did not catch it either, because
`blocks` still writes its own files and returns no `parts`, so the whole runner could have reverted to
its old direct path with that test still green.

Closed with a test that seeds `tree` and `labels` from a previous run and commits complete new ones,
asserting the write happened **once**, that the bytes on disk are the new ones and not the carried
ones, that the step completed, and that the marker is gone. The same mutation now reddens exactly that
test and leaves sixteen green. Separately, `tests/jobs-commit-path.test.ts` wraps the real session the
runner builds and counts, so reverting `src/jobs.ts` to its old inline path fails by name rather than
by inference.

**The atomic boundary was in the wrong place, and that was this plan's fault rather than the
implementation's.** D1a was fenced off from `src/jobs.ts`'s job handling on the grounds that the job
transition was D1b's work. The result was a seam D1b could not have used: `commit` ended at
`finishStep`, `runStep` marked the job step done afterwards, `advanceJob` released or finished the job
in separate calls later, and an all-skipped claim never reached `commit` at all. So the fence is
lifted and D1a carries it. The session is built **once per successful claim** and passed into
`runStep`; `commit` takes an explicit `JobTransition` payload — declarative, not a closure, for the
same reason `commit` takes the product rather than a function; and `runStep` decides the transition
**before** committing, because a transition has to be known while there is still a transaction to put
it in. Every terminal job write now goes through the session, so D1b inherits one seam rather than one
seam and three exceptions.

One bug fell out of that move and is worth recording: with the fenced job write now inside `runStep`'s
`try`, a `StaleAttemptError` from `releaseStep` would have been swallowed into `"failed"` — this
claimant writing a verdict on a job it no longer owns. It is re-thrown, restoring the contract the
function's own docstring states.

**`UNCONVERTED_STEPS` was fail-open, and the note in this plan arguing for it was wrong.** Pinning the
set equal to `STEP_ORDER` was defended here as making a new step declare which side of the seam it is
on. It does the opposite: it hands every newly added step the **unsafe** exemption by default, and a
converted stage accidentally left in the set is permitted to write nothing and pass `assertProduced`
against old artefacts. Inverted: steps are converted-by-default, and `parts` is **statically** required
for any name outside a `LEGACY_UNCONVERTED_STEPS` tuple, through `PipelineStep<N extends StepName>` and
a return type that resolves to a `parts`-required product off the list. A stage dropped from the list
without being converted no longer compiles. The test asserts only that the legacy names are real steps.

**Three edge cases in `checkProduct`**, each now with its own red: `parts[kind]` accepted **inherited**
values while `Object.entries` writes none of them, so a prototype-borne key could let a carried
artefact satisfy the postcondition — `Object.hasOwn` now; extra keys were not rejected until the
filesystem store threw part-way through a write; and a step with `produces: []` and `parts: {}` was
accepted and finished, though `has([], …)` deliberately returns false so it could never be considered
done.

**And `reads` was a compile-time fiction.** It handed out the mutable store, so one assertion widened
it back. `readsOf` returns a six-method facade written out one by one — not a spread, which would
carry `write` with it — with a test that the key set is exactly six, and another that the six really
delegate, because a facade returning `undefined` for everything would pass the first.

#### D2 scoped, 2026-08-29 — the open `sourceHash` question is answered, and there is one blocker

**The `sourceHash` gate can go, and here is the argument this plan owed.** § D2 said three of
`usableCheckpoint`'s four manifest comparisons are already inside the checkpoint key and that
`sourceHash` *"is not obviously subsumed"*. Checked properly:

- `version` and `generator` are **literal** inputs to `batchFingerprint`
  ([`src/labels.ts:600`](../../src/labels.ts)), along with `EFFORT` and `SYSTEM`.
- `slug` is structural rather than hashed: the store is bound per article and
  `assertCheckpointRequest` throws on a mismatch before it touches anything
  ([`src/store/checkpoints.ts:273`](../../src/store/checkpoints.ts)).
- **`sourceHash` is not an input, and does not need to be.** `hashBlocks` covers *every* block in the
  article. `batchFingerprint` instead hashes exactly what the model is shown for that one batch — its
  own blocks' text plus one neighbour either side (`CONTEXT_BLOCKS = 1`), the block ids, the set
  grouping that no rendered text states, **and the whole-tree outline, which every batch shares**. So
  a heading changing anywhere changes every batch's fingerprint, and a batch's own window changing
  changes that batch's.

What is left is the case the coarse gate caught and the fine one does not: a block edited far outside
a batch's window, with no heading touched. There, **reuse is correct** — nothing the model saw for
that batch moved. So dropping `sourceHash` removes no correctness, and removes the old behaviour where
editing one paragraph threw away every batch including the ones still good. Worth noting alongside it
that `structureHash` and `structureVersion`, which `labels.json` records
([`src/labels.ts:1490`](../../src/labels.ts)), were **never** in `usableCheckpoint`'s gate at all — a
forced re-run producing a different tree from the same blocks was already caught only by per-batch
fingerprint mismatch, which is the same mechanism this now relies on.

**`articleId` is not a problem, and the store said so in advance.** Neither call site has one; only a
slug and a directory. `createFsCheckpointStore`'s docstring
([`src/store/checkpoints-fs.ts:122`](../../src/store/checkpoints-fs.ts)) already answers it: *"`ref.articleId`
is unused here and is still required, so that a call site cannot build a filesystem store today and
discover it has nothing to give the Postgres one tomorrow."* `assertCheckpointRequest` validates slug,
namespace and keys and never the id. So an empty `articleId` on the filesystem is the contract working,
not a workaround.

**The blocker: D2 cannot be built without a three-line deletion in `src/toc.ts`.** The
`generateLabels` call site itself is fine — `toc.ts:780` already passes `dir` and `slug`, which is
everything a store needs. But `toc.ts:838` calls `labelRun.clearCheckpoint()`, and `clearCheckpoint`
is one of the things D2 deletes: the checkpoint store has **no `delete`**, deliberately
([`src/store/checkpoints.ts:122`](../../src/store/checkpoints.ts)). A peer is live in `src/toc.ts`,
so this waits for them. Leaving a no-op `clearCheckpoint` behind would be a second door into removed
behaviour, which is the shape this plan exists to close.

> **Correction, 2026-08-31 — two things above are wrong, and one is a live question.**
>
> **The line number is stale.** `clearCheckpoint` is called at **`src/toc.ts:1285`**, and again at
> `src/labels.ts:2065`. Re-derive it rather than trusting either number; `src/toc.ts` has been edited
> heavily since.
>
> **"A three-line deletion" undersells what is there.** `spideryarn2-fe`, who owns that file, points
> out the call is the **last step of a deliberately ordered write sequence** — the label checkpoint is
> discarded only once `labels.json`, `blocks.json` and `tree.json` are all whole, **tree last**,
> because the tree is the file every reader starts from. GPT Sol raised that ordering on 2026-08-26;
> a crash mid-sequence otherwise leaves new labels and new blocks beside last week's tree, all three
> present and mutually inconsistent. Whatever D2 does here, that ordering property has to survive or
> be consciously given up — it is not incidental.
>
> **The open question this exposes:** if the checkpoint store has no `delete` by design, **what
> reclaims a finished run's checkpoint under Postgres?** On the filesystem `scripts/checkpoints-sweep.ts`
> answers it — but that sweeps the `data/` root directly, so it is a *filesystem* answer that does not
> carry over. Either the store needs a reclamation path, or checkpoints accumulate for ever. This is
> unresolved and must be settled before D2 is built, not during.
>
> Also read `src/labels.ts` **after** the current ToC work lands rather than working from the
> paragraph below: `LabelRun` has since gained fields, a shortfall re-ask for missing ordinals and a
> bounded partial accept, so a run can now finish having deliberately dropped labels. A checkpoint
> move sized against the old shape will miss the new state.

**So D2 splits.** `pdf-read.ts` has no boundary crossing at all — its only caller is `runPdfExtract`
([`src/pipeline.ts:941`](../../src/pipeline.ts)), already passing `dataDir` and `slug`, and nothing has
ever deleted a PDF chunk. It can go first and on its own, which is the cheapest possible test of
whether B3's interface is right. `labels.ts` follows once `src/toc.ts` is free. Note that `pdf-read`'s
call site sits inside the `extract` step that **D1 rewrites**, so these two must not be built at the
same time.

**What D2 deletes**, all in `src/labels.ts`: `serialise()` (~21 lines with its docstring), the
accumulated `kept[]` array — gone because each write is now one key rather than a re-serialised batch
list — `runId` in all four of its places, `clearCheckpoint`'s type and implementation, and the
map-level half of `usableCheckpoint` (~28 lines), whose per-entry shape validation stays as the
caller-side gate the store delegates.

#### What the D1 design review changed — [delete-the-importer-d1-design-sol.md](delete-the-importer-d1-design-sol.md)

**NO-SHIP, two criticals, and the design above is superseded by this section.** The run/commit split
itself survived — *"under the present writer set, baseline reads outside the transaction are safe for
the job-owned draft"*, which was the question I most expected to lose. What did not survive is where
the transaction ends, and the shape of `commit` itself.

**The transaction ended too early, and this plan already said so 500 lines earlier.** § *C* says
plainly that the coordinator calls *"`write` + `finishStep` + **the job transition** together"*. My
D1 design dropped the third. `releaseStep` and `finish` open their own statements
([`src/store/pg-jobs.ts:252`](../../src/store/pg-jobs.ts)), so after the artefact transaction commits
there is a window in which `failExpired` can invalidate the attempt before the release lands: the
revision says done and the job says interrupted. And the job's step status is not cosmetic — it drives
`stillForced`, completion and retry-force ([`src/jobs.ts:245`, `:853`, `:1510`](../../src/jobs.ts)).
`noteProgress` may stay outside, because its running text really is a progress bar; the **terminal**
release and finish may not. On the last step the same transaction must publish the revision, and on
failure it must fail revision and job together. That needs transaction-taking variants of the job and
revision operations, and an explicit lock order written down.

**`commit(…, fn)` cannot express its own guard, and that is the second critical.** The session never
receives the product, so *"a transactional session refuses a step that returned no `parts`"* — the
sentence that was supposed to make a partial conversion safe — has nothing to inspect. Worse,
`ArtifactParts` is **partial**, and `assertProduced` only asks whether each kind is readable *now*
([`src/pipeline.ts:556`](../../src/pipeline.ts)) — its own comment already admits it *"cannot tell
that this run wrote them"*. Since `beginDraftIn` carries the previous revision's artefacts into the
draft, a converted step returning `{ parts: {} }`, or an `extract`/`toc`/`blocks` product missing one
required part, **writes nothing, passes the postcondition against the carried copy, and is marked
done.** For `blocks` that commits new stamped HTML beside old block rows — the id-loss failure this
whole plan exists to prevent, arriving through the coordinator meant to prevent it.

So `commit` takes the **product**, not a closure, and validates before any write: every key in
`step.produces` present, with a defined value. Postgres rejects an absent `parts` outright; the
filesystem permits absence only for a step explicitly marked unconverted. **And the test must run
against a carried draft, not an empty one**, or it proves nothing — an empty draft has no old artefact
for the missing part to be mistaken for.

**`reads` needs a real type, and a session cannot live for a job.** `run` currently takes the full
mutable `ArtifactStore` ([`src/pipeline.ts:383`](../../src/pipeline.ts)) while `readOnlyPgArtifacts`
returns four methods, so calling the run-phase object an `ArtifactStore` either fails to typecheck or
pushes writable methods back into the run phase. It gets a real `ArtifactReads` type with the six
read operations the stages actually use. And the lifetime was wrong: **every `/advance` mints a new
attempt and runs one step**, and `JobDraftRef` embeds the attempt — so a session built once per job is
stale on the second request. It is built once per successful claim, after `openOrBeginJobDraft`,
rebinding the same draft to the new attempt. The preflight `stepIsDone` has to go through
`session.reads` as well, or filesystem artefacts will make a Postgres step skip.

**Only the happy path was designed.** A handled failure needs its own short transaction — mark the
step `error`, fail or clear the draft, end the job — or the step stays `running`, the terminal job
keeps its draft pointer, and the retry builds a different draft. So `StoreSession` grows a `fail`.
`collectSpend`'s cost rows, the checkpoints, the logs and the initial interrupted marker all stay
**outside**, deliberately: they record work that was really spent, and it was spent even when the
artefact is rejected.

**One hazard outside the runner entirely.** The importer bypasses the job constraints and can replace
`current_revision_id` during a model call ([`src/store/import.ts:586`, `:1014`](../../src/store/import.ts)),
and publication does not check that the current revision is still the one the draft was copied from —
so a job can overwrite a concurrent import, and `--prune` can delete the article and draft underneath
one. While the importer exists, **import and prune refuse any slug with an active job.** The planned
"current revision has a source reference" refusal does not cover this, because the first Postgres job
runs while the current revision is still importer-produced.

#### D1 splits in two, because the atomic boundary is the whole risk

**D1a — the shape, on the filesystem.** `ArtifactReads`; `run` returning `{ detail, parts?, stamp? }`
(nine mechanical returns); the session seam with `commit` taking the product; product validation
against `step.produces`; the filesystem session; the runner going through it. Nothing converted, no
Postgres session, no transaction. **Safe to stop after:** every stage still writes its own artefacts
and the coordinator has grown a boundary that currently holds one.

**D1b — the atomic boundary, on Postgres.** The transactional session: write, validate, finish the
step, release the job, publish on the last step — one transaction, with a written lock order — plus
`fail`, the transaction-taking job and revision variants, and the importer/prune refusal. **Safe to
stop after:** nothing switches over; `src/jobs.ts` still imports the filesystem store.

**The six tests D1b owes**, each with its guard mutated to confirm the assertion actually fails: a
missing part over a **carried** artefact; a stale attempt between run and commit; artefacts and job
transition rolling back together; two `/advance` claims reopening one draft under different attempts;
a Postgres preflight with misleading filesystem files present; and a job where every step skips. The
review was explicit that a fake product-returning step proves the coordinator and nothing else — it
does not reach carried-output handling, attempt rebinding, preflight store selection, job-transition
atomicity or publication. `arc` stays the first real user, in D3.

#### What D1b's design review changed — [delete-the-importer-d1b-design-sol.md](delete-the-importer-d1b-design-sol.md)

**NO-SHIP, three criticals, and the design was reviewed before a line of it was written** — which is
the one thing this stage got right first time. The lock order I proposed survived; almost nothing
else did unchanged.

**The lock order is settled, and one word of it was wrong.** *"Article then job is the right order.
It agrees with publication/failure and with all article-wide writers."* The correction is that
taking the article lock before the artefact fence is **essential rather than tidy**: *"If the
transaction first acquires the job lock and later calls `publishRevisionIn`, it still has job→article
ordering; being inside one transaction does not prevent a deadlock with another article→job
transaction."* I had reasoned the lock should go at the top for legibility; it has to go at the top
for correctness, and I would have accepted a "take it only when publishing" simplification if anyone
had pushed back on the cost. Re-locking an article the same transaction already holds is safe, so the
unconditional lock costs nothing beyond contention — Postgres does not escalate these row locks and
reader `SELECT`s stay unblocked, but shelf, chat, search, visibility and import writers will wait.
That is a performance risk to measure, not a correctness objection.

And the review went one further than I asked: **`openOrBeginJobDraft` should be reordered to
article→job in D1b too.** It already has the article identity before it locks the job, so it is a
small change, and it *"establishes one enforceable invariant instead of depending on caller
sequencing"*. My argument for leaving the inversion alone was accepted on its facts — the claim fence
does prevent the cycle, and `failExpired` does not create it because a replacement job is a different
job row — but "narrowly safe today by caller sequencing" is not a property anybody can check later.

**Critical 1: settlement was never designed, only its happy path.** Three things follow.
`releaseStep` can resolve to **cancelled** after a concurrent Stop, so a `void` `commit` that infers
the outcome from the transition it was *asked* for reports the wrong thing: **`commit` and
`settleJob` must return the actual settlement.** Neither `finish`, `releaseStep`, `failExpired` nor
`requestCancel` clears `draftRevisionId` ([`src/store/pg-jobs.ts:252`](../../src/store/pg-jobs.ts)),
so the sweeper protects terminal jobs' drafts indefinitely. And the all-skipped path must
**explicitly publish or discard** the copied draft rather than merely finishing the job. The state
machine, in full, is now five cases rather than the two I had drawn: non-terminal success; terminal
success (write, validate, finish step, publish, finish job, clear draft); stage failure or
cancellation; a release that resolves to cancellation; and all-skipped.

**Critical 2: the dependency I declared cannot do the job.** `pgStoreSession(… jobs: JobSettles)`
takes methods whose implementations call `getDb()` independently, so injecting them binds nothing to
the transaction — *"artefacts and step state can commit while release/finish fails separately — the
exact D1 finding"*. The session must call `releaseStepIn(tx, …)` / `finishIn(tx, …)` directly, or
take a factory bound to its own `tx`, and must **not** accept the public `JobSettles` capability.
`NotTheLiveAttempt` is translated to `StaleAttemptError` at that boundary.

**Critical 3: the importer and prune refusal had vanished from the design.** The plan assigns it to
D1b and my draft never mentioned it. Import replaces revision data inside a long transaction and
prune deletes the article, and neither checks for a live job — so an import can replace the base
beneath an active draft and prune can cascade-delete state a running job owns. Both must **lock the
article, then refuse any queued or running job for that owner and slug**, in that order. The review
cited this as further evidence for article-before-job.

**Three of the six owed tests are not honestly reachable as written**, because production is still
hardwired to `fsStoreSession` and the Postgres session refuses every real step: the two concurrent
`/advance` claims, the Postgres preflight over misleading filesystem files, and the all-skipped
Postgres path. Calling a session helper directly would prove *different* behaviour, and "both claims
succeed" contradicts the one-running-job constraint anyway. The fix is **a narrow internal
coordinator entry point taking a session factory and a step registry**, with production supplying
today's defaults.

**And the seventh test is the one that matters most**, for exactly the reason D1a's review gave:
every test on the list is a refusal, and refusals are negative cases. A successful final fake step
must prove **artefacts written, the run completed, the revision published, the job finished and the
draft pointer cleared** — all five. An eighth, a concurrent Stop proving a release-to-cancel disposes
of the draft correctly, is what justifies taking the article lock on non-publishing commits.

**`publishRevisionIn` is not a pure extraction while it logs inside somebody else's transaction.**
The pre-update `article.currentRevisionId` stays correct because the row is locked, but
[`logger.info`](../../src/store/pg-revisions.ts) can announce a publication that the outer
transaction then rolls back during job settlement. It returns its log fields instead, and the caller
logs after the commit. Same rule for any extracted failure helper.

**D3 undoes none of this** — it converts `arc` to return products, drops it from
`LEGACY_UNCONVERTED_STEPS`, and adds a real-product integration test. And a second `StoreSession`
implementation is confirmed as the cheapest sound design: share `checkProduct`, `readsOf` and a small
transition dispatcher, keep the mechanics separate, because *"generalizing transactions across both
stores would add machinery without reducing the atomic risk."*

**One correction to this plan that came from outside the review.** `assets` is a real `ArtifactKind`,
a step with `produces: ["assets"]`, in `DEFAULT_INGEST_STEPS`, on `LEGACY_UNCONVERTED_STEPS` and
carrying a `STAMP_SOURCE` entry — and the string does not appear anywhere in this document. It landed
on 2026-08-29, after the plan was written, and D3's explicit five-name list enumerates it *out*
rather than covering it. **D3 converts six stages, not five.** Found by another session reviewing the
production ingest failure; the plan had no mechanism that would have caught it, which is the more
useful half of the finding.

#### What D1b's tests found — [tests/store-pg-session.test.ts](../../tests/store-pg-session.test.ts)

Ten cases, and every one of them watched red with the guard it targets mutated. Three findings came
out of doing that rather than out of reading the code.

**A refusal that never touched the database was reported as a database failure.** The session's
returned object goes through `guardDbStore`, as the review asked — and that wrapper replaces every
error not on its allowlist. So `checkProduct`'s *"arc returned a product missing arc, so nothing was
written"*, which is refused **before** the transaction opens, came out as *"this app asked its
database for something it would not do"*, and the guard logged `database call failed` for a call
nobody made. Measured by asking a guarded session for the message, 2026-08-30. It is exactly the case
`CheckpointRequestError` is on that allowlist for, so `checkProduct` now throws a closed
`ProductRefused` (in [`src/store/artifacts.ts`](../../src/store/artifacts.ts), not beside
`checkProduct`, because `db-errors.ts` importing `session.ts` closes a cycle the gate catches —
checked by trying it) and that class is the allowlist's sixth entry.

**Deleting the article lock from `commit` reddened nothing.** All eight of the owed tests stayed
green with `lockArticleFor` gone, which is the honest state of a lock-order guarantee under
single-threaded tests. A tenth case now holds the article row `for update` from a second connection
and asserts that a **non-publishing** commit does not settle while it is held — the case that has no
other use for the lock. Whether the lock is taken *before* the artefact fence or after it is still
not testable from outside: an uncommitted write is invisible to every other connection, so the draft
reads unchanged either way.

**Three of the fences are redundant with each other, and that is worth knowing before anyone removes
one.** A stale claim between `beginStep` and `commit` is refused by `requireLiveJobOwnsDraft` inside
`writeArtefacts`, again inside `finishStepRun`, and again by `fence()` in the job transition —
removing any one of them leaves the test green. Same for the skip check: `stepInterrupted` and
`hasArtefacts`'s `run?.status !== 'done'` both refuse an interrupted step, and only removing both
makes the next claim skip it. The mutations that redden are recorded in the test file's header.

**And one mutation could not be run at all.** Publishing in a transaction of its own — the shape the
review rejected — does not fail, it **hangs**: the outer transaction holds the article row and the
job row, and the inner one waits for them on another connection, which Postgres's deadlock detector
cannot see because one side of the wait is an `await` rather than a lock. That is a stronger argument
for one transaction than the test that replaced it.

#### What D1b's code review changed — [delete-the-importer-d1b-sol.md](delete-the-importer-d1b-sol.md)

**NO-SHIP, the sixth in a row on this plan, and the core survived it.** *"`commit` locks the article
first, then performs the artefact fence/write, postcondition, step completion, publication/failure,
and job transition through the same `tx`. `settleJob` also locks article before job. Re-locking
inside publication/failure does not invert the order. Logging occurs only after the transaction
resolves."* Publishing on the all-skipped path was confirmed as *"the correct simple rule"* — it
preserves work an earlier request committed, and no case was found where it loses or corrupts data.
`guardDbStore` was confirmed to preserve the generic signatures and to scrub the free helpers'
rejections, because they happen inside wrapped session methods.

What did not survive was the edges.

**Terminal drafts still leaked, and the design had closed only the doors it walked through.**
`failExpired` and a queued `requestCancel` both make a job terminal without clearing
`draftRevisionId` ([`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts)), and the sweeper spares
pointers belonging to every job including dead ones. Both are reachable after a step has released. The
session cleared the pointer on every path that went through the session — which is exactly the shape
of mistake this plan keeps making: a guarantee established where the new code runs, and absent where
the old code ends the same job.

**A failed stage left its step run saying `running` for ever.** `settleIn` failed the revision and the
job and never marked the begun step `error`, though `finishStepRun(… status: "error")` already
existed. `interrupted` reads exactly that status, so the next claim over the draft would refuse to
believe the step had ended. The fix has an ordering constraint worth keeping: it must come **before**
the draft failure and the job finish, because `finishStepRun` fences on the job still being `running`
and still pointing at this revision, and either of the other two makes that false.

**The rollback test could pass on the wrong exception.** A bare `rejects.toThrow()` accepts a failure
thrown anywhere before `finishIn`, so an early write or validation error would leave every
"rolled back" assertion trivially true. It now requires the scrubbed failure including SQLSTATE
`23502` — which, as the review points out, also proves errors from the free `finishIn` helper travel
through the session's guard. **The author had already named this shape** as a `rejects` lid in their
own report, and I read it as an acceptable limitation rather than a defect. It was a defect.

**`discardAfterCancel`'s comment asserted something false.** The unfenced pointer clear is sound on
the commit path, where `writeArtefacts` has already proved job, attempt, status and draft ownership
and the row stays locked through `releaseStepIn`. But `settleJob` accepted **any** transition
including `release`, without that earlier fence, and `releaseStepIn` checks job, attempt and status —
not the draft pointer. `settleJob` is narrowed to `end` transitions, which is what every caller
already passed, and the conditional clear throws rather than warns when it touches other than one row.

**And two tests were the shapes this repo keeps writing down.** The lock test used a one-second sleep,
which a merely slow unlocked commit would pass; it now uses `pg_blocking_pids`, as the draft-lock
suite already did. The all-skipped test published a **byte-for-byte copy** — so discarding would have
produced the same reader-visible result, and the test proved publication was *called* rather than that
it was *right*. It now runs the real two-request case: the first request writes and releases, the
second finds every step current, and the first request's work has to become visible.

#### What D0's code review found — [delete-the-importer-d0-sol.md](delete-the-importer-d0-sol.md)

**NO-SHIP, and the finding was that the test proving the fix could not fail.** The stamp conversion
itself checked out in full — `stampOf` maps the three fields exactly, `stepIsDone` asks `has` before
the stamp so an absent or malformed artefact is covered, both generators hash the same parsed block
document `inputHashFor` reads, and nothing in `FORCE_ONLY_WHEN_NAMED` or the force-cascade changed.

The deploy-gate regression test was the problem, and it is the third time today the same shape has
turned up. It derived its expected value from `GATE_FIXTURES` itself — an expectation computed from
the list under test agrees with **any** list — and its fake `has()` matched exact strings only, so
the constructed state left out the bare `"data"` and `"output"` entries. Against the old list both
sides came out as `["data", "output"]` and the test passed on the bug it was written for. A throwaway
script had demonstrated the fix; the permanent test had not.

Fixed by putting `"data"` and `"output"` **into** the surviving state — which is what actually
survives, and is the whole point — and spelling the twelve expected paths out. Proved from outside
the test: against the old list the state reports `missing: []`, so the assertion goes red; against the
new list it reports exactly the twelve.

**And one correction to what D0 flagged as deferred: `tweets` reads `meta.json` too**, not only
`summary`. Both stages also read the tree. Still a pre-existing hole rather than a D0 regression, but
it widens what D3's canonical fingerprint has to cover — blocks, tree, the metadata each stage
actually uses, and an explicit answer on the profile.

The review's second finding — that the stale references ran wider than the three comments reported —
was already half discharged: `docs/project/ingest-queue.md`, `docs/project/testing.md` and
`docs/project/summaries.md` were swept in this stage. `src/web/SummaryPanel.tsx` and the comments
inside `src/summarise.ts` wait for the follow-up, because a peer is live in both.

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
15. **`blocks`, `glossary` and `ideas` keep their ids on a *second* run against unchanged text**,
    through the Postgres path — and **no existing item can stand in for this one.** The closest,
    [transactional-stage-runner.md](transactional-stage-runner.md) item 8, runs the pipeline with
    `data/<slug>/` deliberately empty and proves it completes. But a **fresh** ingest mints every id
    by design, so that test cannot tell "carries ids correctly" from "silently re-mints every time".
    It never runs a stage twice against the same article, which is the only place the difference
    shows. Watched red by dropping the baseline.
16. **A failed baseline read fails the stage**, rather than minting. The stage cannot tell an
    infrastructure fault from a first ingest today, and the two must not share a branch — § Three
    stages carry identity in a file.

**And one thing that will not appear as a failure at all.** After D, `StepContext` loses `dir` and
`htmlFile` ([transactional-stage-runner.md](transactional-stage-runner.md)), so the code that reads
the previous blocks cannot compile and somebody is *forced* to touch it. That is the one piece of
luck here. But `splitIntoBlocks(html, previous?: Block[])` takes its baseline as **optional**, so a
conversion that reads the HTML from the store and calls it with one argument compiles cleanly, runs
green, and re-mints everything. The forced edit guarantees somebody looks at the line. It does not
guarantee they get it right, and nothing downstream would say so.

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
