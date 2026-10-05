**Sound after fixes**, for the code and the evidence. Tests and typecheck remain with you.

- **F14 — P3: The reference doc still described `/9` as the current version.** [summaries.md](/var/tmp/spideryarn-worktrees/brief-slightly-longer/docs/project/summaries.md:393) said “The version is `simple-prompt/9`”; the candidate uses `/10`. **Fixed:** “This introduced `simple-prompt/9`.” No other new findings.

The five checks:

1. **Numbers — completed.** Ran `score brief` and `table`, and independently counted the saved prose. Means are **97.09, 103.33, 109.50**, correctly reported as **97, 103, 110**; ranges match. Third-paragraph counts are **0/11, 2/12, 1/12**; longest sentences are **19, 20, 21** words. Every reported preference, padding, bent-claim, coverage and omission tally matches, including both size groups and the book’s four old-preferred pairs. Side balance is **11/11**. Estimated cost is **$4.497**, with four unpriced writes.

2. **Provenance — completed.** All **12 `brief100` hashes match** the current prompts for their bands. All **12 `brief90` hashes differ** from the tree and match its 90/140 variant. All 11 `len0` hashes match the old standard prompt pair. Every file records **`anthropic/claude-opus-5.5`**. `len0` versions are `/8` or `/9`; the new trials record `/9`. Their hashes establish the measured variants despite that shared stamp.

3. **Code statements 1–4 — completed.** Brief changes only **80→100 and 130→150**; Fuller remains byte-for-byte identical in every band. Budget remains **8,999 tokens**; storage shape, limits, validation and freshness handling need no further change. Remaining old-number references are historical. Both earlier scorer outputs are **byte-for-byte unchanged**, as are their table rows.

4. **Judge — completed.** Instructions reveal no arm identity or preference for the increase; the hurry/one-glance framing matches Brief’s purpose. Hand-checked **P02, P09, P13, P24 and P26** against the key, prose and scorer: no misread verdicts. All **54 summary sides** match their result files. Seed replay reproduces **6/16**, then **11/11**, and the accepted key exactly.

5. **Evidence overstatements — completed.** The accepted F11–F13 corrections accurately distinguish the mixed results from the product decision. No further overstatement found within this change.

The `tsx` CLI hit a sandbox IPC restriction; the same read-only commands succeeded through `node --import tsx`. No tests run and no commit made.

**Only worktree file changed this pass:** [docs/project/summaries.md](/var/tmp/spideryarn-worktrees/brief-slightly-longer/docs/project/summaries.md).