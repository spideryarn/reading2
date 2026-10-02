# Build: 261001s stage 3b, part 1 — cache identity, then Ideas, Sketch and Quotes

You are the **builder**; Claude (Opus) reviews every hunk and runs any paid eval. Read first:
`docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md` (§ Stage 3b and the Ledger),
your own survey `docs/plans/261001s-reviews/stage3a-survey-sol.md` (rows for Ideas, Sketch, Quotes,
and § Surprises), `src/messages-structured-output.ts` (the validator, `assertNoBlockIdEnums`,
`withMessagesJsonSchema`), and how Structure adopted it in `src/hierarchy.ts`
(`STRUCTURE_OUTPUT_SCHEMA`, `structureRequest`). Structure's stage 2 is committed but not pushed;
its paid measurements are running now — do not touch `src/hierarchy*.ts`.

## Scope

1. **Schema identity in cache compatibility, first.** `sharesArticleCache` (src/pipeline.ts) and
   whatever it reads (src/models.ts) must treat two stages as cache-compatible only if they send
   the same `output_config.format` (or both send none). Make it impossible to forget: the schema
   a stage sends should be the same value the predicate compares (one source, e.g. each stage
   exports its schema constant and the grouping table references it, or the table holds it), so a
   stage cannot adopt a schema without the grouping knowing. Red-first grouping tests: two
   stages with equal effort and renderer but different schemas do not share; with the same schema
   (or none) they still do. Update `tests/article-cache-group.test.ts` and anything else that pins
   today's groups, and say in your report which groups dissolve.
2. **Ideas, Sketch, Quotes** — each: a schema constant beside the stage's parser that encodes
   exactly what the parser accepts today (do not tighten what the parser tolerates, and do not
   loosen it), validated at module load and passed through `withMessagesJsonSchema` on the
   request; `assertNoBlockIdEnums` naming every field that carries a block id; the existing
   refusal and `max_tokens` checks kept before the parse; post-parse semantic validation (id
   resolution, quote matching, numeric bounds, coordinates) unchanged. Sketch's five-way item
   union goes in `anyOf`; check the optional-parameter total stays ≤ 24 and the union count ≤ 16
   across the schema, and if it does not, say what you did and why. The schema must not change any
   prompt text unless the prompt's own wording contradicts the schema; if a prompt version stamp
   exists for the stage and the request bytes change, move it with a history comment as
   `PROMPT_VERSION` was moved.
3. Each stage's request-shape tests (parity/pins) updated, plus a red-first test per stage that the
   request carries the schema with its effort intact.

## Out of scope

Every other call in the survey (later parts), the chat wire, the thinking-effort harness itself
(Claude will run it — but tell Claude whether it needs any change to measure Ideas at
`high`/`medium`/`low` and Sketch before/after with the schema; if it needs a "no schema" base arm
for Sketch's same-effort before/after, add one, byte-pinned like `evals/hierarchy-structure/toc10-frozen.ts`).

## Gates, house rules, report

As in your stage-2 brief (`docs/plans/261001s-reviews/stage2-build-prompt.md` § Gates, § House
rules, § Report back): typecheck (fallback allowed and stated), vitest on touched files plus the
stages' existing tests and `tests/doc-links.test.ts`; no state-changing git; no commits; strict
types; never log prose. Report the exact eval commands Claude should run for Ideas
(`high`/`medium`/`low` under the schema) and Sketch (same-effort before/after), and the Quotes
validity count.
