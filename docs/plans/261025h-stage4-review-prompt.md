# Review: Stage 4 of plan 261025h — two experiments, and the keyword toggle on *After it*

Repo: this worktree (TypeScript/ESM, React + nuqs, vitest). You may fix what you find inside this
stage (house workflow: you fix, I read your diff and commit); report anything wider for me to decide.

## The candidate

Commit bba409d8d (`git show bba409d8d`). The plan:
docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md (§ Stage 4; decision
10; F12, F13, F18 in § Review). Your Stage 2 review: docs/plans/261025h-stage2-review-sol.md.
Contracts: docs/project/sources.md (§ Where it sits, § The experiments),
docs/project/experimental-features.md, docs/project/url-state.md, docs/project/mode.md,
docs/project/fonts.md, docs/project/privacy.md. Stage 1's server shape for the toggle is
`CitersResult` in src/types.ts and `GET /api/citers/:slug?about=topic` in src/routes.ts.

## What I want

An independent attack. In particular:

- **Nothing stored or sent**: Guess first and Evidence first must never persist or post what the
  reader does (no URL, storage or network). Do the tests really prove it, or could a write slip
  past them?
- **Nothing started**: neither experiment, nor the toggle on open, may start paid work or an
  OpenAlex request. The toggle fetches `?about=topic` only on its press. Check Back/Forward, a
  pasted address and a remount.
- **Addresses**: `?sources=guess-first|evidence-first` light exactly one chip (Where it sits). They
  draw with the switch off (hidden from the controls, not unreachable), and the tools row offers
  them only with the switch on. A visitor gets Bibliography. The command bar has no row for them.
- **Honesty**: does Guess first actually hide the kinds, including through order, grouping, counts,
  aria labels or CSS classes? Does Evidence first hide the note and kind until Reveal? Does the
  toggle's label or count ever claim something the server didn't send (no `count` → no number;
  a server fallback with no `filteredBy` → said so)?
- **Fonts and controls**: the author's, model's and UI faces as fonts.md says. The order chips
  reuse the shared control.

Run the suites you touch (`npx vitest run <files>`). Severity: P0 data loss / exploitable security /
incorrect charging / broadly unusable; P1 user-visible wrong behaviour or an authoritative contract
violated; P2 design/maintainability; P3 prose. IDs S4-F1…. For each: evidence file:line, and either
"fixed" (with the test that proves it, red first) or a suggested fix.
