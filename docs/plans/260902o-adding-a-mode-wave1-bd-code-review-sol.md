## Verdict

- **Stage D: ship.**
- **Stage B: ship.** I recommend one non-blocking cleanup to avoid the fictitious public type.

No stale-reply interleaving survived the audit.

## Findings

1. **Low — `StepsMissingFromOrder` need not be public.**

   - **(a)** Another module can import `StepsMissingFromOrder`, even though its comment says nothing should. The `@public` tag then deliberately tells knip that this accidental API is intentional. This does not weaken the exhaustiveness check or cause a runtime defect.
   - **(b)** Keep an internal tuple value, give the exported `STEP_ORDER` a private conditional type annotation that resolves either to that tuple or `["STEP_ORDER is missing", Exclude<…>]`, and remove the exported assertion type. All declarations remain used, so `noUnusedLocals` and knip accept the shape without a dummy public API. The current spelling in [pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/pipeline.ts:202) is nevertheless safe to ship.

## Stage D

The glossary mechanism survived the lift intact:

- Render-time invalidation keyed on `read` identity: [useOrderedRead.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useOrderedRead.ts:141).
- `finally` clears only its own `inFlight`: [useOrderedRead.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useOrderedRead.ts:170).
- `refresh` awaits the current request and then the trailing request: [useOrderedRead.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useOrderedRead.ts:185).
- Unmount clears `trailing`: [useOrderedRead.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useOrderedRead.ts:210).

I found no stale-commit sequence. Every started read owns a generation. Starting a newer read, changing `read`, or calling `discard` increments that generation before the old reply can commit. `refresh` serializes the post-change read behind the existing one. The old response may briefly commit before its trailing successor, but it cannot land after that successor and overwrite it.

All eight callers check `current()` after both awaits and at the start of `catch`, before state or—for Tweets—logging:

- [useGlossary.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useGlossary.ts:154)
- [useIdeas.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useIdeas.ts:99)
- [useQuotes.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useQuotes.ts:101)
- [useTimeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useTimeline.ts:87)
- [useQuiz.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useQuiz.ts:201)
- [useArc.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useArc.ts:104)
- [useSketch.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useSketch.ts:96)
- [Tweets.tsx](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/Tweets.tsx:134)

The three special cases are correct: Sketch includes joined block order in `load`’s identity; Arc converts stale to `arc: null`/`absent`; Tweets guards before its console/log-buffer side effects too.

`armRefresh` and `discard` are at the right boundary. They manipulate the helper’s private generation/in-flight/trailing state; keeping them “private to glossary” would either duplicate that state or couple the helper to glossary callbacks. One caller each is not a reason to move them. I would retain both.

The test is discriminating:

- Unmodified: **8/8 passed**.
- Mutating `refresh` to join through `reload`: **8/8 failed**, each with only one request answered.
- Separately mutating it to launch an unordered parallel read: **8/8 failed on the rendered value**, ending with `OLD`, confirming every harness actually distinguishes stale from fresh at [artefact-read-race.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/tests/artefact-read-race.test.tsx:393).
- The older glossary preservation suite also passed **10/10**.

## Stage B

`: ArticleReader` is the right choice under the present seam contract. The seam test explicitly discovers adapters from variable annotations at [store-seams-have-two-implementations.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/tests/store-seams-have-two-implementations.test.ts:91), and the filesystem peer uses the same shape. `satisfies ArticleReader` would preserve a narrower inferred object, but no caller benefits from it. Supporting `satisfies` later should begin by teaching the seam parser that syntax.

No `STAMP_SOURCE` reader distinguished an absent key from explicit `null`:

- Filesystem uses `if (!kind) return null`: [artifacts-fs.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/store/artifacts-fs.ts:590).
- Postgres uses the same truthiness branch before reading the artefact: [artifacts-pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/store/artifacts-pg.ts:805).
- `assertStampAgrees` likewise treats either as “not this artefact kind.”

Thus the explicit `fetch`, `extract`, and `blocks` nulls in [artifacts.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/store/artifacts.ts:672) preserve behavior while making omissions a type error. The `quotes.isStale` readonly change is also clean.

The working tree was left untouched.