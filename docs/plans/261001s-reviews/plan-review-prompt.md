# Plan review: 261001s, a structure answer that writes code to correct an id

You are reviewing a PLAN, read-only. Repo: the current directory (a git worktree of Spideryarn,
an AI-assisted reading app). Candidate: commit c935c8805, file
`docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md`. Read it first, then
CLAUDE.md, `docs/project/block-ids.md`, `src/parse-json.ts` (especially `parseJsonAnswer`,
`objectEnd`, `dropTrailingCommas`), `src/json-repair-log.ts`, and `src/hierarchy.ts`
(`SYSTEM`'s OUTPUT block, `planChildRanges`, `recordBoundaryFaults`, `buildTree`). The raw
failing answers are in `evals/results/paperwork/structure-parse/*.raw.txt`; the eval is
`evals/paperwork/structure-parse.ts`. Reading list is a start, not a limit.

Context: Greg asked for this to be fixed "properly": real root cause, fix the class for the long
term (in how the hierarchy shows ids to the model, in the shared parser, or both; decided with
evidence), a postmortem naming the class, and a before/after measurement with enough runs to mean
something. His hard constraint: any lenient-parse repair must never let a wrong or invented id
through silently, and the plan must say why it can't. You will also be the builder of the stages
afterwards, so a plan you cannot build cleanly is a finding.

## What to attack

1. Is the root cause right, and is the chosen option (A, parser repair) the right fix for the
   class, or is B (stop asking the model for range ends), C (labels/indices) or something not
   listed better? Argue from the code and the evidence, not taste.
2. Does the "why it cannot let an invented id through" argument hold? Find a caller of
   `parseJsonAnswer` (there are ~20 under src/) where an evaluated `.replace` could produce an id
   (or any value) that reaches the reader or storage without being resolved against the
   article's blocks. Name file and line.
3. Is "wrong-but-real is made loud" true, or is a log line nobody reads just silence with extra
   steps? If you think a wrong repaired value must be treated differently (e.g. hierarchy treating a
   repaired end as absent), say how, at what cost.
4. Parser design: string-aware scanning, chains, literal semantics, interaction with the
   trailing-comma repair and the "unambiguous single document" rule, and any input where the
   repair turns a correctly-failing answer into a wrongly-accepted one.
5. Is the measurement design (paired rescore of the same answers, ~120 fresh calls) sound and
   sufficient? What would you change?

## Severity and format

P0 data loss/security/charging/service unusable; P1 user-visible wrong behaviour or an
authoritative contract violated; P2 design/maintainability risk, no wrong behaviour today; P3
prose. Give every finding an ID (F1, F2…), a severity, file:line evidence, and the change you
would make to the plan. End with a one-line verdict: build as written / build with the listed
changes / rethink.

## My own suspicions (worth less than yours — spend most of the run elsewhere)

- Whether 20 callers really all resolve ids; I have not audited them.
- Whether repairing the no-op `.replace(x,x)` case should be refused rather than accepted, since
  the model signalled doubt and the evidence shows that value was wrong.
- Whether B should be stage 4 rather than "later if needed".
