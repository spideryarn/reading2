I fixed five established P1 issues and one P3 documentation error.

- **H1 — P1 — established, fixed.** An unescaped TeX `%` let omitted source satisfy recall while Temml hid it as a comment. Recognition now rejects comments, with an end-to-end omission regression. [src/pdf-tex.ts:203](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-tex.ts:203), [tests/pdf-tex.test.ts:168](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/pdf-tex.test.ts:168)

- **H2 — P1 — established, fixed.** Allow-listed commands did not prove valid TeX: incomplete fractions, missing `\right`, and mismatched environments were accepted while stage 1 left them raw. Recognition now uses stage 1’s exact bounded Temml renderer and acceptance rule, loaded lazily. [src/pdf-tex.ts:211](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-tex.ts:211), [tests/pdf-tex.test.ts:149](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/pdf-tex.test.ts:149)

- **H3 — P1 — established, fixed.** Unrecognised spans containing no control word, plus `$x$`, `$x_1$`, and `$$…$$`, could escape the markup check. Their delimiters now produce markup failures without treating prices or shell variables as maths. [src/pdf-score.ts:582](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-score.ts:582), [tests/pdf-tex.test.ts:72](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/pdf-tex.test.ts:72)

- **H4 — P1 — established, fixed.** Nested braces bypassed the `\text{…}` prose limit, and visible-form conversion counted nonprinting environment metadata such as `alignedat`’s `{2}` and `[t]`. Both now parse structurally. Tests also cover `\\`, `\left.`, `\{`, and `\sqrt[3]{x}`. [src/pdf-tex.ts:231](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-tex.ts:231), [tests/pdf-tex.test.ts:118](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/pdf-tex.test.ts:118)

- **H5 — P1 — established, fixed.** `plainMaths` collapsed and trimmed titles with no maths. It now changes only recognised spans. [src/pdf-tex.ts:85](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-tex.ts:85), [tests/pdf-tex.test.ts:188](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/pdf-tex.test.ts:188)

- **H6 — P3 — established, fixed.** The measurement claimed identical page-by-page recall while pages 11 and 14 differed by 0.001. The docs now accurately claim equal mean recall and record both opposite-direction differences. [plan:168](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:168)

- **H7 — P1 — established, reporting wider.** Mathematical relations remain semantically unchecked. A page printing `x = 1` passes with `\(x \ne 1\)` at recall, precision, and order 1.0 because punctuation is folded away and relation commands emit no comparison token. This predates this stage’s word-level comparison design. [src/pdf-score.ts:257](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-score.ts:257), [src/pdf-tex.ts:315](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-tex.ts:315)

- **H8 — P1 — established, reporting wider.** Structural recovery still accepts any non-structural content warning—including malformed TeX—and checkpoints it after publication. This is the existing recovery policy noted in the plan, not introduced by the TeX stage. [src/pdf-read.ts:2397](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-read.ts:2397), [src/pdf-read.ts:2661](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-read.ts:2661)

Checks:

- Focused gate: **156 tests passed**
- Typecheck: prescribed command hit a sandbox `tsx` IPC `EPERM`; the same script via `node --import tsx scripts/typecheck.ts` passed all projects
- Scoped lint and diff checks passed
- No paid calls; no full suite; no commit

**Verdict: accept the stated conclusion for the ordinary checked path after these fixes, but qualify it with H7’s symbol-semantic blind spot and H8’s recovery policy.**