I found three production defects and several tests that overstate their coverage.

1. High — `urlKey` is unsafe as a hard refusal

Both [readWebPage](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat-tools.ts:824) and [destinationOf](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat-tools.ts:693) treat `urlKey` equality as proof of the same page.

It correctly catches protocol-relative URLs, host case, one trailing slash, `www`, UTM parameters, default ports, fragments, and HTTP versus HTTPS. Non-default ports remain distinct.

But it also over-refuses. `http://example.com/x` and `https://example.com/x` can serve genuinely different pages; [normaliseUrl’s own contract](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ingest.ts:167) says exactly that. `www` and trailing-slash routes can differ too. The tool then falsely tells the model that the requested content is already open.

It under-refuses as well: `/%78` versus `/x`, a trailing-dot host, or an arbitrary non-tracking query can fetch the same article.

Smallest fix: use a conservative request-equivalence helper here—same scheme, normalized host/default port, path and query; ignore only the fragment. Keep `urlKey` for shelf deduplication, where its false-positive trade-off was designed to apply.

2. Medium — genuinely different links collide

The key in [linkFrom](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat-tools.ts:721) is built from the resolved destination and already-clipped text.

Two failures follow:

- `#gone` and `#other` with the same text both resolve to `{url:null,targetBlockId:null}`, so they become one row with merged block IDs. I reproduced this.
- Two labels with the same first 80 characters but different endings collide after clipping.

That makes totals and locations wrong, contradicting the exact-count claim.

Smallest fix: deduplicate with a separate identity containing the raw decoded fragment and full whitespace-normalized text. Clip only the displayed label.

3. Medium — the 4,000-character cap is not a cap

The guard at [readArticleLinks](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat-tools.ts:1183) accounts correctly for separators, never emits zero matched rows, and the partial sentence works for both ordinary cap paths.

But `shown.length > 0` makes the first row unconditional. Since `blockIds` is unbounded, one repeated link can produce an arbitrarily large row. With 500 blocks, I measured a 6,029-character row and 6,273-character result; it reported one complete link, not partial.

Smallest fix: bound the displayed block-ID list and state the exact location count, while retaining all IDs internally for queries.

4. Medium — several tests can pass against plausible bugs

- [The character-bound assertion](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-tools.test.ts:507) uses `LINKS_CHARS * 2`. It is not wholly vacuous, but a roughly 7KB cap would pass. Assert the joined row payload is `<= 4_000`, and add the oversized-one-row case.
- [The different-page test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-tools.test.ts:572) merely checks the result is not `"already open"`. Any network failure or different refusal passes. Spy on `fetch` and require one call.
- [The fence test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-tools.test.ts:453) proves the heading precedes an opening fence, but not that the rows are inside it.
- [The registration test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-tools.test.ts:647) checks only that names in `CHAT_TOOLS` are unique; `TOOL_NAMES` is constructed from that same array. Its title claims more.
- The block-ID query test uses a singleton link. It would not catch searching only the first ID of a deduplicated row.

5. Low — extracted “link text” is not necessarily visible text

The case-sensitive shortcut at [articleLinks](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat-tools.ts:743) misses valid uppercase `<A>` markup. Current corpus serialization appears lowercase, so present damage is small.

Also, [textContent](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat-tools.ts:715) includes every descendant, including superscripts and hidden spans, with no separator. I reproduced `Study<sup>12</sup><span hidden>secret</span>` becoming `Study12secret`. Define whether this is DOM text or visible label text; the plan’s “verbatim” claim is currently false.

Sound after inspection:

- The fence is placed correctly, and delimiter escaping prevents exact textual breakout.
- `template.innerHTML` replaces the previous fragment.
- Block-ID order follows `blocks.json` order.
- Long URLs are named without being printed.
- Logging matches the documented fields.
- The `ChatPanel` icon dispatch correctly uses `Link2`.

The targeted slice passed: 30 tests. The full test file had 66 passes and 13 known unrelated `response.headers.get` failures. No files were edited.