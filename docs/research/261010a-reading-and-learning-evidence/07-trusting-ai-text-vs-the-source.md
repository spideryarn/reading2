# Trusting AI text versus the source

Up: [reading-research-overview.md](../../project/reading-research-overview.md) · part of the
[reading and learning evidence library](digest.md), 2026-10-10.

The question: when a reader meets an AI's paraphrase of a piece (a summary, a hedge, a link or
citation), how far do they trust it, how well does that trust track whether it is right, and does
going back to the source text fix it? The short answer: people lean on AI output more than its
accuracy justifies, a wrong-but-fluent answer is the costly case, and the things that look like
safeguards (explanations, citations, a link to the source) mostly raise trust rather than checking.
The designs that do reduce over-reliance either make checking cheap and local (the supporting
passage, shown) or force the reader to commit to their own view first. Almost none of this was
tested on expert adults reading research papers, so the transfer is a judgement, not a finding.

## The short answer

- Over-reliance on automated or AI advice is real and replicated; when the advice is wrong, accuracy falls below what people achieve unaided, and training or instruction does not reliably prevent it. (**High certainty · Analogy**; mostly clinicians and operators, not readers)
- LLM summaries of scientific abstracts generalise more broadly than the originals (about five times the odds of a broad generalisation versus expert-written summaries), and asking for accuracy did not fix it. Other work on Cochrane abstracts found far fewer errors from a different model family and prompt, so the rate is model- and task-dependent. (**Moderate certainty · Direct** on the thing being summarised, **Analogy** on the reader)
- Citations raise trust even when they are random; trust drops when people actually open them, and most people do not (about 10% of answers had a reference checked). (**Low–Moderate certainty · Indirect**: one Prolific experiment, a single-item trust scale)
- Explanations from an AI mostly increase agreement with the AI, right or wrong; they reduced over-reliance only when they made the answer easier to check than to accept, and not reliably even then. (**Moderate certainty · Analogy**)
- Showing the supporting passage lets people judge as well as reading the full source, faster; a model-written explanation made people less likely to detect errors. This is the single finding closest to a design rule, but it is a preprint. (**Low certainty · Indirect**)
- Replacing the passage with an AI summary helped weaker readers and hurt stronger ones on short standardised passages (d = 0.45 up; d = 0.83 down), but the group split was defined on the same control scores, so part of that gap may be regression to the mean. Letting people open the full text after a summary largely closed the comprehension gap in a small news-reading study. (**Low certainty · Indirect**)
- A forced step (commit to your own answer, or wait before seeing the AI) cut over-reliance but was liked less and helped high-Need-for-Cognition people most. (**Moderate certainty · Analogy**)
- AI use inflates confidence: people scored about three points higher with AI help but overestimated their score by about four, and the usual "weak performers overrate most" pattern disappeared. (**Moderate certainty · Analogy**)

## The evidence

### Automation bias and complacency in general

Automation bias is following an automated suggestion instead of checking it (a commission error when
it is wrong; an omission error when you miss a problem because the aid did not flag it). Complacency
is checking less because the aid has usually been right.

Parasuraman & Manzey (2010) reviewed the empirical literature in human factors and concluded that
the two are overlapping effects of automation-induced attention, that practice alone does not
remove them, and that training or instruction does not reliably prevent them (abstract only, via
Crossref). Goddard, Roudsari & Wyatt (2012) is the systematic review for clinical decision support:
74 studies from 13,821 retrieved papers; user traits, trust, workload and time pressure moderate how
far people defer; training, accountability, and the way advice is displayed are the named mitigators
(abstract only, via Europe PMC). (**High certainty · Analogy**) Neither is about reading. The
populations are pilots, operators and clinicians making decisions under load.

Gaube et al. (2021) is worth keeping for the "expertise protects us" assumption. Physicians
reviewed chest X-rays with advice that was sometimes wrong, all of it actually written by human
experts but some labelled as AI. Accuracy fell significantly when advice was wrong regardless of the
label, and the radiologists, as a group, rated advice labelled AI lower while less specialised
physicians did not (abstract only). The detail that matters here: domain expertise changed how
advice was *rated* but the abstract reports that accuracy still fell on wrong advice.
(**Moderate certainty · Analogy**)

### How often do AI summaries of research distort it?

Peters & Chin-Yee (2025): 4,900 summaries from 10 LLMs (GPT-3.5 to ChatGPT-4.5, Claude 2 to 3.7
Sonnet, LLaMA, DeepSeek) of 200 abstracts and 100 full clinical articles. Against the original
texts, several models produced conclusions with a broader scope than the source's. Against expert
summaries (NEJM Journal Watch, 100 articles, four models), LLM summaries were more likely to contain
a generalised conclusion, OR 4.85 [3.06, 7.70]. An explicit accuracy prompt made overgeneralisation
more likely than a plain one, OR 1.90 [1.11, 3.26]. Some newer models were far worse than older ones
(roughly 9x for ChatGPT-4o and 39x for LLaMA 3.3 70B relative to the original text, from the
paper's regression coefficients); ChatGPT-4.5 was an exception and the Claude models did not differ
significantly from the originals (full text, Europe PMC). Caveats the authors give: the originals'
own generalisations were not judged warranted, UI temperature settings were undisclosed, and the
"ironic rebound" explanation for the accuracy-prompt effect is speculation. (**Moderate certainty ·
Direct** for what is being summarised; the study measured the text, not the reader.)

Tang et al. (2023) is the counterweight: 53 Cochrane review abstracts, six domain experts rating
GPT-3.5 and ChatGPT summaries. With the best input configuration fewer than 10% of summaries had
factual inconsistencies or were rated potentially harmful, ChatGPT summaries were preferred about
half the time, and the human-written conclusions had the highest share of fabricated errors (28%).
Longer inputs raised inconsistency and misleading statements, and the authors describe a "certainty
illusion" (overly convincing or overly uncertain statements) without giving a rate. One expert per
domain; one prompt; older models (full text, Europe PMC). (**Moderate certainty · Direct** on the
text; **Analogy** on the reader)

Reading across the two: how often a summary distorts depends on model, prompt and input length, and
the kind of error that matters for a careful reader (a claim stated more broadly than the paper
states it) is exactly the kind that no overlap metric catches.

### Does a wrong summary change what people believe or remember?

Sim, Eiger & Kohno (2026, arXiv preprint, to appear at AIES per the university press page, not
load-bearing): participants watched a short animated car-pedestrian video, then 24–48 hours later
read an accurate or an inaccurate ChatGPT summary. 83.6% of those given the accurate summary
answered the stop/yield question correctly against 44.8% given the misleading one, and the effect
held when participants were told the summary was AI-written. N = 331. The authors also report that
model summaries of videos omitted about half the central details on average. Video, not text, and
no source-reading arm, so it shows susceptibility to a wrong paraphrase, not that reading the
source would have protected anyone. (**Low certainty · Analogy**)

### Does reading the source beat reading the paraphrase?

Etkin et al. (2025, *Frontiers in Education*): pre-registered, within-subject, N = 195 US
college-age Prolific participants, ACT reading passages, ten four-option questions answered without
the passage, five conditions including an AI summary that *replaced* the passage. Among participants
below the median on the no-AI control, the summary raised accuracy from 44.9% to 55.4% (d = 0.45).
Among those at or above the median, it lowered it from 82.5% to 66.5% (d = 0.83), the largest drop
of any tool. Using SAT/ACT scores instead of control performance to define the groups, the low
group's gain vanished and the high group's loss shrank to 76.5% to 67.6% (d = 0.35, p = 0.005).
The groups in the headline split are defined on the same control scores that serve as the
baseline, which builds in regression to the mean; the paper does not discuss this. I treat the
direction as plausible and the size as unreliable. The authors add that results depend on their
prompts and one model. (full text) (**Low–Moderate certainty · Indirect**: short exam passages, not
papers, and the summary replaced the text)

Fan, Liu & Huang (2025, *International Journal of Human–Computer Interaction*): 47 readers of six
Chinese news articles on their phones, AI summary versus human summary versus full text. Full text
first gave the best comprehension; opening the full article after the summary largely closed the
gap; readers with more domain knowledge were less penalised by summary-only reading; and some
readers who said they distrusted the AI summary still used it when full reading felt too costly (an
"attitude–behaviour gap") (abstract only, via Semantic Scholar). Small, news not papers, and
effect sizes were not in the abstract. (**Low certainty · Indirect**) Its one durable idea: the
summary is dangerous as a terminus, much less so as a door.

### Do links and citations lead to verification, or just to more trust?

Ding et al. (2025, AAAI): 303 Prolific participants asked a ChatGPT-4-based chatbot up to ten
questions; answers carried zero, one or five citations, either real search results or random URLs
drawn from other participants' questions. Trust (1–10) was higher with citations than without, even
random ones; random citations were trusted less than valid ones; one citation was as good as five.
Only 193 of 1,976 referenced answers (9.8%) had a citation hovered, and checking was associated with
lower trust; checked random-citation answers were no more trusted than uncited ones (full text).
Limits: single-item trust, a Prolific sample, uncontrolled question content, and "checking" meant
hovering. (**Low–Moderate certainty · Indirect**) This is the clearest data for "citation as
decoration": the sign of a source works as a trust cue until somebody reads it.

Liu, Zhang & Liang (2023, *Findings of EMNLP*) audited four commercial generative search engines
with human evaluation: on average only 51.5% of generated sentences were fully supported by their
citations, and 74.5% of citations supported their sentence, while the answers looked fluent and
polished (abstract plus the ACL page). So a link need not support the claim next to it. (**Moderate
certainty · Direct** for the tools audited then; the engines have changed)

Irons et al. (2026, arXiv preprint, abstract only, not load-bearing) compared three kinds of
supporting information for judging an AI data-extraction tool's answers: full source text, passage
retrieval and LLM explanations. They report that passage retrieval gave judgments comparable to the
full source text at better speed, while LLM explanations produced rapid assessments with
inappropriate reliance and fewer detected errors, worse for complex answers. If it holds up it is
the closest evidence to Spideryarn's design: the quoted passage, not the model's account of it.
(**Low certainty · Indirect**)

Si et al. (2024, NAACL) agrees in a fact-checking task with 80 crowdworkers: LLM explanations made
people faster than search with similar accuracy, but they over-relied when the explanation was
wrong; showing both a "true" and a "false" case reduced this without beating search, and adding
search results beside the explanation gave no benefit over search alone (abstract only).
(**Moderate certainty · Indirect**)

### Do explanations reduce over-reliance?

- Bansal et al. (2021, CHI): 1,626 crowd workers on sentiment and LSAT tasks. Teams beat humans or
  the AI alone, but explanations did not improve accuracy over simply showing the AI's confidence,
  and increased agreement with the AI regardless of whether it was right. (full text, via ar5iv)
- Vasconcelos et al. (2023, CSCW): maze-task experiments, five studies. Highlight explanations
  reduced over-reliance only on the hardest tasks (mean 1.74, 95% CI 0.89 to 2.76), not on easy
  ones, and the medium-task prediction was not supported; higher pay for correctness also reduced
  it. Their account: people compare the effort of checking with the effort of just accepting, so
  explanations help when they make checking cheaper than it otherwise is. Lab proxy task. (full text)
- Fok & Weld (arXiv, a position paper, not load-bearing): across 25 studies the authors tabulated,
  only five showed complementary performance and enabled verification; they argue explanations help
  only if they let the person verify the claim. (checked, preprint)

(**Moderate certainty · Analogy** for the cluster. Convergent, with crowd workers on non-reading tasks.)

### Interventions that make people think

Buçinca et al. (2021, CSCW): N = 199, 75%-accurate simulated AI, meal-ingredient decisions.
Cognitive forcing functions (decide first, update after, or wait) reduced over-reliance versus
simple explanations on one measure (0.48 vs 0.64, d = 0.36) but not on the overall decision, and
participants trusted and liked them less. The benefit was concentrated in high-Need-for-Cognition
people, which the authors flag as a possible new inequality (full text). Pair this with the
anchoring work summarised in the earlier note
([prior-art-and-cognitive-offloading.md](../260831e-helping-peer-reviewers/prior-art-and-cognitive-offloading.md)):
the same pattern, from a different angle: an AI judgment shown first becomes the anchor.
(**Moderate certainty · Analogy**)

Kim et al. (2024, FAccT; pre-registered, N = 404, medical yes/no questions): first-person
hedging ("I'm not sure, but...") on half the AI's answers cut agreement (80.9% to 74.8%), raised
accuracy (63.9% to 72.8%), and lowered confidence in the answers; general hedging ("It's not
clear...") was not significantly different from no hedge. The AI was only about 50% accurate. Note
the baseline: unaided participants scored 74.2%, higher than the unhedged AI group, so the AI
made people worse (full text, via ar5iv). (**Moderate certainty · Analogy**)

Spatharioti et al. (arXiv 2023, published at CHI 2025; I read the preprint, not the CHI version):
90 participants choosing an SUV with traditional or LLM search. On routine tasks accuracy matched
(95.3% vs 92.3%) and LLM search took about half the time; on a task engineered to elicit a wrong
LLM answer, accuracy was 47% versus 93%, and most who erred had made one query. A second
experiment (N = 120) on that task: 26% with no highlighting, 53% with low-confidence highlighting,
58% with high- and low-confidence highlighting, reliability ratings unchanged. (full text,
preprint version) (**Low–Moderate certainty · Analogy**)

### Calibration: does AI help make us feel more certain than we should?

Fernandes et al. (2026, *Computers in Human Behavior*; N = 246 and N = 452, LSAT problems with a
chatbot): scores rose against a norm population but people overestimated their own performance
by about four points, higher AI literacy went with lower metacognitive accuracy, and the
Dunning–Kruger pattern disappeared (abstract only). LSAT items are likely in training data.
(**Moderate certainty · Analogy**)

## Where it is weak, contested or contrary

- **Almost none of it is about expert adults reading research papers.** The evidence is clinicians
  with X-rays, crowd workers on mazes and sentiment, undergraduates on exam passages, and Prolific
  workers on trivia and medical yes/no questions. The one reading study with domain-knowledge data
  (Fan et al.) is 47 readers of news.
- **The headline "summaries hurt strong readers" is shakier than its reputation.** Etkin's split
  invites regression to the mean and does not replicate under the alternative split at the same size.
- **Summaries may not be the villain.** Tang et al. found fewer errors in model summaries than in
  human-written conclusions on one task, and Peters & Chin-Yee found the Claude models did not differ
  significantly from the original text. The risk is specific, overgeneralisation and omission, and
  model-dependent.
- **Explanations do not reliably help, but the reason may be the task.** Vasconcelos finds a benefit
  only when checking is hard otherwise; Bansal finds none over a confidence score.
- **Hedging works on trust but not on a hedged-wrongly AI.** Kim et al. had a poorly calibrated
  hedger. Hedging that is right half the time is not what a real system would do.
- **Citations raising trust is not shown to harm.** Ding et al. measure trust, not whether the answer
  was right. Trust in a well-cited right answer is calibrated trust.
- **Checking is rare and measured crudely** (hovering), and we do not know whether the 90% who did not
  check were calibrated or complacent.
- **Pre-prints from 2026 (Sim, Irons) are the most on point and the least reviewed.**

## What it means for Spideryarn

### Quotes ([quotes.md](../../project/quotes.md))

Today: every row is the article's own text, verified verbatim against the block it came from, and
marked in the prose; the doc states plainly that it proves the words are in the piece, not who wrote
them.

**Supports.** The paraphrase risk (overgeneralisation, omission, the certainty illusion) is
sidestepped for the quote itself, and Irons et al.'s preprint suggests the passage is the best
support for judging. **Suggests a change (proposal):** the model's *reason* for choosing a quote is
the paraphrase part, and the evidence on explanations says people accept such text more than they
check it. Keeping the reason behind a button (as it is) matches this; consider whether the choice of
*which* passages were chosen, an omission risk in Sim's sense, is visible to the reader. **Untested:**
whether a verified quote lowers a reader's guard on the model's ranking of importance.

### Skim ([skim.md](../../project/skim.md))

Today: a route through stored Quotes, ordered by a model, each with a depth and a short role line,
walked three times with the current stop ringed in the prose.

**Supports.** A route that lands the reader in the original words at every stop is the "summary as
door, not terminus" shape. **Suggests a change (proposal):** the role line is a model paraphrase of
why the stop matters, shown beside text the reader can read; the cheapest change in the spirit of
forcing functions would be letting the reader see the passage before the role line (or ask for the
role line), with the caveat that Buçinca found such friction costs preference and helps mostly people
who like effortful thought. **Untested:** whether an ordered route anchors the reader's idea of what
the paper's main points are.

### FAQ ([faq.md](../../project/faq.md))

Today: up to twelve questions, each answered only with passages from the piece itself, with a jump
to the paragraph.

**Supports.** The answer is the passages, not a model's account of them, which is the format the
Irons preprint favours and the one that avoids the explanation trap. **Suggests a change (proposal):**
the *question* is the model's framing and could anchor what the reader thinks is the objection; the
Buçinca result suggests letting the reader pose their own question before seeing the list, as an
option. **Untested:** whether readers check the passages or accept that "the piece answers this".

### Cross-references ([cross-references.md](../../project/cross-references.md))

Today: a phrase that sums up a result links to the paragraph or figure that reports it, with a hover
card previewing the target; the phrase and target are validated, and the model's own string is not
kept.

**Supports.** This is the cheapest-to-check link there is: the hover card puts the target next to
the claim, which is what the "make checking cheaper than accepting" theory (Vasconcelos; Fok &
Weld) asks. **Suggests a change (proposal):** Ding et al. warn that a link works as a trust cue
whether or not it is opened, and Liu et al. found fewer than three-quarters of links support the
sentence they sit next to; the validation here (ids exist, phrase occurs once) proves the link is
well-formed, not that the target supports the phrase. Worth knowing that the shipped fidelity guard
for summaries does check cited paragraphs against what they say (caught 24 of 30 hand-labelled
faults), and a similar check could be considered for xrefs. **Untested:** whether the hover card is
used, or just makes the text look more authoritative.

### Summaries and the fidelity guard ([summaries.md](../../project/summaries.md))

Not in my brief but the most exposed to this literature. Each paragraph links to the passages it
rests on and is checked against them by a quick-tier model; the doc says the guard cannot catch what
the cited passages do not say, which is Peters & Chin-Yee's overgeneralisation in another form (a
claim wrong about the article but not contradicted by its own passages passes). **Suggests a change
(proposal):** test the guard on generalisation-scope errors specifically, using the 4,900-summary
corpus if it is released; and the Brief level is the most Fan-et-al.-like "terminus" risk, so
keeping the door visible matters more than its copy does.

## Not verified

- The CHI 2025 version of Spatharioti et al. (I read the 2023 preprint with the same data; did not
  confirm the CHI DOI or whether numbers changed).
- Whether the "advice written after AI summaries was shorter, less factual" seven-experiment study
  quoted in the earlier note exists as claimed. I could not find it; do not cite it from there.
- The 2026 knowledge-graph overtrust and academic-researchers' verification studies seen in search
  results (not opened).
- Peters & Chin-Yee's limitations section and the final third of the text (read to 100,000 of
  159,000 characters).
- The anchoring study cited in the earlier note (ScienceDirect S0268401225000076); not re-opened.

## Search log

Web search (standard and extended) for: Peters & Chin-Yee; Ding citations and trust; Spatharioti
LLM search; AI summary versus full text comprehension; Etkin; Tang medical evidence summarisation;
Fok & Weld; source citations and verification user studies; Fernandes metacognition. Opened
publisher, ACL Anthology, AAAI mirror, Frontiers, Europe PMC full text (Peters, Tang), ar5iv (Bansal,
Buçinca, Vasconcelos, Kim, Fok & Weld, Spatharioti), arXiv abstract pages (Sim, Irons), Aalto
research portal, Semantic Scholar API (Fan et al. abstract), and Crossref for DOI/title checks. PubMed
and the Royal Society and Nature pages blocked the fetcher (403/cookie wall), so Europe PMC was used.
Crossref returned 429 under parallel requests and was retried singly. The earlier note's "Etkin" lead
was traced to the Frontiers paper above. No retractions or corrections found. Two null or contrary
results: Bansal (explanations no better than confidence) and Tang (summaries mostly sound).

## Sources

1. Parasuraman R, Manzey DH (2010). Complacency and bias in human use of automation: an attentional
   integration. *Human Factors* 52(3). https://doi.org/10.1177/0018720810376055 — checked 2026-10-10 (abstract only, via Crossref).
2. Goddard K, Roudsari A, Wyatt JC (2012). Automation bias: a systematic review of frequency, effect
   mediators, and mitigators. *JAMIA* 19(1):121-127. https://doi.org/10.1136/amiajnl-2011-000089 — checked 2026-10-10 (abstract only, via Europe PMC).
3. Gaube S et al. (2021). Do as AI say: susceptibility in deployment of clinical decision-aids. *npj
   Digital Medicine* 4:31. https://doi.org/10.1038/s41746-021-00385-9 — checked 2026-10-10 (abstract only).
4. Peters U, Chin-Yee B (2025). Generalization bias in large language model summarization of
   scientific research. *Royal Society Open Science* 12(4):241776. https://doi.org/10.1098/rsos.241776 — checked 2026-10-10 (full text, partial, via Europe PMC).
5. Tang L et al. (2023). Evaluating large language models on medical evidence summarization. *npj
   Digital Medicine* 6:158. https://doi.org/10.1038/s41746-023-00896-7 — checked 2026-10-10 (full text, via Europe PMC).
6. Sim M, Eiger Y, Kohno T (2026). AI-enabled human memory manipulation: misleading AI-generated
   summaries distort human memory. arXiv:2609.28820 (preprint). https://arxiv.org/abs/2609.28820 — checked 2026-10-10 (abstract; results from the Georgetown press page).
7. Etkin HK, Etkin KJ, Carter RJ, Rolle CE (2025). Differential effects of GPT-based tools on
   comprehension of standardized passages. *Frontiers in Education* 10. https://doi.org/10.3389/feduc.2025.1506752 — checked 2026-10-10 (full text).
8. Fan G, Liu D, Huang Y (2025). Skim or swim? Investigating AI-generated summaries, trust, and
   comprehension in Chinese mobile reading. *Int J Human–Computer Interaction* 42(12):9025-9046. https://doi.org/10.1080/10447318.2025.2574513 — checked 2026-10-10 (abstract only, via Crossref and Semantic Scholar).
9. Ding Y et al. (2025). Citations and trust in LLM generated responses. *Proc AAAI* 39(22):23787-23795. https://doi.org/10.1609/aaai.v39i22.34550 — checked 2026-10-10 (full text, via a text mirror).
10. Liu NF, Zhang T, Liang P (2023). Evaluating verifiability in generative search engines.
    *Findings of EMNLP 2023*. https://doi.org/10.18653/v1/2023.findings-emnlp.467 — checked 2026-10-10 (abstract and ACL page).
11. Irons J et al. (2026). To believe or not to believe: comparing supporting information tools to aid
    human judgments of AI veracity. arXiv:2603.11393 (preprint). https://arxiv.org/abs/2603.11393 — checked 2026-10-10 (abstract only).
12. Si C et al. (2024). Large language models help humans verify truthfulness, except when they are
    convincingly wrong. *NAACL 2024*, 1459-1474. https://aclanthology.org/2024.naacl-long.81/ — checked 2026-10-10 (abstract only).
13. Bansal G et al. (2021). Does the whole exceed its parts? The effect of AI explanations on
    complementary team performance. *CHI '21*. https://doi.org/10.1145/3411764.3445717 — checked 2026-10-10 (full text, via ar5iv; DOI via Crossref).
14. Vasconcelos H et al. (2023). Explanations can reduce overreliance on AI systems during
    decision-making. *Proc ACM HCI* 7(CSCW1). https://doi.org/10.1145/3579605 — checked 2026-10-10 (full text, via ar5iv; DOI via Crossref).
15. Fok R, Weld DS (2023). In search of verifiability: explanations rarely enable complementary
    performance in AI-advised decision making. arXiv:2305.07722 (position paper, preprint). https://arxiv.org/abs/2305.07722 — checked 2026-10-10 (full text, via ar5iv).
16. Buçinca Z, Malaya MB, Gajos KZ (2021). To trust or to think: cognitive forcing functions can reduce
    overreliance on AI in AI-assisted decision-making. *Proc ACM HCI* 5(CSCW1). https://doi.org/10.1145/3449287 — checked 2026-10-10 (full text, via ar5iv; DOI via Crossref).
17. Kim SSY et al. (2024). "I'm not sure, but...": examining the impact of large language models'
    uncertainty expression on user reliance and trust. *FAccT '24*. https://doi.org/10.1145/3630106.3658941 — checked 2026-10-10 (full text, via ar5iv; DOI via Crossref).
18. Spatharioti SE, Rothschild DM, Goldstein DG, Hofman JM (2023; CHI 2025 version not opened).
    Comparing traditional and LLM-based search for consumer choice: a randomized experiment.
    arXiv:2307.03744 (preprint version). https://arxiv.org/abs/2307.03744 — checked 2026-10-10 (full text of preprint).
19. Fernandes D et al. (2026). AI makes you smarter but none the wiser: the disconnect between
    performance and metacognition. *Computers in Human Behavior* 175:108779. https://doi.org/10.1016/j.chb.2025.108779 — checked 2026-10-10 (abstract only).
