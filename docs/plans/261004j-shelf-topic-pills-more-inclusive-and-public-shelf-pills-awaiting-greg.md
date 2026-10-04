# Shelf topic pills: take in more articles; and pills on the public shelf (a question for Greg)

Up: [plans.md](../project/plans.md) · the feature is [shelf-terms.md](../project/shelf-terms.md)

**Status: Part 1 built, 2026-10-04. Part 2 is written up for Greg and not built.**

Two reports from Greg, both about the topic pills above the shelf, filed 2026-10-04.

> The new topic pills are great. The only thing is they seem slightly too tight. So, for example, I
> think there was a topic pill on learning and memory or something, and it didn't include the Levin
> article about self-improving something something. You can look in my production database to see
> what I mean. I wonder, I think it's better if these topic pills are quite inclusive, sort of err on
> the side of inclusiveness, because you can always use a tabula to focus it down. Whereas if one is
> too tightly bound, then there's a risk that it'll exclude stuff that actually I think should have
> been included.
>
> — Greg, 2026-10-04, report `spya-d4tp0y`

> Show the topic-pills on the page for filtering public/shared articles as well.
>
> — Greg, 2026-10-04, report `spya-mdp0em`

"tabula" is probably a dictation slip. I read the sentence as *"you can always choose a second pill
to focus it down"*, which is how the row already works, and built nothing for the word.

## Part 1: the pills take in too few articles (`spya-d4tp0y`)

### What is actually wrong, measured

I read Greg's stored tree in production, read-only
(`npx tsx evals/shelf-topic-clusters/stored-tree.ts --report spya-d4tp0y --find self-improvis`).
45 articles, 15 topics:

```
AI & Computing (23)
    Neural Representations (5)   AI Trust & Safety (5)   Memory & Learning (5)
    Machine Cognition (6)        Consciousness & Minds (3)
Neuroscience (9)
Cognitive Science (13)
    Language Models & Minds (5)  Memory & Self (3)   Learning & Control (4)   Cognitive Architecture (4)
Philosophy (8)     Buddhism (4)     Society & Culture (4)
```

The article is Levin's *Self-Improvising Memory: A Perspective on Memories as Agential…*. It is in
*Cognitive Science*, and inside that in *Memory & Self*. It is **not** in *Memory & Learning*.

**The cause is the shape of the tree more than the wording of the prompt.** A finer topic is made
by a call that is shown only the articles already inside its parent. *Memory & Learning* was made
inside *AI & Computing*, from AI & Computing's 23 articles. Levin's paper was not one of them, so no
answer the model could have given would have put it there. But the pill itself just says *Memory &
Learning*, and Greg reasonably expects every article about memory to be under it.

```
   how it is built today                       what the reader sees
   ─────────────────────                       ────────────────────
   AI & Computing ── its 23 articles ──► call ──► "Memory & Learning"   a pill that looks like
   Cognitive Science ── its 13 ───────► call ──► "Memory & Self"        it covers the whole shelf
        (Levin is only in here)                                         but only ever saw 23
```

There is a second, smaller cause. Both prompts ask for articles that are *"substantially about"* a
topic, and the filing prompt adds *"do not force a fit"*. That wording leans towards leaving an
article out, which is the opposite of what Greg asks for.

Two re-thinks of his shelf on today's code (the control, `replay-shelf.ts`): the average article is
in 1.76 and 1.80 topics, and 4 and 6 articles are in none. The second run rebuilt the same fault: a
*Memory & Learning* inside *AI*, without Levin.

### What was built

This section was rewritten after GPT Sol's plan review and after measuring; what changed and why
is in [§ What the review and the measurements changed](#what-the-review-and-the-measurements-changed).

1. **A widening pass at the end of every re-think.** Once the tree is built, every article is shown
   every topic, broad and fine, as **one flat list**, and asked which it belongs in. This is the
   filing call that already exists for new arrivals (`fileWorks`). What it says is **added** to what
   the naming calls said; nothing is taken away. So a finer topic can gain an article from outside
   its parent.
   - **The article does not join the parent as well.** Levin's paper joins *Memory & Learning* and
     not *AI & Computing*. A pill means its own name across the whole shelf. Choosing *AI* and then
     *Memory & Learning* still narrows to the articles in both. The one exception: an article under
     no broad topic at all that lands in a finer one takes that topic's parents, so it is never
     missing from every broad pill.
   - **It may not make a finer pill that narrows nothing**: if it would put nine tenths of a
     parent's articles in one finer topic, that topic keeps only what naming gave it.
   - Skipped when the tree has no finer topics: the one top-level call already saw every article
     beside every topic.
   - A batch that fails is tried once more; if it fails again the whole re-think fails, as a failed
     naming call already does. Storing the narrow tree as if it were finished would look complete.
     It also fails rather than start a call that could outlive the ten-minute claim.
   - Cost: one call per 40 articles, about $0.00005 an article. At most 4 extra calls at the
     150-article cap.
2. **Both prompts lean towards including, with a boundary.** An article belongs in a topic it
   discusses, gives evidence about or makes a claim about, even when that is not its main subject;
   not for a passing mention, an analogy, general background, or merely sharing a broad field;
   borderline with something of substance, include it. The filing prompt loses *"do not force a
   fit"*. Naming is told not to pad a topic to reach its minimum.
3. **New arrivals are filed by the same rules** (the flat list, and no parent unless the article
   would have no broad topic).
4. **`TOPIC_SET_PROMPT_VERSION` goes to 2**, so every reader's tree is re-thought the next time they
   open their shelf (at most about two cents each; the previous labels are shown so pills keep their
   names where they still fit).

**The simpler option passed over: change only the wording.** It cannot reliably fix Greg's own
example, because the call that made *Memory & Learning* never saw the article. (It could by luck,
if the top call happened to put the paper under AI too.)

**The more thorough option passed over: merge look-alike finer topics across parents** (*Memory &
Learning* in AI, *Memory & Self* in Cognitive Science). That changes what the tree is, needs a way to
show one pill under two parents, and is not needed for the complaint.

**The trade-off Greg is choosing, named:** more inclusive pills are less sharp. A pill will hold
articles that only touch its subject. That is what he asked for, and the measure below is there to
catch it going too far (every pill holding half the shelf).

### What the review and the measurements changed

GPT Sol's plan review (`261004j-shelf-topic-pills-plan-review-sol.md`): no P0, five P1. All taken.

| Finding | What was done |
|---|---|
| The pass can swell a finer topic to nearly all of its parent, after the check that prevents that has run | The check runs again after the pass; a topic that fails it keeps only what naming gave it. Memberships are a set, so nothing is counted twice. Tests for both. |
| The eval's "wrong placement" forgives any topic inside a right broad one, so "every article in every finer topic" would pass | `hier.ts` now also prints the share of an article's **specific** placements that are an intended topic, with nothing forgiven, and the largest finer topic as a share of its parent. |
| "When unsure, include" with no boundary invites everything everywhere | Sol's wording adopted: what counts, three things that do not, then "borderline with substance: in". And "do not pad a topic". |
| The extra calls are not bounded by the ten-minute claim | The pass starts no call that could still be running when the claim ends, and fails the re-think instead (`RethinkOptions.deadline`). The naming calls before it still have no whole-job limit; that predates this and is noted in the code. |
| Part 2 option A named the wrong allowlist file and an impossible trigger | Corrected below. |

Then the measurements changed the design twice more (all in the investigation):

1. **Drawn as an indented tree, the pass did not fix Greg's example.** On his stored tree the model
   read *Memory & Learning* under *AI* as "memory, in AI" and added nothing to it, twice in two
   runs, even with a sentence telling it to judge a topic by its own name. Shown **one flat list**,
   it added the paper twice in two.
2. **Adding the parent as well swamped the broad pills.** With the flat list and the old rule (an
   article in a finer topic is in the topics above it), *AI & Computing* went from 23 of 45 articles
   to 36 and 34. So an article added to a finer topic from outside no longer joins the parent:
   23 to 26. This drops a rule the first plan called load-bearing. The row does not depend on it:
   the client uses the tree only for order and indent, and every count is an intersection
   (`src/web/shelf-narrow.ts`).

### GPT Sol's code review

`261004j-shelf-topic-pills-code-review-sol.md`: no P0; verdict *ship with the fixes I made*. It found
nothing else that relied on a finer topic's articles all being in its parent. It fixed, and I read
and kept:

- The pass's deadline was counted from when the work started, not from when the claim was taken.
  Now from the claim.
- With a flat list, two finer topics of one name under different parents (*Methods* in two
  subjects) could not be told apart. When a name repeats, the prompt now says to list every id
  with it. **This sentence was added after the measurements and is not itself measured.**
- Two hover cards still implied a finer pill's articles are all inside the broader one. They now
  say a finer topic can take matching articles from outside it. This is reader-facing wording,
  changed by the reviewer: Greg may want to reword it.
- A test for a depth-2 topic named beside a broad topic that is not its ancestor.

Not fixed, and known: **a shelf over 150 works is not re-thought**, so it keeps its version 1 tree
and memberships; only its new arrivals are filed by the new rules. That is the existing cap
([shelf-terms.md § The 150-work cap](../project/shelf-terms.md#the-150-work-cap)), already queued.

On the conclusion, Sol's words are the fair summary: this is *"a substantial, measured loss of
sharpness that matches Greg's stated preference"*, not a free improvement.

### How it is measured

Per [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change):
production's own `rethink`, arms separated in time (before on the commit before, after on the commit
with it), the old prompt run twice as the control.

- **Greg's real shelf**, replayed (`replay-shelf.ts`): topics per article, articles in no topic,
  each topic's size, and where the Levin paper lands. Before: 1.76 and 1.80; 4 and 6 in none.
  Looking for: clearly more than the control's spread; fewer in none; Levin in the memory topic(s);
  no finer pill swollen to most of its parent.
- **The two synthetic shelves that know what each article was written about** (`hier.ts`,
  `greg-wide` and `expert-150`): the share of an article's intended topics it is in (should rise or
  hold), and the share of its placements that are wrong (the cost; it will rise, and the write-up
  says by how much).

Written up in `docs/investigations/261004d-shelf-topics-inclusive-filing.md`. Greg's titles are not
committed, only counts and the one article he named, which is on the public shelf.

### Tests

- Red first: a `rethink` whose naming calls put an article under one broad topic only, and whose
  filing call says it also belongs in another broad topic's finer topic. Before, it was absent from
  that finer topic (watched failing); after, it is in it, and not in that topic's parent.
- The widening only adds: an article the naming call placed stays placed when filing omits it.
- A filing batch that fails twice fails the re-think; one that fails once does not.
- No filing call when the tree has no finer topics.
- The existing prompt tests updated for the new wording.

### Stages

1. The code, tests and docs (`shelf-terms.md`), then the after arm of the eval and the investigation.
2. GPT Sol code review, gates, push to `dev`.

## Part 2: pills on the public shelf (`spya-mdp0em`). Not built; a question for Greg

### Why it stopped

I take "the page for filtering public/shared articles" to be `/read/public`, the page that lists
every article anyone has shared, for anyone, signed in or not ([public-shelf.md](../project/public-shelf.md)).

Two facts decide it:

- **Every way of showing pills there edits a listed security defence.** The page, the query behind
  it and the list of fields a stranger may receive are all in
  [security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live),
  and an unattended run does not edit a defence. Even a version computed entirely in the browser has
  to change `PublicLibraryPage.tsx`.
- **The public shelf holds 6 articles today** (read from the public listing itself). The pills need
  8 different articles before they appear at all, on anyone's shelf. So the version that reuses the
  rule as it stands would show nothing yet.

### Background, in plain words

Your own pills are made by a model that reads the titles and one-sentence summaries of *your*
articles, plus your profile, and the cost lands on your account. The result is stored once per
reader. The public shelf has no reader: a stranger opens it with no account, and a stranger's visit
must never spend money or read anything owner-scoped. So "the same pills" needs three things the
public shelf does not have: somewhere to store a tree that belongs to nobody, somebody whose action
pays for it, and a new piece of data the anonymous page is allowed to receive.

### The options

**A. A model-named tree for the public shelf, made when the shelf changes (recommended, when the
shelf is big enough to need it).**

```
  an owner shares or un-shares an article  ──►  that same request re-thinks the public tree
                                                (≈ half a cent, on the account of the owner whose
                                                action changed the shelf)
  a stranger opens /read/public            ──►  receives the stored labels and which cards
                                                are in each; nothing is computed, nothing spent.
                                                The page still makes its one anonymous request,
                                                signed in or not.
```

- In use: the same row of pills as your shelf, broad to fine, over the public articles. Same look,
  same narrowing.
- Costs: a new stored row (a schema change); the labels and memberships added to what a stranger
  receives (edits to `src/store/public-library.ts`, whose projection is the listing's allowlist, to
  the `PublicLibrary` type, and to the page: listed defences, each with its test updated); public titles and summaries sent to OpenAI with no reader's profile
  (they are already sent for the owner's own pills, so [privacy.md](../project/privacy.md) needs one
  clause, not a new promise). About a day.
- Gives up: nothing in quality. It does not appear until there are 8 public articles, unless the
  minimum is lowered for this page.

**B. Phrase pills worked out in the browser from the titles and summaries the page already has.**

- In use: pills that are words the cards literally use (*memory*, *agents*), with no model.
- Costs: one defence file (the page), no server change, no spend, about an afternoon.
- Gives up: quality. These are the phrase pills you called not "meaningful/relevant" on 2026-09-29
  and replaced, made from far less text (a title and a sentence, not the article). With 6 cards they
  would be close to noise.

**C. Nothing until the public shelf is bigger.** Six cards fit on one screen and do not need
filtering. Revisit at, say, 20.

**D. Is it the other place?** Your own shelf's **Include public** section lists the same public
articles under your own, narrowed by the search box but not by the pills. If that is the page you
meant, the answer is different and smaller: your own tree could be asked to file the public
articles too. No anonymous request would spend anything and no listed defence would be touched
(the titles being sorted are still strangers' text, as your own articles' are). Say so and it gets
its own plan.

### What would make you pick one

- You want it to look and work like your shelf, and are happy for it to wait for 8+ public
  articles: **A**.
- You want something visible this week and can live with weak pills: **B** (I would not).
- You were thinking ahead to a bigger public shelf rather than today's six: **C**, and A when it
  grows.
- You meant the public section of your own shelf: **D**.

My recommendation: **C now, A when the public shelf passes about 20 articles**, unless you meant D.

### Bookkeeping

Queue entry `qi-8a52pdxh` (with `spya-mdp0em` in its source), a line in
[awaiting-approval.md](../user-feedback/awaiting-approval.md), and
[its note](../user-feedback/261004_1000-topic-pills-on-the-public-shelf.md).

## Questions and assumptions (nobody is in the chat to ask)

- Assumed "tabula" means choosing a second pill. If Greg meant a different control, Part 1 still
  stands.
- Assumed re-thinking every reader's tree once (prompt version 2) is fine: it is what a prompt
  change has always done here, and costs cents in total.
