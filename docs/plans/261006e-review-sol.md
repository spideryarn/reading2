No P0/P1 findings. The chosen values fit “dial it down a bit”: page chroma falls **23.16%–23.74%**, while faintest OKLab distance stays **0.162011**, above 0.16. I would keep them.

- **P2 — incorrect arithmetic/reasoning, fixed.** Tier-boundary contrast is **1.132702 → 1.13**, not 1.14. The lowered chroma floor is **1.85×** the lavender’s, not twice. Also, a three-quarter-chroma alternative can narrowly pass at `141 74 185`, strengths 0.48/0.575; the plan incorrectly ruled it out. All other table and new-section figures agree after rounding.

- **P2 — adjacent signals regress.** On faint/light-tier quotes, translucent search outlines lose contrast: at `--hit-a: 0.45`, crimson falls **2.973→2.935**; at 0.675, all sixteen colours regress by **0.038–0.100**. Glossary contrast falls on the faintest quote **3.399→3.365**, though it improves on heavy quotes. All four reader washes lose OKLab separation beside quotes; strongest-quote distances change:
  
  | Wash | Before → after |
  |---|---|
  | Yellow | 0.2003 → 0.1634 |
  | Green | 0.2055 → 0.1689 |
  | Blue | 0.1393 → 0.1056 |
  | Pink | 0.1368 → 0.1037 |
  
  Their luminance separation also decreases beside faint quotes. The **page-coloured gap and cross-reference rules improve**.

- **P2 — other grounds lose foreground contrast.** Ink, soft ink and links regress on all four grounds. Two new threshold crossings deserve recording:
  
  | Ground | Soft ink, before → after | Opaque blue, before → after |
  |---|---|---|
  | `--card` | 4.852→4.789 | **3.029→2.989** |
  | `--panel` | 4.943→4.890 | 3.086→3.052 |
  | `--muted` | 4.609→4.520 | 2.877→2.821 |
  | `--surface-raised` | **4.518→4.419** | 2.820→2.759 |
  
  Glossary rules also regress slightly on muted/raised grounds. I found no quote-filled reading prose on card/raised surfaces, so those crossings are reuse limits rather than established reader-path failures.

Lowering the two floors is honest **because the owner changed the saturation requirement**, and the visibility floor remains intact. They are engineering regression bounds, not measured perception thresholds. The new ceiling genuinely rejects yesterday’s faintest/strongest chroma (**0.098556/0.155977**) against **0.09/0.13**.

No missed current references to the old values were found. Light appearance and spine values are unchanged. The requested Vitest command passed: **5 files, 249 tests passed, 9 skipped**. `git diff --check` passed. The available new `/design` screenshot shows a modest reduction; a real iPad remains unverified.

Corrections and full results are in the [plan](/var/tmp/spideryarn-worktrees/quote-fill-less-saturated/docs/plans/261006e-dark-quote-fill-a-little-less-saturated.md:58), with a reproducible [script](/var/tmp/spideryarn-worktrees/quote-fill-less-saturated/docs/plans/261006e-review-colours.py). Colour/strength values were not changed. Repository edits stayed within the allowed paths; I also wrote arithmetic scratch files under `/tmp`. No commits or modifying Git commands.

**Verdict: ship.**