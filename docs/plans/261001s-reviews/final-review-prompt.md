# Final cross-family review: 261001s (write-capable, fix within scope)

You built most of this job; Claude reviewed and wrote some parts itself. **This review is of the
parts Claude wrote, and of the whole for anything wrong in production** — those are the parts no
other family has read. Fix what you find inside this job's scope, narrowly and red-first; report,
do not fix, anything wider. No state-changing git, no commits, no dispatching reviewers.

Plan with full ledger: `docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md`.
This job's own commits (others on the branch are peers' work merged from dev; ignore them):
`c935c8805 78a6c88e3 2919f757a 56a0858ba 34509bc09 7dd281f53 3f09cf8bf cc7b9cbd0 675aa32b2
0f53bfc8d afc27cfbd de5015eed 8d8dbf20c` (`git show <sha>`).

## Claude-authored, read every line

1. `675aa32b2` — the merge with fb93's re-ask (peer commit `e6e3c2a6c`): conflict resolutions in
   `src/hierarchy.ts`, `scripts/spike-book-structure.ts`, `tests/thinking-effort-eval.test.ts`,
   and the moved fixtures in `tests/hierarchy-structure-reask.test.ts`. Does the re-ask still do
   what fb93 meant under `toc/11` (a fresh answer that parses but fails the starts-only conversion
   is re-asked; the first raw is never checkpointed)? Does `rangelessChildren` still mean anything
   now that `toc/11` answers never reach `planChildRanges` without ranges?
2. `de5015eed` — `tests/article-cache-call-site.test.ts`: the "marks BOTH" walk became a tripwire
   plus a `[false, false]` walk. Is the tripwire's computation right (could it pass while a pair
   exists, e.g. because `sharesArticleCache(a, [b])` is asymmetric)? Prove it by making it go red
   once and restoring.
3. `src/start-ranges.ts` — the restored comment on range-checking the first claim.
4. Docs: `docs/project/prompting-guide.md` § What the model writes back (the rule), the signpost in
   `docs/project/ai-gateway.md`, the paragraph in `docs/project/hierarchy.md` § The generation
   prompt, `docs/postmortems/261002b-an-unconstrained-json-answer-fails-the-step.md`, the pointer
   in `docs/plans/261001p-…md`, and the plan's Ledger. Every factual claim against code or the
   committed results (numbers, file names, commits, which calls were moved or deferred). Anything
   false or overstated is P1 if a reader would act on it.

## The whole, for production harm

- Any request now carrying a schema that a route might refuse (provider, model, wire), any
  stage whose schema is stricter than its parser or looser than its prompt, any `enum` on an id,
  any refusal/`max_tokens` check that moved after a parse, any cache identity that disagrees with
  the request. Claude probed Sonnet 5 and Opus 5.5 on the Messages wire (both accept a format);
  the chat-wire calls were not probed live.
- `toc/11`'s checkpoint and `EXPANSION_PROMPT_STAMP` transition.

Severity P0–P3, IDs on findings, file:line, and for each: fixed (with the test you saw red) or
reported. Gates you ran, verbatim. One-line verdict.
