# An eight-limbed reading spider, and reproducible brand assets

Status: complete on `dev`, 2026-10-24. Implementation `d3baedfe0e83cd63afdd715a5c6e83b4d024e02b`, integrated and pushed as `f9bf3549bfa749d62745ab37cf5b3f27d1223d9b`. No production deployment. Full-suite/browser limits below remain explicit.

## Goal and authority

Greg asked to take Z (the faceless woolly seated reader) forward, generate another round with eight limbs, obtain independent naive-reader and icon-specialist reactions, choose a winner, generate every required asset, preserve intent and intermediate versions, then commit and push to `dev`.

> Actually I'm leaning towards Z! Though I think we need 8 limbs, for a spider, no?
>
> — Greg, 2026-10-24

> Suggestive. Hint at a likeable character in a pose and/or reading. Less is more.
>
> — Greg, 2026-10-24

The product helps people understand, interrogate, connect and remember difficult writing. The character should invite reading and independent thought. The original orange yarn/knot identity, warmth, abstract posture and book matter; eyebrows, literal hands and overt expressions were rejected. Record exact quotations and the progression in a dated research note, with a pointer from the existing logo reference doc.

## Evidence and constraints

- [Vision](../project/vision.md), [positioning](../project/positioning.md), [design/logo](../project/design-logo.md), [third-party selection](../reusable/third-party-library-selection.md).
- `src/web/LogoGlyphs.tsx` centralizes all app mark consumers. The app supports light and dark through `html[data-theme]`.
- `src/web/styles/logo-animations.css` uses `/spideryarn-logo.png` as an alpha mask. Preserve transparent image bounds, wrapper classes and effects; do not substitute an opaque tile as the alpha mask.
- Existing binaries: app PNG, favicon 16/32 PNGs, ICO 16/32/48, Apple 180, Android 192/512 and OG 1200x630. `scripts/make-og-card.ts` is the only existing generator. `@napi-rs/canvas` is already a direct dependency.
- At tiny sizes, wool/book details can disappear. Inspect real 16/20/32/48px renders; derive a deliberately simplified eight-limbed yarn/book mark if needed rather than blindly reducing a detailed illustration.
- App themes and install-icon backgrounds are different concerns. Use one transparent master when it works in both themes; introduce matched theme renders only if necessary. Install tiles are opaque square sources with padding; the OS supplies the corner mask.

## Simpler option passed over

Replacing the existing PNG and shrinking Z everywhere would be simpler, but Z has six readily apparent limbs and its texture is unlikely to remain readable at favicon size. The intended solution is one selected character identity plus the minimum optical simplification and theme/background outputs justified by visual evidence. Prefer existing canvas over a broad favicon platform; compare current upstream options before deciding whether a small ICO dependency is worthwhile.

## Stages

### Select and preserve the identity

- [x] Get GPT Sol plan review before implementation. LOGO-PLAN-261024: proceed; F1/F2 accepted below.
- [x] Generate a small final Z-led round with eight intended limbs: four upper/rear free limbs, two book-support loops, two crossed lower limbs. Preserve a few earlier favourites and their prompts. Review bounded the claim: concealed attachments are not anatomically traceable through the knot.
- [x] Obtain two independent visual critiques (new reader and icon expert), without disclosing the preferred candidate. These are simulated perspectives, not real user research. Count limbs, compare small renders and choose a winner; record dissent and reasoning.
- [x] Commit the source, discussion/review evidence and selection note after stage review. Source and derivatives landed together so the committed family and its regeneration evidence agree.

### Generate and integrate the asset family

- [x] Delegate the reproducible generator and focused tests. Verify current library/platform docs, choose the smallest maintained dependency set and record the decision.
- [x] Produce a transparent app master, light/dark treatments as needed, inset opaque install tiles, favicon PNGs/ICO, Android icons, optional maskable only with a valid safe zone, and updated social card through the existing path.
- [x] Integrate shared mark rendering, favicon/head metadata, manifest, email and animation consumers where required; preserve animation behavior and screen-reader labels.
- [x] Save intent, selected variants, prompt provenance and regeneration command with appropriate signposting. Add no new rule or policy.
- [x] Verify generation determinism, dimensions, alpha/internal gaps, visible content, ICO frames, manifest paths and small-size legibility. Test a deliberately invalid source/check so success is meaningful.
- [x] Independent Sol review, inspect fixes, run focused tests, full `npm test`, `npm run typecheck`, touched-file lint and build. Browser-check both themes and real logo hosts via the prescribed browser mechanism if available; report any actual environmental limit honestly. Full suite was red; limits and focused passes below.
- [x] Commit named files, merge current `origin/dev`, rerun affected gates, push `HEAD:dev`. Do not deploy to `main`. Check worktree safety before cleanup.

## Progress

- Read-only inventory found no favicon generator and identified the alpha-mask, aspect-ratio and OG regeneration traps.
- Isolated managed worktree created; dependency setup running. Shared primary has an unrelated untracked notes file which will not be touched.
- Setup completed, current dev base `3e34c751bce898f5d2292e42cce4e6a3010a7f95`. It brought in 787 commits beyond the stale primary; inventory revalidated in the worktree.
- Plan review F1 accepted: explicitly remeasure/adapt Semaphore's silhouette-specific clips and pivots, inspecting moving and reduced-motion frames including the enlarged loader. Current collection has 27 animations.
- Plan review F2 accepted: raster/ICO regeneration is byte-deterministic for a recorded runtime; the existing OG screenshot additionally depends on Chrome/OS/fonts. Record generation order/prerequisites; validate visuals and dimensions across environments, not cross-OS byte identity.

## Selection and implementation evidence

- Both fresh-context simulated reviewers independently ranked compact candidate **03** first. [Selection, exact quotations and library decision](../investigations/261024a-spideryarn-logo-character-intent-and-selection.md); [critique record](../../assets/brand/explorations/reviews.md). The final transparent rendering is a generative cutout, not an exact extraction of the opaque candidate.
- Delegated generator uses existing `@napi-rs/canvas` plus pinned `png-to-ico` 3.0.2. It produces eleven public PNG/ICO files; the existing OG script produces the twelfth image. [Size/theme proof](../../assets/brand/preview.png). One transparent image works in both themes; opaque light/dark 1024 exports are available. Shipped install icons use ivory and 12% margin. No separately claimed maskable icon.
- Delegated Semaphore adaptation was red-first: old polygons covered only about 30% of the new upper limbs and left three foreground holes at rest. New geometry moves upper ends while excluding the book/body/other limbs. [Motion/rest proof](../../assets/brand/animation-preview.png); focused geometry tests cover actual foreground pixels. The canvas proof is not live-browser evidence.
- [Independent Sol code review](261024a-eight-limbed-reading-spider-code-review-sol.md), nonce LOGO-CODE-261024: proceed, no new findings; independent 14 focused tests and generation check passed. This was a findings-only pass over the live pre-commit candidate, so nothing was edited by the reviewer. F1/F2 are the only findings in the chain and both were addressed.
- Parent focused run: nine files, 291 tests passed, including brand, Semaphore, animation/loader, shared wordmark, social card, public pages, documentation links and auth email templates. Typecheck: all 3937 source files covered and passed. `npm run build` passed. `npm run brand:generate -- --check --preview` verified all eleven assets and the preview.
- Touched-file Biome lint exited 0: existing CSS specificity warning and existing public-shell complexity advisory, plus a test-only flood-fill complexity advisory; no errors.
- [Browser verification attempt](261024a-eight-limbed-reading-spider-browser-review.md): the Sonnet specialist had no Claude-in-Chrome tools, so no live page/theme/reduced-motion verification was possible. It changed nothing and did not substitute another automation mechanism. Static rendered proofs and unit tests are the available visual evidence.
- Full `npm test` exited 1 after 613 seconds: 1913 files passed, 165 failed, 2 skipped; 45588 tests passed, 342 failed, 1 expected failure, 1819 skipped. [Machine-readable result and complete failing-file list](261024a-eight-limbed-reading-spider-validation.json). No failing test file belongs to the logo diff. Much of the private-DB lane failed because local Auth at port 54361 refused connections: existing Kong container had been stopped for eleven days and could not restart because its email-template bind mount points into a deleted `mcp-remote-on` worktree. No production service or database was touched.
- A subagent independently reran `statusline.test.ts` and `the-ideas-extraction-changed-no-requests.test.tsx`: 15 failures and 35 passes reproduced outside the giant suite. Statusline uses GNU date flags and Bash behavior unavailable on this Mac; the Plain request trace includes extra chat/profile GETs in unchanged fetching code. Existing screenshot-guard failures concern compressor fixtures, not these brand PNGs. These are diagnosed examples, not a claim to have root-caused all 342 failures. Runtime changes are a comment-only `LogoGlyphs` change and animation CSS/blurb updates; DB/fetching/CLI/compressor logic and existing dependency versions are unchanged.
- `node --import tsx scripts/check-public-shell.ts --self-test`: 127 passed, 0 failed, including the independent favicon/robots fixture. The stale counted-files comment in robots was corrected.

Generation environment: Node 24.20.0 on macOS arm64, `@napi-rs/canvas` 1.0.8, `png-to-ico` 3.0.2, pinned Geist font from the lockfile. Social-card Chrome is selected by the existing `chromePath()` helper.

## Landing

The code review's live candidate closed as implementation commit `d3baedfe0e83cd63afdd715a5c6e83b4d024e02b`. Merge `f9bf3549bfa749d62745ab37cf5b3f27d1223d9b` brought in 46 newer `dev` commits, with no overlapping rollout files and no conflicts. Afterwards all nine focused files / 291 tests passed again; typecheck covered all 3948 source files and passed; the complete build passed again. The full-suite run above belongs to the pre-merge candidate, not the newer peer code.

`git push origin HEAD:dev` succeeded (`d629e567f..f9bf3549b`). Before this completion-note edit, `npm run worktree:check` reported SAFE TO REMOVE: commits on `origin/dev`, clean files, matching environment and fixture data/output. This completion note is a documentation follow-up to the landed implementation. The worktree is retained for inspection because the full suite and live-browser verification were not green; no ignored work is discarded. Nothing was pushed to `main` and no deployment was requested.
