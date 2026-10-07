# UI sweep K3: the shelf's passage filter, and copy that is false

Cluster K3 of [the UI sweep umbrella](261007a-ui-sweep-umbrella.md#k3-the-shelfs-passage-filter-and-copy-that-is-false),
which is the plan and was reviewed there. This doc records what landed, what the umbrella got
wrong, and what was left. The filter's rule now lives in
[library.md § Finding an article, and finding a passage in one](../project/library.md#finding-an-article-and-finding-a-passage-in-one).

## What landed

### The passages obey the topics and the tags

`Library.tsx` handed `Passages` only the Unread chip's slugs, so with a topic or a tag chosen the
passage list named articles the cards above it had just left out. The allowed slugs are now
`narrowShelf(scope, { query: "", unread, topics: chosenSets })` (`passagesIn`), and `null` when
nothing narrows. Not the slugs of `rows`: those have the search box's match on a card's title,
author and blurb applied, and would hide the passage of an article inside the topic whose body
matches and whose card does not. `ShelfSearchAlso`, the archived tallies and `ShelfPublicSection`
are untouched.

Two sentences changed with it, because "already opened" is false of an article a topic left out:

| When | Before | After |
|---|---|---|
| some passages left out, Unread alone | *N more passages are in articles you have already opened.* | unchanged |
| some left out, a topic or tag chosen | (the passages were listed) | *N more passages are in articles that do not match everything chosen above.* |
| every passage left out, Unread alone | *Nothing in an unopened article's text matches "q".* | *None of the passages found for "q" is in an unopened article.* |
| every passage left out, a topic or tag chosen | (the passages were listed) | *None of the passages found for "q" is in an article that matches everything chosen above.* |

"Everything chosen above" is `nothingLeft`'s phrase for the same filters. The third row is a change
the umbrella did not ask for by name: the server caps the hits before the browser filters them, so
"nothing in an unopened article's text matches" claimed more than the page can know. The new
sentences are about the passages found, which is what the page holds.

Red first: `tests/shelf-passages-obey-the-filters.test.tsx` mounts the shelf over a mocked network
with "zibble" in the body of three articles and on the card of none. Before the fix, with a topic
or a tag chosen, the list named all three articles (expected one). Mutation: deriving the set with
the query applied (the `rows` version) turns three of its five cases red.

### Copy

| Where | Before | After | Why |
|---|---|---|---|
| Learn band's accessible name (`ChatPanel.tsx`), and the example in `ModeSurface.tsx`'s comment | Remember what you took from this article | Recall what you took from this article | The mode was Remember until 2026-10-05; the part is Recall. The siblings name their part the same way: "A tutorial on this article", "Explore what you think about this article" |
| Admin home (`AdminPage.tsx`) | Only Gift vouchers can change anything, and only a voucher. | Two of them can also change something: Gift vouchers makes and edits vouchers, and Feedback can mark a report as ignored. | Feedback's Ignore and Undo write `feedback.ignored_at` (`useAdminFeedback.ts`), since 2026-10-03 |
| Shelf card's details, "Built" with none of the three (`ShelfEntry.tsx`) | nothing beyond the tree | no arc, thread or glossary | `LibraryEntry.has` carries three flags; an article with summaries or quotes made the old line false. The projection is not widened (umbrella U10) |
| Public-sharing page | at the finest level of zoom the reader is looking at the extracted passage itself | the article a reader reads is the extracted passage itself | the zoom went with the gist columns on 2026-09-29 |
| `/opensource` | the pipeline that turns an article into something you can zoom around | the pipeline that turns an article into its table of contents and reading aids | the same |
| `SHARED_LINK_CARRIES` (`src/messages.ts`; drawn once, on a shared article's Metadata page, `PublicPages.tsx`) | the article, its table of contents, every zoom level, and the reading aids | the article, its table of contents, and the reading aids | the same. The rest of the sentence was checked against `NOUN` (`visitor.ts`) and `public-reader.ts` and is true: the list is introduced with "including", and marks, notes and saved searches are selected by the public reader |
| Citations' and FAQ's `runningLabel` | Reading… | Finding… | Both buttons say "Find the citations" / "Find the questions" and "Find them again" in the same component. `runningLabel` is `JobProgress`'s fallback for the moment between two named steps. Timeline keeps "Reading…": its button says "Read the timeline" |

No test or `/help` sentence named an old string, except the literal in
`tests/mode-surface-changes-no-markup.test.tsx`, which moved with the label.
`tests/public-readable-sharing-page.test.tsx` now refuses "zoom" in the page and the constant, and
`tests/find-buttons-say-finding.test.ts` holds the two labels to their buttons (mutated: red).

### `ShelfEntry.tsx`

- **The "details" trigger's focus mark.** `outline-none` and a colour change became a 2px outline
  in `--highlight-text` at 2px offset, with the colour change kept. `outline-none` had to go, not
  be overridden: in Tailwind v4 it sets `--tw-outline-style: none`, which `focus-visible:outline-2`
  then reads. The card's `focus-within` border is 1px in the same colour and the trigger sits well
  inside it, so the two read as "in this card" and "here"; measured below.
- **The rebuild failure sentence.** Three things reach that catch: `fetchOk`'s `HttpError` with the
  server's own sentence, a request that never arrived (the browser's words: "Failed to fetch",
  "Load failed"), and anything unexpected. `describeFetchFailure` now chooses, after the same
  "Couldn't queue a rebuild:". The server-refusal case reads exactly as before. Red first, two
  cases in `tests/refused-writes-are-reported.test.tsx`.

### The counts beside each topic

`opacity-70` on the count is gone, so it is drawn at the chip's own ink. The same class was on the
tag chips' count in `ShelfTagFilter.tsx`, on the same `chipClass`, and went with it.

### `ShelfTags.tsx`: a composing Escape

Handed over from K2 (it is in no cluster's manifest). With the suggestion list hidden, an Escape an
input method was using closed the tag popover and dropped the half-typed tag: Radix hears Escape on
the document before `TagEditor` can. One `isImeComposing` check at the top of `onEscapeKeyDown`.
Red first, in `tests/shelf-tags-popover.test.tsx`.

## Measured in the browser

Headless Chrome through Playwright, this worktree's own dev server, signed in as the seeded
administrator, 1440 wide. Scripts: the session scratchpad's `k3-browser.mts` and `k3-browser2.mts`.

| What | Before | After |
|---|---|---|
| Topic count, light, 12px (`oklch(0.48 0 0)` on the page) | 3.22:1 at opacity 0.7 | 6.31:1 at opacity 1 |
| Topic count, dark, 12px (`oklch(0.63 0 0)`) | 3.29:1 at opacity 0.7 | 5.66:1 at opacity 1 |
| "details" trigger after a real Tab, light | outline `none`; ink `--highlight-text` | `solid 2px` `--highlight-text`, offset 2px; ink unchanged |
| the same, dark | outline `none` | `solid 2px rgb(219, 138, 69)`, offset 2px |
| the card around it while focused | 1px border in `--highlight-text` | the same; the trigger and its mark are more than 4px inside the card on every side, and the card does not clip (`overflow: visible`) |

All twelve counts on the collapsed row read the same in each theme. **The tag chips' count was not
measured**: the seeded shelf has no tags and the check may not add one. It is the same class on the
same chip.

The passage list, with a topic chosen through the address bar and "however" in the box (no card
matches that word, so every listed passage is the case the `rows` version would have hidden):

| Topic | Members | Passages listed | In articles | Outside the topic | Line under the list |
|---|---|---|---|---|---|
| social science | 30 | 1 | 1 | 0 | 29 more passages are in articles that do not match everything chosen above. |
| ai | 24 | 13 | 5 | 0 | 17 more … |
| history of science | 23 | 1 | 1 | 0 | 29 more … |
| cognitive science | 16 | 12 | 6 | 0 | 18 more … |
| personal growth | 15 | 2 | 2 | 0 | 28 more … |
| entrepreneurship | 11 | 1 | 1 | 0 | 29 more … |

The browser "before" for the list was not taken: the fix was already being served when the first
run was made. The red is the unit test's.

Sentences read on screen after the change: `/admin`, `/opensource`,
`/features/public-readable-sharing`, and the details card of an article with none of the three
flags ("Built no arc, thread or glossary"). Not read on screen: the Learn band's accessible name,
`SHARED_LINK_CARRIES` (needs a shared article opened signed out), and the two "Finding…" labels
(shown only while a paid job runs).

## What the umbrella got wrong

- **The topic counts are not in `ShelfTerms.tsx`.** The count is drawn by `TermChip` in
  `ShelfTermChip.tsx`, which is in no manifest; `ShelfTerms.tsx` was not edited.
- **The counts are not `--ink-faint`, and the dark theme fails too.** The ink is the chip's
  `--muted-foreground`; at 70% it measured 3.29:1 in the dark theme, also under the bar. The
  umbrella names only the light theme.
- **"A Sonnet browser check sees the passage list obey a topic and a tag."** A topic, yes. No
  article on the seeded shelf has a tag, and the check may not add one; the tag case is the unit
  test's.

## Left, and why

- **`SHARED_WITH_YOU` in `src/messages.ts`** still ends "at every zoom level". Nothing imports it,
  so no reader sees it; it is a dead constant, not false copy on screen. Not in K3's manifest.
- **`ShelfSearchAlso` and `ShelfPublicSection` are told `narrowedElsewhere` for Unread and topics,
  not for tags.** Kept scoped as the umbrella says; whether a chosen tag should count there is the
  same question and was not looked into.
- **Two comments still call `/admin/vouchers` "the one admin page that writes"**
  (`AdminVouchersPage.tsx`, `tests/admin-only-routes.test.tsx`), and so does a heading in
  `admin.md`, whose text below it already names Ignore as the other. Outside the manifest.
- **The details card's "Built" line still lists only three kinds when some are built** ("arc ·
  thread"). True as far as it goes; the table's row card says the same (`library-columns.tsx`).

## Review status

*(filled in after GPT Sol's code review)*
