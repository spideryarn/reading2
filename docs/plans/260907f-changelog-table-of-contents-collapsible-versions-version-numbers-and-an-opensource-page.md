# `/changelog` gets a contents list, collapsible releases and a version number — and `/opensource` gets a page

Status as of 2026-09-07: **built, on branch `worktree-changelog-toc-and-opensource`, not yet
deployed.** Evidence: `tests/changelog-page.test.tsx` 26 passing, `tests/site-footer.test.tsx` 17
passing, `npm run typecheck` clean, and the page measured in Chrome at 1280×1000 — see § What
changed, measured.

## Goal

Greg, 2026-09-07, in two messages:

> Can you add a table of contents to /changelog, and make each version a collapsible section, all
> default-collapsed except the most recent one. Also, I found the difference between the link to the
> changes and the commit a bit confusing. And take browser screenshots and try and make that page
> more readable and attractive. And include a link to GitHub for the commit corresponding to each
> version. And also then create a brief /opensource page in the footer with links to/from various
> other pages, using GitHub logo to indicate.

> Also, let's include a version number (semver?) as part of the deploy, and include that in
> /changelog for each version, and on tooltip for the Homepage logo.

Seven things, in one page and one new page:

1. a table of contents at the top of `/changelog`;
2. each release a collapsible section, all shut but the newest;
3. the confusion between an entry's *"the change"* link and its row of short shas, removed;
4. the page made more readable and more attractive, checked in a browser rather than asserted;
5. a GitHub link on each release, at the commit that release deployed;
6. a version number, minted as part of the deploy, shown on `/changelog` and in the logo's tooltip;
7. a brief `/opensource` page, in the footer, marked with the GitHub logo.

## Why the page needs it

`/changelog` today is **46,368 CSS pixels tall** (measured in Chrome at 1280×1000 on 2026-09-07),
across 50 visible releases and 11 collapsed runs of quiet ones. There is no way to see what the page
contains without scrolling through all of it, and no way to get back to a release you passed.

The confusion Greg names is visible in the first screen. An entry draws two rows under its prose:

- `Summary · the change` — the entry's `links`, in highlight orange, mixing an app link (`/features`)
  with a **GitHub commit link labelled "the change"**;
- `0297784 93d565b 06ed314 …` — the entry's remaining `commits`, faint and tiny.

Both rows are commits. They are drawn in two different colours, two different sizes and two
different vocabularies, and nothing on the page says that "the change" is one of the shas. See
`ChangelogPage.tsx` § `Entry`, which already subtracts the linked sha from the sha row precisely
because they overlap — the code knew they were the same thing and the page did not say so.

## References

- [changelog.md](../project/changelog.md) — the process that writes the file, and the decisions
  under *The page*. This plan implements against that doc, it does not re-open it.
- [`src/changelog.ts`](../../src/changelog.ts) — the schema and parser, shared by the page, the
  writer and the tests. Imports nothing, because the browser bundle pulls it in.
- [`src/web/ChangelogPage.tsx`](../../src/web/ChangelogPage.tsx) — the page.
- [`tests/changelog-page.test.tsx`](../../tests/changelog-page.test.tsx),
  [`tests/changelog-file.test.ts`](../../tests/changelog-file.test.ts) — what holds it.
- [`src/web/SiteFooter.tsx`](../../src/web/SiteFooter.tsx) — the footer row, and its header's claim
  that a new page is *one entry in `LINKS`*. `/opensource` is the fourth test of that claim.
- [`src/web/ContactPage.tsx`](../../src/web/ContactPage.tsx) — the shape a short page takes here:
  Back link, `h1`, prose, `SiteFooter`. Not the marketing shell.
- [`src/web/GoogleMark.tsx`](../../src/web/GoogleMark.tsx) — the precedent for a hand-drawn brand
  mark, and why it is inline SVG rather than a file in `public/`.
- [icons.md](../project/icons.md) — Lucide, and only Lucide. **Lucide v1 dropped its brand icons**,
  so there is no `Github` export in `lucide-react@1.34.0` (checked: `Object.keys` of the package has
  no match for `/github/i`). The GitHub mark is therefore a component of ours, beside `GoogleMark`.
- [`scripts/deploy.ts`](../../scripts/deploy.ts), [`scripts/build-stamp.ts`](../../scripts/build-stamp.ts),
  [`src/web/build-stamp.ts`](../../src/web/build-stamp.ts) — where a version number would have to be
  minted and how it would reach the client.
- [README.md](../../README.md) § *Contributing* and § *Running it yourself* — the source material for
  `/opensource`, which should not say anything the README does not.

## Decisions

### The two commit rows become one

An entry's `links` are split by what they point at, not by where they came from:

- a link whose `url` starts with `/` is an **app link** — *Summary*, *Ideas*, *Experimental
  features* — and stays inline, in highlight orange, as the thing it is: somewhere to go and try it;
- a link whose `url` is a commit under `REPO_URL` is **a commit**, and joins the sha row.

So an entry has exactly one place commits appear, and one vocabulary for them. The row gets a
GitHub mark and the word *Commits*, so a reader who does not care can skip it by shape.

This needs no change to the file or to the copy stage: the copy prompt goes on emitting *"the
change"*, and the page stops drawing it twice. Changing the prompt as well would be a second edit
whose effect is invisible for as long as the existing 69 lines are on the page — the page has to
handle them either way. (Noted here rather than done: a future run's data is not what makes the
page confusing.)

### A release is a `<details>`, and the newest is open

Native `<details>`/`<summary>` rather than React state: it is keyboard- and screen-reader-correct
without any work, it survives Ctrl-F in browsers that search collapsed content, and it is the
simplest thing that closes. `open` is set on the first visible release only.

### The contents list is one line per release, and carries the headlines

A contents list of 50 rows that repeat the collapsed summary rows below would be furniture. So each
row says something the row below it does not: **version, date, and the release's headline titles**.
Where a release has no headline entry, the row says what it does have (*3 enhancements, 2 fixes*).

It is capped in height and scrolls inside itself, so it does not push the newest release below the
fold on a laptop.

### The version number: a release number on the page, a sha in the tooltip

Greg asked for *"a version number (semver?) as part of the deploy"*. Three candidates were put to
him — `0.1.N` from the deploy ordinal, a bare `Release N`, or hand-maintained semver in
`package.json` — and he referred the choice to Fable. **Fable's answer was a fourth option, and Greg
took it.** The two constraints it rests on were both checked in the code rather than assumed:

- **The deploy has no channel into the build.** Production is built on Vercel's machine from a push
  to `main`; `scripts/deploy.ts` pushes `<sha>:refs/heads/main` and never touches the build's
  environment. `SPIDERYARN_BUILD_COMMIT` exists and is read by `scripts/build-stamp.ts`, but nothing
  in the deploy path sets it for a production build — only `deploy.ts`'s own local gate worktree
  uses it. So "bake the ordinal in the way the commit is baked in" has no plumbing to ride on.
- **A build's own line is written after it ships** ([changelog.md § The page](../project/changelog.md#the-page),
  *"a version's entry lands one deploy late"*), so the running build's sha is never in the copy of
  `changelog-versions.ndjson` it is carrying. It cannot look itself up.

Fable also found the thing that would have made an ordinal quietly wrong: **the file has 69 lines
and 68 distinct shas.** Line 6 (2026-08-27T07:36) is a redeploy of line 5's sha, `commit_count: 0`.
Under a deploy-ordinal scheme those are two different version numbers for byte-identical code — and
the same divergence opens after a rollback, or after a `vercel deploy` from a working directory.
Verified here before it was believed.

So:

- **`/changelog` numbers a release by its line in the file**, counted from the oldest. Display only,
  minted nowhere, stable for ever because runs append. Quiet versions are counted although never
  drawn, so the page and the file stay in step — the redeploy line included, which is why the count
  is of *lines* and not of *shas*.
- **The logo's tooltip carries the sha and the build date** — *"built 7 Sep 2026 from 39282f8"* —
  which is the one fact the running build holds with certainty. `buildDescription` in
  `src/web/build-stamp.ts`, `null` off a build so no tooltip ever says *"built unknown"*.

Against semver specifically, and this is Fable's argument: `0.1.N` is not dishonest — nothing depends
on Spideryarn as a package — but it signals *pre-release* to paying readers and invites *"when is
0.2?"*, and the minor bump is a decision nobody is actually making at deploy time.

**The route not taken, priced.** If the ordinal is ever wanted in the tooltip, the only sound way is
for `npm run deploy` to commit a counter file *before* it captures the sha — the one-sha invariant
survives, since the commit precedes the first gate. It costs one extra commit per deploy, ~20 a day
at peak, into a tree several agents share. Not worth it for a tooltip.

## Stages

1. **The page's clarity** — one commit row per entry, the release heading gains its version and a
   GitHub link, `<details>` per release, the contents list. Tests alongside.
2. **`/opensource`** — the page, the route, the title, the footer entry, the GitHub mark, and the
   links to it from the places that should carry one.
3. **The version number** — number releases from the file in `parseChangelog`, show that on
   `/changelog`, and put the build's own date and sha in the logo tooltip.

   *This stage was written before the question was settled, and said the opposite: "mint it in the
   deploy, carry it into the build stamp … and backfill the 69 existing lines." Nothing is minted
   and nothing is backfilled. Left as a correction rather than a silent edit, because a stage list
   contradicting the decision above it is exactly the kind of stale sentence a later reader believes
   — GPT Sol's review, P3, which caught it here after § The version number had already been
   rewritten.*
4. **Look at it** — browser screenshots at 1280 and 390, before and after, and a readability pass on
   what they show.

Each stage: `npm test`, `npm run typecheck`, and a GPT Sol review of the code before it is committed.

## What changed, measured

Chrome at 1280×1000 against the dev server, on the real 69-line file:

| | before | after |
|---|---|---|
| page height | 46,368 px | 4,640 px |
| releases reachable without scrolling past one | 1 | 50, through the contents list |
| commit rows per entry | 2, in two vocabularies | 1 |

**Not *"50 releases visible at once"***, which an earlier draft of this table said and which is
false: the contents list is capped at 288 px and the page is 4,640 px tall, so a 1000 px window
shows neither all 50 rows nor all 50 shut releases. GPT Sol's review, P3. The claim worth making is
the one about reach — every release is one click from the top of the page rather than 46,000 pixels
down it.

Two things the browser found that no test had:

- **The hash link did nothing visible.** `/changelog#release-64` scrolled to release 64 and left it
  shut. The first draft let the `<details>` keep its own open state and wrote `details.open` from the
  contents list; a re-render put the attribute back. Fixed by making the open set React state —
  `ChangelogPage.tsx` § `VersionBlock` records it, because the reasoning that led to the bug is
  plausible enough to be repeated.
- **The narrow layout put two greys in one line.** At 390 px the counts wrapped up beside the date
  and pushed the release's name onto a second line. `w-full` below `sm` gives them a line of their
  own; the `<summary>` needed `flex-wrap` for that to do anything, which it did not have.

And one the tests found: an entry's commit and its *release's* commit are two different facts, so a
fixture where they were the same sha counted two correct links as a duplicate.

## What this deliberately does not do

- **It does not re-open `changelog.md`'s decisions** — three sections, two headlines, quiet releases
  collapsed into a line. Those are the process's, and this is its reader.
- **It does not add a client-side state store for what is open.** A reader who opens four releases
  and reloads gets the default back. Remembering it is `localStorage` and a key to get wrong, for a
  page nobody visits twice in a session.
- **It does not rewrite the 69 existing lines' copy.** The confusion is in how the page draws them.
