# Third pass: the two changes made in response to your code review

You reviewed the plan, then the built diff (`260908e-code-review-sol-1245.md`, verdict "land it with
changes"). This is a short review of **only the delta since that review**. Be adversarial; I am
about to land this.

## What changed since you last looked

`git diff` against the tree you reviewed. Four of your five findings were applied as you described
and need no re-review (the stale specificity paragraph, the `overscroll-behavior` wording, the
per-occurrence test assertion, and confirming `:focus-within` is gone). **Two are new code.**

### 1. Your finding 1 — the 56px strip. New token `--hint-now`.

You were right and I reproduced it: on an uninstalled iPhone in a side-by-side band mode, scrolled,
the band stopped 56px above the bottom with nothing under it.

The fix follows your suggestion of a "current hint clearance" distinct from the permanent
reservation:

- `tokens.css` — new `--hint-now: var(--hint-h)`.
- `narrow-window.css` § a small device — a new `:root` rule setting `--hint-now: 0px` under the
  *same* condition as the rule that translates `.install-hint` away.
- `mode-band.css` and `table.css` — the two `bottom: calc(max(var(--dock-bottom),
  var(--safe-bottom)) + …)` expressions now read `--hint-now` instead of `--hint-h`.
- `--hint-h` is unchanged, and still what `.reader`'s `padding-bottom` and the three dialogs read.

**Questions.** Is `--hint-now: var(--hint-h)` on `:root` in `tokens.css` correctly re-resolved after
`dock.css`'s later `:root:has(.install-hint) { --hint-h: 3.5rem }` raises it — i.e. does
`--hint-now` compute to 3.5rem, not 0? Does the new `:root` rule's specificity ((0,2,0) vs
tokens.css's (0,1,0)) win everywhere it must and nowhere it must not? Are there **other** consumers
of `--hint-h` that are positioning against the *current* bottom and should have moved too — I moved
exactly two; check `annotations.css`, `dialogs.css` and `dock.css` and tell me if any of those is
really a "current" reader wearing a "resting" name. And is there any path by which `--hint-now`
changing could feed back into document height and therefore into `stepBar`?

### 2. Your finding 2 — `shell.css`, the visitor's top bar.

Applied as you prescribed. Both bare `.mode-band` conditions now read
`:where(.reader.band-covers) .mode-band`:

- the `--bar-bottom` / `--bar-hide` guard;
- `:root:has(…) .controls { transition: none }`.

**Questions.** Is the specificity genuinely unchanged in both (I claim (0,4,0) and (0,3,0))? The
first rule's leading `:has(:where(.reader) > .controls)` was added by a different plan for a
different reason — does adding `.band-covers` to the second `:has()` interact with it, or with the
`:root:not(:has(.controls))` rule it was written to out-rank? And is there a state where a visitor
now *needs* the pinned bar that this takes away — remembering the read-only chip is the only thing
in their bar, and unlike the dock it is not a way out of anything.

## Measurements

Headless Chrome, 844 × 390, the article from the report, real wheel events, each case measured with
the fix and with the pre-fix rule forced back:

| case | pre-fix | with the fix |
|---|---|---|
| install hint: gap between band bottom and viewport bottom | **56px** | **0** |
| visitor bar: `.controls` top, scrolled, `data-bars="hidden"` | **0 (pinned)** | **−44 (gone)** |

Both configurations are reproduced by injecting the element (`.install-hint` in the body, `.controls`
as first child of `.reader`), because both are pure DOM conditions as far as CSS is concerned. Tell
me if that is not a faithful reproduction of what those two readers actually get.

## State of the gates

`npm run typecheck` clean. `npm test`: 864 of 867 files pass; the 2 failures are
`cold-start-lazy-imports` and `pdf-bundle-trace`, both asserting *"api-dist/vercel.js is missing —
run `npm run build`"*, which is what a worktree without a build always reports. All 21 test files
that read the stylesheets re-run green against the final tree (335 tests).

Verdict: land it, land it with changes (name them), or do not land it.
