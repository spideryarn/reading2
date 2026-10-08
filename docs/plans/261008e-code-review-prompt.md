# Code review: 261008e, Chat knows the reader's other conversations

You are reviewing built code in the Spideryarn repo (this worktree), before it is pushed. You may
edit files to fix what you find **inside this change's scope**; report anything wider for me to
decide. Do not commit, do not run git commands that change history or the index, do not touch
`.env.local`, and do not run anything against a remote database.

Read first:
- the plan, `docs/plans/261008e-chat-knows-the-reader-s-other-conversations.md` (your own plan
  review is `docs/plans/261008e-plan-review-sol.md`; check each of its points was handled as the
  plan says);
- the diff, `docs/plans/261008e-code-review.diff` (scoped to src/, tests/, evals/ and the
  migration). The doc changes are in `docs/project/chat-tools.md` and `docs/project/setup-dev.md`.

Then check against the code, numbered findings with file:line, most severe first:

1. `streamChat` in `src/routes.ts`: the gist is awaited after the `finally` (after `release()` and
   `res.end()`). Is that right in every path — success, error, client disconnect, stop, a superseded
   attempt? Can it delay or break anything (the next turn, the stream key, Vercel, the dev server,
   tests that count requests)? Does its model call land on the ledger in request scope as claimed
   (`src/ai-spend.ts`, `src/vercel.ts`)?
2. `chatStore.setGist` in `src/store/pg-chat.ts`: the millisecond compare-and-set. Is the
   `date_trunc('milliseconds', updated_at) = basedOn` comparison sound given how `updatedAt` is
   read back (node-postgres → JS Date → ISO)? Rounding vs truncation? Time zones? Any write path
   that changes the transcript without bumping `updated_at`?
3. `refreshGist`: the "this turn's answer landed" check; owner scope after the response.
4. `src/chat-gist.ts`: the prompt, parsing, caps, the fence, `answerAsSeen`; anything a hostile
   transcript could do.
5. `src/reader-notes.ts`: `indexRow`'s gist and `lastAsked` fallback, `otherConversationsSection`,
   the raised `THREADS_CHARS` — does any hard-budget promise in that file's header or in
   `readerNotesDigest` (Explore's digest, `READER_NOTES_CHARS`) now break? Tests that pin these.
6. `src/converse.ts`: `othersSection` placement below the cache breakpoint; the new SYSTEM bullet
   and the tool description wording (`src/chat-tools.ts`) — would they make the model open
   conversations too eagerly, or contradict another rule in SYSTEM?
7. Registrations: `chat-gist` in every table it must be in (models.ts, ai-call.ts, cost-categories.ts,
   plain-words.ts, `NON_TASK_MODELS`), the export (`src/store/export.ts`, `export-bundle.ts`), and
   anything else that enumerates `chat_threads` columns or `ChatThread` fields.
8. Tests: are they testing the real thing; is anything important untested?

Run `npm run typecheck` and the touched suites (`npx vitest run tests/chat-gist.test.ts
tests/chat-gist-store.test.ts tests/reader-notes-tool.test.ts tests/explore-digest-route.test.ts
tests/chat-tools.test.ts tests/plain-words-coverage.test.ts`) after any fix. List every file you
changed and why. End with a one-line verdict: SHIP / SHIP AFTER MY FIXES / DO NOT SHIP.
