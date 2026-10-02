# Recall and Tutorial: what the research says about prompting recall and one-to-one teaching

Up: [research.md](../project/research.md) · the mode: [remember-mode.md](../project/remember-mode.md) ·
where it is going: [remembering-vision.md](../project/remembering-vision.md) · the plan:
[261002i](../plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md)

**Written 2026-10-02**, for Greg's reports `spya-c8x66d` (one adaptive Recall, with nudging hints)
and `spya-j0scgz` (a Tutorial sub-mode). Greg asked for it:

> So if you use Sonnet for web research on any of these topics in order to kind of give yourself
> inspiration about how to, you know, structure the prompt. … Write up your research in docs research.
>
> — Greg, `spya-j0scgz`, 2026-10-01

The body below is a Sonnet subagent's web research, kept as it came back apart from this header and
the section after it. Its own caveats are at the end: some points rest on search summaries rather
than the papers, and the AI-tutor products' prompts are known only from press descriptions.

## What we took, and what we did not

- **Into Recall**: the hint ladder (a context cue, then a sharper cue, then tell — never more than
  two rungs before telling); one cue per turn, chosen by importance rather than article order; a
  miss is followed by the answer, because a failed attempt followed by the answer still helps
  (Kornell, Hays & Bjork 2009); no quality adjectives. Greg's own ask, that a nudge may offer two
  directions so a reader with nothing on one has the other, is his and not the literature's; the
  closest the research comes is "let them steer".
- **Into Tutorial**: the turn shape (a brief specific reaction, one small cited piece, one task);
  rotating the task up Bloom's levels as the reader succeeds; a revisit of an earlier point every
  few turns, sooner for one they fumbled; expertise reversal (an expert with a narrow goal gets that
  goal's passages and harder questions, not the basics); prediction rather than recall for somebody
  who has not read it.
- **Not taken**: Recall's rule 10 (a closing summary) — the reader leaves when they like and the
  transcript is the record; multiple choice and cloze as interactions — Greg asked for the plain
  conversation first, and the evidence (Kang, McDermott & Roediger 2007) favours short answers
  anyway.


## The research

Method: web searches (URLs below were returned by search). Claims marked [background] come from my own knowledge of the literature, not from a page I opened this session. Effect sizes are as reported by the sources, not re-derived.

---

### 1. What makes a good Socratic question

**Findings**
- Richard Paul and Linda Elder's taxonomy has six families: (1) clarification ("What do you mean by...?"), (2) probing assumptions ("What are you taking for granted?"), (3) probing reasons/evidence ("How do you know? What would change your mind?"), (4) viewpoints/perspectives ("How might someone who disagrees see this?"), (5) implications/consequences ("What follows if that's true?"), (6) questions about the question ("Why does this matter? Is this the right question?"). Source: Paul & Elder, *The Thinker's Guide to Socratic Questioning* (Foundation for Critical Thinking); summaries at https://flipeducation.ai/teaching-wiki/socratic-questioning and https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2019.00126/pdf.
- A good Socratic question is open (the asker doesn't hold the exact wording of the answer), anchored in something the learner already said or can see, and a step the learner can plausibly take. A leading question smuggles the answer in ("Don't you think the author was wrong to assume X?"); a gotcha's purpose is to expose, not to move the learner. [background: Chi's tutoring work and Lepper's INSPIRE both describe expert tutors as indirect, pointing at the learner's own reasoning rather than at the tutor's answer.]
- Good Socratic questions "themselves teach": the question carries a piece of structure ("The author contrasts X with Y. What does that contrast let them say about Z?" teaches that X and Y are contrasted).
- AI "Socratic" products (Khanmigo, Claude Learning mode, ChatGPT Study mode) all use "ask a guiding question instead of the answer", but the published descriptions are marketing-level; the known failure is **withholding help forever**. LearnLM's system-instruction example is "clipped, Socratic style... short, focused sentences... address the student's specific misconception" (https://arxiv.org/pdf/2412.16429; summary https://www.emergentmind.com/topics/learnlm).

**Moves a prompt can require**
1. Anchor every question in the reader's own last words or a named passage ("You said X. What does the author give as the reason?").
2. Pick the question family that fits the reader's state: clarify (vague answer), evidence (confident claim), implication (solid grasp, ready to stretch), other view (expert reader), why-does-it-matter (novice lost in detail).
3. A question must have a defensible answer in the text. If you couldn't point to the passage that answers it, don't ask it.
4. Never embed a claim as a premise ("Since the author clearly overlooks...").
5. One question per turn.

**Sources**: Paul & Elder via the links above; https://arxiv.org/pdf/2504.06294 (Socratic tutor study protocol using the same six types).

---

### 2. Retrieval practice, cued recall, hints, errors, desirable difficulties

**Findings**
- **Testing effect.** Roediger & Karpicke (2006, *Psychological Science*; 2008, *Science*, "The Critical Importance of Retrieval for Learning"): repeated retrieval beat repeated study for delayed recall. In 2008, items always tested were recalled about 80% a week later versus about 33-36% when dropped from testing; extra study after success did nothing for delayed recall (https://www.brucehayes.org/Teaching/papers/2008_Roediger_Karpicke_Science.pdf; https://source.washu.edu/2008/02/practicing-information-retrieval-is-key-to-memory-retention-study-finds/).
- Dunlosky et al. (2013, *Psychological Science in the Public Interest*) rated practice testing and distributed practice "high utility"; elaborative interrogation, self-explanation and interleaving "moderate"; rereading, highlighting, summarising "low" (https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html; https://stafforini.com/works/dunlosky-2013-improving-students-learning/). Spideryarn's thesis (augment, don't replace, reading) is in line with this.
- **Desirable difficulties** (R. Bjork; Bjork & Bjork 2011): spacing, interleaving, testing rather than re-presenting, varying conditions, and intermittent feedback make performance during learning worse and long-term retention better (https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/RBjork_inpress.pdf; https://en.wikipedia.org/wiki/Desirable_difficulty). Caveat in Bjork's own writing [background]: a difficulty is desirable only if the learner has the background to succeed at it. A reader who has not read the piece gains nothing from retrieval.
- **Errors are not poison if corrected.** Kornell, Hays & Bjork (2009): unsuccessful retrieval attempts followed by the answer improved later learning versus just being shown the answer (https://pubmed.ncbi.nlm.nih.gov/19586265/). Butler & Roediger (2008): feedback boosts the benefit of testing and cuts the harm of errors; the biggest feedback benefit is for low-confidence correct answers (https://annualreviews.org/doi/abs/10.1146/annurev-psych-010416-044022 and search summary). Hypercorrection (Metcalfe): confidently held errors are corrected better than low-confidence ones, if feedback arrives. Practical: after a confident wrong claim, give the correction plainly and move on.
- **Errorless vs errorful.** Errorless learning matters for memory-impaired patients [background]; for ordinary learners, errorful-with-feedback is at least as good. So a hint ladder is for avoiding demoralising failure, not for avoiding errors per se.
- **Cue difficulty.** No published "right" cue strength. The principle is "retrieval success is likely but effortful"; a commonly cited target is roughly 70-85% success [background, not verified]. A cue should reinstate context (where in the piece, what the author was arguing) rather than supply content.
- **Generation effect** (Slamecka & Graf 1978 [background]): material you produce yourself, even a single missing word, is remembered better than material you read. Backs "let them complete the thought".
- **Feedback timing.** Delayed feedback sometimes beats immediate for retention, but in a conversation waiting costs confusion and frustration. Rule: corrective feedback in the next turn, not at the end of the session.
- **Expanding vs uniform retrieval.** Landauer & Bjork (1978): for test-type practice, expanding intervals did best on a short-delay test. Later work found expanding vs equal spacing roughly equal for delayed retention; the main benefit is having an early first retrieval (https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Landauer.Bjork_.1978.pdf; https://profiles.wustl.edu/en/publications/expanding-retrieval-practice-promotes-short-term-retention-but-eq/).

**Moves for a prompt**
1. Ask for retrieval before showing content: the reader says what they remember first; the model reveals only after.
2. **Hint ladder**, each rung only if the previous failed: (a) context cue (where / what the author was arguing about); (b) partial or category cue, cloze-style ("the contrast was between..."; "it was a number"); (c) near-gimme (two options, or the sentence with a blank); (d) the answer, with the block id. Skip to (d) when the reader says they are stuck or lost.
3. Fade support: after a reader succeeds on a cue, the next cue for a related item is weaker.
4. After a miss, give the answer and one sentence on why it matters, with the id, and keep going; don't make them fail twice.
5. Correct confident errors directly and briefly; for hesitant near-misses, confirm the right part first.

---

### 3. Human tutoring research and published AI-tutor principles

**Findings**
- **Bloom's 2 sigma** (Bloom 1984): one-to-one mastery tutoring beat conventional class by two standard deviations. VanLehn (2011, *Educational Psychologist*) put human tutoring at d = 0.79 and step-based computer tutoring at d = 0.76 vs no tutoring. So **well-designed small steps with feedback on each get most of the benefit** (https://www.whizzeducation.com/thought-docs/case-for-virtual-tutoring/; https://arxiv.org/pdf/1812.09628). You do not need a perfect human; you need small steps with feedback.
- **Graesser & Person: the five-step tutoring frame**: (1) tutor asks a question or poses a problem, (2) learner answers, (3) tutor gives brief feedback, (4) tutor and learner collaboratively improve the answer, (5) tutor checks understanding. Typical tutors ask shallow questions and rarely get learners to ask their own (https://www.rogerkreuz.com/web/PGKP01.htm; https://digitalcommons.memphis.edu/facpubs/8881).
- **AutoTutor** (Graesser et al.): each topic has *expectations* (what a good answer contains) and *misconceptions* (anticipated wrong ideas). Moves escalate: **pump** ("anything else?", "go on"), **hint** (a question pointing at the missing idea), **prompt** (a question with a one-word answer, a fill-in cue), **assertion** (tutor tells it); a correction is spliced in when a misconception appears; a summary closes (https://notes.andymatuschak.org/AutoTutor; https://telearn.archives-ouvertes.fr/hal-00197320; https://cdn.aaai.org/Symposia/Fall/2000/FS-00-01/FS00-01-007.pdf). This is exactly a hint ladder: pump, hint, prompt, assert.
- **Chi et al. (2001), "Learning from human tutoring"**: learners gain mostly from constructing their own ideas in response to tutor prompts; tutors suppressed from explaining and giving feedback, forced to prompt, did comparably. The learner's own generation is the active ingredient (context: https://asu.elsevierpure.com/en/publications/the-icap-framework-linking-cognitive-engagement-to-active-learnin).
- **Lepper & Woolverton (2002), INSPIRE**: effective tutors are Intelligent, Nurturant, Socratic, Progressive, Indirect, Reflective, Encouraging. Notably **indirect feedback**: avoid saying "wrong", ask something that lets the learner see it; stay warm; build the learner's sense of control and competence (https://stafforini.com/works/lepper-2002-wisdom-practice-lessons/; https://www.eoas.ubc.ca/research/cwsei/resources/INSPIRE-Guidelines.pdf (PDF would not parse for me; description from search summary)).
- **LearnLM** (Google, 2024): pedagogy is injected via system instructions, e.g. "clipped, Socratic style", short sentences, address misconceptions. Its attributes (my recollection, [background]): inspire active learning, manage cognitive load, adapt to the learner, stimulate curiosity, deepen metacognition. In a UK exploratory RCT, tutored students solved novel problems slightly more often than with human tutors alone (66.2% vs 60.7%) (https://arxiv.org/pdf/2512.23633; https://arxiv.org/pdf/2412.16429).
- **OpenAI Study mode** (July 2025): custom system instructions built with teachers; elements: active participation, metacognition and self-reflection, curiosity, actionable supportive feedback; Socratic questions, scaffolded sections, periodic knowledge checks, personalisation to level (https://campustechnology.com/articles/2025/07/30/new-chatgpt-study-mode-guides-students-through-questions.aspx). **Anthropic Learning mode**: asks "How would you approach this?" and "What evidence supports your conclusion?" rather than giving answers (https://www.anthropic.com/news/introducing-claude-for-education; https://engadget.com/ai/anthropic-brings-claudes-learning-mode-to-regular-users-and-devs-170018471.html). **Khanmigo**: Socratic restraint plus "think before it speaks", i.e. assess the learner's understanding before responding (https://ai.engineer/talks/scaling-ai-in-education-a-khanmigo-case-study).
- Widely reported complaint about all of these [background]: the model withholds the answer to a frustrating degree. In Spideryarn the article is on screen and the reader can always look, so "fill the gap and point to the passage" is cheap and right.

**Moves for a prompt**
1. Follow the five-step frame compressed into one turn: brief feedback on what they said, then one next move (a cue, a question, or a small piece of content), then stop.
2. Before replying, silently list what a good answer would contain (expectations) and the likely misreading (misconception), from the article.
3. Escalate pump, hint, prompt, assert; skip rungs when the reader signals they're stuck.
4. Feedback brief and indirect where possible ("that's the first half; what was the author's answer to X?"), explicit when wrong and confident.
5. Prefer getting the reader to produce things (explain, apply, example) over the model explaining more (Chi: constructive/interactive beat passive/active).

---

### 4. Elaborative interrogation, self-explanation, teach-back, Bloom's stems

**Findings**
- **Elaborative interrogation** (Pressley et al. 1987; Dunlosky 2013): asking "why is this true?" of a stated fact helps retention, and works best when the learner has some prior knowledge to connect to (Dunlosky links above).
- **Self-explanation** (Chi, de Leeuw, Chiu & LaVancher 1994): prompting readers to explain what a passage means improved recall and transfer; good self-explainers generate inferences and repair their own misunderstandings (https://education.asu.edu/lcl/publications/chi-m-t-h-de-leeuw-n-chiu-m-h-lavancher-c-1994-eliciting-self-explanations; https://learnlab.org/research/wiki/index.php/Prompted_Self-explanation).
- **ICAP** (Chi & Wylie 2014): Passive < Active < Constructive < Interactive. "Say it in your own words" is Constructive; a back-and-forth where learner and tutor build on each other is Interactive (https://chilab.asu.edu/sites/default/files/lcl/chiwylie2014icap_2.pdf).
- **Teach-back / Feynman**: "explain it simply" surfaces gaps. The evidence base is self-explanation and generative learning (Fiorella & Mayer 2013 [background]); I found no independent trials of the Feynman technique by name.
- **Bloom's taxonomy (revised, Anderson & Krathwohl 2001) stems** [background]:
  - Remember: "What did the author say about...?"
  - Understand: "Say that in your own words." "What's the main point of this part?"
  - Apply: "Where might you see this in your own field?" "Give a different example."
  - Analyse: "How does this section support the claim?" "What's the difference between X and Y here?"
  - Evaluate: "What's the weakest part of this argument? What evidence would change your mind?"
  - Create: "How would you test that?" "What would you add?"
  Climb gradually, but a quick expert can start at Analyse/Evaluate.

**Moves**
1. After teaching a little, ask for one of: say-it-back, why, example, apply, concern. Rotate; don't always ask "in your own words".
2. Use "why" only about things the piece itself justifies (otherwise it becomes guessing).
3. Offer "raise a concern" especially to experts; it treats them as a peer.
4. After a say-it-back, name what was right, add the one missing piece, move on. Don't re-explain the whole thing.

---

### 5. Spacing and interleaving within one session

**Findings**
- Spacing is among the most robust effects (Dunlosky 2013, "high utility"). Within one conversation "spacing" is only minutes: retrieving an early point after 3-6 intervening turns is genuine spaced retrieval, and harder than an immediate repeat. Within-session lags give real but smaller gains than day-scale spacing [background: Cepeda et al. 2006].
- **Expanding retrieval** (Landauer & Bjork 1978): retrieve soon after learning, then successively later; fits a conversation: re-probe a point 1-2 turns later (easy), again several turns later (harder). Later work shows it isn't reliably better than equal spacing for delayed retention, so don't over-engineer; just revisit.
- **Interleaving** (Rohrer & Taylor 2007; Kornell & Bjork 2008 [background]): mixing topics improves discrimination and retention versus blocking. In a reading conversation: connect the current point to an earlier one, or ask how two sections relate.

**Moves**
1. Keep a short private ledger of points taught/recalled and how each went. After 3-5 exchanges, revisit one the reader got right earlier, via a cue and not the answer.
2. Revisit fumbled points sooner (1-2 turns) with an easier cue.
3. Weave: "Earlier you said X. How does that fit with what we just read about Y?" (Analyse level).
4. Don't announce "now a review quiz"; fold the revisit into the flow.

---

### 6. Prior knowledge: expertise reversal

**Findings**
- **Expertise reversal effect** (Kalyuga, Ayres, Chandler & Sweller 2003; Kalyuga 2007): guidance, worked examples and explanations that help novices become redundant, even harmful, for experts, because experts must reconcile the guidance with their own schemas. "Instructional guidance, which may be essential for novices, may have negative consequences for more experienced learners." (https://en.wikipedia.org/wiki/Expertise_reversal_effect; https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/Exp_Rev_LI06.pdf).
- **Fading**: start with more support and reduce it as competence shows (faded worked examples); permanent prompts underperformed fading prompts in one study (https://openlearning.mit.edu/mit-faculty/research-based-learning-findings/worked-and-faded-examples).
- Kalyuga's rapid-diagnosis idea [background]: a quick first question ("what would you expect next?") separates novices from experts; use it to choose the level.

**Moves**
1. Ask up front (or infer from the first message) the reader's reason for reading and background; use it every turn.
2. Novice or "what's this about": define terms in a clause, give an example, smaller steps, more cues; teach before asking.
3. Expert with a narrow goal ("I'm checking their sample size"): skip definitions; go straight to the relevant passages with block ids; ask Evaluate-level questions ("Does their n support this? what would you want to see?"); don't teach what they didn't ask about; fewer, sharper turns.
4. If a reader answers fluently and briefly, raise the level next turn. If vague or "not sure", lower it.
5. Never ask a novice an Evaluate question about content they haven't yet understood; never ask an expert "can you define X".

---

### 7. Motivation: competence, praise, not saying "wrong"

**Findings**
- **Self-determination theory** (Deci & Ryan) [background]: autonomy, competence, relatedness. Support competence with achievable challenges and informational (not controlling) feedback; support autonomy by letting the reader steer.
- **Lepper & Woolverton 2002**: expert tutors rarely say "wrong"; they use indirect feedback, avoid over-praise, diagnose, then nudge so the learner feels they found it (https://stafforini.com/works/lepper-2002-wisdom-practice-lessons/). Tutors are more careful with negative feedback politeness (https://nssa.stanford.edu/studies/role-politeness-online-human-human-tutoring).
- **Mueller & Dweck (1998)**: praise for intelligence led children to avoid challenges and lie about scores after failure; praise for effort/strategy gave better outcomes (https://www.columbia.edu/cu/psychology/courses/3615/Readings/Mueller_Dweck.pdf). Growth-mindset interventions' effect sizes are debated; take "specific process praise beats person praise", not the full mindset story.
- **Inflated praise** (Brummelman et al. 2014, *Psychological Science*): "incredibly good" praise made children with low self-esteem avoid challenges (https://www.psychologicalscience.org/news/releases/when-being-called-incredibly-good-is-bad-for-children.html; https://sciencedaily.com/releases/2014/01/140102112041.htm). Over-praise also signals low expectations.
- Tutoring-praise guidance: sincere, specific, immediate, varied (not "great job" on repeat), about process (https://hackernoon.com/lesson-principles-defining-effective-praise-in-tutoring).
- For adult readers, the dignified version: specific recognition of an actual good move ("you caught that the author separates X from Y"); no cheerleading, no baby voice.

**Moves**
1. Replace praise with specific acknowledgment that says what the reader got and what it did ("That's the key distinction.").
2. Don't say "wrong"; say what holds, then what's missing: "Close. The author actually says it the other way round: ... [spya-...]".
3. Where fair, put the difficulty on the text ("that passage is easy to misread").
4. Sequence challenges so most turns are a success; put the one hard question after two achievable ones.
5. Let the reader steer; sometimes end with a choice ("go deeper here or move on?").
6. At most one short acknowledgment per turn; no exclamation marks; no "Great question!".

---

### 8. Cloze, free recall and multiple choice as add-ons

**Findings**
- Kang, McDermott & Roediger (2007): without feedback, multiple-choice and short-answer initial tests were not clearly different for retention; **with feedback, short-answer testing gave the best final retention**: the more demanding the retrieval, the greater the benefit (https://www.gwern.net/docs/spaced-repetition/2007-kang.pdf).
- Little & Bjork (2014 and earlier): **multiple choice with competitive lures** also strengthens memory for the lures' answers when it forces retrieval about each alternative; non-competitive lures give no benefit (https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2017/01/LittleBjorkMC2014.pdf).
- Cloze (fill-in-blank) is cued recall: lower effort than free recall, more reliable success. Good as a fallback rung of the hint ladder.
- MC risk: guessing, and exposure to wrong options that may later be remembered as true (Roediger & Marsh 2005, negative suggestion effect [background]); feedback fixes most of it.

**Moves**
1. Free recall first, then context cue, then cloze, then two options. Offer MC only to a reader who says they're stuck, with plausible distractors taken from likely misreadings of the article.
2. Don't ask a closed quiz question where a short generative one would do, unless pace requires it.

---

### Implications for the two prompts

### RECALL (retrieval practice)

Purpose: the reader has read (or says they have); they say what they remember; the model helps them recall a bit more each round.

Rules:
1. **Let them go first.** Open with an invitation: "What do you remember? Anything at all, rough is fine." Don't pre-prompt with a list of topics.
2. After each reader turn: (a) half a sentence on what they got right, with a block id if useful; (b) correct any error briefly and directly, citing the passage; (c) give **one** cue toward something they haven't mentioned. Aim for under ~60-80 words.
3. Cue findable-but-not-given: context cue ("In the part about the 2019 experiment..."), then partial cue ("what did they conclude about the control group?"), then cloze ("they found X was ___ by ___"), then fill in. Don't jump to the answer unless they ask, say they can't remember, or have failed two rungs.
4. Choose what to cue by importance, not article order: structure and central claims first, details second.
5. Fade: a reader who retrieved from a context cue gets a lighter cue next time.
6. For partly right answers, confirm the right part first, then ask for the rest ("and what reason did they give?").
7. A miss is information, not failure: "That bit is easy to lose", supply it plus why it matters to the argument, and move on. Revisit it 2-3 turns later with a light cue.
8. Point to passages by block id, with a clause about what's there. Offer "want to re-read that bit?" rather than assuming.
9. Make completeness visible but unforced: "You've got the main claim and two of the three reasons. Hunt for the third, or move on?"
10. Close when the reader wants out, or at a natural coverage point, with a 2-3 line summary of what they recalled and one or two things worth re-reading, each with ids.
11. If they haven't read it or remember nothing: don't quiz. Offer a 3-line gist and ask which part sounds most interesting, or pivot to prediction ("what would you expect them to argue about X?"); unsuccessful attempts followed by the answer still help (Kornell et al. 2009).

### TUTORIAL (short alternating turns)

Purpose: the model teaches a little, the reader says it back / explains / applies / objects; many small successes.

Rules:
1. **Start by asking what they remember and why they're reading** (one question, two parts at most). If "not read it": ask goal and background in one line, then begin with the shortest useful orienting claim (1-2 sentences, with id), then ask a prediction or opinion question rather than a recall one.
2. **Turn shape (every turn):** brief reaction to what they said (specific, never inflated), then *one* small piece of the article (1-3 sentences, quoted or closely paraphrased, with block id), then *one* task. About 80-120 words at most. No lists of questions.
3. **Rotate the task** across Bloom levels: say it back, why, example, apply, compare, concern. Choose by the reader's state and goal, not mechanically.
4. **Socratic questions that teach**: contain a piece of structure ("The author sets A against B. What does that let them claim about C?"), are answerable from what has been shown, and hide no premise.
5. **Teach-back feedback:** name what they got, add the one missing piece, don't re-lecture. If right, raise the level next turn; if shaky, drop to a cue or cloze.
6. **Interleave and space:** keep an internal ledger of points covered and how each went. Every 3-5 turns, revisit an earlier point via a cue or by asking how it relates to the current one. Revisit fumbled points sooner.
7. **Adapt to expertise:** novices get definitions, examples, small steps; experts get the relevant passages, fewer explanations, "what's your concern?" tasks. Follow the stated reason for reading; if an expert is hunting one issue, steer there rather than touring the piece.
8. **Success first:** the first 1-2 tasks should be easily achievable. Ask for things the reader can only produce if they understood (e.g. an example from their own field), not trivia.
9. **Let them steer:** now and then offer a choice of direction. If they ask a direct question, answer it first (briefly, with ids), then optionally follow with a task.
10. **Stuck signals** ("I don't know", "lost", "confused", very short answers): stop quizzing. Re-explain simpler with a concrete example, then ask a much smaller question or just check whether it's clearer.
11. **Close** with a short "what we covered" and one thing worth a second look, each with ids.

### Failure modes to guard against

| Failure | What it looks like | Guard |
|---|---|---|
| Gimme question | "The author says X is ___. What is it?" where the answer is in the previous sentence | Cues reinstate context; the answer must require retrieval or reasoning, not copying. |
| Leading / hidden-premise question | "Why was the author wrong to ignore Y?" | Forbid embedding a claim as a premise; ask about the author's stated reasons. |
| Gotcha | Asks something the reader can't know, to expose them | Every question must be answerable from what the reader has read or been shown. |
| Quizzing a lost reader | Reader says "I'm lost" and gets another question | Switch to explaining; resume asking only after a clarity check. |
| Over-long turn | Multi-paragraph lecture plus three questions | Hard cap ~100 words; one question; one new idea. |
| Praise inflation | "Excellent!", "Great question!" every turn | One specific acknowledgment at most; no quality adjectives; silence is fine on routine successes. |
| Saying "wrong" | "That's incorrect." | State what holds, then the correction with citation. |
| Withholding to frustration | Hint after hint, no answer | Max 2 hint rungs before supplying the answer and id. |
| Testing the unread | Retrieval questions to someone who hasn't read | Detect early; switch to orienting plus prediction. |
| Replacing the reading | Model summarises everything; reader never opens the article | Quote short pieces with ids and invite the reader to look; teach a little, then ask. |
| Fabrication | Attributing claims to the article it doesn't make | Every claim about the article carries a block id; if unsure, say the article doesn't seem to address it. |
| Rigid ladder | Same question type or hint order every time | Choose by reader state; vary the task type. |
| Ignoring the stated purpose | Touring the whole article for an expert hunting one issue | Re-read the stated goal each turn; stay on it. |
| Same level forever | Recall questions to someone clearly fluent | Fade support; raise the Bloom level on success. |
| Interrogation tone | Rapid-fire Q after Q | Alternate: give something, then ask; acknowledge the answer before the next move. |
| Several questions per turn | Three questions at once | One question, last in the turn, concrete enough to answer in a sentence by voice. |

### Voice/dictation-specific notes (from the brief, not from research)
- Replies are read on screen; the reader dictates, so questions must be answerable in a sentence or two out loud. Avoid questions needing a precise term or number unless cued.
- Tolerate messy dictated answers: judge meaning, not wording; don't treat transcription slips as errors.
- Keep ids readable but unobtrusive; one id per point.

### Source list (URLs)
- Paul & Elder / Socratic: https://flipeducation.ai/teaching-wiki/socratic-questioning ; https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2019.00126/pdf ; https://arxiv.org/pdf/2504.06294
- Roediger & Karpicke 2008: https://www.brucehayes.org/Teaching/papers/2008_Roediger_Karpicke_Science.pdf ; https://source.washu.edu/2008/02/practicing-information-retrieval-is-key-to-memory-retention-study-finds/
- Dunlosky et al. 2013: https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html ; https://stafforini.com/works/dunlosky-2013-improving-students-learning/
- Bjork desirable difficulties: https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/RBjork_inpress.pdf ; https://en.wikipedia.org/wiki/Desirable_difficulty
- Kornell, Hays & Bjork 2009: https://pubmed.ncbi.nlm.nih.gov/19586265/
- Butler & Roediger / feedback / hypercorrection: https://annualreviews.org/doi/abs/10.1146/annurev-psych-010416-044022
- Landauer & Bjork 1978: https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Landauer.Bjork_.1978.pdf ; https://profiles.wustl.edu/en/publications/expanding-retrieval-practice-promotes-short-term-retention-but-eq/
- VanLehn 2011 / Bloom: https://www.whizzeducation.com/thought-docs/case-for-virtual-tutoring/ ; https://arxiv.org/pdf/1812.09628
- Graesser / AutoTutor: https://www.rogerkreuz.com/web/PGKP01.htm ; https://notes.andymatuschak.org/AutoTutor ; https://telearn.archives-ouvertes.fr/hal-00197320 ; https://cdn.aaai.org/Symposia/Fall/2000/FS-00-01/FS00-01-007.pdf ; https://digitalcommons.memphis.edu/facpubs/8881
- Lepper INSPIRE: https://stafforini.com/works/lepper-2002-wisdom-practice-lessons/ ; https://www.eoas.ubc.ca/research/cwsei/resources/INSPIRE-Guidelines.pdf ; https://nssa.stanford.edu/studies/role-politeness-online-human-human-tutoring
- Chi: https://chilab.asu.edu/sites/default/files/lcl/chiwylie2014icap_2.pdf ; https://education.asu.edu/lcl/publications/chi-m-t-h-de-leeuw-n-chiu-m-h-lavancher-c-1994-eliciting-self-explanations ; https://learnlab.org/research/wiki/index.php/Prompted_Self-explanation
- LearnLM: https://arxiv.org/pdf/2412.16429 ; https://arxiv.org/pdf/2512.23633 ; https://www.emergentmind.com/topics/learnlm
- Study mode / Claude learning mode / Khanmigo: https://campustechnology.com/articles/2025/07/30/new-chatgpt-study-mode-guides-students-through-questions.aspx ; https://www.anthropic.com/news/introducing-claude-for-education ; https://engadget.com/ai/anthropic-brings-claudes-learning-mode-to-regular-users-and-devs-170018471.html ; https://ai.engineer/talks/scaling-ai-in-education-a-khanmigo-case-study
- Expertise reversal: https://en.wikipedia.org/wiki/Expertise_reversal_effect ; https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/Exp_Rev_LI06.pdf ; https://openlearning.mit.edu/mit-faculty/research-based-learning-findings/worked-and-faded-examples
- Praise: https://www.columbia.edu/cu/psychology/courses/3615/Readings/Mueller_Dweck.pdf ; https://www.psychologicalscience.org/news/releases/when-being-called-incredibly-good-is-bad-for-children.html ; https://sciencedaily.com/releases/2014/01/140102112041.htm ; https://hackernoon.com/lesson-principles-defining-effective-praise-in-tutoring
- MC vs short answer: https://www.gwern.net/docs/spaced-repetition/2007-kang.pdf ; https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2017/01/LittleBjorkMC2014.pdf

### Caveats on evidence
- I could not open the INSPIRE PDF (binary) or the full LearnLM paper (too large); those points rest on search summaries plus background knowledge. The OpenAI, Anthropic and Khanmigo items are press-level descriptions, not the actual system prompts.
- The "70-85% target success" figure, the Bloom stems, SDT and the within-session spacing remarks are background knowledge, not verified this session.
- Within-session spacing gains are real but smaller than day-scale spacing; the design uses them because they are free, not because they are strong.
