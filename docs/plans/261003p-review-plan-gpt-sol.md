Stage 1 is justified. Stage 2 needs changes to its viewport handling, covered controls, and tests. I reviewed against `8019e3549`; implementation edits appeared during the run. I changed no files.

1. **F1 — P1, established: the top anchor loses part of the iOS keyboard contract.**  
   [`useVisualViewport.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fbnseuz2-block-chat-margin/src/web/useVisualViewport.ts:41) supplies both `offsetTop` and `bottomInset`, but `keyboardInsetStyle` exposes only the latter. The plan retains that helper while anchoring at `--bar-bottom`. When Safari pans the visual viewport, the panel’s header and Close control can remain above the visible strip. Subtracting `--kb-inset` from its height does not correct its top.

   Either incorporate the visual viewport’s top and height, or retain the existing bottom anchor. Add a docked test with **nonzero `offsetTop`**, including a viewport `scroll` event. Chrome screenshots at iPad dimensions do not exercise this behaviour.

2. **F2 — P1, reasoned: docking covers controls that remain reachable by keyboard.**  
   [`.marg-head`](/home/greg/code/spideryarn2/.claude/worktrees/fbnseuz2-block-chat-margin/src/web/styles/marginalia.css:245) occupies the proposed position at z-index 30; the chat stays at 70. Its path and arc are real buttons, and the notes also contain controls. The plan covers them visually without withdrawing them from keyboard navigation. Because chat remains modeless, a reader can Tab onto a control hidden behind the panel; its tooltip may then appear above chat.

   Specify how covered Marginalia controls become unavailable while docked, and restore them on close. The existing dialog’s opening, draft-to-thread, and focus-return behaviour should otherwise survive a class/style change without remounting.

3. **F3 — P2, established: the horizontal calculation omits the offset added by CSS.**  
   The helper calculates `room = windowWidth - fit.margLeft - 12`, but CSS then moves the panel right by half `--marg-gap`. That consumes room the helper already allocated.

   Using the actual fit at 1440px with Structure and Marginalia:

   | Root font | Proposed width | Remaining right gutter |
   |---|---:|---:|
   | 16px | 276px | 2px |
   | 20px | 276px | −0.5px |
   | 24px | 276px | −3px |

   Subtract the actual left offset **before** applying the minimum and width cap. Also define the helper’s output clearly: `Fit` plus window width supplies the available pixels; CSS can apply `min(26rem, …)`. A helper returning the final numeric width needs the root-font measurement too.

4. **F4 — P2, established: the proposed tests leave the production wiring unchecked.**  
   A `ChatDialog` test given `docked` manually passes even if `Reader` never computes or supplies it. Likewise, “never overlaps prose **when docked**” passes if nothing docks.

   Add a check through the Reader wiring that positively asserts docking occurs in an eligible layout. Assert actual panel bounds, including the gutter, and exercise resizing across the threshold while a draft remains open. For the block mark, [`TableView`](/home/greg/code/spideryarn2/.claude/worktrees/fbnseuz2-block-chat-margin/src/web/TableView.tsx:1530) currently constructs its classes directly; there is no general per-block-class prop to test. The test must cover whichever real path supplies the anchor and draws the rule.

5. **F5 — P3, established: finishing a tool does not establish that the model is now writing its answer.**  
   [`converse.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fbnseuz2-block-chat-margin/src/converse.ts:2443) can start another model round and request more tools. The spinner condition is sound, but the plan overstates what “writing the answer…” proves. Consider keeping “thinking…” throughout the empty-text wait, or explicitly treating the new wording as an approximation.

The spinner gap is real. I drove the reducer through a running tool followed by its completion: the projected message remained `pending`, with empty text and a finished tool row. [`turn.tool`](/home/greg/code/spideryarn2/.claude/worktrees/fbnseuz2-block-chat-margin/src/web/chat/reduce.ts:953) changes only the tools; text and completion arrive separately. The gap lasts until another tool starts, text arrives, or the turn terminates/recovery intervenes. It spans a further model request and can therefore be substantial, but the specific “seconds long” claim is not measured here. Provider-internal web searches alone do not create these tool rows.

`--marg-left` otherwise means what the plan thinks: the table’s right edge, with the safe-left inset added in CSS. Both `fitMargin` and `fitBoth` support the calculation. Reader’s window width already excludes horizontal safe-area insets and the classic scrollbar.

I found no new ordering inversion with the dock or controls bars. Retaining `.chat-dialog` preserves the narrow-window rule that keeps the dock visible; the return chip remains over the prose on the left. Higher overlays retain their precedence. I could not identify a separate fixed jobs tray at this base, so its coexistence is unverified.

The simpler version of A is **horizontal docking with the existing bottom anchor**. It clears prose and associates chat with the right column while retaining the established keyboard geometry. Option B is also cheaper than described in two respects: it can reuse the conversation components, and its font/selection styles can be overridden locally. Its scrolling and note-collision costs remain real.

**Verdict: build after changes.**