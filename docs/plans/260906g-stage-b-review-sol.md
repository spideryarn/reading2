## Verdict: refuse

F19 and F20 are established P1s. Both let ordinary timing produce navigation state that no longer means “back to where you jumped from.” F21 is another established P1 on the target mobile layout.

### Findings

**F19 — P1 — established: a chained jump temporarily leaves the previous chip active**

[`beginJump`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/keynav.ts:346) queues the nuqs push, then immediately starts scrolling at line 353. The actual History write arrives 50–320ms later, as documented in [`App.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:1711).

Concrete sequence:

1. Jump A → B. Entry B correctly carries origin A.
2. From B, jump to C.
3. The viewport starts moving to C, but until the queued push lands, [`ReturnChip`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/ReturnChip.tsx:55) still displays A’s chip.
4. Press it during that window and line 71 calls Back from entry B, landing at A—not B, where the latest jump began.

I reproduced the sequence against nuqs 2.10.0: before the delayed C push, the current entry still held A; immediate Back landed at A and canceled C.

Smallest fix: do not start `scrollToBlock(target)` until the matching wrapped push has committed. The arm can carry a post-commit action that the wrapper invokes after `innerPush` succeeds. Add a chained-jump test with a deliberately delayed flush.

**F20 — P1 — established: × cancels a pending position write**

[`dismissJumpOrigin`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/router.ts:1408) calls nuqs’s captured `replaceState` with marker `""`. In nuqs 2.10.0, that enters `sync()`, which calls `spinQueueResetMutex()` before noticing that the search string is unchanged: [`patch-history-Bze7i4qB.js`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/node_modules/nuqs/dist/patch-history-Bze7i4qB.js:38).

Concrete sequence:

1. Scroll into another section; the 300ms `?at=` replace is pending.
2. [`useReadingPosition`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:1667) has already advanced `synced.current`.
3. Press ×.
4. The stamp is stripped, but nuqs cancels the pending `?at=` write.
5. Because `synced.current` already says the new section, the position tracker need not retry. Reloading or sharing can therefore return to the old section.

I reproduced this: after waiting 380ms, the queued `at` had still not landed.

Smallest fix: call the captured inner replacement with nuqs’s `__nuqs__` marker, preventing its synchronization/reset path; `NAVIGATED` already updates the chip. Add a test that queues an `at` replacement, dismisses, then verifies that the URL update still lands without restoring the stamp.

**F21 — P1 — established: the offline strip covers the chip on the phone layout**

The full-width offline strip starts at `bottom: var(--dock-space) + var(--hint-h)` and is z-index 97: [`styles.css`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/styles.css:3665). The chip starts only 0.75rem above that same edge and is z-index 46: [`styles.css`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/styles.css:3743).

Even a one-line strip overlaps most of the chip. At 390px, the offline sentence in [`OfflineStrip.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/OfflineStrip.tsx:72) wraps and covers it completely. Internal jumps and Back work offline, but the return control cannot be reached.

Smallest fix: explicitly stack the offline strip above the fixed-height chip when `.return-chip` exists, while retaining the strip’s higher z-index. Verify their rectangles at 390px in the offline state.

**F18 — P3 — established: not closed; the plan still contradicts the source**

The original four errors were corrected, but the same prose defect remains:

- [`plan:249`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:249) still says `window.scrollY <= stickyOffset()` decides `top`; F13 changed this to the first row crossing the reading line.
- [`plan:254`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:254) still describes the arm as `{ pathname, origin, target }`, omitting `from`.
- [`plan:300`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:300) duplicates a sentence.
- [`plan:351`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:351) attributes z-index 46 to `.cmt-dialog`; that dialog is z-index 70.
- [`jump-history.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/tests/jump-history.test.ts:570) says nothing can observe the two writes separately, although the recording wrapper immediately below does exactly that. It should say React/nuqs subscribers do not observe the intermediate address.

### F13–F18 closure check

| Finding | Status |
|---|---|
| F13 | Closed. `measureOrigin` now tests the first row against the reading line, with the masthead-band regression covered. |
| F14 | Closed. The arm records and matches `from`, and `popstate` clears unclaimed arms. |
| F15 | Closed. Only `Object.prototype` and null-prototype records are mergeable. |
| F16 | Closed for the reported nonmergeable-state case: `canStamp` runs before the predecessor rewrite. |
| F17 | Closed. The interposed recorder establishes both writes and both `__nuqs__` markers. |
| F18 | Not closed, for the prose contradictions above. |

### Other questions

`useJumpOrigin` itself is a correct `useSyncExternalStore`; I found no cache defect. Different parsed origins produce different keys, revisiting an earlier origin may safely reuse its object, two raw states with the same parsed origin are semantically identical to this consumer, and the server snapshot is the stable `null`.

The article-swap suspicion is also closed: [`useArticleAccess`](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:938) synchronously refuses a previous slug’s payload, and readers are keyed by slug. There is no paint combining a new entry’s stamp with the previous article’s sections.

Calling `watchHistoryWrites` twice is idempotent. If it was never called, dismissal’s fallback directly writes `withStamp(history.state, null)` and does strip the stamp. Its queue side effect is F20.

The empty-title fallback is the right trade: the return remains valid, so “back to where you were” is preferable to suppressing it.

Seven focused pure suites passed, 242 tests total. No files were changed.