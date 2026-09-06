Verdict: **refuse**. No P0 was established, but F10 is an established P1 containment failure. F11–F12 are also established violations of the Stage 1 test contract.

### F10 — P1 — established

**A non-`Error` render throw breaks the boundary’s own handler.**

(a) Sequence:

1. The reader presses Ideas, arming `N1`.
2. Ideas executes `throw null`.
3. React passes `null` unchanged to `componentDidCatch`.
4. `captureClientFailure` safely accepts it, but [`error.name`](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/FeatureBoundary.tsx:197) throws a `TypeError` while constructing the log entry.
5. [`retireActivation`](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/FeatureBoundary.tsx:205) is never reached.
6. `AppBoundary` catches the new `TypeError` and replaces the whole reader with `[render]`.

A React 19 `<StrictMode>` harness reproduced `outer fallback` with no retirement marker. This leaves the activation token behind, although the stuck root fallback makes a later charge unreachable in the current application, hence P1 rather than P0.

(b) Retire before diagnostics, and safely derive the runtime name:

```tsx
override componentDidCatch(error: Error, info: ErrorInfo): void {
  void info;

  const { slug, target, press } = this.props;
  if (target !== null && press !== null) {
    retireActivation(slug, target, press);
  }

  captureClientFailure(error, {
    boundary: "feature",
    feature: this.props.name,
  });

  let name = "Error";
  try {
    const candidate = (error as unknown as { name?: unknown } | null)?.name;
    if (typeof candidate === "string") name = candidate;
  } catch {
    // A diagnostic must not replace the failure it is recording.
  }
  recordLog({ kind: "client-error", source: "boundary", name });
}
```

Add a `throw null` containment case so this remains protected.

### F11 — P1 — established

**The “real request trace” is not mounted under the application’s `<StrictMode>`.**

(a) Production mounts the application under `<StrictMode>` in [`main.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/main.tsx:206). The trace test imports neither `StrictMode` nor `AppBoundary` and renders only `NuqsAdapter → App` at [`open()`](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/tests/the-ideas-extraction-changed-no-requests.test.tsx:556).

Consequently, a StrictMode-only duplicate request can pass all three exact-sequence assertions. The file even attributes Ideas’ two GETs to StrictMode at [line 658](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/tests/the-ideas-extraction-changed-no-requests.test.tsx:658), despite not enabling it. That does not satisfy the F9 requirement to retain the real before/after trace.

(b) Match the production lifecycle, then recapture both base and candidate traces:

```tsx
import { act, createElement, StrictMode } from "react";

root.render(
  createElement(
    StrictMode,
    null,
    createElement(
      NuqsAdapter,
      null,
      createElement(AppBoundary, null, createElement(App)),
    ),
  ),
);
```

Do not merely update the expected arrays from the candidate; rerun the same harness against the base.

### F12 — P1 — established

**The promised racing-newer-press boundary test is absent.**

(a) The plan explicitly requires “a newer press arriving before failure handling survives” at [lines 251–255](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md:251). The implemented test at [line 763](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/tests/a-broken-mode-leaves-the-article-readable.test.tsx:763) tests only `retireActivation` directly.

All 14 tests would remain green if `componentDidCatch` were changed to look up and retire the latest token at catch time: page tests never place `N2` between the failed `N1` render and its catch, while the direct seam test bypasses the boundary wiring entirely. Thus the load-bearing claim about `this.props.press` remains untested.

(b) Add the React-level association test promised by F7:

```tsx
it("retires the failed render's press, not a newer press", async () => {
  activation.armActivation(SLUG, "ideas");
  const failed = activation.pendingActivation(SLUG, "ideas");

  // Begin a render tagged with `failed`, make it throw, and deterministically
  // arm a second token before the boundary's catch callback commits.
  await renderFailureWithNewerPressBeforeCatch();

  const surviving = activation.pendingActivation(SLUG, "ideas");
  expect(surviving).not.toBeNull();
  expect(surviving).not.toBe(failed);
});
```

The helper should be a controlled React lifecycle harness, not a timing race.

### F13 — P2 — established

**A successful Retry can start a paid job without the 14 tests noticing.**

The retry test keeps `throwBand = true`. If `retry` incorrectly called `armActivation`, the second throw would retire that token and the zero-POST assertion would still pass. The only successful recovery test presses the Ideas Dock button, not “Try Ideas again.”

Add:

```tsx
probe.throwBand = false;
trace.length = 0;

await act(async () => buttonNamed("Try Ideas again").click());
await settle();

expect(text()).not.toContain("[mode-render]");
expect(jobPosts(), "Retry minted spend intent").toEqual([]);
```

### F14 — P2 — established

`generation` and its keyed `Fragment` are redundant. By the time the Retry button exists, the broken render has already replaced and unmounted the child; clearing `broken` necessarily mounts a fresh controller. The key resets nothing additional.

```tsx
private retry = (): void => {
  this.setState({ broken: false });
};

if (!this.state.broken) {
  return this.props.children;
}
```

The target-scoped subscription, reset-on-fresh-press behavior, nonce/epoch comparison, and owner-independent retirement otherwise hold up. In the current topology there is only one live Ideas controller for a key, so a claimed token at a caught failure belongs to the subtree being destroyed; checking `owner` would not improve correctness.

The permitted test run passed: **14/14**. No repository file was changed.