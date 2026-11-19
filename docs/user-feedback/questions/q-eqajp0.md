---
id: q-eqajp0
report: spya-gjcyq3
status: open
asked: 2026-11-03
title: Should Paint again stop the microphone and repaint when pressed while you are still talking?
refs: docs/plans/261103b-send-while-dictating-stops-and-sends-in-every-box.md · docs/plans/261005a-dictation-double-press-on-stop-also-sends.md · qi-n3edc73j · qi-wd4mg6p6 · docs/user-feedback/261103_1124-send-while-dictating-stops-and-sends.md
---
Pressing Send while dictating now stops the microphone and sends once your words are in, in every box that has a Send. I left one box out: the note under an Illustrated picture, whose button is Paint again. Should it work the same way?

A. Yes. Press Paint again while talking and it stops the microphone, waits for your words, then starts the repaint with them. A double press on Stop still does nothing there. Cost: a paid repaint of about a minute starts on words you have not read, and one small extra option in the shared code, because today "has a done action" and "takes the double press" are the same switch.

B. No, as now. Paint again stays greyed out while you are talking, and you press it once your words are in the box. Nothing new to build.

Recommendation: A. Pressing Paint again is a clear "go", unlike a double press on Stop, which is the accident you held back on 5 October. But B costs nothing if a misfired repaint worries you more than one extra press.

Details

Your report (spya-gjcyq3, today): someone pressed Send in Chat while still dictating, saw a message, and nothing was sent. You asked for Send to stop the dictation and send in one go, in every box with a microphone where that makes sense.

What is done (on dev, not deployed): every box with a Send, Answer, Save, Ask or Enter now does this. That covers Chat, the comment follow-up, Annotate's Save, both quiz boxes, Feedback and its reply box, Help, the command bar's Enter and its "Ask what you meant" button, Search, Candidates, Referee's new criterion and Skim's purpose. If the words don't come through, nothing is sent and the box says "Nothing was sent."

Why Illustrated is different: Paint again starts a new picture, which takes about a minute and costs money. On 5 October, asked whether a double press on Stop should repaint, you said yes for the command bar only, and Illustrated stayed without (plan 261005a). A press on Paint again is a much clearer signal than a double press, so this is a new question, not the old one again.

What would decide it: whether one wasted repaint now and then (A) bothers you more than having to press once more after you stop talking (B).
