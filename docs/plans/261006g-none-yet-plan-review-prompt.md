# Review request: the plan 261006g, before anything is built

You are reviewing a **plan**, read-only. Do not change any file.

**Candidate (committed):** commit `82e72480ff6f869a8b27f82f5c99e5dd4b8de6b5`, one path:
`docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md`
(`git show 82e72480f`). Nothing is built yet. The tree is readable; the code the plan names is where
to check its claims, and the reading list below does not limit scope.

Start with: `src/routes.ts` (GET handlers for `/api/quiz/:slug`, `/api/crossrefs/:slug`,
`/api/citations/:slug`), `src/store/pg.ts` § `loadQuiz` / `loadCrossrefs` / `loadCitations`,
`src/store/citations-list-not-found.ts`, `src/web/useQuiz.ts`, `src/web/useCitations.ts`,
`src/web/useCrossrefs.ts`, `src/web/lib/api.ts` (`CACHEABLE`, the offline cache, the quiz special
case), `src/web/QuizPanel.tsx`, `src/web/AdminCostsPage.tsx`, the shared `DataTable`.

## What to do

1. An independent pass first: is each stage's design right, is any claim in the plan about the code
   false (grep it), what would go wrong building it as written, and is there a simpler version that
   gets most of the value? These are two small tidy-ups; say so if the plan is heavier than the
   problem.
2. Then the questions at the bottom.

## Severity scale and output

- **P0** — would lose data or break production for readers. **P1** — the plan as written produces a
  wrong or regressed result. **P2** — worth changing, not blocking. **P3** — nit.
- Give every finding an ID (`F1`, `F2`, …), its severity, the evidence (file and line), and the
  change you would make to the plan.
- End with one line: `VERDICT: build it` / `VERDICT: build it after the P1s` / `VERDICT: rethink`.

## My own suspicions — already mine, worth less; spend most of the run elsewhere

- The opt-in request header against plain `200 null` for everyone. Is the old-tab argument true
  (read the hooks as they stand), and is a header the right carrier given how `apiFetch`, the
  offline cache key and any CORS or Vercel layer treat it? Would `Vary` or a cache in front matter?
- Whether a cached `null` in the offline cache can ever be replayed over a newer real artefact in a
  way the 404 could not (is a 404 ever cached?).
- Whether anything else calls these three GET routes (old-client bridges, the public or visitor
  path, tests that pin the 404) that the plan has missed.
- Stage 2: whether a measured fade is the smallest honest cue, and whether `DataTable` already has
  something to reuse.
