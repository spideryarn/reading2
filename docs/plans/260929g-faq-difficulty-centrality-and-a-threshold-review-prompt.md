# Plan review: FAQ difficulty/centrality scores and a prioritised threshold (260929g)

You are reviewing a PLAN before anything is built. Read-only.

**Candidate:** the untracked file `docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md`
in this worktree (base: the current HEAD). Nothing else has changed yet.

**Start with** that plan, then the code it touches: `src/faq.ts` (the prompt, `FAQ_SYSTEM`, and
validation), `src/glossary.ts` (`score`, `scoreCounting`, `GlossaryScoreDrops`),
`src/web/threshold.ts`, `src/web/GlossaryPanel.tsx` (the prioritised order, `GateSlider`,
`canPrioritise`, `gateTop`, `floorToGateStep`), `src/web/CitationsPanel.tsx` (the second copy of the
same gate arithmetic, and `BarSlider`), `src/web/FaqPanel.tsx`, `src/web/params.ts`
(`citeOrderParam`, `citeBarParam`), `src/public/dto.ts` (`publicFaq`), `docs/project/faq.md`,
`docs/project/glossary.md` § The scores / Prioritised / The threshold. Do not limit yourself to these.

**The request** (Greg, verbatim, a feedback report on the FAQ mode):

> The FAQ questions seemed pretty kind of dense and low level. I wonder if we could perhaps start
> with a few that are a little bit more high level. Or actually, perhaps we could even consider
> using the same approach we use for the glossary and other places, where we give each question a
> rating for something like how difficult and how central, as well as the ordering. And that way
> then we could have a prioritized ordering by default with a threshold, and the threshold could be
> some compound of difficulty and centrality. And then it would show them in order given that
> threshold.

Constraints from the brief: reuse the Glossary's rating/threshold machinery rather than build a
second one; measure the prompt change before/after on real articles; FAQ lists with no ratings must
still render; where something is a product call, take the simplest version and record it.

**What I want from you, in this order:**

1. Is the product design right for what Greg asked? In particular the plan departs from the
   Glossary's `difficulty × centrality` gate: it gates on centrality alone and orders survivors by
   difficulty ascending. Attack that. Is there a simpler or truer reading of "some compound"?
2. Does the prompt change as described risk re-admitting what the FAQ prompt deliberately bans
   (summary questions, tours of the sections)? How should the "big questions" instruction be worded?
3. The reuse plan (generic helpers in threshold.ts, a shared slider migrated onto by Glossary and
   Citations): right scope, or scope creep for a feedback fix? Any trap in moving `floorToGateStep`?
4. Anything that breaks: old artefacts, the public DTO, URL params, tests that pin shapes, caching
   (the FAQ shares a cached prefix with ideas/timeline/quiz), the answer-token budget.
5. Is the eval design able to show an effect, or will it be inside the control's noise with three
   articles?

Severity: P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or contract
violated; P2 design/maintainability risk; P3 prose. For each finding: severity, where, what, and the
fix you recommend. End with a one-line verdict: build as planned / build with changes / rethink.

**My own suspicions, worth less than your independent pass:** ordering by a single noisy score may
be unstable; the default bar value is a guess until the eval; `ScoreBars` labels for "difficulty"
on a question may read oddly.
