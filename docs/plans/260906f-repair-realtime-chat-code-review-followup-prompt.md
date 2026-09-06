# Bounded final review: realtime chat deltas

Read-only. Do not edit source. This follows
`docs/plans/260906f-repair-realtime-chat-code-review-sol.md`; read its verdict first.
Base remains `39282f8ca7e616a212720a7469e1b680cdf874e3`. Candidate is uncommitted.

Review these final deltas since the first review started, and the specific
established P0/P1 findings from that review whose dispositions are appended below. Do not repeat
a broad review. Give explicit READY/NOT READY, stable finding IDs, and a concrete failing
scenario for any remaining established P0/P1. Use repository-relative references in your answer.

1. `src/web/live/useLiveConversation.ts`: the data-channel close callback no longer assigns
   `endedBecause` outside its ownership guard. `failSession` owns that write for a valid current
   close. `tests/live-session-flow.test.tsx` delivers session A's delayed close after B starts,
   then stops B and expects each session's `reader` reason; it failed before this one-line fix.
   Latest focused runtime result: 96 passed across four files. The same results file records a
   test-helper fix binding each wiring to its own observation array, so a deferred unmount from
   the preceding test cannot report into the next test's array.
2. `tests/the-ideas-extraction-changed-no-requests.test.tsx` and `docs/plans/260905h-traces.md`:
   the new empty-list Chat composer legitimately mounts its existing profile checkbox. Under
   StrictMode this adds exactly two article-profile GETs before the bare profile GET; Chat's
   expected trace grows from 16 to 18, Plain and Ideas unchanged. Observed the old assertion
   fail and all three pass with the exact updated sequence. No production source changed for
   this expectation update.
3. Final evidence is in `docs/plans/260906f-repair-realtime-chat-checks.md` and the browser,
   runtime, and UI results siblings. The real provider final pass completed two article searches,
   two passage pointers and a streaming spoken response, one reader line, then hung up to idle.
   No claim of physical microphone capture or speaker audibility is made.

No new dependencies, database changes, or unrelated code changes. You may run one local-only
test file; no network or Postgres is available in your sandbox. Root owns full-gate validation.

## First review dispositions

All three P1 findings were accepted and reproduced before their fixes.

- F1: the chat controller now holds provisional spoken ownership through its one repair read.
  Review the fresh delta in `src/web/chat/{controller,model,project,reduce,effects}.ts`, the
  client-safe `src/spoken-label.ts` helper extracted from `src/routes.ts`, and regressions in
  `tests/chat-spoken-operation.test.ts` and `tests/live-session-flow.test.tsx`. Verify matched
  canonical pair, server-normalized metadata, CAS ordering and a bounded repair failure.
  `tests/chat-spoken-effect.test.ts` is also a new untracked file: it drives the real retry
  effect and response parsing with apiFetch replaced. Exhausted network/timeout/5xx/malformed
  success can represent a committed write even without a 409. A failed SpokenOutcome therefore
  carries uncertain:true in those cases (preserved across a subsequent definite 4xx), and uses
  the same bounded repair. A first definite 4xx still fails immediately. Seven additional
  witnesses were watched red before this fix; final focused suite225/225 and typecheck1426passed.
  Recovery copy now says saving could not be confirmed rather than asserting that it failed.
  Route input validation is unchanged. A repair that includes later unrelated messages must not
  silently advance the live model's expected tail past the matched answer.
- F2: both ordinary Dictation buttons and the fallback now use the same awaited Live shutdown
  before toggling dictation (`src/web/ChatPanel.tsx`). New untracked
  `tests/chat-live-dictation.test.tsx` uses the actual Composer, Live hook and microphone lock with
  a deferred ticket: Chat and Remember controls both failed before repair, and all three paths
  passed afterwards. No later Live ticket can steal the microphone back.
- F3: `src/web/live/exchanges.ts` marks failed/cancelled/incomplete provider responses with the
  existing interrupted flag before harvesting. Saved UI copy says the spoken answer ended early;
  `src/types.ts` defines that broader meaning and `src/converse.ts` only gains an explanatory
  comment. No schema or new message status. New ledger cases and strengthened failed-response
  hook expectation failed before repair; ledger/hook/chat-history suite then passed 138 tests.
  An independent subagent verified introducer ae4ca4229, flag propagation through route/Postgres,
  and the existing policy that incomplete question/answer pairs remain readable but are omitted
  from subsequent model context.

Check the final validation artifact linked from the checks record for the final source state.
Default full gates have exhibited unrelated database timeouts, which are explicitly recorded;
no passing subset is presented as an entirely green full gate.
