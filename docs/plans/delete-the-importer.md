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

Ten commits. **C2 is done and reviewed; C1 was built and withdrawn.** Four of the ten were live bugs
found on the way, which is the pattern worth noticing: **every one came out of reading code near
something else**, not out of the work item that was planned.

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

**Done:** C2. **Withdrawn:** C1, and its absence now shapes C4.
**Not started:** C3 through C7, then B3, D, the demolition, E — in that order. B2's remnant has grown
and lives inside C6.

**One thing has moved earlier.** The re-ingest of the corpus was going to happen at the demolition.
It has to happen **before C7** instead: all seven checked-in manifests predate `storedSha256`, so
C6's refusal breaks every fixture that has not been re-fetched.

**Nothing is at risk from the re-ingest.** All three eval PDFs are tracked in git and both upload
fixtures are the same file as `evals/pdf/easy`. § What it does not delete has the table.

## What this has taught us, so far

Written down because four of these are the same shape, and the fifth is the one that keeps this
project honest.

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
| `constitution`, `example`, `noema-mythology-of-conscious-ai` | no `raw.json` at all | nothing to lose |

Greg offered the `much-harder` PDF as the one file he still had. All three are in the repository, so
the re-ingest is three local paths and two URLs.

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

**C3. The kind ↔ storage map, and the read half.** `src/store/artifacts-pg.ts` with `read` and
`stampFor` only, over a `JobDraftRef` and a mandatory `Db | Tx`.

**Its oracle is explicit mapping fixtures, not importer-written rows** — the first draft had that
wrong. Agreeing with the importer would prove importer-plus-adapter behaviour, and the importer is
known to store `extractedHtml: null`, to stamp every inferred step with the same fingerprint where
`ideas` uses blocks-plus-tree, and to hold no source reference. Importer rows stay as separate
legacy-compatibility cases, which is a different and smaller claim.

`stampFor` merges the run row with the artefact's own fields, preserving `profileHash: null` as the
real value it is.

**C4. `has`, and the `toc` case C1 was supposed to remove.** Separately from C3 because its
definition is the one Sol rewrote: every requested value
reconstructs and passes the same shallow shape checks the filesystem decoder applies, **and** a
`revision_step_runs` row exists with `status = 'done'`. No comparison against today's expected stamp.

**And it carries an explicit `toc` case, said out loud.** C1 would have removed the need for one;
C1 is withdrawn, so `toc` still has no stamp and `has` cannot answer "is this tree current" the way
it does for every other step. The rule is therefore: for `toc`, the stored run row's `input_hash`
must match the stored block rows. That is a documented difference from the filesystem adapter, and a
documented difference beats a false parity claim — this document has now produced three of those.

*Red first, with the case corrected.* The first draft kept a test from an earlier definition and it
contradicts this one: `beginDraftIn` carries block rows **and** a done `toc` run, so under
presence-and-completion `has(slug, "toc", ["blocks"])` is **true**, and it is `stepIsDone` that
answers no once C1's stamp is compared. Assert exactly that pair — `has` true, `stepIsDone` false —
which is also what keeps freshness out of storage. Watched red by deleting the `status = 'done'`
requirement over a revision whose run errored.

**C5. `write`.** The whole atomic set in one statement per destination: the revision row's columns,
then blocks as identities-upsert → unconditional delete → insert-if-any. Delete-all on empty is the
decision, and it gets its own test.

*Red first:* start with carried blocks, write `{ blocks: [] }`, assert zero rows — then force the
job fence to fail and assert the delete rolled back.

**C6. `raw`, the manifest's missing number, and the columns.** Bigger than the first draft said,
because B2 is not "mostly built":

1. **`RawManifest` gains a stored byte count.** `bytes` is the length of what the network sent;
   `raw_sources.bytes` describes the object at the *stored* hash, and for any non-UTF-8 page those
   differ for exactly the reason the two hashes do. `writeRaw` already computes `storedBytes` and
   records only its hash.
2. **`raw_filename` on `article_revisions`**, classified `carry` in `REVISION_COLUMN_POLICY` — the
   exhaustive check throws at module load otherwise, which is the schema forcing the decision.
3. **The `raw_sources` row and the reference pair**, written for the first time by anything.
4. **The refusal**: a manifest with no `storedSha256` is refused rather than written as a null
   reference beside a done `fetch`.

**And the refusal has a scheduling consequence.** All seven checked-in manifests predate
`storedSha256`, so turning it on breaks every fixture that has not been re-fetched. The re-ingest
therefore happens **before C7**, not at the demolition.

The migration itself is the small part: a nullable `ADD COLUMN` that does not interact with the
existing CHECK or composite FK. Generated in one sitting with `src/db/schema.ts` otherwise clean, the
diff read line by line, `tests/db-schema.test.ts` updated in the same commit.

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
7. **The importer refuses an article carrying a reference**, from the commit D lands in.
8. **The adapter refuses a manifest with no `storedSha256`** rather than writing a null reference.
9. **Block identities outlive the revision that dropped them**, through the production path.
10. **`db:export` refuses to run against Postgres without matching blob credentials.**
11. **A retry does not buy a checkpoint twice**, on a different store instance.

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
- [transactional-stage-runner.md](transactional-stage-runner.md) — the landings this re-sequences
- [raw-bytes-in-storage.md](raw-bytes-in-storage.md) — where `storeRawSource`, `raw_sources` and the
  project-pair check come from, and whose backfill this deletes
- [raw-bytes-in-storage-input-3-sol.md](raw-bytes-in-storage-input-3-sol.md) — the round that found
  the publication gate written but not built
- [durable-queue-and-uploads.md](durable-queue-and-uploads.md) · [postgres-migration.md](postgres-migration.md)
- [../project/database.md](../project/database.md) · [../project/block-ids.md](../project/block-ids.md) ·
  [../reusable/silent-success.md](../reusable/silent-success.md)
