# The authenticated API's dispatch becomes enumerable — and the matrix test that has to come first

Status as of 2026-09-07: **the expensive part is behind us; what remains is mechanical.** Stages 1,
1b, 1c, 2, 3a, 3b, 3c, 4a and 4b are landed and reviewed. `AUTH_ROUTES` holds **21 of the 81 guards**
(billing, jobs/uploads, referee); **60 remain**, and search is the next slice up. Biome on
`serveAuthenticatedApi`: **244 → 234 → 183 → 164**.

**This supersedes an earlier "done enough to stop here."** That recommendation rested on a cost
estimate that was wrong — see § *Fable settles the end-state, and corrects the price*. The remaining
60 guards need **no new machinery and no new tests**: each slice is stage 3b's move, verified by a
character-for-character body diff and an order expectation written **red-first**. The one genuinely
hard prerequisite — proving a moved closure still holds its lock, still ends its response and still
makes its caller wait — was paid once, in stage 4a, and Sol confirms it is paid for every remaining
domain. Evidence gathered at `d4b503b4`;
every line number below was live at `d4b503b4` and stage 3a has since moved them — the four billing
guards are gone from the chain and roughly 280 lines were added above `serveAuthenticatedApi`, so
read a line number as "which statement", not "which line". Design
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

**Stage 1 — the route contract, checked against the source. ✅ Landed, `31cfcbcc` + `ee920a86`.**
`tests/authenticated-api-route-contract.test.ts`, 304 cases, unit lane, no database.
[Reviewed](260907b-stage1-code-review-sol-073600.md): **no P0, no P1.** Sol independently
re-derived the inventory from the AST and got exactly what the test asserts — 69 declarations (67
matchers, the request destructure, the admin namespace), 82 top-level `if`s (81 guards and the
gate), 4 calls, 1 terminal return, **0 unsupported statement kinds** — and confirmed the negative
matrix cannot send a request the source would handle. Four small findings went to stage 1c. Its
verdict on stopping here: *"a valuable, independent inventory and fail-closed syntax reader without
changing production behavior… not worse than not starting"*, but it does not complete the refactor.

The prerequisite Sol named in
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
  order and compared as a set, which does **not** record the order — the layout is for a human
  reader and nothing asserts it (corrected in stage 1c). Asserting the order
  would be wrong for the reason the paragraph above gives, so the test asserts **the property that
  makes order irrelevant**: no two of the 81 guards accept the same `(method, path)`. The two
  documented intersections are *allowed* — `/api/library/search` GET vs PATCH,
  `/api/chat/:slug/live-tool` POST vs PATCH/DELETE — and each is asserted to be a real intersection
  resolved by the method, so it cannot pass by the paths having drifted apart. `jobAction`'s
  `(cancel|retry)` against `jobAdvance`'s `advance` had a case of its own; stage 1c deleted it and
  left the three job paths in the overlap probes, where the collision check already asks about them.
  **Honest about its reach:** regex intersection is undecidable in general and this does not
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

**Stage 1c — the four corrections from Sol's review of the built code**
([review](260907b-stage1-code-review-sol-073600.md): no P0, no P1). Test-only; `src/routes.ts`
untouched. 304 cases to 305.

- **The safety model's scope, asserted rather than relied on** (P2-SAFETY-SCOPE). `sourceAccepts()`
  models `serveAuthenticatedApi` only, but `call()` enters through `handleApi`, which dispatches the
  public namespace (`:6347`) and the Stripe webhook (`:6371`) above it. A new case asserts every
  witness and overlap probe is outside both, using the dispatcher's own `isPublicNamespace` and
  `WEBHOOK_PATH`. Sol's alternative — have the negative matrix call `serveAuthenticatedApi` directly
  — was **declined**: going through `handleApi` is what makes this exercise the real entry path.
  **Watched red** with a contract row for `/api/public/mutation`: 7 failed, and four of them were
  refusal cases that *sent* their requests and got *No public API route for …* while
  `sourceAcceptsIt` said `false` — the hole, demonstrated.
- **`METHOD_UNIVERSE` closed explicitly** (P2-METHOD-UNIVERSE). Pair equality catches a verb added on
  one side; a verb added to *both* would be skipped by everything that walks the universe. A new case
  asserts every source and contract method is one of the five. HEAD and OPTIONS stay out, and stay a
  matter for the refusal policy. **Watched red** with a `HEAD` arm on `billingUsage` plus the
  matching contract row and canary bump: **1 failed**, 304 passed, which is the finding.
- **Two comments made true** (P2-DISJOINTNESS-CLAIM, P3-OVERLAP-COMMENT). A set does not *record*
  order; and "fourteen matchers overlap" was wrong — fourteen have more than one method, while only
  two pairs of distinct matchers intersect. The disjointness section now also says that an
  intentional matcher change needs a fresh intersection review by hand, since this corpus cannot
  justify a later reordering on its own.
- **The job-family case deleted.** It ran three sample paths that `OVERLAP_PROBES` already feeds to
  the collision check, so it earned nothing the corpus check does not. The library and chat cases
  stay: they assert intersections are *kept*, which a collision check cannot see.

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

**Stage 3 — move domains into the ordered table, then reassess.** Gates outside it, handlers
unchanged, one domain per commit, suite green each time. (An earlier draft of this line said
`async function tryXRoutes(request): Promise<boolean>`; that was the shape the mis-read review
argued for. The settled shape is § *The shape* above.)

**Migrate from the bottom upward, and do not hoist.** Sol's P2-STAGE3B-ORDER, and the alternative is
a trap worth naming: take the contiguous guard slice immediately above the existing table call and
prepend those rows before the ones already there, in original order. One call, total order preserved.
**Do not dispatch the complete `AUTH_ROUTES` at several positions** — that lets an already-migrated
domain match at the first call. A non-contiguous domain instead gets an explicitly named *slice*
table at its recorded position, keeping the invariant "the complete `AUTH_ROUTES` is dispatched
exactly once".

Hoisting the table earlier is **not** licensed by the disjointness property. That property is true
today, but it rests on a hand-read of 67 patterns plus a finite corpus, and it expires the moment a
pattern is widened. It becomes durable only when every guard has moved, or when matchers use a
representation whose same-method intersections can be checked exhaustively.

**And capture the order oracle *before* the move, not with it.** Stage 3b's order test was written in
the same commit as the arrangement it approves, so it would equally have blessed a mistaken one — a
regression pin, not evidence. Sol checked the nine rows against `468d1eeb^` by hand and confirmed
they are right, so stage 3b is sound; the lesson is for the next slice. Commit an ordered fixture
while the guards are still in the chain, watch it green, then move without touching the oracle.

**Stage 3a — the table exists and billing is in it. ✅ Landed.** `AUTH_ROUTES` and
`dispatchAuthRoute` in `src/routes.ts`, above `serveAuthenticatedApi`; the four billing guards are
now four rows; `serveAuthenticatedApi` gained one statement,
`if (await dispatchAuthRoute(AUTH_ROUTES, { user, request })) { return; }`, placed after every
remaining guard and before the terminal 404 — the position billing already occupied, so the move
reorders nothing. Biome's score on the dispatcher: 244 → 234.

**The fixed point is `EXPECTED_AUTH_ROUTES`: not one row and not one witness changed**, and the
block is byte-identical to stage 1c's (md5 `c36bdcb…`). What changed is the *reader* inside
`tests/authenticated-api-route-contract.test.ts`, which now normalises both an
`if (matcher && req.method === "…")` and a table row into the same `(method, match)` pair — and
still refuses everything it does not recognise, at module scope, before a case runs. 305 cases → 316.

Three properties the chain did not have, each checked where it lives:

- **Registration is side-effect-free** (Sol, P2-ISOLATION-SCOPE). Enforced by a whitelist rather than
  by watching for effects: every key of every row is named, every value must be a string literal, a
  regex literal or a function written out in place. Eight refusal cases are its control — a call
  building the path, a call building the row, a spread, a handler named elsewhere, a pattern named
  elsewhere, a computed key, an extra key, a non-literal method.
- **Every handler is awaited** — § [LIFETIME]. `assertHandlersAwaited` reads `dispatchAuthRoute` and
  refuses an un-awaited `.handler(…)`, or none at all. Billing opens no stream, so nothing about
  billing would have gone red; the check exists **before** the domain that needs it.
- **No `g` or `y` pattern**, refused at registration by `src/routes.ts` itself, not only by a test —
  § [REGEX]. A table's regexes are shared across requests where the chain's are rebuilt per request,
  so this is the one constraint that becomes live the moment the table exists.

Four mutations watched red and edited back; the transcripts are in the test file's header, § *Stage
3a*. `npm run check` at EXIT=0, 791 files, 14,699 tests. `referee-scan-route.test.ts`'s four-space
brace is untouched, as expected — billing is not referee, and that test will break loudly at the
domain that is.

Two corrections from Sol here. First, the lock-registry inventory was wrong and incomplete — there
are **six**, not four: `answering` (`:1010`), `streaming` (`:2069`), `turnOrder` (`:2120`),
`searching` (`:3800`), `refereeing` (`:3970`), `pullingClaims` (`:4211`). `streaming` and
`turnOrder` were the omissions that mattered. Second, they do **not** make same-module extraction
harder — helper functions go on closing over exactly the same module state. They become a real cost
only at a later *file* split, where their ownership and `processSingleton` identities have to move
atomically with the helpers that use them. So the plan's earlier claim that chat/live/jobs are
"materially harder" was wrong for this stage and right for the one after it.

**Stage 3b — jobs and uploads join it, prepended. ✅ Landed.** The nine guards
`allJobs` GET · `uploads` POST · `upload` DELETE · `upload` GET · `allJobs` POST · `job` GET ·
`job` DELETE · `jobAction` POST · `jobAdvance` POST — taken as **one contiguous slice** from
immediately above the table call and put **above** the billing rows in that same order. So the
table now reads bottom-of-the-chain-upward, one dispatch call, unchanged position. All nine handler
bodies moved verbatim; the only edits inside them are `part(upload, 1)` → `part(captures, 1)` and
each arm's trailing `return;` dropped, and a script checked the nine bodies character for character
against the arms they came from.

This is [Sol's prescription](260907b-stage3a-code-review-sol-0923.md) (P2-STAGE3B-ORDER) and the
reason it is a *slice* rather than a *domain*: `uploads` and `upload` sit **between** `allJobs` GET
and `allJobs` POST, so taking the range contiguously preserves that interleave for free, where
grouping by domain name would silently reorder it. The order is not to be tidied.

**`EXPECTED_AUTH_ROUTES` is unchanged again** — md5 still `c36bdcb…`, not one row and not one
witness. 316 cases → 319.

Three things this stage hit that billing did not:

- **Shared matchers.** `upload`, `allJobs` and `job` each serve two rows, and the reader refused
  `pattern: SOME_IDENT` on purpose — stage 3a left the note saying what the right shape would be.
  It is a module-scope `const` both rows name (`JOBS_PATH`, `UPLOAD_PATTERN`, `JOB_PATTERN`), and
  the reader now resolves an identifier **only** to a top-level `const` holding a string or regex
  literal, which keeps the no-effects-at-construction whitelist exactly as tight. `ParsedTableEntry`
  gained a `site`, so two rows naming one constant are one matcher and two guards — what a chain
  binding read by two guards already is — while two rows spelling the same literal out twice are two
  matchers and § *names each matcher once* fails on them. 67 and 81 both held.
- **The order is now asserted, for the table only.** New case § *keeps the table in the chain's
  order, newest domain first*. The chain's order is deliberately not asserted because its guards are
  disjoint; the table's order **is** the chain's order carried across, and nothing else recorded
  that. It is the only thing the interleave mutation reddened.
- **Sol's trap has a rail, and it is blanket rather than absolute.** A second
  `dispatchAuthRoute(AUTH_ROUTES, …)` earlier in the chain is refused by `readTableDispatch` at
  module scope — `Tests: no tests`. "Absolute" was this write-up overstating it (Sol, stage 3b review
  § P2-DISPATCH-RAIL-SCOPE): the walk reads `serveAuthenticatedApi`'s own statement list, so it
  counts *recognised top-level* dispatches and not a call nested inside a guard body or anywhere else
  in the module. The blanket refusal stays, because the alternative is slice machinery nothing uses.
  The same rail would refuse a *slice* dispatched at its old position, which is Sol's sanctioned move
  for a domain that is not a contiguous suffix; teaching it that is a deliberate edit at the stage
  that needs one, and the invariant to preserve there is **the complete `AUTH_ROUTES` is dispatched
  exactly once**.

Also done here, since the file was open: **P3-CAPTURE-CONTRACT**. `PatternAuthRoute`'s comment said
the pattern arm necessarily captures; `/^\/api\/x$/` is a legal row. The comment now says regex
route and names what the type does not promise. No stronger type was built.

`npm run check` at EXIT=0. `referee-scan-route.test.ts` is still green, as expected — referee is the
next slice up and its four-space brace is untouched. That is the test that breaks next, by design.

**Not in scope**, named as passed over: moving domains into separate files (Greg's call, and the
place the registries actually bite); anything inside the 81 handler bodies; the eager-matcher cost;
a 405 policy; and pre-committing to extract all fourteen domains — Greg's request is enough to
override 260905b's "Tier 3, do not start", but not enough to make every domain automatically worth
extracting.

**Stage 3c — the P1 the stage 3b review found. ✅ Landed.** `literalConstants` accepted every
top-level `VariableDeclaration` without checking `kind === "const"`, so `let P = /^\/api\/safe$/`
followed by `P = makePattern()` would be silently accepted: **the reader records one route while the
server dispatches another.** That is the contract test certifying a route the server does not serve —
this job's own failure mode, inside the thing built to prevent it.

Both readers now require `const`. `literalConstants` admits a name only if it is `const`, declared
**before** `AUTH_ROUTES`, and declared once; `readRouteTable` throws on `AUTH_ROUTES` being non-`const`
or declared twice. Two details worth keeping:

- **The kind check is a skip, not a refusal.** An unrelated module-scope `let` in `src/routes.ts` is
  none of the reader's business; only a *row naming* it refuses, as "names nothing declared here".
- **"Declared before" is enforced by slicing, not by trusting TDZ** — `literalConstants(statements.slice(0, declaredAt))`.
  That matters because the reader must not depend on a runtime rule it does not execute.

**The mutation evidence is honestly weaker than it looks, in two of four cases.** Moving a `const`
below the table went red as a `ReferenceError` — TDZ fired at import, *before* the reader ran — and
the duplicate-declaration mutation went red as `Transform failed`, esbuild refusing the redeclaration.
In both, the runtime won the race and the reader's own refusal was proved by fixture case instead.
Recorded because a mutation that reddens for a reason other than the one you are testing is a green
test wearing a red coat. The six new fixture cases were controlled properly: with the new checks
temporarily removed, exactly **6 failed | 319 passed** — every new case is a real control and no old
case moved. 325 pass.

**On the duplicate-name check, kept against its own author's lean.** Once `const` is enforced, a
duplicate top-level name is unreachable in production: two `const`s of a name is a `SyntaxError`, and
any *legal* duplicate needs a `var`, which the `const` check already rejects. It bites only on the
fixture path, where `parseSource` sets `errorRecovery: true` and babel hands back both declarations
with an error nobody inspects — so without the check the second silently wins. Three lines to refuse
a reader resolving a name to something the source does not unambiguously say, which is the P1's class
exactly. Kept.

**Stage 4a — the lifetime oracle, written before anything moves. ✅ Landed, reviewed clean.**
`tests/streaming-route-request-lifetime.test.ts` drives `POST /api/referee/criteria/:slug` through
`handleApi` with the model call paused, **while that guard is still an `if` in the chain**, and asks
whether the response, the `refereeing` lock and the caller's promise are each still where the guard
left them. No guard moved; `src/routes.ts` byte-identical; contract hash untouched.

**The silent success the brief walked past.** `sweepPending` spares any row younger than
`CRITERION_ORPHAN_GRACE_MS` (150 s), so the obvious version of this test — issue the GET, check the
row is still `pending` — **passes with the lock deleted outright.** The row survives for being young
and the assertion never touches the lock: a check agreeing with the code because it shares an
assumption with it ([silent-success.md](../reusable/silent-success.md)). The test therefore backdates
`attempt_started_at` past the grace window while the stream is paused, leaving the lock as the only
thing between that row and the sweep, then restores and backdates identically *after* the request
resolves, where the same GET buries it with `CRITERION_SWEPT`. One arrangement, two opposite answers,
the only difference being whether the request is in flight — which is also how lock *removal* gets
observed. Sol confirmed the equivalence: after backdating, every sweep predicate except
`notInArray(id, keep)` is satisfied, so survival means the id is in `liveCriteria(slug)`, which is
derived directly from `refereeing`.

Three mutations, each red for the reason under test. The load-bearing one — `refereeing` released
immediately after being taken — **was reproduced by the orchestrator rather than taken on the
implementer's word**: `expected 'error' to be 'pending'`, reverted by editing the text back, green
again. That is precisely the failure `assertHandlersAwaited` cannot see, because the syntax it reads
never changed.

**Sol's review: sound and pushable, no P0/P1/P2.** One P3 fixed in the same stage
(**P3-CASE-ISOLATION**): the rejection case asserted a fixed row count and passed only on residue
from the preceding case, so it failed when run alone — which is how a case stops being run at all. It
counts before and after now, and was verified passing in isolation.

**The nuance stage 4b must not miss.** Sol: at stage 4a the rejection case "does not yet exercise
`dispatchAuthRoute`" — criteria still matches the chain guard, so it currently proves propagation
through the guard's `await`, `serveAuthenticatedApi` and `serveApi`'s catch. Once criteria moves, the
**unchanged** case exercises the dispatcher's awaited handler calls instead. **That post-move green is
when the dispatcher half is discharged** — so 4b must run this file and require it green, and if 4b
ever finds itself *editing* it, that is a finding rather than a chore.

**Stage 4b — referee joins the table, and the oracle collects. ✅ Landed.** The eight referee guards
became eight rows, prepended above jobs/uploads; one table, one call, unchanged position. Three
shared matchers (`CRITERIA_PATTERN`, `ONE_CRITERION_PATTERN`, `REFEREE_CLAIMS_PATTERN`) follow the
`JOBS_PATH` shape stage 3b built; `refereeScan` and `refereeMirror` are single-row and stay inline.
All eight bodies were mechanically re-split and compared **character-for-character identical** after
normalising `slugPart(<binding>,` → `slugPart(captures,` and dropping each trailing `return;`.
`EXPECTED_AUTH_ROUTES` untouched.

**The order expectation was written red-first, which is the correction from 3b.** The eight pair-keys
went into § *keeps the table in the chain's order* **with no source change**, and the file went red
with a diff of exactly those eight rows at the head and nothing else — so the expectation demonstrably
predates the arrangement it approves. It then went green after the move, unedited. That is what stage
3b could not claim, and it is now the recipe for every remaining slice.

**The oracle collected on the thing it was built for.** Mutation 4 — the moved criteria closure's
`await` replaced with `void` — left the contract test **green at 325**, because `assertHandlersAwaited`
reads syntax that did not change. `tests/streaming-route-request-lifetime.test.ts` went **2 failed**:
*the request is still in flight*, and *the rejection reached serveApi's catch: expected +0 to be 500*.
Reproduced by the orchestrator rather than taken on report. That failure now travels through
`dispatchAuthRoute`, so **the dispatcher half of P2-LIFETIME-BEHAVIOUR is discharged** — and the file
was never edited to achieve it (`git diff` empty), which was the condition Sol set.

**The one deliberate test edit, and proof it is not vacuous.** `tests/referee-scan-route.test.ts`
extracted the arm by matching `if (refereeScan && req.method === "GET") {` up to a brace at four
spaces. Both halves died in this move, so it now anchors on the row's own `pattern:` line and ends at
the handler's closing `\n    },`. A rewritten extractor is exactly the shape that can silently match
nothing forever, so it was checked: perturbing the route's pattern in `src/routes.ts` makes it fail
with *"the route is not in src/routes.ts under that pattern: expected '' not to be ''"*. The presence
control still fires.

## The referee slice was built twice, and what the merge nearly hid

**Two worktrees did this slice in parallel and neither knew.** `260907e`
(`worktree-referee-into-the-route-table`) branched off stage 4a *after* it was pushed at 20:32 and
landed its own referee migration at 20:43; stage 4b landed here at the same time. The end states were
the same to the row — 21 rows, 60 guards, and the identical contract hash — differing only in
comments. **260907e landed first, so it is the one on `dev`, and this worktree's `src/routes.ts` was
resolved to theirs.** Nothing here was lost that was not also there.

**Their lifetime test is the better one and is the one that survives.**
`tests/referee-stream-lifetime.test.ts` has nine cases across *all three* streaming referee routes —
criteria, claims and mirror — and asserts lock *release* as well as lock holding, plus a case
checking that its own backdating assumption still matches the real grace constants. Stage 4a's
`tests/streaming-route-request-lifetime.test.ts` did criteria alone in two cases and is strictly
subsumed, so it was removed rather than left as a second thing to maintain. Both had independently
found the same grace-window trap, which is at least a good sign about the trap.

**The merge conflict was not the dangerous part.** Git marked five hunks in `src/routes.ts`, and all
five were comment wording. What it did *not* mark was the important bit: both sides had added eight
referee rows to `AUTH_ROUTES` in places whose text did not collide, so it took **both** — leaving
**29 rows where there should be 21, every referee route declared twice.**
[git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md) says exactly this:
*"A conflict shows you the files git could not merge; it says nothing about the files it merged
silently."*

**The safety net catches it, in seven places at once** — including the collision check, whose message
is the right one: *"two guards accept the same method and path, so the earlier one wins and the order
of the chain is now behaviour."* Running the contract test immediately after the merge would have
found this before anything else did. It was actually found by a different route, below, which is luck
rather than method; the method is to run the checks for whatever a merge touched, not only for the
files it marked.

**A silent success in the fix for a silent success.** Sol's **P2-LEXICAL-HANDLER-BOUNDARY** said the
scan-route extractor's `\n    },` terminator was lexical rather than structural — and both 260907b
and 260907e had independently rewritten it that way. Replacing it with an AST cut through
`parseSource` was correct but *not sufficient*: the first version assigned `handler = fn` on every
match, so with the block duplicated it silently inspected the **second** copy while a test mutation
sat in the first, and reported green. It now collects matches and refuses more than one:

> `expect(handlers.length, "GET /api/referee/scan/:slug is declared more than once").toBe(1)`

Both new assertions were watched fail — a `withSpendAttribution` added at the very end of the handler
(which the old lexical cut would have missed), and a duplicated row. The general lesson is the one
this job keeps re-learning in new costumes: **a reader that picks one of several answers cannot tell
you it had several**, and "assign the last match" is that shape wearing ordinary clothes.

## Where stage 3 stands, and what the next slice costs

**21 of 81 guards migrated** (billing 4, jobs/uploads 9, referee 8 — stage 4b, 2026-09-07). 60 remain
in the chain, plus the admin gate and the one table call. Biome on `serveAuthenticatedApi`: **244 →
234 → 183 → 164**. `npm run check` EXIT=0 at each stage, all seven hard checks clean.

The next slice up is **search** (`searches`, `oneRun`), and it has no prerequisite left to pay: the
referee slice paid the only one. Sol confirmed that in the stage 4b review — *"Search has no
remaining prerequisite… I found no other test reading the `searches` or `oneRun` dispatch syntax"* —
and gave the recipe: four ordered pair-keys added red-first, two shared module-scope matcher
constants, four handlers prepended in GET/POST/PATCH/DELETE order, bodies compared while normalising
**both** `slugPart` and `part` uses, `EXPECTED_AUTH_ROUTES` and the lifetime oracle untouched.

**It is now a contiguous suffix, which it was not when 260907e queued it.** That plan's § *The next
slice* warns search is "not adjacent to the table" because referee's eight guards sat between them;
referee has since moved, so the four search guards (`:8453`–`:8489`) run straight into the table call
at `:8519`. It is the plain bottom-upward move again, with no slice-dispatch needed.

**Whoever takes it should check `ListAgents` first.** Both plans queue this slice and either session
could read it as an invitation; that is exactly how referee got built twice. Asking costs nothing.

Referee was **the one slice with a real prerequisite** — but not the start of an expensive stretch,
which is how this section first read. See § *Fable settles the end-state, and corrects the price*
below: the prerequisite is paid **once**, not once per domain. Both bullets below are now discharged.

- **It is the first streaming slice, and not for the reason first thought.** `POST criteria`
  (`:8321`) calls `runRefereeCriterion`, which opens SSE *and holds `refereeing`*; Claims POST
  streams and holds `pullingClaims`; Mirror POST streams but holds no live-run lock. So the plan's
  "chat is the first streaming domain" was wrong twice over — it is referee, and the first guard
  inside it is criteria rather than mirror.
- **`assertHandlersAwaited` is a syntax tripwire, not behavioural proof.** It would still pass if a
  moved closure launched its stream without returning it, swallowed an error, or released its lock
  early — [silent-success.md](../reusable/silent-success.md), a claim about shape standing in for a
  claim about lifetime. Sol's required integration test, against the **still-chain-based** criteria
  POST: pause `runCriterionStream` after the pending row and the SSE `begin` frame; prove the
  `handleApi` promise is unsettled and the response not ended; issue the corresponding GET and prove
  its sweep leaves the row `pending`, so `refereeing` is demonstrably still held; release, then
  require the terminal frame, the store finish, the response end, the lock removal, and only then
  `handleApi` resolving. Plus a deferred-handler rejection-propagation check.
- **One test must move with it.** `tests/referee-scan-route.test.ts:342` cuts an arm starting from
  `if (refereeScan && req.method === "GET") {`, which will not exist. It returns `""` and its
  presence control fires — loud, but a deliberate one-line edit in that commit. It is the only one of
  the five source readers that has to move. **Done in stage 4b:** it now anchors on the row's own
  `pattern: /^\/api\/referee\/scan\/…/,` line and ends at the handler's closing `\n    },`. The two
  ordering assertions and the `withSpendAttribution` refusal are unchanged, and so is the presence
  control.
- **A note against ourselves:** stage 3b already moved `jobAdvance`, a long-lived lease-owning
  handler. Its awaits are correct, but under the lifetime finding's own wording the integration
  coverage was arguably already due — we moved it on a syntactic check.

## Fable settles the end-state, and corrects the price

Asked to arbitrate between **(A)** finishing the migration and **(B)** stopping at a deliberate
hybrid — table for stateless domains, chain for streaming and lock-holding ones — Fable picked **(A)**
and dismantled (B). Its three factual claims were checked in the tree and all hold:

**The shape distinction (B) rests on does not exist here.** Every streaming guard left in the chain
is the same three lines — read the body, call a helper with `res`, return:

```ts
const criteriaBody = await readBody(req);
await withSpendAttribution({ articleSlug: slugPart(criteria, 1) }, () =>
  runRefereeCriterion(slugPart(criteria, 1), criteriaBody, res),
);
return;
```

No guard opens a stream or touches a lock registry. The helper does: `refereeing.add`/`.delete` at
`:4149`/`:4177`, `pullingClaims` at `:4284`/`:4315`, `searching` at `:3902`/`:3929` — each its own
`try`/`finally`, one call below dispatch. **At the dispatch layer a streaming guard already *is*
"match, call, return"** — the thing (B) says a table row is good for. And because the plan chose
closures precisely so rows carry no shared behaviour, there is nothing for a stream to be an
exception *to*.

**(B) is a budget wearing a design's clothes.** Three tells, all verifiable. The argument was already
made by 260906h § T3.1 and already answered by Sol in the stage 3a review — quoted at line 491 above:
helpers "go on closing over exactly the same module state". Stage 3b already moved `jobAdvance`, a
long-lived lease-owning handler, so the boundary (B) proposes is one the table has already crossed.
And the line falls exactly where the next step got expensive: had referee been cheap and chat first,
the "principled" line would have been drawn under chat instead. **A line whose position is set by the
cost of the next step is a budget, not a design** — and the cost of calling it a design is that the
next reader defends it, leaving two mechanisms permanently plus a rule nothing can enforce.

**Nothing could enforce it.** Every candidate rule needs facts about handler *behaviour*, which the
contract reader cannot see: the guard body names no registry and writes no header, both being inside
`runX`. The reader enumerates *dispatch syntax*, so a rule about which form a route must take would
decay to "whatever the last person thought". The file already shows what that looks like — endpoints
hand-counted in comments as "the one", "the third", "the fourth", "the sixth", "the fifth". There is
no "second", and the fifth is written below the sixth. The informal bookkeeping has already drifted,
and that is the enforcement mechanism (B) would inherit.

### The correction that matters most: "per streaming domain" was never Sol's

§ *Where stage 3 stands* calls referee "where the cheap part ends", and the orchestrator priced the
rest of the job at a lifetime integration test **per streaming domain**. That multiplication was
**the orchestrator's, not the review's** — it does not appear in Sol's text at all. Sol wrote "before
a streaming/stateful domain moves" and named exactly one instance, criteria POST. It never said
*per*. That invented factor is where most of (A)'s imagined cost came from, and it is also what made
(B) look attractive. What the two tests actually cover:

- **The deferred-handler rejection test is about `dispatchAuthRoute`**, not any domain. Written once,
  it covers every row present and future.
- **The criteria-POST lifetime test is about `runRefereeCriterion`**, not about dispatch. It proves
  the helper holds `refereeing` across the stream — true before the move and after, because the move
  does not touch the helper. It does not need repeating for chat or searches: a verbatim move of a
  three-line caller cannot change what a callee does. It is also a test this app should own
  regardless; there is no request-lifetime test for any stream today.

What actually speaks to a move is what stage 3b already did: a character-for-character body diff and
an order fixture captured *before* the move. That scales to every remaining slice at near-zero cost.

**So the honest price of finishing is one dispatcher test, one lifetime test, and ~10 mechanical
slices verified the 3b way** — not a project. By this repo's own definition it is also the *simpler*
end state: one mechanism, one order fixture, and no policy to document.

**Sol was asked to overrule this and did not.** Because the argument reinterprets Sol's own finding,
the stage 4a review put the question to it directly. Its answer: *"I agree with Fable: this is once,
not per domain. No separate lifetime oracle is required for chat, searches, claims, or Mirror. Their
locks/streams live inside their helpers; a verbatim caller move cannot alter those lifetimes."* It
named the three things that cover the remaining move-specific risk — the body/order diff, the static
awaited-handler check, and this unchanged rejection case passing through `dispatchAuthRoute` once
criteria has moved — and set the condition under which a domain would need its own test after all:
**only if its helper or caller responsibilities change**, not for a mechanical table migration. So
both the cross-family reviewer and the arbitrating model agree, and the inflated estimate was the
orchestrator's alone.

**One caution of Fable's did not survive checking.** It warned that three worktrees carry unmerged
`routes.ts` edits, making every slice a conflict. Listing non-merge commits on all branches that are
not on `dev` and touch `src/routes.ts` returns **nothing**: the five that look like it are merges
carrying dev's own change. No worktree holds an original unmerged edit, so that blocker does not
apply. Recorded because the rule is to check each finding rather than bank it, and this one was wrong.

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
