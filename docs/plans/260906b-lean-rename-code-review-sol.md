## Findings

### F71 — P1, established: legacy compatibility stops at the panel

[`readStoredLean`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/types.ts:4075) protects the appearance lookup, but other consumers still read only `lean`:

- [`vocabularyReport`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/evals/debate/score.ts:237) treats every historical raw `valence` as an absent lean.
- [`replayJournal`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/evals/debate/replay.ts:136) sends historical rows through the new parser, which converts each missing `lean` to `cannot-tell`.

Measured against the three real journals:

- Cargo Cult: 6/6 leans off-vocabulary as `(absent)`
- Writes: 10/10
- Constitution: 10/10

Thus all 26 historical rows are no longer faithfully scorable, and Layer-1 replay silently loses their stance. This contradicts the accessor docblock’s “called by every consumer” claim.

The synthetic fixtures were correctly renamed—they explicitly are invented rigs—but consequently no longer exercise this historical boundary. Add a schema-aware adapter at the journal/stored-artifact boundary while keeping the live parser strict.

### F72 — P1, reasoned: the new negation can contradict the target binding

The shared instruction says lean is about the row target but not about “whatever the outside piece is itself discussing” ([debate.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:1093)). The direct prompt then says the target is the article itself while repeating that prohibition ([debate.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:1150)).

An admissible review will often itself be discussing precisely that article. Likewise, a claims source may discuss precisely the quoted claim. The intended exclusion is sentiment toward a person, product, phenomenon, or topic considered separately—not everything the source discusses.

The supplement example teaches the intended rule well for group two, but it does not remove the literal conflict, particularly in group one. Also, `relation` and `lean` share a subject and target; they do not “answer that same question” ([debate.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:1100)).

### F73 — P2, established: the prompt test is polarity- and format-insensitive

[`debate-prompt-target.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/tests/debate-prompt-target.test.ts:52) proves that selected phrases remain present, but not what the prompt says about them.

These opposite mutations would still pass:

- “Lean is **not** about this row’s target; use whatever the outside piece is itself discussing.”
- Changing both answer examples to `"lean": "supportive"` while leaving the shared vocabulary list untouched.

The second is exactly the F62 failure: the test titled “offers exactly the four leans” only checks that four strings occur somewhere in the prompt; it never validates the value attached to `"lean"` in each answer example.

So the deletion mutation is valid evidence, but C4 is false at the stronger semantic-contract level.

### F74 — P3: several Debate comments retain the old or old-scope contract

Examples:

- `DebateRelation` still opens with “What the outside page does…” despite the passage rescope ([types.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/types.ts:3503)).
- Parser comments still name fallback `unknown` ([debate.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:330), [debate.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:796)).
- Debate CSS still describes `neutral` and `unknown` ([debate.css](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/web/styles/debate.css:347)).

The functional rename is complete, but C3’s “did not miss a Debate one” is not literally true.

## Claim rulings

| Claim | Ruling |
|---|---|
| C1 | True for rendering: the sole production appearance lookup goes through `readStoredLean`. It preserves every legacy label and safely defaults missing/junk values. False only if expanded to every consumer—F71. |
| C2 | True as scoped. All four maps are independent exhaustiveness guards over the canonical union; adding or removing a `DebateLean` member forces each map to change. Prompt prose/examples remain unguarded copies. |
| C3 | Referee mode was untouched, and no functional Debate identifier was missed. Overall false because historical eval/replay was missed and several Debate comments remain stale. |
| C4 | The reported mutations genuinely fail. The legacy test is sound; the prompt test does not establish semantic polarity or example/parser agreement—F73. |
| C5 | Today’s example values are accepted by the parser. The supplement example teaches the desired inversion correctly. The prompt is nevertheless internally ambiguous/contradictory—F72. |

The label-sheet blinding remains intact: unique sentinel answer values are checked against rendered Markdown, while the renderer reads only target and evidence fields.

Verification: requested tests 25/25; all 13 focused files 346/346; all TypeScript projects pass. No files were changed by me.