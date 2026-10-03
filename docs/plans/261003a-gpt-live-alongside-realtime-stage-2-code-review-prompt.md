# Code review and fix: 261003a stages 1 and 2 (server half)

You are the reviewer-fixer for two stages of
`docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md`. Read the plan first, and
your own plan review beside it (`…-plan-review-sol.md`): F4 and F5 are what Stage 2 had to answer.

## What to review

- Stage 1: `git diff 42864ede9^..66b001ae4 -- src/live.ts tests/live.test.ts` (prompt additions to
  the Realtime engine).
- Stage 2: `git diff a8b7a4873..b3d4b4c9e` (the GPT-Live server half: `src/live-gpt.ts`,
  `src/live.ts`, `src/routes.ts`, `src/pricing.ts`, `src/types.ts`, `src/ai-spend.ts`,
  `src/db/schema.ts`, `src/store/*`, `drizzle/20261003105818_*`, and their tests).

Real provider event shapes are in `evals/live/gpt-live-spike/spike-out-allow.json` (and the README
there). The exact create request that worked is in `spike-server.ts`.

## What you may change

**Another agent is, right now, building the browser half under `src/web/**` and
`tests/gpt-live-*.test.ts` / `tests/*gpt-live*flow*`. Do not read conclusions from, or edit,
anything under `src/web/`.** Your files are the server ones listed above and their tests.

Fix what is wrong **inside these two stages**, narrowly, each finding red-first with the test that
reproduces it. Report, do not fix, anything wider. Do not change the wire contract the browser will
use (`GptLiveTicket`, `GptLiveUsage`, `/spoken`'s `engine`) without saying so prominently at the
top of your answer — the other agent is coding against it. You cannot commit (linked worktree);
leave your changes in the tree.

You have no network and no database. Tests that need Postgres are mine to run: say which ones you
want run and why, and do not report a sandbox red as a finding. You can run
`npx vitest run tests/live-gpt-server.test.ts tests/realtime-usage.test.ts tests/live.test.ts`.

## Severity and form

P0 wrong or unsafe as shipped · P1 real defect, fix now · P2 note. Every finding gets an id
(C1…), file:line, whether you fixed it, and the test that went red.

## Look hardest at

- The meter: `advanceVoiceSeconds` — lock, delta, row id, the create-time 15 s, cross-engine
  refusal, what a report after `acceptsUntil` does, and whether any path can price the same second
  twice or lose seconds. The check constraint tying `voice_seconds` to `voice` rows.
- The route's order of operations and every failure exit: journal failure, create failure, create
  success followed by a failed transaction (the session exists at OpenAI and is billing — what
  does the reader get, and what does the ledger say?).
- The migration SQL against the schema file, and whether it is safe on a production table with
  existing rows (it will be applied before the code that uses it).
- The two prompts in `src/live-gpt.ts`, against `docs/project/prompting-guide.md` and OpenAI's
  Live prompting guidance: will the voice delegate when it must, and stay quiet rather than guess?
  Can the backend's answer carry a block id into speech? Is article text clearly fenced as source
  rather than instruction?
- The token budget: can any article, profile or history push `session.instructions` over 16,384
  tokens or `session.input` over 8,192 and make the create fail with a 400?
- The data-channel allowlist against the events the plan's browser loop needs.
- Auth and ownership on the new route, compared line by line with `liveChatToken`.
- Stage 1's prompt: does the preamble rule contradict anything left in `LIVE_SYSTEM`?

## My suspicions, last

Backend cached input is priced as fresh (`+cached-as-fresh`): is an overstatement the right
direction for this ledger, and is it visible in `npm run cost`? The session row's `model` is what
we asked for, not what OpenAI created. `pessimisticTokens` is a guess with no tokenizer behind it.

End with: findings table, what you changed (files), what you want me to run, and a verdict.
