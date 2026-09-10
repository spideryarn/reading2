# Stage 3 fixes task: Sol's review, applied

You are applying GPT Sol's read-only review of Stage 3 of
`docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md`, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory`. The review is
`docs/plans/260910e-recovery-inventory-stage3-review-sol.md`. Read it whole, then §6 and Stage 3's
status in the plan. The candidate was commit `bcd11529`.

**Red first for every behaviour change**: write the test, watch it fail on today's code, fix it,
watch it pass. Save each finding's red and green output as `ri3f-repro-F<n>.txt` in the scratchpad,
in the same shape as the Stage 2 fixes (the command, the red output, the green output). If a red
cannot be produced, say so; never fake one.

## The findings and what to do with each

- **F27 (P1): the input ceiling can be defeated.** The file's size is checked with `stat`, and then
  `readFile()` reads to EOF, so a file that grows in between goes past the limit. **Fix:** read from
  the descriptor, at most `MAX_RECOVERY_INPUT_BYTES + 1` bytes; that extra byte means `oversized`.
  Decode only the bounded buffer.
- **F28 (P1): the drill's guard.** A symlinked ancestor defeats it, and it ignores an absolute
  `OVERSEER_STORE_DIR`. **Fix:** protect both the default store and an absolute
  `OVERSEER_STORE_DIR`. Canonicalise the nearest existing ancestor, then append the missing suffix
  before comparing. Recheck the canonical target immediately before creating anything. Tests: the
  symlinked ancestor (`/tmp/<x>/live -> <fake store dir>`, so the real `~/.overseer` is never
  involved), and the `OVERSEER_STORE_DIR` case.
- **F29 (P1): the fleet parser's cross-field contract.** Require `entry.key === record.key`, and
  unique `view.page` ids. For every view item, `key`, `name`, `at` and `resolution` must equal its
  record's. Unresolved items need both classification and evidence; resolved items have neither.
  A failure in the view makes it `unreadable`, and a mismatched `entry.key` makes the record file
  `unreadable`. That matches what the store's own parser refuses (`store.ts` around line 2920).
- **F30 (P1): the browser parser's whole-payload check.** Add one final validation:
  - `not-yet-checked` means every classification is null;
  - an untrusted inventory means every classification is `unknown`;
  - ids are unique, and there are at most 100 records;
  - `unresolved <= total`, `shownUnresolved <= unresolved` and `shownResolved <= total - unresolved`;
  - the impossible oversize, entry and disappearance combinations are refused.

  Any violation gives `no-answer`.
- **F31 (P1): the view's age is taken from the browser clock.** Compute it against the server's
  `composedAt`, advanced by the time elapsed on the client since the answer arrived. Keep the words
  honest: "checked N ago" must be true of the server's clock.
- **F32 (P1): missing evidence on some rows.**
  - For `already-live` and `present-but-unmatched`, render the live row's directory, its claim, its
    verified conversation and its execution token.
  - For unchecked and resolved records, render the stored worktree, plus `resume: not checked` or
    `resume: not applicable, this record is resolved`.
- **F33 (P1): contradictory empty-state wording.** With `records=[]` and `overflow>0`, the text says
  "No interrupted work is recorded". Replace it with "The recovery index currently holds no records."
  whenever `overflow > 0` or anything else says records exist elsewhere. Keep the plain empty state
  only for a truly empty index.
- **F34 (P2): parsing is synchronous on the event loop.** **Measure rather than build.** Generate a
  worst-case valid file at the daemon's own caps: 500 unresolved records at the 16 KB cap, plus
  resolved ones. Time `readRecoveryFeed` plus projection over it, the median of 5 runs, and put the
  number and the file size in your report. If a realistic worst case exceeds about 100 ms, lower
  `MAX_RECOVERY_INPUT_BYTES` to a measured bound with a comment, and tell me. Do not add a worker.
- **F35 (P2): the wiring guards are text searches.** For the page: render the real `App` in Overseer
  mode (the existing fleet web tests show how to render it with injected clients), and assert that
  `RecoveryPanel` is present. **Keep the server side as a source check.** Importing `server.ts` binds
  port 8787, which is why `tests/fleet-health-wiring.test.ts` keeps one too. But make it harder to
  fool: assert the dispatch line sits in the request handler's top-level `if` chain, as its
  neighbours do. Say exactly how strong it is.

## Files — yours

`tools/fleet/recovery-feed.ts`, `tools/fleet/routes-recovery.ts`,
`tools/fleet/web/src/recovery-client.ts`, `tools/fleet/web/src/RecoveryPanel.tsx`,
`scripts/overseer-recovery-drill.ts`, and the four `tests/fleet-recovery-*.test.ts(x)` files. The
`wire.ts` recovery block, only if a type must change. **Not** `server.ts`, `App.tsx`,
`tools/overseer/`, or anything else. If a finding needs one of those, stop and tell me.

## Gates, constraints, report

The same as the Stage 1 brief (`docs/plans/260910e-recovery-inventory-stage1-task.md` § Gates you
run, § Constraints, § What to report back). Add: `npm run build:fleet` (read its exit code); a fresh
browser check at 400 px of any row whose rendering changed, on your own server and port, killing
only your own PID; and `tests/fixture-ids.test.ts`. Use the scratchpad prefix `ri3f-`. **A full
`npm test` may still be running in this worktree when you start** (its tmux job is
`ri-full-suite-…`). Do not stop it, and do not start another. Do not commit. Report one line per
finding ID, then the gates with their exit codes, the F34 measurement, and the repro file paths.
