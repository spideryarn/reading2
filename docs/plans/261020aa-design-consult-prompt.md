Design consult, read-only. Do not edit files. Answer in under 700 words, as a recommendation with reasons.

Context. Repo: Spideryarn. Read src/structure.ts (STRUCTURE_OUTPUT_SCHEMA, wholeDocumentRequest, treeFrom), src/structure-prompt.ts (SYSTEM, renderBlocks, EFFORT), src/start-ranges.ts, src/messages-structured-output.ts, docs/project/prompting-guide.md § the structured-output rules, docs/plans/261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md, docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md § Stage 2.

The problem. The whole-document Structure call already sends a strict JSON schema (Anthropic output_config.format via OpenRouter, Sonnet 5.5, effort low, adaptive thinking which drops to zero under the schema). The JSON is valid by construction, but `start` is a free string, and on one production article (648 blocks) the model wrote non-existent ids in 4 of 4 re-runs: mostly splicing the prompt's line number into the id (`[582] spya-xcf0dz` → `spya-582xcf0dz`, `spya-582xcf`, `spya-582`), rarely `"x"` or a well-formed wrong id `spya-76bd1a`. 261019l added code that decodes the splice and, on the last answer, drops an unrecoverable child. Greg, the product owner, now asks for "a clean way to deal with this rather than a hacky way": constrain the output so it is valid by construction.

Facts from the web: Anthropic strict schemas support `pattern` (regex), `enum`, `anyOf`, `minItems` 0/1; NOT minimum/maximum/minLength/maxLength. No documented enum cap but grammar-size limits exist ("Schema is too complex for compilation"). assertNoBlockIdEnums forbids an id enum here because a 1000-2000-value enum is heavy and would force a mistyped prefix to finish as some real (wrong) id silently.

Candidate designs I am weighing:
A. Keep string ids; add `pattern: "^spya-[a-z0-9]{6}$"` (match block-ids.md's alphabet exactly). Kills `x`, `spya-582xcf0dz`, `spya-582`; but a splice may then be forced into a well-formed wrong id `spya-582xcf`.
B. Answer the line number: `start` becomes an integer copied from `[N]`; code maps N → block id; ids removed from (or kept in) the whole-document prompt render. No string to mangle. Risk: a wrong-but-valid integer is silent (no redundancy), guarded only by ordering/parent-window checks and the heading snap.
C. Both: `start: integer` plus `startId: string` (pattern-constrained); accept when they agree, otherwise ... (which wins?).
D. Remove `[i]` from the whole-document render (id first, nothing to splice). Leaves the rare wrong-copy faults.
E. Raise effort / think-first line.

Questions:
1. Which is the clean fix, and why? Consider silent-vs-loud failure (this codebase prefers a loud failure over a silent wrong boundary), token cost, cache-key/PROMPT_VERSION churn, the scoped expansion call and long-document slices which share renderBlocks and the start-ranges kernel, and whether 261019l's recovery code should then be deleted (simpler) or kept for stored/replayed answers.
2. What should the paid eval measure to decide (arms, draws, articles, gates)? There is evals/paperwork/structure-parse.ts (validity, 70 answers ~$8) and a blind quality panel used in 261001s.
3. Which other pipeline JSON calls copy block ids into a free string and would benefit from the same change?
