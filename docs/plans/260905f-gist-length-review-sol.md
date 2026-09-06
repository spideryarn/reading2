The most serious problem is the escape hatch: it lets a word-count rule redesign the article’s structure. The same model call chooses boundaries and writes gists, so “if 22 words cannot be filled honestly, the section was too slight to be its own node” tells it to merge or avoid a legitimate section to satisfy a prose constraint ([hierarchy.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/hierarchy.ts:128)). The fixed-tree eval cannot reveal this interaction by construction.

My verdict: the direction is right, but I would not land the 22-word floor and structural escape hatch as written. Land the depth-dependent brevity, simpler-language rule, and a narrower meta-narration ban; change the floor first.

1. The numbers

The evidence for 18 is much weaker than the table suggests:

- The root result is only three roots, not four. `scaling-hypothesis`’s root is silently excluded because its stored range does not resolve wholly inside `body`; the harness skips such nodes ([generate.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/evals/summaries/generate.ts:94)).
- The minimum observed root of 17 is not a quality boundary. It only says one unconstrained generation happened to be that short.
- The 134 depth-2 nodes are clustered within four documents, not 134 independent examples.
- There is one draw per arm and no quality judgment. That proves instruction-following, not faithfulness, claim-ness, or lack of padding.

The completed floor remeasurement is:

| depth | nodes | mean | min | max | violations |
|---|---:|---:|---:|---:|---:|
| root | 3 | 18.0 | 16 | 21 | 1 over 18 |
| 1 | 31 | 21.0 | 10 | 26 | 3 over 25 |
| 2 | 134 | 23.4 | 6 | 32 | 33 under 22 |

So the explicit floor works materially—21.0 → 23.4—but still leaves 24.6% under it. One of four calls also needed recovery after malformed JSON. See the [floor run](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/output/summaries-runs/toc6-floor/generated.json).

The generated 16–21-word roots remain claims rather than labels, so I do not see evidence that 18 necessarily destroys claim-ness. But three selected examples cannot establish safety across narrative, reference, multi-thesis, or heavily qualified pieces. I would use ≤20 for v1: still roughly a 30% cut from 28.8, without forcing every article into headline copy. Also say “central claim or governing move,” not “the one claim”; some works genuinely do not have one.

2. The framing

“Opposite way to what you would expect” is unnecessary model psychology. Leakage into the JSON is unlikely, but it adds salience without specifying better behavior, and the eval does not isolate whether it helped.

Use the interface reason directly:

- Root: shelf/card overview, ≤20 words.
- Depth 1: chapter orientation, ≤25.
- Deeper: substitutes for its covered prose; include the main move and useful support where present.

That is better than either model-prior narration or a bare unexplained table.

Also, banning the standalone words “then” and “next” is too broad ([hierarchy.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/hierarchy.ts:136)). “If X, then Y” can be the actual claim; “next” may be substantive in a sequence. Ban narration of document order, not ordinary lexemes.

3. Cascade interaction

The risk is real and currently unmeasured. The root gist is explicitly carried into each descendant’s ancestor chain ([hierarchy-deepen.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/hierarchy-deepen.ts:2360), [hierarchy-expand.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/hierarchy-expand.ts:379)). It can therefore influence child boundaries, titles, and verdicts.

There are two separate interactions:

- The initial whole-document call generates structure and the shorter gist simultaneously.
- Later expansion calls see that gist as context while proposing new structure.

The existing structure evaluator can reveal boundary, fan-out, depth, heading, and title changes for the first interaction. Nothing currently attributes cascade degradation to the shortened root; candidate telemetry records outcomes, not whether the semantic context became worse.

The clean experiment is an expansion ablation with identical blocks, outline, and target:

- current root gist;
- shortened root gist;
- root gist omitted;
- deliberately misleading root gist.

Compare boundaries, verdicts, fan-out, title distinctiveness, and human preference. If shortened and omitted behave like current while misleading changes them, you have evidence the channel works but brevity is harmless.

4. Token headroom

The token paragraph is now stale because it measured the pre-floor wording. Across the completed rewrite:

- Mean gist characters rose from 148.9 to 163.3, not 149.
- Per-document gist-character ratios were 0.989×, 1.186×, 1.118×, and 1.068×.
- Applying your own conservative ratio-transfer method, `145 × 1.186 ≈ 172`, leaving about three tokens rather than thirty under 175.

That is not proof of imminent truncation: the hierarchy estimator overestimates total node count heavily, and expansion separately budgets 200 tokens per child ([hierarchy-expand.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/hierarchy-expand.ts:151)). But the claimed per-node cushion is no longer established.

Also, 852 omits the 102 stored depth-3 nodes. “Deeper than depth 1” covers 954 of 1,239 stored nodes, across two different call paths.

Failure behavior is sound but different:

- Whole-document truncation fails the hierarchy stage rather than accepting partial JSON ([hierarchy.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/hierarchy.ts:2434)).
- Expansion truncation abandons the deepening wave, keeps wave 1, and records `deepenFailed` ([hierarchy.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/hierarchy.ts:2525)).

Reconstruct the post-floor answers and run at least one real whole-structure call before retaining the 175 claim.

5. Cache floor

Replacing an unreachable false-case test with a margin pin is correct. Testing a fabricated false branch of a one-line comparison adds little.

But the accompanying claim is false: the prefix did not go from “never cacheable” to “always cacheable.” The old tests themselves had a short prefix below the line and a padded long prefix above it. `EXPAND_SYSTEM` alone was below the floor; `EXPAND_SYSTEM + outline` could already exceed it. The change moved eligibility from outline-dependent to estimated-always-eligible.

Two qualifications belong in the wording:

- `estimatedCacheable` means the four-characters-per-token estimate clears the floor, not that the provider necessarily does.
- Eligible does not mean cache hit, especially when cold calls begin concurrently without a warm-up.

Pinning the system-only margin is a reasonable conservative invariant ([hierarchy-expand.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/tests/hierarchy-expand.test.ts:293)). Verify the incidental win with provider-reported cache creation/read tokens on two sequential real calls.

6. The floor

“Claim AND ground” is useful for argumentative sections but not universal. Fine nodes can be:

- a definition and its distinction;
- an event and consequence;
- a list or comparison;
- a transition;
- bibliographic or front-matter material.

The new outputs show the model sensibly refusing to pad slight nodes: examples remain six to fifteen words for titles, attribution, addresses, and catalogue metadata. That is preferable to inventing a “ground.”

The deeper conflict is that 22–32 words in exactly one sentence encourages the clause chaining prohibited at the root, and syntactic complexity works against “slightly simpler language.”

I would replace the hard floor with something like:

> For a substantive fine node, normally use 22–30 words: state the main claim or move and add its essential reason, contrast, consequence, or example. Never pad, invent support, or change a genuine boundary to reach a word count. A shorter gist is correct when the range contains no second substantive element.

Delete the “too slight to be its own node” sentence. Node-worthiness is a navigation decision, not a test of whether prose can be stretched to 22 words.

There is also an unexplained contract difference: the whole-document prompt has the structural escape hatch, while `EXPAND_SYSTEM` does not ([hierarchy-expand.ts](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/hierarchy-expand.ts:257)). I think omission is safer, but it means the two paths are not actually mirrored.

7. Missing measurements

Before landing, I would add:

- Full production old/new structure calls, with at least two draws per arm, compared against within-arm boundary noise.
- Human paired review of root ceilings 18/20/22, stratified by essay, narrative, reference, and normative text.
- Faithfulness checks specifically for qualifications lost at the root.
- Padding analysis: unsupported causal links, generic “showing/underscoring” clauses, repetition, and clause count.
- Floor misses classified by range size and function; distinguish sensible short metadata from failed substantive summaries.
- Cascade root-gist ablation as described above.
- Actual whole-call and expansion answer tokens, stop reasons, malformed-answer rate, and cache read/write tokens.
- A lexical simplicity measure alongside retention of the author’s distinctive terms.

The core change is sound. The hard universal floor, its structural escape hatch, and the now-stale cost claim are not ready.