# scaling-hypothesis — summary-fuller — A-opus

This long essay by Gwern looks at GPT-3, a text-predicting program from OpenAI released in May 2020, and what it says about AI's future. GPT-3 is a neural network, a program that learns patterns from examples, with 175 billion parameters, the adjustable numbers it tunes while learning. It was trained only to guess the next word in a huge pile of Internet text. Gwern uses it to argue for the scaling hypothesis: simple networks, made far bigger and given far more data and computing, keep getting more intelligent.

<sub>spya-ewxv9q, spya-aqts9c, spya-suzdvz</sub>

The piece says GPT-3 matters because it showed meta-learning, which means learning how to learn. Shown a few examples in its prompt, it could do new tasks like arithmetic, translation or unscrambling words, with no extra training. Gwern stresses it is an old, simple design trained in the "dumbest way possible", yet its gains from size have not slowed. He adds that it is cheap by business or government standards, so much larger models are possible.

<sub>spya-aqts9c, spya-fvqe70, spya-ewxv9q</sub>

The main evidence is scaling curves: graphs showing a model's prediction error falling smoothly as it grows. Gwern expected the curves to bend by about 100 billion parameters, but GPT-3 kept to the trend of much smaller models. Its training used 3640 petaflop/s-days of computing, about twice an estimate for the Go program AlphaGo Zero. By his sums, error fell from about 3.3 for GPT-2 to about 1.73 for GPT-3, and might reach 1.24 with 100 to 1000 times more computing.

<sub>spya-asr663, spya-uz2hd5, spya-edr6mj</sub>

Gwern calls this the blessings of scale: for these networks, bigger and harder problems can be easier to solve than small ones. His suggested reason is that a big network holds countless smaller sub-networks which, averaged together, favour simple solutions. Small models with little data settle for memorizing or shallow shortcuts. With enough data, memorizing every sum costs too much, so the simplest way to predict the text becomes real arithmetic.

<sub>spya-sfkxh8, spya-grkhs8, spya-vkkfzh</sub>

To show why plain text prediction could teach so much, Gwern tracks a model's error per character, measured in bits. A random guesser needs 8 bits, and just learning how often letters and spaces appear cuts this to about 5. At around 2 bits sentences start to make sense, but each further gain costs more. Humans manage about 0.7 bits, and that gap holds everything the model still misses, such as reasoning and common sense.

<sub>spya-r465ug, spya-x3c389, spya-rjwfkb</sub>

Gwern admits this argument long felt to him like a magic trick: neat in theory, unproven in practice. It might have needed more text than exists, impossibly huge models, or a wholly different design. He says he does not know what a much bigger model would learn, and even the projected drop would, as far as he can tell, fall short of human level.

<sub>spya-e5n86h, spya-faees7, spya-edr6mj</sub>

Gwern argues the main limit now is people's belief in scaling, not hardware. He says DeepMind holds a "weak scaling hypothesis", building brain-like parts one by one, while OpenAI bets that scale alone is enough. He faults experts who predicted failure, were wrong, and rarely admit it.

<sub>spya-khnsat, spya-vr9q2p, spya-m9r8zx</sub>

An appendix argues that agency, the ability to plan and chase goals, may emerge even in models trained on physics or random programs, not just human text. So removing human data is no reliable way to keep a "tool AI" from becoming an agent. His conclusion is that the deep learning revolution "has begun as foretold", and the 2020s may bring either a levelling off or something far bigger.

<sub>spya-mkbrjp, spya-hjpau9, spya-suzdvz</sub>
