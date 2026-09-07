## Verdict

Refuse as written. Established P1 findings F1–F6 contradict the governing A5/A6 contract or can undo A2’s containment guarantee.

### F1 — P1 — established: the plan chooses unverified, bottom-only geometry that the authority explicitly prohibits

(a) The governing review says to reproduce the band on iOS “before … choosing its arithmetic” and requires accounting for `offsetTop` ([A5](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:332), [vertical-fit contract](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:350)). The candidate instead chooses bottom-only arithmetic, explicitly refuses `offsetTop`, and finishes with no phone measurement ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:67)).

The “top chrome drifts together” argument does not close this. `.controls` is a separate sticky element positioned and hidden by its own `top`/`transform` rules ([styles.css](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/styles.css:669)); it does not consume `offsetTop`. The hook itself says `offsetTop` is what top-anchored content must add ([useVisualViewport.ts](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/useVisualViewport.ts:23)), and the existing test treats a scroll-only offset change as significant ([test](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/visual-viewport-dialogs.test.tsx:217)).

(b) Replace Stage 2’s fit decision with:

> **The viewport-fit stage is blocked on a real iOS reproduction.** Record `innerHeight`, `visualViewport.height`, `offsetTop`, `scale`, and the controls/band/header/composer rectangles with the keyboard closed, opening and open. Until then, do not add visual-viewport-derived geometry to `.mode-band`; synthetic Chrome proves plumbing only. The chosen arithmetic must account for `offsetTop`, or include measured evidence that leaving it unused keeps both the bar and band header reachable.

The behaviour-preserving container migration can proceed before that.

### F2 — P1 — established: the proposed bottom expression adds overlapping occlusions

(a) The plan admits that the dock is behind the keyboard, yet adds both dock clearance and keyboard inset ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:54), [admission](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:78)). Overlapping occlusions combine by `max`, not addition.

At the default 44px top bar and 40px dock, a 390px layout viewport with a synthetic 120px visual strip produces only 36px of band height before safe-area/hint terms. Below an 84px visible strip, it collapses. That is incompatible with the authority’s requirement that the header and composer remain reachable.

(b) If device evidence authorizes this inset strategy, commit to the union of occlusions:

```css
bottom: max(
  calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-h)),
  var(--kb-inset, 0px)
);
```

This does not move the dock; it merely stops reserving space for it when the keyboard already covers that same region.

### F3 — P1 — established: the proposed scroller invariant is false of the current Referee fix

(a) The candidate says `.ref-panel` is the child that gives way and defines the invariant as `flex: 1` plus `min-height: 0` ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:120)). Current CSS deliberately says the opposite:

- `.ref-brief` is shrinkable with `min-height: 0` ([styles.css](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/styles.css:7052)).
- `.ref-panel` has `flex: 1` and a nonzero `5rem` floor ([styles.css](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/styles.css:7294)).
- The existing regression test explicitly rejects `min-height: 0` on `.ref-panel` ([test](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/referee-band-fits.test.ts:74)).

Search’s `.srch-hits` and Chat’s `.chat-threads` also lack an explicit `min-height: 0`. Following the stated invariant could reverse the exact Referee correction that made its controls reachable.

The proposed marker test is also the silent-success shape: it can remain green while `.quotes-list` lacks the needed declaration or while the marked element has the wrong computed flex rules.

(b) Replace the invariant section with:

> `ModeSurface` does not impose or claim a uniform structural scrolling invariant in v1. Each mode retains its feature-specific scroll policy. A marker may identify the primary body for browser measurements, but jsdom checks only the declaration: `none` means zero markers and `body` means one. Browser acceptance checks outcomes—nonzero body height, footer/composer inside the band, and every overflowing region reachable. It must preserve Referee’s shrinkable `.ref-brief` and floored `.ref-panel`.

### F4 — P1 — established: migrating the failure fallback onto `ModeSurface` defeats A2

(a) The candidate migrates `FeatureBoundary`’s fallback to the same component whose failures it must contain ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:93)). If `ModeSurface` throws, the boundary catches its first render and then invokes the same throwing component while rendering its fallback. That second error escapes to `AppBoundary`, replacing the reader—the failure A2 exists to prevent.

A throwaway React 19 harness confirmed this exact shape reaches the outer/root fallback.

(b) Replace that paragraph with:

> `FeatureBoundary`’s fallback deliberately keeps its raw `<aside className="mode-band">`. This duplication is a circuit breaker: a failure in `ModeSurface` must not make the fallback invoke the failed dependency again. Add a test that makes `ModeSurface` throw and asserts the feature fallback, prose and dock remain while the root fallback is absent.

`VisitorBand` can still migrate.

### F5 — P1 — established: “no composer slot” defensibly drops Chat’s composer, but silently drops real footer slots too

(a) `Conversation` genuinely returns the transcript and composer as one fragment ([ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/ChatPanel.tsx:1046)), so not extracting Chat’s composer is defensible.

It does not justify omitting `foot`. Existing panels already have direct pinned footer rows: Glossary ([GlossaryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/GlossaryPanel.tsx:487)), Ideas ([IdeasPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/IdeasPanel.tsx:317)), Quotes ([QuotesPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/QuotesPanel.tsx:674)) and Timeline ([TimelinePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/TimelinePanel.tsx:529)). A5 requires header/content/footer slots and explicitly says Search and Chat have different footer needs ([authority](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:338)).

(b) Commit to:

```tsx
interface ModeSurfaceProps {
  label: string;
  feature: string;
  head?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
}
```

Render `head`, unchanged body children, then `foot`, without adding body/footer wrappers. Chat may keep `Conversation` entirely in `children` for v1; that is a documented exception, not grounds to remove the footer seam.

### F6 — P1 — established: the A6 step explicitly stops short of its authoritative acceptance

(a) The authority requires auditing nested help/lightbox/menu/tooltips and defining which surface consumes Escape once ([A6](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:378), [stage acceptance](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:648)). The candidate fixes one Annotate/Comment pair and explicitly defers the general ownership rule ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:234)).

(b) Drop A6 from this job and hand the discovered pair to a separate A6 plan. Remove “plus the half of A6” and do not tick A6’s checklist. That gives the surface migration a coherent final stage rather than coupling it to an unrelated interaction audit.

### F7 — P2 — reasoned: Stage 1 cannot be both “with the fit” and byte-identical in desktop Chrome

(a) `keyboardInsetStyle()` returns an inline property whenever `visualViewport` exists, including `--kb-inset: 0px` ([hook](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/useVisualViewport.ts:89)). Modern desktop Chrome exposes that API. Therefore Stage 1’s component “with … the fit” changes serialized markup even though the stylesheet does not consume it yet, contradicting its byte-identical acceptance ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:176)).

(b) Change Stage 1 step 2 to:

> `ModeSurface.tsx` with `label`, `feature`, `head`, `children` and optional `foot`; no viewport subscription or viewport style yet.

Also replace “every desktop takes the no-property fallback” with:

> No `visualViewport` means no property. A present, full-size viewport normally supplies `0px`; computed geometry—not serialized markup—must match the baseline.

### F8 — P3 — established: the copy counts are wrong

(a) There are 14 non-preview `.mode-band` asides total: 12 modes plus two fallbacks. Only nine contain `.band-head`; Search, Summary, Outline and both fallbacks do not. After piloting Search and Chat, the remainder is ten modes plus two fallbacks—not “twelve plus two.”

(b) Replace with:

> Fourteen files write a `.mode-band` aside; nine also write `.band-head`. Pilot Search and Chat, then migrate the remaining ten mode panels and `VisitorBand`; keep `FeatureBoundary`’s raw fallback as the circuit breaker described below.

Checks: `tests/visual-viewport-dialogs.test.tsx` passed, 8/8. The React bailout claim is correct: a React 19 harness kept the child render count at one across a surface state update even with a fresh style object. I also found no current inherited `--kb-inset` collision: the three CSS consumers are Reader siblings of the mode bands, not descendants.