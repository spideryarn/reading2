# 261003f — Shelf topics named by a model, as concepts rather than phrases

**Status: Greg answered on 2026-10-03 and v1 is built, for shelves of up to 150 works** —
[§ Greg's answer, and v1](#gregs-answer-and-v1). The sections from *The proposal* down to *The
questions for Greg* are the first proposal, kept for its reasoning; where they disagree with v1, v1
is what is built.

## Greg's answer, and v1

> Okay, that sounds good. I guess what will it have as input? Will it take in the sort of titles and
> summaries or what? I guess the prompt probably needs to take into account the variety and number
> of articles.
>
> Because if there aren't that many, we probably don't want that many topic pills. If there are
> loads, then we probably need more. And indeed, if some topics have loads, then we probably need a
> mix of coarse and fine-grained topic pills. Because, you know, if I'm a neuroscience expert and I
> have a thousand neuroscience papers, and then a few others that are on a mix of topics like
> Buddhism and carpentry, for example, then, you know, I want neuroscience, Buddhism and carpentry
> as high-level categories, but then I also want a whole bunch, a crap load of fine-grained topic
> pills, you know, within those.
>
> And I guess ideally what we want would be a little bit of metadata for each topic pill for how
> sort of coarse or fine-grained, ranging from zero to one. And then we might order the topic pills
> by coarseness. So it's all the coarse ones first. And then, for example, if I pick neuroscience,
> then it'll hide all of the non-neuroscience-related topic pills.
>
> And then I can easily filter down within those at sort of increasing levels of granularity. And it
> should keep the existing machinery for, you know, mapping the topic pill colours so that similar
> topic pills get a similar colour. If you can see any other improvements, go for it.
>
> If you have questions that you need to ask, ask me, but I'd probably prefer you proceed
> autonomously.
>
> — Greg, 2026-10-03, relayed by the Overseer

> One more thing. You said it costs a cent per shelf each time topics are worked out. I guess so
> potentially that means we need to do it every time we add a new paper or a new batch of paper
> articles. Could be a bit on the expensive side.
>
> I wonder if maybe I don't understand how this would work, because if we add a new paper, do we
> have to rerun this automatically? Do we can we just add the topic pills that exist for the new
> paper? If it adds new topic pills, how does it backfill existing papers?
>
> I know if you feel like you have a plan that's clear and that will work, go for it. But we need to
> keep one eye on cost. One approach would be, you know, for the user to be able to click a button
> to refresh the topic pills. And that way it would only happen every so often.
>
> But the key thing is new papers and articles need to be included automatically. That shouldn't be
> something that the user has to do. Maybe we need some evals. Yeah, so I guess we're trying to
> prioritize a bunch of objectives.
>
> One of them is, you know, new papers should always be included and that things should be up to
> date. So correctness, I suppose. Then the next would be cost. And then the next would be latency.
>
> And actually also quite a high priority that this shouldn't require much thought from the user.
> And another high priority is this should be really clear and helpful to the user.
>
> — Greg, 2026-10-03, relayed by the Overseer

And, asked directly whether to build and whether his shelf may be read: *"Yes, build the first
version. Yes, it's allowed to read my shelf from production."* The permission classifier still
refused the production read from this session, so his shelf has not been looked at; the one-command
script in question 1 is still how he sees it.

### His questions, answered

**What does it take as input?** Each article's title and its one-sentence summary (the abstract,
for a paper that has no summary yet), and the reader's "about you" if they wrote one. Never the
article text.

**If we add a new paper, do we have to rerun everything?** No. There are two jobs:

- **Filing.** A new article is shown the existing topic names and asked which it belongs in. That
  is one small call, about $0.00005 an article, and it happens by itself the next time the shelf is
  opened, within seconds. Nothing for the reader to do. This is his "can we just add the topic
  pills that exist for the new paper?", and the answer is yes.
- **A re-think.** Now and then the whole tree is worked out again, which is when new topics can
  appear, and because it reads every article it files all the old ones under the new topics too.
  That is the backfill. It happens when the shelf has grown by a quarter since the last one, or
  when enough articles have turned up that fit no existing topic.

**Against his priorities, in his order:**

1. *New articles are always included.* Sorting them in is automatic: by filing, or by a re-think
   when one is due anyway, since a re-think reads every article. An article that fits no topic is
   recorded as seen and counted towards the next re-think, so a new subject does not stay
   invisible. Until it is sorted, the row says *Sorting 1 new article into topics…*, because for
   those seconds it is missing under a chosen topic.
2. *Cost.* Filing is a two-hundredth of a penny per article. A re-think of a 150-article shelf was
   a cent and a half. Over a shelf's first 150 articles the two together come to roughly a
   twentieth of a penny per article, most of it re-thinks ([§ What v1 costs](#what-v1-costs)).
3. *Latency.* The row draws at once from what is stored. Filing a handful of new articles takes
   15 to 30 seconds in the background and the row updates without a reload. A re-think takes one
   to two minutes in the background; the old topics stay up until it lands.
4. *Little thought from the reader.* There is no button and no setting in v1. The refresh button
   he floated is deferred: with filing automatic it is a convenience, not a need
   ([§ Deferred](#deferred-with-a-queue-entry-each)).
5. *Clear and helpful.* Broad subjects first; choosing one hides the unrelated pills and brings its
   finer topics forward; a finer pill is marked `›` and its card says which subject it is inside.

**Where v1 stops short of what he asked: it re-thinks shelves of up to 150 works, not a thousand.**
[§ The 150-work cap](#the-150-work-cap) says why and what is queued.

### The tree, and the 0-to-1 number

A re-think asks for the shelf's **broad subjects** first: the separate fields a librarian would make
top-level sections, as many as the shelf really has. A field that most of the shelf belongs to is
one topic however large. Then **every topic with twelve works or more is asked about again, by
itself**, for the finer topics inside it, and those again, to three levels. The count at each level
follows how many works are there (about √n, between 3 and 20), which is his "if there aren't that
many, we probably don't want that many topic pills. If there are loads, then we probably need more".

**Granularity is the level, not the size**: 0 for a broad subject, 0.5 for a topic inside one, 0.75
inside that (`1 − 2^−depth`). *Buddhism* with seven articles is as broad a subject as *Neuroscience*
with 160, which a number based on size would get wrong. It is sent with each pill, and the row is
ordered by it, broad first, then by how many articles.

**Picking a pill narrows the rest** with the rule the row already had: a pill with nothing to show
is not drawn. Choose *Neuroscience* and *Buddhism* and *Woodworking* go; its finer topics stay.
**The colours are untouched**: they are worked out from which articles topics share, so a subject
and the topics inside it land on neighbouring hues by themselves.

**A name already taken.** If *Consciousness* is already a broad topic, a finer *Consciousness* inside
*Neuroscience* is not made: two pills of one name at different levels cannot be told apart, and
choosing the two existing pills together already gives those articles. If two subjects each have a
finer topic of one name (*Methods* inside *Neuroscience* and inside *AI*), both are kept: they are
told apart by which subject is chosen, and each card says what it is inside.

### What was measured

[`evals/shelf-topic-clusters/hier.ts`](../../evals/shelf-topic-clusters/hier.ts) runs the shipped
code (`rethink` and `fileWorks` in `src/shelf-terms/model-topics.ts`) on synthetic shelves that
record what each article was written to be about. One run each, on the final code:
[hier-expert-150.md](../../evals/shelf-topic-clusters/results/hier-expert-150.md),
[hier-greg-wide.md](../../evals/shelf-topic-clusters/results/hier-greg-wide.md),
[hier-expert.md](../../evals/shelf-topic-clusters/results/hier-expert.md).

- **expert-150** is Greg's own example at the size v1 re-thinks: 141 neuroscience articles over ten
  sub-areas, 6 Buddhism, 3 carpentry. The top level came back as exactly *Neuroscience 141 ·
  Buddhism 6 · Woodworking 3*; inside *Neuroscience*, 13 topics (*Memory, Reward & decisions,
  Predictive processing, Vision, Synaptic plasticity, Motor control, Attention, Sleep* …); inside
  those, 44 finer ones. All 13 intended categories were matched (mean F1 0.90). 12 calls,
  **$0.016, 104 seconds**.
- **greg-wide** (96 articles, twelve areas): 11 broad topics and 15 finer ones; 11 of 12 intended
  areas matched (mean F1 0.82; *startups*, six articles, reached only 0.55). 5 calls, **$0.005, 57
  seconds**.
- **expert**, all 172 articles, is above the cap, so it exercises the sample-and-file path the
  product does not use yet: the same three broad subjects, 15 topics inside *Neuroscience*, 59
  finer. 16 calls, $0.02, 162 seconds.
- **Filing, judged against what the articles were written to be about** (not against the model's
  own earlier answer, which was GPT Sol's objection to the first test): every fifth article is held
  out, the rest re-thought, the held-out filed.

  | shelf | filed articles: share of their intended topics they are in | the same for articles the re-think placed | share of a filed article's topics that are wrong | cost an article |
  |---|---|---|---|---|
  | expert-150 | 0.93 | 0.93 | 0.02 (0.00 for the re-think) | $0.00005 |
  | greg-wide | 0.84 | 0.77 | 0.10 (0.04) | $0.00004 |
  | expert (172) | 0.95 | 0.93 | 0.03 (0.01) | $0.00005 |

  No held-out article was left in no topic. On greg-wide two intended categories had no topic to be
  scored against in the smaller tree (*history of science*, *startups*), which left one article
  unscored; that is a miss by the re-think, not by filing, and is counted in the 11 of 12 above.

**One thing was changed after seeing a result, and it is the important one.** The first top-level
prompt asked for "about √n broad topics". On the expert shelf that produced fifteen top-level
neuroscience topics beside *Buddhism* and *Woodworking*, and no *Neuroscience*: the opposite of what
Greg asked for. The prompt now asks for the shelf's separate fields, "as many as the shelf really
has and no more", and says a dominant field is one topic. Two smaller rules were also added after
the first greg-wide run: a name a broader topic already has is not reused, and a finer topic needs
three works.

**What this does not show**: variance between runs, the effect of article order, whether a re-think
keeps the previous labels (the instruction is in the prompt and unmeasured), a real shelf, or
anything above 172 articles.

### The 150-work cap

**A re-think is attempted only on a shelf of up to 150 distinct works** (`MAX_WORKS`). Above that:
a shelf that already has a tree keeps it, and new articles are still filed into it; a shelf that
never had one keeps the phrase pills.

Why, from GPT Sol's review of this design (findings 1 and 2), both of which hold:

- **A rare subject would be missed.** Above 150, a level is named from a sample of its works and the
  rest are filed into those names. With five carpentry papers among a thousand, the sample holds
  less than one of them on average, a topic needs three, and filing cannot invent a name. That is
  precisely Greg's *Buddhism and carpentry* case, and it would fail silently.
- **It would not finish.** A 3,000-work re-think is some seventy filing calls at the top level
  alone before the finer levels start, which can outlast both the ten-minute claim and the
  function's 800-second limit, and then start again.

The fix is known and is the next stage: name candidates from **every** chunk of the shelf, merge
them in one more call, file everything into the merged names, and make the re-think a job that can
stop and resume across requests. It is queued, not built. **This is the one place v1 does not do
what Greg described**, and whether it matters now depends on how many articles his shelf holds.

### How it runs

- **One stored tree per reader**, over active and archived articles together (`shelf_topic_sets`):
  the tree, each article's topics, the profile it was made with, when it was last re-thought and
  last filed. Membership is cut to the articles in view when it is read, so the same tree serves the
  shelf with and without *Include archived*.
- **Exact copies are one work**: the model sees one line per work and every copy gets its topics.
  The deterministic phrase reader finishes the exact-copy hashes over active and archived first;
  naming and filing wait rather than treating a not-yet-read copy as a separate work. While it
  does, `pending` may include an archived article outside the active view because the tree spans
  both halves of the shelf.
- **On each request to the topics route**: answer at once from the stored tree (or, when there is
  none yet or the shelf is under eight works, with the phrase pills); then, if anything is due,
  claim it, **read everything again under the claim and decide again**, take the allowance, and do
  the work after the answer has gone. Due means, in this order: a re-think (no tree yet; the prompt
  version, the model or the reader's profile changed; the shelf has grown or shrunk by a quarter
  and at least five works since the last one; or the works that fit no topic have grown by five and
  a tenth of the shelf since then), else filing whatever is not yet in the tree.
- **Arrivals during a re-think are filed in the same handler**: after the write, an optimistic shelf
  read finds whether anything arrived; if it did, the drain takes a second claim and reads the row
  and shelf again under it before filing. It therefore cannot file ids from its old tree into a
  newer one that another request wrote between the two claims.
- **Never judged by hashing a prompt that contains the previous answer.** The previous labels are
  given to a re-think as context ("keep a label that still fits") and play no part in deciding
  whether one is due.
- **A failed call** counts, backs off as the scoring did (2, 8, 32, 128 minutes, then six hours),
  and leaves the stored tree in use. A call for one subject's finer topics is tried twice; if it
  fails twice the whole re-think fails, because a tree stored with a branch missing would look
  complete.
- **Below eight works**, nothing is asked and a stored tree is not shown; the row behaves as before.
- **The old scoring call is no longer made.** Its stored scores still shape the phrase pills a
  reader sees until their first tree lands.
- **The client asks again every 10 seconds for up to three minutes** while the server says work is
  under way, so a re-think is seen landing without a reload. It was 8 seconds, four times.
- **Security** is the list under the first proposal's stage 1: no tools, a strict schema, works and
  topics named only by ids this prompt showed, a label of one clipped line with a fixed-alphabet
  key, text-only rendering, nothing of the shelf logged, an owner-scoped row.
- **One known gap**: the "fits no topic" trigger compares two totals, so if as many unplaced works
  are deleted as new ones fail to fit, it does not fire. The size trigger still does in time.

### What v1 costs

Measured, GPT-6 Luna, 2026-10-03, one run each. A re-think was $0.005 at 96 articles, $0.016 at 150
and $0.02 at 172: **between $0.00006 and $0.00012 an article per re-think**, more on the shelf with
the deeper tree, because each article is read once per level. Filing is **$0.00004 to $0.00005 an
article**.

| | |
|---|---|
| adding one article | about $0.00005 (filing) |
| one re-think of a 150-article shelf | about $0.016 (measured) |
| a shelf's first 150 articles, in total | about $0.05 to $0.10: 150 filings ($0.01) and re-thinks at each quarter of growth |
| per article, averaged | **about 0.03¢ to 0.07¢** |
| each article past 150 | about $0.00005, filing only, until the large-shelf stage exists |

The totals are arithmetic from the measured prices: re-thinking at each quarter of growth means the
shelf is read about five times its final size over its life. What bounds it: 12 pieces of work an
hour and 40 a day per reader, 3,000 a day across everyone, each at most one re-think of 150 works.
So the worst day is under a dollar for one reader and about $60 for everyone together, if every
allowed piece of work were a full re-think.

### Deferred, with a queue entry each

- **Shelves over 150 works**: naming from every chunk and a re-think that can resume, as
  [§ The 150-work cap](#the-150-work-cap) describes, with its own eval on shuffled 1,000- and
  3,000-article shelves holding a few rare subjects. The allowance should be weighed by calls or
  dollars rather than counted in jobs before the cap is lifted (Sol, finding 11).
- **A *Redo topics* button.** Greg floated it as a way to keep cost down; with filing automatic it
  is no longer needed for that, and he asked for no thought from the reader. Worth adding if a tree
  comes out wrong and somebody wants it redone now.
- **Removing the old scoring path** (`model-scores.ts`, `shelf_topic_scores`, the scoring half of
  `shelf-topics.ts`) once v1 has been seen on real shelves.
- **Greg's own shelf.** `npm run shelf-topics:preview` shows the flat first proposal, not this
  tree. The live row is now the better look; the script should be retired or taught the tree.
- **Editing topics** (rename, hide, pin), as before.

Report `spya-ntyes8`
([note](../user-feedback/260930_0715-shelf-topics-as-concepts-topic-model-or-clustering.md)), Greg,
2026-09-30, on the logged-in homepage:

> Somehow the topic pills on the logged-in homepage still don't feel they're working that well. By
> that what I mean is I look at the topics and they don't seem like high-level concepts that I would
> use to group and organize my articles myself if I was coming up with them. Or at least some of
> them do, like, you know, there's one for Buddha, one for AI. So we're getting there. But there's
> others like "principles" and "writers" that seem a bit generic/arbitrary.
>
> […] Alternatively, maybe this is all overkill, and we just use an LLM or two. But if that's what
> you conclude, I'd want to discuss carefully about costs (so that it can scale to thousands of
> papers for a given user while costing at most pennies per paper).
>
> I'm hoping there's a way to do this that won't be enormously complex. If this is going to be
> complex, do a bit of research and planning, but stop before implementing, and we can discuss
> options.
>
> — Greg, 2026-09-30

The conclusion **is** "use an LLM", so by his own rule this stops here for the cost conversation.
The options surveyed are in
[research 261003a](../research/261003a-topic-models-and-clustering-for-shelf-topics.md); the
measurements are in
[investigation 261003b](../investigations/261003b-shelf-topics-as-concepts-not-phrases.md).

## Why the pills are generic

Today ([shelf-terms.md](../project/shelf-terms.md)) a program finds phrases the articles literally
use, and GPT-6 Luna scores those phrases; the rule is that the model **never invents a label**. That
rule is the cause. No article about predictive coding says "computational neuroscience", and no
essay on drafting says "writing", so the umbrella is never a candidate and the best available
phrase is something like *writers*. A stricter scorer cannot help: it can only refuse what it is
offered.

A topic model (LDA and its Bayesian relatives) does not change this. Its topics are lists of likely
words, it needs hundreds of documents, and there is no maintained JavaScript version. Embedding
clustering groups articles without a label and then needs a model to name the groups anyway. So
every route to *Buddhism* and *AI* has a model writing the label.

## What the eval found

Six synthetic shelves (12 to 96 articles), blind Opus judges, one verdict per shelf, on one run of
each method:

- **A model that reads the titles and gists and proposes the topics itself won all six against
  today's list.** It also won all six against the one embedding-clustering pipeline we built
  (Louvain groups, model-written labels, a similarity rule for overlap). That says this pipeline is
  not worth its extra parts, not that clustering could never be made to work.
- On the 96-article shelf modelled on Greg's interests, with *principles*, *writers*, *lessons* and
  *framework* planted across it, it gave thirteen topics: *Computational neuroscience,
  Consciousness, Buddhism, Artificial intelligence, AI safety, Meditation, Writing, Learning and
  memory, Philosophy of science, Economics, Productivity, History of science, Business*. The first
  twelve match 11 of the 12 areas the articles were written for and all thirteen match 12;
  clustering matched 5; today's list matched none.
- Two runs put most articles in the same groups (0.81 to 1.00 on a best-overlap measure), but not
  all, and a label can change (*Soil health* in one run, *Seed saving* in the other).
- It makes **fewer, broader pills**: 3 to 6 on a small shelf where today gives 7 to 17.

**This is a synthetic benchmark, and Greg's own shelf was not in it**: this session was refused the
production read. The trial on his shelf is the decisive one, so it is the first stage below, before
anything changes for anyone.

## The proposal

**The model names the topics and says which articles belong in each.** The program's phrase list
stays exactly as it is, as what the row shows when there is no model answer (no key, a failed call,
the first seconds on a new shelf).

**And the topics are re-thought when the shelf has grown by a tenth, not every time it changes.**
This is the cost decision, and it is also the stability one: between re-thinks the labels do not
move. An article added since the last re-think is in no topic until the next one, and a
*Redo topics* button asks for one now.

### Stage 0 — Greg's shelf, before anything ships

**Written 2026-10-03, not yet run on a real shelf**:
[`evals/shelf-topic-clusters/preview-shelf.ts`](../../evals/shelf-topic-clusters/preview-shelf.ts),
`npm run shelf-topics:preview`. It takes an owner's id, reads the shelf inside one
`begin read only` transaction, and prints the shelf's size and today's pills beside the proposed
ones, with what the one model call cost. It writes nothing, not even the spend ledger. The command
is in question 1. **If Greg's pills are not clearly better, stop here.**

What has and has not been checked: it typechecks, and its queries ran against the local database for
an owner that does not exist (no rows, exit 0). This session was refused any read of a real shelf,
so the half after the queries has run only under GPT Sol's mocked cases in its code review
([prompt](261003f-shelf-topics-named-by-a-model-code-review-prompt.md),
[answer](261003f-shelf-topics-named-by-a-model-code-review-sol.md)), which also made it count
exact copies as one work, skip the call below eight works, apply stored scores exactly as the route
does, and strip control characters from what it prints. The model call itself is the eval's own
`induce`.

### Stage 1 — the model's topics on the shelf, up to 150 works

What is kept from today: the one-at-a-time claim and its lease, the back-off after a failure, the
per-reader allowance and the global fuse, `chosenBy`, the client's ask-again loop, the narrowing
and the count formula, the colours (they are worked out from which articles topics share), the
paper card. What changes:

- **The call** (`src/shelf-terms/model-topics.ts`, beside `model-scores.ts`): the reader's profile,
  one line per **distinct work** (exact copies are one line, as the chooser counts them today) with
  its title and gist, or the abstract for a paper with no gist. The eval's instruction, as measured:
  about √n topics, between 4 and 20; named the way the reader would label a shelf; 1 to 4 words; no
  generic word; no near-synonyms; at least 3 works each (2 below twenty works); every work in each
  topic it is substantially about. The previous labels are added as context with "keep a label that
  still fits". That clause was not in the eval and gets its own measurement in this stage.
- **Articles the phrase program skips are included.** A non-English article has a title and a gist,
  which is all this needs. That is a gain over today.
- **When a re-think happens.** The stored answer records which works it saw. A re-think is due when
  there is no answer yet; when works it has not seen reach a tenth of the shelf; when the profile,
  the prompt version or the model changes; or when the reader presses *Redo topics*. A rename, a
  new gist, an archive or a delete does not trigger one. **Freshness is never judged by hashing a
  prompt that contains the previous answer**, which would make every answer stale the moment it
  landed (GPT Sol, finding 6).
- **One topic set per reader, over active and archived together.** Today there are two stored rows,
  one per scope, and so two calls. Membership is cut to the articles in view when it is read, and a
  pill with nothing to show is already hidden, so one set serves both and the cost is not doubled.
- **A strict parser**, refusing the whole answer as today's does: work numbers must be ones the
  prompt showed; a label is trimmed, one line, at most 40 characters; two labels with the same key
  are merged; a topic below the minimum is dropped; at most 20 topics. Nothing left is a failure and
  counts as one.
- **Stored** in `shelf_topic_scores`: a `topics` column (key, label, article ids) and the ids of the
  works seen. The migration is additive but must also loosen the existing check that a result row
  has `scores`. **A row from before this change keeps working as it does today** until the first
  topics answer replaces it.
- **Read back**: memberships are cut to articles still in view and expanded to every copy of a work;
  a topic left below the minimum is dropped; if none is left, the program's list is shown.
- **The key** is made from the label: lowercase, letters, digits and spaces only, so it can never
  contain the comma `?topics=` splits on. And the client must not drop a chosen key from the URL
  while a refresh is under way; today it can (Sol, finding 9).
- **The response**: a model topic's articles carry no phrase count, so `count` becomes optional on
  the wire rather than a made-up 1. Members come newest first. The tooltip and the More-detail row
  list them without "used N times".
- **On screen**: the *Topics* card says a model named them from titles and summaries, and when;
  *Redo topics* sits in it. When articles are waiting for the next re-think the row says how many.
- **Shelves over 150 works keep today's pills until stage 2.** One call over more than 96 is
  unmeasured and slow (44 seconds at 96).
- **The eight-work minimum stays**, counted in works as today, but as its own gate: today the model
  is not asked at all when the phrase program finds nothing, which is exactly where this would help.
- **Security**, re-reading [security-map.md](../project/security-map.md) at build time. A title is a
  stranger's text and can steer a label or a membership, on the shelf of the one reader who saved
  it. What bounds that: the call has no tools and fetches nothing; the answer is a strict schema;
  article ids must be ones this reader's prompt showed; the key is a fixed alphabet and length; the
  label is drawn as text only; nothing from titles, gists, labels or the profile is logged; the row
  is owner-scoped; tokens, time and paid retries are capped. "This is data, not instructions" in the
  prompt is a mitigation and is not counted as one of these.
- [privacy.md](../project/privacy.md) already says titles, gists and the profile go to OpenAI via
  OpenRouter for topics. Nothing new is sent.

### Stage 2 — shelves over 150 works

Name the topics from a **spread** of the shelf (not the newest 150, or an old subject could never
become a topic), then sort the remaining works into those topics in parallel batches, all inside one
claimed re-think, so nothing races it. **Unmeasured**: this stage starts by measuring it on a shelf
of several hundred, for quality as well as cost.

### What is not in it

- **Filing each new article the moment it arrives.** Measured at $0.00005 a call, and 10 of 12
  landed where the whole-shelf call had put them. But that only shows the model agrees with itself,
  and it would add a second prompt, an allowance of its own, and races with a re-think. Question 3
  offers it; the recommendation is to wait and see whether "sorted at the next re-think" bothers
  anyone.
- **No embeddings, no clustering.** The pipeline we tried lost, and it needs stored vectors, which
  this repo has not yet decided how to keep.
- **Nothing runs in the browser.** That was on Greg's list for an algorithm; a model call cannot.
  The row still loads at once from the stored answer.
- **Editing topics** (rename, hide, pin) stays the obvious next thing. The reader's own tags already
  sit in the row above.

## What it costs

GPT-6 Luna, measured 2026-10-03, two runs each: asking about a whole shelf cost $0.0010 at 22
articles and $0.0028 at 96 ($0.0023 and $0.0032), so about **$0.00003 an article per re-think**.
Everything past 96 articles below is that slope carried forward, **arithmetic and not a
measurement**.

| | today | re-ask on every change (not proposed) | **proposed: re-think at each tenth of growth** |
|---|---|---|---|
| what adding one article triggers | one scoring call | the whole shelf asked again | usually nothing |
| one re-think of a 150-work shelf | $0.001 | about $0.005 | about $0.005 |
| one re-think of a 1,000-work shelf | $0.001 | about $0.03 | about $0.03 (stage 2) |
| a reader's first 1,000 articles, in total | about $1 | about $15 | **about $0.35** |
| per article, averaged | 0.1¢ | 1.5¢ | **about 0.03¢** |

How the $0.35 comes about: re-thinking at each tenth of growth means the shelf is asked about
roughly eleven times its final size over its life (10 articles, then 11, 12, 13 …, then 909, then
1,000), so about 11,000 article-asks at $0.00003. At 3,000 articles it is the same 0.03¢ each,
about $1 in all. That is a thirtieth of a penny per paper, against Greg's limit of pennies.

What can push it up: a failed call is paid for and retried on today's back-off; *Redo topics* and
a profile edit each cost one re-think; Luna's reasoning tokens vary (the dearer of two runs was 40%
above the cheaper). What bounds it: today's fuses, 12 re-thinks an hour and 40 a day per reader, so
the worst day for one reader with 1,000 articles is about $1.20, and 3,000 a day across everyone.

## What it gives up, and the risks

- **The model invents the labels.** That reverses a rule the area was built on, and Greg's first
  ask on 2026-09-28: *"Ideally this would use code/algorithms that can run without an LLM, so that
  it's fast and cheap and can be re-run repeatably"*. With the model down, the row falls back to
  today's phrases, which now look like a different feature.
- **A new article waits to be sorted.** On a 50-article shelf, up to four articles sit in no topic
  until the fifth triggers a re-think, or the reader presses *Redo topics*.
- **A re-think can rename or regroup.** Runs agreed mostly, not wholly. Feeding the old labels back
  should hold them steady and is unmeasured.
- **Membership is the model's reading of a title and one sentence**, not a count of words in the
  text. An article can be filed wrongly and there is no phrase to point at. The judges scored
  membership 8.8 of 10 against today's 4.3.
- **Fewer pills.** A 13-article shelf gets 3 or 4. On one shelf a judge preferred today's
  *sourdough*, *kimchi* and *compost* to clustering's two broad pills. Question 2 is about this.
- **Every shelf in the eval was synthetic**, written by the same model family that judged them.
  Stage 0 exists for this.

## The simpler options passed over

- **A longer banned-word list.** It removes *principles* and still has no *productivity* to show.
- **Keep the phrases, and let the model only rename each one** (*writers* becomes *Writing*). The
  members stay whichever articles happen to contain the word *writers*, which is the wrong set.
- **Embedding clustering with model labels.** Cheaper per call, but more new parts (stored vectors,
  a clustering step, an overlap rule), and the version we built filed articles badly.

## The questions for Greg

**1. Try it on your own shelf first? (Stage 0)**

Everything measured so far is on shelves a model wrote. Your complaint is about your shelf, and this
session was not allowed to read production.

- **A. Yes (recommended).** The script is written. Run it once, with the production database URL
  in the shell as you do for `shelf-terms:report`:

  ```
  DATABASE_URL=<production> npm run shelf-topics:preview -- --owner <your owner uuid> --archived
  ```

  On the box the URL is in `.env.prod`, so from `/home/greg/code/spideryarn2` (GPT Sol's code review checked this against the file's form; it has not been run):

  ```
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.prod | tr -d '"')" \
    npm run shelf-topics:preview -- --owner <your owner uuid> --archived
  ```

  Read the `Target:` line first. It prints how many articles the shelf holds, then today's pills
  beside the proposed ones. Add `--members` to see up to five titles under each proposed topic;
  drop `--archived` for the active shelf alone. **It needs the owner uuid, the one you give
  `shelf-terms:report`**: the app's database role cannot read accounts
  ([admin.md](../project/admin.md)), so an email is refused cleanly with a line saying so. About a cent
  or less, and it writes nothing. If the proposed pills are not clearly better, we stop.
- **B. No, build stage 1 and judge it live.** Faster by a step, but the first real look comes after
  the work is done.

**2. Should the model's topics replace today's pills, or sit in front of them?**

The model gives a few broad topics. Today's method gives more, narrower ones.

- **A. Replace (recommended).** The row is the model's topics only: *Buddhism · AI · Writing ·
  Economics …*. Simplest, and it is what won. It costs you the narrow pills such as *predictive
  coding* or *sourdough*, though search finds those.
- **B. Broad first, then narrow.** The model's topics, then today's scored phrases after them under
  *All N topics*. Keeps the narrow ones, but it is two model calls instead of one, two kinds of pill
  in one row, and *principles* is back in the tail.
- **C. Leave the pills as they are.** Then the generic ones stay; a banned-word list is the only
  lever.

What decides it: whether you filter by narrow phrases today. If you mostly want the big buckets, A.

**3. When should a newly added article get its topics?**

This is the cost question. A re-think of the whole shelf is about three cents at a thousand
articles, so what matters is how often one happens.

- **A. At the next re-think: when the shelf has grown by a tenth, or when you press *Redo topics*
  (recommended).** About a thirtieth of a penny per article however big the shelf gets, one prompt,
  and the labels stay put in between. What you give up: on a 50-article shelf, up to four new
  articles sit in no topic for a while.
- **B. Straight away, with a small extra call per new article**, plus A's re-thinks. Another
  $0.00005 an article, so still far under a penny. Every article is sorted within seconds. It is a
  second prompt, its own spending limit, and care where it overlaps a re-think: perhaps half as much
  work again. Worth it only if waiting turns out to be annoying.
- **C. Re-think the whole shelf every time anything changes**, which is how today's scoring works.
  Least code, always current, but about 1.5¢ per article averaged over a thousand and 3¢ each by the
  end, and the labels can shift under you on every add. Not recommended.

Whichever you pick, shelves over 150 articles keep today's pills until stage 2 has measured a
bigger call. **How many articles are on your shelf, with archived included?** If it is already past
150, stage 2 moves up and stage 0 has to cope with it.

**Not asked, decided here**: GPT-6 Luna, because it is the model already on this job and the one
measured; no embeddings; the fallback is today's program list; the eight-work minimum stays; one
topic set per reader rather than one per scope.

## Reviews

**GPT Sol, review of the v1 code, 2026-10-03** —
[prompt](261003f-shelf-topics-named-by-a-model-v1-code-review-prompt.md),
[answer](261003f-shelf-topics-named-by-a-model-v1-code-review-sol.md). No P0. It fixed six P1s in
place, each with a test, and I read its diff and ran the gates:

1. A failed call in a parallel batch left the others running after the allowance was handed back;
   the pool now stops taking work and waits for what is in flight.
2. The drain of arrivals filed into the tree this request had written, though another request could
   have replaced it between the two claims; it now re-reads under its second claim.
3. **Paid work now waits until every article's text hash is stored**, active and archived. Without
   it, exact copies could be named as separate works and later inherit whichever copy's topics came
   first. The cost is that a shelf's first tree waits for the phrase program to finish reading it,
   which the row already shows as *Reading N more articles…*.
4. Several failure paths could leave a claim held; a failed release now tries the fenced failure
   path, and the route completes the claim and allowance even if sending the answer throws.
5. Keys were not unique in every collision; a qualified key now takes a suffix when it must.
6. An empty tree could have been written; `rethink` refuses it and the table's CHECK does too.

Two smaller ones: labels also lose Unicode format controls, and same-label topics order by key. One
left for a decision and not changed: the eval lets several intended categories match one topic,
which can flatter the category and filing scores; the results files say so. Sol's sandbox could not
reach Postgres, so I ran both Postgres files and the migration tests afterwards: green.

**Browser check, 2026-10-03** (a Sonnet subagent, Playwright, the server's answer replaced by a
made-up tree over the local shelf): the row broad first with `›` on finer pills, choosing
*Neuroscience* then *Vision*, a pressed pill not moving, both cards, More detail, *Sorting 3 new
articles into topics…*, and the URL rule with and without `refreshing`, at 1280 and 390 wide, light
and dark. All passed, no console errors. Not checked: a real re-think landing, because the shared
local database could not take the migration.

**GPT Sol, review of the v1 design, 2026-10-03** —
[prompt](261003f-shelf-topics-named-by-a-model-v1-plan-review-prompt.md),
[answer](261003f-shelf-topics-named-by-a-model-v1-plan-review-sol.md). Thirteen findings, read while
the build was under way and applied before anything was pushed:

1. *A 150-work sample cannot find a rare subject among thousands.* Accepted. **v1 is capped at 150
   works** and the large-shelf stage is queued.
2. *A large re-think can outlast the lease and the function.* Accepted; the same cap.
3. *A request that read an older row could claim and overwrite a newer one; arrivals during a
   re-think waited on the browser.* Fixed: everything is read again under the claim and decided
   again, and arrivals are filed in the same handler.
4. *A failed finer-topic call was stored as "no finer topics".* Fixed: tried twice, then the whole
   re-think fails.
5. *A shelf that shrinks below eight kept its tree; a large shrink never re-thought.* Fixed both.
6. *One count cannot tell new unplaced works from old.* **Not fixed**; recorded as the known gap
   above. Closing it means storing which works were unplaced, and the size trigger covers it late.
7. *A profile edit never refreshed the tree.* Fixed: the profile's hash is stored and compared.
8. *Dropping a duplicate name is wrong when two subjects share one.* Fixed: dropped only when a
   broader topic has the name; kept under the parent's key when a sibling subject does.
9. *The filing eval scored recall only and hid what it could not score.* Fixed: wrong placements,
   unmatched categories and unscored articles are reported. Variance and order effects are still
   unmeasured and listed as such.
10. *The answer carried the phrase program's counts.* Fixed: the model path reports its own, and no
    longer zeroes `pending`.
11. *The fuse counts jobs, and a job is now many calls.* Bounded by the cap for now; weighing it by
    cost is on the deferred item.
12. *The prose said filing comes first; the row gave no sign an article was waiting.* Corrected,
    and the row now says *Sorting N new articles into topics…*.
13. *Keys dropped non-ASCII labels and could cut a character.* Fixed for both. Two labels that
    differ only in punctuation (*C++*, *C#*) still share a key and are merged; left.

**GPT Sol, plan review, 2026-10-03** — [prompt](261003f-shelf-topics-named-by-a-model-plan-review-prompt.md),
[answer](261003f-shelf-topics-named-by-a-model-plan-review-sol.md). Thirteen findings; it recomputed
the judges' tally and got the same 6–0, 6–0, 4–2. All accepted except as noted:

1. *The clustering conclusion was too broad.* Reworded here and in the investigation: one pipeline
   lost on one run of six synthetic shelves, and the real-shelf trial decides. The judge's brief is
   now saved in the eval's README.
2. *"Matched all 12" was printed beside twelve pills, but the thirteenth topic is what made it 12.*
   Corrected: 11 from the first twelve, 12 from all thirteen.
3. *The cost table described an uncapped stage 1 that the plan does not propose, and "worst case
   under half a cent" was a mean.* The table is rebuilt around the proposed design and gives both
   runs' prices.
4. *The stage 2 total was not derived from the stage 2 design.* That design is gone (5); the new
   total is derived in the text.
5. *A simpler choice was missing: re-think at milestones and leave new articles unsorted until
   then.* **This became the proposal**, and per-article filing moved to an option in question 3.
6. *Feeding stored labels back made the freshness hash depend on its own answer.* Freshness is now
   the set of works seen, never a hash of the prompt.
7. *Exact copies, skipped articles and the phrase-list gate.* Lines are per distinct work, skipped
   articles are included, and the work-count gate is its own.
8. *The client does not work unchanged without phrase counts.* `count` optional, newest first, copy
   changed. The claim that the response keeps its shape is withdrawn.
9. *Storage constraint, old rows, comma in keys, keys dropped mid-refresh.* All four are now in
   stage 1.
10. *The filing test showed self-consistency, not soundness.* Said so, and filing is no longer
    relied on.
11. *Naming from the newest 150 is biased, and filing races a re-think.* Stage 2 samples a spread
    and does its sorting inside the claimed re-think.
12. *The security paragraph gave the outcome without the argument.* Replaced with the list of
    controls.
13. *Wording and numbers in the investigation.* Corrected there. One part not accepted as written:
    the whole-eval cost of "about four cents" does include the production-arm runs and the reruns,
    which the ledger printed at the time; the investigation now says which runs it counts.

Up: [plans.md](../project/plans.md)
