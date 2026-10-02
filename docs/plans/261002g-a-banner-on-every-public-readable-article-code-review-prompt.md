You are reviewing code in the repo at the current directory (Spideryarn, an AI-assisted reading app), and you may fix what you find.

The change is commit 31f1d37c4: `git show 31f1d37c4` is the whole diff. The plan it implements is docs/plans/261002g-a-banner-on-every-public-readable-article.md (read § What the plan review changed — it overrides the decisions above it), and your own earlier plan review is docs/plans/261002g-a-banner-on-every-public-readable-article-plan-review-sol.md.

What it does: a visitor's SharedNotice (src/web/PublicChrome.tsx) now shows the article's source (published URL, or a shared upload's found source guess), a takedown offer (mailto + link to /privacy's takedown section), and a hedged no-training line linking /privacy. To show a guess for an upload, the public article payload gained `sourceGuess` via a new query `publicSourceGuessQuery` (src/store/public-reader.ts), projected by `publicSourceGuess` in src/public/dto.ts, and re-dressed for the reading view in src/web/article/access.ts.

Check in particular:
1. Security of the new public read and projection: can anything private, or any address the public policy would refuse, reach a stranger? Is publicSlug really re-asked? Can a visitor's guess trigger an owner-only request (useSourceGuess, POST /api/source-guess)? Is the guess drawn anywhere besides the banner for a visitor (Masthead OriginLine, Metadata)?
2. Correctness of the access.ts mapping and the types (exactOptionalPropertyTypes is on).
3. Is any banner sentence (src/messages.ts § BANNER_*) an overclaim against src/web/PrivacyPage.tsx or src/web/PublicReadableSharingPage.tsx? Is the owner's "what goes out" wording (SHARED_LINK_CARRIES provenance row) accurate?
4. UI: the banner reuses .origin classes from src/web/styles/shell.css inside a box with tw: classes — any layout problem (e.g. flex on the source line, narrow windows)? The banner also renders on the visitor details page (src/web/PublicPages.tsx) without a source.
5. Tests: do the new and changed tests (tests/shared-notice-banner.test.tsx, tests/source-guess-pg.test.ts, tests/public-reads.test.ts) actually fail if the behaviour regresses? Any test elsewhere that this change should have updated (grep for sourceGuess, SharedNotice, SHARED_WITH_YOU, "no guess")?

Rules: fix defects inside this change's scope directly in the working tree (do not commit, do not run git commands that change the index or branches). Run `npx vitest run <file>` for any test you touch, and `npm run typecheck`. Report anything wider than this change for me to decide. Finish with a list of findings ranked P0/P1/P2, each with file:line, and for each say whether you fixed it.
