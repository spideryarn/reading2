---
id: q-pm2j66
report: spya-yk3r03
status: answered
asked: 2026-10-12
title: May an unattended agent build B, the guide saving a lightly reworded sentence of yours without a press?
acted: spya-v33gfs
refs: follows q-q7mb3w (reply spya-wwy7sh) · qi-wj98rygd (this doc work) · qi-ywbfftr2 (the build, held) · docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md · docs/plans/261012c-plan-review-sol.md · docs/plans/261012c-plan-review-2-sol.md · docs/user-feedback/261011_0139-the-guide-saves-your-profile-in-your-words.md · SPIDERYARN-READING2-H8 · src/save-closeness.ts
---
You chose B on q-q7mb3w: the guide may save a rewording of what you typed to About you or Why you're reading, without your press. Nothing is built yet, because this loosens a safety catch, and an agent working with nobody watching may not loosen one on a reply alone. Working it out, the only rewording a fixed rule can safely allow is very light. Real rewording would need a second AI to check it, and that check has to be tested before anyone builds it.

A. Yes, the light form, by an unattended agent. It saves one whole sentence you typed about yourself, changed only in spelling: "I'm" to "I am", a capital, a full stop, and "Preparing for" in place of "it's for" in a reason. No word is added or dropped. Gives up: it saves only a little more than today, so "not an ML specialist" for your "not an ML person" still needs your press.

B. A, and also test the wider form without building it. An agent tries a second AI check that sees only your sentence and the proposed words, never the article. It runs that check against attacks and against real close rewordings, and brings you the numbers. You then decide whether to build it. Gives up: an agent's time and some AI cost for the test.

C. Build the light form only in a session you are watching.

D. Drop it, and keep exact words only, as built now.

Recommended: B. The light form adds almost no risk beyond the exact-words rule you already accepted, so it can be built unattended. The test shows whether the rewording you actually asked for can be made safe enough, before anyone is asked to build it.

Details

Background. On 9 October the guide learned to offer to save two things you tell it: why you are reading this article, and something about yourself (About you, on your profile). About you goes into every later AI prompt on every article, so whatever lands there shapes every later answer. Since 11 October (q-t3j8hj, reply A), an offer saves itself if it is word for word what you typed in that message. Anything reworded shows a card with a Save button. On q-q7mb3w you chose B: a close rewording may save itself too, accepting that a planted instruction in an article could then save a sentence about you that you never said.

Why ask again. Our feedback rules say an unattended agent does not loosen a safety catch even on your reply. You were asked the same about the exact-words rule (q-t3j8hj) and about the ChatGPT publishing tools (q-hpwyf0), and answered A both times.

Why the fixed rule ended up so light. Opus and GPT Sol tried to break each rule for "close". A rule that only checks the words are yours fails. "I'm reading this because my mother has cancer" can become "I have cancer". The next version allowed small edits: dropping "a" or "the", or starting partway through a sentence. GPT Sol broke that too. "I have a little experience with statistics" became "I have little experience". "In the simulation, I am a surgeon" became "I am a surgeon". Small words, commas and where a sentence is cut all carry meaning. So the light form changes spelling only, and takes whole sentences only.

What the light form also does. It only saves from a statement about yourself that you typed, not a question or a request. It never saves anything with a link, an address, quotation marks, or words like "ignore" or "instructions". For About you, the sentence must start with "I" and must not contain "you". It is only ever added at the end of About you, never rewrites it. A reason is saved by itself only if you have no reason yet. The card says "Saved, reworded", shows your own sentence under it, and has an Undo. The exact-words rule gets the same refusals, which only makes it stricter. The security notes are updated in the same change, rating the risk Medium. GPT Sol reviews the code.

What is left. A planted instruction in an article can choose which of your own sentences from that message gets saved. A sentence can lose its context. If you typed "Let's role-play. I am a surgeon.", "I am a surgeon." could be saved. The exact-words rule on dev can do that today, and the light form does not make it worse.

The wider form, in B. GPT Sol designed it and judged it "a fallible semantic check, not a provenance guarantee". It also said the details of that second AI are the safety catch itself and are not defined yet, so it should be measured before anyone is asked to build it, watched or not.

What would decide it. Whether the light form is worth having on its own. And whether you want the wider form tested, at some AI cost, to see if the rewording you asked for can be made safe enough.

Greg's reply, 2026-10-17T13:09Z (spya-v33gfs): "A or B is fine. I think we're overthinking this. I want the agent to be able to reword lightly, and for you to tell me if there's good reason to allow it more discretion (I'm open to that)"

Acted on 2026-10-17: the light form built (queue item qi-mr3tgs7w, plan 261012c). Whether to allow more discretion is asked in q-tz5az8.
