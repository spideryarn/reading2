---
id: q-k25zfg
report: spya-pn7gvw
status: answered
asked: 2026-11-01
title: Structure one level deeper failed its tests: retry with the AI thinking, a new wording, or stop at three levels?
refs: qi-negzd289 · qi-p6s6g6vw · docs/plans/261101d-structure-fourth-level-staged-second-call.md · docs/investigations/261101c-structure-fourth-level-staged-measured.md · docs/plans/261029a-structure-one-level-deeper.md · docs/investigations/261101b-structure-fourth-level-two-wordings-measured.md · docs/user-feedback/261029_0300-structure-one-level-deeper.md · q-vrnbyj · spya-pn7gvw
acted: spya-xb2rrn
---
Done your way: in stages. Structure now goes one level deeper wherever the author's own sub-headings divide a section, and it passed every test. It is on `dev`; once the Overseer deploys it, it re-runs your consciousness paper's structure in production, as you said yes to.

How it works. The first call is exactly today's, so nothing it makes can be lost. A second, small step then looks at each section: if the author's own headings one level down divide it, code cuts it at those headings, and one AI call writes a one-line summary for each piece. On your paper, 2.4's six theories each get their own row, 2.5 stays beside 2.4, and the (a)-(c) inside 2.4.5 stay inside it.

What it costs. Nothing on an article without sub-headings. On one with them, about a third more for the structure step (median +37%, 9 seconds more); your paper +13 cents. The paragraph labels cost the same as before.

Two things I decided without asking:
- A section the first call merged with its neighbour (it swallowed the next heading) is left exactly as it is, never given sub-sections that would put the neighbour inside it. That is common: about a third of the sections with headings inside.
- In a numbered paper, an unnumbered heading inside a numbered section is treated as a sub-heading. That is what makes it work on PDFs whose heading tags are wrong. The risk is a stray "Conclusion" shown one level too deep; it never happened in the tests.

Not done: a long section with no sub-headings is still not divided. That would be the next step, measured on its own, if you want it.

Your reply, 1 Nov (spya-xb2rrn): "I mean, this feels like a technical problem that you should be able to solve if you try a few different ways. I will say that one of the hunches I always had was that we should do this in multiple stages, perhaps hierarchically. So we might do the top level first, then the next level of granularity, and then perhaps an optional thing that would add yet a further level of granularity. So I don't know if that would help. Or alternatively, stick with what we have right now that works robustly for, you know, for the current approach, and a button that says add an extra level of granularity so the user can request it. That would work fine."

What was done with it: the staged approach was built and measured on 19 articles (five from before, fourteen fresh, one book). Every test passed: your paper right in both runs; 98% of the author's sub-headings found, none wrongly; no section lost; a blind reader found the new summaries faithful. September's version of the staged idea was tried first, but on articles it cost nearly three times as much and could misplace headings. The button was not needed. Plan 261101d; results 261101c.

The question first asked offered A (let the call think), B (a third wording), C (both) or D (stop at three levels); the staged route replaced all four.

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
