1. **P1 — The timing guard silently ignored computed staggers.** Pluck’s 2800ms hold did not complete two loops for all delayed letters. I made loader-only Pluck finite, changed its hold to 3106ms, and replaced the regex parser with one covering calculated delays, pseudo-elements, shorthand delays, and nested `@supports` rules. The guard was proven red against both Pluck and a temporary Radius duration mutation. [LogoLoader.tsx:54](src/web/LogoLoader.tsx:54), [logo-animations.css:283](src/web/styles/logo-animations.css:283), [logo-loader.test.tsx:251](tests/logo-loader.test.tsx:251)

2. **P2 — Reduced-motion subscription was incomplete.** The inline subscriber resubscribed on every track render, old Safari’s `addListener` API was unsupported, and server rendering threw without `getServerSnapshot`. I added stable subscription/snapshot functions with legacy, no-`matchMedia`, and SSR fallbacks. [LogoLoader.tsx:119](src/web/LogoLoader.tsx:119), [logo-loader.test.tsx:435](tests/logo-loader.test.tsx:435)

3. **P2 — The track lifecycle had two latent gaps.** A pool of one could not restart the same class, and timers did not strictly prove that the resting glyph had painted before Settle began. I added a short rearm rest for one-item pools and an animation-frame paint barrier. StrictMode, unmount, `on` changes, and timer cleanup are covered. [LogoLoader.tsx:81](src/web/LogoLoader.tsx:81), [LogoLoader.tsx:152](src/web/LogoLoader.tsx:152), [logo-loader.test.tsx:337](tests/logo-loader.test.tsx:337)

4. **P3 — `/design` contradicted the implementation and exposed a fictional wait label.** It still described a fixed 2.4-second cadence. I corrected the copy and made the live specimen decorative; the article loader retains hidden descriptive text without adding a duplicate live region. [DesignPage.tsx:1224](src/web/DesignPage.tsx:1224), [LogoLoader.tsx:183](src/web/LogoLoader.tsx:183)

Edited files:

- `docs/project/design-logo.md`
- `docs/project/loading-spinner.md`
- `src/web/DesignPage.tsx`
- `src/web/LogoLoader.tsx`
- `src/web/styles/logo-animations.css`
- `tests/logo-loader.test.tsx`

Checks: requested Vitest command passed, 78/78 tests. `npm run typecheck` was attempted but the sandbox forbids tsx’s `/tmp` IPC socket; running the same script directly with `node scripts/typecheck.ts` passed all four TypeScript projects and coverage. No commit made.

**Verdict: P1/P2 defects fixed; ready to commit after reviewing this six-file diff.**