# Blind judging, cheap-model bake-off, 2026-09-03

Materials, keys and verdicts behind
[hierarchy-cheap-models-2026-09-03.md](../../hierarchy-cheap-models-2026-09-03.md). Kept because the
mechanical half of that eval again reached the opposite conclusion, and the disagreement is the
point — for the second time in one day.

Two draw sets from the 16,846-word fixture, each judged by two models from **different families** —
GPT Sol and Claude Fable — with no knowledge of how any tree was produced. Labels are shuffled per
set by [`blind.ts`](../../../hierarchy-structure/blind.ts); the mapping lives in the key files, which
the judges never saw. The free heading tree is in both lineups as a non-model anchor, and **both
Sonnet arms are in both sets** so the two sets can be read against each other.

| set | arms besides the free heading tree |
|---|---|
| 1 | Sonnet `medium`, Sonnet `low`, `gemini-3.8-flash`, `grok-4.3`, `deepseek-v4-pro` |
| 2 | Sonnet `medium`, Sonnet `low`, `glm-5.3`, `glm-5.3-flash`, `tencent/hy4-preview` |

Rankings, decoded:

| rank | set 1 Fable | set 1 Sol | set 2 Fable | set 2 Sol |
|---|---|---|---|---|
| 1 | `deepseek-pro` | free headings | `glm-5.3-flash` | free headings |
| 2 | Sonnet `low` | `deepseek-pro` | `hy4-preview` | `glm-5.3-flash` |
| 3 | free headings | Sonnet `low` | Sonnet `low` | `hy4-preview` |
| 4 | **Sonnet `medium`** | **Sonnet `medium`** | **Sonnet `medium`** | Sonnet `low` |
| 5 | `grok-4.3` | `grok-4.3` | `glm-5.3` | `glm-5.3` |
| 6 | `gemini-3.8-flash` | `gemini-3.8-flash` | free headings | **Sonnet `medium`** |

**Sonnet `low` placed above Sonnet `medium` in all four**, which with the four judgements in
[the effort eval](../../hierarchy-effort-2026-09-03.md) makes eight out of eight across two arm
sets, two judge families and two studies. The recurring named fault against `medium` is *welding* —
fusing two of the author's own distinct arguments under one title — and one judge called its titles
"generic".

Two things not to over-read. The judges disagree sharply about the free heading tree (1st for Sol
both times, 3rd then 6th for Fable), so its placement is unsettled. And **absolute placements may
not be read across sets** — relevance is judged over whichever arms are in the lineup, which is the
same caution [`../../README.md`](../../README.md) gives for the embedding runs.

Set 1's `deepseek-pro` tree is draw r1 from the `2026-09-03-12-56-47` run; every other tree comes
from `2026-09-03-12-29-23`.

**Read the caveats in the write-up before quoting any of this.** One article, two draw sets, and the
judges are models judging model output — the weakness `blind.ts` names in its own header.
