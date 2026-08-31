## Findings

1. **High — headings silently delete a trailing `#`.**  
   [`HEADING`](/home/greg/code/spideryarn2/src/web/markdown.ts:54) treats any final hashes as closing markers, even without the required preceding space.

   ```md
   # Learn C#
   ```

   renders as “Learn C”. This violates the text-preservation claim.

2. **High — streaming URLs become clickable too early inside headings and quotes.**  
   [`drawBlock`](/home/greg/code/spideryarn2/src/web/Cited.tsx:354) passes `partial=false` for both headings and quotes.

   ```md
   > See https://good.example
   ```

   While streaming, that incomplete URL is linked. A later `.evil.example/x` changes its destination. Paragraphs and ordinary list items correctly defer linking. This is not XSS, but it enables transient wrong navigation and contradicts the nearby `partial` comments.

3. **Medium — the inline pass order cannot represent valid nesting.**

   ```md
   [run `npm test`](https://example.com/x)
   *see [source](https://example.com/x) now*
   **this is *italic* too**
   ```

   The first is split at the code span before links are recognised. The second leaves literal outer stars because italics are computed separately inside each link/text leaf. The third leaves the outer `**` literal because [`splitEmphasis`](/home/greg/code/spideryarn2/src/web/citations.ts:311) refuses any `*` inside bold text.

   The current-tree fix for `**run with `code` inside**` does work, but it fixes only that particular crossing.

4. **Medium — Unicode words can lose underscores.**  
   [`ITALIC`](/home/greg/code/spideryarn2/src/web/citations.ts:425) uses ASCII `\w`.

   ```text
   café_naïve_été
   ```

   renders with `naïve` italic and both underscores removed.

5. **Medium — a malformed closing fence swallows text.**  
   [`takeCode`](/home/greg/code/spideryarn2/src/web/markdown.ts:178) reuses the opener regex for closers, allowing an info string:

   ````md
   ```ts
   body
   ```js
   after
   ````

   `js` disappears and the code block closes. A closing fence cannot carry an info string.

6. **Medium — pathological input is quadratic and can crash rendering.**  
   Every blank line inside [`takeList`](/home/greg/code/spideryarn2/src/web/markdown.ts:248) slices and scans the entire remaining input. A 16,000-blank-line list probe took about 1.6 seconds, and parsing repeats on every token. Deeply nested quotes or lists eventually throw `RangeError: Maximum call stack size exceeded`; roughly 6,000 quote markers reproduced it.

7. **Low — prose preservation and indentation comments are false.**

   - `  leading spaces` loses its spaces because [`takePara`](/home/greg/code/spideryarn2/src/web/markdown.ts:297) calls `.trim()`.
   - `    - indented prose` becomes a list, despite the comment saying markers beyond three spaces remain prose. The list regexes accept unlimited indentation.

8. **Documentation/comments have materially drifted.**

   - The claim that “every Markdown library returns HTML” in [chat-markdown.md](/home/greg/code/spideryarn2/docs/plans/chat-markdown.md:28) is false.
   - Model syntax also controls `<ol start>`, fixed heading elements, and citation attributes, so “only links reach an attribute” is false.
   - CitedText now interprets italic and inline code in summaries, contradicting comments that summaries interpret bold only.
   - chat-mode.md still describes everything beyond bold as literal.

## Security conclusion

I found no path where raw model text becomes HTML or an arbitrary attribute. React escapes text; URLs remain restricted to validated HTTP(S); ordered-list starts are numbers; heading names are fixed to `h4`–`h6`. The concrete security-adjacent defect is the premature streaming link above.

## Approach verdict

I think the hand-written parser is now the wrong trade-off. Security does not require it: [react-markdown](https://github.com/remarkjs/react-markdown/blob/main/readme.md) renders React elements without `dangerouslySetInnerHTML` by default, while [remark](https://github.com/remarkjs/remark/blob/main/readme.md) can supply an AST for bespoke rendering.

Keep raw HTML disabled, retain the existing URL policy and custom citation components, but use a tested Markdown tokenizer/AST. This parser already has silent loss, nesting, streaming and complexity bugs—the exact classes mature parsers exist to handle.

Typecheck and scoped lint passed. Vitest could not start because the read-only environment prevented Vite from creating its temporary directories; direct parser and server-render probes reproduced the findings above. No files were changed.