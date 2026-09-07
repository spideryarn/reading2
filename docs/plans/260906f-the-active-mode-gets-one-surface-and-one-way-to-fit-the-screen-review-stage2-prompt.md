# Code review: stage 2 of A5 — the remaining eleven bands migrate onto `ModeSurface`

You have reviewed this work three times: the plan (F1–F8), the revised plan (F9–F14), and stage 1's
code (F15–F19, then F20–F24). All were accepted. This is stage 2.

Worktree: `/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface`, branch
`worktree-a5-mode-surface`. Read files directly.

## What stage 2 claims

**Every product mode band now goes through `src/web/ModeSurface.tsx`, and not one of them changed
its DOM.** Eleven bands migrated here, on top of Search and Chat from stage 1.

- The plan — `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md`,
  § *Stage 2* especially.
- The oracle — `tests/mode-surface-changes-no-markup.test.tsx`. **Read this first.** Its 19 shapes
  were captured at commit `e4952ecb`, in a commit of their own, **while all eleven bands were still
  hand-written**. That ordering was your F21.
- The new circuit-breaker test — `tests/the-band-fallback-must-not-use-modesurface.test.tsx`.
- The migrated panels: `PublicChrome.tsx`, `SummaryPanel.tsx`, `GlossaryPanel.tsx`, `IdeasPanel.tsx`,
  `QuotesPanel.tsx`, `TimelinePanel.tsx`, `QuizPanel.tsx`, `DebatePanel.tsx`, `DiagramPanel.tsx`,
  `OutlinePanel.tsx`, and Referee inside `src/web/App.tsx`.

## The finding that shaped this stage, and what I want you to attack

Capturing before migrating turned up something neither of us had: **five bands ship an EMPTY
`<div class="band-head"></div>` today.** Glossary, Ideas, Quotes and Timeline empty theirs while the
artefact loads, because every header child is gated on it — and **Diagram's is empty in its ordinary
state**, its only header child being a caveat that draws on the projected pictures while Sketch is
the default.

`ModeSurface` renders **no** `.band-head` for an absent, `null` or boolean `head` — that was your
F15. So `head={artefact && <X/>}` deletes a row those five bands show today, silently, with the whole
suite green. All five were written as `head={<>…</>}`, an always-present fragment. Quiz needed the
same treatment for a different reason found during the work: its only header child is `subMode`, an
**optional prop**, so `head={subMode}` would be `undefined` for any caller that omitted it.

**Attack this.** Is the fragment form actually correct in all seven places it was used? Is there a
band where it is now *wrong* — where a header genuinely should disappear rather than sit empty, and
the migration has frozen an empty row into a state that never had one? Diagram's own comment
(`DiagramPanel.tsx`, the 2026-08-30 reasoning) claims the row is load-bearing; check that claim
rather than taking it from me.

## Everything else I want checked

1. **Is the DOM genuinely unchanged, per band, per state?** The oracle pins 19 shapes, but the panels
   have more states than that. Read the diffs. A dropped conditional, a changed guard, a reordered
   child, a lost `key`.
2. **The `foot` migration is the riskiest edit in the stage.** Six footers moved from being a trailing
   child inside an outer conditional to a sibling `foot` prop, which meant writing the **conjunction**
   of the outer and inner guards by hand. Check every one of the six against the original —
   `.gloss-foot`, `.ideas-again`, `.quotes-foot`, `.tl-again`, `.dbt-again`, `.quiz-rewrite`. A
   conjunction that is subtly wrong shows a footer in a state that never had one, or hides one that
   did, and **the oracle would not catch it** unless that exact state is among the 19.
3. **Debate's ordering.** `.dbt-again` sat before a `card.shown && <FloatingPortal>`; `foot` renders
   after all children. The claim is that in-band order is unchanged because the portal writes to
   `document.body`. Verify.
4. **Outline** passes `ref` and `data-outline-rung` through the surface. Does it still measure and
   choose a rung correctly?
5. **Referee**, in `App.tsx`. I migrated it by hand. It is another agent's ground (item A1), so the
   edit is deliberately minimal. `tests/referee-band-fits.test.ts` reads `App.tsx` **as text** with a
   regex, and I had to update that regex — twice, because the file deliberately takes the same slice
   in two places so a stopped match fails loudly rather than emptying quietly. Check I updated it
   honestly rather than in a way that makes it match something weaker.
6. **The circuit-breaker test.** `tests/the-band-fallback-must-not-use-modesurface.test.tsx` mocks
   `ModeSurface` to throw and asserts `FeatureBoundary`'s raw fallback still stands, the prose and
   dock survive, and `AppBoundary` never fires. I temporarily migrated the fallback and watched all
   three assertions go red, including one showing the article's own text vanishing. Is the test
   actually sound, or does it pass for a reason other than the one it claims?
7. **What is left raw, and should it be?** `FeatureBoundary.tsx` (the circuit breaker), the five
   `preview-*.tsx` copies, and `DesignPage.tsx:222` — the `/design` page's band *specimen*, which the
   migration deliberately left because it is a demonstration rather than a product band. Is that the
   right call?
8. Anything else: correctness, accessibility, a comment that says something the code does not do.
   Three of your five findings in stage 1 round 1 and two in round 2 were exactly that, so weight it.

## State of the checks

- `npm run typecheck` — green, all three projects.
- The oracle (31), the circuit breaker (3), `referee-band-fits` (7) — green.
- `every-mode-draws-its-surface`, `a-broken-mode-leaves-the-article-readable`, `outline-panel`,
  `public-network-trace` — green.
- `npm run check` is running as I send this; if it is red I will say so rather than let this stand.
- Untracked in the tree: nothing. Modified: the 14 files in the stage-2 diff and no others.

## Ground rules

- **Check claims against the source.** Say **established** or **reasoned** for each finding.
- Severity **P0/P1/P2/P3**, IDs continuing from F24 — start at **F25**.
- A clear verdict: accept, or refuse as written.
- Out of scope: the viewport fit arithmetic (stage 4, blocked on a device measurement — the
  instrument landed but no trace exists yet), the A6 Escape work (stage 3, in progress), and the
  mobile redesign (not authorised).
