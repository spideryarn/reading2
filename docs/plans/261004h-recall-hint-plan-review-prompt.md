# Plan review: Recall's question links its passage, and a Hint button

Read-only review. Do not edit anything.

Candidate: the plan at
`docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md` (untracked, in
this worktree; base is HEAD). Nothing is built yet. It answers one admin feedback report, quoted at
its top. Review it against the code here: `src/converse.ts` § `REMEMBER_SYSTEM`,
`src/web/ChatPanel.tsx` § `Answer` and its one call site, `src/web/Cited.tsx`,
`src/web/citations.ts`, `evals/remember-recall.ts`, `tests/remember-prompt.test.ts`,
`tests/remember-panel.test.tsx`, `docs/project/remember-mode.md`,
`docs/project/prompting-guide.md`, `docs/research/261002c-recall-and-tutorial-pedagogy-for-remember-mode.md`.
That list is where to start, not a limit.

Make your own independent pass first. Things to attack:

1. **Does the design satisfy Greg's words**, and is there a simpler product shape that does? Is
   anything in it more than he asked for?
2. **The inline `Hint:` paragraph as a contract between a prompt and a parser.** Where does it
   break: streaming, markdown parsing, a model that writes `**Hint:**` or `Hint -`, a hint in the
   middle, a legitimate final paragraph that starts "Hint:", retry/edit, stored history sent back to
   the model, the 20-turn trim, `unknownIds` counting, length heuristics.
3. **Every other reader of an assistant message's text** for a Remember thread: find them all
   (export, the `reader_notes` tool and Explore's digest, thread summaries or titles, copy buttons,
   Live/spoken paths, search, anything else) and say for each whether a trailing `Hint: …` paragraph
   is wrong there.
4. **The prompt change against `REMEMBER_SYSTEM` as it stands**: does a hint contradict any
   existing rule (one question mark, the word ceiling, NO GIMMES, ASK ONLY WHERE YOU COULD HAVE
   TOLD, the format section's "plain prose paragraphs")? What wording would you use, and where?
   Is "the question carries the id of the passage that answers it" in tension with "a cue names
   where and what, never what it said", or with the cited-quotation flash (`quotesBefore`)?
5. **The tests and the eval named in the plan**: would each go red for the failure it is meant to
   catch? What is missing?
6. **The open question and the deferred items**: is the recommendation right? Is "store when it
   happened" (CLAUDE.md § Writing code) a reason this cannot ship without recording the press?

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Whether the split should live in `Answer`/`Turn` or inside `Cited.tsx`.
- Whether holding back a partial `Hint:` prefix while streaming is worth its code.
- Whether the model's history should have the hint stripped.

## Output

Findings with stable ids `F1`, `F2`, …, each with a severity on this scale, the file and line that
shows it, whether it is *established* (direct evidence) or *reasoned*, and a suggested change.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

End with exactly one line: `VERDICT: approve`, `VERDICT: approve with changes` or `VERDICT: rework`.
