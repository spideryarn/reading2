No P0s. The canonical `@/` fix is correct, but one in-scope non-relative escape remains.

### Findings

- **P1-1 — Vite root-absolute specifiers still bypass containment.**  
  [checkSpecifierValue](../../tests/helpers/env-reads.ts:565) returns at line 570 for `/scripts/env-bridge.js` and `/@fs/…`. I verified Vite resolves:

  ```text
  /scripts/build-stamp.js → <repo>/scripts/build-stamp.ts
  /@fs/<repo>/scripts/build-stamp.ts → <repo>/scripts/build-stamp.ts
  ```

  Thus a browser module under `src/` can bridge to repo-written code outside the sweep without a refusal. This is the same in-scope class as `@/`, not the documented package boundary. Literal filesystem paths and `file:` URLs are the corresponding Node form.

- **P2-1 — Repeated alias slashes are falsely refused.**  
  Vite resolves `@//components/ui/button.tsx` inside `src/web`, but `path.resolve` treats the sliced `/components/…` as filesystem-absolute and reports it outward. No current import uses this noncanonical form, so nothing is broken today. Strip leading slashes from the alias suffix before resolving; traversal such as `@//../../scripts/…` will still be refused.

- **P2-2 — `REFUSED_BY` protects only its five listed fixtures.**  
  The optional lookup at [line 464](../../tests/env-reads-are-literal.test.ts:464) means a sixth red control can omit `REFUSED_BY` and again pass for an unrelated reason. For listed fixtures, `toContain(expected)` correctly prevents that failure. To generalise the class, make an expected shape mandatory for every must-refuse control—or narrow the claim to those five instances.

Hard-coding `@/ → <swept root>/web` is the right decision; this helper should not execute or interpret Vite/TypeScript configuration. The canonical inward and outward arithmetic matches the configured alias, and all 13 current imports remain accepted. The root-absolute forms should likewise receive an explicit, deliberate rule.

Checks passed: focused Vitest 47/47; direct typecheck covered all 1,549 files.

**do not land — the remaining P1 is in scope, not the documented package boundary.**