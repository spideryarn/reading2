# Make the metadata page legible, and put the machinery away

The Metadata page ([`src/web/Metadata.tsx`](../../src/web/Metadata.tsx),
originally [260825e](260825e-metadata-page.md)) had grown to nine sections and
about two thousand lines, and the order it drew them in was the order they had
been written in. Greg opened it on a real article on 2026-09-03 and gave six
instructions:

> - Provide a contents page for the various sections (ideally in a side-tab),
>   and clean up their display (some of them seem larger than others somehow?
> - Improve and add more explanations/tooltips, e.g. the one for "Where it came
>   from / Checked" is very confusing. Get Fable input for this.
> - Perhaps the "In one sentence" could be displayed directly underneath the
>   title.
> - It shows `temporal-context-reinstatement-spya-dhqkf9` and
>   `spideryarn.article_revisions/e7efb065-b82d-4442-af7a-148d37895171/`. I don't
>   know what these are. Give them tooltips, and maybe also hide them in a
>   section of "Technical details" (default collapsed) or something like that,
>   along with Fingerprint, etc.
> - Move Access & Sharing up.
> - Move "What we did to it" down, and maybe put that in the Technical Details.
>
> In general, try and make it easier to understand, with the more important
> stuff (for a user) more prominent, and the less important stuff less visible.

## The order it lands in

| | before | after |
|---|---|---|
| 1 | identity — title, byline, **slug, store location** | identity — title, byline |
| 2 | At a glance | **In one sentence** |
| 3 | In one sentence | At a glance |
| 4 | Where it came from *(PDF)* | **How well we read the PDF** *(PDF)* |
| 5 | What we did to it | **Access & sharing** |
| 6 | Your reading | Your reading |
| 7 | Access & sharing | Export |
| 8 | Export | **Technical details** *(shut)* |
| 9 | Not built yet | Delete this article |
| 10 | Delete this article | |

"Technical details" holds the two identifiers, the PDF fingerprint, the pipeline
stage rows that were "What we did to it", and the one-row "Not built yet" list —
which is a sentence about the stage rows and had a whole section to itself.

**The one judgment call not directly in the instructions**: Access & sharing went
*above* "Your reading", not just above the sections that used to sit between
them. "Move it up" is satisfiable either way, and Fable, asked, would have left
it below. The case for above: the sections now run *what this article is* → *where
it goes* → *your own work on it* → *the machinery*, and the page's one
irreversible control (a public link cannot be un-rung —
[`src/messages.ts`](../../src/messages.ts) § `SHARING_CANNOT_UNRING`) had been
sitting below two screenfuls of notes and file paths. Easy to swap back if Greg
disagrees; it is one JSX block.

## What "some of them seem larger than others" was

Real, and not a spacing problem. [`tailwind.css`](../../src/web/tailwind.css)
imports **preflight nowhere** — deliberately, since it would reset everything
inside `.prose`, the one place we render the article author's own HTML and cannot
enumerate the tags — and [`styles.css`](../../src/web/styles.css) has no shared
button reset either, by the same history: twenty components in it declare their
own `font: inherit`.

So a `<button>` on this page kept the UA's `font`, which in Chrome is 13.333px
Arial. `Section`'s collapsible heading *is* a button, carrying the `h2`'s
0.68rem-uppercase classes on its parent and nothing of its own — so a shut
section's heading drew half again the size of every heading beside it, in a
different typeface. Everything else on the page was subtler: `tw:text-sm` sets a
size and leaves the family alone, so Export, Delete and the dimmed rows were the
right size in the wrong face.

Fixed with one page-scoped rule rather than a global reset, because a global one
is a change to all twenty of those components at once, in a tree several agents
are working in. It sits in `app`, so it is a floor and utilities still outrank
it.

## The contents list reads the page

[`PageContents.tsx`](../../src/web/PageContents.tsx) scans for `[data-section]`
inside the page body rather than taking a list of section names.

**The simpler option passed over** was the obvious one: a `SECTIONS` array beside
the markup. Rejected because it is the near-miss pair this repo keeps walking
into — two lists of one fact, nothing keeping them in step, failing quietly when
a section is renamed. Worse here than usual, since half these sections are
conditional (no PDF section for a web page, no sharing switch on the fixture, no
"In one sentence" before the arc has run), so every one of those conditions
would have had to be written out a second time. The cost of scanning is a
`MutationObserver`, because those conditions resolve after the metadata request
lands.

"Which section am I in" is a scroll handler, not an `IntersectionObserver`: an
observer reports what is *visible*, three sections are visible at once on a tall
window, and turning that into one answer needs thresholds and tie-breaks and
still gets the bottom of the page wrong. "The last heading that has gone past
the top" is one comparison and is what a reader means.

## The copy, and what Fable found

Fable reviewed the page's wording. Taken: the "Checked" row rewritten (below),
"Address" and "Stored as" for the two identifiers, the fixture badge's pointer to
a repo file the reader has no copy of, and trims to the Read time, Blocks and
Levels tooltips. Also its point that `StageRow` led with the opaque key (`arc`,
`tweets`) and showed the *human* label only for stages that had not run — so the
readable rows were the empty ones. Now: label first, key beside it, since the key
is what `npm run <step> <slug>` takes.

Declined: moving "Transcribed by" out of the reader's view — the stage rows name
models already, and hiding it would be inconsistent rather than kind.

### "Checked" was confusing in three separate ways

- It named the **process** ("did a check run?") when the reader is asking about
  the **outcome** — can I trust these words. Now "Words we may have missed",
  stated as a shortfall, which is the direction somebody worries in. "83% of the
  words" also read as a grade; it is coverage.
- The tooltip said the number was "averaged over the pages that had one". **It is
  not an average.** `recall` is `matchedTokens / baselineTokens`
  ([`src/pdf-read.ts`](../../src/pdf-read.ts)), pooled across every scored page
  and therefore weighted by how much text each page carried. The field's own
  docstring in [`src/types.ts`](../../src/types.ts) said "Mean per-page recall"
  too — corrected in the same commit, since that is where the tooltip's error
  came from.
- "on 3 of 17 pages" was never explained, so the obvious reading is *fourteen
  pages failed*. It means fourteen pages carry no hidden text to compare against,
  so nothing could check them — findable only by reading `pagesChecked`'s
  definition.

## What the two reviews changed

**GPT Sol**, on the built code. Nothing high-severity; six findings, all acted on,
and four of them were the page making claims the stored fields do not support:

- **`pagesChecked` is not "pages that had a text layer".** `scored` in
  [`src/pdf-score.ts`](../../src/pdf-score.ts) also drops end-of-document
  reference lists, which *do* have one and are excluded because the model
  transcribes them only partly. So the tooltip's "the other N had no hidden
  text, so nothing could check them" was false, and so was the `types.ts`
  docstring I had just written to correct the *previous* error in it. Both now
  say what was compared and hedge the reason.
- **`unverified` does not mean no text at all** — `isScan` is
  `withText.length <= 1 && pages.length > 1`, so a scan may carry one text page,
  usually the digitising library's rights page.
- **An absent `recall` does not prove an old record.** A *single-page* scan is
  not classified as a scan at all (`isScan` needs more than one page), so it
  stores neither `recall` nor `unverified` and landed on "read before we started
  recording this" — a cause we cannot establish. Now "No comparison score was
  recorded".
- **"None found" fired on a rounded 100%**, so a stored recall of `0.998` —
  which is what `revistes-ub-30977` actually holds — claimed a perfect
  transcription of a document that missed words. Now `recall === 1` only, with
  "Less than 1%" underneath it.
- The contents nav's own buttons kept the UA font, because the page-scoped reset
  hangs off `.metadata-page` on `<main>` and the nav is main's *sibling* — the
  exact bug this work exists to fix, reintroduced in the component that shipped
  alongside the fix.
- The scroll-spy had the short-final-section failure its docstring claimed to
  avoid, and three test assertions were weaker than they read (one regex passed
  off `AboutYou`'s unrelated "couldn't").

**A browser pass** on the running page, which is the only thing that could
settle the typography. All eight section headings, including the collapsible
one's `<button>`, now measure `10.88px` in `"Geist Variable"` — identical, no
Arial anywhere. It also caught what no jsdom test could: **clicking a contents
entry scrolled correctly and then highlighted the entry above it.** `REACHED_PX`
had been set equal to the sections' `scroll-mt`, so a heading that came to rest a
fraction over 96px was the one section not counted as reached. It is now
strictly greater, and both constants carry a note saying they must stay that way.
Every rect in jsdom is zero, so no unit test can ever see this.

## Two things found on the way, one fixed and one reported

**Fixed:** `Section` latched shut and sealed its own error in. Seven days live,
and the comment above it described the behaviour it did not have. Written up in
[260903d](../postmortems/260903d-a-collapsible-section-latched-shut-and-sealed-the-error-in.md).

**Not fixed, and Greg's call:** `meta.quality` — the transcription checker's
specific complaints, e.g. *"Page 7: only 41 of its words appear anywhere in this
chunk's transcription"* — is written by `src/pdf-read.ts`, rendered nowhere in
the client, **and has no column in the Postgres store**: every other PDF field
(`recall`, `pagesChecked`, `unverified`, `rawSha256`) is in `articleRevisions`
and in `pg.ts`'s field map, and this one is in neither, so it does not survive
the store the app is moving to. Its docstring says *"this field is the whole of
what is left of that defence: if nobody reads it, nobody is checking"* — the
publish-time gate it used to feed was stood down on 2026-08-30. Fable proposed a
row for it here, which is the right home; building it needs a migration and
pipeline plumbing, which is a separate piece of work.
