# Plan review: 261008d

You are reviewing a plan, read-only. Repo: Spideryarn (this worktree). Read
`docs/plans/261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md`, then the code it
names: `src/web/DictationStrip.tsx` (the strip, `DictationButton`), `src/web/useDictation.ts`
(around line 860-880 where `deviceLabel` is cleared at stop; `beginCapture` near line 2200),
`src/web/useDictationField.ts` (the 600 ms double-press window, `again`), `src/web/ChatPanel.tsx`
(composer, ~line 3200-3300), `src/web/styles/mode-band.css` (the chat band and composer), and
`docs/plans/261005a-dictation-double-press-on-stop-also-sends.md` for background.

Questions:
1. Is keeping the "Microphone: … Change" line (and the "Couldn't use" warning) through the
   transcribing phase the right fix for the 28.7 px drop at Stop? Is there anything else in the strip
   or composer that changes height or position at the armed→transcribing transition (in Chat, in
   Learn mode's composer, in Feedback, comment, quiz, annotate, command bar) that would still move the
   button? Consider `deviceLabel` being null on some browsers (no label until permission; iOS).
2. Is the adjust-state-during-render pattern correct here, StrictMode-safe, and does it avoid a
   painted frame without the line? Would a simpler shape be better?
3. Part 1's conclusions about WebKit microphone grants: anything wrong or overstated? Is there any
   page-side lever we missed that is acceptable (not a held-open microphone)?
4. Anything in the plan that is unclear, or a simpler option we passed over wrongly.

Write findings as a numbered list with severity (P0-P3), file:line, and a one-paragraph reason each,
then a one-line verdict: build as is / build with the fixes / rethink.
