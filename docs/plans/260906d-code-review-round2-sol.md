## Findings

**F20 — Certain — a false money comment remains.**  
[src/web/DiagramPanel.tsx:875](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/DiagramPanel.tsx:875) still says Force is the default and that opening bare Diagram posts to `/api/similar`. The actual default is Sketch at [src/web/params.ts:905](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/params.ts:905).

Concrete failure: open `?mode=diagram` with no `diagram` parameter. It resolves to Sketch, so `useSimilar` is disabled; a bar press instead arms the Sketch job. A future money or visitor test written from the DiagramPanel comment recreates F11 with the opposite incorrect expectation.

**F21 — Certain — `DRAWS` is not structurally total in the way claimed.**  
[tests/every-mode-draws-its-surface.test.tsx:972](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/every-mode-draws-its-surface.test.tsx:972), [tests/every-mode-draws-its-surface.test.tsx:986](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/every-mode-draws-its-surface.test.tsx:986), and [tests/every-mode-draws-its-surface.test.tsx:1031](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/every-mode-draws-its-surface.test.tsx:1031) derive both the excluded key union and the runtime skip from `NO_BAND_MODES`. The two absence tests remain hard-coded below at line 1059. This is not the literal `Exclude<Mode, "plain" | "hierarchy">` described in the prompt.

Concrete failure: add `map` to `Mode`, add it to `NO_BAND_MODES`, and satisfy the other total tables. TypeScript no longer requires a `DRAWS.map` row, phase B skips it, and no new deliberate-absence test is required. A missing or wrongly rendered Map controller passes. Moving an existing mode such as Glossary into that list produces the same escape. The corresponding claim in [docs/project/new-mode.md:40](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/docs/project/new-mode.md:40) is therefore too strong.

**F22 — Certain — the money contract erases duplicate direct spending.**  
[tests/every-mode-draws-its-surface.test.tsx:545](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/every-mode-draws-its-surface.test.tsx:545) converts `mutations` to a `Set`, although `Press.spends` is documented as every paid request.

Concrete failure: make Force call `/api/similar/:slug` twice. `mutations` contains two POSTs, `paidPosts()` reduces them to one, and the Force row still passes. StrictMode replay is a harness problem to isolate, not a reason for a money contract to discard cardinality; an accidental duplicate inside one effect is financially observable.

**F23 — Certain — the repaired import walker recognizes only one legal `@import` spelling.**  
[tests/helpers/stylesheets.ts:63](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/helpers/stylesheets.ts:63) recognizes quoted imports but not `url(...)`.

Concrete failure: put this at the top of `src/web/styles/table.css`:

```css
@import url("./spine.css");
```

It is a valid relative CSS import, but `relativeImportsOf()` returns nothing. The leaf prohibition and duplicate-visit failure are therefore both bypassed while the real processor loads Spine again. The graph repair is real for the calibrated quoted mutation, but not for the full CSS syntax it claims to forbid.

**F24 — Certain — the narrowed ban cannot catch a component importing a feature sheet unlayered.**  
The prohibition at [tests/helpers/stylesheets.ts:125](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/helpers/stylesheets.ts:125) only walks CSS `@import` edges. The existing TypeScript import scanner sees side-effect imports at [tests/client-imports.test.ts:502](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/client-imports.test.ts:502), but its rule explicitly permits imports that stay inside `src/web` at line 568.

Concrete failure: add `import "./styles/table.css";` to a component. The manifest and walker remain green, `client-imports` accepts it, and Table is emitted again outside `styles.css`’s `layer(app)`. This is exactly the unlayered component-import failure the narrowed rule is meant to prevent. Also, the prompt’s “`IMPORTERS` allowlist” is stale: the current implementation uses `LEAF_DIR`, not such an allowlist.

**F25 — Certain — `> 500` proves bulk, not that the relevant CSS entered the scan.**  
[tests/table-selectors-are-scoped.test.ts:277](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/table-selectors-are-scoped.test.ts:277) correctly repairs the exact zero-selector failure, but the positive control at line 291 is not tied to Table or even to every production CSS entry path.

Concrete failure: import a separate `rogue-table.css` from a component containing `td { … }`. `readerCss()` still supplies thousands of branches, so `> 500` passes, while the offending production rule is outside the scanned graph. Independently, a helper regression that omitted only `table.css` would also remain over 500.

Keep the coarse count if useful, but add a semantic witness such as the known `:where(table.zoom > thead) > tr > th` branch—and close F24 so the helper’s graph really is the production corpus. The pre-/post-merge two-versus-zero calibration validates `offends()` once given the correct body; it does not calibrate acquisition of that body.

**F26 — Certain limitation, not circularity — the merge oracle proves global byte order, not ownership.**  
The ordered boundary list is [src/web/styles.css:29](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/styles.css:29). I independently reconstructed the base, ours, and theirs bodies and ran `git merge-file`: it was clean, and the expected and working-tree concatenations had identical SHA-256 hashes.

Concrete blind spot: move the final rule of `table.css` to the beginning of adjacent `prose.css`, preserving bytes and whitespace. The concatenation remains identical, the oracle passes, cascade behaviour remains identical, but ownership is wrong. It also cannot detect a semantic conflict that Git considers textually clean—for example, one side renaming markup while the other adds CSS for the old name.

For the duplicated mode-band/profile declaration, the reasoning is sound: choosing the wrong non-adjacent occurrence changes its position in the global stream and fails the byte comparison. The oracle is not circular; it is simply an oracle for merged cascade order, not semantic ownership or runtime correctness.

**F27 — Causal judgment, high confidence — the postmortem names one subtype as the whole class.**  
[docs/postmortems/260906e-a-guard-that-agreed-with-the-thing-it-was-watching.md:10](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/docs/postmortems/260906e-a-guard-that-agreed-with-the-thing-it-was-watching.md:10) calls the class “expectation downstream of the thing it checks,” but its own flavours 3 and 4 at lines 22–26 do not require a downstream expectation. They are lossy observation and insufficient discrimination.

Concrete consequence: F22 here discards cardinality with a `Set`; F25 observes a large but potentially irrelevant corpus. Neither failure comes from deriving an expectation from the implementation. The broader root cause is an **uncalibrated verifier boundary**: acquisition, normalization, predicate, or expectation can each erase the failing state.

The split’s size was an amplifier, not the root cause. Reading source by path is also not inherently wrong; treating a syntactic entry file as the semantic CSS corpus without proving liveness was wrong. The postmortem’s calibration remedy and its asymmetry argument remain applicable, but the class name should be broadened.

## Already handled

- The current `SPENDS` rows match the actual fetches: Force → `/api/similar`, Drift/Trail → `/api/projection`, Sketch/Illustrated → their respective jobs, the five fixed artefact modes → their job steps, and the remaining modes → none.
- `MODE_TARGET` is genuinely total over `Mode`. The delegated function is itself total over `PressContext`; `null` is an explicit outcome, not missing table coverage. `armActivationForMode` exhaustively switches the union, and Dock makes one call for every mode.
- Apart from F21 and F22, the expectation tables are independent of production activation data.
- The ordered 37-name manifest, exact import syntax check, aimed-selector matcher, hidden-ancestor handling, non-empty tuple types, latent-token sweep, and complete hue-set check repair their stated failures.

The focused suite passed: 120 tests across the six relevant files. All three TypeScript projects also pass direct `tsc --noEmit`; the repository’s `tsx` wrapper could not open its IPC socket under this review sandbox.