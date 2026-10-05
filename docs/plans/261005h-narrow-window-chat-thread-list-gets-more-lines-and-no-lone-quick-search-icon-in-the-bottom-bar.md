# Narrow window: Chat's list of conversations shows more of each one, and the bottom bar stops drawing a lone quick-search icon

Up: [plans.md](../project/plans.md)

Two reports from Greg (an admin; `feedback-reporter.ts` exit 0 on each production row), batched as
Overseer queue entry qi-prrxf2rv because both are small layout changes for a narrow window. Session
`fbsvsbae-n8pgy2-narrow-chat-and-search`.

**`spya-svsbae`**, 2026-10-05 07:37 UTC, `?mode=chat`, Sentry SPIDERYARN-READING2-DD:

> In chat mode, when I'm looking at it in portrait mode on an iPhone, it truncates both the thread
> title and the first response a little bit too aggressively, so it's quite hard to tell what each
> chat's really about.

**`spya-n8pgy2`**, 2026-10-05 07:45 UTC, `?match=quick`, Sentry SPIDERYARN-READING2-DF:

> In the bottom bar of the reading view, we show a search mode icon. Good.
>
> We also show a quick search input text bar when there's room. Okay, that's good too.
>
> But if there isn't much room, don't bother showing the quick search icon alone without the input
> text bar, because the quick search icon does just the same thing as clicking the search icon,
> which we are already also showing, so the quick search icon alone doesn't add any value.

Prior work checked (plans, user-feedback notes, `git log origin/dev`, `gjd-remote ls`): nothing has
touched either. The only session carrying these ids is this one.

## What was measured first

A Playwright pass against this worktree's own dev server, before any change
(`before.json` and `before-*.png` in the session scratchpad; the script is re-run after the change).
Article `fowler-phrenology`, fifteen conversations, three seeded locally with 58-character titles and
121-character answers.

**Chat's list, 390×844, touch:**

| | width | what shows |
|---|---|---|
| the list | 378px | |
| a row's title | 302px | two lines, **not clamped** — all 58 characters |
| a row's preview (`.chat-thread-last`) | 302px | **one line, about 35 characters** of a 121-character answer |
| the two hidden icons (rename, delete) | 46px | invisible, but they keep their width |

So the CSS is not what cuts the title. **The title is cut when the conversation is made**:
`titleFrom` in `src/chat.ts` keeps the first sixty characters of the first question and adds `…`,
and that string is what is stored. Two existing rows in the test article both read *"Explain the
opening argument of this article in detail, in…"* and nothing in the row tells them apart, since
the preview under each is six words.

**The bottom bar.** The quick-search control (`.dock-qs`) holds a text box and a ⚡ button, and the
stylesheet picks one. The ⚡ is drawn alone in four cases:

| case | measured |
|---|---|
| a finger (`pointer: coarse`), any width | 390 touch: ⚡, 44px |
| a window under 732px | 600 mouse: ⚡ |
| fit rung 4 (the bar's last rung) | first worn at **1100px** on the dev admin's bar: ⚡ |
| Search mode open and the bar's box not focused (`.dock-qs--bolt`) | 1440 mouse, `?mode=search`: ⚡ |

The first three are "there isn't much room" (or a box is unwanted: a finger). The fourth is at any
width and is a different decision — one box to type in, not two.

## The change

### 1. Chat's list (`spya-svsbae`)

**a. The row shows the first question in full when the title is only its cut-off start.** A new pure
function, `rowTitle(thread)` in a new `src/web/chat-list-row.ts`:

- if the stored title ends in `…` and the first reader message, with its whitespace collapsed,
  starts with the title less that `…`, return the message (capped at 240 characters, cut at a word,
  with `…` — the stylesheet's clamp is what a reader normally meets first);
- otherwise return the stored title. A renamed conversation is therefore never touched: a rename is
  not a prefix of the question, and if a reader renames it to exactly such a prefix they get their
  question, which is what they typed anyway.

`ThreadList` draws `rowTitle(t)` in `.chat-thread-title` and in the row's hover text (`describe`),
which already claims to be "the title in full". Nothing stored changes, so **conversations that
already exist get the longer title too**. The open conversation's header (`.chat-head-title`) and
the server are not touched.

**Changed after GPT Sol's plan review** (its one finding, P2): the prefix test above would draw the
question over a rename such as `Explain…`. So `titleFrom` moves to a client-safe file of its own,
`src/chat-title.ts` (`src/chat.ts` reads files and cannot be imported into the client; it re-exports
the function), and `rowTitle` expands only when `titleFrom(first question) === title` exactly. A
rename that is character for character the server's cut cannot be told from no rename, and gets
the question it abbreviates.

**b. Under 732px the title may run to three lines and the preview to two.** In
`styles/mode-band.css`, beside the rules they change:

```
@media (max-width: 731px) {
  .chat-thread-title { line-clamp: 3 }                       /* was 2 */
  .chat-thread-last  { white-space: normal; line-clamp: 2 }  /* was one line, ellipsis */
}
```

At 302px that is roughly 120 characters of title and 80 of preview, against 60 and 35 today. A
typical row grows from four lines to at most six; a short question still takes one line.
`LAST_MAX` (120 characters of preview put in the DOM) stays: two phone lines are under it.

**Above 731px nothing changes in the stylesheet.** The desktop list is 452px wide, the report is
about a phone, and row density there is a separate call. Desktop does get (a): two lines at 452px
hold about 150 characters, so a long first question now shows where it showed sixty.

### 2. The bottom bar (`spya-n8pgy2`)

**Where the box is not drawn for want of room or for a finger, nothing is drawn.** In
`styles/dock-quick-search.css`:

- fit rung 4: `.dock-qs`, its field and its ⚡ are all `display: none`;
- `@media (max-width: 731px), (pointer: coarse)`: the same.

Both children are hidden as well as the wrapper, because `DockQuickSearch.tsx` asks
`getComputedStyle(field).display` to decide what `/` does and whether a focused box has just been
hidden, and a child of a `display: none` parent still reports its own `display`. The wrapper is
hidden so an empty flex item cannot leave a double gap in the row.

**Rung 4 keeps its number and its job** — the last rung, one step narrower than rung 3 — but what
it gives up is now the whole control rather than the box for a ⚡. It frees about 33px more than it
did.

**Unchanged:**

- **`/`** still opens Search mode on *quick* with the panel's box focused wherever the box is not
  shown. The handler lives in the component, which stays mounted.
- **A focused box that a resize hides** still hands its words to the panel (the same effect).
- **Search mode open at a width that has the box** (`.dock-qs--bolt`): still the ⚡. Greg's sentence
  is about "if there isn't much room"; this case is at any width, exists so there is one box to
  type in, and removing it would shift the bar every time Search opens. Left alone, and named in
  the note so he can ask for it.

### One thing Greg's sentence has slightly wrong, and what follows from it

The ⚡ and the Search button are not quite the same door. The ⚡ opens Search on **quick**; the
Search button opens it on whatever the URL says, and with nothing said that is **thorough**
(`DEFAULT_MATCHER` is `meaning`, `params.ts`). So after this change a phone reader reaches *quick*
by Search, then the *quick* tab — one more tap than the ⚡ — or by `/` with a keyboard.

Built as asked anyway: the request is explicit, the icon was scrolled off the right-hand end of a
390px bar in the measurement (past x=889), and the extra tap is small. Whether Search should open on
*quick* on a phone is a product question for Greg, not part of this; the note says so.

## Passed over

- **Raising `titleFrom`'s sixty.** Simpler to say, but it changes only conversations made from now
  on, and the stored title is also the open conversation's one-line header, where longer is worse.
- **Taking back the 46px the hidden rename and delete icons hold on a phone.** It would give the
  text 15% more width. But on a touch screen those icons are reached by tapping that empty strip
  (the tap lands on the row, the row is `:hover`, the icons appear), and rename exists nowhere
  else. Hiding the column on touch would remove rename from a phone.
- **A React change in `DockQuickSearch`** to not render the ⚡. The fit ladder measures each rung by
  class, so the shapes must be the stylesheet's (Sol F9 on 261002h).

## Tests

Each written first and seen red.

- `tests/chat-list-row.test.ts` (new): `rowTitle` over a long question (full text), a short one
  (title), a renamed thread (title), a thread with no messages, whitespace and newlines in the
  question, the 240 cap; and for each long case `titleFrom(question)` is the title used, so the
  prefix rule cannot drift from the server's cut.
- `tests/chat-list-row.test.ts`, stylesheet half: inside a `max-width: 731px` block,
  `.chat-thread-title` clamps at 3 and `.chat-thread-last` at 2 with `white-space: normal`; outside
  it they are 2 and `nowrap`.
- `tests/dock-quick-search.test.tsx`: the rung-4 case becomes "draws nothing at rung 4" (field, ⚡
  and wrapper hidden, and no rule *shows* the ⚡ there); a new case for the narrow/coarse media
  block; the rung-3 case and every `.dock-qs--bolt` case stay as they are.
- `tests/dock-fit.test.ts`: only the wording of the rung-4 case.

## Browser check

The same script, after: at 390 touch the long rows show their whole first question and a two-line
preview, and the two "Explain the opening argument…" rows read differently; at 390 touch, 600 mouse
and 1100 mouse `.dock-qs` is `display: none` and the gap between the modes and the next button is a
single gap; at 1440 the box, and at 1440 with Search open the ⚡, exactly as before. Then `/` at
1100 with a mouse opens Search on quick with the panel's box focused.

## Docs that move with it

`search.md` (§ the box in the bottom bar, and the bottom-bar paragraph), `keyboard.md` (§ the slash
key), `help-modes.tsx` (the ⚡ sentence), `reading-view-overview.md`/`narrow-windows.md` only if they
name the ⚡; the comments in `dock-quick-search.css`, `DockQuickSearch.tsx`, `dock-fit.ts`,
`dock-fit.css` and `narrow-window.css` that say rung 4 or a phone draws the ⚡. One feedback note
naming both ids.

## Reviews

GPT Sol on this plan (read-only) before building; GPT Sol on the code before pushing.
