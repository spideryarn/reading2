# Four store and route correctness fixes from the Overseer's queue

Four small items the fifth sweep found and left "found, not fixed", queued by the Overseer and
released by Greg on 2026-10-04 (*"If you're confident, address all of the Q-queue-yeses"*). Their
evidence is in [261004b](261004b-sweep-clusters-9-15-16-21-frozen-control-lock-tests-script-fixes-freshness-agreement.md)
§ Found, not fixed, and [261004d](261004d-fifth-sweep-cluster-6b-store-contracts-require-the-attempt-and-markers-outlive-finish.md)
§ Not here and § Code review.

Up: [plans.md](../project/plans.md).

None of this changes what a reader sees on an ordinary day. Each is a place where two parts of the
server can give different answers about the same thing. No migration.

Base: `8646b09ad`. One commit per item. Three builders in parallel on disjoint files (A; B; C then
D, which share `src/routes.ts`), each red first and mutated afterwards; then one GPT Sol code review.

## A — `qi-paam4re2`: the Metadata page and the queue disagree about `blocks`

**What is wrong.** Two functions decide whether a pipeline step is up to date. The queue asks
`stepIsDone` (`src/pipeline.ts`), and for stage 3 (`blocks`) that runs `blocksMatchTheirHtml`: cut
stage 2's HTML into blocks again and check the result is what is stored. The Metadata page asks
`isCurrent` (`src/store/pg.ts` § `articleMetadata`), a `switch` with no `blocks` case, so it lands
on `default: true`. When stage 2's HTML has moved, the queue says *not done* and the page says
*current*. `tests/freshness-deciders-agree.test.ts` pins that pair as a known disagreement.

**The fix.** One decider, called from both places, so they agree by construction:

- Pull the body of `blocksMatchTheirHtml` out into a pure exported function (in `src/blocks.ts`,
  beside `splitIntoBlocks` and `canonicalBlock`, or wherever avoids an import cycle): given the
  extracted HTML, the stamped HTML and the stored blocks, answer yes or no. The pipeline function
  becomes three reads and one call.
- `isCurrent` gets `case "blocks"`, which calls it. The `default` arm's comment stops naming
  `blocks`.
- `tests/store-revision-columns.test.ts` § "has a case for every stamped step" widens to every
  step with a `stamp` **or** an `isDone`. Red first: widen it before the arm exists.
- `tests/freshness-deciders-agree.test.ts`: the `blocks:extractedHtml` entry leaves
  `DISAGREEMENTS`, and the case asserts both say *not done*. Red first against today's code.
- `docs/project/` wherever it says `blocks` has no currency rule; the long comment above
  `articleMetadata` says so too and is corrected.

**The cost, named.** The Metadata read deliberately does not select `extracted_html` or
`stamped_html` (the whole article, twice), and a test holds every projection but one to that. The
new arm needs both, plus one jsdom re-split, per Metadata page load. They are read in a **second,
narrow query of those two columns**, made only when the `blocks` run row says `done`, so the
`metadata` projection and its test stay as they are. `articleMetadata` has two callers: the
Metadata page (`GET …/metadata`, opened on purpose, by few) and a feedback report. Neither is a
hot path.

*Passed over: record a hash of stage 2's HTML on the `blocks` run row and compare that.* A cheaper
read, but it is a second, weaker decider (a hash of the input, not a replay of the stage), it needs
a column or a stamp and a backfill for every existing row, and the queue would still ask the
replay — so the two could disagree again. If the Metadata page ever shows up as slow, this is the
optimisation.

*Not here:* `structure` disagrees the other way (queue *done*, page *not current*), known since
2026-08-27 and deliberate. It stays pinned.

## B — `qi-g25rz5tc`: the visibility race test passes without the lock it names

**What is wrong.** `pgVisibilityStore.set` (`src/store/pg-visibility.ts`) takes the owner's
`billing_accounts` lock, then the article row `for update`. The race test in
`tests/public-visibility-pg.test.ts` fires two publishes by one owner and expects one log row; it
stays green with the article lock deleted, because the billing lock has already put the two in a
queue. The test's comment and the file's header both credit the article lock.

**The decision rule.** Only the owner can change an article's visibility (`ownedSlug`), so every
pair of `set` calls on one article shares one billing lock. The article lock can therefore only
matter against a **different** writer of the same `articles` row that does not hold that billing
lock. The builder lists every writer of `articles.visibility`, `articles.public_at` and
`articles.processing` (the *Read this* transition, which `set` reads under the lock to refuse
sharing a minimal paper), and which locks each takes.

- **If one exists** (expected: the `processing` transition, or a delete): the lock stays, and the
  test becomes that race, shown red with `.for("update")` deleted and blocked-by-the-holder
  (`tests/helpers/` § `waitUntilBlockedBy`), not timed. The header and the test's comment are
  rewritten to say which lock serialises two publishes (billing) and what the row lock is for.
- **If none exists**: the lock still stays. It is one clause, it is in the documented lock order,
  and a guard that is redundant today is cheaper than finding out later which new writer needed it.
  The header and the test comment are corrected to say it is belt and braces and what serialises
  the publishes; the race test is renamed for what it proves; and the SQL-reading assertion in
  `tests/public-reads.test.ts` remains the thing that notices the clause being deleted.

*Passed over: delete the lock.* Removing a lock on the one write this feature has, to save one
row lock per toggle, is the wrong trade. *Passed over: two owners.* Two owners cannot both own one
slug, so that test cannot be written.

## C — `qi-dwkg6wh4`: live markers count their holders

**What is wrong.** While a search, a referee criterion or a claims run is in flight, the process
keeps a marker so a page load's sweep does not bury the run as abandoned. The marker is a map from
key to **one** holder (`searching`, `refereeing`, `pullingClaims` in `src/routes.ts`), set after
`begin` answers. If an older request's `begin` answers *after* a newer one's, the older takes the
marker over; when the older finishes (its fenced `finish` writes nothing) it deletes the marker,
and the newer run, still going, can be swept once its grace has passed.

**The fix.** A count per key: live while any request holds it. One small helper used by all three,
so there is one implementation and one test of it:

```ts
/** Keys held by at least one request. `hold` returns an idempotent release. */
function liveKeys() → { hold(key): () => void; has(key): boolean; keys(): Iterable<string> }
```

The three maps become three of these; each handler's `finally` calls its release; `liveRuns`,
`liveCriteria` and `pullingClaims.has(slug)` read through it. It lives in its own small module
under `src/` so it can be unit-tested without a route.

Red first: a unit test of the helper (two holds, the first released, still live; release twice is
one release); and in `tests/referee-stream-lifetime.test.ts` (or `tests/routes.test.ts` for
Search), one case per handler where the first request's `begin` is made to answer after the
second's, the first finishes, the row is aged, and a `GET` must still find the second `pending`.
Sol's F4 was reasoned, not reproduced; these reproduce it or the debrief says which could not be.

*Cluster 8 is out of `src/routes.ts`* (the builder confirms with `git log` before editing). Other
markers in the file (`answering`, `streaming`) are not part of this item; the builder says whether
they have the same shape and does not change them.

## D — `qi-rw8ppcgf`: Search and Criteria stamp the hash of the blocks they send

**What is wrong.** A stored run records a fingerprint of the article's blocks, so a later re-
extraction can mark it "from an older version". Search and Criteria read that fingerprint inside
`begin`, and the handler loads the blocks it sends to the model afterwards. A re-extraction landing
in between gives the model the new blocks and the row the old hash: a fresh answer shown as stale.
Claims was fixed in 6a by having the handler load the article first and pass
`hashBlocks(article.blocks)` to `begin`.

**The fix.** The same, in both: `begin` takes a required `sourceHash: string` straight after
`slug`; the handler calls `loadArticle` before `begin` and hands the same `article` to the model
call. The stores stop calling `sourceHashFor` in `begin` (their `sourceHash(slug)` reader, used for
the stale mark, stays). The article lock in `begin` stays: it still orders the read of existing
runs against the write.

**What changes for a caller, named.** `loadArticle` now runs before anything is written, as in
Claims. A slug that is not an article is still a 404, from `loadArticle` rather than from `begin`.
A `loadArticle` that fails for another reason is now an HTTP error with no row, where it used to be
a stored `error` run with a *Try again*; the builder checks what the Search and Criteria panels
show for a failed POST and says so. `refuseAPaperNotReadYet` is then redundant in these two
handlers if `loadArticle` raises the same `NotProcessed`; remove it only if a test shows the same
409.

Red first: per store, a test that `begin(slug, "a-hash-of-my-own", …)` stores that hash, and per
handler, a test that re-extracts between the article read and the row and finds the row holding the
hash of the blocks sent.

*Passed over: `finish` writes the hash.* It keeps `begin`'s signature and the old order, but a
`pending` row would carry one hash and the finished row another, and 6b made `sourceHash`
deliberately unsettable at `finish` for Claims. One shape for all three stores is worth the wider
diff in tests.

## Gates

Each builder: its touched suites, alone. Then, once, `npm run typecheck`, `npm test`,
`npm run lint` on touched files. GPT Sol reviews this plan read-only and the four commits
write-capable. A browser pass only if D changes what a panel shows on a failed POST.

## Log

### 2026-10-05 — GPT Sol's plan review: build with corrections, all five accepted

[The review](261005i-q-yeses-four-store-and-route-correctness-fixes-plan-review-sol.md) (prompt
beside it). No P0 or P1. **Where an item above and a correction below disagree, the correction
wins**; each builder is handed the review itself.

- **PF1 → A.** Sharing the function is not enough: the artefact read returns a block's raw HTML and
  `blocksFor` returns it sanitised, and Sol reproduced the decider answering differently on the
  two. The new arm reads the **raw stored blocks**, the same ones the pipeline's read gets, and a
  test has a block with removable markup. The second query is bound to `found.revision.id`.
- **PF2 → A.** The paragraph-text case near line 895 of the agreement test also expects the
  `blocks` disagreement; `blocks` moves into its expected stale list.
- **PF3 → D.** The untyped fake in `tests/search-route-cancellation.test.ts` would read the hash as
  the criterion and the compiler will not say so; the test in `tests/store-searches-pg.test.ts`
  that expects `begin` to omit `sourceHash` is replaced, keeping one for reading an old row with no
  hash.
- **PF4 → D.** The handler's red test wraps the real `begin`: let it commit, change the article,
  then return. Assert the stored hash against the blocks captured at the model boundary. The
  store's persistence test is separate.
- **PF5 → B.** The first branch applies: publication's minimal-to-full transition writes
  `processing` under the article lock without the billing lock. The test holds that lock, starts a
  share, shows it blocked, commits and expects success. `lockedArticleQuery`'s comment and the
  commentary in `tests/public-reads.test.ts` are corrected too; the two-publish test is kept, named
  for what it shows.
- **C, from the body.** The older `begin` must commit before its return is delayed, and both
  requests must share a key: Search by a quick revision, Criteria by DELETE and reuse, Claims by
  its one row. `hold` sits immediately before the outer `try`. `answering` already has this
  count-and-release shape, so the helper is taken from it, not written beside it.
- **D, from the body.** Dropping `refuseAPaperNotReadYet` would add `loadArticle`'s `paper` payload
  to the 409; keep the call unless that shape is checked.

### 2026-10-05 — all four landed

| Item | Queue id | Commit | What happened |
|---|---|---|---|
| B | `qi-g25rz5tc` | `40c217dd6` | The lock is **not** redundant and stays. Publication (`publishRevisionIn`, `src/store/pg-revisions.ts`) flips `processing` to `full` under the article lock with no billing lock. A new case holds that write open and shows a share blocked behind it; with `.for("update")` deleted it answers 409. The two-publish case is kept and renamed. No behaviour change. |
| A | `qi-paam4re2` | `c0b2e1727` | `blocksAreWhatTheirHtmlProduces` in `src/blocks.ts`, called by the queue and by `isCurrent`. `blocksFor` was split so the page reads the rows once and feeds the arm the stored copy. The guard and the agreement test were red first. |
| C | `qi-dwkg6wh4` | `d5a445c32` | `src/live-keys.ts`; `searching`, `refereeing`, `pullingClaims` and `answering` all use it, and `beganAnswering` is gone. Sol's reasoned F4 was **reproduced** in all three handlers. |
| D | `qi-rw8ppcgf` | `7fc1b41fb` | `begin` takes `sourceHash` after `slug` in both stores; both handlers load the article first. 85 test callers migrated; the untyped fake fixed by hand. |

Built by three Opus subagents in parallel (A; B; C then D). Every fix was red first and mutated
afterwards; the outputs are quoted in
[the code review prompt](261005i-q-yeses-four-store-and-route-correctness-fixes-code-review-prompt.md).

What differed from the plan:

- **A.** The pure function takes nullable inputs and answers false when one is missing, so that
  rule is shared too. The measured cost is up to about a second on the largest article, per load
  of the Metadata page only (`GET /api/metadata/:slug` has no other client caller).
- **D.** The handler tests stand in for a re-extraction by rewriting one `revision_blocks.text`
  row and restoring it in `finally`; no helper edits a loaded article's blocks. They pin the
  handler's order, and only the store tests pin whose hash is written.
- **D, for a reader.** A `loadArticle` that fails is now an HTTP error with no stored row. Both
  panels already turn a failed POST into a local error row with a retry (`useSearch.ts`,
  `useCriteria.ts`); it is gone on reload, where the stored one was not. No client change, so no
  browser pass.

**GPT Sol's code review: land after its fixes.**
[The review](261005i-q-yeses-four-store-and-route-correctness-fixes-code-review-sol.md). One round.

- **CF6 (P1, reproduced), fixed by the reviewer.** The comment answer took its live hold before
  the stream was opened and outside any `finally`, so a response that threw during setup pinned
  the comment's id in every later sweep. It predates this work, and C moving `answering` onto the
  shared helper is what put it in scope. One outer `try`/`finally` now covers setup; two cases in
  `tests/comment-answer-marker.test.ts`;
  [postmortem](../postmortems/261005h-a-live-hold-before-the-cleanup-boundary-survives-stream-setup-failure.md).
  I read the diff (a re-indent and the outer block) and re-ran `routes`, `comment-sweep`,
  `referee-stream-lifetime` and the new file: 195 and 77 passing.
- **CF7, CF8, CF9 (P3), fixed by the reviewer.** `block-ids.md` described a comparison that
  ignored ids, which the replay has not done for some time; a sentence in `pg-visibility.ts`
  overstated what the billing lock is needed for; `architecture.md` gets a line for `liveKeys`.
- **CF10 (P1, reasoned, wider, pre-existing), not built.** `GET` of saved searches does not send
  the article's current fingerprint, so the panel cannot reliably mark a saved search as from an
  older version. `search.md` already says so. It is a client change and goes to the queue.

**Gates.** `npm run typecheck`: all four projects pass. `npm test` at `7fc1b41fb`: 1633 files
passed, 1 failed — `tests/worktree-remove.test.ts`, two cases about a worktree's lock, which pass
when the file is run alone and touch nothing here. The suite was not re-run after the review's
fixes; the files they touch were.

**Found, not fixed.**

1. CF10, above.
2. `structure` still disagrees the other way (queue *done*, page *not current*). Deliberate, pinned.
3. `contracts.ts` says "both stores call it" of `withRun` and `withCriterion`; there is one store.
4. About ten test comments name `blocksMatchTheirHtml (src/pipeline.ts)` as where the three
   questions live. It is still the entry point, so they are not wrong, only one hop short.
