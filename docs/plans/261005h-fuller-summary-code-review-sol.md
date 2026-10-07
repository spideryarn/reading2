Part 1 should not be pushed as-is. I found three P1s, three smaller issues, and no defect in the held-back prompt itself.

## Findings

### F1 — P1 — established — Part 1

(a) Part 2 is already in this branch’s ancestry. `git log origin/dev..HEAD` includes `dd71128c5`, which changes `src/simple-summary.ts` and both tests. Committing the working-tree reversions and running `git push origin HEAD:dev` would push that commit, even though the resulting `dev` tree would contain `/9` bytes.

That contradicts both “Part 2 is not being pushed” and the plan’s claim that the `/10` commit remains unpushed ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md:225)). It also is not the branch’s “last commit”; two commits and a merge follow it.

(b) Create the Part 1 commit in a clean worktree rooted at `origin/dev`, containing only the Part 1 files. Keep `dd71128c5` exclusively in this existing worktree’s ancestry. Replace lines 229–232 with:

> The docs, eval script and judges’ briefs are on `dev`; `src/simple-summary.ts` and its two tests on `dev` remain `simple-prompt/9`, byte for byte. The `/10` edit remains committed only in the measurement worktree, whose commits are not ancestors of `dev`.

This must be fixed in Git topology, not only in prose.

### F2 — P1 — established — Part 1

(a) `score` does not enforce the promised judge-file contract.

The parser at [new-reader.ts:287](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/evals/simple/new-reader.ts:287):

- accepts duplicate sections by reading the first and ignoring the duplicate;
- ignores extra or unknown sections;
- accepts duplicate answer lines by taking the first;
- accepts choices forbidden by the brief, such as `follow: both`, `prefer: neither`, or `padded: same`;
- cannot tell that a judge file answers an older/different key when the sequential IDs still match.

For example, two `## S01` sections are accepted if the first is valid. A stale `pairs-judge.md` can also be scored after `pairs` regenerates its key because nothing binds the answer to the blind input it read.

(b) Replace the loose `section()` parsing with exact validation that:

1. Extracts every `## S…`, `## P…`, or `## G…` heading and requires the ordered list to equal the corresponding key exactly.
2. Requires each count/fault/question line exactly once.
3. Applies the brief’s per-question choices:
   - `follow`, `more`, `prefer`: `A | B | same`
   - `padded`, `down`: `A | B | both | neither`
4. Adds an opaque digest to each blind input and requires the judge to copy it.

Add this exact sentence to each brief:

> Copy the `blind-id:` line from the input unchanged as the first line of your answer. It identifies the particular shuffled file you judged; `score` will refuse an answer carrying any other id.

The generated key should carry the same digest, and `score` should throw before scoring if it differs.

### F3 — P1 — established — Part 1

(a) The audit can report `PASSES` from an incomplete experiment. `audit()` silently skips missing runs at [new-reader.ts:155](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/evals/simple/new-reader.ts:155), while the criterion only checks that each array is non-empty at [new-reader.ts:336](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/evals/simple/new-reader.ts:336).

A concrete partial set—one old-A score of 2, one old-B score of 4, and one new score of 0—prints PASS: old mean 3, drop 3, noise 2. Missing results are omitted rather than averaged as zero, but the partial experiment still receives a verdict.

`grounded()` has the same silent skip. `pairs()` skips missing input too, although its final `profiled.length === 10` happens to force FAIL rather than a false PASS.

(b) Replace every missing-run `continue` with:

```ts
if (!run) throw new Error(`missing run for ${slug} ${arm}: write the complete arm before building judge files`);
```

Before computing the audit criterion, require exactly five scores in each of `about-new0a`, `about-new0b`, `about-new1a`, and `about-new1b`; otherwise throw. Also validate that the audit key contains every `SLUGS × ARMS` combination exactly once.

With complete data, both PASS/FAIL formulas match plan checks 1 and 2 exactly, and both FAIL branches are reachable.

### F4 — P2 — established — Part 1

(a) The feedback report has been given an ending that its governing document forbids. “Awaiting Greg” means “the plan doc written, nothing built” ([feedback-reports.md:409](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/project/feedback-reports.md:409)); `awaiting-approval.md` repeats “researched and written up but not built” ([awaiting-approval.md:3](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/user-feedback/awaiting-approval.md:3)).

Here the evaluator and prompt implementation have both been built, and the proposed note says so ([note:23](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/user-feedback/261005_0742-fuller-summary-written-for-someone-who-has-not-read-the-piece.md:23)). The blocker is temporary capacity needed to finish an in-progress report, not a product decision awaiting approval. The awaiting-approval entry also exceeds its prescribed one-sentence format.

(b) Until the measurement finishes, remove:

- the feedback note;
- this report’s `awaiting-approval.md` entry;
- `"spya-rntjxu": "awaiting"` from the generated mapping.

Keep the report in progress under its existing queue item. Replace the plan’s opening status with:

> **Status, 2026-10-05: blocked on model-key capacity. The prompt and eval are written, but nothing is measured or on `dev`; the feedback report remains in progress and has not taken one of its three endings.**

The note’s remaining factual claims are consistent with the plan and research.

### F5 — P2 — reasoned — Part 1

(a) Pickup step 2 uses the moving `origin/dev` ref as the old prompt ([plan:237](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md:237)). If another Summary prompt lands before the key has room, those arms will not measure the declared `/9` baseline. The evaluator only establishes that prompt hashes differ; it does not know the expected `/9` hash.

(b) Replace step 2 with:

> 2. The old arms. For this run use `src/simple-summary.ts` exactly as it was at pinned commit `d1eec9994`—not the then-current `origin/dev`—while keeping the edited file aside. Write `high-about-new0a`, `high-about-new0b` and `high-none-new0a`, then restore the edited file.

Step 4 is otherwise exact enough: the full first and fifth bullet text appears earlier in the same plan, and leaving `AFTER_PROFILE.fuller` untouched retains the shared paragraph.

### F6 — P3 — established — Part 1

(a) `new2` is the two-bullet arm, but evaluator output still calls it `"sentence"` at [new-reader.ts:99](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/evals/simple/new-reader.ts:99) and [new-reader.ts:180](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/evals/simple/new-reader.ts:180). The file header also says its variant is “recorded in the investigation,” but no investigation exists yet because measurement is blocked.

(b) Replace `"sentence"` everywhere in this evaluator with `"two-bullets"`, and replace the header sentence with:

> `new2` is written with the two-bullet variant specified in plan 261005h; its exact source and rendered-system hashes will be recorded in the investigation after the run.

### F7 — P3 — established — Part 1

(a) The side-balance output groups all test pairs together, while the passing threshold uses only the ten profiled test pairs. Therefore the printed `test` balance does not directly establish the balance of the sample being scored.

For the current fixed seed, the output would report test A 9/B 6; the relevant profiled subset is A 6/B 4, so the present draw is acceptable. A completely broken coin would still be obvious, and `blindCoin` has an exact deterministic test, but the printed evidence is less specific than the criterion.

(b) Change the balance key from `w.kind` to:

```ts
`${w.kind}/${readerOf(w.left)}`
```

That prints the profiled old/new balance directly before judging.

## Checks that passed

- Part 1’s runtime files do not import or require `NOT_READ`, `AFTER_PROFILE.fuller`, `/10`, or another Part 2-only symbol. Once F1’s ancestry is corrected, its final app source is byte-identical to `origin/dev`.
- The prompt-hash guard can fire: it rejects a shared hash between prompt categories and multiple hashes for the same category and band. F3 must ensure it receives the complete experiment.
- The judge briefs produce the shapes `score` expects and do not reveal arm identity or the hoped-for winner. Their questions are symmetric; the defect is that `score` accepts more than those briefs permit.
- Part 2 includes the agreed F1, F2, F4, F5, and F6 wording. “The length below” is immediately followed by `LENGTH`; the later fidelity and profile rules resolve the apparent tensions.
- Brief remains byte-for-byte unchanged.
- Each of the three new assertions can independently fail: Fuller-only placement, post-`PROFILE_RULES` ordering, and `/9` freshness.
- `npx vitest run tests/doc-links.test.ts`: 16 tests passed.

VERDICT: push Part 1 with the changes above — fix F1 and F2 first.