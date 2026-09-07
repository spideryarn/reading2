# Review round 2: the plan to split App.tsx into article access, reader composition and mode controllers

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition`, branch
`worktree-a1-a3-reader-composition`. TypeScript + ESM + React 19 + Vite + vitest/jsdom.

## The candidate

Live pre-commit; base `0977d6f6`. Still **no code has been written**. Untracked files:

- `docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md` — the plan,
  revised since round 1
- `docs/plans/260906c-plan-review-prompt.md` — round 1's prompt
- `docs/plans/260906c-plan-review-sol.md` — **your round 1 answer**

Read the revised plan in full, then spend most of the run on what changed. The authority is
`docs/plans/260905e-main-app-architecture-review.md` §§ A1, A3 and its checklist under *"Stage:
Separate article access, reader composition and mode controllers"*.

Orientation, unchanged from round 1: `src/web/App.tsx` (`Reader` 1647–3666; band dispatch 3307–3568;
`Found[]` states and the two ternary chains 2252–2371), `src/web/modes/ideas/IdeasMode.tsx`,
`tests/passage-mode-cleanup.test.tsx`, `src/web/CriteriaPanel.tsx`, `src/web/ClaimsPanel.tsx`,
`src/web/visitor.ts`, `src/modes.ts`.

## Previous findings

| ID | Finding, verbatim | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | the planned tests do not verify `Reader`'s actual passage wiring | fixed | Stage 4 gains a Reader-level wiring test over the real sequence (Ideas → Timeline → Search with pending work → Criteria ↔ Claims → Plain → Back), asserting prose marks, ring and Spine at every commit, under StrictMode and A → B → A, proved by the setter-swap mutation you named. |
| F2 | the proposed Chat/Remember destinations force a forbidden feature-to-feature import | fixed | One `src/web/modes/conversation/ConversationModes.tsx` holding `ConversationBand`, `RememberBand`, `QuizSubBand`, `ConversationKind`, `isConversationThread`. Verified `RememberBand` renders `ConversationBand` at `App.tsx:3990`. |
| F3 | the sixth-slot fix contradicts the explicit five-slot invariant and is not the smallest fix | fixed, **and extended** | Sixth slot dropped; five stay five. **But your fix is one-directional.** Both Referee producers publish in `useLayoutEffect` and clear in a passive `useEffect` (`CriteriaPanel.tsx` 276/307, `ClaimsPanel.tsx` 257/264), so criteria → claims loses Claims' marks by the same mechanism as claims → criteria loses Criteria's. The plan therefore makes the discriminant **slot-sharing**, carried as a separate input field, not `kind`: a producer that shares its reader slot clears in a layout cleanup; every producer with a slot of its own keeps its passive cleanup. Both directions are to be reproduced red first. |
| F4 | moving Referee can silently remove the controller itself from the copy scanner | fixed | Verified the non-recursive `readdirSync(WEB)` in `IMPORTS_THE_DOMAIN`. Stage 1 requires recursive discovery, seeding the surface set with `RefereeMode.tsx`, resolving specifiers from the importing file, and a mutation inserted into `RefereeMode.tsx` whose failure names that file. |
| F5 | required documentation work is absent | fixed | Feature-doc signposts per controller batch; `web-client.md` in stage 3; `new-mode.md` and `url-state.md` in stage 4. |
| F6 | the stage/commit boundaries are unnecessarily broad | fixed | "Deviation" framing removed; stage 1 is two batches (1a Timeline/Quotes/Debate/Glossary, 1b Search/Summary/Diagram/Referee), stage 3 is two commits (Reader/position, then access). |
| F7 | the test census is inaccurate | fixed | Five importers named; ten source-text checks including `page-title.test.ts` (verified: it reads `App.tsx` for `articleWaitTitle(`); `no-raw-nul-bytes` and `eager-client-graph` left alone but must still pass; `glossary-band-wiring` reads owning files separately rather than concatenating. |
| F8 | there are nine non-producer modes, not ten | fixed | Corrected in both places, and the nine are named. |

Treat the revised plan as unreviewed work by someone else.

## What it is meant to do

Unchanged from round 1. Four stages of behaviour-preserving moves out of a 5,920-line file, then two
things no compiler currently checks becoming things it does: an exhaustive `switch` for the band
dispatch, and a total `selectPassages(mode, slots) -> { found, openKey }`.

Invariants: the five producer slots stay five; cleanup callback identity must stay the parent's
setters (`tests/passage-mode-cleanup.test.tsx` lines 33–46); no `readerContext` bag and no whole-app
context; feature files must not import `App.tsx` or each other; article access and reading-position
code untouched by the acceptance exercise.

Out of scope: a single publication slot with owner tokens; a renderer table; lazy-loading mode code;
any product change.

## What you can and cannot run

Tree read-only; `/tmp` writable. One test file (`npx vitest run tests/<one>.test.tsx`) and throwaway
harnesses under `/tmp`. No network. Baseline at `0977d6f6`: `npm run typecheck` clean; the twelve
affected test files green (153 tests).

## Attack it

Independently, before the questions below. Discovery is closing after this round, so the highest-value
thing you can do is break something the revisions introduced rather than restate round 1.

Specifically worth attacking:

- **The layout-cleanup fix.** Is *"React destroys outgoing layout effect cleanups before running
  incoming layout effects"* actually true for a sibling swap inside a `switch`, in React 19, in
  StrictMode, and when the swap happens in the same commit as a parent state change? Build the probe.
  Does moving Claims' and Criteria's clear to a layout cleanup break anything their current comments
  claim — the every-frame-flicker argument, or leaving Referee mode altogether?
- **The slot-sharing field.** Is there a producer pair I have missed that shares a reader slot?
- **`band()` as a local closure.** Any commit where the `switch` and the seventeen `&&` siblings
  differ in what mounts or unmounts.
- **The two-commit stage 3.** Does commit 1 (Reader out, access still in `App.tsx`) actually compile
  without a cycle?

For each finding: an ID (**numbering continues above F8**), a severity, established or reasoned,
(a) the concrete scenario or contradicted contract, (b) the smallest change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it.

## My own suspicions — read last

1. Is the slot-sharing field one field too many? Would "every producer clears in a layout cleanup"
   be simpler and still correct, or does it re-introduce the flicker the passive-cleanup comments
   exist to prevent?
2. Stage 4 does five things. Is that one stage or two?
3. Is there any part of the revised plan where I have accepted a fix of yours that makes something
   else in the plan inconsistent?

Do not change any file.
