# Review: repairing an eval's calibration gate, and the result it then gave

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval`, branch
`worktree-fb1v-socratic-v4-and-the-eval`. TypeScript + ESM, `tsx`, vitest.

`evals/summaries/` chooses between wordings for a one-line Socratic question shown on each part of an
article. Arms differ in a GISTS block and a QUESTIONS block; a model generates lines over a **fixed**
tree; a second model (GPT-5.6-sol via `codex exec`) judges blinded lineups; a **calibration gate**
puts five known-bad lines into one lineup and discards the whole ranking unless the judge put all
five below every real line.

On 2026-09-05 that gate failed and the run reported no ranking. This commit repairs it, and the
repaired eval then produced a result.

## The candidate

**Committed: `764e9c57`** — stages 3 and 4. `ab83aa98` (the previous commit) is context.

```
git show 764e9c57
git diff 764e9c57^..764e9c57
```

Changed paths, complete:

```
evals/summaries/corpus.ts
evals/summaries/judge.ts
evals/summaries/run.ts
evals/summaries/variants.md
tests/summaries-eval.test.ts
evals/results/summaries/2026-09-07T16-05-49-socratic-questions-after-the-gate-repair.md   (new — the run)
docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md
```

**Start with** `evals/summaries/judge.ts` (the `demand` axis), `evals/summaries/variants.md`
(§ *The five negative anchors*), and the promoted results file — which is the evidence, and which you
should read as a reviewer of the *conclusions drawn from it*, not only of the code.

**The working tree may be moving**: I am running an unrelated ingest for the next stage. No file
outside the manifest is in scope. Read the candidate through `git show`.

## What it is meant to do

Five changes:

1. **Anchor 2 rewritten.** It was `Computational functionalism: what four arguments does the section
   cover?`, designated "neutral lookup question". The judge scored it `5,5,5,5,5` and ranked it 4th /
   2nd / 4th of twelve, causing fourteen of the fifteen gate inversions. On inspection it is **not a
   bad line**, so it is replaced by
   `Computational functionalism — how many arguments does the section give against it?`
2. **The rubric gains a `demand` axis** — *does answering it require following the argument, or would
   one lookup settle it?* This is your own F3 from an earlier round: the rubric had **no criterion for
   the lookup failure every variant's prompt forbids**, so a rewritten anchor alone could have bought
   a passing gate over a judge still preferring polished lookups.
3. **A failed gate sets `process.exitCode = 1`**, in both `judge` and `report`. It set none before.
4. **`judgeInstability` is printed even when the gate fails**, because it measures the instrument
   rather than the arms.
5. **The corpus pin hashes the blocks array, not `blocks.json`** — whose envelope also carries a
   `sanitizer` number that is about the sanitiser. All ten manifest entries re-pinned.

**`MAX_ANCHOR_INVERSIONS` is still `0` and was not touched.**

**Invariants that must hold:**

- The gate must not have been made easier to pass. Adding a rubric criterion and repairing a
  mis-specified anchor are legitimate; anything that lowers the bar is not.
- The `demand` axis must not penalise a **straight or yes/no** question — the V3 arm's entire axis is
  a straight question, and a rubric that docked it would decide against V3 before the judge read a
  word.
- The corpus re-pin must not be a way to make a drift warning go away.
- No result may be claimed that the harness itself refuses to name.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You can run one test file
(`npx vitest run tests/summaries-eval.test.ts`) and a script (`node --import tsx <script>`), and build
a throwaway harness under `/tmp`. **No network, not even loopback** — the eval's own `generate` and
`judge` commands cannot run for you. Note `output/summaries-corpus/` is gitignored and may or may not
be present in the tree you see.

**What I ran, and the raw results:**

- `npm run check`: **all gates green**, `EXIT=0`. Log: `logs/tmux-jobs/check-s34-1728-3030800.log`.
- The free stub pipeline in both directions, exit codes read **without a pipe**:
  `--stub-judge bad` → `REAL_EXIT=1`, `Calibration: FAILED`, no ranking, instability printed;
  `--stub-judge good` → `REAL_EXIT=0`, ranking with threshold and per-repeat leaders.
- The corpus-pin test seen red against the old hashing:
  `AssertionError: a sanitiser bump alone must not move the hash: expected 'd6062a5f746a' to be 'e4d2252972ea'`.
- Before re-pinning, the exported blocks for `noema-mythology-of-conscious-ai` were compared field by
  field with the committed fixture cut at `tests/fixtures/data-root/data/…`: id, tag, kind, text,
  words, gistable **and html** identical on all 141, 0 differing pairs.
- **The real run**: 5 arms, 1 document, 3 judging repeats of which 2 returned (the third was cut off
  at 9,225 characters and the harness refused it). Generation `$0.2471` over 5 calls; judging has no
  metered cost. Everything else is in the promoted results file in the manifest.

## Attack it

Independently, before you read my suspicions.

The invariant to break: **a gate that now passes for a reason other than the judge having got
better.** That is the exact failure this repo keeps paying for, and it is the failure a repaired gate
is most likely to be.

Worth your attention in whatever order you find useful:

- **The `demand` axis as written.** Does it interact with the other axes in a way that changes what
  the ranking measures? Could a variant win *because* of it? Does it in fact leave a yes/no question
  alone — check V3's own text against it, not just my claim. Is the JSON schema example consistent
  with the axis list, and would a judge answering the schema literally produce what `score.ts` parses?
- **The new anchor 2.** Is it genuinely faithful, distinctive, simple and low-leakage while being
  settled by one lookup — or does it carry a second defect I have not seen? It is in V4's shape while
  the other four are in V1's; does that matter?
- **The result as reported.** The plan doc draws conclusions from a run with **two** usable repeats.
  Read the promoted results file and tell me whether the conclusions are supported. In particular:
  `questions-toc6` leads at 0.83 with `incumbent` at 1.42 and `incumbent-repeat` — the same recipe as
  `incumbent` — at 2.08. I claim this shows the arms are not separable and that the nominal lead means
  nothing. **Is that right, or am I explaining away an inconvenient result?** It is the outcome I
  would least like to be wrong about.
- **The corpus re-pin.** Is the evidence I gathered sufficient to justify it, or did I re-pin over a
  real change? Is `JSON.stringify(blocks)` a sound canonical form?
- The exit-code change against `tests/summaries-eval.test.ts`'s repo-wide guard that every eval taking
  `exitCodeFor` raises from it — did I extend that honestly or route around it?
- Stage 4's claim that nothing should change. Is there a change the evidence *does* support that I
  have declined to make?

For each finding give an ID — **continue the numbering, so the next new one is `F21`** — a severity
(P0/P1/P2/P3), whether **established** or **reasoned**, then (a) the input or mutation I can run, and
(b) the smallest change that closes it. A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

For a doc or a results write-up, grade by the consequence the error would cause. A wrong conclusion
in the plan doc that a later reader would act on is not a P3 because it is made of prose.

Refuse only on an **established** P0 or P1, and name what established it.

## Previous findings

F1–F20 are dispositioned in the plan doc's three ledgers. The ones bearing on this commit:

| ID | Finding | Disposition |
|----|---------|-------------|
| F3 | the rubric has no argument-demand criterion; and "the judge is stable" was unsupported | **taken in full** — this commit is that fix. Judge instability is now also reported separately |
| F7 | stage 4's evidence rule was unfalsifiable | **taken** — stage 4 may ship only exact text that was an arm in a passing run, and it ships nothing |

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

1. **The conclusion is the thing I would most like checked**, not the code. "The arms are not
   separable and the control's nominal lead means nothing" is a comfortable conclusion for someone who
   shipped V4 this morning. The number I lean on is the paired generation noise floor of 1.83 ranks
   against an arm-to-arm gap of 0.59. Tell me if that is the wrong comparison.
2. Two usable repeats is the bare minimum `judgeInstability` measures at. I decided a third could not
   move a factor-of-three margin and did not spend on it.
3. The `demand` axis is new wording I wrote. It may be leading, or ambiguous, or may overlap
   `leakage` enough to double-count.
4. Re-pinning ten hashes is exactly the shape of "making a warning go away", and I would like the
   evidence I gathered judged rather than accepted.

Do not change any file.
