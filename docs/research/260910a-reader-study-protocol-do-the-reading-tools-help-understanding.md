# Reader study protocol: do the reading tools help understanding?

Status as of 2026-09-10: **protocol written and reviewed, not run** — no reader has been contacted,
recruited or tested. Evidence: this file is the whole of the work; nothing in `src/` changed for it,
and nothing below needs anything built. The GPT Sol review is
[260910a-…-review-sol.md](260910a-reader-study-protocol-do-the-reading-tools-help-understanding-review-sol.md);
what it changed is listed at the end.

This is the study that answers [open question Q6](../project/open-questions.md#q6), *how do we know
it's working?* It is cluster P of
[260908f-prioritised-spideryarn-codebase-improvements.md](../plans/260908f-prioritised-spideryarn-codebase-improvements.md#p-test-the-products-purpose-before-adding-more-modes),
and it is meant to run before the next batch of new product work (glossary streaming, figures,
keyboard access to terms), so that what readers actually trip over can outrank what we guess they
will.

It is written **for Greg, who runs it**. Recruiting, consent and every conversation with a reader are
his; an agent prepares, and never contacts anybody.

## What it is testing

The claim under test is the one in [vision.md](../project/vision.md):

> it augments human cognition, but it doesn't replace it … help the user get what they need from it,
> help them read efficiently, but deeply, help them internalize and interrogate.
>
> — Greg, 2026-08-24

and the tiebreak that makes it measurable, from
[Greg's notes](260902k-greg-notes-the-edge-between-ease-and-difficulty.md):

> what will help the human to best form their own rich updated internal representations?

So the outcome is **what the reader comes away holding**: can they reconstruct the argument, tie a
claim to its evidence, use a term in the author's sense, and say where the argument is weak? The
failure we are most looking for is the one vision.md names: *"a fluent impression of the piece and
none of its texture"* — a reader who feels they understood and cannot show it.

**Not measured, deliberately:** time in the app, clicks, articles finished, or anything a dashboard
could count ([vision.md § Anti-goals](../project/vision.md#anti-goals)). No telemetry is added, no
code changes, nothing is scored by a model, and no answer or grade is stored in the product.

## What it can and cannot tell you

**Four readers is a formative study, with no pass/fail verdict on the product.** It will find where
the tools get in the way, and it can show a signal — or a harm — worth taking seriously. It
**cannot** establish that Spideryarn improves understanding; nothing with four people can, and the
write-up must not say it did. First use of an unfamiliar interface also costs something a practised
reader would not pay, so "inconclusive" does not mean the tools do not work. A clear *harm* is the
more trustworthy result, because novelty explains away a missing benefit more easily than an actively
misleading one.

## The design in one paragraph

Each reader reads **two comparable articles**, **one in Spideryarn and one as ordinary prose**, for
**15 minutes each** (piloted first). After each, with the article closed, they say how well they think
they understood it and write the argument down from memory; then, with the article open again in the
same condition, they answer three short questions. Which article gets Spideryarn, and which comes
first, is **rotated across the four readers**. Everyone practises the whole sequence on a third,
short article first, so the second article is not the first time they learn what is asked. Greg
watches the Spideryarn reading and codes where generated text led back to the prose and where the
tool got in the way. The written answers are scored afterwards, **against marking sheets Greg wrote
before looking at anything Spideryarn generates for either article**, without knowing which condition
each answer came from.

## Conditions

- **Spideryarn** — the article in the live product, signed in to a **study account Greg owns**, with
  the experimental switch **off**, so the reader sees what an ordinary reader sees. Free use: they
  may open any mode or none. Nobody is told to use a particular tool, because whether they reach for
  one is part of what we are watching.
- **Ordinary prose** — the original page in the browser's reader view (Safari or Firefox), on the
  same screen. Not a print-out, so the device is the same; not Spideryarn with its modes hidden,
  because the comparison that matters is with how the reader would otherwise read it.

**The unit is a whole article, not an extracted passage**, because the tools work on the whole
article's structure — the hierarchy, the glossary, the summaries are all of the piece — and a passage
would have to be uploaded as a file and would test a smaller product. If the pilot shows 15 minutes
cannot do a whole article justice, change the time before changing the unit.

## Rotation across readers

A and B are the two study articles; P is the short practice article.

| Reader | First | Second |
|---|---|---|
| R1 | A in Spideryarn | B as prose |
| R2 | B in Spideryarn | A as prose |
| R3 | A as prose | B in Spideryarn |
| R4 | B as prose | A in Spideryarn |

This balances article and order **across the four readers, not within any one of them**: one
reader's Spideryarn article is a different article from their prose one, so a single reader's
difference says as much about the articles as about the tool. That is why the result below is read
from the article-by-article contrasts, not reader by reader. A second round, if the first is useful,
uses the same four rows again.

## Readers

- **Four**, then decide whether a second four is worth it.
- People who read long, argued non-fiction for work or study — the general deep reader
  [positioning.md](../project/positioning.md) speaks to first.
- Have not used Spideryarn beyond a glance, do not work on it, and are not experts in either study
  article's field.
- Adults (18+).
- Ideally not Greg's closest friends: people who like him will be kind about the tool. The script
  below limits what he can signal, and the scored measures are answers, not opinions.

## Articles

Two study articles (A and B) and a short practice article (P). The study pair should be:

- **Argued**, with explicit claims and specific evidence for them.
- **Comparable**: same genre, similar length and difficulty — ideally two pieces by the same author
  or publication on different topics.
- **About 3,000–4,000 words**, a guess to be tested by the pilot: long enough that 15 minutes is not
  quite enough to read every line closely, so deciding where to spend effort matters
  ([vision.md § Principles](../project/vision.md#principles), *effort in the right places*), but
  not so long that every reconstruction is poor.
- Using **a few terms in a non-obvious sense**, so the glossary has work to do; one relevant figure is
  a bonus, since poor figures are one of the obstacles we are looking for.
- **Unlikely to have been read** by the readers, and outside their fields.
- Publicly readable. Keep the study articles **private in the study account** — sharing one would list
  it on the [public shelf](../project/public-shelf.md).

## The marking sheet, written first

For each study article, **before opening any Spideryarn mode on it**, Greg writes:

1. **Ten reconstruction units** — the same number for both articles: the main claim; the supporting
   claims; the key evidence, as units of its own rather than folded into a claim; any limitation the
   author concedes. For every unit, an example answer that would score **0, 1 and 2**, and the
   acceptable paraphrases.
2. **One claim** for the find-the-evidence question, and **the evidence the author gives for it**, with
   0/1/2 examples.
3. **One term** used in a non-obvious sense, and **what the author means by it**, with 0/1/2
   examples.
4. **Two or three real weak points** — places the argument is thin, or an objection it does not meet.

Written first, and by a person, for one reason: a sheet drafted by a model, or after reading
Spideryarn's summaries, would share their wording, and a reader who echoed Spideryarn's summary voice
would score well for it. The point is to score against the **article**, as a careful human reader of
it understood it.

## What is measured, and how

| # | Measure | When | Scored as |
|---|---|---|---|
| 1 | **Confidence** — "How well could you explain this article's argument to a colleague?" | straight after reading, article closed | 1–5; set against 2, not scored alone |
| 2 | **Reconstruction** — write down the argument, from memory | article closed, 5 min | each of the ten units 0 / 1 / 2 against the sheet's examples, out of 20; plus **distortions** — things attributed to the author that the article does not say or contradicts — each marked *minor* or *material*; and the answer's length in words, so a distortion count can be read against it |
| 3 | **Claim and evidence** — "The author claims [C]. Where, and what evidence do they give for it?" | article open again, same condition | 0 / 1 / 2 |
| 4 | **Term** — "What does the author mean by [term] — in their sense, not the dictionary's?" | same | 0 / 1 / 2 |
| 5 | **Weak point** — "Where is the argument weakest, or what objection does it not answer? Why?" | same | 0 generic (could be said of any article) / 1 specific to this piece / 2 specific and tied to a passage |
| 6 | **Door or wall** | Spideryarn reading only | coded episodes, below |
| 7 | **Interruptions** | Spideryarn reading only | each place the tool got in the way: not knowing which mode to open, a term with no or a wrong glossary entry, a figure too poor to read, a wait, an error, getting lost |
| 8 | **Delayed recall** (optional) | by email, 3–7 days later | below |
| 9 | **Debrief** | end of session | not scored |

**Two tags on each reconstruction, descriptive rather than scored.** *Whose voice*: the author's own
terms and evidence, or the flattening "the author argues that…" voice
[vision.md § Principles](../project/vision.md#principles) warns against. *The author's words*: does it
contain at least one phrase or formulation specific to the article — Q6 asks *do they quote the
piece?* For both, check afterwards whether a phrase came from the article or from Spideryarn's
generated text, which stays visible in the study account until it is deleted.

**The reconstruction comes before the open-book questions** on purpose: answering them with the
article open would put it back in front of the reader just before they are asked to recall it.

**Door or wall, coded from what can be seen.** An *episode* begins when the reader explicitly opens,
selects or points at a generated item — a summary, a gist in a coarser column, a glossary entry, an
idea. It is a **door** if, before opening another generated item, they go to or inspect the prose it
comes from; a **wall** if they leave it and carry on without going to the source. Anything Greg cannot
tell from the screen is **uncodable** — never guess from where their eyes seemed to be. Report doors,
walls and uncodable per reader; never pool episodes across readers, so one busy reader cannot decide
it.

**Delayed recall.** One question per article — what did it argue, and what was its strongest evidence?
— scored like 2. Analyse it only for readers who answer about both articles, give the count ("3 of
4 replied"), keep it separate from the main result, and describe it honestly: retention after the
whole study procedure, questions included, not after reading alone.

**Scoring.** Every written answer is labelled with a random code, not a name or a condition, and typed
up so handwriting does not give the condition away. After the last session, score them all in shuffled
order. Then, **at least a week later, score them all again without looking at the first scores** — or
better, give a second person the marking sheets and the coded answers and nothing else. Record where
the two scorings disagree and settle it **before** un-blinding. If the two scorings differ by as much
as the difference between conditions, do not read anything into that difference.

## How the result is read

Decided **now**, before any data, so the answer cannot be shaped to fit the results. This is not a
pass/fail test; it says what to call what comes back.

**Report everything.** Every reader's scores in both conditions, and all four article-by-condition
cells, with each cell's two readers.

**The contrast.** Reconstruction as a percentage of the 20 points. For article A, the mean of its two
Spideryarn readers minus the mean of its two prose readers; the same for B; and the average of those
two. The rotation balances article and order in these averages. It does not remove differences
between readers, carry-over from the first article to the second, or scoring error, and each cell is
two people. **First-article results are also reported on their own**, as the only ones no earlier
study questions touched, with the same caveat twice over.

**A signal worth testing with more readers** — all of:

- the averaged reconstruction contrast is **at least 10 percentage points** (two points out of 20) in
  Spideryarn's favour;
- neither article shows a comparably large contrast the other way;
- claim-and-evidence, term and weak-point show no consistent drop in the Spideryarn condition;
- material distortions are no more common in the Spideryarn condition;
- among readers with at least two codable episodes, doors outnumber walls for most of them.

Ten points is a judgement about what would matter to a reader, not a statistical threshold.

**Possible harm, to investigate now** — any one of these, **even in a single reader**:

- a material falsehood in their answers that can be traced to Spideryarn's generated text;
- a reader kept from reaching the source prose a question was about — by the tool, not by choice.

And worth recording as a pattern if two or more readers show it: higher confidence but an equal or
lower reconstruction in the Spideryarn condition — the fluent impression, measured.

**Everything else is inconclusive.** Say so; do not give the product a verdict either way. The study's
value is then its obstacle list.

**The obstacle list is produced whatever the result.** Every interruption from measure 7 and the
debrief, with how many of the four readers hit it. An obstacle two or more readers hit is
**recurring**, and recurring obstacles go **above speculative feature work** in the product plan — the
plan's own rule for this cluster.

## Session plan — about 90 minutes

| Min | What |
|---|---|
| 0–5 | Welcome, the opening script, the consent form signed |
| 5–12 | Spideryarn tour on the practice article P — the same tour for everyone |
| 12–20 | **Practice round on P**: close it, say its argument in two or three sentences, reopen it, answer one claim-and-evidence and one term question. Then: *"The two study articles use the same kinds of questions, about different things."* |
| 20–35 | First article, 15 minutes, in its condition. Greg observes; no talking aloud |
| 35–41 | Article closed: confidence, reconstruction (5 min) |
| 41–48 | Article open again, same condition: claim and evidence, term, weak point |
| 48–51 | Break |
| 51–79 | Second article: the same three steps |
| 79–90 | Debrief |

**No thinking aloud while reading**: it slows reading, and would slow the two conditions by different
amounts. In the debrief, Greg takes the reader back to two or three moments from his notes —
*"here you opened the glossary; what were you looking for, and did you find it?"* — and asks, last,
*"What result did you think I was hoping for?"*, recorded as context, not a score.

**During the timed parts Greg answers only procedural questions**, with fixed phrases — *"Whatever
you'd normally do"*, *"There's no right way"*, *"About five minutes left"*. He does not explain a
mode, suggest a route, reassure a reader who is struggling, or react to an answer. Every time he does
intervene, it goes on the observation sheet.

Answers are written on paper, or in a plain document outside Spideryarn — **never** in Spideryarn's
comments or chat, which would store them in the product.

### The tour — the same seven minutes for everyone

On P, Greg shows, without recommending any of them over reading:

- the columns — scan the shape of the piece at the left, read the real prose at the right, and move
  between them;
- the spine, for where you are;
- the underlined terms and the glossary;
- summaries, ideas and quotes, in the band beside the prose;
- selecting a passage to ask about it.

Then: *"Use any of these, or none. Reading the article itself is always fine."* The same words each
time — write them on a card.

## What the reader is told

Read out, or close to it, at the start:

> Thanks for doing this. I'm testing a reading tool I'm building, called Spideryarn — I'm testing the
> tool, not you. There are no right answers, and honest criticism is the most useful thing you can
> give me; if something is annoying or confusing, that is exactly what I need to hear.
>
> You'll read two articles, about 15 minutes each — one in Spideryarn, one as an ordinary web page.
> Read each as if you'd need to explain its argument to a colleague tomorrow, and say whether you're
> convinced by it. You don't have to finish; read the way you'd normally read something you needed to
> understand. Afterwards I'll ask you a few questions, some from memory — we'll do a practice round
> first so you know what they're like.
>
> I'll be taking notes while you read, but I won't interrupt or help — that's so I don't steer you,
> not because I'm being unfriendly. You can stop at any point.

Do not say that we hope Spideryarn helps, which invites the reader to make it look as if it did.

## Consent form

To print, or send beforehand. **Before recruiting, fill in the three bracketed gaps** — they are
decisions, and the form is not honest until they are made. If any reader is recruited through a
university or through Greg's employer, check whether that body's own research-ethics or staff rules
apply; this form does not replace them.

> **Taking part in a reading study — Spideryarn**
>
> **What this is.** I'm building a reading tool called Spideryarn and want to find out whether it
> helps people understand what they read, and where it gets in the way. You'll read two articles,
> about 15 minutes each — one using Spideryarn, one as an ordinary web page — and answer some
> questions about them, some from memory, then talk with me about how it went. It takes about 90
> minutes. It is a test of the tool, not of you.
>
> **Who is responsible.** Greg Detre, a sole trader in the UK, is responsible for your data.
> Contact: hello@spideryarn.com. I use it for this study because you have agreed to it, below.
>
> **It is up to you.** You can stop the session at any point without giving a reason.
>
> **What I record.** Notes of what you do on screen and what you say, and your written answers,
> labelled with a code rather than your name. If you agree below, a recording of the screen and your
> voice (no camera), and one follow-up email.
>
> **Deleting it.** Until [DELETION DATE] you can ask me to delete everything from your session — the
> notes, your answers, any recording, the follow-up email, and the key linking your code to your name.
> On that date I delete all of those myself, and keep only results that can no longer be linked to
> you. Once they have been combined into the summary, I cannot pick your part out of it.
>
> **What you type into Spideryarn.** You'll use a study account that belongs to me, not one of your
> own. A comment you save is stored in Spideryarn. What you type is sent to the AI services
> Spideryarn uses only when you ask the AI something, or talk to it. When the study ends I
> permanently delete the study articles and everything you did on them. The imported article file
> and records that contain none of what you wrote may remain, as described at spideryarn.com/privacy,
> and deletion cannot recall a copy already held by a service provider. Please don't type anything
> personal.
>
> **Who sees it.** I see your notes, answers and any recording. Spideryarn's service providers,
> listed at spideryarn.com/privacy, handle anything typed into Spideryarn. [THE EMAIL, VIDEO-CALL AND
> RECORDING SERVICES USED, IF ANY.]
>
> **What gets published.** A summary of what I learned, and, if you agree below, short quotes of
> things you said, may be written into Spideryarn's project notes, **which are in a public code
> repository** that anyone can read. I will leave out names and identifying details — but in a study
> this small I can't promise that someone who already knows you took part couldn't guess.
>
> **Your rights.** You can ask to see, correct or delete what I hold about you, or withdraw your
> consent, by writing to hello@spideryarn.com. If you're unhappy with how I've handled it, you can
> complain to the Information Commissioner's Office (ico.org.uk).
>
> ☐ I've read this and agree to take part.
> ☐ *(optional)* You may record my screen and voice.
> ☐ *(optional)* You may email me once, 3–7 days later, with two short questions (about 5 minutes).
> ☐ *(optional)* You may quote things I said, anonymously.
>
> Name ______________________  Date ____________  Signature ______________________
>
> [THANK-YOU, IF ANY.]

## Recruiting message

For Greg to send, edited to his own voice:

> I'm building a tool to help people read long articles more deeply, and I'd like to watch a few
> people use it to find out where it helps and where it gets in the way. It's about 90 minutes: you'd
> read two articles, one with the tool and one without, and answer some questions. It's a test of
> the tool, not of you, and honest criticism is exactly what I'm after. [In person at … / over Zoom.]
> [Thank-you, if any.] Would you be up for it? Happy to send the details first.

## What Greg does, step by step

**Once, before the first session**

- [ ] Decide the questions in *Choices for Greg* below, and fill in the consent form's three gaps.
- [ ] Choose articles A, B and P against the criteria above (an agent can shortlist candidates on
  request; the choice is yours).
- [ ] **Write the marking sheets for A and B before opening any Spideryarn mode on them.**
- [ ] **Pilot** A and B as ordinary prose, with one person who will not be in the study, under the
  15-minute limit. Keep them if 15 minutes allows real engagement with most of the argument without
  making a close read of every line routine; otherwise change the time, or the articles.
- [ ] Make the study account with an email address you own; leave the experimental switch off. A new
  account's free allowance is exactly three articles ([billing.md](../project/billing.md)), which is A,
  B and P.
- [ ] Ingest A, B and P. Keep them private.
- [ ] **Open every default mode once on A, B and P**, so the glossary, summaries, ideas and quotes
  exist before anyone reads and every reader sees the same generated text; check each renders, and
  note anything broken — that is a finding before any reader arrives. A real first reader waits for
  that generation; see the wait for yourself on any fresh article, not in a session.
- [ ] For each of A, B and P, write down the canonical starting state: the URL, the mode, the top of
  the article.
- [ ] Print: consent forms, the opening script, the tour card, the practice and study question sheets
  (with [C] and [term] filled in), one observation sheet per reader, and a list of random codes.
- [ ] Recruit four readers and give each a row of the rotation table.

**Each session**

- [ ] **Reset the study account**: delete every comment, note, highlight, chat and saved search any
  earlier reader left on A, B and P; open a fresh private browser window, signed in to the study
  account, so no cached state carries over; load each article at its canonical starting state; and
  look, to confirm no earlier reader's trace is visible. If something cannot be cleared, use a second,
  identically set-up study account for that reader — its generated text will differ from the first
  account's, so note which readers used which.
- [ ] Remotely: Zoom with remote control of your browser, so the reader never signs in themselves.
- [ ] Run the session plan. Keep the observation sheet during the Spideryarn reading — time, the
  generated item, door / wall / uncodable, any interruption, any intervention of yours, anything said.
- [ ] Label every answer with its random code; keep the key (code → reader, article, condition) on a
  separate sheet.
- [ ] If they agreed, send the delayed-recall email 3–7 days later.

**After the last session**

- [ ] Score as *Scoring* says — twice, a week apart, or with a second scorer — then un-blind.
- [ ] Read the result exactly as *How the result is read* says, and compile the obstacle list with
  counts.
- [ ] Delete the study articles, as the consent form promises: *Delete this article* on each
  article's metadata page —
  [privacy.md § Deleting an article, for good](../project/privacy.md#deleting-an-article-for-good)
  is what that removes and what survives.
- [ ] Write the result — anonymised, no raw answers — into the doc that owns Q6, delete Q6 from
  [open-questions.md](../project/open-questions.md), and hand the obstacle list to whoever is ordering
  product work. An agent can do the write-up from your summary.
- [ ] On the consent form's deletion date, delete the notes, answers, recordings, emails and the key.

## Where the data lives

Paper, or files on Greg's own machine — **not** this repository, not Spideryarn's database, not a
shared drive. The only things that reach the repository are the anonymised summary and the obstacle
list. The only participant traces in the product are whatever they did in the study account, removed
as the consent form says.

## Designs passed over

**The simpler one: interviews only.** Show a few people Spideryarn and ask whether it helped. Half the
effort, and good at finding friction. Passed over because the failure this study most needs to catch
— a reader who *feels* they understood — is exactly the one self-report cannot see: a fluent summary
makes a reader more confident, not less. The confidence rating is kept so it can be set against what
they can reconstruct.

**Simpler still: one article, Spideryarn only.** Keeps the observation and drops the prose reading,
saving about 30 minutes a session. It finds obstacles just as well, but with no comparison it cannot
say anything about whether the tools help, which is the question Q6 asks. **It is the fallback if a
reader can only give 45–60 minutes** — run it, keep the obstacles, and leave that reader out of the
contrasts.

**Larger designs**, passed over for now: a third condition with an AI summary before reading (the
thing vision.md defines Spideryarn against — a later round, since three conditions over four readers
leaves no cell covered twice); twenty or more readers with statistics (right for a claim, more than a
first look needs); and in-product logging of modes opened, which the plan rules out and which would
say what readers clicked rather than what they understood.

## Choices for Greg

Each has a default, so none blocks the preparation.

1. **In person or remote?** Default: in person, on your laptop — observing is much easier, and nobody
   else's browser touches the study account.
2. **Screen recording?** Default: offered as optional. It makes the debrief replays and the door/wall
   coding easier to check, and is one more thing to store and delete.
3. **A thank-you?** Default: none promised; add a line if you give one.
4. **The delayed recall?** Default: offer it. It is the only measure of *internalise* rather than
   understand-in-the-moment, and it costs the reader five minutes.
5. **Who scores?** Default: you, twice, a week apart. A second scorer is better, and costs someone an
   afternoon.
6. **Your name on the form?** The public privacy page deliberately does not name you
   ([privacy.md § The four decisions Greg made](../project/privacy.md#the-four-decisions-greg-made)).
   A consent form is different: it is handed over by you, and a form that does not say who is
   responsible for the data is not informed consent. Default: named, as drafted.

## What the review changed

GPT Sol reviewed the first draft on 2026-09-10 (exit 0, answer file present, model `gpt-5.6-sol`):
two P0, six P1, three P2. All eleven were checked against the docs and taken, two with adjustments:

- **P0 — the decision rule.** The draft's "10 points in 3 of 4 readers" compared each reader's two
  *different* articles, so it threw away what the rotation buys. Replaced with article-by-article
  contrasts, a harm rule that fires on one reader, and no pass/fail verdict.
- **P0 — the consent form** contradicted itself on deletion (until write-up, versus six months),
  over-promised that everything attached to an article goes (the imported file survives —
  [privacy.md](../project/privacy.md#deleting-an-article-for-good)), said every comment is sent to an
  AI (only when the reader asks it), promised anonymity it cannot guarantee in a study of four, and
  left out who is responsible, the basis, the reader's rights and the ICO. All fixed; the gaps that
  are Greg's decisions are bracketed.
- **P1**: ten units per article with 0/1/2 examples, and a second scoring before un-blinding; a
  practice round on P so the second article is not where readers learn the questions, and
  first-article results reported alone; a pilot of the length and time; door/wall coded as observable
  episodes, per reader; a full reset of the study account between readers (adjusted: a fresh private
  window, and a second account as the fallback, rather than one account per reader from the start);
  fixed phrases for Greg during timed parts.
- **P2**: delayed recall analysed separately; the quote measure folded into a tag on the
  reconstruction; the larger passed-over designs cut to one paragraph. (Adjusted: the free-allowance
  line stays, moved into the checklist, because it is exactly what Greg would otherwise hit.)

---

Up: [research.md](../project/research.md)
