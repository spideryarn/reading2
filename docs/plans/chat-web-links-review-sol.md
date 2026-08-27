Verdict: do not ship as written. The hover-card safety claim and regex runtime claim do not hold.

## Findings

1. **High — the hover card is not a safety boundary.**  
   [Cited.tsx:94](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Cited.tsx:94), [useHoverCard.ts:315](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useHoverCard.ts:315), [ProseHoverCard.tsx:158](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProseHoverCard.tsx:158)

   Input: `[the Anthropic paper](https://not-anthropic.example/)`.

   A quick desktop click can happen before the 320ms card delay. On touch, links deliberately navigate immediately; `tapSelector` includes only glossary terms. The reader therefore does not necessarily see the real host before deciding. `https://trusted.example@evil.example/` also passes `isWebUrl`; only the optional card makes `evil.example` conspicuous.

   `noopener noreferrer` limits what happens after navigation, but does not address deceptive navigation.

   Smallest fix: show the normalized host visibly beside every labelled model link. Also reject URL credentials. Otherwise downgrade every claim that the card is a defence.

2. **High — `MD_LINK` has quadratic failure behaviour.**  
   [citations.ts:63](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/citations.ts:63), [ChatPanel.tsx:1488](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:1488)

   Input: `"[".repeat(n) + "x"`.

   Because the label allows another `[`, every possible opening bracket scans most of the remaining string looking for `]`. Using the exact pattern:

   - 8,000 brackets: 94ms
   - 16,000: 332ms
   - 32,000: 1.25s

   Every streaming update reruns it over all accumulated paragraphs, so total work is worse than the single-pass figures. I did not find exponential backtracking in the URL-parenthesis groups—their delimiters are disjoint—but this quadratic scan is enough to freeze the reader.

   Smallest fix: exclude `[` from the label class: `([^\[\]\n]+)`. Add a scaling test, not only a timeout at one size.

3. **Medium — enabling links in shared `CitedText` creates an unrequested summary-model `href` sink.**  
   [Cited.tsx:83](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Cited.tsx:83), [SummaryPanel.tsx:620](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SummaryPanel.tsx:620)

   Sequence: an untrusted article steers the summary model into returning `[the source](https://evil.example/)`. Summary mode now renders it as a working anchor and gives it a card through `a.cited-link`, although neither the request nor the chat-only prompt governs summary output.

   The plan acknowledges working summary links while calling previews there “not built”; they are in fact built.

   Smallest fix: make linkification opt-in and enable it from `ChatPanel.Answer` only. If summary links are wanted, give that producer the same provenance rule and document the expanded security boundary.

4. **Medium — bolded bare URLs get the wrong `href`.**  
   [citations.ts:74](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/citations.ts:74)

   Input: `**https://x.example/y**`.

   `BARE_URL` accepts `*`, producing:

   ```text
   text("**")
   link(text="https://x.example/y**", href="https://x.example/y**")
   ```

   The link goes to the wrong path and the Markdown markers remain visible.

   Smallest fix: exclude `*` from `BARE_URL`. The spanning-emphasis problem below still needs its own fix.

5. **Medium — web URLs corrupt the citation-health metrics.**  
   [converse.ts:999](/Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:999), [converse.ts:1020](/Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:1020), [converse.ts:1911](/Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:1911)

   Input: `Notes: https://example.com/spya-k3m9qt`.

   Rendering correctly protects that id by extracting the URL first. The server’s `citedBlockIds` and `unknownCitedIds` still scan raw answer text. Depending on whether that id exists, the log records a false article citation or a false hallucinated id. Those are explicitly load-bearing monitoring signals.

   The client/server agreement test at `tests/chat.test.ts:352` misses this because both implementations share the same raw-regex mistake.

   Smallest fix: remove recognized link destinations before both metric scans, using the same parser rather than another URL regex.

6. **Medium — review-mode chat lacks the new provenance instruction.**  
   [converse.ts:350](/Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:350), [converse.ts:578](/Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:578)

   Review threads can search the web, and their answers use the same renderer, but `LINKING TO THE WEB` exists only in `SYSTEM`, not `REVIEW_SYSTEM`. A review answer can therefore emit a working model-selected URL without being told “tool result from this turn only.”

   Smallest fix: extract this block into one constant and interpolate it into both prompts.

7. **Medium — nested parentheses produce a truncated destination.**  
   [citations.ts:49](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/citations.ts:49), [citations.ts:63](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/citations.ts:63)

   Input:

   ```text
   [Foo](https://en.wikipedia.org/wiki/Foo_(bar_(baz)))
   ```

   The Markdown pattern fails, then the bare alternative links only `https://en.wikipedia.org/wiki/Foo_`, leaving the rest as punctuation-like text. The same truncation occurs for the bare form.

   The comment claiming one level is “all CommonMark itself promises” is false; current CommonMark permits arbitrary balanced parentheses. [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/#links)

   Smallest safe fix: either support a bounded deeper level, or refuse a bare-prefix match when the next character is `(` so malformed Markdown stays literal rather than linking the wrong page.

8. **Low — `TRAILING` changes valid URLs.**  
   [citations.ts:85](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/citations.ts:85), [citations.ts:130](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/citations.ts:130)

   Input: `Read https://x.example/search?q=why?`.

   The final `?` is valid query data but becomes text outside the anchor; the link goes to `...?q=why`. Commas, semicolons and exclamation marks can likewise be legitimate path/query characters. The combined visible text looks unchanged, so the smaller clickable range is hard to notice.

   Smallest fix: at least preserve `?` when the URL already contains a query marker. More generally, document that bare-address punctuation is ambiguous and prefer leaving uncertain characters inside the URL.

9. **Low — emphasis cannot span a link anymore.**  
   [Cited.tsx:83](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Cited.tsx:83), [citations.ts:273](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/citations.ts:273)

   Input: `**see [here](https://x.example/y) now**`.

   Link extraction creates three runs, and each gets emphasis-parsed independently. Both text runs have unmatched `**`, so the markers print literally instead of bolding the sentence. Before link extraction, `splitEmphasis` handled the whole string correctly.

   Smallest fix: carry bold state across the sequence of link/text runs instead of restarting emphasis parsing per run.

10. **Low — the documentation’s security inventory and streaming explanation are false.**  
    [security.md:702](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/security.md:702), [chat-web-links.md:119](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-web-links.md:119)

    `security.md` still says there are exactly two model-output-to-attribute exceptions and omits inline chat/summary links.

    The plan also says React replaces the entire `<p>` on every streamed update. With the stable index key and element type, React preserves both the `<p>` and an existing `<a>` during ordinary updates; I confirmed their DOM identities remain equal across renders. The generic MutationObserver statement about observing a detached child is correct, but its claimed chat premise is not.

    The broader `.chat-turn` host is harmless robustness. `closest(".prose, .chat-turn")` and `[shown, host]` are correct.

    Smallest fix: update the security inventory, relabel summary support, and remove the false `<p>` replacement rationale.

11. **Low — valid mixed-case schemes are missed.**  
    [citations.ts:63](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/citations.ts:63), [citations.ts:76](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/citations.ts:76)

    `HTTPS://example.com/x` is a valid HTTPS URL but neither regex matches it.

    Smallest fix: use the `i` flag on `LINKED`.

## Numbered-area accounting

1. Regexes: findings 2, 4, 7, 8 and 11. No exponential URL-group blow-up found; quadratic bracket scanning exists.
2. Text loss: no loss or duplication found in `stop` arithmetic. I swept 10,000 two-link/trailing-punctuation cases; reconstructed text was identical.
3. Pass interaction: findings 4, 5 and 9.
4. `partial`: no defect found. A trailing blank line creates an empty last paragraph, but that blank line itself proves the prior URL ended.
5. Security: findings 1, 3 and 6. `isWebUrl` is sufficient against scheme smuggling/XSS at this sink; `%00`, embedded `data:` text and encoded newlines remain inert parts of an HTTP URL. It is not sufficient against deceptive HTTP(S) destinations.
6. Selector narrowing: no article-prose break found; all injected article blocks are under `.prose`. Summary behavior is finding 3.
7. `host`/observer: no hook defect found. The stated React premise is wrong; selector-list `closest()` and dependencies are correct.
8. Streaming cost: finding 2. `matchAll` leaves the private global regex’s `lastIndex` at zero, so ordinary calls have no state hazard.
9. Plan/docs: findings 3, 7 and 10.

The two requested Vitest files could not start under this read-only sandbox because Vite attempted to create `node_modules/.vite-temp/...`; I did not treat that startup failure as a product defect.