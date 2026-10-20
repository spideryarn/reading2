---
id: q-vcxe83
report: spya-evtsag
status: open
asked: 2026-10-19
title: Dictation on Safari, the iPad and Firefox shows no words until you stop. Should it show a rough preview while you talk?
refs: SPIDERYARN-READING2-M2 · SPIDERYARN-READING2-M9 · spya-za4bxk · qi-4v6sx4rw · qi-c3v228da · docs/plans/261019m-dictation-records-from-the-first-word-and-a-preview-everywhere.md · docs/plans/261019m-dictation-plan-review-sol.md · docs/user-feedback/261019_2018-dictation-preview-on-every-browser.md · docs/user-feedback/261019_2032-dictation-records-from-the-first-word.md
---
You asked for a preview of what is being said wherever there is a Dictation button. Chrome and Edge already have one. Safari, the iPad and Firefox show nothing until you press Stop. What should those three do?

A. Leave them as they are. The level meter shows the microphone is hearing you, and the line under the box says "the words appear when you stop". No cost, no risk.
B. A rough preview from short clips (recommended, if you want it at all). While you talk, every 5 seconds the last 5 seconds are sent to the same transcriber we already use, and their words show greyed out under the box. Your real words still come from the whole recording when you stop. It costs about as much again as the dictation itself (roughly half a cent a minute), and audio is now sent while you talk rather than only at Stop, so the privacy page would say so. About a day's work, but it first needs a test on a real iPhone, because a second recorder running beside the real one might break the real one there. If it does, Safari gets no preview and I tell you.
C. A live streaming transcriber: OpenAI's realtime transcription, the same service Live conversation already talks to. This is the best preview, word by word, and it might later replace the two-pass design. But it widens the one exception to "every paid call goes through OpenRouter" from Live conversation to dictation, and it is the biggest job of the three.

Details

Two of your reports from 2026-10-19 evening. The first said a reader found dictation good but it kept missing the start of what he said. That one is fixed and on dev, not yet deployed. On Chrome and Edge the recording only began about a second after the microphone opened, because it waited for the browser's own speech recogniser to start up, and anything said in that second was lost. It now starts the moment the microphone opens, on every browser. While the microphone is still opening, the line under the box says "Wait — opening the microphone…", and the button is outlined and pulsing. Once it is filled in, it is recording.

The second report is this question. Chrome and Edge already show a preview: their built-in recogniser's guesses appear as you talk and are replaced by the real transcript at the end. Safari and Firefox cannot do both at once, because Safari allows only one use of the microphone per page, and we use it to make the recording that gets your vocabulary right. So there the preview would have to come from us.

I planned B and had GPT Sol review it before building. It found four things that made me stop and ask. First, the iPhone risk above, which I cannot test from the server. Second, the fleet dashboard's transcriber allows ten calls a minute, so the clips would use up the allowance the final transcript needs, unless that limit is changed. Third, the clips would need marking as previews, so that their failures do not reach Sentry and their cost shows separately. Fourth, sending audio while you talk, more than once, is a change to how a reader's voice travels, even though it goes to the same place, and I was told that is yours to decide.

Pick A if Chrome's preview is enough for now. Pick B if you want Safari and the iPad to have one soon, and can try it on your iPhone. Pick C if you would rather wait for the better version and accept a second use of the OpenAI exception.
