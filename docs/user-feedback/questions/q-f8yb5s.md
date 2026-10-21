---
id: q-f8yb5s
report: spya-yjnpjg
status: answered
asked: 2026-10-20
title: Should Backspace press the "back to ⟨section⟩" chip, as a reader asked?
refs: SPIDERYARN-READING2-MM · qi-77s6w6mb · qi-6a56cdns · docs/plans/261020u-backspace-takes-the-way-back.md · docs/plans/261020u-plan-review-sol.md · docs/user-feedback/261019_2146-backspace-takes-the-way-back.md
acted: spya-dzfvs2
---
A reader asked for a keyboard shortcut for the "↩ back to ⟨section⟩" chip, and asked for Backspace. Should we add it?

A. Backspace, but only while the chip is on screen (recommended). It does exactly what pressing the chip does: your position goes back, the modes stay. It never fires inside a text box, with a modifier held, on a held-down key, or while Chat, a comment box or the bar's drawer is open in front. The chip shows a small ⌫ so readers can find it. About an hour plus tests, after checking what Safari on a Mac does with Backspace. What it gives up: while the chip is up, someone who thinks they are still typing, but whose cursor has left the box, moves the article instead of deleting a letter. The browser's Back undoes that.
B. Nothing new. A keyboard reader can already Tab to the chip and press Enter, or use the browser's Back (Alt+← or ⌘[). But Back also puts back the mode you were in before the jump, which is what you asked the chip not to do on 2026-10-08.

If A: on a phone, after the first press, a "back to ⟨mode⟩" pill takes the chip's place. Should Backspace press that too? I suggest not (section chip only): phones rarely have a keyboard, and it keeps the key to one meaning.

Details

The chip appears after a deliberate jump inside an article: a glossary term, a cross-reference, a press on a section in Structure. It says "↩ back to" and the section you left, moves only your position when pressed, and goes by itself after 30 seconds (your 2026-10-17 change), unless a mouse or focus is resting on it. The reader was in Structure mode on the cephalopod sentience review when they asked.

Is Backspace safe? Nothing in the app uses it outside a text box (only the tag editor, inside its input). Chrome stopped Backspace meaning Back in 2016 and Firefox in 2021. Safari on a Mac may still use it for Back. That would be checked before building: if it does, Backspace would be our gentler back while the chip shows and Safari's full Back once it has gone. The screen reader JAWS uses Backspace for "back a page" itself, which is harmless here.

Why not a letter, such as B for back? GPT Sol pointed out that B already means "next button" in all three common screen readers (JAWS, NVDA, VoiceOver), so it is worse than Backspace, not safer.

Opus recommended A, built straight away. I have not built it: it is a new key in the reading view with a real, if small, downside, and your 2026-10-19 rule says a reader's suggestion in doubt comes to you first.

Your reply, 2026-10-20 21:46 UTC (spya-dzfvs2): "A. And use your judgement"

Built as A, for the section chip only: the phone's "back to ⟨mode⟩" pill does not take Backspace. One judgement call went beyond the question. Unlike G, the key also works when focus is on an ordinary button or on Structure's list. A press on a section in Structure can leave the focus there, and that is where the reader asked from. It still does nothing in any text box, in a picker, or while a dialog is open. Safari on a Mac was not tested, because this was built on the Linux box. That only matters once the chip has gone: while it shows, our handler takes the key, so Safari's own Back cannot run.
