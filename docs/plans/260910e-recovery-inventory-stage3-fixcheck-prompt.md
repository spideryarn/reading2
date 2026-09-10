# Narrow check: seven P1 fixes in Stage 3 of the recovery inventory

Repo: /home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory (a linked worktree of
spideryarn/reading2), branch `worktree-recovery-inventory`. TypeScript, ESM, `tsx`; tests are
vitest. The dashboard client is React under `tools/fleet/web/`.

**The tree is read-only for you. Do not change any file.**

## This is not a review of the stage

Discovery for this stage is closed. This check answers one question per finding, and nothing
wider:

**Does the fix close the finding exactly as the finding was stated, without reopening anything next
to it?**

If you notice something unrelated, add one line at the very end under "Outside scope".

## The candidate

The commit whose message begins "Recovery inventory stage 3, review fixes"
(`git log -1 --grep='Recovery inventory stage 3, review fixes' --format=%H`). Diff it against its
first parent. Your own findings, verbatim, are in
`docs/plans/260910e-recovery-inventory-stage3-review-sol.md` (F27–F33). The contract the fleet side
parses is what the daemon writes: `recoveryFileText` in `tools/overseer/store.ts`, plus the types in
`tools/overseer/recovery-view.ts` and `recovery.ts`.

## The seven questions

1. **F27.** Can the route ever decode more than `MAX_RECOVERY_INPUT_BYTES` bytes, whatever happens to
   the file between the open and the last read?
2. **F28.** Take a symlinked ancestor, a missing leaf, a relative path, `..` segments, an absolute
   `OVERSEER_STORE_DIR` pointing at a non-default store, and the default store. **Can the drill create,
   write or delete anything inside a live store by any of these?** And is the recheck immediately
   before creating anything real, or is there a gap a swap can use?
3. **F29, the one to spend the most time on.** After the fix, can `recovery-feed.ts` return a
   `published` feed in which any record carries evidence, a classification, a directory, a transcript
   or a resolution that belongs to a different record? Consider:
   - `entry.key` against `record.key`;
   - duplicate ids in `view.page`;
   - a view item whose id matches one record and whose other fields describe another;
   - an unresolved item with no evidence;
   - a resolved item carrying a classification.
4. **F30, the second to spend time on.** Can the browser's parser accept a payload that the page then
   renders as two contradictory claims? For example: `not-yet-checked` with a classified row; an
   untrusted inventory with a non-`unknown` row; more than 100 records; counts that do not add up.
5. **F31.** Is every age on the page now true of the server's clock?
6. **F32.** For each classification, and for each of unchecked and resolved, does the row show every
   fact the plan's §6 and the roadmap stage require? That includes the live row's directory, claim,
   verified conversation and token for `already-live` and `present-but-unmatched`.
7. **F33.** With `records=[]` and `overflow>0`, does any sentence on the page say, or imply, that
   nothing was interrupted?

For each question: **closed** or **not closed**. For "not closed", give the concrete input and the
smallest fix. You may run `npx vitest run tests/<one>.test.ts` and
`node --import tsx scripts/typecheck.ts`. You have no network.

**Answer in under 1,000 words. Put seven lines of verdict first, then detail only where a fix is not
closed. Write the answer before you run out of time.**

## One deliberate deviation to judge, under question 3

The fixer accepts one view item that disagrees with its record: an item that says `unresolved`
beside a record the file now holds as **resolved**. That item is **ignored**, not refused. The
record's own resolution decides its state, and none of the stale item's evidence is drawn.

The reason: the daemon writes exactly that state. `appendDerived` appends a disposition, and the
next checkpoint writes the new records beside the view it already held (`daemon.ts` around line
957, `store.ts` around line 3663). Strict refusal would put "view unreadable" on the page after
every resume. Every other resolution mismatch is refused.

**Is that acceptance safe?** Can anything from the ignored item reach the page? And can a record
that is really unresolved be passed off as resolved by this path?

## The reproductions, as raw output

Every red below came from running the test **before its fix existed**. The full raw output is in the
worktree's scratchpad as `ri3f-repro-F<n>-{red,green}-raw.txt`. It is summarised here, verbatim
where it matters.

**F27** `npx vitest run tests/fleet-recovery-feed.test.ts -t "F27"`
```
RED  exit 1  × a file that grows after its size is checked is refused as oversized, and never read past one byte over the limit (F27)
             AssertionError: expected { kind: 'unreadable', …(1) } to match object { kind: 'oversized', …(2) }
GREEN exit 0  Tests 1 passed | 26 skipped (27)
```

**F28** `npx vitest run tests/fleet-recovery-wiring.test.ts -t "F28"`
```
RED  exit 1  × refuses a target reached through a symlinked ancestor of the store, and one inside an absolute OVERSEER_STORE_DIR (F28)
             × refuses a dangling link on the way rather than following it (F28)
             × builds nothing when the target resolves into a store (F28)   — promise resolved "{ …(4) }" instead of rejecting
GREEN exit 0  Tests 3 passed | 5 skipped (8)
```

**F29**, in full, as the Overseer asked: `npx vitest run tests/fleet-recovery-feed.test.ts -t "F29"`
```
RED  exit 1
  × a record whose entry.key names another session makes the file unreadable, as the store's own parser does
      AssertionError: expected 'published' to be 'unreadable'
  × a view item carrying another record's key, name, time or resolution makes the view unreadable, and every record unchecked
      AssertionError: key: expected { kind: 'checked', …(2) } to match object { kind: 'unreadable' }
  × a view that lists one id twice is unreadable, never last-one-wins
      AssertionError: expected { kind: 'checked', …(2) } to match object { kind: 'unreadable', …(1) }
  × a view item for a record the index does not hold is unreadable
      AssertionError: expected 'checked' to be 'unreadable'
  × an unresolved item carries both its classification and its evidence; a resolved one carries neither
  ✓ an item written before its record was resolved is the view lagging the fold: the record shows resolved, and the view is still read
GREEN exit 0  all six pass
```

**F30**, in full, as the Overseer asked: `npx vitest run tests/fleet-recovery-panel.test.tsx -t "F30"`
```
RED  exit 1, 14 failed
  × refuses not-yet-checked beside a classified row
  × refuses an unreadable view beside a classified row
  × refuses an untrusted inventory beside a row that is not unknown
  × refuses one id twice
  × refuses more than the first page of 100
  × refuses more unresolved than records
  × refuses more unresolved rows shown than are unresolved
  × refuses more resolved rows shown than are resolved
  × refuses a resolved row shown while an unresolved record is not
  × refuses an oversize stub that carries an entry / a disappearance / a sighting
  × refuses a record that is no stub and has no disappearance
  × refuses a journal record with no entry
      e.g. AssertionError: expected { schema: 1, kind: 'published', …(10) } to match object { kind: 'no-answer' }
  ✓ reads the lawful shape of each of the same things
GREEN exit 0  all pass
```

**F31** `npx vitest run tests/fleet-recovery-panel.test.tsx -t "F31"`
```
RED  exit 1  AssertionError: expected 'Checked 0s ago, at 2026-09-10T14:30:0…' to match /Checked 30m ago by the server's clock/
GREEN exit 0
```

**F32** `npx vitest run tests/fleet-recovery-panel.test.tsx -t "F32"`
```
RED  exit 1, 5 failed
  × a live row shows its directory, its claim, its verified conversation and its execution token, on both classes that carry one
  × a live row with nothing verified says so for each of the four, rather than leaving them out   — expected undefined to be 'not recorded'
  × an unchecked record shows its stored worktree, and that resume was not checked
  × a resolved record shows its stored worktree, and that resume does not apply   — expected undefined to be 'none recorded'
  × a record with no stored entry still says what resume is   — expected undefined to be 'not checked'
GREEN exit 0
```

**F33** `npx vitest run tests/fleet-recovery-panel.test.tsx -t "F33"`
```
RED  exit 1  expected 'No interrupted work is recorded.' to be 'The recovery index currently holds no records.'   (overflow, and replay not-run)
GREEN exit 0  Tests 2 passed | 45 skipped (47)
```

My own run on the candidate: `npm run typecheck` exit 0; the four recovery suites plus
`fixture-ids`: `Test Files 5 passed (5)`, `Tests 100 passed (100)`, exit 0.
