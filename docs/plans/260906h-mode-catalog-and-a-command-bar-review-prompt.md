# Review prompt: mode catalog and command bar (plan stage, before any code)

You are reviewing a **plan**, not code. Nothing has been built yet. The whole point of this round is
to find a bad idea now, while it costs an hour, rather than at the end of a stage.

## Repository and revision

Repo: `reading2` (product name: Spideryarn), an AI-assisted reading app.
Worktree: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar`
Branch: `worktree-worktree-command-bar`, currently at merge commit `ff060dc3` (a fast-forward merge
of `origin/dev`). Everything referenced below is committed at that revision **except** the plan doc
itself, which is untracked:

- `docs/plans/260906h-mode-catalog-and-a-command-bar.md` — **untracked, the thing under review**

## Read these, in this order

1. `docs/plans/260906h-mode-catalog-and-a-command-bar.md` — the plan under review.
2. `docs/plans/260905e-mode-catalog-and-command-bar.md` — the design brief it is executing. This is
   the authority for the long-range shape. The plan under review deliberately builds far less than
   this brief describes; judging whether the deferrals are the right ones is part of your job.
3. `docs/plans/260905e-main-app-architecture-review.md` § A3 — the parent review, which mandates
   exhaustive per-layer adapters and must not be weakened.
4. `docs/project/new-mode.md` — the checklist a new mode must satisfy today, including the
   compiler-checked total tables and "the residue nothing checks".
5. `src/modes.ts`, `src/title-text.ts` (`MODE_LABEL`), `src/web/visitor.ts` (`POLICY`),
   `src/web/activation.ts` (`MODE_TARGET`, `armActivationForMode`, `PressContext`),
   and in `src/web/Dock.tsx`: `interface ModeUi` (~line 468), `MODES_UI` (~line 516),
   `visibleModes` (~line 810), `modeInSearch` (~line 830), and the mode button `onClick`
   (~line 1729).
6. `tests/dock-experimental-modes.test.tsx` and `tests/every-mode-draws-its-surface.test.tsx`.

You may run individual test files yourself — `npx vitest run <file>` — and a finding you reproduced
outranks one you reasoned to. **Note:** you have no network and no loopback, so anything touching
Postgres or a local service will fail for reasons that are not the code's. Do not report those as
findings. Most of the files above are pure and testable without a database.

**Do not change any file.** This is a read-only review.

## What is fixed and not up for review

Four product decisions were put to the product owner (Greg) and answered on 2026-09-06. They are his
calls, they carry his authority, and re-litigating them is out of scope. They are listed in the
plan's § "The four product calls". In particular:

- v1 opens **modes only** — no passage jump, no generation rows, no chat, no model call.
- The empty state says `No command matches.` and offers **no fallback**. This overrode the
  recommendation to offer article search; do not re-recommend it.
- The bar is opened by Cmd/Ctrl-K **and** a Dock button.
- Experimental modes: the bar shows exactly what the Dock shows.

You may of course report if the *plan* fails to deliver one of these, or if a decision has a
consequence the plan has not noticed.

## What I want from you

Judge the plan on whether building it would leave the codebase in a good state, and whether it can
actually be built as described. Specifically:

1. **Is the catalog seam drawn in the right place?** The plan moves `description`, `experimental` and
   a new `aliases` into a pure `src/mode-catalog.ts`, and deliberately leaves `label` in
   `MODE_LABEL`, `icon` and `keepLabel` in `MODES_UI`, and `POLICY` and `MODE_TARGET` exactly where
   they are. Is any of those five "stays put" decisions wrong? Is any "moves" decision wrong?
2. **Does it weaken any total table the compiler currently checks?** `new-mode.md` lists them. A
   mode added after this lands must still go red in every place it goes red today. Check
   specifically that shrinking a `ModeUi` row to `{ mode, icon, keepLabel? }` does not lose the
   property that a new mode must *decide* its experimental status rather than inherit a default.
3. **Is "opens exactly as the Dock button does" actually achieved** by calling
   `armActivationForMode(slug, mode, { diagram })` then `onMode(mode)`? Read the real `onClick` and
   say what else it does that the plan has not accounted for. The activation token is nonce- and
   epoch-guarded; is there a sequence where the bar arms a token that something else spends, or
   arms one that is never spent?
4. **Is mounting the command bar from `Dock.tsx` rather than `App.tsx` sound?** The motivation is
   partly political (App.tsx is another agent's territory this week) and partly that the Dock already
   holds every input. Is there a correctness or architecture reason this is wrong? Note the Dock is
   also mounted on Metadata, Tweets and public pages, where there is no `onMode`.
5. **Are the deferrals the right ones?** The plan defers the entire typed `AppAction` vocabulary on
   the grounds that a dispatcher over one action is a dispatcher over nothing. Is that right, or does
   building v1 without it create a shape that will be expensive to unpick when the second verb
   arrives?
6. **Anything the plan will discover halfway through and wish it had known.**

## Severity scale — use exactly these

- **P0** — will break production, lose reader data, or spend money without disclosure.
- **P1** — will produce a wrong or unmaintainable design that is expensive to unpick later.
- **P2** — worth fixing, but the plan is sound without it.
- **P3** — nit, taste, wording.

Give **every finding an ID** of the form `F1`, `F2`, … and a severity. State for each: the file and
line it concerns, what is wrong, and what you would do instead. If you think a section is right,
say so briefly — I need to know what you checked and cleared, not only what you objected to.

## My own suspicions, last, so they do not anchor you

Read them only after forming your own view.

- I am least sure about **`aliases`**. Nothing in the repo has aliases today. A hand-maintained list
  of nicknames per mode is a thing that rots, and there is no compiler check that could tell me an
  alias has become wrong — only that two collide. Is there a better shape, or should v1 match on
  label and description alone and skip aliases entirely?
- I am unsure whether **`visibleModes` should stay in `Dock.tsx`**. Keeping it there means the new
  `CommandBar.tsx` imports from a 2,354-line React component. Moving it means touching five test
  files that import it from `../src/web/Dock.js`. I chose the smaller diff; I am not confident that
  was right.
- The plan claims the Stage 1 blast radius is three call sites. I measured that with a subagent
  rather than by hand. Please verify it independently.
