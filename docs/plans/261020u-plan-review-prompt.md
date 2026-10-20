Read-only plan review. Repo root is the current directory (Spideryarn, a reading app).

Plan: docs/plans/261020u-backspace-takes-the-way-back.md. A non-admin reader asked for Backspace to press the "back to X" way-back chip (src/web/ReturnChip.tsx). The plan does not build; it brings options A (Backspace while the chip shows), B (letter B), C (nothing) to Greg as a question.

Check, against the code and docs (docs/project/keyboard.md, src/web/key-chord.ts, src/web/TermJump.tsx, src/web/DockQuickSearch.tsx, src/web/reader/Reader.tsx returnFromJump, src/web/ReturnChip.tsx):
1. Are the factual claims right? Especially: no global Backspace handler exists; browser Back differs from the chip (restores ?mode=); current browser behaviour of Backspace in Chrome, Firefox and Safari (desktop and iPadOS with a keyboard) — say what you know and how sure.
2. Missing downsides or conflicts: screen readers (NVDA/JAWS browse mode, VoiceOver), Escape tiers, an open dialog/drawer, focus on the chip's own buttons, the phone "back to <mode>" pill, Backspace in a type=search or contenteditable, the glossary list focus after G.
3. Is the recommendation sound, and is the build sketch (listener in the visible chip, reuse key-chord.ts) the right shape? Any letter B conflict?
4. Is going to Greg (rather than building) the right call under docs/project/feedback-reports.md § Who sent it and Greg's 2026-10-19 rule quoted in the plan?

Write findings as a numbered list, each with severity, then a final line "VERDICT: proceed | proceed with changes | rethink".
