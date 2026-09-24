# Only a sentence written for the reader reaches the reader

Overseer queue item `qi-pbasrz4b`, authorised by Greg. Deferred from
[260915a](260915a-question-press-answer-does-not-loop.md) § Deferred (Sol R6): *"Making 'a
sentence the server wrote' a type rather than a hope touches three hooks and every caller; worth
its own small plan."* Reader report:
[260912_1120](../user-feedback/260912_1120-question-answer-replaced-by-react-error-185.md).

## What and why

`describeFetchFailure` (`src/web/useComments.ts`) is the one function seven client files use to
turn a caught failure into the sentence a reader sees — `useComments`, `useSourceScan`,
`useCriteria`, `useMirror`, `useClaims`, `useSearch`, `chat/effects.ts`. Today it does three things:

```
StreamStalled  → wentQuiet(...)                                  (fine)
TypeError      → "Couldn't reach the dev server … (<its message>)"
anything else  → error.message, verbatim
```

The third branch rests on a comment: *"an Error we threw ourselves already carries a real message
from the server"*. Nothing enforces it. On 2026-09-12 React's own `Minified React error #185` came
out of the chat store inside the stream loop and was printed as the answer's failure — a
[copy.md](../project/copy.md) violation (not written for a reader, not ours) and a false claim (the
server had finished; the client lost it). The second branch is the same hope with a different
name: every JavaScript bug is a `TypeError` too (`Cannot read properties of undefined`), and that
one is told *"Couldn't reach the server"* with the bug's text in brackets.

## The fix

Two positive marks, set only where the fact is known, and everything unmarked gets generic copy.

1. **`ReaderFacingError`** — a new class in a new leaf module, `src/web/lib/reader-facing.ts`. Its
   message is, by construction, a sentence somebody here wrote for a reader. Producers:
   - `HttpError` extends it — the server's own `{ error }` string, or `errorFor`'s status sentence;
   - `readJson`'s "replied 200 but not with JSON" sentence;
   - `OpeningReadTimedOut` extends it (its message is `LIST_LOAD_TIMED_OUT`);
   - the client-authored "stopped arriving" sentences thrown inside these flows (`useComments`,
     `useClaims`, `useCriteria`, `useSearch`, `useMirror` ×3 including the server's `error` frame
     text), and `chat/effects.ts`'s `NO_RESPONSE` and pre-stream refusal (which rethrows the
     `HttpError` itself instead of copying its message into a plain `Error`).

   Its own module rather than `lib/api.ts` because several tests `vi.mock` that module wholesale;
   a mocked-away class would make `instanceof` throw.

2. **Transport failures are marked where they happen**, not recognised by class afterwards. A
   `WeakSet` brand (`markUnreachable` / `isUnreachable`, same module) set at the three places a
   request's transport can fail inside our helpers: the `fetch` in `apiFetch`, `res.text()` in
   `readJson`, and `reader.read()` in `readEvents` (only when the rejection is a `TypeError` —
   an abort is not a lost connection). A brand rather than a wrapping subclass so the error object
   is untouched: its name, message, stack and `instanceof TypeError` stay exactly as they were, and
   the six other sites that check `e.message === "Failed to fetch"` or `instanceof TypeError`
   (`useShelf`, `jobEngine`, `useAdminUsers`, `useAdminFeedback`, `useDictation`,
   `chat/effects.ts`'s disconnect branch) keep working unchanged.

3. **`describeFetchFailure`**:

   ```
   StreamStalled        → wentQuiet(...)                (unchanged)
   isUnreachable(e)     → the existing "couldn't reach" sentence
   ReaderFacingError    → e.message
   anything else        → PAGE_FAULT (new, kind "bug", [web-unexpected]) — and the error goes to
                          captureClientFailure + console.error, so it is not silently swallowed
   ```

   Sentry's scrubber already withholds an unauthored message, so reporting the foreign error sends
   its name and frames, not its text.

## The simpler options passed over

- **Fix only the plain-`Error` branch; leave `TypeError` → "couldn't reach".** One class and no
  brand. Passed over because it leaves the same hope under another name, and the brief names a
  `TypeError` as one of the things that must not reach the reader.
- **Recognise transport `TypeError`s by message** (`"Failed to fetch"`, `"Load failed"`,
  `"NetworkError when attempting…"`). Four sites already do this for Chrome's string only, which is
  the argument against: browser wording is not ours and is already wrong on Safari.
- **Mark sentences with a WeakSet too, instead of a class.** Rejected: a sentence is constructed by
  us at the throw site, and a class there is the type the deferred line asked for.

## Out of scope, recorded

- The "couldn't reach" sentence itself says *"is `npm run dev` still running?"* to readers in
  production, here and at four other sites (`useShelf`, `jobEngine`, `useAdminUsers`,
  `useAdminFeedback`). A copy fix across five sites; not this plan.
- `useGlossary`, `useQuiz` and other hooks with their own failure wording do not go through
  `describeFetchFailure` and are not audited here.

## Stages

1. Red: `tests/comments.test.ts` § `describeFetchFailure` — a plain
   `new Error("Minified React error #185…")` and a bare `TypeError("Cannot read properties of
   undefined")` must not reach the reader; a `ReaderFacingError`, an `HttpError` from a real
   `readJson` on a 4xx `{ error }` body, and a branded transport failure from a rejecting `fetch`
   through `apiFetch` still must. Plus one end-to-end case through a hook: a chat turn whose sink
   throws a foreign `Error` fails with `[web-unexpected]`, not the foreign text.
2. Build as above; register the code in `CODE_KINDS`; mutate (drop the `ReaderFacingError` check,
   drop a brand) and see the tests notice.
3. Docs: [copy.md](../project/copy.md) (the rule and the `web-` prefix),
   [web-client.md](../project/web-client.md) § Reading an API response, the Deferred line in
   260915a, the feedback note.

## What done means

No `Error` reaches a reader through `describeFetchFailure` unless its class says a reader was meant
to read it; the tests above red on the old code and green on the new; gates green.

## Review ledger

Plan review: [260924a-…-plan-review-sol.md](260924a-only-a-sentence-the-server-wrote-reaches-the-reader-plan-review-sol.md)
(it ran while the build had started, which it noted; the findings were about the plan's design).

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 (P0) | `sanitise` trusts any message ending in a registered code, so a foreign `Error("<article> [ai-busy]")` reported from the new branch would reach Sentry intact | **Taken.** `sanitise(err, { neverAuthored })` and `captureClientFailure(err, ctx, { neverAuthored })`; `describeFetchFailure` passes it. Tested red→green, and by mutation |
| F2 (P2) | the spoken repair aborts `askForThreads` after finishing; the `AbortError` would be reported as a page fault each time | **Taken.** `askForThreads` returns early when its own signal aborted. Tested, and by mutation |
| F3 (P2, reasoned) | a `TypeError` from `fetch`/`text()`/`read()` can be a programmer error (GET with a body, a used body) and would be branded a lost connection, with the engine's text in brackets | **Overruled for now.** Both examples are bugs that fail on every call and are seen in development before any reader; the bracketed text is a browser string, not a provider's or the article's. Removing it belongs with the "`npm run dev`" copy fix across five sites (§ Out of scope) |
| F4 (P2) | no test proves the brand on `readEvents`' clocked (`readBefore`) read path | **Taken.** Both read paths now go through one branded `.catch`, and a test covers a stream that dies after its first frame |

Code review: [260924a-…-code-review-sol.md](260924a-only-a-sentence-the-server-wrote-reaches-the-reader-code-review-sol.md)
(it changed no files; 186 targeted tests and the typecheck passed in its sandbox).

| ID | Finding | Disposition |
|----|---------|-------------|
| F5 (P1) | `useMirror` wraps the server's SSE `error` frame in `ReaderFacingError`, but `src/routes.ts` fills that frame from raw `(err as Error).message` — an unclassified `TypeError("fetch failed")` reaches the reader verbatim | **Not a regression, and not fixable here.** The frame's text reached the reader verbatim before this change too; the client cannot tell a server's sentence from a server's leak on a channel the server declares as the reader's. The fix is on the server — five streaming routes (`frame("error", { error: (err as Error).message })`) should send a declared sentence or `UNEXPECTED_FAILURE`. Recorded in [copy.md § The same seam in the browser](../project/copy.md#the-same-seam-in-the-browser) as open; wider than this stage, for the orchestrator to queue. Sol still objects; overruled for this stage because the change it needs is a server stage's |
| F6 (P2) | the hooks' own tests do not pin the migrated sentences — Sol mutated Mirror's throw back to plain `Error` and all its tests stayed green | **Taken.** A guard in `tests/describe-fetch-failure.test.ts` refuses `throw new Error(` in any `src/web` file that calls `describeFetchFailure` (the list is found, not written), and `tests/referee-mirror-stream.test.tsx` now matches the sentence. The same mutation reds both |
| F7 (P3) | web-client.md still said `describeFetchFailure` is only for requests with no response | **Taken**, reworded |

## What landed

- `src/web/lib/reader-facing.ts` (new): `ReaderFacingError`, `markUnreachable`, `isUnreachable`.
- `src/web/useComments.ts`: `describeFetchFailure` as above; `PAGE_FAULT` + console + Sentry.
- `src/web/lib/api.ts`: `HttpError extends ReaderFacingError`; the not-JSON sentence is one; `fetch`
  and `res.text()` transport `TypeError`s branded. `src/web/lib/sse.ts`: `reader.read()` branded.
  `src/web/lib/opening-read.ts`: `OpeningReadTimedOut extends ReaderFacingError`.
- Throw sites: `useComments`, `useSearch`, `useCriteria`, `useClaims`, `useMirror` (×3),
  `chat/effects.ts` (`NO_RESPONSE`; the pre-stream refusal rethrows the `HttpError` itself;
  `askForThreads`' abort, F2).
- `src/messages.ts`: `PAGE_FAULT`, `[web-unexpected]` in `CODE_KINDS`.
  `src/monitoring-scrub.ts` / `src/web/monitoring.ts`: `neverAuthored` (F1).
- Tests: `tests/describe-fetch-failure.test.ts` (new); `tests/comments.test.ts` and
  `tests/use-comments-load-state.test.ts` updated to construct the sentence they stand in for;
  `tests/eager-client-graph.test.ts` lists the new leaf.

Left open: `ChatController`'s spoken repair (`controller.ts`, `(error) => finish({ error:
error.message })`) is a second, smaller path by which a foreign exception's text could reach
`#landed`; it does not go through `describeFetchFailure` and is not changed here.

## Stage 2b

Asked by the orchestrator after stage 2 was committed (6c7c1d0d): fix F5 and the two other leftovers
in this run rather than queue them, because they are the same class.

**1. F5, the server's stream channels.** Not five sites but nine, all in `src/routes.ts`: the five
`error` frames (glossary ask, glossary lookup, quiz mark, chat, referee mirror) and the four stored
rows whose `error` a reader later sees (explain, search, referee criteria, referee claims — and chat's
stored row, which shares its frame's variable). All now go through `sayToReader`
(`src/reader-sentence.ts`, new). **No new convention**: it passes a declared `stageFailure`
(`declaredFailure`) or a message ending in a registered code (`kindOfMessage`, the test
`authored` in `monitoring-scrub.ts` already applies before Sentry). Anything else →
`ANSWER_GAVE_UP` (`[ai-gave-up]`) and one `log("http").error` line with the error.
`retry` rather than `UNEXPECTED_FAILURE`'s `bug`: before, an uncoded raw message read as
kind-unknown and so kept its Retry, and `readerFailureOf`'s documented rule is that an undeclared
failure keeps the offer. The simpler option, reusing `UNEXPECTED_FAILURE`, would have taken Retry
away from what is most often a broken connection to the provider.

Red first: `tests/glossary-asked-term-stream-route.test.ts` § "says only a sentence written for the
reader…" — the provider body breaks with `TypeError("fetch failed: <sentinel>")`; the sentinel was in
the frame. Green after; reverting that one site reds it again. `tests/reader-sentence.test.ts` pins
the helper's three branches and the log line.

**2. `ChatController`.** Four catches put `e.message` into state the panel draws — the spoken
repair's (`finish({ error: error.message })`), `#write`'s, `#stream`'s and `#settle`'s. All four now
call `describeFetchFailure`. The first test covered only a `runTurn` rejection; review F8 (P2) proved
that reverting `#write` to `e.message` still left the file green. The focused test now drives all
four rejection paths. Each mutation — `#write`, the spoken repair, `#stream` and `#settle` — exposes
React #185 and reds its own case; the built code draws `[web-unexpected]` instead.

Review F9 (P2) found the spoken repair's deadline setting `finished`, aborting its request, and then
classifying the resulting `AbortError` before `finish` could ignore the late result. That drew
nothing, but reported an ordinary timeout as `[web-unexpected]` to Sentry. The rejection branch now
returns on `finished` before calling `describeFetchFailure`; a fake-clock test watches the monitoring
seam as well as the reader's existing timeout sentence.

**3. "is `npm run dev` still running?" on production.** `couldNotReach(detail?)` in
`src/web/lib/reader-facing.ts`: a built page (`import.meta.env.PROD`) says `COULD_NOT_REACH`
(`[net-down]`, new in `src/messages.ts`) and never the browser's own words (which also closes F3's
exposure half); the dev build keeps the hint and the bracketed detail. Used by `describeFetchFailure`
and the four others (`useShelf`, `jobEngine`, `useAdminUsers`, `useAdminFeedback`). Tested both ways
with `vi.stubEnv("PROD", …)`; forcing the dev branch reds the production case.

**Found, not changed:**
- `handleApi`'s own catch (`send(res, status, { error: (err as Error).message })`) sends a raw
  message for every status, 500 included. Same class, JSON side. Not changed because some routes
  answer a 500 with an uncoded sentence they wrote (fleet, admin), which needs an audit to tell
  apart. Recorded in copy.md.
- Those four "couldn't reach" sites still match the exact string `"Failed to fetch"` (Chrome's; Safari
  says "Load failed") and pass any other `e.message` through. Routing them through
  `describeFetchFailure` would fix both; it lives in a hook module they do not import today.

**Stage 2b review ledger.** [2b code review](260924a-only-a-sentence-the-server-wrote-reaches-the-reader-2b-code-review-sol.md):
no P0/P1. F8 (P2, only `#stream`'s catch was pinned) — taken by Sol: a test per controller catch,
each reds under its own mutation. F9 (P2, the spoken repair's deadline abort reported as
`[web-unexpected]`) — taken by Sol: the late rejection returns on `finished` first, with a
fake-clock test. Also `tests/shelf-cached-paint.test.tsx` now matches `[net-down]` rather than the
dev-only prose.
