Code review of one stage, and you fix what you find inside it.

Candidate: commit 97179213f on branch worktree-why-reading-feeds-the-bar (its parent is 832370faa).
`git show --stat 97179213f` lists every changed path; `git diff 832370faa 97179213f` is the diff.
Start with: src/types.ts (`ThreadOrigin`, `isLensOrigin`, `sameOrigin`), src/thread-origin.ts,
src/routes.ts (`parseOrigin`, `parseLens`, `streamChat`), src/db/schema.ts (`chat_threads`),
drizzle/20261005185425_chat_thread_origin_lens.sql, src/web/DebatePanel.tsx (`Angles`),
src/web/useChatAnchors.ts (`lensThreads`), src/web/chat-handoff.ts (`askDebateThroughLens`),
src/web/reader/Reader.tsx (`debateThroughLensInChat`), src/web/thread-source.ts,
src/web/ChatPanel.tsx, src/web/styles/debate.css, and the tests the commit adds or changes. That
list does not limit scope.

What the stage is for: docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md,
§ A and "Stage 1", and its Log entry for what the implementer says is not done. The plan review is
docs/plans/261005k-plan-review-sol.md (F7, answers 1 and 2). It extends
docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md.

Do an independent pass first. Read the code and the call sites, not only the changed functions:
every place a `ThreadOrigin` is made, stored, read, compared or drawn, on the server and in the
browser, including paths the commit did not touch (src/chat.ts, src/store/pg-chat.ts,
src/store/export.ts, retry and edit, Live). Look for what would go wrong for a reader, for an
existing claim chat, for a visitor, on a phone, or at deploy (the migration against a table that
already holds claim rows; code that lands before the migration).

You may fix: defects inside this stage, narrowly, with a test you saw fail first where a test can
reach it. Report and do not fix: anything wider. Do not commit. Do not touch the database
migration files' history (a wrong migration is a finding with a proposed replacement, since it has
not been applied anywhere yet you may regenerate it with `npm run db:generate` only if the schema
itself must change). You have no network and no Postgres: tests that need a database are mine to
run, so say which ones you want run and what you expect. Tests that need nothing outside the tree
you should run yourself (for example `npx vitest run tests/debate-lens.test.tsx tests/chat-handoff.test.ts tests/thread-origin-way-back.test.ts`).
When you edit a doc, never write words as Greg's unless they are quoted exactly from the plan.

Then say whether each of these holds. They are my own suspicions and worth less than what you find:

1. `isLensOrigin` is `"lens" in origin`. Any origin object built with `lens: undefined`, or read
   from JSON or the export, that this misreads?
2. The three CHECKs: is there any row the mapper would write that they refuse, or any row they
   allow that `originFromColumns` drops silently?
3. The box in the panel: Enter during IME composition; a double press; an empty or blank lens; what
   the reader sees when Chat's band is already open with an unsent draft; focus afterwards.
4. `Your angles`: thread deleted or renamed elsewhere; two chats with one lens; the list after the
   reader hands off but never sends (there is no thread yet).
5. The seed text in `askDebateThroughLens`: plain words (docs/project/prompting-guide.md), and the
   fence.
6. Docs and the help page say only what the code does.

Severity, by consequence: P0 data loss, security, wrong charging, service unusable; P1 user-visible
wrong behaviour or an authoritative contract violated; P2 design or maintainability risk with no
wrong behaviour today; P3 prose or comment defect. Number findings CR1, CR2 …; for each give the
severity, whether you established it (ran or traced) or reasoned to it, file:line, and whether you
fixed it. List every file you changed.

End with one line: `VERDICT: land` / `VERDICT: land with my fixes` / `VERDICT: do not land`.
