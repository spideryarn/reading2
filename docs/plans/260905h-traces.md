# The real request trace of Plain, Ideas and Chat, before and after the extraction

[260905e-main-app-architecture-review.md](260905e-main-app-architecture-review.md)'s checklist asks
for the real request trace of Plain, Ideas and Chat on one fixture article before anything is lifted
out of `App.tsx`; finding **F9** in
[260905h-plan-review-sol-2.md](260905h-plan-review-sol-2.md) says why the tests already in the tree
cannot stand in for it — **none of them rejects an *additional* request**, so an extraction that
added an Ideas GET to Plain would leave every one of them green. So the trace was captured in both
trees and diffed. **All three diffs are empty.**

> **Captured twice, and the first one was wrong.** The 2026-09-05 capture mounted
> `NuqsAdapter → App`, while `src/web/main.tsx` mounts
> `StrictMode → LucideProvider → NuqsAdapter → AppBoundary → App`. Without `<StrictMode>` React
> invokes each effect once, so that capture was not the lifecycle any reader gets, and a duplicate
> request caused only by the double invocation could have passed every assertion built on it —
> GPT Sol, F11 in [260905h-code-review-sol.md](260905h-code-review-sol.md). It was re-captured on
> 2026-09-06 under `StrictMode → NuqsAdapter → AppBoundary → App`, in **both** trees, and the
> traces below are the second capture. `LucideProvider` is left out because it renders its children
> and issues nothing.
>
> The traces got longer — Plain 9 → 12, Ideas 12 → 16, Chat 11 → 16 — and the diff between the two
> trees is still empty in all three, which is the thing this document exists to say.

## The two trees, and the commands

Both are the same commit, `6eecb377f24d92446086a006d5b3103daae40aef`. At the first capture the
**after** tree added one change: `IdeasBand`, `VisitorIdeasBand` and `useIdeasMode` moved out of
`src/web/App.tsx` into `src/web/modes/ideas/IdeasMode.tsx` unchanged, with
`tests/passage-mode-cleanup.test.tsx`'s import moved with them. By the 2026-09-06 re-capture it also
carried the whole of stage 1 — `FeatureBoundary` around both Ideas branches, and `retireActivation`
— so the second diff is over a wider change than the first, and is still empty.

| | path |
| --- | --- |
| before | `.claude/worktrees/a2-trace-base` (detached at the base commit) |
| after | `.claude/worktrees/a2-mode-failure-containment` |

One capture file, identical bytes in both trees (`tests/zz-trace-capture.test.tsx`, a copy of the
standing test with the three `toEqual`s replaced by writes, deleted from both trees afterwards —
see below), run alone in each:

```
A2_TRACE_LABEL=before npx vitest run tests/zz-trace-capture.test.tsx   # in the before tree
A2_TRACE_LABEL=after  npx vitest run tests/zz-trace-capture.test.tsx   # in this tree
diff /tmp/a2-trace-before-plain.json /tmp/a2-trace-after-plain.json    # and ideas, and chat
```

It reuses `tests/public-network-trace.test.tsx`'s harness wholesale — the `useSession` and
`lib/supabase` mocks, the `fetch` stub that pushes `{url, method, auth}` onto `trace`, the fake
server `reply()`, the jsdom stubs, `settle()` and `open()`. Every capture is a **signed-in owner**
(`{id: "owner-1", …}`) on the same fixture article, `a-piece`, with `trace` emptied immediately
before each scenario:

- **plain** — `open()`, no `?mode=`.
- **ideas** — `open()` on the default view, then a **real `click()`** on the Ideas dock radio, which
  is what arms an activation token, then `settle()`. Not `?mode=ideas`, which is a different
  gesture.
- **chat** — `open("?mode=chat")`.

Dates: first capture 2026-09-05, re-capture under `<StrictMode>` 2026-09-06. Machine: `/home/greg/`
— the Hetzner box. The re-capture used the same two trees and the same commands, with the capture
file taken from the corrected standing test so that the harness and the assertion cannot drift.

## The normalisation rule

**Consecutive `/api/jobs` polls collapse into one entry annotated `repeated: true`.** That is the
only normalisation, and it exists because the poller's cadence is deliberately time-dependent
(`src/web/jobEngine.ts`) — how many times it fires inside six settle turns is a fact about the box's
load rather than about the code. The *fact* that it repeated is kept, because "polled once" and
"polled in a loop" are different behaviours.

**Nothing else is touched.** Not the ordering, not the query strings, not the `auth` field. It
fired in the re-capture and had not in the first one: under `<StrictMode>` the job engine's
subscription runs twice and polls twice in a row, so the **first** `/api/jobs` entry in each trace
below carries `repeated: true`. The second `/api/jobs` is a separate point in the mount, after the
article and the record-open POST, and is not collapsed.

## The traces

As captured in the **after** tree, under `<StrictMode>`, 2026-09-06. The before tree's three files
are byte-identical. `repeated` is shown where the rule fired.

**Where the doubles come from.** React invokes every effect twice under `<StrictMode>`, so a hook
whose fetch is not de-duplicated issues it twice. `/api/glossary` and `/api/arc` appear once because
theirs is; `/api/article`, `/api/comments`, `/api/chat?summary=1`, `/api/ideas` and
`/api/reader?slug=` appear twice because theirs is not. Whether the duplicates are worth removing is
a separate question from whether they are being held still, and this document is only the second.

### Plain — 12 requests

```json
[
  { "url": "/api/jobs",                  "method": "GET",  "auth": "Bearer t", "repeated": true },
  { "url": "/api/article/a-piece",       "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/article/a-piece",       "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/jobs",                  "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/library/a-piece/open",  "method": "POST", "auth": "Bearer t" },
  { "url": "/api/comments/a-piece",      "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/chat/a-piece?summary=1","method": "GET",  "auth": "Bearer t" },
  { "url": "/api/glossary/a-piece",      "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/arc/a-piece",           "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/comments/a-piece",      "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/chat/a-piece?summary=1","method": "GET",  "auth": "Bearer t" },
  { "url": "/api/reader",                "method": "GET",  "auth": "Bearer t" }
]
```

### Ideas — 16 requests (Plain's twelve, then four)

```json
[
  { "url": "/api/jobs",                  "method": "GET",  "auth": "Bearer t", "repeated": true },
  { "url": "/api/article/a-piece",       "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/article/a-piece",       "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/jobs",                  "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/library/a-piece/open",  "method": "POST", "auth": "Bearer t" },
  { "url": "/api/comments/a-piece",      "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/chat/a-piece?summary=1","method": "GET",  "auth": "Bearer t" },
  { "url": "/api/glossary/a-piece",      "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/arc/a-piece",           "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/comments/a-piece",      "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/chat/a-piece?summary=1","method": "GET",  "auth": "Bearer t" },
  { "url": "/api/reader",                "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/reader?slug=a-piece",   "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/ideas/a-piece",         "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/reader?slug=a-piece",   "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/ideas/a-piece",         "method": "GET",  "auth": "Bearer t" }
]
```

The press costs four requests: the reader's per-article row and the ideas artefact, in that order,
once per effect pass. No `POST /api/jobs`, because this fixture answers `/api/ideas/` with a
present-but-empty artefact rather than a 404.

### Chat — 16 requests

```json
[
  { "url": "/api/jobs",                  "method": "GET",  "auth": "Bearer t", "repeated": true },
  { "url": "/api/article/a-piece",       "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/article/a-piece",       "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/jobs",                  "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/library/a-piece/open",  "method": "POST", "auth": "Bearer t" },
  { "url": "/api/chat/a-piece",          "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/comments/a-piece",      "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/chat/a-piece?summary=1","method": "GET",  "auth": "Bearer t" },
  { "url": "/api/glossary/a-piece",      "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/arc/a-piece",           "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/chat/a-piece",          "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/comments/a-piece",      "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/chat/a-piece?summary=1","method": "GET",  "auth": "Bearer t" },
  { "url": "/api/reader?slug=a-piece",   "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/reader?slug=a-piece",   "method": "GET",  "auth": "Bearer t" },
  { "url": "/api/reader",                "method": "GET",  "auth": "Bearer t" }
]
```

Two orderings differ from Plain's and Ideas', and both are properties of arriving at Chat by URL
rather than of the extraction: the panel's full `/api/chat/a-piece` lands *before* the reading
view's `?summary=1` one, in each pass, and the two `/api/reader?slug=` reads come out together ahead
of the bare `/api/reader` rather than straddling it.

## The diff

| | result |
| --- | --- |
| plain | **empty** |
| ideas | **empty** |
| chat | **empty** |

The positive control held: every capture asserted its trace was non-empty, and all three were (12,
16, 16 entries) — two empty files would have diffed clean too. The same table held for the first,
pre-`StrictMode` capture, at 9, 12 and 11 entries.

## It is a standing test now, not only this file

The capture was byte-identical across four runs of the same tree, so it is stable enough to assert
rather than only to record. It lives as
[`tests/the-ideas-extraction-changed-no-requests.test.tsx`](../../tests/the-ideas-extraction-changed-no-requests.test.tsx),
which runs the same three scenarios and `toEqual`s the whole array against the three lists above —
the only shape of assertion an *extra* request cannot survive, which is F9's point. The `repeated`
annotation is left out of the comparison, because it is the one time-dependent thing in the trace;
the poller's cadence is pinned separately, under fake timers, in
`tests/job-engine-drives-with-no-view.test.ts`.

Seen red before it was believed: adding one bogus entry to the Plain list failed two of the three
tests. Three consecutive green runs followed on this tree, plus `npm run typecheck` and
`npx biome check` clean on the file. It was seen red a second time on 2026-09-06, without anybody
arranging it: mounting the harness under `<StrictMode>` made all three lists wrong, which is the
sensitivity the file is for.

**When it goes red, read it as a question rather than as a bug.** A changed list is a changed
network trace, which may be exactly what was intended — update the lists and this doc together, and
say in the commit which request moved and why.
