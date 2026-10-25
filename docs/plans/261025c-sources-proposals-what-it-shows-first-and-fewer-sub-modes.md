# Sources: what it shows first, and six sub-modes folded into three — proposals to discuss

Written 2026-10-25, for Greg to discuss. **Nothing here is built.** The evidence is the trial on six
real articles, [261025a](../investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md);
the mode being reshaped is [sources.md](../project/sources.md). GPT Sol reviewed a first draft
([261025c-plan-review-sol.md](261025c-plan-review-sol.md)) and it was reshaped: its *B+* is now the
recommendation, and two of its findings became the second question. The question to Greg is
[q-vg2b69](../user-feedback/questions/q-vg2b69.md).

> 1. Before versus after: I think both are relevant. It depends on whether this is an old or a new
>    article, which is more relevant.
> 2. What to see first when Sources opens: Not sure. Make some proposals for us to discuss.
> 3. Trial it on real articles first: Yep, you can either use existing articles or pick some others
>    that are representative.
>
> — Greg, 2026-10-25

## What you have asked for, and what the trial says about each

Over 22 reports, 11 September to 23 October, the same five asks come back:

| You asked for | Your words | What the trial found |
|---|---|---|
| Who cited it, and did they agree | *"Has anyone cited this article either supporting or criticizing?"* (2026-10-01) | Cited by is a count and titles, nothing read. Search the literature found named disagreement on every article it ran on, but mostly through web searches, not the citation list: it read citers' abstracts on only two of the six. |
| Do its citations hold up | *"whether what it cited says what they think it says"* (2026-10-23) | Still barely served: no *Citation?* finding on any of the six. |
| Value beyond paraphrase | *"That's almost no value… better to say less"* (2026-10-03) | Every Search the literature finding is something the article does not say, with a quoted source. |
| Key themes and landmark papers | *"key nodes, i.e. the critical papers that really responded or moved things forward"* (2026-09-30) | For a classic, OpenAlex's citers filtered by its own keyword for the piece come close: for *The Extended Mind*, Sterelny, Rupert, Gallagher, Sutton. For a paper with a few hundred citers or fewer the filter does nothing or harm. |
| Fewer sub-modes, less confusion | *"I want to get to the point where there are fewer sources submodes"* (2026-10-23) | Reception found nothing on three of six and one page on each of the others. |

**In one line**: Search the literature found what a careful reader in each field would point to —
Adams & Aizawa against *The Extended Mind*, the batch-norm and Bayesian story after Dropout, the
AGENTS.md paper's own wording softening between arXiv versions, the 50 commentaries on Seth's *BBS*
paper behind his essay — for $0.26–0.48 (mean $0.33) and 37–59 seconds a run (thinner on the blog post, where it missed the one direct reply). The
lists around it mostly did not, and where they failed it was in matching the piece to its own
records (a paper held twice, a record with the wrong title, a translation of itself listed as "not
cited"), not in the model.

## Words used below

- **The dossier**: what *Search the literature* makes today (behind the experimental switch). A
  model plans about 16 web searches from the piece, they run, OpenAlex adds up to 40 papers that cite
  it with their abstracts, and one read of all of it writes up to 14 findings, each pinned to a
  passage with its sources quoted: *Challenged*, *Citation?*, *Since*, *Not cited?*, *Reception*,
  *Supported*. Plus an overview and five questions.
- **Old** and **new**: older than about two years is read for *what has happened since*, newer for
  *where it sits now*. The dossier decides this itself; before it has run, only the article's
  publication date can (and two of the six had none).
- **Topic-matched citers**: papers that cite this one and whose title or abstract contain
  OpenAlex's own top keyword for it (*dropout*, *extended mind*). No model, one extra OpenAlex
  request once the piece is identified, and nothing new sent: the keyword is OpenAlex's.
- **A session**: one agent working for an afternoon, two to four hours.

## Where each sub-mode goes (the same in all three)

| Today | Becomes |
|---|---|
| Bibliography | Stays a chip, unchanged. |
| Links | Stays a chip, unchanged. |
| Reception | Its search (pages about this piece by name) becomes one of the dossier's queries; the two real replies it found in the trial were that kind. Its stored rows show under *What was searched*. Old `?sources=reception` lands on the first chip. |
| Claims | The list and the reader's own paid checks move under the dossier, folded, as *Check a claim yourself*. Nothing a reader did is lost; old links open that fold. |
| Not cited | Its free list moves under the dossier, folded, still on its own press because it sends the article's opening ([privacy.md](../project/privacy.md#crossref-datacite-and-openalex-are-sent-a-doi)). The dossier's *Not cited?* findings are the judged version. |
| Investigate | The question box, *Your questions* and the suggested questions move to the dossier's foot. Arriving still reopens your last chat. |
| Visitors | Unchanged: they see Bibliography, Links, and any stored Reception or Claims rows; no dossier, no presses. |

**The fixes that need no decision**, whichever you pick: *Since* held in code to a source dated after
the piece, and a note trimmed when it names a paper it has no source for (the two failure shapes in
[261024b](../investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md)).
About one session.

## The three shapes

Every option below gets the same fields. The sketches use the trial's real *Extended Mind* data.

### A — The dossier is the page, and it runs on first open

```
 ┌ Where it sits │ Bibliography 17 │ Links 4 ┐
 │ A paper from 1998: what has been said since                  run 25 Oct · Search again
 │ The founding statement of the extended mind thesis, still argued over: critics say it
 │ slides from coupling to constitution; later work applies it to phones and AI tools.
 │
 │ Challenged (4)
 │  "this sort of coupled process counts equally well as a cognitive process"   ↳ jump
 │    Adams & Aizawa call this the coupling–constitution fallacy … Clark replied.
 │    Defending the Bounds of Cognition · Coupling, Constitution… (Clark)   [Ask in chat]
 │ Since (3) …  Citation? (0)  Not cited? (2) …  Reception (1) …  Supported (0)
 │
 │ ▸ What was searched (16)   ▸ Check a claim yourself   ▸ Close to it, not in its bibliography
 │ Ask your own question …
```

- **Before it has run**: on the first open of Sources for an article, it starts by itself, and the
  page says so while it works (about 45 s), with the Bibliography's most relied-on works.
- **After**: the dossier, groups ordered by age (old: *Challenged, Since, Citation?, Reception,
  Not cited?, Supported*; new: *Not cited?, Citation?, Supported, Challenged, Since, Reception*).
- **What leaves, and when**: the article to the model and the model's searches to Exa, both through
  OpenRouter, **on opening Sources** rather than on a press. That is a change to what the privacy
  page promises.
- **Cost**: $0.26–0.48 on every article whose Sources is opened, once.
- **Fails how**: the allowance is four runs an hour and twelve a day per reader, so the fifth article
  opened in an hour gets no dossier and a line saying why; a glance at the bibliography spends a run
  nobody asked for; and a verdict-shaped page arrives before the reader has formed a view.
- **Build**: about two sessions beyond the shared part, plus a separate budget for automatic runs so
  they do not use up the presses.

### B+ — Lists first until you ask; after that, the dossier first (recommended)

Before the first press:

```
 ┌ Where it sits │ Bibliography 17 │ Links 4 ┐
 │ A paper from 1998.
 │ After it — 556 papers cite it and mention "extended mind"          (old piece: this first)
 │   Minds: extended or scaffolded? · 2010 · cited 621
 │   Cognitive Systems and the Extended Mind · 2009 · 413
 │   The socially extended mind · 2013 · 378                          … 7 more  ▸ all 5,849
 │ Before it — the works it leans on most
 │   Epistemic actions in Tetris (Kirsh & Maglio 1994) · Putnam 1975 · Burge 1979 · Hutchins 1995
 │
 │ [ Search the literature · about 45 s ]  reads the web and these papers against the piece and
 │   puts what it finds beside the passages: who disagreed, what changed since, what it missed.
```

After it, and on every later open: the dossier as in A, with the two lists folded beneath it.

- **Before it has run**: two short lists, no model. *After it* is the topic-matched citers when the
  piece has more than about a thousand citers, otherwise simply its citers, most cited first (for a
  few hundred or fewer the filter loses the best ones: the trial's *Consciousness in AI*). *Before
  it* is the Bibliography's most relied-on works, made on import already. Which list comes first
  is decided by the publication year when the article has one; with none, the two are shown side
  by side, equally long.
- **After**: the dossier first, ordered by age as in A.
- **What leaves, and when**: on open, only what Cited by sends today (the DOI or title, to
  OpenAlex), plus one OpenAlex request using its own keyword. The dossier still sends only on its
  press, as the privacy page says now.
- **Cost**: nothing on open but one OpenAlex request from a free allowance shared with Cited by and
  Not cited. $0.26–0.48 when pressed.
- **Fails how**: a reader who never presses never sees a *Challenged*. A piece OpenAlex cannot find
  (a pasted essay, a blog post: Seth and Scott Alexander in the trial) gets only *Before it*, or,
  with no bibliography either, only the button.
- **Why I recommend it**: it gives something real on open without spending or sending anything new;
  the reader does the first reading, which is the vision's "augment, not replace"; the money moves
  only on a press, as everywhere else in Sources; and once you have asked for the dossier, it is
  what you see, which is where the trial says the value is.
- **Build**: about three sessions beyond the shared part: the citer question and its caching, the
  page and its ordering, the folding and old addresses.

### C — Before | After, two lists with judgments on them

```
 ┌ After │ Before │ Links ┐                         (old piece: After first; new: Before first)
 │ After — what was said about it
 │   ✗ disputes   Minds: extended or scaffolded? · Sterelny 2010   "scaffolded, not extended…"
 │   ✓ builds on  Supersizing the Mind · Clark 2008
 │   ~ mentions   The Self-Evidencing Brain · Hohwy 2014            (marks illustrative)
 │ Before — what it cites                (Bibliography, with Citation? and Not cited? marks)
 │   Kirsh & Maglio 1994   ⚠ later work: complementary actions fall with expertise
```

- **Before it has run**: the same two free lists as B+, as two chips.
- **After**: each citer row gets a mark (disputes, builds on, mentions), and each Bibliography row
  the dossier's *Citation?* or *Not cited?* note.
- **What leaves, and when**: as B+.
- **Cost**: as B+ on open. On a press, the dossier **plus** a second model pass to mark each citer,
  perhaps $0.05–0.15 more.
- **Fails how**: it is organised by paper, not by passage, so a finding is no longer beside the
  sentence it is about. Many of the best findings are not a citer at all (Adams & Aizawa came from a
  web search) and would have no row. And a citer's abstract rarely says what it thinks of the
  piece, so most marks would be *mentions*.
- **Build**: about a week: two new list views, and a classification the dossier does not make
  today.

## Reading the citers, for or against

The most-asked of the five, so answered on its own: **inside the dossier, not as a list of its
own.** Today the dossier reads the 40 most-cited citers' abstracts, which for a classic are papers
that cite it in passing (Dropout's are DenseNet and BatchNorm). For a piece with thousands of
citers it should read the topic-matched ones; for anything smaller, all of them up to 40, as now.
A per-citer for/against mark (C) would pay a second pass for little, because abstracts rarely say.
Honestly measured: on the two articles where the read did see citers' abstracts (36 for Dropout,
30 for *Consciousness in AI*), no finding cited one, so whether the *right* citers pay for their
tokens is untested; it is the first thing to measure once built.
What would really answer it is the citing sentence itself. Semantic Scholar holds those, but Greg
decided on 2026-10-25 not to use it, because its licence is non-commercial (q-x9srvv,
[bibliography.md](../project/bibliography.md)), so for now no source we use supplies them.

## The second question: two identity rules

Both make the lists more right, and both loosen or change a rule somebody chose on purpose, so they
are yours:

1. **One paper held twice by OpenAlex.** *The Extended Mind* is two records (5,514 and 673 citers),
   and today Cited by refuses to choose and shows nothing: *"the most cited is not evidence"*. The
   change: two records with the same whole title, at least two of the same authors and the same
   year are one work; their citers are taken together and counted once. About half a session.
2. **The piece itself in Not cited.** A translation (*La mente extendida*), a reprint, or the
   anthology that reprints it is listed as a paper "not cited". Four of the 19 rows for *The
   Extended Mind*. Either hide a row that shares the piece's authors and is a version of its title,
   or keep it but group it under a line *Other editions of this piece*. Grouping keeps a useful
   edition findable; hiding is tidier. About half a session.

## What I passed over

- **Keep six chips and put the dossier's result at the top of Reception** (the smallest change).
  It leaves every confusion you named, and Reception is the sub-mode that found least.
- **Run the dossier on import.** Most imports never open Sources, and every one would pay.
- **Haiku for the read**, an eighth of the price: it lost quotes and misdated in 261024b. The
  queued comparison (`qi-9bc5xnwn`) decides that, not this.
- **Let a model choose the citer filter's words.** It would be a model-written query sent
  automatically, needing the same address-stripping defence as the dossier's (S3 in 261024o), for
  little over OpenAlex's own keyword.
