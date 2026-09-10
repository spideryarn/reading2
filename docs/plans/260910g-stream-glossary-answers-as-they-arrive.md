# Stream the glossary's two waiting answers

Status as of 2026-09-11: **both stages built, Sol-reviewed and on `dev`.** Cluster E of
[the prioritised plan](260908f-prioritised-spideryarn-codebase-improvements.md#e-show-glossary-answers-as-they-arrive),
dispatched by the Overseer (queue item `qi-csycwx9r`) after Greg, 2026-09-10 21:10Z:

> deprioritise further Overseer/web dashboard stuff to the very bottom priority, and now push up the
> priority of all the Spideryarn product stuff. Keep within 5h usage limits.

The glossary has two owner-facing waits of up to a minute each, and both show a spinner and then the
whole answer: **Look up a term** (the box, nothing stored) and an entry's **Check the web** (stored
against the entry). Everything else that explains a passage already streams — comments, chat, quiz
marks, link summaries — through one server helper (`sse` in `src/routes.ts`) and one client reader
(`readEvents` in `src/web/lib/sse.ts`). This plan puts the glossary on the same two pieces. The
[2026-08-26 streaming plan](260826o-streaming-the-slow-two.md) is history; its semantic-search half
has been built and is not touched here.

## The simpler option passed over

**Keep the JSON response and improve the waiting copy.** Rejected by the umbrella plan itself: a
spinner is not streaming, and AGENTS.md's rule is that a model call a person waits on streams. The
generator, the transport and the terminal-frame contract already exist, so the cost is a route and a
hook, not new machinery.

## Stage 1 — the unsaved asked-term answer

**Server.** `makeAskAboutTerm` (src/term-lookup.ts) splits in two, along the line the route already
needs: everything that can refuse — ownership (`loadArticle`), the term's validity, no prose, the
anchor — runs **before** a header is written, so every refusal stays the ordinary JSON 400/404/409 it
is today, codes unchanged. It resolves to the server-found anchor plus a `stream(signal)` that drives
`explainStream`. The route then opens `sse(res)` and passes `gone` as that signal, so a reader leaving
cancels the provider call and not merely the frames.

Frames: one `begin` carrying `{ term, blockId, quote }` — **the quote is `anchor.matched`, the
article's own characters, never the typed term** — then any number of `delta`, then exactly one of
`done` (the unchanged `AskedTermAnswer`) or `error` (`{ error }`, the reader-facing sentence).

**A partial answer can never become `done`.** `explainStream` yields `done` for an *abandoned* stream
with whatever had arrived (half a comment is worth keeping); here the ask's own stream refuses to
yield `done` when its signal has fired, so the drain can only complete on a finished answer. `safeUrl`
filtering and the content-free log line stay where they are.

No rate limit is added. Traced 2026-09-10: this route and its sibling `lookup` have none; the only
per-request middleware is `withSpendAttribution`, which records and does not gate; billing gates
ingest, not calls. The route keeps `withSpendAttribution` around the whole stream.

**Client.** `useGlossary.ask` reads the stream with `readEvents` under `STREAM_STALL_MS`, in a
`readAskedTerm` function (since stage 2, `readGlossaryStream`) shaped like `readMark` in src/web/useQuiz.ts: the answer is returned only on
a `done` frame; an `error` frame, a stall, or EOF without a terminal frame throws. The in-flight text
lives in a new `askDraft` field and **`asked` is set only from `done`**. One `AbortController` per
request: a keystroke (`clearAsked`), a slug change and unmount all abort it, which cancels the body,
which closes the socket, which fires `gone` on the server. The generation guard stays as the second
line.

`AskATerm` draws `askDraft` as the found passage (the server's `quote` and block) and the text so far,
with no provenance line and no sources — those are facts of a finished answer.

**Red first.** A Postgres route test with a fetch-stubbed provider that sends one delta and then
holds: today the route answers nothing until the provider finishes, so "a delta frame is written
before completion" is red. Then EOF-without-`[DONE]`, a provider error, refusals staying unstreamed
JSON with zero provider calls, exactly one provider call per request, and the reader leaving
aborting the provider signal. A jsdom hook test with a held body: text visible before `done`, `asked`
null until `done`, and each of error frame, EOF, stall-free abort on keystroke, slug change and
unmount ending deliberately.

## Stage 2 — stream and save an existing entry lookup

Built after stage 1 landed (`5ab767c6`). `makeLookUpTerm` takes the same split: the 404 and the two
409s before headers, then a stream whose `done` is emitted **only after `lookups.save` has
succeeded**, carrying `{ entry }` with the stored lookup — the JSON route's old body. A save failure
after text has arrived is an `error` frame, never a `done`. `refuseUnfinished` guards the save too,
so a cut-off answer is never stored. The client's `look` uses the same reader as the box
(`readGlossaryStream`, one terminal contract for both), keeps the words in `lookDraft`, and merges
into the entry through `patchEntry` only on `done`.

Three decisions, each tested:

- **Leaving does not cancel the lookup.** The route does not pass `gone` to the model call. The
  panel promises *"the answer is saved against this term either way"*, and the JSON route kept that
  only because nothing stopped the server; cancelling would turn a closed band into a paid call
  thrown away. The client stops reading on another article or unmount; the server finishes and
  saves. `answer` (comments) makes the same choice. The unsaved box does cancel — nothing it
  produces outlives the page.
- **A failure reads the list again** (Sol's plan-review P2: `error` does not prove nothing was
  kept). If the save landed and the frame did not, the re-read shows the stored answer.
- **An entry removed mid-stream is accepted, not refused** (Sol's other P2). Lookups are keyed by
  entry id with no foreign key, deliberately; the save succeeds and `patchEntry` does not put a
  stale entry back. A glossary rebuild can replace the list while the lookup runs, so `lookKept`
  survives independently of the rows and the panel says that the answer was saved but its term is
  no longer shown.

## What the plan review changed

GPT Sol read the plan before it was built
([answer](260910g-stream-glossary-answers-plan-review-sol.md)). No P0.

- **P1, accepted and built.** `explainStream` yields `done` not only for an abandoned stream but for
  one that hit its token ceiling (`length`) or the provider's filter — the draft checked only the
  reader's signal, so a cut-off answer would have been shown, and in stage 2 saved, as whole. The
  classified ending now travels on `done` (`ExplainEnding`, src/explain.ts) and
  `refuseUnfinished` (src/term-lookup.ts) refuses `abandoned`, `truncated` (`[gl-cut-off]`, new)
  and `filtered` (`[ai-filtered]`). Comments are unchanged: they read the fields they always read.
- **P2, already so.** Every `begin`/`delta` write is guarded by the request's generation, not only
  the terminal ones.
- **P2, named and tested.** A provider refusal (a 429, a missing key) is decided after the headers,
  so it is now a 200 carrying an `error` frame rather than the response's own status. Unavoidable
  once the stream opens first; the sentence the box shows is unchanged.
- **P2 ×2, for stage 2.** A rejected `lookups.save()` does not prove nothing was saved (the Postgres
  store upserts and then reads back separately), and a regeneration can remove the entry while its
  answer streams, so `patchEntry` merges into nothing. Both are carried into stage 2 below.

## Evidence

Stage 1, against `b9f6ca61`:

| check | result |
|---|---|
| route test, before the change | **4 failed, 2 passed** — first words before completion, EOF → `error`, provider failure → `error`, reader leaving aborts the provider; the two refusal cases are controls and passed both before and after |
| route test, after | 8 passed (adds `length` → `error [gl-cut-off]` and the 429-in-a-200 case) |
| hook test against the old `useGlossary.ts` | **7 failed, 1 passed** — the malformed-`done` case also fails safe on the old JSON parse |
| hook test, after | 8 passed |
| mutation: `stream(gone)` → `stream()` in the route | 1 failed — *aborts the provider request* |
| mutation: drop the abandoned-answer guard | 1 failed — *never finishes with the half* |
| mutation: `refuseUnfinished` accepts `truncated` | 2 failed — the unit and the route cut-off cases |
| focused suites after the code review's fixes | 8 files, 91 passed; `npm run typecheck` exit 0 |
| real browser, one real model call (Playwright, `fowler-phrenology`, term *sufficient*) | first words at 11.8 s, finished at 14.0 s; 8 samples drawn as *arriving…* with no sources or globe, then *asked, not checked* with the globe; checked at 1280 and 400 wide |

### What the code review changed

GPT Sol reviewed the built stage with write access
([answer](260910g-stream-glossary-answers-stage1-review-sol.md)); no P0, all five claims hold after
its fixes, each of which I read:

- **P1** — a `done` whose `citations` held a `null` passed the array check, became `asked`, and
  crashed the render. Citations are now checked member by member, frames are parsed null-safely, and
  a regression case was red before the fix.
- **P2** — admission used React state, so two submits in one tick could both start, and
  `clearAsked(); ask(…)` in one tick could refuse the second. Admission is `live.current` now,
  `useQuiz.mark`'s guard; two regression cases.
- **P2** — the failure sentence is drawn above the unfinished text, which is what this doc said.
- **P2** — comments that overstated what the route test covers were corrected.
- **Wider, for Greg or a later sweep** — Sol names two classes that meet the postmortem bar:
  shallow validation of a wire object that then reaches render, and React state used as an
  admission lock. Not written up in this stage.

The full suite ran while the review was editing these files, so its result is not by itself a gate
for the final tree; the focused rerun above is. It finished 10 files red of 1,075: three were this
stage's (a doc anchor, the new `[gl-cut-off]` code missing from `CODE_KINDS`, the new route test
missing its registry entry) and were fixed before the commit; two were the fresh-worktree bundle
tests (`cold-start-lazy-imports`, `pdf-bundle-trace`, which want `npm run build`); four were
`tools/fleet` and `tools/overseer` suites, which import nothing this stage touched; and
`glossary-asked-term-stream.test.tsx` was mid-edit by the review and passed alone.

Stage 2, against `00305a03`:

| check | result |
|---|---|
| route test, before the change | **5 failed, 2 passed** — the two that passed are the behaviour to keep: the reader leaving still saves, and a 404 stays unstreamed JSON |
| route test, after | 7 passed |
| hook test against stage 1's `useGlossary.ts` | **6 failed, 1 passed** — the malformed-`done` case fails safe on the old JSON parse |
| focused suites, both stages | 12 files, 174 passed; `npm run typecheck` exit 0 |
| mutation: pass `gone` to the lookup's model call | 1 failed — *does not stop the paid call, and the answer is still kept* |
| mutation: yield `done` before the save | 3 failed — the removed-article route case and two unit ordering cases |
| mutation: drop the client's re-read after a failure | 1 failed — *reads the list again* |
| real browser, one real model call (Playwright, `fowler-phrenology`, entry *Destructiveness*) | first words at 5.7 s, finished at 10.4 s; 17 samples drawn as *arriving…* under a *Checking…* button with no sources, then the stored answer; a fresh page load at 400 wide shows the same answer |
| focused suites after the code review's fixes, Postgres ones included | 14 files, 197 passed; typecheck exit 0; lint clean on touched files |
| full `npm test` on the final tree | 7 files red of 1,079. One was this stage's: `glossary-one-fetch.test.tsx` still mocked the lookup as JSON, which now reads as an unfinished stream whose re-read waits on a held GET — its mock now sends the `done` frame and it passes. The other six are the same environment and `tools/` reds as stage 1: `cold-start-lazy-imports`, `pdf-bundle-trace`, `fleet-composed-access`, `fleet-decisions-route`, `fleet-reports-route`, `overseer-diagnose` |

### What the stage 2 code review changed

GPT Sol reviewed the built stage with write access
([answer](260910g-stream-glossary-answers-stage2-review-sol.md)); no P0. I read each fix.

- **P1** — after a failure the re-read was fire-and-forget and the button came back at once, so a
  quick retry could start a second paid call and the first lookup's re-read then hid the retry's
  draft. The re-read is now awaited while the lookup still holds admission.
- **P1, and it corrects this plan** — the first draft said no client path removes an entry. False:
  *Find them again* on a stale or outdated list replaces it, and can do so while a lookup streams.
  `done` then confirmed storage, the merge found no row, and the panel said nothing. `lookKept` now
  survives the list and the panel says the answer was saved but its term is no longer shown.
- **P2** — a failure was drawn under whichever term was *selected*, not the one asked about;
  failures now carry their request id.
- **P2** — `GlossaryStore` still declared the old `lookUpTerm(): Promise<{ entry }>`; removed.
- **P2** — the `sse` helper's caller inventory was a stale count; now count-free.
- **Wider, not done here** — aggregate spend on these routes is unbounded (no rate limit, no per-term
  dedup, no admission gate; each call is individually bounded by its 120 s deadline, 45 s stall
  clock and 1,500-token ceiling), and the post-model save has no database statement deadline. Both
  are house-wide policies rather than glossary ones; the first is Greg's question in the debrief.
