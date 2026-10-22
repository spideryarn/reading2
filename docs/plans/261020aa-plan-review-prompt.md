Plan review, read-only. Do not edit files.

Review docs/plans/261020aa-block-id-fields-carry-the-id-pattern-in-the-schema.md in the repo at the current working directory. It answers Greg's request for a clean, schema-level fix to Structure naming blocks that do not exist. Your own design consult is docs/plans/261020aa-design-consult-sol.md. You recommended a paired {line, id}; the plan takes only the exact id pattern, and gives measurements to justify it. Judge that choice on the evidence in the plan and in evals/results/structure-id-pattern/*.jsonl (the harness is evals/structure-id-pattern/run.ts).

The code already exists in the working tree (uncommitted; `git diff HEAD` and the untracked evals/structure-id-pattern/). The code gets its own review afterwards, so focus on the plan's reasoning:
1. Is the evidence enough to ship the pattern alone, and to delete 261019l's line-number decoder (`splicedLineNumber`)? Is any path left where a stored answer or a non-Anthropic provider (OpenRouter `require_parameters: true`, `allow_fallbacks: true`) could still bring back a splice that is then refused rather than recovered?
2. Is applying the pattern to all 13 stages safe? Consider grammar size and compile limits, prompt-cache invalidation and the `ARTICLE_OUTPUT_FORMAT` cache groups, and whether any stage's id field could legitimately hold a non-id.
3. Is "no PROMPT_VERSION bump" right for Structure and the 12 modes, given the checkpoint key digests the wire body?
4. Anything the plan claims that is false.

Write findings as a numbered list, each with a severity (blocker / should / nit) and evidence (file:line). End with a one-line verdict: "approve", "approve with changes", or "revise".
