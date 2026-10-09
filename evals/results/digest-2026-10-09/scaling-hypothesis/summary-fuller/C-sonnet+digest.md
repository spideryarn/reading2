# scaling-hypothesis — summary-fuller — C-sonnet+digest

This essay by Gwern is about GPT-3, a language model from OpenAI released in May 2020 and trained to predict the next word of Internet text. It argues for the scaling hypothesis: simple neural networks, made much bigger and given more data and computing power, keep gaining more general, human-like abilities. The hypothesis treats this as the secret of general AI, meaning machine intelligence as broad as ours.

<sub>spya-suzdvz, spya-ewxv9q</sub>

The author says it matters because GPT-3 is the largest network ever trained, by over ten times, and still did not hit diminishing returns. Training it is costly by machine learning standards, about 5 million dollars, but cheap next to science, military or government budgets. So models could be made much larger, and he says AI researchers' forecasts lack any coherent model of how progress happens.

<sub>spya-ewxv9q, spya-dfjr4c</sub>

GPT-3 has 175 billion parameters (the adjustable numbers inside a network), 117 times more than GPT-2. Given only examples written into its prompt, the text it must continue, it handles arithmetic, translation, anagrams and SAT analogies with no extra training. The author calls this meta-learning: learning how to learn. He finds GPT-3 scary because its design is old, simple and badly used, yet it already does this. Standard benchmarks barely show the leap, so his case leans on samples, and he asks for new tests.

<sub>spya-aqts9c, spya-fvqe70, spya-s8rx6n</sub>

Prediction error, called loss, has kept falling smoothly as models grow, as earlier papers forecast. The author had expected the curves to bend near 100 billion parameters, but GPT-3 went twice that without noticeable change. Eyeballing the graphs, he guesses trillions of parameters are affordable, though he admits extrapolation is uncertain.

<sub>spya-asr663, spya-hqpffq, spya-vn0xpd</sub>

He calls the pattern the blessings of scale: bigger models, data and problems make learning faster, more stable and better at generalizing. His explanation, offered as a suggestion, is that a big network holds countless sub-models whose errors average out toward simple solutions. Lazy shortcuts like memorizing win early, but with enough varied data they lose to general methods such as real arithmetic.

<sub>spya-sfkxh8, spya-grkhs8, spya-vkkfzh</sub>

The pretraining thesis says that predicting human text very well forces a model to learn real understanding. Error is counted in bits per character, and humans reach about 0.7, so the remaining gap holds everything models still miss. The author admits the argument never convinced him in practice, since many clever algorithms work only in theory. Then he concludes that, apparently, it would have worked fine.

<sub>spya-rjwfkb, spya-e5n86h, spya-s0h95g</sub>

He says labs differ in belief, not resources: OpenAI bets on scaling, while DeepMind holds a weak version needing brain-like parts found one by one. As of late October 2020, no model had even exceeded the 17 billion parameters of Turing-NLG. He also argues that experts who predicted failure were wrong and few have owned up, a point made as polemic.

<sub>spya-vr9q2p, spya-fyy04z, spya-m9r8zx</sub>

A later appendix argues that models trained on rich data may pick up agency, meaning planning and acting toward goals. He hedges this as a possibility, maybe not even a small one, and says he has no solution. His advice is to drop the idea that tool AIs cannot become agent AIs, because tampering with data is not a fix.

<sub>spya-mkbrjp, spya-ueb3d2, spya-hjpau9</sub>
