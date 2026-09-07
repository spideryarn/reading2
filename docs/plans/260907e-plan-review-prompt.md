# Review: a plan for three small postmortem preventions, before any of it is built

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907`
(a git worktree of the Spideryarn repo), branch `worktree-worktree-postmortem-preventions-260907`.
TypeScript + ESM, run with `tsx`, tests are vitest, React on the client, Postgres + Supabase Storage
for the store. This is a **plan review**: nothing has been built yet, so there is no diff. Review the
plan's design, not an implementation.

## The candidate

Live pre-commit; base `6b57e0f1` (merged with `origin/dev`).
Untracked, and the only thing to review:

- `docs/plans/260907e-small-uncontested-postmortem-preventions-batch.md`
- `docs/plans/260907e-plan-review-prompt.md` (this file — context, not under review)

Not durable — I will record the resulting commit SHA in the plan doc once it lands.

Start with the plan doc. Everything it cites is in the tree and readable; this is where to begin,
not the limit of scope.

## What it is meant to do

An audit of `docs/postmortems/` found ~90 recorded prevention recommendations that were never built.
This job takes three that are small, mechanical, and turn a habit into a check, plus a fourth to be
chosen from a trawl still running. Each is one stage: a red-first test, a small fix, a review.

The files that matter, so you can check my reading of them:

- Stage 1: `src/web/AppBoundary.tsx:52`, `src/web/LazyPage.tsx:107`,
  `src/web/FeatureBoundary.tsx:186`, `src/web/log-buffer.ts` (§ `nameOfThrown`, ~line 384),
  `src/web/monitoring.ts:162`, `tests/no-boundary-reads-the-caught-value.test.ts`,
  `tests/every-boundary-contains-a-throw-that-is-not-an-error.test.tsx`.
- Stage 2: `src/store/db-errors.ts` (§ `mayPassThrough`, ~line 433), `src/routes.ts` (the six
  `instanceof` sites — lines 768, 920, 6424, 6439, 6444), `src/comments.ts` (`CommentIdTaken`,
  `NotAnExplanation`), `src/store/article-rows.ts:449` and `:642` (`ArticleNotFound`),
  `src/embeddings.ts:189` (`EmbeddingFailure`), `tests/helpers/ts-ast.ts`, and
  `docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md` (the recommendation, item 4 under
  "What would have caught the whole class", and the table of siblings above it).
- Stage 3: `src/parse-json.ts` (module header, `dropTrailingCommas` ~line 330, `parseJsonAnswer`
  ~line 560), `docs/project/logging.md`,
  `docs/postmortems/260906b-asking-a-model-to-omit-a-field-makes-it-emit-the-comma-anyway.md`.

Deliberately out of scope, and I want to know if you think that is wrong rather than have you design
them: quarantining raw model answers on a parse failure; a comma warning in every prompt's schema
section; any call-graph analysis of what is thrown from inside a guarded store; anything touching a
defence listed in `docs/project/security-map.md`.

House rules the plan has to obey, in case one of them is being broken:

- `docs/project/logging.md` — server code logs through `src/log.ts`, CLI code uses `console.log`,
  and **article prose and model output are never logged**. `src/parse-json.ts`'s whole reason to
  exist is that `JSON.parse`'s error message quotes its input.
- `docs/reusable/silent-success.md` — a check that has never been seen to fail is not evidence.
- Prefer simple over easy; prefer the simplest version first; do not add a second way to do
  something the codebase can already do.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can build
a throwaway harness under `/tmp`. You have **no network, not even loopback**, so anything needing
Postgres will skip. `tests/no-boundary-reads-the-caught-value.test.ts` and
`tests/parse-json.test.ts` need nothing outside the tree and are worth running if you want to see
the existing machinery work.

## Attack it

Independently, and before you read my own questions at the bottom.

The invariants to try to break:

1. **Stage 2's check would not have caught the bug it is named after.** The bug: `CommentIdTaken`
   (409) and `NotAnExplanation` (404/409) were thrown from inside a guarded store, `guardDbStore`
   replaced them with a generic scrubbed error, and `src/routes.ts`'s `instanceof` branches could
   not match, so both surfaced as 500. Would the proposed check have gone red on the tree as it
   stood on 2026-08-28? Reconstruct that rather than take my word.
2. **Stage 2's check is wrong about the tree today** — my table of five classes, the claim that
   `ArticleNotFound` and `EmbeddingFailure` are unreachable from a guarded store, or the claim that
   nothing else in `src/routes.ts` maps a class to a status. Check the `instanceof` list is complete
   and that I have not missed a place where a class-to-status mapping happens by another spelling.
3. **Stage 2's exemption list (clause 3) is a trap of the same kind as the one it replaces.** The
   original bug was an allowlist that a new class silently failed to join. Is the exemption list a
   second allowlist with the same failure mode, and if so is there a formulation that does not need
   one?
4. **Stage 3's observer seam is the wrong shape.** It is global mutable state in a module whose
   entire discipline is about not letting content escape. Can an observer be registered that
   receives something it should not? Is the `source` string genuinely always one of our own
   constants at all 37 call sites, or can a caller pass something derived from content? Is there a
   simpler design that still reports from both a request path and a CLI?
5. **Stage 3 counts the wrong event.** The plan counts only `removed > 0` *and* a subsequently
   successful parse. Trace `parseJsonAnswer` and say whether that is reachable, whether it
   under-counts something worth knowing, and whether a repair can fire on a path the plan has not
   noticed.
6. **Stage 1 is not worth doing at all**, or is bigger than the plan thinks. Does retyping three
   `componentDidCatch` parameters to `unknown` typecheck against React's own declarations under this
   repo's `strict` settings, or does it need a cast, an override, or a change nobody wants? If it
   needs a cast, the stage's whole argument collapses and I would rather hear that now.
7. **The stage boundaries are wrong** — a stage that does not leave the tree in a good state, or two
   that should be one, or one that should be dropped. "This stage is not worth its cost" is a
   conclusion I want, not one I will resist.

For each finding give:

- an ID (`F1`, `F2`, …), a severity, and whether it is **established** or **reasoned**
- (a) what shows it fails its own claim, (b) the smallest fix, (c) what would have caught it

Severity, graded by consequence — a defect in a doc that will cause a P1 to ship is not a P3 because
it is made of prose:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Established** means direct evidence with no unresolved material inference — an observed failing
run, an exact reachable source path, or an authoritative contract the plan directly contradicts. If
a load-bearing premise is still inferred, it is **reasoned**: those rank and inform but do not block.

Finish with a verdict: build it as written, build it with the changes you name, or do not build it.

## My own suspicions — read these last

These are already mine and are worth less than anything you find independently. Spend most of the
run above.

- I think Stage 2's clause 3 is the weakest part of the plan, and I could not find a formulation
  that avoids it without a call-graph analysis I do not want to build tonight. I would like to be
  told I am wrong about that.
- I suspect Stage 1 may need no test at all beyond the typechecker, in which case the "red-first
  test" ritual is being performed rather than earning anything — but a type-level test does not run
  under vitest in this repo, so the red-first evidence would have to be a `typecheck` transcript. Is
  that acceptable evidence, or is the AST-sweep test the honest home for it?
- I am least confident about where Stage 3's observer should be registered, and the plan does not
  say. Naming the wrong composition root would mean repairs in a request path going uncounted while
  the test passes — which is the failure mode this whole batch is about.
