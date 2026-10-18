No blocking findings remain. I found and fixed these issues, ranked by severity:

1. **High — a first iPad tap could still jump.** A touch using pointer 7 followed by a trackpad press using pointer 1 could produce a delayed touch click labelled `mouse`/pointer 1—the failure described by [WebKit bug 282988](https://bugs.webkit.org/show_bug.cgi?id=282988). The prior logic treated it as the mouse and jumped. [BlockLinkCard.tsx](/var/tmp/spideryarn-worktrees/fbyk33ke-link-card-back-chip/src/web/BlockLinkCard.tsx:308) now queues presses and uses release order, failing closed when ambiguous.

2. **Medium — a later chip could inherit focus and never expire.** Removing a focused chip does not reliably fire `blur`, so the next journey inherited its held state. [ReturnChip.tsx](/var/tmp/spideryarn-worktrees/fbyk33ke-link-card-back-chip/src/web/ReturnChip.tsx:90) now unmounts the stateful child whenever the chip disappears, while preserving holds across continuously visible journey changes.

3. **Medium — a second finger or palm could authorize a jump.** A primary second-tap permit survived a later non-primary contact. Non-primary touch/pen presses now revoke all queued permits.

4. **Medium — touch adjustment could borrow permission.** A press beside an open cross-reference followed by an adjusted click on it could jump. Permission is now issued only when that press began on the same resolved `data-xref` phrase.

5. **Low — split cross-reference phrases could require a third Pencil tap.** Moving Pencil hover between sibling `<mark>` pieces lost element-based state. The arm is now keyed by the shared phrase.

6. **Low — timeout tests could not distinguish dismissal from accidental Back navigation.** [return-chip.test.tsx](/var/tmp/spideryarn-worktrees/fbyk33ke-link-card-back-chip/tests/return-chip.test.tsx:799) now asserts the address is unchanged and `history.back()` was not called.

I also updated the plan and project docs to describe release-order matching and the hover/focus pause accurately. `router.ts`’s whole-stamp key and stale-clock identity check were reviewed and retained.

Validation:

- Focused suite: **3 files passed, 106 tests passed**.
- Red-first regressions failed before their fixes; an isolated mutation disabling touch classification and timeout behavior caused **28 failures**.
- Exact `npm run typecheck`: attempted, but its `tsx` launcher was blocked by sandbox IPC permissions on `/tmp/tsx-1000/14.pipe`.
- Equivalent `node --import tsx scripts/typecheck.ts`: **passed all 3,807 covered source files**.
- Scoped lint: exit 0, with two advisory complexity notices.
- `git diff --check`: passed.

APPROVE WITH CHANGES (made)