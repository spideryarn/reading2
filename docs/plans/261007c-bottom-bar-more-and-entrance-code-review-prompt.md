# Code review: 261007c — a More button gathers five modes; the bottom bar rises in on first load

Repo: this worktree, TypeScript + ESM, React client under `src/web/`. Branch off `dev`.

## The candidate

Committed: commit `6c788fd51` (parent `ddbd2c86a`, which is the plan and its review).

    git diff ddbd2c86a..6c788fd51
    git diff --stat ddbd2c86a..6c788fd51     # the complete manifest, 47 paths

Start with: `src/web/Dock.tsx` (`splitForMore`, `DockBar`, `fitSignature`, `DockMore`, `MORE_OPEN`,
the drawer's Escape handler, `DockModes`, `DockModeLinks`), `src/web/reader/dock-entrance.ts`,
`src/web/menu.ts`, `src/web/styles/dock.css` § the entrance, `src/web/styles/narrow-window.css`
(the `:root:has(...)` keep-home list), `tests/dock-more.test.tsx`, `tests/dock-entrance.test.tsx`,
`tests/helpers/dock-more.ts`. That is where to begin, not the limit of scope; the manifest is.

## What it is meant to do

The plan is the contract:
`docs/plans/261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md`
— decisions D1 to D7, the section "GPT Sol's plan review" (PR-1 to PR-10, all accepted), and the Log
at the end, which lists what the builder decided beyond the plan (a non-modal menu, a description
line in each item, focus after a mouse pick, ↓ on More). Read those as claims to check.

In short: Quotes, Glossary, FAQ, Ideas and Timeline leave the bar for a Radix menu opening upwards
from a More button that is outside the radiogroup; an open gathered mode is still drawn as a radio;
`visibleModes` is still the reachable set and feeds the command bar; the menu holds the phone bar
home; and the first `Reader` mount of a page load plays a one-off entrance that never animates
`transform`, is off under reduced motion, and covers the install hint.

Invariants that must not break: exactly one radio checked in the radiogroup whatever mode is open;
every mode a reader could reach from the bar before is still reachable (bar, More, or command bar),
for an owner, a signed-in visitor and a signed-out visitor, on the reading view, Metadata and the
public pages; a second press on the open mode closes it; the fit ladder and the coarse-pointer
shares count what is drawn.

Out of scope: which modes are experimental; a Marginalia filter; whether the product decision is
right.

## What you can run, and what you may change

You may edit this worktree. **Fix what is inside this change, narrowly and red-first** (the test
that reproduces it, seen failing, then the fix), and leave anything wider as a finding for me to
decide. Do not commit. List every file you changed at the end.

You can run one test file at a time (`npx vitest run tests/<one>.test.tsx`) and
`node --import tsx <script>`. No network, not even loopback, so nothing needing Postgres or a dev
server; no browser. I have run `npm run typecheck` (clean) and these, all passing:
`tests/dock-more.test.tsx tests/dock-entrance.test.tsx tests/command-bar.test.tsx
tests/doc-links.test.ts tests/help-page.test.tsx`. The builder reports 104 Dock-naming test files
passing. A real-browser pass is running separately.

## Attack it

Independently, before reading my suspicions.

1. Break an invariant above: give the input, URL or sequence of presses.
2. For each updated test in the manifest: was an assertion weakened to get green, or does a sweep
   now cover less than its name claims? `tests/helpers/dock-more.ts` is new shared test code; is it
   right, and can a sweep through it pass while visiting nothing?
3. Are the docs changed in this commit accurate about the code (`docs/project/interface-vision.md`,
   `mode.md`, `reading-view-overview.md`, `keyboard.md`, `narrow-windows.md`, `phone-and-touch.md`,
   `experimental-features.md`, `web-client.md`) and is the reader's help
   (`src/web/help/help-topics.tsx`)?
4. `src/web/menu.ts` was lifted out of `ShelfEntry.tsx`: is the shelf's menu unchanged in behaviour?
5. `scripts/measure-cpu.ts` was edited and never run: read it as code that has not executed.

For each finding: an ID continuing the chain (**start at `CR-1`**), a severity, established or
reasoned, (a) the input or mutation that shows it, (b) the smallest change that closes it (and say
whether you applied it).

| | |
|---|---|
| **P0** | data loss, security, or the reading view broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1 that you could not fix. End with one line:
`VERDICT: approve` / `VERDICT: approve with the changes I made` / `VERDICT: do not land`.

## My own suspicions — read last

Already my doubts; confirming them is worth less than what you find yourself.

- `modal={false}` on the menu against the drawer's Escape handler and the other dialogs.
- `useDockEntrance` when `Reader` remounts inside the first 1.6s, and `animation ... forwards`
  leaving `opacity` and `translate` held on `.dock` for the life of the page.
- The `Tooltip` around a Radix `Trigger asChild` (ref and prop merging).
- The description line in each menu item at 390px.
