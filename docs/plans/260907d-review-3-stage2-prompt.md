# Review: giving the deepening cascade a Socratic question, as `expand/4`

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval`, branch
`worktree-fb1v-socratic-v4-and-the-eval`. TypeScript + ESM, `tsx`, vitest.

A reading app. A model carves an article into a nested table of contents ("the tree"). Stage 4 asks
for the whole tree in one long-context call; where that answer leaves a section undivided, a later
**deepening cascade** (`src/hierarchy-deepen.ts`, `-expand.ts`, `-cascade.ts`) asks scoped follow-up
calls to divide it. The reader's Summary panel draws **one line per part**: the Socratic `question`
where there is one, and the one-sentence `gist` otherwise.

## The candidate

**Committed: `6bcb0b6e`** (this stage), and its immediate predecessor `91a3fee4` for context only.

```
git show 6bcb0b6e
git diff 6bcb0b6e^..6bcb0b6e
```

Changed paths, complete:

```
src/hierarchy-expand.ts
src/hierarchy-deepen.ts
src/hierarchy-cascade.ts
tests/hierarchy-expand.test.ts
tests/hierarchy-deepen-wave.test.ts
tests/summary-question-replaces-gist.test.tsx
docs/project/summaries.md
docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md
```

**Start with** `src/hierarchy-expand.ts` (`EXPAND_SYSTEM`, `asksChildQuestions`,
`renderTargetBriefing`, `readChild`) and `src/hierarchy-deepen.ts` (`unansweredQuestions`,
`DeepenStats.missingQuestions`). The manifest above is the scope, not those two files.

**The working tree is moving and is NOT the candidate.** I am implementing the next stage in
`evals/summaries/` right now — none of those files is in the manifest. Read the candidate through
`git show` against the SHA, and if a test run disagrees with the diff, trust the diff and say so.

## What it is meant to do

`EXPAND_SYSTEM` had **no question field at all**, so a part grown by the cascade drew a bare gist
beside a neighbour's question once `SummaryPanel` began drawing `question ?? gist`. You found this
yourself as P1-5 on 2026-09-05; it was recorded rather than fixed. This commit fixes it at
generation.

1. `EXPAND_SYSTEM` gains a `QUESTIONS` block carrying the shipped V4 rules (`<topic> — <question>?
   (<shape hint>)`) in the expansion prompt's voice.
2. **Which sections it applies to is marked per target**, `ASK QUESTION ON CHILDREN` /
   `OMIT QUESTION`, derived from that target's own ancestor chain — because one call batches several
   parents that need not be at the same depth. This was your F4.
3. `ProposedChild` gains `question?`; the expansion carries it onto the node **unjudged**, and
   `buildTree`'s existing `questionFor` keeps or drops it at the node's real depth in the finished
   tree.
4. `DeepenStats.missingQuestions` names the parts that were *asked* and came back without one, with
   a `warn` that is silent at zero.
5. `EXPAND_PROMPT_VERSION` `expand/3` → `expand/4`.

**Invariants that must hold:**

- A missing question is **non-fatal**: it is logged and named, the panel renders, nothing throws,
  nothing is retried, and no second model call is ever made to fill a gap.
- No backfill. Existing articles pick this up only when a stage is re-run.
- The per-target policy must be right in a **mixed-depth batch** — the root's target asked, a
  depth-1 target in the same call omitted.
- A question written for a child deeper than 1 must be dropped, and dropped by `questionFor`, not by
  a second rule in the cascade.
- No import cycle: `hierarchy-expand`/`-deepen`/`-cascade` are imported *by* `src/hierarchy.ts` and
  may take **types only** from it. `npm run cycles` is a gate.
- Nothing article-adjacent may reach a log line (`docs/project/logging.md`).

**Deliberately out of scope:** the client (`src/web/` is untouched by design — hiding the sibling's
gist would trade a visible inconsistency for an invisible one); the eval harness; questions at depth
2.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You can run one test file
(`npx vitest run tests/hierarchy-expand.test.ts`) and a script (`node --import tsx <script>`), and
build a throwaway harness under `/tmp`. **No network, not even loopback**, so anything needing
Postgres or a local service will skip.

**What I ran, and the raw results:**

- `npm run check` on this tree (typecheck, build, full suite, cycles, chain, conflicts): **all gates
  green**, `Test Files 802 passed | 1 skipped`, `EXIT=0`. Log:
  `logs/tmux-jobs/check-s1fix-s2-1629-2687516.log`.
- Ten new assertions, each seen red before the fix. The red messages, verbatim:
  `expected 'You are extending a nested table of c…' to contain '- Shape: "<topic> — <question>? (<sha…'`;
  `… to contain 'ASK QUESTION ON CHILDREN'`;
  `expected 'expand/3' to be 'expand/4'`;
  `expected 'toc/7+expand/3' to be 'toc/7+expand/4'`;
  `expected '1 OF 2\n\nTHE CHAIN ABOVE IT\n\n  Par…' to contain 'ASK QUESTION ON CHILDREN'`;
  `expected undefined to be 'Computational functionalism — why is …'`;
  `Error: expected an ExpansionRefused, and nothing was thrown`;
  `TypeError: .toMatch() expects to receive a string, but got undefined`;
  `expected [] to deeply equal [ 'root > child 1 > child 1', …(3) ]`;
  `expected undefined to deeply equal [ 'root > child 1', 'root > child 2' ]`.
- **No real model call was made in this stage.** See § *the thing I most want checked*.

## Attack it

Independently, before you read my suspicions.

The invariant to break: **something here that reports success while doing something other than what
it claims** — this repo's recurring class, and the one your last two reviews of this plan both found.

Worth your attention in whatever order you find useful:

- `asksChildQuestions(ancestors) === ancestors.length === 0`. Is "no ancestors" really "is the root"
  everywhere this is called, on every path into `deepenTree` and any other caller? Is there a path
  where a non-root target arrives with an empty chain, or the root arrives with a non-empty one?
- The mark's placement in `renderTargetBriefing` — between `SECTION n OF m` and `THE CHAIN ABOVE IT`.
  Can a model confuse it for content? Can the article's own prose contain a line that reads as the
  other mark?
- `unansweredQuestions`: does it count the right thing? It uses `child.proposed.question === undefined`
  — is that distinguishable from a question that was sent and refused? Are the positions it emits
  (`root > child 2`) free of article text?
- The new QUESTIONS block read as a prompt, against `EXPAND_SYSTEM`'s other sections and against
  `src/hierarchy.ts` § `SYSTEM`. Does it ask for anything the code then discards? Does the
  `"question"` key's OUTPUT line contradict the "omit the key entirely" instruction?
- Does anything here break the **cacheability** of the expansion prompt? There are pinned assertions
  about the prefix and the cache floor; the prompt grew by ~550 estimated tokens.
- `DeepenStats.missingQuestions` is not zeroed on a withheld or failed wave, by analogy with `usage`.
  Is that analogy sound, or does it double-count across retries?
- The docs in the manifest, graded by the consequence they would cause, not by being prose.

For each finding give an ID — **continue the numbering, so the next new one is `F17`** — a severity
(P0/P1/P2/P3), whether it is **established** or **reasoned**, then (a) the input or mutation I can
run that shows it fails its own claim, and (b) the smallest change that closes it. A finding with no
(a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it.

## Previous findings

Rounds 1 and 2 are at `docs/plans/260907d-review-1-plan-answer.md` and
`docs/plans/260907d-review-2-stage1-answer.md`. F1–F16 are all dispositioned in the plan doc's two
ledgers; F9–F11 were three P1s in the previous commit and are fixed in `91a3fee4`, with every fix
seen red first. The two from your plan review that this commit was supposed to answer:

| ID | Finding | Disposition |
|----|---------|-------------|
| F4 | "stage 2 can finish without fixing the visible gap"; and the seam needs stating, because `ExpansionTarget` carries no depth | **taken** — per-target marking, and the depth question resolved differently: see suspicion 1 |
| F5 | the stamp explanation was wrong and permitted a provenance-only bump | **taken** — explicit `expand/3` → `expand/4`, reason rewritten to provenance |

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

1. **Your F4 asked for `questionFor` at `candidate.depth + 1`. That is not buildable** — it would be
   a value import from `src/hierarchy.ts` into a file that `src/hierarchy.ts` imports, closing a
   cycle the `cycles` gate refuses. What shipped instead carries the question unjudged and lets
   `buildTree`'s existing `questionFor` decide at the node's real depth. I believe that is strictly
   better, including where `collapseRestatedRungs` promotes a rung — but I would like it checked
   rather than agreed with.
2. **The thing I most want checked.** `deepenTree`'s `walk` makes a candidate only of a *childless*
   node, so `asksChildQuestions` is true **only** when wave 1 returned a root it did not divide. On
   any ordinary article every section is marked `OMIT QUESTION` and this commit changes nothing
   observable. I have concluded that is the correct scope — it is the flat-article case, one of the
   two ways a part loses its question — and that the other way (a restated rung spliced away, its
   depth-2 children promoted) is not fixable within the constraints. **Is that reading right?** And
   is there a cheaper way to reach the second case that I have dismissed too quickly?
3. Because of 2, **no real model has been shown the new block.** I could not commission a run: it
   needs an article whose wave-1 answer is a childless root, which is a model outcome rather than a
   flag, and forcing it would mean lying to the model about the article. The plan's acceptance
   condition was narrowed for that reason and says so. Tell me if that narrowing is a dodge.
4. `missingQuestions` on `DeepenStats` rather than on `BuildReport` was a placement forced by file
   ownership during a parallel session, not by design. Is it in the right place?

Do not change any file.
