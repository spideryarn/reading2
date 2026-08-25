# URL state, keyboard, and the command palette

Their state layer and ours agree on the principle — **the URL is the view** — and they got there by
making the mistake first. That mistake is worth recording, because it is not obvious and it is easy
to make.

Reference docs: `docs/reference/ARCHITECTURE_URL_STATE.md`,
`docs/reference/COMMAND_PALETTE_KEYBOARD_INTERFACE.md`, `docs/reference/KEYBOARD_SHORTCUTS.md`.
Code: `lib/tools/url-state.ts`, `lib/tools/use-tool-url-state.ts`, `components/command-palette.tsx`.

## URL as the single source of truth

Every bit of tool state lives in the query string, human-readable, never base64:
`?tab=summary&expertise=beginner&length=sentence_or_two`. Built on **nuqs** — the same library we
use ([url-state.md § The library: nuqs](../url-state.md#the-library-nuqs)), which is a small
independent confirmation that it was the right pick.

### The infinite render loop

They originally synced **both ways**: the URL updated a React Context, and the Context wrote back to
the URL. That loops. Two sources of truth for one value, each reacting to the other, is a cycle with
no natural stopping point, and in React it shows up as an infinite render rather than as anything
that names the real problem.

The documented fix (2025-06-15) made the URL the **only** source of truth and the Context a
**read-only mirror** — and, importantly, they enforced it: a dev-mode guard throws if you call the
old `actions.setActiveTab()` directly instead of the `useNavigateToTab()` hook.

**Take the rule; improve the enforcement.** The rule is already ours in practice. The enforcement
should be a compile-time one rather than a runtime throw — this repo is small enough that a
read-only type on the mirror, or a lint rule, catches it before it runs. A dev-only throw catches it
only if someone happens to exercise that path in development, which is the same class of gap as
[silent-success.md](../../reusable/silent-success.md).

### Push versus replace

They kept a small decision table: **tab change and search submission push** a history entry; **typing
and UI preference changes replace**. Ours is the same shape, arrived at independently, and is
already written down at
[url-state.md § Position replaces history](../url-state.md#position-replaces-history-deliberate-acts-push)
with Greg's reasoning: back should undo *what you did*, not crawl you back up the page.

The one place ours goes further is that **position is a section id, not an offset**
([url-state.md](../url-state.md#the-unit-is-a-section-not-a-position)) — so our URLs survive
re-extraction and reflow, where a scroll offset would not. Theirs had no scroll position in the URL
at all, which is why their pane-sync problem
([reading-view-ui.md](reading-view-ui.md#the-first-attempt-and-why-it-was-abandoned)) had to be
solved with component wiring instead.

## The command palette

Cmd/Ctrl+K opens a `cmdk`-based fuzzy palette: 12 commands in 4 categories, with the tool tabs also
reachable directly as Cmd+1…6. Cmd+B toggles the left pane. It is deliberately hidden on touch
devices. The entries were generated from the tool registry
([tool-framework.md](tool-framework.md)), which is the one genuinely nice thing that registry bought
them.

**Not worth building here yet.** A palette pays off when there are many modes to reach and no room
for buttons; we have one view with a handful of controls, all visible. Revisit if this app ever
grows a library, a settings surface, and several tools — at that point the palette is the cheap
answer and `cmdk` is the boring choice.

## Keyboard

Their bindings are conventional app chrome — Cmd+K palette, Cmd+1…6 panes, Cmd+B sidebar. Ours are
doing something different and more interesting: **↑ / ↓ step through the article, and the level they
step by is whichever column the pointer is over** ([keyboard.md](../keyboard.md)).

That is worth stating as a contrast rather than a borrowing. Their shortcuts navigate *the
application*; ours navigate *the article*. If we ever add app-chrome shortcuts, the Cmd-prefixed
convention is the right neighbourhood to stay in, precisely because it doesn't collide with the
unmodified keys the reading view has claimed.

One thing they had that we don't: a **discoverable list**. `KEYBOARD_SHORTCUTS.md` exists as
documentation, and the palette doubles as a menu of what's possible. Our arrow-key behaviour is
genuinely non-obvious — the pointer aiming the stride is a novel idea, and nothing on screen says so.
A one-line hint, or a `?` overlay, is the cheapest possible fix and is currently missing.

## See also

- [overview.md](overview.md) — the map to that codebase
- [../url-state.md](../url-state.md) — ours: the parameters, push vs replace, and why position is a section
- [../keyboard.md](../keyboard.md) — ours: arrows aimed by the pointer
- [reading-view-ui.md](reading-view-ui.md) — the panes this state drove
- [tool-framework.md](tool-framework.md) — where the palette's entries came from
