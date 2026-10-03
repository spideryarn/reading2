You are reviewing CODE in the repo at the current working directory (a git worktree). The work is two commits on top of 59bd41171: `2f068a1d6` (stage 1) and `18eaf5951` (stage 2). The scoped diff is docs/plans/261003f-marginalia-code-review.diff (drizzle/meta left out); `git diff 59bd41171 HEAD` is the same thing.

Read first: docs/plans/261003f-marginalia-relation-words-and-timeline-events.md (the plan, and at its end what was taken from your plan review), docs/project/marginalia.md, AGENTS.md § Working agreements.

What was built:
- Stage 1: Timeline's dated events as a shut kind in the Marginalia column (src/web/marginalia/notes.ts, MarginaliaColumn.tsx, tips.ts; Reader.tsx wiring).
- Stage 2: a new pipeline step `relations` (src/relations.ts and its registrations across src/, a migration drizzle/20261003103702_relations.sql, GET /api/relations/:slug), read by src/web/useRelations.ts, drawn as so/but/vs by `RelationWord`; started by the press that turns the column on (src/web/activation.ts MODE_TARGET.marginalia, src/web/Dock.tsx useActivateMode, useAutoRun).

House rule since 2026-09-09: you FIX what you find inside this scope (edit the files, keep the surrounding style and comment density), and REPORT anything wider for me to decide. Do not commit. Do not run the whole `npm test` (26 minutes); run `npm run typecheck` and the specific vitest files you touch (`npx vitest run <files>`). Do not run git commands that discard work. Do not edit drizzle/20261003103702_relations.sql (its hash is in the local ledger) — report instead.

Look especially for, with the concrete failing scenario for each finding:
1. Spending: any path where a relations job starts without a press (mount, reload, Back, pasted ?margin=1, a visitor, the off-press, the command bar while the column is on, a slug change in the same mount, StrictMode double effects), or starts twice for one press, or loops after a failure. Trace claimActivation/useAutoRun/beginAutoAttempt with `useRelations` passing "none" for a stale/outdated artefact: can a `ready`-but-outdated artefact cause a run on every press forever if the step's own stamp check skips it (stamp says current, client says outdated), or the reverse?
2. A visitor: is there ANY route by which a non-owner receives relations (public reader/DTO, export, the GET route's auth, shareable artefacts, the offline cache in src/web/lib/api.ts)?
3. src/relations.ts: the eligible list vs what the client draws beside (the client keys on block id; is every eligible id a block the margin can draw beside?), the validation and the under-half failure, the zero-eligible path, token budget, the fingerprint vs the actual prompt inputs, the paperwork sentence, log line (counts only, no prose).
4. Registrations that are NOT compile-checked and may be missing or wrong: the SQL CHECK and schema.ts agreeing, REVISION_CARRY_POLICY and what happens to relations when blocks change (carried but stale: does the owner's GET say stale?), export/import round trip, reset roles, STEP_SHARING, cost categories, the jobs tray label.
5. Timeline in the margin (notes.ts): placement at `when.at`, the `words` branch, the quote checks, and whether a visitor's stale timeline can mislead more in the margin than it already does in the band.
6. React correctness in MarginaliaColumn.tsx / Reader.tsx: the memo dependencies (I added `owner` and `ownerFeed.relations`), `useMarginLayout` re-measuring when words arrive, the feed's effect identity (does `relations` change identity every render and loop `onFeed`?).
7. Tests that cannot fail, or that assert the implementation rather than the behaviour.

Write your answer as: a ranked list P0/P1/P2, each with file:line, the scenario, and whether you FIXED it (and how) or are REPORTING it. Then the typecheck and test results you saw. Be concrete and concise.
