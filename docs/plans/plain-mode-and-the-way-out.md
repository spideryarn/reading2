# Plain mode, the way out of a mode, and the way to the original

**Status: built, reviewed at the plan stage, and browser-checked.** Four related changes to the
reading view's chrome, all from one session with Greg on 2026-08-31, plus one server-side fix they
turned up. GPT Sol reviewed the plan before any of it was written —
[the review](plain-mode-and-the-way-out-review-sol.md), and § What the review changed below — and
the code went back to it afterwards.

## What Greg asked for

> We have a lot of "Back to contents" links - they should say, "Back to Hierarchy", no? Or maybe we
> don't even need those links, since the user can just press on the bottom-bar.
>
> That said, on mobile I did find that I sometimes struggled to get back to the main text (e.g.
> within the Search mode when the keyboard was open). It was possible, just fiddly. So I wonder if
> we should have some kind of icon in the top-left or bottom-left for "Back to text"?
>
> Or maybe better still, a (default?) mode that's empty, i.e. where the middle columns are closed.
> Call it Blank or Clean or Empty or Plain? Then that can be the first (and largest?) icon in the
> bottom-bar, to make it easy for the user to use that to get out of a mode to the text.
>
> One more semi-related request. It should be easier to get to the original article somehow. Maybe
> an icon in the top bar that takes you to the original source url (maybe it becomes a download link
> if it was uploaded), with nice tooltips.
>
> — Greg, 2026-08-31

His four decisions, taken the same day:

- The mode is called **Plain**.
- **Plain becomes the default** a reader lands in.
- The controls bar's exit becomes an **× close icon** rather than a renamed text link.
- The uploaded-file case is not deferred: **fix `sendSource`** so the download works in production.
  — *"I thought we stored in Supabase Storage?"* He is right; see § 5.

## Say the awkward thing first: the bottom bar is the wrong place for an escape hatch

Greg's own diagnosis is that the dock should carry the way out. Measured, it cannot carry it in the
case he is complaining about, and the measurement is the reason this plan does more than add a
button.

A browser pass at a real 390 × 740 viewport, 2026-08-31:

| element | at rest | after scrolling down |
|---|---|---|
| `.controls` (holds "back to contents") | `y: 0–44` | `y: −44` — **off-screen** |
| `.mode-band` | `y: 44–700` | fills the screen |
| `.dock` (holds the mode buttons) | `y: 700–740` | `y: 740` — **off-screen** |

Two separate things take the dock away, and both are in play when Greg hit this:

1. **`data-bars="hidden"`.** On a small device, scrolling down slides *both* bars off screen
   (`styles.css` § a small device, `watchBarVisibility` in `scroll.ts`). Confirmed with a real
   trusted wheel event: after one scroll, `.controls` measured `transform: translateY(-44px)` and
   `.dock` measured `translateY(40px)`. Neither the "back to contents" link nor the dock's mode
   buttons is reachable at all in that state.
2. **The on-screen keyboard.** `index.html` deliberately does *not* set
   `interactive-widget=resizes-content` (`styles.css` § `.cmt-dialog` records why), so a keyboard
   shrinks the visual viewport and leaves every `position: fixed` element pinned to the layout
   viewport. The dock at `y: 700` is inside the bottom ~300px a keyboard covers; the controls bar at
   `y: 0` is not.

So the honest ordering is: **fixing the bar-hiding is the fix for Greg's actual complaint**, and
Plain mode is a good idea on its own terms that would not have rescued him.

## 1. The bars stay while a mode band is open

One rule, and it pays for itself twice.

While a band is open on a phone the band *is* the screen — the article behind it is covered
(`styles.css` § a narrow window). Hiding the top bar to reclaim 44px of article buys the reader
nothing, because they are not looking at the article; what it costs is the only exit that survives
a keyboard.

**As built**, `.mode-band` is another argument to the two `:root:has(…)` guards that already sit in
that query — the list of reasons the bars must stay, which until now held a focused control, an open
drawer and the three dialogs:

```css
:root:has(.controls:focus-within, .mode-band)              { --bar-bottom: …; --bar-hide: 0px; }
:root:has(.dock-drawer, .dock:focus-within, …, .mode-band) { --dock-bottom: var(--dock-space); }
```

**Not** as a `:not(:has(.mode-band))` on the hidden-bars rule, which is what this plan first said.
That takes that rule from (0,2,0) to (0,3,0) — a *tie* with these guards, decided by source order —
and a guard that holds because of where it sits in the file is one that goes quiet the day somebody
reorders it. Sol caught the identical tie here on 2026-08-28, and caught this one on the plan.
Adding an argument to a `:has()` changes nothing, since `:has()` takes its most specific argument.

`:has()` on `:root` is already used in this stylesheet (`:root:has(.install-hint)`), so this is not
a new mechanism.

**Rejected:** teaching `watchBarVisibility` about the band. The knowledge would then live in two
places — a query string in the stylesheet and a condition in JS — and `tests/spine-width.test.ts`
exists because that file already has too many numbers to keep in step.

## 2. Plain mode

An empty band and no gist columns: the spine, the article, and nothing else.

### It is a mode, not a column preset

The state is already expressible — `?mode=hierarchy&cols=none` — so the cheap version is a dock
button that writes those two parameters. It is rejected because the reader could not then *see*
where they are: the dock is a radiogroup, and a member of it that is not a mode has no checked
state to show. Making it a mode is the same trade the file header already records for `hierarchy`
itself — *"giving `toc` a button of its own is what makes the radiogroup honest"*.

### What it costs

`src/modes.ts` gets one word, `MODES_UI` one row. Then:

- **`src/web/App.tsx`.** `inMode` keeps meaning `mode !== "hierarchy"` — which is exactly right for
  both of its jobs: the granularity pills do not apply in Plain, and the prose is forced on in Plain.
  A second, narrower question appears beside it: **`bandOpen = inMode && mode !== "plain"`**, passed
  to `fitView` as `modeBand`, used to choose which panel renders, and used to decide whether the ×
  exists — the third consumer, which the plan first missed and Sol named. `fitView` also takes
  `chosen: mode === "plain" ? [] : cols`, so the existing "no columns" arithmetic does the work and
  `layout.ts` is not touched at all.
- **`src/web/visitor.ts`.** `visitorGap` must return `null` for `plain`, and must do it by name.
  The fall-through is deliberately fail-closed, and the last mode that assumed otherwise shipped as
  owners-only with a plan claiming it was free (Outline, GPT Sol, 2026-08-28).
- **`src/title-text.ts`.** `MODE_LABEL.plain = "Plain"`. The tab title omits whatever
  `DEFAULT_MODE` is, so this becomes the *unwritten* one and `Hierarchy` starts appearing — which
  is correct and needs no code change.
- **`src/web/styles.css`.** Nothing, unless § 4 is taken.

### The icon, and the size

`AlignLeft` — the article as plain lines, against `ListTree` for Hierarchy and `Focus` for Outline.

Greg asked whether it should be the largest. Recommendation: **same size, and keep its text label at
narrow widths where every other button loses one.** `.dock-btn-label` is already `display: none`
below a breakpoint (Dock.tsx § the modes segment), so this is one selector, and it makes Plain read
as *the way out* rather than as one peer among nine drawn slightly bigger. Easy to change to a
literal size bump if it does not read.

### Plain as the default

`DEFAULT_MODE = "plain"`. Copied URLs start carrying `?mode=hierarchy` where they used to carry
nothing; `withMode` already omits whatever the default is, so that falls out.

The one thing it breaks is that every pre-2026-08-29 `?mode=toc` link would silently start opening
Plain. Those links work today only because `toc` is an unrecognised value and an unrecognised value
lands on the default — which happened to be the view `toc` named. Move the default and the
coincidence breaks.

**Greg's call, 2026-08-31: do not preserve them.**

> Can we tidy up/get rid of `toc` altogether. I'm not worried about breaking urls — we're in alpha
> and have no users yet.

So there is no alias. `toc` becomes an ordinary unrecognised value with no story attached, and the
back-compat machinery goes with it:

- `tests/url-state.test.ts` § *"still shows the hierarchy for a link written before the rename"* is
  deleted. It exists to assert a guarantee we are no longer making.
- `tests/public-read-rewrite.test.ts` keeps `"toc"` in its list of unknown values — it is a fine
  test string — but the comment calling it *"the real case"* goes, and the assertions there say
  `DEFAULT_MODE` rather than the literal `"hierarchy"`, since what they are testing is the
  unknown-value rule and not which mode happens to be the default.
- The paragraphs explaining the `toc` fallback in `src/web/params.ts` § `modeParam`,
  `src/read-address.ts` § `readMode`, `src/modes.ts` and `src/web/Dock.tsx` § `withMode` are
  trimmed to the rule itself: *an unrecognised mode lands on the default, so a link from a future
  version degrades to the article rather than to an error.* That rule is still true and still worth
  keeping; the worked example it hangs on is over.

**The pipeline step keeps the name.** `toc` is simultaneously the old mode name and the *step* that
builds `tree.json` (`src/pipeline.ts` § `STEP_ORDER`, `src/toc.ts`,
`docs/project/table-of-contents.md`). That collision is what the 2026-08-29 rename ended, by giving
the word to the step. Nothing here touches it.

## 3. The way out of a mode: an × in the controls bar

`App.tsx:1866` — one occurrence, rendered in every mode, which is why it reads as "a lot of them".
It becomes:

```
┌───────────────────────────────────────────┐
│ Spine │ Mode  search  ✕ │ ↑↓ paragraph    │
└───────────────────────────────────────────┘
```

Measured today it is a 12px grey underlined text link at `x: 607–711` in a bar of pills — the
quietest thing in it. An `X` icon button styled like the existing `.chat-icon` is louder, is the
icon Greg asked for, and stops the bar naming a destination.

**Where it lands: `plain`, by name.** The plan said `DEFAULT_MODE`, and Sol was right that those are
different contracts which happen to coincide today: *where a reader lands with no instructions* and
*what closing a panel means* have no reason to agree, and if the default moves again the × would
silently start opening whatever it moved to. Closing a band means the article. **Rejected:** remembering the band-less mode the reader came from in a
`useRef`. It is one line, and it makes the same button do two different things depending on history
the reader cannot see — and a ref resets on remount, so it would be *mostly* consistent, which is
worse than either.

The label `back to contents` also survives in three plan/doc ASCII diagrams
(`docs/project/glossary.md`, `docs/plans/chat-mode.md`, `docs/plans/ideas-mode.md`). Those are
records of what was built at the time and are left alone; `docs/project/reading-view-overview.md`
and the App comment are updated.

## 4. An icon to the original

In the sticky `.controls` bar, not the masthead. The masthead's `<h1>` is *already* an `<a>` to
`meta.url` and a browser pass found it undiscoverable — no `title`, no `aria-label`,
`text-decoration: none`, and the same `oklch(0.97 0 0)` as unlinked heading text, so the only
affordance is an underline that appears on hover. And the masthead scrolls away, which is the same
reason the About disclosure was moved out of it in the first place (Masthead.tsx).

Three states, and the third is the one that matters:

| condition | control | tooltip |
|---|---|---|
| `meta.url` present | `ExternalLink`, opens in a new tab | *Open the original at `noemamag.com`* |
| no `meta.url`, `source === "pdf"`, **owner** | `SourceLink` (existing component), `FileDown` | *Download the PDF this was made from* |
| otherwise | nothing rendered | — |

The owner gate is not new policy: it is the rule `SeeTheOriginal` in Masthead.tsx already applies,
for the reason written there — *"What they cannot have is somebody else's uploaded file."* A visitor
on a shared link still gets the `meta.url` arm, because that is a public address.

Placement: **the left end of the bar, first of everything.** The plan said the right end — a fact
about the article rather than a control over the view — and Sol measured why that is wrong: on a
phone the controls bar scrolls sideways and nothing in it shrinks, so a rightmost icon can start past
the edge of the screen, reachable only by dragging a bar most readers do not know drags. Nothing that
must be findable goes at that end.

`SourceLink` also grew an `onError` hook. Its default is a sentence beside the button, which is right
in the masthead's paragraph and wrong in a fixed-height row that does not shrink its children — the
sentence would push the granularity pills off the screen. The bar reports the failure the way it
already reports a comment-transport failure: a short label, the whole message in the tooltip.

## 5. `GET /api/source/:slug` did not work in production, and now does

`sendSource` in `src/routes.ts` authorises correctly and then reads the bytes off the local
filesystem:

```ts
const { dir } = fsLocations(slug);
const manifest = await readRaw(dir);
const bytes = await readFile(path.join(dir, manifest.file));
```

Vercel has no such disk, so the existing masthead link 404s there, and § 4's download icon would
inherit that. `SourceLink.tsx`'s header says the fix is "until source storage moves to the
database" — that is stale. **The bytes are already in Supabase Storage**: uploads land at
`staging/<uploadId>`, are hashed and promoted to `sha256/<hash>.pdf` (`src/source.ts`
§ content addressing), and `blobStore()` picks Supabase whenever the service credentials are
present (`src/store/blobs.ts` § why selection does not read `SPIDERYARN_STORE`).

So the route needs the *key*, which lives on the revision row, and `src/store/pg.ts` has been
waiting for this exact caller:

> `rawFilename` is reader-facing (it is what an uploaded PDF should download as) and **will want a
> grant here the day something serves it, which is exactly what this map is for.**

### The change, as built

1. **A `rawSource` revision reader** in `src/store/pg.ts` — `rawSource` and not `source`, because
   `source` is already a *column* on that table (`Meta.source`, which says "pdf"), and one word for
   two things in one file is the collision the `toc` rename was made to end. Six columns: `id`,
   `rawBytes`, `rawContentType`, `rawSourceSha256`, `rawSourceKind`, `rawFilename`.
   `tests/store-revision-columns.test.ts` has it in its loops, and asserts both that `rawBytes` is
   granted to this read *and to no other*, and that this read does not also drag the article across.
2. **`ArticleReader.loadSource(slug)`**, returning `{ bytes, kind, filename } | null`. Not
   `readerStore`, which is the reader-*profile* store. The filesystem adapter answers from
   `data/<slug>/`; the Postgres one from the object store the revision names, falling back **inside
   itself** to `raw_bytes` for a row written before references existed. Neither reaches into the
   other's storage — the plan had the Postgres path fall back to the local disk, which on Vercel
   turns a document the database still holds into "no source exists".
3. **`readRawDocument` reused, not reimplemented**, and lifted out of `src/store/export.ts` into
   [`src/store/raw-document.ts`](../../src/store/raw-document.ts) to break an import cycle
   (`export.ts` reaches into `pg.ts` for `ownedSlug`). It owns the two eras, the refusal to fall
   through from a dangling reference, and the **re-hash** of what the bucket returned — the key *is*
   the digest, so skipping that lets a bad backfill put one reader's document under another's name.
   `export.ts` re-exports the three names, so its callers and tests are unchanged.
4. **`sendSource` keeps `await shelfStore.read(slug)` first** — that is the authorisation, added
   because the route was authenticated and not authorised (GPT Sol, 2026-08-27). Kept even though
   `currentRevision` joins through `ownedSlug` too: two independent refusals on the one route that
   hands back somebody's private document is worth a round trip, and the filesystem store has no
   owner column at all.
5. **`Content-Disposition` takes `rawFilename`**, escaped — an ASCII fallback in `filename=` and the
   real name percent-encoded in `filename*=UTF-8\'\'…`. It is reader-controlled text going into a
   response header. **`Content-Type` comes from the recorded kind**, never from `raw_content_type`:
   that column is the *origin's* header, and a valid PDF fetched as `application/octet-stream`,
   served back with `nosniff`, is a document the browser will refuse to open and will not rescue.
6. **`src/routes.ts` no longer imports `node:fs` or `node:path` at all.** `sendSource` was the last
   reader of the disk in that file, and a fresh `readFile` there is the shape of this bug returning.

### How we know it works rather than reports success

`tests/source-download.test.ts` drives `readRawDocument` against a stub blob store — no database, no
bucket — and covers all four outcomes rather than the two the plan named, because a test for "it
works" plus "the store threw" would have passed against the version that answered 404 for everything
in between:

| what the row and the bucket say | answer |
|---|---|
| no reference, no legacy column | `null` → 404, *this article kept no source document* |
| a reference the bucket cannot answer | `MissingRawObject`, 500 |
| a reference whose object hashes to something else | `CorruptRawObject`, 500 |
| the blob store itself throwing | propagates → 500 |

Plus: a dangling reference must **not** fall through to a legacy column that is also present, and
the `Content-Disposition` cannot be made to close its own quoted string.

## Build order

Built in this order, which is the order it was planned in:

1. § 2, Plain mode, the default move, and the `toc` clear-out — with the test updates it forces.
2. § 3, the ×.
3. § 1, the bar-hiding rule, in the guards rather than as a `:not()`.
4. § 5, the server fix, its extraction and its tests.
5. § 4, the icon, which now has a working link behind both arms.

## Checks

`npm test`, `npm run typecheck`, `npm run lint` on the touched files.

**Six suites sweep `MODES` and every one of them had to be changed on purpose**, which is the point
of them: `tests/visitor-gaps.test.ts` (Plain named as free), `tests/url-state.test.ts` (the `toc`
back-compat test retired, and the default read from `DEFAULT_MODE`),
`tests/public-read-rewrite.test.ts`, `tests/page-title.test.ts`, `tests/page-head.test.ts` (nine → ten,
and Hierarchy now *named*), and `tests/store-revision-columns.test.ts` for the new projection. Each
was watched failing first.

A browser pass at 390 × 740 reproduces the table at the top of this file with the bars **staying**
while a band is open — and, on the same page, still leaving while one is not, so the rule is scoped
rather than switched off.

---

Up: [reading-view-overview.md](../project/reading-view-overview.md)

## What the review changed

GPT Sol reviewed this plan before any of it was built —
[the full review](plain-mode-and-the-way-out-review-sol.md). Its verdict on the Plain-mode half was
"sound"; its verdict on § 5 was that it *"uses the wrong store seam, mishandles legacy production
rows, and turns broken blob invariants into misleading 404s."* All four of those were right, and the
built version is different from the plan above in these ways:

- **`readerStore.rawSource()` was the wrong home.** `readerStore` is the reader-*profile* store. The
  read is `ArticleReader.loadSource` now — the article-reading contract — with a `rawSource`
  projection of its own in `src/store/pg.ts` rather than columns added to the `article` read that
  every page load runs.
- **The legacy fallback crossed stores, and now does not.** The plan had a revision with no
  `raw_source_sha256` fall back to the filesystem. A production row from before references has its
  bytes in the same Postgres row's `raw_bytes`, so on Vercel that would have turned a document the
  database still holds into "no source exists". Each adapter answers from its own store, and the
  legacy branch lives inside the Postgres one.
- **A dangling reference is a 500, not a 404.** Once a revision names a stored object, that object is
  an invariant. A deleted object or a mis-set bucket is an operational fault and has to look like
  one; telling an owner their paper never existed would put the failure where monitoring cannot see
  it and where the reader will not report it.
- **The bytes are re-hashed against their key**, which the plan did not say and the existing
  exporter already did. The key *is* the digest, so skipping it means a bad backfill can put one
  reader's document under another's name.
- **And all of it is `readRawDocument` reused rather than reimplemented** — lifted out of
  `src/store/export.ts` into [`src/store/raw-document.ts`](../../src/store/raw-document.ts), because
  importing it from `export.ts` made a cycle (`export.ts` reaches into `pg.ts` for `ownedSlug`).
  `export.ts` re-exports the three names, so its callers and tests are unchanged.

Four smaller ones:

- **`meta.url` was not safe to copy into an `href`.** The fetcher validates a URL on the way in, but
  an *imported* article's metadata is written straight into the row, so a `javascript:` value is
  reachable — and the masthead's `<h1>` anchor had had this hole all along. Both go through
  `isWebUrl` now. `tests/the-original-control.test.tsx` covers it, and was watched failing without
  the guard.
- **The × goes to `plain` by name, not to `DEFAULT_MODE`.** *Where a reader lands with no
  instructions* and *what closing a panel means* are different contracts that happen to agree today.
- **The bar rule went into the existing `:has()` guards** rather than becoming a `:not()` on the
  hidden-bars rule, which would have raised that rule's specificity to (0,3,0) — a tie with the
  focus guards, decided by source order. That exact fragility was a Sol finding here on 2026-08-28.
- **The source icon is leftmost, not rightmost.** On a phone the controls bar scrolls sideways and
  nothing in it shrinks, so a rightmost icon can start past the edge of the screen.

`Content-Disposition` also gained an RFC 5987 `filename*` beside an escaped ASCII fallback, and the
response's `Content-Type` comes from the recorded kind rather than from `raw_content_type` — which is
the *origin's* header, so a valid PDF fetched as `application/octet-stream` would have been served as
one, with `nosniff` set.

## What the code review changed

The built code went back to GPT Sol —
[the second review](plain-mode-and-the-way-out-code-review-sol.md). No critical findings; one high,
four medium, two low, and a long list of things it checked and found correct (the `inMode` /
`bandOpen` split, `plainCols`, the owner filtering, the CSS specificity, `Content-Length`, the
keyboard walk). Seven changes came out of it:

- **The URL allowlist had been applied to two of its four sinks.** `TheOriginal` and the masthead
  check `isWebUrl`; `Metadata.tsx` and `ShelfEntry.tsx` were still rendering the same imported
  `final_url` straight into an `href`. Both are gated now — the metadata page still *prints* a
  refused address as text, because that page's job is to show what we hold, and the shelf card simply
  has no button. `tests/the-original-control.test.tsx` now also greps all four components for the
  guard, which is the assertion that catches a fifth sink arriving.
- **The blob read was unbounded.** `readRawDocument` called `get(key)` with no `maxBytes`, so an
  oversized object under a referenced key is buffered in full before it can be hashed. It passes
  `MAX_UPLOAD_BYTES` now — the largest thing that can legitimately be under a canonical key, since
  uploads stop there and a fetch stops at 32 MiB.
- **The Postgres adapter could still reach the filesystem.** `loadSource` called `blobStore()`, which
  picks the local disk when the Supabase credentials are absent. The running server never reaches
  that arm — `src/store/index.ts` builds a checked store at boot and refuses to start without the
  pair — but `pgArticleReader` is exported and imported directly by scripts and tests, and a direct
  caller bypasses the guard entirely. It asks for `postgresBlobStore(…)` by name now and fails closed.
- **`filename*` was not RFC 5987 for every legal filename.** `encodeURIComponent` leaves `'`, `(`,
  `)` and `*` alone and none is an `attr-char`, so `O'Brien (draft)*.pdf` produced a value a strict
  client may reject — falling back to the lossy ASCII half for a name that did not need it. And a
  lone UTF-16 surrogate made it *throw*, turning an imported filename into a 500.
- **A failed download was silent to a screen reader.** The blank tab closing and a label appearing
  are both invisible; both error surfaces carry `role="alert"` now.
- **The tests did not exercise the route.** `tests/source-route.test.ts` drives the real `handleApi`
  with the store faked at the seam: the four statuses, the headers, the exact body length, and that
  nothing is written before the document is in hand. Both of the regressions Sol named — the null
  outcome becoming a 500, `Content-Length` removed — were reproduced and watched failing.
- **And one test was passing for the wrong reason**, which is the finding worth keeping. Sol
  predicted `tests/owner-isolation.test.ts` would now fail: it asserts that `shelfStore.read` comes
  before the bytes are fetched, and compares against `fsLocations(slug)`, which `sendSource` stopped
  *calling*. It did not fail — the rewrite left a comment saying *"This used to be `fsLocations(slug)`
  plus a `readFile`"*, and the regex matches the function's whole text, prose included. So the test
  went on asserting an ordering between a live call and a sentence about a dead one. Neither the
  review nor a green suite would have told you: one predicted the wrong outcome, the other reported
  the right outcome for the wrong reason. It strips comments first now, asserts both operands are
  present before comparing their positions (two `-1`s also satisfy `<`), and asserts that the
  stripping did something. [silent-success.md](../reusable/silent-success.md).
