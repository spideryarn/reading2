I found genuine holes; Stage 3 should not land with these assertions claiming the stronger properties.

- **P1 — `ReportedEnvNameIsExactlyTheTable` accepts `any`.** At [src/vercel-health.ts:606](src/vercel-health.ts:606), both of these compile, resolve the assertion to `"ok"`, and admit `"NOT_IN_TABLE"`:

  ```ts
  type ExpectedRow = (typeof EXPECTED)[number] | any;
  // or
  type ReportedEnvName = any;
  ```

  Those are widenings of the checked subject, not edits to the assertion. Ordinary widening to `string` or `unknown`, and narrowing to `never`, are caught.

- **P1 — widening `EXPECTED` widens both sides together.** Either of these leaves the equality `"ok"` while admitting names absent at runtime:

  ```ts
  const EXPECTED: readonly Expected[] =
    [...] as const satisfies readonly Expected[];

  // or inside a row
  { name: "DATABASE_URL" as string, breaks: null }

  // even a finite lie:
  { name: "DATABASE_URL" as "DATABASE_URL" | "NEW_ONE", breaks: null }
  ```

  `ReportedEnvName` and `NamesInTable` derive from the same widened source, so comparison cannot expose it. These are edits outside the assertion. The finite asserted union is inherently impossible to disprove using types alone.

- **P1 — `ExpectedHasNoIndexSignature` only detects a full string index.** At [src/vercel-health.ts:629](src/vercel-health.ts:629), this passes while allowing the exact `wher` typo:

  ```ts
  interface Expected {
    // existing fields...
    [key: `w${string}`]: unknown;
  }
  ```

  `string extends keyof Expected` is false because `` `w${string}` `` is narrower than `string`. The same bypass works through a mapped type or a merged patterned-index declaration.

  Numeric and symbol indexes also remain invisible and allow numeric/symbol extras, although they do not permit an ordinary textual typo. A merged full `[key: string]` signature is correctly caught.

  Two other non-index widenings also preserve `"ok"` while disabling the protection:

  ```ts
  type Expected = unknown;
  // or an empty Expected interface/type
  ```

  Likewise, moving a row through a variable or introducing an extra property through a spread bypasses excess-property checking without changing `keyof Expected`.

`NamesInTable`, `MustBeOk`, or the conditional itself are parts of the assertion; weakening those is the accepted “delete or edit the check” category. Widening `ROWS` alone has no effect.

For question 3: mutual tuple-wrapped assignability is correct for finite literal unions that exclude `any`. The tuple wrapping handles `never` and prevents distributive conditionals. `unknown` and ordinary `string` widening are rejected when only one side has them. But:

- `any` compares equal to every tested non-`never` type.
- `"A" | string` normalizes to `string`.
- `"A" | unknown` normalizes to `unknown`.
- `never` members disappear.

Therefore the formulation establishes equality of the normalized assignability types, not preservation of two finite literal-member sets. It needs explicit guards against `any` and broad `string` at minimum; those still cannot detect a deliberately false finite type assertion in `EXPECTED`.

The current code passes all four TypeScript projects. These bypasses were reproduced separately with the repository’s TypeScript 7.0.2 compiler.