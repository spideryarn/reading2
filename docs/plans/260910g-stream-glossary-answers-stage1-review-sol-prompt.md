You are reviewing the BUILT code for stage 1 of docs/plans/260910g-stream-glossary-answers-as-they-arrive.md
in the Spideryarn repo, in this worktree. House rule since 2026-09-09: you FIX what you find inside
this stage's scope (edit the files), and REPORT anything wider for me to decide. Do not commit, do not
touch .env.local, infra/, systemd or any database other than the local test one, and do not run the
full test suite (the box is shared; it is already running). You may run focused vitest files, e.g.
`npx vitest run tests/glossary-asked-term.test.ts tests/glossary-asked-term-stream.test.tsx
tests/glossary-asked-term-race.test.tsx tests/glossary-asked-term-stream-route.test.ts` and
`npm run typecheck`.

The scoped diff is uncommitted in this worktree: `git diff` plus the untracked files
tests/glossary-asked-term-stream-route.test.ts, tests/glossary-asked-term-stream.test.tsx and the plan
docs. The plan doc's "Evidence" table lists the red runs and three mutations I ran.

What the stage claims (the conclusion I want checked, not just the diff):
1. `POST /api/glossary/:slug/ask` now streams: `begin` {term, blockId, quote}, `delta`*, then exactly
   one `done` (unchanged AskedTermAnswer) or `error`. Every refusal (404 ownership, 400 term, 409
   no-prose/absent/part-word) is still JSON before any header.
2. Partial text can never become `asked` on the client nor a `done` on the server: abandoned,
   truncated and filtered endings throw (refuseUnfinished in src/term-lookup.ts); EOF without a
   terminal frame, an `error` frame, a stall, and a malformed `done` are failures in readAskedTerm
   (src/web/useGlossary.ts).
3. The typed term is never presented as article quotation: `quote` is always anchor.matched.
4. A keystroke (clearAsked), a slug change and unmount abort the fetch; the route passes `gone` to the
   model call so the provider request is cancelled. `asking` is tied to the live controller.
5. Adding `ending` to ExplainEvent's `done` changes nothing for the comments `answer` route or the
   `explain()` drain (which strips it).

The finding I would least like to be wrong about: claim 2 — any path, server or client, where text
that stopped part-way is drawn or returned as a finished answer. Second: whether the `useEffect(() =>
clearAsked, [slug, clearAsked])` cleanup plus the `live.current === controller` guard in `finally`
leaves `asking` stuck true or false in any interleaving (double submit, submit-type-submit, slug change
mid-stream).

Also check: the GlossaryPanel `AskATerm` rendering of `askDraft` vs `asked` vs `askFailed` (ordering,
nothing drawn as "checked" before done); the test harnesses genuinely exercise what they claim (e.g.
the route test's held provider really holds, the "first words before completion" assertion reads the
body before release).

Answer with numbered findings: severity (P0/P1/P2), file:line, the concrete failure, and what you
changed (or why you did not). End with the list of files you edited. Say plainly if a claim holds.
