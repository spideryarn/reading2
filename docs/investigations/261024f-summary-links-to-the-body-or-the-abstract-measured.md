# Summary links to the body or the abstract, measured

Up: [investigations.md](../project/investigations.md) · plan
[261024x](../plans/261024x-summary-links-the-body-that-argues-a-point-not-the-abstract.md) · report
`spya-hnw9xq`

**Asked:** does one prompt rule (`simple-prompt/13`) move Summary's links off a paper's abstract and
executive summary and onto the passages that lay each point out, without linking passages that do
not support what they are attached to? **Decided:** yes; shipped. Four of the five gates set before
the `after` arms ran were met; the fifth was missed on two counts, both small, and one of them did
not replicate (below).

## What was run

Production's own `generateSimpleSummary` through `evals/simple/probe.ts`: high power, guard on,
no reader profile. Four papers with a front summary (the reported *Consciousness in AI* report,
with an abstract and an executive summary; Llama 2; *Generative AI at Work*; Dropout) and one essay
with none (*How to Do Great Work*) as a control for harm. `link0a` and `link0b` are `/12` twice, on
`d80d03f6d`; `link1a` and `link1b` are `/13`. 20 writes, $4.81 (the first two, on a cold cache, $1.40 of it). Scored by
[`evals/simple/link-targets.ts`](../../evals/simple/link-targets.ts); raw files under
`evals/results/simple/high-none-link*` and `evals/results/simple/link-targets-261024x/`.

## Where the links land (the four papers)

| | `/12` (two runs) | `/13` (two runs) |
|---|---|---|
| Brief: paragraphs with a front-summary link | 13 / 16 | 1 / 16 |
| Brief: first chip in the front summary | 13 / 16 | 0 / 16 |
| Fuller: paragraphs with a front-summary link | 20 / 74 | 2 / 75 |
| Fuller: first chip in the front summary | 19 / 74 | 0 / 75 |
| Sentences with a link, Brief · Fuller | 100% · 91% | 93% · 90% |

The two `/12` runs agreed closely with each other (Brief 7/8 and 6/8 paragraphs), so the change is
far outside the control's spread. On the reported article Fuller now links each point to the
section that argues it: 1.2.1 for computational functionalism, 3.2.1 for the Transformer case
study, 4.1.1–4.1.2 for under- and over-attribution. The essay's links barely moved.

Guard: every level passed; `/12` had one retry, `/13` none. No write failed and no paragraph was
dropped.

## The gates

- **G1 destination, G2 first chip, G3 coverage, G4 no harm**: met. Coverage fell 7 points on Brief
  (48/48 to 52/56), inside the 10 allowed.
- **G5 judge**: a blind Opus judge per level, reading only the pairs with each linked passage
  beside its sentence, sides from `blindCoin` (seed 26102440, the first that balanced every kind,
  picked before any judge read a pair). The new links won **14–4** in test pairs (2 ties): Brief
  8–2, Fuller 6–2. Claim faults named: 2 old, 2 new. **Two misses:**
  - the Brief control came out 3–0 for `link0b` with 2 ties, where the gate allowed 3–1. Fuller's
    control was 3–2. Five pairs is a small control;
  - the first judges named 7 unsupported links on new summaries against 4 on old. A second pair of
    judges, asked only that question and to list each link, found **8 and 8**. Two of the new arms'
    eight were a third passage under a paragraph that no sentence cites. The single passage named
    most often, three times on each side, is the reported article's block 53, an executive-summary
    paragraph ("far from the final word"), which is the old behaviour, not the risk the plan review
    raised (a merely related body passage chosen to avoid the front summary).

## Also seen, not gated

- **Brief is a little longer**: mean 94 words under `/12`, 101 under `/13`, all under the 130 cap.
- **A bold phrase dropped**: 5 of 10 `/13` files dropped one `key` (a bold phrase that did not match
  its sentence, which then draws unbolded), against 0 of 10 `/12` files and 29 of 364 older probe
  files. Cosmetic, and possibly noise at ten files.

## Ruled out

A filter that removes the abstract from the ids the writer may cite. It cannot see an executive
summary, which `matter` does not mark; it would take the abstract away where it is the only source;
and `matter` may not have run when Summary is written. The prompt rule was enough.
