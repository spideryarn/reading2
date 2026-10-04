Build with changes. The diagnosis is sound, but the cascade, pointer handling, and test timing need correction first.

Findings:

1. **P2 — `.close-x` will not make the button 32px while `tw:size-7` remains.** Tailwind’s `utilities` layer follows `app`, so `tw:absolute` correctly beats `.close-x { position: relative }`, but `tw:size-7` also beats its 32px width and height. The result would be a 28px box and only a 36px coarse-pointer target. Remove `tw:size-7` and retain the absolute-positioning utilities. Add a regression assertion that the button carries no competing size utility; merely checking for `close-x` would silently pass the broken combination. See [Library.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/src/web/Library.tsx:1217), [close.css](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/src/web/styles/close.css:30), and [tailwind.css](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/src/web/tailwind.css:38).

2. **P2 — focus suppression should follow the actual activation, not `(pointer: coarse)`.** A finger can tap an iPad whose primary pointer reports fine; conversely, keyboard activation on a coarse-primary device should return focus to the input. Record `touch`/`pen` at `pointerdown`, then decide at `click`; keyboard and mouse activation should refocus. This is already the project’s documented rule, including the iOS bug where a finger-generated click can claim to be a mouse click. See [touch.md](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/docs/project/touch.md:69) and [phone-and-touch.md](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/docs/project/phone-and-touch.md:217).

3. **P2 — the prepared URL assertions wait 50ms, but `q` is debounced for 200ms.** The input empties immediately, while `location.search` may still contain `q` when the assertions run. Either wait through the debounce/use fake timers, or deliberately override only clear operations to flush immediately while retaining `history: "replace"`. The existing scaffold’s waits are at [shelf-search-clear.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/tests/shelf-search-clear.test.tsx:128), while the parser declares the debounce at [params.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/src/web/params.ts:1537).

4. **P3 — one sentence overstates the evidence from Greg.** The earlier iPad report concerned a roughly 20×15px comment-close target, not this shelf’s 14px glyph in a 28px button. Treat it as precedent for using the house cross, not evidence that Greg missed this exact size. Likewise, “too faint to be found” should be “plausibly too faint to find”: the plan correctly admits that Greg’s actual Safari/iPad state is unknown.

On the seven checks:

1. **Diagnosis: holds.** The code proves an owned clear button already exists whenever the query is non-empty, and the screenshots support the best explanation available: it is faint when unfocused and duplicated by Chromium when focused. No better-supported alternative appeared in the code. The exact condition Greg encountered remains an inference, as the plan says.

2. **Composition and geometry: does not hold until `tw:size-7` is removed.** `tw:absolute` wins desirably; `tw:size-7` wins undesirably. Once corrected, the 40px target extends from 44px to 4px inside the input’s right edge. `pr-11` reserves 44px, so it meets but does not overlap the text area, and it does not protrude beyond the input edge.

3. **Escape: holds.** There is no shelf-wide Escape listener that this would double-trigger. The tag editor and Radix menus own Escape only within their open surfaces. Calling both `preventDefault` and `stopPropagation` only for a non-empty query is correct and matches Metadata’s implementation at [PageContents.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/src/web/PageContents.tsx:479).

4. **Refocusing: needs the pointerdown change above.** Refocus after mouse or keyboard activation is right. Suppressing it for the actual touch/pen activation is right. Primary-pointer media alone is not reliable enough.

5. **History: holds.** Empty becomes `null`; `q` uses replace, not push, while preserving `archived=1` and other parameters. That is appropriate for editing a live search field. Pushing would make Back unexpectedly resurrect a query the reader deliberately cleared.

6. **Scope: holds.** The “Not doing” items should remain out of scope. Hiding the native cross, strengthening the owned cross, adding Escape, and restoring focus are all warranted. Reusing `.close-x` as the shared visual primitive is acceptable if its comment honestly describes both close and clear crosses.

7. **Greg conclusion: slightly overstated only as described in P3.** The proposed product response is supported; the claim about exactly what Greg encountered is not proven.

No files were changed.

VERDICT: build with changes