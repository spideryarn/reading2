# Plan review: pictures in Help (261007l)

You are reviewing a plan before it is built, read-only. Repo: Spideryarn (TypeScript, React, Vite,
Vitest). Skim AGENTS.md/CLAUDE.md for house rules.

Read:
- docs/plans/261007l-help-screenshots-and-gifs.md — the plan under review
- docs/project/help-page.md — what owns Help
- src/web/help/help-markdown.tsx, src/web/help/help-pages.ts, src/web/help/HelpPage.tsx (WORDS_CLASS)
- src/web/shots.ts and tests/landing-assets.test.ts — the existing screenshot manifest pattern
- docs/project/marketing-pages.md § Shooting a screenshot of the product
- the Vite and Vitest configs, to check `import.meta.glob(..., { query: "?url", eager: true })`
  works in both the browser build and Vitest for files under src/web/help/pages/images/

Another session's corpus generator, not yet on dev, is on the local branch
`worktree-fbucftjt-help-chatbot`, file tests/help-corpus.test.ts (read it with a git show of that
branch).

Questions, answered with file:line evidence:
1. Is the Markdown form (image alone in a paragraph, title = caption, relative path) sound with
   mdast-util-from-markdown? Any parsing trap (a title with quotes, an image in a list item, a
   paragraph holding an image plus a soft break)?
2. Is the glob + manifest + test design right, or is there a simpler shape with the same
   guarantees? Would anything in the server bundle or that corpus generator break?
3. The GIF dependency choice (gifenc + pngjs devDependencies vs ffmpeg vs <video>): any reason to
   prefer differently?
4. Anything that would make this silently succeed while doing nothing (an image the test never
   sees, a check that cannot fail)?
5. Anything missing in the docs update for "Help keeps its pictures up to date from here on"?

Number your findings P1, P2, … with severity, and end with one line:
`VERDICT: ready` or `VERDICT: changes needed`.
