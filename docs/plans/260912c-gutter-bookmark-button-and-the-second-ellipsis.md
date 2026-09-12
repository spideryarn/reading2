# The gutter's bookmark button, and the "…" inside its own menu

**Status:** planned 2026-09-12. Two feedback reports, one control.

From an iPad in production, build `607b57a0`, on
`/read/entropy-24-00930-spya-bmvfyb?at=spya-hnr33h&mode=summary&remember=quiz&deep=2`.

[SPIDERYARN-READING2-38](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-38), a problem:

> When I click on a really small block, or hover over a small block, there's just the three dots
> icon. And if I click on that, it reveals the extra icons like the permalink and the comment and the
> question mark. All of that's fine. The only issue I notice is when I click on the three dots, it
> actually includes three dots within the menu that expands out, and I don't think that's right. It's
> like three dots, click on that, and then it has yet more three dots, but I don't know what that
> does. I don't think it does anything.
>
> — Greg, 2026-09-12

[SPIDERYARN-READING2-37](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-37), a suggestion:

> Next to each block, there's three icons at the moment by default. There's a permalink, like a
> comment, and a question mark. Great. And then there's a sort of three dots that reveals them if
> it's a really small block. All of that's fine. The issue is I thought we were going to add a sort
> of bookmark icon as well, sort of a fourth one, so you could just say, that would just somehow,
> yeah, bookmark that block as being really interesting. I thought maybe it was going to be
> represented as an empty comment, but I'm not seeing that bookmark icon as the fourth.
>
> — Greg, 2026-09-12

(His "comment" in the first sentence is the chat button — the speech bubble.)

## References

- [`src/web/BlockGutter.tsx`](../../src/web/BlockGutter.tsx) — the column; source order is the
  priority order.
- [`src/web/styles/gutter.css`](../../src/web/styles/gutter.css) § the gutter, § What "…" opens.
- [260905c](260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md) — where the "…" came
  from, and Greg's priority order for what folds away first.
- [260908e](260908e-gutter-icons-on-touch-only-when-a-block-is-selected.md) — the touch gate.
- [comments.md](../project/comments.md) — a comment *is* a bookmark; the five store operations.
- [260828a](260828a-comments-and-bookmarks.md) — the plan that made a bookmark free.
- `ChatAnchor` in [`src/types.ts`](../../src/types.ts) — the whole-block anchor chat already has.

## 38: what the second "…" is

**It is the same button.** The "…" is the last child of `.blk-gutter`, and the rule that unfolds the
column is

```css
.blk-gutter[data-open] > * { display: inline-flex; opacity: 1; pointer-events: auto; }
```

— every child, the "…" included. So the open panel is the controls plus, at its foot, the button
that opened it. It does do something: it toggles the panel shut, and its `title` says "Fewer". But a
`title` never shows on a finger, the glyph is still three dots, and on an iPad the panel also closes
on any press outside it — so the one thing the second "…" does is the thing every other part of the
screen already does, under an icon that says *more*.

Reproduced by reading, not by guessing: the rule is gutter.css § What "…" opens, and
`tests/block-gutter.test.tsx` § the "…" clicks the same element twice to open and close, which is
only possible because it is still drawn.

**Fix: the open column does not draw its own "…".** One rule,
`.blk-gutter[data-open] > .blk-more { display: none; }`, written after the container-query rules
so it wins at equal specificity.

What that costs, and why it is acceptable:

- **A keyboard reader loses the in-panel toggle.** They keep Escape (which already returns focus to
  the "…"), choosing any control (which already closes it), and a press elsewhere. Opening from the
  keyboard already moves focus to the head of the column, so nobody is left focused on the hidden
  button that way.
- **A mouse press leaves focus on a button that then disappears.** Chrome's focus fixup drops it to
  `body`; Escape still works because its listener is on `document`. This is the pointer path, where
  the focus ring is not shown anyway.

**Passed over: turn the second "…" into an ✕.** It keeps a textbook disclosure (the toggle never
leaves), and it is a fifth icon in a column whose whole job is to be small, duplicating three ways
to close that already exist. Greg's words were *"I don't think that's right"* about the dots being
there at all.

## 37: does bookmarking exist?

**Yes, but not where he looked, and not in one press.** Selecting text opens the comment box, and
saving it empty is a bare bookmark — comments.md § What a comment is now. The gutter then shows a
`Bookmark` in `--highlight` beside that paragraph. What has never existed is **a button that
bookmarks the block**: every bookmark today is a selection first. So this is a small feature, not a
missing icon.

### The design question: what does a bookmark on a whole paragraph anchor to?

A comment's anchor is `blockId + quote + start`, all three required, and `quote` is what draws the
underline in the prose. Three ways to give a gutter press something to store:

| | what gets stored | what the reader sees | cost |
|---|---|---|---|
| **A. The whole paragraph as the quote** | an ordinary comment, `quote` = the block's rendered text, `start` 0 | every word of the paragraph underlined, with a ✳ at the end; **any tap inside it opens the note**; a paragraph over 2000 characters is refused by `MAX_QUOTE_CHARS` | no schema change |
| **B. A comment with no quote** — the whole-block anchor | `blockId` alone, exactly as `ChatAnchor`'s `{ blockId }` arm already does for conversations | the gutter mark and nothing in the prose — the same way a whole-block conversation shows only its gutter chip | a migration (two columns become nullable, one check), a union type, and about ten call sites the compiler finds |
| **C. The button opens the comment box on the whole paragraph** | as A, after a second press | as A | no schema change, and not what was asked — *"just say … bookmark that block"* |

**B is the plan.** A looks free and is not: on an iPad a tap on a paragraph is how a reader selects
the block (260908e), and under A every tap on a bookmarked paragraph would open a dialog instead —
the bookmark would make the paragraph harder to use. It also underlines prose the reader never
chose, which is the thing a mark is supposed to prove they did. And the precedent is already in the
codebase: a whole-block conversation is `{ blockId }` with no quote, draws no mark, and is shown by
the gutter chip alone. A whole-block bookmark should be the same shape for the same reason.

A sizing experiment settled that B is an afternoon, not a week: making `quote`/`start` optional on
`Comment` gives 21 type errors across ten sites — `dto.ts`, `referee-mirror.ts`, one line of the
legacy answer route, `TableView`'s `anchorKey`/`resolveAnchors`, `comment-nav`'s ordering,
`Reader`'s follow-up handoff, and a test seed. The compiler undercounts in one known way: JSX renders
`{comment.quote}` happily when it is `undefined`, so `CommentDialog`'s blockquote and the Dock
drawer's list need finding by hand, and they are named below.

## What gets built

### Stage 1 — the second "…" (38)

- `gutter.css`: `.blk-gutter[data-open] > .blk-more { display: none; }`, after the open rule, with
  the reason beside it.
- `tests/gutter-target-size.test.ts`: asserts the rule exists and sits after `.blk-gutter[data-open]
  > *` (red first).
- `BlockGutter.tsx`: the comment on the "…" says the open column does not draw it.
- A browser check on a one-line paragraph, iPad-sized, touch: open the "…", and count the controls
  in the panel.

### Stage 2 — the whole-block bookmark (37)

**Data.**

- `Comment`'s anchor becomes a union — `{ quote: string; start: number }` or neither — so "a quote
  with no offset" is not a value, the same argument `ChatAnchor` makes.
- Migration: `comments.quote` and `comments.start` drop `NOT NULL`; a check that they are null
  together; a check that a quote-less comment is `status = 'none'` (a whole-block bookmark was never
  a question, and the legacy answer path must not be able to reach one). Additive — no existing row
  changes. Generated with `drizzle-kit generate`.
- `pg-comments.ts`: row ↔ comment for the null pair; `create`'s same-id comparison treats two absent
  quotes as equal. `linkThread`'s anchor comparison is unreachable for these (a whole-block bookmark
  is made with no chat) but gets the same null-safe comparison.
- `POST /api/comments/:slug`: a body with no `quote` and no `start` is a whole-block bookmark; one
  with only one of them is a 400. `blockId` is still checked against the article.
- The public projection and `PublicComment`: the pair is optional there too. The SQL predicate is
  unchanged — a whole-block bookmark is `status none`, which the public read already allows.
- The export carries whatever the row has; the field list in export.md gets the absent case.

**Consumers.**

- `TableView` `anchorKey` / `resolveAnchors`: a quote-less comment draws no mark (and still counts in
  `commentsByBlock`, which groups on `blockId` alone — that is the whole point).
- `comment-nav` `orderComments`: a whole-block comment sorts **first** within its block (it is about
  the paragraph, so it comes before anything about part of it).
- `CommentDialog`: where the blockquote was, a line saying it is the whole paragraph, with the
  paragraph's opening words from the block so the reader can tell which one.
- The Dock drawer's list: the same.
- `Reader`'s follow-up handoff: a whole-block comment hands chat `{ blockId }`, the arm that already
  exists.
- `referee-mirror`: a whole-block comment with words on it is placed at the start of its block with
  the block's text as the passage (clipped as now); a bare one is a skipped bookmark as now.

**The button.**

- A new optional `onBookmark(id)` on `BlockGutter` — the callback is the capability, as with
  `onChatAbout` and `onHelp`, so a visitor gets none.
- **Drawn only where the block has no comment.** Where it has one, the existing mark is the state
  and pressing it opens the note, which is where un-bookmarking (delete) already lives. So a
  paragraph has *either* the affordance *or* the mark in it, never both, and `data-controls` still
  counts at most four for an owner.
- **Its place in the column is third, after the permalink and the chat door, before the "?"** —
  Greg's priority order from 260905c: *"always permalink and chat; the '?' and the mark are the ones
  that may be folded away."* When the press lands, the affordance goes and the mark appears at the
  head of the column, which is where state lives; the move is the feedback.
- Hidden at rest and revealed on hover / the touch-selected row, like the other affordances: it is a
  button, not state.
- One press: `comments.create({ id, blockId })` — optimistic, free, no dialog. Announced in the live
  region ("Bookmarked this paragraph"). The column closes if it was open.
- An outlined `Bookmark` in the affordance grey; the mark keeps `--highlight`.

**Docs.** comments.md § What a comment is now gains the whole-block anchor; gutter.css and
BlockGutter.tsx headers list five things in the column.

## Deferred

- **Bookmarking a paragraph that already carries a selection comment.** The mark is already there
  and opens the notes; a second, whole-block bookmark beside it would need the mark to say which.
  Not asked for.
- **A visual difference between a bare bookmark and a comment with words** — comments.md has carried
  this as an open question since 260828a.
- **An in-panel way to close the column other than Escape and a press elsewhere**, if a keyboard
  reader turns out to want one.
- **On a desktop, a one-line row's mark is two clicks from its note.** The gutter sits inside the
  row, so pointing at the mark hovers the row, and the hover reveals the "…" over the mark: the click
  opens the column, and the mark at its head opens the note. Found by the third browser pass after
  stage 2b. **Not a regression** — before 2b the mark was folded behind the "…" on every one-line row
  at all times, so the note was already two clicks away and the bookmark invisible besides — and a
  finger is unaffected, because a tap on the mark does not select the row. The option the pass
  suggested, revealing the "…" on the prose's hover but keeping the mark while the pointer is on the
  gutter, needs a way to reach the "…" by mouse that does not exist yet.
- **Focus after choosing a folded control from the keyboard.** GPT Sol's stage 1 review, P2, and
  older than this change: a keyboard reader who opens the column and activates a control the row
  normally folds away — the permalink, which opens nothing — has the column close under them, the
  control go back to `display: none`, and the focus fall to `body`. The controls that open a dialog
  move focus there and are unaffected. Fix when someone touches the disclosure's focus handling:
  on close, send focus to the "…" if the focused element is no longer drawn.

## What the plan review changed

GPT Sol, [260912c-gutter-bookmark-plan-review-sol.md](260912c-gutter-bookmark-plan-review-sol.md):
**B is the right product choice over A**, and the slot arithmetic is coherent. No P0; four P1s, all
taken:

1. **The union must be strict** — the block arm is `{ quote?: never; start?: never }`, not
   `ChatAnchor`'s looser `{ blockId }`, and `ClientComment`/`Placement` become intersections because
   an interface cannot extend a union. `PublicComment` takes the same anchor.
2. **The button must wait for the opening read.** Before the list lands every paragraph looks
   unmarked, so a press could be erased by the arriving list, or duplicate a note nobody had fetched.
   Reader withholds `onBookmark` until `loaded && loadError === null` — the gate `AnnotateDialog`'s
   Save already has, for the same race.
3. **An old open tab crashes on a quote-less row** (`TableView`'s `c.quote.length`), and an iPad
   home-screen tab can stay on old code for days — Greg's own iPad seeing a bookmark made on the
   laptop is the realistic case. So the owner's `GET /api/comments/:slug` sends whole-block rows only
   when the client asks (`?anchors=whole-block`); the new client asks. **Not done for the public
   read**: a visitor's page brings its comments in its own payload on load, so an old visitor tab
   only meets one by navigating inside an already-open shared page. Accepted, and named here.
4. **The consumer list was incomplete** — the seeder, the route test that called `{ blockId }`
   invalid, the public DTO key set, both export formats. All handled; the downloadable bundle keeps
   raw rows, so a whole-block bookmark there has `quote` and `start` null, and its README says so.

Two P2s taken: the dialog and drawer show *Whole paragraph —* and the opening words, with a line for
a paragraph that has gone (`passageOf`); and **the "…" becomes an ✕ while open rather than being
hidden** — hiding took the disclosure and its `aria-expanded` out of the accessibility tree and left
the focus to Chrome's fix-up on an iPad that runs Safari. That reverses stage 1's `display: none`,
and § 38's "passed over" paragraph above is now the choice. The P2 against widening `linkThread` was
already true: it is unchanged.

## Stage 2 — built and reviewed

GPT Sol, [260912c-gutter-bookmark-stage2-review-sol.md](260912c-gutter-bookmark-stage2-review-sol.md):
no P0. Its P1 was that a press whose response was lost minted a *new* id on the next press, so a row
the server had stored could be joined by a second: it added
[`block-bookmark.ts`](../../src/web/block-bookmark.ts), which keeps one id per block until a write is
confirmed and folds two presses in flight into one. Three P2s — the failure announcement now says
"not confirmed" rather than claiming it failed, the request-trace test learned the new comments URL, and
direct witnesses for the database constraints, the public mapping, both export shapes, the dialog and
drawer JSX and the mirror. Its sandbox could not reach the database; those files were run outside it:
14 files, 532 tests, green.

**The browser pass found one thing no test could**, at iPad and desktop widths: every other point
passed — the ✕, the order, the store, no underline, the drawer and dialog, persistence, delete — but
**a bookmark on a one-line paragraph was invisible at rest.** A one-line row has one slot, the "…"
takes it and folds the mark behind it, and the "…" itself only shows on a hovered or selected row. The
file had accepted that for the rare orphaned note, whose words are also gone from the prose; a
whole-paragraph bookmark underlines nothing, so on a one-line paragraph pressing the button made it
vanish with nothing in its place — which is the very kind of block Greg was on.

**Stage 2b: the mark and the "…" share the slot.** gutter.css § One slot and a mark: on a one-slot row
only (a negated container query, so no rule is undone on a taller one), a marked gutter shows the mark
at rest with the "…" in the same cell on top, invisible and not taking presses until it is revealed —
then the mark gives way. Nothing is `display: none`, which is what sank the 2026-09-05 version of this,
so both stay reachable by keyboard and finger. Reviewed separately:
[260912c-gutter-bookmark-stage2b-review-sol.md](260912c-gutter-bookmark-stage2b-review-sol.md) — no
P0; it fixed a P1 in place (with a mouse resting over the row, Tab to the mark left the focus on an
invisible element, because the hover rule outranked `.blk-cmt:focus-visible` and the "…" painted over
it — the hover prefix is `:where()`-wrapped now, and a focused mark switches the "…" above it off) and
a P2 (the focused "…" patched `--page` over an opaque row's `--muted`). Its one wider P2 is the
deferred focus-after-a-folded-control item above.

**And a browser recheck found what neither review could: paint order.** On touch every point passed;
on a desktop hover a real click on the visible "…" opened the *note*. An element with an opacity below
1 is painted above its ordinary neighbours, so the mark at 0 was painted over the "…" at 1 and took
the press — and a focused "…" had the mark at 0.75 showing through its patch. Touch passed only
because the "…" is 0.705 there. The subagent confirmed the cause by changing inline styles rather
than by reasoning about them: `pointer-events: none` on the mark, `position: relative` on the "…",
or the "…" at 0.99 each moved the element under the pointer. The fix is the second and the first
together — the "…" is `position: relative; z-index: 1` in the shared cell, and both rules that hide
the mark take its `pointer-events` with its opacity. **This is the class worth remembering**: a
stacking rule argued from source order is only true until something in the pair drops below opacity 1,
and no stylesheet test can see it — only a real pointer in a real browser.

## Stage 1 — built and reviewed

GPT Sol, [260912c-gutter-bookmark-stage1-review-sol.md](260912c-gutter-bookmark-stage1-review-sol.md):
no P0 or P1. It fixed two P2s in place — the ordering test now checks that the hide rule is the last
`display` decision on `.blk-more` across every reader stylesheet rather than after one named query,
and the component comment stopped implying assistive technology can reach a `display: none` button —
and raised the focus P2 above, which predates this and is deferred. 65 gutter tests, typecheck
green.

## Gates

`npm test`, `npm run typecheck`, `npm run lint` on touched files, a GPT Sol code review after each
stage, and a browser pass on the gutter at iPad width for both.
