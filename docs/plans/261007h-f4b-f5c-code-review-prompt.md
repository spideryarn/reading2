# Code review: 261007h F4b + F5c (signed-out bar on document pages; fade-ins reveal once)

**Candidate:** commit `143fdb199` in worktree `/var/tmp/spideryarn-worktrees/fbrgq3f6-design-consistency`.
`git show 143fdb199 --stat` lists every changed path; start with `src/web/DocumentPage.tsx`,
`src/web/reveal-once.ts`, `src/web/SiteBits.tsx`, `src/web/BackLink.tsx` and `src/web/styles/site.css`,
but that list does not limit scope. **Another builder is working in this worktree on a different
family (loading lines in the reading-view panels); uncommitted changes in other files are theirs —
ignore them and do not touch them.**

**Spec:** `docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md`
§ F4 (the signed-out bar), § F5 (fade-ins), and § "What GPT Sol's plan review changed" (R13, R14,
R16). Docs touched: `docs/project/marketing-pages.md`, `docs/project/website-text.md` — review them
as a reviewer of the claims, not only of the code.

## What to do

You may write. **Fix what is inside this family**, narrowly and red-first (a test that fails
before your fix), and **report, do not fix**, anything wider. Do not commit. Write your findings to
the answer file first, then make fixes, then update the answer with what you changed.

Independent pass first:

1. Signed-in vs signed-out: can a signed-in reader ever see the bar, or a signed-out one see no way
   home? Is `SignedInShell` really decided before first render on all five routes, including a
   direct load and a client-side move?
2. Layout: the bar's sticky behaviour inside a `display: contents` wrapper; top padding and
   safe-area inset (`--safe-top`) on a notched phone signed out; `floor` heights; Help's sticky
   contents column and anchor offsets; `/privacy` not linking to itself; `SITE_NAV_ROUTES` and
   corner Feedback unchanged for signed-in readers.
3. reveal-once: any path that leaves a section hidden forever (late-rendered sections, a section
   above the window at start, back/forward cache, a route change mid-transition, `stop()` racing
   the observer, print, reduced motion changing at runtime); leaks across client-side navigation;
   the MutationObserver's cost on a long page.
4. Tests: does each new test fail if the behaviour it names is removed? Run
   `npx vitest run tests/reveal-once.test.ts tests/home-link-only-without-the-corner-logo.test.tsx tests/back-link.test.tsx tests/dock-corner-controls.test.tsx tests/site-nav-sign-in.test.tsx`
   yourself.
5. Docs: does anything in marketing-pages.md, website-text.md or /help (src/web/help/) now say
   something false?

## Severity

P0 data loss / security / charging / broadly unusable · P1 user-visible wrong behaviour or a
contract violated · P2 design or maintainability risk · P3 prose. IDs `C1`, `C2`, …. Refuse only
on an established P0 or P1.

## My own suspicions (worth less)

- The `top < innerHeight` test in `take` marks a section above the window as shown — intended?
- `tw:contents` on the `.site` wrapper: does any `.site` rule rely on `.site` being a box?

End with `VERDICT: ready` / `VERDICT: ready with these fixes` / `VERDICT: not ready`, and a list of
files you changed.
