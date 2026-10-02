---
reports: spya-bjbcxp
ending: shipped
parts: 2
---
# Skim in the author's and the model's faces

Report `spya-bjbcxp`, a suggestion from Greg (admin), from Trajectory (now Skim) on
`arxiv-2508-spya-wrzxkg`, 2026-10-01:

> In Trajectory/Skim mode:
> - Remove the FAQ snippets (they don't add much)
> - Update the fonts to be clear about what's author-generated vs AI-generated (as elsewhere)

**This note is the second half, the typeface.** The first half, the FAQ snippets, shipped in
[261001_1730](261001_1730-skim-drops-its-faq-snippets.md).

**Ending: Shipped** to `dev` (commits `9b4b7a933` and `75dc3d59d`). Skim's quoted words were already
in the author's serif and its cues, sense text and chips in the AI face from `dab30ed19`, but only
behind the Experimental switch; the faces are now on for everyone. Skim's place crumbs above each
stop now put each section title in its writer's face too: the author's heading kept, or the model's
title. Playwright checked it with the switch off.

The rest of the work, and what was left out on purpose, is in
[261001_1840](261001_1840-the-three-faces-for-everyone-and-structure-s-headlines.md) and the plan
[261002f](../plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md).
