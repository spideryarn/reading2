# Metadata: more sections shut by default, and Archive and Share near the top

A suggestion from Greg (admin) on `/read/<slug>/metadata`, 2026-09-30:

> In the metadata mode, I think we can have more of the sections be default collapsed, like
> authors, export, delete. I think perhaps we could add a button to archive near the top because
> that's going to be quite a common action, and also a button to publicly share. Although I guess
> if you click that, it'll probably have to take you to the section for public sharing because that
> has its own kind of confirmation tick box. But I think the archive button, because it's
> reversible, I guess in an ideal world archiving it, well, just says, okay, it's archived, but you
> could carry on reading, I guess, so it doesn't need to kick you out of the article itself.
>
> — SPIDERYARN-READING2-6Z

Status: **built and code-reviewed, 2026-09-30**.

## What changes

### 1. Three more sections shut by default

**Authors**, **Export** and **Delete this article** become `collapsible` in `Section`
(src/web/Metadata.tsx), the same disclosure *Technical details* and *Re-run AI processing* already
use. Nothing else moves; the page order test keeps pinning the order.

- **Authors** keeps its count on the heading (`aside`), so a shut section still says how many.
- **Export** and **Delete** use `keepMounted`, so a half-finished Delete confirm or an Export in
  flight survives the reader shutting the section, and its `role="alert"` error is not unmounted
  with it. Shut hides them with `hidden`, which is what *Re-run* already does.
- Only the three he named. "like" could stretch further (*What it cost*, *Your reading*), but those
  weren't named, and *What it cost* only arrived this morning, at his own request.

**Is a shut Delete a weaker defence?** No. The confirm step inside it is unchanged, and shutting
it adds a click in front of the irreversible act. It is not on
[security-map.md](../project/security-map.md) § Where the defences physically live either way.

### 2. An action row under the title: Archive, and Share…

A row of two quiet buttons between the identity block (title, facts line, `Origin`) and *In one
sentence*:

```
Temporal context reinstatement  ✎
Jane Doe · example.org · fetched 3 days ago
[ ▣ Archive ]  [ ↗ Share… ]
```

**Archive** is the same act as the section at the foot of the page, not a second one.
`ArchiveArticle`'s state (`acted`, `busy`, `error`, and the `set` that PATCHes and re-reads on
failure) moves up into a `useArchive(...)` hook in `Metadata`, and both the top
button and the bottom section read and write that one state. Pressing either flips both. The
alternative was two independent copies of the state, which could disagree on one screen: the top
saying *Archive* while the bottom says *Put back*.

Once archived, the top row says so and stays where it is:

```
Archived just now — you can carry on reading.   [ ↶ Put back ]  [ ↗ Share… ]
```

Nothing navigates. An archived article is already readable by direct link and the reading view
keeps working ([library.md](../project/library.md) § An archived article is still readable by
direct link), so "doesn't need to kick you out" is already true. The row only has to say it.

The rules `ArchiveArticle` already follows carry over to the top button unchanged, because it is
the same state:

- no button while `at` is unknown (in flight, failed, or lost after a failed write). The top row
  simply leaves Archive out. The bottom section still carries the explanation;
- no button on the fixture (`showingFixture`);
- one `<button>` element across the two labels, so focus survives the press;
- the box icon, never a bin; never the destructive tint.

**One live region, not two.** The bottom section's `role="status"` "Archived …" line and its
`role="alert"` error stay where they are. The top row repeats both as plain text, so a reader who
pressed the top button sees the result beside it, but a screen reader hears each fact once. Both
copies read from the one state.

**Share…** does not share. It scrolls to *Access & sharing* and moves focus to that section's
heading (changed at review — see below). That card keeps its confirmation panel and rights
tick-box exactly as they are, and they are the only path to `PUT …/visibility`. Hidden where the sharing card is hidden (`showingFixture`). The ellipsis and
the tooltip say it goes somewhere: *"Takes you to Access & sharing below, which asks before
anything goes public."*

**Passed over: a Share that opens the confirmation in place, at the top.** It would mean a second
mount of `AccessSharing`, or lifting its four-state card up the same way as Archive. That's a lot
of rework on the one irreversible control on the page, for a click Greg himself expected to land
in the section.

**Not a URL change.** Scrolling doesn't write `#sec-access-sharing` into the address bar. Section
state here is deliberately not URL state (`Section`'s own comment says why).

## Tests

In `tests/metadata-page-order.test.tsx`, beside the existing Archive tests:

- Authors, Export and Delete headings are `aria-expanded="false"` on first render, and opening
  each one shows its content. Red first: they are open today.
- The top Archive button PATCHes `{ archived: true }`. Afterwards the top reads *Put back* and
  says *carry on reading*, the bottom section's button also reads *Put back*, and no navigation
  happened (`location.pathname` unchanged).
- No top Archive while the metadata request is unresolved or failed.
- Share… sends no request of any kind and moves focus inside `#sec-access-sharing`.

The existing Export and Delete suites find their buttons by text. With `keepMounted`, their
elements are still in the DOM, so they keep passing; the new shut-state test is what proves the
sections are actually shut.

## Plan review (GPT Sol, 2026-09-30) and what changed because of it

[The review](260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top-plan-review-sol.md)
said *build with changes*: four P1s and one P2. All five checked out against the code.

1. **A failed refresh left Archive offered from a stale read.** `readProvenance` keeps the old
   `provenance` when a revalidation fails, so `archivedAt` alone was not *unknown*. Fixed:
   `useArchive(slug, archivedAt, answered, failed)` reads a validated server answer, unless a
   later successful act has superseded it. This also changes the section at the foot, which had
   the same hole before this work. The pin is an
   extra assertion on the existing refresh-failure case in `tests/metadata-delete-permanently.test.tsx`,
   seen red with the rule removed.
2. **"Focus the first control" was wrong about the code.** On a public article the first focusable
   is the link box, not *Stop sharing*. Now Share… focuses the section's heading (`Section`'s new
   `landing` prop, `tabIndex={-1}`), looked up through `body` rather than `document`.
3. **`keepMounted` did break the Delete suite**, which assumed the card was the section's direct
   child. Its helpers now go through the `hidden` wrapper. Its `open()`, and the Export suite's,
   now also press the heading, because a `.click()` reaches a button inside `hidden` as well.
4. **Tests for the reverse and failure paths**: bottom → top, Put back from an archived start,
   PATCH-fails-re-read-succeeds, both fail, one PATCH while pending, the fixture, and Share… sending
   nothing and opening no confirmation.
5. (P2) **An alert inside `hidden` is not announced.** Accepted and said in the code: an Export or
   Delete error that arrives after the reader has shut the section is heard when they reopen it.

## Code review (GPT Sol, 2026-09-30)

**Approve after changes.** Four findings were fixed in the scoped files:

- P1: two Archive controls could both dispatch before React painted `disabled`, sending two PATCHes.
  The hook now has a synchronous in-flight guard, with a same-turn two-button test.
- P1: `readJson<T>` is only a cast, so malformed metadata or a malformed successful PATCH could be
  treated as a known archive state. Archive dates and the PATCH envelope are now checked; an unreadable
  answer removes both controls, and a bad write answer takes the existing fresh-read path.
- P2: Share… focused the right heading but that heading explicitly suppressed its only focus outline.
  The native outline remains, and the test pins both the focused element and the absence of outline
  suppression.
- P2: the tests proved the three sections were shut, but not why Export and Delete use `keepMounted`.
  They now shut and reopen a half-finished Delete confirmation and shut an Export while its request is
  in flight, proving both child trees survive under `hidden`.

Checked after the review: the real metadata route always sends `archivedAt` (`?? null`,
src/store/pg.ts), so the stricter reading cannot hide the buttons from a normal answer.

## Evidence

- `npm run typecheck` exit 0. The metadata suites plus `tests/feedback-endings.test.ts` pass: 11
  files, 221 tests, after the review's fixes.
- Mutations seen red before the review: dropping `failed` from `useArchive`, dropping
  `collapsible` from Export, and focusing the first button instead of the heading.
- The full suite (before the review's fixes) had 4 failures in 5 files. All five are build-artefact
  files that are red in any fresh worktree: `cold-start-lazy-imports`, `pdf-bundle-trace`, and
  three `fleet-*`. None of them touches Metadata.
- A browser pass (Playwright, local dev, Sonnet subagent) confirmed three things. The top Archive
  flips both controls without navigating. Share… lands on the heading with no confirmation open.
  There is no overflow at 390px. Screenshots: `260930h-shot-top-desktop.png`,
  `260930h-shot-top-phone.png`. It could not check Authors, because no local article has an
  author list; the unit test covers that.
- Landed on `dev`, not deployed.

## Deferred

- Collapsing further sections: none named beyond the three.
- A top Share that confirms in place: see *Passed over*.
- Showing *Shared* versus *Share…* on the top button. The card's state lives inside
  `AccessSharing` and changes after a publish. Showing it at the top would mean lifting that state
  up, as with Archive.
