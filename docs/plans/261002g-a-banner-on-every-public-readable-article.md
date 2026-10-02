# 261002g — a banner on every public-readable article: its source, the takedown offer, no training

Status as of 2026-10-02: **built, on dev** (evidence: `SharedNotice` in src/web/PublicChrome.tsx
takes a `source`; `publicSourceGuessQuery` in src/store/public-reader.ts;
tests/shared-notice-banner.test.tsx). **The plan review changed four decisions**, listed in § What
the plan review changed at the end. Where they disagree, that section overrides the decisions above
it. Feedback report spya-ger3a3, Overseer queue item qi-452ev4kp, from Greg, so trusted input:

> For anything public readable, let's make sure there's a banner at the top that says, that
> highlights the URL where it came from. And ideally, I think we've already got something else
> that's trying to figure out what is the canonical URL, even for uploaded PDFs or HTML, so that
> wherever possible, we are providing a link back with, you know, SEO juice pointing to the
> canonical source, and that the banner should explicitly say two things. It should say, if you're
> the, you know, IP owner and you don't want this to be public readable, that email, I don't know,
> hello at spideryarn.com and we'll take it down. And secondly, if you provide evidence, and
> secondly, that we explicitly use models that don't train on your content, and then point them to
> the privacy page.
>
> — Greg, 2026-09-29

## What it is for

A stranger who opens a shared article should see, before the prose, three things: **where the
piece really lives**, **that its author can have it taken down with one email**, and **that the
models here do not train on it**. The first is courtesy to the author and to the reader; the other
two are aimed at the author who found their own work here and is not pleased. Today the first is
said by the masthead's origin line, the second only on the article's details page, in grey at the
foot, and the third only on `/privacy` and `/features/public-readable-sharing`.

## The banner already exists, so this extends it

`SharedNotice` (src/web/PublicChrome.tsx) is a bordered box under the masthead, drawn for every
visitor and for nobody else (`!owner` in src/web/reader/Reader.tsx), saying *"This article was
shared publicly…"*. It is not dismissible on purpose. It is the banner. The work is to put three
lines in it.

**The simpler option passed over: a second, new box above the title.** That would mean two boxes
stacked for a visitor, each with something to say about the page's status, and a choice of which one
is "the" banner. One box with the facts in order costs less and reads better.

## Decisions

1. **Visitors only, as the box already is.** The owner of a public article does not see it. The
   offer *"if this is yours, email us"* is nonsense to the person who added it, and the owner
   already has the sharing mark and the details page. *Assumption, named for Greg:* an owner who
   wants to see what a stranger sees opens the link signed out.

2. **The source line moves into the box for a visitor.** For a visitor, `OriginLine` (Masthead.tsx)
   already prints the publisher's address under the title. Printing it twice within four lines
   would be sloppy, so the masthead stops drawing it for a visitor and the banner draws it instead,
   using the same component with the same tooltip. The `<h1>` is still a link to the original, so
   the masthead keeps a way out. The owner's masthead is unchanged.
   Wording: **"First published at `host/path ↗`."**

3. **Uploads get the guessed source, which visitors have never been sent.** Greg's *"even for
   uploaded PDFs or HTML"* is the 260929g source guess, which was owner-only in v1 and deferred
   with the note *"a guessed address wants its own public projection, as `final_url` has
   `publicSourceUrl`"* (260929g § Decisions 4). This plan builds that projection:
   - `PublicArticle.sourceGuess?: { url, host, kind }`, only for a `found` row, with `url` run
     through `publicSourceUrl` (src/urls.ts), the same policy the article's own address gets. No
     `matchedBy`, no `why`, no model, no counts: only what the line draws.
   - Read by its own query that joins `upload_source_guesses` to `articles` under `publicSlug(slug)`.
     That way the visibility question is asked again in the query's own `where`, as
     `publicCommentsQuery` asks it, rather than by passing an article id around as if it were a
     permission.
   - `access.ts` stops blanking it for the public arm, and maps it onto `Article.sourceGuess` as a
     `found` guess (`matchedBy` is not shown anywhere a visitor reaches; the tip wording keys on
     `kind`).
   - Drawn with `GuessedSourceLink`, keeping its **?**, and worded for a stranger. Its owner wording
     says *"your file"*; a visitor gets *"the uploaded file"*. Line: **"Probably first published at
     `host/path ?`"** for `canonical`, **"A page matching this file: `host/path ?`"** for
     `matching`.
   - `useSourceGuess` stays mounted only for an owner, so a visitor still fires no
     `POST /api/source-guess` (tests/public-network-trace.test.tsx holds this already).

   **Not the canonical tag.** Greg's *"SEO juice"* is real for an indexed page, but every public
   page here is `noindex, nofollow` under a `Disallow: /` robots.txt, so no search engine reads the
   `<link rel="canonical">` at all (public-readable-sharing.md § Two of the five briefed claims). A
   *guessed* address as a canonical would also be a machine-readable claim we cannot fully stand
   behind. The canonical stays `final_url` only. If we ever open public pages to search engines, the
   guess as canonical is the question to ask then, not now.

4. **The takedown offer says the mailbox and links to the promise, without restating it.**
   **"If it's yours and you'd rather it weren't here, email hello@spideryarn.com and we'll take it
   down. [What that involves](/privacy#…)"**, with `CONTACT_EMAIL` as a `mailto:` and
   `TAKEDOWN_HREF` as the link. What *taken down* means, what to include, and days-not-hours stay on
   `/privacy` § If something here is yours, which owns them.
   **No "provide evidence".** Greg's transcript starts that clause and abandons it (*"And secondly,
   if you provide evidence, and secondly, …"*), and `/privacy` promises the opposite: *"We will
   take a fair complaint at face value rather than asking you to prove anything first"*. The banner
   cannot contradict the page it links to.

5. **The no-training line keeps the hedge.** `/privacy` and the sharing page both say *nobody
   trains a model on it* and both call it *a commitment we hold ourselves to*, because it rests
   partly on an OpenRouter account setting rather than on code (zdr is set on nothing —
   public-readable-sharing.md). So the banner says: **"Nobody trains a model on it — a commitment we
   hold ourselves to, as our [privacy policy](/privacy) explains."** A bare *"our models don't train
   on your content"*, which is Greg's phrasing, would claim more than `/privacy` does.

6. **Strings in src/messages.ts, pinned by a test.** The test pins the two shared phrases (the
   no-training claim and its hedge) on the banner's constants, the way
   tests/public-readable-sharing-page.test.tsx pins the sharing page against `/privacy`, and also
   pins that the banner's offer names `CONTACT_EMAIL` and links `TAKEDOWN_HREF`. It does not pin the
   rest of the prose.

7. **This reverses one decision on purpose.** `PublicPages.tsx`'s comment on its takedown link says
   the reading view is the wrong place for one: *"a report link in the prose chrome would shout at
   every reader of an article that is almost certainly shared legitimately"*. Greg has now asked for
   exactly that, so the comment is updated to say the banner carries it too, and why. The details
   page keeps its link.

## Shape

```
┌ title (still a link to the original) ───────────────────────────┐
│ byline · site · 4,210 words · ~17 min                            │   masthead, no origin line
└──────────────────────────────────────────────────────────────────┘   for a visitor
┌──────────────────────────────────────────────────────────────────┐
│ This article was shared publicly. The whole piece is here to     │
│ read, at every zoom level.                                       │
│ ↗ First published at example.com/2024/essay                       │   or the ? guess, or nothing
│ If it's yours and you'd rather it weren't here, email            │
│ hello@spideryarn.com and we'll take it down. What that involves  │
│ Nobody trains a model on it — a commitment we hold ourselves to, │
│ as our privacy policy explains.                                  │
│ [sign up …]  (signed out only, as now)                           │
└──────────────────────────────────────────────────────────────────┘
```

On a narrow window with a band open, the box already hides with the masthead
(tests/shared-notice-hides-with-the-masthead.test.tsx). That is unchanged: the source then lives
only in the `<h1>` link, which is hidden too, so for that state nothing changes from today.

## Deferred, named

- **A dismiss control.** The box is not dismissible by design (PublicChrome.tsx § SharedNotice), and
  three short lines do not change that.
- **The guess as `<link rel="canonical">`.** Decision 3.
- **An upload with no guess.** Nothing is said about the source. A visitor's absent address cannot
  be told apart from one the policy withheld (Masthead.tsx § OriginLine), so *"uploaded"* is still
  not said to a stranger.
- **The owner seeing the banner.** Decision 1.

## Tests

- Banner unit test (new, `tests/shared-notice-banner.test.tsx`): web source drawn; found guess drawn
  with `?` and visitor wording; no source → no source line; mailto and takedown link present;
  privacy link present.
- `tests/masthead-origin.test.tsx`: the visitor cases change. The masthead draws no origin line for
  a visitor, and the banner draws it.
- Public reader Postgres test: a public upload with a `found` row carries `sourceGuess`; a private
  article's row never crosses; a `none`/`searching` row gives no key; a URL `publicSourceUrl`
  refuses gives no key.
- The no-training pin, as decision 6.

## What the plan review changed

GPT Sol reviewed the plan read-only:
[261002g-…-plan-review-sol.md](261002g-a-banner-on-every-public-readable-article-plan-review-sol.md).
It found no P0s and four P1s, and all four were taken:

1. **Decision 2 is reversed: the masthead keeps its origin line, and the banner repeats it.** Moving
   the line would have made the sharing page's promise that the address sits *directly beneath the
   title* false. The masthead tests stay as they were. The repeat is deliberate: the origin line is
   the article's identity, and the banner is where the three facts are read together. On the
   visitor's details page, the banner draws no source line, because that page's `SourceRow` prints
   it already.
2. **"Source:", not "First published at".** `final_url` is a post-redirect address and a guess is a
   page we matched. Neither proves which copy came first. Guesses use the metadata page's own leads:
   *Probably the original:* and *A page that matches this paper:*.
3. **`matchedBy` is published** (the tooltip needs it to say DOI or arXiv), and **`host` is derived
   from the published URL**, never copied from the stored column, which nothing ties to `url`.
4. **The security guards widen on purpose.** `uploadSourceGuesses` is the seventh table in
   tests/public-imports.test.ts, with the three sentences it asks for. `publicSourceGuessQuery` is
   named in tests/owner-isolation.test.ts. tests/public-reads.test.ts reads its SQL: `publicSlug` in
   its own `where`, `status = 'found'`, and no `host`, `why`, claim token or counts.

Also from the review: the guess is keyed by article, not by file. Today every new revision of an
upload carries the same file forward, so this is not a leak. A path that ever replaced the file
would have to clear the row (`publicSourceGuessQuery`'s header says so).

**Also changed while building:** the owner's *what goes out* list (`SHARED_LINK_CARRIES` §
provenance) now says that an uploaded file's matched page goes out too. Three docs and two comments
that said a visitor never sees a guess were corrected.

## Tests, as built

- `tests/shared-notice-banner.test.tsx` (new): the published address drawn; a found guess drawn with
  its **?** and with no *your file*; the address preferred over a guess; nothing said when there is
  neither, and no *uploaded*; no source line when the caller passes none; a `javascript:` guess
  refused; the mailbox, the takedown section and `/privacy` all linked; no *evidence*; and the
  training wording held to both `/privacy` and the sharing page.
- `tests/source-guess-pg.test.ts`: the case *"never reaches a visitor"* is replaced. A found guess
  now crosses on a shared article, with the host taken from the URL even when the stored host
  disagrees. Nothing crosses while the article is private, when the address carries a query, or
  when the row is `none`, and the `why` never crosses.
- `tests/public-reads.test.ts`, `tests/owner-isolation.test.ts`, `tests/public-imports.test.ts`,
  `tests/shared-inventory.test.ts`: decision 4 above. The allowlist entry was seen to fail without
  it.
