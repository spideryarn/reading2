# Plan review: Help back in the bar, and Help as Markdown pages (261007e)

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

- The plan: `docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md`
  (untracked, in this worktree; base commit `67a6b9cb88441e3ccd92f06d7b486e7f810dca57`).
- What it changes, to read as you see fit (this list does not limit scope):
  `src/web/help/` (all seven files), `src/web/router.ts` (§ `STATIC_ROUTES`, `parseRoute`, `HELP_HREF`),
  `src/web/App.tsx` (the two `help` arms), `src/web/Dock.tsx` (§ `DockHelp`, `helpHrefFor`),
  `src/web/CommandBar.tsx` (the Help row), `src/web/BandAbout.tsx`, `src/web/Cited.tsx` (the existing
  mdast walker), `src/web/page-title.ts`, `src/web/page-search.ts`, `src/site-pages.ts`, `vercel.json`,
  `tests/help-page.test.tsx`, `tests/dock-help-link.test.tsx`, `tests/site-pages.test.ts`,
  `tests/client-imports.test.ts`, `docs/project/help-page.md`, `docs/project/overseer.md` § Deploying,
  `docs/project/mode.md`.
- The request it answers is quoted at the top of the plan. It is from the product's owner, so
  whether to build it is settled; how is what is under review.

## What to do

Make an independent pass first: attack the plan as a design. Will it work in this codebase, is
anything it asserts about the code false, what breaks that it does not mention, and is there a
simpler shape that gives the reader the same thing? Check its claims against the source rather than
taking them from the plan. You may run `npx vitest run tests/help-page.test.tsx` (it needs nothing
outside the tree).

Then answer these, which are mine and worth less than what you find yourself:

1. `?raw` imports of `.md` under `src/web/help/pages/`: any trap in this repo's typecheck, Vite
   build, vitest, `tests/client-imports.test.ts`, or the import-graph checks?
2. `/help/<segment>` in `router.ts` and on Vercel (`vercel.json` rewrites, the `noindex` header
   source, `scripts/check-public-shell.ts`): does a direct load of `/help/spine` reach the shell
   and draw, signed out? Does anything refuse it?
3. Old links: `/help#spine`, `/help#mode-trajectory`, `/help#faq-older-profile`. Is a client-side
   replace enough, and is there any caller that builds a Help address without `helpHref`?
4. Is one page per topic and per mode the right grain, or would you group differently?
5. Does the deploy step in `docs/project/overseer.md` § Deploying, step 4, still hold as the plan
   claims, without an edit to `overseer.md`?
6. The plan defers listing `/help/<page>` in search engines. Is that deferral safe to ship, or does
   something (the sitemap, `check-public-shell.ts`) go red?

## Severity, and the verdict

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (`R1`, `R2`, …), its severity, the evidence (file and line), and what you
would change in the plan. Say for each whether it is **established** (direct evidence) or
**reasoned**. End with one line: `VERDICT: ready` / `ready with changes` / `not ready`. Refuse only
on an established P0 or P1.
