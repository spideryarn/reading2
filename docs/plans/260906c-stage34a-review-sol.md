No refusal: I found no established P0/P1 and no unintended reader-visible behavior in the candidate. I found three P2 guard gaps and one P3 documentation defect.

## Findings

**F21 — P2 — established: non-literal dynamic imports bypass every relevant import guard.**

[reader-import-direction.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/reader-import-direction.test.ts:145) ignores `import(expr)` when `expr` is not a literal. The eager graph and sanitiser/client-layer guards have the same hole.

- (a) Adding this to `IdeasMode.tsx` passed all three direction tests, and Vite built successfully:

  ```ts
  const target = "../../App.js";
  void import(target);
  ```

  The equivalent computed import of `../quotes/QuotesMode.js` also passed. A computed import of `../../sanitize.js` from `article/access.ts` passed the sanitiser test, eager-graph test, and the relevant `client-imports` assertion.

- (b) Fail closed on every non-literal dynamic import in graph-enforcing tests. Resolve literal dynamic imports normally; throw for anything that cannot be statically named. Prefer the existing AST helper over another regex.

**F22 — P2 — established: the footer mount inventory counts commented JSX as a live mount.**

The raw match in [site-footer.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/site-footer.test.tsx:216) cannot distinguish JSX from comments.

- (a) Replacing the real `SignInPage` mount with `{/* <SiteFooter /> */}` left all 15 footer tests green, although the page no longer renders a footer.

- (b) Count `JSXOpeningElement` nodes named `SiteFooter` using `parseSource`/`walkAst`. That is a small replacement for the current regex and naturally ignores comments and strings.

**F23 — P2 — established: the personal-address guard only recognizes named imports.**

The check at [site-footer.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/site-footer.test.tsx:300) misses namespace access.

- (a) This passed all 15 tests:

  ```ts
  import * as reviewAdmin from "../../../admin.js";
  void reviewAdmin.ADMIN_EMAIL;
  ```

  The same access could be rendered by a component without changing what the regex sees.

- (b) Walk the client AST for actual `ADMIN_EMAIL` identifiers/member accesses, ignoring comments, rather than matching one import spelling.

**F24 — P3 — reasoned: the plan was not fully reconciled with what landed.**

The authoritative plan still says Reader/position and article access are “separate commits” at [line 94](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md:94). It also attributes a visible Search→Plain frame to a passive cleanup at [line 141](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md:141), although stage 4a has made that cleanup layout-phase. `TimelineMode.tsx` likewise still describes “five effects below” and proposes the helper that now exists.

- (b) Say stage 3 was performed in dependency order within one commit; reframe stage 4b around totality/compiler enforcement rather than the now-removed passive-cleanup frame; update Timeline’s header to describe the two remaining policy effects.

## What held under attack

- All eleven moved function bodies compared byte-for-byte with the parent commit after ignoring only their new export wrapper.
- The five `Found[]` slots remain five, and every lifecycle callback comes directly from a stable React state setter.
- The helper preserves each old publication dependency set. `NO_KEY_TO_SET` is module-stable and harmless.
- Quotes still publishes `found` and `openKey` together in one layout effect.
- Restoring the old passive cleanup made three non-StrictMode hand-off assertions fail; the StrictMode variant remained green, confirming the postmortem’s account.
- Literal imports of `App.tsx` and a sibling mode each failed the new direction guard; an unresolved local import failed suite loading.
- Turning Debate into an ordinary literal lazy import failed both eager-mode assertions.
- The sanitiser replacement correctly accepts the client sanitiser, rejects the server sanitiser, and fails when the scan finds zero sanitiser imports.
- `9b636cc1` is the correct introducing commit: it added the second writer, Claims, after Criteria’s `b9f1d2a5`.
- Combining stage 3 into one commit costs only an intermediate bisection point that never existed as a verified tree; I found no behavioral or dependency-order cost.

I ran 98 candidate-snapshot tests across the seven central suites, all green. The live worktree acquired concurrent stage 4b edits during review, so all final evidence was taken from an isolated `14c1d79c` archive. No files were changed.