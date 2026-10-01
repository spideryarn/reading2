You are reviewing a plan, read-only, in the repo at the current directory (Spideryarn). Read CLAUDE.md first.

The plan: docs/plans/261001q-logo-loading-spinner.md — replace the article page's "Fetching the article and its summaries…" text with an animated logo loader that reuses the thirteen wordmark hover animations.

Read alongside it: src/web/logo-animation.ts, src/web/LogoGlyphs.tsx, src/web/styles/logo-animations.css, tests/logo-animation.test.tsx, src/web/article/ArticlePage.tsx (the `loading` branch), src/web/useSlow.ts, docs/project/design-logo.md, docs/project/icons.md § The loading spinner, src/web/Library.tsx § ShelfWordmark, src/web/DesignPage.tsx § LogoAnimations.

Check especially:
1. Is the mark/letters partition right? Read each animation's actual selectors and keyframes. Will two classes (one mark-track id, one letters-track id) on the same host really not fight — including pseudo-elements, transitions (spya-settle, spya-i, spya-seam), fill modes, `.spya-anim` base rules, and the site-wordmark-specific rules?
2. Does switching an animation class on a live element restart/transition correctly (e.g. a one-shot animation followed by another one-shot on the same element; a transition-based one followed by a keyframe one)? Anything that would visibly snap or stall?
3. Reduced motion, accessibility, and the "must not delay first paint or the article" requirement.
4. Anything simpler that gets the same result, and anything the plan misses (other places, docs ownership via tests/doc-links.test.ts).

Answer with numbered findings, each with a severity (P0–P3), the evidence (file:line), and the fix. End with a one-line verdict.
