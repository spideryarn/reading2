# Stages 2–3 review prompt — one press that draws the Sketch and then paints

You are reviewing **code that has already landed on a branch**, not a plan. Weight this higher than a
plan-stage review.

Working tree: `/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac`
Branch: `worktree-illustrated-415-mac`. Scoped diff (two commits, 790 lines):
`/private/tmp/claude-501/-Users-greg-dev-spideryarn-reading2/30d48fe1-626c-4185-80fe-248a1005b23c/scratchpad/stage23.diff`

Read first: `docs/plans/260903j-illustrated-415-and-one-click-paint.md` (**part two** — part one is
stage 1, already reviewed by you and fixed, and is out of scope), `docs/project/diagram.md`
§ Illustrated, AGENTS.md, `docs/reusable/silent-success.md`.

**Please run these yourself** — a finding you reproduced outranks one you reasoned to:

```
npx vitest run tests/illustrated-view.test.tsx tests/illustrated-step-registration.test.ts
npm run typecheck
```

Make no network call and do not run anything with `--prod`.

## What this is

Greg asked for one press that paints an Illustrated diagram even when no Sketch exists yet — draw
the Sketch first, then paint. This **reverses a decision made the day before**, whose reasoning was
recorded in the code as: *"Not `enqueue(["sketch", "illustrated"])`, which turns one press into a
hidden $0.20 charge and a three-minute wait that nothing warned about."*

The judgement made was that **the objection was to the hiding, not to the chain** — so the chain
ships and the price goes on the button, before the press.

## The design

- `useStepJob.start` gained optional `precededBy`, sending `steps: [...precededBy, step]`. The
  server orders them (`STEP_ORDER` / `orderSteps`); the browser never sequences anything. The
  rejected alternative was two POSTs sequenced client-side.
- `useIllustrated.drawThenPaint()` calls `start({ precededBy: ["sketch"] })`, **unforced**.
- The three refusal branches (`absent`, `stale`, `profile-changed`) keep their sentence and the
  "press the chip one to the left" route, and gain the button.
- `SKETCH_PRICE`/`SKETCH_WAIT` are now exported from `SketchView` and imported by `IllustratedView`,
  so one price has one home.

## What I most want you to attack

1. **The unforced decision, which is load-bearing.** The claim is: forcing would name `sketch`,
   `cascadeForce` sweeps in every step after the first forced one, neither `sketch` nor
   `illustrated` is in `FORCE_ONLY_WHEN_NAMED`, so a *current* Sketch would be redrawn at $0.20 for
   nothing — therefore leave it unforced and let `stepIsDone` decide. Is that right? And does
   leaving it unforced actually make `stale` and `profile-changed` **re-draw rather than adopt**?
   The argument offered is that the sketch stamp reads the artefact's own `sourceHash`/`profileHash`,
   which are the same two fields the route reports `stale`/`profileChanged` from, so there is no
   second copy to drift. Verify or break that.
2. **Can one press ever cost money the reader was not shown?** That is the whole product objection
   this reverses. Look for a path where more than the two named steps run, where a step runs that
   the button's sentence did not price, or where the sentence and the request can disagree.
3. **The in-flight state.** While the *Sketch* half runs, the band must not show a dead spinner or a
   still-pressable button. Note that `JobProgress` keeps `step="illustrated"` while the running step
   is `sketch` — is anything mislabelled or wrong during that window?
4. **`precededBy` as a general seam.** It is optional and defaults to nothing. Can a caller passing
   it get a job that is ordered wrongly, deduplicated wrongly, or force-cascaded unexpectedly?
   `orderSteps` puts names through a `Set` — is a duplicate (`precededBy: ["illustrated"]`, or the
   step naming itself) handled sanely?
5. **Anything that reports success while doing nothing.** Stage 1 existed because a check printed a
   tick about the wrong machine. In these tests specifically: is there an assertion that would pass
   whether or not the code under it ran? One test in this diff is explicitly a regression guard
   whose subject already worked — it was proved failable by mutation; check the others are not
   quietly in that category without saying so.

## Known, and NOT findings

- **Browser verification succeeded**: one press on a Sketch-less article produced a job naming both
  steps, ran them in order, and wrote three real `image/jpeg` plates to Storage; one was fetched and
  looked at. But there is **no in-app screenshot of the rendered plate** — the driving tab was
  occluded so client polling froze, and a peer's concurrent run replaced that article's revision.
  So the in-flight band label during the Sketch half is test-covered but not eye-verified. I know;
  tell me only if you think the tests are insufficient to cover it.
- `npm test` is not a stable baseline in this shared tree (peers share one local Supabase). Judge by
  the targeted files above.
- Stage 1 and its fixes are out of scope.

If an area is fine, say so plainly rather than manufacturing a finding. Separate "this is a bug"
from "I would have designed this differently", and for the latter say what you would do instead.
