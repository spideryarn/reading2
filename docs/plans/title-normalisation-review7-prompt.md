# Round 7 — the three round-6 blockers, and one new decision

You reviewed this six times. Round 6 returned three blockers and one nit. This is what
changed since, and nothing else. Please check the fixes rather than re-reviewing the
whole change, and say explicitly whether each blocker is closed.

Verdict line first: `LGTM` or `CHANGES REQUESTED`.

## What the change is

A shared `/read/<slug>` is served with a `<title>` the serverless function composed;
React then sets `document.title` over it. Anything the two disagree about is a tab that
changes in front of the reader. Ten findings so far — eight title divergences and two
address bugs; six of the ten you found by reading.

## Blocker 1 — "the client half still models production"

You wrote: *"If `App.tsx` omits `mode` — which compiles because it is optional — the real
tab loses the mode while the cross-product stays green."*

**Not fixed by teaching the test. `TitleSpec` is split by view**, so the state cannot be
built (`src/web/page-title.ts`):

    | { kind: "read"; title: string; view: "article"; mode: Mode }
    | { kind: "read"; title: string; view: Exclude<ArticleView, "article">; mode?: never }

`mode?: never` because a union rejects a bad object *literal* by excess-property checking
but accepts a value assembled in a variable.

Evidence: applying your exact mutation to `src/web/App.tsx:1143` now gives

    src/web/App.tsx(1143,30): error TS2345: Argument of type
    '{ kind: "read"; title: string; view: "article"; }' is not assignable to
    parameter of type 'TitleSpec'.

`VisitorPage`'s `view` prop narrowed from `ArticleView` to `Exclude<ArticleView,"article">`
to suit; it is only ever constructed with `"tweets"`.

**Please check:** is there still a route by which a real tab loses its mode? In
particular `PublicPages.tsx` and `Metadata.tsx`, and whether `mode?: never` actually bites
where a spec is built in a variable.

## Blocker 2 — "the server's final wiring remains untested"

You wrote: *"Changing `url: restored` to `url: path` compiles and drops all query state
… Required means 'some string,' not 'the restored string.'"*

**The argument is gone.** `servePublicReadPage` now takes the request:

    req: Pick<IncomingMessage, "method" | "url">;

`src/vercel.ts` already does `req.url = restored` — the same field `handleApi` routes on —
and the call is `servePublicReadPage({ req, res, slug, shell })`. There is no separate
address to get wrong, and the mode/view derivation stayed inside the function.

Evidence: the **compiled** `api-dist/vercel.js` driven against the real local Postgres,
which is the artifact that deploys:

    no mode            "The Mythology Of Conscious AI · Spideryarn"
    mode=glossary      "The Mythology Of Conscious AI · Glossary · Spideryarn"
    ?about=1           "The Mythology Of Conscious AI · Metadata · Spideryarn"
    ?about=0           "The Mythology Of Conscious AI · Spideryarn"
    ?add=…%3Fabout%3D1 "The Mythology Of Conscious AI · Spideryarn"
    ?%61bout=1         "The Mythology Of Conscious AI · Metadata · Spideryarn"
    unknown slug       404, bare shell title

**Please check:** is `req.url` genuinely the restored URL at that point for every path
that reaches the call, and is there any remaining single-token edit in `src/vercel.ts`
that silently drops the query?

## Blocker 3 — the tenth, and what it says about the test

`redirectsToMetadata` treated a `?` inside a value as a parameter boundary.

`src/read-address.ts` now has `queryPairs` (only the first `?` begins a query),
`isMetadataPair` and `isLegacyAboutPair`, **both decoding key and value**, per your
recommendation — so `%61bout=1`, `about=%31` and `panel=%61bout` are the literal forms,
while untouched pairs stay byte-for-byte. `liftLegacyAbout` in `src/web/router.ts` calls
`isLegacyAboutPair` **to decide and to remove**, so decision and removal cannot diverge —
which is how the ninth bug worked.

**And the test lesson, which I think is the real content of your finding:** equality
between two halves is blind to both halves being wrong the same way. Every row of the
corpus in `tests/address-settling.test.ts` now declares the view it should settle on, and
that is checked before the equality.

Evidence — three mutations, each red:

    old raw regex back        → "?add=https://x.test/a?about=1: settles on the metadata
                                 view, and it should be the article view" (and 3 more)
    queryPairs lastIndexOf    → same rows red
    decode the decision but
    not the removal           → red (the ninth bug's shape)

One existing case had to be rewritten rather than kept: it asserted `%61bout=1` stays on
the article, which was the old raw-matching rule. It is now written as the invariant that
survives the rule change — *a fragment must not change which page you land on* — with two
absolute controls beside it.

**Please check:** is `queryPairs`/`keyValue` right about `+`, about a pair with no `=`,
about a repeated `about=`, and about a malformed escape? And is the anchored corpus
actually anchored, or have I just moved the modelling one step along — i.e. could both
halves still agree on something wrong that the declared views don't cover?

## The nit

Counts made consistent: ten findings, eight of them title divergences.

## One thing outside the blockers

`public/robots.txt` gained `Allow: /read/` groups for `facebookexternalhit` and
`Twitterbot`, on Greg's instruction, so a shared link draws a card in Meta's apps.
`X-Robots-Tag: noindex, nofollow` and the robots meta are untouched. Tests in
`tests/public-read-rewrite.test.ts` pin both lines for both bots and deliberately do not
model crawler semantics. **Please check I have not opened more than I think** — in
particular whether a named group without its own `Disallow` would be an open door, and
whether the composed head can ever be served for a non-public article.

## Gates

- `npm run typecheck`: clean for every file of mine. Remaining errors are peers'
  uncommitted `evals/toc-structure/run.ts` and `tests/sketch-scene.test.ts`.
- Both builds pass. Biome clean on all touched files.
- 202 tests pass across the nine affected files. Five files fail across the whole suite,
  all traced to peers' uncommitted work (`src/db/schema.ts`, `docs/plans/reader-profile.md`,
  and a supabase mock reached through unmodified files).

## The diff

```diff
diff --git a/docs/project/page-titles.md b/docs/project/page-titles.md
index 54541d1..5551d54 100644
--- a/docs/project/page-titles.md
+++ b/docs/project/page-titles.md
@@ -115,7 +115,7 @@ characters at the end of a string that is already being cut. **Front-loading is
 saying what is different about this tab.**
 
 It also agrees with the URL, which leaves the default mode out for a related reason
-([params.ts § modeParam](../../src/web/params.ts)) — so a reader who learns the rule in one place has
+([params.ts § modeParam](../../src/web/params.ts), over the list in [modes.ts](../../src/modes.ts)) — so a reader who learns the rule in one place has
 learned it in both.
 
 ### What is deliberately *not* in the title
@@ -276,9 +276,281 @@ that here, because the title is announced: a flicker nobody sees is an interrupt
 Until the threshold passes the previous title stands, which is exactly what a browser does during a
 real page load.
 
-The `<title>` still in `index.html` is deliberately the bare app name. It is only what the tab says
-between the first byte and React's first paint, and a page-specific guess made before the fetch would
-be a wrong one.
+The `<title>` in `index.html` is deliberately the bare app name. It is what the tab says between the
+first byte and React's first paint, and a page-specific guess made before the fetch would be a wrong
+one. **One route no longer uses it**: a shared `/read/<slug>` is served with a real title composed
+from the database — the next section.
+
+## The server writes the title first now, and both sides use one function
+
+Since 2026-08-29 a shared `/read/<slug>` is not served as the bare shell. A small function composes
+the `<head>` — `<title>`, `og:`, `twitter:` — from the database before the bundle loads, for public
+articles only, so that a pasted link previews as something. That closed the "no `og:` tags" question
+this page carried for two days. [`src/public/page-head.ts`](../../src/public/page-head.ts), and
+[public-read-only-access.md](../plans/public-read-only-access.md) § Stage 2.
+
+It also created a new way to be quietly wrong. React still mounts and still assigns
+`document.title`, **over the top of a title that was already there and already right**. So whatever
+the two disagree about is a tab that changes in front of the reader, a second after the page arrives.
+
+They did disagree. The server ran the title through `headText`
+([`src/html.ts`](../../src/html.ts)) — internal runs of whitespace collapsed, control characters
+became a space, bidi overrides dropped — and the client only trimmed the ends and cut to length. An
+article titled `Two  spaces` was served as `Two spaces` and then rewritten to `Two  spaces`. GPT Sol
+found it reviewing slice 1; it was pinned as a divergence nobody had chosen, and put to Greg, who
+left the call to the implementer (2026-08-30).
+
+**The call: the server's normalising wins, the client's clamp wins.** Each side kept the rule it had
+the better reason for.
+
+| | The rule that won | Why that side |
+|---|---|---|
+| Normalising | the server's | An RLO reverses display order — `A‮gnp.exe` shows as `A exe.png` — and a newline in a `<title>` renders differently in every consumer of it. There is no argument for the tab being the one place an invisible direction change survives. |
+| Clamping | the client's | A word-boundary cut with an `…` is what a reader wants in a tab, a bookmark and a history entry: the ellipsis says "there was more". The server only had the hard cut because `headText` also serves `og:title`. |
+
+Both now call **`documentTitle`** in [`src/title-text.ts`](../../src/title-text.ts), which is the
+whole of the guarantee: two copies of one rule is one place for it to drift, and the drift is what
+happened. That file sits at `src/` rather than under `src/web/` because
+[`page-title.ts`](../../src/web/page-title.ts) imports React and nothing the public function reaches
+may import anything under `src/web/` — the standing answer here is to move the shared thing into a
+module that imports almost nothing — `src/html.ts` for the normaliser, plus the two vocabularies a
+title is built from, [`src/modes.ts`](../../src/modes.ts) and
+[`src/read-address.ts`](../../src/read-address.ts), which are leaves themselves.
+
+**What still differs, on purpose:** `og:title` and `twitter:title` drop the ` · Spideryarn` suffix
+and clamp hard at 120 with no ellipsis. That is a difference between *a tab* and *a card* — different
+sinks, read by different things — rather than between two copies of one rule. A card already carries
+`og:site_name`, so repeating the app's name spends the visible half of it saying one word twice, and
+an `…` in published metadata is a claim that the title contained one.
+
+`tests/page-head.test.ts` § *the one title rule, applied by both sides* is the check, and its expected
+strings are written out rather than computed from either side — an expectation spelled
+`documentTitle(t)` would agree with every possible behaviour of `documentTitle`, which is how a test
+about two things that must agree quietly becomes a test about nothing.
+
+### The other two ways the two sides disagreed
+
+The whitespace one above was the finding. Auditing for more of the same shape — *two sources
+answering "what should the tab say"* — turned up two others, both of which shipped with the server
+head and neither of which any existing test could reach.
+
+**The fallback chain, fixed 2026-08-30.** `loadHead` answered `title ?? headingTitle`, and the
+article payload's `metaFrom` ([`src/public/dto.ts`](../../src/public/dto.ts)) answers
+`title ?? headingTitle ?? slug`. They agree for every article that has a title or an `<h1>`, which is
+nearly all of them — which is exactly why nothing caught it. For an article with neither, the tab said
+`Untitled · Spideryarn` and then changed to the slug. `loadHead` has the third link now, and there is
+a fixture with neither of the first two, because **the corpus could not previously reach the
+disagreement at all**: `a public article with neither a title nor an <h1>` in
+`tests/public-visibility-pg.test.ts`. GPT Sol found this one in the last minutes of a review that
+then ran out of time.
+
+**`Loading…`, fixed 2026-08-30.** This is the one the server head *caused* rather than exposed.
+`ArticlePage` replaces the tab with `Loading…` once a fetch passes `SLOW_AFTER_MS` (600ms — a cold
+serverless start against Postgres, routinely). Before the server composed heads that was strictly an
+improvement, because the tab started at the bare app name. Afterwards it is a step backwards: a
+shared link arrives with the article's real title, and this would replace it with `Loading…` and then
+put it back, announcing both to a screen reader.
+
+`articleWaitTitle` in [`page-title.ts`](../../src/web/page-title.ts) is the rule, and it is the one
+this component already followed for a fast fetch: **do not replace a title that is already right.**
+Two guards, both necessary and each with a case that fails without it —
+
+- the composed head must be about *this* slug, or a reader who has navigated on would keep a title
+  about the article they left;
+- the tab must *still be showing* it, or a reader who goes `/read/a` → `/read/b` → back to `/read/a`
+  would have b's title left standing over a's loading page. The `og:url` still names `a`, so the slug
+  check alone passes; comparing the string self-expires the moment anything writes a different one.
+
+An **error** still replaces it, deliberately. `Loading…` is a claim that the right title is coming;
+`Couldn't open` is a claim that it is not, and a broken page must not go on advertising the article
+it failed to show.
+
+The signal is the `og:url` the head already carries, read once at module load — not a marker of its
+own, because a second element meaning the same thing is a second place for the two to disagree, which
+is the whole subject of this section.
+
+### And the fourth: the mode
+
+Found by GPT Sol reviewing the three fixes above, 2026-08-30, and it is the one worth understanding
+because of *why* nothing else found it.
+
+`/read/<slug>?mode=glossary` was served as `Article · Spideryarn` and then rewritten by React to
+`Article · Glossary · Spideryarn`. The rewrite in `vercel.json` preserves the query, so the mode was
+there to be read; the transport simply passed the slug on and dropped the rest.
+
+There is a seeded fuzz over 20,000 generated titles guarding the server/client equality, and it could
+not see this. Every case it generates fixes `view: "article"` and leaves `mode` absent — so it varies
+the title's *characters* exhaustively while holding the one axis this bug lives on completely still.
+Sol's sentence is the one to keep:
+
+> The missing dimension is title state, not title characters.
+
+That is a general lesson about corpora, not a fact about this bug: a generator is thorough along the
+axes it varies and blind along every axis it fixes, and the blindness is invisible from inside the
+results. `tests/page-head.test.ts` now loops over `MODES` itself, read from
+[`src/modes.ts`](../../src/modes.ts) rather than listed, so a tenth mode arrives in the check without
+anyone remembering to add it.
+
+The server learns the mode rather than the client dropping it, because the client's rule — the mode
+distinguishes tabs, so it belongs in the title — is the one with the argument behind it (§ *The
+default mode leaves no trace* above). `readMode` in [`src/vercel.ts`](../../src/vercel.ts) reads it,
+and resolves anything unrecognised to the default through the same `isMode` the client's `modeParam`
+uses, so a `?mode=` from a future version degrades to the article on both sides identically. The mode
+reaches the `<title>` only: `og:title` and `og:url` are about the article, not about which panel the
+person who shared it happened to have open.
+
+That move is why `MODES`, `Mode` and `DEFAULT_MODE` now live in `src/modes.ts` instead of
+`src/web/params.ts` — nothing the serverless function reaches may import from `src/web/`. `params.ts`
+re-exports all three, so no component knows it moved.
+
+### And a fifth: the legacy metadata addresses
+
+The article's details have been in three places — `?about=1`, then `?panel=about`, now
+`/read/<slug>/metadata`. [`main.tsx`](../../src/web/main.tsx) rewrites both old spellings on the way
+in, before React draws anything.
+
+`/read/x/metadata` is **two** path segments, so `vercel.json`'s `/read/:slug` never matches it and it
+falls to the SPA catch-all — which is why the view axis looked safe. `/read/x?about=1` is **one**
+segment. It matched, the server composed the *article's* title, and the client then turned the
+address into the metadata page: `Article · Spideryarn` → `Article · Metadata · Spideryarn`, or with a
+mode on it, `Article · Glossary · Spideryarn` → `Article · Metadata · Spideryarn`.
+
+GPT Sol found this one too, 2026-08-30, after I had checked the direct route and written down that
+the axis was covered. **The direct route being safe is not the axis being safe** — a legacy address
+is a second door into the same view, and it does not look like the thing it becomes.
+
+`redirectsToMetadata` in [`src/read-address.ts`](../../src/read-address.ts) is the predicate, and
+`main.tsx` calls it rather than keeping the pattern it used to hold, so there is one answer rather
+than two. The server composes `· Metadata ·` for those addresses and drops the mode, exactly as
+`readTitle` does for a non-article view. `about=0` is the case that separates "contains `about=`"
+from "becomes the metadata page": it meant the panel was shut, it is stripped from the URL, and the
+reader stays on the article — so the server goes on composing the article's title for it.
+
+### Sixth and seventh: the two older legacy entrances
+
+Same shape as the fifth, and I did not learn it the first time. `/?slug=x` and `/?add=<url>` are
+addresses from when everything was a parameter on one page. Neither was constrained to the root, so
+both fired under `/read/` too:
+
+- `/read/a?slug=b` — the server composes article **a**'s title; `main.tsx` rewrites the address to
+  `/read/b`.
+- `/read/a?add=https://example.com/x` — the server composes article **a**'s title; `canonicalAddHref`
+  rewrites the address to `/add/…`, which is not an article page at all.
+
+Both now read only on `/`, which is what [url-state.md](url-state.md) has always described them as.
+The `/add/<url>` **path** form is untouched and canonical wherever it appears.
+
+GPT Sol found these in the third round, after I had twice written that the view axis was covered.
+The lesson, which took three rounds to land: **enumerating the routes will not find a legacy
+entrance, because a legacy entrance is not a route.** It is a query parameter that turns one page
+into another, before the router ever sees it.
+
+There is a second consequence, and it is the one to keep. Constraining `?add=` to the root means the
+auth callback is now safe from being folded into an ingest for *two* independent reasons — the
+`onCallback` guard in `main.tsx`, and the pathname. That is defence in depth, and it is also how a
+control quietly stops testing anything: `tests/router.test.ts` had a case whose whole premise was
+"`?add=` is read from the query wherever it appears". It now proves each guard separately, with a
+positive control on `/` so that a `null` is evidence about the pathname rather than about a function
+that has stopped reading `?add=` at all.
+
+### The one exception: an owner's private rename
+
+Everything above is in service of one guarantee — the tab does not change when React mounts. There is
+exactly one place it still does, and it is a decision.
+
+`articles.title_override` is the owner's private name for a piece. The public head must never carry
+it, because that head is served to strangers ([security-map.md](security-map.md)); the owner's own
+payload deliberately applies it. So an **owner** hard-loading their own renamed public article sees
+the extracted title for a moment and then their own name for it.
+
+Nobody else can see this. A stranger, a signed-in stranger and the owner all get byte-identical
+*public* responses, so the change is visible only to the one person who already knows both strings.
+The alternative — putting the override in the public head so the two agree — is a disclosure, and no
+tab is worth that. Pinned in `tests/public-visibility-pg.test.ts`, with the non-disclosure asserted
+first, because that is the half that must never regress.
+
+### The eighth, which is why the rest of this section is now one test
+
+`/read/a?%61bout=1#spya-k3m9qt`. The server reads the raw query, sees `%61bout`, and says: the
+article. The client lifts the fragment into `?at=` — and did that through `URLSearchParams`, which
+**reserialises the whole query**, so `%61bout=1` became `about=1`, and the metadata rewrite two steps
+later fired on a parameter that had not been there when the server looked.
+
+Neither rewrite is wrong on its own. It is an **interaction**, and it was invisible because
+`main.tsx` performed the four rewrites as four `history.replaceState` calls at module scope — side
+effects nothing can call. Each had tests; the sequence had none.
+
+Two things changed, and the second is the more important:
+
+1. **The query is edited as text throughout.** That was already this file's rule for `?slug=` and
+   `about=` — round-tripping re-encodes as it serialises, and `?cols=0,1` comes back as
+   `?cols=0%2C1`, still correct and no longer readable ([params.ts](../../src/web/params.ts) spells
+   those commas out on purpose). The hash rewrite was the one breaking the rule, and it was mangling
+   those commas too.
+2. **The sequence is one pure function** — `settleAddress` in [`router.ts`](../../src/web/router.ts).
+   `main.tsx` calls it once. That also collapses four `onCallback` guards into one, so a fifth
+   rewrite is exempt from the auth callback *by construction* rather than by the person adding it
+   remembering.
+
+### Eight fixed one at a time is not a fix
+
+**The count, since it keeps moving:** ten findings in all — the eight title divergences listed above,
+plus two address bugs that are not title divergences at all (the ninth, a stale `?at=` when its key
+was percent-encoded; the tenth, below). Six of the ten were found by a reviewer reading the code,
+three of those on axes this document had already claimed were covered.
+
+Each of the eight got a test naming its own case, and that is exactly the shape of testing that let
+the next one through. **A list of the cases somebody thought of is not a statement about the class.**
+
+So the class is now stated as one test:
+[`tests/address-settling.test.ts`](../../tests/address-settling.test.ts) crosses every path shape
+against every query parameter this app has ever recognised against every hash shape.
+
+It compares the *real* functions on both sides — `readSlug`, `readMode`, `viewFor` and `composeShell`
+against `settleAddress`, `parseRoute` and `pageTitle` — so it is the two behaviours, not two models of
+them. That is only possible because the rewrite sequence became a function; it is the reason it did.
+
+### An equality test is only as good as its anchor
+
+The first version of that cross-product asserted one thing:
+
+    what the server puts in <title>  ===  what the client ends up setting
+
+which catches every case where the two *disagree*, and says nothing whatever about a case where they
+agree on the wrong answer. GPT Sol found one on 2026-08-30 — the **tenth**.
+`redirectsToMetadata` matched `(^|[?&])about=1`, so it read a `?` inside another parameter's *value*
+as a parameter boundary:
+
+    /read/x?add=https://x.test/a?about=1
+
+went to the metadata page, both halves concurring. Only the first `?` begins a query; after that only
+`&` separates pairs, and [`queryPairs`](../../src/read-address.ts) is now the one place that knows it.
+
+So every row of the corpus states **which view it should settle on**, and both halves are checked
+against that rather than only against each other. The fix and the lesson are separate: the fix is a
+boundary, the lesson is that two halves of a system can share a bug, and equality between them is
+blind to exactly that by construction.
+
+Restoring any of six faults reddens the file, verified: the transport dropping the mode, the server
+not predicting the metadata rewrite, the hash rewrite reserialising the query, `readSlug` matching a
+two-segment view, the raw-text metadata predicate, and `queryPairs` taking the last `?` rather than
+the first. It carries a control requiring more than forty addresses to actually reach the reading
+view, because a cross-product that compares nothing also reports no disagreement.
+
+### Two of the ten are now compile errors instead
+
+Better than a test that catches a mutation is a mutation that will not compile, and two of these got
+there in the end:
+
+- **`TitleSpec` splits the reading view from the other two.** `mode` was one optional field, so
+  deleting it from the call in `App.tsx` compiled and silently cost the tab its `· Glossary`. The
+  reading-view variant now requires `mode` and the other two forbid it with `mode?: never` — the
+  `never` because a union rejects a bad *literal* by excess-property checking but accepts a value
+  assembled in a variable.
+- **`servePublicReadPage` takes the request, not an address copied out of it.** It went through three
+  shapes in a day: the caller derived mode and view; then it passed `url`; and `url: restored` versus
+  `url: path` both compile while only one carries the query. It reads `req.url` now — the same field
+  `handleApi` routes on — so there is no wiring left to get wrong.
 
 ## What would go wrong quietly
 
@@ -316,9 +588,6 @@ be a wrong one.
   title on a failed form, specifically so a screen reader announces it first. We have one failure
   title (`Couldn’t open`) and no forms that fail this way; if the shelf ever grows one, that is the
   pattern to copy.
-- **No `og:` or `twitter:` tags.** A shared Spideryarn link unfurls as nothing — the tab title is a
-  runtime value and a link preview reads markup a server sent, so none of this work touches that.
-  Separate job, and it needs server rendering we do not have — see [deployment.md](deployment.md).
 - **Nothing here has met a real screen reader.** The tests prove the region holds the right text at
   the right moment; they cannot prove a word was spoken. VoiceOver/Safari and NVDA/Firefox are the
   check, and it has not been run. Until it has, treat the announcement half of this as designed
diff --git a/public/robots.txt b/public/robots.txt
index 8cb1045..b81108d 100644
--- a/public/robots.txt
+++ b/public/robots.txt
@@ -1,4 +1,5 @@
-# Spideryarn is a private beta. None of it is meant to be listed yet.
+# Spideryarn is a private beta. None of it is meant to be listed yet — with one
+# deliberate hole, at the bottom of this file, for link previews.
 #
 # Why this file exists at all: Vercel puts `x-robots-tag: noindex` on the
 # generated *.vercel.app addresses automatically and does NOT put it on a custom
@@ -15,3 +16,33 @@
 
 User-agent: *
 Disallow: /
+
+# The hole, and it is only wide enough for a card.
+#
+# Pasting a shared /read/<slug> link into a chat should show its title and gist.
+# The services that draw those cards fetch the page like any other crawler, so a
+# blanket Disallow means no card — a bare URL, which is what slice 2 exists to
+# fix. Slack unfurls anyway (Slackbot honours only rules addressed to it by
+# name); Meta's crawler obeys the `*` group above, so before this it showed
+# nothing in WhatsApp, Messenger, Facebook or Instagram.
+#
+# **This is not permission to index.** These two fetch a page to draw a card,
+# and neither puts it in a search result. Every response still carries
+# `X-Robots-Tag: noindex, nofollow` (vercel.json) and every page still carries
+# the matching `<meta name="robots">` (src/public/page-head.ts) — that pair is
+# what actually keeps this out of search, and it is untouched.
+#
+# Nothing new is exposed. A head is composed only for an article whose owner set
+# `visibility = 'public'`, and anybody holding the link can already fetch it.
+# A private slug answers with the plain shell, to these two as to anyone else.
+#
+# A bot obeys exactly one group — the most specific one naming it — so each
+# needs its own Disallow as well; they do not inherit the `*` group above.
+
+User-agent: facebookexternalhit
+Allow: /read/
+Disallow: /
+
+User-agent: Twitterbot
+Allow: /read/
+Disallow: /
diff --git a/src/html.ts b/src/html.ts
index 989999d..959359d 100644
--- a/src/html.ts
+++ b/src/html.ts
@@ -1,7 +1,7 @@
 /**
  * **Turning somebody else's text into markup, in one place.**
  *
- * Two functions and no imports. Everything here is about the moment a string we
+ * Three functions and no imports. Everything here is about the moment a string we
  * did not write becomes part of a document we did: the extracted `<title>` of a
  * page, a caption a model produced, the gist that will be a `<meta>` tag on a
  * shared link. [security-map.md](../docs/project/security-map.md) counts the
@@ -75,6 +75,31 @@ const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
  */
 const CONTROLS = /[--]/g;
 
+/**
+ * **Steps 1-3 on their own: one line, single spaces, no bidi overrides.**
+ *
+ * Split out of `headText` so that the clamp is a separate decision from the
+ * cleaning, because the two sinks want the same cleaning and different clamps.
+ * `headText` clamps hard and adds nothing, which is right for an `og:title`; the
+ * page title clamps at a word boundary and adds an ellipsis, which is right for
+ * a tab. Before this was one function, the browser tab was normalised by the
+ * server and then *un*-normalised the moment React mounted and set
+ * `document.title` from its own, looser copy of the rule — a title with a double
+ * space or an RLO in it visibly changed. src/title-text.ts is where both callers
+ * now get the composition from; this is the piece of it that belongs next to the
+ * escaper.
+ *
+ * **Not "nothing invisible", which an earlier draft of this line claimed.** It
+ * removes the bidi controls and the C0/C1 range, and collapses what JavaScript's
+ * `\s` considers whitespace — which covers NBSP and the ideographic space but
+ * **not** U+200B ZERO WIDTH SPACE or U+2060 WORD JOINER, which survive intact.
+ * They are harmless in a title and a strip of them is a separate decision from
+ * this one; the claim was simply wider than the code. GPT Sol, 2026-08-30.
+ */
+export function normaliseText(value: string): string {
+  return value.replace(BIDI, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
+}
+
 /**
  * **Make a piece of somebody's text fit to be metadata**, before it is escaped.
  *
@@ -107,7 +132,7 @@ const CONTROLS = /[--]/g;
  *   description at 240.
  */
 export function headText(value: string, limit: number): string {
-  const cleaned = value.replace(BIDI, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
+  const cleaned = normaliseText(value);
   const points = [...cleaned];
   if (points.length <= limit) return cleaned;
   /* Trimmed again after slicing: the cut can land immediately after a space,
diff --git a/src/public/page-head.ts b/src/public/page-head.ts
index 5a7b82d..a657a28 100644
--- a/src/public/page-head.ts
+++ b/src/public/page-head.ts
@@ -34,6 +34,9 @@
  * `requireMarkersInHead` below now, and the build check calls the same function.
  */
 import { escapeHtml, headText } from "../html.js";
+import { DEFAULT_MODE, type Mode } from "../modes.js";
+import type { ArticleView } from "../read-address.js";
+import { APP_NAME, documentTitle } from "../title-text.js";
 import { safePublicCanonical } from "../urls.js";
 import type { PublicHead } from "../store/public-reader.js";
 
@@ -56,37 +59,32 @@ import type { PublicHead } from "../store/public-reader.js";
 export const PUBLIC_ORIGIN = "https://www.spideryarn.com";
 
 /**
- * The product name, and the separator between title segments.
+ * **The `<title>` and the `og:title` are two different strings, on purpose.**
  *
- * **Duplicated from src/web/page-title.ts on purpose**, and it is a real
- * duplication rather than an oversight: that module imports React, and this one
- * is reached by `src/public/routes.ts`, whose whole import graph is asserted
- * closed against the client and the writers (tests/public-imports.test.ts). Two
- * three-character constants are the cheaper of the two evils, and
- * tests/page-head.test.ts asserts that the title this file composes is
- * character-for-character the one `pageTitle()` composes, so the copies cannot
- * drift without a test going red.
+ * `documentTitle` — imported, not restated — is the tab: the article's title,
+ * normalised, clamped at a word boundary with an ellipsis, then ` · Spideryarn`.
+ * src/web/page-title.ts assigns that exact string when React mounts a moment
+ * later, so the tab does not change under the reader; src/title-text.ts is where
+ * both halves come from and why each rule went the way it did.
+ *
+ * `og:title` below is composed here instead, with `headText` at a larger limit
+ * and no suffix. A card is a different sink from a tab: it already carries
+ * `og:site_name`, so repeating the app's name spends the visible half of it
+ * saying one word twice, and an `…` in published metadata is a claim that the
+ * title contained one.
  */
-const APP_NAME = "Spideryarn";
-const SEP = " · ";
 
 /**
- * The three clamps, in code points, from the design § 6.
+ * The two clamps this file owns, in code points, from the design § 6.
  *
- * They differ because the sinks differ: a tab and a bookmark show the page
- * title, a link card shows the `og:` pair, and a card's description gets a
- * paragraph's worth. `headText` does the clamping — see src/html.ts for why it
- * is by code point rather than by `.length`.
+ * They differ because the sinks differ: a link card shows the `og:` pair, and a
+ * card's description gets a paragraph's worth. `headText` does the clamping —
+ * see src/html.ts for why it is by code point rather than by `.length`.
  *
- * `PAGE_TITLE` is 64 because that is `CLAMP` in src/web/page-title.ts, so the
- * server's title and the one React sets a moment later agree. **One deliberate
- * difference**: the client's `clamp()` cuts at a word boundary and appends an
- * ellipsis, and `headText` does neither. A title over 64 code points therefore
- * gains an `…` when React mounts. Metadata is the reason — an ellipsis in an
- * `og:title` is a claim that the title contained one — and the tab is the only
- * place the two are ever visible together, for the moment before mount.
+ * The page title's clamp is not here: it is `CLAMP` in src/title-text.ts,
+ * applied by the `documentTitle` this file calls, because the client applies the
+ * same one to the same string.
  */
-const PAGE_TITLE = 64;
 const CARD_TITLE = 120;
 const DESCRIPTION = 240;
 
@@ -120,7 +118,12 @@ export const MANAGED_HEAD_END = "<!-- spideryarn:managed-head:end -->";
  * function cannot understand is a broken build in every case, not only when
  * somebody happens to share a link.
  */
-export function composeShell(shell: string, head: PublicHead | null): string {
+export function composeShell(
+  shell: string,
+  head: PublicHead | null,
+  mode: Mode = DEFAULT_MODE,
+  view: ArticleView = "article",
+): string {
   const start = shell.indexOf(MANAGED_HEAD_START);
   const end = shell.indexOf(MANAGED_HEAD_END);
   requireOnce(shell, MANAGED_HEAD_START, start);
@@ -143,7 +146,9 @@ export function composeShell(shell: string, head: PublicHead | null): string {
   const indent = shell.slice(lineStart, start);
   const gap = /^[ \t]*$/.test(indent) ? `\n${indent}` : "\n";
 
-  return shell.slice(0, start) + tags(head).join(gap) + shell.slice(end + MANAGED_HEAD_END.length);
+  return (
+    shell.slice(0, start) + tags(head, mode, view).join(gap) + shell.slice(end + MANAGED_HEAD_END.length)
+  );
 }
 
 /**
@@ -208,11 +213,13 @@ function requireOnce(shell: string, marker: string, at: number): void {
  * in that order and exactly once each — normalise, then escape at the moment it
  * becomes markup. src/html.ts explains why those are two jobs.
  */
-function tags(head: PublicHead): string[] {
-  /* "Untitled" rather than an empty tag, matching `readTitle()` in
-     src/web/page-title.ts, so a link to an article with no title of its own
-     previews as the app does. `||` and not `??`: a title of `"   "` normalises
-     to `""`, which is as titleless as `null`. */
+function tags(head: PublicHead, mode: Mode, view: ArticleView): string[] {
+  /* "Untitled" rather than an empty tag, matching `articleTitle()` in
+     src/title-text.ts. **Effectively unreachable from `loadHead`**, which falls
+     back to the slug and so always hands over a string — it is the defence for
+     the paths that compose a head without one, and for a title that normalises
+     to nothing. `||` and not `??`: a title of `"   "` normalises to `""`, which
+     is as titleless as `null`. */
   const cardTitle = headText(head.title ?? "", CARD_TITLE) || "Untitled";
   /* `head.gist` is already `root_gist` — itself the gist → summary → excerpt
      fallback from src/library-scalars.ts. When there is none, all three
@@ -221,7 +228,7 @@ function tags(head: PublicHead): string[] {
      wrong thing is worse than none. */
   const description = head.gist === null ? "" : headText(head.gist, DESCRIPTION);
 
-  const out = [MANAGED_HEAD_START, `<title>${escapeHtml(documentTitle(head.title))}</title>`];
+  const out = [MANAGED_HEAD_START, `<title>${escapeHtml(documentTitle(head.title, mode, view))}</title>`];
   if (description) out.push(meta("name", "description", description));
   /* **Unconditional, and it stays that way in this slice.** Composing a head
      changes what a card looks like; it changes crawler exposure not at all. The
@@ -266,17 +273,3 @@ function tags(head: PublicHead): string[] {
 function meta(key: "name" | "property", id: string, content: string): string {
   return `<meta ${key}="${id}" content="${escapeHtml(content)}" />`;
 }
-
-/**
- * **The `<title>` text**, before escaping — the article's own title, clamped,
- * then the app's name.
- *
- * Exported and then called by `tags()` above rather than being a comment about
- * what `tags()` does inline, so that the value tests/page-head.test.ts compares
- * against `pageTitle()` from src/web/page-title.ts is *the same value that
- * reaches the document*. A helper the tests use and the code does not is a
- * helper that can be right while the code is wrong.
- */
-export function documentTitle(title: string | null): string {
-  return `${headText(title ?? "", PAGE_TITLE) || "Untitled"}${SEP}${APP_NAME}`;
-}
diff --git a/src/public/page.ts b/src/public/page.ts
index 80a9239..63ce257 100644
--- a/src/public/page.ts
+++ b/src/public/page.ts
@@ -86,13 +86,14 @@
  * static rule and moves the header here; see the plan.
  */
 
-import type { ServerResponse } from "node:http";
+import type { IncomingMessage, ServerResponse } from "node:http";
 
 import { isSlug } from "../ingest.js";
 import { errorFields, log } from "../log.js";
 import { captureFailure } from "../monitoring.js";
 import type { PublicHead } from "../store/public-reader.js";
 import { pgPublicReader } from "../store/public-reader.js";
+import { readMode, viewFor } from "../read-address.js";
 import { composeShell } from "./page-head.js";
 
 /**
@@ -269,21 +270,48 @@ async function loadHead(slug: string, read: (slug: string) => Promise<PublicHead
  * correct in every unit test while the truth lived somewhere no test reached.
  */
 export async function servePublicReadPage(args: {
+  /**
+   * **The request itself, rather than an address copied out of it.**
+   *
+   * This went through three shapes in one day, and the third is the point.
+   * First the caller derived the mode and the view and passed those; a test
+   * could reassemble the same two calls and stay green while `src/vercel.ts`
+   * quietly stopped passing one. Then the caller passed the whole `url`; that
+   * fixed the deriving but not the wiring, because `url: restored` and
+   * `url: path` both compile and only one of them carries the query. GPT Sol
+   * named both, 2026-08-30, the second with the exact mutation: *"Required means
+   * 'some string,' not 'the restored string.'"*
+   *
+   * So there is no address argument left to get wrong. `src/vercel.ts` has
+   * already put the restored URL on `req.url` — the same field `handleApi`
+   * routes on, so the two cannot be given different ideas of the address — and
+   * this reads it from there. The wiring is not a choice any more.
+   *
+   * Mode and view reach the `<title>` and nothing else. `og:title`,
+   * `twitter:title` and the canonical are about the article whichever of its
+   * pages was asked for, and whichever panel the person who shared it had open.
+   */
+  req: Pick<IncomingMessage, "method" | "url">;
   res: ServerResponse;
-  method: string;
   /** Already decoded exactly once, by `originalUrl`. Do not decode it again. */
   slug: string;
   shell: BuiltShell;
   read?: (slug: string) => Promise<PublicHead>;
 }): Promise<void> {
-  const { res, method, slug, shell } = args;
+  const { res, slug, shell } = args;
+  const method = args.req.method ?? "GET";
+  const url = args.req.url ?? "";
+  const mode = readMode(url);
+  /* The address may be a legacy spelling of the metadata page, which the client
+     rewrites before it draws anything — src/read-address.ts. */
+  const view = viewFor(url);
   const read = args.read ?? ((s: string) => pgPublicReader.loadHead(s));
 
   const wanted = READ_METHODS.includes(method) && isSlug(slug);
   const load = wanted ? await loadHead(slug, read) : null;
   const decision = decidePublicPage(method, slug, load, shell.sha256);
 
-  const body = composeShell(shell.html, decision.head);
+  const body = composeShell(shell.html, decision.head, mode, view);
   res.statusCode = decision.status;
   for (const [key, value] of Object.entries(decision.headers)) res.setHeader(key, value);
   res.setHeader("Content-Length", String(Buffer.byteLength(body, "utf8")));
diff --git a/src/store/public-reader.ts b/src/store/public-reader.ts
index d0c6457..c81aa5f 100644
--- a/src/store/public-reader.ts
+++ b/src/store/public-reader.ts
@@ -83,7 +83,17 @@ import { publicArticle, publicMetadata } from "../public/dto.js";
  */
 export interface PublicHead {
   slug: string;
-  /** The article's title, or its first `<h1>` when it has no title of its own. */
+  /**
+   * The article's title, its first `<h1>`, or its slug — the same three-step
+   * fallback `metaFrom` uses in src/public/dto.ts, because the client sets
+   * `document.title` from that one a second after this head is served, and any
+   * difference is a tab that changes in front of the reader.
+   *
+   * Still `string | null` rather than `string`: the type is the shape of a head,
+   * and src/public/page-head.ts composes a default one for the 404, 400 and 503
+   * paths where there is no article to have a title. `loadHead` itself now
+   * always has one.
+   */
   title: string | null;
   /** The description, from `root_gist` — already the gist/summary/excerpt fallback. */
   gist: string | null;
@@ -525,12 +535,23 @@ export const pgPublicReader: PublicArticleReader = {
 
       return {
         slug: found.slug,
-        /* `??` and not `||`: an empty-string title is not a title, but neither
+        /* **The slug is the last resort, and it is not optional.** `metaFrom`
+           in src/public/dto.ts is `title ?? headingTitle ?? slug`, and that is
+           the value React assigns to `document.title` a second after this head
+           was served. Without the third link the two chains disagree for an
+           article with neither a title nor an `<h1>`: the tab said
+           `Untitled · Spideryarn` and then changed to the slug in front of the
+           reader. GPT Sol found it, 2026-08-30; the fixture that can reach it is
+           `a public article with neither a title nor an <h1>` in
+           tests/public-visibility-pg.test.ts, and there was none before, which
+           is why nothing caught it.
+
+           `??` and not `||`: an empty-string title is not a title, but neither
            is it the *absence* of one, and the heading fallback is already `null`
            when there is no `<h1>` — so `||` would turn "" into null twice over
            and hide which of the two the row actually has. The composer clamps
            and escapes; deciding what is missing is this file's job. */
-        title: found.revision.title ?? found.revision.headingTitle,
+        title: found.revision.title ?? found.revision.headingTitle ?? found.slug,
         gist: found.revision.rootGist,
         canonical: found.revision.finalUrl,
       };
diff --git a/src/vercel.ts b/src/vercel.ts
index 1609193..79e12ca 100644
--- a/src/vercel.ts
+++ b/src/vercel.ts
@@ -46,6 +46,7 @@ import {
   withMonitoringScope,
 } from "./monitoring.js";
 import { UNEXPECTED_FAILURE } from "./messages.js";
+import { readMode } from "./read-address.js";
 import { builtShell, servePublicReadPage } from "./public/page.js";
 import { handleApi } from "./routes.js";
 import { health } from "./vercel-health.js";
@@ -200,6 +201,11 @@ export function originalUrl(raw: string): string | null {
  * reading URL and is left alone; `/read/` is one with an empty slug, which is a
  * 400 like any other malformed one.
  */
+/* Re-exported so the transport's own tests can reach it by the name they always
+   used. It moved to src/read-address.ts, beside `viewFor`, because the two ask
+   the same question of the same string and the server is not the only caller. */
+export { readMode };
+
 export function readSlug(path: string): string | null {
   const read = /^\/read\/(.*)$/.exec(path);
   if (read === null) return null;
@@ -296,12 +302,11 @@ async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
        with the reason nowhere a person can reach it, which is the exact failure
        api/index.js exists to have stopped happening. */
     if (slug !== null && shell) {
-      await servePublicReadPage({
-        res,
-        method: req.method ?? "GET",
-        slug,
-        shell,
-      });
+      /* `req.url` is `restored` — set above, and the same field `handleApi`
+         routes on. Nothing about the address is passed separately, because a
+         second copy of it is a second thing to get wrong; see the doc-comment
+         on `servePublicReadPage`. */
+      await servePublicReadPage({ req, res, slug, shell });
       return;
     }
 
diff --git a/src/web/App.tsx b/src/web/App.tsx
index 07210bd..ef0d42a 100644
--- a/src/web/App.tsx
+++ b/src/web/App.tsx
@@ -134,7 +134,7 @@ import { useComments } from "./useComments.js";
 import { ChatDialog, type ChatTarget } from "./ChatDialog.js";
 import { anchored, countByBlock, useChatAnchors } from "./useChatAnchors.js";
 import { PILL } from "./pill.js";
-import { pageTitle, useDocumentTitle } from "./page-title.js";
+import { articleWaitTitle, pageTitle, useDocumentTitle } from "./page-title.js";
 import { apiFetch, readJson } from "./lib/api.js";
 import { loadPublicArticle } from "./public-api.js";
 import type {
@@ -592,13 +592,22 @@ function ArticlePage({
    * than that here: the title is announced to a screen reader, so a flicker
    * nobody sees is an interruption somebody hears. Until then the previous
    * title stands, which is exactly what a browser does during a real page load.
+   *
+   * **And on a shared link it does not say `Loading…` at all**, because the
+   * server already put the article's real title in the tab and replacing it
+   * would be a step backwards. That decision is `articleWaitTitle` in
+   * page-title.ts, which is where the two guards it needs are explained; this
+   * component's job is to say which of the three states it is in.
    */
   useDocumentTitle(
-    access.kind === "error"
-      ? pageTitle({ kind: "error" })
-      : access.kind === "loading" && slow
-        ? pageTitle({ kind: "loading" })
-        : "",
+    articleWaitTitle(
+      access.kind === "error" ? "error" : access.kind === "loading" && slow ? "loading" : "ready",
+      slug,
+      /* Read at call time rather than captured: the question `articleWaitTitle`
+         asks is whether the tab *still* shows what the server put there, and a
+         value captured earlier could not answer it. */
+      typeof document === "undefined" ? "" : document.title,
+    ),
   );
 
   /* **The one branch with no corner wordmark**, and the reason is that
@@ -3451,21 +3460,25 @@ function useSummaryMode(article: Article, summaries: { entries: SummaryEntry[] }
 }
 
 /**
- * Diagram mode's band — the tree, drawn.
+ * Diagram mode's band — the article, drawn.
  *
  * Same shape as `SummaryBand` above and for the same reasons: `?diagram=` is
  * read here rather than in `Reader`, because it is meaningless outside this mode
  * and a subscription in the parent would cost every render of the reading view.
  *
- * **It takes no `slug` and fetches nothing.** Every number this panel needs is
- * already on the page — stage 4 wrote a gist onto every internal node, and the
- * block ranges give the sizes — so unlike chat, glossary, search and summary
- * there is no artefact to wait for, no job to run, and nothing to pay a model
- * for — and that is what `tree`, the default picture, is drawn from. **The
- * other three all spend a model call**, which is why the default is the free
- * one: opening a mode should not bill you. `useSimilar` and `useProjection`,
- * inside the panel, are what fetch for those three, each gated on its own
- * picture being the one on screen. See docs/project/diagram.md.
+ * **This component fetches nothing**, and that is a statement about this
+ * component rather than about the mode. The shape of the picture comes from
+ * `article.tree` and `article.blocks`, which the page already holds — so unlike
+ * chat, glossary, search and summary there is no artefact to wait for and no
+ * job to run here. The two hooks that do spend money live inside the panel,
+ * each gated on its own picture being the one on screen: `useSimilar` for
+ * Force's dotted lines, `useProjection` for the two scatters' dots. `slug` is
+ * passed for exactly that.
+ *
+ * All three pictures spend a model call since the free one — `tree`, the
+ * outline — was cut on 2026-08-30. Force is the default because it is the only
+ * one that draws something real before its answer lands. See
+ * docs/project/diagram.md.
  */
 function DiagramBand({
   slug,
diff --git a/src/web/PublicPages.tsx b/src/web/PublicPages.tsx
index 1eb0c2b..3498096 100644
--- a/src/web/PublicPages.tsx
+++ b/src/web/PublicPages.tsx
@@ -145,7 +145,11 @@ export function VisitorPage({
 }: {
   slug: string;
   article: Article;
-  view: ArticleView;
+  /* Never the reading view: this page exists *instead of* an article the link
+     does not carry. Narrower than `ArticleView` on purpose — the wide type let
+     it be built for the reading view, which would have put a mode-less tab on a
+     mode-bearing page. */
+  view: Exclude<ArticleView, "article">;
   gap: VisitorGap;
   /**
    * Which artefacts this piece has, for the bar's marked modes.
diff --git a/src/web/main.tsx b/src/web/main.tsx
index 8d761bf..e526732 100644
--- a/src/web/main.tsx
+++ b/src/web/main.tsx
@@ -3,8 +3,7 @@ import { createRoot } from "react-dom/client";
 import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
 import { LucideProvider } from "lucide-react";
 import { App } from "./App.js";
-import { CALLBACK_HREF, canonicalAddHref, parseRoute, readHref } from "./router.js";
-import { isSpideryarnId } from "../ids.js";
+import { CALLBACK_HREF, settleAddress } from "./router.js";
 import { startPerf } from "./perf.js";
 import { watchConnection } from "./offline.js";
 import { OfflineStrip } from "./OfflineStrip.js";
@@ -142,110 +141,26 @@ enableHistorySync();
  */
 const onCallback = new RegExp(`^${CALLBACK_HREF}/?$`).test(location.pathname);
 
-if (!onCallback) {
-  const canonicalAdd = canonicalAddHref(location.pathname, location.search, location.hash);
-  if (canonicalAdd) history.replaceState(history.state, "", canonicalAdd);
-}
-
 /**
- * Deep links used to be `/#spya-k6fpme`; position now lives in `?at=`.
- *
- * Rewritten before React mounts, for the same reason the hash was abandoned:
- * blocks carry their id in the HTML, so left in place the browser would scroll
- * to the block on its own, and then our restore would scroll again to offset it
- * under the sticky bars. Old links keep working; they just arrive in the new
- * spelling.
- *
- * **The hash beats an `?at=` that came with it**, which it did not until GPT
- * Sol's review on 2026-08-26. The article's own internal links are `#spya-…`
- * now (src/web/internal-links.ts), so ⌘-clicking one opens
- * `?at=<where you were>#<where you asked to go>` — two positions in one
- * address, and keeping the parameter meant the new tab opened at the paragraph
- * you had *left*. Nothing about that looks like a bug from the outside; the tab
- * opens, the article is there, and it is simply in the wrong place.
- *
- * The two are not equal claims. `?at=` is where the reader happened to be, put
- * there by scrolling; a fragment is somewhere they asked to go. Reading it as
- * the more recent of the two is right whichever way the link was made.
+ * **All four rewrites, in one call, behind one guard.**
+ *
+ * They used to be four `replaceState`s in a row here — side effects at module
+ * scope, which nothing can call. Each had tests of its own; the *sequence* had
+ * none, and that is where the eighth divergence lived: the hash rewrite ran the
+ * query through `URLSearchParams`, which reserialised `?%61bout=1` into
+ * `?about=1`, and the metadata rewrite two steps later then fired on a parameter
+ * the server had not seen. GPT Sol, 2026-08-30.
+ *
+ * `settleAddress` in router.ts is that sequence as a pure function, so the
+ * interactions are testable and the server can be checked against it over a
+ * cross-product of addresses (tests/address-settling.test.ts). It also means one
+ * `onCallback` guard rather than four: a fifth rewrite added inside it is exempt
+ * from the callback by construction, instead of by the person adding it
+ * remembering to.
  */
-const legacyAnchor = decodeURIComponent(location.hash.slice(1));
-if (!onCallback && isSpideryarnId(legacyAnchor)) {
-  const url = new URL(location.href);
-  url.hash = "";
-  url.searchParams.set("at", legacyAnchor);
-  history.replaceState(history.state, "", url);
-}
-
-/**
- * Which article used to be `/?slug=…`; it is now `/read/<slug>`.
- *
- * Rewritten here, before React mounts, so nothing downstream has to know two
- * spellings — App reads the path and only the path (router.ts). `replaceState`
- * rather than `push`, because the old address is not somewhere the reader
- * should be able to press Back into; it isn't a page they visited, it's a
- * spelling they arrived in.
- *
- * Every other parameter is carried across untouched, so an old link that
- * pinned columns and a position still lands exactly where it said it would.
- *
- * "Untouched" is why the rest of the query string is edited as TEXT rather than
- * through `URLSearchParams`. Round-tripping it re-encodes as it serializes, and
- * `?cols=0,1` comes back out as `?cols=0%2C1` — still correct, still parsed the
- * same, and no longer readable. Those commas are spelled out on purpose so that
- * someone handed a link can see what it is going to show them (params.ts).
- */
-const legacySlug = new URLSearchParams(location.search).get("slug");
-if (!onCallback && legacySlug) {
-  const rest = location.search
-    .replace(/^\?/, "")
-    .split("&")
-    .filter((pair) => pair !== "" && !pair.startsWith("slug="))
-    .join("&");
-  history.replaceState(history.state, "", readHref(legacySlug, rest));
-}
-
-/**
- * The article's details have been in three places. They opened in the masthead
- * as `?about=1`, then became a drawer panel as `?panel=about`, and are now a
- * page of their own at `/read/<slug>/metadata`.
- *
- * **One pass, not one per spelling.** Two hops would put a superseded address
- * in the middle of a rewrite chain and leave whoever adds the fourth spelling
- * deciding which hop to bolt onto. So: recognise either spelling, strip *every*
- * `about=` and `panel=about` from the query, and send an article to its
- * metadata page. Third rewrite in this file and the same shape as the other
- * two — one spelling reaches React, and every old address keeps working. Done
- * as text rather than through `URLSearchParams` for the reason spelled out
- * above: a round trip re-encodes `?cols=0,1` into something still correct and
- * no longer readable.
- *
- * `about=0` is stripped but does **not** redirect. It meant the panel was shut,
- * and a shut panel is not a reason to send anybody to a different page — but it
- * is a dead parameter, and this file has been claiming since the drawer landed
- * that the new spelling for a shut panel is no parameter at all. It used to say
- * that and then leave the parameter sitting in the URL.
- *
- * Either spelling can also arrive with no article in the path — `/?about=1`,
- * from the days when the slug was a parameter too. There is no metadata page
- * for "no article", so that case strips and stays put. The rewrite above has
- * already turned `/?slug=x` into `/read/x`, so this only catches genuinely
- * article-less links.
- */
-const aboutish = /(^|[?&])(about=[^&]*|panel=about)($|&)/.test(location.search);
-if (!onCallback && aboutish) {
-  const rest = location.search
-    .replace(/^\?/, "")
-    .split("&")
-    .filter((pair) => pair !== "" && !/^about=/.test(pair) && pair !== "panel=about")
-    .join("&");
-  // Only the two spellings that meant "open", never `about=0`.
-  const wantsPage = /(^|[?&])(about=1|panel=about)($|&)/.test(location.search);
-  const route = parseRoute(location.pathname);
-  const href =
-    wantsPage && route.kind === "read"
-      ? readHref(route.slug, rest, "metadata")
-      : `${location.pathname}${rest ? `?${rest}` : ""}`;
-  history.replaceState(history.state, "", `${href}${location.hash}`);
+if (!onCallback) {
+  const settled = settleAddress(location.pathname, location.search, location.hash);
+  if (settled !== null) history.replaceState(history.state, "", settled);
 }
 
 /**
diff --git a/src/web/page-title.ts b/src/web/page-title.ts
index d397c8d..eb00edb 100644
--- a/src/web/page-title.ts
+++ b/src/web/page-title.ts
@@ -11,8 +11,9 @@
  * nothing.
  *
  * Not the link preview, though — a pasted address unfurls from `og:` tags a
- * server rendered, which we have not got. See docs/project/page-titles.md
- * § Still open.
+ * server rendered. Since 2026-08-29 there is one, for public articles only:
+ * src/public/page-head.ts. That changes this file's job, and the next section
+ * is where.
  *
  * ## The one rule: what is different about this tab goes first
  *
@@ -25,16 +26,26 @@
  * That is also why the default mode is *absent* rather than spelled out; see
  * `readTitle` below.
  *
- * ## No server rendering, so this is the only place a title is set
+ * ## The server writes a title first now, and this one has to match it
  *
  * The app is one HTML file and a router that never reloads (router.ts), so
- * `document.title` is a thing each page assigns on mount and on change. The
- * `<title>` in `index.html` is what the tab says until some page's effect
- * replaces it — which is longer than it sounds: effects run after paint, and
- * the whole app waits on a session check and then on an article fetch, so a
- * cold load into `/read/<slug>` sits on it for as long as those take. That is
- * why it is deliberately just the app's name. A page-specific title guessed
- * before the fetch would be a wrong one shown for a noticeable while.
+ * `document.title` is a thing each page assigns on mount and on change. What
+ * the tab says until then depends on how you arrived:
+ *
+ *  - **Any page but a shared article**: the `<title>` in `index.html`, which is
+ *    deliberately just the app's name. Effects run after paint and the app waits
+ *    on a session check and then on a fetch, so a cold load sits on it for a
+ *    noticeable while — and a page-specific title guessed before the fetch would
+ *    be a wrong one, shown for exactly that long.
+ *  - **`/read/<slug>` for a public article**: a real title, composed on the
+ *    server before the bundle loads (src/public/page-head.ts), so that a pasted
+ *    link previews as something.
+ *
+ * In the second case this file's assignment **overwrites a title that was
+ * already right**, in front of the reader. So the two have to produce the same
+ * string, and the way that is guaranteed is that both call `documentTitle` in
+ * src/title-text.ts — read its header for the two rules and which side won
+ * each. `readTitle` below is the client's half of it.
  *
  * ## Why the composition is a pure function
  *
@@ -47,74 +58,23 @@
  * docs/project/url-state.md for the state these titles are drawn from.
  */
 import { useEffect } from "react";
+import { APP_NAME, MODE_LABEL, SEP, TAGLINE, VIEW_LABEL, articleTitle, clamp } from "../title-text.js";
 import { DEFAULT_MODE, type Mode } from "./params.js";
 import type { AdminPage, ArticleView } from "./router.js";
 
-/** The product. `spideryarn2` is the working directory; this is the name. */
-export const APP_NAME = "Spideryarn";
-
-/**
- * The strapline. It appears on the two homepages and nowhere else — the shelf
- * with nothing chosen on it, and the landing page a signed-out reader gets
- * instead. See `pageTitle` for why it is on no other.
- */
-export const TAGLINE = "AI-assisted reading";
-
 /**
- * Between segments.
- *
- * A middot rather than an em dash or a pipe: it is already this app's
- * separator (the fact lines on the library card and the metadata page use it),
- * it is the narrowest of the three so it spends the fewest of a tab's very few
- * pixels, and unlike `-` it can never be confused with a hyphen inside a title
- * that has one. No evidence anywhere says one separator is more legible than
- * another; consistency with the rest of the app is the whole argument.
+ * **The rules themselves live in src/title-text.ts**, and are re-exported here
+ * so that every existing caller of this module — nine components and
+ * tests/page-title.test.ts — keeps importing them from the place it always did.
+ *
+ * They moved because the server composes the same title before this file's
+ * React ever runs (src/public/page-head.ts), and two copies of one rule is one
+ * place for them to disagree. They did disagree, visibly, in the tab. The whole
+ * argument is in the header of src/title-text.ts.
  */
-export const SEP = " · ";
+export { APP_NAME, CLAMP, SEP, TAGLINE, clamp } from "../title-text.js";
 
-/**
- * How much of a leading title we keep.
- *
- * Nothing forces this. No browser has a character limit, and every place that
- * truncates does it by **pixels** rather than characters — Firefox caps a tab
- * at 225px, Chrome shrinks tabs until only the favicon is left, Google cuts a
- * search result at about 600px. The familiar "50-60 characters" is SEO folklore
- * converged on by blogs, not a vendor number, and it is the wrong *unit*
- * besides. So a clamp cannot make a title fit a tab, and this one does not try.
- *
- * It is for the places that do *not* truncate: the history list, a bookmark,
- * the window switcher, and the text somebody gets when they paste a link into a
- * chat. A 180-character academic paper title there pushes everything after it
- * off the end of the useful world.
- *
- * 64 is therefore a judgment call rather than a measurement, and it is
- * deliberately generous — comfortably more than any tab shows, so clamping
- * never costs a reader something the tab would have shown them.
- */
-export const CLAMP = 64;
 
-/** Which of an article's nine middle-band modes, by the name the Dock uses. */
-const MODE_LABEL: Record<Mode, string> = {
-  hierarchy: "Hierarchy",
-  outline: "Outline",
-  summary: "Summary",
-  glossary: "Glossary",
-  ideas: "Ideas",
-  search: "Search",
-  diagram: "Diagram",
-  chat: "Chat",
-  review: "Review",
-};
-
-/**
- * The two of an article's three views that are pages beside the article rather
- * than the article itself. Named as the Dock names them, so the tab and the
- * button you pressed to get there agree.
- */
-const VIEW_LABEL: Record<Exclude<ArticleView, "article">, string> = {
-  metadata: "Metadata",
-  tweets: "Tweets",
-};
 
 /**
  * Everything a page can tell us about itself.
@@ -125,10 +85,49 @@ const VIEW_LABEL: Record<Exclude<ArticleView, "article">, string> = {
 export type TitleSpec =
   /** The shelf. Both fields are what the reader has narrowed it to, if anything. */
   | { kind: "library"; query?: string | null; unread?: boolean }
-  /** An article, in whichever of its views and — for the reading view — mode. */
-  | { kind: "read"; title: string; view: ArticleView; mode?: Mode }
+  /**
+   * An article, in whichever of its views and — for the reading view — mode.
+   *
+   * **Split by view, so that the reading view cannot forget its mode.** `mode`
+   * was one optional field on a single variant, and GPT Sol named the hole,
+   * 2026-08-30: deleting `mode` from the call in App.tsx compiles, the real tab
+   * silently loses `· Glossary`, and no cross-product test can see it, because
+   * the test passes its own arguments. A required field is a better answer than
+   * a test — the mutation stops existing rather than being caught.
+   *
+   * `mode?: never` on the other variant is not decoration. A union rejects a bad
+   * combination in a fresh object literal by excess-property checking, but a
+   * value assembled in a variable and passed in is structurally fine without it;
+   * naming the field is what makes `{ view: "metadata", mode }` an error
+   * wherever it is built.
+   */
+  | { kind: "read"; title: string; view: "article"; mode: Mode }
+  | {
+      kind: "read";
+      title: string;
+      view: Exclude<ArticleView, "article">;
+      mode?: never;
+    }
   /** An ingest in flight. `source` is the host, or the file, being added. */
   | { kind: "add"; source?: string | null }
+  /**
+   * The page a signed-in reader gets for an article that is not theirs and not
+   * shared — `NotSharedPage` in PublicChrome.tsx. A signed-out reader gets the
+   * landing page instead, which has its own variant below.
+   *
+   * It exists because **every terminal state of `ArticlePage` must have an owner
+   * for the tab**, and this one had none: `articleWaitTitle` hands over on
+   * anything that is not loading-and-slow or an error, and `NotSharedPage` then
+   * set no title at all. So a reader who navigated to an unavailable article
+   * kept the previous article's title, or — if the fetch had already gone slow —
+   * sat on `Loading…` for ever, because `slow` goes false and the hand-over is
+   * to nobody. GPT Sol, 2026-08-30.
+   *
+   * It says what the page's own heading says, and nothing more: a slug you do
+   * not own is a 404 rather than a 403, and the tab must not be the thing that
+   * confirms an article exists.
+   */
+  | { kind: "not-shared" }
   | { kind: "profile" }
   | { kind: "design" }
   /** The administrator's pages. `page` is which one — see router.ts. */
@@ -188,6 +187,9 @@ function segments(spec: TitleSpec): string[] {
        and the title had to add a noun because a window switcher showing "You"
        says nothing; the page's own name now carries that, so the title is the
        name and nothing else. */
+    case "not-shared":
+      return ["Not shared", APP_NAME];
+
     case "profile":
       return ["Profile", APP_NAME];
 
@@ -230,6 +232,93 @@ function segments(spec: TitleSpec): string[] {
   }
 }
 
+/**
+ * **What the server already put in this tab, read once before React can change
+ * it.**
+ *
+ * A shared `/read/<slug>` arrives with a real `<title>` and a full `og:` head,
+ * composed from the database (src/public/page-head.ts). Nothing else in the app
+ * does — an ordinary SPA navigation, a private article, and every other route
+ * get the bare shell — so the presence of an `og:url` naming a slug is exactly
+ * the signal "the server composed a head for *this* article".
+ *
+ * `og:url` rather than a marker of its own: it is already there, already
+ * asserted in tests/page-head.test.ts, and adding a second element that means
+ * the same thing is a second place for the two to disagree. Its value is
+ * `PUBLIC_ORIGIN + "/read/" + encodeURIComponent(slug)`, so the slug is the last
+ * segment, decoded.
+ *
+ * Read at module load and never again. The server writes this once, into the
+ * document that arrived; React never updates it, so a value read later would be
+ * stale in a way that is invisible. `title` is captured alongside it for the
+ * reason `articleWaitTitle` gives.
+ */
+export function serverComposedHead(doc: Document): { slug: string; title: string } | null {
+  const url = doc.querySelector('meta[property="og:url"]')?.getAttribute("content");
+  if (!url) return null;
+  const match = /\/read\/([^/?#]+)$/.exec(url);
+  if (!match?.[1]) return null;
+  try {
+    return { slug: decodeURIComponent(match[1]), title: doc.title };
+  } catch {
+    /* A malformed percent-escape. `decodeURIComponent` throws, and a thrown
+       exception at module load would take the whole bundle down over a tab
+       title. There is simply no composed head as far as we are concerned. */
+    return null;
+  }
+}
+
+/** Captured at module load — see `serverComposedHead` for why not later. */
+const COMPOSED: { slug: string; title: string } | null =
+  typeof document === "undefined" ? null : serverComposedHead(document);
+
+/**
+ * **What `ArticlePage` puts in the tab while it waits**, and the one case where
+ * the answer is to say nothing.
+ *
+ * Before the server composed heads, a cold load of `/read/<slug>` started at the
+ * bare app name, so replacing it with `Loading…` after 600ms was strictly an
+ * improvement. It is not any more. A shared link now arrives with **the article's
+ * real title already in the tab**, and a fetch slower than `SLOW_AFTER_MS` — a
+ * cold serverless start against Postgres, routinely — would replace it with
+ * `Loading…` and then put it back. The reader watches a correct title turn into
+ * a worse one and back again, and a screen reader announces both.
+ *
+ * That is the same fault as the two this file's `documentTitle` fixes: two
+ * sources answering "what should the tab say", disagreeing. So the rule is the
+ * one this component already follows for a *fast* fetch, extended to the case
+ * the server made possible: **do not replace a title that is already right.**
+ *
+ * The two guards are both necessary:
+ *
+ *  - **`slug === COMPOSED.slug`** — the composed head is about one article. Once
+ *    the reader navigates to a different one the server's title is a lie, and
+ *    `Loading…` is the honest thing to say.
+ *  - **`currentTitle === COMPOSED.title`** — the tab must still be showing it.
+ *    A reader who goes `/read/a` → `/read/b` → back to `/read/a` has an `og:url`
+ *    that still names `a`, and suppressing here would leave *b's* title standing
+ *    over a's loading page. Comparing the string self-expires the moment
+ *    anything writes a different one, which is exactly when the guarantee stops
+ *    holding.
+ *
+ * **An error still replaces it**, deliberately. `Loading…` is a claim that the
+ * right title is coming; `Couldn't open` is a claim that it is not, and a broken
+ * page must not go on advertising the article it failed to show.
+ */
+export function articleWaitTitle(
+  state: "loading" | "error" | "ready",
+  slug: string,
+  currentTitle: string,
+  composed: { slug: string; title: string } | null = COMPOSED,
+): string {
+  if (state === "error") return pageTitle({ kind: "error" });
+  /* "" is `useDocumentTitle`'s "not mine to set" — see the hook, and see
+     `ArticlePage`, which uses the same value to hand over to its children. */
+  if (state === "ready") return "";
+  if (composed !== null && composed.slug === slug && composed.title === currentTitle) return "";
+  return pageTitle({ kind: "loading" });
+}
+
 /**
  * The segments before the app name, for one of an article's three views.
  *
@@ -246,7 +335,7 @@ function segments(spec: TitleSpec): string[] {
  * a reader who learns the rule in one place has learned it in both.
  */
 function readTitle(spec: Extract<TitleSpec, { kind: "read" }>): string[] {
-  const title = clamp(spec.title.trim()) || "Untitled";
+  const title = articleTitle(spec.title);
   if (spec.view !== "article") return [title, VIEW_LABEL[spec.view]];
   const mode = spec.mode ?? DEFAULT_MODE;
   return mode === DEFAULT_MODE ? [title] : [title, MODE_LABEL[mode]];
@@ -257,36 +346,6 @@ function join(parts: string[]): string {
   return parts.map((p) => p.trim()).filter(Boolean).join(SEP);
 }
 
-/**
- * Cut at a word boundary, with an ellipsis, or return the text unchanged.
- *
- * Word boundary rather than mid-word because the cut is doing the reader a
- * favour and a truncation that lands inside a word looks like corruption. If
- * there is no space to cut at in the last third of the budget — one very long
- * word, or a language that does not space its words — it cuts where it must,
- * which is still better than not clamping.
- *
- * **Counted in code points, not in UTF-16 units**, which is why the text is
- * split into an array first rather than sliced. `"…".slice(0, 64)` will happily
- * cut an emoji in half and leave a lone surrogate, which renders as `�` — a
- * clamp whose whole job is to look deliberate, producing the one character that
- * looks like corruption. GPT Sol found it, 2026-08-27.
- *
- * Code points, not graphemes: a combining accent or a flag can still be split,
- * and doing better needs `Intl.Segmenter`. Not worth a segmenter for a title
- * that is already being cut with an ellipsis on it — but that is the next step
- * if this ever matters.
- */
-export function clamp(text: string, max = CLAMP): string {
-  const points = [...text];
-  if (points.length <= max) return text;
-  const cut = points.slice(0, max).join("");
-  const space = cut.lastIndexOf(" ");
-  // Only honour a space in the last third; otherwise a title whose first word
-  // is long would be clamped down to that one word.
-  const at = space > cut.length * 0.66 ? cut.slice(0, space) : cut;
-  return `${at.trimEnd()}…`;
-}
 
 /**
  * The host of a URL, without its `www.`, or the text unchanged if it is not a
diff --git a/src/web/params.ts b/src/web/params.ts
index efa319f..90f682d 100644
--- a/src/web/params.ts
+++ b/src/web/params.ts
@@ -238,55 +238,25 @@ export const panelParam = createParser<Panel>({
  * (docs/project/summaries.md). Diagram is the fifth
  * (docs/project/diagram.md), and it cost this list one word as well.
  */
-export const MODES = [
-  /* Renamed from `toc` on 2026-08-29, at Greg's request: the reader sees
-     "Hierarchy" and the code now says the same word. It also ends a collision
-     that had lasted as long as the list — `toc` was simultaneously this mode and
-     the *pipeline step* that builds tree.json (src/pipeline.ts § STEP_ORDER), so
-     one word meant two things in one repo. The step keeps the name; the mode
-     gives it up. docs/plans/defer-arc-and-rename-hierarchy.md § 3. */
-  "hierarchy",
-  "chat",
-  "glossary",
-  "search",
-  "summary",
-  "diagram",
-  "ideas",
-  /* Review is the seventh, 2026-08-27, and the first mode whose content comes
-     from the reader rather than from the article: they say what they took from
-     it and the model helps them find where that comes apart. It cost this list
-     one word, like the five before it. docs/plans/review-mode.md.
-
-     There is deliberately no `?stance=` beside `?thread=` below. The stance
-     governs the next answer and changes nothing on screen, which is the rule
-     this file keeps — the closest existing thing is chat's profile checkbox,
-     which is component state for the same reason. */
-  "review",
-  /* The eighth, 2026-08-28: the whole document as one nested list that never
-     scrolls and expands around where the reader is. It costs this list one
-     word like the six before it, and it is the first mode that is a second
-     answer to a question an existing surface already answers — the gist
-     columns' context panels — rather than a new question. That is deliberate
-     and temporary: Greg asked for it as an eighth mode "for now, so that it
-     doesn't mess with what we have, and so that I can go back and forth to
-     compare". docs/plans/outline-mode.md § Where it sits, and what happens if
-     it wins. */
-  "outline",
-] as const;
-export type Mode = (typeof MODES)[number];
-
-/**
- * The mode a reader lands in, named once.
- *
- * Two places need it — `modeParam`'s fallback below, and `withMode` in
- * src/web/Dock.tsx, which omits the parameter when it is writing this value. A
- * literal in both would be two copies of one decision, and the copy that drifts
- * is the one that puts a redundant `?mode=` back into every URL.
- */
-export const DEFAULT_MODE: Mode = "hierarchy";
+/* **Moved to src/modes.ts on 2026-08-30**, and re-exported here so that every
+   importer of this file is unchanged. The server composes the same titles now
+   and cannot import anything under `src/web/`; the reasoning and the history of
+   the list are in that file's header. */
+import { isMode } from "../modes.js";
+export { isMode };
+/* Imported as well as re-exported: `export … from` creates no local binding, and
+   `modeParam` below uses all three. */
+import { DEFAULT_MODE, MODES, type Mode } from "../modes.js";
+export { DEFAULT_MODE, MODES, type Mode };
 
 export const modeParam = createParser<Mode>({
-  parse: (v) => (MODES.includes(v as Mode) ? (v as Mode) : null),
+  /* `isMode` and not a second `MODES.includes` here. The serverless function
+     that composes a shared article's `<title>` asks the same question of the
+     same query string (`readMode` in src/vercel.ts), and this file used to
+     answer it independently — so "one place decides what a mode is" was a claim
+     rather than a fact, and no test paired the two on an invalid input. GPT Sol,
+     2026-08-30. */
+  parse: (v) => (isMode(v) ? v : null),
   serialize: (v) => v,
 })
   .withDefault(DEFAULT_MODE)
@@ -748,31 +718,36 @@ export const rungParam = createParser<Rung>({
 /**
  * Which picture the Diagram mode is drawing.
  *
- * Four of them, and the toggle is not a skin — see src/web/diagram.ts for what
- * each one is honest about, and for why there were eight until 2026-08-27.
- * Short version: `tree` is the outline, `force` is the relationships an outline
+ * Three of them, and the toggle is not a skin — see src/web/diagram.ts for what
+ * each one is honest about, and for why there were eight until 2026-08-27 and
+ * four until 2026-08-30. Short version: `force` is the relationships an outline
  * cannot hold, and `drift` and `trail` are the article as paragraphs placed by
  * meaning. That is a real choice a reader makes, so it belongs in the URL like
  * every other bit of view state (docs/project/url-state.md).
  *
- * **`tree` is the default because it is the only one that is free.** The other
- * three all spend a model call the moment they are drawn, and a default that
- * bills the reader for opening a mode is not a default — it is a purchase
- * nobody agreed to. (The old default, `strata`, was free too, and was cut.)
+ * **`force` is the default because it is the only one that draws anything
+ * before its answer lands.** All three spend a model call now that the free
+ * picture — `tree`, the outline — has been cut for overlapping the outline and
+ * hierarchy views that already exist. Force's call only adds the dotted lines;
+ * the rest of it is arithmetic over prose the browser is already holding, so
+ * opening the mode still shows the reader something immediately. Drift and
+ * Trail have nothing at all without the projection, and now say so with a
+ * spinner rather than borrowing another picture.
  *
  * `push`, like `?rung=` and `?cols=`. Switching picture is a deliberate act on
  * the view and Back should undo it — and unlike stepping between glossary terms,
  * you do not do it twice in ten seconds.
  *
- * **A cut picture's name degrades to `tree`** rather than throwing, the same
- * rule as every other parser in this file — which is what stops a link somebody
- * pasted in August, saying `?diagram=strata`, from opening a broken page.
+ * **A cut picture's name degrades to the default** rather than throwing, the
+ * same rule as every other parser in this file — which is what stops a link
+ * somebody pasted in August, saying `?diagram=strata` or `?diagram=tree`, from
+ * opening a broken page.
  */
 export const diagramParam = createParser<DiagramKind>({
   parse: (v) => (DIAGRAMS.includes(v as DiagramKind) ? (v as DiagramKind) : null),
   serialize: (v) => v,
 })
-  .withDefault("tree")
+  .withDefault("force")
   .withOptions({ history: "push" });
 
 /**
diff --git a/src/web/router.ts b/src/web/router.ts
index de4fb25..e3e7d12 100644
--- a/src/web/router.ts
+++ b/src/web/router.ts
@@ -65,7 +65,18 @@ import { useMemo, useSyncExternalStore } from "react";
 import { isSlug } from "../ingest.js";
 
 /** Which of an article's three pages. `article` is the reading view itself. */
-export type ArticleView = "article" | "metadata" | "tweets";
+/* **Moved to src/read-address.ts on 2026-08-30** and re-exported, so nothing
+   that used this name knows. The serverless function that composes a shared
+   article's head has to know which view an address settles on, and it may not
+   import anything under src/web/. */
+import {
+  isLegacyAboutPair,
+  queryPairs,
+  redirectsToMetadata,
+  type ArticleView,
+} from "../read-address.js";
+import { isSpideryarnId } from "../ids.js";
+export type { ArticleView };
 
 /** Which admin page. `home` is `/admin` itself — the index of the others. */
 export type AdminPage = "home" | "users";
@@ -455,12 +466,199 @@ export function canonicalAddHref(pathname: string, search: string, hash: string)
      as ours and replaced it. And since this now runs before every other rewrite
      in main.tsx, nothing downstream could have repaired it. GPT Sol, 2026-08-26. */
   const fromPath = addUrlFrom(pathname, search, hash);
-  const url = fromPath !== "" ? fromPath : addUrlFromQuery(search);
+  /* **`?add=` is read on the root and nowhere else**, which is what
+     docs/project/url-state.md has always described it as: `/?add=<url>`, from
+     the days when everything was a parameter on one page. Unconstrained it also
+     fired on `/read/a?add=…`, and that is a divergence rather than a
+     convenience: `/read/a` with a query is one path segment, so the server
+     composes *article a's* title for it (src/read-address.ts), and the client
+     then navigates to an add page instead. Sixth of these, GPT Sol 2026-08-30.
+     The path form is untouched — `/add/<url>` is canonical wherever it appears. */
+  const url = fromPath !== "" ? fromPath : pathname === "/" ? addUrlFromQuery(search) : "";
   if (url === "") return null;
   const href = addHref(url);
   return href === pathname + search + hash ? null : href;
 }
 
+/**
+ * **Every rewrite the app does before React mounts, as one pure function.**
+ *
+ * `main.tsx` used to do these as four separate `history.replaceState` calls at
+ * module scope — side effects nothing can call, which is why *interactions*
+ * between them were invisible. Each one had tests; the sequence had none. GPT
+ * Sol found the consequence on 2026-08-30, at the fourth time of asking:
+ *
+ *     /read/a?%61bout=1#spya-k3m9qt
+ *
+ * The hash rewrite went through `new URL()` and `searchParams.set()`, which
+ * **reserialises the whole query** — so `%61bout=1` became `about=1`, and the
+ * metadata rewrite two steps later then fired on a parameter that had not been
+ * there when the server read the same address. Server said article, client went
+ * to the metadata page. Neither rewrite is wrong on its own, and no per-rewrite
+ * test could have seen it.
+ *
+ * Two things follow, and both are the point of this function existing:
+ *
+ *  - **The query is edited as text throughout.** That was already this file's
+ *    rule for `?slug=` and `about=` — round-tripping re-encodes as it
+ *    serialises, and `?cols=0,1` comes back as `?cols=0%2C1`, still correct and
+ *    no longer readable. The hash rewrite was the one that broke the rule, and
+ *    it was mangling those commas too.
+ *  - **One guard instead of four.** `/auth/callback` is exempt from all of this
+ *    (see main.tsx), and it used to be exempt four times over, which meant the
+ *    person adding a fifth rewrite had to remember. Now there is one call site
+ *    to guard, and a rewrite added inside here is guarded by construction.
+ *
+ * The order is the order main.tsx had, and it is load-bearing: canonicalising
+ * an `/add/` address first leaves something none of the other three can match.
+ *
+ * @returns the address to `replaceState` to, or `null` if it is already right.
+ */
+export function settleAddress(pathname: string, search: string, hash: string): string | null {
+  const was = `${pathname}${search}${hash}`;
+  let at = { pathname, search, hash };
+
+  const canonical = canonicalAddHref(at.pathname, at.search, at.hash);
+  if (canonical !== null) at = splitHref(canonical);
+
+  at = liftLegacyAnchor(at);
+  at = liftLegacySlug(at);
+  at = liftLegacyAbout(at);
+
+  const href = `${at.pathname}${at.search}${at.hash}`;
+  return href === was ? null : href;
+}
+
+/** An address in the three pieces `location` gives them in, prefixes included. */
+interface Address {
+  pathname: string;
+  search: string;
+  hash: string;
+}
+
+/** `/a/b?c=d#e` back into its three parts, with their prefixes kept. */
+function splitHref(href: string): Address {
+  const hashAt = href.indexOf("#");
+  const hash = hashAt === -1 ? "" : href.slice(hashAt);
+  const rest = hashAt === -1 ? href : href.slice(0, hashAt);
+  const queryAt = rest.indexOf("?");
+  return {
+    pathname: queryAt === -1 ? rest : rest.slice(0, queryAt),
+    search: queryAt === -1 ? "" : rest.slice(queryAt),
+    hash,
+  };
+}
+
+/**
+ * **Does this pair name that parameter, however it is spelled?**
+ *
+ * `?%61t=…` is `?at=…`: `URLSearchParams` percent-decodes keys, so it reads them
+ * as the same parameter — and a textual filter for `at=` does not. Removing only
+ * the literal spelling left both in the query, and the reader got the **stale**
+ * one, because `get("at")` returns the first match. So the fragment lost to a
+ * position it was supposed to override. GPT Sol, 2026-08-30; the ninth address
+ * bug and the second of this exact shape.
+ *
+ * The key is decoded to decide, and the pair is then dropped or kept **whole**,
+ * so everything that stays is byte-for-byte what was written. A malformed escape
+ * cannot be a match for a plain name, and it must not throw here either.
+ */
+function hasKey(pair: string, name: string): boolean {
+  const key = pair.split("=")[0] ?? "";
+  if (key === name) return true;
+  try {
+    return decodeURIComponent(key) === name;
+  } catch {
+    return false;
+  }
+}
+
+/**
+ * Drop the pairs a rewrite is consuming, and keep every other one **exactly as
+ * it was written**. Text, never `URLSearchParams` — see `settleAddress`.
+ */
+function withoutPairs(search: string, drop: (pair: string) => boolean): string {
+  return search
+    .replace(/^\?/, "")
+    .split("&")
+    .filter((pair) => pair !== "" && !drop(pair))
+    .join("&");
+}
+
+/**
+ * `/#spya-k6fpme` → `?at=spya-k6fpme`. Deep links used to be fragments;
+ * position now lives in `?at=`.
+ *
+ * **The hash beats an `?at=` that came with it.** The article's own internal
+ * links are `#spya-…`, so ⌘-clicking one opens `?at=<where you were>#<where you
+ * asked to go>` — two positions in one address. `?at=` is where the reader
+ * happened to be; a fragment is where they asked to go.
+ *
+ * `decodeURIComponent` throws on a malformed escape like `#%zz`, and a throw at
+ * module scope takes the whole bundle down over a deep link. There is simply no
+ * legacy anchor in that case.
+ */
+function liftLegacyAnchor(at: Address): Address {
+  let anchor: string;
+  try {
+    anchor = decodeURIComponent(at.hash.slice(1));
+  } catch {
+    return at;
+  }
+  if (!isSpideryarnId(anchor)) return at;
+  const rest = withoutPairs(at.search, (pair) => hasKey(pair, "at"));
+  return { pathname: at.pathname, search: `?${rest ? `${rest}&` : ""}at=${anchor}`, hash: "" };
+}
+
+/**
+ * `/?slug=x` → `/read/x`, **on the root and nowhere else**.
+ *
+ * The old address was `/?slug=…`, from when the slug was a parameter on the one
+ * page there was — never `/read/a?slug=b`, which is a contradiction nobody ever
+ * produced. Unconstrained it fired there anyway, and the server had already
+ * composed article *a*'s title for it. GPT Sol, 2026-08-30.
+ *
+ * **The fragment is carried across, which the old inline version did not do.**
+ * It dropped it; the `about=` rewrite beside it kept it. That reads as two
+ * rewrites written at different times rather than as a decision, and keeping it
+ * is the better of the two — a fragment the reader wrote should not vanish
+ * because their link used an old spelling. Only a fragment that is *not* a block
+ * id is affected, because `liftLegacyAnchor` runs first and consumes those.
+ */
+function liftLegacySlug(at: Address): Address {
+  if (at.pathname !== "/") return at;
+  const slug = new URLSearchParams(at.search).get("slug");
+  if (!slug) return at;
+  /* `URLSearchParams.get` above decoded the key to find it, so the removal has
+     to decode too, or `?%73lug=x` is read and then left behind. */
+  const rest = withoutPairs(at.search, (pair) => hasKey(pair, "slug"));
+  return { ...splitHref(readHref(slug, rest)), hash: at.hash };
+}
+
+/**
+ * `?about=1` and `?panel=about` → `/read/<slug>/metadata`. The article's details
+ * were in the masthead, then a drawer, and are now a page.
+ *
+ * `about=0` is stripped but does **not** redirect: it meant the panel was shut,
+ * and a shut panel is not a reason to send anybody to a different page.
+ * `redirectsToMetadata` in src/read-address.ts is the predicate, shared with the
+ * server, which has to predict this to compose the right `<title>`.
+ */
+function liftLegacyAbout(at: Address): Address {
+  /* **Deciding and removing are the same function**, `isLegacyAboutPair`, which
+     the server also reaches through `redirectsToMetadata`. That is the whole
+     lesson of the ninth bug: a decoding decision paired with a literal removal
+     leaves a parameter in the query that one side acts on and the other has
+     never seen. There is now no second spelling of the question. */
+  if (!queryPairs(at.search).some(isLegacyAboutPair)) return at;
+  const rest = withoutPairs(at.search, isLegacyAboutPair);
+  const route = parseRoute(at.pathname);
+  if (redirectsToMetadata(at.search) && route.kind === "read") {
+    return { ...splitHref(readHref(route.slug, rest, "metadata")), hash: at.hash };
+  }
+  return { pathname: at.pathname, search: rest ? `?${rest}` : "", hash: at.hash };
+}
+
 /**
  * Go somewhere, without a page load.
  *
diff --git a/tests/page-head.test.ts b/tests/page-head.test.ts
index 97c8055..5e5b735 100644
--- a/tests/page-head.test.ts
+++ b/tests/page-head.test.ts
@@ -40,11 +40,16 @@ import { describe, expect, it } from "vitest";
 
 import {
   composeShell,
-  documentTitle,
   MANAGED_HEAD_END,
   MANAGED_HEAD_START,
   PUBLIC_ORIGIN,
 } from "../src/public/page-head.js";
+/* From the shared leaf rather than from page-head.js, because the leaf is the
+   only definition there now is — see src/title-text.ts. `composeShell` calls
+   this same function, so comparing it against `pageTitle()` below is a
+   statement about what actually reaches the document. */
+import { DEFAULT_MODE, MODES } from "../src/modes.js";
+import { clamp, documentTitle } from "../src/title-text.js";
 import type { PublicHead } from "../src/store/public-reader.js";
 import { pageTitle } from "../src/web/page-title.js";
 
@@ -317,7 +322,13 @@ describe("text from a stranger, on its way into a document head", () => {
        slicing at a UTF-16 offset can cut an astral character in half and leave a
        lone surrogate, which is not valid text. */
     const d = doc(composeShell(SHELL, head({ title: "x".repeat(10_000) })));
-    expect([...d.title]).toHaveLength(64 + " · Spideryarn".length);
+    /* **64 plus one.** The tab's clamp appends an ellipsis rather than counting
+       it, so a title with no space to cut at comes out one code point over
+       budget — see `clamp` in src/title-text.ts, which says so. That is the
+       client's rule, and since 2026-08-30 the tab is composed by the client's
+       rule on both sides. `og:title` keeps `headText`'s hard 120, because
+       metadata is a promise about a length. */
+    expect([...d.title]).toHaveLength(64 + 1 + " · Spideryarn".length);
     expect([...(metaContent(d, 'meta[property="og:title"]') ?? "")]).toHaveLength(120);
 
     const astral = doc(composeShell(SHELL, head({ title: "\u{1D54F}".repeat(200) })));
@@ -340,71 +351,243 @@ describe("text from a stranger, on its way into a document head", () => {
   });
 });
 
-describe("the two copies of the title rule", () => {
-  it("composes character for character what the client composes on mount", () => {
-    /* `src/web/page-title.ts` imports React, so a module reached by
-       `src/public/routes.ts` cannot import it (tests/public-imports.test.ts).
-       `APP_NAME` and the separator are therefore duplicated in
-       src/public/page-head.ts, and this is what stops the copies drifting: the
-       tab a reader sees before React mounts and the one it sets afterwards are
-       the same string.
-
-       `documentTitle` is the function the composer itself calls, not a
-       restatement of it — a helper the tests use and the code does not can be
-       right while the code is wrong. */
-    for (const title of ["The hard problem is a distraction", "A · B", "  spaced  "]) {
-      expect(documentTitle(title), title).toBe(
-        pageTitle({ kind: "read", title: title.trim(), view: "article" }),
-      );
+describe("the one title rule, applied by both sides", () => {
+  /**
+   * **The tab must not change when React mounts**, and until 2026-08-30 it did.
+   *
+   * A shared `/read/<slug>` is served with a `<title>` this file's
+   * `composeShell` composed; React then assigns `document.title` from
+   * `pageTitle()` in src/web/page-title.ts, over the top of it. The server ran
+   * the title through `headText` (src/html.ts) and the client did not, so for
+   * any title with a double space, a newline, a tab or a bidi override in it the
+   * reader watched the title they were given turn into a worse one. GPT Sol
+   * found it reviewing slice 1; it was pinned as a divergence nobody had chosen
+   * and put to Greg, who left the call here.
+   *
+   * **The call: the server's normalising wins and the client's clamp wins**, and
+   * they are one function now — `documentTitle` in src/title-text.ts, which both
+   * sides import. That header has the argument for each half.
+   *
+   * The expected strings below are **spelled out** rather than computed from
+   * either side. An expectation written as `documentTitle(t)` would agree with
+   * every possible behaviour of `documentTitle`, which is the way a test about
+   * two things that must agree quietly becomes a test about nothing.
+   */
+  it("normalises whitespace, controls and bidi identically on both sides", () => {
+    const cases: [string, string][] = [
+      /* [ the article's title, what BOTH sides must put in the tab ] */
+      ["A  B", "A B · Spideryarn"],
+      ["A\nB", "A B · Spideryarn"],
+      ["A\r\nB", "A B · Spideryarn"],
+      ["A\tB", "A B · Spideryarn"],
+      /* U+202E RIGHT-TO-LEFT OVERRIDE: invisible, and it reverses what follows
+         it. The client used to keep it. */
+      ["A\u202eB", "AB · Spideryarn"],
+      ["  spaced  ", "spaced · Spideryarn"],
+      /* The separator inside a title, which must survive being one. */
+      ["A · B", "A · B · Spideryarn"],
+      ["The hard problem is a distraction", "The hard problem is a distraction · Spideryarn"],
+      /* Arabic keeps every character it had — the strip is of invisible
+         instructions, not of right-to-left text. */
+      ["مرحبا بالعالم", "مرحبا بالعالم · Spideryarn"],
+    ];
+    for (const [title, expected] of cases) {
+      const client = pageTitle({ kind: "read", title, view: "article", mode: DEFAULT_MODE });
+      expect(documentTitle(title), `server: ${JSON.stringify(title)}`).toBe(expected);
+      expect(client, `client: ${JSON.stringify(title)}`).toBe(expected);
+      /* Said as a comparison too, so this is about the pair and not about two
+         independent constants that happen to be written on one line. */
+      expect(documentTitle(title), `pair: ${JSON.stringify(title)}`).toBe(client);
+    }
+  });
+
+  it("says Untitled on both sides for a title that is nothing", () => {
+    for (const title of [null, "", "   ", "\u202e", "\n\t"]) {
+      expect(documentTitle(title), `server: ${JSON.stringify(title)}`).toBe("Untitled · Spideryarn");
+      expect(
+        pageTitle({ kind: "read", title: title ?? "", view: "article", mode: DEFAULT_MODE }),
+        `client: ${JSON.stringify(title)}`,
+      ).toBe("Untitled · Spideryarn");
     }
-    expect(documentTitle(null)).toBe(pageTitle({ kind: "read", title: "", view: "article" }));
-    /* And the one place they deliberately differ, written down so it is a
-       decision rather than a surprise: over 64 code points the client cuts at a
-       word boundary and adds an ellipsis, and the head does neither, because an
-       `…` in an `og:title` is a claim that the title contained one. */
+  });
+
+  it("clamps long titles to the same string, ellipsis and all", () => {
+    /* 40 words of five characters. The clamp cuts at the last word boundary
+       inside 64 code points, which is after the twelfth. Written out rather
+       than derived: `clamp(x)` as the expectation would pass for any clamp. */
     const long = "word ".repeat(40);
-    expect(documentTitle(long)).not.toContain("…");
-    expect(pageTitle({ kind: "read", title: long, view: "article" })).toContain("…");
+    const expected = `${Array(12).fill("word").join(" ")}… · Spideryarn`;
+    expect(documentTitle(long)).toBe(expected);
+    expect(pageTitle({ kind: "read", title: long, view: "article", mode: DEFAULT_MODE })).toBe(
+      expected,
+    );
   });
 
   /**
-   * **And the second place they differ, which nobody decided** — pinned here as
-   * it is, not papered over.
+   * **The plumbing, not the rule** — and this is the case that answers "is the
+   * equality guaranteed, or only usually?"
    *
-   * The case above passes `title.trim()` to the client, which hides this: the
-   * server's title goes through `headText` (src/html.ts), so internal runs of
-   * whitespace collapse, control characters become a space, and bidi overrides
-   * are dropped. The client's `clamp()` only trims the ends and cuts to length.
-   * So for a title with a double space, a newline or an RLO in it, **the tab
-   * changes the moment React mounts** — the normalised title is replaced by the
-   * less normalised one. GPT Sol's review of slice 1 found it.
+   * The three cases above are about `documentTitle`, which both sides call. This
+   * one is about everything the *client* wraps around it: `pageTitle` reaches it
+   * through `segments` → `readTitle` → `join`, and `join` trims every part and
+   * drops the empty ones. Reasoning says that is a no-op — `articleTitle`
+   * normalises, so its result cannot begin or end in whitespace, and it falls
+   * back to `Untitled` rather than returning `""`. Reasoning is exactly what was
+   * wrong last time, so this looks instead.
    *
-   * This is a product decision and it is Greg's, so nothing is changed here. The
-   * value of the assertion is that the divergence is now a fact somebody wrote
-   * down: if either side is ever brought into line with the other, this test
-   * goes red and asks whether that was on purpose.
+   * Seeded, so a failure is reproducible from the number rather than from luck,
+   * and the alphabet is built out of the things that broke the two sides apart
+   * before: bidi controls, the C0/C1 range, whitespace the `CONTROLS` class does
+   * **not** cover (NBSP, zero-width space, ideographic space) which only the
+   * `\s` collapse can touch, surrogate pairs either side of the clamp, and the
+   * separator itself inside a title.
    *
-   * **Mutation: make `documentTitle` skip `headText` and only trim.** Red on
-   * every `not.toBe` below — which is the point, because that is precisely the
-   * "fix" that would look like tidying.
+   * **`oldClient` is the control.** A fuzz that finds nothing is worthless until
+   * it has been shown to find something, and "no divergence" is precisely the
+   * output an inert loop produces. So the same loop runs against the client
+   * behaviour as it was before 2026-08-30, and is required to fail.
    */
-  it("but diverges from the client on internal whitespace, controls and bidi — pinned, not fixed", () => {
-    const cases: [string, string, string][] = [
-      /* [ the title, what the server writes, what React writes over it ] */
-      ["A  B", "A B · Spideryarn", "A  B · Spideryarn"],
-      ["A\nB", "A B · Spideryarn", "A\nB · Spideryarn"],
-      ["A\tB", "A B · Spideryarn", "A\tB · Spideryarn"],
-      ["A‮B", "AB · Spideryarn", "A‮B · Spideryarn"],
+  it("finds no divergence the client's own wrapping could introduce — and can find one", () => {
+    /* The client before the fix: trim the ends, clamp, fall back. Nothing calls
+       this; it exists so that the loop below can be seen failing. */
+    const oldClient = (t: string) => `${clamp(t.trim()) || "Untitled"} · Spideryarn`;
+
+    const ALPHABET = [
+      " ", "  ", "\t", "\n", "\r\n", "\v", "\f", "\u0000", "\u001f", "\u007f", "\u009f",
+      "\u202e", "\u202a", "\u2066", "\u2069", "\u061c", // RLO, LRE, LRI, PDI, ALM
+      /* NBSP and the ideographic space are outside the CONTROLS class but are
+         `\s`, so the collapse reaches them. U+200B and U+FEFF are neither, and
+         survive normalising untouched — which is fine, and is why src/html.ts no
+         longer claims to remove "nothing invisible". */
+      "\u00a0", "\u3000", "\u200b", "\ufeff",
+      "a", "word", "the", "·", " · ", "…", "&", "<", "'", '"',
+      "\u{1D54F}", "\u{1F1EC}\u{1F1E7}", "é", "e\u0301", "\u0645\u0631\u062d\u0628\u0627",
     ];
-    for (const [title, server, client] of cases) {
-      expect(documentTitle(title), title).toBe(server);
-      expect(pageTitle({ kind: "read", title, view: "article" }), title).toBe(client);
-      /* Said as a comparison too, so this test is about the pair rather than
-         about two independent constants that happen to be written here. */
-      expect(documentTitle(title), title).not.toBe(
-        pageTitle({ kind: "read", title, view: "article" }),
-      );
+
+    /* A linear congruential generator — deterministic, and no dependency. */
+    let seed = 20260830;
+    const rnd = () => {
+      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
+      return seed / 0x7fffffff;
+    };
+    const titles: string[] = [];
+    for (let i = 0; i < 20_000; i++) {
+      let t = "";
+      const n = Math.floor(rnd() * 40);
+      for (let j = 0; j < n; j++) t += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
+      titles.push(t);
     }
+
+    const diverged = titles.filter(
+      (t) =>
+        documentTitle(t) !==
+        pageTitle({ kind: "read", title: t, view: "article", mode: DEFAULT_MODE }),
+    );
+    expect(diverged.slice(0, 3).map((t) => JSON.stringify(t))).toEqual([]);
+
+    /* The control. If this ever comes back empty the corpus has stopped
+       exercising anything and the assertion above means nothing. */
+    const wouldHaveDiverged = titles.filter((t) => documentTitle(t) !== oldClient(t));
+    expect(wouldHaveDiverged.length).toBeGreaterThan(1_000);
+  });
+
+  /**
+   * **Every mode, through the served page** — the dimension the fuzz could not
+   * see.
+   *
+   * The fuzz varies the title's *characters* and leaves `mode` absent on both
+   * sides, so it fixes the one axis this case is about. `/read/x?mode=glossary`
+   * was served as `Article · Spideryarn` and then replaced by React with
+   * `Article · Glossary · Spideryarn`: a fourth instance of the same fault, and
+   * invisible to a corpus that only ever asked about the default mode. GPT Sol
+   * found it, 2026-08-30, and the phrase worth keeping is his — **the missing
+   * dimension was title state, not title characters.**
+   *
+   * `MODES` is read from src/modes.ts rather than listed here, so a tenth mode
+   * arrives in this loop without anybody remembering to add it.
+   */
+  it("agrees with the client in every one of the nine modes", () => {
+    expect(MODES.length, "a mode was added or removed; check this still covers them").toBe(9);
+    for (const mode of MODES) {
+      const d = doc(composeShell(SHELL, head({ title: "A shared piece" }), mode));
+      const client = pageTitle({ kind: "read", title: "A shared piece", view: "article", mode });
+      expect(d.title, mode).toBe(client);
+    }
+  });
+
+  it("and spells the two ends of that out, so the loop is not comparing two bugs", () => {
+    /* The default mode is left out of the title entirely — the rule in
+       `readTitle`, and the reason the loop above cannot be satisfied by a
+       function that simply appends every mode. */
+    expect(doc(composeShell(SHELL, head({ title: "A shared piece" }), "hierarchy")).title).toBe(
+      "A shared piece · Spideryarn",
+    );
+    expect(doc(composeShell(SHELL, head({ title: "A shared piece" }), "glossary")).title).toBe(
+      "A shared piece · Glossary · Spideryarn",
+    );
+  });
+
+  it("says Metadata where the client will, and drops the mode as the client does", () => {
+    /* The composed head for `/read/x?about=1&mode=glossary`. `readTitle` gives a
+       non-article view its own label and ignores the mode entirely, so the
+       server must too — otherwise the tab reads `· Glossary ·` for a second and
+       then `· Metadata ·`. Spelled out on both sides. */
+    const d = doc(composeShell(SHELL, head({ title: "A shared piece" }), "glossary", "metadata"));
+    expect(d.title).toBe("A shared piece · Metadata · Spideryarn");
+    expect(d.title).toBe(
+      /* No mode: `TitleSpec` forbids one on this view now, which is the same
+         claim this line was making by hand. */
+      pageTitle({ kind: "read", title: "A shared piece", view: "metadata" }),
+    );
+    /* And the card is still about the article, not about which of its pages the
+       address named. */
+    expect(metaContent(d, 'meta[property="og:title"]')).toBe("A shared piece");
+    expect(metaContent(d, 'meta[property="og:url"]')).toBe(
+      "https://www.spideryarn.com/read/the-hard-problem",
+    );
+  });
+
+  it("but keeps the mode out of the card, which is about the article", () => {
+    /* A shared link is about the article, not about which panel the person who
+       shared it happened to have open — and `og:url` is the mode-free address
+       for the same reason. */
+    const d = doc(composeShell(SHELL, head({ title: "A shared piece" }), "glossary"));
+    expect(metaContent(d, 'meta[property="og:title"]')).toBe("A shared piece");
+    expect(metaContent(d, 'meta[name="twitter:title"]')).toBe("A shared piece");
+    expect(metaContent(d, 'meta[property="og:url"]')).not.toContain("mode");
+  });
+
+  /**
+   * **The difference that remains, which is a decision rather than a drift.**
+   *
+   * `<title>` and `og:title` are different sinks read by different things, so
+   * they are allowed to differ — and the divergence this test is about is
+   * between a tab and a card, not between two copies of one rule.
+   *
+   * The card drops the ` · Spideryarn` suffix, because the card already carries
+   * `og:site_name` and repeating it spends the visible half of the card saying
+   * one word twice. And it clamps hard at 120 with no ellipsis, because an `…`
+   * in published metadata is a claim that the title contained one.
+   */
+  it("but the card title is not the tab title, on purpose", () => {
+    const long = "word ".repeat(40);
+    const d = doc(composeShell(SHELL, head({ title: long })));
+    const card = metaContent(d, 'meta[property="og:title"]');
+
+    expect(card).not.toContain("…");
+    expect(card).not.toContain("Spideryarn");
+    /* 24 words, not 25: `headText` cuts at 120 code points — which lands on the
+       space after the twenty-fourth — and trims the end, because a metadata
+       string ending in a space is one that will not compare equal to the obvious
+       expectation of it. Written out for the reason the case above is. */
+    expect(card).toBe(Array(24).fill("word").join(" "));
+    expect(card).not.toBe(d.title);
+    /* And the tab, from the same document, is the client's string — so this
+       case is also a check that `composeShell` uses `documentTitle` rather than
+       composing a third title of its own. */
+    expect(d.title).toBe(
+      pageTitle({ kind: "read", title: long, view: "article", mode: DEFAULT_MODE }),
+    );
   });
 
   it("puts the composed head between the sentinels and leaves them in place", () => {
diff --git a/tests/page-title.test.ts b/tests/page-title.test.ts
index c3c1bd2..235c36f 100644
--- a/tests/page-title.test.ts
+++ b/tests/page-title.test.ts
@@ -21,9 +21,20 @@
  */
 import { readFileSync, readdirSync } from "node:fs";
 import path from "node:path";
+import { JSDOM } from "jsdom";
 import { describe, expect, it } from "vitest";
-import { MODES } from "../src/web/params.js";
-import { APP_NAME, CLAMP, SEP, TAGLINE, clamp, host, pageTitle } from "../src/web/page-title.js";
+import { DEFAULT_MODE, MODES } from "../src/web/params.js";
+import {
+  APP_NAME,
+  articleWaitTitle,
+  CLAMP,
+  SEP,
+  serverComposedHead,
+  TAGLINE,
+  clamp,
+  host,
+  pageTitle,
+} from "../src/web/page-title.js";
 
 describe("the shelf", () => {
   it("is the one page that leads with the app's name, and the one with the strapline", () => {
@@ -55,7 +66,9 @@ describe("an article", () => {
   const title = "The Mythology of Conscious AI";
 
   it("leads with the article, not the app", () => {
-    expect(pageTitle({ kind: "read", title, view: "article" })).toBe(`${title}${SEP}${APP_NAME}`);
+    expect(pageTitle({ kind: "read", title, view: "article", mode: DEFAULT_MODE })).toBe(
+      `${title}${SEP}${APP_NAME}`,
+    );
   });
 
   it("says nothing about the default mode — that is the point of it", () => {
@@ -89,8 +102,13 @@ describe("an article", () => {
     }
   });
 
-  it("names the other two views, and ignores any mode that came with them", () => {
-    expect(pageTitle({ kind: "read", title, view: "metadata", mode: "chat" })).toBe(
+  /* This used to pass a mode to the metadata view and assert it was ignored.
+     `TitleSpec` no longer lets that state be built — the reading view requires a
+     mode and the other two forbid one — so the case it was defending is a
+     compile error now, which is the better place for it. What is left is the
+     label itself. */
+  it("names the other two views", () => {
+    expect(pageTitle({ kind: "read", title, view: "metadata" })).toBe(
       `${title}${SEP}Metadata${SEP}${APP_NAME}`,
     );
     expect(pageTitle({ kind: "read", title, view: "tweets" })).toBe(
@@ -99,7 +117,7 @@ describe("an article", () => {
   });
 
   it("has something to say about an article with no title at all", () => {
-    expect(pageTitle({ kind: "read", title: "  ", view: "article" })).toBe(
+    expect(pageTitle({ kind: "read", title: "  ", view: "article", mode: DEFAULT_MODE })).toBe(
       `Untitled${SEP}${APP_NAME}`,
     );
   });
@@ -107,7 +125,7 @@ describe("an article", () => {
   it("clamps a very long title so the app's name survives in a history list", () => {
     const long =
       "Attention Is All You Need But Also A Great Many Other Things Besides Which This Title Will Now List At Length";
-    const t = pageTitle({ kind: "read", title: long, view: "article" });
+    const t = pageTitle({ kind: "read", title: long, view: "article", mode: DEFAULT_MODE });
     expect(t.endsWith(`${SEP}${APP_NAME}`)).toBe(true);
     expect(t).toContain("…");
     expect(t.length).toBeLessThan(long.length);
@@ -145,7 +163,7 @@ describe("every title, whatever the page", () => {
   const every = [
     { kind: "library" },
     { kind: "library", query: "x", unread: true },
-    { kind: "read", title: "T", view: "article" },
+    { kind: "read", title: "T", view: "article", mode: DEFAULT_MODE },
     { kind: "read", title: "T", view: "article", mode: "search" },
     { kind: "read", title: "T", view: "metadata" },
     { kind: "add" },
@@ -238,6 +256,92 @@ describe("host", () => {
   });
 });
 
+/**
+ * **The tab a shared link arrives with, and the rule that stops us wrecking it.**
+ *
+ * Since 2026-08-29 a public `/read/<slug>` is served with the article's real
+ * title already in the tab. `ArticlePage` used to replace that with `Loading…`
+ * whenever the fetch ran past 600ms — a cold serverless start against Postgres,
+ * routinely — and then put it back. A correct title turning into a worse one and
+ * back, announced to a screen reader both times.
+ *
+ * `articleWaitTitle` is the decision. Its two guards are both load-bearing and
+ * each has a case below that fails without it.
+ */
+describe("what the tab says while a shared article loads", () => {
+  const HERE = { slug: "a-shared-piece", title: "A shared piece · Spideryarn" };
+  const LOADING = `Loading…${SEP}${APP_NAME}`;
+  const ERROR = `Couldn’t open${SEP}${APP_NAME}`;
+
+  it("says nothing, leaving the title the server composed", () => {
+    /* The assertion this case is named for and the reason the function exists:
+       "" is `useDocumentTitle`'s "not mine to set". */
+    expect(articleWaitTitle("loading", HERE.slug, HERE.title, HERE)).toBe("");
+  });
+
+  it("but says Loading… once the reader is waiting for a different article", () => {
+    /* Guard one. The composed head describes one article; after a navigation
+       the server's title is about the page the reader has left, and keeping it
+       would be a lie rather than a courtesy. Delete `composed.slug === slug`
+       and this is the case that goes red. */
+    expect(articleWaitTitle("loading", "some-other-piece", HERE.title, HERE)).toBe(LOADING);
+  });
+
+  it("and once something else has already changed the tab", () => {
+    /* Guard two, and the case that is easy to miss: a reader who goes
+       /read/a → /read/b → back to /read/a still has an `og:url` naming a, so
+       the slug check alone passes and b's title would be left standing over a's
+       loading page. Comparing the string self-expires the moment anything
+       writes a different one. */
+    expect(articleWaitTitle("loading", HERE.slug, "Another piece · Spideryarn", HERE)).toBe(LOADING);
+  });
+
+  it("and on every page the server did not compose a head for", () => {
+    /* An ordinary SPA navigation, a private article, a signed-in reader's own
+       shelf — the overwhelming majority of loads, and the behaviour this
+       function must leave exactly as it was. */
+    expect(articleWaitTitle("loading", HERE.slug, "Spideryarn", null)).toBe(LOADING);
+  });
+
+  it("replaces it when the fetch failed, which Loading… deliberately does not", () => {
+    /* `Loading…` is a claim that the right title is coming. `Couldn’t open` is a
+       claim that it is not, and a broken page must not go on advertising the
+       article it could not show. */
+    expect(articleWaitTitle("error", HERE.slug, HERE.title, HERE)).toBe(ERROR);
+  });
+
+  it("and hands over to the view as soon as the article is here", () => {
+    expect(articleWaitTitle("ready", HERE.slug, HERE.title, HERE)).toBe("");
+  });
+});
+
+describe("reading what the server composed out of the document", () => {
+  const docWith = (head: string): Document =>
+    new JSDOM(`<!doctype html><html><head>${head}<title>A shared piece · Spideryarn</title></head><body></body></html>`).window.document;
+
+  it("takes the slug from og:url, which is the only thing that carries it", () => {
+    const d = docWith('<meta property="og:url" content="https://www.spideryarn.com/read/a-shared-piece" />');
+    expect(serverComposedHead(d)).toEqual({
+      slug: "a-shared-piece",
+      title: "A shared piece · Spideryarn",
+    });
+  });
+
+  it("decodes it, because the server percent-encodes what it writes there", () => {
+    const d = docWith('<meta property="og:url" content="https://www.spideryarn.com/read/a%20b" />');
+    expect(serverComposedHead(d)?.slug).toBe("a b");
+  });
+
+  it("and says there is none for every page the server did not compose", () => {
+    /* The bare shell — every route but a shared article. */
+    expect(serverComposedHead(docWith(""))).toBeNull();
+    /* A malformed percent-escape makes `decodeURIComponent` throw, and a throw
+       at module load would take the whole bundle down over a tab title. */
+    const bad = docWith('<meta property="og:url" content="https://www.spideryarn.com/read/a%zz" />');
+    expect(serverComposedHead(bad)).toBeNull();
+  });
+});
+
 /**
  * **A page wired to a route but not to a title is the silent failure here** —
  * it simply inherits whatever the last page set, and a stale title on a new
@@ -271,6 +375,27 @@ describe("every kind of page is actually wired up", () => {
     expect(missing).toEqual([]);
   });
 
+  /**
+   * **`articleWaitTitle` is only worth anything if `ArticlePage` calls it.**
+   *
+   * Earlier in this same body of work a guard was written, documented, called by
+   * a build check and referred to in its file's header as being in force — and
+   * never called from the function it was guarding. The rule against a rule that
+   * is documented but not enforced was itself documented and not enforced.
+   *
+   * This is a **static** check and it says so: it proves the call is written, not
+   * that it runs. The dynamic half would mean mounting `ArticlePage`, which
+   * drags the whole app in; the six cases above cover the decision itself, and
+   * this covers the one failure they cannot see.
+   */
+  it("and ArticlePage actually asks articleWaitTitle what to say", () => {
+    const app = readFileSync(path.join(WEB, "App.tsx"), "utf8");
+    expect(app).toContain("articleWaitTitle(");
+    /* And has stopped composing the answer itself, which is the shape the call
+       replaced — leaving both would put the old behaviour back on some path. */
+    expect(app).not.toContain('pageTitle({ kind: "loading" })');
+  });
+
   it("can tell — the union really was read, and it is not empty", () => {
     expect(kinds().length).toBeGreaterThanOrEqual(9);
     expect(kinds()).toContain("library");
diff --git a/tests/public-read-page.test.ts b/tests/public-read-page.test.ts
index 6420927..0a21551 100644
--- a/tests/public-read-page.test.ts
+++ b/tests/public-read-page.test.ts
@@ -147,6 +147,14 @@ async function serve(
   method: string,
   slug: string,
   read: (slug: string) => Promise<PublicHead>,
+  /**
+   * The address, which the page module reads the mode and the view out of.
+   * Defaults to the plain reading URL for this slug, because that is what every
+   * case here is about; `tests/address-settling.test.ts` is where the query
+   * varies. It became a required argument on 2026-08-30 so that the wiring
+   * cannot be reassembled by a test while production drops half of it.
+   */
+  url = `/read/${slug}`,
 ): Promise<Answer> {
   const headers: Record<string, string> = {};
   let status = 0;
@@ -170,7 +178,7 @@ async function serve(
     },
   } as unknown as ServerResponse;
 
-  await servePublicReadPage({ res, method, slug, shell, read });
+  await servePublicReadPage({ req: { method, url }, res, slug, shell, read });
   return { status, headers, body, wroteBody };
 }
 
diff --git a/tests/public-read-rewrite.test.ts b/tests/public-read-rewrite.test.ts
index b2425ed..48870a0 100644
--- a/tests/public-read-rewrite.test.ts
+++ b/tests/public-read-rewrite.test.ts
@@ -33,8 +33,11 @@ import path from "node:path";
 import { describe, expect, it } from "vitest";
 
 import { decidePublicPage } from "../src/public/page.js";
-import { originalUrl, readSlug } from "../src/vercel.js";
-import { parseRoute } from "../src/web/router.js";
+import { DEFAULT_MODE, MODES } from "../src/modes.js";
+import { redirectsToMetadata, viewFor } from "../src/read-address.js";
+import { modeParam } from "../src/web/params.js";
+import { originalUrl, readMode, readSlug } from "../src/vercel.js";
+import { canonicalAddHref, parseRoute, settleAddress } from "../src/web/router.js";
 
 const ROOT = path.resolve(import.meta.dirname, "..");
 
@@ -313,6 +316,230 @@ describe("readSlug, and what a malformed capture is answered with", () => {
   });
 });
 
+/**
+ * **The mode has to survive the rewrite, because the tab carries it.**
+ *
+ * `/read/x?mode=glossary` was served as `x · Spideryarn` and then rewritten by
+ * React to `x · Glossary · Spideryarn` — the same fault as the whitespace one,
+ * on the axis nothing was varying. GPT Sol found it, 2026-08-30.
+ *
+ * The rewrite preserves the original query beside the `__spy_read` capture
+ * (§ *originalUrl and the second capture* above), so the value is here to be
+ * read; `readMode` is what reads it.
+ */
+describe("readMode, and the mode a shared address asked for", () => {
+  it("takes it off the restored URL, for every mode there is", () => {
+    for (const mode of MODES) {
+      expect(readMode(`/read/some-article?mode=${mode}`), mode).toBe(mode);
+    }
+  });
+
+  it("lands an unknown one on the default rather than failing", () => {
+    /* The rule `modeParam` already keeps on the client: a link from a future
+       version, or a pre-2026-08-29 `?mode=toc` link, degrades to the article
+       rather than to an error. `toc` is the real case — it named this very
+       view until the rename. */
+    for (const asked of ["toc", "", "HIERARCHY", "glossary ", "../../etc/passwd", "%zz"]) {
+      expect(readMode(`/read/some-article?mode=${asked}`), asked).toBe("hierarchy");
+    }
+  });
+
+  it("and on the default when the address says nothing about it", () => {
+    expect(readMode("/read/some-article")).toBe("hierarchy");
+    expect(readMode("/read/some-article?at=spya-k3m9qt")).toBe("hierarchy");
+    /* A stranger controls this string, and a throw here would be a 500 on an
+       address that only wanted a tab title. */
+    expect(readMode("/read/some-article?%")).toBe("hierarchy");
+    expect(readMode("")).toBe("hierarchy");
+  });
+
+  /**
+   * **The two predicates, paired on the inputs that are not modes.**
+   *
+   * `readMode` calls `isMode`; `modeParam.parse` used to call `MODES.includes`
+   * separately, so "one place decides what a mode is" was a claim rather than a
+   * fact — and every test compared each side against literals instead of
+   * against the other. They agreed, but nothing would have noticed if they
+   * stopped. GPT Sol, 2026-08-30.
+   *
+   * The corpus is mostly **junk on purpose**: the nine good values are the case
+   * that already passes, and the interesting question is whether two
+   * implementations of "not a mode" reject identically.
+   */
+  it("agrees with the client's own parser about what is not a mode", () => {
+    const asked = [
+      ...MODES,
+      "toc",
+      "TOC",
+      "Hierarchy",
+      "hierarchy ",
+      " hierarchy",
+      "hierarchy,chat",
+      "",
+      "0",
+      "null",
+      "undefined",
+      "__proto__",
+      "constructor",
+      "toString",
+      "hasOwnProperty",
+      "length",
+      "0.5",
+      "-1",
+      "true",
+    ];
+    for (const value of asked) {
+      const client = modeParam.parse(value) ?? DEFAULT_MODE;
+      const server = readMode(`/read/some-article?mode=${encodeURIComponent(value)}`);
+      expect(server, `mode=${JSON.stringify(value)}`).toBe(client);
+    }
+    /* And the control: the corpus really does contain things that are rejected,
+       so "they agree" is not the trivial agreement of two functions that accept
+       everything. */
+    expect(asked.filter((v) => modeParam.parse(v) === null).length).toBeGreaterThan(10);
+  });
+
+  it("survives the round trip through the rewrite, which is the only path it has", () => {
+    /* Not `readMode` on a URL written by hand: the value has to come through
+       `originalUrl`, because that is where a rewrite that dropped the query
+       would show up — and a hand-written URL would pass with the query
+       discarded. */
+    const restored = originalUrl("/api/index?__spy_read=some-article&mode=glossary");
+    expect(restored, "the rewrite must preserve the query").toContain("mode=glossary");
+    expect(readMode(restored ?? "")).toBe("glossary");
+  });
+});
+
+/**
+ * **The legacy metadata spellings, which reach the composer while the real
+ * metadata address never does.**
+ *
+ * `/read/x/metadata` is two path segments, so vercel.json's `/read/:slug` does
+ * not match it and it falls to the SPA catch-all — pinned above. I checked that
+ * and concluded the view axis was safe. It is not: `/read/x?about=1` is **one**
+ * segment, so it matches, the server composed the *article's* title for it, and
+ * `main.tsx` then rewrote the address to `/read/x/metadata` before React drew
+ * anything. The tab went `Article · Spideryarn` → `Article · Metadata ·
+ * Spideryarn`; with `?mode=glossary` on it, `Article · Glossary · Spideryarn` →
+ * `Article · Metadata · Spideryarn`. GPT Sol, 2026-08-30 — the fifth of these,
+ * and the second it found after I had reasoned my way past the axis.
+ */
+describe("viewFor, and the legacy spellings of the metadata page", () => {
+  it("recognises the two that redirect, given a query or a whole URL", () => {
+    /* Both shapes, because the client passes `location.search` and the server
+       passes the restored URL — and the doc-comment claimed only the first while
+       production used the second. GPT Sol, 2026-08-30. */
+    for (const query of [
+      "/read/some-article?about=1",
+      "/read/some-article?panel=about",
+      "/read/some-article?mode=glossary&about=1",
+      "?about=1",
+      "?panel=about",
+      "?mode=glossary&about=1",
+      "?about=1&mode=glossary",
+      "?at=spya-k3m9qt&panel=about&cols=0,1",
+    ]) {
+      expect(viewFor(query), query).toBe("metadata");
+      expect(redirectsToMetadata(query), query).toBe(true);
+    }
+  });
+
+  it("and leaves the article alone for everything else, `about=0` included", () => {
+    /* `about=0` meant the panel was shut. It is stripped from the URL and the
+       reader stays on the article, so the server must go on composing the
+       article's title for it — the one case where "contains about=" and
+       "becomes the metadata page" are different answers. */
+    for (const query of [
+      "/read/some-article",
+      "/read/some-article?about=0",
+      "/read/some-article?mode=glossary",
+      "",
+      "?",
+      "?about=0",
+      "?mode=glossary",
+      "?about=2",
+      "?aboutx=1",
+      "?xabout=1",
+      "?panel=notes",
+      "?panel=aboutish",
+      "?notabout=1",
+    ]) {
+      expect(viewFor(query), query).toBe("article");
+      expect(redirectsToMetadata(query), query).toBe(false);
+    }
+  });
+
+  it("agrees with the rewrite the client actually performs", () => {
+    /* Not a grep for a string any more: `settleAddress` **is** the sequence
+       main.tsx runs, so this compares the server's prediction against the
+       client's real behaviour rather than against a copy of it. */
+    for (const [query, settled] of [
+      ["?about=1", "/read/some-article/metadata"],
+      ["?panel=about", "/read/some-article/metadata"],
+      ["?about=1&mode=glossary", "/read/some-article/metadata?mode=glossary"],
+    ] as const) {
+      expect(settleAddress("/read/some-article", query, ""), query).toBe(settled);
+      expect(viewFor(query), query).toBe("metadata");
+    }
+    /* And the pair that must NOT move, with the server agreeing. */
+    for (const query of ["?about=0", "?mode=glossary", ""]) {
+      const after = settleAddress("/read/some-article", query, "");
+      expect(after === null || !after.includes("/metadata"), query).toBe(true);
+      expect(viewFor(query), query).toBe("article");
+    }
+  });
+});
+
+/**
+ * **The two older legacy entrances, which reach the composer the same way.**
+ *
+ * `/?slug=x` and `/?add=<url>` are addresses from when everything was a
+ * parameter on one page (docs/project/url-state.md). Neither was constrained to
+ * the root, so both fired on `/read/a?…` — which is **one** path segment, so the
+ * server composes article *a*'s title for it and the client then navigates
+ * somewhere else entirely: to a different article, or to an add page.
+ *
+ * Sixth and seventh of these. GPT Sol found both on 2026-08-30, in the third
+ * round, after I had twice said the axis was covered. The lesson is the one from
+ * the metadata case, and it did not take the first time: **a legacy entrance is
+ * a door into a different page that does not look like one**, and enumerating
+ * the routes will not find it because it is not a route.
+ */
+describe("the older legacy entrances, which must not fire under /read/", () => {
+  it("leaves ?slug= alone anywhere but the root, so the client cannot swap the article", () => {
+    /* Behavioural now that the sequence is a function: the address the server
+       titled as article `an-article` must still be that article afterwards. */
+    const after = settleAddress("/read/an-article", "?slug=other", "");
+    expect(after === null || !after.includes("other"), String(after)).toBe(true);
+    /* The control: on the root it still works, so the assertion above is about
+       the pathname rather than about a rewrite that has stopped happening. */
+    expect(settleAddress("/", "?slug=other", "")).toBe("/read/other");
+  });
+
+  it("and reads ?add= on the root only", () => {
+    /* The address the server composes an article title for. */
+    expect(canonicalAddHref("/read/an-article", "?add=https://example.com/x", "")).toBeNull();
+    expect(canonicalAddHref("/read/an-article", "?add=https://example.com/x&at=spya-k3m9qt", "")).toBeNull();
+    /* And the control, or the assertions above would pass against a function
+       that had stopped reading `?add=` at all: on the root it still works, which
+       is the whole feature Greg asked for. */
+    expect(canonicalAddHref("/", "?add=https://example.com/x", "")).toBe(
+      "/add/https%3A%2F%2Fexample.com%2Fx",
+    );
+    /* The path form is untouched — `/add/<url>` is canonical wherever it is. */
+    expect(canonicalAddHref("/add/https://x.test/a", "?utm=1", "")).not.toBeNull();
+  });
+
+  it("while the server goes on composing the article's own title for both", () => {
+    /* The other half of the pair: these addresses stay on the reading view, so
+       the server's title is right and must not become a Metadata one. */
+    for (const query of ["?slug=other", "?add=https://example.com/x"]) {
+      expect(viewFor(query), query).toBe("article");
+      expect(readMode(`/read/an-article${query}`), query).toBe("hierarchy");
+    }
+  });
+});
+
 describe("parseRoute and a malformed slug", () => {
   /**
    * **`/read/Upper` is the shelf, not an error page.**
@@ -351,3 +578,94 @@ describe("parseRoute and a malformed slug", () => {
     });
   });
 });
+
+/**
+ * **public/robots.txt, and the one hole in it.**
+ *
+ * Greg's call, 2026-08-30: name the two preview bots so a shared link draws a
+ * card in Meta's apps, and leave the blanket `Disallow: /` standing for
+ * everybody else.
+ *
+ * **What this describe does not do is model a crawler.** It parses the file into
+ * groups and asserts what is in them; it makes no claim about how any given
+ * robot resolves `Allow` against `Disallow`, because a parser I wrote agreeing
+ * with a parser I wrote is worth nothing. The real check is empirical and comes
+ * after a deploy: paste a link and look at the card. What these cases are for is
+ * the *other* failure — a later edit that drops a line, or adds a bot, without
+ * anybody noticing.
+ *
+ * The one semantic claim here is the one that is easy to get wrong and cheap to
+ * check: **a robot obeys exactly one group**, the most specific one naming it,
+ * and inherits nothing from `*`. So a named group without its own `Disallow: /`
+ * is not a narrow hole, it is an open door — and it would look, in a diff, like
+ * the tidier version of this file.
+ */
+describe("public/robots.txt", () => {
+  type Group = { agents: string[]; rules: { rule: string; path: string }[] };
+
+  const groups: Group[] = [];
+  {
+    const text = readFileSync(path.join(process.cwd(), "public/robots.txt"), "utf8");
+    let open: Group | null = null;
+    for (const raw of text.split("\n")) {
+      const line = raw.replace(/#.*$/, "").trim();
+      if (line === "") continue;
+      const [key = "", ...rest] = line.split(":");
+      const value = rest.join(":").trim();
+      const name = key.trim().toLowerCase();
+      if (name === "user-agent") {
+        /* Consecutive user-agent lines share one group; a rule closes it. */
+        if (open === null || open.rules.length > 0) {
+          open = { agents: [], rules: [] };
+          groups.push(open);
+        }
+        open.agents.push(value);
+      } else if (open !== null) {
+        open.rules.push({ rule: name, path: value });
+      }
+    }
+  }
+
+  const groupFor = (agent: string): Group | undefined =>
+    groups.find((g) => g.agents.some((a) => a.toLowerCase() === agent.toLowerCase()));
+
+  it("still shuts out everybody who is not named", () => {
+    expect(groupFor("*")?.rules).toEqual([{ rule: "disallow", path: "/" }]);
+  });
+
+  /* Mutation: drop either name and this reddens; that is the whole point of it,
+     because losing a card is silent — the link still works, it just looks like
+     nothing. */
+  it("names exactly the two preview bots and no others", () => {
+    const named = groups.flatMap((g) => g.agents).filter((a) => a !== "*");
+    expect(named.sort()).toEqual(["Twitterbot", "facebookexternalhit"]);
+  });
+
+  it.each(["facebookexternalhit", "Twitterbot"])(
+    "lets %s reach /read/ and nothing else",
+    (agent) => {
+      const group = groupFor(agent);
+      expect(group).toBeDefined();
+      /* Both lines, in this order. `Allow` alone would be the open door, and
+         `Disallow` alone would be the hole closed again. */
+      expect(group?.rules).toEqual([
+        { rule: "allow", path: "/read/" },
+        { rule: "disallow", path: "/" },
+      ]);
+    },
+  );
+
+  /**
+   * **The hole is for cards, not for search**, and this is the pair that says
+   * so. Fetching is now permitted for two robots; indexing is refused to all of
+   * them, by a header and a meta tag that neither of those two reads for
+   * anything. If a later slice wants public articles indexed, it has to defeat
+   * both of these deliberately — see docs/project/page-titles.md.
+   */
+  it("does not, on its own, let anything be indexed", () => {
+    const robots = config.headers.flatMap((h) =>
+      h.headers.filter((k) => k.key.toLowerCase() === "x-robots-tag").map((k) => k.value),
+    );
+    expect(robots).toEqual(["noindex, nofollow"]);
+  });
+});
diff --git a/tests/public-visibility-pg.test.ts b/tests/public-visibility-pg.test.ts
index 2d454eb..e32e2f4 100644
--- a/tests/public-visibility-pg.test.ts
+++ b/tests/public-visibility-pg.test.ts
@@ -47,6 +47,7 @@ import {
 } from "../src/db/schema.js";
 import { loadEnvLocal } from "../src/env.js";
 import { pgPublicReader } from "../src/store/public-reader.js";
+import { documentTitle } from "../src/title-text.js";
 import { safePublicCanonical } from "../src/urls.js";
 import { currentOwnerId, type OwnerId, runInRequest } from "../src/owner.js";
 import type { Glossary, Ideas, Summaries, TweetThread } from "../src/types.js";
@@ -93,6 +94,10 @@ const EXTRACTED_TITLE = "A piece somebody shared";
  * comes across the wire from Postgres whatever the table guard says, and only
  * the projection in src/public/dto.ts drops it.
  */
+/* A steer, on an artefact written before the box was deleted on 2026-08-30
+   (docs/plans/steer-becomes-the-profile.md). Nothing writes one now; every
+   summary stored before then still carries one inside its JSON, so the
+   projection still has to drop it and this still has to prove that. */
 const PRIVATE_GUIDANCE = "I am reading this to argue with a colleague, skip the history";
 const PRIVATE_LOOKUP = "what the owner asked the web and what it said back";
 const PRIVATE_PROFILE_HASH = "profilehash-nobodyelsesbusiness";
@@ -152,7 +157,10 @@ const ARTEFACTS: {
     slug: SLUG,
     sourceHash: "abc",
     profileHash: PRIVATE_PROFILE_HASH,
-    guidance: PRIVATE_GUIDANCE,
+    /* `Summaries` no longer declares this, so it is spread in rather than
+       written as a key — see PRIVATE_GUIDANCE above for why an artefact that
+       cannot be written any more still has to be *read* safely. */
+    ...({ guidance: PRIVATE_GUIDANCE } as Record<string, string>),
     missing: 0,
     generatedAt: "2026-02-02T00:00:00.000Z",
     elapsedMs: 1,
@@ -747,6 +755,49 @@ when("sharing one article", { timeout: 60_000 }, () => {
     expect(owned.text).not.toBe(anonymous.text);
   });
 
+  /**
+   * **The one place the tab is allowed to change at mount, written down as a
+   * decision rather than left as a surprise.**
+   *
+   * Everything else in this body of work exists to stop the server-composed
+   * `<title>` being replaced by a different one when React mounts — five
+   * divergences, docs/project/page-titles.md. This is the sixth, and it is not
+   * a bug: the public head must never carry `articles.title_override`, because
+   * that is the owner's private name for the piece and the head is served to
+   * strangers. The owner's own payload deliberately applies it (`titleFor`), so
+   * an **owner** hard-loading their own renamed public article sees the
+   * extracted title for a moment and then their own name for it.
+   *
+   * Nobody else can see this. A stranger, a signed-in stranger and the owner all
+   * get byte-identical *public* responses (the case above), so the change is
+   * visible only to the one person who already knows both strings.
+   *
+   * GPT Sol raised it, 2026-08-30, as something needing "an explicit accepted
+   * exception and test, or different tab semantics — never disclosure of the
+   * private rename in the public head". This is the exception, accepted: the
+   * disclosure is the thing that must not move, and it is asserted first.
+   */
+  it("changes the owner's tab at mount, which is the accepted cost of hiding the rename", async () => {
+    const head = await pgPublicReader.loadHead(SLUG);
+
+    /* **The property that must never regress, first.** Everything above an
+       assertion is a lid on it, and this is the one worth the whole case. */
+    expect(head.title, "the public head must not carry the private rename").not.toBe(PRIVATE_TITLE);
+    expect(JSON.stringify(head)).not.toContain(PRIVATE_TITLE);
+    expect(documentTitle(head.title)).not.toContain(PRIVATE_TITLE);
+
+    /* What it says instead — the extracted title, spelled out. */
+    expect(head.title).toBe(EXTRACTED_TITLE);
+    expect(documentTitle(head.title)).toBe(`${EXTRACTED_TITLE} · Spideryarn`);
+
+    /* And what the owner's client will put there a moment later, from their own
+       endpoint. The two differ, and that difference is the exception. */
+    const owned = await call("GET", `/api/article/${SLUG}`, { as: OWNER });
+    const ownerTitle = (owned.body as { meta: { title: string | null } }).meta.title;
+    expect(ownerTitle).toBe(PRIVATE_TITLE);
+    expect(documentTitle(ownerTitle)).not.toBe(documentTitle(head.title));
+  });
+
   /** And Bob still cannot reach it through the owner's route. */
   it("and the owned route still refuses everybody else", async () => {
     const r = await call("GET", `/api/article/${SLUG}`, { as: OUTSIDER });
@@ -1468,6 +1519,312 @@ when("a public article whose revision has no blocks", { timeout: 60_000 }, () =>
   });
 });
 
+/**
+ * **An article with no title of its own, which is where the two sides said
+ * different things.**
+ *
+ * `/read/<slug>` is served with a `<title>` composed from `loadHead`, and React
+ * then sets `document.title` from the article payload's `meta.title`. Those come
+ * from two different fallback chains:
+ *
+ *   loadHead   `title ?? headingTitle`               → then `Untitled`
+ *   metaFrom   `title ?? headingTitle ?? slug`       (src/public/dto.ts)
+ *
+ * They agree for every article that has a title or an `<h1>`, which is nearly
+ * all of them, and that is exactly why nothing caught it: **the corpus could not
+ * reach the disagreement.** For an article with neither, the tab said
+ * `Untitled · Spideryarn` and then changed to the slug a second later. GPT Sol
+ * found it while reviewing the fix for the *other* divergence between these two
+ * (whitespace and bidi normalising, src/title-text.ts), minutes before its
+ * 45-minute budget ran out.
+ *
+ * It needs its own fixture for the reason the boneless one above does: the main
+ * fixture has both a title and an `<h1>`, so the bug is unreachable from it and
+ * every assertion in this file stays green with the fault in place.
+ *
+ * Blocks, so `hasBlocks` passes and the head is served at all — but not one of
+ * them is a level-1 heading, which is what `PUBLIC_HEADING_TITLE` looks for.
+ */
+const TITLELESS_ID = "00000000-0000-4000-8000-0000000b04f0";
+const TITLELESS_REVISION = "00000000-0000-4000-8000-0000000b04f1";
+const TITLELESS_SLUG = "test-public-head-no-title";
+/* The id alphabet excludes i, l, o and 1 (src/ids.ts), and `block_identities`
+   has a check constraint on it — "notitl" is refused for three of those four. */
+const TITLELESS_BLOCK = "spya-ntxhqz";
+
+when("a public article with neither a title nor an <h1>", { timeout: 60_000 }, () => {
+  beforeAll(async () => {
+    const db = getDb();
+    await cleanTitleless();
+    await db.insert(articles).values({
+      id: TITLELESS_ID,
+      ownerId: OWNER,
+      slug: TITLELESS_SLUG,
+      visibility: "public",
+    });
+    await db.insert(articleRevisions).values({
+      id: TITLELESS_REVISION,
+      articleId: TITLELESS_ID,
+      status: "published",
+      /* The whole point of the fixture. */
+      title: null,
+      wordCount: 7,
+      blockCount: 1,
+      tree: {
+        version: "test",
+        generator: "test",
+        slug: TITLELESS_SLUG,
+        rootId: "n0",
+        nodes: {
+          n0: { id: "n0", depth: 0, parent: null, children: [], range: [TITLELESS_BLOCK, TITLELESS_BLOCK], title: "Root", gist: "Prose with no heading above it." },
+        },
+      },
+    });
+    /* `revision_blocks` has a foreign key into `block_identities` — an id is
+       minted once for an article and every later revision points at it
+       (docs/project/block-ids.md). Without this row the insert below fails with
+       `revision_blocks_identity_fk`, and vitest reports the whole suite's tests
+       as **skipped** rather than failed, which is how a broken fixture reads as
+       green in a filtered summary. */
+    await db.insert(blockIdentities).values({ articleId: TITLELESS_ID, blockId: TITLELESS_BLOCK });
+    await db.insert(revisionBlocks).values([
+      {
+        articleId: TITLELESS_ID,
+        revisionId: TITLELESS_REVISION,
+        blockId: TITLELESS_BLOCK,
+        ordinal: 0,
+        /* `p`, not `h1`. A heading here would give the fallback something to
+           find and the fixture would stop being able to show the bug. */
+        tag: "p",
+        kind: "text",
+        text: "Prose with no heading above it.",
+        words: 6,
+        html: "<p>Prose with no heading above it.</p>",
+        gistable: true,
+      },
+    ]);
+    await db
+      .update(articles)
+      .set({ currentRevisionId: TITLELESS_REVISION })
+      .where(eq(articles.id, TITLELESS_ID));
+  });
+
+  afterAll(cleanTitleless);
+
+  it("gives the head the same title the client is about to set", async () => {
+    const head = await pgPublicReader.loadHead(TITLELESS_SLUG);
+    const r = await call("GET", `/api/public/article/${TITLELESS_SLUG}`);
+    /* A precondition rather than a claim: without a payload there is no client
+       title to disagree with, and the failure below would be about the wrong
+       thing. */
+    expect(r.status, "the fixture must be served at all").toBe(200);
+    const client = (r.body as { meta: { title: string | null } }).meta.title;
+
+    /* **The assertion this test is named for, and it goes first.** Everything
+       above an assertion is a lid on it — a failing `expect` ends the case, so a
+       fault caught by a later line proves nothing about this one. */
+    expect(head.title, "loadHead and metaFrom must agree").toBe(client);
+
+    /* And what they agree *on*, spelled out, because two sides agreeing on the
+       wrong answer is the other way this passes while broken. The slug is the
+       fallback the owner's side has always used; `Untitled` was only ever the
+       head's. */
+    expect(head.title).toBe(TITLELESS_SLUG);
+    expect(documentTitle(head.title)).toBe(`${TITLELESS_SLUG} · Spideryarn`);
+    expect(documentTitle(head.title)).not.toContain("Untitled");
+  });
+
+  /**
+   * The control on the fixture: it really does have neither of the two things
+   * the fallback prefers. If a later edit gave it a title or an `<h1>`, the case
+   * above would pass with the bug back in place, and nothing would say so.
+   */
+  it("and the fixture really is titleless — no stored title, no level-1 heading", async () => {
+    const db = getDb();
+    const [rev] = await db
+      .select({ title: articleRevisions.title })
+      .from(articleRevisions)
+      .where(eq(articleRevisions.id, TITLELESS_REVISION));
+    expect(rev?.title).toBeNull();
+
+    const headings = await db
+      .select({ blockId: revisionBlocks.blockId })
+      .from(revisionBlocks)
+      .where(and(eq(revisionBlocks.revisionId, TITLELESS_REVISION), eq(revisionBlocks.kind, "heading")));
+    expect(headings).toEqual([]);
+  });
+});
+
+/**
+ * **The `<h1>` rung of the same fallback, which has two implementations.**
+ *
+ * `loadHead` finds the first level-1 heading **in SQL** (`PUBLIC_HEADING_TITLE`,
+ * src/store/public-reader.ts); the article payload finds it **in TypeScript**
+ * (`headingTitleOf`, src/library-scalars.ts, over the blocks it already has in
+ * memory). Two implementations of one rule, and the tab is composed from the
+ * first and then overwritten from the second.
+ *
+ * The fixture above covers only the last rung, the slug. This one covers the
+ * rung above it, and it is built to be **awkward on the two axes each
+ * implementation could get wrong on its own**:
+ *
+ *  - an `h2` sits before the first `h1`, so anything that takes the first
+ *    *heading* rather than the first level-1 heading picks the wrong one;
+ *  - there are two `h1`s, and the rows are **inserted in the wrong order**, so
+ *    an implementation that leans on insertion order rather than `ordinal`
+ *    picks the second.
+ *
+ * GPT Sol asked for this, 2026-08-30: the two agree today, but nothing paired
+ * them, so a mutation like `level = 2` or a reversed `order by` in the SQL would
+ * have survived every test in the repo.
+ */
+const HEADED_ID = "00000000-0000-4000-8000-0000000b0500";
+const HEADED_REVISION = "00000000-0000-4000-8000-0000000b0501";
+const HEADED_SLUG = "test-public-head-h1-fallback";
+/** What both implementations must find: the first `h1` *by ordinal*. */
+const HEADED_H1 = "The first level-one heading";
+
+when("a public article whose only title is its first <h1>", { timeout: 60_000 }, () => {
+  beforeAll(async () => {
+    const db = getDb();
+    await cleanHeaded();
+    await db.insert(articles).values({
+      id: HEADED_ID,
+      ownerId: OWNER,
+      slug: HEADED_SLUG,
+      visibility: "public",
+    });
+    await db.insert(articleRevisions).values({
+      id: HEADED_REVISION,
+      articleId: HEADED_ID,
+      status: "published",
+      title: null,
+      wordCount: 12,
+      blockCount: 3,
+      tree: {
+        version: "test",
+        generator: "test",
+        slug: HEADED_SLUG,
+        rootId: "n0",
+        nodes: {
+          n0: {
+            id: "n0",
+            depth: 0,
+            parent: null,
+            children: [],
+            range: ["spya-hdgaaa", "spya-hdgccc"],
+            title: "Root",
+            gist: "A piece whose title is its heading.",
+          },
+        },
+      },
+    });
+    for (const id of ["spya-hdgaaa", "spya-hdgbbb", "spya-hdgccc"]) {
+      await db.insert(blockIdentities).values({ articleId: HEADED_ID, blockId: id });
+    }
+    /* **Deliberately not in ordinal order.** An implementation that takes the
+       first row it is handed rather than the lowest `ordinal` gets the second
+       `h1`, and that is the whole point of writing them this way round. */
+    await db.insert(revisionBlocks).values([
+      {
+        articleId: HEADED_ID,
+        revisionId: HEADED_REVISION,
+        blockId: "spya-hdgccc",
+        ordinal: 2,
+        tag: "h1",
+        kind: "heading",
+        level: 1,
+        text: "A second level-one heading, later in the document",
+        words: 8,
+        html: "<h1>A second level-one heading, later in the document</h1>",
+        gistable: true,
+      },
+      {
+        articleId: HEADED_ID,
+        revisionId: HEADED_REVISION,
+        blockId: "spya-hdgaaa",
+        ordinal: 0,
+        /* An `h2` above the first `h1`, so "first heading" and "first level-1
+           heading" are different answers. */
+        tag: "h2",
+        kind: "heading",
+        level: 2,
+        text: "A subheading that comes first",
+        words: 5,
+        html: "<h2>A subheading that comes first</h2>",
+        gistable: true,
+      },
+      {
+        articleId: HEADED_ID,
+        revisionId: HEADED_REVISION,
+        blockId: "spya-hdgbbb",
+        ordinal: 1,
+        tag: "h1",
+        kind: "heading",
+        level: 1,
+        text: HEADED_H1,
+        words: 4,
+        html: `<h1>${HEADED_H1}</h1>`,
+        gistable: true,
+      },
+    ]);
+    await db
+      .update(articles)
+      .set({ currentRevisionId: HEADED_REVISION })
+      .where(eq(articles.id, HEADED_ID));
+  });
+
+  afterAll(cleanHeaded);
+
+  it("finds the same <h1> in SQL that the payload finds in TypeScript", async () => {
+    const head = await pgPublicReader.loadHead(HEADED_SLUG);
+    const r = await call("GET", `/api/public/article/${HEADED_SLUG}`);
+    expect(r.status, "the fixture must be served at all").toBe(200);
+    const client = (r.body as { meta: { title: string | null } }).meta.title;
+
+    /* The assertion this case is named for, first. */
+    expect(head.title, "PUBLIC_HEADING_TITLE and headingTitleOf must agree").toBe(client);
+
+    /* And what they agree on, spelled out — not derived from either, or the
+       pair could agree on the subheading, on the second `h1`, or on the slug
+       and this would still pass. */
+    expect(head.title).toBe(HEADED_H1);
+    expect(head.title).not.toBe(HEADED_SLUG);
+    expect(documentTitle(head.title)).toBe(`${HEADED_H1} · Spideryarn`);
+  });
+
+  it("and the fixture really is awkward — an h2 first, and two h1s out of order", async () => {
+    /* The control on the control. If a later edit tidied these rows into
+       ordinal order or dropped the `h2`, the case above would pass with either
+       implementation broken and nothing would say so. */
+    const rows = await getDb()
+      .select({ ordinal: revisionBlocks.ordinal, level: revisionBlocks.level })
+      .from(revisionBlocks)
+      .where(eq(revisionBlocks.revisionId, HEADED_REVISION));
+    expect(rows.filter((r) => r.level === 1)).toHaveLength(2);
+    const first = rows.find((r) => r.ordinal === 0);
+    expect(first?.level, "an h2 must come before the first h1").toBe(2);
+  });
+});
+
+async function cleanHeaded() {
+  const db = getDb();
+  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, HEADED_ID));
+  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, HEADED_ID));
+  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, HEADED_ID));
+  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, HEADED_ID));
+  await db.delete(articles).where(eq(articles.id, HEADED_ID));
+}
+
+async function cleanTitleless() {
+  const db = getDb();
+  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, TITLELESS_ID));
+  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, TITLELESS_ID));
+  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, TITLELESS_ID));
+  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, TITLELESS_ID));
+  await db.delete(articles).where(eq(articles.id, TITLELESS_ID));
+}
+
 async function cleanBoneless() {
   const db = getDb();
   await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, BONELESS_ID));
diff --git a/tests/router.test.ts b/tests/router.test.ts
index 7667071..f2c03a6 100644
--- a/tests/router.test.ts
+++ b/tests/router.test.ts
@@ -6,8 +6,12 @@
  * blank page from a stray slash is the sort of failure that looks like the app
  * is broken rather than like the link was.
  */
+import { readFileSync } from "node:fs";
+import path from "node:path";
+
 import { describe, expect, it } from "vitest";
 import {
+  settleAddress,
   ADMIN_HREF,
   ADMIN_USERS_HREF,
   addHref,
@@ -548,14 +552,88 @@ describe("the auth callback", () => {
    * idea what `/auth/callback` is — which is exactly why the guard lives above
    * it in main.tsx rather than inside it.
    */
-  it("would be rewritten into an add if it were not exempt — so it must be exempt", () => {
-    /* Not an `/add/` path, so nothing to canonicalise: proves the callback is
-       safe from the path branch on its own. */
+  /**
+   * **Two guards now, and each is checked on its own.**
+   *
+   * This case used to read "`?add=` is read from the query wherever it appears,
+   * so the exemption in main.tsx is the only thing standing between a Google
+   * return and an ingest of the reader's authorisation code". That sentence
+   * stopped being true on 2026-08-30: `?add=` is now read on the **root only**,
+   * because reading it anywhere else made `/read/a?add=…` a page the server
+   * titled as article *a* and the client turned into an add.
+   *
+   * So the callback is safe twice over — and the danger of that is a test that
+   * passes because the function has gone inert rather than because a guard
+   * works. Hence the positive control below: the same query on `/` **is**
+   * folded, and does carry the secret, which is what makes the `null` above
+   * evidence about the pathname rather than about the query.
+   */
+  it("is not folded into an add — by the root constraint, and separately by main.tsx", () => {
+    /* Not an `/add/` path, so nothing to canonicalise: the path branch cannot
+       touch the callback on its own. */
     expect(canonicalAddHref("/auth/callback", "?code=SECRET&state=S", "")).toBeNull();
-    /* But `?add=` is read from the query wherever it appears, and this is the
-       shape that shows the guard is doing work rather than being decorative. */
-    const folded = canonicalAddHref("/auth/callback", "?add=https://x.test/a&code=SECRET", "");
-    expect(folded).not.toBeNull();
-    expect(folded).toContain("SECRET");
+
+    /* Guard one, the root constraint. */
+    expect(canonicalAddHref("/auth/callback", "?add=https://x.test/a&code=SECRET", "")).toBeNull();
+
+    /* **The control.** The identical query on the root is folded and does carry
+       the code, so the two `null`s above are the pathname doing work — not a
+       function that has quietly stopped reading `?add=` at all. */
+    const onRoot = canonicalAddHref("/", "?add=https://x.test/a&code=SECRET", "");
+    expect(onRoot).not.toBeNull();
+    expect(onRoot).toContain("SECRET");
   });
-});
+
+  /**
+   * **Guard two, and it is now a structural property rather than a habit.**
+   *
+   * Every pre-mount rewrite lives inside `settleAddress`, so `main.tsx` has
+   * exactly **one** place that changes the address and one `onCallback` check in
+   * front of it. It used to have four of each, which meant the person adding a
+   * fifth rewrite had to remember — and counting the guards, as an earlier
+   * version of this test did, would not have noticed an unguarded fifth. GPT Sol
+   * made that point on 2026-08-30; the fix is that a fifth rewrite now goes
+   * *inside* the guarded function and is exempt by construction.
+   *
+   * Still partly static, because module-init side effects cannot be called. But
+   * what it asserts is a count of rewrite *sites*, which is the thing that was
+   * actually hard to keep right.
+   */
+  it("carries a fragment across the ?slug= rewrite, which the old version dropped", () => {
+    /* A deliberate change, made while turning the four rewrites into one
+       function: the inline `?slug=` rewrite dropped the fragment and the
+       `about=` one beside it kept it, which reads as two rewrites written at
+       different times rather than a decision. Only a non-id fragment is
+       affected — `liftLegacyAnchor` runs first and turns `#spya-…` into `?at=`. */
+    expect(settleAddress("/", "?slug=a-piece", "#section-2")).toBe("/read/a-piece#section-2");
+    /* And the id case, to show the ordering: the fragment is consumed, not
+       carried, because it means a position rather than a place. */
+    expect(settleAddress("/", "?slug=a-piece", "#spya-k3m9qt")).toBe(
+      "/read/a-piece?at=spya-k3m9qt",
+    );
+  });
+
+  it("and main.tsx has exactly one guarded place where the address changes", () => {
+    const main = readFileSync(
+      path.join(path.resolve(import.meta.dirname, ".."), "src", "web", "main.tsx"),
+      "utf8",
+    );
+    expect(main.match(/history\.replaceState/g) ?? [], "one rewrite site, not four").toHaveLength(1);
+    expect(main).toContain("if (!onCallback) {");
+    expect(main).toContain("settleAddress(location.pathname, location.search, location.hash)");
+
+    /* And the behavioural half, which the old version had none of.
+       `?add=` on the callback is already inert — it is read on the root only —
+       so that shape no longer demonstrates anything: */
+    expect(settleAddress("/auth/callback", "?add=https://x.test/a&code=SECRET", "")).toBeNull();
+
+    /* **This is the shape that shows the guard still has work.** `about=` is
+       stripped on any path, so an unguarded `settleAddress` would rewrite the
+       callback's address — and a Google return carries a one-time `code` on it.
+       Google sends no `about=`, so this is not a live route; the point is that
+       the guard is doing something rather than being a comment, and it must stay
+       whatever the other rewrites are constrained to. */
+    const rewritten = settleAddress("/auth/callback", "?about=0&code=SECRET", "");
+    expect(rewritten, "the guard must have work to do, or it proves nothing").not.toBeNull();
+    expect(rewritten).toContain("code=SECRET");
+  });});
=== NEW FILE: src/modes.ts ===
/**
 * **The reader's nine middle-band modes, named once, in a module that imports
 * nothing.**
 *
 * This vocabulary was in src/web/params.ts, which is where it is used and where
 * its history is. It moved here on 2026-08-30 because a **second** reader of it
 * appeared on the far side of the client/server line: a shared `/read/<slug>`
 * is served by a serverless function that composes the `<title>`, and that title
 * carries the mode. Nothing that function reaches may import anything under
 * `src/web/` (tests/public-imports.test.ts), so the list had to come out.
 *
 * `params.ts` re-exports all three names, so every existing importer is
 * unchanged and this file is not something a component needs to know about.
 *
 * See src/title-text.ts for the labels these get in a title, and
 * docs/project/reading-view-overview.md for what each mode is.
 */

export const MODES = [
  /* Renamed from `toc` on 2026-08-29, at Greg's request: the reader sees
     "Hierarchy" and the code now says the same word. It also ends a collision
     that had lasted as long as the list — `toc` was simultaneously this mode and
     the *pipeline step* that builds tree.json (src/pipeline.ts § STEP_ORDER), so
     one word meant two things in one repo. The step keeps the name; the mode
     gives it up. docs/plans/defer-arc-and-rename-hierarchy.md § 3. */
  "hierarchy",
  "chat",
  "glossary",
  "search",
  "summary",
  "diagram",
  "ideas",
  /* Review is the seventh, 2026-08-27, and the first mode whose content comes
     from the reader rather than from the article: they say what they took from
     it and the model helps them find where that comes apart. It cost this list
     one word, like the five before it. docs/plans/review-mode.md.

     There is deliberately no `?stance=` beside `?thread=` below. The stance
     governs the next answer and changes nothing on screen, which is the rule
     this file keeps — the closest existing thing is chat's profile checkbox,
     which is component state for the same reason. */
  "review",
  /* The eighth, 2026-08-28: the whole document as one nested list that never
     scrolls and expands around where the reader is. It costs this list one
     word like the six before it, and it is the first mode that is a second
     answer to a question an existing surface already answers — the gist
     columns' context panels — rather than a new question. That is deliberate
     and temporary: Greg asked for it as an eighth mode "for now, so that it
     doesn't mess with what we have, and so that I can go back and forth to
     compare". docs/plans/outline-mode.md § Where it sits, and what happens if
     it wins. */
  "outline",
] as const;
export type Mode = (typeof MODES)[number];

/**
 * The mode a reader lands in, named once.
 *
 * Two places need it — `modeParam`'s fallback below, and `withMode` in
 * src/web/Dock.tsx, which omits the parameter when it is writing this value. A
 * literal in both would be two copies of one decision, and the copy that drifts
 * is the one that puts a redundant `?mode=` back into every URL.
 */
export const DEFAULT_MODE: Mode = "hierarchy";

/**
 * **Is this string one of the modes?** — the guard the server needs and the
 * client already had inside `modeParam`.
 *
 * An unrecognised value is not an error anywhere: `modeParam` parses it to the
 * default so that a link from a future version, or a pre-2026-08-29 `?mode=toc`
 * link, degrades to the article rather than to an error page. The server does
 * the same with this, which is the point of it being one function — a second
 * spelling of "is this a mode" on the server would be a second answer, and the
 * looser one would be the one nobody read.
 */
export function isMode(value: string | null | undefined): value is Mode {
  return value !== null && value !== undefined && (MODES as readonly string[]).includes(value);
}
=== NEW FILE: src/read-address.ts ===
/**
 * **What a `/read/…` address asks for, decided once for both sides.**
 *
 * Two things read these addresses now. `src/web/main.tsx` rewrites the legacy
 * spellings before React mounts, and the serverless function that composes a
 * shared article's `<head>` has to know what the client is about to do — because
 * whatever the two disagree about is a tab that changes in front of the reader,
 * a second after the page lands. docs/project/page-titles.md has the four ways
 * that had already happened.
 *
 * Imports the mode vocabulary and nothing else, so the public function's closed
 * import graph
 * (tests/public-imports.test.ts) and the client's allowlist
 * (tests/client-imports.test.ts) both accept it.
 */

import { DEFAULT_MODE, isMode, type Mode } from "./modes.js";

/**
 * **Which middle-band mode a `/read/` address asked for**, or the default.
 *
 * The rewrite in vercel.json preserves the original query alongside the
 * `__spy_read` capture, so `?mode=glossary` survives to here — and it has to be
 * read, because the client puts the mode in the tab. Without this the server
 * served `Article · Spideryarn` and React replaced it with
 * `Article · Glossary · Spideryarn` a second later, which is the fault
 * src/title-text.ts exists to close. GPT Sol, 2026-08-30.
 *
 * **Unknown values land on the default rather than failing**, which is the rule
 * `modeParam` in src/web/params.ts already keeps: a link from a future version
 * with a mode this one has not got, or a pre-2026-08-29 `?mode=toc` link,
 * degrades to the article. `isMode` is the one place that decides, so the two
 * cannot answer differently.
 *
 * Deliberately tolerant of a malformed URL. This runs on a string a stranger
 * controls, and a throw here would be a 500 on an address that only wanted a
 * tab title.
 */
export function readMode(url: string): Mode {
  const query = url.indexOf("?");
  if (query === -1) return DEFAULT_MODE;
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(url.slice(query + 1)).get("mode");
  } catch {
    return DEFAULT_MODE;
  }
  return isMode(asked) ? asked : DEFAULT_MODE;
}

/**
 * The three things a `/read/<slug>` address can be showing.
 *
 * Defined here rather than in src/web/router.ts, which owns the routes but
 * imports React's world. `router.ts` re-exports this name, so nothing that used
 * it knows it moved.
 */
export const ARTICLE_VIEWS = ["article", "metadata", "tweets"] as const;
export type ArticleView = (typeof ARTICLE_VIEWS)[number];

/**
 * **The pairs of a query, with only the first `?` treated as one.**
 *
 * `?add=https://x.test/a?about=1` carries one parameter whose *value* contains a
 * question mark. The old predicate matched on `(^|[?&])`, so it read that inner
 * `?` as a parameter boundary and sent the reader to the metadata page for an
 * article they were trying to add. GPT Sol found it, 2026-08-30 — the tenth of
 * these, and the first that **both sides got wrong in the same way**, which is
 * why the cross-product in tests/address-settling.test.ts could not see it:
 * equality between two halves says nothing when they agree on the wrong answer.
 *
 * Takes either a bare query or a whole URL, which is the contract the two
 * callers need — the client hands over `location.search`, the server the
 * restored URL. A string with no `?` at all is treated as the query itself, so
 * `about=1` works as well as `?about=1`.
 */
export function queryPairs(searchOrUrl: string): string[] {
  const at = searchOrUrl.indexOf("?");
  const query = at === -1 ? searchOrUrl : searchOrUrl.slice(at + 1);
  return query === "" ? [] : query.split("&");
}

/**
 * One half of a `key=value` pair, decoded, or the raw text if it will not
 * decode. A malformed escape is not a match for any plain name, and it must
 * never throw: this runs on a string a stranger controls.
 */
function part(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A pair split into its decoded key and value. `k` with no `=` has no value. */
function keyValue(pair: string): { key: string; value: string | null } {
  const eq = pair.indexOf("=");
  if (eq === -1) return { key: part(pair), value: null };
  return { key: part(pair.slice(0, eq)), value: part(pair.slice(eq + 1)) };
}

/**
 * **Does this pair ask for the metadata page?**
 *
 * Decoded on both halves, so `%61bout=1`, `about=%31` and `panel=%61bout` are
 * the same request as their literal spellings. That is GPT Sol's rule, and the
 * reason for it is that a decoding *decision* with a literal *removal* is how
 * the ninth bug worked: the client stripped one spelling, kept the other, and
 * acted on a parameter the server had never seen. Here one function answers for
 * both, so they cannot come apart — `liftLegacyAbout` in src/web/router.ts
 * calls this to decide **and** to remove.
 *
 * **`about=1` and `panel=about` only, never `about=0`.** A shut panel is not a
 * reason to send anybody to a different page.
 */
export function isMetadataPair(pair: string): boolean {
  const { key, value } = keyValue(pair);
  return (key === "about" && value === "1") || (key === "panel" && value === "about");
}

/**
 * **Which pairs the metadata rewrite consumes**, which is a wider set than the
 * ones that redirect: `about=0` is stripped from the URL and stays on the
 * article. `panel` is only consumed when it says `about`; any other panel is
 * somebody else's parameter.
 */
export function isLegacyAboutPair(pair: string): boolean {
  const { key } = keyValue(pair);
  return key === "about" || isMetadataPair(pair);
}

/**
 * **Will the client turn this address into the metadata page before it draws
 * anything?**
 *
 * The article's details have been in three places: `?about=1` in the masthead,
 * then `?panel=about` as a drawer, and now `/read/<slug>/metadata`. `main.tsx`
 * rewrites either old spelling on the way in, with `history.replaceState`, so
 * the reader never sees them.
 *
 * The server has to ask the same question, and the reason is exact. `/read/x`
 * with a query is **one path segment**, so it matches vercel.json's
 * `/read/:slug` rewrite and reaches the head composer — while `/read/x/metadata`
 * is two segments and falls to the SPA catch-all, never composed. So
 * `/read/x?about=1` was served with the *article's* title and then rewritten by
 * React to `Article · Metadata · Spideryarn`. With `?mode=glossary` on it as
 * well, the tab went from `Article · Glossary · Spideryarn` to
 * `Article · Metadata · Spideryarn`. GPT Sol found it, 2026-08-30, after I had
 * checked `/read/x/metadata` and concluded the view axis was safe: the direct
 * route is safe and this legacy route into the same view is not.
 *
 * @param search the query with or without its `?`, or a whole URL containing one.
 */
export function redirectsToMetadata(search: string): boolean {
  return queryPairs(search).some(isMetadataPair);
}

export function viewFor(search: string): ArticleView {
  return redirectsToMetadata(search) ? "metadata" : "article";
}
=== NEW FILE: src/title-text.ts ===
/**
 * **The article title in a tab, composed once for both the sides that write
 * it.**
 *
 * Two things put a title into `<title>`, half a second apart. The server
 * composes a head for `/read/<slug>` before the bundle has loaded, so that a
 * pasted link previews as something (src/public/page-head.ts); React then
 * mounts and assigns `document.title` from `pageTitle()`
 * (src/web/page-title.ts). Whatever these two disagree about is a **visible
 * change in the tab at mount** — the reader watches the title they were given
 * turn into a different one.
 *
 * They did disagree, and nobody had decided that they should. The server ran
 * the title through `headText` (src/html.ts): internal runs of whitespace
 * collapsed, control characters became a space, bidi overrides were dropped.
 * The client only trimmed the ends and cut to length. So an article titled
 * `Two  spaces` was served as `Two spaces` and then rewritten to `Two  spaces`
 * in front of the reader. GPT Sol's review of stage 2 slice 1 found it; it was
 * pinned as a known divergence and put to Greg, who left the choice here
 * (2026-08-30).
 *
 * **The choice: the server's normalisation wins, and the client's clamp wins.**
 * Each side keeps the rule it had the better reason for.
 *
 *  - *Normalising* is not a preference. An RLO in a title reverses display
 *    order (`A‮gnp.exe` shows as `A exe.png`) and a newline in a `<title>`
 *    renders differently in every consumer of it. The server had to do it
 *    because its output is published into caches we cannot clear, and there is
 *    no argument for the tab being the one place a bidi override survives.
 *  - *Clamping with a word-boundary ellipsis* is what a reader wants in a tab,
 *    a bookmark and a history entry: `…` says "there was more". The server had
 *    the hard cut because `headText` serves `og:title` as well, and an ellipsis
 *    in metadata is a claim that the title contained one.
 *
 * So this file composes with `normaliseText` and with `clamp`, and both callers
 * import the result rather than restating it. The `og:` and `twitter:` tags
 * keep the hard `headText` clamp at their own limits — that difference is
 * between *a tab* and *a card*, which are different sinks read by different
 * things, and not between two copies of one rule.
 *
 * ## Why it is here rather than in src/web/
 *
 * src/web/page-title.ts imports React, and a module reached by
 * src/public/routes.ts may not import anything under src/web/ — the public
 * import graph is asserted closed (tests/public-imports.test.ts). The standing
 * answer in this repo for a thing two sides need is to move it into a module
 * that imports almost nothing, which is what this is: src/html.js for the
 * normaliser, and src/modes.js and src/read-address.js for the two vocabularies
 * a title is built from. All three are themselves leaves.
 * tests/client-imports.test.ts lists every one of them and **checks** that they
 * are pure rather than trusting the claim — which matters, because this
 * paragraph said "src/html.js and no more" for half a day after `modes.js`
 * arrived. GPT Sol, 2026-08-30.
 *
 * See docs/project/page-titles.md for the rules behind the composition, and
 * docs/plans/public-read-only-access.md § Stage 2 for the server half.
 */
import { normaliseText } from "./html.js";
import { DEFAULT_MODE, type Mode } from "./modes.js";
import type { ArticleView } from "./read-address.js";

/** The product. `spideryarn2` is the working directory; this is the name. */
export const APP_NAME = "Spideryarn";

/**
 * The strapline. It appears on the two homepages and nowhere else — the shelf
 * with nothing chosen on it, and the landing page a signed-out reader gets
 * instead. See `segments` in src/web/page-title.ts for why it is on no other.
 */
export const TAGLINE = "AI-assisted reading";

/**
 * Between segments.
 *
 * A middot rather than an em dash or a pipe: it is already this app's
 * separator (the fact lines on the library card and the metadata page use it),
 * it is the narrowest of the three so it spends the fewest of a tab's very few
 * pixels, and unlike `-` it can never be confused with a hyphen inside a title
 * that has one. No evidence anywhere says one separator is more legible than
 * another; consistency with the rest of the app is the whole argument.
 */
export const SEP = " · ";

/**
 * How much of a leading title we keep.
 *
 * Nothing forces this. No browser has a character limit, and every place that
 * truncates does it by **pixels** rather than characters — Firefox caps a tab
 * at 225px, Chrome shrinks tabs until only the favicon is left, Google cuts a
 * search result at about 600px. The familiar "50-60 characters" is SEO folklore
 * converged on by blogs, not a vendor number, and it is the wrong *unit*
 * besides. So a clamp cannot make a title fit a tab, and this one does not try.
 *
 * It is for the places that do *not* truncate: the history list, a bookmark,
 * the window switcher, and the text somebody gets when they paste a link into a
 * chat. A 180-character academic paper title there pushes everything after it
 * off the end of the useful world.
 *
 * 64 is therefore a judgment call rather than a measurement, and it is
 * deliberately generous — comfortably more than any tab shows, so clamping
 * never costs a reader something the tab would have shown them.
 */
export const CLAMP = 64;

/**
 * Cut at a word boundary, with an ellipsis, or return the text unchanged.
 *
 * Word boundary rather than mid-word because the cut is doing the reader a
 * favour and a truncation that lands inside a word looks like corruption. If
 * there is no space to cut at in the last third of the budget — one very long
 * word, or a language that does not space its words — it cuts where it must,
 * which is still better than not clamping.
 *
 * **Counted in code points, not in UTF-16 units**, which is why the text is
 * split into an array first rather than sliced. `"…".slice(0, 64)` will happily
 * cut an emoji in half and leave a lone surrogate, which renders as `�` — a
 * clamp whose whole job is to look deliberate, producing the one character that
 * looks like corruption. GPT Sol found it, 2026-08-27.
 *
 * Code points, not graphemes: a combining accent or a flag can still be split,
 * and doing better needs `Intl.Segmenter`. Not worth a segmenter for a title
 * that is already being cut with an ellipsis on it — but that is the next step
 * if this ever matters.
 *
 * **The result can be one code point longer than `max`**, because the ellipsis
 * is appended rather than counted. That is deliberate and it is why the two
 * clamps are not interchangeable: `headText(t, 64)` is a promise about a
 * length, and this is a promise about legibility.
 */
export function clamp(text: string, max = CLAMP): string {
  const points = [...text];
  if (points.length <= max) return text;
  const cut = points.slice(0, max).join("");
  const space = cut.lastIndexOf(" ");
  // Only honour a space in the last third; otherwise a title whose first word
  // is long would be clamped down to that one word.
  const at = space > cut.length * 0.66 ? cut.slice(0, space) : cut;
  return `${at.trimEnd()}…`;
}

/**
 * **An article's own title, as the leading segment of a page title.**
 *
 * Normalise, then clamp — in that order, and the order is not cosmetic. A
 * clamp before normalising would count invisible bidi characters and collapsing
 * whitespace against the budget, so two titles that display identically would
 * be cut in different places.
 *
 * `||` and not `??`: a title of `"   "` normalises to `""`, which is as
 * titleless as `null`, and `Untitled · Spideryarn` is a better tab than a
 * stranded separator. src/public/page-head.ts says `Untitled` in `og:title`
 * for the same reason.
 */
export function articleTitle(title: string | null): string {
  return clamp(normaliseText(title ?? "")) || "Untitled";
}

/**
 * **The whole of what `<title>` says for one article** — its own title, then
 * the app's name.
 *
 * This exact string is what src/public/page-head.ts writes into the served
 * document and what src/web/page-title.ts assigns to `document.title` a moment
 * later, so the tab does not change at mount. tests/page-head.test.ts asserts
 * the two are character for character equal over a corpus built to break them;
 * that test is only worth anything because both sides call *this* function
 * rather than each restating it. A helper the tests use and the code does not
 * is a helper that can be right while the code is wrong.
 *
 * **The mode is part of it**, and the default one is left out — the rule
 * `readTitle` in src/web/page-title.ts has always followed, now applied on both
 * sides. A reader with the same article open in three modes gets three tabs they
 * can tell apart, and `Hierarchy` in nearly every tab would distinguish nearly
 * nothing while costing eleven characters of a string that is already being cut.
 * An unrecognised `?mode=` is not this function's problem: the caller resolves
 * it to the default first, with `isMode` in src/modes.ts, exactly as `modeParam`
 * does on the client.
 *
 * Not the card title: `og:title` drops the ` · Spideryarn` suffix and the mode
 * with it. A card already carries `og:site_name`, so repeating the app name
 * spends the visible half of the card saying one word twice — and a shared link
 * is about the article, not about which panel the person who shared it happened
 * to have open.
 */
export function documentTitle(
  title: string | null,
  mode: Mode = DEFAULT_MODE,
  view: ArticleView = "article",
): string {
  /* **The view wins over the mode, and that is `readTitle`'s rule rather than a
     new one**: the metadata and tweets pages are pages beside the article, and
     the mode is a band inside the reading view that neither of them has. A
     `/read/x?about=1&mode=glossary` becomes `x · Metadata · Spideryarn` on both
     sides, with the mode dropped. */
  const label =
    view !== "article"
      ? `${VIEW_LABEL[view]}${SEP}`
      : mode === DEFAULT_MODE
        ? ""
        : `${MODE_LABEL[mode]}${SEP}`;
  return `${articleTitle(title)}${SEP}${label}${APP_NAME}`;
}

/**
 * The two of an article's three views that are pages beside the article rather
 * than the article itself. Named as the Dock names them, so the tab and the
 * button you pressed to get there agree.
 *
 * Beside `MODE_LABEL` and for the same reason: the server composes this title
 * too. `/read/x?about=1` is one path segment, so it reaches the composer, and
 * `main.tsx` then rewrites it to the metadata page — see
 * `redirectsToMetadata` in src/read-address.ts.
 */
export const VIEW_LABEL: Record<Exclude<ArticleView, "article">, string> = {
  metadata: "Metadata",
  tweets: "Tweets",
};

/**
 * **Which of the nine middle-band modes, by the name the Dock uses**, so that
 * the tab and the button the reader pressed to get there say the same word.
 *
 * Here rather than in src/web/page-title.ts because the server composes this
 * title too — `/read/<slug>?mode=glossary` is served with `· Glossary` already
 * in it, and without that the tab said one thing and React said another a second
 * later, which is the fault this whole file exists to close. GPT Sol found that
 * one on review, 2026-08-30: the fuzz could not see it because every generated
 * case left `mode` absent, and the missing dimension was title *state* rather
 * than title *characters*.
 */
export const MODE_LABEL: Record<Mode, string> = {
  hierarchy: "Hierarchy",
  outline: "Outline",
  summary: "Summary",
  glossary: "Glossary",
  ideas: "Ideas",
  search: "Search",
  diagram: "Diagram",
  chat: "Chat",
  review: "Review",
};
=== NEW FILE: tests/address-settling.test.ts ===
/**
 * **The one test that would have found all eight, instead of a reviewer finding
 * four of them.**
 *
 * A shared `/read/<slug>` is served by a function that composes the `<title>`
 * from the address (src/public/page-head.ts); the client then settles the
 * address (`settleAddress` in src/web/router.ts) and React sets
 * `document.title`. **Anything the two disagree about is a tab that changes in
 * front of the reader**, a second after the page lands.
 *
 * Eight of those shipped. They were fixed one at a time — whitespace, the
 * fallback chain, `Loading…`, `not-shared`, the mode, the legacy metadata
 * spellings, `?slug=`, `?add=`, and finally the interaction between the hash
 * rewrite and the metadata one. Each fix got a test naming its own case, and
 * that is exactly the shape of testing that let the next one through: **a list
 * of the cases somebody thought of is not a statement about the class.**
 *
 * So this file states the class. It crosses every path shape against every
 * query parameter this app has ever recognised against every hash shape.
 *
 * The eighth is the reason this exists rather than another per-case test. It was
 * an *interaction*: the hash rewrite reserialised the query through
 * `URLSearchParams`, turning `?%61bout=1` into `?about=1`, which made the
 * metadata rewrite two steps later fire on a parameter the server had never
 * seen. No test of either rewrite alone could see it. GPT Sol found it by
 * reading, at the fourth time of asking; a cross-product finds it by arithmetic.
 *
 * ## Two assertions, and the second one took three more rounds
 *
 * The first version asserted only
 *
 *     what the server puts in <title>  ===  what the client ends up setting
 *
 * which is blind, by construction, to both halves being wrong in the same way —
 * and the **tenth** was exactly that: `redirectsToMetadata` read a `?` inside
 * another parameter's value as a parameter boundary, so
 * `?add=https://x.test/a?about=1` went to the metadata page with server and
 * client in cheerful agreement. GPT Sol, 2026-08-30.
 *
 * So every row of the corpus now carries the view it **should** settle on, and
 * that is checked first. An equality test is only as good as its anchor.
 *
 * @see docs/project/page-titles.md § the eight — and the two address bugs
 *      beside them, which is why the count in this file is ten.
 */
import { describe, expect, it } from "vitest";

import type { ServerResponse } from "node:http";

import { DEFAULT_MODE, MODES, type Mode } from "../src/modes.js";
import { servePublicReadPage } from "../src/public/page.js";
import { viewFor, type ArticleView } from "../src/read-address.js";
import type { PublicHead } from "../src/store/public-reader.js";
import { readSlug } from "../src/vercel.js";
import { pageTitle } from "../src/web/page-title.js";
import { parseRoute, settleAddress } from "../src/web/router.js";

const SLUG = "a-shared-piece";
const TITLE = "A shared piece";
const HEAD: PublicHead = { slug: SLUG, title: TITLE, gist: null, canonical: null };

/* A shell with the sentinels, so `composeShell` is exercised rather than a
   stand-in for it — the title asserted below is the one that reaches the
   document. */
const SHELL = [
  "<!doctype html><html><head>",
  "<!-- spideryarn:managed-head:start -->",
  "<title>Spideryarn</title>",
  "<!-- spideryarn:managed-head:end -->",
  "</head><body><div id=root></div></body></html>",
].join("\n");

/**
 * **What the server actually serves for this address** — through
 * `servePublicReadPage`, not through a reassembly of the functions it calls.
 *
 * An earlier version of this helper called `readMode`, `viewFor` and
 * `composeShell` itself. That is a **model of the server**, and a model stays
 * green while production drifts: deleting the `mode` argument at the call site
 * in `src/vercel.ts` would have put the title change straight back with this
 * file none the wiser. GPT Sol, 2026-08-30 — and it is the same fault as
 * everything else in this file, one level up.
 *
 * So the page module now takes the whole address and reads the mode and the view
 * itself, and this drives it. What is left un-covered is one required `url:`
 * argument in `vercel.ts`, which cannot be dropped without the compiler saying
 * so.
 *
 * `null` when the address gets no enhanced head — either not a `/read/<slug>`
 * at all, or the reader is not entitled to one.
 */
async function serverTitle(pathname: string, search: string): Promise<string | null> {
  if (readSlug(pathname) !== SLUG) return null;
  let body = "";
  const res = {
    statusCode: 200,
    setHeader: () => {},
    end: (chunk?: string) => {
      body += chunk ?? "";
    },
  } as unknown as ServerResponse;

  await servePublicReadPage({
    /* The request as `src/vercel.ts` hands it over: `url` is the *restored*
       address, and it is the only place the address comes from. */
    req: { method: "GET", url: `${pathname}${search}` },
    res,
    slug: SLUG,
    shell: { html: SHELL, sha256: "a".repeat(64) },
    read: async () => HEAD,
  });

  const title = /<title>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? null;
  /* The bare shell title means no head was composed for this address. */
  return title === "Spideryarn" ? null : title;
}

/**
 * **What the client will put in the tab for this address**, once it has stopped
 * moving.
 *
 * `settleAddress` is the *real* pre-mount rewrite sequence — the same function
 * `main.tsx` calls — so this is the client's actual destination rather than a
 * model of it. That is the whole reason the sequence was made a pure function.
 *
 * Returns `null` when the reader ends up somewhere that is not this article's
 * reading view, which the server must then not have titled as the article.
 */
function clientSettles(
  pathname: string,
  search: string,
  hash: string,
): { view: ArticleView; title: string } | null {
  const settled = settleAddress(pathname, search, hash) ?? `${pathname}${search}${hash}`;
  const [beforeHash = ""] = settled.split("#");
  const [path = "", query = ""] = beforeHash.split("?");
  const route = parseRoute(path);
  if (route.kind !== "read" || route.slug !== SLUG) return null;
  const mode = new URLSearchParams(query).get("mode");
  const chosen = (MODES as readonly string[]).includes(mode ?? "")
    ? (mode as Mode)
    : DEFAULT_MODE;
  /* Split by view because `TitleSpec` is: the reading view must carry a mode and
     the other two must not. That is not this test being fussy — it is the type
     that makes App.tsx dropping `mode` a compile error rather than something a
     cross-product has to notice. */
  const title =
    route.view === "article"
      ? pageTitle({ kind: "read", title: TITLE, view: "article", mode: chosen })
      : pageTitle({ kind: "read", title: TITLE, view: route.view });
  return { view: route.view, title };
}

/**
 * **Every query this app recognises, and the page each one should settle on.**
 *
 * The second field is the part that took three review rounds to arrive at.
 * Comparing the server's title with the client's catches every case where the
 * two *disagree* — and says nothing whatever about a case where they agree on
 * the wrong page. GPT Sol found exactly that on 2026-08-30: `redirectsToMetadata`
 * read a `?` inside another parameter's value as a parameter boundary, so
 * `?add=https://x.test/a?about=1` sent the reader to the metadata page, both
 * halves cheerfully concurring. An equality test is only as good as its anchor,
 * and until now this corpus had none.
 *
 * So every row states its own answer, and both halves are checked against it.
 * `%61bout` and `about=%31` are the eighth divergence in its own words — the
 * hash rewrite decoded them on the way past, so the client acted on a parameter
 * the server had not seen — and they redirect, because a percent-encoded
 * unreserved character is the same parameter.
 */
const QUERIES: { search: string; view: ArticleView }[] = [
  { search: "", view: "article" },
  { search: "?mode=glossary", view: "article" },
  { search: "?mode=hierarchy", view: "article" },
  { search: "?mode=toc", view: "article" },
  { search: "?mode=nonsense", view: "article" },
  { search: "?at=spya-k3m9qt", view: "article" },
  { search: "?cols=0,1", view: "article" },
  { search: "?about=1", view: "metadata" },
  { search: "?about=0", view: "article" },
  { search: "?about=2", view: "article" },
  { search: "?panel=about", view: "metadata" },
  { search: "?panel=notes", view: "article" },
  { search: "?%61bout=1", view: "metadata" },
  { search: "?about=%31", view: "metadata" },
  { search: "?panel=%61bout", view: "metadata" },
  { search: "?slug=another-piece", view: "article" },
  { search: "?add=https://example.com/x", view: "article" },
  { search: "?about=1&mode=glossary", view: "metadata" },
  { search: "?mode=glossary&about=1", view: "metadata" },
  { search: "?at=spya-k3m9qt&cols=0,1&mode=summary", view: "article" },
  { search: "?about=1&at=spya-k3m9qt", view: "metadata" },
  /* **A `?` inside a value is not a parameter boundary.** GPT Sol's tenth,
     2026-08-30. Only the first `?` begins the query; after that only `&`
     separates pairs, and every one of these three used to redirect. */
  { search: "?add=https://x.test/a?about=1", view: "article" },
  { search: "?next=https://x.test/?about=1", view: "article" },
  { search: "?x=?panel=about", view: "article" },
  /* Encoded keys, duplicates and order — the classes GPT Sol named as missing,
     2026-08-30. `%61t` is `at` and `%73lug` is `slug` as far as
     `URLSearchParams` is concerned, and a textual filter that does not decode
     the key leaves the old pair sitting in front of the new one. */
  { search: "?%61t=spya-k6fpme", view: "article" },
  { search: "?%73lug=another-piece", view: "article" },
  { search: "?at=spya-k6fpme&at=spya-hqrrtt", view: "article" },
  { search: "?mode=glossary&mode=chat", view: "article" },
  { search: "?mode=chat&mode=glossary", view: "article" },
  { search: "?at=spya-k6fpme&%61t=spya-hqrrtt", view: "article" },
  { search: "?%6dode=glossary", view: "article" },
];

/** Fragments, including the legacy anchor that becomes `?at=` on the way in. */
const HASHES = ["", "#spya-k3m9qt", "#not-an-id", "#%zz"];

describe("the server's title and the client's, over every address either can see", () => {
  it("agree for every combination of query and hash on a shared article", async () => {
    const disagreed: string[] = [];
    let compared = 0;

    for (const { search, view } of QUERIES) {
      for (const hash of HASHES) {
        const server = await serverTitle(`/read/${SLUG}`, search);
        const client = clientSettles(`/read/${SLUG}`, search, hash);

        /* **The client leaving this article is a failure, full stop.**
           An earlier version of this line permitted the server's ordinary
           article title here — which meant restoring the unrestricted `?slug=`
           or `?add=` rewrites produced `client === null`, an ordinary server
           title, and no failure at all. Two of the faults this file claims
           to cover slipped straight through it. GPT Sol checked the predicate
           and reported `caught: false` for both, 2026-08-30.

           Every address in this loop is a `/read/<slug>` that the server gives
           an enhanced head to. If the client walks away from it, the server has
           titled a page the reader will not be looking at, and that is exactly
           the class. (Root legacy entrances are a different case and are not in
           this corpus: there the server composes nothing at all — asserted
           separately below.) */
        if (client === null) {
          disagreed.push(
            `${search}${hash}: the client left this article, but the server titled it ${JSON.stringify(server)}`,
          );
          continue;
        }
        compared++;
        /* **The anchor, checked before the agreement.** Both halves reading the
           same wrong parameter is a bug they agree about, and equality is blind
           to it by construction — the tenth divergence was exactly that. This is
           the row saying what the right answer is, independently of either. */
        if (client.view !== view) {
          disagreed.push(
            `${search}${hash}: settles on the ${client.view} view, and it should be the ${view} view`,
          );
          continue;
        }
        if (server !== client.title) {
          disagreed.push(
            `${search}${hash}\n    server ${JSON.stringify(server)}\n    client ${JSON.stringify(client.title)}`,
          );
        }
      }
    }

    expect(disagreed).toEqual([]);
    /* The control. A cross-product that compared nothing would also report no
       disagreement, and "0 failures out of 0" is the shape of every corpus that
       cannot exercise its arm. */
    expect(compared, "the corpus must actually reach the reading view").toBeGreaterThan(40);
  });

  /**
   * **And the other half of the class: the server composes a head for exactly
   * one shape of address.**
   *
   * The case above varies query and hash over `/read/<slug>`. This varies the
   * path, and asserts the property that makes the case above sufficient — every
   * other path gets no composed title at all, so there is nothing for the client
   * to disagree with. It is what makes `/read/x/metadata` safe, and it is the
   * assertion I should have written instead of reasoning that it was safe: three
   * of the ten were on this axis, and I twice wrote down that it was covered.
   */
  it("composes a head for /read/<slug> and for no other path", async () => {
    for (const pathname of [
      "/",
      "/library",
      "/add/https://example.com/x",
      "/add/upload/spya-k3m9qt",
      `/read/${SLUG}/metadata`,
      `/read/${SLUG}/tweets`,
      "/read/",
      "/profile",
      "/design",
      "/admin",
      "/admin/users",
      "/login",
      "/auth/callback",
      `/read/${SLUG}/nonsense`,
    ]) {
      for (const search of ["", "?mode=glossary", "?about=1", "?slug=other"]) {
        expect(await serverTitle(pathname, search), `${pathname}${search}`).toBeNull();
      }
    }
    /* The control: the one path that *does* compose, or the loop above would
       pass against a server that had stopped composing anything at all. */
    expect(await serverTitle(`/read/${SLUG}`, "")).toBe(`${TITLE} · Spideryarn`);
  });

  /**
   * **The eighth on its own: a rewrite must not change which page you land on.**
   *
   * `%61bout` is `about`. `settleAddress` used to run the query through
   * `URLSearchParams` while lifting the hash into `?at=`, which normalised the
   * escape — so the metadata rewrite two steps later fired on a parameter the
   * server had never seen, and the tab changed. Neither rewrite is wrong alone;
   * it is the sequence, which is why the sequence became one function.
   *
   * **The invariant outlived the rule, and that is the point of writing it this
   * way.** This case first asserted that `%61bout=1` stays on the article, which
   * was true while the predicate matched raw text. On GPT Sol's round-6
   * recommendation the rule changed — percent-encoded unreserved characters are
   * the same parameter, so `%61bout=1`, `about=%31` and `panel=%61bout` all
   * redirect now, and both the decision and the removal decode. Had this case
   * been written as *"stays on the article"* it would now be pinning a decision
   * nobody holds. Written as *"the fragment changes nothing about which page"*
   * it survives the rule change and still reddens on the bug.
   */
  it("does not let the hash rewrite change which page an address settles on", () => {
    for (const search of ["?%61bout=1", "?about=%31", "?panel=%61bout", "?about=1", "?about=0"]) {
      const alone = settleAddress(`/read/${SLUG}`, search, "");
      const withHash = settleAddress(`/read/${SLUG}`, search, "#spya-k3m9qt");
      const page = (href: string | null) =>
        (href ?? `/read/${SLUG}${search}`).split("?")[0];
      expect(page(withHash), `${search} must land on the same page with a fragment on it`).toBe(
        page(alone),
      );
    }

    /* And the two controls, so the loop above is not agreeing that nothing
       redirects. One spelling of each answer, checked absolutely. */
    expect(viewFor("?%61bout=1"), "an encoded key is the same parameter").toBe("metadata");
    expect(viewFor("?about=0"), "a shut panel stays on the article").toBe("article");
  });

  /**
   * **The fragment must beat an `?at=` however that parameter is spelled.**
   *
   * `?%61t=…` is `?at=…` to `URLSearchParams`, which decodes keys. Removing only
   * the literal spelling left both pairs in the query, and `get("at")` returns
   * the first — so the reader landed at the position they had *left* rather than
   * the one the link asked for. GPT Sol found it, 2026-08-30: the ninth address
   * bug, and not a title divergence, which is why the cross-product above cannot
   * see it and this case exists.
   */
  it("lets the fragment beat an ?at= whatever its key is encoded as", () => {
    const HERE = "spya-k3m9qt";
    for (const search of [
      "?at=spya-k6fpme",
      "?%61t=spya-k6fpme",
      "?a%74=spya-k6fpme",
      "?at=spya-k6fpme&%61t=spya-hqrrtt",
    ]) {
      const settled = settleAddress(`/read/${SLUG}`, search, `#${HERE}`) ?? "";
      const at = new URLSearchParams(settled.split("?")[1] ?? "").getAll("at");
      expect(at, search).toEqual([HERE]);
    }
  });

  it("and still keeps every unrelated pair byte for byte while doing it", () => {
    /* The removal decodes the *key* to decide, and then drops or keeps the pair
       whole — so nothing that stays is re-encoded. `?cols=0,1` is the case that
       matters (params.ts spells those commas out on purpose). */
    const settled = settleAddress(`/read/${SLUG}`, "?cols=0,1&%61t=spya-k6fpme&mode=summary", "#spya-k3m9qt") ?? "";
    expect(settled).toContain("cols=0,1");
    expect(settled).toContain("mode=summary");
    expect(settled).not.toContain("spya-k6fpme");
    expect(settled).toContain("at=spya-k3m9qt");
  });

  /**
   * The other rule the eighth taught: the query is edited as **text**, never
   * round-tripped through `URLSearchParams`. This file's `?cols=0,1` case exists
   * because the hash rewrite was re-encoding those commas into `%2C` — still
   * correct, still parsed the same, and no longer readable, which is the thing
   * `params.ts` spells them out to avoid.
   */
  it("carries every other parameter through untouched, exactly as written", () => {
    const settled = settleAddress(`/read/${SLUG}`, "?cols=0,1&mode=summary", "#spya-k3m9qt");
    expect(settled).toContain("cols=0,1");
    expect(settled).not.toContain("cols=0%2C1");
    expect(settled).toContain("mode=summary");
    expect(settled).toContain("at=spya-k3m9qt");
  });
});
```
