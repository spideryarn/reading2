# Adversarial review wanted: Referee mode for peer reviewers

You are reviewing a **plan**, before any code is written, for the Spideryarn repo you are sitting
in. Be a devil's advocate. Your job is to find what is wrong with it, not to improve its prose.

## What to read

1. `docs/plans/260831an-referee-mode-for-peer-reviewers.md` — **the plan under review.**
2. `docs/research/260831e-helping-peer-reviewers/README.md` and the three files beside it — the
   web research the plan rests on, including `ideas-fable.md`, a list of 32 candidate ideas from
   another model.
3. `CLAUDE.md` — the house rules. `docs/project/vision.md` — the product thesis.
4. `docs/project/search.md`, `docs/project/review-mode.md`, `docs/project/comments.md`,
   `docs/project/ideas.md`, `docs/project/architecture.md` — the machinery the plan proposes to
   reuse. **Check the plan's claims about this machinery against the actual code**
   (`src/search.ts`, `src/db/schema.ts`, `src/web/annotate.ts`, `src/converse.ts`, `src/routes.ts`,
   `src/modes.ts`, `src/web/Dock.tsx`, `src/web/params.ts`, `src/pipeline.ts`, `src/models.ts`).

## Context you need

The product owner (Greg) is asleep. He decided four things tonight and they are not up for review:
verdicts may be given but must be hedged, and he prefers **ranking** to absolute scores; v1 **may**
use web search but must not ingest cited papers; there must be **no** "draft my referee report"
feature; the mode is a normal mode in the band rather than behind the experimental flag.

Everything else is fair game, including the choice of the three sub-modes.

## What I actually want from you

**1. Attack the product design.** Which of the three sub-modes is weakest, and what would you build
instead from the 32 ideas in `ideas-fable.md` or from your own? Is "Mirror" (the AI critiques the
referee's own comments) really as well-evidenced as the plan claims, or is the plan over-reading one
ICLR result? Is "Claims" a real feature or a table nobody will look at twice? Is "Criteria" just
Search mode with a hat on — the plan admits this risk itself, so tell me whether it is fatal.

**2. Attack the anti-cognitive-surrender argument specifically.** The plan claims each sub-mode makes
the referee think more. Where is that self-flattery? Name the sub-mode most likely to be used to
*avoid* reading, and how it will happen in practice.

**3. Attack the cut list.** The plan cuts "candidate reviewer suggestions" even though Greg raised it
and did not veto it. Is that the wrong call? Are any of the other appendix cuts wrong?

**4. Attack the technical plan against the real code.** Does `search_runs`' shape actually carry a
signed valence without a migration nobody planned? Does the annotate/mark renderer
(`src/web/annotate.ts`, `MarkKind`) take a new mark kind as cheaply as claimed? Is a diverging
red↔green stripe compatible with the existing "wash carries confidence, stripe carries identity"
split, or does it break it? Is `?referee=` the right sub-mode mechanism given Diagram's precedent and
the standing keyboard rule? Does the plan's claim that "Claims" fits as an on-demand pipeline stage
hold, given `STEP_ORDER` and the on-demand mechanism? Can OpenRouter's server-side web search
actually be turned on per-call from a non-chat route the way `explain()` does it?

**5. Accessibility and colour.** A red↔green diverging scale is the single worst choice for the most
common colour-vision deficiency. Say what should replace it, concretely, given
`docs/project/colour-scales.md` and what the code already has.

**6. What will actually break first** when this ships, and what is missing from the staging plan.

## How to answer

Ordered by severity, most serious first. For each finding: what is wrong, the evidence (file and
line where it is a code claim), and what you would do instead. Say plainly if a section is fine —
do not manufacture findings to fill space. If you think the whole plan is sound and I should build
it, say that too, but say what you would bet goes wrong.

End with: the **one** change you would make to this plan if you could make only one.
