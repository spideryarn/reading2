# The authenticated API's dispatch becomes enumerable — and the matrix test that has to come first

Status as of 2026-09-07: **reviewed, stages 1 and 2 building.** Evidence gathered at `d4b503b4`;
`src/routes.ts` is byte-identical at the worktree HEAD, so every line number below is live. Design
input from GPT 6 Astra (high) and Fable, and a plan review from GPT Sol
([review](260907b-split-the-authenticated-api-dispatch-by-domain-review-sol.md),
[prompt](260907b-split-the-authenticated-api-dispatch-by-domain-review-prompt.md)), are folded in
and attributed. Sol returned **no P0**; it reversed the shape decision, rejected stage 1's first
design as circular, narrowed stage 2 from four files to one, and corrected the ordering model in
both directions. Each correction is marked below.

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

**Settled: per-domain functions in the same module, as 260906h said.** I initially settled this the
other way — an ordered list of static entries — and Sol's review sent it back. Recording both, since
the reasoning matters more than the verdict:

- My argument was that 260906h's objection is to a *data-driven* table (behaviour derived from data,
  as in `src/public/routes.ts`) and that an ordered list of closures is not that; and that a boolean
  protocol creates fourteen instances of the fallthrough hazard this repo already documented at
  `src/public/routes.ts:361` — *"a `false` returned from here is one `if` away from being a
  fallthrough into the authenticated table."*
- **Sol's answer**, which I accept: the boolean hazard is real but bounded and specifiable — each
  handled arm must await all its work, streams included, before returning `true`, and a helper
  returns `false` only after every *complete* matcher-and-method pair has missed. A table, meanwhile,
  buys nothing here that same-module functions do not, and same-module functions are the smaller
  change.
- **Astra dissents** and would have taken the table, on the grounds that no-return-value dispatch
  cannot be got wrong the way a boolean can. Overruled because Sol and this repo's own settled
  decision agree against it, and because `noImplicitReturns` plus an explicit await rule covers the
  failure Astra names. Its residual point stands and goes in the stage 3 brief: *`noImplicitReturns`
  cannot stop someone starting a stream without awaiting it and returning `true`.*

The signature is **not** `(req: IncomingMessage)`. Domains need the whole `ApiRequest` — `res`,
`path`, `query`, sometimes `rawUrl` — and the feedback route at `:7103` additionally needs the
verified user:

```ts
async function tryChatRoutes(request: ApiRequest): Promise<boolean>
async function tryMiscRoutes(user: VerifiedUser, request: ApiRequest): Promise<boolean>
```

Moving each domain into its own **file** is a further, materially harder change — it is where
ownership, import isolation and the `processSingleton` identities below actually have to move — and
it is Greg's call, not this plan's.

## The constraints anything here must respect

Numbered so the review and the implementation briefs can quote them.

1. **[GATE] The pre-dispatch boundary is ordered and must run even when nothing matches.**
   `assertVerifiedUser` (`:6563`) → `setRequestOwner` (`:6572`) → `setMonitoringUser` (`:6578`) →
   the admin predicate (`:6597`) and its refusal (`:6974`) → *only then* route selection. The gate
   must fire when no endpoint matches, when the method is unsupported, and when captures are
   malformed. Making it one entry among 81 loses that.
   [admin.md:86](../project/admin.md): *"It sits above the route table, so an admin endpoint added
   later is behind it whether or not whoever adds it remembers."*
2. **[HTTP] Method mismatch is a 404 — inside this dispatcher, for an authorised user.** The
   wording matters (Sol, P2-R6): *"no 405 anywhere"* is only true of `serveAuthenticatedApi` **after
   its admin gate**. The wider `serveApi` surface does have 405s, in the public dispatcher and the
   Stripe webhook; and a non-admin asking for any `/api/admin` path gets 403 *before* method
   dispatch, wrong method or not. Within that scope: the terminal `send(res, 404, …)` at `:8177`
   must stay a **sent** response, not a thrown error — the caller's `failure` logging value would
   change. Preserve `req.method` and `rawUrl` in the message, including the undefined-method case.
   No `Allow` header, no HEAD/OPTIONS handling, no URL decoding, normalisation or trailing-slash
   tolerance. Copying `src/public/routes.ts:390`'s 405 policy would be a behaviour change.
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

Interleaves to move deliberately, after stage 1 and never before. Sol corrected this list in both
directions, and I verified each by hand:

- **`uploads` (`:7903`–`:7939`) sits between `allJobs` GET (`:7899`) and POST (`:7939`).** Extracting
  jobs reorders uploads against one of them.
- **`shelfOpen` is declared with the library matchers at `:6626` but handled at `:7184`** — after
  models, transcribe, feedback and both reader routes. I missed this one entirely. It means
  *library* extraction reorders unrelated guards just as jobs extraction does, so library is not the
  easy first domain it looks like.
- **`readerRoute` GET (`:7107`) and PATCH (`:7176`) are already consecutive.** I had this wrong: the
  69 lines between them are the GET handler's own body, not another guard. Verified — `awk` finds no
  dispatch-level `if` in that range.

Further declaration-order/guard-order inversions exist around article vs link preview/summary,
source/asset/export vs metadata, quiz mark vs debate, the comment subroutes vs `one`, most chat
subroutes vs `oneThread`, and referee scan vs mirror. They are harmless **because matcher evaluation
is pure and every complete accepted pair is unique** — which is a property to preserve, not a
coincidence to rely on silently.

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

**Stage 1 — the route contract, checked against the source.** The prerequisite Sol named in
[260826m § 3.1](260826m-simplification-audit.md) and 260902e named again, asked for four times over
five weeks and never built. **It is worth landing on its own merits whether or not stage 2 or 3 ever
happens**, and Sol agrees stopping here would be a defensible finish.

My first draft of this stage was circular, and Sol rejected it (P1-R1): a list *derived from* the
matchers cannot also be the independent oracle for whether a matcher was deleted, and a bare count
is only a canary — delete one guard while adding another and it still passes. The corrected design:

1. **A hand-written, reviewed `EXPECTED_AUTH_ROUTES`**, one row per matcher: the match (literal path,
   or regex source plus flags), the accepted methods, and witnesses. **Do not pin binding names** —
   renaming `timeline` to `timelineRoute` is behaviour-neutral and must not go red.
2. **Parse `src/routes.ts` with the already-installed Babel parser** (there is repo precedent), and
   extract the 67 matchers, the 81 matcher/method guards, the admin gate, and whether every handled
   arm terminates.
3. **Compare the two bidirectionally. Exact set equality is the oracle**; 67 and 81 are loud failure
   controls, nothing more. Unsupported guard or matcher syntax must be *rejected*, never silently
   omitted.
4. **Black-box only the safe negative matrix**: for each witness, call every method that no matcher
   matching that witness accepts, and require the exact terminal 404 and no `Allow` header. This
   reaches no handler and so needs no database.
5. **Leave positive dispatch behaviour to the existing per-route suites.** This is the correction
   that matters most: several accepted POSTs write data, spend money, contact providers, open SSE
   streams and create Stripe objects. A generic matrix that fires a witness at every accepted pair
   would do all of that. `/api/models` is the cheap positive control.

This catches deletion, addition, matcher changes, method changes, unknown syntax and accidental
acceptance of a wrong method. It does **not** cover handler behaviour, URL restoration, query
parsing, streaming completion, or arbitrary regex intersections — those stay with the focused tests
that already own them.

**Mutation controls, to prove it can fail:** delete a guard; add one; change a matcher; change an
accepted method; feed it syntax the parser does not understand. **Not** the library-guard swap, and
not "reorder two overlapping guards" — no two guards accept the same method/path pair, so any such
swap is an equivalent mutation and would pin an implementation detail rather than behaviour.

**Stage 2 — fix the one source-text test that is genuinely silent.** Narrowed by Sol (P2-R4) from
four files to one. `tests/cacheable-covers-artefact-routes.test.ts:132` filters away a `null`
binding, so a route that stops matching vanishes from the test's universe. The other three
(`owner-isolation.test.ts:1306`, `referee-scan-route.test.ts:342`, `source-store.test.ts:84`)
already assert their extraction was non-empty and need nothing. `referee-scan-route`'s exact source
shape will need adapting when its guard moves in stage 3 — that is a stage 3 edit, not a defect now.
Ideally the cacheable test eventually reuses stage 1's checked parser instead of a second grep.

**Stage 3 — extract two or three same-module domains, then reassess.** Top-level
`async function tryXRoutes(request: ApiRequest): Promise<boolean>` in the same file, gates outside,
handlers unchanged. **Billing first**, as Sol suggests: it is a good control, four guards, no shared
module state. One domain per commit, suite green each time.

Two corrections from Sol here. First, the lock-registry inventory was wrong and incomplete — there
are **six**, not four: `answering` (`:1010`), `streaming` (`:2069`), `turnOrder` (`:2120`),
`searching` (`:3800`), `refereeing` (`:3970`), `pullingClaims` (`:4211`). `streaming` and
`turnOrder` were the omissions that mattered. Second, they do **not** make same-module extraction
harder — helper functions go on closing over exactly the same module state. They become a real cost
only at a later *file* split, where their ownership and `processSingleton` identities have to move
atomically with the helpers that use them. So the plan's earlier claim that chat/live/jobs are
"materially harder" was wrong for this stage and right for the one after it.

**Not in scope**, named as passed over: moving domains into separate files (Greg's call, and the
place the registries actually bite); anything inside the 81 handler bodies; the eager-matcher cost;
a 405 policy; and pre-committing to extract all fourteen domains — Greg's request is enough to
override 260905b's "Tier 3, do not start", but not enough to make every domain automatically worth
extracting.

## Open

- Whether stage 1 alone is a defensible finish. I think it may be.
- Three worktrees carry unmerged `routes.ts` edits (`delete-article-permanently`, `critiques-mode`,
  `a1-a3`). Each will conflict; each conflict is a proposal to show Greg, not an edit.
