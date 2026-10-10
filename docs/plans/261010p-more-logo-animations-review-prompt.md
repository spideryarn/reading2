Review this plan before it is built: docs/plans/261010p-more-logo-animations.md (thirteen new CSS animations for the Spideryarn wordmark). Read-only: do not edit any file.

Context to read: docs/project/design-logo.md (the rules and five silent failure modes), docs/project/loading-spinner.md § The wordmark loader, src/web/styles/logo-animations.css, src/web/logo-animation.ts, src/web/LogoLoader.tsx, tests/logo-animation.test.tsx, tests/logo-loader.test.tsx. The longlists and brief are docs/plans/261010p-more-logo-animations-*.md (one of them is yours).

Please look hard at:
1. Whether each of the thirteen can be built under the stylesheet's rules (no box change, rest at 100%, resting transforms on pseudo-elements, --wordmark-ink at keyframe ends, --logo-px for letter lengths, class-driven) and whether any one would silently do nothing in one of the hosts (corner HomeLogo, Dock's 40px clipping bar, shelf heading, marketing Wordmark with "Reading" after it, the 2.2x loader).
2. Loader compatibility: does each tracked one keep to its half, and can its hold be expressed so tests/logo-loader.test.tsx's timing reader (literal or calc(var(--i) * Xms + Yms) delays only) can verify it? Is anything a held pose that would snap?
3. The selection as a set: duplicates with the existing fourteen or each other, anything likely to look broken to a stranger, anything you would swap for a near-miss.
4. Specific risks: Semaphore's clip-path approach on the PNG; In Quotes' opening quote vs the spider and closing quote vs "Reading"; Cross-reference's arc width in em; Played Dead's individual rotate property vs other transforms on .logo-image (e.g. the resting .logo-image transition, Settle); Hop's 7px upward travel in the dock; Pacing's scaleX(-1) on a non-symmetric PNG.
5. Anything missing from the test/doc changes listed.

Write findings as a numbered list, most important first, each with severity (blocker / should / nit) and a concrete fix. End with a one-line verdict.
