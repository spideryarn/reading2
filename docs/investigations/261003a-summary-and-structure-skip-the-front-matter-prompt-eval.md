# Structure skips the front matter: the before/after prompt eval

Written 2026-10-03 for [plan 261003c](../plans/261003c-summary-and-structure-skip-the-front-matter.md),
run the same night. Results are in `evals/results/front-matter/`. This compares prompts, not
models; every call ran at `power: "standard"` (Sonnet).

## The question

Greg wanted Summary's per-section outline to skip non-content sections: the title, the abstract,
the references and the acknowledgements. That outline is Structure's tree today. Acknowledgements
were already handled
([261001p](../plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md)).
With the changed prompts, do the nodes that cover only the front abstract stop restating it as a
claim with a question, while the substance keeps its claims?

> maybe they don't need a summary at all, or maybe it's just very brief because we want the
> summary text to focus on kind of substantive content.
>
> — Greg, 2026-09-30 (spya-abs6bj)

## How it was run

- **Harness:** `evals/paperwork/run.ts --set front-matter` (`generate`, `report`, `pairs`).
  It calls production's own functions: the whole-document Structure request,
  `generateSimpleSummary` and `generateTweets`.
- **Corpus:** four local papers, each with an abstract and a reference list. analog-cognition,
  entropy-24 (an unheaded *"Abstract: …"* paragraph), scaling-hypothesis (a gwern.net essay, whose
  opening blockquote is the abstract), and s41598-023-33209-9 (Scientific Reports).
- **Arms, separated in time:**
  - `before` and `before-2`, the old prompt twice (the control), on toc/11;
  - `after` and `after-2`, on `ba2e96030`'s wording;
  - `after-3`, on `9ac3ee21b`'s final wording, after GPT Sol's code review reworded the shared
    text.
- **Cost:** $6.73 in all.
- **Screen:** a node is *abstract-only* when it ends inside the hand-marked abstract range (the
  abstract's first block to the last block before the body), whatever its title.

## The numbers

| arm | abstract-only nodes | with a question | with a content gist | Brief, mean words |
|---|---|---|---|---|
| before | 8 | 3 | about 6 | 146.5 |
| before-2 | 8 | 2 | about 4 | 138.8 |
| after | 8 | 0 | 0 | 147.8 |
| after-2 | 8 | 0 | 0 | 138.5 |
| after-3 | 5 | 0 | 0 | 140.3 |

"Content gist" is read by eye. A new label reads like *"The authors' summary of the paper."*; an
old content gist reads like *"Brain waves may provide executive-like control by organizing
neurons…"*.

- **Checked in every arm:** the closing `8. Summary` (entropy-24) and the Conclusions keep
  content gists. scaling-hypothesis's substantive appendix keeps its claim in every new arm.
- **Blind read:** three Opus judges in fresh subagents, one per pairs file, with 20 pairs each.
  The pairs are Structure, Brief, Simple, Fuller and Thread, per paper.

| pairs | (a) less paperwork, new : old | Structure only | (b) substance | fidelity faults, new / old side |
|---|---|---|---|---|
| before vs after | 5 : 0 | 4 : 0 | 3 : 0 | 2 (one minor) / 5 |
| before-2 vs after-2 | 4 : 1 | 3 : 0 | 2 : 2 | 2 (one in a Simple summary) / 2 |
| before vs before-2 (control) | 4 : 1 by side | 3 : 1 | — | both sides |

## What it says

- **The screen is the evidence.** No old arm went without a question on an abstract-only node. No
  new arm wrote one, and every new abstract-only gist is a label. The control judge said the same
  unprompted: *"Neither side reliably drops the question from the Abstract node."*
- **The blind read does not, on its own, show an effect.** Old against old split 4:1 on paperwork,
  about as wide as new against old (5:0, 4:1). It agrees in direction and finds no loss of
  substance from the change. An old-prompt fault it found was a substantive appendix cut to the
  label *"Appendix material."*; that is the over-reach the new wording was written to avoid, and
  no new arm did it.
- **Brief is unchanged.** The plan's literal gate, that `after`'s mean is not above `before`'s,
  failed by 1.3 words on one arm. The old prompt's own two arms differ by 7.7 words, and pooled,
  the three new arms give 142.2 words against the two old arms' 142.6. The Summary prompt changed
  only by two entries in the shared list.

## Decision

Ship toc/12, expand/8, simple-prompt/6 and tweets/8.

## Caveats

- Four papers, five draws in all.
- The judges are the generator's family.
- `expand/8` (the later structure waves) is not measured, because the harness calls only the
  whole-document request.
- No front executive-summary or key-points box is in the corpus, so the "by role" clause is
  untested.
- Found, not caused: `evals/structure-whole-document/toc10-frozen.ts` imports the live
  `TOC10_SYSTEM`, which interpolates the shared rules. Its "frozen" toc/10 baseline therefore moves
  whenever `src/paperwork.ts` or `src/plain-words.ts` does (Sol's code review).

Up: [investigations.md](../project/investigations.md)
