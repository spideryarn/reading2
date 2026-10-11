---
id: q-a0qp3x
report: spya-x6qjbn
status: answered
asked: 2026-10-11
title: Should dictation get a second pass that adds paragraph breaks?
refs: SPIDERYARN-READING2-HF · qi-6n5th4qh · docs/plans/261011i-dictation-failures-reach-sentry.md · docs/user-feedback/261011_0150-dictation-paragraph-breaks.md
acted: spya-rg47vu
---
You asked for a small tweak to the dictation clean-up prompt so it adds paragraph breaks. There is no clean-up prompt to tweak, and the transcriber ignores the instruction if we try to give it one (tested today). So the only way to get paragraph breaks is to add a new step after the transcriber. Do you want that?

A. Leave it. Dictation stays one paragraph, as now. Costs nothing.
B. Add a small second model call, used only on longer dictations (say over 400 characters), whose one job is to put in paragraph breaks. A check in code makes sure it changed nothing but line breaks; if it changed anything else, we keep the original words. Costs about 1 to 2 extra seconds before the words land, plus a fraction of a cent each time.
C. As B, but only in the Feedback box and the profile boxes, where people dictate long passages. Chat, comments and the quiz stay as they are, with no extra wait.

Recommendation: C. The long, rambling dictations are where paragraphs help, and that is where an extra second matters least.

Details

What you saw. With dictation there seem to be two stages: a quick one, then something that tidies the words up. That is right, but the second stage is not a language model tidying up. The first stage is your browser's own speech recogniser showing words as you speak (Chrome only; Safari has none). Those words are just a preview and are thrown away. The second stage sends the recording to OpenAI's transcription model, and its words replace the preview. That model is sent no instructions, only the audio and a list of words likely to come up (the article's terms, Spideryarn, and so on), so there is no prompt to edit.

What I tested, 11 October. I made a 42-second recording of three separate points with a two-second pause between each, and ran it through the transcriber five ways: as normal; with "start a new paragraph wherever the speaker moves on to a new point" sent through OpenRouter in two different ways; and the same with and without that instruction sent to OpenAI directly. Every time it came back as one paragraph, so the model ignores the instruction, and it is not OpenRouter dropping it. I also asked for the version of the answer that includes the timing of each phrase, which would let simple code break on long pauses. That model refuses to give it.

So any paragraph breaks have to come from a second step. The risk with a second model call is that it does more than add line breaks: it fixes a word, smooths a sentence, and your words stop being your words. The check in B and C rules that out mechanically. It compares the before and after with the line breaks removed, and if they differ at all, the original is used. The cost is the extra wait on a call you are sitting watching, which is why C keeps it out of the chat box.

What would change the answer: if you mostly dictate short things into chat, A. If the Feedback box is where you notice it, C.

Greg's reply, 2026-10-11 (spya-rg47vu, in the Feedback dialog):

> A

Acted on by the feedback sweep, 2026-10-11 (queue item qi-zmdjcrnn): dictation stays one paragraph, no second pass. The report's note now ends declined.
