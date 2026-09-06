# Review prompt: the shelf table plan

You are reviewing a plan before it is built, for a React + TypeScript reading app called Spideryarn.

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks`

Please read these files yourself:

- `docs/plans/260906g-the-shelf-table-is-ugly-because-the-reading-view-s-css-leaks-into-it.md` — **the plan, the thing under review**
- `src/web/lib/DataTable.tsx` — the reusable table wrapper
- `src/web/ShelfControls.tsx` — the cards/table toggle
- `src/web/library-columns.tsx` — the shelf's column definitions
- `src/web/Library.tsx` — the homepage; see the render section around lines 380–470
- `src/web/styles.css` lines 795–1000, 1660–1710 and 4170–4190 — the leaking rules and two of the workarounds
- `src/web/tailwind.css` — Tailwind v4, `tw:` prefix, dark-only, the token bridge
- `AGENTS.md` — the house rules: "prefer boring", "prefer simple over easy", "simplest version first"

## Context you need

- The app is **dark only**. No light mode, no toggle.
- Tailwind v4 with a **`tw:` prefix on every utility** (`tw:flex`, `tw:hover:bg-card`). Unprefixed
  names do nothing. A utility whose theme key is missing from the `@theme inline` bridge in
  `tailwind.css` **emits no rule at all** — silently. `tests/tailwind-utilities-resolve.test.ts`
  guards this.
- Preflight is deliberately **not** imported.
- TanStack Table v8, headless. `radix-ui` and shadcn (`button`, `toggle` only) are available.
- There are exactly three `<table>` elements in the app: the reading view's `table.zoom`
  (`TableView.tsx`), `table.design-table` (`DesignPage.tsx`), and the shelf's table
  (`lib/DataTable.tsx`) — plus any `<table>` inside article prose (`.prose table`).

## What I most want from you

1. **Is Stage 1 right, and is it safe?** Scoping `thead th` and `td` to `table.zoom`. Specifically:
   is `table.zoom` the correct scope for **both** rules, or does the reading view rely on those
   declarations reaching some element that is not inside a `table.zoom`? Check `TableView.tsx` and
   `useColumnContext.ts`. Are there other unscoped element selectors in `styles.css` that are the
   same bug and that this plan misses? What breaks when the `td` rule stops applying to `.prose` and
   `.design-table` — both currently override it, but do they override **all** of it?

2. **Is the proposed regression test the right guard**, or will it be either unenforceable or so
   noisy it gets deleted? `styles.css` is ~12,800 lines and was written over weeks. If a
   "no unscoped element selectors" rule would fail on 40 existing rules, say so and propose what
   would actually hold.

3. **The declined recommendation.** The research said to copy shadcn's `Table` primitive file in as
   a shared wrapper; the plan declines on the grounds that `lib/DataTable.tsx` already *is* that
   wrapper. Is that reasoning sound, or is it self-justifying?

4. **Stage 3's row cap.** `DataTable` gets an optional `limit` and slices the rows it was handed. Is
   putting the cap inside the shared table component the right seam, or should the caller slice?
   Note that `Library.tsx` computes `sorted` through two `sinkLast` passes and hands the result
   down. Also: the expanded state is component-local and does **not** reset when the search query
   changes — is that going to feel broken?

5. **Stage 4's toggle.** The plan hand-rolls a `role="radiogroup"` rather than using Radix's
   `ToggleGroup type="single"`. Argue the other side if you think it is wrong. Is a hand-rolled
   two-option radiogroup with roving tabindex actually as small as the plan claims, and what does it
   have to get right that the plan does not mention?

6. **Anything the plan is wrong about, or any risk it does not name.** In particular, check the
   claim in Stage 2 that `overflow-x: auto` forces `overflow-y` to `auto` and therefore breaks a
   page-level sticky header — is that accurate per spec, and does it actually apply to this markup?

7. Is there anything in the plan that is **more complexity than the request warrants**? The house
   rule is simplest-version-first, and the user explicitly said pagination would be overkill.

Be concrete and specific. Cite `file:line`. Say clearly which findings are certain and which are
guesses. It is more useful to tell me three things that are actually wrong than twelve that might be.
