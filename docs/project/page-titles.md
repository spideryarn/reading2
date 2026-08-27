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
| `/profile` | `Your profile · Spideryarn` | — |
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

This looks like an omission and is the point. `toc` is where a reader spends most of their time, so a
"Contents" in nearly every tab distinguishes nearly nothing, while spending eleven characters at the
end of a string that is already being cut. **Front-loading is not only about order; it is about only
saying what is different about this tab.**

It also agrees with the URL, which leaves the default mode out for a related reason
([params.ts § modeParam](../../src/web/params.ts)) — so a reader who learns the rule in one place has
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

The `<title>` still in `index.html` is deliberately the bare app name. It is only what the tab says
between the first byte and React's first paint, and a page-specific guess made before the fetch would
be a wrong one.

## What would go wrong quietly

- **Putting the app's name first.** Looks fine on any one page. Only a window with six tabs shows the
  damage, and by then nobody connects it to the change. `tests/page-title.test.ts` asserts the app
  name is last on every page but the two homepages.
- **Adding the strapline "for consistency".** Same shape: reads as tidier, and is the thing Google's
  guidance names as the reason it overrides titles. There is a test for that too.
- **Spelling out `Contents` for the default mode.** Reads like completing a list. Costs every tab in
  the window eleven characters to say the thing they all have in common.
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
- **No `og:` or `twitter:` tags.** A shared Spideryarn link unfurls as nothing — the tab title is a
  runtime value and a link preview reads markup a server sent, so none of this work touches that.
  Separate job, and it needs server rendering we do not have — see [deployment.md](deployment.md).
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
