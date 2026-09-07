# Review: a plan to split a 5,920-line React file into article access, reader composition and mode controllers

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition`, branch
`worktree-a1-a3-reader-composition`. TypeScript + ESM + React 19 + Vite + vitest/jsdom. Client code
is under `src/web/`; tests under `tests/`. `strict` and `noUncheckedIndexedAccess` are on.

## The candidate

Live pre-commit; base `0977d6f6`. **No code has been written.** The candidate is one untracked
document:

- `docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md`

Read it first, in full. Then read, in this order:

- `docs/plans/260905e-main-app-architecture-review.md` — §§ A1, A3, and the checklist under
  *"Stage: Separate article access, reader composition and mode controllers"*. **That checklist is
  the authority the plan must satisfy.**
- `docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md` — the immediately prior
  piece of work (item A2), whose shape this plan says it follows.
- `src/web/App.tsx` — the file being split. `Reader` is lines 1647–3666; the band dispatch is
  3307–3568; the `Found[]` states and the `passages`/`openPassage` ternary chains are 2252–2371.
- `src/web/modes/ideas/IdeasMode.tsx` — the one controller already extracted, and the target shape.
- `tests/passage-mode-cleanup.test.tsx` — the executable form of the contract stage 4 touches.
- `src/web/CriteriaPanel.tsx` and `src/web/ClaimsPanel.tsx` — the two Referee producers.
- `src/web/visitor.ts` (§ `visitorGap`, and the `never` idiom), `src/modes.ts` (the 14 modes).

This is where to begin, not the limit of scope.

## What it is meant to do

`src/web/App.tsx` holds seven unrelated jobs — route choice, session services, article access
resolution, the reading view's composition, reading position, and nine feature controllers. The plan
moves them apart along seams that already exist, in four stages, **without changing behaviour**, and
then (stage 4) makes two things that no compiler currently checks into things it does:

1. the band dispatch — today seventeen sibling `{cond && <Band/>}` expressions — becomes an
   exhaustive `switch` on `mode` with a `never` default;
2. `passages` / `openPassage` — today two independent ternary chains whose last arm hands **ten of
   the fourteen modes** Search's results — become one total function returning `{ found, openKey }`
   together.

Invariants it must not break:

- **The five `Found[]` producer slots stay five.** They are separate because an outgoing producer's
  *passive* unmount cleanup must not erase an incoming producer's *layout-effect* publication. The
  review forbids merging them in this stage.
- **Cleanup callback identity.** `tests/passage-mode-cleanup.test.tsx` (lines 33–46) states that the
  unmount effects depend on `[onFound, onOpenKey]`, so a per-render identity turns an unmount clear
  into an every-render clear — which the suite would still pass except for one assertion.
- **No `readerContext` bag, no whole-app context** whose value changes on keystroke or scroll, and no
  claim that a sixteen-value object is a smaller interface. The review says this explicitly.
- **Feature files must not import `App.tsx`.**
- Article access and reading-position code must be *untouched* by the acceptance exercise (adding a
  fixture mode).

Deliberately out of scope: a single reader-scoped publication slot with owner tokens; a renderer
table replacing the switch; lazy-loading mode code; any product change.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/passage-mode-cleanup.test.tsx`) and build a throwaway harness under `/tmp`.
You have no network, not even loopback. Nothing in the files above needs Postgres.

Baseline I ran on this tree at `0977d6f6`: `npm run typecheck` clean; twelve affected test files
green, 153 tests — `tests/{passage-mode-cleanup,a-broken-mode-leaves-the-article-readable,public-network-trace,remember-url-rules,conversation-band-send-new,glossary-band-selection,referee-tooltips,pressing-a-chip-arms-it,arrows-belong-to-the-article,the-ideas-extraction-changed-no-requests,eager-client-graph,referee-how-card}`.

## Attack it

Independently, before you read my questions below.

The invariant to break: **is there any sequence of the plan's four stages that lands a commit which
compiles and passes the suite while quietly changing what a reader sees, or while silently disarming
a test that was protecting something?** This repo has a written history of checks that reported
success while doing nothing (`docs/reusable/silent-success.md`), and a dozen tests here read
`App.tsx` as a *string* and slice it with `indexOf` — a slice whose anchor has moved to another file
asserts about an empty string and goes green.

For each finding give:

- an ID (`F1`, `F2`, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
- (b) the smallest change that closes it — exact replacement wording for the plan, or a code block

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A finding with no (a) goes last. Refuse only on an **established** P0 or P1, and name what
established it. Established means direct evidence with no unresolved material inference.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

1. **The ordering inversion.** The review's checklist says access first, then `Reader`, then the
   controllers. I build leaves-first (controllers → `Reader` → access) because the stated order puts
   an import cycle in every intermediate commit. Is that reasoning right, and is the inversion
   actually a deviation worth recording, or did I misread the checklist as an ordering constraint
   when it is a list of things?
2. **`band()` as a local function inside `Reader`.** It closes over `Reader`'s scope and calls no
   hooks. Does that create any React correctness problem I have missed (reconciliation identity,
   `key`s, the `FeatureBoundary` around Ideas, the `key={mode}` on `ConversationBand`)? Is a `switch`
   returning `null` for `plain`/`hierarchy` really equivalent to seventeen sibling `&&` expressions —
   in particular, does anything depend on **two** of those siblings rendering at once?
3. **The lifecycle helper's effect dependencies.** I propose one `useLayoutEffect` whose dep array is
   `[found, kind === "derived" ? openKey : null, onFound, onOpenKey]` so that only the `derived` shape
   republishes on a key change. Is a dep array with a conditionally-computed element sound here, or
   is there a shape where it silently stops firing?
4. **`selectPassages` returning a fresh object.** The array identities inside it are preserved, and
   the object is destructured immediately, so I claim the downstream memos are unaffected. True?
5. **The Referee sub-mode bug.** Criteria (keyed, layout publish) and Claims (unkeyed, passive
   unmount clear) share `refereeFound`. I claim claims → criteria wipes Criteria's marks after paint.
   Is that ordering claim correct for React 19, and is my proposed sixth-slot fix the smallest one?
6. **Stage 3 does two moves in one commit** (`Reader` and the access unit). Is that a stage that ends
   at a good stopping point, or should it be two?

Do not change any file.
