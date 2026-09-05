# Remember where you were in an article, and move the Design link into /admin

Two unrelated feedback reports, both small pieces of client state, done in one worktree because
neither touches the other's files. Parent plan:
[260905b-feedback-reports-batch-three.md](260905b-feedback-reports-batch-three.md).

Both are from Greg, who is an administrator, so
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) says **build it** —
the question is only how small the first version can be.

## The two reports

**SPIDERYARN-READING2-1T**, 2026-09-05 09:36 UTC:

> Move the Design link on the logged-in Homepage into /admin

**SPIDERYARN-READING2-1W** (kind: suggestion), 2026-09-05 09:57 UTC:

> If I close and then reopen an article, it should ideally return me to the position/state/view that
> I was in. It's fine for this to be local to the device/browser, or whatever is simplest

## Stage 1 — the Design link (1T)

One link moves from the shelf's masthead ([`Library.tsx`](../../src/web/Library.tsx)) to the
`/admin` index ([`AdminPage.tsx`](../../src/web/AdminPage.tsx)), where it becomes a third `Entry`
beside Users and Feedback. `DESIGN_HREF` stays where it is in
[`router.ts`](../../src/web/router.ts); only its call site changes.

**`/design` itself is not gated, and this does not gate it.** `parseRoute` answers `design` for
anybody and `App.tsx` renders `DesignPage` for any signed-in reader — there is no `isAdmin` check on
the route and no admin API behind it. So after this change the link lives on an admin-only page
while the page it points at is open to every signed-in reader.

That is deliberately left alone, for the reason
[admin.md § The three refusals](../project/admin.md#the-three-refusals-and-only-one-of-them-is-a-gate)
already gives about the Admin link itself: **drawing or not drawing a link is a courtesy, not a
gate**, and `DesignPage` is in the bundle every reader downloads either way. Gating it would be a
new refusal nobody asked for, over a page that reads no data and shows nothing but our own colour
tokens and component variants. Recorded here so the next reader does not have to work out whether
it was an oversight. If it should be gated, that is a separate report.

**Nothing else *links to* the homepage Design link**, but five places described it, and a
cross-family review (F5) found four the first sweep missed. `DESIGN_HREF` had exactly two live call
sites (`router.ts` defines it, `Library.tsx` used it) and `tests/page-title.test.ts` tests the
`/design` page title, which is untouched. What went stale was prose about *"the masthead's three
links"*: [tooltips.md](../project/tooltips.md) in two places (the file inventory and a dated hover
measurement), [`Link.tsx`](../../src/web/Link.tsx)'s docstring about why `ref` is spelled out, and
two comments in [`Library.tsx`](../../src/web/Library.tsx) — one arguing where the design reference
should sit, one saying a hover opens "the other two" cards. All corrected in the same commit.
`tests/tooltip-on-link.test.tsx` mentions the three tooltips historically and asserts nothing about
the shelf, so it is left as the dated statement it is.

## Stage 2 — reopen where you left off (1W)

### What the URL already answers

Almost all of it. [url-state.md](../project/url-state.md) is emphatic that everything about how you
are looking at an article is in the query string — `at=` the section, `mode=`, `cols=`, `deep=`,
`sort=` and thirty more — and that **nothing lives in `localStorage`**. So this feature is not about
representing reading state. It is one question: *what remembers the query string, and when is it
replayed?*

That makes the whole thing: **remember the last query string per slug in `localStorage`, and put it
back when the reader opens that article with a bare address.** No server, no schema, no sync, and
per-device by construction — which is what Greg said was fine.

### The exception to "nothing lives in localStorage", stated plainly

That rule is about the *source of truth*: while you are looking at an article the URL is the only
thing that knows where you are, and a second store that could disagree with it is a bug waiting to
happen. This feature does not add one. `localStorage` here holds a **copy of an address you have
already left**, and it is read exactly once, before anything renders, to choose which address you
arrive at. From that moment on the URL is the only writer, exactly as before. The same shape as
`referee-card.ts`, `install-hint.ts` and `mic-devices.ts`, which are the existing exceptions.

### Which parameters are remembered

Remembered — everything that is *how you are looking at it*, and inert on arrival:

`at`, `cols`, `text`, `spine`, `mode`, `deep`, `diagram`, `dx`, `dhue`, `referee`, `crits`,
`refscale`, `remember`, `sort`, `gate`, `rank`, `bar`, `term`, `idea`, `quote`, `event`

Deliberately **not** remembered, each with its reason:

| Param | Why not |
|---|---|
| `note` | opens the explanation dialog and jumps the page. A dialog is something you did, not somewhere you were. |
| `panel` | a drawer is not a place you were — the app's own `carriedSearch` already drops it between an article's pages. |
| `thread` | names an open conversation. See `mode=chat` below. |
| `find`, `run`, `runs`, `match`, `order`, `conf` | search mode's matcher and its results. A search washes the passages that match; replaying last week's search over the prose is a surprise, not a restoration. Excluded as a block so the rule is one sentence rather than six. |

**Three values of `?mode=` are remembered as *no mode*: `chat`, `diagram` and `remember`** —
`NEEDS_AN_EXPLICIT_PRESS` in [`last-view.ts`](../../src/web/last-view.ts). Their subordinate
parameters (`?diagram=`, `?dx=`, `?dhue=`, `?remember=`) are still kept, so pressing Diagram or
Remember later returns the reader to the picture or the half they had chosen.

**How that list got to three is the most useful thing in this document.** The first version dropped
only `chat`, on the strength of a survey that read every mode's hook and reported **all thirteen
inert on arrival** — no model call, no write, no dialog. That survey was wrong twice, and GPT Sol's
review of the code established both (F1, F2):

- **`diagram` fires a paid call.** `useSimilar` POSTs `/api/similar` for the Force picture and
  `useProjection` POSTs `/api/projection` for Drift and Trail, on arrival. The panel's own comment
  says so outright — *"merely opening `?mode=diagram` fires this POST — it is the one fetch in the
  reading view a reader can start without pressing anything that says what it will do"* — and the
  survey had read `useIllustrated` and not `useSimilar`. Bare `?mode=diagram` would have been safe,
  since `?diagram=` defaults to `sketch`; but we remember `?diagram=` too, so restoring the mode
  restores the picture with it.
- **`remember` opens a conversation.** `RememberBand` mounts the same `ConversationBand` chat does,
  and its arrival effect calls `startNew()` — which opens a conversation, focuses the composer and
  writes a `?thread=`. The claim that only chat did this was in this plan and in the code comment,
  and both were false.

`chat` stays on the list for the original reason, which was never cost: `begin` in
[`useChat.ts`](../../src/web/useChat.ts) is client-side until the reader sends something. A
conversation panel that opens by itself reads as the app *starting* something.

**The lesson worth carrying**, since it cost two P1s: *"I read the hook and it looked inert"* is not
evidence that a mode is inert. Three of thirteen were not, and the two that were missed were missed
by reading the wrong hook in the right file. A survey of thirteen things by one agent in one pass is
a lead, not a result.

Two things the survey did settle correctly: `?find=`, `?run=`, `?runs=`, `?event=`, `?crits=` and
`?refscale=` are pure client-side selectors over data already in the page — so excluding the search
matcher above is a **product** call about what a reader wants on arrival, not a cost one. And
`useArc` does auto-start a paid job for an owner opening an article with no hierarchy arc yet, but it
lives in `OwnedReader` above the mode dispatch, so it fires on a bare `/read/<slug>` today exactly as
it would after a restore. This feature changes nothing about it.

### When it is replayed, and when the link wins

**Only when the incoming address carries none of the article's parameters at all** — not just none
of the remembered ones. So `?note=`, `?thread=`, `?find=` or a bare `?panel=` link wins outright and
nothing is restored on top of it. A shared link is a statement about where the reader should be, and
it must beat a memory of where *this* browser last was; getting that backwards breaks sharing, which
is half of what the URL state is for ([public-shelf.md](../project/public-shelf.md),
[links.md](../project/links.md)).

The test is therefore over the **full** article parameter list, remembered and excluded alike, and
that list is the one thing in this feature that can go stale: a thirty-sixth parameter added later is
neither remembered nor recognised, so a link carrying only it would be overwritten by a restore. A
test pins the list against `params.ts` so that adding one is a decision rather than an omission.

### Decisions, explicitly

- **Silent, not visible.** No banner, no "we put you back". The app already restores a position from
  a URL without announcing it, and the reader who scrolls to the top has undone it in a gesture. A
  "start from the top" affordance is deferred; nobody has asked for one.
- **`replaceState`, not `pushState`.** The bare address is a spelling the reader arrived in, not a
  page they visited — the same call every rewrite in `main.tsx` makes. Back goes to the shelf.
- **No stored state on this device** — the overwhelmingly common first case — is simply nothing to
  restore, and the reader gets the top of the article as they always did. Same for a private window,
  a cleared cache, or a different browser. This is a convenience, and it is allowed to be absent.
- **A remembered block id that no longer exists** costs nothing: `scrollToBlock` returns when the
  row is not in the DOM ([`scroll.ts`](../../src/web/scroll.ts)), which is the same graceful nothing
  a stale shared link already gets. Block ids are minted once and preserved
  ([block-ids.md](../project/block-ids.md)), so this needs an article to have genuinely changed, and
  the cost is landing at the top.
- **`localStorage` can throw**, not merely be empty — Safari's private mode throws on write, and a
  browser set to block site data throws on read. Every touch is wrapped, and a failure means the
  feature does nothing rather than the page not rendering.
- **Which of the article's three pages you were on is not remembered.** The path says which article
  and which page; we remember only the query string. Reopening `/read/x` gives you the reader with
  your state, not the metadata page.
- **The key is not scoped to the account, and that is deliberate.** Two people sharing one browser
  profile, or one person signing out and in as somebody else, would find the other's position
  restored on an article they can both open. What that discloses is a block id — *somebody using
  this browser had read this far* — on a document the second reader is already allowed to read, and
  it is one scroll to undo. Scoping it would mean the key waiting on the session before it could be
  read, which is a whole render later, so the restore would land after the first paint instead of
  before it. Not worth it for that. Compare `lib/offline-store.ts`, which *does* partition by
  reader, and has to: it caches the articles themselves.

### Where the code goes

One new module, [`src/web/last-view.ts`](../../src/web/last-view.ts), following the shape of the
three existing `localStorage` exceptions: pure decisions at the top, guarded storage below, and one
hook.

- `rememberableSearch(search)` — the filtered query string, pure. Filtered **textually**, pair by
  pair, rather than through `URLSearchParams`, so `cols=0,1,2` survives as itself. That is the same
  reason `router.ts`'s rewrites are textual, and the ninth address bug is what it is guarding
  against.
- `hasArticleState(search)` — does this address already say anything, pure.
- `readLastView` / `writeLastView` — guarded, one key per slug.
- `useLastView(slug)` — the hook, called near the top of `ArticlePage`.

**In `ArticlePage` rather than in `main.tsx`.** `main.tsx`'s rewrites run once per page load, and
the commonest way to reopen an article is a click on the shelf, which is a client-side `navigate()`
and never re-runs that file. `ArticlePage` mounts on both paths, and its `slug` prop changes on the
third. One mechanism covers all of them.

**A layout effect, keyed on the slug**, so the address is settled before anything paints, and long
before `useReadingPosition` mounts — that hook lives inside the reader, which is not rendered until
the article has been fetched, so it reads the restored `?at=` exactly as it reads a pasted one.

**The writer does not re-render anything.** It subscribes to address changes through `router.ts`'s
existing history listener rather than through `useAddress()`: `?at=` is rewritten roughly once a
second while anybody scrolls, and a `useState` at `ArticlePage` level would re-render the entire
reading view each time — the staleness/memoisation work of 2026-09-04 exists precisely to stop that.

### What is deferred, and why

- **Any cross-device memory.** Greg said local was fine. A `reader_article` column would be the
  obvious next step if it is ever wanted, and it changes nothing here — this would become the
  fallback.
- **Pruning old entries.** Each entry is a few dozen bytes against a ~5MB quota, so a reader would
  need tens of thousands of articles for it to matter, and a `QuotaExceededError` is already caught
  and ignored. Not worth read-modify-writing an index on the scroll path.
- **Remembering the search matcher** (`find`/`run`), and **remembering which of the article's three
  pages you were on**. Both are in the table above; either could be added later without changing the
  shape.
- **A visible "back to the top" affordance** for a reader who did not want the restore.

## The cross-family review

[260905d-code-review-prompt.md](260905d-code-review-prompt.md) →
[260905d-code-review-sol.md](260905d-code-review-sol.md) (GPT Sol, high effort, 2026-09-05).
**Verdict: refuse**, on two established P1s. Both were real, both were checked in the code before
being acted on, and all five findings are fixed.

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 | P1 — restoring `?mode=diagram` starts an unrequested paid call (`/api/similar` for Force, `/api/projection` for Drift and Trail) | **Fixed.** `diagram` added to `NEEDS_AN_EXPLICIT_PRESS`; `?diagram=`, `?dx=`, `?dhue=` still remembered |
| F2 | P1 — `?mode=remember` opens a conversation on arrival exactly as chat does, contradicting the claim that only chat did | **Fixed.** `remember` added to the same set; `?remember=` still remembered |
| F3 | P2 — the `useQueryStates` scan is formatting-dependent; a one-line call is missed silently | **Fixed.** The test now counts `useQueryStates(` occurrences and fails unless every one was parsed. Verified the guard fires on the exact one-line form |
| F4 | P2 — `StrictMode` replays the layout effect, so storage is read twice per open, against the "exactly once" claim | **Fixed.** A `restoredFor` ref |
| F5 | P3 — five places still describe Design as being on the masthead | **Fixed**, all five |

Sol also confirmed, independently, that it found no defect in the slug guard, the synchronous
`navigate()` ordering, parent-layout-versus-child-passive effect ordering, Back/Forward behaviour,
the current parameter inventory, the `localStorage` exception handling, or the byte-preserving pair
filter — which were the six things the prompt asked it hardest to break.

Nothing was overruled.

## The gates, and the one red that is not ours

Run in the worktree on 2026-09-05, after the review fixes:

- `npm run typecheck` — clean, 1317 files across three projects.
- `npm run check` — typecheck, build, cycles, chain and committed all clean. Lint, knip, complexity
  and dupes have their usual non-gate findings.
- `npm test` — **1 failed | 685 passed | 1 skipped** files; **12,343 tests passed**.
- Browser pass against a live dev server, signed in as an administrator: both features verified
  end to end, including the negative case (an explicit `?at=` in the URL is not overwritten) and a
  frame-by-frame check that the restore lands before the article paints rather than jumping.

**The one red is inherited from `dev` and is not ours**: `tests/store-migration-registry.test.ts`
fails on `tests/jobs.test.ts` growing a block that accounts for no mutation. That file is not in this
branch's change set (`git diff 750c91fd --name-only`), and the failure reproduces when the suite is
run alone.

`tests/admin-store.test.ts` was also red in the first full run and **passes alone (3/3)** — box
contention, at a load average above 60 with several other agents' suites running. Worth stating
because this branch touches `AdminPage.tsx`, so "an admin test went red" is exactly the coincidence
that deserves a second look rather than a shrug.

## Questions recorded rather than asked

This ran unattended, so these are written down rather than put to Greg
([feedback-reports.md](../project/feedback-reports.md)):

1. Should `/design` itself be admin-gated, now that its only link is on an admin page? Judged out of
   scope above — the report asked for the link to move, and the page holds no data.
2. Should the restore be announced? Judged no, above.
3. Should `mode=chat` really be dropped on restore, or should the chat mode's own
   start-a-conversation-on-arrival behaviour be what changes? Dropping it is the smaller change and
   leaves chat mode exactly as it is for every link that names it.

## See also

- [url-state.md](../project/url-state.md) — what is in the query string, and the rule this makes one
  exception to
- [feedback-reports.md](../project/feedback-reports.md) — how a report ends
- [admin.md](../project/admin.md) — why a drawn link is never a gate
