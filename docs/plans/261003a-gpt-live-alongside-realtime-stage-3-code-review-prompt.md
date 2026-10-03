# Code review and fix: 261003a stage 3 (GPT-Live in the browser)

You are the reviewer-fixer for Stage 3 of
`docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md`. Read the plan (its Log
says what changed after the merge with `dev`), your plan review beside it (F1–F3, F6–F8 are what
this stage had to answer), and `docs/investigations/261002r-gpt-live-spike.md`, a peer's
measurement of GPT-Live whose findings were applied to this code.

## What to review

Everything under `src/web/live/gpt-live/`, plus `src/web/live/useLive.ts`, `engine.ts`,
`session-shared.ts`, the engine select in `LiveButton.tsx`, the generic change to
`src/web/live/meter.ts`, `wiring.ts`'s two additions, and the `engine` field threaded through
`src/web/useChat.ts` and `src/web/chat/{model,reduce,controller}.ts`. Their tests are
`tests/gpt-live-*.test.*`. The diff is `git diff 18eb1dfcf..HEAD -- src/web tests/gpt-live-*`
restricted to those files; `dev` was merged in between, so other files in that range are not
this stage's.

The server contract this code talks to is in `src/live.ts` (`GptLiveUsage`, `createGptLiveSession`),
`src/live-gpt.ts` (session config, allowlist) and `src/routes.ts` `liveChatSession`. Real provider
traces: `evals/live/gpt-live-spike/spike-out-*.json`.

The fixes in commit `18eb1dfcf` to the server half were yours, and the cached-rate change in the
same commit was mine: treat both as unreviewed code by somebody else if you look at them.

## What you may change

Fix what is wrong **inside this stage**, narrowly, each finding red-first with the test that
reproduces it. Report, do not fix, anything wider — including anything about the Realtime engine
(`useLiveConversation.ts`, `exchanges.ts`, `tool-responses.ts`, tap to talk), which is another
plan's. You cannot commit; leave your changes in the tree. Nobody else is editing it.

You have no network and no database. You can run
`npx vitest run tests/gpt-live-segments.test.ts tests/gpt-live-delegations.test.ts tests/gpt-live-stall.test.ts tests/gpt-live-meter.test.ts`
and the `.tsx` flow tests if jsdom works in your sandbox; a sandbox red is not a finding — say which
files you want me to run.

## Severity and form

P0 wrong or unsafe as shipped · P1 real defect, fix now · P2 note. Every finding gets an id
(D1…), file:line, whether you fixed it, and the test that went red.

## Look hardest at

- `segments.ts`: can it lose words, store them out of order, emit an exchange twice, or emit one
  that later changes? Late and out-of-order fragments; the freeze rule; the bracket-token filter.
- `useGptLive.ts` `commit` and the serial append queue against `expectedTailId`: a retry, a 409,
  an append that fails with exchanges queued behind it, hang-up with an append in flight.
- `delegations.ts` against the real traces: one continuation per response, never before
  `response.completed`, each call once. Two overlapping delegations.
- The lifecycle: every `await` in start and stop checked against the epoch; an abandoned start
  after the server has created (and billed) the session; microphone released on every exit;
  `pagehide`; a provider `session.closed`; the data channel closing first.
- `useLive.ts`: can the page ever show one engine's controls while the other owns a live
  microphone? Experimental switched off mid-call; Reconnect across engines.
- The meter: can a voice report be lost or a backend response reported twice; what is posted when
  the final `session.closed` never arrives.
- The stall rule against wall-clock time when the provider's timeline freezes.
- What `show_passage` validates before it records a pointer, compared with the Realtime hook.

## My suspicions, last

The hook copies about ten blocks from the Realtime hook (listed in its header); a copy that has
already drifted from the original after the merge is the likeliest bug. The freeze rule waits for
the next reader segment to *finish*, so a call that ends in a failed save may hold more unsaved
words than the Realtime engine would. And `say()` feeds typed text to the segmenter as a reader
fragment with a made-up time.

End with: findings table, what you changed (files), what you want me to run, and a verdict.
