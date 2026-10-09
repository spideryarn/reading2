# Marketing and awareness

How people come to hear about Spideryarn: the ideas, the experiments, and what has been decided.
Started 2026-10-09 and still being worked out with Greg. It is a list of things to try, not a plan
yet.

Up: [vision.md](vision.md)

**What we are promising, and the rules the copy follows, are not here.** The promise (read deeply
and efficiently) is [vision.md § Deeply and efficiently](vision.md#deeply-and-efficiently). What the
website says, who it speaks to and whose words it uses is [positioning.md](positioning.md). Nothing
here may break [vision.md § Anti-goals](vision.md#anti-goals). A channel that only works by
promising "read this in 2 minutes" is not one we use.

## What we start with

> Initially my goal is just to tell one person every day, but that's probably not going to get me
> very far. So maybe I need to speak at conferences.
>
> — Greg, 2026-10-09

- **No budget.** Paid ads and sponsorships are out. Time is what we have to spend.
- **Greg is a good presenter**, so talks, demos and recorded walkthroughs play to a strength.
- **Greg knows a few academics from grad school**, about fifteen years ago. These are warm
  contacts, not cold ones. Mostly computational psychology and neuroscience and nearby fields, with a
  few in social psychology, biology, computer science and classics. Their fields decide which papers
  to make the first private links from.
- **A live product with paying readers** (since 2026-09-03), a public shelf at `/read/public`, and
  private links for single articles ([public-shelf.md](public-shelf.md),
  [public-readable-sharing.md](public-readable-sharing.md)).

## What success means right now

> Right now, success would be a single person who is voluntarily choosing to use Spideryarn other
> than me.
>
> — Greg, 2026-10-09

One person, using it because they want to, not because they were asked. Judge every idea below by
whether it gets us closer to that person. Raise the bar once we have one.

## Who first

**Academics and researchers first. Long-form writers come second, as an experiment.** Greg,
2026-10-09:

> Probably academics and researchers because they're the ones who are professionally reading and
> maybe might have money if it makes them more efficient at their jobs. But long form writers are
> interesting. I suppose the issue is they have their own platform where they want people to read,
> so it's unlikely, I think, that they're going to want people to read it on Spideryarn. At this
> point I don't know, so we should run experiments.

This narrows who we go out and find. It does not change who the homepage speaks to, which stays
the general deep reader ([positioning.md § Who the homepage speaks to first](positioning.md#who-the-homepage-speaks-to-first)).

## Ideas

Each idea has a status: **idea** (not started), **trying** (running now) or **done** (with what we
learned).

### Tell one person a day — *idea*

Greg's starting point. It is slow, but every conversation can also count as a user interview. It
works better if each one ends with something to try: a private link to an article that person
would actually read.

### First experiment: five old contacts, their own papers — *trying, from 2026-10-09*

Greg sends five grad-school contacts a private link to their own most recent paper in Spideryarn,
with a short personal note asking what it gets wrong, and calls them where he can. They are warm,
they will answer honestly, and they are the best judges of whether it got their argument right.
Each reply is a user interview, and it tests the author-gift idea below on friendly ground first.
Greg, 2026-10-09: *"That's a good idea for the first experiment. I might try and actually talk to
them on the phone at the same time."*

### Talks — *idea*

Greg presents well. A talk about ideas, with the product as the example, is easier to get invited
to; a straight demo suits a room that has already asked. Either is fine (Greg, 2026-10-09: *"Whatever
works"*). Which rooms to aim for:

> I was imagining more like a kind of product conference rather than an academic conference. Though
> an academic conference might be interesting, but … they're usually interested in their particular
> domain rather than mine. I suppose I could find one that's about AI or HCI or human augmentation
> via AI that would be ideal.
>
> — Greg, 2026-10-09

So: product conferences first, plus academic venues on AI, HCI or human augmentation, where the
subject itself is the domain. A recording of any talk can be reused afterwards.

### Make a Spideryarn version of an author's piece and give it to them — *idea, to run as an experiment*

> I was hoping is I would start to create public articles or at least private links for articles,
> perhaps for somewhat famous authors and bloggers who might be flattered or think that Spideryarn
> actually is a better presentation that will help readers understand their stuff. … It's just a
> hypothesis. Perhaps they'll resent it. I think our SEO stance probably might reassure them.
> Obviously we want to be ethical, so if they don't want it, we'll take it down. Maybe that's why I
> thought the private links was a more careful way to proceed.
>
> — Greg, 2026-10-09

- **Send a private link and ask first.** "I made this of your essay; only you have the link; would
  you like it public?" reads as a gift. Finding your essay already republished does not.
- **What is already true reassures the author.** A shared article is `noindex` and points back to
  the original page, and there is a takedown promise.
  [public-readable-sharing.md](public-readable-sharing.md) is the single home for those claims.
  Quote it rather than restating it.
- **The risk is accuracy.** The author is the one reader certain to notice if the AI gets their
  argument slightly wrong. Greg reads each page before sending it.
- **Greg's doubt is the thing to test:** writers want readers on their own platform. A cheap first
  test is ten academics and ten bloggers, private links only, counting replies and how warm they
  are.

**A tool to make this cheap (a feature idea, not built).** Greg, 2026-10-09:

> For admins in the add page when the article is being imported, perhaps we could add a button or
> something that says this is potentially going to be for marketing to the author, and then that
> would automatically switch on the higher capability AI processing and make a private link and
> perhaps do a web search to try and figure out who the author is and see if we can find an email
> address for them.
>
> And if so, can we create a draft gift voucher? … So it would create a gift voucher that's ready
> and populated but hasn't been sent. … And so then it would be easy for me to then say, okay,
> great, I'm gonna click send on the gift voucher. Perhaps draft a separate email from myself.
> There's already a private link populated in the gift voucher.

Most of the parts already exist: High-powered AI for one article
([high-powered-ai.md](high-powered-ai.md)), private links
([public-readable-sharing.md § A private link](public-readable-sharing.md#a-private-link-the-same-republishing-to-fewer-people)),
and gift vouchers that can carry a starter article by private link
([billing.md § Gift vouchers](billing.md#gift-vouchers-extra-free-articles-given-by-email)).
What is new is a voucher that is saved but not yet sent, the author-and-address lookup, and one
button that does all of it. It needs a plan under `docs/plans/` before it is built. Greg asked on
2026-10-09 for it to be built now, handed to the Overseer rather than built by hand first.

## Waiting on

- **The research Greg started on 2026-10-09** from a feedback report. Some of the ideas above may
  change when its write-ups land under `docs/research/`.
- **Evidence pages.** [positioning.md § Evidence, and where it goes](positioning.md#evidence-and-where-it-goes)
  puts the research behind the product (AI summaries hurt skilled readers most; Learn rests on
  learning-and-memory research) into blog posts or pages "eventually". These are also marketing,
  especially for academics.
