You are reviewing the BUILT code for stage 2 of docs/plans/260910g-stream-glossary-answers-as-they-arrive.md
in the Spideryarn repo, in this worktree. House rule: you FIX what you find inside this stage's scope
(edit the files) and REPORT anything wider. Do not commit; do not touch .env.local, infra/, systemd or
any non-local database; do not run the full test suite (the box is shared). You may run focused files:
`npx vitest run tests/term-lookup.test.ts tests/glossary-lookup-refusals.test.ts
tests/glossary-lookup-stream.test.tsx tests/glossary-asked-term-stream.test.tsx
tests/glossary-asked-term-race.test.tsx tests/glossary-asked-term.test.ts` and `npm run typecheck`.
(Your sandbox could not reach the local Postgres last time; tests/glossary-lookup-stream-route.test.ts
needs it — read that harness if you cannot run it. I ran it: 7 passed.)

Stage 1 is committed (5ab767c6) and was reviewed by you already
(docs/plans/260910g-stream-glossary-answers-stage1-review-sol.md). Stage 2 is the uncommitted `git diff`
plus untracked tests/glossary-lookup-stream-route.test.ts and tests/glossary-lookup-stream.test.tsx.
The plan's "Stage 2" section and its Evidence table (red runs, three mutations, a browser check) are
the conclusions to check.

What stage 2 claims:
1. `POST /api/glossary/:slug/:id/lookup` streams: refusals (404, the two 409s) are JSON before any
   header; then `delta`* and exactly one `done` ({ entry }, the old JSON body) or `error`.
2. `done` is yielded only after `lookups.save` resolves; a save failure after text is `error`; a
   truncated/filtered/abandoned ending is never saved (refuseUnfinished).
3. The route deliberately does NOT pass `gone` to the model call, so a reader leaving still gets the
   answer stored (the panel promises that). Is that the right call, and is anything left un-bounded
   by it (a lookup that never ends, a runaway spend)? The model call still has its own 120s deadline
   and 45s stall clock.
4. Client `look`: admission via `lookLive` ref; only `done` patches the entry, via `patchEntry(id,
   lookup)` using the REQUEST's id and requiring done.entry.id === id; any failure after the stream
   opened calls `refresh()` so a lookup that was stored despite the error appears; slug change and
   unmount abort the read and clear state, and a late `done` cannot land on the next article's list.
5. `readGlossaryStream` is now shared by `ask` and `look`; the stage-1 ask behaviour is unchanged.
6. `Looked` in GlossaryPanel draws the draft as "arriving…"/"unfinished" with no provenance or
   sources, and the failure sentence above it.

The finding I would least like to be wrong about: claim 2 plus claim 4 together — any interleaving
where the panel shows an answer as kept that is not stored, or stores one the panel then hides
without saying so. Second: claim 3's trade-off.

Answer with numbered findings: severity (P0/P1/P2), file:line, the concrete failure, and what you
changed (or why not). End with the list of files you edited. Say plainly if a claim holds.
