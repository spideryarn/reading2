Verdict: **broken: G-1 allows an unverified Unicode-indented blockquote through.**

- **G-1 — P0 — Unicode-leading blank bypasses blockquote detection.**

  Input: `"\u00A0> fabricated line"`  
  Allowed texts: `[]`  
  Tested chunkings: whole input, split after NBSP, every two-way split, and character-by-character.  
  Actual result for all: `{ released: "\u00A0> fabricated line", failed: null }`

  [`isBlank`](</home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/investigate-quote-guard.ts:114>) recognizes only ASCII space and tab. NBSP therefore clears `atLineStart`, so the following `>` is never guarded.

```ts
it("guards a blockquote after a non-breaking-space indent", () => {
  const text = "\u00A0> fabricated line";
  for (const [split, result] of runsAcrossSplits(text, []).entries()) {
    expect(result, `split ${split}`).toEqual({
      released: "",
      failed: { cause: "not-found" },
    });
  }
});
```

- **G-2 — P3 — Literal property edge:** punctuation-only spans such as `"!"`, `“!”`, `‘!’`, and `> !` pass with no allowed texts because trailing punctuation reduces the checked content to empty. No words leak, and the header documents the normalization, but it is technically an exception to the property as worded.

Legitimate-prose results: all requested forms passed under every two-way split and character-by-character delivery:

- `The authors’ claim`
- `‘fitness’ is`
- `what’s`
- sentence-final `’`
- `‘Principia’, then`

No new legitimate-prose refusal was found. The documented accepted refusal involving a later plural possessive remains.

Focused test result: **38/38 passed**. The scoped files match `b6ec2f10`; no files were changed.