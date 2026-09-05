# Review: the built cache-ordering fence

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence`, branch
`worktree-cache-order-fence`. TypeScript + ESM, React client, Vitest. **This is the code review** —
you reviewed the plan twice (F1–F13); this is what got built from it. Weight this pass higher than
those: a plan-stage review cannot find a transaction that writes one store and then rejects.

## The candidate

Live pre-commit; base `cda25e24` ("Seven red tests for a cache that lets the slow reply win", which
contains the plan and the Stage 1 red tests). Scoped paths, all **tracked and modified** — untracked:
**none**:

```
src/web/lib/offline-store.ts
src/web/lib/api.ts
tests/offline-store.test.ts
tests/cache-issue-order.test.ts
tests/api-fetch-offline.test.ts
tests/cacheable-covers-artefact-routes.test.ts
tests/offline-remount.test.tsx
tests/shelf-cached-paint.test.tsx
docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md
```

`git diff cda25e24 -- src/web/lib/offline-store.ts src/web/lib/api.ts` is the code. Not durable —
I will record the resulting commit SHA in this file once it lands.

Start with `src/web/lib/offline-store.ts` (read it whole, it is the change) and then `api.ts`
§§ `apiFetch` / `attempt` / `saving`. This is where to begin, not the limit of scope.

Read alongside: the plan
`docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md` (it now records what
actually landed, including two corrections the implementation forced on it), and your own two
reviews, `260905g-cache-order-plan-review-sol.md` and `...-plan-review2-sol.md`.

## What it is meant to do

An IndexedDB store of already-received JSON API responses, partitioned by signed-in user id, read
back **only** when a GET fails at the transport layer. Not a sync engine.

The mechanism you specified: a cacheable GET reserves a ticket (`{ userId, url, epoch, seq }`) before
it is issued; the commit accepts a body only if the ticket's epoch is still the owner's current epoch
and its `seq` beats the URL's last **committed** seq. `invalidate`/`forgetUser` collapse into one
`retire()` that deletes bodies, deletes their `commit` rows and advances the epoch in one
transaction. Eviction has its own transaction after the commit. Every public operation is bounded by
`DEADLINE_MS` and aborts its transaction on expiry. A retirement that cannot be shown to have
happened calls `abandon()` — cache off for the page, `deleteDatabase`.

Invariants that must hold:

- No response may overwrite a **newer** successfully committed body.
- A **failed** newer request must not stop an **earlier successful** one filling an empty cache.
- A GET issued before a successful mutation must not restore pre-mutation data.
- After `forgetUser(A)`, no response for A in flight before teardown may recreate A's rows, including
  after A signs back in; B's rows untouched throughout.
- Nothing throws at a caller, and **every public operation settles**.
- Eviction stays whole-article. The account partition and the `x-spideryarn-offline` /
  `x-spideryarn-saved-at` headers are unchanged. `savedAt` stays the reader-facing "we got this at".
- A body may never be filed under a drawer its ticket was not taken for.

Out of scope: A1–A10 of `260905e-main-app-architecture-review.md`, service workers, offline writes,
new dependencies, any server or database change.

## Decisions taken since your last pass, so you are not re-litigating settled ground

- **The v1 → v2 upgrade clears every existing row.** Your F9(b) offered this as the safe migration
  and it was taken, after a second opinion. The deciding argument: there is no service worker, so v2
  code only ever runs on a page loaded online, and copies re-save as the reader reads. Preserving
  them needs a durable record of failed retirements in `localStorage`, which this module already
  documents as throwing in a Safari private window — so preserving is clearing plus a mechanism that
  degrades to clearing silently. Argued in the plan § "The upgrade clears what version 1 saved".
  **Attack the implementation of it, not the decision.**
- **No cooldown.** Giving up is for the page, per your F9.
- **One previously-green test was replaced**: the `stampFuture` case pinned `existing.savedAt > now`,
  the clock comparison F1/F2 required removing. Keeping it green meant keeping that comparison
  alongside the fence. **Check that its replacement really covers what it covered.**
- **A correction to the plan the implementation forced**: the sign-out test does *not* force the
  epoch advance to be atomic with the deletes (the ticket is taken before the call, so it is retired
  either way). The atomic version was built anyway. So **that invariant is now asserted by nothing**
  — worth your attention.
- `DEADLINE_MS = 3_000` and `MAX_COMMITS = 2_000` were chosen, not derived.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. Please run
`npx vitest run tests/offline-store.test.ts` — it uses `fake-indexeddb`, needs no network, and
includes a real 3-second deadline test. You can also run `tests/cache-issue-order.test.ts`, build a
throwaway harness under `/tmp`, and run a script with `node --import tsx`. Your round-1 and round-2
harnesses were the most valuable part of both reviews — please do that again, particularly against
the commit rule and the abort path. **No network, not even loopback.** Nothing here needs it.

I have run: the nine cache test files (139 green before the last two changes, 85 green across five
of them after), `npm run typecheck` clean, `biome check` clean on the touched files. The full
`npm test` is running as I write this and its result will be added to the plan.

## Attack it

Independently, before my questions.

Break the commit rule in code rather than in principle: an interleaving of reserve, commit, touch,
evict, sweep, retire, abandon, sign-out and sign-back-in — one tab or two — that leaves a stale body
committed over a newer one, loses a body that should have been kept, recreates a signed-out reader's
data, files a body under the wrong owner, or wedges the cache so nothing can ever be written.

Then look specifically at things a plan review could not reach:

- **Transaction discipline.** Every `await` inside an IndexedDB transaction risks letting it
  auto-commit. Does any operation here `await` something that is not a request on its own
  transaction, and if so does the transaction survive it? `bounded` wraps an async IIFE — check what
  that does to the transaction's lifetime in a real browser, not only in `fake-indexeddb`.
- **The abort path.** `bounded` aborts on the deadline. Is every partial write actually rolled back,
  is `Done<T>`'s `{ ok: false }` handled correctly at each of the seven call sites, and can an
  aborted transaction leave `meta` and `responses` disagreeing?
- **`abandon()` re-entrancy.** It is reachable repeatedly (every later mutation on a dead cache).
  Does calling it twice, or during an in-flight operation, do anything worse than nothing?
- **The upgrade.** `oldVersion < 1` creates stores, else clears `responses`. Is that right for every
  path a browser can take through it, including a database that exists at version 1 with no
  `meta` store, and a `deleteDatabase` racing an open?
- **The tests.** Do any of them pass for a reason other than the one they claim? Is any assertion
  vacuous? The file has helpers (`until`, `fence`, `save`, `freshStore`, `lockResponses`) whose
  correctness the tests depend on.

For each finding: an ID (**continuing from F13** — new ones from F14 up, reuse an ID only for the
same finding), a severity, established or reasoned, (a) the input or mutation that shows it fails,
(b) the smallest change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

Worth less than anything you find yourself.

1. `retire()` calls `abandon()` when `open()` returns `null`. In a browser with no IndexedDB at all
   — Node, a Safari private window — that means the **first mutation** switches on a flag and calls
   `deleteDatabase` for a database that never existed. Harmless, or is there a path where a reader
   with working storage gets their cache deleted by something that was never a failure?
2. `sweep()` runs inside the commit transaction and calls `getAllKeys` twice. Is that safe inside a
   transaction that has already written, and is the `MAX_COMMITS + 1` count trick sound?
3. `evict()` runs *after* `writeCached`'s transaction commits but its result is not part of the
   `true` the caller gets. Is the "successful write stays successful" claim actually delivered?
4. `bounded` now does `tx.done.catch(() => {})` to stop an aborted transaction's rejection escaping.
   Does swallowing that hide a real failure anywhere?
5. The `commit`-row key range uses `￿` as an upper bound. Is that a correct bound for every URL
   this app can produce?

Do not change any file.
