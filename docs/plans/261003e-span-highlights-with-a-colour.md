# 261003e — Span highlights with a colour

Reports: spya-rze8qh (Greg, 2026-09-29, suggestion), spya-xhvxue (Greg, 2026-10-02). Overseer
queue: qi-pzhk52ax, qi-ashkp938.

> We currently allow sort of bookmarking blocks, but we don't allow the user to highlight sort of
> particular sections or sentences or words or whatever. […] I want to be able to drag to select a
> section, and then maybe there's a context menu that pops up and I can say highlight this and choose
> a color and perhaps add a comment to it. So I guess I'm talking about span-level comments. If this
> is complex, then just research and plan it, don't implement.
>
> — Greg, 2026-09-29 (spya-rze8qh)

> I want to be able to highlight/comment on sentences. May need discussion before implementing
>
> — Greg, 2026-10-02 (spya-xhvxue)

## What already exists, which is most of it

**Span-level comments shipped on 2026-08-28** ([comments.md](../project/comments.md)): drag over
words in the prose, let go, and `AnnotateDialog` opens: the quote, an optional note, and a box to
tick if you also want an AI answer. Saving with nothing written is a bare bookmark of those words.
It is stored as `blockId + quote + start`, so the anchor is already the block id, with the quote
second ([block-ids.md](../project/block-ids.md), [comments.md § Anchoring](../project/comments.md#anchoring)).
Overlaps are already solved: `annotateHtml` cuts text nodes at every mark boundary, so no two
`<mark>`s ever nest ([original-version/highlighting.md § Built](../project/original-version/highlighting.md)).

So the reader can already mark a sentence and comment on it. What they cannot do, and what the report
asks for:

1. **See it as a highlight.** Today a comment is a thin orange underline with a ✳. It is designed to
   be quiet (`annotations.css` § `mark.cmt`), so a page with ten of them still reads as plain
   prose, and you have to look for the underlines.
2. **Choose a colour.** There is one style for every comment.
3. **Get a light menu, not a box.** Letting go opens a dialog that takes the focus, which is already
   the cause of one complaint, about copying ([comments.md § Copying the passage](../project/comments.md#copying-the-passage)).
   "Highlight this, yellow" should be one press.

Neither report was a mistake or a duplicate: the gap is real. It is just much smaller than "build span
highlights from scratch". **No library is needed.** The anchoring, the overlap drawing, the store,
the share projection, the drawer and the margin all exist.

## The design: a highlight is a comment with a colour

Not a new kind of object. Adding a nullable `colour` to a comment makes these two the same row:

```
   the mark      always. blockId + quote + start           (exists)
   the colour    optional, one of four named colours        (new)
   the words     optional — body                            (exists)
   the answer    optional — the AI tick-box / its chat      (exists)
```

A highlight with no words is a wordless coloured comment. A highlight with a comment is the same row
with `body`. **The simpler option passed over** is a separate `highlights` table and its own drawing
path. It would duplicate the anchor, the resolver, the share projection, the drawer and the delete
flow, and two overlapping marks would then be two kinds of thing to merge. One row type with one
optional property is the house pattern: the whole-block bookmark and the referee placement were both
added that way.

### Colours

Four named colours, stored by name rather than by hex value so that the palette can be retuned for
dark mode or contrast without a migration: `yellow`, `green`, `blue`, `pink`. A CHECK constraint in
SQL and a union type in TypeScript (`HighlightColour`). Each colour gets a light-mode and a dark-mode
wash token in `styles/tokens.css`, checked against the page ground and against the existing
`--hit-wash` and gist-active washes so that a highlight never reads as a search hit
([original-version/highlighting.md](../project/original-version/highlighting.md): "don't put three
meanings on one hue"). The words keep their colour (the rule `mark.cmt` states): only the
background changes.

`colour: null` is every comment made so far and every comment made from the box without picking
one. Those keep today's underline exactly. Nothing existing changes appearance.

### Drawing

- `annotateHtml` already emits `<mark class="cmt" data-…>` per run. Add `data-colour` when the
  comment has one; the CSS paints `mark.cmt[data-colour="yellow"]` etc. with that wash.
- **Overlap of two colours:** the mark lists both comment ids already; the colour is the one of the
  comment **made most recently**. A newer highlight drawn over an older one visibly wins. The older one
  is still in the drawer and still opens. (Mixing two washes reads as a third colour nobody chose.)
- **The ✳ marks words, not highlights.** A wordless highlight draws the wash only; a highlight with a
  note keeps the ✳ on its last run, as any comment with words does. A plain uncoloured bookmark keeps
  its ✳ as today.
- `commentKind` gains `highlight` (wordless, coloured), labelled **Highlight** in the drawer, which
  also shows a small swatch. The margin leaves out wordless highlights, as it already leaves out bare
  bookmarks (there is nothing to say in it).

### Changing and removing a colour

`PATCH /api/comments/:slug/:id/colour { colour }` (a colour or `null`), modelled on the existing
`PATCH …/:id/mark`. `CommentDialog` (the box a click on a mark opens) gets the same swatch row, so a
highlight can be recoloured, or have its colour removed, which leaves an underline. Deleting stays
where it is.

### The menu (the part that needs Greg's decision; see "The question" below)

Recommended: **a small floating menu at the selection**, instead of the box opening straight away:

```
   …the variance of the estimator falls as n grows, which is why…
       ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
       ┌─────────────────────────────────┐
       │  ●  ●  ●  ●   │  💬 Comment…   │
       └─────────────────────────────────┘
```

- A swatch saves a wordless coloured comment **in one press**, clears the browser selection so the
  wash shows, and the menu goes. The save goes through the existing `useComments.create`, with its
  optimistic write and its tombstones, so it gains no new failure modes.
- **Comment…** opens today's `AnnotateDialog`, exactly as letting go does now, with a swatch row
  added (no colour picked by default, so a comment made the old way looks as it does today). The AI
  tick-box stays there, where it is now. The menu does not offer the paid thing in one press.
- Escape, a click elsewhere, or a new selection dismisses it. It takes no focus on open, so the
  selection survives and ⌘C still works. That fixes the 2026-09-05 copying complaint at the root
  rather than with a button.
- Placed below the selection's last line rect (so it does not sit under the iOS callout, which goes
  above) and clamped to the viewport.
- Visitors (no owner) get nothing, as today: `selectProse` returns early.
- Referee mode keeps going straight to the box, because placing on a criterion is the point of a
  selection there.

## Stages

1. **Data.** Migration (one nullable `text` column, CHECK of the four names, additive), `Comment`
   type, the Postgres store, `POST` accepting `colour`, `PATCH …/colour`, the public projection
   carrying it (it is presentation, not private; same as `body` on a shared copy), and the export
   if `export.md` lists comment fields. Tests: a round trip, a refused unknown colour (route and
   SQL), PATCH to null, and the projection.
2. **Drawing.** `data-colour` in `annotateHtml`, the newest-wins rule on overlap, no ✳ on a wordless
   highlight, the wash tokens (light and dark), `commentKind` → `highlight` and the drawer swatch.
   Tests red-first in `tests/annotate.test.ts` for the overlap and the ✳ rule.
3. **The menu**, in whichever shape Greg chooses, plus the swatch row in both dialogs. A jsdom test
   for one-press save and for the menu not taking focus; a browser check (Sonnet subagent, Playwright
   on the box) of select → swatch → wash, overlap, dark mode, and a narrow window.
4. **Docs.** `comments.md` gains a § Highlights section, with the "underline, not a fill" CSS comment
   updated to say when a fill is used; the feedback note; the Overseer queue.

Each stage ends green and committed. Sol reviews the plan before stage 1 and the code at the end.

## Deferred, by name

- **Touch.** Selection reaches the comment flow through `onMouseUp`, and whether a finger's selection
  gets there today is untested. The menu inherits whatever the box has; making selection work for
  touch is its own piece of work ([touch.md](../project/touch.md)).
- **A selection across two blocks** stays clamped to the first block (an existing limit, because a
  comment addresses one block id). Multi-block highlights would mean one row per block, or a
  range anchor. Not now.
- **Colour meanings / a legend / filtering by colour** ("yellow = disagree"). Worth having once
  people use colours; not in v1.
- **Custom colours.** Four fixed names.
- **Keyboard shortcut** for highlight-in-last-colour. Easy later.

## GPT Sol's plan review, 2026-10-03: build with changes

[261003e-span-highlights-plan-review-sol.md](261003e-span-highlights-plan-review-sol.md). Eleven
P1s, no P0. All accepted; each checked against the file it cites. What they change:

- **S1 the opening-read gate.** A one-press swatch must wait for `owner.comments.loaded`, as
  AnnotateDialog's Save does ([260908c](../postmortems/260908c-an-opening-read-can-erase-a-later-write.md)).
- **S2 the mark cache.** `anchorKey` in `TableView.tsx` excludes every non-anchor field, so a
  recolour, a removed colour or a body added would leave the old drawing. Colour, "earns a ✳" and a
  creation priority go on each comment `Mark`, and into the key (or a cheap pass like `applyOpen`).
  Mounted tests for each change.
- **S3 write ordering.** `recolour` joins `useComments`' per-comment `queue` beside `edit` and
  `place`; the picker is controlled by the stored row.
- **S4 no whole-block colour.** SQL `colour is null or quote is not null`, refused at POST and
  PATCH, and no picker on a whole-paragraph comment.
- **S5 one priority for colour and click.** `createdAt` then `id`: the comment whose colour shows is
  the one a click opens (ids emitted newest-first), keeping the linked comment/chat exception.
  Tested through `onMouseUp`. A highlight under an author link or a cross-reference opens from
  the gutter or drawer, not from the words. That is an existing rule, now stated.
- **S6 search shares the background.** A highlight's wash wins on the overlapping words; search
  keeps its stripes and paragraph rail; an open highlight gets an outline, not the orange wash.
  Browser-checked.
- **S7, S8 the menu's lifecycle** (if built): one draft `{anchor, rect, token}`, geometry from the
  clamped range, dismissed on scroll, resize, mode change and selection change, re-checked before
  saving; one state machine `menu → dialog → saved/cancelled` inside `surface.current`, with one
  Escape owner, Comment… mounting the dialog fresh, visitors silent, Referee straight to the dialog,
  and pointerdown inside the menu not counted as outside.
- **S9 kind precedence.** `comment-ai` > `comment` > `highlight` > `bookmark`; Marginalia excludes
  `highlight` and `bookmark`; `CommentDialog`'s own labels use `commentKind`.
- **S10 idempotency.** Colour joins `NewComment`, `toComment` and same-Save equality (same id with a
  different colour is a 409). `Comment.colour` is optional, absent for null.
- **S11 projections are definite work.** The rollback exporter (`store/export.ts`), the public SQL
  select, the public mapping and DTO, and `PublicComment` all list fields by hand. Stage 1, with
  owner/visitor equivalence and export tests.
- **S12** the menu needs Greg's answer before stage 3. **Copy** is dropped from any menu: if the menu
  takes no focus, ⌘C already works.

Sol's "simpler version that gets most of the value" is colour in the two existing boxes with the
selection flow unchanged. That is option A in the question below.

## The question for Greg

Sent through the Overseer; see the feedback note for the answer.

## Stage 1 landed, 2026-10-03 (option A only, on the Overseer's instruction while Greg is asleep)

The Overseer: build what every option shares (colours, and the box with colour dots), but no menu
until Greg answers. On dev as 3e2d0b9a8 + 7bbc132d8:

- `comments.colour` (migration `20261003050050_comments_colour`), POST + `PATCH …/:id/colour`,
  `recolour` on the per-comment queue, public projection and rollback export.
- The wash in the prose, the Highlight kind, no ✳ on a wordless highlight, colour rows in
  `AnnotateDialog` and `CommentDialog` (shared `HighlightSwatches.tsx`), and a dot in the drawer.
- **The overlap rule changed in review.** The build first put the newest *coloured* comment first;
  Sol's code review (C1) showed that a newer uncoloured note over a highlight then opened the
  highlight and lost its underline. It is now one total order, newest first (`createdAt`, `id`): the
  newest comment is both what a click opens and, if coloured, the wash.
- **The washes are dark-only**, because the app is (`styles/tokens.css` § DARK ONLY). If the
  light/dark work in progress (fbnv5bzx) lands, `--hl-*` needs a light twin.
- **Not yet browser-checked.** The shared local database refuses `db:migrate` until a peer's
  unlanded `article_tags` migration is reconciled, so no dev server here has the column. The S6
  cases (highlight over a search hit), the swatch rows and a narrow window wait for that.

Sol code review: [261003e-span-highlights-code-review-sol.md](261003e-span-highlights-code-review-sol.md),
"land after fixes (made)"; the Postgres tests it asked for pass (comment-colour, public-visibility-pg).

**Browser-checked, 2026-10-03** (Sonnet subagent, Playwright on the box, `/read/fowler-phrenology`),
once the peer's migration landed and this one applied: swatch row by mouse and keyboard, all four
washes legible and distinct from each other and from the orange, recolour and remove without a
reload and persisted across one, the overlap (pink inside yellow opens pink, yellow around it opens
yellow), a words-mode search over highlights keeps both, no overflow at 400px, no page errors. One
change from it: the wash's rounded corners notched the seams where a highlight is cut around a
glossary term, so the corners are square.
