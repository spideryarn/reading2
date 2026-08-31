# The bottom bar, and the drawer that rises out of it

**Built 2026-08-25.** A permanent bar across the bottom of the reading view, and a drawer that
slides up over the article when you press one of its buttons. It holds the things that are about
*this article* but are not the article: the questions you have asked, where it came from, the way
home — and the app's own name, which had nowhere to live until now.

Code: [`src/web/Dock.tsx`](../../src/web/Dock.tsx), with the styles at the end of
[`src/web/styles.css`](../../src/web/styles.css) under `§ dock`.

```
  SHUT — the reading view, plus one bar

 ┌─────────────┬───────────────────────────────────────────────┐
 │             │  Title of the article                         │
 │  ▇▇▇▇▇▇▇▇   │  Granularity:  L0  L1  L2   Text   fit        │
 │  ▇▇▇▇▇      ├────────┬────────┬─────────────────────────────┤
 │  ▇▇▇        │ L1     │ L2     │ the full text of the        │
 │  ▇▇▇▇▇▇▇    │ gists  │ gists  │ article                     │
 │  ▇▇         │        │        │                             │
 │  ▇▇▇▇       │        │        │                             │
 ├─────────────┴────────┴────────┴─────────────────────────────┤
 │ ⌂ Home   ✳ Questions 3   ⓘ Metadata     ▨ ▨ ▨ ▨ ▨          │
 └─────────────────────────────────────────────────────────────┘
   spine and table exactly as before          not built yet


  OPEN — the drawer rises; the table has not moved a pixel

 ┌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░┐
 │░░░░░░░░░  the article, dimmed — click it to close  ░░░░░░░░░│
 ├─────────────────────────────────────────────────────────────┤
 │ ◈ Spideryarn    Your questions                          [×] │
 ├─────────────────────────────────────────────────────────────┤
 │  “…and that is why the estimate…”   The author is comparing │
 │  “the second law implies…”          thinking…               │
 │  “where does this figure come…”     It comes from table 3,  │
 ├─────────────────────────────────────────────────────────────┤
 │ ⌂ Home   ✳ Questions 3   ⓘ Metadata     ▨ ▨ ▨ ▨ ▨          │
 └─────────────────────────────────────────────────────────────┘
```

## Why the bottom

It started as a left-hand sidebar. The design was settled — an icon rail outboard of the spine, a
drawer over the top — and then:

> What's the alternative? I suppose we could put it at the bottom? Would that be simpler to
> implement? If so, let's do that for now.
>
> — Greg, 2026-08-25

It is simpler, and the reason is worth stating plainly rather than as a feeling:

**This view's hard problem is horizontal, and the bottom edge is vertical.**
[`layout.ts`](../../src/web/layout.ts) spends its whole length negotiating width — it squeezes the
gist columns from 15rem to 11rem, and when that is not enough it starts giving up levels. Anything
permanent down the left joins that negotiation, and brings with it:

- a `--rail-w` term in five CSS rules that currently read `var(--spine-w)`;
- a constant beside `SPINE_FULL`, and the `minWidth` arithmetic that depends on it;
- a third interaction with the spine's three modes (`full`, `narrow`, `off`);
- a band of window widths where a granularity column is dropped that used to fit.

A bar at the bottom takes height, and height is the axis where this view has nothing to ration — the
page simply scrolls. `fitView` never learns the bar exists. That is not a smaller version of the same
work; it is different work, and much less of it.

### The right-hand edge, offered and turned down

Greg's message offered the right-hand side as the escape hatch if it were much simpler. It is not —
**the right edge is the busiest one in the app**, and all three of its occupants would have had to
move:

- the prose column ends there, and `styles.css` carries a long note at `td.pin-right` recording that
  pinning right shifts the last column left by the entire overflow, hiding live content on arrival —
  which is why that pin was abandoned;
- the answer dialog is `position: fixed; right: 1.25rem; bottom: 1.25rem`, deliberately over the
  prose — [comments.md](../project/comments.md);
- the "there is more over here" fade is `.reader:has(table.zoom.overflowing)::after` at `right: 0`.

So the choice was not left-versus-right. It was *horizontal versus vertical*, and vertical won.

## What is in it

Eight buttons, and the order was set by hand. Greg, 2026-08-26:

> Rearrange the buttons in the bottom-bar. It should be Contents, Summary, Glossary, Search, Chat,
> Questions, Thread (renamed to "Tweets"), Metadata.

| | | |
|---|---|---|
| ☰ | **Contents** · **Summary** · **Glossary** · **Search** · **Chat** | The five modes, and one control rather than five: `role="radiogroup"`, exactly one on at a time. They choose what the middle band **is**. First in the bar because they are the only buttons that change the page you are already looking at rather than sending you somewhere else. See [260826a-chat-mode.md](260826a-chat-mode.md) for the band, and `MODES_UI` in [`Dock.tsx`](../../src/web/Dock.tsx) for the table that owns the order |
| ✳ | **Questions** | Every question asked about this article, in reading order, with a count on the button and the count turning orange while anything is still with the model. Clicking one closes the drawer and opens its answer where the passage is. **A drawer on the reading view only** — on the metadata and tweets pages it is a link back, carrying `?panel=questions`, because `useComments` fetches on mount and those pages have no passages to scroll to |
| ≡ | **Tweets** | The article as a numbered thread. Labelled `Thread` until 2026-08-26 and named after its own page and route now — the same rule that turned `About` into `Metadata`. See [260825g-tweet-thread-page.md](260825g-tweet-thread-page.md) |
| ⓘ | **Metadata** | Source, slug, shape, which model built the tree and the arc. **Moved out of the masthead**, see below. Since 2026-08-25 it is a *link* rather than a panel — the details grew into a page, [260825e-metadata-page.md](260825e-metadata-page.md) — and it is labelled after that page rather than after the `About` panel it used to open. Last in the bar: it is the machinery behind the article rather than a way of reading it |

The shape underneath that order is **the five modes, then the things that leave the band**, and
inside the modes it runs from the article restated (Contents, Summary), through the ways into it
(Glossary, Search), to the conversation about it (Chat). A new mode is a row in `MODES_UI`;
anything else goes after them.

### Home left the bar, and the app got a logo

Greg, 2026-08-26:

> Get rid of "Home". Instead, add a Spideryarn logo in the very top-left of the window that takes
> us Home.

The bar had a `Home` link at its left end from the day it was built. It was the odd one out and
always had been: every other button is about *this article*, and the way out of a document is not
one of the things the document can be. It is now the wordmark fixed in the very top-left corner of
the window — [`HomeLogo.tsx`](../../src/web/HomeLogo.tsx) — which is where the web has kept both
the brand and the way home for twenty years, so it costs the reader nothing to learn. It also gave
the app's name somewhere to live: the wordmark used to be tucked in the drawer header, visible only
while a panel that is shut nearly all the time was open, and that copy is gone.

**The one thing to know before moving it again.** On the reading view the corner is genuinely empty
at every scroll position — the spine is fixed at `top: var(--bar-h)`, and the masthead and controls
bar are both inset by `left: calc(var(--spine-w) + var(--mode-w))`. But `--spine-w` is not a
constant: [`layout.ts`](../../src/web/layout.ts) narrows the spine as the window shrinks, and
**turns it off entirely whenever the reader hides the prose** — `!showText`, at any width at all.
That last part is the trap. The first draft of this note said the spine only disappeared on a
narrow window, which would have made `--spine-w: 0` a rare edge case; it is in fact one toggle
away on a full-size screen, and `?text=0` is the whole reproduction. (Measured with the spine off:
the logo runs 0→136px and the title starts at 160.)

It is `!showText` **and no mode band**, mind. A band is laid out by `fitMode`, a different
function, and that one never returns `"off"` — inside a band the prose is always on. So the two
smallest terms cannot happen together, and with today's constants the `--mode-w` term never
changes the answer at all: a band means at least `SPINE_NARROW` + `MODE_MIN` = 312px against the
logo's 160px reach, and the expression floors at 1.5rem. It is in there anyway because the bars are
*positioned* by `--spine-w + --mode-w`, and an offset expression that does not mirror its own
positioning is a trap for whoever changes one of them.

So both bars reserve the space, with one expression written twice:

```css
padding-left: max(1.5rem, calc(var(--logo-w) + 1.5rem - var(--spine-w) - var(--mode-w)));
```

Both are positioned at `left: calc(--spine-w + --mode-w)`, so `--logo-w` minus that offset is
exactly how far the logo reaches into them, and the `+ 1.5rem` keeps the gutter they have
everywhere else rather than letting the title start flush against the wordmark. At full spine the
whole term goes negative and the ordinary 1.5rem wins, so the wide case costs nothing rather than
needing a second rule. Change `--logo-w` and both follow; change the logo's size without the token
and they will not, and the wordmark lands on the article's title — in a state that is one keystroke
away and that nobody testing at their own screen width would think to try.

### The dimmed placeholders are gone

The bar's right end used to carry five dimmed placeholders — Summaries, Glossary, Highlights,
Search, Reading time — each with a tooltip saying what it would be *and the one thing the original
version learned the hard way about it*. Greg, 2026-08-25: *"Also see
docs/project/original-version/overview.md for ideas - for now, add extra ideas as placeholders with
rich tooltips."*

The "for now" ran out, and it ran out the good way: **four of the five were built.** Glossary and
Search became modes in the band on 2026-08-25, Summary on 2026-08-26
([summaries.md](../project/summaries.md)), and Highlights turned out not to be a feature at all —
highlighting is what search *does to the page* ([search.md](../project/search.md)). Each cost the
bar one row in a table and cost the layout nothing, which is the strongest evidence so far that the
mode band was the right shape; see [260826a-chat-mode.md](260826a-chat-mode.md), where that slot was argued for.

The last one standing was Reading time. Greg, 2026-08-26:

> And get rid of "Reading time" - that should be part of "Metadata".

It already was — the metadata page has read time as one of its six stat cards. So the bar was
advertising a button for something a page already answered. The one thing the placeholder carried
that the page did not, that the original version dropped the readability formulas for a model's
judgement and then scaled the estimate by how confident the model was, is now in that card's
tooltip, where somebody wondering about the number will actually meet it.

**The convention itself is not dead**, and it did not lose its owner — it moved. `SOON` and the
`.tip-soon` rules now live for the metadata page's own three (reading purpose, re-run a stage,
delete this article,
[260825e-metadata-page.md § A second pass over theirs](260825e-metadata-page.md#a-second-pass-over-theirs-2026-08-25)),
and anything else that needs to say "this is an intention, not an oversight" should reuse them
rather than invent a second good way. What died is the narrower idea that a *bar* is a good place
to advertise unbuilt features. A bar is for pressing.

They were never a backlog. The standing rule from
[original-version/overview.md](../project/original-version/overview.md) is *a library to consult, not
a backlog to import*.

> **Both of the features this section originally refused are now buttons in this bar**, and the
> refusals are left standing above rather than quietly edited out, because what they said is still
> the argument each feature had to answer.
>
> - **Tweet threads** — "simply not what this is", written a few hours before Greg asked for them.
>   Answered in [260825g-tweet-thread-page.md § Say the awkward thing first](260825g-tweet-thread-page.md#say-the-awkward-thing-first).
> - **Chat** — the stronger objection: [their own docs](../project/original-version/search-and-chat.md#chat-the-one-to-be-suspicious-of)
>   single it out as the one to be most suspicious of, and it sits closest to our
>   [anti-goals](../project/vision.md#anti-goals). Built 2026-08-25 at Greg's request, and **not as
>   the thing that was refused**: it is a *mode* in the band between the spine and the prose rather
>   than a pane over the article, and every claim it makes carries a block id you can press. The
>   full argument, including which half of the original version's own constraint we did not keep, is
>   in [260826a-chat-mode.md § Say the awkward thing first](260826a-chat-mode.md#say-the-awkward-thing-first).
>
> The lesson for whoever writes the next refusal here: say *why*, in terms of what would have to be
> true for the answer to change. Both of these were reversed within a day, and both reversals were
> cheaper to argue because the objection had been written down properly.

Also deliberately absent, from the design round before the move to the bottom:

- **A list of other articles.** Greg, 2026-08-25: *"Actually, the sidebar doesn't need that. Let's
  make the sidebar specific to this article for now. If the user wants other articles, they can use
  Home to browse them."*
- **The granularity buttons.** They stay in the bar above the table. They are used constantly while
  reading; this is for stepping out of reading.

### The questions list is the new thing

Everything else here moved. This did not exist in any form: the answers were reachable only through
the dialog's `‹ 3/7 ›` arrows, which will walk you through them one at a time but never show you
what you asked. That is exactly what you want when you come back to a piece the next day.

Order comes from [`comment-nav.ts`](../../src/web/comment-nav.ts) and therefore from the block index
— **never from the id string**, which is random and would sort into a plausible, meaningless order
([block-ids.md](../project/block-ids.md#why-random-and-not-sequential)).

### The masthead lost its ▾

The article's details used to live behind a disclosure triangle in the masthead. They are the
drawer's About panel now, and the reason is a property the masthead already documented about itself:
**it scrolls away.** So its disclosure was only reachable from the very top of the article, and
opening it pushed the whole table down. The facts you want when something looks wrong are exactly the
facts you want without having to go back to the top first.

`?about=1` became `?panel=about`. [`main.tsx`](../../src/web/main.tsx) rewrites the old spelling
before React mounts — the third rewrite in that file and the same shape as the other two, so one
spelling reaches the app and old links keep working. `about=0` is dropped rather than translated: it
meant the panel was shut, and the new spelling for a shut drawer is no parameter at all.

**And then it moved again, the same day.** The panel became a page,
`/read/<slug>/metadata` ([260825e-metadata-page.md](260825e-metadata-page.md)), because it was never really a
drawer's worth of content — Greg: *"We can get rid of the panel, and move all its contents into the
new page."* So there are now **two** superseded spellings and `main.tsx` rewrites both to that page.
The bar's ⓘ button is a link, and that is what made the bar's buttons two kinds rather than one. Questions then became both, depending on the page: `Dock` takes an
optional `drawer` prop, and only the reading view hands one in. The bar looks identical on all three
pages and is one component.

The counts both places need moved to [`stats.ts`](../../src/web/stats.ts), pure and DOM-free like
`layout.ts` and `comment-nav.ts`, rather than being computed twice.

## The URL

One parameter, `?panel=`, absent when the drawer is shut, with `history: "replace"`. It had two
values, `questions` and `about`; `about` went with the panel, so it has one today.

`replace` is not a fresh judgement — it is the rule [`params.ts`](../../src/web/params.ts) already
applies to both of the panels we had. From `noteParam`: *"Back would walk the reader through a
history of panels they had already"* finished with. From the old `aboutParam`: *"opening and closing
a panel twice would otherwise cost four presses of Back to undo. It is in the URL at all so that a
link can arrive with the provenance already showing."* Both sentences are exactly as true of the
drawer, and the second is the whole reason it is in the URL rather than in `localStorage`.

Greg chose "which page, yes; how wide, no". There is no width to store, so that answer collapses to
one parameter. An unknown value parses to a shut drawer rather than throwing, so a link from a future
version with more panels degrades to the article — the same rule `parseAsBlockId` follows. See
[url-state.md](../project/url-state.md).

## What it cost, honestly

The drawer costs the reading view nothing: it is `position: fixed` over the top and `fitView` never
hears about it. The bar costs `--dock-h` (2.5rem) of height, paid as `padding-bottom` on `.reader` so
the last paragraph can still be scrolled clear of it.

Three existing rules had to move out of its way, and each would have failed quietly rather than
visibly:

1. **`.cmt-dialog`** sat at `bottom: 1.25rem` and would have been half under the bar. Now
   `calc(var(--dock-h) + 0.75rem)`, written in terms of the token so that changing the bar's height
   cannot leave the dialog's delete button unclickable — which reads as a dead button, not a layout
   bug.
2. **The overflow fade** ran to `bottom: 0` and washed over the bar's right end. Now stops at
   `var(--dock-h)`.
3. **`.tooltip-anchor` was at z-index 80**, and the drawer is at 95. The bar's own rich tooltips —
   the entire content of the placeholders — would have rendered *underneath* the drawer. Raised to
   100, with the reasoning written into the rule: a tooltip is always about the thing you are
   pointing at, so it is always the frontmost thing on screen.

The stacking order now, bottom to top: pinned cells 15/35, overflow fade 20, table head 25, controls
bar 40, spine 45, answer dialog 70, **scrim 92, drawer 95, bottom bar 96**, tooltips 100.

The bar sits *above* its own scrim, which is the second thing that looked deliberate rather than
broken: dimmed along with the article, the live controls you use to switch panels read as disabled.
The drawer rests exactly on top of the bar rather than over it, so nothing is covered by that.

Two behaviours needed arbitrating rather than styling:

- **`Esc` was already taken.** The answer dialog listens on `window`, and both would have fired on
  one press — closing a dialog the reader could not see under the dim. The drawer listens in the
  **capture** phase and stops the event there, which is what makes "the drawer wins" a fact rather
  than a question of which component mounted first. It uses `stopImmediatePropagation` rather than
  `stopPropagation`: the two are the same for a real key press, and differ only when the event's
  target *is* `window` — no propagation path to cut, both listeners on one node, and the plain
  version silently stops nothing.
- **↑ / ↓ step through the article** ([keyboard.md](../project/keyboard.md)). `useArrowNav` grew an
  `enabled` flag, off while the drawer is open: a reader looking at their questions is not reading,
  and the article scrolling silently underneath the dim is the sort of thing you only discover
  afterwards, when you have lost your place. Only the keys go quiet — the pointer keeps aiming, so
  the controls bar still says what ↑/↓ would do, and closing the drawer resumes where it left off.

## What is still open

- **Small windows.** The bar's buttons carry both an icon and a word. Below roughly 700px the five
  placeholders will run out of room before the three real buttons do. Nothing has been done about
  this yet; the honest fix is to drop the placeholders' labels first and their icons never.
- **No keyboard shortcut opens the drawer.** It is click-only. A `?`-style shortcut map is a
  reasonable thing to want and does not exist anywhere in the app yet.
- **The placeholders do nothing**, on purpose. If one of them is built, it becomes a `Panel` value in
  `params.ts` and a case in the drawer body, and nothing else about this file changes — which was
  most of the point of the shape.

## See also

- [260826a-chat-mode.md](260826a-chat-mode.md) — the Chat button, and the **mode band** it introduced: the middle
  columns are now a slot, and the table of contents is the default thing in it
- [web-client.md](../project/web-client.md) — the reading view this attaches to
- [comments.md](../project/comments.md) — where the questions come from
- [library.md](../project/library.md) — where Home goes
- [url-state.md](../project/url-state.md) — the parameter, and the push/replace division
- [keyboard.md](../project/keyboard.md) — the arrow keys the drawer suspends
- [icons.md](../project/icons.md) — Lucide, one stroke weight, and the two ways an icon swap breaks a layout quietly
- [tooltips.md](../project/tooltips.md) — the tooltip engine the placeholders lean on
- [original-version/reading-view-ui.md](../project/original-version/reading-view-ui.md) — the icon rail this is a much smaller cousin of
- [original-version/overview.md](../project/original-version/overview.md) — where the placeholder ideas come from
