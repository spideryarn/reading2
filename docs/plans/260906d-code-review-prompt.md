# Review: the built A10 work — a 37-way stylesheet split and a tightened mode contract

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership`, branch
`worktree-a10-style-ownership`. TypeScript + ESM, React 19 client, Vite + Tailwind v4 (prefixed
`tw`), Vitest.

You reviewed the **plan** for this in two rounds (`260906d-plan-review-sol.md`,
`260906d-plan-review-round2-sol.md`). **This is the code.** Weight it higher than the plan review:
a plan-stage review cannot see a guard that passes over an empty match.

## The candidate

Committed, three commits, in order:

```
a5fbf4f1  A fifteenth mode now has to say whether pressing it spends money
6ec9e0ad  Thirty-seven files that say where a rule belongs, and the same cascade
ffa12f4e  A mode that draws nothing, and a press that buys nothing, now fail

git diff a5fbf4f1~1..ffa12f4e
git diff --stat a5fbf4f1~1..ffa12f4e     # the complete manifest
```

Start with, and this is where to begin rather than the limit of scope:

- `src/web/activation.ts` — the tagged activation union and `armActivationForMode`
- `tests/every-mode-draws-its-surface.test.tsx` — the new owner sweep (`SPENDS`, `DRAWS`)
- `tests/helpers/stylesheets.ts` — the `@import`-graph resolver the migrated tests now use
- `tests/styles-entry-is-imports-only.test.ts` — the manifest guard
- `src/web/styles.css` (now 65 lines) and any two or three of `src/web/styles/*.css`

## What it is meant to do

**Half one.** `src/web/styles.css` was 15,489 lines; it is now 65 lines of `@import` over 37 sheets
under `src/web/styles/`, each a contiguous slice in the original order **plus a header comment**.
No selector redesigned, nothing renamed, no rules gathered by prefix. The cascade must be
unchanged.

**Half two.** A new mode must fail to compile at its activation and presentation decisions, and the
owner sweep must render the real controller and check its real surface — with the expectation
**independently written**, never derived from the implementation.

## Evidence I have already established — check it rather than repeat it

- The 37 ranges tile lines 29–15489, no gap or overlap; every cut is at brace depth 0 and outside a
  comment; concatenating the slices reproduced the original **byte for byte** at cut time.
- `tailwindcss` `compile()` output: **identical** before and after.
- `npm run build` CSS: **identical**, md5 `733c807548da26925bd8b120d7c026ac`, and Vite's
  content-hashed asset name did not change.
- Headers added afterwards: **286 lines added, 0 deleted**, verified by stripping them and diffing
  the concatenation against `git show a5fbf4f1:src/web/styles.css`.
- Browser, 10 surfaces × 2 widths, dev mode: 0 computed-style differences, identical root
  variables, all rects identical bar one whose top moved 22.7px while its height grew 22.7px (a
  bottom-anchored dialog off a scripted text selection — both runs sum to exactly 792.00).
- Mutations that went red and were restored: a `fixed` activation row → `none`; Diagram's
  `delegated` arm ignoring `ctx`; `QuotesPanel`'s body emptied against a **populated** fixture with
  shell, band-head count and hidden copies intact.
- Adding a fifteenth `Mode` is red at `SPENDS`, `DRAWS`, `MODE_LABEL`, `OWNER_MODE_NOTE`,
  `MODES_UI`, `POLICY`, `MODE_TARGET` and `BAND_SAYS`.

## What you can and cannot run

Tree read-only; `/tmp` and `node_modules` caches writable. **No network, not even loopback**, so
anything touching Postgres, Supabase or a dev server will fail — those are mine and the results are
above. You can run a jsdom test file, e.g.:

```
npx vitest run tests/every-mode-draws-its-surface.test.tsx
npx vitest run tests/styles-entry-is-imports-only.test.ts
```

A finding you reproduced outranks one you reasoned to.

## Attack it

Independently, before my suspicions below.

The two claims to break:

1. **"The cascade is unchanged and the guards would catch it if it were not."** The static evidence
   is strong, so aim at the *guards* and the *tests* rather than at the bytes: find the migrated
   test that now passes over nothing, the vacuity guard that a rename would satisfy, the assertion
   that got weaker in the move. One such guard was already found and fixed during the work — a
   `toContain(".crit-how")` that `.crit-how-x` satisfies — so assume there are others.
2. **"A fifteenth mode cannot be shipped half-wired."** Find the way. Both new tables are total, but
   totality is not the same as correctness: find the row somebody could write that typechecks, runs
   green, and is a lie. Look hard at `SPENDS`' `delegated` variant and at whether `DRAWS`' `says`
   values really are body literals rather than chrome that survives an empty state.

Then: is `tests/helpers/stylesheets.ts` right? It restricts to `src/web/` and excludes
`styles/tokens.css`, which was deliberate (to keep the migration a no-op) — is that defensible, or
does it now hide something?

Severity by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

For each finding: an ID, a severity, established or reasoned, (a) what shows it fails its own claim
— the input or mutation I can run — and (b) the smallest change that closes it. A finding with no
(a) goes last. Refuse only on an established P0 or P1, and name what established it.

**IDs continue from F10.** Number new findings F11 upward; reuse an ID only for the same finding.

## Previous findings

All eight from round one and all five from round two were accepted and fixed; the dispositions are
in `docs/plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md` § Reviews.
F5 and F6 were still open at the end of round two and their fixes are **in this code and have not
been reviewed** — the executable `delegated` variant carrying an `arm` function, and the two-phase
sweep with a non-nullable `DRAWS`. Those two deserve most of your attention.

## My own suspicions — read last

- Whether `SPENDS`' `delegated` variant is genuinely executable-checked or has become a second
  description.
- Whether twelve populated fixtures in one file makes the sweep so heavy that a later author will
  weaken it rather than extend it.
- Whether splitting `narrow-window.css` as one 923-line file (the mega-section plus its children
  plus the nested coarse-pointer block) was right, given it holds nearly every cross-file override.
- Whether the nine "sections that are not where their name says", recorded in the plan but not
  moved, should have been moved.

Do not change any file.
