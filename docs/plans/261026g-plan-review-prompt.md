# Plan review: 261026g — Where it sits made clear, runs itself, reaches the margin

Review docs/plans/261026g-where-it-sits-made-clear-runs-itself-and-reaches-the-margin.md, read-only.
It builds on docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md, whose
Stage 4 is committed on local branch `worktree-fbvg2b69-sources-reshape` and not yet on origin/dev
(`git show worktree-fbvg2b69-sources-reshape:src/web/WhereItSitsPanel.tsx`, `…:src/web/SituateDossier.tsx`).

Read at least: src/web/SituateDossier.tsx, src/web/situate-dossier.ts, src/web/WhereItSitsPanel.tsx,
src/web/activation.ts (header and § activationForSources), src/web/auto-run-targets.ts,
src/web/useSituate.ts, tests/modes-that-start-themselves.test.tsx (header),
docs/project/chat-from-a-mode.md, docs/project/sources.md § Where it sits, src/web/PrivacyPage.tsx
(the Search the literature paragraph), docs/project/marginalia.md (the Literature row).

Greg's three reports are quoted at the top of the plan. His cost rule (q-vg2b69): free things
proactively; paid things only when Sources is opened; ~$0.30 "upon user request"; per-item costly
things only when the reader asks about that item.

Questions:
1. Stage 4: is "a press that lands on Where it sits arms situate" sound through the activation
   token? Does `activationForSources` returning one target force a shape change, and what is the
   least risky one? Any path where a non-press (pasted link, Back/Forward, reload, the command
   bar's restore, a margin "Open in Sources" focus, a chat's way back, a tool's crumb back to Where
   it sits) would now spend ~$0.30? Is the crumb back from a tool a press that should arm?
2. Stage 2: the overview's chat as a lens origin — any problem with chat's list, the way back, the
   600-char cap, or a mark found by words? Is a new id-shaped origin clearly better?
3. Stage 2: folded groups as component state; a finding focus must open its group first. Pitfalls
   with useLandOnItem / item-focus.ts?
4. Anything in the plan that conflicts with 261025h's direction or its pending Stage 5.
5. Anything simpler that gets Greg the same result.

Write numbered findings with P0–P3, the file/section, and a concrete fix. End with a verdict.
