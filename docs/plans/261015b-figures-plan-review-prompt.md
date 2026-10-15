You are reviewing a plan, read-only. Repo: Spideryarn (read CLAUDE.md for context). Plan: docs/plans/261015b-figures-follow-ups-tables-as-pictures-louder-structure-marks.md. It follows docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md. Code: src/figures.ts, src/web/FigureMark.tsx, src/web/styles/structure-mode.css, src/skim.ts, src/types.ts (SkimStop), docs/project/skim.md.

Questions:
1. Is the diagnosis of #585 sound (marks present but too quiet), or is there a case where the marks would genuinely not show for a PDF article like the one described (3 PDF placeholder figures with data-spya-pdf-figure, tree ranges covering their rows)? E.g. the Expanded face, the outline face, row ranges from buildSummaryTree, a part with children, visitors.
2. Is classifying a picture-figure as a table by a caption starting "Table N" right? False positives/negatives? Is the regex /^(supplementary\s+)?table\s+([a-z]?\d+[a-z]?|[ivxl]+)\b/i good? Does any other consumer of figureKindOf/Figure.kind (Skim Figures walk, door nouns, ordinals, Illustrated) need to agree?
3. Is deferring #584 (figures in the Gist/More/Most route) to its own queue entry justified, and are options A/B/C a fair framing? Anything simpler missed?
Answer with a verdict line first (VERDICT: approve / approve with changes / reject), then numbered findings with file:line evidence. Be concise.
