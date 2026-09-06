Verdict: **refuse**. No charging defect or P0 was found, but F15 is an established P1 violation of the repository’s regression-test contract.

### F15 — P1 — established

**The `AppBoundary` half of F10 is fixed but has no regression test.**

(a) Sequence:

1. Mount `AppBoundary → component that throws null`.
2. At the base commit, `componentDidCatch` reads `error.name`, throws a secondary `TypeError`, and leaves the root empty.
3. The candidate correctly renders `[render]`.
4. The new non-`Error` test only exercises `FeatureBoundary`; because that boundary succeeds, `AppBoundary` never receives `null`.
5. Consequently, reverting only [AppBoundary.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/AppBoundary.tsx:52) to the broken implementation leaves all 17 containment tests green.

A disposable React 19 `<StrictMode>` harness established:

- Base: `TypeError: Cannot read properties of null (reading 'name')`, empty root.
- Candidate: no rejection, `[render]` fallback present.

The code is correct, but the independently changed root boundary has not received the required red/green regression test.

(b) Smallest closure:

```tsx
it("the root boundary contains a non-Error throw", async () => {
  function ThrowsNull(): never {
    throw null;
  }

  await act(async () => {
    root.render(
      <StrictMode>
        <AppBoundary>
          <ThrowsNull />
        </AppBoundary>
      </StrictMode>,
    );
  });

  expect(text()).toContain("[render]");
  expect(
    readLogBuffer().filter((entry) => entry.kind === "client-error"),
  ).toContainEqual(
    expect.objectContaining({
      source: "boundary",
      name: "Error",
    }),
  );
});
```

Run it against the base to observe the failure, then against the candidate.

### F16 — P2 — established

**The F12 probe is mutation-sensitive, but its stated lifecycle claim is false.**

(a) In [the probe](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/tests/a-broken-mode-leaves-the-article-readable.test.tsx:901):

1. The wrapper reads `N1`.
2. The child arms `N2` during render, then throws.
3. Recovery renders again with `N2`; the child arms `N3`, then throws.
4. This continues until the caught render’s props hold `Nk` while the store already holds `Nk+1`.
5. `retireActivation(Nk)` therefore returns `false`: the test does **not** demonstrate that the boundary retires “the press its failed render was holding.”
6. It usefully demonstrates only that a replacement token is not deleted. That is why the catch-time-lookup mutation fails it.

This is not faithful to a reader race: every replacement is an illegal render-phase write. The production argument itself holds for React 19.2.8: once a render throws, React immediately performs synchronous recovery in the same JavaScript task, so a browser click cannot enter that gap.

(b) Keep the useful seam test, but narrow its claim:

```tsx
describe("the boundary will not retire a token newer than its render snapshot", () => {
  it("leaves a token installed after the wrapper read", async () => {
    // This deliberately creates an otherwise unreachable stale-props/store
    // state. It tests compare-and-retire refusal, not a racing user click and
    // not successful retirement of the older token.
  });
});
```

The normal page cases already prove that a matching token is actually retired.

### F17 — P2 — reasoned

**Retirement is now the remaining operation capable of throwing out of `componentDidCatch`.**

(a) The ordering choice is correct: money before diagnostics, and both `captureClientFailure` and `recordLog` internally suppress their failures. However:

1. `retireActivation` deletes the token.
2. It calls `emit()`.
3. `emit()` invokes subscriber callbacks without containment.
4. If one throws, the token remains safely deleted, but the original report is skipped and the error escapes the feature boundary’s handler.
5. `AppBoundary` then replaces the article.

Today the production subscribers are React’s external-store callbacks, so this is a defensive maintainability risk rather than known wrong behavior. The charging invariant remains safe because deletion precedes notification.

(b) Smallest local closure:

```tsx
try {
  if (target !== null && press !== null) {
    retireActivation(slug, target, press);
  }
} catch (retirementError) {
  captureClientFailure(retirementError, {
    boundary: "feature",
    feature: this.props.name,
    phase: "retire-activation",
  });
}

captureClientFailure(error, {
  boundary: "feature",
  feature: this.props.name,
});
```

### F18 — P2 — established

**The `mode` component of `resetKey` is dead and documents the wrong extension point.**

(a) [FeatureBoundary is mounted only when `mode === "ideas"`](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/App.tsx:3387). Leaving Ideas destroys it; re-entering constructs new state. Therefore `mode` cannot change during this boundary’s lifetime.

A future sub-mode would not change the top-level `mode` value either, so copying this expression would not reset on that sub-mode. The comment presents dead data as useful guidance.

(b) Remove it and name the real future requirement:

```tsx
resetKey={`${slug}|${owner ? "owner" : "visitor"}`}
```

A feature with a genuine sub-mode should append that sub-mode’s actual identity.

F11, F13, and F14 otherwise hold up. Removing the child key is safe because the failed subtree has already been unmounted, and successful Retry does not arm or spend a token. The permitted containment test passed **17/17**. No repository file was changed.