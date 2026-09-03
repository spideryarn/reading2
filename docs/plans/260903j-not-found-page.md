# A 404 page

Greg, 2026-09-03:

> We don't seem to have the notion of a 404 page. I tried heading to /asdf and it just took me to
> the homepage...

He is right, and it was on purpose. `parseRoute` in [`src/web/router.ts`](../../src/web/router.ts)
ends *"anything that isn't an article is the library, including nonsense"*, and
[library.md](../project/library.md) says so in as many words: *"There is no 404 page on purpose: a
mistyped address lands you on the shelf, which is both a useful place to be and self-explanatory."*

This plan reverses that decision for **addresses nobody minted**, and keeps it for the few places
where landing on the shelf is a real answer rather than a shrug.

## Why reverse it

One reason, and it is the one Greg's message is about: **a stale or mistyped link fails silently.**
The reader is shown a plausible page at an address that means nothing, and never learns the link
was wrong. That is the same failure shape as
[silent-success.md](../reusable/silent-success.md) — something reporting a good outcome while doing
nothing — pointed at a person instead of at a check.

**The SEO argument is not a reason, and an earlier draft of this plan said it was.** Every path is
already `X-Robots-Tag: noindex, nofollow` from [`vercel.json`](../../vercel.json),
`public/robots.txt` says `Disallow: /`, and the managed head in
[`index.html`](../../index.html) carries `<meta name="robots" content="noindex, nofollow">`. Nothing
on this site is indexable today, so *"`/asdf` returns 200 and indexes as a duplicate of the landing
page"* — which is what I told Greg in chat — describes a state we are not in. It becomes true only
on the day the header is narrowed to let shared articles be indexed, and the belt-and-braces meta
tag in the shell is already the guard for that. **No robots work in this change.**

## What the reader gets

A small page in the shape of `NotSharedPage` in
[`PublicChrome.tsx`](../../src/web/PublicChrome.tsx) — same measure, same heading weight — because
from the reader's side these are two answers to the same question, and a different-looking page
would suggest a different kind of problem. A heading, one sentence, and one link home.

The link goes to `/` in both cases and only its **label** changes with the session: a signed-in
reader is offered their shelf, a stranger the home page. Same href, because `/` already renders
whichever of those two the reader is entitled to (`App.tsx`), so nothing here has to know.

## Which addresses become it

`parseRoute` gains a `{ kind: "not-found" }` variant, returned from four places that answer
`library` today:

| Address | Today | After |
|---|---|---|
| `/asdf`, `/read`, `/read/a/b` | shelf | **not found** |
| `/read/Upper`, `/read/-leading`, a slug over 60 chars | shelf | **not found** |
| `/read/x/nonsense`, `/read/x/metadata/x` | shelf | **not found** |
| `/admin/nonsense`, `/privacy/cookies`, `/features/zoom` | shelf | **not found** |
| `/`, `""`, `/index.html` | shelf | shelf |
| `/add`, `/add/` | shelf | shelf |
| `/add/<not a URL>` | the add page's own refusal | unchanged |

The last three rows are the deliberate survivors. For `/add` the existing comment is the reason: *"A
bare `/add` — nothing to add — falls through to the shelf, which is where the add box is."*
`/index.html` is the root under its own name — the file this whole app is, served by Vite and by
every static host — and it had been the shelf only by accident of the fall-through; an app that
404s its own entry point is a bug report nobody should have to file. **And the fourth row is a
correction**: an earlier draft of this table said `/add/<not a URL>` reached the shelf, and it never
did. `addUrlFrom` hands back whatever follows the prefix without judging it, so that address is an
add route and `AddPage` says *that isn't a web address we can fetch* over the thing the reader
typed — a better answer than either of ours. GPT Sol found the claim, 2026-09-03.

`/read/Upper` is the interesting reversal — GPT Sol's stage 2
design argued *an address the server could never answer is a mistyped address*, and a mistyped
address landed on the shelf. The premise still holds; the conclusion changes now that there is
somewhere honest to send it.

**`/admin` for a reader who is not the administrator does *not* become this**, and I had it the
other way round for half an hour. The argument for changing it was that `App.tsx` justifies the
shelf by saying *"exactly as they would for `/nonsense` — router.ts has no 404 page by design"*, a
sentence this change falsifies, and that the house rule is *a thing you may not see does not exist*.
[admin.md](../project/admin.md) has already decided the opposite for this exact namespace, and
gives the reason: **403, not 404**, because *"the page's existence is in everybody's bundle
already"* — the admin components ship to every signed-in reader, so a 404 pretends about something
anyone can see is there. So the behaviour stands and only the stale justification in the comment is
replaced. `/admin/nonsense` *is* not-found, because that is an address rather than a refusal, which
matches the server: `/api/admin/anything` is 403 and `/api/administer` is 404.

## The status code, and what we are not doing

**Non-`/read/` addresses will still answer HTTP 200.** `vercel.json` rewrites
`/((?!api/).*)` to the static `index.html`, and a static file cannot choose a status.

The alternative was routing that rewrite through the serverless function so it could answer a real
404. Rejected: the function would need to know the client's whole route table to decide, which is a
second copy of `parseRoute` on the server and the exact drift this repo keeps writing postmortems
about — and it makes every unknown path a function invocation. With the whole site `noindex`, the
only party that reads the status is a link checker.

**And the addresses that arrive from links already answer correctly**, which is most of what a
status is for: `/read/:slug` is rewritten to the function, and `decidePublicPage` in
[`src/public/page.ts`](../../src/public/page.ts) already answers **400** for a malformed slug and
**404** for one that is absent or not shared, serving the unmodified shell either way. So
`/read/Upper` gets a 400 from the edge *and* this page in the browser, with no work here.

## Files

- `src/messages.ts` — the heading and the sentence, beside `NOT_SHARED`, per
  [copy.md](../project/copy.md).
- `src/web/NotFoundPage.tsx` — the page.
- `src/web/router.ts` — the variant, the four returns, and the header comment that currently
  promises no 404 page.
- `src/web/App.tsx` — both branches: the sixth exception to the signed-out gate, and the signed-in
  route. Plus the non-administrator comment, whose stated reason this change retires.
- `src/web/page-title.ts` — a `not-found` title variant. Every terminal page owns its tab, or the
  previous page's title stands over it (the bug behind the `not-shared` variant).
- `tests/router.test.ts`, `tests/page-title.test.ts`, `tests/public-read-rewrite.test.ts` — the
  existing assertions that say `library`, and a new one per row of the table above.
- `tests/not-found-page.test.tsx` — the page renders, and the label follows the session.
- `tests/not-found-route.test.tsx` — **`/asdf` through the real `App`**, which the two above cannot
  see between them. Added after the review; see below.
- `docs/project/library.md`, `docs/project/url-state.md`, `docs/project/admin.md` — the paragraphs
  that state the old rule. (An earlier draft listed `docs/project/copy.md`; it does not state it.)

## The cross-family review

GPT Sol reviewed the built code — `gpt-5.6-sol`, high effort, 2026-09-03 — and found six things.
Five were taken:

1. **The `/add/<not a URL>` claim was false**, in the plan, in `library.md` and in a comment. Fixed
   above, and the behaviour left alone.
2. **Nothing joined the router to `App`.** `tests/router.test.ts` stopped at `{ kind: "not-found" }`
   and `tests/not-found-page.test.tsx` rendered the component by hand, so replacing the branch in
   `App.tsx` with `<LandingPage />` — Greg's exact original bug — kept every test green. That is
   `tests/not-found-route.test.tsx`, and the mutation was run and watched to fail before it was
   believed.
3. **`/index.html` was about to become a 404**, having been the shelf by accident. Named explicitly.
4. **Five comments and doc lines were now false**, including one claiming a valid slug nobody owns
   reaches this page (it reaches `NotSharedPage`) and one claiming this page shares
   `NotSharedPage`'s corner logo (signed out it deliberately has none). All rewritten.
5. **"The link may be mistyped"** became "The address", because Greg reached it by typing rather
   than by following a link.

The sixth was that `router.ts` called the edge's 400 and the client's not-found *"the same
verdict"*, which they are not — one says the request was malformed, the other that there is nothing
here to read. The comment says two refusals now.

## The simpler option passed over

Doing nothing to `parseRoute` and instead giving `Library` a *"there's nothing at `/asdf`"* strip
when the address is unrecognised. It is fewer moving parts, and it is worse: the page would be
making a claim about the address in the address bar while showing content from a different one, and
every reader who arrives at the shelf normally pays for the branch. A wrong address is a different
page, not a decoration on a right one.
