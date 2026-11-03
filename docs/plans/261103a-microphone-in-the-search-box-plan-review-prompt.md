You are reviewing a plan, read-only. Repo: Spideryarn (TypeScript, React). Read
docs/plans/261103a-microphone-in-the-search-box.md, then the code it touches:
src/web/SearchPanel.tsx (the `Box` component, ~line 509-870), src/web/useDictationField.ts,
src/web/DictationStrip.tsx, src/web/modes/search/SearchMode.tsx (useTypingSession ~line 420-520),
src/web/quick-session.ts, src/web/CommandBar.tsx (its dictation wiring ~2535-2580, ~3025-3070) and
docs/project/dictation.md § Adding it to a box.

Find what is wrong or missing: races between the dictation hook and the typing session (blur/focus
timers when the mic button takes focus, the pause timer, flush), words-mode `?find=` writes, the
matcher switch mid-dictation, the bar's shared draft (src/web/search-draft.ts), the `ready`/`repeat`
guards when `onDone` runs, phone layout, and anything the house pattern requires that the plan
skips. Rank findings P1/P2/P3 with file:line evidence. Be concise.
