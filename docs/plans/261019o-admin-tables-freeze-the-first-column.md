# The /admin tables keep their first column on screen while they scroll sideways

Two admin suggestions from Greg, the same idea twice:

> When I scroll the table, can you keep the first column, which shows the name, frozen/visible the
> whole time?
>
> — Greg, 2026-10-19, `/admin/users` (spya-t45cfc, SPIDERYARN-READING2-KC)

> When scrolling this table to the right, keep the first column frozen (article name) so that it's
> always visible.
>
> We have made the same point about the user column in /admin/users - consider whether there are
> any other columns in tables in /admin/* that also should freeze the first column.
>
> — Greg, 2026-10-19, `/admin/articles` (spya-zzewu7, SPIDERYARN-READING2-M5)

## Every table under /admin, and which ones pin

| Page | Table | First column | Today | After |
| --- | --- | --- | --- | --- |
| `/admin/users` | `DataTable` (admin-columns.tsx) | Account (email) | scrolls away | **pinned** |
| `/admin/articles` | hand-drawn | Article | scrolls away | **pinned** |
| `/admin/vouchers` | hand-drawn | Email | scrolls away | **pinned** |
| `/admin/costs` | ranking, `DataTable` | the row's label | scrolls away | **pinned** |
| `/admin/costs` | pivot, failures by day / task | the row's label | pinned (`PINNED`) | unchanged |
| `/admin/costs` | why attempts failed | Failed (the phase) | scrolls away | **pinned** |

The rule: **pin the column that says what a row *is***, and every table here has one. The causes
table was left out of the first draft as six short codes that fit a phone; GPT Sol pointed out it is
seven columns, every one `whitespace-nowrap`, and the widest table on the page — so its short first
column is held too. `/admin/feedback` is cards, and the author gifts and public topics are not
tables.

The shelf (`/read`) also draws through `DataTable` and is **not** changed: Greg asked about
`/admin/*`, and the shelf is a reader's page with its own column-hiding. It gets the option for free
if he wants it later.

## How

`/admin/costs` already does this — `PINNED` in AdminCostsPage.tsx:
`sticky left-0 z-10 bg-background shadow-[1px_0_0_var(--border)]` — and `SidewaysScrollBox` already
knows about it (its shades are `z-20` to sit above a pinned cell's `z-10`). So this is one mechanism
reused, not a second one:

1. **Move `PINNED` into `lib/DataTable.tsx` as an export**, with its comment, and import it in
   AdminCostsPage, AdminArticlesPage and AdminVouchersPage. One home for the class list.
2. **`DataTable` gets `pinFirst?: boolean`** (off by default, so the shelf is untouched). When on,
   the first *visible* column's `<th>` and `<td>` get the pinned classes. A prop rather than a
   column `meta` flag, because pinning at `left: 0` is only right for the first column — a flag on
   the third column would draw it over the first. The prop is right by construction.
3. **The row's own tint has to reach the pinned cell.** An opaque `bg-background` on the cell hides
   the row's `hover:bg-card` and the marked row's `bg-highlight/10` (`?user=`) under the frozen
   column. In `DataTable` the pinned cell takes `group-hover:bg-card` (the `<tr>` is already
   `group`). The marked row's tint becomes an opaque mix of the orange into the page
   (`MARKED_BG`), worn by **both** the row and its held cell, so they match by construction — an
   alpha tint and an opaque mix are not the same colour (tailwind.css § `--color-highlight-wash`).
   It names the runtime variables (`--spideryarn-orange`, `--background`): the first draft used
   `--color-highlight`, which `@theme inline` never emits, so the cell would have had no background
   at all (Sol, plan review finding 1). The hand-drawn tables have no row hover, so plain `PINNED`
   is enough there.
4. **`isolate` on the scrolling box itself.** `SidewaysScrollBox` contained the `z-10` only on its
   cue wrapper, and users, articles and vouchers draw without the cue (Sol, finding 4).
5. **Narrow windows.** A pinned column is a column you cannot scroll past, so on a phone it has to
   be narrow enough to leave room for the rest. The costs labels already cap at `max-w-40` (160px)
   below `sm`. The users email column is fluid with a `min-w-56` (224px) floor, and Articles has the
   same floor: at 390px that pins 224 of ~358px. Below `sm` the pinned column's floor drops to
   `min-w-40`; the email already truncates with its full text in `data-tip`, and an article title
   wraps. The voucher email cell's edit inputs were `w-56` and would have widened it straight back,
   so they are `w-36 sm:w-56` (Sol, finding 2).
6. **The cell's rules.** Rows are separated by a `border-b` on the `<tr>` under
   `border-collapse: collapse`; a positioned cell paints its background over the collapsed border.
   Check in the browser whether the row rule vanishes under the pinned column (it would on costs
   today too); if it does, add the bottom rule to the pinned cell's shadow.
   **It does not.** Measured in the browser: the rule's pixels at the pinned column match a
   scrolling column's, header and body, on every table, and the last row gains no rule. Nothing to
   add (Sol's finding 5 was conditional on this).

## Log

- **Plan review, GPT Sol (high), 2026-10-19: revise before build.** Five findings, all taken: the
  marked tint named a variable that is never emitted (1); the voucher edit inputs undid the phone
  floor (2); the causes table was misdescribed and is pinned after all (3); `isolate` was missing
  without the cue (4); the row rules (5) were left to the browser, which found them intact.
- **Browser check (Playwright, local, 2026-10-19), every table at 390px and 1000px: pass.** The first
  column holds at the box's left edge, is opaque in both themes, and the hover and marked tints
  match the rest of the row (computed colours identical). The page never scrolls sideways. At 390px
  the box is 325px wide and the held column takes 160px on users, articles and vouchers (172px with
  a voucher in edit mode), 103–188px on the costs tables. The header's sort button still sorts when
  scrolled.

### The simpler option passed over

`position: sticky` on the first cell of each hand-drawn table with no shared constant — three copies
of a class list that already has two users. Not simpler to read, just quicker to type.

The heavier option, the frozen-pane pattern (two tables scrolled in sync), is what table.css passed
over for the reading view's right pin; the left pin needs none of it, because a sticky first column
is already at its static place when nothing has scrolled.

## Tests

- **Render tests** (the suite already renders admin pages, e.g. `tests/admin-articles-page.test.tsx`):
  `DataTable` with `pinFirst` puts `sticky` on exactly the first visible column's `<th>` and every
  `<td>` in it, with a column hidden too; without it, on none. The users, articles, vouchers and
  costs-ranking tables each pin their first column. Red first, against today's code.
- **The browser**, because a class on a cell is not a column on screen: at 390px and at a desktop
  width, scroll each table right and confirm the first column stays, nothing shows through it, the
  hover and marked tints reach it, the row rules survive, and the page itself does not scroll
  sideways.

## Deferred

- The shelf: not asked for.
- A sticky *header row* (vertical scrolling) — not asked for; the admin pages scroll as a page.
