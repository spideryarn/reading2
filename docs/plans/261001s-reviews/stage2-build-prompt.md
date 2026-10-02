# Build: 261001s stage 2

You are the **builder**; Claude (Opus) reviews every hunk and runs the paid evals (you have no
network). Read first: `docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md` — the
whole plan, **§ Stage 2** closely, and the Ledger's stage-1 entry (including the replay result and
the overruled gate, which you are invited to challenge in your report). Stage 1 is committed
(`3f09cf8bf`): `src/messages-structured-output.ts`, `src/start-ranges.ts`, `src/hierarchy-starts.ts`.

## Scope

1. **Structure goes to `toc/11`: starts-only and schema-constrained.**
   - `SYSTEM`'s STRUCTURE/OUTPUT wording asks for a `start` per child and no range anywhere, worded
     the way `src/hierarchy-expand.ts` words it; the root has no `start`. Keep every other block of
     SYSTEM (GISTS, QUESTIONS, plain words, paperwork) byte-identical so evals that slice them keep
     working.
   - A three-level unrolled JSON schema (root → depth-1 → depth-2; no deeper, matching "Go 3 levels
     deep") built once at module load, validated by `validateAnthropicJsonSchema`, checked by
     `assertNoBlockIdEnums(schema, ["start"])`, and attached with `withMessagesJsonSchema` inside
     `structureRequest`, so `params` (and therefore the checkpoint digest) carries it.
     Fields per node as today minus `range` plus `start` (not on root); `required` as the prompt
     demands (title, gist, start where applicable; question on root and depth 1 as today's prompt
     says — read `questionFor`/`MAX_QUESTION_DEPTH` and do not make the schema stricter than the
     builder's own rules without saying so). Respect the validator's optional-parameter ceiling.
   - The parse path: `treeFrom` parses the starts-only answer and converts it with
     `modelNodeFromStarts` before `buildTree`, passing the same `BuildReport`. Keep refusal and
     `max_tokens` checks before the parse, as today. An invented start must still refuse with
     today's message.
   - `PROMPT_VERSION` → `"toc/11"` with a history comment in the house style (why: 261001s; what
     changed; new articles only). Move the pins: the parity test, the hoist pin and its digest,
     `EXPANSION_PROMPT_STAMP` (`toc/11+expand/7`) and `tests/hierarchy-expand.test.ts`. Add a test
     that a `toc/10` structure checkpoint is not resumed under `toc/11`.
   - Every eval that parses a structure answer goes through the production parse+converter
     (`parseStructureAnswer` or its successor), not its own: `evals/hierarchy-structure/model-arms.ts`,
     `evals/paperwork/run.ts`, `evals/plain-words/run.ts`, `evals/paperwork/structure-parse.ts`,
     and anything else `grep` finds.
2. **Eval plumbing for the measurements Claude will run.**
   - `evals/paperwork/structure-parse.ts`: wrap each article's draws in `collectSpend`
     (`scopeKind: "eval"`, as `evals/paperwork/run.ts` and `evals/thinking-effort/run.ts` do), and
     record per row: thinking tokens, output tokens, cost, duration, and — for answers that parse —
     whether the tree builds, dropped children, dropped authored headings, depth-1 count, refused
     invented start. Keep every raw answer. Extend `tally` to print these per label.
   - `evals/hierarchy-structure/run.ts`: wrap in `collectSpend` the same way (it records no spend
     today — r2 G3).
   - **A frozen `toc/10` arm** in `evals/hierarchy-structure/` (name it e.g. `toc10-frozen`) that
     sends the exact `toc/10` request, byte for byte — the old SYSTEM, ranged output, no schema —
     and parses with the old ranged path. Prove the bytes with a test against the toc/10 parity
     fixture as it stood at `3f09cf8bf` (copy the expected bytes into the test before you change
     the live pin). This is the pre-registered quality panel's base; `incumbent` becomes `toc/11`.
     Also a `toc11-think-first` arm: `toc/11` plus Anthropic's think-first line (find Anthropic's
     wording in their Sonnet prompting guidance if you can; otherwise "Think the problem through
     before you answer." and say so), for the fallback the plan names.
   - Check `evals/thinking-effort/hierarchy-panel.sh` and the lineup/judging path still work with
     the new arms; adjust the panel script to run `toc10-frozen ×2` and `incumbent ×2` (toc/11),
     and say how to build lineups and judge them (cite the files).

## Out of scope

Stage 3 (any other stage's calls), the chat wire, docs beyond code comments and the plan's
ledger. Report anything wider.

## Tests — red first

Write each before its code and watch it fail: the schema passes the validator and the id-enum
assertion; `structureRequest` params carry `output_config.format` with `effort: "low"` intact; a
starts-only answer builds the tree the converter promises; an invented start refuses; a `toc/10`
checkpoint misses under `toc/11`; the frozen arm's request equals the toc/10 bytes; the
structure-parse row fields.

## Gates

`npm run typecheck` (or `node --import tsx scripts/typecheck.ts` if tsx's socket is denied — say
so), and `npx vitest run` on every test file you touched plus `tests/hierarchy-*.test.ts`,
`tests/messages-structured-output.test.ts`, `tests/structure-starts-replay.test.ts`,
`tests/doc-links.test.ts`. List any test you could not run (Postgres) rather than skipping.

## House rules

No git commands that change anything (read-only diff/log/show/status only). No commits. Strict
types, discriminated unions, no `any`. Never log article prose or model text. Match the comment
density around you.

## Report back

Files changed and why; each test and whether you saw it red; gate output verbatim; the exact
commands Claude should run for (a) the validity arm and (b) the quality panel (both arms, lineups,
both judges); anything you could not run; anything wider; and your view on the stage-1 replay
overrule.
