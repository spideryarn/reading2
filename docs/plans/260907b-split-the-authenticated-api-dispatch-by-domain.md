# The authenticated API's dispatch becomes enumerable — and the matrix test that has to come first

Status as of 2026-09-07: **reviewed; stages 1, 1b and 2 landed, stage 3 not started.** Evidence gathered at `d4b503b4`;
`src/routes.ts` is byte-identical at the worktree HEAD, so every line number below is live. Design
input from GPT 6 Astra (high) and Fable, and a plan review from GPT Sol
([review](260907b-split-the-authenticated-api-dispatch-by-domain-review-sol.md),
[prompt](260907b-split-the-authenticated-api-dispatch-by-domain-review-prompt.md)), are folded in
and attributed. Sol returned **no P0**; it **endorsed** the ordered closure table over per-domain
functions, rejected stage 1's first design as unproven, corrected the source-reader inventory from
four files to five, and corrected the ordering model in both directions. Each correction is marked
below. (An earlier version of this line said Sol *reversed* the shape decision. That was the
mis-read review — see § *What the mis-read review cost*.)

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
| `src/web/styles.css` | **Solved.** The A10 style-ownership worktree landed. Now a 2.7 KB manifest of `@import`s over 37 files in `src/web/styles/` — 16,624 lines in all, so nothing shrank; it gained owners. |
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

**Settled: a static ordered table of closures.** This section was written three times and the middle
version was wrong for a process reason worth recording, because the mistake is more instructive than
the answer.

I first settled on the table. Then a Sol review arrived saying per-domain functions were right and a
table was not, so I reversed. **That review was answering the previous draft of this plan** — the
first review process was killed and relaunched against a rewritten prompt, but its `codex` grandchild
survived the kill and wrote its answer to the same output path eight minutes later. I read it,
believed it was the new review, and reversed a design decision on it. The real review of the actual
plan overwrote it afterwards and says the opposite. See § *What the mis-read review cost* below.

The live opinions, all on the plan as it actually stands:

- **Sol** — *"The ordered closure table itself is defensible — and I prefer it to fourteen
  `Promise<boolean>` dispatchers."*
- **Astra** — the table, with method mismatch meaning *continue* and gates outside it.
- **Fable** — per-area modules contributing ordered slices.
- **[260906h § T3.1](260906h-improve-the-codebase-fourth-sweep.md)** — per-domain functions, and
  against a table.

**This is an intentional override of 260906h, not a reinterpretation of it.** My earlier framing —
that 260906h only meant to reject a *data-driven* table, so a closure list was never in scope — was
not fair to it, and Sol says so (P2-SHAPE-OVERRIDE): *"It explicitly rejected a per-route table; it
did not reserve 'table' for declarative shared behavior. A closure registry is still a table driving
selection."* The override is justified by Greg's explicit request, which supersedes the older "Tier 3,
refused", and by one centralised handled/miss protocol instead of fourteen boolean ones. Sol also
narrows my supporting argument: `public/routes.ts:361`'s `false` warning is about a *security-boundary*
fallthrough, so it is not the same risk — though fourteen boolean protocols remain unattractive.

**The type, per Sol (P2-STATIC-CONTRACT).** Static handlers cannot close over per-request state, so
the entry is a discriminated exact/regex type, the request context and the raw `RegExpExecArray` are
*passed in*, dispatch does no decoding, and the dispatcher does `await handler(...)` followed by an
unconditional return. Registration construction must be side-effect-free — and that is a new
invariant to assert, because `owner-isolation` does not cover it (P2-ISOLATION-SCOPE).

Moving each domain into its own **file** is a further, materially harder change — it is where
ownership, import isolation and the `processSingleton` identities actually have to move — and it is
Greg's call, not this plan's.

## What the mis-read review cost, and the check that would have caught it

Recorded because the failure is a *class*, and the class has no existing guard.

**What happened.** A review process was killed and relaunched against a rewritten prompt, reusing the
same `--output` path. `kill` plus `pkill -P` took the `tsx` wrapper and its direct children; the
`codex` grandchild survived, finished, and wrote the **old** review to that path. The relaunched run
wrote the real one over it later.

**Why the standing check did not fire.** [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)
says to confirm *a verdict actually arrived — exit code and answer file*, because a review that
returned nothing looks exactly like one that found nothing. Both were true here. The file existed and
was 148 lines of substantive, correct-looking review. What was false is that it answered **the prompt
I sent**, and nothing in the recipe asks that.

**The cost.** One design decision reversed on it, one plan rewrite, and two commits (`c916e1b5`,
`2eed75d2`) whose reasoning is sound but whose verdict is now overturned. Nothing built was wrong:
stage 1 and stage 2 are consistent with *both* reviews, because the two agreed on everything except
the shape — which is the one thing not yet built. It was caught only because the file showed as
modified in `git status` afterwards and I looked at why.

**The check to add**, and it is cheap: *reusing an `--output` path across runs makes a stale answer
indistinguishable from a fresh one.* Either give every run a unique output path, or delete the file
before launching and treat its reappearance as the completion signal. Better still, have the review
prompt ask the reviewer to echo a nonce, and refuse an answer that does not carry it — the same
argument as [silent-success.md](../reusable/silent-success.md), one level up: here the *verification*
succeeded loudly at the wrong artefact.

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
   (`src/public/routes.ts:347`). Copying the public helper changes behaviour. **Both orders now have
   a test**, and the swap was watched red — stage 1b, § Stages below.
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
8. **[TEXT] One test reads `src/routes.ts` as a string and fails silently — and four others
   already learned that lesson.** Corrected three times: by Sol (P2-R4), then by stage 2 building
   it, then by Sol again (P1-SOURCE-INVENTORY) counting **five** readers rather than four.
   `tests/cacheable-covers-artefact-routes.test.ts:105–140` derives every artefact route by grepping
   for `const (\w+) = /^\/api\/<kind>\/([\w.%-]+)$/.exec(path)` and then for
   `if (<binding> && req.method === "GET")`; a miss was **`filter`ed out rather than asserted** — the
   [silent-success](../reusable/silent-success.md) class. `owner-isolation.test.ts:1306`,
   `source-store.test.ts:84` and `referee-scan-route.test.ts:342` each already assert their
   extraction was non-empty and need nothing.

   **The hazard is the declaration *form*, not the binding name**, which is the opposite of what this
   plan first said. A pure rename (`timeline` → `timelineRoute`) leaves the test green, because
   `bindingOf` captures the name out of the declaration rather than assuming it — the 2026-09-02 fix
   the file's own header describes. What goes quiet is the declaration changing shape. Measured in
   stage 2: rewriting one matcher as `TIMELINE_PATTERN.exec(path)` — **exactly the module-scope
   hoist constraint 7 contemplates for stage 3** — dropped that route from the test's universe, ran
   19 tests instead of 20, and left both pre-existing controls green. Stage 2 closed it; stage 3 must
   not reopen it.

   ### All five source readers, and how each meets stage 3

   Sol counted five, not four (P1-SOURCE-INVENTORY); the omitted one was `embedding-route-failures`.
   The question worth answering is not *is it loud today* — four of the five already are — but **what
   each does when stage 3 moves guards into per-domain helpers and constraint 7 hoists regex literals
   to module scope**. Two of them read *dispatch syntax* and are exposed; three read a *helper
   function* or a *whole-file count* and are not.

   | Reader | Reads | Can it go quiet today? | Stage 3 |
   |---|---|---|---|
   | `cacheable-covers-artefact-routes.test.ts:105–140` | dispatch syntax: `const (\w+) = /^\/api\/<kind>\/([\w.%-]+)$/.exec(path)`, then `if (<binding> && req.method === "GET")`, greped **file-wide** | It could, and did — the `.filter(…)` at `:132` dropped an unresolved kind. **Closed in stage 2** by `ROUTELESS_KINDS`, which requires the unresolved set to be *exactly* the eight pipeline-stage kinds | **Loud.** Hoisting a matcher to module scope is precisely the mutation stage 2 watched: the kind stops resolving, leaves the eight, and is named. Because the grep is file-wide, moving a guard into `tryArtefactRoutes` unchanged keeps it green — correctly. One residual, left open deliberately in stage 2: a *currently routeless* kind that gained a route in an unsupported form stays unbound and stays green |
   | `referee-scan-route.test.ts:342` | dispatch syntax, and the most brittle of the five: it cuts the arm with `if \(refereeScan && req\.method === "GET"\) \{[\s\S]*?\n {4}\}` — **the closing brace pinned at four spaces**, the guard's current indentation inside `serveAuthenticatedApi` | No. `expect(whole, "the route is not in src/routes.ts under that name").not.toBe("")` fires before any ordering is compared | **Loud, and it will fire.** A top-level `async function tryRefereeRoutes` puts the arm at two spaces, the extraction returns `""`, and the file goes red. That is a deliberate one-line edit at the moment the guard moves — the plan already says so — not a defect now. It is the only one of the five that stage 3 *must* touch |
   | `owner-isolation.test.ts:1306` | a **helper**, `async function sendSource(…)`, and the order of two calls inside it | No. Both operands are asserted present before their order is compared (two `-1`s satisfy `<`), and `not.toContain("fsLocations(slug)")` proves the comment-stripping still does something | **Untouched.** `sendSource` is a top-level helper, not a guard; moving the `if (source && …)` arm that calls it changes nothing here. Only a later *file* split moves the declaration, and then the extraction is empty and every assertion fails at once |
   | `source-store.test.ts:84` | the same `sendSource` cut, plus more of its body | No. It has an explicit presence control — *"has a body this test can actually read"* — asserting `res.statusCode = 200` before anything else | **Untouched**, for the same reason as `owner-isolation`. The two are deliberate duplicates: this one restates the security ordering outside a `describe.skip` that needs a database |
   | `embedding-route-failures.test.ts:103` | neither: a **whole-file count**, `throw embeddingHttpError(` exactly twice, and no inline `[emb\d]` | Not in the direction that usually bites. Losing a call makes it `expected 1 to be 2`. **Its blind spot is location, not shrinkage**: the count is file-wide, so a third caller appearing while `similar` or `projection` stopped using the helper still reads 2 | **Survives unchanged** while stage 3 stays in one file — the two throws move with their handler bodies and the count holds. A later file split takes it to 0 and it says so loudly. Stage 1's inventory does not close its blind spot either: that is a fact about handler *bodies*, which stage 1 explicitly does not cover |

   **The one thing to carry into stage 3:** `referee-scan-route` breaks on the *first* domain
   extraction that includes referee, loudly and by design; `cacheable-covers-artefact-routes` breaks
   only if regexes are hoisted, loudly and by design; nothing else in this list moves. Sol's
   suggestion that these eventually consume stage 1's checked inventory rather than adding more greps
   stands for the first two and is inapplicable to the last three.
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

**This is now asserted rather than recorded** — stage 1b's § *no two guards accept the same method
and path*, and if it ever goes red, everything in this section stops being true and the order becomes
behaviour.

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

**Stage 1b — three things stage 1 left out**, all three from Sol's review of the plan.
`tests/authenticated-api-route-contract.test.ts` goes from 296 cases to 304.

- **Disjointness, instead of order** (P1-ORDER-CONTRACT). The contract is written in declaration
  order and compared as a set, which records the order without asserting it. Asserting the order
  would be wrong for the reason the paragraph above gives, so the test asserts **the property that
  makes order irrelevant**: no two of the 81 guards accept the same `(method, path)`. The two
  documented intersections are *allowed* — `/api/library/search` GET vs PATCH,
  `/api/chat/:slug/live-tool` POST vs PATCH/DELETE — and each is asserted to be a real intersection
  resolved by the method, so it cannot pass by the paths having drifted apart. `jobAction`'s
  `(cancel|retry)` against `jobAdvance`'s `advance` is *shown* disjoint by running both rather than
  argued. **Honest about its reach:** regex intersection is undecidable in general and this does not
  attempt it — the question is asked over the witness corpus plus the named overlap probes, so two
  matchers meeting only at a path no witness spells would pass unnoticed. What keeps it from being
  empty is that every contract row must carry a witness, so a new matcher arrives with a path of its
  own. Its control is synthetic, because a real overlap cannot be introduced without also failing the
  pair-set comparison. **If it ever fails, order has become load-bearing** and stage 3 stops being a
  rearrangement.
- **The two decode-order cases** (P1-DECODE-CONTROL), which is constraint 4 given a test. Malformed
  JSON plus an undecodable slug, sent twice: `PUT /api/article/%/visibility` → **400 Request body is
  not valid JSON** (body parsing wins), `PATCH /api/library/%` → **500 URI malformed** (slug decoding
  wins), and a third case asserting the two differ, because either alone could go green by both
  routes converging. Neither reaches a store. **Watched red:** decoding the visibility slug into a
  `const` before its body read — the shape stage 3's move of handler bodies into closures could
  produce by accident — failed two cases (*expected 500 to be 400*, *expected 500 not to be 500*),
  and was reverted by editing the text back.
- **The five source readers classified** (P1-SOURCE-INVENTORY) — constraint 8's new table.

**Stage 2 — fix the one source-text test that is genuinely silent. ✅ Landed, `3fd9e5c1`.**
Narrowed by Sol (P2-R4) from four files to one. `ROUTELESS_KINDS` names the eight `SHAPE` kinds that
are pipeline stages rather than URLs, and one new assertion requires the unresolved kinds to be
*exactly* that set — so a lost route is named and a gained one has to leave the list deliberately.
Both directions were watched red; see constraint 8 for what the mutation revealed.
[Reviewed](260907b-stage2-code-review-sol.md): no P0, no P1, and Sol reproduced the rename finding
from the test's own derivation rather than taking it on trust. One **P2 left open deliberately** —
the assertion is bidirectional over what the *grep* recognises, not over actual routes, so a
currently-routeless kind that gained a route in an unsupported form (`LABELS_PATTERN.exec(path)`)
would stay unbound and stay green. Stage 1's checked AST inventory is the proper fix; when it
exists, this test should drop its grep and use it. Sol confirms the failure that matters is loud:
hoisting an *existing* regex reddens the new assertion, and changing a GET guard's form reddens the
old one, so stage 3 cannot quietly lose an artefact route — it will have to adapt this test on
purpose. `tests/cacheable-covers-artefact-routes.test.ts:132` filters away a `null`
binding, so a route that stops matching vanishes from the test's universe. The other four already
assert their extraction was non-empty, or count over the whole file, and need nothing — **constraint
8's table** names all five and says how each meets stage 3, which is the piece Sol asked for
(P1-SOURCE-INVENTORY) and stage 1b wrote. Ideally the cacheable test eventually reuses stage 1's
checked parser instead of a second grep.

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

## The baseline, so a later red is attributable

Full `npm test` on this worktree at `c916e1b5`, before any stage-1 code: **2 failed, 783 passed,
1 skipped of 786 files; 14,320 tests passed; 21 minutes.** Both failures are one environmental
cause — `api-dist/vercel.js` is missing because a fresh worktree has not run `npm run build` —
in `tests/cold-start-lazy-imports.test.ts` and `tests/pdf-bundle-trace.test.ts`.

`npm run worktree:setup` predicts "~14 of 477 files red". That is stale in both numbers and was
worth measuring rather than believing. Note both failures are *loud*: each says the artefact is
missing and that the assertion below would otherwise check nothing — the discipline in
[silent-success.md](../reusable/silent-success.md), working.

## Open

- Whether stage 1 alone is a defensible finish. I think it may be.
- Three worktrees carry unmerged `routes.ts` edits (`delete-article-permanently`, `critiques-mode`,
  `a1-a3`). Each will conflict; each conflict is a proposal to show Greg, not an edit.
