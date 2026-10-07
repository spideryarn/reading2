# Review: K3 of the UI sweep. The shelf's passage filter, and copy that is false

Repo: this worktree (`/var/tmp/spideryarn-worktrees/agent-a68d551dd8fe8285a`), branch
`worktree-agent-a68d551dd8fe8285a`. TypeScript, ESM, React 19, Tailwind v4 (prefix `tw:`), vitest
with jsdom. Read `CLAUDE.md` § Working agreements first.

Nonce, to echo on the first line of your answer: `K3-REVIEW-c41d7e`.

## The candidate

Committed: base `c25a46a8d`, head `3aad96ec5` (one commit).

    git diff c25a46a8d...3aad96ec5
    git diff --stat c25a46a8d...3aad96ec5      # the complete list of changed paths (21 files)

Start with: `src/web/Library.tsx` (the `passagesIn` memo and the `Passages` component),
`tests/shelf-passages-obey-the-filters.test.tsx`, `src/web/ShelfEntry.tsx` and
`src/web/ShelfTags.tsx`. That is where to begin, not the limit of scope: the diff is.

Also part of the candidate, to be read as a reviewer of its conclusions and not only of the code:
`docs/plans/261007a-ui-sweep-k3-shelf-filter-and-false-copy.md` (what landed, the browser
measurements, what the umbrella got wrong, what was left) and the new paragraph in
`docs/project/library.md`. The specification is `docs/plans/261007a-ui-sweep-umbrella.md` § K3,
K3's line in its File manifest, and § What the review changed (U9, U10, U20).

## What it is meant to do

1. **The passages under the shelf's cards obey every filter the cards obey, except the search box a
   second time.** With a topic or a tag chosen, a passage from an article outside it must not be
   listed; a passage from an article inside it whose *card* does not match the query must still be
   listed. The allowed slugs are `narrowShelf(scope, { query: "", unread, topics: chosenSets })`.
   `ShelfSearchAlso`, the archived tallies and `ShelfPublicSection` keep their own scope. The server
   caps the hits before the browser filters them, so no sentence may claim that nothing matches.
2. **Seven sentences that were false become the smallest true replacement** (the table in the plan
   doc): the Learn band's accessible name, the Admin home's sentence about what can write, the
   shelf card's "Built" line when none of the three flags is set (the server projection
   `LibraryEntry.has` is not widened), three sentences that still promised zoom levels, and
   Citations' and FAQ's `runningLabel`.
3. **`ShelfEntry.tsx`**: the "details" trigger shows a visible `:focus-visible` outline in
   `--highlight-text` and keeps its colour change; a failed rebuild is reported through
   `describeFetchFailure`.
4. **The article counts beside each topic chip and tag chip** are drawn at the chip's own ink
   (the 70% opacity is gone).
5. **`ShelfTags.tsx`**: an Escape an input method is using does not close the tag popover
   (`isImeComposing`, `docs/project/keyboard.md` § A key an input method is using is not ours).

Deliberately out of scope: every `.css` file; `PageContents.tsx`; the hooks and panels K4 owns
(`useCitations.ts`, `QuotesPanel.tsx`, `GlossaryPanel.tsx`, `SearchPanel.tsx`); anything in
`CitationsPanel.tsx` and `FaqPanel.tsx` beyond the one string each (another session is editing
those files); `LibraryEntry.has` and every server projection; any prompt.

## What was measured in a browser

Headless system Chrome through Playwright, this worktree's own dev server, signed in, 1440 wide.

- Topic count, 12px: light 3.22:1 before, 6.31:1 after; dark 3.29:1 before, 5.66:1 after.
- The "details" trigger after a real Tab: outline `none` before; `solid 2px` in `--highlight-text`
  at 2px offset after, in both themes. The card's `focus-within` border is 1px in the same colour;
  the trigger and its mark sit more than 4px inside the card, which does not clip.
- With a topic chosen and "however" typed (no card matches that word): six topics tried, 1 to 13
  passages listed each, **none from an article outside the topic**, and the line under the list
  read "N more passages are in articles that do not match everything chosen above."
- Read on screen: the new sentences on `/admin`, `/opensource`,
  `/features/public-readable-sharing`, and "Built no arc, thread or glossary" on a card with none.
- Not measured: the tag chips' count (the seeded shelf has no tags and the check may not add one);
  a browser "before" for the passage list (the red is the unit test's); the two "Finding…" labels
  (only shown while a paid job runs).

## What you can and cannot run, and what you may change

You may edit this worktree. **Fix what is inside this cluster, narrowly and red-first** (the test
that reproduces the finding, seen failing, then the fix); **report, do not fix, anything wider**
(another cluster's file, a design change a reader would see beyond the list above, a server
change). Do not commit. List every file you changed at the end. Do not put a quotation attributed
to Greg in any doc.

You have no network, not even loopback: run a single test file with `npx vitest run tests/<one>`
or a script with `node --import tsx`. Do not run the whole suite. A test file that needs Postgres
will skip or fail for that reason alone; the ones this cluster touches do not.

## Attack it

Independently, before you read my suspicions below.

- Is statement 1 accurate for every combination of Unread, topics, tags, Include archived and a
  topic list that is still loading or failed? Is there a state where the passage list now shows
  less than the cards say it should, or where a line under it says something false?
- Is each of the seven replacement sentences true as written? Check each against the code that
  makes it true, not against the plan doc.
- **Does any change alter what a reader sees beyond what the plan says?** Name each one you find,
  including a class that changes layout by a pixel.
- Does any test in the diff pass for a reason other than the one it names?

For each finding give:

- an ID (`K3-F1`, `K3-F2`, …), a severity, and whether it is established or reasoned
- (a) what shows it fails its own claim: the input or mutation I can run
- (b) the smallest change that closes it

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it. End with one verdict line:
ready / ready with these fixes / not ready.

## My own suspicions (read last)

These are already my doubts, so confirming them is worth less than anything you find yourself.

- `chosenSets` is built from `members` (topics that have loaded) and the tag facets. While the
  topics are loading, `members` is empty, so `passagesIn` is `null` and the passages are briefly
  unfiltered, as the cards are. I think that is right (it matches the cards); say if not.
- The sentence for "every passage left out, Unread alone" changed from "Nothing in an unopened
  article's text matches" to "None of the passages found … is in an unopened article". The
  umbrella asked for the topic and tag sentences; I changed this one too because of the server's
  cap. Is that the smallest true replacement, or more than the plan allows?
- I removed `tw:outline-none` from the details trigger instead of overriding it, on the belief
  that Tailwind v4's `outline-none` sets `--tw-outline-style: none` and so defeats
  `focus-visible:outline-2`. The browser measurement agrees with the result; the reason is
  inferred. Does a mouse click now draw an outline it did not before?
- `tw:rounded-xs` was added to the trigger so the outline's corners are not square. That is one
  more visible change than "an outline"; say if it should go.
- `ShelfTermChip.tsx` and `ShelfTagFilter.tsx` are not in K3's manifest line (it names
  `ShelfTerms.tsx`, where the count is not drawn). I edited both, one class each. Is the tag
  chip's count really the same ink on the same surface as the topic chip's?
- In `ShelfTags.tsx` the composing Escape is `preventDefault`ed, because that is the only way to
  tell Radix not to dismiss. Could that cancel something the input method needs?
- `tests/find-buttons-say-finding.test.ts` reads source text. It was written after the change and
  then mutated (red). Is it worth its keep?
