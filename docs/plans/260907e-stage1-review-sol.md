Verdict: **land it with the small test and comment corrections below.** No behavioural defect or charging-order regression exists.

### Findings

**F7 — P2 — established: the test enforces literal syntax, not the full semantic guarantee it claims.**

The combined type/test protection can be bypassed by aliasing or narrowing:

```ts
const caught = error;
if (typeof caught === "object" && caught !== null && "name" in caught) {
  void caught.name;
}
```

I compiled this under the repo’s strict settings; the current recognizer reported `declared: "unknown"` and no forbidden reads. A throwing `name` getter therefore remains hazardous. `(error as Error).name` similarly passes because [memberRead](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/no-boundary-reads-the-caught-value.test.ts:119) only recognises the original parameter as the member-expression receiver.

A quoted or computed method such as `"componentDidCatch"(error: Error)` is not discovered because [handlers()](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/no-boundary-reads-the-caught-value.test.ts:150) accepts only an identifier key. The three existing boundaries still satisfy the positive control, so the omission stays green.

For this small stage, I would avoid data-flow analysis. Instead:

- Recognise statically named string/computed `componentDidCatch` keys.
- Consider banning any `.name`/`.message` read or destructure inside a recognised handler, irrespective of receiver; the stated house rule already says `nameOfThrown` is the only route.
- Add small parser fixtures covering method, quoted method, arrow property, alias/cast, destructured parameter and rest parameter.
- Otherwise narrow the test’s comments to “literal `unknown` plus unaliased direct reads.”

The cases you named behave as follows:

- `type Thrown = unknown`: rejected, although sound.
- `type Thrown = Error`: also rejected—it does **not** pass wrongly.
- `any`: rejected.
- Destructured parameter: rejected by both checks.
- Rest parameter: rejected because its annotation is not literal `unknown`.
- Arrow class property: found, but its arrow parameters are not inspected; it fails closed as `(none)`.
- Assertions, narrowed aliases and quoted/computed method names provide the actual bypasses.

**F8 — P3 — established: the rewritten comments overstate or mislocate the guarantee.**

- [AppBoundary](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/web/AppBoundary.tsx:70) and [LazyPage](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/web/LazyPage.tsx:120) say `error.name` produces a `TypeError`. It only **can** do so—for example on `null` or `undefined`; an actual `Error` succeeds and a string property access yields `undefined`.
- [FeatureBoundary](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/web/FeatureBoundary.tsx:248) says the diagnostic “skipped the retirement above.” That is impossible in the current ordering: retirement is already complete before the diagnostic. Say it “once skipped retirement, before retirement was moved ahead of diagnostics.”
- The test says the existing sweep needs manual synchronisation for a fourth conventional boundary and that the typechecker owns the scalable half. In fact, both assertions consume the same recursive `handlers()` sweep. The sweep discovers a conventional fourth boundary; it forces the literal annotation; only then does `strict` reject an un-narrowed property read.

### Confirmed non-findings

- The three boundary files emit byte-identical JavaScript against `8954b23f`.
- `FeatureBoundary` still retires the activation before either diagnostic; the load-bearing ordering is unchanged.
- `unknown` is sound against React’s `Error` declaration. Method bivariance exists—I confirmed a narrowed subtype override also compiles—but `unknown` does not depend on it: an ordinary strict function accepting `unknown` is safely assignable where React expects an `Error` handler. A future first-parameter widening to `unknown`, or narrowing to another thrown-value type, would not break this override.
- The `handlers()` modification does not weaken the existing positive control or parsing path; its limitations above pre-existed or are inherited by the new assertion.
- The requested three test files pass: 23/23.