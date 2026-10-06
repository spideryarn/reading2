**do not ship**

C1 violates your explicit preservation requirement. U8’s block-depth defect is closed, but general citation parity is not.

- **C1 — P1, [src/citable.ts:139](/var/tmp/spideryarn-worktrees/agent-a7b31a2c0866346e4/src/citable.ts:139), reproduced; reported.** At **block depth zero**, `"*".repeat(21) + "spya-k3m9qt" + "*".repeat(21)` produces no citation before this cluster and one afterward. Verified against the actual pre-cluster module. The renderer already draws that chip, so the change improves parity, but contradicts “unchanged at depths 0–3 for ANY input shape.” Those two requirements cannot both hold here. Corrected the builder’s blanket claim.

- **C2 — P2, [src/citable.ts:118](/var/tmp/spideryarn-worktrees/agent-a7b31a2c0866346e4/src/citable.ts:118), reproduced; wider defect reported.** The server matches raw source; the renderer matches decoded text. Minimal disagreement families, expressed as **server count / rendered chips**:

  | Input | Counts |
  |---|---|
  | `spya\-k3m9qt` | 0 / 1 |
  | `spya-&#107;3m9qt` | 0 / 1 |
  | `https://x.example/&#32;spya-k3m9qt` | 0 / 1 |
  | `https\://x.example/spya-k3m9qt` | 1 / 0 |
  | `https&#58;//x.example/spya-k3m9qt` | 1 / 0 |
  | `[cmd\:bookmark:spya-k3m9qt]` | 1 / 0 |
  | `[cmd:bookmark:spya-k3m9qt\]` | 1 / 0 |

  Encoding other letters in the id produces the same missing-count failure. These defects predate this cluster, introduced by `3f6b7d68a`.

- **C3 — P1, [src/web/Cited.tsx:204](/var/tmp/spideryarn-worktrees/agent-a7b31a2c0866346e4/src/web/Cited.tsx:204), reproduced; fixed.** Streaming `"> ".repeat(10000) + "spya-k3m9qt"` overflowed `lastText` before capped rendering began. The new regression failed with `RangeError`, then passed after replacing that recursive inspection with an iterative walk. Traversal order and tie handling are preserved. Fixed `Cited.tsx` and `tests/chat-markdown-render.test.tsx`.

- **C4 — P1, [src/web/Cited.tsx:448](/var/tmp/spideryarn-worktrees/agent-a7b31a2c0866346e4/src/web/Cited.tsx:448), reproduced; wider defect reported.** `"*".repeat(6000) + "spya-k3m9qt" + "*".repeat(6000)` still overflows inline rendering in SSR after approximately 4.9 seconds. The server walk completes. This is pre-existing; changing the renderer’s inline-depth policy exceeds the traversal-preserving fix applied above.

- **C5 — P3, [src/store/block-rows.ts:66](/var/tmp/spideryarn-worktrees/agent-a7b31a2c0866346e4/src/store/block-rows.ts:66), reproduced; fixed.** The comment incorrectly claimed absent versus undefined properties change JSON output. Both serialize identically. Corrected the comment and recorded review findings in the cluster’s plan.

The remaining checks support the implementation:

- **Fuzzing:** 10,008 generated cases with valid ids, plus 2,000 cases using literal ids, covering depths 0–14, mixed lists/quotes, marks, code, links, headings and table-shaped prose. The literal run had **zero disagreements**. Neither side enables GFM tables.
- **Walk:** finite AST work terminates without recursive traversal. Writing original offsets preserves citation order and duplicates; citation counters subsequently deduplicate. Ten thousand quotes took approximately 0.5–1.2 seconds; a million-character line approximately 0.33 seconds. Extreme inline parsing remains expensive.
- **Flat mode:** list and quote disagreements are real, but no citation-counter caller processes flat-mode output. The current production `CitedText` caller is Quiz feedback.
- **Browser imports:** `citable.ts` introduces no server-only dependency.
- **Null checks:** both current `FetchedDocument` members were checked; all three removals are valid.
- **Mapper:** all five replacements preserve aliases, values, optional-key omission and key order. An independent 128-combination probe matched old mappings and serialized bytes. `hashBlocks` is insensitive to object-key order; export order remains unchanged.
- **Privacy:** structural typing permits extra `note` properties, but explicit projection excludes them. An actual input-spread mutation made the visitor unit test fail with the leaked note visible; restoring the mapper returned it to green. U7’s narrower extraction contract is satisfied.
- **Lane/docs:** `private-postgres` is appropriate; both requested doc additions match current code.

Final typechecking passed, **316 distinct database-free tests passed**, lint passed, and the diff is clean. No network, database access, or commits.