# Code review: glossary/10, a long piece's glossary follows its length (261022f)

Candidate: commit `7fd0c6b7a` in this worktree. Diff: `git show 7fd0c6b7a`. Changed paths:
`git show --stat 7fd0c6b7a`. Start with `src/glossary.ts` and `tests/glossary.test.ts`, then
`docs/project/glossary.md` (§ A long piece, and a name met once; § One — the answer is what times
out; § Finding more), the plan `docs/plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md`
(read it as a reviewer of its conclusions and its § Results table, not only of the code) and
`docs/project/explain-this-vision.md`. That list does not limit your scope.

You reviewed the FIRST version of this plan and rejected it
(`docs/plans/261022f-explain-this-plan-review-sol.md`). The parallel-stretches design was dropped;
your F7 (one call, count unclamped) was measured and built, plus a names rule in the prompt and a
part-by-part line for long pieces. Check whether each of your F1–F8 is now answered, moot, or still
open.

You may FIX what is inside this change, narrowly, red-first where it is code: run
`npx vitest run tests/glossary.test.ts` yourself (it needs nothing outside the tree). Report, do not
fix, anything wider. Do not touch production, do not commit, do not push.

Attack independently first. Things worth checking:
- `suggestedCount(words, existing)`: every caller, the Find more path in `generateGlossary`
  (`existing?.entries.length`), and whether the essay request is truly byte-identical to
  `glossary/9`'s except for the names-rule text;
- the token budget at `MAX_ENTRIES` (`budgetFor`, src/token-budget.ts) and what a truncated answer
  does now that answers are bigger;
- the version bump to `glossary/10`: `appendableVersion`, staleness, `panelRunKind`, anything that
  pins the literal;
- the names-rule prompt wording against the existing rules (cited works are not terms, glossary/9;
  the senseHere/background split) — does it reopen the citation entries 261003o closed?;
- whether the docs' claims match the measurements (the Results table in the plan; the density claim
  in glossary.md);
- anything else, e.g. the threshold consequence the plan names.

Severity: P0 data loss / security / incorrect charging / broadly unusable; P1 user-visible wrong
behaviour or authoritative contract violated; P2 design/maintainability risk; P3 prose. Each finding:
id (C1…), severity, file:line, established or reasoned, and whether you fixed it. End with one line:
APPROVE, APPROVE WITH CHANGES, or REJECT.

My own doubts, worth less than yours: that the part-by-part line is a weak, untestable lever whose
effect rests on two runs per arm; and that the names rule may make essays' lists noticeably more
name-heavy at the expense of terms.
