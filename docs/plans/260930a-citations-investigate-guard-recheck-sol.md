Verdict: **broken: a blockquote after a lone `\r` line ending bypasses the guard.**

- **G-1 — P0 — Unverified blockquote leaks.**  
  Input: `"Safe prose\r> fabricated line"`  
  Chunking: `["Safe prose\r", "> fabricated line"]` (also leaks as one chunk and character-by-character).  
  Allowed texts: `[]`  
  Actual: `{ released: "Safe prose\r> fabricated line", failed: null }`  
  Cause: [investigate-quote-guard.ts:188](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/investigate-quote-guard.ts:188) recognizes only `\n` as a line boundary.

Failing test, text only:

```ts
it("guards a blockquote after a CR line ending", () => {
  const text = "Safe prose\r> fabricated line";
  for (const chunks of [[text], ["Safe prose\r", "> fabricated line"], [...text]]) {
    expect(run(chunks, [])).toEqual({
      released: "Safe prose\r",
      failed: { cause: "not-found" },
    });
  }
});
```

- **G-2 — P2 — Common legitimate s-ending terms remain refused.**  
  `"The article says ‘fitness’ means health."`, allowed `["fitness"]`, returns `unclosed` and releases only `"The article says "`. The whitelist accepts only `as/is/are/was/were`.

- **G-3 — P1 — The exact D-1 form fails when ordinary following prose exceeds the quote cap.**  
  `"The article says ‘fitness’ is " + "ordinary prose ".repeat(35)`, allowed `["fitness"]`, returns `unclosed`. Once `is` marks the first `’` as the prose close, all subsequent prose remains held and counts toward the 400-character cap at [investigate-quote-guard.ts:233](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/investigate-quote-guard.ts:233).

The specifically named short prose cases—`authors’ claim`, `‘fitness’ is`, `what’s`, a sentence-final `’`, and `‘Principia’, then`—all passed both whole-input and character-by-character chunking.

`npx vitest run tests/investigate-quote-guard.test.ts`: **26/26 passed**. The scoped files are unchanged from `cc2a26f4`; no files were edited.