# Spideryarn Reading — a statement of intent, for whoever writes the website

**What this is.** One long, honest account of what Spideryarn Reading is for, who it is for, what it
refuses to be, and how it should sound — written for a marketer, copywriter or product manager who
has never seen the code. It was synthesised on 2026-09-02 from everything Greg wrote or said about
the product across two codebases: the original 2025 app (`/Users/greg/dev/spideryarn/reading`, May–
July 2025) and this rebuild (August 2026 onwards). Where Greg said it himself, he is quoted verbatim
and dated; the rest is synthesis and is marked as such.

**What this is not.** Not copy. Not a site map. Not decided — the final section lists the questions
only Greg can answer, and the answers will be folded into [vision.md](../project/vision.md).

**Where the raw material came from.** Five subagent trawls over the old repo's marketing folder,
reference docs, planning docs, captured conversations and shipped UI, plus this repo's `docs/project/`
and `docs/research/`. The single most valuable old-repo sources: `docs/reference/VISION_PRODUCT_STRATEGY.md`
(Greg's own, marked "please don't edit"), `docs/marketing/250714a_conversation_product_marketing_strategy_development.md`
(Greg thinking aloud with a marketing-persona AI), `docs/marketing/MARKETING_BRAND_MESSAGING_GUIDELINES.md`,
`docs/marketing/TAGLINES.md` — all four copied verbatim, with a guess at who wrote each, into
[260902k-old-version-materials/](260902k-old-version-materials/README.md), since the old repo
exists only on Greg's Mac. In this repo: [vision.md](../project/vision.md),
[granularity-zoom.md](../project/granularity-zoom.md), [open-questions.md](../project/open-questions.md),
[original-version/overview.md](../project/original-version/overview.md), the current
[`LandingPage.tsx`](../../src/web/LandingPage.tsx), and the
[peer-review research](260831e-helping-peer-reviewers/README.md).

---

## 1. In one paragraph

Spideryarn Reading is a web app for reading one hard piece of non-fiction — an essay, a paper, a
long article, a PDF — with an AI beside you that helps you get more out of it rather than doing the
reading for you. You paste a URL or drop in a PDF; it comes back as the article with a set of tools
built around it: the whole thing at every level of detail at once, its structure as a map, its
terms explained in the author's own sense, its claims and ideas pulled out, search by meaning,
questions answered in place with every answer tied to the passage it came from, and at the end a
way to find out what you actually retained. The author's words are always on the screen and always
one press away from anything the model says. The product exists because every other AI reading tool
compresses, and compression is the wrong move for anyone who needs to *understand*.

## 2. The founding conviction, in Greg's words

There are two eras of this product and one idea. The idea has been stated three times, each time
more sharply.

**2025, the original app.** From the vision doc Greg kept for himself:

> The AI should do absolutely everything possible to empower and augment the human, enabling better
> understanding and potentially faster/more efficient processing. **However, the AI must never
> replace human judgment or critical thinking.**
>
> **Key principle**: Think of having "a bunch of smart postdocs who you could give any instructions
> to" — what would you ask them to do to enable you to be the most effective version of yourself
> when reading?
>
> A really big risk is that the AI does too much and the human gets lazy or atrophies by not doing
> the work and doesn't internalise things as well. We're trying to figure out how to avoid that
> failure mode.
>
> — Greg, `VISION_PRODUCT_STRATEGY.md`, mid-2025

**July 2025, thinking aloud about marketing.** On why "give me the gist" is the temptation to
resist:

> I think a lot of the stuff around just helping me get the gist is tempting but I think that value
> of Spideryarn's got to be about depth and internalisation and digestion rather than simply "give me
> a neat summary". So I think it's got to be about helping the person to navigate around the paper
> and get what they need.
>
> — Greg, 2025-07-14

And on what the tool does that a chat window does not:

> The idea is that we're highlighting, providing structure, explaining, and keeping you grounded in
> the actual paper itself rather than in the conversation. Hopefully, that'll lead to slightly better
> retention and better familiarity with those papers themselves and the actual concrete details and
> content of it.
>
> — Greg, 2025-07-14

**August 2026, the rebuild's brief.** The sentence everything in this repo is downstream of:

> I'm interested in trying a new way of reading that's AI assisted, but still — well, **it augments
> human cognition, but it doesn't replace it.** So the idea would be that instead of trying to make
> things too easy, trying to replace the words with quick and easy summaries so much, but rather we
> **help the user get what they need from it, help them read efficiently, but deeply, help them
> internalize and interrogate.**
>
> — Greg, 2026-08-24

The tiebreak the team uses for every close design call, and which a copywriter can use for every
close copy call, in the form Greg corrected it to on 2026-09-03: *which option will best help the
reader form their own rich, updated internal representation — digest, understand, learn, notice,
integrate, critique?* (Not, as an earlier draft had it, "which leaves more of the thinking with the
reader": the point is what the reader comes away holding, not how much work is left to them.)

The old app's architecture conversations coined the shortest version of the whole thing, and it is
still the best two-word category description we have: **"You're not building an editor, you're
building an augmented reader"** (2025-06-22). **Not Greg's words, or not provably so:** the line
sits inside an AI-written "Key Insights" summary of a captured conversation, unattributed, so it
is a category to consider rather than a quote to put on the website — see
[the old-version materials](260902k-old-version-materials/shipped-copy-and-product-framing.md).

## 3. The problem

Two problems, one on each side.

**Reading hard things is expensive, and most of the expense is misplaced.** The old vision doc's
mission list is the best inventory of what a serious reader actually wants from a difficult text,
and none of it is "finish faster":

> Get the gist or extract quotes and relevant information faster · See structure and take different
> trajectories through documents · Clear up confusions and make sense of complex parts · Get up to
> speed on terminology or requisite background · Understand core ideas more deeply · Compare with
> existing knowledge or other sources · Evaluate what's trustworthy and see potential flaws · Chat
> with an AI interlocutor and think things through · Generate, evaluate, and manage new/varied/complex
> ideas.
>
> — Greg, `VISION_PRODUCT_STRATEGY.md`

The principle that follows is in [vision.md](../project/vision.md): *"We are not trying to minimise
reading time. We're trying to minimise time spent on the parts the reader didn't need, so there's
more left for the parts they did."*

**AI reading tools make it worse, fluently.** The current landing page states this well enough to
quote as-is:

> Every AI reading tool makes the same move: compress. Paste an article, get bullets, done. Great for
> triage. Corrosive for understanding. You come away with a fluent impression and none of the texture.
> No argument you could reconstruct. No sentence you could quote. No sense of where the author was
> strong and where they were hand-waving. The summary didn't support the reading — it replaced it.

This is not just a stance; there is evidence for it, gathered in
[prior-art-and-cognitive-offloading.md § 5](260831e-helping-peer-reviewers/prior-art-and-cognitive-offloading.md#summaries-specifically-the-closest-analog-to-the-reviewer-reads-an-ai-gist-instead-of-the-section)
and worth a marketer's attention because it is the kind of claim a sceptical academic audience will
respect:

- A Microsoft Research and CMU survey of 319 knowledge workers (CHI 2025): higher trust in the AI
  correlated with *less* critical thinking; most respondents reported much less effort on
  comprehension, analysis and synthesis; and outputs across users became more alike.
- Skilled readers did *worse* after an AI summary than after the original, because the simplified
  text strips the cues skilled readers use. Summaries hurt the best readers most.
- The counter-finding that is Spideryarn's whole design in one sentence: **full text first, with a
  summary as an entry point rather than a replacement, largely eliminates the deficit.** The harm is
  in the summary being a *terminus*. Spideryarn's summaries are doors.

## 4. What it does instead — the five verbs, and the features under each

Greg's brief gives the product its verbs (2026-08-24): *"you could sort of scan through things
quickly if you just want to kind of get a vague sense of the landscape … or you could burrow
deeply."* [vision.md](../project/vision.md) turns that into five: **scan, descend, stay oriented,
interrogate, internalise.** Every feature that has been built sits under one of them. The list below
is the feature set as of 2026-09-02, each with its reader-facing purpose; the docs under
[reading-view-overview.md](../project/reading-view-overview.md) have the detail.

**Scan and descend — the flagship.** *Granularity zoom.* Greg's original spec (2026-08-24):

> imagine a book: you could think of the book as being divided into chapters, which are divided into
> sections, which are divided into … paragraphs … And what I'm wondering is if we used an LLM to
> summarize multiple levels of granularity. … As a user, you can sort of go up and down the levels of
> granularity. … the article up and down, and then the scales of granularity left and right. So maybe
> the furthest right would be the full article, and the furthest left would be … one sentence per
> page or per chapter or something. So by scrolling rightwards, you get more detail. By scrolling
> downwards, you progress through the chronology of the article.

On screen: columns of increasing detail beside the prose; sideways is how much detail, down is where
you are; the far right is always the author's own words. The same tree is also the *Hierarchy*, a
deeply nested table of contents, and the *Summaries* panel, one sentence on every part. This is the
feature the whole app was a bet on, and its roots go back to a May 2025 idea in the old app: a
"compact-summary mode" that replaced every paragraph with one sentence you could expand back.

**Stay oriented.** The *spine* — a narrow strip showing where you are in the whole piece (Greg,
2026-08-25: *"I need a way to see where I am in the whole article"*); the *arc*, one sentence per
part on where the argument stands by that point; and *Diagram* mode, four pictures of the article's
shape (Greg, 2026-08-26: *"diagrams/maps of the structure of the doc … It would be amazing if it was
interactive"*).

**Interrogate.**
- *Glossary* — the terms this piece uses in a non-obvious way, defined from the piece itself,
  underlined wherever they occur, with the card coming to you rather than you leaving the page.
- *Ideas* — the propositions the piece assumes or introduces. Greg, 2026-08-26: *"a way to pull out
  new ideas that the text introduces and/or key ideas that the text requires the user to understand."*
  A term is a word you look up; an idea is a claim you hold.
- *Quotes* — the article's own sentences worth keeping, orderable by place, importance or how
  striking they are (Greg, 2026-08-31).
- *Timeline* — when the piece says things happened, uncertainty shown rather than hidden.
- *Search* — literal *words* and semantic *meaning*, hits marked in the prose and painted into the
  spine, confidence shown honestly. The old app's Greg on why this matters (2025-07-14): *"being
  able to see specifics of the actual text verbatim, in context, and perhaps notice other related
  areas, and be able to scan the actual text in a rapid assisted way."*
- *Comments* — select a passage, it's bookmarked; a note is optional; an AI response is a tick-box,
  not the default.
- *Chat with tools*, and *Live conversation* — a chat that can search the piece, your library or the
  web, where every claim links back into the article, and which will not summarise the article for
  you on purpose. Live mode lets you talk to it out loud.
- *Links* — hover an author's own hyperlink and see where it goes before you leave.
- *Referee mode* — for peer reviewers: your own criteria streamed against the paper, the paper's
  claims pulled out with where they are taken up, and a *Mirror* that rereads your own draft comments.
  Built explicitly to help a reviewer read *without reading for them*.

**Internalise.**
- *Remember* mode — you say (or type) what you took from the piece and the model tells you, plainly,
  where your account and the piece diverge. Greg, 2026-08-27: *"the prompt for this should be
  delicately written, because we don't want to be annoying/patronising/superior, but at the same time
  the user is earnestly looking to deepen/correct their understanding."*
- *Quiz* — the other half: a dozen short-answer questions from the article, easy-first then harder,
  central-first, marked against the article itself.
- *Reader profile* — a box for who you are and why you are reading this, fed into anything that
  should be tailored.

**Around it.** A *library* shelf; paste a URL or upload a PDF and watch it ingest; *Export* — one
button that gives you everything Spideryarn holds about an article, because, Greg, 2026-09-01:
*"It's the reader's data."*

## 5. Who it is for

This is the question the old repo argued with itself about most, and the honest answer has two
layers.

**The true north: anyone who has to read difficult non-fiction and needs to actually understand it.**
The old vision doc's list, in Greg's words: *"Academics, researchers, editors & reviewers,
journalists, strategists, politicians, investors, commentators, leaders — anyone who needs to read a
lot of non-fiction."* The texts the product has always been tested on say the same thing: Chalmers on
consciousness, Deleuze and Guattari, Sutton's "The Bitter Lesson", an arXiv paper, a statistics
textbook, Nietzsche notes, and in the rebuild an Anil Seth essay on AI consciousness. Philosophy of
mind, machine learning, long essays. Never fiction, never business memos, never the news.

The old tagline file (2025) put the audience in one line: *"Aimed at researchers, academics etc who
have to read a lot of difficult stuff, and want to get the gist of a document, then understand it,
interrogate it, compare it, remember it, etc."*

**The wedge Greg chose in 2025, reluctantly and with his reasons on record: scientific peer
reviewers and journal editors.** From the email quoted in the old vision doc:

> I'm thinking of focusing on scientific peer reviewers & journal editors, where: the human has to
> make a decision; based on evidence/criteria; it's a drudge job, where they don't want to do a
> terrible job, but they also very much want to be efficient; I can think of lots of ways to speed
> things up. It's not 100% aligned with the vision of helping experts to read & understand new
> difficult material deeply, but a stepping stone in roughly the right direction with a fighting
> chance of being enough of a pain that people might pay…

And in the marketing conversation, the full reasoning, including the doubt:

> the honest answer is that I'm leaning towards the more general case, but I guess I know that and it
> would be much better from a product marketing point of view to be more specific. I am often made
> this mistake before, so I'm trying to learn from that. At least to start with, I know more
> scientists and I've worked in science … reviewers … have a pain that doesn't feel quite so much
> like they've got to make a decision … it doesn't feel like a creative act in quite the same way. So
> maybe they'll be less threatened by AI helping them with it … it feels more like a pain that
> they're going to want a painkiller for. … one of our scientists … [was] like "oh no, I'm very good
> at reading a paper, I know how to glance around and get what I need from it efficiently".
>
> — Greg, 2025-07-14

The marketing-persona AI proposed, and Greg accepted as "plausible … something I could experiment
with", a **Trojan horse**: market to reviewers on efficiency, deliver the deep-reading experience
underneath.

**What has changed since.** Referee mode now exists in the rebuild, so the wedge is real rather than
notional. But the peer-review research turned up a hard constraint the 2025 thinking did not have:
**nearly every publisher and funder treats uploading an unpublished manuscript to a third-party AI
service as a confidentiality violation**, whatever the AI does with it. Spideryarn sends text to
models via OpenRouter. So the honest reviewer audience for a v1 is preprints, open-review venues,
public review, drafts shared with consent, and journal clubs — not a confidential Elsevier submission.
[ideas-fable.md](260831e-helping-peer-reviewers/ideas-fable.md) says this *"wants a sentence of
product copy, not silence."* The same research found that reviewers *"want help saying what they
already think more clearly, and resist anything that tells them what to think"*, and that showing an
AI's judgment first biases the human toward it, mistakes included. Both cut the reviewer pitch away
from "AI reviews the paper" and toward exactly what Spideryarn already does: structure, retrieval,
and a mirror on the reviewer's own words.

**Reader of the copy, then:** someone clever, busy, and sceptical of AI, reading something above
their pay grade on purpose. They do not want to be told they read badly. They want the drudge parts
cheaper and the thinking parts left to them.

## 6. Principles that bind the copy as much as the code

From [vision.md § Principles](../project/vision.md#principles), and they are the three commitments on
the current landing page. Any sentence of marketing that breaks one is wrong even if it converts.

1. **The text is the destination, not the source material.** Summaries route you into the prose.
   "Every generated line should be a door, not a wall." The rightmost level is always verbatim.
2. **Speak the author's language.** Summaries reuse the author's terms; no flattening "the author
   argues that…" voice. This is also a rule for copy about the product: describe what the *reader*
   does, not what the AI does.
3. **Effort in the right places.** Not less reading; less wasted reading.
4. **Legible provenance.** Anything the model asserts is tied to a block of the article and the
   passage is one press away. "Nothing the model says floats free."
5. **No hidden reformulation.** The author's prose is never silently rewritten.

And the older, engineering-side commitments that a reader can feel: **reversibility** (every AI
change to structure can be undone), **fail loudly rather than degrade silently** (the old PDF
pipeline would refuse a document rather than drop its figures), and **precision of meaning** (the old
app's Greg, 2025-06: *"'consciousness' and 'conscious experience' must be treated as distinct.
Because they mean subtly different things"*).

## 7. Anti-goals — what it will not be, and what the copy must never promise

From [vision.md § Anti-goals](../project/vision.md#anti-goals), unchanged since day one:

- **A chatbot with the article stuffed in the context window.** Chat exists, and the defence is
  that the article never leaves the screen and every claim carries a link back. The copy should
  never lead with chat.
- **"Read this in 2 minutes."** No time-saved percentages, no "3x faster". (The old 2025 messaging
  guidelines did propose "Review papers 3x faster without missing critical details" — that drifted
  back toward exactly the framing Greg was wary of, and it should not be revived.)
- **Engagement mechanics**, streaks, nudges, anything optimising for time in the app.
- **Confident generated claims with no path back to the source.**

The old brand guidelines' don'ts still hold and are worth keeping verbatim:

> ❌ "Revolutionary AI will transform how you read forever"
> ❌ "Our advanced algorithms eliminate the need for manual review"
> What to avoid: claiming AI can replace human analysis; overstating current capabilities; generic
> "revolutionary AI" language; dismissing current researcher methods.

One feature was cut for being on the wrong side of this line: the old app's tweet-thread view
(turn a paper into 12 tweets) was scoped "optimise for paper comprehension, not engagement" and was
still the one that got deprecated. The rebuild has a numbered-thread page but does not advertise it.

## 8. Differentiation

Stated across both repos; the ordering is mine.

- **Versus a chat window (ChatGPT, Claude, NotebookLM).** Grounded in the page, not the
  conversation. Every answer cites a passage you can press. It will not summarise the whole thing
  for you. Greg's phrase: *"keeping you grounded in the actual paper itself rather than in the
  conversation."*
- **Versus summarisers (Blinkist-style, "TL;DR" browser extensions, most AI reading apps).** They
  compress; Spideryarn zooms. Every level of detail is on screen at once and the full text is one
  column away. The summary is an entry point, never the terminus.
- **Versus PDF readers and reference managers (Zotero, Adobe, Readwise Reader).** Those hold and
  annotate; they do not understand. Spideryarn gives the piece a structure, a glossary, a map and a
  meaning-search it did not ship with.
- **Versus academic AI tools (Elicit, Scholarcy, SciSpace, Consensus, Semantic Scholar).** Those
  work across the literature: find papers, extract fields, rank consensus. Spideryarn is
  **single-document, deep**. Greg on scope (2025-07-14): *"I'd like for the first version of the
  product to try and stay within a single paper, I need to not try and assess the whole literature
  because that's a whole other bowl of wax."*
- **Versus writing and thinking tools (Notion AI, Obsidian).** Greg: *"Notion and Obsidian are
  more like writing tools or at least collaboration tools because you're explicitly adding a lot of
  text, and this is explicitly a reading tool currently focused on single documents at a time."*
- **Versus peer-review checkers (StatReviewer, SciScore, Ripeta).** Those check reporting
  completeness; none judges the science, and Spideryarn does not claim to either. It helps the
  referee read and hold their own judgment.

The one-line category: **an augmented reader.**

## 9. Voice and tone

Greg's own register, in every quote above, is the voice: plain, first person, honest about doubt,
allergic to hype, specific. The old guidelines' four words are right — *professional yet
approachable, confident but not arrogant, empathetic, clear and direct* — and their good examples
show the shape:

> ✅ "We understand how frustrating it is to hunt through a 30-page paper for methodology details"
> ✅ "Your expertise drives the analysis — our AI just helps you get there faster"

The rebuild's own docs add rules that read as tone rules: *say each thing once, briefly*; *quote the
author, don't paraphrase them*; *when a number is a guess, say so out loud* (the search panel tells
the reader its confidence score "is the model's own guess rather than a measurement"). The current
landing page is the best existing sample of the voice, and its best lines are:

- *"AI that helps you read harder things, not fewer of them."* (the current strapline)
- *"Make deep reading cheaper, not optional."*
- *"Every generated line is a door into the prose, never a wall in front of it."*
- *"This is an alpha. A working experiment, not a product."*

**Words to use:** read, understand, hold, argument, the author's words, where you are, in place,
verbatim, door, orient, interrogate, internalise, one press away.
**Words to avoid:** summarise (as a promise), faster, save time, revolutionary, powerful, unlock,
effortless, insights (as a noun), "AI-powered" as a prefix on everything, any percentage.

## 10. Taglines already on the table

From `TAGLINES.md` and the 2025 guidelines, then the rebuild:

| Line | Source | Note |
|---|---|---|
| Spideryarn — to help us read more deeply & efficiently. | 2025 | The plainest statement of intent; "deeply & efficiently" is the whole tension in four words |
| Be changed by what you read. | 2025 | Greg's favourite by position in the file; aspirational, says nothing about AI |
| The best thing to happen to your reading since sliced paper. | 2025 | Joke; risks the wrong register with academics |
| "Computers are useless. They can only give you answers." | 2025, Picasso | Contrarian hook; captures "interrogate" |
| Your tireless / junior science assistant is ready | 2025 | The "smart postdocs" idea, but "assistant" now sounds like every chatbot |
| Read deeper, decide faster / AI assistance, human insight / Where deep reading meets smart technology | 2025 guidelines | Generic; drafted by the AI persona, not Greg |
| A tool for reading enriched documents with AI assistance — designed to help you navigate, digest, and interrogate complex documents like papers, essays, and books. | 2025 | The best *subhead*; "navigate, digest, interrogate" is a keeper |
| AI-assisted reading | Greg, 2026-08-27 | What he asked for as the page-title tagline |
| AI that helps you read harder things, not fewer of them. | 2026 landing page | Current strapline; strongest so far, an agent's line not Greg's |

Synthesis: the durable ingredients are **depth, not speed**; **the author's words stay**; **you do
the thinking**; **navigate, digest, interrogate, remember**. A three-line stack that uses only
Greg's own ingredients: *Spideryarn Reading. AI-assisted reading for people who need to actually
understand. Navigate, interrogate, remember — the author's words never leave the page.*

## 11. Brand facts

- **Name.** "Spideryarn" is unexplained in both repos — no origin story, no meaning written down
  anywhere. The logo's hover animations were themed on web strands ("Strand Pulse", "Web Threading"),
  so the spider/web reading was live in 2025. The product is "Spideryarn Reading"; the code and the
  page say "Spideryarn"; the old app's parent project presumably owns the bare name.
- **Colour.** Spideryarn orange, `#DB8A45`, since May 2025; the 2025 guidelines' suggestion of
  "deep blues, professional grays" was never adopted and contradicts the shipped brand. The rebuild is
  dark-mode only, by Greg's call (2026-08-24: *"I'm happy to go with the dumb version where we just
  switched to always being in dark mode"*).
- **Type.** Georgia for reading prose, chosen on comprehension research (65-character measure, 17px);
  Trebuchet MS for the wordmark; Geist for interface chrome in the old app. Aesthetic target, in the
  old design doc's words: "Professional Academic Aesthetic … delight without distracting from the
  serious academic software context."
- **Logo files.** `public/spideryarn-logo.png` and a presentation-quality version dated 2020-09 in
  the old repo (`static/img/logo/`), so the name predates both apps by at least five years.

## 12. Business model, stage, and access

Nothing here is decided for the rebuild; this is what was thought in 2025 plus what is true now.

- **2025 thinking.** *"Probably a professional tool for academics and people like that. It'll be
  paid. Maybe eventually this will be something that universities, journals, or research companies
  pay for, for their employees/researchers."* Price: *"$20/month (or perhaps $10 or $50 or tiers) for
  uploading as many papers as you like."* A "centaur-sourcing" idea: you pay to commission AI
  processing of a document; the result becomes available to everyone who can read that document.
  Never built, never mentioned again.
- **Now.** It is an alpha behind an invite list; the landing page says so in a strip and Greg asked
  for *"a very prominent 'Alpha' sign"*. There are no real users, one production database, and
  speed is the priority. A visitor today can read the pitch and see four screenshots but cannot get
  in.
- **Data stance already in the product.** Export gives the reader everything; the live-conversation
  audio never touches Spideryarn's own server. "It's the reader's data" is a claim the copy can make.

## 13. How we would know it is working

[open-questions.md § Q6](../project/open-questions.md#q6) says the augment-not-replace claim
*"needs a test, or it's just a slogan."* The candidate signals there are the right ones for a
marketer to know, because they are also the promises:

- Readers actually scroll *right*, into more detail, rather than stopping at the gist.
- Afterwards they can reconstruct the argument.
- They quote the piece.
- Explicitly *not* time in app, and not articles completed.

## 14. Tensions and contradictions a copywriter would otherwise inherit

1. **Depth versus efficiency.** Greg has said both "read more deeply & efficiently" and "not
   about efficiency". The resolution in vision.md is "effort in the right places": the drudge gets
   cheaper so the depth gets more of you. The 2025 guidelines slid to "3x faster"; that was drift.
2. **General reader versus peer reviewer.** Chosen as a wedge in 2025 with doubts on record; now a
   built mode, with a confidentiality constraint that shrinks its honest audience. The site could
   lead with the general reader and have a page for referees, or the reverse.
3. **Single document versus the literature.** Always single-document by choice; some competitor
   comparisons in the 2025 research were against multi-paper tools. Say the scope out loud.
4. **The name of the thing.** "Reading" appears in the product name but the rebuild's page says
   just "Spideryarn". Which is the brand?
5. **"AI-assisted reading" versus "augmented reader".** Greg asked for the former as a tagline; the
   latter is the sharper category. Both are honest.
6. **Chat.** An anti-goal that was built. The copy's stance is settled in vision.md ("the article
   never leaves the screen, every claim carries a link") but it must not be the headline feature.

## 15. Greg's answers, 2026-09-02

Asked the same day the brief was written. His words, lightly trimmed where the question is implied.

1. **Front door.** No option picked; the note was about the other audience: *"make sure we have
   stored the notes for Peer Reviewer/Referee in our .md docs for when we add extra website copy for
   them in future."* Read as: the general deep reader is the homepage; the referee material is kept,
   not led with — see [referee-mode.md § Website copy notes](../project/referee-mode.md#website-copy-notes-kept-for-later).
2. **Depth or efficiency.** *"time-saved is acceptable, but don't emphasise it. 'more deeply &
   efficiently' feels right for now."* So the 2025 line stands, and a time claim may appear but never
   as the headline.
3. **The name.** *"It's a long story re the origin of Spideryarn. It was originally a note-taking
   app, with the idea of a web of ideas and stories weaving together, but still feels relevant. I'm
   reusing it as a name/brand for a bunch of experimental projects. This is the primary one right now.
   So let's go with spideryarn.com but with most of the reading-related stuff under /read and the main
   title on the homepage 'Spideryarn Reading' (which is also helpfully explanatory for a brand-new
   user)."*
4. **Stage and access.** *"We're working on taking Stripe payments. I'm hoping to promote it to
   'Beta' soon, and get it to the point where we can sign up real users and share Public-readable
   docs and hopefully even our first payments soonish."* And, a minute later: *"we should write the
   copy as if we're in Beta and taking payments."* So the website copy assumes Beta, sign-up open,
   paid — not the alpha strip the current landing page carries.

5. **Voice.** Confident and plain is *"probably closest. But I want it to use my words rather than
   AI-generated, and it may not be clear what came from me vs AI. So for now, I'd say let's try and
   take notes on all the core ideas/concepts, and you can interview me and I'll use voice-dictation
   to breathe life & lyricism in."* The interview guide is
   [260902k-spideryarn-reading-interview-guide.md](260902k-spideryarn-reading-interview-guide.md).
6. **Which texts.** Name fields as well as genres.
7. **Chat on the site.** Yes, far down, framed as "ask in place".
8. **Citing the research, and taglines.** *"For now, let's just add this to docs/research/, and
   eventually we'll add blog posts and/or pages that describe the thinking/evidence behind our
   product decisions."* No tagline was picked; § 14 of the interview guide asks again.

The decided parts now live in [positioning.md](../project/positioning.md).

## 16. Provenance — whose words are whose

Greg's concern in answer 5 is fair, so, for this doc: **every blockquote attributed "— Greg" and
every italic phrase with a date beside it is his, verbatim.** Everything else is an agent's
synthesis. In particular, these lines are **agent-written and not copy**, however good they sound:
the current landing page's strapline *"AI that helps you read harder things, not fewer of them"*,
its "The problem" paragraph quoted in § 3, *"Make deep reading cheaper, not optional"*, *"a door into
the prose, never a wall"*, *"Nothing the model says floats free"*, the three-line stack proposed at
the end of § 10, and the words-to-use list in § 9. The five verbs in § 4 — scan, descend, stay
oriented, interrogate, internalise — are an agent's compression of Greg's *"scan through things
quickly … or you could burrow deeply"* and *"internalize and interrogate"*; two of the five are his
words, three are not.

---

Up: [docs/research](.) · Owner-to-be: [vision.md](../project/vision.md)
