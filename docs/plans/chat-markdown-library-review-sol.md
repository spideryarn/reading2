## Findings

1. **High — deeply nested Markdown still crashes rendering.**  
   [`drawBlock`](/home/greg/code/spideryarn2/src/web/Cited.tsx:244), [`drawList`](/home/greg/code/spideryarn2/src/web/Cited.tsx:301), and—while streaming—[`lastText`](/home/greg/code/spideryarn2/src/web/Cited.tsx:193) recursively walk the AST.

   ```md
   >>>>>>>>>>>>>>>>>>>>>>>>>>>>> ... 4,000 times ... deep
   ```

   `fromMarkdown` parses this successfully, but a traversal equivalent to the renderer threw `RangeError: Maximum call stack size exceeded` at roughly 2,400 nested nodes. The old parser’s depth cap therefore protected a behaviour the rewrite lost.

   The claims that all previous defects were fixed and “6,000 nested `>` markers” no longer throw are false for the complete render path in [chat-markdown.md](/home/greg/code/spideryarn2/docs/plans/chat-markdown.md:52) and [chat-markdown.md](/home/greg/code/spideryarn2/docs/plans/chat-markdown.md:99).

2. **High — client and server still disagree about citations because only one side parses Markdown.**  
   Sharing `webLinks` is insufficient when the client calls it separately on individual mdast text nodes.

   Client shows a chip; server removes it as part of one URL:

   ```md
   https://x.example/_spya-k3m9qt_
   ```

   mdast parses the suffix as `emphasis > text`, so the client links `https://x.example/` and chips the ID. `withoutWebLinks` sees the complete raw string as one URL and blanks it.

   Server counts an ID; client considers it part of a link:

   ```md
   [spya-k3m9qt](https://x.example "title")
   ```

   mdast emits one `link`, so the client makes no chip. The raw matcher does not recognise the complete titled link; it removes only the bare destination and leaves the label for the server to count.

   The new `withoutCodeSpans` still does not match CommonMark:

   ```md
   `line
   spya-k3m9qt`
   ```

   and:

   ````md
   ```
   spya-k3m9qt
   ```
   ````

   Both produce no client chip, but the raw server pass counts the ID. Reference links, relative/refused links, HTML attributes, and indented code have similar disagreements.

   The responsibility split is wrong here. Keep `webLinks` as the single bare-URL matcher, but parse Markdown on both sides and apply it only to the same citable text nodes. A second raw Markdown approximation such as [`withoutCodeSpans`](/home/greg/code/spideryarn2/src/urls.ts:333) cannot remain equivalent to mdast.

3. **Medium — adjacent fallback blocks lose their separating characters.**  
   [`sourceOf`](/home/greg/code/spideryarn2/src/web/Cited.tsx:218) preserves each node, but blank lines between root nodes belong to neither node. [`drawBlocks`](/home/greg/code/spideryarn2/src/web/Cited.tsx:234) restores separators only in flat mode.

   ```md
   [a]: https://a.example

   [b]: https://b.example
   ```

   Chat renders the two source strings adjacent:

   ```text
   [a]: https://a.example[b]: https://b.example
   ```

   Two HTML blocks do the same. This directly falsifies “`sourceOf` cannot lose text.” Nested fallback nodes themselves neither overlap nor duplicate because their children are not traversed; the missing inter-node source ranges are the hole.

4. **Medium — the rewrite lost the old leading-whitespace guarantee.**  
   The deleted test explicitly protected:

   ```text
     leading spaces
   ```

   mdast’s paragraph text starts after those two spaces, and the renderer uses `node.value`, so the screen shows `leading spaces`.

   Four-space indentation changes behaviour too:

   ```text
       - indented prose
   ```

   The old parser deliberately treated this as a list. CommonMark treats it as indented code. Neither change appears among the plan’s claimed three reader-visible reversals. Setext headings, escapes, entities, and indented code introduce further unrecorded CommonMark changes.

5. **Medium — streaming work is cumulatively quadratic.**  
   Each update parses and walks the entire prefix, so a linear parse repeated over \(n\) tokens is \(O(n²)\) over the answer. `useMemo` helps only unrelated renders.

   On this machine, parsing a 4KB answer after every four characters took about 2.3 seconds cumulatively; 8KB took 7.6 seconds, before React traversal or DOM reconciliation. The final parse alone was only several milliseconds. Thus “1.5ms is the number that mattered” at [chat-markdown.md](/home/greg/code/spideryarn2/docs/plans/chat-markdown.md:100) is misleading.

6. **Low — `lastText` suppresses completed links when the real tail is not text.**  
   For a live answer:

   ````md
   https://a.example

   ```
   code
   ```
   ````

   the URL is the greatest-offset `text` node because the code block has no `Text` child. It receives `partial=true` and remains unlinked until streaming ends, despite substantial source following it. Inline code and terminal HTML blocks produce the same delayed-link flicker.

   I found no case where a URL inside terminal code, a link, a code block, or an HTML node becomes clickable too early. Those nodes bypass `leaf`. The defect is over-suppression, not premature linking.

7. **Low — the fallback’s missing-position branch contradicts its guarantee.**  
   [`sourceOf`](/home/greg/code/spideryarn2/src/web/Cited.tsx:218) returns `""` when either position is missing. Current `fromMarkdown` output has positions, so I found no parser-produced counterexample, but “cannot lose text” and “whatever CommonMark grows next” are stronger than the implementation. Throwing would at least prevent silent loss.

## Security conclusion

I found no markup or arbitrary-attribute injection path:

- Every enabled core `link` under paragraphs, headings, emphasis, strong, lists, and quotes reaches `drawLink`.
- HTTP(S) and credential checks cover parser links, including angle autolinks.
- `linkReference` and `definition` never become anchors.
- Fallback values are React string children and are escaped.
- Images never become requests.
- Model-controlled attributes are limited to the validated `href` and numeric ordered-list `start`.

The library choice is right. The direct mdast-to-React walk is also reasonable. The wrong part is keeping the server on a raw-text approximation after the client became AST-aware.

Literal byte-for-byte preservation is not the actual contract: Markdown escapes/entities are interpreted, and [`splitCitations`](/home/greg/code/spideryarn2/src/web/citations.ts:134) deliberately drops unknown IDs from a mixed known/unknown run. Those are explicit policies. The accidental losses I found are root fallback separators and paragraph indentation.

The current DOM suite misses both, plus the renderer recursion failure and the divergence examples above. TypeScript and scoped Biome checks passed. Vitest could not run because the read-only environment prevented Vite from creating temporary directories. No files were changed.