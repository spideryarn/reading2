FIXED

1. [ArticlePage.tsx:154](/var/tmp/spideryarn-worktrees/fbmdmqqq-logo-twice-on-open/src/web/article/ArticlePage.tsx:154) and [dock-corner-controls.test.tsx:33](/var/tmp/spideryarn-worktrees/fbmdmqqq-logo-twice-on-open/tests/dock-corner-controls.test.tsx:33) still described every no-Dock/loading state as retaining a corner home control. Updated the route descriptions and error/loading comments to document the deliberate loading exception.

2. [HomeLogo.tsx:34](/var/tmp/spideryarn-worktrees/fbmdmqqq-logo-twice-on-open/src/web/HomeLogo.tsx:34), [dock.css:772](/var/tmp/spideryarn-worktrees/fbmdmqqq-logo-twice-on-open/src/web/styles/dock.css:772), and [web-client.md:62](/var/tmp/spideryarn-worktrees/fbmdmqqq-logo-twice-on-open/docs/project/web-client.md:62) contained brittle or overbroad page inventories. Corrected them to distinguish loaded views, loading, and the no-Dock stand-ins accurately.

3. [article-loading-one-wordmark.test.tsx:7](/var/tmp/spideryarn-worktrees/fbmdmqqq-logo-twice-on-open/tests/article-loading-one-wordmark.test.tsx:7) claimed the test held a network request open, but it actually fixes the access hook at `loading`. Corrected the description. The test is effective: temporarily restoring `<HomeLogo />` made both cases fail with one `.logo-home`; restoring the fix makes them pass.

4. `HomeLogo` remains used by the error branch at [ArticlePage.tsx:213](/var/tmp/spideryarn-worktrees/fbmdmqqq-logo-twice-on-open/src/web/article/ArticlePage.tsx:213). No CSS, page-title, focus, test, or e2e dependency on `.logo-home` during article loading was found.

Checks:

- Focused Vitest: 55 passed; only the two declared `/read/public` fixture failures remain.
- Typecheck logic passed via `node --import tsx scripts/typecheck.ts`, covering all 3,561 source files. Literal `npm run typecheck` cannot start because the sandbox rejects `tsx`’s Unix socket with `EPERM`.
- Scoped Biome lint and `git diff --check`: clean.
- Full `npm test`: blocked before collection because the local database/Docker port is inaccessible in this environment.