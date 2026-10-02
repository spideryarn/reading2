You are reviewing a plan, read-only, in the repo at the current directory (Spideryarn, an AI-assisted reading app). The plan is docs/plans/261002g-a-banner-on-every-public-readable-article.md. Read it first, then check its claims against the code it names:
src/web/PublicChrome.tsx (SharedNotice), src/web/reader/Reader.tsx (where SharedNotice and Masthead mount), src/web/Masthead.tsx (OriginLine, GuessedSourceLink, guessTip), src/web/article/access.ts (sourceGuess blanked for the public arm), src/store/public-reader.ts and src/store/public-slug.ts, src/public/dto.ts (publicMeta), src/public-types.ts, src/urls.ts (publicSourceUrl, safePublicCanonical), src/store/source-guess-row.ts, src/web/useSourceGuess.ts, src/web/PrivacyPage.tsx (training paragraph and takedown section), src/web/PublicReadableSharingPage.tsx, src/web/PublicPages.tsx, src/messages.ts (SHARED_WITH_YOU, TAKEDOWN_*), docs/project/public-readable-sharing.md, docs/project/security-map.md, docs/plans/260929g-canonical-link-for-an-uploaded-paper.md.

What I want from you:
1. Is anything in the plan false about the code? Quote the line.
2. Security: the plan publishes a guessed source URL for an uploaded paper to strangers. Is the proposed projection (publicSourceUrl, own query under publicSlug, only url/host/kind) safe? Anything else that can leak (e.g. host field not derived from the published url, a guess written for a previous revision, a private host)?
3. Is any banner sentence an overclaim against /privacy or the sharing page? Is the no-training wording right? Is the takedown wording right?
4. Is moving the visitor's origin line out of the masthead into the banner a good call, or does it break something (tests, narrow-window hiding where the banner is hidden but the masthead is not, etc.)? Check styles for .shared-notice hiding rules.
5. Anything simpler that gives Greg what he asked for.
Rank findings P0/P1/P2, each with the file:line evidence. Do not edit any files.
