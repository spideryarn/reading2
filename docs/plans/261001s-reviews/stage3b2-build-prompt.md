# Build: 261001s stage 3b, part 2 — the remaining Messages-wire calls at medium/high effort

You are the **builder**; Claude reviews every hunk. Do not dispatch any reviewer yourself.

Read: the plan (`docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md`, Ledger
included), your survey (`docs/plans/261001s-reviews/stage3a-survey-sol.md`), and how part 1 did
it — commit `0f53bfc8d` (`src/ideas.ts`, `src/sketch.ts`, `src/quotes.ts`, `ARTICLE_OUTPUT_FORMAT`
in `src/pipeline.ts`, `tests/article-cache-output-format.test.ts`) plus the fix round
(`docs/plans/261001s-reviews/stage3b1-fix-prompt.md`).

## Scope

Migrate exactly these Messages-wire calls onto `withMessagesJsonSchema`, one schema constant per
call, validated at module load, `assertNoBlockIdEnums` naming every field that carries a block id:

Arc (`src/arc.ts`), Tweets (`src/tweets.ts` — keep the legacy string row via `anyOf`), Glossary
(`src/glossary.ts`), Timeline (`src/timeline.ts`), Quiz (`src/quiz.ts`), FAQ (`src/faq.ts`),
Cross-references (`src/crossrefs.ts`), Simple summaries (`src/simple-summary.ts`, every attempt),
Citations list (`src/citations.ts`), Illustrated's brief-writing call (`src/illustrated.ts`).

**The rule from the part-1 fix round, binding:** a schema encodes the contract the prompt already
states — never looser than the prompt, never stricter than the parser — and **no prompt text
changes**. If a prompt and its parser genuinely disagree, do not resolve it: leave that field as
the parser allows, and list the disagreement in your report for Claude.

For each: refusal and `max_tokens` checks stay before the parse; post-parse semantic checks
(id resolution, quote matching, numeric bounds) unchanged; the stage's version stamp moves with a
history line ("the request gained a schema; the prompt text is unchanged") if one exists and the
request bytes change; its row in `ARTICLE_OUTPUT_FORMAT` (for article stages) points at the same
schema constant, and `tests/article-cache-output-format.test.ts` keeps proving it. Report which
cache groups dissolve; Tweets/Timeline/Quiz/FAQ/Simple currently share `ids/high` — if any two
end up with byte-identical schemas they still share; otherwise say they no longer do.

## Out of scope

Skim, Labels, scoped Structure expansion (low effort — a later part with a quality check), every
chat-wire call, `src/hierarchy*.ts`, Ideas/Sketch/Quotes (done).

## Tests, gates, report

Red-first test per call that the request carries its schema with effort intact; each stage's
existing tests green. Typecheck (fallback allowed, stated); vitest on every touched test file plus
`tests/article-cache-*.test.ts` and `tests/doc-links.test.ts`. No state-changing git, no commits.
Report files, red evidence, gate output verbatim, any prompt/parser disagreement you left alone,
dissolved cache groups, and which evals (if any) Claude could run cheaply for a validity count.
