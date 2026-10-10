1. **P2 — [logo-animations.css:1187](/var/tmp/spideryarn-worktrees/fbaxbxr8-more-logo-animations/src/web/styles/logo-animations.css:1187): Played Dead could inherit Settle’s exiting transform.** Independent `translate`/`rotate`/`scale` properties composed with Settle’s 220ms transition during a rapid re-hover. Changed Played Dead to animate one consistent `transform` list and added a regression test at [logo-animation.test.tsx:243](/var/tmp/spideryarn-worktrees/fbaxbxr8-more-logo-animations/tests/logo-animation.test.tsx:243).

2. **P2 — [design-logo.md:323](/var/tmp/spideryarn-worktrees/fbaxbxr8-more-logo-animations/docs/project/design-logo.md:323): the rule described reduced motion as freezing the animation.** The global guard actually finishes a shortened animation, after which base style and fill mode determine the still. Corrected the rule, including the distinction between a loader boundary and a hover cut off mid-gesture.

3. **P3 — [DesignPage.tsx:1689](/var/tmp/spideryarn-worktrees/fbaxbxr8-more-logo-animations/src/web/DesignPage.tsx:1689): stale gallery copy.** It still said fourteen animations and claimed half were one-shots. Updated it to twenty-seven and “some”.

4. **P3 — [logo-animations.css:973](/var/tmp/spideryarn-worktrees/fbaxbxr8-more-logo-animations/src/web/styles/logo-animations.css:973): most new blocks omitted their required reduced-motion outcome.** Added the actual resting result to each affected block. All thirteen finish visually at rest; Semaphore uses its accepted reconstructed resting spider.

5. **Info — audited without further changes.** Loader counts and holds are correct; every tracked 100% frame is neutral. The `evenodd` gate, zero-percent `color-mix()`, and per-element custom properties parse correctly. Magnifier, Semaphore, Radius Sweep, and Dragline cannot share a host simultaneously because the mark track exposes one ID at a time.

Checks: 66 focused tests passed; the TypeScript driver passed for 620 files. `npm run typecheck` itself was blocked by the sandbox’s `tsx` IPC socket (`EPERM`), so the same driver was run successfully with `node --import tsx`. CSS parsed with zero warnings. Lint only reported existing out-of-diff findings at `DesignPage.tsx:1394` and `logo-animations.css:236`.

Verdict: **approve after these fixes; no remaining functional findings.**