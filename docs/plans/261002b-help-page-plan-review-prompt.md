# Plan review: 261002b, a Help page

You are reviewing a PLAN, read-only, in the repo at the current working directory (Spideryarn, a
reading app; React client in src/web). The plan is `docs/plans/261002b-help-page.md` (untracked file
in this worktree). Read it, then check it against the code it names: src/web/PageContents.tsx,
src/web/page-search.ts, src/web/BandAbout.tsx, src/web/Tooltip.tsx, src/web/Spine.tsx,
src/web/SiteFooter.tsx, src/web/router.ts, src/web/App.tsx, src/web/CommandBar.tsx,
src/web/ChangelogPage.tsx (its contents list and why it is not PageContents), src/modes.ts,
src/mode-catalog.ts, docs/project/tooltips.md, docs/project/mode.md, docs/project/overseer.md
§ Deploying, docs/project/changelog.md.

Questions, most important first:
1. Is there a simpler design that gets most of the value? Is anything here over-built for v1, or
   anything Greg asked for missing (his words are quoted at the top)?
2. Reusing PageContents with a synonyms prop and an opt-in `fragmentLinks` mode: sound, or does it
   give one component two jobs (ChangelogPage.tsx argued that once)? Concretely what breaks?
3. Arriving at /help#anchor on a lazily-loaded SPA page: what goes wrong (router handling of hash,
   scroll restoration, the app's own scroll code), and what is the robust way?
4. The (i)-is-the-link approach given pointer-events:none cards and open-questions.md Q10. Is a
   second icon in each band's corner a mistake? Better placement?
5. Keeping it current: is `Record<Mode, HelpSection>` + a pinned anchor test + a non-gating deploy
   step the right weight? Would a gate be better or worse?
6. Anything in the content plan that would mislead readers or be unmaintainable.

Severity scale: P0 (wrong/harmful, must change), P1 (should change before building), P2 (worth
doing), P3 (nit). Give each finding an ID (R1, R2, ...), the severity, file:line evidence where it
applies, and a concrete recommendation. Keep it under 1200 words. End with a one-line verdict.
