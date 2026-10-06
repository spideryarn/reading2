# Review: stage 1 of 261005l — an arXiv link of any shape imports the paper (the resolver, its three callers, a queue hand-back)

Repo: this worktree, branch `worktree-fbayettj-arxiv-import`. TypeScript + ESM, strict.

## The candidate

Committed: commit `0f63486a2`.
`git show --stat 0f63486a2` prints the complete list of changed paths; `git show 0f63486a2 -- src`
the source diff.

Start with `src/paper-sources.ts`, `src/pipeline.ts` (`fetchFirstCandidate`, the `fetch` step, the
`extract` step's `url`), `src/jobs.ts` (`enqueue`: `handBackTheSameWork` and the block that reads
an adopted holder) and `src/ingest.ts` (`urlKey`, `slugFromUrl`). That is where to begin, not the
limit of scope.

**Out of scope, and not part of the candidate:** the working tree also holds uncommitted edits by
another agent, mid-work, in `src/extract.ts`, `src/latexml.ts`, `src/maths-import.ts`,
`src/meta-authors.ts`, `src/protect.ts`, `tests/latexml.test.ts`, `tests/extract-protect*.test.ts`,
`tests/maths-import.test.ts`, `tests/table-oracle.test.ts`, `tests/fixtures/latexml/`. They are the
next stage. Read the committed versions (`git show 0f63486a2:<path>`) where it matters, and do not
report on them.

## What it is meant to do

The plan is `docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md`:
§ Design, § "Stage: the resolver and its three callers, arXiv as PDF only" (including "What landed,
and what changed from the plan"), and § Reviews, which has your two plan reviews and what was done
about each finding.

The contract, in short:

1. `resolvePaperSource(url)` recognises arXiv links of every shape listed in the plan's § Goal, and
   nothing else. It matches an origin (no port, no credentials). Today arXiv has one candidate, the
   PDF.
2. `urlKey` and `slugFromUrl` answer with the source's key and slug for such an address, and are
   byte-for-byte unchanged for every other address. `normaliseUrl` is unchanged.
3. The `fetch` step calls `fetchDocument` exactly as before, once per candidate; moves to the next
   candidate only on a 404/410 or a document of the wrong kind or without its marker, and never
   after the job's signal has fired; a last candidate of the wrong kind stores nothing and fails.
   **No defence in `src/fetch.ts` or anywhere in `docs/project/security-map.md` § Where the
   defences physically live is edited.**
4. The `extract` step resolves relative links against the manifest's final URL.
5. **Your F11 (P0), whose fix you have not seen.** A job queued by the previous build from an
   arXiv `pdf/` or `html/` address keeps that build's `url_key` and `work_key`. After this deploy a
   paste of the `abs/` address must be handed that job, not inserted as a second charged job. The
   fix is in `enqueue`: when the allocation adopted an active job's slug from the queue, the holder
   is read and compared with `sameWork` (which compares addresses by today's `urlKey`), and handed
   back before the insert. `sourceAddress` and the unresolved in-flight comparison from the earlier
   revision are withdrawn, which is what your F12 rested on.

## What you can and cannot run, and what you may change

**The tree is read-only for this run** (another agent is editing it; a second writer would
collide). Report fixes as exact code. `/tmp` and the node_modules caches are writable. You can run
one test file at a time and scripts under `/tmp`. You have no network, not even loopback, so the
Postgres tests will not run for you. I ran them; the raw output of the deploy-window test is
`docs/plans/261005l-evidence/postgres-deploy-window-test.txt`, and the test is
`tests/a-paper-queued-before-the-resolver.test.ts`. The loop's run against live arXiv is
`docs/plans/261005l-evidence/fetch-step-live-pdf-only.txt`.

Tests you can run: `tests/paper-sources.test.ts`, `tests/ingest.test.ts`,
`tests/fetch-candidates.test.ts`, `tests/extract-resolves-against-the-final-url.test.ts`,
`tests/eager-client-graph.test.ts`, `tests/cited-in-spideryarn.test.ts`, `tests/paper-text.test.ts`
(the uncommitted `src/extract.ts` may affect the extract one; say so if it does).

## Attack it

Independently, before you read my questions at the end.

- **F11 first.** Is this statement accurate: *"after this commit, no sequence of one reader's
  requests for one arXiv paper, at the deploy or after it, ends with two active ingest jobs for it
  or two slots charged, except the one the plan names (two pre-deploy jobs already active on one
  unpublished article)"*? Trace `enqueue` end to end, including the `sourceTaken` and `nameTaken`
  repairs re-entering the loop, `slugForRetry`, `handBackToARetry`, the reservation
  (`withIngestSlot` in `src/billing/admission.ts`, `ingestEventId` on the ticket) and the status
  check on the holder. Does the hand-back return a job to a caller who should not get it (another
  owner's, a cancelling one, one with a different upload, profile, reset or step plan)? Does the
  test seed what the old build really wrote?
- The resolver: a link shape that resolves wrongly, a non-arXiv address captured, two different
  texts given one key, a slug that fails `isSlug` or collides across papers.
- The fetch loop: a failure the reader should see that is swallowed, a second request made when it
  should not be, a document stored that should not be, an address reaching a log or a stored
  failure, any change to what a non-source address does.
- The extract base: an article for which `manifest.url ?? requireUrl(ctx)` is a worse answer than
  before.
- Every other caller of `urlKey` and `slugFromUrl` (find them): does the new answer break one?
- The docs changed in this commit (`fetching.md`, `ingest-queue.md`, `architecture.md`): is each
  new sentence true of the code?

For each finding give:
  - an ID continuing the chain (**start at F14**), a severity (P0/P1/P2/P3), established or reasoned
  - (a) the input or mutation that shows it, or the exact reachable path
  - (b) the smallest change that closes it, as a code block or exact wording
A finding with no (a) goes last.

Severity, by consequence: **P0** data loss, exploitable security, incorrect charging, or the
service broadly unusable. **P1** user-visible wrong behaviour, or an authoritative contract
violated. **P2** design or maintainability risk with no wrong behaviour today. **P3**
non-behavioural prose or comment defect.

Refuse only on an established P0 or P1, and name what established it. End with one line:
`VERDICT: ship it` / `VERDICT: ship it after fixing <IDs>` / `VERDICT: do not ship`.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- The hand-back reads the holder with `store.get(allocation.holder, owner)` and checks `queued` or
  `running`; I have not checked what a `cancelling` holder looks like through that read.
- `saysItIsNotThere` treats any `FetchFailure` with status 404 or 410 as absence, including one
  raised mid-redirect to another host.
- `urlKey` now ignores the whole query of an arXiv address, not only tracking parameters.
- A wrong-kind last candidate fails as `[fetch-incomplete]` with Retry; whether that is the truest
  existing sentence.

Do not change any file.
