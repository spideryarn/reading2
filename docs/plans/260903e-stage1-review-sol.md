## Findings

1. **[Reproduced — no-ship for fix 4 as written] `overCap` does not prove the cap manufactured the spread failure.**

   [`toQuestions()`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/quiz.ts:530) stops after twelve survivors and sets `overCap` to the number of raw array elements it never examines. Those elements may be malformed, duplicate, unanchored, or simply the wrong band.

   I reproduced this with twelve valid `easy` questions followed by one malformed `{ band: "hard" }`. The result was:

   ```text
   overCap: 1
   malformed: 0
   ...
   A non-zero over-cap count is ... manufacturing this failure rather than the model
   ```

   No usable hard question was discarded, so the causal diagnosis at [`buildQuiz()`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/quiz.ts:684) is false. Even a valid thirteenth easy question would produce the same false conclusion.

   The new test injects `overCap: 4` directly rather than obtaining it through the cap, so it verifies formatting but cannot catch this semantic error ([test](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/tests/quiz.test.ts:476)).

   Either describe it factually as “N returned items were not examined after the cap,” or validate enough of the tail to prove that a usable missing-end question was discarded before claiming the cap caused the failure.

   The `{ authored }` privacy claim is sound: every interpolation is a number or a band selected from `SPREAD_ENDS`; no question, quote, provider message, or other model text reaches the string.

2. **[Reasoned; underlying downgrade reproduced — revise fix 3 before closing the stage] Idempotence belongs in `guardDbStore`, not only this composition root.**

   The claimed downgrade is real: the requested tests reproduce an `ECONNRESET` becoming `STORAGE_BUSY` after one wrapper and `STORAGE_FAILED` after two. However, [`guarded()`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/store/index.ts:218) protects only this particular composition path. Any other caller can still double-wrap.

   Worse, the test named “must not be wrapped twice” deliberately wraps twice and expects the wrong classification ([test](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/tests/store-guarded.test.ts:460)). The static scan cannot see `guardDbStore(what, pg)` because its regex requires a string literal ([scan](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/tests/store-guarded.test.ts:275)). Reverting the composition-root check would therefore leave these tests green.

   The simpler invariant is for [`guardDbStore()`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/store/db-errors.ts:411) itself to return an already-guarded store unchanged. Then every caller is safe, `index.ts` needs no special case, and the test can assert identity plus preserved `STORAGE_BUSY`.

   I would not copy a raw errno into `.code`: the existing comment correctly identifies the `ENOENT`/route-404 ambiguity. Making the wrapper idempotent is cleaner than carrying transport metadata through a scrubbed error.

   `Symbol.for` itself is sound here. I imported two distinct instances of `db-errors.ts`; a wrapper created by one was recognized as `"probe"` by the other. I found no current store that becomes unguarded under the new composition logic.

3. **[Reasoned — documentation correction, not a functional blocker] The PDF comments overstate the old harm.**

   [`alreadyKept()`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/pdf-read.ts:1585) correctly recovers from invalid JSON and valid non-manifest JSON, and a valid manifest still short-circuits. Those focused tests passed.

   However, the comment says callers interpret `readRaw()` returning `null` as “assume HTML” ([comment](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/pdf-read.ts:1562)); [`readRaw()` explicitly says that behavior ended on 2026-08-31](/home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/fetch.ts:562). The CLI also extracts from the current invocation’s in-memory bytes after `keepTheOriginal`, so the article is not literally permanently unreadable. The persistent harm is lost source provenance/object availability across reruns.

   The shallow `whyUnusable("raw", …)` check does accept legacy manifests that may later fail `readRawBytes`, but that is intentional compatibility: requiring `storedSha256` here could overwrite a legitimate older fetch’s provenance. The non-atomic write is acceptable for this fix because an interrupted manifest now repairs on the next invocation.

## Other checks

- `db-export`: safe and correct. The environment assignment occurs before the lazy pool and blob-store consumers. `shellWins: true` is appropriate for a rollback target. My IPC-free reproduction announced and passed port `59911` downstream while withholding the password. The other four `db-*` files without target resolution either do not touch a database or are pure/local-stack helpers.
- Layout: sound. Every `.band-covers` rule also requires `.mode-band` or `:has(.mode-band)`, so the class is inert when no band is open. Removing the media query lost no separate behavior, and the layout-focused suites passed.

## Test evidence

- Requested command: **30 passed, 5 skipped**, exit 0.
- Broader focused run: **104 passed**; two child-process tests failed only because this sandbox forbids the `tsx` CLI’s IPC socket.
- PDF recovery/short-circuit tests passed separately.
- Cross-module `Symbol.for` recognition and the export target’s downstream port were reproduced directly.

**Verdict:** fixes 1, 2, and 5 can ship. Fix 4 should not ship with its false causal diagnostic. Fix 3’s export guard should ship, but I would first move the already-guarded check into `guardDbStore` and replace the characterization test with a real idempotence regression test.