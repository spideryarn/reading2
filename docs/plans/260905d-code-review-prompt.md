# Review: reopen an article where you left it, and move the /design link into /admin

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link` (a git
worktree of the main repo — work in this path, not the primary checkout). Branch
`feedback-position-and-design-link`. TypeScript + ESM, React 19 client, vitest, `nuqs` for
query-string state, a fifty-line hand-rolled router rather than react-router.

## The candidate

Live pre-commit; base `750c91fd`.

Scoped paths (tracked, modified):

```
src/web/App.tsx
src/web/AdminPage.tsx
src/web/Library.tsx
src/web/params.ts
src/web/router.ts
docs/project/admin.md
docs/project/tooltips.md
docs/project/url-state.md
```

Untracked (new files — a pathspec cannot name these, so they are listed explicitly):

```
src/web/last-view.ts
tests/last-view.test.ts
docs/plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md
docs/user-feedback/260905_0936-move-the-design-link-into-admin.md
docs/user-feedback/260905_0957-reopen-an-article-where-you-left-it.md
```

`git diff 750c91fd -- <the tracked paths above>` shows the tracked half; read the untracked files
directly. **Landed as `a04dc7f5d3f9`**, which closes the live candidate above: that commit is what the
review actually saw, plus the fixes for F1–F5.

**Start with** `src/web/last-view.ts` and its use in `src/web/App.tsx` (search for `useLastView`).
That is where to begin, not the limit of scope — the manifest above is.

## What it is meant to do

Two unrelated user-feedback reports, both from the product owner.

**(1) The small one.** *"Move the Design link on the logged-in Homepage into /admin"*. The link is
now a third `Entry` on the `/admin` index and is gone from the shelf masthead. `/design` itself is
deliberately **not** gated — the reasoning is in `docs/project/admin.md` § The page itself and § The
three refusals.

**(2) The one with judgment in it.** *"If I close and then reopen an article, it should ideally
return me to the position/state/view that I was in. It's fine for this to be local to the
device/browser, or whatever is simplest"*.

This app already keeps every piece of reading-view state in the query string
(`docs/project/url-state.md` — read it, it is the authoritative contract here). So the feature is:
copy the query string into `localStorage` under the article slug as the reader moves, and put it
back when they open that article at an address carrying none of the article's parameters.

The contract, stated as invariants:

- **I1 — a link always wins.** If the incoming address carries *any* known article parameter
  (remembered or not — `?at=`, `?note=`, `?thread=`, `?find=`, `?panel=`, …), nothing is restored.
  Breaking this breaks link sharing, which is half of what the URL state is for.
- **I2 — the URL stays the single source of truth.** `localStorage` is read exactly once per
  article-open, in a layout effect, to choose the address; after that only the URL is consulted.
  The two must never be able to disagree.
- **I3 — a restore must not start anything.** No model call, no server write, no dialog, no
  permission prompt. (All 13 `?mode=` values were surveyed and are inert on arrival; `chat` is
  dropped anyway on judgment. See the plan doc.)
- **I4 — `localStorage` may throw**, not merely be empty (Safari private mode; site data blocked;
  and in vitest's node environment the global is Node's own). A failure must degrade to "no
  restore", never to a broken page.
- **I5 — pair text is preserved byte-for-byte.** Filtering is textual, never through
  `URLSearchParams`, because reserialising `cols=0,1,2` to `cols=0%2C1%2C2` is the shape of two
  historical address bugs in this repo (see `hasKey` in `src/web/router.ts`).

Deliberately out of scope: any cross-device sync, pruning stored entries, remembering search mode's
matcher, remembering which of an article's three pages (`/read/x`, `/read/x/metadata`,
`/read/x/tweets`) the reader was on, and any visible affordance announcing the restore. The plan doc
names each and why.

## What you can and cannot run

The tree is read-only to you; `/tmp` and the node_modules caches are writable. You can run
`npx vitest run tests/last-view.test.ts` — it needs nothing outside the tree, and it is the one I
most want you to run. You have no network, not even loopback, so anything needing Postgres or the
dev server will skip.

What I have run, and the raw results:

- `npm run typecheck` — clean, 1317 files across three projects.
- `npx vitest run tests/last-view.test.ts` — 17 passed.
- I verified both guards in that file can fail: deleting `"event"` from `REMEMBERED` reddens the
  coverage scan (`expected [ 'event' ] to deeply equal []`), and removing the `mode=chat` clause
  reddens the mode test (`expected '?mode=chat' to be ''`).
- `npm run check` and the full `npm test` were running as I wrote this; I will state their results
  in the ledger next round. Note `dev` already carries two reds that are not mine (`admin-store`
  under contention, `store-migration-registry`).
- A browser pass against the real app is running in parallel.

## Attack it

Independently, before reading my own doubts below.

The invariants to try to break are I1–I5 above. Concretely, the questions I would most like answered
by someone who has not been staring at this:

- Is there any sequence of navigations — shelf → article → shelf → *another* article, browser Back,
  Forward, opening a link in a new tab, an account switch, the `/read/x/metadata` page — in which
  `useLastView` writes one article's query string under another article's slug, or restores a stale
  one over a link? Note the ordering hazard I tried to handle: `navigate()` in `router.ts` writes
  history and fires its event **synchronously**, before React re-renders, so the save listener runs
  once more with the *new* address while the old component is still mounted.
- Does the layout-effect restore genuinely land before anything reads `?at=`? `useReadingPosition`
  in `App.tsx` is a passive effect inside a component that is not rendered until the article fetch
  resolves — but check the case where the fetch resolves synchronously (an offline/IndexedDB cache
  path in `useShelf`/`lib/offline-store.ts`), and check React's effect ordering for a parent layout
  effect versus a child passive effect in the same commit.
- `history.replaceState` is patched twice here — by nuqs's `enableHistorySync()` and by our
  `watchHistoryWrites()` in `router.ts`. Is calling it from a layout effect safe with respect to
  nuqs's debounce queue (`?at=` is debounced 300 ms) and its key-isolated subscriptions?
- Is `hasArticleState` really closed over every parameter the client writes? The test scans for
  `useQueryState("key"` with a regex — find a spelling of a query parameter in `src/web/` that the
  regex would miss (a computed key, a `useQueryStates` call, a server-side reader, a parameter
  written by `main.tsx` or by the serverless title composer in `src/vercel.ts`).
- Anything in the moved `/design` link: a dead import, a stale doc claim, a test that asserted on
  the masthead's three links.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
  - (a) what shows it fails its own claim — the input, sequence or mutation I can run
  - (b) the smallest change that closes it — a code block, or exact replacement wording

Severity by consequence: **P0** data loss, exploitable security, incorrect charging, or the service
broadly unusable. **P1** user-visible wrong behaviour, or an authoritative contract violated. **P2**
design or maintainability risk with no wrong behaviour today. **P3** non-behavioural prose or comment
defect. A defect in a doc that will cause a P1 to ship is not a P3 because it is made of prose.

Refuse only on an **established** P0 or P1 — direct evidence with no unresolved material inference —
and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

1. I chose to append the remembered pairs onto any foreign query string (`?utm_source=nl` →
   `?utm_source=nl&at=…`) rather than replacing it. I think that is right but it is the kind of
   choice that has an ugly corner I have not thought of.
2. I write to `localStorage` on every address change while the reader scrolls (`?at=` is debounced
   to ~3/sec). Synchronous storage I/O on a scroll path — I judged a ~40-byte write negligible
   against this repo's scroll-CPU work (`docs/plans/260904a-more-scroll-cpu-wins-review-sol.md`).
   Say if that is wrong.
3. I deliberately duplicated `router.ts`'s `hasKey` logic as `pairKey` in `last-view.ts` rather than
   exporting it. Two copies of a decoding rule is exactly the shape of the historical bugs that file
   records — but exporting it drags this module's concerns into the address canonicaliser. I am not
   sure which way this should go.
4. No pruning of stored keys. I did the arithmetic (a few dozen bytes each against ~5 MB) and
   decided against; tell me if you think a bounded index earns its cost.
5. `NOT_AN_ARTICLES` in the test hard-codes the five shelf parameters plus `by`/`dir` shared with
   `/admin`. That set could go stale the same way the article set could.
