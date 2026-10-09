# scaling-hypothesis — summary-fuller — D-haiku

This is an essay by Gwern about GPT-3, a language AI that OpenAI announced in May 2020. It is the largest neural network ever trained, with 175 billion adjustable numbers called parameters. It learns by predicting the next word in huge amounts of Internet text, and the essay's main subject is the scaling hypothesis: the idea that bigger neural networks, trained on more data with more computing power, keep getting smarter.

<sub>spya-ewxv9q, spya-aqts9c, spya-suzdvz</sub>

Gwern argues this matters because the jump from GPT-2 to GPT-3 did not level off, as many experts had expected. GPT-3 is expensive by machine-learning standards but cheap by scientific, commercial, military, or government budget standards, so models could be made much larger. His bigger point is that size alone, rather than clever design, might be the key to human-like general intelligence.

<sub>spya-ewxv9q, spya-ag750z</sub>

The first finding is meta-learning: GPT-3 can learn new tasks from a few examples written in its prompt, with no extra training. It did this on arithmetic, English translation, unscrambling anagrams, and SAT analogies, with no specialized training at all. The second finding is about size: the model's loss, a score where lower means fewer prediction mistakes, kept falling as models grew. Gwern estimates that GPT-3 roughly halved the loss of GPT-2, from about 3.3 to about 1.73, and the trend showed no clear bend yet.

<sub>spya-ewxv9q, spya-aqts9c, spya-edr6mj</sub>

Gwern's pretraining argument says a model passes through stages as its error, measured in bits per character (how many yes-or-no guesses it needs per letter), falls. Early on, the model learns letter frequencies and that a space comes about every five characters or so. Next it learns which words exist, and its error falls to around three to four bits per character. Then it learns which words tend to appear together, pushing its error below about three bits per character.

<sub>spya-r465ug, spya-hbr5sy, spya-s3g2e7</sub>

Gwern argues the progress was predictable, because Hans Moravec in 1998 expected cheap computing power to rival a human brain sometime in the 2020s. He says many respected experts predicted that this approach would fail, and few have admitted they were wrong. He describes their confident tone as phatic rather than predictive, meaning it sounds like a forecast but makes no testable predictions.

<sub>spya-ad5qgy, spya-m9r8zx, spya-kdcvq7</sub>

A second concern is agency: Gwern argues that powerful models trained on human writing become agents, meaning goal-seeking actors, when prompted the right way. He argues agency is a continuum rather than an on-off switch, so filtering out agent-like data may not stop it. His conclusion is that tool AIs may well become agent AIs, and the more capable they get, the more likely this is.

<sub>spya-mkbrjp, spya-hjpau9</sub>

Gwern admits that nobody, as far as he knows, can say what a larger model would learn or when new abilities would appear. He ends by asking whether the 2020s will bring a sigmoid, an S-shaped curve that levels off, or a singularity, a runaway explosion of progress. The piece's main conclusion is that scaling has so far worked better than expected, and the open question is how far it goes.

<sub>spya-f6zupy, spya-suzdvz</sub>
