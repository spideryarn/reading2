You are GPT Sol, reviewing a plan before it is built. Read-only review: do not edit files.

Repo: this worktree (Spideryarn, an AI-assisted reading app). The plan is
docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md — read it first, then check
its claims against the code: src/tweets.ts, src/web/Tweets.tsx, src/web/PublicPages.tsx,
src/types.ts (Tweet, TweetThread), src/models.ts (ARTICLE_RENDERER), src/source-hash.ts,
src/pipeline.ts (the tweets step), src/public/dto.ts, src/web/layout.ts (BandShape, bandWidth),
src/web/router.ts (parseRoute, settleAddress, liftLegacyAbout), src/read-address.ts,
src/web/useAutoRun.ts, src/web/last-view.ts, src/web/shared-inventory.ts, src/web/Dock.tsx,
src/web/CommandBar.tsx, and docs/project/new-mode.md (the checklist for adding a mode). The FAQ mode
(src/faq.ts, src/web/useFaq.ts, src/web/modes/faq/) is the closest precedent.

What I would least like to be wrong about:

1. The version-aware isStale: does switching the fingerprint to articleWithIdsFingerprint for new
   threads, while old (pre tweets/5) threads keep being compared with articleFingerprint, actually
   keep every existing stored thread from being reported stale — through BOTH the GET /api/tweets
   route (loadTweets in src/store/pg.ts) and the pipeline step's stamp/skip logic? Is there any other
   reader of sourceHash (public DTO, export, sharing) that would disagree?
2. The redirect from /read/<slug>/tweets to ?mode=tweets: does settleAddress run early enough
   (before parseRoute decides not-found) for owner and visitor, SPA navigation and a hard load
   (vercel.json rewrites)? Anything server-side (src/public/page-head.ts, page.ts) that must change?
3. Dropping useAutoRunOnArrival for useAutoRun: is anything lost that Greg asked for (260915e)?
4. Anything the plan misses in new-mode.md's checklist or in the visitor/sharing path.

Also say if a simpler shape would get most of the value. Output: numbered findings, each with
severity (must-fix / should-fix / nit), file:line evidence, and the change you propose. End with a
one-line verdict.
