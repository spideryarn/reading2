# Code review: pictures in Help (261007l)

You are reviewing the code built from a plan you reviewed earlier, in the worktree you are running
in. Per house rules (AGENTS.md, docs/reusable/codex-cli-as-subagent.md § The house workflow):
**fix what you find inside this change**, keep fixes small and in the existing style, and report
anything wider for me to decide. Run no git command that commits, resets, stashes or checks out;
just edit the working tree.

The plan and your plan review: docs/plans/261007l-help-screenshots-and-gifs.md (its last section
says what came of each finding), docs/plans/261007l-help-screenshots-plan-review-sol.md.

The change is the two commits on top of origin/dev: read them with a git diff of origin/dev...HEAD
(skip the binary images). The parts that matter:

- src/web/help/help-markdown.tsx — `figureOf`, `HelpFigure`, the `image` cases in both walks
- src/web/help/help-images.ts — the manifest
- tests/help-images.test.ts, tests/help-markdown.test.tsx (the new cases), tests/helpers/image-size.ts
  and its use in tests/landing-assets.test.ts
- scripts/frames-to-gif.ts, scripts/gifenc.d.ts, package.json (gifenc devDependency)
- docs/project/help-page.md § Pictures and § Bringing it up to date
- the image lines added to src/web/help/pages/**/*.md — check each caption and alt against the page
  around it and, where you can, the code: a caption that states something untrue about the product
  is a defect (Help's rule: a fact that could not be checked is left out, not guessed)

Look especially for: anything that succeeds silently (a check that cannot fail, an image the test
never sees); the `<picture>`/`<source>` reduced-motion fallback actually working in browsers (an
`<img>` inside `<picture>` with `srcset` on the source and `src` on the img); the 2× width/height
contract; the GIF frame-count detector in the test (could it count a non-frame, or miss frames from
gifenc's output?); `frames-to-gif.ts` memory/time on ~40 frames of 1344×780; and whether
the help-corpus generator on the branch `worktree-fbucftjt-help-chatbot`
(tests/help-corpus.test.ts there) will be affected when both land.

Gates you can run: `npx vitest run tests/help-markdown.test.tsx tests/help-images.test.ts
tests/help-page.test.tsx tests/landing-assets.test.ts tests/doc-links.test.ts` and
`npm run typecheck`. Run them after any fix.

Report: numbered findings C1, C2, … with severity, what you changed for each (file and a line of
why), and what you left for me. End with one line: `VERDICT: ready` or `VERDICT: changes needed`.
