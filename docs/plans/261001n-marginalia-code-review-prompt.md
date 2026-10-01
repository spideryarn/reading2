# GPT Sol code review: 261001n (Annotations → Marginalia rename)

You are reviewing the commit 4849b82f5 in this worktree (the current directory), and you may FIX what
you find inside its scope: edit files, then run `npm run typecheck` and the affected test files with
`npx vitest run <files>`. Do not commit, push, or run any git command that changes the tree or
history. Report anything wider than the rename for me to decide rather than fixing it.

Read: docs/plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md
(§ Stage 2 is the spec, incl. "What does not change"), your own plan review
docs/plans/261001n-marginalia-plan-review-sol.md, and the diff
docs/plans/261001n-marginalia-code-review.diff (src + tests; the docs are in the commit too:
`git show 4849b82f5 -- docs AGENTS.md`).

Check especially:

1. `?mode=marginalia` and `?mode=annotations` behave identically in every path: the Reader's arrival
   rewrite, the Dock's link canonicalisation (withMargin, modeLinkHref), rememberableSearch,
   marginInSearch, the server title (readMode/documentTitle), visitor/public paths, the command bar.
   Does any path still compare to a literal instead of `isMarginaliaModeWord`?
2. Anything a reader sees that still says "Annotations" (labels, aria, tooltips, herald, command bar,
   owner notes, visitor copy, CSS `content:`).
3. Did any unrelated "annotation" sense get renamed by mistake (annotate.ts, annotations.css,
   OpenRouter url_citation annotations, MathML)?
4. Tests: do the new marginalia mirrors really exercise the new path (could they pass with the old
   code)? Is the visitor arrival test — which checks the URL and the Dock toggle, not the column —
   adequate?
5. Are the docs under docs/project accurate after the rename (reading-view-overview, url-state,
   mode.md § Retiring a mode exception, narrow-windows, experimental-features, interface-vision)?

Report: findings P0/P1/P2 with file:line, what you fixed (with the tests you ran), and what you left
for me. End with a verdict line: "land" / "land after fixes" / "do not land".
