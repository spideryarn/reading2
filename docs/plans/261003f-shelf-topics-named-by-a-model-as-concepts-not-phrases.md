# 261003f — Shelf topics named by a model, as concepts rather than phrases

**Status: not built. Waiting on Greg** — [§ The questions for Greg](#the-questions-for-greg).

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
