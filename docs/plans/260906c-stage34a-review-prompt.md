# Review: Reader and article access extracted, and six copies of a passage lifecycle made one hook

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition`, branch
`worktree-a1-a3-reader-composition`. TypeScript + ESM + React 19 + Vite + vitest/jsdom.
`strict` and `noUncheckedIndexedAccess` on.

## The candidate

Committed, three commits:

```
f8903313  App.tsx is 407 lines and does one job, and a guard now says so       (stage 3)
96088337  Three guards that had stopped guarding, and one that never could      (your F15–F19)
14c1d79c  Six copies of three rules become one hook, and StrictMode hid the bug (stage 4a)
```

```sh
git diff f8903313~1..14c1d79c
git diff --stat f8903313~1..14c1d79c   # the complete manifest
```

Start with `src/web/passage-lifecycle.ts`, `tests/passage-slot-hand-off.test.tsx`,
`src/web/reader/Reader.tsx`, `src/web/article/`, and
`docs/postmortems/260906d-one-publication-slot-two-producers-two-commit-phases.md`.
That is where to begin, not the limit of scope — the manifest above is.

**The full list of edits that are not byte-identical relocations**, because last time my prompt
under-described this and you were right to call it: stage 3 moved `Reader`, `useReadingPosition`,
`useWindowWidth`, `useRootFontPx` and the whole article-access unit, with `function X` →
`export function X` on seven of them and `const` → `export const` on `OWNER_HAS_EVERYTHING`;
`App.tsx`'s import block was pruned from `tsc --noUnusedLocals`' own list; ten source-text tests were
repointed; `tests/sanitize-client.test.ts` had a real defect fixed (see below). Stage 4a is **not** a
relocation at all — it rewrites the publish/clear/invalid-key effects in six producers.

The plan is `docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md`.
You have reviewed it twice (`260906c-plan-review-sol.md` F1–F8, `-sol-2.md` F9–F13) and reviewed
stage 1 once (`260906c-stage1-review-sol.md` F14–F20). The authority above all of them is
`docs/plans/260905e-main-app-architecture-review.md` §§ A1, A3.

## What it is meant to do

**Stage 3** finishes A1: `src/web/App.tsx` goes 3,599 → **407 lines** and exports only `App` — route
choice, session subscription, persistent services. `Reader` and the position hooks are in
`src/web/reader/`; the article-access unit is in `src/web/article/`. Two steps in that order because
each is independently cycle-free. `tests/reader-import-direction.test.ts` is new and enforces **both**
halves of A1's rule (your F11): no feature file imports `App.tsx`, and no `modes/<feature>/` imports a
different one.

**Stage 4a** is the first half of A3. `usePassageLifecycle` in `src/web/passage-lifecycle.ts` takes the
three rules identical across six producers — publish in a layout effect before paint, drop an
`openKey` no longer in `found`, clear on the way out — discriminated three ways (`keyed` / `derived` /
`unkeyed`), and leaves per-mode policy alone. The unmount clear is now a **layout** cleanup for every
producer, which is your F10.

**The plan was corrected in this stage and you should check the correction.** It claimed the Referee
sub-mode bug was live. It is latent: both producers publish an *empty* list in their first layout
effect, so the outgoing passive clear overwrote empty with empty. The class is live, because
`SearchBand` publishes `findLiteral` marks synchronously from `?find=` on its first commit. So the red
proof is `tests/passage-slot-hand-off.test.tsx` — two stand-in producers carrying the real effect
shapes, swapped in one slot the way `RefereeSubMode` swaps its bands. **Your F9 was reproduced in the
same run**: the StrictMode variant passed against the same broken code the other two failed against.

Invariants that must hold:

- five `Found[]` producer slots stay five; no sixth, no owner tokens, no merging;
- **callback identity** — the unmount effect depends on `[onFound, onOpenKey]`, so a per-render
  identity turns an unmount clear into an every-render clear
  (`tests/passage-mode-cleanup.test.tsx` lines 33–46);
- no `readerContext` bag and no whole-app context;
- article access and reading-position code untouched by anything else;
- the band dispatch and the `passages`/`openPassage` ternaries in `Reader.tsx` are **deliberately
  unchanged** — that is stage 4b, in flight now, and out of scope here.

## What you can and cannot run

Tree read-only; `/tmp` and node_modules caches writable. You can run test files
(`npx vitest run tests/<one>.test.tsx`) and build throwaway harnesses under `/tmp`. No network.

I ran on this exact tree: `npm run typecheck` clean (1,415 files, four projects); 12 files / 195 tests
green, including `passage-slot-hand-off`, `passage-mode-cleanup`, `site-footer`,
`referee-copy-is-about-the-model`, `eager-client-graph`, `glossary-band-wiring`,
`reader-import-direction`, `doc-links`, `referee-criteria-panel`, `referee-claims-band`,
`a-broken-mode-leaves-the-article-readable`, `public-network-trace`. Pre-existing failures on this
worktree, established before any of this work and none in this area: `admin-store` ×2,
`hierarchy-deepen-wave`, `pdf-source-parsed-once`, `store-export-fails-closed`, `chat-web-links`, and
four in `shelf-action-tooltips` — timeouts under a load average of ~100, plus another agent's shelf work.

## Attack it

Independently, before you read my questions.

The invariant to break: **is there any reader-visible behaviour change in these three commits that
nobody intended, or any check that used to bite and now does not?** Two shapes are worth your time:

1. **The lifecycle rewrite is not a relocation.** Six producers had their effects replaced. Does the
   helper preserve each producer's exact timing, dependency set and clear semantics — including
   Quotes' single-layout-effect guarantee, Search's different prop names, and Claims having no key?
   Is there a producer whose behaviour changed in a way no test asserts?
2. **A guard that no longer guards.** `tests/reader-import-direction.test.ts` is new; is it
   mutation-sensitive in both rules, does its resolver fail closed, and can a walk that has stopped
   walking pass it? Same question for the `site-footer` and `eager-client-graph` repairs.

Also: `tests/sanitize-client.test.ts`'s "the client never imports the jsdom-bound sanitiser" check was
`/(\.\.\/)+sanitize\.js/` — it asked how many levels an import climbs, not where it lands. It now
resolves and compares paths. Is the replacement right in **both** directions, and does its count
control actually fail when the scan matches nothing?

For each finding: an ID (**numbering continues above F20**), a severity, established or reasoned,
(a) the input or mutation that shows the failure, (b) the smallest change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A finding with no (a) goes last. Refuse only on an **established** P0 or P1, and name what
established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. The helper branches on `kind` *inside* each of three effects so hook order is constant, and reads
   deps off the input's fields rather than the object. Is there a shape where an effect silently stops
   firing, or where `NO_KEY_TO_SET` (the stable stand-in for `unkeyed`'s missing setter) misbehaves?
2. Making the unmount clear a **layout** cleanup for *every* producer was your F10. Does that move any
   observable work before paint that the passive version deliberately left after it?
3. The postmortem names the introducing commit as `9b636cc1`. Is that right?
4. Stage 3 landed as one commit though the plan said two, because separating them afterwards would
   have meant reconstructing an intermediate `App.tsx` that never existed on disk. Does that cost
   anything real?

Do not change any file.
