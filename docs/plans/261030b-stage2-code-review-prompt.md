You are reviewing CODE in this repository, write-capable: fix what you find inside this stage, and report anything wider for me to decide. Read CLAUDE.md first for house rules. Do not commit, push, deploy, or touch any database other than the test databases the suite mints itself.

The plan: docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md (§ On screen, and § Stages → Stage 2). Stage 1 (the server step, src/sources-digest.ts) was reviewed already: docs/plans/261030b-stage1-code-review-sol.md.
The diff under review: `git show ea1959879` (commit "Sources digest stage 2: the Digest chip and its panel"). Centre: src/web/SourcesDigestPanel.tsx, src/web/useSourcesDigest.ts, tests/sources-digest-panel.test.tsx, src/web/modes/sources/SourcesMode.tsx, src/web/params.ts, src/web/sub-modes.ts, src/web/activation.ts, src/web/auto-run-targets.ts, src/web/help/pages/modes/sources.md. A Sonnet browser pass is running at the same time; it does not edit code.

Review independently for:
1. Opening it is the request (docs/project/sources.md § Opening it is the request; how Where it sits does it: src/web/useSituate.ts, src/web/useWhereAutoRun.ts): only a press of the chip or the command-bar row starts a ~$1 run; link, Back, reload, restore, StrictMode double mount, another tab already running, a stored (stale/outdated) digest — none start one. Can any path start two runs, or loop?
2. Owner-only: can a visitor (shared/public read, view-as) ever request /api/sources-digest/:slug or see a digest chip? Is the experimental switch threaded so switch-off hides the chip (and command-bar row) but a pasted ?sources=digest still draws it?
3. Rendering untrusted text: model prose, strangers' quotes, titles and URLs — any raw HTML, unsafe href (javascript:, data:), or missing rel/target on links out? Fonts per docs/project/fonts.md.
4. Sentences as BlockRefs (the on-screen lighting is shared code, docs/project/summaries.md § Each sentence is a door too); ids that are not in the article; empty sections; nothing-found; stale banner.
5. Controls that do the same job look the same (docs/project/controls.md); reuse of shared components rather than copies (docs/project/web-client.md § Shared code (client)); mode.md registration sites.
6. Anything else false, fragile, or simpler.

Severity: P0 data loss / exploitable security / incorrect charging / broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability; P3 prose. Give each finding an ID (SD2-01 …), severity, file:line evidence, and either "fixed" (what you changed, and a test seen red then green where it is behaviour) or "not fixed, for you" (the concrete change). Run typecheck (`node --experimental-strip-types scripts/typecheck.ts` if `npm run typecheck` cannot start in your sandbox) and the tests you touch after any fix, and report the results.

Write your findings first to docs/plans/261030b-stage2-code-review-sol.md, then end with a one-line verdict: approve / approve with changes / revise.
