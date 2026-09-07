# Realtime chat repair checks

2026-09-06. [Plan](260906f-repair-realtime-chat.md).

## Scope and environments

Initial diagnosis and plan review used `28096583db9a5cbee322e0f0936e54aeaaea86eb`.
Before final validation, fetched and fast-forward merged the latest `origin/dev` to
`39282f8ca7e616a212720a7469e1b680cdf874e3`. Incoming debate evaluation and feedback changes
did not overlap the repair. No dependency or schema change was needed for realtime chat.

Browser testing uses the worktree's Vite server at `127.0.0.1:5273`, with local Postgres.
The silent provider preview additionally uses `scripts/live-spike.ts` at `127.0.0.1:5399`.
Physical microphone input and audible speaker output are not established by those preview checks.

## Postgres routes

Command: `node node_modules/vitest/vitest.mjs run tests/chat-live-ticket-route.test.ts tests/live-session-routes.test.ts tests/chat-live-turn.test.ts`.
Exit 0. This run predates the final browser-only changes; these routes were not changed.

```text
[private lane] spideryarn_test_260906092837_c9cce87e266a40ba812535f59efe1134 in 1.6s
Test Files  3 passed (3)
Tests       27 passed (27)
Start at    12:28:37
Duration    6.79s
[private lane] dropped spideryarn_test_260906092837_c9cce87e266a40ba812535f59efe1134
```

## Regression and browser evidence

- [Runtime results](260906f-repair-realtime-chat-runtime-results.txt): observed failing assertions,
  repaired lifecycle, input capture, playback, tool ordering and transcript ownership checks.
- [UI results](260906f-repair-realtime-chat-ui-results.txt): visible controls, new/resumed thread
  handoff, stable passage navigation, and regression witnesses.
- [Browser results](260906f-repair-realtime-chat-browser-results.md): shipping UI and provider
  observations, distinguishing synthetic fixtures, real transport, and unverified acoustic behavior.

## Full gate

The first full run found the exact Chat request-trace assertion had changed: the newly visible
empty-list composer mounts its existing profile checkbox, adding two profile GETs under
StrictMode. Plain and Ideas remain unchanged. Updated the exact list and its historical trace
record; the isolated trace rerun passed all three tests. Raw failure and green output follow.

```text

 RUN  v4.1.11 /Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair

(node:85042) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
 ❯ |unit| tests/the-ideas-extraction-changed-no-requests.test.tsx (3 tests | 1 failed) 2005ms
     × Chat, on arrival 681ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/the-ideas-extraction-changed-no-requests.test.tsx > the request trace of a mode is the whole of it, in order > Chat, on arrival
AssertionError: expected [ { url: '/api/jobs', …(2) }, …(17) ] to deeply equal [ { url: '/api/jobs', …(2) }, …(15) ]

- Expected
+ Received

@@ -75,8 +75,18 @@
      "url": "/api/reader?slug=a-piece",
    },
    {
      "auth": "Bearer t",
      "method": "GET",
+     "url": "/api/reader?slug=a-piece",
+   },
+   {
+     "auth": "Bearer t",
+     "method": "GET",
+     "url": "/api/reader?slug=a-piece",
+   },
+   {
+     "auth": "Bearer t",
+     "method": "GET",
      "url": "/api/reader",
    },
  ]

 ❯ tests/the-ideas-extraction-changed-no-requests.test.tsx:766:24
    764|     await open("?mode=chat");
    765|
    766|     expect(captured()).toEqual(CHAT);
       |                        ^
    767|   });
    768| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
   Start at  12:44:25
   Duration  10.59s (transform 5.34s, setup 121ms, import 6.72s, tests 2.01s, environment 1.48s)


```

```text

 RUN  v4.1.11 /Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair

(node:12820) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  12:45:54
   Duration  13.23s (transform 6.48s, setup 128ms, import 8.15s, tests 3.15s, environment 1.45s)


```

Touched-file Biome lint: exit 1, 12 errors, 43 warnings and 7 information findings. The errors
are in unchanged App effects and CSS declarations outside this repair; lint is advisory here.
The new components and regression tests introduce no lint errors. Complexity and CSS specificity
advisories remain. No autofix was applied.

First full `npm run check`: exit 1. Typecheck, both builds, cycles, migration chain and committed
HEAD typecheck passed. Test result was 745 passed files, two failed files and one skipped file;
13,555 tests passed, two failed and 58 skipped. The failures were the corrected Chat trace above
and an unrelated `tests/admin-store.test.ts` 20-second timeout. The latter passed all three tests
on an isolated rerun (5.21 seconds); no admin code changed. A final full gate is running again.

The final small accounting change deletes an unconditional close-reason assignment. Its regression
now delivers an abandoned session's delayed channel-close event while a replacement session runs,
then verifies the replacement still reports its own ending reason. Watched red and green, recorded
in the runtime results; latest focused runtime count is 96 passed.

Final gate and code-review outcome pending.


## Sol code review F3

The failed/cancelled/incomplete response statuses preserve their partial words with the existing interrupted marker. The saved copy says the answer ended early; history continues to exclude the pair. Observed red before editing the ledger:

```text

 RUN  v4.1.11 /Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair

 ❯ |unit| tests/live-exchanges.test.ts (20 tests | 3 failed | 17 skipped) 8ms
     × marks a failed provider answer as unfinished 6ms
     × marks a cancelled provider answer as unfinished 1ms
     × marks a incomplete provider answer as unfinished 1ms
(node:12603) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
stderr | tests/live-session-flow.test.tsx > live audio and tool recovery > meters and settles a failed response before exposing the failure
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)

stderr | tests/live-session-flow.test.tsx > live audio and tool recovery > meters and settles a failed response before exposing the failure
The current testing environment is not configured to support act(...)

stderr | tests/live-session-flow.test.tsx > live audio and tool recovery > meters and settles a failed response before exposing the failure
The current testing environment is not configured to support act(...)

stderr | tests/live-session-flow.test.tsx > live audio and tool recovery > meters and settles a failed response before exposing the failure
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)

stderr | tests/live-session-flow.test.tsx > live audio and tool recovery > meters and settles a failed response before exposing the failure
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)

stderr | tests/live-session-flow.test.tsx > live audio and tool recovery > meters and settles a failed response before exposing the failure
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)

stderr | tests/live-session-flow.test.tsx > live audio and tool recovery > meters and settles a failed response before exposing the failure
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)
The current testing environment is not configured to support act(...)

stderr | tests/live-session-flow.test.tsx > live audio and tool recovery > meters and settles a failed response before exposing the failure
The current testing environment is not configured to support act(...)

 ❯ |unit| tests/live-session-flow.test.tsx (52 tests | 1 failed | 51 skipped) 22ms
     × meters and settles a failed response before exposing the failure 21ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/live-exchanges.test.ts > interruption > marks a failed provider answer as unfinished
 FAIL  |unit| tests/live-exchanges.test.ts > interruption > marks a cancelled provider answer as unfinished
 FAIL  |unit| tests/live-exchanges.test.ts > interruption > marks a incomplete provider answer as unfinished
AssertionError: expected [ { id: 'live-u1', …(6) } ] to match object [ { question: 'Q1', …(2) } ]
(4 matching properties omitted from actual)

- Expected
+ Received

  [
    {
      "answer": "A partial answer",
-     "interrupted": true,
+     "interrupted": false,
      "question": "Q1",
    },
  ]

 ❯ tests/live-exchanges.test.ts:247:17
    245|       { type: "response.done", response: { id: "r1", status, output: […
    246|     ]);
    247|     expect(out).toMatchObject([{ question: "Q1", answer: "A partial an…
       |                 ^
    248|     expect(ledger.pending()).toBe(0);
    249|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  |unit| tests/live-session-flow.test.tsx > live audio and tool recovery > meters and settles a failed response before exposing the failure
AssertionError: expected [ { threadId: 'spya-thra01', …(3) } ] to match object [ { question: 'A question', …(2) } ]
(2 matching properties omitted from actual)

- Expected
+ Received

  [
    {
      "answer": "The partial answer",
-     "interrupted": true,
      "question": "A question",
    },
  ]

 ❯ tests/live-session-flow.test.tsx:1175:21
    1173|       { providerEventId: "failed-r", status: "failed", inputTokens: 13…
    1174|     ]);
    1175|     expect(written).toMatchObject([{ question: "A question", answer: "…
       |                     ^
    1176|     expect(h.get().phase).toBe("failed");
    1177|     expect(sent.filter((event) => event.type === "response.create")).t…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯


 Test Files  2 failed (2)
      Tests  4 failed | 68 skipped (72)
   Start at  13:15:20
   Duration  1.07s (transform 224ms, setup 73ms, import 388ms, tests 30ms, environment 549ms)


```

After repair, ledger, hook and chat-history tests:

```text

 RUN  v4.1.11 /Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair

(node:12885) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12887) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  3 passed (3)
      Tests  138 passed (138)
   Start at  13:16:18
   Duration  9.41s (transform 1.63s, setup 231ms, import 2.78s, tests 8.08s, environment 681ms)


```

## Second full gate

Exit 1: all non-test gates passed. The corrected Chat trace passed. Test result: 746 passed files, one failed file, one skipped file; 13,557 passed tests, one failed, 58 skipped. The sole failure was a 30-second beforeEach timeout in unrelated billing-quota-race.test.ts. Its isolated rerun passed all 13 tests in 2.63 seconds; no billing code changed. The full suite is therefore not claimed green.

## Final review and validation snapshot

All three first code-review findings were reproduced and fixed. F1 also covers exhausted ambiguous write responses, with no extra retry loop: definite first-attempt 4xx stays an immediate failure. The focused runtime/controller/effect suite passed 225 tests and typecheck covered 1,426 sources. [Final validation](260906f-repair-realtime-chat-final-validation.md) records the comprehensive scoped run and the reduced-contention full gate (`VITEST_MAX_WORKERS=4 npm run check`), run without changing timeouts.

The [bounded Sol follow-up](260906f-repair-realtime-chat-code-review-followup-sol.md) exited 0 and returned **READY**, closing F1–F3 and the delayed-close regression. It independently passed all 57 hook tests. Its evidence note describes the earlier validation snapshot; the final capped gate was appended to that record after the review read it.

That gate caught an omitted registration for the new import-free `spoken-label.ts` shared leaf and a reopened-panel URL assertion. Both failed again in the named-file rerun. The helper registration now has the same purity checks as the other shared leaves: the server route itself remains forbidden. The boundary, spoken-controller and spoken-effect run then passed all 32 tests in three files.

The URL assertion introduced in `77e045a6e` ran after six zero-delay turns, before nuqs' throttled history write. The component draft had already changed. Awaiting the actual URL invariant passed all 60 public-network tests. Temporarily omitting `startChatAboutBlock`'s `setThread(null)` still failed the revised assertion; restoring that line passed. The root inspected the red and restored-green outputs; no application change remains from this test repair. The [UI results](260906f-repair-realtime-chat-ui-results.txt) retain the exact mutation evidence.

The [final Sol gate review](260906f-repair-realtime-chat-gate-review-sol.md) exited 0 and returned **READY**, with no P0/P1 finding. It independently passed the 60 public-network tests and the two relevant boundary checks. Its read-only sandbox prevented the boundary suite's unrelated fixture-writing test; the root's complete four-test boundary run passed. Scoped lint on both final test edits passed.

The last full gate, against the same frozen application source and the two test fixes, passed typecheck, builds, cycles and migration checks. Tests reported 746 passed files, three failed files and one skipped file; 13,574 passed tests, five failed and 58 skipped. The three failing files are unrelated job/claim tests. Two passed their one rerun; `store-jobs-parity.test.ts` still reported explicit `TEST DATABASE CONTENDED` failures. Root inspected the errors and confirmed none of those files or job implementations changed. The complete gate is **not** claimed green; the [final validation](260906f-repair-realtime-chat-final-validation.md) records exact results and unchanged source hashes. No additional full runs were made to chase an environmental green.
