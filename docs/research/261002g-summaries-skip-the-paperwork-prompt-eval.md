# Summaries skip the paperwork: the before/after prompt eval

Written 2026-10-02 from [plan 261001p](../plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md)
(§ Measuring it, § The result), run 2026-10-01. Results in `evals/results/paperwork/`. This is a prompt
comparison, not a model comparison; every call ran at `power: "standard"` (Sonnet).

## The question

Do the Structure gists, Summary levels and tweet thread leave out acknowledgements, conflicts and
affiliations, and lead with the takeaway, with the changed prompts? And is Brief shorter?

> The structure, summary, tweet thread, and other such modes don't really need to include summaries
> of stuff like acknowledgements or conflicts of interest or affiliations ...
>
> — Greg, 2026-10-01 (Sentry SPIDERYARN-READING2-8M, as quoted in the plan)

## Options measured

Arms separated in time: `before`, `before-2` (old prompt twice, the noise control), `after`, `after-2`. Four local papers
(entropy-24, ball lightning `source-spya-f550ta`, analog-cognition, scaling-hypothesis), production's own functions,
harness `evals/paperwork/run.ts` (`generate --arm ...`, `pairs --a before --b after`, `report`). About $9
(budget was under $5). Three blind Opus judges read only pairs files, unblinded afterwards.

## The numbers (source: the plan's result table)

- Clearer takeaway, new : old : tie: **12:0:8** (`before` vs `after`) and **12:0:7** (`before-2` vs `after-2`);
  the control (old vs old) split 7:5:8 by side.
- Less paperwork: 5:0:15 and 3:2:14; mostly a tie because the old summaries already omitted most of it. The difference shows in Structure gists
  and the tweet thread's opening.
- Fidelity faults: old side about 13 and 8 rows, new about 5 and 4.
- Brief: old 121-154 words (mean 139), 3 paragraphs always; new 99-170 (mean 124), 2 paragraphs in 7 of 8.
  One run still reached 170, so no generation cap was taken.
- Boundary check: on scaling-hypothesis, funding as argument stayed in.

## Decision

Ship the prompt changes; Brief's length cap deferred. Lives in the plan and the prompts
(`prompting-guide.md` governs).

## Dead ends and side findings

- A first `after`/`after-2` hit `402 ai-no-credit` on the dev key; partial runs kept as `after-partial-402/`.
- The first harness borrowed plain-words' strict parse and hid failures; it now uses `parseJsonAnswer` and keeps raw answers.
- Found, not caused: structure answers that write JavaScript (`.replace(...)`): `toc/9` 1 in 20 (+0 in 8), `toc/10` 2 in 12 (+1 in 8);
  Fisher p about 0.3, so pre-existing, not a regression. Measured with `evals/paperwork/structure-parse.ts`.

## Caveats

Four articles, two draws each, three judges (same family as the generator). The `PAPERWORK` regex is a screen only. Opus power was not measured
(Simple moved to Opus the same evening, so word counts on Opus are unmeasured).

Up: [research.md](../project/research.md)
