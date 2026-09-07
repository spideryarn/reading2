# The authenticated API's dispatch becomes enumerable — and the matrix test that has to come first

Status as of 2026-09-07: **draft, revised after design input, not yet reviewed by Sol or built.**
Evidence gathered at `d4b503b4`; `src/routes.ts` is byte-identical at the worktree HEAD, so every
line number below is live. Design input from GPT 6 Astra (high) and Fable is folded in and
attributed.

## Brief

> I was interested in whether there are large files that we should refactor.
>
> — Greg, 2026-09-06

Greg then asked for the work to run autonomously after an 8-hour wait for other agents to land,
naming `serveAuthenticatedApi` as the target and a **route table** as the shape.

## What changed between the survey and this plan

The survey ran on the evening of 2026-09-06; 51 commits landed overnight. Re-measured:

| Survey target | State on 2026-09-07 |
|---|---|
| `src/web/styles.css` | **Solved.** The A10 style-ownership worktree landed. Now a 2.7 KB manifest of `@import`s over ~20 files in `src/web/styles/`. |
| `src/web/App.tsx` | **Not ours, and finished but unpushed.** `.claude/worktrees/a1-a3-reader-composition` is 8 commits ahead of `dev` with `App.tsx` down to **407 lines**; its tmux session was mid-task while this was written. Somebody should push it. Nobody else should touch it. |
| `src/routes.ts` | **Unclaimed.** The finding is one function inside it. |

## The finding, measured

`serveAuthenticatedApi` — `src/routes.ts:6555–8180`; only caller `serveApi` at `:6277`, which
awaits it at `:6401`.

| Measure | Value |
|---|---:|
| Raw / code / comment lines | 1,626 / 684 / 890 |
| Endpoint guards | **81** |
| Admin gate | 1 (`:6974`) |
| Nested handler/gate conditionals — *not* registrations | 27 |
| Matchers, all evaluated eagerly before any dispatch decision | **67** (51 regex, 16 exact) |
| Biome `noExcessiveCognitiveComplexity` | **244 against a threshold of 25** — highest in the tree |
| Churn | 100 of the last 2,195 non-merge commits (4.6%) |

The survey's "109 branches" was 81 endpoint guards + 1 admin gate + 27 conditionals *inside*
handlers (Astra, AST inventory). Every one of the 81 is exactly `matcher && req.method === literal`.
None has an extra conjunct and none deliberately falls through.

## The shape, and the fork that had to be settled

Three independent opinions, and they did not agree:

- **[260906h § T3.1](260906h-improve-the-codebase-fourth-sweep.md), written 2026-09-06** — this
  repo's own settled answer: *"A per-domain **file**, not a per-route **table**… each domain can
  become a standalone `async function tryChatRoutes(req): Promise<boolean>` called in sequence…
  `src/public/routes.ts` already runs a real data-driven table successfully because that surface is
  homogeneous (validate → one read → 200), while the authenticated surface has SSE streams, four
  module-scope lock registries, uploads and live sessions."*
- **Astra** — one ordered table of `{ method, pattern, handler }`, method mismatch meaning
  *continue*, gates outside the table, handlers owning their own response and **returning nothing**.
- **Fable**, asked only to arbitrate scope — *"per-area route modules each contributing an ordered
  slice."*

**Settled: an ordered list of entries, grouped by domain inside one array, with no boolean
protocol.** The two positions are not actually exclusive, and each fixes the other's weak point:

- 260906h's objection is to a *data-driven* table, where the data drives behaviour — which is what
  `src/public/routes.ts` does, and it is right that the authenticated surface is too heterogeneous
  for it. An ordered list of closures is not that. Each handler keeps whatever shape it has now,
  including hijacking the response to stream.
- Astra's objection to `Promise<boolean>` is the fallthrough hazard, and **this repo has already
  written that danger down**: `src/public/routes.ts:361` — *"a `false` returned from here is one
  `if` away from being a fallthrough into the authenticated table."* Adopting a boolean protocol
  for 14 domain functions would create 14 places to make exactly that mistake.
- The domain grouping is what buys 260906h's stated payoff — fewer simultaneous editors in one
  region — and it makes a later move of each group to its own file a cut rather than a redesign.

So: **the table is the mechanism, the domain grouping is the organisation**, and moving groups to
separate files is a further, separate change that is Greg's call and is not in this plan.

## The constraints anything here must respect

Numbered so the review and the implementation briefs can quote them.

1. **[GATE] The pre-dispatch boundary is ordered and must run even when nothing matches.**
   `assertVerifiedUser` (`:6563`) → `setRequestOwner` (`:6572`) → `setMonitoringUser` (`:6578`) →
   the admin predicate (`:6597`) and its refusal (`:6974`) → *only then* route selection. The gate
   must fire when no endpoint matches, when the method is unsupported, and when captures are
   malformed. Making it one entry among 81 loses that.
   [admin.md:86](../project/admin.md): *"It sits above the route table, so an admin endpoint added
   later is behind it whether or not whoever adds it remembers."*
2. **[HTTP] Method mismatch is a 404 and there is no 405 on this surface.** The terminal `send(res,
   404, …)` at `:8177` must stay a **sent** response, not a thrown error — the caller's `failure`
   logging value would change. Preserve `req.method` and `rawUrl` in the message, including the
   undefined-method case. No `Allow` header, no HEAD/OPTIONS handling, no URL decoding,
   normalisation or trailing-slash tolerance. Copying `src/public/routes.ts:390`'s 405 policy would
   be a behaviour change.
3. **[URL] Match on `path`, never `rawUrl` or `req.url`.** The
   [260901a postmortem](../postmortems/260901a-the-route-the-query-string-hid.md): 32 matchers ran
   against a string carrying the query string, so `GET /api/chat/<slug>?summary=1` matched nothing
   for four days. The rename is *"a speed bump, not a wall"* — `.exec(req.url ?? "")` still compiles.
4. **[DECODE] Body-read and slug-decode order differs per route and is observable.** Visibility
   parses its body at `:7230` *before* decoding the slug at `:7234`; shelf PATCH decodes *before*
   reading its body at `:7089`. POST chat/search/criteria read bodies first (`:7645`, `:7745`,
   `:7794`). **One global decoding policy cannot preserve both orders.** Also: authenticated `part`
   lets `decodeURIComponent` throw → outer catch → 500, while public `slugFrom` converts it to 400
   (`src/public/routes.ts:347`). Copying the public helper changes behaviour.
5. **[LIFETIME] Awaiting the handler is part of correctness.** The catch/finally lives in `serveApi`,
   which awaits at `:6401`. Streaming handlers must stay awaited to completion — the spend collector
   depends on it at `:6246`. The dispatcher must neither call `send` nor end the response after a
   handler returns. Local embedding catches at `:7485` and `:7517` stay.
6. **[RETURN] Two guards do not end in a top-level `return;`.** `similar` (`:7477`) and `projection`
   (`:7515`) return `withSpendAttribution(...)` from an inner block. A transcription tool looking
   for a trailing `return;` misclassifies them.
7. **[REGEX] Reject `global` and `sticky` patterns at registration.** All 51 literals currently have
   no flags and are freshly constructed per request, so hoisting them to module scope is safe today.
   A future `/g` would make matching depend on the previous request via `lastIndex`.
8. **[TEXT] Four tests read `src/routes.ts` as a string, and they fail silently.**
   `tests/cacheable-covers-artefact-routes.test.ts:105–140` derives every artefact route by grepping
   for `const (\w+) = /^\/api\/<kind>\/([\w.%-]+)$/.exec(path)` and then for the literal
   `if (<binding> && req.method === "GET")`. A rewrite deletes both halves of what it greps for, and
   a missed match is **`filter`ed out rather than asserted** — the exact
   [silent-success](../reusable/silent-success.md) class, and this test already has a documented
   instance of it. Same shape at `owner-isolation.test.ts:1299`, `referee-scan-route.test.ts:336`
   (which does it correctly, with a loud empty-match control) and `source-store.test.ts:67`.
9. **[ISOLATION]** `tests/owner-isolation.test.ts` cuts the dispatcher's *anonymous region* and
   asserts it names no table and imports nothing outside a short pinned list. A rewrite must not
   widen it.

## The ordering hazard is smaller than the comments claim — and that is a trap

Astra enumerated the actual selections. **There are no competing same-method endpoint guards.** Both
documented overlaps are resolved by the method, not by the order:

| Request | Selected |
|---|---|
| `GET /api/library/search` | library search, `:7081` |
| `PATCH /api/library/search` | shelf entry, slug `search`, `:7088` |
| `POST /api/chat/a/live-tool` | live tool, `:7656` |
| `PATCH /api/chat/a/live-tool` | thread rename, id `live-tool`, `:7715` |
| `GET /api/chat/a/live-tool` | the terminal 404 |

Verified by hand at `:7081`/`:7088` and `:7656`/`:7715`. So the comment at `:6620` — *"Before the
`:slug` pattern below, and it has to be"* — describes a hazard the method check currently prevents
independently. Keep the comment and its history; add the qualification.

**The trap this sets for stage 1:** swapping the two library guards is an **equivalent mutation
today**. Using it as the positive control would prove nothing while looking like proof. The general
first-match rule needs a *synthetic* pair of overlapping same-method entries to test.

Fourteen matchers are shared by two guards each (`readerRoute`, `glossary`, `comments`, `one`,
`chat`, `oneThread`, `searches`, `oneRun`, `criteria`, `oneCriterion`, `refereeClaims`, `allJobs`,
`upload`, `job`), which is why entries are per *guard*, not per matcher.

## The domains are already contiguous

The chain was never shuffled; it grew in clusters, so grouping is mostly cutting contiguous ranges:

| Lines | Domain | Guards |
|---|---|---:|
| 6974–7038 | admin (gate, then 4 routes) | 4 + gate |
| 7069–7092 | library / shelf | 4 |
| 7092–7107 | models, transcribe, feedback — genuinely miscellaneous | 3 |
| 7107–7192 | reader, shelfOpen | 3 |
| 7192–7271 | article, link preview/summary, visibility, source, asset, export, metadata, tweets | 9 |
| 7271–7322 | glossary, lookup, askTerm | 4 |
| 7322–7386 | ideas, quotes, timeline, quiz, debate, quizMark | 6 |
| 7386–7526 | sketch, illustrated, arc, similar, projection | 6 |
| 7526–7613 | comments | 6 |
| 7613–7735 | chat, live sessions | 11 |
| 7735–7777 | searches | 4 |
| 7777–7899 | referee — criteria, claims, scan, mirror | 8 |
| 7899–8111 | jobs, uploads | 8 |
| 8111–8180 | billing | 4 |

Two interleaves to move deliberately, after stage 1 and never before: **`uploads` (`:7903`–`:7939`)
sits between `allJobs` GET (`:7899`) and POST (`:7939`)**, and **`readerRoute` GET (`:7107`) and
PATCH (`:7176`)** are split by an unrelated handler.

## What does not justify this

- **The eager matchers are not a performance argument.** Fable: *"do not sell that as a reason."*
  Astra will not put a number on it without measurement, and notes a table rebuilding 81 closures
  per request could spend the saving on allocation — so entries must be **static**, built once at
  module scope. No stage here claims a speed win.
- **"Hot file, therefore split" proves too much.** Every router is touched by every endpoint. The
  valid narrow form: unrelated features all append to *the same hunk*, which git cannot merge. 36 of
  783 non-merge commits since 2026-09-01 touch this function; merge `cf780c7e` records seven textual
  conflicts including this file.
- **No route gets shorter and no line count falls.** 260906h says so plainly. The payoff is an
  enumerable dispatch contract and fewer simultaneous editors in one region.

## Stages

**Stage 1 — the route/method matrix test, and nothing else.** The prerequisite Sol named in
[260826m § 3.1](260826m-simplification-audit.md) and 260902e named again, asked for four times over
five weeks and never built. **It is worth landing on its own merits whether or not stage 2 or 3 ever
happens.** Two halves, per Astra's [P1 ORACLE]:

- *Structural manifest.* Parse `git show d4b503b4:src/routes.ts` with an AST parser — never a
  hand-copied second list — and extract, in order, each guard's method, its matcher's exact source
  and flags, and its identity. Reject any syntax the extractor does not understand, and fail if the
  inventory is not 81 guards + 1 gate + 67 matchers. This is what gives coverage over *all* path
  strings; a finite corpus cannot.
- *Differential branch-entry execution.* Replace each handler body with a unique observation
  recording guard identity and raw captures, run a corpus, and compare **selected identity, captures,
  admin refusal and exhaustion** — not merely HTTP status, because a matched handler can legitimately
  return 404 (`tests/the-query-string-does-not-decide-the-route.test.ts:137` explains that trap).
  Needs no database. Corpus per Astra: a witness for every entry; every alternative in `cancel|retry`
  and the image extensions; every declared method plus HEAD, OPTIONS, unknown, lowercase, undefined;
  both overlap families crossed with every method; empty captures, missing/extra segments, trailing
  slashes, hash lengths 63/64/65, uppercase hex; `%`, `%25`, encoded slash and dot, double encoding;
  bare and near-miss admin paths for admin and non-admin users; query strings through the caller's
  real splitting.

  Every registration must have a selecting witness, and a missing witness fails the harness.

  **Mutation controls, to prove it can fail:** stop on first path match regardless of method (library
  and chat cases must go red); remove the bare `/api/admin` case; swap two handler bodies keeping
  their ids; decode the whole path. **Not** the library-guard swap — that is equivalent today.

Done when green, and when each mutation above is watched red.

**Stage 2 — make the four source-text tests fail loudly.** Before anything moves, and while what
they grep for still exists. `referee-scan-route.test.ts:336`'s empty-match control is the model.

**Stage 3 — the ordered entry list, in guard order, grouped by domain.** Static module-scope
registrations; gates outside; handlers unchanged and still awaited. One domain per commit, suite
green each time. Re-judged after two domains rather than run straight through: the domains touching
the module-scope lock registries (`:1010`, `:3800`, `:3970`, `:4211`) — chat, live, jobs — are
materially harder than billing or glossary, and the plan should not pretend otherwise.

**Not in scope**, named as passed over: moving domains into separate files (Greg's call; stage 3
makes it cheap); anything inside the 81 handler bodies; the eager-matcher cost; a 405 policy.

## Open

- Whether stage 1 alone is a defensible finish. I think it may be.
- Three worktrees carry unmerged `routes.ts` edits (`delete-article-permanently`, `critiques-mode`,
  `a1-a3`). Each will conflict; each conflict is a proposal to show Greg, not an edit.
