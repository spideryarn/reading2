# Airier reader limbs across the icon family

Status: complete implementation, reviewed and validated, 2026-10-25. Parent: [main-icon.md](../project/main-icon.md).

> I can't really tell the difference between B and C. Maybe C? I think these are better, especially for the smaller verisons. Proceed.
>
> — Greg, 2026-10-25

Adopt C from the upper-limb comparison: the built-in image tool's second edit, `exec-e161cf5c-9870-48e6-8d74-e432890132ff.png`. C targets slimmer/longer four free rear limbs, preserving the faceless body, book, two supports and crossed base (eight intended limbs). Prompt percentages are approximate visual targets, not measured geometry or pixel-preservation claims. Apply the same new master across all uses, rather than introducing a favicon-only character. Keep the approved99% tiny/84% phone fills, ivory default and existing large margins.

Simpler option: use C only for the favicon. Rejected because Greg explicitly wanted consistent identity across sizes; the last recommendation was to carry selected proportions across the family.

## One stage

1. Independent Sol plan review before edits. Archive existing reader master/provenance and B/C studies; copy C byte-for-byte as the new master; preserve exact prompt/input/model-tool provenance and comparison evidence. Verify RGBA, transparent core/limb gaps and opaque pages, no unwanted meaningful fragments; do not silently retouch the chosen image.
2. Delegate regeneration/brand tests and independent Semaphore anatomy adaptation separately. Regenerate public icons, exports and OG, proofs and browser page using the current single-source generator. Add a C identity guard/regression before replacement, then show it fail against old outputs and pass after replacement. Keep meaningful opacity/gap/fill checks.
3. The extension already has the same old textured character but now needs the new master too. Bring its16/32/48/128icons into the existing generator/check command, with no new dependency. Measured existing treatment:16/32/48 transparent,128ivory opaque. Preserve those backgrounds; use the already approved99% fill for the tiny extension marks to match favicons, and retain12% inset for128. Explicit extensionDir test seam; when public outputDir is overridden without extensionDir, use an isolated nested extension-icons folder, never the real extension checkout. Keep return value11publicnames for callers; CLI names both families. Add freshness/no-write/missing-dir/source-change tests including the extension; build its package but do not publish/store-upload/change permissions.
4. Replace anatomy source hash and annotate C upper limbs independently in source coordinates. Remeasure CSS cuts/pivots, keep coverage/exclusion/rest reconstruction/pivot thresholds and negative controls, show old geometry failure if present. Refresh static motion proof and inspect20/44px both themes.
5. Update main-icon and extension guide source ownership/regeneration instructions, dated investigation/plan, and test evidence. Sol code review, brand:update/check (includes focused npm test), typecheck, full build, extension build and scoped lint. Recent unrelated full-suite failure remains documented; no passing-global-suite claim. Commit named paths and push dev. No production deploy or extension-store submission.

## Evidence

Chosen preview: `/Users/greg/.codex/visualizations/2026/10/23/01a16af8-7ad5-7ee1-b6a2-3a341d2500d5/favicon-unified/slender-c-master.png`,1254×1254RGBA. Original generated file remains under `.codex/generated_images/01a16af8-7ad5-7ee1-b6a2-3a341d2500d5/` and must not be the sole stored project source. Plan approved in [Sol review](261025i-plan-review-sol.md). Fixed independent identity guard, measured extension host treatment and no-write assertions accepted. Implementation delegated in two exclusive file groups. [Sol implementation review](261025i-code-review-sol.md) approved without blocking findings.

## Implementation and validation

C was copied byte-for-byte and the old master/provenance archived. B/C studies and exact prompts are in assets/brand/explorations; the current generation JSON links them. Source RGBA/core gaps verified; book-page pixels are visually solid (mostly alpha254), like the generated input, not claimed universally alpha255. Install tiles are composited fully opaque. No retouch was applied to the selected image.

The fixed C source-identity guard failed on the old master before replacement: [red evidence](261025i-source-red.log). Brand tests now cover extension dimensions/backgrounds, tiny equality to favicons, all4source-change invalidation, missing/stale/no-write/no-create-dir/mtime behavior and the isolated outputDir fallback. Public return contract remains11names; normal CLI checks15actual icon assets.

C received fresh independent source-space anatomy with its selected-file hash. Existing CSS remained valid: [baseline](261025i-geometry-baseline.log) is green, not a manufactured red failure. [Metrics](261025i-geometry-metrics.json): coverage94.43%/93.14%, unrelated/stationary pixels0, rest missing0, overlap0.103%. Strict thresholds and broad-cut/wrong-pivot negative controls remain unchanged. Parent inspected source annotation and native tiny proof; agent/reviewer inspected motion at20/44both themes.

Validation: brand:update exit0 (including C OG); brand:check10files/314tests passed; typecheck4015sourcefiles passed; app build and extension build passed; scoped lint exit0 with pre-existing flood-fill complexity info. Independent review reran37tests and freshness checks; both built extension folders match committed icons. [Validation record](261025i-validation.json) stores resulting hashes. Current browser proof references actual generated public files. Physical iPhone appearance/cached installation and live motion remain unverified.

Focused npm test is part of brand:check. The prior broader-suite interrupted/known-red run is documented in [A-selection validation](261025b-validation.json); no global passing-suite claim or unrelated retest here.

Landing target dev after named-file commit. No production deploy or extension-store submission. Extension package is built at its existing version; a future store update must follow the extension guide's version bump/publication process.
