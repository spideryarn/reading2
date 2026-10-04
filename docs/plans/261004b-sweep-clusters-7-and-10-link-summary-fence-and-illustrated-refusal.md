# Sweep clusters 7 and 10: a fence on the link-summary cache, and Illustrated's refusal sentence

Two Tier 0 clusters from the
[fifth codebase sweep](261003f-fifth-codebase-sweep-umbrella.md) (§ The clusters, rows 7 and 10).
Their files are disjoint, so each is its own commit. Evidence: XZ-X10 in
[the cross-zone doc](../investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md)
and [Sol's review of it](../investigations/261003b-fifth-sweep-review-sol-on-knowledge-and-cross-zone.md);
DP-D2 in [the data-and-pipeline doc](../investigations/261003b-fifth-sweep-data-and-pipeline.md) and
[Opus's review of it](../investigations/261003b-fifth-sweep-review-opus-on-data-and-pipeline.md).

Both were re-checked against the tree on 2026-10-04 (`6ead5c4de`) and are still live.

## Cluster 7 — link summaries survive a profile change

### What is wrong

A link's hover card carries a short model-written summary of how the destination stands to the
passage. It is written from the reader's profile ("about you") and purpose ("why you're reading
this one"), and cached per tab in `summaryCache` in `src/web/link-facts.ts`, in front of the
server. `forgetSummaries()` empties that cache when either is saved. Three holes:

1. **The keepalive saves do not call it.** `leaveProfile` (`useProfile.ts`) and `leavePurpose`
   (`purpose.ts`) are the saves `useAutosavedText` fires on `pagehide` and, since 2026-10-02, on
   **unmount** — a box inside a mode band that the Dock or an article change removes while the page
   stays open. So: edit the description, switch mode, hover a link hovered before, and the card
   shows the summary written for the old profile. `pagehide` is not safe to ignore either, because
   a back-forward-cache restore brings the page back with the module cache intact.
2. **A stream already in flight refills the cache after it was cleared**, on ordinary saves too.
   `forgetSummaries()` clears finished entries only; a `loadSummary` begun before it writes
   `summaryCache.set(key, …)` when it ends. Reproduced by Sol.
3. **The same stream's partial text and its `summaryPending` entry survive the clear**, so a card
   re-hovered straight after the save joins the old stream and shows old words arriving.

### The fix

A generation counter in `link-facts.ts`, and nothing wider:

- `let summaryGeneration = 0`. `forgetSummaries()` bumps it and clears `summaryCache`,
  `summaryPartial` and `summaryPending`, then wakes the watchers.
- `loadSummary` captures the generation when it starts. Every write it makes — each partial, the
  finished answer, the three "cached as nothing" branches, and the `finally` clean-up — happens
  only while its generation is still current. A stale stream stops reading at the next frame
  (`break` out of `readEvents`, which releases the reader) and leaves the maps alone; in
  particular its `finally` must not delete the `summaryPending` entry a newer run now owns.
- `leaveProfile` and `leavePurpose` call `forgetSummaries()` when they send **and again when the
  request settles**. The second is the one that matters: a summary asked for between the send and
  the server storing the write is written from the old profile, and the settle-time bump fences
  it. (`saveProfile` and `savePurpose` already call it after the response, which is the same
  moment.)
- For that, `leavingFetch` (`src/web/lib/api.ts`) returns a promise that settles when the request
  does and never rejects, where it returned `void`. Its other two callers ignore the result.
  **This file is outside the cluster's listed set**; no other cluster in the umbrella names it, and
  the change is one return type. The alternative that stays inside the set — forget on send only —
  leaves the window above open, which is the same "two-line patch" Sol rejected.

`useAutosavedText.ts` is in the cluster's file list and needs no edit: it already calls `leave`
at the right moments, and ordering after an in-flight save is its job and it does it.

### The simpler option passed over

Call `forgetSummaries()` in the two `leave*` functions and stop. That closes hole 1 on most days
and leaves 2 and 3, which Sol reproduced on the ordinary save path.

### Not doing

- Aborting the stale request with an `AbortController`. The model call is the server's and is
  already paid for; breaking out of the read loop is enough for the client.
- Keying the cache on a profile hash. The client does not know the server's four fingerprints, and
  one counter says "everything before this is stale", which is all that is true.
- A selective clear by article. The global half of a profile is true of every article
  (`forgetSummaries`' own header says so).

### Tests, red first

`tests/link-summary-forget.test.tsx` (jsdom, `useLinkFacts` mounted with `lib/api.js` posed, the
harness `tests/no-block-no-summary.test.tsx` uses), with a summary stream the test holds open:

1. a stream that finishes **after** `forgetSummaries()` does not fill the cache: the next hover
   asks the server again and shows the new answer, never the old one;
2. after `forgetSummaries()` mid-stream the card shows no partial text, and a re-hover starts a
   **new** request instead of joining the old stream; the old stream ending later does not remove
   the new run's partial text or its pending entry;
3. `leaveProfile` and `leavePurpose` forget on send and again on settle (asserted through the
   cache's behaviour, not a spy on the function).

## Cluster 10 — Illustrated loses the refusal sentence

### What is wrong

`src/illustrated.ts` throws `new Error(MODEL_REFUSED.message)` when the provider refuses the brief.
Every sibling throws `stageFailure(MODEL_REFUSED, { authored: … })`, which declares the reader's
sentence. The plain error still carries the bracketed code, so `failureKindOf` reads `blocked` and
Retry stays off — but `readerFailureOf` finds no declared sentence and stores the generic "could
not be done for this article". `noteUndeclaredBlocked` warns in the log each time. Two comments in
`src/job-failure.ts` say "the ten `MODEL_REFUSED` throw sites" go through `stageFailure`; there are
eighteen and one does not.

### The fix

- The throw becomes `stageFailure(MODEL_REFUSED, { authored: "the model answered with stop_reason:
  refusal" })`, Sketch's wording.
- The two comments stop carrying a count, and name the test that makes the claim true.
- A source test: no `new Error(MODEL_REFUSED.message)` anywhere under `src/`, so the nineteenth
  site cannot be written the old way unnoticed.

### Tests, red first

- `tests/illustrated-run.test.ts`: make the posed `wasRefused` answer true for one case, drive
  `generateIllustrated`, and assert on the thrown error what the job would store:
  `readerFailureOf(err, "illustrated")` is `MODEL_REFUSED` itself, `failureKindOf(err)` is
  `blocked`, and `undeclaredBlocked` is false.
- The source test above, in the same file as the other refusal source checks
  (`tests/stop-details.test.ts` § the source itself).

## Stages

1. Cluster 10: red tests, fix, comments. Commit.
2. Cluster 7: red tests, fence, the two `leave*` calls. Commit.
3. GPT Sol reviews the code of both; fixes; gates; push; umbrella rows updated.

## Log

- 2026-10-04 — plan written; sent to GPT Sol.
- 2026-10-04 — **Sol's plan review: build as written**, no P0 or P1, four P2s, all taken.
  - PL-1: say the guarantee exactly. It is **no stale summary survives the save settling** — not
    "none is ever shown". Between a keepalive write leaving and landing, a hover can still be
    answered from the old profile and shown; the settle-time forget then throws it away. Closing
    that too would mean withholding summaries while a write is out, which is not worth it. And a
    request that fails in transport has settled without proving the server stored anything.
  - PL-2: the fence is tested on the three "remember nothing" endings as well (`unavailable`, a
    stream that just stops, a broken connection), each proved red by removing its guard.
  - PL-3: `leavingFetch`'s own contract is tested in `tests/api-fetch.test.ts` — settles when the
    request does and not before; resolves on a transport failure and on both refusals to send.
    Two test doubles that posed it as returning nothing (`profile-panel`, `purpose-prompt`) now
    return a promise.
  - PL-4: the source test is about the name, not one spelling: outside `messages.ts` and imports,
    every mention of `MODEL_REFUSED` is the first argument of an `authored` `stageFailure`. It is
    checked against six snippets first, four of them wrong forms.
- 2026-10-04 — **Sol's code review: land after fixes**, and it made them. Nothing left open.
  - CR-1 (P1): a card that was **open** when a save landed lost its summary and did not ask for
    another, because the hook's effect did not re-run. `useLinkFacts` now reads the generation
    during render and lists it as a dependency. The cost, accepted: a card left open across a
    keepalive save asks twice, once at the send and once at the settle.
  - CR-2 (P1), CR-3 (P2): the source test's import-stripping regex could swallow code between a
    side-effect import and the next named one, and an aliased import hid a stray use. Both fixed,
    each with a snippet that failed first.
- 2026-10-04 — landed: cluster 10 `5ae9316e7`, cluster 7 `bddf8c0c8`. `npm run typecheck` clean;
  `npm test` 32,464 passed and 4 failed in 5 files, all of them the fresh-worktree "no build yet"
  set (`cold-start-lazy-imports`, `pdf-bundle-trace`, `fleet-composed-access`,
  `fleet-decisions-route`, `fleet-reports-route`), none touching this work.
