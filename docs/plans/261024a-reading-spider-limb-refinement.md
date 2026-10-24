# Make the reading spider's limb lengths more alike

Status: implemented and reviewed, 2026-10-24; full-suite run and landing in progress. Follow-up to the [identity rollout](261024a-eight-limbed-reading-spider-brand-assets.md). Claimed by this Codex session.

> can we tweak it so that the limbs are slightly closer to all being the same length (like a spider)?
>
> — Greg, 2026-10-24

Keep the selected compact, faceless orange yarn reader, hollow body and dark book. Adjust the proportions gently so the crossed lower limbs are less long relative to the four free upper/rear limbs and two book-support limbs. Similar implied strand length matters; identical projected lengths would ignore bending and occlusion. Do not add a face, fingers or a literal spider abdomen.

The simpler option is changing just the detailed PNG. Pass it over because the small optical mark and generated family should remain recognizable as the same identity. Preserve the previous detailed master and optical SVG in the archive before replacing either. Use the built-in image tool for the raster edit, and edit the optical SVG directly to match the result. Keep the upper free-limb geometry/crop unchanged where possible so Semaphore's tested joints do not move; if any output crop/geometry changes, remeasure and adjust its masks instead of weakening the checks.

## One implementation slice

- [x] Obtain Sol plan review before generating/editing. LOGO-LIMBS-PLAN-261024: proceed; F1 crop/pivots, F2 crossing mask and F3 actual visual/OG verification accepted. All are prospective P2 risks, not observed defects.
- [x] Generate a targeted transparent edit, inspect side by side, retain prompt/provenance and the previous masters. Confirm eight intended limbs, comparable lengths, reading posture and transparency. Fresh simulated visual review: accept, visible but modest; upper pair slightly more symmetrical; lower attachment occlusion remains intentional.
- [x] Match the optical treatment, regenerate the existing family/preview and OG card, update animation proof only if its source changes. Delegate a visual check and independent implementation review. Visual check accepted; independent code review follows.
- [x] Record the follow-up in the existing design investigation and source provenance. Avoid changing the original selection/history claims.
- [ ] Run focused brand/animation/metadata/doc checks, typecheck, build, touched-file lint and required full `npm test`. Do not expand this tweak into repairing the known unrelated suite/environment failures. Record real results and limits.
- [ ] Commit named files, merge `origin/dev`, push `HEAD:dev`; retain the worktree if validation limits remain. No deployment.

Parent: [design-logo.md](../project/design-logo.md#identity-and-asset-regeneration). Source-to-output inventory and theme/padding policy stay there and in `BRAND_OUTPUTS`, not duplicated here.

## Implementation evidence

The [side-by-side comparison](../../assets/brand/limb-refinement-comparison.png) uses the archived first transparent master and current edited master at the same canvas scale. Exact built-in image prompt and prior input history are in `assets/brand/source/reader-generation.json`; originals survive under `assets/brand/archive/`.

Delegated optical refinement shortened the long lower SVG route from 279.89 to 234.28 units and the foreground crossing strand from 88.11 to 73.52 (about 16% each), with the crossing mask kept in sync. Four free paths (80.5–86.3) and two supports (92.3) remain unchanged. These are editable path measurements, not claims of anatomical whole-limb totals: the lower route joins concealed folds.

As F1 predicted, preserving the upper source paths did not preserve their position in the PNG. The shortened crop shifted them down 3.23px. The unchanged geometry test went red first: right-limb selection coverage 0.74864, below the 0.75 minimum. Translating cuts and pivots down 1.26% restored the check; no test or threshold was changed. The delegate passed 80 focused tests, refreshed the motion/rest proof, and observed only 25 antialiased edge-pixel differences at rest, none below the joints. This is canvas/pixel evidence, not a live-browser check. Browser tooling is unchanged from the [unavailable attempt](261024a-eight-limbed-reading-spider-browser-review.md).

Parent generation/check with `--preview` succeeded for all eleven outputs and the proof. OG was separately regenerated through the existing script. The new-reader subagent accepted the visual change as modest and found no obvious new defects, while noting slightly more symmetrical upper limbs and still-occluded crossed attachments. These are simulated observations, not real-user evidence.

[Independent Sol implementation review](261024a-reading-spider-limb-refinement-code-review-sol.md), LOGO-LIMBS-CODE-261024: proceed, no new findings. It independently reproduced the old crop failure and measured updated selection coverage 0.78408/0.77679, with no stationary anatomy selected and both pivots on the upper stems. Fourteen tests and exact generation/preview checks passed independently. No reviewer edits.

Parent focused gate: nine files / 291 tests passed; all 3948 source files typechecked; full build passed. Touched CSS lint exited 0 with only the pre-existing specificity warning. Required full `npm test` is still running; no passing full-suite claim is made. Existing live-browser/tooling limitation remains explicit.
