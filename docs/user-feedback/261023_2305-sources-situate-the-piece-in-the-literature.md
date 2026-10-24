---
reports: spya-w95xmq
ending: shipped
comment: Shipped behind the experimental switch: "Search the literature" at the top of Sources › Investigate (~$0.33–0.47, under a minute), with notes in Marginalia. An automatic second dive and fewer sub-modes are queued.
---

# Sources: situate the piece in the literature

Report `spya-w95xmq` (#689), from Greg (an admin), filed 2026-10-23 23:05 UTC on
`arxiv-2308-08708-spya-xax6v4`, in Sources › Investigate. A suggestion.

> I think the value that people keep asking for from Spideryarn is to situate an article relative to
> everything else in the literature, both before and especially after. So in terms of what it cites,
> maybe what it should have cited but didn't, whether what it cited says what they think it says,
> and especially whether there's something new since then that might change how we think about the
> article. […] at the end of the day, if it's an old paper, we probably care about what's been said
> since. If it's a brand new paper, we probably care more about situating it in the current
> literature. Depending on what kind of paper it is, that might affect the kinds of questions we're
> going to ask. And some of this is also going to be based on the user's profile and why they're
> reading it […] If there's a citation that doesn't say what it, you know, is purported to say, or
> if there's something new that would undermine a claim that's being made, like those are the kinds
> of things that will be gold in a margin annotation. […] I can imagine doing a crapload of web
> searches for each article and for the claims, and then feeding all of that in. […] as a gigantic
> input to a small or medium-sized model like Haiku or Sonnet, along with the article and anything
> else, and make use of prompt caching for the article […] ultimately, I want to get to the point
> where there are fewer sources submodes […] I'd say proceed autonomously. I prefer you didn't ask
> questions. Try and get to a fun, interesting version one, and then we can always pare it back.
>
> — Greg, 2026-10-23 (abridged; the whole of it is in the report)

**Ending: Shipped**, on `dev`, behind the experimental switch. Plan
[261024o](../plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md);
the research on how researchers and reviewers situate a paper,
[261024a](../research/261024a-situating-a-paper-in-the-literature-how-researchers-read-and-check.md);
the spike and the real runs, [261024b](../investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md).
GPT Sol reviewed the plan (it was reshaped) and each stage's code, beside the plan.

**What it does.** At the top of Sources › Investigate, *Where this piece sits* has one button,
*Search the literature*. One press, then hands-free: Sonnet reads the piece's opening and its most
relied-on references, decides what kind of piece it is and how old, and writes about 16 searches
(on the piece, on its claims, on its citations, on what it may have missed). They run on Exa;
when it can confirm the piece, OpenAlex adds the most-cited later papers with their abstracts. One
Sonnet read then takes the whole article (cached), every search result and your profile, and writes
findings anchored to passages: *Challenged*, *Citation?*, *Since*, *Not cited?*, *Reception*,
*Supported*. Each finding's passage
and each source's quote are checked in code against the article and that source's own text, so
every source shown is one the run actually found and says the words quoted from it. An old paper
is read for what has happened since, a new one for where it sits now. The dossier also suggests
five questions for this piece; *Ask in chat* on a finding is the agentic deeper dive. In
Marginalia, each passage with a finding gets one shut line (*Challenged · The 2025 Nature
adversarial collaboration…*), opening to the notes, the source links and *Open in Sources*.

**On *Consciousness in AI*, run for real**: 56 seconds, $0.47, 14 findings, including the 2025
*Nature* adversarial collaboration beside the ignition passage, Seth's *BBS* biological naturalism
beside the working hypothesis, the IIT "pseudoscience" letter, and the authors' own 2025 follow-up.
Every source's quote was real and bore out the core of its note; two notes named a second paper they
had no source for, and two older works were filed under *Since*. A 2026 paper: 52 seconds, $0.33, 10
findings.

**Decided rather than asked**, as you said:

- **No new sub-mode.** The dossier sits in Investigate, which moves Sources towards your "fewer
  submodes", not away. Folding Reception and Claims into it once you have used it is queued as
  `qi-mbh8appj` (marked as needing you).
- **No automatic second pass.** A search written by a model after it has read web pages can be
  steered by those pages, and a failure in it would lose the paid first pass. *Ask in chat* on a
  finding is the dive for now; a safe automatic one is queued as `qi-kqqst6vy`.
- **Sonnet, not Haiku**, reads: on the same evidence Haiku was an eighth of the price but lost three
  findings to the quote check and called a 2025 paper something the 2023 report "omits". A proper
  comparison, with a prompt fix for the two failure shapes above, is queued as `qi-9bc5xnwn`.
- **Behind the experimental switch**, as the dearest press in Sources; turn it out when you like it.

**Also queued**: a finding's chat found by the finding rather than its wording (`qi-mmtsxdhg`), and
retraction checks through Crossref (`qi-ktggbtqs`). All proposals: yours to authorise.

**Not done, worth knowing:** OpenAlex's record for this report's DOI carries another paper's title,
so the shared identity check refused it and no later papers came from OpenAlex on this article (the
same refusal hides Reception's *Cited by* here). Underlines in the prose were passed over for the
margin.
