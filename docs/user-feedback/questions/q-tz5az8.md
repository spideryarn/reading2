---
id: q-tz5az8
report: spya-yk3r03
status: open
asked: 2026-10-17
title: Should the guide get more room to reword what you tell it before saving it without a press?
refs: follows q-pm2j66 (reply spya-v33gfs) · qi-mr3tgs7w · docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md · docs/investigations/261009c-the-guide-s-offers-to-save-measured.md · docs/user-feedback/261011_0139-the-guide-saves-your-profile-in-your-words.md · SPIDERYARN-READING2-H8 · src/save-closeness.ts
---
You asked me to build the light rewording (done, on dev) and to tell you if there is good reason to give the guide more room. My answer: not yet. On our test conversations it now saves 11 of 14 offers by itself, up from 9, and of the 3 left only one could ever save itself under a looser rule.

A. Leave it light for now, and look again if you find yourself pressing Save a lot. Costs nothing. Gives up: a tidied sentence that drops or changes a word still needs your press.

B. Test the wider form without building it: a second AI that sees only your sentence and the guide's words, never the article, judges whether they say the same thing. An agent runs it against attacks and real rewordings and brings you the numbers. Costs an agent's afternoon and a few dollars. Gives up: nothing built; you decide afterwards.

C. Let the guide drop the end of your sentence after a comma, with no second AI. Saves the one case we saw. Gives up safety: "I am a surgeon, in the game" would save as "I am a surgeon", which is the kind of cut GPT Sol has broken every looser rule with.

Recommended: A. The gain on our tests is one offer in fourteen, and the cost of being wrong is a sentence about you, in every later answer, that you did not quite say. B is worth doing if you see real misses in use.

Details

What is built. Since today, the guide's offer to save "why you're reading" or "About you" saves itself, with an Undo, when it is either your exact words or one whole sentence you typed with only the spelling tidied: "I'm" as "I am" (or back), a capital, a full stop, and "Preparing for" in place of "it's for" in a reason. The card says "lightly reworded" and shows your own sentence under it. Both kinds now refuse anything with quotation marks, a question, a link or an address, words like "ignore" or "instructions", or (for About you) the word "you", which is the shape of an instruction to the AI. The security register has a Medium entry for it, quoting your acceptance.

What the test showed. Fourteen offers across seven made-up conversations, run twice. 10 saved as exact words, 1 as a light rewording, 3 went to the button. Two of those 3 were corrections, where you change what About you already says ("I left the lab last year"); those must always wait for your press, under any rule, because a save without a press only ever adds to the end. The third was "I'm a historian of science, not an AI person, so go easy on the technical bits", offered as "I am a historian of science, not an AI person." It dropped the second half, so it needs a press.

Why not more room by a fixed rule. Every rule looser than "spelling only" that Opus and GPT Sol tried was broken by small changes that flip meaning: dropping "a" turns "a little experience" into "little experience"; cutting at a comma turns "In the simulation, I am a surgeon" into "I am a surgeon". Option C is that comma cut, at the end of a sentence instead of the start.

Why B is the only real way to more room. A second AI can judge meaning, which a fixed rule cannot, but it can also be wrong or be talked round by the very words it is checking. GPT Sol called it "a fallible semantic check, not a provenance guarantee". The test in B would say how often.

What would decide it. Whether you, using the guide, notice it asking you to press Save for words that were obviously yours. If so, B; if not, A.
