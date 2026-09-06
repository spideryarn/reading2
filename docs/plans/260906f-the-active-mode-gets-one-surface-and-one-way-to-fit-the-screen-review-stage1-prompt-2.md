# Code review round 2: stage 1 of A5 — `ModeSurface`, piloted in Search and Chat

You reviewed this code an hour ago and refused it, with F15–F19 (no P0/P1). **All five are accepted
and fixed.** This is the revision. Round 1's prompt is
`docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage1-prompt.md`
and your answer is
`docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage1-sol.md`;
both are on disk. Worktree:
`/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface`.

This is the **last** round — the process here is two rounds, then I settle it and write any overrule
into the plan. So say plainly what is still wrong and what you would accept.

## What changed since you looked

**F15 — the empty-head guard.** Now `typeof head !== "boolean" && head != null`, at
`src/web/ModeSurface.tsx`. A `head={true}` case is in the test and was watched going red against the
old guard. I made an explicit decision **not** to treat `""` or `[]` as absent, and wrote the reason
into the code: a fragment containing only `null`s is equally empty and no runtime check distinguishes
it, so a rule with a stated edge seemed better than one that catches some empty heads and not others.
**Tell me if you disagree** — this is the one place I chose an edge over completeness.

**F16 — the oracle.** `expectShape` in `tests/mode-surface-changes-no-markup.test.tsx` now also
asserts: the band is the panel's *entire* output (`[...host.children]` equals `[the aside]`), the
band's complete attribute-name set is exactly `["aria-label", "class"]`, and no non-whitespace text
node sits directly inside the band. Each of the three was watched going red against a deliberate
break (a wrapping `<div>`, an added `id`, an added `{" x "}`).

**F17 — provenance and coverage.** The docstring no longer claims everything came from the baseline.
It now separates *measured* (the `SEARCH` and `CHAT` child lists, from the Chrome baseline at
`6dacbd2e`) from *read from the pre-migration source at `369699af~1`* (every `aria-label`, `REMEMBER`,
and two new shapes). Two shapes were added — `SEARCH_VISITOR` (visitor + meaning, which is the only
reachable visitor state, since `useSearchMode` pins the matcher) and `CHAT_LIST` (`threadId: null`).
Both of my first guesses at their child lists were **wrong** and the test caught it; the corrected
literals are `["srch-empty"]` and `["band-head", "chat-threads", "chat-composer"]`, and I verified
both class names exist in the panels at `369699af~1` before recording them. I did **not** add the
other ~dozen shapes; the reasoning is in the docstring under "What this file does not attempt".

**F18 — the passthrough.** `PassThrough` now also omits `dangerouslySetInnerHTML` and `role`.

**F19 — the Outline rationale.** Corrected in `ModeSurface.tsx` **and** in the plan doc
(`docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md`
§ *The surface has to carry what Outline puts on the band*), which carried the same error. Both now
say the seam is `data-outline-rung`.

## State of the checks

- `npm run typecheck` — green across all three projects.
- `tests/mode-surface-changes-no-markup.test.tsx` — 12 tests, green.
- The nine existing Search/Chat panel suites (79 tests) and the eight band-wide suites (150 tests) —
  green.
- `tests/doc-links.test.ts` — green for my files. One failure remains that is **not mine**:
  `docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md` links to
  `tests/shared-site-run-row-gate.test.ts`, which does not exist. I established it is broken on
  `origin/dev` itself, in commit `01459af6`, from another agent's job — so I have left it alone.
- Full `npm test` and `npm run check` are re-running against the final tree as I send this; if either
  is red I will say so rather than let this stand on a claim.

## What I want from you

1. **Are F15–F19 actually fixed**, or fixed in a way that introduces something else?
2. **The `""` / `[]` decision under F15** — is the stated edge defensible, or should the surface
   treat them as absent?
3. **Is the oracle now sufficient** to justify migrating the remaining ten panels and `VisitorBand`
   behind it in stage 2? That is the decision this test is load-bearing for. If there is a class of
   DOM change it still cannot see, name it.
4. Anything new you see in the revised files, including in the prose — a comment that overclaims, or
   a reason that does not survive contact with the code. Two of round 1's findings were comments
   asserting things the code did not do, so weight that.
5. Anything about **stage 2 readiness**: an interface the remaining bands cannot adopt without adding
   DOM. The full list of raw bands left is in `PublicChrome.tsx`, `SummaryPanel.tsx`,
   `GlossaryPanel.tsx`, `IdeasPanel.tsx`, `QuotesPanel.tsx`, `TimelinePanel.tsx`, `QuizPanel.tsx`,
   `DebatePanel.tsx`, `DiagramPanel.tsx`, `OutlinePanel.tsx`, and Referee in `App.tsx`;
   `FeatureBoundary.tsx` stays raw on purpose and the five `preview-*.tsx` copies are out of scope.

## Ground rules

- **Check claims against the source**; say **established** or **reasoned** for each finding.
- Severity **P0/P1/P2/P3**, IDs continuing from F19 — start at **F20**.
- A clear verdict: accept, or refuse as written.
- Out of scope: the viewport fit (stage 4, blocked on a device measurement), the A6 Escape work
  (stage 3), the actual migration of the other panels (stage 2), and the mobile redesign.
