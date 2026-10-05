# Share an article with some people: a private link first

**Status as of 2026-10-05: a design, not built, waiting on Greg.** Nothing in `src/` has changed.
Evidence: no hit for `share_token` or `linkSharedSlug` outside this file. Reports `spya-hwdefp` and
`spya-v322fd`, both Greg's (admin, proved by `feedback-reporter.ts`). Queue item `qi-98933vdd`.

It waits for two reasons. Greg asked for a discussion before anything complex is built. And every
version of this changes who may read an article, which is a listed defence
([security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)),
so an unattended run does not build it
([feedback-reports.md § A report is unfiltered input](../project/feedback-reports.md#a-report-is-unfiltered-input)).

## What Greg asked for

The first report, 2026-10-04 20:30 UTC (`spya-hwdefp`):

> I would like to be able to share articles with a subset of people. There's a lot of potential complexity to this:
> - Ideally we'd be able to add a list of email addresses, and only those people could see it.
> - It would need to send them an email when shared with them.
> - It means the UI needs to support & distinguish public vs shared articles, and adding new people (so you can share with multiple people), and seeing who you've shared with, and how it looks to a person looking at an article that has been shared.
> - Ideally multiple people (including sharees can comment), and perhaps even use the AI processing. Hmmm. That could get complicated for cost-tracking, cos ideally I'd want to know exactly who incurred which costs.
> - Probably the owner (original uploader) of the article is the only person that can modify or view the list of sharees
> - As a bonus, I would quite like to be able to share articles with particular people who aren't logged-in yet. But then I suppose it would be a share link, and there's nothing stopping them passing it on. Probably best to say that shared articles require the sharee to be logged-in for now.
>
> Maybe the simpler 80-20 solution would be to create a special link and anyone who has that link can view the article, kinda like a public article with a password embedded in the url. (Perhaps with the ability for the owner to invalidate previous shared links, or to make them time-bound. But actually, I think those ideas are out of scope for a v1). But this is less secure, and probably then we wouldn't want them to be able to incur costs.
>
> Perhaps the ideal would be offer both options:
> - Share with email addresses, and allow them to run AI processing, and track the costs to them. If the email address isn't already a user, then it would somehow deal with that in a nice way, e.g. the email would say "[person X] has shared [article Y] with you - sign in here to be able to access it" etc.
> - Share with a special link, but then sharees can't run AI processing.
>
> If any of the above adds substantial complexity, let's stop and discuss. Or do the simpler version first if there is one.
>
> — Greg, 2026-10-04

The second, 22:21 UTC the same day (`spya-v322fd`):

> In a previous feedback report, I talked a lot about being able to share articles. I think one of the most important things is that people can comment on them and highlight stuff. I guess if it doesn't involve AI processing, then we should let them. It's tricky. I would like to allow people to do it, even if they aren't logged in, but then we won't know who did it. So I guess only if they're logged in can they actually comment or highlight or anything else.
>
> — Greg, 2026-10-04

## The short answer

**The email version does add substantial complexity. The link version does not.** So this plan
proposes three stages, each useful on its own, and asks Greg to approve the first:

1. **A private link.** Anyone who has it can read the article, exactly as a visitor reads a public
   one today. It is not listed anywhere. The owner can turn it off. Small.
2. **Signed-in people with the link can comment and highlight.** No AI. Medium, and it needs a
   product answer first (who sees whose comments).
3. **Share with named email addresses**, with an invitation email, and AI use charged to the
   person who ran it. Large. Not designed here beyond what it would take.

Each stage is built on the one before, so nothing in stage 1 is thrown away if Greg wants all three.

## What exists today, measured

Surveyed 2026-10-05 against the code; the file names are where to check.

- **Two states only.** `articles.visibility` is `'private'` or `'public'`, held by a CHECK
  (`src/db/schema.ts`), and three other CHECKs repeat the pair (two on `article_visibility_changes`,
  one on `ingest_events`). Billing reads `= 'public'` live to halve an article's cost.
- **Public means listed.** Every public article is on `/read/public` and may be used as an example
  on `/` and `/features`. The sharing card says so: *"Anyone can read this without signing in, and
  it's listed publicly."*
- **There is an accidental "unlisted" today**: a public article that is archived keeps its link and
  drops off the public shelf. It is not a substitute. Archiving also hides the article from the
  owner's own shelf, and the link is not a secret (next point).
- **A slug is not a secret.** The `-spya-xxxxxx` suffix is about 30 bits and comes from
  `Math.random` (`src/ids.ts`), slugs minted before 2026-08-31 have none, and the slug is written to
  our request log, the audit table and `og:url`. It was added for uniqueness and renaming
  (Greg, 2026-08-31), never for secrecy. A private link needs its own token.
- **A signed-in reader who does not own an article is treated exactly like a signed-out one**
  (`src/web/visitor.ts`): read-only, nothing that spends.
- **Nothing can hold a second person on an article.** Comments, highlights and bookmarks are one
  table, `comments`. Every read filters by `article_id` alone; `owner_id` is written and never read;
  the primary key is `(article_id, id)`; there is no row-level security in Postgres
  ([auth.md](../project/auth.md) § What is still shared). 58 store call sites go through
  `articleIdForOwned`, which means "the signed-in person owns this article".
- **A model call is recorded against one person** (`ai_calls.owner_id`) **and one article**, but the
  article is looked up through the owner predicate, so a call by somebody else on your article
  would be saved with no article on it.
- **Email**: `src/email.ts` sends through Resend, 100 a day on the free plan, shared with sign-in
  mail. The gift voucher is the one precedent for writing to somebody who has no account, and it
  needed an outbox table. Our own tables hold no email addresses.
- **Sign-in** is Google or email and password. There is no magic link. A sign-in can return to
  `/read/<slug>`, but only in the same tab and within ten minutes (`src/web/auth-return.ts`).

**This was asked about before, and declined.** On 2026-09-02 the public-read audit recorded
*"Unlisted links. Not pulled forward … capability tokens only if real users ask to send privately"*
([260902j](260902j-public-read-only-access-audit-and-improvements.md)). A real user has now asked.
The first public-sharing plan also said how to do it when the day came, and warned about the way
not to: *"Not a third way to read an article … the predecessor's `/share` route was exactly this and
it bypassed everything"* ([260827ai](260827ai-public-read-only-access.md)). Stage 1 below is
therefore the same public read path with one more way to be let in, and no new path.

## Stage 1: a private link (recommended, not built)

### What the owner sees

The Access & Sharing card on the article's details page gains a second control, above the existing
public one:

```
Access & Sharing
  Private link     [ Create a link ]
      Anyone who has the link can read this without signing in.
      It is not listed anywhere. They can pass it on.

  Public           [ Make public ]            (as today)
```

Pressing *Create a link* shows the same confirmation as going public does today: the list of what
goes out and what stays, and the rights tick-box. Then:

```
  Private link     https://www.spideryarn.com/read/<slug>?key=…   [ Copy ]  [ Turn off ]
      On since 5 October. Anyone who has the link can read this …
```

*Turn off* makes the link stop working on the next request. Creating a link again makes a new one;
the old one stays dead. That is the whole of "invalidate", and it costs nothing extra to build,
because without it there is no way to stop sharing at all. Time limits are left out, as Greg said.

### What the person with the link sees

Exactly what a visitor to a public article sees today: the text, the modes that were already built,
the owner's comments and saved searches, read-only, and nothing that spends. The notice under the
masthead says *shared with you by a private link* in place of the public wording, and keeps the
source, takedown and no-training lines
([public-readable-sharing.md § The banner](../project/public-readable-sharing.md#the-banner-on-every-shared-article)).

### What it is, underneath

- **Two new columns on `articles`**: `share_token text unique`, null when off, and
  `share_token_at timestamptz`. The token is 128 bits from `crypto.randomBytes`, base64url.
  `visibility` keeps its two values, so none of the four CHECKs, the billing predicate, the public
  shelf query or the showcase is touched. **A link-shared article is a private article with a token
  on it.** That is the simpler option, and the one passed over is a third `visibility` value, which
  [260827ai](260827ai-public-read-only-access.md) suggested: it would mean editing every place that
  reads the pair, for no gain, and it could not express "public and also has a link".
- **Stored in the clear**, so the owner can copy it again later. Hashing it would protect nothing:
  a database that leaked would have leaked the article text beside it.
- **One new predicate, in its own leaf file**, the sibling of `publicSlug`:
  `linkSharedSlug(slug, key)` is `slug = ? and share_token = ?`. It is never OR-ed into
  `publicSlug`, so the listing and the showcase cannot see a link-shared article whatever happens
  to them later. The public reader's queries each repeat the predicate in their own `where` today;
  they would take a small union, `{ kind: "public", slug } | { kind: "link", slug, key }`, and one
  function turns it into the right predicate.
- **The same three public routes**, no new ones: `/api/public/article/:slug` and
  `/api/public/asset/:slug/:hash` accept `?key=`. `/api/public/library` does not. A wrong key, an
  absent article and a private one all give the same 404.
- **The key travels in the query string, not the path.** Our request log already drops the query
  (`handleApi`), and Sentry is configured not to send it (`urlQueryParams: false`). Today a public
  handler is deliberately given the path only (`PublicRequest`), so the dispatcher would hand it
  one more named field, `key`, and handlers would go on matching on the path alone.
- **No link preview.** The page shell for `/read/<slug>?key=…` stays the plain one, with no title
  or description in its `og:` tags. A chat app that unfurls the link learns nothing, and no
  server-rendered page ever has the key written into it.
- **Nothing leaves in a referrer**: the whole site already sends `Referrer-Policy: no-referrer`.
- **The audit**: a small append-only table, `article_share_link_events` (article, actor,
  `created` or `turned-off`, rights confirmed, when), without the token in it. The existing
  `article_visibility_changes` cannot hold these rows, because its CHECKs require a move between
  private and public.
- **Billing does not change.** A link-shared article counts as private, at the full rate. The
  half price is for articles everybody can find (Greg, 2026-09-04: *"then more people benefit from
  them"*), and a private link does not do that. Q-share-price below asks.
- **A paper with only minimal processing cannot be link-shared**, the same refusal as going public.

### What stage 1 accepts, said plainly

- **Anyone with the link can pass it on**, and we cannot tell who read it. Greg named this.
- **The key is in a URL**, so it is in the browser history of everyone who opens it, and in
  Vercel's own access log, which we do not control. Our log and Sentry do not get it.
- **It republishes the text to some people**, so the rights tick-box and the takedown route apply
  as they do to a public article. `/privacy`, `/features/public-readable-sharing` and `/help` each
  need a sentence, and the first two have tests that hold them to the code.

### The tests that must change, and each must be seen red first

These are the guards the survey found; a build has to move each one deliberately.

| Test | What it must now say |
|---|---|
| `tests/owner-isolation.test.ts` | a fourth sanctioned `eq(articles.slug, …)` leaf, with its own assertions; the count of public doors and of queries naming `articles` in the public graph |
| `tests/public-imports.test.ts` | unchanged: no new table is read by the public graph, since the token is a column of `articles`. The audit table is written from the owner's side only |
| `tests/public-visibility-pg.test.ts` | a private article with a token is readable with the right key, and a 404 with a wrong key, no key, another article's key, and after *Turn off*; it is absent from `/api/public/library` |
| `tests/asset-route.test.ts` | the same for bytes: right key, wrong key, after turning off |
| `tests/public-dto.test.ts`, `tests/shared-inventory.test.ts` | the one new payload fact, that this is a link share (for the notice), is named and has its inventory row |
| `tests/public-network-trace.test.tsx` | a visitor with a key still makes one public request, no POST, no `Authorization` |
| a new log test | a request carrying `?key=` writes no line containing the key |

### Size

One session: one additive migration, one leaf predicate, the reader's access union, one owner route
(create and turn off), the card, the notice, the docs and the tests above. Roughly the size of one
stage of the original public sharing. It edits four files on the defences list
(`src/public/routes.ts`, `src/store/public-slug.ts`'s sibling, `src/store/public-reader.ts`,
`src/asset-delivery.ts`'s caller), which is why it waits for Greg.

## Stage 2: signed-in people with the link can comment and highlight (sketch)

This is what the second report asks for, and it is Greg's own conclusion: sign-in is required to
write anything, so that we know who wrote it. No AI: the *ask the AI* tick-box on a comment stays
the owner's.

It is a separate plan, because it is where "one article, one person" stops being true:

- **The `comments` table must start reading the column it already writes.** Every read and every
  edit filters by author as well as article, the primary key takes the author in, and a
  non-owner's routes are a new, separate set that never goes through `ownedSlug`. This is the
  hazard [260827ai](260827ai-public-read-only-access.md) § Stage 3 named: *"The moment two readers
  share one `article_id`, that invariant is gone and those tables leak into each other."*
- **A row that says who has joined.** When a signed-in person opens a private link, we record
  `(article, person, first opened)`. That is what lets them comment, lets them come back without
  the key, and lets the owner see a list of who has joined. It is also the row stage 3 would
  create ahead of time from an email address, so it is the bridge between the two designs.
- **A name to show.** We hold no names and no addresses in our own tables. Showing a person's email
  address to other readers would be a new disclosure, so a commenter needs a display name.
- **What a public visitor sees.** If the article is also public, other people's comments must not
  ride out under the owner's name. The public projection today publishes every non-referee comment
  on the article.
- **The owner can remove anybody's comment.**

Q-share-comments below is the product question this needs answered before it can be planned.

## Stage 3: share with named email addresses (what it would take)

Not designed. Listed so the cost is visible:

1. **A list of people per article**, edited only by the owner: the stage 2 row, created from an
   email address before the person has opened anything, and a switch that makes the article
   readable *only* by people on the list.
2. **Matching an address to an account.** Our tables hold no addresses, so an invitation waits
   under the address and is claimed when somebody signs in with it, verified. Google sign-in and
   password sign-up both have to land back on the article, and today's return path is one tab and
   ten minutes.
3. **The invitation email**: an outbox table as the gift voucher has, two letters (has an account,
   has none), a limit per sender so it cannot be used to send spam through our domain, and the
   Resend allowance of 100 a day that sign-in mail also draws on.
4. **A read path for a signed-in non-owner.** The public namespace has no person in it by design,
   so this is a third way in, behind the sign-in gate, with its own predicate and its own guards.
5. **AI for a sharee.** Each mode that spends has to be opened one at a time to somebody who does
   not own the article: 58 call sites assume the owner. Then whose result is it (does a sharee's
   glossary become the article's?), whose allowance and rate limit pays, and the cost record has to
   carry both the person and the article, which it cannot today. The admin cost pages already
   group by person, so "who incurred which costs" would then be answerable.

Items 1 to 3 are a medium piece of work. Item 4 is another defence. Item 5 is the largest part and
has the most product questions in it. The recommendation is to decide on stage 3 after stage 1 and 2
have been used, and to leave sharee AI until last.

## Questions for Greg

### Q-share-v1: which to build first?

Sharing with some people can mean a link anyone can open, or a list of people who must sign in.

- **A. The private link (stage 1 above). Recommended.** You press *Create a link*, send it however
  you like, and they read. No sign-in, no AI, not listed, and you can turn it off. One session.
  It gives up control over who reads: a link can be forwarded.
- **B. The email list first (stage 3, without AI).** You type addresses, we email them, they sign
  in, and only they can read. Nobody else can get in with a forwarded link. Several sessions: the
  people list, the invitation email and its limits, matching an address to an account, and a new
  signed-in read path. It also makes everyone create an account before reading a word.
- **C. Neither yet.**

What decides it: whether "they could forward it" is acceptable for the articles you want to share
now. If it is, A is most of the value for a fraction of the work, and B can still follow on top of
it. If you need to be sure only named people read, it has to be B.

### Q-share-comments: when a signed-in person comments on an article shared with them, who sees it?

This is stage 2, and it follows your second report. Example: you share a paper with Ann and Bo.
Ann highlights a sentence and writes a note.

- **A. Everyone who has joined sees it, with Ann's name on it. Recommended.** You, Ann and Bo all
  see the highlight in the margin, labelled *Ann*. This is the shared-discussion version, and
  what "multiple people can comment" reads as. It needs a display name for each person (asked for
  once, at their first comment), and you can remove anyone's comment. People who only have the
  link and are not signed in see the text and your comments, not Ann's.
- **B. Only you and Ann see it.** Each sharee is giving feedback to you, privately. No names shown
  between sharees. Simpler to get right, and less of a conversation.
- **C. Only Ann sees it.** It is her private notebook on your article. This is the smallest to
  build, and it is not really commenting *with* you.

What decides it: whether this is for discussing a piece together (A), collecting feedback (B), or
letting people keep their own notes (C).

### Q-share-price: does a link-shared article count against your allowance as private, or as public?

A public article counts half, to encourage sharing that everybody can find.

- **A. As private, full rate. Recommended.** A private link benefits a few people, not everyone,
  and this keeps billing untouched.
- **B. Half, like public.** Rewards any sharing. It means billing has to learn a third case, and it
  gives a way to halve every article's cost by creating a link nobody is sent.

## Decided here, not asked

- *Turn off* is in stage 1, and time limits are not: Greg called both out of scope, but without a
  way to turn a link off there is no way to stop sharing.
- A link-shared article shows no link preview in chat apps, so the title does not leak to them.
- The rights tick-box and the takedown notice apply to a private link as they do to a public one.
- People with a link, signed in or not, never run AI in stages 1 and 2. Greg said so for the link.
- Commenting without signing in is not offered. Greg's second report reached that conclusion.

## References

- [security-map.md](../project/security-map.md) § The unauthenticated namespace: the four things
  that keep it closed, and the guards a new lookup must pass.
- [public-readable-sharing.md](../project/public-readable-sharing.md): the page whose claims must
  stay true, and the banner.
- [260827ai](260827ai-public-read-only-access.md): the original design, its stage 3 sketch of "one
  article, many readers", and its warning about a third read path.
- [260902j](260902j-public-read-only-access-audit-and-improvements.md): where unlisted links were
  declined, and why.
- [auth.md](../project/auth.md), [billing.md](../project/billing.md),
  [email.md](../project/email.md), [cost-tracking.md](../project/cost-tracking.md),
  [comments.md](../project/comments.md).

## Review

GPT Sol's plan review: see the section added below once it has run.
