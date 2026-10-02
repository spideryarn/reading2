You are GPT Sol doing the CODE review of plan docs/plans/261002b-bring-the-signed-out-home-page-features-and-design-up-to-date.md in the Spideryarn repo. Your plan review is docs/plans/261002b-homepage-plan-review-sol.md; check its findings were honoured.

Scope: `git diff 886812f5a..HEAD` (commits 7e2066dc8..HEAD on this branch). Files: src/web/LandingPage.tsx, src/web/FeaturesPage.tsx, src/web/SiteBits.tsx, src/web/styles/site.css, src/web/shots.ts, src/web/assets/*.png, src/web/DesignPage.tsx, tests/features-page-modes.test.tsx, tests/landing-page-tiles.test.tsx, tests/marketing-public-sharing.test.tsx, tests/helpers/marketing-page-render.ts, tests/annotate.test.ts, tests/eager-client-graph.test.ts, docs/project/website-text.md, docs/project/marketing-pages.md.

You may FIX what you find inside this scope (workspace-write). Do not commit, do not run git commands that change history or the index, do not touch files outside this scope; report anything wider for me to decide. Do not run `npm run check` (26 minutes). You may run `npx vitest run <files>` and `npm run typecheck`.

Check, against the CODE (not the docs):
1. Every NEW or changed sentence on / and /features: is it TRUE now (verify against src/ — e.g. Structure's Fisheye/Expanded, Skim's three passes and cue, Citations' orders, Marginalia's contents, FAQ rating/threshold, Debate themes, Tweets auto-generation and block links, cross-references preview, maths, Quiz up to twenty "each building on the one before", public sharing = comments and searches go, chats and profile do not (src/public/dto.ts, PrivacyPage.tsx))? And is its provenance comment honest (Greg's words exist where it says; product facts point at real code)? Rule: docs/project/marketing-pages.md § The copy is not yours to write; docs/project/positioning.md § Whose words.
2. The Experimental tag: correct for every tile (MODE_CATALOG), accessible (is the tag read sensibly by a screen reader, does it break the tile's heading), no visual regression at 390px widths in the CSS.
3. Tests: can each go red for the right reason? Any that would pass on a broken page?
4. /design: the specimens are real components; the inert switch panel truly cannot write to the server (HighPowerSwitch PUT, SettingsSection) — check `inert` covers keyboard and programmatic paths that matter; the SPECIMEN_OUT strings match annotateHtml; eager-client-graph additions are justified (nothing heavy pulled into the eager bundle).
5. shots.ts: sizes match the PNGs (tests/landing-assets.test.ts), alt text describes each picture (you may open the PNGs).
6. Anything else wrong: dead imports, stale comments that now lie, a11y regressions.

Write numbered findings with severity (P0/P1/P2), file:line, what you fixed (if anything) and what you left for me. Be concise.
