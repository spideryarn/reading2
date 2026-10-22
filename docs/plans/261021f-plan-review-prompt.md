You are reviewing a plan before it is built, read-only. Repo: Spideryarn (an AI-assisted reading app).

Read docs/plans/261021f-nicer-ai-face-and-no-reader-font-setting.md, then docs/project/fonts.md,
docs/research/261002a-a-nicer-typeface-for-ai-written-text.md, src/web/tailwind.css (the font imports;
note the block marked TEMP-SPECIMEN is a temporary comparison aid, not part of the plan),
styles/tokens.css (--font-ai), src/web/styles/voices.css, tests/voices-css.test.ts, and
docs/reusable/ask-me-questions.md.

Measured facts you can rely on (2026-10-21): @fontsource/ia-writer-quattro 5.3.0 is OFL-1.1 with
Reserved Font Name "iA Writer"; it ships one unsubsetted file per style (~44 KB woff2 for latin-400)
whose cmap has 1053 code points including Greek (75), Cyrillic (96) and Vietnamese; its family name in
the package CSS is 'iA Writer Quattro'. IBM Plex Mono latin-400 is ~15 KB, split by unicode-range,
with cyrillic and latin-ext subsets but no Greek.

Questions:
1. Is the plan's reasoning sound — is changing --font-ai for everyone the right minimal response, and
   is Quattro a sensible expected pick versus Duo or Recursive? Anything about Quattro (weight
   matching with --reading-weight 450, italic, the static 700, RFN, file size, line length changes in
   fixed-width layouts like Tweets or the Marginalia clamp, anything that measures text assuming 0.6em
   per char) that would break or silently degrade?
2. Find every place that depends on the AI face's metrics or family name (grep widely: src/, styles/,
   tests/, evals/, scripts/) and say which need changing.
3. Is the proposed test (the token names a family some imported @font-face declares) worth having,
   and how would you write it so it fails on a misspelt family? Is there already one?
4. Anything missing.

Write your findings, numbered, with severity (P1 must fix / P2 should / P3 nit) and file:line, and a
one-line verdict: approve, approve with changes, or rework.
