You are reviewing a PLAN (not code) in the Spideryarn repo, read-only. Plan: docs/plans/261002b-bring-the-signed-out-home-page-features-and-design-up-to-date.md

Context: two admin requests from Greg ("Update the non-logged-in homepage and Features pages"; "Update /design"). Files: src/web/LandingPage.tsx, src/web/FeaturesPage.tsx, src/web/SiteBits.tsx, src/web/shots.ts, src/web/DesignPage.tsx, src/mode-catalog.ts, src/modes.ts, src/web/PrivacyPage.tsx, src/public/dto.ts. Rules that bind the copy: docs/project/marketing-pages.md (§ The copy is not yours to write; claims checked against code), docs/project/positioning.md § Whose words, docs/project/website-text.md.

Please check, against the CODE:
1. Is every "what is wrong now" claim actually true? Especially: the public-sharing contradiction (do public articles really carry the owner's comments and searches? chats?), which modes are experimental, MAX_QUESTIONS, Outline/Hierarchy retirement.
2. Is the design of the experimental tag sound (SiteBits components reading MODE_CATALOG; is mode-catalog importable from the browser bundle — check tests/client-imports.test.ts and any allowlist)? Is "every Mode in MODES appears on /features" the right invariant (what about plain, chat, marginalia — is chat already on the page under another name)?
3. Copy-provenance risks: any proposed new sentence that would be agent-drafted rather than Greg's words / product fact?
4. Is the scope the simplest version that satisfies Greg, and is anything important missing or anything that should be cut? Are the deferrals honest (does any deferred item leave something FALSE on the pages)?
5. Any test proposed that cannot go red, or would pass for the wrong reason?
Give numbered findings with severity (P0/P1/P2), file:line evidence, and a concrete fix each. Be concise.
