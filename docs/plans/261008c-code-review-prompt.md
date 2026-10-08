# Review: 261008c — Chat's "‹ Chats" way back, the model and thinking level in a thread's (i), and Top/↑/↓ between messages

Repo: this worktree (Spideryarn, TypeScript + ESM, React client in `src/web/`, Postgres via
Drizzle, vitest). `CLAUDE.md` has the house rules.

## The candidate

Committed: the single commit at `HEAD` of this worktree's branch (`git show --stat HEAD`). Review
`git diff HEAD~1..HEAD`. Start with:

- `docs/plans/261008c-chat-back-to-the-list-on-a-phone-the-model-in-the-thread-s-i-and-step-between-messages.md`
  — the plan, the plan review's findings F1–F5 and how each was settled, and what landed. Read it
  as a reviewer of the conclusions too.
- `src/web/chat-steps.ts`, `src/web/ChatPanel.tsx` (`head` and `Conversation`: `steps`, `ends`,
  `measureSteps`, `step`, the `.chat-steps` row), `src/web/ChatThreadAbout.tsx`,
  `src/model-names.ts`, `src/models.ts`, `src/converse.ts` (`done`'s `effort`), `src/routes.ts`
  (chat's `finished`), `src/store/pg-chat.ts`, `src/store/export.ts`, `src/db/schema.ts` and
  `drizzle/20261008102903_chat_message_effort.sql`, `src/types.ts`, `src/web/chat/model.ts`, the
  two stylesheets, `src/web/help/pages/modes/chat.md`.

This list does not limit scope.

You may run (jsdom / stubbed fetch, nothing outside the tree): `npx vitest run tests/chat-steps.test.ts
tests/chat-streamed-answer-stays.test.tsx tests/chat-thread-about.test.tsx tests/chat-effort.test.ts
tests/mode-surface-changes-no-markup.test.tsx tests/chat-latest-pill-in-flow.test.ts`.
`tests/store-chat-pg.test.ts` needs Postgres; I ran it: 28 passed, and a mutation (removing the
retry's `effort: null`) turned it red. `tests/chat-effort.test.ts` went red when the stamp was
replaced by a constant. The browser pass (Playwright, WebKit iPhone 390×844 and Chromium 1440): all
three changes pass, step buttons 40×40 with 4px gaps on touch, ↑/↓ sequence correct through a
10-turn thread, and a streamed answer stayed at the reader's chosen position for 6s while it grew.

## What to do

You are the reviewer-fixer: **fix what is wrong inside this change**, narrowly, red test first
where a test can show it; **report, do not fix**, anything wider. Leave fixes uncommitted. Grade P0
data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or a contract
violated; P2 design risk, no wrong behaviour today; P3 prose. IDs continue from the plan review:
start at F6.

Independent pass first. Then, my own suspicions (worth less; spend most of the run elsewhere):

- `measureSteps` now calls `turnStarts` (a `getBoundingClientRect` per turn) on every scroll event
  and every streamed-word layout effect. Is that a real cost, or a layout thrash in the hold path?
- Does anything else write or read `chat_messages` rows field-by-field and now silently drop
  `effort` (a spoken append, an import, the round-trip test's fixtures, `tests/store-roundtrip`)?
- Is the stored `effort` right for a `candidates` or `guide` thread (`jobFor(kind)`)?

End with `VERDICT: approve` / `approve with changes` (and list your fixes) / `refuse`.
