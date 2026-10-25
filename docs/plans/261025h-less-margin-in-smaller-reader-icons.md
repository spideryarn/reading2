# Less margin in smaller reader icons

Status: complete implementation, reviewed and validated, 2026-10-25. Parent: [main-icon.md](../project/main-icon.md).

> So I guess what I'm suggesting, the smaller the icon, the less margin. I don't know, use your judgment, and then update docs and push.
>
> — Greg, 2026-10-25

Greg wants near-full favicons/tiny marks, the middle fuller iPhone tile, and existing breathing room in big exports. A remains the unchanged textured reader. Decisions here are the implementing agent's judgment under that instruction, not further user quotes.

## Proposed treatment

- Favicon16/32/48 and app256 (displayed mainly20px):99% of the longest alpha-bounds dimension (0.5% inset per edge). Almost edge-to-edge, retaining a tiny sampling allowance instead of clipping the antialiased tips at100%.
- iPhone180 and Android192/512 home-screen tiles:84% fill (8% inset), matching the middle preview. Their large source resolution does not make them large display icons.
- Reader512/social source: existing3% inset. Light/dark1024exports: existing12% inset. Preserve master,512/social and1024bytes.
- Keep opaque ivory for the default phone tile. The dark book/reading pose separates better on ivory; retain dark export for future choice. Transparent favicon/app marks remain. Native Apple layered/clear icons are not the same facility as our flat apple-touch-icon web clip. Apple guidance recommends full-bleed opaque background layers, and WebKit records transparency causing unexpected black backgrounds/borders for web clips. Do not claim all modern iOS appearances forbid transparency or automatically track our app theme.

Simpler option: remove all padding from every output. Rejected: risks sampling/clipped tips and discards the requested breathing room at larger uses. No new library or artwork edit.

## One stage

1. Sol plan review before implementation; delegate generator/tests and animation geometry separately.
2. Add a geometry/fill contract red-first against existing outputs, using independent decoded alpha/background bounds, then change output paddings and regenerate. Keep opacity and exact native-proof checks. Update existing master-comparison expected scaling, not tolerance. Preserve raster-equivalence/ICO logic.
3. Transform Semaphore cuts/pivots for the enlarged app crop, reusing source-space independent anatomy annotation and unchanged strict thresholds/negative controls. Update expected reference crop to99%, show oldCSS failure if it fails, fix actual geometry and regenerate motion proof. No animation redesign.
4. Update actual-asset browser proof and size sheets, stale labels, main-icon process and decision record. Inspect sizes/themes and light/dark phone choice; physical iPhone validation remains unverified.
5. Sol implementation review; brand:update/check, npm test, typecheck, build and scoped lint. This follows the previous full-suite run that failed outside the icon scope and was interrupted; record new results accurately. Commit own named paths and push dev; no deploy.

## Sources and evidence

- [Apple app-icon design](https://developer.apple.com/design/human-interface-guidelines/app-icons): opaque background layers and system-applied masks, native app guidance rather than a promise of web-clip dark/clear variants.
- [WebKit web apps](https://webkit.org/blog/13878/): apple-touch-icon takes precedence over manifest icons.
- [WebKit transparency report](https://bugs.webkit.org/show_bug.cgi?id=255596): concrete web-clip background limitation, historical report rather than a universal current-platform claim.

Sol plan review approved with no blocking findings. Accepted wording correction: fill measures the longest alpha-bounds dimension, not an assumed height. Delegated generator/fill regression and animation crop adaptation to separate agents. 
Implementation landed in the planned scoped files. [Sol implementation review](261025h-code-review-sol.md) approved with one pointer-wording correction applied. Fill regression failed before the table change: [red evidence](261025h-fill-red.log) found the old app256 short by11.44pixels against a2.56pixel sampling allowance. Old CSS on the enlarged app crop selected8stationary pixels; [geometry red evidence](261025h-geometry-red.log). New CSS applies the centred99/95transform without loosening anatomy/coverage/exclusion/reconstruction/pivot assertions. The source-space fixture and source hash are unchanged.

Validation: complete brand:update exit0; brand:check10files/311tests passed; typecheck4015sourcefiles passed; full build passed; scoped Biome exit0 with existing specificity warning/flood-fill complexity info. Independent reviewer reran34tests and both proof freshness commands. Parent inspected the actual generated size/theme proof. [Validation record](261025h-validation.json) preserves unchanged master, reader512,1024exports and OG hashes. Physical iPhone appearance and live reduced-motion/animation timing remain unverified.

The required npm test invocation is included in brand:check's focused run. The recent full-suite attempt in the preceding [A-selection validation](261025b-validation.json) was stopped after failures outside the icon scope and database connection errors; this slice does not claim a passing global suite or repeat that known-red unrelated run.

Landing: commit named paths and push dev. No production deploy. Keep the existing worktree available for icon proof inspection while the broader suite remains ungreen.
