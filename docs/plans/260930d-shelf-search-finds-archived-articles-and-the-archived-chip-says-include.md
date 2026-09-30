# Shelf search finds archived articles, and the Archived chip says "Include"

Report: SPIDERYARN-READING2-72, from Greg (admin), 2026-09-30, on `/?archived=1`. Note:
[260930_0608-shelf-search-cannot-find-an-archived-article.md](../user-feedback/260930_0608-shelf-search-cannot-find-an-archived-article.md).

> I tried searching for Wolfram, expecting to find the article on bigger brains. I was looking for it
> because I just archived it by accident, and I was trying to unarchive it. … So then I clicked the
> button archived near the search box, figuring that would include the archived articles. But it was
> very confusing the way that button worked. I couldn't tell if that button meant, when clicked,
> include both active and archived, or only include archived. And anyway, either way, it still didn't
> find the Wolfram article.
>
> — Greg, 2026-09-30

**Status:** built (one stage); code review pending.

## Root cause

The shelf's search box asks two questions ([library.md](../project/library.md),
[search.md](../project/search.md)):

1. **The cards** — `filterEntries` in `src/web/shelf-narrow.ts`, over title, byline, site name and
   blurb. With the chip on, archived entries are in the scope, so this half already reaches them.
2. **The passages** — `GET /api/library/search?q=`, full-text over every block. Its Postgres query
   has `isNull(articles.archivedAt)` unconditionally (`src/store/pg-shelf.ts`), and the client never
   says the chip is on. So archived articles are out of the passage search **whatever the chip
   says**.

Greg's article (checked read-only on production, 2026-09-30): title *"What If We Had Bigger Brains?
Imagining Minds beyond Ours"*, `byline` null, `site_name` null. "Wolfram" is on no field the card
shows, so half 1 cannot find it; eleven of its passages match `Wolfram`, and half 2 was not allowed
to look. Both halves came back empty, chip or no chip.

The class: **a scope switch that reaches one of two queries behind the same box** — the chip was
wired into the in-memory filter (260929a) and not into the server query beside it, and nothing
compared the two scopes. The 260929a doc line *"search … apply to both as one list"* was true of the
cards only.

The ambiguity is separate and real: **Unread** beside it is a *restricting* chip ("only unread"), so
an identical pill reading **Archived** reads as "only archived". It is additive.

## What we build (v1)

1. **Passage search follows the chip.** `LibrarySearchOptions` gains `includeArchived?: boolean`
   (default false, so chat's `search_library` is unchanged); the route reads `?archived=1`;
   `useLibrarySearch(query, includeArchived)` sends it and re-asks when it changes. Each `LibraryHit`
   carries `archived: boolean` (from `archived_at is not null`), and a passage from an archived
   article wears the same **Archived** mark the card does, so a hit that opens it is not a ghost.
   The rule in library.md ("an archived article is out of the index entirely") becomes "out of the
   index unless the chip is on".
2. **The chip says what it does.** Visible text **Include archived** (was *Archived*), same pill,
   same `aria-pressed`; tooltip off: *"Include archived — archived articles are hidden. Activate to
   list them too, each marked Archived."*; on: *"Include archived — archived articles are listed too,
   each marked Archived. Activate to hide them."* Accessible name still begins with the visible text.
3. **Nothing found says where else to look.** With the chip off and a query in the box, the two "no
   match" lines add *"Archived articles aren't searched — turn on Include archived."* Static text,
   no fetch.
4. **Unread with the archive in scope.** The passage filter's `only` set is built from the active
   shelf's never-opened articles; it must come from the same scope as the cards, or an unread
   archived article's passages are hidden. Build it from `scope`.

As built, (2)'s tooltips say *"list and search"*, and (3)'s line is said once, on the passages'
"nothing" line, rather than on both.

## Plan review (GPT Sol, 2026-09-30)

[plan-review-sol](260930d-shelf-search-finds-archived-articles-and-the-archived-chip-says-include-plan-review-sol.md).
It agreed with the root cause. What changed because of it:

- **Stale answers across a chip press (P1)** — the response echoes `archived`, the hook drops an
  answer for the other chip state, and `Passages` renders only when both halves of the question
  match. A test holds the active-only answer, presses the chip, then releases it; it goes red
  without the hook's check.
- **Ownership on the widened path (P1)** — `tests/owner-isolation.test.ts` searches as a stranger
  with `includeArchived: true` too.
- **Copy that said otherwise (P1)** — the Metadata page and the privacy page still said *"Show
  archived"* (stale since 260929a) and that archived articles are out of search; both say **Include
  archived** now, and the privacy page's `LAST_UPDATED` moved to 30 September. `shelf-terms.md`'s
  "passage search still covers active articles only" is corrected.
- **Important-doc gate (P1)** — not taken: `library.md` and `shelf-terms.md` are not among the seven
  entry points or `docs/reusable/`, so the before-and-after approval does not apply to them.
- **Unread while the archive loads (P2)** — deferred, below.

## Simpler option passed over

Only relabelling the chip. It fixes the confusion and not the bug: Greg would have pressed a clearer
chip and still found nothing.

## Deferred

- **Counting archived matches with the chip off** ("1 archived article matches — include it"). Needs
  the archive fetched on every search; the static line in (3) is the cheap version.
- **Showing the source's hostname when there is no site name**, and matching on it — would have let
  the card half find "Wolfram" from `writings.stephenwolfram.com`. A card-design change; not needed
  for the fix.
- **Unread while the archive is loading, or failed.** The Unread chip's passage filter is built from
  the scope, which holds only active rows until the archive list arrives — so for that moment (and
  for good, if the list fails) an unread archived article's passages count as "in articles you have
  already opened". Unread also still filters after the server's cap. Both are older shapes of the
  same filter; worth fixing if anyone meets them.

## Tests

- Store: a Postgres test that an archived article's passage is absent by default and present with
  `includeArchived`, flagged `archived: true`. Red first.
- Route: `?archived=1` reaches the store option.
- Client: the chip's visible text and names; the "not searched" line.

## Stages

One stage: build, gates, GPT Sol code review, a browser check, commit, push.
