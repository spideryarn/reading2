# One textured reader across tab and app

Status: complete implementation, approved and validated, 2026-10-25. Worktree: spideryarn-knot-reader-logo. Parent: [main-icon.md](../project/main-icon.md).

> Let's go with A. Proceed autonomously.
>
> — Greg, 2026-10-25

A is the unchanged textured `assets/brand/source/reader.png`, not the flat B study. Greg compared A/B in a shared preview and chose A after asking for consistent favicon/main-app identity. His target is Chrome on Mac. The earlier separate optical and upright-knot favicon experiments are superseded, not instructions to redesign the master.

## Scope and simpler option

Use the existing textured master for all outputs, including favicons and the shared in-app mark. Keep existing output names and install/social treatment; do not edit the master or introduce dependencies. Preserve the former SVG as historical evidence. Generating only favicons would be simpler but leave the divergent small app mark Greg objected to. RealFaviconGenerator was tried in an isolated preview: useful packaging/checking, but no improvement in the chosen artwork and no reason to replace the existing generator.

## One implementation stage

1. Before implementation obtain Sol plan review. Delegate generator/source-family regression and animation geometry to separate agents, with exclusive files.
2. Switch small outputs to the reader master. Add an independent regression proving the app/favicons contain the selected coloured book and source silhouette, and watch it fail before changing the generator. Update old optical-specific expectations only where the new artwork justifies it. Preserve source/installed/social bytes unless intentionally regenerated from identical source.
3. Remeasure Semaphore cuts/pivots on the textured PNG. Replace the old SVG-dependent anatomy reference with an independent annotated reader-source fixture or explicit anatomical regions; preserve meaningful limb coverage, exclusion, reconstruction and pivot thresholds. Run against new raster with old CSS first, record failures, then fix geometry. Do not remove the animation or loosen checks to pass.
4. Regenerate public assets, size/theme proofs and static motion proof. Add a durable browser-tab review page generated from real assets showing 16 logical pixels at 1x/2x and larger app samples, with real favicon declarations; keep this focused and avoid app runtime changes. Inspect actual PNGs, rest and raised poses. Browser verification via available UI; do not claim Chrome/Retina hardware verification from page samples alone.
5. Update main-icon ownership, historical investigation pointer and process for one master; record exact decision and Chrome logical-vs-device pixel distinction, source links and tool trial. Preserve older source/history. Review implementation with Sol, inspect fixes, run focused brand checks, npm test, typecheck, build and touched-file lint. Record baseline/unrelated failures honestly. Commit named paths, merge latest dev if needed, push HEAD:dev. No production deploy.

## Evidence

Implemented one reader input, removed live SVG/markPath, regenerated app/favicons, preserved master/install/social bytes. Added HTML browser proof to the existing update/check process. Sol [plan review](261025b-plan-review-sol.md) and [implementation review](261025b-code-review-sol.md) approved.

Red-first evidence: [identity](261025b-pipeline-red.log) failed on the former monochrome favicon (zero dark book pixels); [geometry](261025b-animation-red.log) failed with the textured raster and old CSS (21.06% unrelated foreground; pivot in stationary anatomy). The independent annotation fixture is source-space, source-hash guarded and labels the two upper limbs without using CSS coordinates. Strict coverage, exclusion, reconstruction and pivot checks remain, with nonempty masks and broad-cut/wrong-pivot negative controls. The textured master has fewer enclosed gaps than the outline: test expectations now protect its actual central hollow at16/32px and extra gaps at48/256, alongside independent full-master/book identity.

Parent inspected native proof and static motion proof. Raised-limb rotation retains a small enlarged joint notch inherent to the clipped raster technique, slight at44px; no changed body/book or stationary limb movement was observed.

Validation: `brand:update` exit0; `brand:check`10files/310tests passed; typecheck4006sourcefiles passed; fullbuild passed; direct scoped Biome check exit0 with existing specificity warning/flood-fill complexity info. The literal npm lint script also checked its built-in whole-tree target and failed its existing baseline. Full `npm test` was stopped with exit130 after failures outside this icon scope were established, including shared database contention/ECONNREFUSED and remote/process tests. It is not a complete-suite pass. The [validation record](261025b-validation.json) lists the observed failing suites; neither changed test appears there. Executable changes are confined to the generator and Semaphore CSS; remaining code edits are comments. The focused brand/animation/consumer checks passed independently. Final doc links:18tests passed.

Browser: prescribed Chrome extension unavailable in the Sonnet handshake; parent used the in-app browser fallback to inspect actual generated files. All16images loaded at declared widths; its16logical-pixel srcset selected favicon32. This verifies page resource selection, not Chrome tab-strip caching, physical display scale, device installation or live animation timing.

Existing A/B preview at `/Users/greg/.codex/visualizations/2026/10/23/01a16af8-7ad5-7ee1-b6a2-3a341d2500d5/favicon-unified/compare.html`; it is selection evidence, not the shipped assets. No main master changes authorised or needed.

The newly landed Chrome extension already uses the selected textured reader on cream. A narrow
Sol follow-up confirmed no material identity inconsistency; integrating its independent icon package
would expand this stage without fixing a current defect. Its build copies committed `extension/icons/`;
the main-icon guide now signposts that separate owner and future-update obligation.

## Final landing

Landing target: `dev`, after named-file commit; fresh fetch showed dev unchanged at4b0d4dd3f. No production deployment. The retained worktree holds this validated change and its proof page; wider full-suite failures prevent calling the whole tree green. Source unchanged: A remains the textured reader, not flat B or a separate upright-knot favicon.
