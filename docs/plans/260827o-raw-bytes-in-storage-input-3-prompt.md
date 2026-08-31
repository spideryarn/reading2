# Input, not a full review: does "never delete" delete the protocol?

You have reviewed `docs/plans/260827o-raw-bytes-in-storage.md` twice, both NO-SHIP, both times on the
protocol rather than the direction. The owner has now answered the open question that the protocol
was built around, and the answer changes its shape rather than its details. This is a request for
**input on the reduced design before it is built**, not a verdict on a finished draft.

Read-only. Be adversarial: I am looking for the sequence where the simplification is wrong, not
reassurance that it is simpler.

## What the owner decided

Asked for an erasure deadline — how long after its last reference an object may live — Greg's answer
was:

> Maybe keep them indefinitely (at least for now)?

So: **no deletion at all, for now.** No sweeper, no retention deadline, no erasure path. That is an
explicit product decision by the person who owns the consequence, not an oversight, and it is
reversible later by building the thing we are now not building.

He also handed me two of your other findings to settle by judgement — the signed-URL window and
telling "we never had the bytes" from "we lost them". My answers are below; attack those too.

## The claim

**With no deletion, there is no acquisition state machine.** Every critical you raised across both
reviews was about deletion, or about ordering that only matters because deletion exists:

| your finding | why it may no longer apply |
|---|---|
| review 1 #1 — the sweeper deletes an object immediately before its reference commits | there is no sweeper |
| review 2 #1 — `deleting` has no safe completion or recovery | there is no `deleting` |
| review 2 #2 — object creation has no row-creation protocol; a crash leaks an object no row can find | the "leak" is now the retention policy. An object with no row is a **kept** object |
| review 2 #4 — a reference may name a row in `deleting` | there is no such state |

So the whole of `raw_sources`'s `state`, `claimed_by`, `claimed_at` and `retire_after` would go, and
the reduced protocol is two steps:

1. **Put the object.** `putIfAbsent(canonicalKey(sha, kind), bytes, contentType)`, outside any
   transaction. Idempotent by construction — the key is the hash of the contents — and permanent.
2. **One transaction**: upsert the `raw_sources` row (`on conflict (sha256, kind) do nothing`), write
   the revision's reference to it, write the artefacts, write the step run, and transition the job.
   This is the same single fenced commit `docs/plans/260827j-transactional-stage-runner.md` already requires.

Failure cases, as I see them:

- Crash between 1 and 2: the object is kept, nothing references it, the retry re-uploads (getting
  `already-there`) and commits. Self-healing, and the orphan is policy rather than a leak.
- Two acquirers of the same document: both write identical bytes to the same name, both upsert, one
  wins the insert and the other's `do nothing` is correct. No lock needed because there is nothing to
  disagree about.
- Crash after 2: consistent.

`raw_sources` therefore keeps only `sha256`, `kind`, `bytes`, `content_type`, `verified_at`,
`created_at` — a record of what we believe is in the bucket, with no lifecycle.

**What I want from you: the sequence where this is false.** Especially — is there a case where a
committed revision references a `raw_sources` row whose object is not in the bucket, that does *not*
require somebody to have deleted something? And does removing the row's lifecycle break anything that
was relying on it for a reason other than deletion?

## The two judgement calls

**A. The signed-URL window: 60 seconds, and the ownership check stays where it is.**
`sendSource` checks `shelfStore.read(slug)` and then serves the bytes, so check and delivery are one
act; a redirect splits them and the URL is forwardable until it expires. My reasoning: the redirect
is followed by the browser immediately, so the window only has to cover one hop — 60s, not the upload
grant's two hours, which was chosen for a human picking a file out of a dialog. The ownership check
stays *before* minting, so an unauthorised caller never receives a URL at all.

Attack: is 60s actually enough for a real client (slow mobile, a proxy, a resumed download, Range
requests)? Does Supabase's signed URL support single-use or any narrowing beyond TTL? Is there a
reason to keep proxying small documents through the function and only redirect large ones?

**B. "Never had it" versus "lost it": a publication rule, not a new column.**
Your finding was that a legacy import with no source and a fresh revision whose acquisition failed
both end as the same null reference. My answer: `publishRevision` already refuses revisions on
structural grounds, and it can refuse this one — **a revision whose `fetch` step has a run recorded
in `revision_step_runs` must have a raw source reference.** A legacy import has no `fetch` step run,
so it publishes with a null reference, correctly. No new column; the distinction is already in data
we keep.

Attack: does `revision_step_runs` actually carry what this needs, given `fetch` can be skipped as
already-done, and given carry-forward copies a reference from a previous revision? Is there a path
where a fresh revision inherits a reference it did not acquire and the rule passes vacuously? And
what about the third case you found — a database restored to before an object's deletion, where the
row says the object is there and the bucket disagrees — which, note, **can no longer arise from our
own deletion**, only from somebody operating the bucket by hand.

## Read

1. `docs/plans/260827o-raw-bytes-in-storage.md` — the third draft, whose deletion protocol is what is being
   removed.
2. `docs/plans/260827o-raw-bytes-in-storage-review-2-sol.md` — your own second review.
3. `src/store/blobs.ts`, `src/source.ts` — `putIfAbsent`, `canonicalKey`, the existing seam.
4. `src/store/pg-revisions.ts` — `publishRevision`, the `CARRY` table, `beginDraftIn`.
5. `src/db/schema.ts` — `article_revisions`, `revision_step_runs`.
6. `src/pipeline.ts` — `acquireUpload`, and the `fetch`/`extract` steps.

Answer as numbered points with severity and confidence, and say plainly whether the reduced design is
safe to build. Markdown links must be repo-relative or plain code spans — absolute paths and
root-relative paths both break `tests/doc-links.test.ts`, which has now caught three of your reviews.
