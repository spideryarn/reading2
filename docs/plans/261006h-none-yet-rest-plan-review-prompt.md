# Review request: the plan 261006h, before anything is built

You are reviewing a **plan**, read-only. Do not change any file.

**Candidate:** `docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md`
at `HEAD` of this worktree. Nothing is built yet. It extends a mechanism that is already built and
on this branch: plan `docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md`
(Stage 1), whose code review is `docs/plans/261006g-stage-1-code-review-sol.md`.

Start with: `src/routes.ts` § `orNullWhenNotMadeYet`, `withProfileChanged`, and the GET handlers for
`/api/{simple,ideas,faq,timeline,debate,glossary,quotes}/:slug` beside the three already moved
(`quiz`, `crossrefs`, `citations`); `src/store/pg.ts` § the seven loaders;
`src/store/artefact-not-made-yet.ts`; the seven hooks under `src/web/use*.ts` beside
`src/web/useQuiz.ts`; `src/web/lib/api.ts` § `NONE_YET_AS_NULL` and the offline cache;
`tests/none-yet-*.test.*`. The list does not limit scope.

## What to do

1. An independent pass first: is any claim in the plan about the code false (grep it), what would
   go wrong building it as written, and is the plan heavier or lighter than the problem?
2. Then the suspicions at the bottom.

## Severity scale and output

- **P0** — would lose data or break production for readers. **P1** — the plan as written produces a
  wrong or regressed result. **P2** — worth changing, not blocking. **P3** — nit.
- Give every finding an ID (`F1`, `F2`, …), its severity, the evidence (file and line), and the
  change you would make to the plan.
- End with one line: `VERDICT: build it` / `VERDICT: build it after the P1s` / `VERDICT: rethink`.

## My own suspicions — already mine, worth less; spend most of the run elsewhere

- Other callers of the seven loaders that tell "not made yet" from another failure by something the
  class change could disturb (an error's `name`, its message, `instanceof Error` with
  `Object.assign` fields, `guardDbStore` in `src/store/db-errors.ts`).
- Other readers of the seven URLs than the seven hooks (Marginalia, Skim, Search, an offline
  "save this article" walk, the public or visitor path) that would now get a `null` they did not
  ask for, or that should ask and are not in the plan.
- `Cache-Control: private, no-store` newly on seven routes: does anything depend on those answers
  being cacheable (a service worker, the offline cache, a test)?
- Glossary's `alsoFrom` / `panelRun` and Quotes' `clearedCountsAsChanged`: is wrapping the outside
  of `withProfileChanged` right for those two, given `resolveProfile` runs in parallel with the
  load and its rejection is handled inside?
- `loadDebate` appears to have two "not there" conditions; which is "never made"?
