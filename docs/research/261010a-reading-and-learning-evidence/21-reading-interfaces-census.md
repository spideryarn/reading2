# AI and intelligent reading interfaces in HCI: a census, and how they were evaluated

Up: [reading-research-overview.md](../../project/reading-research-overview.md) · part of the
[reading and learning evidence library](digest.md), 2026-10-10.

The question: what has human-computer interaction (HCI) research actually built to help people read
papers and long articles, how was each tool tested, and what did the tests find, including the
null results? The short answer: the field has built many thoughtful augmentation tools (definitions in
place, skim highlights, citation context, plain-language gists), but the studies are **small** (mostly
9–27 people), **short** (4–20 minutes), and mostly measure **speed, preference and perceived ease**.
Where correctness or comprehension was measured, tools usually did **not** improve it; the best they
claim is "no loss". The few controlled 2025 studies of generative-AI help with comprehension (on
passages, not papers) show a split: weaker readers gain, stronger readers can lose, especially with
summaries that replace the text. This is a census of prior art and evaluation methods, not a review
of learning science; other files in the library cover that.

## The short answer

- Most reading-interface studies measure **time, ease, confidence and preference**; very few measure
  comprehension, and none that we found measures delayed retention of a paper's argument by expert
  adults (**High certainty · Direct**, for the pattern across the studies below).
- Where answer **correctness** was tested, the tool made no significant difference: ScholarPhi
  (16/27, 20/27 and 16/27 correct across three conditions), Scim (0.80 vs 0.76), Paper Plain (52% vs
  50%) (**Moderate certainty · Direct**; each study is small).
- The consistent gains are in **speed and effort**: ScholarPhi answered terminology questions 45 s
  faster (about 2.2 vs 3.0 minutes), Scim 23 s faster overall (**Moderate certainty · Direct**).
- A tool can feel better while a reader understands no more: Paper Plain readers rated difficulty
  and understanding much better, but comprehension was equal, and one reader who used only the gists
  rated their understanding highly and scored 2/7 (**Low certainty · Direct**; a single case, noted by
  the authors).
- Generated summaries that **replace** the text help weaker readers and can hurt stronger ones: in a
  pre-registered crossover with 195 young adults, an AI summary lowered quiz scores of high performers
  (d = 0.83) while raising low performers' (d = 0.45); a Socratic chatbot helped low performers most
  (**Moderate certainty · Indirect**: ACT passages, not papers).
- Experience seems to matter: a small CHI 2026 extended abstract found experienced HCI researchers'
  critical thinking improved with LLM help while novices' tended to decline (13 people) (**Low
  certainty · Direct**; abstract only).
- Evaluation papers are open about the weakest link: model errors. Qlarify's expansions were 87.5%
  fully accurate, and no interviewee noticed the errors (**Moderate certainty · Direct**).
- Spideryarn's planned study has stronger measures (written reconstruction, blinded scoring, a
  calibration contrast) than most of this literature; borrowable additions are listed below
  (**Moderate certainty · Direct**; a judgement, not a finding).

## The evidence: a census, one row per system

Population is "researchers" (mainly PhD students) unless stated. "Correctness" means answer accuracy
on set questions.

| System (paper, venue) | What it does | Study (N, design) | Measured | Found, including nulls |
|---|---|---|---|---|
| **ScholarPhi** (Head et al. 2021, CHI '21) | In a PDF-like reader, tooltips give the definition of a term or symbol at the point where you meet it; usage filters; equation diagrams; a glossary | 27 researchers (18 PhD), remote, within-subject, 3 interfaces (basic PDF, "declutter" only, full) x 3 timed 4-minute questions, one paper; plus 15–20 min free reading | Time, correctness, confidence, ease, area of paper viewed | Faster (2.2 vs 3.0 min), easier (+1.70 on 5-point), less scrolling. **Correctness: no significant difference** (16/27 vs 16/27). The symbols question went badly with the tool: the definitions list did not show every sense of an overloaded symbol and readers trusted it as complete. 26/27 used a feature; the priming glossary was least used. Definitions were extracted by hand, so extraction errors were not tested |
| **Paper Plain** (August et al. 2023, ACM TOCHI 30(5)) | For lay readers of medical papers: key-question index with answer passages, plain-language section gists, term definitions | 24 Upwork workers (no medical training, all college-educated), within-subject, 4 interfaces, two 10-minute papers; 14 multiple-choice questions written with physicians | Self-rated difficulty, understanding, confidence; proportion correct (non-inferiority test) | Difficulty 4.0 to 2.0, understanding 2.0 to 3.5 (medians), all significant. **Comprehension 52% vs 50%, a non-inferiority result, not a gain**; the authors note the questions could be answered from the original text, so equal scores prove little. Section gists and term definitions alone did **not** significantly improve any subjective measure; readers leaned on the question index |
| **Scim** (Fok et al. 2023, IUI '23) | Highlights salient sentences by rhetorical facet (goal, method, result...) for multi-pass skimming | 19 NLP-literate readers (lab, within-subject, 6 papers, questions whose answers were/were not in the highlights); 12-person two-week diary study | Time to correct answer, first-response accuracy, perceived difficulty | Faster overall (94 vs 118 s), but **no time gain when the answer was not highlighted** (p = .45); **accuracy 0.80 vs 0.76 and difficulty, no difference**. Diary: 70.4% of responses said highlights helped. Classifier F1 0.53 vs annotator agreement 0.73; some readers just used Ctrl+F |
| **CiteSee** (Chang et al. 2023, CHI '23) | Marks inline citations by what the reader has read, saved or published, to guide literature discovery | Lab: 10 researchers rated 5 citations chosen by each of 4 strategies; field: 6 of them for 1–2 weeks | Rated importance of highlighted citations; papers opened/saved; interviews | Personalised strategy rated far higher (about 87% agree) than baselines (about 32–58%). 57% of saved papers came from inline citations. Outcome is *discovery*, not understanding; cold-start, echo-chamber and overload concerns reported |
| **Threddy** (Kang et al. 2022, UIST '22) | Lets readers clip sentences from related-work sections into a hierarchy of "threads", recommends papers | 9 scientists, within-subject vs Google Docs, two 20-minute literature reviews | Counts of threads/clips/references, flow, workload (NASA-TLX), acceptance | 2x clips, 2.6x references, higher flow. **Threads created: no difference**; workload and acceptance not significant (authors suspect familiarity with Docs). Output counts are not understanding |
| **CiteRead** (Rachatasumrit et al. 2022, IUI '22) | Places comments from later citing papers in the margin of the paper you are reading | 12 scientists vs a plain list of citing papers (abstract only) | "Comprehension and retention of follow-on work" | Reported improvement; I could not read the instruments, so the result is not usable beyond "reported" |
| **Qlarify** (Fok et al. 2024, UIST '24) | Expand an abstract in place, one question at a time, with an answer linked to source passages | Interviews (9); field log of 275 VLDB users; within-subject comparison of 12 (manual, chat-QA, Qlarify), 15 min each, shortlisting 80 papers; accuracy check of 120 expansions | 7-point satisfaction, "gained information", motivation; interaction logs; accuracy | Higher satisfaction and motivation than manual. Users opened source PDFs less (time in PDFs 539 s manual, 201 s Qlarify, no test reported); evidence was opened in 14.8% of field expansions. 87.5% of expansions fully accurate; **no participant spotted the errors**. Gains over the chat condition did not survive correction. **No comprehension outcome**; authors warn about shallow, abstract-only exploration |
| **Semantic Reader Project** (Lo et al. 2024, CACM 67(10); arXiv 2023) | Umbrella for ten prototypes (the above, plus Ocean, Papeo, Relatedly, SciA11y) and a production reader | Reports 300+ participants across studies (no per-study N in the arXiv abstract page I read) | Mixed | Authors say even slight AI errors harmed readers in testing; bespoke models were slow to build. Useful as a map, not as evidence of learning |

Two of the "leads" are not reading systems and are left out: Dang et al. 2022 (summaries in the
margin) and Kim et al. 2023 (Cells, Generators, Lenses) are about *writing* with AI, at UIST rather
than CHI. Dang et al.'s idea (a paragraph's summary in the margin) is relevant by analogy only; see
Not verified.

### Which outcomes were measured

Reading across the table, outcomes fall into five kinds, and they are kept apart here because tools
move them differently.

- **Speed to find a fact** (ScholarPhi, Scim): improved, but only when the tool had the answer. Scim
  showed no gain when the answer sat outside the highlights.
- **Perceived ease and confidence** (ScholarPhi, Paper Plain, Qlarify): improved, consistently.
- **Correctness or comprehension** (ScholarPhi, Scim, Paper Plain): not improved; at best non-inferior.
- **Discovery and output counts** (CiteSee, Threddy): improved, but these measure finding things, not
  understanding them.
- **Calibration**: essentially unmeasured, apart from Paper Plain's anecdote of high rated
  understanding with a low score.

### 2023–26 LLM reading aids with a controlled comprehension measure

This is a short list, which is itself a finding.

- **Etkin et al. 2025**, *Frontiers in Education* (pre-registered, randomised, within-subject
  crossover). 195 US 18–22-year-olds (Prolific) read official ACT passages and answered 10 questions
  each without the passage in view. Five conditions: AI summary replacing the passage, AI outline,
  Q&A tutor, Socratic chatbot, no AI. Low performers (n = 71; control 44.9%): Socratic 63% (d = 0.86),
  outline d = 0.74, Q&A d = 0.50, summary d = 0.45. High performers (n = 124; control 82.5%): summary
  66.5% (d = 0.83 *worse*), outline d = 0.51 worse, Q&A d = 0.37 worse, Socratic d = 0.33 worse.
  Control accuracy correlated with AI benefit at r = -0.785. Limits: one session, single use of each
  condition, no delayed test, passages not papers, sample above national SAT/ACT averages. This is
  the closest thing to a controlled test of the "summary replaces reading" worry. (**Moderate
  certainty · Indirect**; full text read.)
- **Etkin's result in context**: Paper Plain and Skim-or-Swim agree in direction. The mobile-news
  study (Skim or Swim, *Int. J. Human-Computer Interaction* 2025; 47 adults, six articles, within-subject;
  abstract only) reports that reading the full text first gave the best comprehension, opening the full
  text after a summary largely closed the gap, and prior domain knowledge reduced the penalty of
  summaries alone. (**Low certainty · Indirect**; abstract only, news not papers, sample small.)
- **Bae et al. 2026**, CHI '26 Extended Abstracts: 13 student HCI researchers (5 experienced, 8
  novices) read papers with and without an LLM and wrote critical reviews; experienced researchers'
  critical thinking improved, novices' tended to decline, with wide individual variation. Closest to
  Spideryarn's readers in task, but tiny and an extended abstract. (**Low certainty · Direct**;
  abstract only, via the Semantic Scholar record of the paper.)
- **Melumad and Yun 2025**, *PNAS Nexus* 4(10): pgaf316. Seven online and lab experiments (10,462
  participants) found learners using LLM summaries reported shallower knowledge and wrote sparser,
  less original advice than those using web search, even when summaries included live links. This is
  about learning a topic by search, not reading a given text. (**Moderate certainty · Analogy**;
  abstract only.)
- **Guidroz et al. 2025** (preprint, arXiv:2505.01980, not peer reviewed): 4,563 participants read
  original or LLM-simplified texts (including PubMed articles) and answered multiple-choice questions;
  simplified readers scored 3.9 points higher overall, 14.6 on PubMed. Labelled preprint, not
  load-bearing. It tests whether a *rewritten text* is easier to answer questions about, which is a
  different claim from "a reader understands the original better".
- **Mannhardt et al. 2024** (preprint, arXiv:2401.09637): 200 healthy women randomised to three
  levels of LLM augmentation of clinical notes improved on understanding scores; interviews with 7
  patients; a clinician-led error analysis. Preprint, patients not experts. Not load-bearing.

## How these systems were evaluated, and what Spideryarn could borrow

The Spideryarn study protocol
([260910a](../../investigations/260910a-reader-study-protocol-do-the-reading-tools-help-understanding.md))
asks four readers to read two whole articles (one in Spideryarn, one as plain prose) for 15 minutes
each, then write the argument from memory, rate their own confidence, answer claim-and-evidence,
term and weak-point questions, and optionally recall it a few days later. Scoring is blind, against
marking sheets written before any generated text was seen. It is formative: no verdict from four
people.

Compared with the census:

- **Already stronger than the field.** The free-recall reconstruction is a deeper measure than the
  multiple-choice questions used by Paper Plain, or the fact-finding in ScholarPhi and Scim, which
  measure *finding* rather than *holding*. Pairing confidence with reconstruction measures
  calibration, which none of the census studies did. Using whole articles, not extracted passages, and
  blinded scoring against pre-written sheets are also rare here. The pre-declared "what counts as a
  signal or a harm" avoids the field's habit of reporting only the metrics that moved.
- **Borrow: a no-peeking comprehension test that cannot be answered by the tool's text.** The Paper
  Plain authors say their questions could be answered from the original text, so equal scores were
  expected. The protocol's open-book questions with the article open in the same condition carry the
  same risk; the closed-book reconstruction is what protects it. Keep it first and unchanged.
- **Borrow: a "what the tool did not highlight" control.** Scim's split of questions whose answers
  were or were not in the highlights is how the authors saw that speed gains vanish off-highlight. A
  parallel for Spideryarn: include one claim or term that the summaries and glossary do **not**
  cover, and see whether tool readers do worse on it than prose readers (a measure of whether
  generated structure narrows attention).
- **Borrow: a seeded trap.** ScholarPhi's symbols question exposed a tool that looked complete but
  was not. Seeding one known hole (an overloaded term, a figure the extractor garbles) tests whether
  readers notice. Qlarify's finding that nobody noticed 12.5% of expansions being inaccurate or
  incomplete argues for it. This extends the protocol's "material distortion" count, which only
  catches errors readers *repeat*.
- **Borrow: timed fact lookup as a secondary, cheap measure.** Time-to-answer on 3–4 pre-written
  questions is how ScholarPhi, Scim and Qlarify showed an effect at N around 12–27. It speaks to the
  "efficiently" half of the tagline and adds little to the session length. The protocol deliberately
  does not time anything; if added, keep it separate from the comprehension contrast.
- **Borrow: a longer diary phase, later.** Scim's two-week diary (12 people, logged use plus short
  daily entries) was the only long-run view in the census. After the four-reader study, a diary can
  show whether the modes get used and whether trust changes, without claiming comprehension.
- **Borrow: report effect sizes and stratify by reader skill.** Etkin et al. found that the sign of the
  effect flipped with baseline skill (r = -0.785). With four readers Spideryarn cannot stratify, but
  the protocol should record each reader's familiarity with the article's field and their
  prose-condition score, so a later, larger study can ask "who is helped and who is hurt" and the
  earlier readers are not wasted.
- **Borrow: counterbalancing and mixed-effects analysis for a later round.** ScholarPhi and Paper Plain
  used within-subject designs with counterbalanced order and mixed-effects models. At four readers
  the protocol correctly refuses inference; at 16–24 these methods are standard.
- **Avoid: self-report-only success.** Qlarify's satisfaction and "gained information" ratings, and
  CiteSee's importance ratings, are common headline numbers. The census shows they can move while
  correctness does not.

## Where it is weak, contested or contrary

- **Population mismatch.** Most census studies use PhD students or NLP/HCI researchers on papers from
  their own field, or lay crowd-workers (Paper Plain). Neither is "educated adult reading outside their
  field", which is Spideryarn's likely reader. Only Paper Plain studied non-experts, and they were
  paid crowd-workers reading medical papers.
- **Tiny, short, single-paper studies.** The ScholarPhi authors list one stimulus paper and three
  4-minute questions as limitations; Paper Plain used 10 minutes per paper; Threddy 20 minutes; none
  followed readers for retention beyond Scim's diary (self-report).
- **Same-lab evaluation.** ScholarPhi, Paper Plain, Scim, CiteSee, CiteRead, Qlarify and Threddy are
  all from the Semantic Reader network of authors; the authors rate their own systems' studies. I found
  no independent replication of any of them.
- **Mechanical gains may be scanning gains.** Scim's authors note some readers used Ctrl+F; speed
  gains in fact-finding may not carry over to understanding an argument.
- **Equal comprehension is not evidence of benefit.** "No loss" (non-inferiority) was Paper Plain's
  claim, and the questions allowed answering from the original text. It supports "does not harm
  comprehension at 10 minutes", no more.
- **Verification is where AI augmentation fails quietly.** Qlarify's 87.5% accuracy and unnoticed errors,
  Scim's F1 of 0.53, and ScholarPhi's overloaded symbol all suggest readers over-trust a tool that
  looks complete. The Semantic Reader authors state that slight AI errors harmed readers.
- **Direction of the 2025 generative-AI results could mean we built the wrong thing.** If summaries and
  outlines that replace reading hurt strong readers (Etkin et al.), a product aimed at skilled adults
  should keep generated structure strictly secondary to the prose. The Socratic chatbot's advantage for
  weaker readers (and its smaller cost for strong ones) points to *asking the reader* as safer than
  *telling the reader*. That cuts for Learn and Quiz modes, and against summary-first designs.
- **Evidence for LLM harm to learning is largely outside reading.** The most cited controlled result
  of AI harming learning without guardrails (Bastani et al. 2025, PNAS, high-school mathematics) is
  not about reading (I confirmed the paper's title and venue only); it is Analogy at best.
- **Gap.** I found no controlled study of an LLM reading assistant on expert adults reading full research
  papers with a delayed comprehension test. Spideryarn's study would be unusual, even at N = 4.

## What it means for Spideryarn

Mode descriptions below are from the entry-point docs and the protocol; I have not re-read each mode's
doc beyond the signposts.

**The Spideryarn reader study** ([protocol](../../investigations/260910a-reader-study-protocol-do-the-reading-tools-help-understanding.md)).
- **Supports:** closed-book written reconstruction, confidence set against it, blinded scoring and
  pre-declared harm criteria are all better than the census norm, and the census gives the reason: tools
  reliably change speed and feeling, rarely correctness.
- **Suggests a change (proposals):** add one "off-the-tool" item per article; seed one known hole;
  record reader familiarity and prose-condition score; consider a short timed fact-lookup block as a
  separate secondary measure.
- **Untested:** whether a four-person formative study can detect anything a 27-person timed study
  could not; the protocol's own honesty about this is the right stance.

**Glossary** ([glossary.md](../../project/glossary.md)), in-place definitions.
- **Supports:** the closest relative is ScholarPhi's tooltips, which readers used most and which sped
  lookup without hurting correctness.
- **Suggests a change:** the symbols failure suggests showing when a term is used in more than one
  sense, or saying "this list may be incomplete", rather than presenting a single definition as
  complete.
- **Untested:** whether definitions improve understanding of an argument; ScholarPhi measured lookup
  only.

**Summaries and Structure** ([summaries.md](../../project/summaries.md), [structure.md](../../project/structure.md)).
- **Supports:** the principle of keeping prose one click away. Qlarify found people open source PDFs
  less when a generated answer is in front of them, and Etkin found strong readers lose from summaries
  that replace text; Paper Plain's single gist-only reader scored 2/7.
- **Suggests a change:** keep summaries clearly beside, not instead of, the prose; consider making the
  link to the source passage the default action (a "door" in the protocol's language).
- **Untested:** whether structure outlines (Etkin's "outline" condition helped low performers but hurt
  high performers) help or hurt experts reading whole papers.

**Skim** ([skim.md](../../project/skim.md)) and **Quotes** ([quotes.md](../../project/quotes.md)).
- **Supports:** Scim is the nearest published system (salient sentences, multiple passes). Its
  verdict: faster fact-finding, no accuracy gain, and no help when the answer is off the highlights.
- **Suggests a change:** none firmly; state plainly in the docs that Skim is for triage and speed, not
  proven for comprehension.
- **Untested:** whether three passes through quotes leave a reader with better reconstruction than one
  careful read.

**Learn and Quiz** ([learn-mode.md](../../project/learn-mode.md), [quiz.md](../../project/quiz.md)).
- **Supports:** the only chatbot condition that helped the weaker group most and cost strong readers
  least in Etkin et al. was the Socratic one.
- **Suggests a change:** none yet; this is the best argument in the census for making "the reader
  answers first" the default shape.
- **Untested:** all of this on papers, with experts, with a delay.

**Sources / Citations** ([sources.md](../../project/sources.md), [bibliography.md](../../project/bibliography.md)).
- **Supports:** CiteSee and CiteRead are the nearest relatives, and both are rated well by researchers.
- **Suggests a change:** none. Note their outcome was discovery and "reported" comprehension of follow-on
  work, not understanding of the paper itself.
- **Untested:** whether margin citation context helps or crowds a reader outside their field.

## Not verified

- **Dang et al. 2022**, "Beyond Text Generation: Supporting Writers with Continuous Automatic Text
  Summaries", UIST 2022, DOI 10.1145/3526113.3545672: seen only in a search snippet (two studies, N = 4
  and N = 8, writers); about writing, not reading.
- **Kim et al. 2023**, "Cells, Generators, and Lenses", UIST '23, DOI 10.1145/3586183.3606833: seen only
  in a search snippet; about writing interfaces; out of scope.
- **Kreijkes et al. 2025**, "Effects of LLM use and note-taking on reading comprehension and memory: a
  randomised experiment in secondary schools" (405 students aged 14–15, per a search snippet; Computers &
  Education per the ScienceDirect URL): the SSRN and ScienceDirect pages returned 403 and the PDF could
  not be read. Direction in the snippet: note-taking, alone or with the LLM, beat the LLM alone for
  retention and comprehension. This would be highly relevant (the same underlying question as
  Spideryarn's "write it down" step) and is worth a manual read.
- **Bastani et al. 2025** (PNAS 122(26)): title and venue confirmed via Crossref; findings not read.
- **Fok and Weld**, "In search of verifiability" (AI Magazine 45(3), 2024, DOI 10.1002/aaai.12182):
  seen in a search snippet only; relevant to why explanations rarely help readers catch AI errors.
- **Head et al. 2021, Paper Plain and CiteSee full texts** were read via arXiv HTML renderings
  (ar5iv); the first ~100,000 characters of each were read, the remainder unread, except Paper Plain
  where the second part was read for the comprehension results.
- CiteRead's instruments and the Semantic Reader per-study Ns were not found.

## Search log

- Web search (Google-style, via the search tool): Semantic Reader / ScholarPhi / Paper Plain / Scim /
  CiteSee / Threddy / Qlarify / CiteRead / Dang / Kim by title; "LLM reading assistant controlled
  study reading comprehension"; "AI-generated summaries versus full text comprehension experiment";
  "chatbot scientific paper reading study comprehension novices"; Melumad and Yun; Fok and Weld.
- Fetched: arXiv abstract pages and ar5iv HTML full texts (PDF fetches returned unreadable binary);
  Crossref API for titles/venues (some requests returned 429 and were retried); Semantic Scholar
  Graph API for abstracts of CiteRead, Bae et al. and Skim or Swim (the Semantic Scholar SSRN lookup
  returned 404). Publisher pages for ACM and Taylor & Francis returned 403 except where noted.
- Citation chaining: from the Semantic Reader overview to its member papers; from search results to
  Etkin et al.
- Retractions: none found. One **internal inconsistency**: Threddy's text and table give different
  p-values for one Likert item (p = 0.01 vs 0.001), flagged by my reader of the paper, not checked
  independently.
- Null results found and recorded above: ScholarPhi correctness; Scim accuracy, difficulty and
  off-highlight time; Paper Plain comprehension and section-gist-only condition; Threddy thread count,
  workload, acceptance; Qlarify gains over the chat condition after correction.
- **Not searched** (out of scope here): learning-science reviews of reading; eye-tracking of reading;
  social annotation (Hypothes.is) outcomes, covered in the earlier research
  [prior-art-and-cognitive-offloading.md](../260831e-helping-peer-reviewers/prior-art-and-cognitive-offloading.md) §4.
  That file observed that reading-tool vendors have mostly not been independently studied for
  comprehension; this census agrees for academic prototypes too.

## Sources

Venue and year checked against Crossref unless stated. "Full text" means a full-text rendering was
opened (arXiv HTML); the venue version may differ in detail.

1. Head, A., Lo, K., Kang, D., Fok, R., Skjonsberg, S., Weld, D. S., Hearst, M. A. (2021). Augmenting
   Scientific Papers with Just-in-Time, Position-Sensitive Definitions of Terms and Symbols. CHI '21.
   https://doi.org/10.1145/3411764.3445648 (arXiv:2009.14237). Checked 2026-10-10 (full text, first
   ~100,000 characters).
2. August, T., Wang, L. L., Bragg, J., Hearst, M. A., Head, A., Lo, K. (2023). Paper Plain: Making
   Medical Research Papers Approachable to Healthcare Consumers with Natural Language Processing. ACM
   Transactions on Computer-Human Interaction 30(5). https://doi.org/10.1145/3589955
   (arXiv:2203.00130). Checked 2026-10-10 (full text).
3. Fok, R., et al. (2023). Scim: Intelligent Skimming Support for Scientific Papers. IUI '23.
   https://doi.org/10.1145/3581641.3584034 (arXiv:2205.04561). Checked 2026-10-10 (full text, first
   ~100,000 characters).
4. Chang, J. C., Zhang, A. X., Bragg, J., Head, A., Lo, K., Downey, D., Weld, D. S. (2023). CiteSee:
   Augmenting Citations in Scientific Papers with Persistent and Personalized Historical Context. CHI
   '23. https://doi.org/10.1145/3544548.3580847 (arXiv:2302.07302). Checked 2026-10-10 (full text, first
   ~100,000 characters).
5. Kang, H. B., Chang, J. C., Kim, Y., Kittur, A. (2022). Threddy: An Interactive System for
   Personalized Thread-based Exploration and Organization of Scientific Literature. UIST '22.
   https://doi.org/10.1145/3526113.3545660 (arXiv:2208.03455). Checked 2026-10-10 (full text).
6. Rachatasumrit, N., Bragg, J., Zhang, A. X., Weld, D. S. (2022). CiteRead: Integrating Localized
   Citation Contexts into Scientific Paper Reading. IUI '22. https://doi.org/10.1145/3490099.3511162.
   Checked 2026-10-10 (abstract only, via Semantic Scholar record and project page).
7. Fok, R., Chang, J. C., August, T., Zhang, A. X., Weld, D. S. (2024). Qlarify: Recursively Expandable
   Abstracts for Dynamic Information Retrieval over Scientific Papers. UIST '24.
   https://doi.org/10.1145/3654777.3676397 (arXiv:2310.07581). Checked 2026-10-10 (full text, first
   ~100,000 characters).
8. Lo, K., et al. (2024). The Semantic Reader Project. Communications of the ACM 67(10).
   https://doi.org/10.1145/3659096 (arXiv:2303.14334). Checked 2026-10-10 (arXiv abstract page and HTML
   rendering; not the CACM text).
9. Etkin, H. K., Etkin, K. J., Carter, R. J., Rolle, C. E. (2025). Differential effects of GPT-based
   tools on comprehension of standardized passages. Frontiers in Education 10: 1506752.
   https://doi.org/10.3389/feduc.2025.1506752. Checked 2026-10-10 (full text).
10. Bae, S., Song, H., Jeon, H., Kim, T., Suh, B. (2026). Supporting or Hindering? Understanding the
    Divergent Effects of LLM Assistance on Critical Thinking in Academic Reading. CHI '26 Extended
    Abstracts. https://doi.org/10.1145/3772363.3798788. Checked 2026-10-10 (abstract only, via Semantic
    Scholar record).
11. (Anonymous authors not captured.) Skim or Swim? Investigating AI-Generated Summaries, Trust, and
    Comprehension in Chinese Mobile Reading. International Journal of Human-Computer Interaction
    (2025). https://doi.org/10.1080/10447318.2025.2574513. Checked 2026-10-10 (abstract only, via
    Semantic Scholar record). Author names not read.
12. Melumad, S., Yun, J. H. (2025). Experimental evidence of the effects of large language models versus
    web search on depth of learning. PNAS Nexus 4(10): pgaf316.
    https://doi.org/10.1093/pnasnexus/pgaf316. Checked 2026-10-10 (abstract only, via Crossref).
13. Guidroz, T., et al. (2025). LLM-based Text Simplification and its Effect on User Comprehension and
    Cognitive Load. arXiv:2505.01980. **Preprint**, not peer reviewed. Checked 2026-10-10 (abstract
    page).
14. Mannhardt, N., et al. (2024). Impact of Large Language Model Assistance on Patients Reading Clinical
    Notes: A Mixed-Methods Study. arXiv:2401.09637. **Preprint**, not peer reviewed. Checked 2026-10-10
    (abstract page).
15. Bastani, H., et al. (2025). Generative AI without guardrails can harm learning: Evidence from high
    school mathematics. PNAS 122(26). https://doi.org/10.1073/pnas.2422633122. Checked 2026-10-10
    (title and venue only; not cited for findings).
