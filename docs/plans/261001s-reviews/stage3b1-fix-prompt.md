# Fix: 261001s stage 3b part 1 — two findings from Claude's review

You built stage 3b part 1 (your report: `docs/plans/261001s-reviews/stage3b1-build-sol.md`; the
work is uncommitted in this tree). Claude reviewed every hunk. Fix exactly these two, red-first,
and nothing else. Do not dispatch any reviewer yourself (no `run-claude.ts`, no `run-codex.ts`):
Claude is the reviewer.

## R1 (P1) — Ideas must not change its prompt text

My brief told you to encode "exactly what the parser accepts", and that was the wrong rule; the
consequence is mine to own, the fix is yours. The `ideas/3` prompt asks for `reasoning` on every
occurrence and lets `whyYouNeedIt` and `analogy` be omitted on any idea. Your change tells the
model it may now omit `reasoning` on introduced occurrences, which removes reasoning lines a
reader sees — a product change nobody asked for — and makes `whyYouNeedIt` required on assumed
ideas, which is stricter than the prompt.

Rule from now on: **a schema encodes the contract the prompt already states**, never looser than
the prompt (no new freedom for the model) and never stricter than the parser (no answer today's
parser would accept becomes unrepresentable unless the prompt already forbids it).

So: revert every prose change in `src/ideas.ts`'s prompt; the schema becomes one idea object
(no `anyOf` on provenance — `provenance` a string `enum` of the two values) with `whyYouNeedIt`
and `analogy` optional and `reasoning` required on every occurrence; keep `ideas/4` with its
history line rewritten to say the request gained a schema and the prompt text is unchanged.
Re-check Sketch and Quotes against the same rule and say so (I read both as fine).

## R2 (P2) — the cache table must be tied to what each stage actually sends

`ARTICLE_OUTPUT_FORMAT` is a hand-maintained table. A stage that adopts a schema at its request
seam but whose row still says `null` would be grouped as cache-compatible with stages it can never
share with — a silent 1.25× write premium. Nothing fails today if that happens.

Add a test that, for **every** `ArticleStage`, captures the Messages body the stage really sends
(drive the generator with a stubbed stream, as the stage's existing tests do, or call its request
builder if it has one) and asserts `body.output_config?.format ?? null` deep-equals
`ARTICLE_OUTPUT_FORMAT[stage]`. Watch it go red by temporarily setting one row wrong, then restore.

## Gates and report

Typecheck (fallback allowed, stated), vitest on every touched test file plus
`tests/article-cache-group.test.ts`, `tests/glossary-ideas-baseline.test.ts` (or whichever tests
Ideas' prompt bytes), `tests/thinking-effort-eval.test.ts`, `tests/doc-links.test.ts`. No
state-changing git, no commits. Report: files changed, red evidence, gate output verbatim.
