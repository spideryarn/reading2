# Add a link to the public shelf in the site footer

Greg, through the Feedback button, 2026-09-12 (Sentry `SPIDERYARN-READING2-3V`, standing on
`https://www.spideryarn.com/`):

> Add a link in all the footers to the publicly readable shelf alongside, you know, feedback and
> pricing etc

The publicly readable shelf is `/read/public` — [public-shelf.md](../project/public-shelf.md). Today
it is reachable from the `PublicShowcase` block on `/` and `/features`, from
`/features/public-readable-sharing`, and from the command bar. It is **not** in the footer row, which
is the site's actual navigation and the thing a reader scrolling to the bottom of the landing page
looks at.

## What "all the footers" turns out to mean

**There is one footer**, and finding that out was most of the investigation the report asks for.
[`src/web/SiteFooter.tsx`](../../src/web/SiteFooter.tsx) is a single component drawn by eleven pages,
and its `LINKS` array is the whole of the row. That is not an accident: the row existed twice before
the component did — hand-written in `LandingPage.tsx` and again in `FeaturesPage.tsx`, already
disagreeing about which links they carried — and the file's header says in as many words that *"a
Terms page is one entry in `LINKS`, not an edit to every page"*. So this report is one array entry,
which is the component working as designed.

The sweep for other footers, so the claim above is checked rather than assumed:

| `<footer>` in the tree | Is it a site footer? |
|---|---|
| `src/web/SiteFooter.tsx` | **yes** — the one |
| `src/web/ChatDialog.tsx`, `src/web/CommentDialog.tsx` | no — a dialog's action row |
| `src/store/export-bundle.ts` | no — the colophon inside an exported article's HTML, which is an artefact a reader downloads and not a page on the site |

And the pages that mount `SiteFooter` are pinned by `tests/site-footer.test.tsx` § *the pages that
mount it*, so "eleven" is a fact with a test under it rather than a count in a paragraph.

**`/read/public` itself has no footer, and keeps none.** Greg's earlier exclusion — *"NOT on any
`/read/*` pages"* — is written about the path, and `SiteFooter.tsx` records the day a previous
version read it as being about the reading *view* instead and had that called rationalising by a
cross-family review. Adding a link *to* the shelf is not the same request as giving the shelf a
footer, and the shelf already carries `SiteNav`, so nothing there is unreachable. This plan does not
touch that exclusion.

## The decisions, and the simpler option each passed over

### 1. The label

The row's register is page names: *Home, Features, Pricing, Privacy, Contact, What's new, Open
source*. Two strings for this page already exist in the tree — `"Public shelf"` in
[`CommandBar.tsx`](../../src/web/CommandBar.tsx) and a heading-specific constant with the value
`"Shared articles"` in [`messages.ts`](../../src/messages.ts), which is the page's own `<h1>`.

**The label is *Shared articles*, and it is `PUBLIC_SHELF_LABEL` rather than a new string.**
Arbitrated by Fable, 2026-09-16, and each of its claims checked against the tree afterwards. The
decision began from three existing *Shared articles* surfaces against one *Public shelf* surface:

| Surface | What it says today |
|---|---|
| the page's `<h1>` | the shelf-name constant — *Shared articles* |
| the browser tab | `"Shared articles"`, a literal, in [`page-title.ts`](../../src/web/page-title.ts) |
| the *← Back* link on `/features/public-readable-sharing` | `"Shared articles"`, a literal |
| the command bar | `"Public shelf"`, a literal |

So *Shared articles* is already the reader-facing name and *Public shelf* is the outlier — and the
command bar's own comment says it took the name from `docs/project/public-shelf.md`, which is the
**internal** name for the page. That is the exact mistake `CHANGELOG_LABEL` was extracted to fix:
*Changelog* is what we call the process that writes the page, and a reader has never heard of it.

Two further reasons, both about who reads the footer:

- **"Shelf" means the reader's own library everywhere else in this product**
  ([library.md](../project/library.md)) — `shelf` is literally an alias on the command bar's
  *Library* row. On a signed-out marketing page, *Public shelf* is jargon that points the wrong way.
- **"Shared" rather than "Public" is a decision already taken**, for the reason
  [`page-title.ts`](../../src/web/page-title.ts) gives at the case: *"an owner reads 'shared' as
  something they did, and this list is exactly what they did"*. The shelf badge says it the same way.

**The constant lives in `messages.ts`, not beside `CHANGELOG_LABEL` in `router.ts`**, which is the
one place the obvious pattern does not transfer: `messages.ts` is on the shared-import allowlist
precisely because it imports almost nothing, and `router.ts` imports React. The constant is already
there and already imported by the page, and `messages.js` is allowlisted for client files
(`tests/client-imports.test.ts` § `SHARED`), so the footer and the command bar can both reach it.

**It is renamed `PUBLIC_SHELF_LABEL`.** Once the same value names a heading and two navigation rows,
a name that says where it is drawn is knowingly stale. GPT Sol made the same recommendation as
Fable; this is the cheapest moment to do the call-site rename because this change already touches
the consumers.

**So the command bar changes too**, to the same constant, with *public shelf* demoted to an alias
beside the four it already has. That is not scope creep dressed up: the footer and the command bar
would otherwise name one page two different ways starting the day this lands, and this change is what
creates the collision. Nothing is lost, because an alias is what the bar matches on
(`tests/command-bar.test.tsx` asserts the *ranking*, and mentions `Public shelf` only in a comment —
no test pins that literal).

**The two remaining literals stay literal**: the browser tab and the *← Back* link. They already say
the right words, and folding them in changes no behaviour. GPT Sol's plan review called that cleanup
more than this report needs; the constant's docblock names both copies so the duplication is visible
when either is next touched.

### 2. The entry declares its own route, and `FooterPage` grows a member

Every entry in `LINKS` carries `here`, the route it *is*, so the row can drop the link for the page
under the reader's feet. `FooterPage` is `Extract<Route["kind"], …>` and is documented as *"the link
kinds `LINKS` carries"* — so once the shelf is a link, `"public-library"` belongs in that type by the
type's own definition, not as a favour to it.

**The drop it enables is inert today**, because `/read/public` draws no footer for the link to be
dropped from, and that is worth writing at the point of use rather than leaving to be rediscovered.
The alternative — making `here` optional for entries whose page has no footer — was passed over: it
adds a branch and a second kind of entry to save nothing, and it would have to be undone the day the
`/read/*` exclusion is revisited.

### 3. Position in the row

After *Features*, not at the end. The row runs product → commerce → policy → meta, and the shelf is a
product destination: it is the page that shows a stranger what the thing does with real articles.
Appending it after *Open source* would put the most persuasive link in the row last, behind two links
written for people who already know what Spideryarn is.

### 4. What is deliberately not in this change

- **No `SiteNav` entry.** Greg asked for the footers. The top bar was measured tight at the 320px
  reflow width ([SiteBits.tsx § `SiteNav`](../../src/web/SiteBits.tsx)), another always-on link
  there is a measurement exercise rather than an array entry, and the same decision was already taken
  and recorded for `/contact`.
- **No second copy on the shelf page itself.** See above.

## The stages

### Stage 1 — the failing test

`tests/site-footer.test.tsx` holds the row's inventory as an exact `toEqual` against an ordered
array, so every one of its eight existing row assertions goes red the moment the entry lands. **The
test moves first**: add the constant token and thread it through the expected rows, watch the suite
go red against today's `LINKS`, then build.

Red is expected to read as *"expected [ …7 ] to deeply equal [ …8 ]"* on the control at `/profile` and
on the six existing self-drop cases and the explicit-`here` case.

A ninth assertion closes the pre-existing gap the review found: **Pricing drops its own link**. The
exact arrays already prove the shelf link is present everywhere they run, so a second loop asserting
that would be redundant.

### Stage 2 — the entry

Files:

- `src/messages.ts` — rename the shelf-name constant to `PUBLIC_SHELF_LABEL` and record its three
  consumers and the two deliberately untouched literals.
- `src/web/SiteFooter.tsx` — one entry in `LINKS`, one member on `FooterPage`, and the comments that
  say why each is there.
- `src/web/CommandBar.tsx` — reads the constant; *public shelf* becomes an alias; the comment that
  justified the old literal is replaced by one that justifies the constant.
- `tests/public-shelf-page.test.tsx` — follow the constant rename.
- `tests/site-footer.test.tsx` — add the shelf token to every exact row and the missing Pricing case.
- `tests/command-bar.test.tsx` — remove the stale label from its ranking comment.

Then `npm run typecheck` and the scoped suites: `site-footer`, `command-bar`, `page-title`,
`public-shelf-page`, `public-showcase`, `reserved-article-address`.

### Stage 3 — the narrow-window measurement

`SiteFooter.tsx` claims *"Measured clean — `scrollWidth - clientWidth === 0` … on all seven pages at
1440, 390 and 320"*. An eighth link makes that claim untested, and a claim in a comment that nobody
re-measured is exactly what [silent-success.md](../reusable/silent-success.md) is about. So: measure
again at 1440, 390 and 320 on the pages that draw the row — including `/login`, whose 336px column is
the tightest place the row is drawn — and update the sentence with what was actually measured.

The row is `flex-wrap`, so the expected answer is "it wraps and nothing scrolls sideways". The point
of measuring is that the expected answer is not evidence.

### Stage 4 — the docs that make a claim about this

Four places say something that this change makes false or incomplete:

- [`src/web/SiteBits.tsx`](../../src/web/SiteBits.tsx) § `SiteNav` — *"it is deliberately not in
  `LINKS` below or in `SiteFooter`'s"*. **Becomes half false**, and that half is the point of the
  sentence, so it has to be rewritten rather than trimmed: the shelf stays out of the *nav's* list
  and joins the *footer's*.
- [public-shelf.md](../project/public-shelf.md) § Who sends people here — currently *"Two marketing
  pages"*. The footer is a third route in, and a different kind: every page rather than two.
- [website-text.md](../project/website-text.md) § The footer — the list of what the row carries.
- [`PublicLibraryPage.tsx`](../../src/web/PublicLibraryPage.tsx)'s header — *"nothing is lost, because
  the bar above already carries every link the row would"*. Still true and now more interesting: the
  row would carry a link to this page, which the bar does not.

Each is a doc under an entry point rather than a rule-bearing doc, so none needs approval —
CLAUDE.md § Editing a doc whose wording is a rule.

### Stage 5 — gates, review, land

`npm test` and `npm run typecheck`, GPT Sol on the scoped diff, then `git push origin HEAD:dev` and
the note in `docs/user-feedback/`.

## What could go wrong

- **The row gets too long and starts wrapping on a normal window.** Measured in stage 3 rather than
  argued about here.
- **A third home for the page's name.** § 1 is the whole of the answer to this, and `CHANGELOG_LABEL`
  exists because the same thing happened to *What's new*.
- **Somebody later lifts the `/read/*` footer exclusion and the shelf's own footer links to itself.**
  It will not: the entry declares `here: "public-library"`, so the drop is already written and fires
  the moment the page draws a row.

---

## GPT Sol's review of this plan, and what changed because of it

`260916a-…-review-sol.md`, 2026-09-16, `--sandbox review`. Five findings, all five accepted; every one
was checked against the tree before being acted on. It also confirmed the five conclusions the prompt
named, including that the sweep for other footers is complete — it went further than mine and checked
the server head composer (`src/public/page-head.ts` preserves the body byte for byte), the static
shell (`index.html` holds only the React root) and the absence of any email template.

| # | Finding | What changed |
|---|---|---|
| 1 | The sentence in `PublicLibraryPage.tsx` — *"the bar above already carries every link the row would"* — **is already false**, and the replacement this plan proposed is false too. `SiteNav` carries Home, Features, Pricing, Privacy; the footer carries seven. And a footer on `/read/public` would drop its own shelf link, so *"the row would carry a link to this page"* is wrong in the other direction. | Stage 4 rewrites that header around the actual rule rather than patching the claim. A pre-existing falsehood, found because this change made me read the sentence. |
| 2 | *Shared articles* winning the label does **not** mean the site stops saying "public shelf": `PrivacyPage.tsx:673` and `:690` say *"our public shelf"* in descriptive prose. | § 1 no longer implies otherwise. The prose stays — it describes the thing in a sentence, and is not a name for a destination. `tests/command-bar.test.tsx:1000` has the old literal in a comment and joins the stage 2 file list. |
| 3 | Stage 1 miscounted, and its ninth assertion was redundant — the exact `toEqual` arrays already pin the new link's presence everywhere they run. | Counted properly: **eight** exact row arrays and **six** self-drop cases. The redundant loop is cut. In its place, the **Pricing self-drop case that has never existed** — a real pre-existing gap, and worth more than the loop. (Sol counted seven arrays and six drops; it missed the `here` assertion at line 167. The number above is mine, from the file.) |
| 4 | The measurement inventory is already contradictory: `SiteFooter.tsx` says "all seven pages", the mount inventory holds eleven components, and 260908d actually measured eight signed-out and seven signed-in routes. `marketing-pages.md:28` says "the other six" and is stale. | Stage 3 replaces "seven pages" with what is actually measured, split signed-out/signed-in, and fixes `marketing-pages.md`. Sol found no other count or measurement that the eighth link invalidates. |
| 5 | Converting the `page-title.ts` tab literal and the `← Back` link to the constant changes no behaviour and is more than the request needs. | **Cut**, along with the `tests/page-title.test.ts` assertion that existed only to cover them. Those two literals already say the right words; they are pre-existing duplication this report did not cause, and they are named here so the next person does not have to rediscover them. The command bar stays in, because it presents a genuinely *different* navigation label and this change is what makes that a visible inconsistency. |

Two further corrections it made, neither a finding:

- **The constant is renamed to `PUBLIC_SHELF_LABEL`.** Both reviewers said so independently. Once it
  names a heading, a footer link and a command row, `HEADING` is a name that is knowingly wrong, and
  `CHANGELOG_LABEL` is the general name this repo already uses for the same job. Seven call sites.
- **"The footer is never drawn under `/read/*`" would be a false comment.** Signed out at an unshared
  `/read/<slug>` the reader gets `LandingPage`, which carries the row — `SiteFooter.tsx`'s own header
  says so. The precise claim, and the one the new entry's comment will make, is that **the footer is
  never drawn while `useRoute()` returns `public-library`**, which `App.tsx:234` and `:483` establish
  by mounting `PublicLibraryPage` for that route in both the signed-out and signed-in branches.

It also rejected one of my reasons while agreeing with the conclusion: `router.ts` importing React is
not why the constant belongs in `messages.ts`, since `SiteFooter`, `CommandBar` and `page-title.ts`
all import `router.js` already. The real reason is simply that the constant is already in
`messages.ts` and moving it buys nothing.

## Stage 3, as measured

Headless system Chrome via `playwright-core`, against this worktree's own dev server — the process's
`/proc/<pid>/cwd` checked against the worktree, and the served `PUBLIC_SHELF_LABEL` checked in the
response, because a port cannot tell two servers apart and half this box is running one.

**Thirty-three cells, every one zero.** `scrollWidth - clientWidth` on the page, on the `<footer>`
and on the nav, at 1440, 390 and 320, across nine signed-out route states and two signed-in route
states (`/` — the reader's shelf — and `/profile`). The row wraps rather than scrolling: three lines
at 320, two at 390, and two even at 1440 inside `/login`'s ~336px column, which is the tightest place
the row is drawn and behaved exactly as the old comment predicted it would.

The link count per page is 7 or 8 and never 0 — 8 wherever the page is not a `FooterPage` member and
so drops nothing (`/login`, `/features/public-readable-sharing`), 7 where it drops its own. That the
count was never 0 is the control: it says the measurement was taken on a page that actually drew a
footer, rather than on one that drew nothing and overflowed by nothing.

## GPT Sol's review of the code, and what it changed

`260916a-…-code-review-sol.md`, 2026-09-16, `--sandbox workspace-write`, so it fixed what it found
and I read the diff afterwards. It reported four issues, all in comments and docs rather than in
behaviour — which is the right shape for this change, since the runtime part of it is one array
entry.

**Its answer file is a summary that points at itself for the ranked detail**, so the diff is the
record rather than the prose. What it actually changed:

- **Three more stale counts**, in comments this change had already walked past: *"a row of six
  identical grey words"* on the GitHub mark, *"the same shape as the five above it"* in the test's
  token block, and the cell in `marketing-pages.md` where I had replaced one wrong number with
  another right one. All three are now written without a count. That makes five counts removed by
  this change and none added, which was the point.
- **`SiteBits.tsx`'s `signedIn` paragraph**, which said *"two of the three pages that draw this bar
  are mounted signed in as well as signed out"* and had been stale since `/read/public` joined the
  bar on 2026-09-04. It is now Features, Pricing and the public library, named. **Checked against
  `App.tsx` rather than taken on trust**: `:178`/`:416`, `:192`/`:463` and `:234`/`:487` are the three
  pairs, and `LandingPage` is `signedIn={false}` only, so the correction is right and the sentence it
  replaced was wrong.
- **My own comment on `FooterPage`**, from *"the one member whose drop can never fire"* to *"does not
  fire in today's page tree"*. That is the weaker and truer claim — nothing stops a future page
  drawing the row at that route — and it is the same class of overstatement the first review caught
  in the plan.
- **The measurement sentence**, from "pages" to "route states". `/` signed out and `/` signed in are
  one address measured twice, and calling them two pages would have made the inventory unfalsifiable
  by anybody re-running it.

Two things it checked that I could not have checked by reading:

- **It mutation-tested the new Pricing self-drop case** — changed that entry's `here` and confirmed
  the test goes red. A test written for a gap nobody had noticed is exactly the kind that can be
  vacuous, and this one is not.
- **It re-ran the sweep for the old constant name** and for any surviving *Public shelf* used as a
  navigation label, and found only the one intended historical mention inside the constant's own
  docblock.

It kept the `SHELF` token being built from the constant while its neighbours are literals, agreeing
with the argument written beside it, and it asked for no further scope cut.

**Its one gap, stated by it rather than found afterwards**: it could not run `npm test` — the sandbox
gave it no Postgres and no Docker, so the full suite ran here instead.

## The gates

- `npm run typecheck` — exit 0, read as an **exit code** rather than from its last lines, which are
  always `✓` (its failures go to stderr).
- The scoped suites — `site-footer`, `command-bar`, `public-shelf-page`, `public-showcase`,
  `reserved-article-address`, `client-imports`, `page-title`, `doc-links` — 8 files, 170 tests,
  green.
- `npm test`, once, through `scripts/tmux-job.ts` at load 2.7: **1127 files passed, 8 failed;
  24350 tests passed, 7 failed.** None of the eight is this change, and that was established rather
  than assumed:

| Failing file | Why, and how it was checked |
|---|---|
| `cold-start-lazy-imports.test.ts`, `pdf-bundle-trace.test.ts` | Both failures are the assertion literally named *"has a build to inspect"* — a worktree has no `api-dist/` until `npm run build` runs. Environment, and the two files a fresh worktree always reds. |
| `fleet-usage-history-wiring.test.ts`, `overseer-daemon-usage-pass.test.ts`, `overseer-store-usage.test.ts` | **Failing on `dev` already.** Re-run in the shared primary checkout, which does not contain this diff, and they fail there identically. |
| `fleet-composed-access.test.ts`, `fleet-decisions-route.test.ts`, `fleet-reports-route.test.ts` | Pass in the primary and fail in a worktree, which has none of the fleet's on-disk data (52 tests ran here against 130 there). Environment. |

Two independent reasons none of them can be this change: they were each re-run **alone**, so it is
not cross-suite contention (docs/reusable/silent-success.md — a full-suite red here is usually
contention, and that has to be excluded before it means anything); and none of the six imports
anything in the diff. The only `messages.js` anywhere under `tools/` is `./cli-messages.js`, a
different module.
