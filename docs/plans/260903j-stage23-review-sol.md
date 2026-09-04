Verdict: no blocker. The draw-then-paint chain is functionally sound, with two low-severity bugs and one prospective seam concern.

### Bugs

- Low — contradictory refusal copy. [IllustratedView.tsx](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac/src/web/IllustratedView.tsx:678) says “there is no Sketch” for all three branches. For `stale` and `profile-changed`, the next sentence immediately says a Sketch exists. Use “no usable Sketch” or branch-specific text. The tests only assert the second paragraph, so this wrong sentence passes unnoticed.

- Low — the force rationale is factually wrong. [useIllustrated.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac/src/web/useIllustrated.ts:143) says force would name `sketch`; [useStepJob.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac/src/web/useStepJob.ts:487) actually forces only the hook’s step, `illustrated`. Also, both steps are in `FORCE_ONLY_WHEN_NAMED` at [pipeline.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac/src/pipeline.ts:475). Reproduced results:

  - force `illustrated` → only `illustrated` forced
  - explicitly force `sketch` → only `sketch` forced

  The unforced implementation remains correct; its documentation and test rationale need correction.

### Design concern, not a current bug

`precededBy` does not enforce precedence. [useStepJob.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac/src/web/useStepJob.ts:105) accepts any `StepName`, while `orderSteps` applies canonical ordering. I reproduced `precededBy: ["assets"]` on `hierarchy` becoming `["hierarchy", "assets"]`; with force, both become forced. The current `sketch` → `illustrated` caller is safe. I would validate that every preceding step occurs earlier in `STEP_ORDER`, or rename the option to `additionalSteps`.

Everything else checks out:

- Stale/profile-changed Sketches genuinely rerun; current Sketches skip.
- One press names only `sketch` and `illustrated`; no hidden downstream steps.
- The in-flight test sufficiently covers the Sketch-half label, spinner, Stop, and absent button.
- Duplicate step names deduplicate sanely.
- The new tests are substantive rather than vacuous, apart from the uncovered contradictory sentence.

Checks: targeted Vitest passed, 45/45. The exact `npm run typecheck` wrapper was sandbox-blocked opening `tsx`’s IPC socket; running the same script via `node --import tsx scripts/typecheck.ts` passed all three projects and covered all 1,212 source files.