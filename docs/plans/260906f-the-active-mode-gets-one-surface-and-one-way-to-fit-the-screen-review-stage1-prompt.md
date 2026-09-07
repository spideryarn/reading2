# Code review: stage 1 of A5 — `ModeSurface`, piloted in Search and Chat

You are reviewing **built code**, not a plan. You already reviewed this plan twice (rounds 1 and 2,
findings F1–F14); all were accepted and the plan was revised. This is the first stage of it.

Weight this review higher than the plan reviews: a plan review cannot see a guard that is wrong for
`false`, and one of those was in this code an hour ago.

## Where everything is

Worktree: `/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface` (branch
`worktree-a5-mode-surface`). Read files directly.

- **The plan** — `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md`.
  §§ *What gets built*, *Design decisions*, *Stage 1* are the contract this code is judged against.
- **The Chrome baseline** —
  `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-baseline.md`,
  captured at commit `6dacbd2e84ff0fd52df91c5464d0911541260dff`, **before** the migration.
- **The new component** — `src/web/ModeSurface.tsx`.
- **The two pilots** — `src/web/SearchPanel.tsx` (band at ~line 279) and `src/web/ChatPanel.tsx`
  (band at ~line 443).
- **The acceptance test** — `tests/mode-surface-changes-no-markup.test.tsx`.
- **The scoped diff of the three source files** against the pre-migration parent is at
  `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/a5-stage1.diff`
  if a diff is easier to read than the files.

## What stage 1 claims

1. `ModeSurface` renders **the same DOM the panels rendered before** — no wrapper, no padding, no box
   of its own. Search's band fits with **zero slack** (baseline), so a hairline of padding would be
   absorbed by `.srch-hits` (`flex: 1 1 0%`) and show up only as one pixel of scrollbar.
2. It owns **only** the container: the `<aside>`, its required `aria-label`, an optional `head`
   rendered as today's `.band-head`, the children unwrapped, an optional `foot` unwrapped.
3. It is **not** an error boundary and must not become one — `FeatureBoundary`'s fallback keeps its
   own raw `<aside className="mode-band">` as a circuit breaker (your F4).
4. It carries **no viewport code at all**, not even an inert version (your F7).
5. It forwards a `ref` and a passthrough of standard `<aside>` attributes, because `OutlinePanel`
   writes a ref, a `data-outline-rung`, its own padding and two custom properties onto the band.

## State of the checks

- `npm run typecheck` — green.
- `tests/mode-surface-changes-no-markup.test.tsx` — 9 tests, green.
- The nine existing Search/Chat panel suites — 79 tests, green.
- The eight band-wide suites (`every-mode-draws-its-surface`, `referee-band-fits`, `outline-panel`,
  `public-network-trace`, `a-broken-mode-leaves-the-article-readable`, `spine-width`,
  `styles-entry-is-imports-only`, `table-selectors-are-scoped`) — 150 tests, green.
- `npm test` and `npm run check` were running at the time of writing; if either is red I will say so
  rather than let this stand on a claim.
- `npx biome lint` on the three source files: one pre-existing warning at `SearchPanel.tsx:253`,
  present before this work (verified against the parent commit), untouched.

## Two defects already found and fixed here, for calibration

Both were found by reading, not by a failing caller, and **neither had a caller in stage 1** — both
were waiting for stage 2:

- `head != null` is **true for `false`**, and `head={cond && <X/>}` is how a conditional header is
  written. It rendered an empty `.band-head`: invisible, and one extra slot in front of every band
  that styles its first child by position. Guard is now `head != null && head !== false`.
- `` `mode-band ${feature}` `` produced **`class="mode-band undefined"`** for a band with no hook
  class. Two real bands have none: `PublicChrome`'s visitor band and `FeatureBoundary`'s fallback.
  `feature` is now optional and the class is `feature ? \`mode-band ${feature}\` : "mode-band"`.

Both are pinned by tests, and both tests were watched going red against the old code.

## What I want from you

Find what is still wrong. In particular:

1. **Is the rendered DOM genuinely unchanged** for both pilots, in every branch each panel can take —
   not just the one the test mounts? Search has visitor/owner branches and a `meaning`/`words`
   matcher; Chat has open/list, `chat`/`remember`, error and live-dictation branches. **Read the
   pre-migration code in the diff and compare branch by branch.** A dropped conditional class, a
   changed element order, a lost `key`, a fragment where an array was — anything the test's three
   mounted shapes do not reach.
2. **Is the acceptance test honest?** It is the whole evidence for stage 1's claim. Does it derive
   any expectation from the implementation? Can it pass while the DOM has changed? Are the literals
   actually what the baseline records? Is there a shape it should mount and does not?
3. **The passthrough type.** `PassThrough = Omit<HTMLAttributes<HTMLElement>, "className" |
   "aria-label" | "children">` with `{...rest}` spread **before** `ref`, `className` and
   `aria-label`. Is there an attribute a caller could pass that breaks the invariant — an `id`,
   `role`, `style`, `onKeyDown`, a `dangerouslySetInnerHTML`? Should the spread be after? Is
   `Omit`-ing `className` enough to stop a caller adding a second class list?
4. **Chat keeping `Conversation` whole in `children`** rather than splitting its composer into
   `foot`, and Search passing **no** `head` at all. Both are deliberate and documented. Are they
   right, given `foot` exists for four other panels in stage 2?
5. **Anything that makes stage 2 harder or unsafe** — an interface that the remaining ten panels and
   `VisitorBand` cannot adopt without adding DOM. `OutlinePanel.tsx:308` is the hard case; check the
   component can actually carry what it needs.
6. Anything else: correctness, accessibility, React 19 specifics, dead code, a comment that says
   something the code does not do.

## Ground rules

- **Check claims against the source.** Several of my earlier claims were wrong and you caught them;
  assume the same rate here. Say for each finding whether it is **established** (you read the code
  and it is definitely so) or **reasoned** (it follows but you did not confirm every step).
- Severity **P0/P1/P2/P3**, stable IDs continuing from F14 — start at **F15**.
- A clear **verdict**: accept, or refuse as written.
- Out of scope: the viewport fit arithmetic (stage 4, blocked on a device measurement), the A6
  Escape work (stage 3), migrating the other ten panels (stage 2), and the mobile redesign (not
  authorised). Say so if you think one of those is being pre-empted by this code.
