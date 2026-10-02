Opening **Search mode on the first pause, with focus remaining in the dock**, is the right results destination. Reuse its list and prose marks; a second results surface would add unnecessary state.

The revise approach is reasonable, but the attempt fence protects **finishes**, not request ordering or client updates.

1. **F1 — P1: Wait for the opening GET before asking.**  
   Evidence: plan `:72–80`; `src/web/useSearch.ts:295–307` replaces the list when GET arrives; `SearchPanel.tsx:501` currently gates submission on `loaded`.  
   **Fix:** carry the latest pending intent through mount and submit only after `loaded`. Enter bypasses debounce, not this gate. Test a delayed GET arriving after typing.

2. **F2 — P1: Mount currently steals dock focus.**  
   Evidence: plan `:80`; `src/web/SearchPanel.tsx:492` unconditionally focuses the panel input.  
   **Fix:** suppress panel autofocus for dock-origin activation; retain it for the phone button and ordinary Search activation. Use `focus({ preventScroll: true })`. Verify the next character still enters the dock input.

3. **F3 — P1: The fence does not make revisions arrive in typing order.**  
   Evidence: plan `:117–122`; `src/store/pg-searches.ts:152–185` serializes database transactions by arrival; `:378–389` fences only `finish`.  
   A revision can reach `begin` before the initial insert, or an older revision can begin after a newer one and become authoritative. Aborting fetch does not roll back server work.  
   **Fix:** serialize through each `begin` acknowledgement, coalescing queued edits to the latest text; then abort the superseded model call. Alternatively add a server revision sequence. Use a distinct revision UPDATE that sets `criterion`; the retry UPDATE at `:199–221` requires the old criterion and `error` status.

4. **F4 — P1: Client frames also need an attempt fence.**  
   Evidence: `src/web/useSearch.ts:473–508` checks ownership for cleanup, but `:534–589` applies frames/errors without checking it.  
   An old `begin`, `follow()`, hit, or catch can overwrite the revised row or rename its `?runs=` entry.  
   **Fix:** invalidate the old send synchronously and check its generation before every state mutation and rename. Preserve tombstones; ordinary revision must not resurrect a deleted session row. Test stale frames and catches after replacement.

5. **F5 — P1: Session endings need explicit event rules.**  
   Evidence: plan `:125–128`; `SearchMode.tsx:118–130` always creates and activates a new row, with `isRunning` potentially refusing Enter.  
   **Fix:** Enter/find flushes changed text into the current session row, then seals it; unchanged text does not trigger another call. Seal even when that query is already running. Revisions neither append duplicate URL ids nor retick a row the reader unticked. Add mode departure, article departure and ↺ reuse to the boundary rules; remounting retained text must not issue another paid search.

6. **F6 — P1: Moving `useState` alone does not produce one shared draft.**  
   Evidence: `src/web/SearchPanel.tsx:495–521,557–559`: words mode reads/writes `?find=`, while quick/meaning use the draft.  
   **Fix:** define the handoff with `?find=` and distinguish dock quick intent from panel edits. Typing in words or meaning must not accidentally launch quick calls. Matcher changes preserve text and end the session; ↺ starts fresh rather than overwriting the current session. Fetches never populate the draft. The “fetch can take the text away” section is historical: `docs/project/search.md:994–1000` records its removal.

7. **F7 — P2: Cancellation already has a shared server seam.**  
   Evidence: `src/routes.ts:1321–1367` provides `sse(res).gone`, including already-closed responses; `src/search.ts:207` accepts a signal.  
   **Fix:** pass `gone` to both matchers instead of adding another close listener. Handle expected abandonment without reporting a fault, but still finish the attempt through the fence so cancelled rows do not remain pending and escape trimming. Make `searching` ownership/count aware: the old attempt’s `finally` at `:4449` currently removes the newer attempt’s identical key.

8. **F8 — P1: Specify the dock capability gate.**  
   Evidence: `src/web/Dock.tsx:1616` supports visitors; `src/web/reader/Reader.tsx:2343–2355` mounts the requesting band only for owners.  
   **Fix:** show the input/button and register its shortcut only on an owner’s processed reading view. Otherwise the new control promises an action the mounted band cannot perform.

9. **F9 — P2: The width fallback is sensible; its focus behaviour is unspecified.**  
   Evidence: plan `:160–163`; `src/web/dock-fit.ts:164–174` probes rungs synchronously through CSS classes.  
   **Fix:** size the control through those classes, with `flex: none`; do not require React to swap controls during measurement. Handle focus when the final rung hides the input. Check 768px portrait, landscape, experimental modes and rotation while typing—not only 1440/1024/390.

10. **F10 — P2: `/` clashes with Firefox Quick Find.**  
    Evidence: plan `:152–156`; [Mozilla documents `/` as Quick Find](https://support.mozilla.org/en-US/kb/search-contents-current-page-text-or-links).  
    **Fix:** choose an unbound key, or explicitly accept that browser override. If retaining `/`, include `defaultPrevented`, IME, editable and modal guards; do not copy G’s Shift rejection blindly because some layouts require Shift to type `/`.

Precisely: a session starts with the first deliberate quick edit, acquires a row on its first submitted query, and retains that id across pauses. Enter/find seals it after flushing; clearing, matcher change, reuse, deleting/fleshing out its row, or leaving the mode/article seals it and cancels queued debounce work. Blur alone should not end it, since focus can move between the two boxes. Retained text stays inert until another deliberate edit.

A simpler option gets most of the value: **⚡ button plus shortcut, opening the existing quick panel before typing**, with debounce there. It avoids shared drafts and responsive input focus handling. Keeping one revised saved row is preferable to new-row/delete-old; save-on-Enter changes the persistence promise.

**Verdict: proceed with changes.**