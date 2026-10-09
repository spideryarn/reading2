You are reviewing a plan before it is built, in the Spideryarn repo (the current directory). Read-only: do not edit anything.

Read the plan: docs/plans/261009j-skim-question-optional-and-the-border.md

Then read what it touches: src/skim.ts (the prompt's section 3 around "A CUE for each stop", `cueOf`, `validateRoute`, `SKIM_OUTPUT_SCHEMA`, `PROMPT_VERSION`, the `SkimDrops` type), src/web/SkimPanel.tsx (the row and `StopCardView`, the door), src/web/styles/skim.css (`.skim-go`, `.skim-row.current`, `.skim-card`, `.skim-cue`, `.skim-door-cue`), tests/type-roles.test.ts, docs/project/skim.md (§ "A cue sets the scene", and the stale/outdated rules), docs/project/prompting-guide.md § Measuring a prompt change, docs/investigations/261006b-skim-cue-situates-the-quote-eval.md (the previous measurement of this same field), and scripts/eval/skim-coverage-eval.ts and scripts/eval/skim-cue-pairs.ts.

Look for:
1. Anything that silently breaks when a cue is empty: places that read `cue`, count `badCue`, test for it, or use it (the door, the feedback payload, the export, MCP, the help text, route freshness, the input hash). grep for `cue` and `badCue` across src/ and tests/.
2. Whether the measurement can actually tell the new prompt apart from the control, and whether the ship rule is sound — in particular that a prompt which leaves cues empty can "win" a pairwise judgement just by saying less, and how the judge questions should guard against that. Also whether 6 articles / ~70 stops is enough, and what the judge must see.
3. The CSS plan for one bar on the li (::before inset strip): what could go wrong (hover states, the position mark button laid over the row, `.skim-line.piped`, focus rings, the card's padding that aligns to the row text, the narrow/phone layout).
4. The tooltip on the cue inside a <button> that already sits inside a Tooltip: nesting problems, accessibility (aria-describedby on a span inside a button), touch.
5. Anything simpler that would do the same job, and anything the plan claims that the code contradicts.

Answer with numbered findings, each: severity (high/medium/low), what is wrong, the evidence (file:line), and the fix you recommend. End with a one-line verdict: build as planned / build with the fixes / rethink.
