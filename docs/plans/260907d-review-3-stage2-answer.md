Verdict: **refuse as-is** on two established P1 contract violations.

### F17 — P1 — established: the records schema changed without a version bump

[`DeepenStats.missingQuestions`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-deepen.ts:2008) is a new required field serialized inside `DeepenRecordsFile`, but the writer still emits [`deepen-records/3`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-deepen.ts:1876). That interface explicitly requires a bump when its shape changes. The eval reader accepts any `/3` file after checking only that `stats` exists.

(a) Against the exact commit, I passed `parseRecordsFile` an old `/3` object whose `stats` lacks `missingQuestions`. It accepted it:

```json
{
  "acceptedVersion": "deepen-records/3",
  "hasMissingQuestions": false,
  "runtimeValue": null
}
```

Thus an old artefact is accepted as the new TypeScript shape, contrary to the version’s stated guarantee.

(b) Bump the writer and type to `deepen-records/4`, update [`RECORDS_VERSION`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/deepen/harness.ts:933), and add a parser regression showing `/3` is refused.

### F18 — P1 — established: the live acceptance gate was waived on a false impossibility claim

The original acceptance condition requires [one real cascade run](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md:325). The appended account declares that impossible because a childless root must arise naturally from wave 1.

It need not. The existing [`rootOnlyTree()` fixture](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/tests/hierarchy-deepen-wave.test.ts:1877) already constructs the exact state. Using real article blocks, its real root metadata and [`liveExpansionExecutor`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-deepen.ts:828) gives the model the exact production prompt for this case. Nothing about the article is falsified; only the upstream model outcome is controlled.

(a) My exact-commit harness constructed an ASK-root request from a wave-1 example that already had children. It reported:

```json
{
  "wave1WasAlreadyDivided": true,
  "asksRootChildren": true,
  "showsHonestOutline": true,
  "coversWholeArticle": true
}
```

For the live pilot, create a root-only `Tree` over one real article’s full range and call `deepenTree` with `liveExpansionExecutor`. No production data needs changing.

(b) Restore the live acceptance condition and make that one scoped pilot. If every question is omitted, revise the prompt as originally required; otherwise record the result.

### F19 — P3 — established: `summaries.md` says mixed panels have only one remaining cause

The new claim says a mixed panel is [“only ever” caused by a collapsed rung](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/docs/project/summaries.md:360). But requested questions remain optional and non-fatal.

(a) I returned two root children, one with a question and one without. The exact candidate made one call, reported `missingQuestions: ["root > child 2"]`, and rebuilt:

```json
[
  { "title": "First", "question": "First — why does it matter? (a reason)" },
  { "title": "Second", "gist": "…" }
]
```

A wave-1 structure answer may likewise omit one optional question.

(b) Name all remaining cases: collapsed-rung promotion, accepted expansion omission, and a wave-1 omission. Distinguish `droppedQuestions`, `missingQuestions`, and currently uncounted wave-1 absence.

### F20 — P3 — established: the cache arithmetic comment retained the old prefix size

[`runExpansionWave` still says 1,150–1,400 tokens](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-deepen.ts:1203). The exact candidate reports `estimateTokens(EXPAND_SYSTEM) === 1,631` before any outline is added.

(a) Run:

```ts
estimateTokens(EXPAND_SYSTEM) // 1631
expansionPrefixIsCacheable("") // true
```

(b) Update the range and reconsider the adjacent “about 1%” sentence. Cacheability itself is intact.

The core implementation otherwise holds: ancestor length equals depth by induction through `walk`; the production ASK case is only a childless root; carrying questions through to `buildTree` is cleaner than duplicating `questionFor`; deeper questions are dropped there; no import cycle or article-adjacent logging appears. `DeepenStats` is the right home for answer omissions, subject to F17’s artefact bump.

I ran `tests/hierarchy-expand.test.ts` from an extracted `6bcb0b6e` snapshot: **52/52 passed**. No files were changed.