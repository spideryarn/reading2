# Blind judging, 2026-09-03 — the run that reversed the effort verdict

Materials, keys and verdicts for the blind comparison behind
[hierarchy-effort-2026-09-03.md](../../hierarchy-effort-2026-09-03.md). Kept because the mechanical
half of that eval reached the opposite conclusion, and the disagreement is the point.

Two draw sets from the long fixture, each judged by two models from **different families** — GPT Sol
and Claude Fable — with no knowledge of how any tree was produced. Labels are shuffled per set by
[`blind.ts`](../../../hierarchy-structure/blind.ts) and the mapping lives in the key files, which
the judges never saw. The free heading tree is in every lineup as a non-model anchor.

| set | arms | judged by |
|---|---|---|
| 1 | `incumbent`, `incumbent-repeat`, `smart-low`, `cheap-high`, `headings` | Sol, Fable |
| 2 | `incumbent`, `incumbent-repeat`, `smart-low`, `headings` | Sol, Fable |

**All four judgments ranked the arms identically**: `smart-low` first, `headings` second, both
`medium` arms below both, `cheap-high` last. Set 1's draws come from `2026-09-03-09-25-21`, set 2's
from `2026-09-03-09-46-32`.

Two sanity checks passed. The two `medium` arms landed adjacent in every judgment — the same recipe
next to itself. And the family-bias worry ran the wrong way for the losing arm: Sol is OpenAI-family,
`cheap-high` is an OpenAI model, and Sol still ranked it last.

**Read the caveats in the write-up before quoting any of this.** One article, two draw sets, and the
judges are models judging model output — the weakness `blind.ts` names in its own header.
