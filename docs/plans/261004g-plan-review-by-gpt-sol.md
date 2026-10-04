Reviewed against base `8ef63beb2d74cadeabba172836f8e4fee9a5d944`. No files changed by me. Source line references below refer to that commit.

- **F1 — P1: `openAskedFromDrawer` is wrongly marked “No”.** [Reader.tsx:1984](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-cards-bands-notices/src/web/reader/Reader.tsx:1984). The Remember guard controls only the mode switch. In Chat mode, this callback still opens a thread through `openChatThread`, which sets `thread` without clearing `bandAway`; the floating dialog is also suppressed in Chat. Selecting an Asked question therefore leaves its answer hidden. Reveal Chat when the current mode is Chat or Remember, preserving the floating-dialog behavior in other modes. Add a whole-page regression case.

- **F2 — P1: the proposed `showBand` preserves invisible history pushes.** [Reader.tsx:3683](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-cards-bands-notices/src/web/reader/Reader.tsx:3683). The installed nuqs setter queues same-value writes, and `modeParam` uses push history. Always clear `bandAway`, but call `setMode(next)` only when `next !== mode`. Otherwise reopening an unchanged Glossary destination—or digging again in Citations—adds a history step with no URL change. This already affects 261004b’s citation path. Test both visibility and history length.

- **F3 — P3: `handToChat`’s stated reachability is incorrect.** [Reader.tsx:2530](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-cards-bands-notices/src/web/reader/Reader.tsx:2530) and [Reader.tsx:2597](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-cards-bands-notices/src/web/reader/Reader.tsx:2597). Its callers are Glossary’s *Ask in chat* and Summary’s paragraph action, both inside their respective bands. The prose term card receives no Ask-in-chat callback. Today these actions necessarily change mode; the proposed same-Chat handoff regression cannot be reached through that UI. Correct the table and test plan.

The item 3 table checks out as follows:

| Caller | Assessment |
|---|---|
| `openTermInGlossary` | Yes |
| `handToChat` | **No today; F3** |
| executor’s `openGlossary` | Yes |
| `citeActions.dig` | Visibility fixed; history issue remains |
| `openFromStopCard` | No; only supplied to Skim |
| `onOpenInQuotes` | No; button suppressed in Quotes |
| `onOpenFull` | No; floating panel suppressed in Chat |
| `openAskedFromDrawer` | **Yes in Chat; F1** |
| Dock press | Already reveals and avoids same-mode pushes |

For the four fixes:

1. **Structure positioning:** the cause and narrow fix are sound. Dropping `keepSide` also enables vertical-overflow checks, so mouse placement on a wide window can change near viewport edges. Check those cases in the browser. The browser measurement is the evidence; the mocked jsdom test is optional policy protection.

2. **BandAbout reopening:** the pending hover timer is the real cause. The Referee guard is a reasonable shared-hook design. It does not interfere with Tooltip’s touch-close protection or focus-preserving close rules: those run before the parent callback, and the guard still accepts closes. The proposed timer test should fail on the base implementation. My one permitted test-file run passed **18 tests**, but another writer introduced the fix during review, so that run does not establish the baseline red.

3. **Glossary returning:** the stated cause is correct. Keep the shared callback, with F1 and F2 addressed. The proposed whole-page Glossary test should fail for the stated reason.

4. **Shelf notice:** the cause is correct. Store message and source together, derive the public `actionError`, and update **every** internal error setter—not just `report`. Test through real `useShelf`, including an archive failure surviving a successful copy. Clearing another row’s copy failure is coherent with the current generic, shelf-wide notice and shared clipboard; make that policy explicit and pin it with a two-row test.

**Verdict:** build it with changes