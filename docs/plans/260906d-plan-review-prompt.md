# Review: a plan to split a 15,489-line stylesheet without moving the cascade, and to make a new reader mode fail to compile

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership`, branch
`worktree-a10-style-ownership`. TypeScript + ESM, React 19 client under `src/web/`, Vite +
Tailwind v4 (prefixed `tw`, v4 colon syntax), Vitest. Nothing has been built yet — this is a
**plan review before any code is written**.

## The candidate

Live pre-commit; base `b67f3a76` (the merge of `origin/dev` this worktree sits on).

Untracked, and the only file to review:

- `docs/plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md`

**Read that plan first.** Everything below is context for judging it.

Start with, for context (all committed, unchanged):

- `src/web/tailwind.css` — 390 lines, the stylesheet entry point. Its header comment is the
  authority on the layering and every line of it is load-bearing.
- `src/web/styles.css` — 15,489 lines, every hand-written rule. Imported by `tailwind.css` as
  `@import "./styles.css" layer(app)`. Note line 27, its own `@import "../../styles/tokens.css"`,
  which inherits the layer.
- `docs/project/design-css-overview.md` — the map of the five stylesheets and which mechanism owns
  what.
- `docs/project/new-mode.md` — the checklist for adding a mode. § *The client* is the list of
  compiler-checked tables, followed by "the residue, which is why this page exists".
- `src/modes.ts` (`MODES`, 14 words), `src/title-text.ts` (`MODE_LABEL`), `src/web/visitor.ts`
  (`POLICY`), `src/web/activation.ts` (`MODE_TARGET`, line 177 — the `Partial` one),
  `src/messages.ts` (`OWNER_MODE_NOTE`).
- `tests/public-network-trace.test.tsx` line 836 (`BAND_SAYS`) — the existing precedent for a total
  `Record<Mode, …>` living in a test with independently-written literals.
- `tests/tailwind-utilities-resolve.test.ts` lines 105–170 — an existing resolver that walks the
  `@import` graph with Tailwind's own `compile()`.
- `tests/css-tokens.test.ts` lines 59–66 (`SHEETS`, hard-coded) and lines 333–360 (a grep of
  `styles.css` with a vacuity guard).

That list is where to start, not the limit of scope.

## What it is meant to do

The brief is item A10 of `docs/plans/260905e-main-app-architecture-review.md` § A10, plus its
checklist under "## Implementation stages and handoff" → "### Stage: Make style ownership visible".
Read both — they are the authority the plan is answering to, including what they say **not** to do.

The contract the work must not break:

1. **The cascade must not move.** `styles.css` is extracted into smaller sheets as *contiguous
   ranges in their original order*, imported in that order. No selector is redesigned, nothing is
   renamed, rules that share a prefix are **not** gathered together, and no visual adjustment rides
   along in the same commit. Later overrides in the file depend on intervening rules.
2. **The layering must not move.** One documented import order under `tailwind.css`'s `app` layer.
   The `tw` prefix, the `@source "../../src/web"` guard, the `@theme inline` token bridge and the
   deliberate absence of Preflight all stay. **No feature stylesheet may be imported unlayered from
   its component** — importing a sheet outside `layer(app)` makes it beat every Tailwind utility,
   silently.
3. **Global geometry tokens and stacking rules keep one home.**
4. The second half: a new mode must **fail to compile** at its presentation, visitor policy, label
   and activation decisions, and the active-mode test must render each real controller through the
   shell and check its expected surface or its deliberate absence — with **the expected behaviour
   independently written**, because deriving both the implementation and the expectation from one
   new table gives you a test that agrees with an omission.

Deliberately out of scope: the exhaustive mode-dispatch `switch` (that is item A3, owned by a
different agent working concurrently in `App.tsx`); any change to the semantic-CSS-versus-Tailwind
split; any visual change.

Four other agents are working in this repo concurrently, in their own worktrees, and one of them
holds unmerged commits in `styles.css`.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and build a
throwaway harness under `/tmp`. You have **no network, not even loopback**, so anything needing
Postgres, Supabase or a dev server will fail — I run those. There is no code to review yet, so
running anything is optional; reading `styles.css` around the line numbers the plan names is likely
more useful.

## Attack it

Independently, before you read my questions below.

**The invariant to break: "extracting contiguous ranges in original order and importing them in
that order cannot change what the browser computes."** Find the case where that is false. CSS
`@import` has rules of its own — about ordering relative to other statements, about `layer()`,
about what a nested import inherits, about what a bundler does to it — and the plan's whole safety
argument rests on them.

Then attack the *verification*: the plan claims a byte-concatenation check plus a compiled-CSS diff
plus a browser pass is enough. Find the failure it would not see.

Then attack the second half: find the fifteenth mode that this plan's tables would still let
somebody ship half-wired, and find the way the presentation test could go green over an omission.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it
        contradicts — for a plan review, a named CSS/bundler behaviour or a named file in this repo
  - (b) the smallest change that closes it: exact replacement wording for the plan
A finding with no (a) goes last.

Severity by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it. Established means direct
evidence with no unresolved material inference.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Whether a three-level nested `@import` chain (`tailwind.css` → `styles.css` → `styles/x.css`)
  reliably inherits `layer(app)` under Tailwind v4's own `compile()` and under `@tailwindcss/vite`.
  The two-level case demonstrably works today (`tokens.css`), and `tokens.css` itself imports
  `colourscales.css`, so four levels appear to work — but I have not proved that the *layer* is
  what is inherited rather than merely the resolution.
- Whether the plan's stage 1 ordering (cut one section, watch a test go red, then introduce the
  helper) is actually red-first or merely theatre.
- Whether an owner-side presentation table living in a **test file** is a real "fails to compile"
  guarantee, given that `tsc` is run by a wrapper (`npm run typecheck`) that does cover `tests/`
  but Vitest itself never type-checks.
- Whether splitting into ~20 files makes ownership *less* visible rather than more, if the cut
  points follow the existing banner comments rather than the features people actually edit.

Do not change any file.
