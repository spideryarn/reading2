# Include public on the shelf, help for an empty shelf, and a phone banner

Two reader reports from Greg, both suggestions, both about the signed-in homepage (the shelf,
[library.md](../project/library.md)).

> We have a button to include archived when displaying stuff in the shelf and searching the shelf.
> Perhaps let's also have a button for include public. And if the user has no articles in their
> shelf, we probably actually want to, as well as saying you have no articles yet, you know, upload
> them, you know, see above or whatever with a link that points them to the top.
>
> We might also want to see or browse our public articles, you know, click include public. So just
> kind of provide a bit more help to new users that don't yet have anything on their shelf and be
> able to include public for everybody they want, including in searching, etc.
>
> — Greg, 2026-10-01 (spya-yy5x66)

> Spideryarn does not work that well on a mobile phone. It works, but because of the small screen
> the experience is suboptimal. So I wonder if we should show some kind of banner to people when they
> open it on a phone to say that it's probably best on a larger screen, and failing that, in
> Landscape mode.
>
> We'd show it on the logged-in homepage, and ideally only once/the first time they use it on a
> phone.
>
> — Greg, 2026-10-01 (spya-fcbnhq)

Nothing on `origin/dev` had started either (checked `git log`, 2026-10-02).

## Part A — an **Include public** chip

A chip beside **Include archived**, in `ShelfControls`, same shape, same words pattern, its own URL
bit: `?public=1` (`libraryPublicParam` in `params.ts`, `history: "push"` like archived). Off by
default, and it does not fetch until it is on.

On, the shelf fetches `GET /api/public/library` through the existing `loadPublicLibrary`
(`src/web/public-api.ts` — the same anonymous read `/read/public` makes; no new server route, no new
query, so nothing new in the public import graph) and draws **a second section under the shelf's
list**: a heading — *Shared by other readers* — and the matching public articles as `PublicCard`s
(exported from `PublicLibraryPage.tsx` rather than copied).

- **Narrowed by the same search box**, by the same rule the shelf's own cards use — `filterEntries`'
  four fields (title, byline, siteName, gist), which `PublicLibraryEntry` also carries. The rule is
  lifted to take any `{title, byline, siteName, gist}` so there is one matcher, not two.
- **Not narrowed by Unread or Topics.** Both are facts about *your* reading (opens; terms picked from
  your shelf). The section says it is narrowed by the search only when either is on.
- **Your own public articles are left out** (by slug, against everything already in the shelf
  scope) — they are already above, with your verbs on them.
- **The cap is said**, with `PUBLIC_SHELF_TRUNCATED`, exactly as `/read/public` says it.
- **Passages are not searched in public articles.** With the chip on and a query typed, the passages
  list carries one line saying public articles were matched by their cards only. See § Deferred.

### The simpler option passed over, and the bigger one

- *Simpler:* a link to `/read/public` beside the chip, and no chip. Rejected — Greg asked for it
  "including in searching", and a link leaves the search box blind to it.
- *Bigger:* public articles **inside** the one list, as archived became on 260929a (sorted, topics,
  table view, Unread). That needs a `LibraryEntry`-shaped row for an article with no owner fields
  (opens, comments, rename, archive) and a `ShelfCard` with every owner verb switched off — exactly
  the six-optional-branches design [public-shelf.md](../project/public-shelf.md) § The parts rejected
  for `PublicCard`. A section is the v1; if Greg wants sorting and topics across both, that is the
  next step and it is named as a question.

## Part B — an empty shelf that helps

Today: *"Nothing on the shelf yet. Paste a URL above and it'll be here in a minute or two."* Now:

- **"Paste a URL above"** becomes a link to the add box (`#add-url`) whose click scrolls to it and
  focuses it — Greg's *"a link that points them to the top"*.
- **A second sentence offers the public shelf**: *"Or see what other readers have shared —"* and a
  button that turns **Include public** on (the same setter as the chip). With it already on, the
  sentence is not drawn.
- The chip itself is already drawn over an empty shelf (the `bare` row in `ShelfControls`), so
  Include public is added to the bare row too.

## Part C — a phone banner on the shelf

A `role="note"` banner at the top of the shelf, the `.small-screen-hint` styles reused, the shape of
`SmallScreenHint` (lazy initialiser, × writes one bit):

> **Spideryarn works best on a larger screen** — a tablet or a computer. On a phone, turning it
> sideways gives the reading view more room.

(the landscape sentence dropped when the phone is already sideways, `moreRoomSideways`).

**Who gets it — a phone, not a narrow window.** `coarsePointer` *and* the screen's **shorter side
under 600 CSS px** (`screen.width`/`screen.height`, not the window — a phone is a phone in either
orientation, and an iPad mini's short side is 744). The article banner asks the layout because it
explains one layout decision; this one is about the device, so it asks the device. A laptop window
dragged narrow has a fine pointer and never sees it.

**Until dismissed, on this device** — the same contract as the article banner, its own
`localStorage` key (`spya.shelfPhoneHint.dismissed`), every read and write in try/catch. Greg's ask
says *"ideally only once/the first time"*; touch.md § One banner, once records why the article banner
chose *until dismissed* instead (a banner spent on a visit where the reader scrolled past explained
nothing), and the same holds here. Asked back as a question rather than decided silently.

The pure parts (`isPhone(env)`, `shouldShowShelfPhoneHint(env)`, the storage pair) go in
`small-screen-hint.ts` beside their siblings, so one file holds both banners' conditions.

## Tests

- `filterEntries` over public entries; the dedup by slug; the section's empty and capped states.
- The chip: off makes no public request; on makes one, and the section draws; `?public=1` on arrival.
- The empty shelf: the link targets `#add-url`; the button turns the chip on.
- The phone rule: a phone portrait and landscape → yes; iPad (short side 744/820) → no; a fine
  pointer at 390 → no; dismissed → no; storage throwing → shows (cannot tell = show).

## Deferred, said rather than left

- **Passage search in public articles** — a server query that returns public block text for a
  query: a new listing-shaped read in the unauthenticated namespace, which
  [security-map.md](../project/security-map.md) treats as the sharpest kind. Worth doing on its own
  plan if Greg wants it; the UI says it is not done.
- **Public articles in the one sorted list** (above).

## Plan review (GPT Sol, 2026-10-02)

[261002b-plan-review-sol.md](261002b-plan-review-sol.md): no P0. Confirmed the separate section, the
anonymous read (no credentials, query never sent), and that a signed-in reader opens another
reader's public article through the visitor path (`access.ts`, owned 404 → public 200). Taken:
the failure/Retry contract is tested (P1); the cap gets its own sentence saying the *search* is
bounded, and "nobody else has shared" is not said when every row sent was yours and there are more;
`isPhone` refuses an unmeasured screen (0 or `NaN`) and the 599/600 boundary is pinned; the
landscape sentence is picked by an orientation media query so it follows a rotation; library.md,
public-shelf.md and touch.md record the change.
