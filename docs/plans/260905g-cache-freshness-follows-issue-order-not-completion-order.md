# Cache freshness follows issue order, not completion order

Status as of 2026-09-05: planned, not built. Implements **A0** of
[the main app architecture review](260905e-main-app-architecture-review.md), and nothing else from
it — Greg scoped this run to A0 alone and asked to re-decide the rest afterwards.

## Brief

> Just A0 first, then re-decide.
>
> — Greg, 2026-09-05

The review's A0 is the one item in it that is a confirmed defect rather than a maintenance
preference: the offline cache decides which of two responses is fresher by **when the write
started**, so a slow old response lands on top of a fast new one. Four sibling operations in the
same file — the LRU touch, eviction, invalidation and sign-out teardown — read a snapshot and then
write outside the transaction that produced it, which is the same mistake in a different costume.

Nothing here touches production data, the server, or any schema. It is entirely inside one browser
module and its one caller.

## What is actually wrong

All five are in [`src/web/lib/offline-store.ts`](../../src/web/lib/offline-store.ts), and the
caller seam is [`src/web/lib/api.ts`](../../src/web/lib/api.ts) § `saving`.

1. **`writeCached` orders by completion.** `const now = Date.now()` is taken when the write begins,
   and the guard is `existing.savedAt > now`. An OLD GET that returns last therefore carries the
   *later* `savedAt` and wins. The comment above the guard says "a slow reply must not overwrite a
   fast one", which is precisely what it fails to do — it prevents a *clock* inversion, not a
   *completion* inversion.
2. **A GET issued before a mutation can undo it.** `saving` invalidates on a successful non-GET.
   A GET issued before that PATCH/DELETE, completing after, refills the cache with pre-mutation
   data. Offline, `apiFetch` then serves it as a synthetic 200 and the deleted thing is back.
3. **`readCached`'s LRU touch is a stale read-modify-write.** It does
   `put({ ...row, lastOpened: Date.now() })` outside the read's transaction, so it can put a whole
   **old body** back over a newer one saved in between, and can **recreate a row** deleted in
   between by `invalidate` or `forgetUser`.
4. **`evict` chooses victims from a snapshot and deletes later.** Rows written after the snapshot
   can be deleted; an article can be left half-evicted, which is the exact outcome the
   whole-article rule exists to prevent.
5. **`forgetUser` is unfenced.** It deletes a signed-out reader's bodies, but a response already in
   flight for that reader can commit afterwards and recreate them.

Classes: **completion time used as causal freshness**, and **stale read-modify-write outside a
transaction**.

### Where they came from

All five arrived together in `ad90b175`, 2026-08-27, *"Keep the article a reader is holding when the
connection goes."* — the commit that added the file whole. `git log -S` for `savedAt > now`,
`lastOpened: Date.now()` and `function evict` each returns that one commit and nothing else; the
file has had three later commits and none of them changed this logic. Neither
[260827r-offline-reading.md](260827r-offline-reading.md) nor either of its GPT Sol reviews discusses
transaction scope for `evict`/`invalidate`/`forgetUser`, or issue time versus completion time.

**And there is already a test that looks like it covers defect 1.**
`tests/offline-store.test.ts` § *"an older reply cannot overwrite a newer one"* forges a future
`savedAt` onto a stored row with `stampFuture` and then checks that `existing.savedAt > now`
compares the way it reads. It proves the operator, not the race — it never drives two real writes
completing out of issue order, which is the only way the defect happens. That is the shape
[silent-success.md](../reusable/silent-success.md) is about, and it is why the reproduction below
has to drive `apiFetch` and the store together.

The general shape has bitten twice server-side in the preceding week —
[a `SELECT … FOR UPDATE` that locked nothing](../postmortems/260901f-a-for-update-that-locks-nothing.md)
and [the truncation retry cost storm](../postmortems/260902c-the-truncation-retry-cost-storm.md),
which names "read-modify-write serialised per process" as an unenforced claim in four store
modules — but never in the browser and never under this name.

## The mechanism: a ticket reserved before the request goes out

This is A0's own design — a monotonic sequence reserved per owner, an owner mutation epoch, both in
IndexedDB, both read **before** the cacheable request is issued.

An earlier draft of this plan proposed something cheaper: stamp each request with its issue time and
compare timestamps at the commit, avoiding the round trip entirely. **GPT Sol refused it, and was
right.** The claim that a clock jump would degrade to *stale, not wrong* is false for the retirement
mark: a backwards adjustment lets a pre-mutation response compare newer than the retirement that
followed it, and it **restores data the reader deleted**. A forward jump can wedge caching until wall
time catches up. Two tabs also share no monotonic source, so equal stamps in the same millisecond
reject the newer response. Recorded here rather than deleted, because the cheap version is the one
the next reader will think of too. See
[the plan review](260905g-cache-order-plan-review-sol.md) §§ F1, F2.

### What is stored

`DB_VERSION` 2. `responses` keeps its present shape, keys and indexes. One new store, `meta`,
keyed by `key`, holding two kinds of row:

| Key | Row | Purpose |
|---|---|---|
| `epoch\n<userId>` | `{ epoch, nextSeq }` | The owner's mutation epoch, and the allocator for their issue sequence |
| `commit\n<userId>\n<url>` | `{ seq }` | The last sequence that **successfully committed** a body for that URL |

The committed sequence lives here rather than on the response row, and that separation is what
makes eviction safe: deleting a body does not reset the ordering baseline, so
**eviction needs no retirement of its own** and cannot discard an unrelated in-flight response.

### The four operations

Each is one `readwrite` transaction over exactly the stores it touches.

**Reserve** — `reserveTicket(url, userId)`, before a cacheable GET is issued. Reads/creates the
owner's epoch row, `nextSeq += 1`, writes it back, returns `{ userId, url, epoch, seq }`. On no
database, a throw, or the deadline below: returns `null`, and that request **irrevocably does not
cache**. A late reservation cannot restore its eligibility, because the ticket is a value passed
down the call chain and there is nothing to restore it to.

**Commit** — inside `writeCached`, over `responses` + `meta`:

```
reject unless ticket.epoch === meta(epoch\<user>).epoch          // no mutation/teardown since
reject if     commit(commit\<user>\<url>) exists && seq >= ticket.seq   // something newer already landed
otherwise     put the response row, and put commit row seq = ticket.seq — together
```

Compared against the **last committed** sequence, never the last issued: a newer request that fails
leaves no mark, so an earlier successful response still fills an empty cache.

**Retire** — `invalidate` and `forgetUser`, each in one transaction: delete the matched `responses`
rows, delete their `commit` rows, and `epoch += 1`, all together. The epoch row is **retained**, so
every ticket reserved before the retirement stays retired for good — including after the same
reader signs back in, whose fresh reservations read the new epoch and cache normally. Deleting the
`commit` rows is safe *because* the epoch advanced in the same transaction, and it is what keeps
this metadata bounded without a pruning scheduler. A mutation retires the whole owner, so an article
still loading when the reader posts a comment may end up **partially** cached — the parts that
committed before the mutation stay, the rest are refused. A0 accepts that for mutations; only
eviction promises whole articles.

**Evict** — unchanged in policy, and in **its own** transaction after the commit completes, not
folded into it: selection, revalidation and whole-article deletion together, failing independently
so a successful cache write stays successful. It deletes bodies only. An in-flight response for an
article evicted a moment ago may recommit its row, which puts the cache one row over the cap until
the next eviction — the right direction, since the reader is plainly still reading it.

### The upgrade clears what version 1 saved

**Decided 2026-09-05, by me with Fable's second opinion, after Greg delegated the call.** The v1 → v2
upgrade deletes every existing row.

It costs one line and closes two of Sol's findings outright: a v1 row carries no ordering metadata,
so a response issued before the upgrade could overwrite a **newer** v1 row (F4); and a mutation whose
`invalidate` could not run while the database was unavailable leaves a preserved v1 row that later
serves a comment the reader already deleted (F9).

The argument that settles it is Fable's, and it is about when the code runs: **there is no service
worker**, so v2 code only ever executes on a page loaded *online*. The clear therefore happens while
the reader is connected, and every article they open from then on is saved again exactly as before.
What is actually lost is the backlog — articles cached earlier that they do not reopen before their
next disconnection. A reader with fifteen saved articles who opens the app at the airport, reads one
and boards will find fourteen offline markers gone. Once, recoverably, and it is a thing this module
already treats as ordinary life: the note at `MAX_ARTICLES` observes that Safari's seven-day wipe
takes the lot anyway.

Preserving them was the alternative, and it is not merely more work. The durable record of
retirements that failed while the cache was down has to live somewhere IndexedDB is not, and the one
place available is `localStorage` — which this module already documents as throwing in a Safari
private window and absent under Node. Two blocked tabs would have to *merge* that record rather than
overwrite it. And where it cannot be written, the only honest fallback is to clear on upgrade after
all. So preserving is clearing, plus a second mechanism that degrades to clearing **silently**.

The honest cost, stated plainly: this is a deliberate, unannounced loss of saved copies for real
readers. It is not announced in the UI because the copies return on their own and the notice would
alarm more than the event. Reconsider if readers turn out to queue a week's reading for a trip, if
schema bumps become routine rather than once-in-the-module's-life, or if this store ever holds
something that cannot be trivially fetched again — none of which is true today.

### Every operation is bounded, and failure is closed

Two of Sol's findings live here, and the second is the one nobody had seen.

**F3 — the version bump can hang the offline read.** A tab running today's v1 code holds its
connection, the v2 `openDB` is blocked indefinitely, and since `attempt` awaits `readCached` which
awaits that promise, the reader offline gets **neither their copy nor the working no-cache app this
module promises**. Today's `open()` has no `blocked` handler and no deadline.

**F10 — bounding `open()` bounds nothing else.** Once a handle exists, any transaction can wait
forever behind a locked `readwrite` transaction in another tab — a suspended background tab on a
phone is enough. Sol's harness: `{"openAlreadySettled":true,"publicOperationSettled":false}`. So the
deadline belongs on **every public operation**, including transaction completion, not on opening.

So:

- `open()` becomes `Promise<IDBPDatabase<Schema> | null>` with a bounded deadline and a `blocked`
  handler; a connection that lands after we gave up is closed. A `blocking` handler on the v2
  connection closes it so *our* tabs never block a future upgrade — the deadline is still needed,
  because already-deployed v1 code has no such handler.
- Every public operation races its own deadline. On expiry it **aborts the transaction** — merely
  racing `tx.done` is not enough, because an abandoned transaction can still write — and returns the
  ordinary no-cache result, which every caller already handles.
- **Giving up is for the page, not for the moment.** An earlier draft had a cooldown so the cache
  came back when the blocking tab closed. Sol's F9 shows that is not a missed cache write but wrong
  data: a mutation's `invalidate` silently cannot run during the unavailable interval, and the
  recovered cache then serves a comment the reader has already deleted
  (`{"blocked":true,"retirementCouldRun":false,"staleBodyAfterRecovery":{"comments":["deleted later"]}}`).

**A retirement that fails, fails closed.** `invalidate` and `forgetUser` are the two operations
whose failure is not merely a missing convenience — a body that should have been deleted and was not
is a body that gets served. Today the module swallows that failure by design: *"The write succeeded.
A cache we failed to clear is not worth failing it."* That was written without noticing it means
serving deleted data offline, and it is the same hole F9 describes.

The rule instead: **if we cannot prove the cache is honest, we do not keep a cache.** A retirement
that fails or times out disables the cache for the rest of the page — so nothing stale is served now
— and requests `deleteDatabase`, so nothing stale is served later. Deleting is always safe, because
every row is a copy of something the server still has, and it needs no durable record of outstanding
debt and no replay. One branch, no bookkeeping.

### The cost, stated

A reservation is an IndexedDB round trip in front of every **cacheable GET** — not every request,
and not non-GETs. An earlier draft claimed it was free because it pipelines with the `accessToken()`
call `apiFetch` already awaits. **Sol's F12: it does not.** The ticket needs the owner whose token
will authorise the request, and that owner comes out of `accessToken()` — reserving concurrently
would need a second `lastKnownUser()` lookup, which is precisely the cross-account race `api.ts`
already carries a long comment about having fixed. So: await the token, reserve for its owner, then
send. One added round trip on a tiny store, and the deadline bounds the pathological case.

### What this does not change

The whole-article eviction rule, the `${userId}\n${url}` account partition, the never-throw
contract, `savedAt` as the reader-facing "we got this at" value, and the `x-spideryarn-offline` /
`x-spideryarn-saved-at` headers.

## Stages

### Stage 1 — reproduce, in red

No fix in this stage. The point is to see each defect fail before it is fixed, and — equally — to
know which cases are **controls that should stay green**, so that a green run afterwards means
something. Sol's F6 is folded in: overlapping IndexedDB `readwrite` transactions serialise, so the
store-level reproduction is not "two writes overlap" but *the newer response invokes its write
before the older response invokes its own*.

**Expected red — the defects:**

- [x] **Reverse completion**, driven through `apiFetch` and the real store together: GET #1 issued,
      GET #2 issued for the same URL, #2 resolves and its write lands, then #1 resolves. The cached
      body must be #2's.
- [x] **Pre-mutation response.** GET issued; a successful PATCH/DELETE invalidates; then the GET
      resolves. The cache must stay empty.
- [x] **LRU touch versus a newer save**, and **versus a delete** — the body must be the newer one,
      `lastOpened` must still have moved, and a deleted row must not come back.
- [x] **Eviction versus a fresh save** — nothing that should have been kept is deleted, and no
      article is left with some rows gone and others kept.
- [x] **Teardown fence.** A response for A in flight, `forgetUser(A)` completes, the response lands:
      no A row is recreated, B's rows are untouched. Then A signs back in and a fresh read caches.

Blocked-upgrade and legacy-row behaviour are **not here**: nothing is on version 2 yet, so neither
can be red, and Stage 1's own rule forbids claiming a redness it cannot show. They move to Stage 2a
— Sol's F13.

**Expected green — the controls.** These pass today and must still pass after the fix; they are
what stops the fix being "cache nothing":

- [x] Empty cache, earlier request succeeds while a newer one fails, in both completion orders.
- [x] A direct A → B account switch with no `forgetUser` keeps both partitions.
- [x] Non-cacheable and non-JSON responses cause no write; a served copy is not re-saved.

- [x] Record the red output verbatim into this doc, and say which controls were green.

**Done, 2026-09-05.** `npx vitest run tests/offline-store.test.ts tests/cache-issue-order.test.ts`,
run twice independently — **7 failed, 19 passed**, the same seven each time:

```
 ❯ tests/cache-issue-order.test.ts (4 tests | 2 failed)
     × keeps the body of the request that was issued later
     × does not let a GET issued before a mutation refill the cache it emptied
 ❯ tests/offline-store.test.ts (22 tests | 5 failed)
     × cannot put an old body back over one saved while it was reading
     × cannot bring back a row invalidated while it was reading
     × cannot bring back a row a sign-out deleted while it was reading
     × does not delete an article that was saved while it was choosing
     × does not let a reply in flight survive the sign-out it arrived after
```

Three things the reproduction established that this plan had wrong:

- **The touch race needs the two operations issued *concurrently*, not in sequence.** `idb` creates
  a `put`'s transaction **synchronously** inside the call, and IndexedDB commits transactions over
  one store in creation order — so anything a test starts *after* `readCached` returns is ordered
  behind the touch and wins, and the test is green against the buggy code. Written that way it
  proves nothing. The interleaving that does reproduce it is the one the app performs on every
  repeat visit: [`useShelf.ts`](../../src/web/useShelf.ts) calls `readCachedShelf` and
  `apiFetch("/api/library")` together, so the paint-from-cache read always races the response that
  replaces it.
- **The half-evicted-article half of defect 4 is not writable today**, and was not faked. Every way
  of producing "some rows present, others gone" for one article is either indistinguishable from a
  legitimately partial article, or is still produced by correct code. Telling them apart needs the
  ticket, i.e. Stage 2. The test asserts the unambiguous half instead: a save that returned `true`
  and was then deleted by a decision taken before it arrived — which is this module's own docstring
  rule, *"the one thing this must not do is report a success it did not have"*.
- **The sign-out test was thought to constrain where the fence is read** — advance the mark at the
  top of `forgetUser` and an in-flight write survives; advance it in the transaction that does the
  deletes and it does not. **Stage 2 proved this wrong** for the ticket design, and the correction
  matters more than the claim: under the epoch the ticket is taken *before* the call, so it is
  retired wherever inside `forgetUser` the advance happens, and the test stays green either way.
  The atomic version is still what got built — a half-done retirement is deletes without an advance,
  or an advance without deletes — but it is the plan that requires it, not this test.

And one trap worth keeping: a raw `indexedDB.open` with no version, on a database that does not
exist yet, **creates an empty one** — after which the module's own `openDB(…, 1)` sees a current
version, never runs its upgrade, has no object store, and every write silently returns `false`. A
whole suite about which write wins would have run against a cache that was not there.
`cache-issue-order.test.ts` opens through the module first and asserts the boot write returned
`true` before touching raw IndexedDB.

### Stage 2 — the fence

**2a, the migration.** Sol's F13: the blocked-upgrade and legacy checks cannot be red in Stage 1,
because nothing is on version 2 yet. So they are a substage of their own, and the redness is
observed here rather than claimed there.

- [x] Bump `DB_VERSION` to 2 and add the `meta` store, **without** the deadline. Write the
      blocked-upgrade test — a raw v1 connection held open — and watch `readCached` hang.
- [x] Add the bounded `open()`, the `blocked`/`blocking` handlers, and the closing of a connection
      that lands after we gave up. The test now settles promptly with no cached copy.
- [x] Clear every v1 row in the upgrade, per the decision above, and test that a
      pre-upgrade row is gone and a post-upgrade write caches normally.

**2b, the fence itself.**

- [x] `reserveTicket`, and `writeCached(url, body, ticket, slug)` implementing the commit rule.
- [x] `readCached`'s touch: one `readwrite` transaction that re-reads the row and writes back only
      `lastOpened`, on the row it actually found. If the row is gone, do nothing.
- [x] `invalidate` and `forgetUser`: one transaction each — delete rows, delete `commit` rows,
      advance and retain the epoch. The epoch must be advanced **in the transaction that does the
      deletes**, not at the top of the function — for **failure containment**, since a half-done
      retirement is deletes without an advance, or an advance without deletes. The sign-out test
      cannot show that, per the correction above; nothing asserted it until Sol's F16 added
      *a transaction that fails half-way keeps none of it*, which faults the epoch `put` and
      checks both stores rolled back.
- [x] `evict`: selection, revalidation and whole-article deletion in one transaction of its own,
      after the commit, failing independently.
- [x] Every public operation bounded by its own deadline, aborting its transaction on expiry; a
      failed or timed-out **retirement** disables the page's cache and requests `deleteDatabase`.
- [x] The `commit`-row sweep, **deterministic** — Sol's F11 is right that the version in the earlier
      draft was not bounded at all: deleting only rows whose article is no longer held can delete
      nothing, leave the count above the threshold, retire live tickets, and do it again on the next
      commit. Instead, on crossing the threshold: advance the epoch **once**, preserve `nextSeq`, and
      delete **all** of that owner's `commit` rows. That genuinely resets the bound, because the
      epoch retires every older ticket. Test the rare cost — every outstanding ticket for that owner
      is refused — and record it.
- [x] `api.ts`: await `accessToken()`, reserve for its owner, then send — one round trip, not
      pipelined. A fresh ticket for the post-refresh retry, which is a newly issued request that may
      belong to a refreshed owner and must see any mutation between attempts. Thread it through
      `saving` to `writeCached`. No change to what `saving` decides to cache.
- [x] All Stage 1 reds green, all Stage 1 controls still green, and a changed-input control proving
      the new tests can still fail. Stage 1's comments mentioning `retiredAt` are updated to the
      epoch; every assertion keeps its meaning.
- [x] `npm test`, `npm run typecheck`, `npm run check`, lint on touched files.

**Stage 2 landed, 2026-09-05.** 139 green across the nine cache test files, verified independently
of the implementer. The blocked-upgrade test settles at 3017 ms — on the deadline — so it passes by
*giving up*, not by never having been blocked. Before the deadline existed it failed like this:

```
 ❯ tests/offline-store.test.ts (24 tests | 1 failed | 23 skipped) 10016ms
     × settles rather than hanging while an old tab holds it off 10014ms
Error: Test timed out in 10000ms.
```

Mutation controls, each reverted: dropping the seq comparison turns 2 red, dropping the epoch
comparison 3, restoring the stale read-modify-write touch 1.

**One previously-green test was replaced, and this is the reasoning.** The `stampFuture` case pinned
`existing.savedAt > now` — the clock comparison this work exists to remove. Keeping it green would
have meant keeping that comparison *alongside* the fence: a second, redundant ordering mechanism,
re-importing the clock that F1 and F2 spent two rounds getting out, and wedging writes for a URL
after a backwards adjustment. Its own docstring already conceded it could not tell a clock inversion
from a completion inversion. Replaced by the same promise expressed in the live mechanism — a
deliberate pair, newer-first giving `false` and issue-order giving `true` — plus a case proving a
ticket taken for another URL is refused.

Two limits worth knowing rather than discovering later:

- The two "cannot bring back a row … while it was reading" tests now pass because **retirement is
  atomic**, not because the touch re-reads: the read is ordered after the whole retirement and finds
  nothing, so no touch happens. Deliberately stale, they stay green. The touch's re-read is pinned by
  one test, not three.
- `MAX_COMMITS = 2_000` and `DEADLINE_MS = 3_000` were chosen, not derived. The deadline is what a
  reader waits on when their network has failed, and it also decides how easily a slow device has its
  cache deleted by a spurious retirement timeout.

**The code review, and what it cost.** Two rounds. Round one refused with three P1s, all reproduced
with fault-injection harnesses rather than reasoned: eviction ranking by wall clock could delete the
article just received while `writeCached` still returned `true` (F14); `open` + commit + eviction each
took a separate three-second budget, so one call measured 5004 ms against a contract of 3000 (F15);
and a **synchronous** throw part-way through a transaction — as opposed to a request error event,
which aborts on its own — left the transaction alive with nothing pending, so it auto-committed the
body **without its commit row**, after which an older ticket overwrote it (F16). Round two confirmed
F15–F18 closed and found F14 still open in the concurrent case: two writes landing together take the
cache to 102, and the first eviction to finish drops two — one of which can be the other write's
article, because each eviction spares only its own slug.

The closing fix is a presence check, and the shape of it is the part worth remembering: it runs
**only when eviction actually completed**. Checking unconditionally looked right and quietly
withdrew F7's promise that a failed eviction leaves a successful write successful — an eviction that
timed out aborted its transaction and deleted nothing, so the row is still ours. An inconclusive
check answers `false`, because the promise is never to *claim* a success we did not have; declining
one we did is the direction this module is allowed to be wrong in.

**One finding overruled, deliberately.** Sol proposed a logical recency counter so eviction's ranking
would survive a clock rollback in general. Not taken: it changes the schema and the LRU semantics for
a case nobody has reported, and the narrower fix closes the contract violation on its own. Eviction
can still choose the *wrong* victim after a clock step; it can no longer choose the row it was called
for, or one a concurrent write is still reporting on.

**Two tests were silently green, and both are fixed.** A raw `indexedDB.open` with no version creates
the database at version 1; the module's v1 → v2 upgrade then clears the seeded rows, so a full-cache
test runs against an empty cache, eviction never triggers, and the assertion is satisfied by an
absence. It only bites when a test runs alone, because a whole-file run has already been through the
upgrade. Closed with `onVersion2()`, called by the seeding paths that need it — deliberately **not**
folded into `seed`, because the upgrade describe seeds a version-1 row on purpose and booting the
module there upgrades the database out from under the thing under test. The first attempt did exactly
that and turned a green test red.

Every fix in both rounds was watched failing first. When F14's concurrent case was mutated out, of
the forty tests then in the two files **only the new one went red** — none of the existing forty
covered it.

**Gates, 2026-09-05.** `npm run check`: typecheck clean, build clean, cycles clean, chain clean,
committed clean. Lint, knip, complexity and dupes have findings and are not gates — the baselines
are unclean on purpose ([linting.md](../project/linting.md)).

`npm test` — **713 passed, 2 failed, 1 skipped** of 716 files, and **neither failure is this work**:

- `admin-store.test.ts` fails in the batch and **passes alone** (3/3). Postgres contention on this
  box, which is a known habit here rather than a finding.
- `store-migration-registry.test.ts` fails on `tests/debate-step-registration.test.ts`, which arrived
  in `39701ce7` — another agent's in-flight work, merged in at worktree setup.

An earlier run also failed `cold-start-lazy-imports` and `pdf-bundle-trace`, both with
*"api-dist/vercel.js is missing — run `npm run build`"*. Both pass once the build exists; the run
above had it.

The nine cache suites are **148 green**, run repeatedly. The deadline tests involve real seconds and
were checked for flakiness rather than run once.

### Stage 3 — write it down

- [ ] Postmortem at `docs/postmortems/260905e-a-slow-response-overwrites-a-fast-one.md`: both class
      names, `ad90b175` as the introducing commit, the `stampFuture` test that looked like cover,
      the long-term fix, and what would have caught the class, ranked by ease and value.
- [ ] Update [260827r-offline-reading.md](260827r-offline-reading.md)'s implemented-state record,
      the [library](../project/library.md) signpost, and A0's row in the architecture review.
- [ ] GPT Sol review of the built code; then commit and push to `dev`.

## What this deliberately does not do

- No service worker, no write queue, no offline sync, no change to what is cacheable.
- No reader refactor. A0 was chosen precisely because it lands independently of A1–A10.
- No new dependency. `idb` and `fake-indexeddb` already do everything needed.
- No cross-tab coordination channel. IndexedDB is already shared between tabs, and the reserved
  sequence is already the shared logical clock; `BroadcastChannel` would add a second one.

Up: [Main app architecture review](260905e-main-app-architecture-review.md) ·
[Offline reading](260827r-offline-reading.md) · [Web client](../project/web-client.md)
