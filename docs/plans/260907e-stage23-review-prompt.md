# Review: Stage 2 (the `mayPassThrough` cross-check) and Stage 3 (counting the JSON repair)

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907`,
branch `worktree-worktree-postmortem-preventions-260907`. TypeScript + ESM, `tsx`, vitest,
TypeScript 7 (no TS compiler API — static checks parse with `@babel/parser`).

You reviewed the plan these come from (findings F1–F6, `docs/plans/260907e-plan-review-sol.md`), and
a separate review of Stage 1 is running concurrently. **This review is Stages 2 and 3 only.** Stage
1 (`componentDidCatch(error: unknown)`) and Stage 4 (the environment-variable inventory) are out of
scope here — do not review either.

They are reviewed together because they are disjoint: Stage 2 adds one test file and changes no
source; Stage 3 touches `src/parse-json.ts` and adds one module and one test.

## The candidate

Live pre-commit; base `8954b23f`.

Modified: `src/parse-json.ts`
Untracked (new, and a pathspec cannot name these — read them explicitly):

- `src/json-repair-log.ts`
- `tests/json-repair-is-counted.test.ts`
- `tests/routes-status-classes-survive-the-store-guard.test.ts`

`git diff 8954b23f -- src/parse-json.ts`

Also untracked and **context rather than candidate**: `docs/plans/260907e-*.md`. Files changed by
Stage 1 (`src/web/AppBoundary.tsx`, `src/web/FeatureBoundary.tsx`, `src/web/LazyPage.tsx`,
`tests/no-boundary-reads-the-caught-value.test.ts`) are in the tree but are not this candidate.

Not durable — I will record the resulting commit SHA in the plan doc once it lands.

## Stage 2 — what it is meant to do

`docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md` § *What would have caught the whole
class*, item 4. A refusal thrown inside a guarded store whose class is neither on `mayPassThrough`'s
allowlist nor carrying a numeric `status` is replaced by `guardDbStore` with a generic scrubbed
error, so `src/routes.ts`'s `instanceof` branches cannot match and the reader gets a 500. This check
makes the two lists agree.

**Your F3 changed its shape and I adopted the first half.** The check now looks only at
`instanceof` inside the initialiser of a variable named `status`, so local translations
(`sendExport`, `embeddingHttpError`) are out of scope by construction and there is no exemption
list. I did **not** take the second half — giving `ChatConflict` a `status`, dropping its allowlist
branch, and deleting the three unreachable branches from the chain. That edits `src/routes.ts`,
which this unattended run is not rewriting, and the postmortem's own follow-up says to delete them
*"when somebody is next in that function for another reason"*. Recorded in the plan as the next
step. **Do not re-litigate that decision; do tell me if the check as built is wrong.**

## Stage 3 — what it is meant to do

`docs/postmortems/260906b-asking-a-model-to-omit-a-field-makes-it-emit-the-comma-anyway.md`.
`dropTrailingCommas` repaired malformed model JSON and nothing recorded that it had.

Adopting F1, F2 and F4: no tally, no observer, no process state. One log call, made by
`parseJsonAnswer` (which knows the outcome), through `noteJsonRepair` in a module of its own. The
metric is named a **parse-repair invocation**, not "model answers repaired", and carries
`outcome: "accepted" | "still-invalid"`.

**Why `src/json-repair-log.ts` exists rather than a `log()` call in `parse-json.ts`.** That module
deliberately imports no logger — its header is the whole reason, `JSON.parse`'s message quotes its
input, and `docs/project/logging.md` says that text never enters a line. The seam is the
*signature*: `(source: string, removed: number, outcome: RepairOutcome)` cannot carry the payload. I
judged that better than a logger in scope, which makes `logger.warn({ text })` a one-line mistake
for the next person. Tell me if the extra module is not worth it.

The contract for both stages: **no behaviour changes for a well-formed answer.** Stage 3 restructured
the repair site (the attempt is taken as a value instead of returning from inside the `try`) and that
restructure must be semantically identical for every input.

## Evidence I already have — check it rather than repeat it

Stage 2:
- Green on the tree. Because green-on-arrival is worth nothing, the file has a second `describe`,
  *the check itself*, with five fixture-driven controls: the 2026-08-28 bug reconstructed; the
  `status: number | null` shape; an unresolvable class failing closed; both doors staying green; a
  local translation correctly ignored. 8 tests pass.
- A real-file mutation: removing `readonly status = 409` from `CommentIdTaken` in `src/comments.ts`
  produced `src/routes.ts:6439 — CommentIdTaken (src/comments.ts): not in mayPassThrough, and no
  numeric non-nullable status`. Reverted.

Stage 3:
- 6 tests pass; `tests/parse-json.test.ts`'s own 65 still pass (71 together).
- Mutations: removing the `noteJsonRepair` call turned 4 of 6 red; changing the `removed > 0` gate to
  `>= 0` turned the "says nothing when the answer parses cleanly" control red. Both reverted.
- `npm run typecheck` exits 0; `npm run cycles` finds no new cycle.

## What you can and cannot run

Tree read-only; `/tmp` and node_modules caches writable. **`tests/routes-status-classes-survive-the-store-guard.test.ts`
and `tests/json-repair-is-counted.test.ts` need nothing outside the tree** — run them. Note that
`tests/parse-json.test.ts` creates `data/_test-parse-json` in its setup and will skip in a read-only
tree; its 71-passing result above is mine, run here.

## Attack it

Independently, before my questions.

**Stage 2**
1. **Can a real disagreement slip past?** The rule keys on a variable named `status`. What if the
   chain is assigned to something else, returned directly, or written as a `switch`? I want the
   evasions listed even where I decide not to close them.
2. **Is `declaresNumericStatus` right?** It accepts `readonly status = 409` and `readonly status:
   number`, and rejects unions. Does it handle a status assigned only in the constructor with no
   class-property declaration, an inherited one from a base class, a getter, `status = 409 as const`,
   or a numeric enum? Which of those are false negatives (wrongly red) and which false positives
   (wrongly green)? **False positives are the ones that matter.**
3. **Does the import resolution hold?** `declaringFile` only follows `./`-relative specifiers from
   `src/routes.ts` and rewrites `.js`→`.ts`. What about a re-export, a `node_modules` class, an
   `import type`, or a class declared in `routes.ts` itself? Does it fail closed in each case?

**Stage 3**
4. **Is the repair-site restructure semantically identical to what it replaced?** This is the P1
   risk. Walk every path — clean parse, repaired parse, repaired-but-still-broken, not unambiguous,
   array-rooted — and confirm the return value and the thrown error are unchanged in each.
5. **Can anything of the model's answer reach the log?** Check every field. Is `source` genuinely a
   project-authored constant at all 13 call sites — you said so of the plan, but check it against
   the built code, including whether `removed` or the outcome could encode content.
6. **Is the counting gate right?** `removed > 0` and the outcome. Is there a path where a repair
   fires and is not reported, or is reported twice for one call?
7. **Is `src/json-repair-log.ts` justified, or is it a file that should not exist?** A one-function
   module is machinery. I argue the narrow signature is a structural guarantee worth it; argue back
   if it is not.

For each finding: an ID continuing from the highest already issued (Stage 1's review is running
concurrently and may also be issuing IDs — if so I will reconcile, so just continue from `F6` and
say so), a severity, and whether **established** or **reasoned**.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Established** means direct evidence with no unresolved material inference. Refuse only on an
established P0 or P1.

Verdict at the end: land both, land with the changes you name, or do not land.

## My own suspicions — read these last

Worth less than anything you find independently.

- Question 4 is where I think the real risk is. The restructure was mechanical and the tests pass,
  but "the tests pass" is what this whole batch exists to distrust.
- Question 2's false-positive list is the other one. A class whose `status` is set only in the
  constructor body — `NotAnExplanation` declares `readonly status: number` *and* assigns in the
  constructor, so it passes on the declaration — but a class doing only the latter would be judged
  to have no status and go red. I think that is a false *negative* and therefore safe, but check me.
- I am least sure that Stage 2's positive controls are strong enough. They assert the three known
  classes are found and that the allowlist has at least five entries. If someone restructured the
  chain into a shape the walker does not recognise, would those controls actually catch it, or would
  they pass over nothing?
