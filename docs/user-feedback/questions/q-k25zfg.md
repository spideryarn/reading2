---
id: q-k25zfg
report: spya-pn7gvw
status: open
asked: 2026-11-01
title: Structure one level deeper failed its tests: retry with the AI thinking, a new wording, or stop at three levels?
refs: qi-negzd289 · docs/plans/261029a-structure-one-level-deeper.md · docs/investigations/261101b-structure-fourth-level-two-wordings-measured.md · docs/user-feedback/261029_0300-structure-one-level-deeper.md · q-vrnbyj · spya-pn7gvw
---
I tried two wordings of the Structure prompt that add sub-sections. Both made the extra level on your consciousness paper, but each also left one other article with no sections at all, in both test runs. So I have not shipped it, and your paper has not been re-run. How should I go on?

A. Try again with the structure AI allowed to think before it answers. Today it never does: 0 thinking tokens on every call, old prompt included. My guess is that this is why it follows the more complex instructions unreliably. It will be slower and somewhat dearer for every new article, by an amount I would measure first; the rule stays under about a fifth more. About one session and $10 of tests.
B. A third wording, still not thinking, tested on articles it was not tuned on. Cheaper per article if it works, but two wordings have already failed in different places. About one session and $8.
C. Both A and B side by side on the same fresh articles, and ship whichever passes every check (or neither). About one session and $12.
D. Stop at three levels for now. Nothing changes for readers. The test kit and both wordings are kept for later.

Recommendation: C. It costs little more than A or B alone and answers both at once. If neither passes, D.

Details

What you asked (29 Oct, from Structure on the consciousness paper): for Structure to go one level deeper, e.g. each theory in "2.4 Other Theories" as its own row. You chose "automatically" and the layout where column B opens the section you are in. The reading-view half of that is built and live. It draws sub-sections whenever an article's outline has them, but no article's outline has them yet. You also said yes to re-running your paper once the prompt changed. That re-run waits on this.

What I did today. The AI key had reset. I built a test that runs the real structure step on 14 of your own articles: your paper, a book (Rovelli), six papers whose sections the author divides with sub-headings, and six without. Each version ran twice, $10 in all. The test checks quality before cost. Your paper must come out right: 2.4.1 to 2.4.6 under 2.4, 2.5 beside 2.4, and the mis-tagged 2.4.5(a)-(c) not promoted. No short section may be split at a made-up join. No article may be left with fewer than half as many sections in both runs.

What came back.
- Cost and time are fine: the median article changed by about +3% in cost and +1% in time.
- On your paper the second wording got everything right, twice. That is what you would see.
- But wording 1 turned one paper's outline into ten bare parts with no sections, in both runs. Wording 2 fixed that paper and did the same to another one, whose minor headings are unnumbered. A few articles with only top-level headings also came out with noticeably fewer sections.
- About one in six of the authors' sub-headings became sub-sections overall: 43 of 340 with wording 1, and 61 of 266 with wording 2.

Your paper, today and with wording 2:

```
today                          wording 2
2 Scientific Theories          2 Scientific Theories
  2.1 Recurrent Processing       2.1 Recurrent Processing
  ...                              2.1.1 Introduction ...
  2.4 Other Theories  (76 paras)   ...
                                 2.4 Other Theories
                                   2.4.1 Attention Schema Theory
                                   ... 2.4.6 Time and Recurrence
                                 2.5 Indicators of Consciousness
```

Why I think thinking matters. This call is set to low effort, and under a strict answer format it skips thinking entirely. A second model (Opus) read the evidence and agreed: without thinking, cautions meant for sub-sections leak into how it makes sections.

Not asked, decided myself: every structure run now logs how many sub-sections it made and how many author headings it swallowed, so whatever ships is watched from its first article. A third wording tuned on the same 14 articles would just be fitting the test, so A, B and C all use fresh articles.
