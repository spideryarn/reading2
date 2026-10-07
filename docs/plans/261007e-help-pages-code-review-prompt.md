# Code review, fixing: Help back in the bar, and Help as Markdown pages (261007e)

You are reviewing **and fixing** a finished piece of work in this worktree. Read
`docs/reusable/codex-cli-as-subagent.md` § "The house workflow" for the rules of a fixing review:
fix what is inside this work, narrowly and red-first; report, do not fix, anything wider.

## The candidate

Base `67a6b9cb88441e3ccd92f06d7b486e7f810dca57`. The work is exactly these commits, in order:

- `1cc8dfec6` 261007e S1: Help is back in the bottom bar for everybody
- `c1c607a4f` 261007e S2a: Help's words move to 46 Markdown files, checked against the old ones
- `c86510187` 261007e S2b: Help is a contents page and a page per topic, mode and guide
- `aa044ee7c` 261007e S3: help-page.md and mode.md describe Help as pages of Markdown

Changed paths: `git diff --stat 67a6b9cb8 aa044ee7c` (no other work is in the range). Start with
`src/web/help/` (`HelpPage.tsx`, `help-anchors.ts`, `help-pages.ts`, `help-markdown.tsx`,
`help-content.tsx`, `help-front-matter.ts`), `src/web/router.ts`, `src/web/page-search.ts`,
`src/web/command-match.ts`, `src/feedback-page.ts`, `public/robots.txt`,
`scripts/check-public-shell.ts`, `src/web/Dock.tsx` (`DockHelp`), then the Markdown under
`src/web/help/pages/` (especially the four new `guides/*.md`) and the tests. This does not limit
scope.

The plan, with GPT Sol's plan review (R1 to R7) and what landed, is
`docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md`.
Read it as a reviewer of its conclusions too.

## What to do

Independent pass first. Attack it: wrong behaviour a reader can reach (a link that lands nowhere,
an old address that no longer lands, Back/Forward misbehaving, a page that throws, search that
misses, the questions page's fragments, a signed-out visitor), anything a test claims but does not
check, anything that makes a future edit easy to get wrong. Run tests yourself:
`npx vitest run tests/help-page.test.tsx tests/help-markdown.test.tsx tests/page-search.test.ts
tests/feedback-page.test.ts tests/command-pick-catalogue.test.ts tests/router.test.ts
tests/site-pages.test.ts tests/dock-help-link.test.tsx` need nothing outside the tree.

**The guides are published copy, written new.** Their rule: a guide states no product fact that
another Help page (or a mode's `MODE_CATALOG` description / how in `src/mode-catalog.ts`) does not
already state. Check each guide's sentences against those pages; a guide sentence with no backing
is a P1 (it tells a reader something unchecked). Fix by narrowing the sentence, never by adding
facts.

Then, mine, worth less: (a) R5 — is keying arrival on the resolved view enough when the same page
is reached twice with different fragments on `/help/questions`? (b) does anything still build a
Help address by hand? (c) is the click capture on `/help/questions` safe for modified clicks and for
links to a question from another page? (d) the tab title for `/help` must equal `src/site-pages.ts`'s
for `/help`.

## Severity, and the verdict

P0 data loss, exploitable security, incorrect charging, or the service broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk with no wrong behaviour today; P3 prose or comment. ID every finding (C1, C2, …), give the
evidence and whether it is established or reasoned, and say for each whether you fixed it (with
which test, red first) or are only reporting it. Do not commit. End with one line:
`VERDICT: ready` / `ready after its fixes` / `not ready`.
