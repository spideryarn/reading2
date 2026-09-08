# Review 3: Stage 3 — a narrowly scoped check of two compile-time assertions

**Scope: two type declarations in `src/vercel-health.ts`, and nothing else.** You have refused this
stage twice, both times correctly, and both times because a check of mine answered a weaker question
than its message claimed. Discovery is closed. Do not raise findings about anything outside the two
assertions below, and do not re-open Stages 1 or 2, the syntactic checks, the prose, or the door
decisions — those are settled or are mine to settle.

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal`. Full diff at
`/tmp/claude-1000/-home-greg-code-spideryarn2/404961e7-a9af-47c9-bf9e-38918ba8ffc4/scratchpad/envlitS3-diff-3.txt`.

## What changed since your round two

Your P1-1 was that my compile-time check tested one sample literal rather than the property, and
your `ExpectedRow` widening walked past it. Your P1-2 was that requiring the `satisfies` target to
be spelled `readonly Expected[]` does not stop the *interface* being widened. Both are now asked of
the compiler as properties:

```ts
type MustBeOk<T extends "ok"> = T;

type NamesInTable =
  | (typeof EXPECTED)[number]["name"]
  | Extract<(typeof EXPECTED)[number], { or: string }>["or"];

export type ReportedEnvNameIsExactlyTheTable = MustBeOk<
  [ReportedEnvName] extends [NamesInTable]
    ? [NamesInTable] extends [ReportedEnvName]
      ? "ok"
      : "the brand is missing a name the table carries"
    : "the brand admits a name the table does not carry"
>;

export type ExpectedHasNoIndexSignature = MustBeOk<
  string extends keyof Expected ? "Expected has a string index signature" : "ok"
>;
```

`NamesInTable` is written from `typeof EXPECTED` **directly**, with no intermediate alias, so a
widening of `ExpectedRow` moves `ReportedEnvName` and not the thing it is compared against.

Both of your round-two mutations were re-applied to the finished code and both now fail to compile:

- `type ExpectedRow = (typeof EXPECTED)[number] | { name: "NEW_ONE"; or: "NEW_TWO" }` →
  `TS2344: Type '"the brand admits a name the table does not carry"' does not satisfy the constraint '"ok"'`
- `[key: string]: unknown` added to `interface Expected` →
  `TS2344: Type '"Expected has a string index signature"' does not satisfy the constraint '"ok"'`

The syntactic checks in `tests/env-names-are-inventoried.test.ts` are kept as a cheaper, weaker
layer, and the gate now asserts both of these aliases still exist — verified by renaming one and
watching it go red. They are `export`ed only because `noUnusedLocals` rejects an unused local; the
export is not part of the interface and nothing imports it.

## What I want from you, and only this

1. **Is there a way to admit a name `EXPECTED` does not carry while
   `ReportedEnvNameIsExactlyTheTable` still resolves to `"ok"`?** Try widening in every place you
   can reach: `ExpectedRow`, `ReportedEnvName` itself, `NamesInTable`, `Expected`, the `EXPECTED`
   literal, the `ROWS` annotation, `MustBeOk`. Say which of those are *deliberate edits to the
   assertion itself* (which I accept — you cannot stop someone deleting the check, only make it
   visible) and which are widenings *elsewhere* that the assertion fails to notice. Only the second
   kind is a finding.
2. **Same question for `ExpectedHasNoIndexSignature`:** a way to turn off `satisfies`'s
   excess-property checking for this table while that still resolves to `"ok"`. A numeric or symbol
   index signature, a mapped type, a widened `MustBeOk`, an interface merged from a second
   declaration — whatever you can find.
3. **Is `[A] extends [B] ? [B] extends [A]` the right formulation** for "these two unions have the
   same members", given `any`, `never`, `unknown` and a union with a `string`-typed member could
   each appear on either side? Where does it give a wrong answer, if anywhere?

If you find nothing in scope, say so plainly and say the stage should land. I am not looking for a
fourth round unless one of the above is genuinely open.
