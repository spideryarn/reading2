# Page titles

**What the browser tab says.** One rule — *what is different about this tab goes first* — and one
place it is implemented: [`src/web/page-title.ts`](../../src/web/page-title.ts), a pure function
plus a hook, tested in [`tests/page-title.test.ts`](../../tests/page-title.test.ts).

> Improve the title of the pages — right now it says something about "granularity zoom". If we need
> a tagline, use something like "AI-assisted reading". Ideally the title should change for each page,
> e.g. Home, document title, include the particular mode, etc. Use your judgment. Each page should
> have an adaptive easy-to-scan title with the most useful information on the left.
>
> — Greg, 2026-08-27

## What it said before

`<title>Spideryarn — granularity zoom</title>`, in [`index.html`](../../index.html), on every page.

Two things wrong with that, and the second is the expensive one.

It **named one feature as though it were the product**. Granularity zoom is the first feature
([granularity-zoom.md](granularity-zoom.md)) and there are now seven modes beside it
([diagram.md](diagram.md), [glossary.md](glossary.md), [search.md](search.md),
[summaries.md](summaries.md), [ideas.md](ideas.md), [chat-tools.md](chat-tools.md)).

And it was **the same string on every page**. A tab title is the only label a browser gives you for a
page you are not looking at. It is also the label in the window switcher, the history list, the
bookmark, and the text somebody gets when they paste the link into a chat. A reader with six articles
open had six identical tabs — six labels that label nothing.

## The one rule

**The most specific thing on the page goes first; the app's name goes last.**

Every place a title is shown truncates from the right, so the left end is what survives. That is the
whole argument, and it is the argument every credible source makes:

- **NN/g's scanning research.** People decide from roughly the first two words, about eleven
  characters, before their eyes move on — the "[First 2 Words](https://www.nngroup.com/articles/first-2-words-a-signal-for-scanning/)"
  finding, out of the [F-shaped pattern](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/)
  eye-tracking work. Their title-specific advice is blunt: *"Move the keywords to the front of the
  title to catch people's attention and to support scanning"*
  ([Microcontent](https://www.nngroup.com/articles/microcontent-how-to-write-headlines-page-titles-and-subject-lines/)).
- **[Google Search Central](https://developers.google.com/search/docs/appearance/title-link)** says
  the site name may go at either end — and separately names near-identical titles across a site as a
  reason it will *rewrite your title* in search results. Boilerplate at the front is exactly what
  makes titles near-identical.
- **The two large-scale precedents both put identity first.** GitHub:
  `<PR title> by <author> · Pull Request #28000 · react/react · GitHub`. GOV.UK/HMRC:
  `<h1> — <section> — <service name> — GOV.UK`
  ([HMRC page-title pattern](https://design.tax.service.gov.uk/hmrc-design-patterns/page-title/)).
  In both, specificity decreases left to right and the brand is last.

Losing "Spideryarn" off the end of a truncated tab costs nothing. You already know which app it is —
you are looking at it.

## What each page says

| Page | Title | Example |
|---|---|---|
| Landing page (signed out) | `Spideryarn · AI-assisted reading` | — |
| Shelf, untouched | `Spideryarn · AI-assisted reading` | — |
| Shelf, searched or filtered | `“<query>” · Unread · Shelf · Spideryarn` | `“seth” · Shelf · Spideryarn` |
| Reading view, default mode | `<article> · Spideryarn` | `The Mythology of Conscious AI · Spideryarn` |
| Reading view, any other mode | `<article> · <Mode> · Spideryarn` | `The Mythology of Conscious AI · Glossary · Spideryarn` |
| `/read/<slug>/metadata` | `<article> · Metadata · Spideryarn` | — |
| `/read/<slug>/tweets` | `<article> · Tweets · Spideryarn` | — |
| `/add/<url>` | `Adding <host> · Spideryarn` | `Adding nytimes.com · Spideryarn` |
| `/add/upload/<id>` | `Adding <filename> · Spideryarn` | `Adding the-paper.pdf · Spideryarn` |
| `/profile` | `Profile · Spideryarn` | — |
| `/design` | `Design reference · Spideryarn` | — |
| `/login` | `Sign in · Spideryarn` | — |
| `/auth/callback` | `Signing you in · Spideryarn` | — |
| An article still *slowly* loading | `Loading… · Spideryarn` | — |
| An article that failed to load | `Couldn’t open · Spideryarn` | — |

The mode and view names are the words the bottom bar uses ([`Dock.tsx`](../../src/web/Dock.tsx)), so
the tab and the button you pressed to get there agree. `Tweets`, not `Thread`; `Metadata`, not
`Details`.

### The two homepages are the pages that lead with the app's name

A homepage is the page where the site's name *is* the most specific thing there is to say. Every
piece of guidance that otherwise says "brand last" makes this exception.

There are two of them, and they are the same page seen from either side of the gate: the **shelf**,
and the **landing page** a signed-out reader gets instead of it wherever they were heading. They
carry the same title deliberately — signing in swaps one homepage for the other, and a tab that
renamed itself at that moment would be claiming a change of page that did not happen. They are also
the only two pages the strapline appears on.

**Narrow the shelf and it stops being the homepage in that sense.** Type in the search box or turn on
the Unread filter ([library.md](library.md)) and what you narrowed it to becomes the specific thing,
so it takes the front and the strapline drops out. That is not decoration: the shelf's search and
filter live in the URL (`?q=`, `?show=` — [url-state.md § the library's own five](url-state.md#the-librarys-own-five)),
so two shelf tabs really can be showing different things, and the title is what tells them apart.

### The strapline goes on the homepages and nowhere else

*"AI-assisted reading"* — Greg's own words, above — appears on the bare shelf and on the landing
page, and on nothing else.

A tagline repeated on every page is boilerplate by definition, and boilerplate is the specific thing
Google's title-link guidance says makes a site's titles indistinguishable. Once you are one level in,
the tagline no longer describes what is different about *this* page, which is the only job a title
has.

### The default mode leaves no trace

Six of the seven modes are named in the title. `toc` — the table-of-contents columns, which is the
default — is not.

This looks like an omission and is the point. `hierarchy` is where a reader spends most of their
time, so a "Hierarchy" in nearly every tab distinguishes nearly nothing, while spending twelve
characters at the end of a string that is already being cut. **Front-loading is not only about order; it is about only
saying what is different about this tab.**

It also agrees with the URL, which leaves the default mode out for a related reason
([params.ts § modeParam](../../src/web/params.ts), over the list in [modes.ts](../../src/modes.ts)) — so a reader who learns the rule in one place has
learned it in both.

### What is deliberately *not* in the title

The middle band's own state — which term is selected, which saved search is open, which rung of the
length ladder, how deep the summary goes. All of it is in the URL (url-state.md) and none of it is in
the title.

The line is: **the title says which page and which mode; it does not narrate what you are doing
inside one.** A title that changes as you step down a glossary list is a title that is never stable
long enough to be scanned, and — see the accessibility note below — every change is announced.

The two exceptions are the shelf's search and filter, and they are exceptions because they change
*which articles exist* on the page rather than which one is highlighted.

## The separator is ` · `

A middot, not an em dash and not a pipe.

**No usability evidence favours any of the three.** CSS-Tricks once
[polled its readers](https://css-tricks.com/new-poll-whats-your-favorite-page-title-separator/) and
the pipe won on popularity; the article's own commenters could not produce a citation for any of the
SEO claims made for it. Google treats hyphen, colon and pipe as interchangeable. So this is a
consistency decision, and there are three small reasons for the middot:

- It is **already this app's separator** — the fact lines on the library card and the metadata page
  use it.
- It is the **narrowest** of the three, which matters when the budget is a tab's handful of pixels.
- Unlike `-`, it can never be mistaken for punctuation *inside* a title that has some.

One caution from the accessibility literature, which applies to any separator: screen readers handle
punctuation inconsistently — pipes especially have a history of being read as "vertical bar" or
dropped entirely, depending on verbosity settings ([Deque on punctuation](https://www.deque.com/blog/dont-screen-readers-read-whats-screen-part-1-punctuation-typographic-symbols/)).
So **the separator must never carry meaning the words on either side do not**. Ours does not.

## The clamp, and why it is not a character limit

`clamp()` cuts a leading title at 64 characters, on a word boundary, with an ellipsis.

**It cannot make a title fit a tab, and it does not try.** Every place that truncates does so by
*pixels*, not characters: Firefox caps a tab at 225px, Chrome shrinks tabs until only the favicon is
left, Google cuts a search result at about 600px on desktop. The familiar "50–60 characters" number
is SEO folklore converged on by blogs rather than a vendor figure, and it is the wrong *unit*
besides — a title of capital W's overflows where the same character count in lowercase fits.

The clamp is for the places that do **not** truncate: the history list, a bookmark, the window
switcher, and the text somebody gets when a link is pasted into a chat. A 180-character academic
paper title there pushes everything after it off the end of the useful world.

64 is therefore a judgment call, deliberately generous — comfortably more than any tab shows, so
clamping never costs a reader something the tab would have shown them anyway.

It counts **code points, not UTF-16 units**, which is why the text is split into an array before it
is cut. `slice(0, 64)` will happily halve an emoji and leave a lone surrogate, which renders as `�` —
a clamp whose entire job is to look deliberate, producing the one character that looks like
corruption. Code points, not graphemes: a combining accent can still be split, and doing better needs
`Intl.Segmenter`, which is not worth it for a string already ending in an ellipsis.

**GPT Sol's review recommended deleting the clamp entirely** (2026-08-27), on the grounds that it
matches no browser metric — which is true, and said above — and that the exact article title is worth
more in bookmark and history search than the trailing app name it protects. Kept anyway, and this
paragraph is here because the decision went against the recommendation: the argument is about the
*long* tail rather than the average. A 200-character PDF title is a real thing on this shelf, and a
history row that is one such title and nothing else is worse than a clamped one. Sol's version is
cheap to get back to — delete two calls — if the exact title turns out to matter more.

## Setting the title is not the same as announcing it

This is the part that fails silently, and it is the most-repeated warning in the SPA accessibility
literature.

**WCAG 2.4.2 Page Titled is Level A** — the baseline, not a nice-to-have. The
[W3C's Understanding document](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html) extends
it to apps like this one explicitly: *"For dynamic content changes without URI changes … the title of
the page should also be changed dynamically to reflect the content or topic of the current view."*
That is the clause that obliges [`router.ts`](../../src/web/router.ts)'s client-side navigation to
update `document.title` at all.

But: **assigning `document.title` announces nothing.** A screen reader reads the title on a genuine
document *load*, and this app never loads twice. Deque, Perficient and
[hidde.blog](https://hidde.blog/accessible-page-titles-in-a-single-page-app/) all say the same thing;
the last states it flatly — *"that change does not trigger a screen reader announcement."*

So `useDocumentTitle` does two things. It sets the title, and it writes the **specific** part of it
into a polite live region — one visually-hidden node, created on first use and reused. Two traps in
that, both of which look like working code:

- **The region must already be in the DOM before its text changes.** A region created *and* filled in
  the same tick is a live region appearing, not a live region updating, and nothing is announced.
- **It is cleared before it is set.** Assistive technology may say nothing when the same string is
  written twice, and two articles can share a title.

A live region rather than moving focus, which is the other recommended supplement: a mode change is
not a page load, and yanking the reader's focus to the top every time they press a button in the
bottom bar would be worse than the problem.

**Everything but the app's name is announced.** Not the leading segment alone — switching mode leaves
the article's title unchanged, so announcing only that would repeat it and say nothing about the
button just pressed. And not the app's name, because hearing *"Spideryarn"* after every navigation is
the audible version of the problem this whole file exists to fix. The separator spoken is a comma
rather than the middot the tab shows, because a comma is the one mark every screen reader turns into
a pause.

**The tab changes at once and the announcement waits 350ms**, and that gap does two jobs.

The first is not being chatty. Not every title change is a navigation: the shelf's search box puts
what you have typed into the title, and `useQueryState` updates on the *keystroke* rather than on the
debounced URL write — so an unguarded announce spells the word back one letter at a time to the
person typing it. The pause collapses a burst into one announcement of wherever it settled.

The second is that **the region has to be created empty and filled later, in two separate ticks**.
Both halves of that fail silently, and the first draft of this got it wrong in exactly the way its own
docstring warned against (GPT Sol found it, 2026-08-27):

- A region **created and filled in one go** is a live region *appearing*, not updating. Nothing is
  announced, and every line of the code looks right.
- **Emptying and refilling in the same tick** is no better: the browser sees one net change, so
  re-announcing the *same* string — and two articles can share a title — is coalesced away to
  nothing.

Splitting the two across the delay fixes both at once, which is the only reason one function does two
things a tick apart.

**An honest limit.** `polite` is a request rather than a guarantee — assistive technology can be set
to interrupt anyway — and none of this is *proven* by the tests. jsdom can tell you the node holds the
right text at the right moment; only VoiceOver and NVDA can tell you it was spoken. See
[Still open](#still-open).

## Where the title is set

Eleven call sites across ten files, one line each, all of the form
`useDocumentTitle(pageTitle({…}))`:

| File | Page |
|---|---|
| [`Library.tsx`](../../src/web/Library.tsx) | the shelf, with its query and filter |
| [`App.tsx`](../../src/web/App.tsx) — `ArticlePage` | loading and error, **and nothing else** |
| [`App.tsx`](../../src/web/App.tsx) — `Reader` | the reading view, with its mode |
| [`Metadata.tsx`](../../src/web/Metadata.tsx) | `/read/<slug>/metadata` |
| [`Tweets.tsx`](../../src/web/Tweets.tsx) | `/read/<slug>/tweets` |
| [`AddPage.tsx`](../../src/web/AddPage.tsx) | both `/add/` routes |
| [`ProfilePage.tsx`](../../src/web/ProfilePage.tsx) | `/profile` |
| [`DesignPage.tsx`](../../src/web/DesignPage.tsx) | `/design` |
| [`LandingPage.tsx`](../../src/web/LandingPage.tsx) | what a signed-out reader gets instead of wherever they were heading |
| [`SignInPage.tsx`](../../src/web/SignInPage.tsx) | `/login` |
| [`AuthCallback.tsx`](../../src/web/AuthCallback.tsx) | `/auth/callback` |

**`ArticlePage` hands over as soon as it has an article**, and that is load-bearing rather than
tidy. React runs a child's effects *before* its parent's, so a title computed in `ArticlePage` would
land on top of the more specific one `Reader` had just written — the mode would appear for a frame
and then vanish. It passes an empty string instead, which `useDocumentTitle` treats as "not mine to
set".

**`Loading…` waits for the same threshold the page body does** — `useSlow`, which is what stops the
reading view saying "Loading…" on a fetch that takes 200ms. A tab that flickers through it on every
fast navigation is the tab equivalent of a spinner that flashes and vanishes, and it is worse than
that here, because the title is announced: a flicker nobody sees is an interruption somebody hears.
Until the threshold passes the previous title stands, which is exactly what a browser does during a
real page load.

The `<title>` in `index.html` is deliberately the bare app name. It is what the tab says between the
first byte and React's first paint, and a page-specific guess made before the fetch would be a wrong
one. **One route no longer uses it**: a shared `/read/<slug>` is served with a real title composed
from the database — the next section.

## The server writes the title first now, and both sides use one function

Since 2026-08-29 a shared `/read/<slug>` is not served as the bare shell. A small function composes
the `<head>` — `<title>`, `og:`, `twitter:` — from the database before the bundle loads, for public
articles only, so that a pasted link previews as something. That closed the "no `og:` tags" question
this page carried for two days. [`src/public/page-head.ts`](../../src/public/page-head.ts), and
[public-read-only-access.md](../plans/public-read-only-access.md) § Stage 2.

It also created a new way to be quietly wrong. React still mounts and still assigns
`document.title`, **over the top of a title that was already there and already right**. So whatever
the two disagree about is a tab that changes in front of the reader, a second after the page arrives.

They did disagree. The server ran the title through `headText`
([`src/html.ts`](../../src/html.ts)) — internal runs of whitespace collapsed, control characters
became a space, bidi overrides dropped — and the client only trimmed the ends and cut to length. An
article titled `Two  spaces` was served as `Two spaces` and then rewritten to `Two  spaces`. GPT Sol
found it reviewing slice 1; it was pinned as a divergence nobody had chosen, and put to Greg, who
left the call to the implementer (2026-08-30).

**The call: the server's normalising wins, the client's clamp wins.** Each side kept the rule it had
the better reason for.

| | The rule that won | Why that side |
|---|---|---|
| Normalising | the server's | An RLO reverses display order — `A‮gnp.exe` shows as `A exe.png` — and a newline in a `<title>` renders differently in every consumer of it. There is no argument for the tab being the one place an invisible direction change survives. |
| Clamping | the client's | A word-boundary cut with an `…` is what a reader wants in a tab, a bookmark and a history entry: the ellipsis says "there was more". The server only had the hard cut because `headText` also serves `og:title`. |

Both now call **`documentTitle`** in [`src/title-text.ts`](../../src/title-text.ts), which is the
whole of the guarantee: two copies of one rule is one place for it to drift, and the drift is what
happened. That file sits at `src/` rather than under `src/web/` because
[`page-title.ts`](../../src/web/page-title.ts) imports React and nothing the public function reaches
may import anything under `src/web/` — the standing answer here is to move the shared thing into a
module that imports almost nothing — `src/html.ts` for the normaliser, plus the two vocabularies a
title is built from, [`src/modes.ts`](../../src/modes.ts) and
[`src/read-address.ts`](../../src/read-address.ts), which are leaves themselves.

**What still differs, on purpose:** `og:title` and `twitter:title` drop the ` · Spideryarn` suffix
and clamp hard at 120 with no ellipsis. That is a difference between *a tab* and *a card* — different
sinks, read by different things — rather than between two copies of one rule. A card already carries
`og:site_name`, so repeating the app's name spends the visible half of it saying one word twice, and
an `…` in published metadata is a claim that the title contained one.

`tests/page-head.test.ts` § *the one title rule, applied by both sides* is the check, and its expected
strings are written out rather than computed from either side — an expectation spelled
`documentTitle(t)` would agree with every possible behaviour of `documentTitle`, which is how a test
about two things that must agree quietly becomes a test about nothing.

### The other two ways the two sides disagreed

The whitespace one above was the finding. Auditing for more of the same shape — *two sources
answering "what should the tab say"* — turned up two others, both of which shipped with the server
head and neither of which any existing test could reach.

**The fallback chain, fixed 2026-08-30.** `loadHead` answered `title ?? headingTitle`, and the
article payload's `metaFrom` ([`src/public/dto.ts`](../../src/public/dto.ts)) answers
`title ?? headingTitle ?? slug`. They agree for every article that has a title or an `<h1>`, which is
nearly all of them — which is exactly why nothing caught it. For an article with neither, the tab said
`Untitled · Spideryarn` and then changed to the slug. `loadHead` has the third link now, and there is
a fixture with neither of the first two, because **the corpus could not previously reach the
disagreement at all**: `a public article with neither a title nor an <h1>` in
`tests/public-visibility-pg.test.ts`. GPT Sol found this one in the last minutes of a review that
then ran out of time.

**`Loading…`, fixed 2026-08-30.** This is the one the server head *caused* rather than exposed.
`ArticlePage` replaces the tab with `Loading…` once a fetch passes `SLOW_AFTER_MS` (600ms — a cold
serverless start against Postgres, routinely). Before the server composed heads that was strictly an
improvement, because the tab started at the bare app name. Afterwards it is a step backwards: a
shared link arrives with the article's real title, and this would replace it with `Loading…` and then
put it back, announcing both to a screen reader.

`articleWaitTitle` in [`page-title.ts`](../../src/web/page-title.ts) is the rule, and it is the one
this component already followed for a fast fetch: **do not replace a title that is already right.**
Two guards, both necessary and each with a case that fails without it —

- the composed head must be about *this* slug, or a reader who has navigated on would keep a title
  about the article they left;
- the tab must *still be showing* it, or a reader who goes `/read/a` → `/read/b` → back to `/read/a`
  would have b's title left standing over a's loading page. The `og:url` still names `a`, so the slug
  check alone passes; comparing the string self-expires the moment anything writes a different one.

An **error** still replaces it, deliberately. `Loading…` is a claim that the right title is coming;
`Couldn't open` is a claim that it is not, and a broken page must not go on advertising the article
it failed to show.

The signal is the `og:url` the head already carries, read once at module load — not a marker of its
own, because a second element meaning the same thing is a second place for the two to disagree, which
is the whole subject of this section.

### And the fourth: the mode

Found by GPT Sol reviewing the three fixes above, 2026-08-30, and it is the one worth understanding
because of *why* nothing else found it.

`/read/<slug>?mode=glossary` was served as `Article · Spideryarn` and then rewritten by React to
`Article · Glossary · Spideryarn`. The rewrite in `vercel.json` preserves the query, so the mode was
there to be read; the transport simply passed the slug on and dropped the rest.

There is a seeded fuzz over 20,000 generated titles guarding the server/client equality, and it could
not see this. Every case it generates fixes `view: "article"` and leaves `mode` absent — so it varies
the title's *characters* exhaustively while holding the one axis this bug lives on completely still.
Sol's sentence is the one to keep:

> The missing dimension is title state, not title characters.

That is a general lesson about corpora, not a fact about this bug: a generator is thorough along the
axes it varies and blind along every axis it fixes, and the blindness is invisible from inside the
results. `tests/page-head.test.ts` now loops over `MODES` itself, read from
[`src/modes.ts`](../../src/modes.ts) rather than listed, so a tenth mode arrives in the check without
anyone remembering to add it.

The server learns the mode rather than the client dropping it, because the client's rule — the mode
distinguishes tabs, so it belongs in the title — is the one with the argument behind it (§ *The
default mode leaves no trace* above). `readMode` in [`src/vercel.ts`](../../src/vercel.ts) reads it,
and resolves anything unrecognised to the default through the same `isMode` the client's `modeParam`
uses, so a `?mode=` from a future version degrades to the article on both sides identically. The mode
reaches the `<title>` only: `og:title` and `og:url` are about the article, not about which panel the
person who shared it happened to have open.

That move is why `MODES`, `Mode` and `DEFAULT_MODE` now live in `src/modes.ts` instead of
`src/web/params.ts` — nothing the serverless function reaches may import from `src/web/`. `params.ts`
re-exports all three, so no component knows it moved.

### And a fifth: the legacy metadata addresses

The article's details have been in three places — `?about=1`, then `?panel=about`, now
`/read/<slug>/metadata`. [`main.tsx`](../../src/web/main.tsx) rewrites both old spellings on the way
in, before React draws anything.

`/read/x/metadata` is **two** path segments, so `vercel.json`'s `/read/:slug` never matches it and it
falls to the SPA catch-all — which is why the view axis looked safe. `/read/x?about=1` is **one**
segment. It matched, the server composed the *article's* title, and the client then turned the
address into the metadata page: `Article · Spideryarn` → `Article · Metadata · Spideryarn`, or with a
mode on it, `Article · Glossary · Spideryarn` → `Article · Metadata · Spideryarn`.

GPT Sol found this one too, 2026-08-30, after I had checked the direct route and written down that
the axis was covered. **The direct route being safe is not the axis being safe** — a legacy address
is a second door into the same view, and it does not look like the thing it becomes.

`redirectsToMetadata` in [`src/read-address.ts`](../../src/read-address.ts) is the predicate, and
`main.tsx` calls it rather than keeping the pattern it used to hold, so there is one answer rather
than two. The server composes `· Metadata ·` for those addresses and drops the mode, exactly as
`readTitle` does for a non-article view. `about=0` is the case that separates "contains `about=`"
from "becomes the metadata page": it meant the panel was shut, it is stripped from the URL, and the
reader stays on the article — so the server goes on composing the article's title for it.

### Sixth and seventh: the two older legacy entrances

Same shape as the fifth, and I did not learn it the first time. `/?slug=x` and `/?add=<url>` are
addresses from when everything was a parameter on one page. Neither was constrained to the root, so
both fired under `/read/` too:

- `/read/a?slug=b` — the server composes article **a**'s title; `main.tsx` rewrites the address to
  `/read/b`.
- `/read/a?add=https://example.com/x` — the server composes article **a**'s title; `canonicalAddHref`
  rewrites the address to `/add/…`, which is not an article page at all.

Both now read only on `/`, which is what [url-state.md](url-state.md) has always described them as.
The `/add/<url>` **path** form is untouched and canonical wherever it appears.

GPT Sol found these in the third round, after I had twice written that the view axis was covered.
The lesson, which took three rounds to land: **enumerating the routes will not find a legacy
entrance, because a legacy entrance is not a route.** It is a query parameter that turns one page
into another, before the router ever sees it.

There is a second consequence, and it is the one to keep. Constraining `?add=` to the root means the
auth callback is now safe from being folded into an ingest for *two* independent reasons — the
`onCallback` guard in `main.tsx`, and the pathname. That is defence in depth, and it is also how a
control quietly stops testing anything: `tests/router.test.ts` had a case whose whole premise was
"`?add=` is read from the query wherever it appears". It now proves each guard separately, with a
positive control on `/` so that a `null` is evidence about the pathname rather than about a function
that has stopped reading `?add=` at all.

### The one exception: an owner's private rename

Everything above is in service of one guarantee — the tab does not change when React mounts. There is
exactly one place it still does, and it is a decision.

`articles.title_override` is the owner's private name for a piece. The public head must never carry
it, because that head is served to strangers ([security-map.md](security-map.md)); the owner's own
payload deliberately applies it. So an **owner** hard-loading their own renamed public article sees
the extracted title for a moment and then their own name for it.

Nobody else can see this. A stranger, a signed-in stranger and the owner all get byte-identical
*public* responses, so the change is visible only to the one person who already knows both strings.
The alternative — putting the override in the public head so the two agree — is a disclosure, and no
tab is worth that. Pinned in `tests/public-visibility-pg.test.ts`, with the non-disclosure asserted
first, because that is the half that must never regress.

### The eighth, which is why the rest of this section is now one test

`/read/a?%61bout=1#spya-k3m9qt`. The server reads the raw query, sees `%61bout`, and says: the
article. The client lifts the fragment into `?at=` — and did that through `URLSearchParams`, which
**reserialises the whole query**, so `%61bout=1` became `about=1`, and the metadata rewrite two steps
later fired on a parameter that had not been there when the server looked.

Neither rewrite is wrong on its own. It is an **interaction**, and it was invisible because
`main.tsx` performed the four rewrites as four `history.replaceState` calls at module scope — side
effects nothing can call. Each had tests; the sequence had none.

Two things changed, and the second is the more important:

1. **The query is edited as text throughout.** That was already this file's rule for `?slug=` and
   `about=` — round-tripping re-encodes as it serialises, and `?cols=0,1` comes back as
   `?cols=0%2C1`, still correct and no longer readable ([params.ts](../../src/web/params.ts) spells
   those commas out on purpose). The hash rewrite was the one breaking the rule, and it was mangling
   those commas too.
2. **The sequence is one pure function** — `settleAddress` in [`router.ts`](../../src/web/router.ts).
   `main.tsx` calls it once. That also collapses four `onCallback` guards into one, so a fifth
   rewrite is exempt from the auth callback *by construction* rather than by the person adding it
   remembering.

### Eight fixed one at a time is not a fix

**The count, since it keeps moving:** ten findings in all — the eight title divergences listed above,
plus two address bugs that are not title divergences at all (the ninth, a stale `?at=` when its key
was percent-encoded; the tenth, below). Six of the ten were found by a reviewer reading the code,
three of those on axes this document had already claimed were covered.

Each of the eight got a test naming its own case, and that is exactly the shape of testing that let
the next one through. **A list of the cases somebody thought of is not a statement about the class.**

So the class is now stated as one test:
[`tests/address-settling.test.ts`](../../tests/address-settling.test.ts) crosses every path shape
against every query parameter this app has ever recognised against every hash shape.

It compares the *real* functions on both sides — `readSlug`, `readMode`, `viewFor` and `composeShell`
against `settleAddress`, `parseRoute` and `pageTitle` — so it is the two behaviours, not two models of
them. That is only possible because the rewrite sequence became a function; it is the reason it did.

### An equality test is only as good as its anchor

The first version of that cross-product asserted one thing:

    what the server puts in <title>  ===  what the client ends up setting

which catches every case where the two *disagree*, and says nothing whatever about a case where they
agree on the wrong answer. GPT Sol found one on 2026-08-30 — the **tenth**.
`redirectsToMetadata` matched `(^|[?&])about=1`, so it read a `?` inside another parameter's *value*
as a parameter boundary:

    /read/x?add=https://x.test/a?about=1

went to the metadata page, both halves concurring. Only the first `?` begins a query; after that only
`&` separates pairs, and [`queryPairs`](../../src/read-address.ts) is now the one place that knows it.

So every row of the corpus states **which view it should settle on**, and both halves are checked
against that rather than only against each other. The fix and the lesson are separate: the fix is a
boundary, the lesson is that two halves of a system can share a bug, and equality between them is
blind to exactly that by construction.

Restoring any of six faults reddens the file, verified: the transport dropping the mode, the server
not predicting the metadata rewrite, the hash rewrite reserialising the query, `readSlug` matching a
two-segment view, the raw-text metadata predicate, and `queryPairs` taking the last `?` rather than
the first. It carries a control requiring more than forty addresses to actually reach the reading
view, because a cross-product that compares nothing also reports no disagreement.

### Two of the ten are now compile errors instead

Better than a test that catches a mutation is a mutation that will not compile, and two of these got
there in the end:

- **`TitleSpec` splits the reading view from the other two.** `mode` was one optional field, so
  deleting it from the call in `App.tsx` compiled and silently cost the tab its `· Glossary`. The
  reading-view variant now requires `mode` and the other two forbid it with `mode?: never` — the
  `never` because a union rejects a bad *literal* by excess-property checking but accepts a value
  assembled in a variable.
- **`servePublicReadPage` takes the request, not an address copied out of it.** It went through three
  shapes in a day: the caller derived mode and view; then it passed `url`; and `url: restored` versus
  `url: path` both compile while only one carries the query. It reads `req.url` now — the same field
  `handleApi` routes on — so there is no wiring left to get wrong.

## What would go wrong quietly

- **Putting the app's name first.** Looks fine on any one page. Only a window with six tabs shows the
  damage, and by then nobody connects it to the change. `tests/page-title.test.ts` asserts the app
  name is last on every page but the two homepages.
- **Adding the strapline "for consistency".** Same shape: reads as tidier, and is the thing Google's
  guidance names as the reason it overrides titles. There is a test for that too.
- **Spelling out `Hierarchy` for the default mode.** Reads like completing a list. Costs every tab in
  the window twelve characters to say the thing they all have in common.
- **A new page with no `useDocumentTitle`.** It inherits whatever the last page set, so a stale title
  sits on the new page looking entirely plausible. Nothing catches this but noticing.
- **A live region created and written in the same tick**, or emptied and refilled in one. Both are
  silent, and both look identical to working code — this file's first draft did the first of them
  while its own docstring explained why not to. See `region()` and `useDocumentTitle` in
  [`page-title.ts`](../../src/web/page-title.ts).
- **Announcing a title that is still changing.** Invisible to anybody sighted, and unusable for
  anybody not. Only a screen reader would ever find it.
- **Rendering the previous article under the new slug.** `ArticlePage` clears its state in an
  effect, and an effect runs *after* the render that scheduled it — so for one frame a child keyed on
  the new slug held the old article, and the tab said
  `<the article you just left> · Metadata`. Fixed by keeping the slug beside the payload, so the
  mismatch cannot be rendered rather than merely being unlikely. Older than the titles; the titles
  are just what showed it.
- **An empty segment joined rather than dropped**, giving a title that opens with a stranded ` · `.
  The metadata page's fact line has the same trap, and for the same reason.

## Still open <a id="still-open"></a>

- **The favicon carries no state.** Notification and unsaved-state conventions — Gmail's `(3)` prefix,
  the leading `●` for unsaved work — are well established, and both are silently defeated by a pinned
  tab, which shows the favicon and no text at all. Nothing here needs one yet: an ingest in flight has
  its own page. If a background job ever needs to shout, the favicon is the place, not the title.
- **Nothing front-loads an error state.** GOV.UK prepends a literal `Error: ` to the *front* of the
  title on a failed form, specifically so a screen reader announces it first. We have one failure
  title (`Couldn’t open`) and no forms that fail this way; if the shelf ever grows one, that is the
  pattern to copy.
- **Nothing here has met a real screen reader.** The tests prove the region holds the right text at
  the right moment; they cannot prove a word was spoken. VoiceOver/Safari and NVDA/Firefox are the
  check, and it has not been run. Until it has, treat the announcement half of this as designed
  rather than verified.
- **Whether a mode change should announce at all.** GPT Sol's position (2026-08-27) is that a mode
  toggle should convey its own selected state — `aria-pressed` on the control in
  [`Dock.tsx`](../../src/web/Dock.tsx) — and that only genuine navigations should reach the live
  region. That is probably right, and it is a change to the bottom bar rather than to this file, so
  it has not been made. What is here now announces both, which is verbose rather than wrong.

## See also

- [url-state.md](url-state.md) — every parameter a title can be built from, and which of them push
  history
- [library.md](library.md) — the shelf, its search box and its Unread filter
- [copy.md](copy.md) — the other words the reader sees when something fails, and why they live in one
  file
- [web-client.md](web-client.md) — the reading view and the constraints it works under
