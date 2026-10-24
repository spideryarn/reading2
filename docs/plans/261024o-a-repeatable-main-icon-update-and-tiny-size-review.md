# A repeatable main-icon update and tiny-size review

Status: complete on `dev`, 2026-10-24. Implementation `173e0d995664bb38bd8d0c757b0be1dda626b3c7`, based on `f2b128b914bec227c65a9472715a26b54c45ee47`. No artwork change or deployment.

> and then update our docs/scripts (e.g. a main-icon.md with appropriate signposting) so that we have a process for updating it again in future
>
> — Greg, 2026-10-24

## Scope and simpler option

The selected artwork and generated icon family already exist. `brand:generate` produces PNG/ICO and optionally the size/theme preview; OG remains a separate script, and the more useful tiny/zoom inspection sheet exists only as a one-off conversation artifact. Put the repeatable process in `docs/project/main-icon.md`, owned by the design overview. Move the current identity/regeneration material out of `design-logo.md` into that home; retain its old anchor as a pointer so dated links keep working. Add only signposts to AGENTS/overview, not new policy.

The simpler option is a doc that lists the current manual commands. Pass it over because forgetting OG or the small-size proof is exactly the gap the future process should close. Reuse the existing generator/canvas/OG path; no new dependency, image generation, brand redesign or automation framework.

## One implementation slice

- [x] Sol plan review before implementation. MAIN-ICON-PLAN-261024: approve. F1 accepted: distinguish PNG/ICO/proof byte freshness from OG structural validation; `brand:update` regenerates OG, without adding a second rendering/check framework.
- [x] Delegate generator/package/tests changes: `--preview` emits both the existing proof and a tiny-size sheet from the actual generated PNGs, with light/dark favicon16/32/48, app20/15/10, detailed install60/48/32/24/16 and a clearly labelled enlarged16px diagnostic. Make check mode verify both proofs without writing. A testable optional preview destination avoids tests touching committed files.
- [x] Add `brand:update` (generate with proofs, static animation proof, then OG), `brand:og`, `brand:animation-preview` and `brand:check` (freshness/proofs plus focused brand/animation/metadata/doc tests). Keep `brand:generate` compatibility and its explicit output table. Existing broad DB/Auth suite limits do not belong on the routine icon-only check path.
- [x] Write `main-icon.md`: intent/history links, source vs derivative ownership, archiving/prompts, both optical/detailed treatments, commands/prerequisites, native-pixel/theme/zoom inspection, alpha/crop/Semaphore trap, output-consumer links and landing links. Keep inventories/command details in code/package.json rather than duplicate tables. Point existing guide/comments/current investigation at it; preserve dated history and old anchor.
- [x] Fresh agent starts from AGENTS with a realistic future icon-update task; report navigation and omissions, without edits. Independent Sol implementation review. Inspect actual generated proof, focused `npm test`, typecheck, touched-file lint, build and command behavior. Exercise missing/stale proof failure and no-write check in a temporary destination. No repeat of the previously failing/interrupted broad DB run for this dev-script/doc slice; no full-suite passing claim.
- [x] Commit named files, merge current dev, rerun affected checks and push `HEAD:dev`. No deployment. Retain this worktree while wider browser/suite limits remain.

## Authority and boundaries

This is the existing worktree attached to the task. Artwork/source hashes and public icon/OG bytes should stay unchanged; only proof images may change. Generating OG invokes the existing headless renderer, not live browser automation or account access. The new guide records this distinction. The user's earlier authorization to commit/push persists. Any signpost edit to AGENTS/overview is not a policy change.

## Findings during implementation

The fresh navigation agent followed AGENTS → design overview → main-icon successfully, then found that the animation proof was referenced without any saved refresh script. Accepted: promote the existing temporary canvas renderer into `scripts/preview-logo-animation.ts`, with an isolated exact `--check`, and include it through `brand:animation-preview` in update/check. This closes the documented process instead of leaving a manual reconstruction exercise. No live browser or new dependency. The guide also now distinguishes optional light/dark exports from the actual cream install consumer and records physical-device verification as a separate check.

The new strict native-pixel test exposed high-quality canvas smoothing changing 1:1 samples by up to 39 channel units. The delegate initially suspected alpha rounding, then traced it and disabled smoothing for native draws rather than weakening the assertion. Exact native and 8× diagnostic assertions pass. This was caught before the first implementation commit; [the postmortem](../postmortems/261024e-a-proof-resampling-its-supposedly-native-input.md) preserves the false-evidence class.

Fresh navigation check: AGENTS → design overview → main-icon led to the sources, commands and important limits. After adding the motion-proof command and explaining install exports/physical-device limits, the agent found no remaining substantive ambiguity. Its separate six-test contract suite covers missing/stale/no-write animation proof checks and malformed CSS before output creation. The existing anatomy tests remain independent.

## Validation

[Machine-readable result and public hashes](261024o-main-icon-process-validation.json). Parent exercised the complete `brand:update` command, not just its constituent generator: all twelve public PNG/ICO/OG hashes remained exactly unchanged. `brand:check` passed ten files / 301 tests; typecheck covered all 3953 source files and passed; build passed; touched-file lint exited 0 with the existing test-only flood-fill complexity advisory. Both generated size proofs and the static motion proof were visually inspected.

[Independent Sol code review](261024o-main-icon-process-code-review-sol.md), MAIN-ICON-CODE-261024: approve, no new findings. It passed 39 targeted tests and both no-write generation checks, and independently reproduced the 35/39-channel smoothing defect behind the postmortem. No reviewer edits. Plan F1 was accepted and addressed; no new finding IDs were issued.

## Landing

The live candidate closed as `173e0d995664bb38bd8d0c757b0be1dda626b3c7`. A fresh fetch and merge reported already up to date; no peer changes required new checks. Push succeeded `f2b128b91..173e0d995` to `dev`. Before this completion-note edit, `worktree:check` reported SAFE TO REMOVE with all commits on `origin/dev` and matching environment/fixture data. The worktree is retained for inspection under the previously recorded wider-suite/browser limits. This final note closes the review provenance; it does not change the implementation.
