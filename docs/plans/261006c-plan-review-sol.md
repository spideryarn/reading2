**F1 — P2 — Correct the expected movement below 1000px.** [Plan:46](/var/tmp/spideryarn-worktrees/qi-kfmr6j93-title-align/docs/plans/261006c-the-title-follows-the-prose-below-1600px-with-the-marginalia-column-on.md:46) assumes the title box already fills the bar throughout this range. Its `65ch` cap can already bind, so narrowing the bar can move the title’s left edge too.

With a 16px root, rail on, no horizontal insets, and widths measured as the fitted page width:

| Page width | Reserve | Masthead content width before → after |
|---:|---:|---:|
| 612 | 200 | 569.6 → 369.6 |
| 768 | 212 | 708 → 496 |
| 1000 | 288 | 940 → 652 |
| 1200 | 196 | 1140 → 944 |
| 1400 | 0 | 1340 → 1340 |

These follow `C = page − 12 − paddingLeft − paddingRight − reserve`. The inner width is `min(C, H)`, where `H = 65ch + textPadRight − textPadLeft`; its left edge is `12 + paddingLeft + max(0, C − H)/2`.

Consequently, 612px keeps its left edge at 26.4px, but 768px can move left as centring disappears. At 1000px the capped box moves left **144px**; at 1200px it moves **98px**. At 1400px this fix changes nothing. Correct the plan’s explanation and browser expectations accordingly; retain the proposed gate removal.

The 45 focused tests pass. I found no blocking issue in the candidate.

VERDICT: build