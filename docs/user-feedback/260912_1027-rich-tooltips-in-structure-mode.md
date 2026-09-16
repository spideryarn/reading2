# Structure mode's rows had no hover card

[SPIDERYARN-READING2-3N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3N) (2026-09-12
10:27 UTC, `kind=suggestion`), from an admin, build `d358f773`, in Structure mode on
`temporal-context-reinstatement-spya-dhqkf9`.

> Add rich tooltips to Structure mode (so I can see summary of that bit of the text)

**Ending: Shipped** — on `dev`, not deployed. Resolve 3N.

What we did: hovering a row in Structure's two-column view now shows a card with that part or
section's one-sentence summary and a bulleted list of what is inside it, capped at five with "+ N
more". Keyboard focus opens the same card, and running the pointer down a column opens each one
instantly, the way the spine's rail already does.

The reason this was missing at all is that **Structure has two faces**: on a narrow band it draws the
nested list that used to be Outline mode, and that face has had a card since it was a mode of its
own. The two-column face — the one a wide window gets, which is where the report came from — had
none.

The card is deliberately **subtractive**: it leaves out anything the panel is already showing. So
the part you are currently standing in gets **no card at all**, because its summary is already
printed on its row and its sections already fill the right-hand column; and a row whose summary is
on screen gets a card holding only the list of what is inside. A hover that costs a second and then
tells you what you were already looking at is worse than no hover.
[260916b-rich-tooltips-on-structure-mode-rows.md](../plans/260916b-rich-tooltips-on-structure-mode-rows.md).

**Not built, and worth knowing: a finger still cannot open it.** The card opens on hover and on
keyboard focus, and a tap does not hold it. That matters more than it sounds, because a phone
*does* get the two-column face — the threshold is 364 content pixels and a 400px phone clears it —
so on a phone these cards are currently dead weight. It is also **the same gap the list face has
had all along**, rather than something this change introduced.

It was left out because the fix is the spine's reveal-then-commit gesture, which needs the tooltip
to take over its own open state — the exact shape that took the spine's hover cards away for a day
in August ([260828g](../postmortems/260828g-spine-hover-cards.md)) — and because it buys less here
than on the rail: a spine band is two pixels tall and tapping one blind is a coin flip, whereas a
Structure row is a legible line of text you can already read. Say the word and it is an afternoon,
for both faces at once.
