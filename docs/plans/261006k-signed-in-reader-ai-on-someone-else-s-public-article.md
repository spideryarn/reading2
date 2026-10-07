# Should a signed-in reader get AI on somebody else's public article?

Up: [plans.md](../project/plans.md) · the area is
[public-readable-sharing.md](../project/public-readable-sharing.md) and
[security-map.md](../project/security-map.md)

**Status: researched and written up for Greg, 2026-10-06. Nothing built.** Every version that
does what the report asks edits a listed security defence, and an unattended session does not edit
one. The questions are in [§ Questions for Greg](#questions-for-greg).

Greg's report, `spya-uc0asn` (an admin's; provenance proved against the production row,
`feedback-reporter.ts` exit 0), filed 2026-10-06 from a public article:

> I'm wondering if we should allow AI processing (e.g. search) if they are logged-in on a public article?
>
> Would that create extra complexity? If not, and if you think it's a good idea, proceed.
>
> — Greg, 2026-10-06

## The short answer

**Yes, it creates extra complexity, so nothing was built.** It is a good idea in the long run, and
there are two cheap first steps. Neither is the thing you asked for, but one gets a signed-in
reader to the same place and the other makes search useful to every visitor for nothing.

Why it is not small, in three sentences. Today the app has exactly two kinds of request: *the
owner's*, which may do everything, and *anyone's*, which may only read and can never spend. A
signed-in reader running a search on your article is a third kind (signed in, not the owner,
allowed to spend) and nothing in the server has a place for it. The result also has to live
somewhere that is neither your article nor the public page, and today every saved search belongs
to the article and is shown to every visitor.

## What happens today, checked in the code

- **A signed-in reader on somebody else's public article is treated exactly as a signed-out
  one.** The page asks the owner's route first, gets a 404, and falls back to the public route
  (`findArticle` in [`src/web/article/access.ts`](../../src/web/article/access.ts)). This was
  decided on purpose in [260827ai](260827ai-public-read-only-access.md): *keyed on "is this mine",
  not on "am I signed in"*.
- **What they can do:** read everything already made, including the owner's saved searches.
- **What they cannot do:** make a search of any kind. The search panel has no box for them at all,
  not even for **words**, the search that runs in the browser and costs nothing
  (`VisitorSearchBand` in
  [`SearchMode.tsx`](../../src/web/modes/search/SearchMode.tsx) passes `words: false`;
  [260904c](260904c-more-modes-on-a-shared-link.md) left it out of its v1 on purpose). If the
  owner saved no searches they read *"Whoever added this article hasn't searched it."* Nor can
  they use Chat, Learn or Referee, or start any mode that has not been built. On those they are
  told, for example: *"Chat is for whoever added this article — asking costs a model call, and a
  shared link spends nobody's money."* A signed-out visitor is also offered *Make a free account*.
  A signed-in one is offered nothing; the sentence is a dead end.
- **You said this before, twice.** *"to see all the already-generated AI output, but not to incur
  any new AI costs"* (260827ai), and on search: *"Only owner can create new searches. Everyone else
  can see the ones they have already created"* (260904c). The first plan recorded the later step
  too: *zero now, a small metered budget later*, and "later" meant after a spend limit exists
  ([260827ai § Stage 4](260827ai-public-read-only-access.md#stage-4-variants-and-a-taste-of-ai)).
- **On sharing with named people you leaned the same way as today's report:** *"Share with email
  addresses, and allow them to run AI processing, and track the costs to them"*
  ([261005e](261005e-share-an-article-with-some-people-a-private-link-first.md)). That plan put
  AI for a non-owner last, as its largest part.

## The three things you asked me to work out

### Who pays

**We do, and nobody's allowance is touched.** The allowance (three articles on a free account)
counts *new articles added*. It does not count model calls made afterwards: a search, a chat
message or a glossary lookup on an article already on a shelf is free to the reader and paid by
us. So a signed-in reader's search on your article would cost you nothing and cost them nothing.

What a search costs us
([search.md § A quick search starts the thorough one by itself](../project/search.md#a-quick-search-starts-the-thorough-one-by-itself),
from production, the 30 days to 2026-10-04): a quick search is **$0.0006 per model call** on
average, one search is several calls on a long article, and typing can start several searches. A
meaning search is **$0.06 per call**, about a hundred times more. Since 2026-10-04 a quick search
that settles starts one meaning search by itself, so "quick only" needs that switched off for a
non-owner. Chat and the other paid modes cost more again.

### What stops a script

**Today, for an owner on their own article: nothing but the allowance on adding articles.** There
is no limit on how many paid calls an account makes on an article it owns; the code says so in
plain words (the comment above the glossary `ask` route in `src/routes.ts`), and
[auth.md § What is not done](../project/auth.md#what-is-not-done) has listed *a spend limit* as
"the control that is actually missing" since August. Only a few calls have their own limiter (the
link summary: 30 new summaries an hour, two at once, 100 a day per person, 1,000 a day for
everybody; its own comment calls those numbers guesses).

So a script with a free account can already spend our money on its own three articles. What opening
public articles adds is not a new hole so much as **removing the one brake there is**: a free
account would get AI on every public article without ever using one of its three. Anything built
here needs its own limit per person and a daily ceiling for everybody, and should not wait on the
general spend limit to be safe.

### Which defences it would edit

[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
lists the files. Running AI in place for a non-owner touches at least:

| | |
|---|---|
| `src/routes.ts` | a new signed-in route that is not the owner's. Every paid route today is reached only by the owner |
| `src/store/public-slug.ts` / `public-access.ts`, or a new lookup beside them | "this article is public right now, and a signed-in person is asking", read on the server for every paid request. A third way in, with its own tests |
| `src/store/public-reader.ts` (only if results are saved) | saved searches are kept per article, and every finished one is shown to every visitor and to the owner. A non-owner's search stored there would be published to everybody. Both reads need a "whose is it" filter |
| the tests that guard those | `owner-isolation`, `public-imports`, `public-network-trace` (which asserts a visitor's page spends nothing) |

And outside that list: the cost record would name the spender and keep the article's slug, but
its link to the article would be empty (that link is found through the owner), so the per-article
cost figures would miss these calls. Also a new limiter (a new bucket in both the code's closed
list and the database's check), a third arm in each panel (owner, visitor, signed-in visitor), and
the promise made to an owner when they share, *"nothing a visitor does can spend a model call"*,
which would need rewording.

**No small version runs a model in place for a non-owner without editing a defence.** GPT Sol
looked for one in review and found none. The two small things that edit none are B and E below,
and neither is AI in place.

## The options

**A. Leave it as it is.** A signed-in reader reads what the owner made, saved searches included,
and cannot search. Costs nothing.

**B. "Add a private copy to your shelf" (small; not built, because it is a new offer on a public
page and that is yours to make).** Where a signed-in visitor is told *"Chat is for whoever added
this article"*, and in the search panel, add one line offering their own copy, linking to the
existing `/add/<the article's address>`.

```
  ┌ Chat ─────────────────────────────────────────────────┐
  │ Chat is for whoever added this article — asking costs  │
  │ a model call, and a shared link spends nobody's money. │
  │ [ Add a private copy to your shelf ]  uses one of your │
  │ articles, and takes a minute.                          │
  └────────────────────────────────────────────────────────┘
```

- **In use:** they press it, the article imports onto their shelf as their own private copy, and
  everything works because they own that copy.
- **The press is the commitment.** `/add/` starts the import the moment it opens, with no second
  step, so one press uses one of their articles. The button has to say so, as above.
- **When there is no button:** only on a public article (not one reached by a private link), and
  only when the public page carries the article's real address. It does not for an upload, or
  when the address has a query string or anything else our public-address rule refuses. We never
  build the link from a guessed address.
- **Costs:** about an afternoon. No defence is edited: the public page already carries the
  address, and `/add/` is the existing door with the existing allowance. The copy is private, so
  no new question of rights arises.
- **Who pays, what stops a script:** it uses one of the reader's own articles (three on a free
  account), which is the brake we already have.
- **Gives up:** it is a second copy, made from scratch. We pay for the import again ($0.03 to
  $0.39 in the
  [September measurement](../../evals/results/cost-per-article-2026-09-03.md), more for each
  mode), which is the repeat work public articles were meant to save. The copy does not carry the
  owner's glossary, searches or sketches. And it is not "search here, now": it is a minute's wait
  and a different page.

**C. Quick search only, in place, nothing saved (medium, a few sessions; edits defences).** A
signed-in reader types in the search box on your article and gets the one-second meaning search.
The result is shown and thrown away: no row is written, so there is no question of whose it is or
who sees it.

- **In use:** the search box works for them as it does for you, minus the saved list and minus
  the slower, more thorough meaning search.
- **Costs:** the new signed-in route and lookup (the first two rows of the table above), a limit
  per person and a daily ceiling for everybody, the cost record taught to link the article, a
  third arm in the search panel, and the sharing promise reworded. It does not need the "whose is
  it" storage work.
- **Who pays:** we do. A search is a few calls at $0.0006 each, so on the order of a cent for a
  typing session on a long article. The limits should count model calls, not button presses.
- **Gives up:** nothing saved means a reload loses the results, and the best search (meaning)
  stays the owner's. It is also the first paid call a non-owner can make, so it is the precedent.
- **What it must hold to** (for the plan that builds it): the server reads the article itself
  with the *public right now* condition in the same query, on every request, and trusts nothing
  the browser sends about it; a private link's key never opens this; the limit is taken before
  the model is called, for the signed-in person, with the ceiling for everybody behind it; the
  reader's words are never logged, saved, put on the owner's article or sent to other visitors;
  and a signed-out visitor still makes no paid request.

**D. The full thing: meaning search, Chat and the rest, kept privately for each reader (large).**
This is "one article, many readers", which
[260827ai § Stage 3](260827ai-public-read-only-access.md#stage-3-one-article-many-readers)
sketched: each reader's searches, chats and notes hang off *their* relationship to the article
rather than off the article. Every paid mode is opened one at a time. It is the same work as
[261005e stage 3 item 5](261005e-share-an-article-with-some-people-a-private-link-first.md#stage-3-share-with-named-email-addresses-what-it-would-take)
(AI for a sharee), and it should be one design for both, not two.

- **Costs:** a project in several stages. Searches, chats, comments and the Learn records are
  each keyed to the article alone, so each needs a migration. And a real spend limit comes first,
  one that counts money or tokens: a chat has no limit at all today.
- **Gives up:** nothing in the end; it is the destination. It is just far.

**E. Words search for visitors (small; not AI; not built).** Give every visitor the box for the
free, in-browser words search, and nothing else. No model, no server call, nothing saved.

- **In use:** a visitor types a word and sees where it appears in the piece, as you do in words
  mode.
- **Costs:** about an afternoon, in the browser only. It edits no file in the defences table, but
  the visitor's search panel having *no verbs* is what the security map names as the thing that
  stops a visitor spending, so it must keep that, and keep the test that a visitor's page makes no
  paid request.
- **Gives up:** it is not what you asked for. 260904c left it out as the simpler version; this
  would be taking it back up.

## Recommendation

**B and E now if you want something this week, then C, and D last.**

- B is honest about what it is: a way out of a dead-end sentence, using doors that exist.
- E makes the search panel useful to a visitor for nothing.
- C is the first real answer to your question. It and comments for private-link holders
  (261005e stage 2) both add a signed-in, not-the-owner route, so they can share conventions and
  tests, but the check itself differs (*public now*, against *a list of who has joined*), so
  neither has to wait for the other.
- D waits for a spend limit and for C to show whether anybody uses it.

My view on whether it is a good idea: **yes for C, eventually.** A signed-in reader who cannot ask
anything of a public article is seeing the least interesting half of the product, and a quick
search costs almost nothing. The caution is the allowance: if AI on public articles is free and
unlimited, a free account has little reason to add articles of its own. A daily number per person
answers that, and you may want that number to differ by plan.

## Questions for Greg

**Answered so far: B.**

> B yes probably it would be nice to be able to add a private copy to your own shelf (perhaps in
> Metadata)
>
> — Greg, 2026-10-06

Built as [261007m](261007m-a-private-copy-of-a-public-article-on-your-own-shelf.md) (queue item
`qi-jp2r4be8`): the offer is in the visitor's banner, which the Metadata page draws too, and in
the band a visitor meets on Chat, Search and the other owner's modes. **E, C and D, and question 2,
are not answered yet**, so they stay below as asked.

**1. Which of these, if any?**

- **A.** Leave it. A signed-in visitor reads what the owner made, and cannot search.
- **B.** A button, *Add a private copy to your shelf*, for a signed-in visitor. One press uses
  one of their articles and starts the import. About an afternoon, no defence edited.
- **E.** The free words search for every visitor. Not AI. About an afternoon.
- **C.** Quick search in place for a signed-in reader, nothing saved, with a daily limit. A few
  sessions, edits defences.
- **B and E now, then C.** *(recommended)*
- **D.** Go straight to the full design: private searches and chats for every reader.

What would decide it: if the point is that a signed-in reader should not hit a dead end, B does
that. If the point is that they should be able to *ask this article something without leaving it*,
only C or D does.

**2. If C: is a signed-in reader's quick search free with a daily limit, or does it draw on
their allowance?**

- **A. Free, with a daily limit per person and a ceiling for everybody**, both counted in model
  calls. *(recommended)* Simple. At $0.0006 a call, a ceiling of, say, 5,000 calls a day for
  everybody is $3 a day at the very worst. The allowance stays a count of articles added.
- **B. It counts against their allowance.** For example, the first search on a public article
  uses a fraction of an article, as a minimal paper uses a hundredth. Ties spending to the plan
  they pay for, but adds a third kind of row to the billing ledger, and somebody has to explain to
  a reader why searching another person's article used up some of theirs.

What would decide it: whether you see a search on a public article as a taste that brings people
in (A), or as part of what a plan buys (B).

**Not asked now:** who pays for D. Meaning search and Chat cost a hundred times more per call and
nothing limits them, so D's answer depends on the general spend limit, which does not exist yet.
That question belongs to D's own plan.

## Decided here, not asked

- **Nothing was built**, including B and E. Each is small and edits no file in the defences
  table, but neither is what the report asked for: B is a new offer on a public page that spends
  one of the reader's articles on a press, and E reopens a choice 260904c made.
- **A signed-out visitor still never spends.** No option here changes that, and none should until
  a spend limit exists (your own order in 260827ai).
- **An owner's saved searches stay visible to visitors**, as they are.
- **No option lets a non-owner's result appear on the owner's article or the public page.** C
  saves nothing; D keeps each reader's results their own.
- **If C is built, a quick search by a non-owner does not start the meaning search by itself.**

## References

- [260827ai](260827ai-public-read-only-access.md): the original design. Visitors keyed on
  ownership; stage 3 "one article, many readers"; stage 4 "a taste of AI".
- [260904c](260904c-more-modes-on-a-shared-link.md): saved searches shown to visitors; only the
  owner makes one; the words search left out.
- [261005e](261005e-share-an-article-with-some-people-a-private-link-first.md): the private link,
  and the signed-in read path its stage 2 needs.
- [billing.md § The quota](../project/billing.md#the-quota-and-the-one-thing-it-has-to-survive):
  what the allowance counts.
- [search.md](../project/search.md): the three searches and what each costs.
- The note: [261006_1425](../user-feedback/261006_1425-ai-for-a-signed-in-reader-on-a-public-article.md).

## Review

GPT Sol reviewed this plan read-only on 2026-10-06
([prompt](261006k-signed-in-reader-ai-on-someone-else-s-public-article-plan-review-prompt.md),
[findings](261006k-signed-in-reader-ai-on-someone-else-s-public-article-plan-review-sol.md)).
**Verdict: agree: no build, Awaiting Greg.** Eight findings, each checked against the code and all
taken:

| | Finding | What changed |
|---|---|---|
| 1 | P1. Question 2 priced option D with quick-search numbers, which do not bound it; and a quick search is priced per model call, not per search | Question 2 is now about C only, in model calls; D's payment is left to D's plan |
| 2 | P2. A visitor has no words search today, and no "Search is for whoever…" sentence; that hid a small option | "What happens today" corrected; option E added |
| 3 | P2. B's press spends an article at once; the public address is often absent; private-link articles share the visitor screen | B says so on the button, and says when there is no button |
| 4 | P2. The cost record keeps the slug; it is the link to the article that is empty | Reworded |
| 5 | P2. C and private-link comments do not share one check | The "build once, use twice" argument removed |
| 6 | P2. C and D need a stated security contract | Added under C |
| 7 | P2. Question 2 was not answerable as written | Rewritten with 1 |
| 8 | P3. The limiter numbers count new summaries and are guesses; the ingest cost range was unsupported; D is several stages | Corrected |
