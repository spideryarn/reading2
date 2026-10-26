I would build a cheap, press-only web fallback first, while keeping the OpenAlex full-text path experimental until its precision is measured. In the UI, keep one **After it** area but preserve two evidence classes:

- **Possible citations in OpenAlex** — candidate papers found through indexed full text.
- **References found on the web** — pages whose returned extract explicitly identifies the piece.

Never add these to OpenAlex’s citation count.

### 1. The free list

It is honest enough only under **Possible citations**, not **Cited by**. The search does not prove exact occurrence: the Olah result demonstrates stemming. A surname elsewhere in the paper also proves nothing.

Before showing it automatically, I would require at least 95% of displayed top-five candidates to refer to the intended piece, with no systematic failure for a title class. Calling rows simply “Cited by” needs closer to 98% and row-level evidence. Eight pieces are useful exploration, not enough to establish that.

Do not fetch arXiv HTML as the live prerequisite: that produces a biased mixture of verified arXiv rows and unchecked others. Use full documents during evaluation. Later, an accessible reference-section match could upgrade an individual row from “possible.”

Several proposed filters are wrong:

- Do not drop every work whose title contains the piece’s title. That removes *Response to …*, *Revisiting …* and similar follow-ups. Exclude the original work and copies instead.
- Do not hard-drop pre-publication-year rows. Preprints, revised editions and OpenAlex date errors make the boundary unreliable. Allow a one-year tolerance and treat dates as evidence, not identity.
- Do not reuse `searchableTitle` unchanged: it requires an author, excluding the motivating authorless piece.
- Do not sort primarily by citation count. It elevates authoritative-looking false positives. Rank by identification confidence, then relevance/date; citation count can be secondary.
- Bound the candidate set. “Show all” must not mean retrieving thousands. Suppress obviously ambiguous queries such as “Simulators,” or cap the stored results and say so.

### 2. One list or two

One component, two labelled sections. If the same citing work appears in both, show one row with both provenance labels and retain the web quote.

Dedupe only through strong identities, in order:

1. DOI or arXiv id;
2. OpenAlex id when mapped;
3. canonical URL/`sameTarget`;
4. an exact normalized title plus compatible author and year, used cautiously.

Never silently merge on title alone. Keep the two counts separate and never imply exhaustiveness.

### 3. Web-result checks

“The quote names the piece” is necessary but insufficient. In particular, surname plus year is far too weak. Prefer:

- the piece’s canonical URL; or
- its full distinctive title;
- for a short title, title plus author and year.

Search for the public source URL first, then quoted title plus author. The URL is the strongest missing query and can rescue short titles.

The same-host rejection should be removed. A later post on the same blog, another Substack author, or another arXiv paper can genuinely cite it. Reject the exact source URL, its aliases, and local shingle-detected copies instead. The article text can remain server-side for that comparison.

`titleNamesWork` is the wrong positive check: it identifies a page that is the work itself. For a citing page, use it only as a warning that the result may be the original or a copy. The annotation title should instead identify the citing page and differ from the target title. Store the annotation’s title, never `citingTitle` invented by the model.

Require two pieces of evidence:

- an **identification witness** naming/linking the target piece;
- a **citation-context witness** showing it used as a reference, bibliography entry, response, or substantive link.

Check each extract segment independently; nothing may match across the `" ... "`/extract separator.

A paper’s reference list counts. A reading list, Hacker News thread, search page or citation aggregator does not represent an independent citing work. Host denylists help but cannot prove page type; ambiguous cases should be rejected. Reuse Reception’s `namesArticleBy`, canonical-URL and copy-detection machinery rather than creating weaker parallel rules. Also reuse already-stored qualifying Reception rows instead of paying to rediscover them.

### 4. Second LLM check

Use one additional **batched, tools-free** checker over all surviving extracts, not one call per row. Ask it to classify each as citing work / original or copy / aggregator or list / namesake / unclear, and reject `unclear`.

The first model both searches and selects, while deterministic code cannot reliably distinguish a citation from a reading list. The checker is cheap and follows the existing citation-note pattern. Measure its incremental precision and false rejections; remove it later if it contributes nothing.

### 5. V1 cuts

For v1 I would ship:

- the press-only web search;
- at most five accepted rows;
- literal checked evidence, with no generated descriptions;
- shared Reception verification primitives;
- batched checking;
- single-flight presses, its own allowance, stage frames, and seven-day completed-negative caching.

I would defer the live OpenAlex full-text list, full-text fetching, pagination beyond a small bound, and elaborate cross-source fuzzy deduplication.

Two final gaps:

- `max_total_results` limits returned evidence, not tool calls or spend. Reception has observed many searches behind a small result cap, so “one or two searches” is a prompt request, not a ceiling. Record actual calls and cost, and size the fuse from measured worst cases.
- Sampling returned hits measures precision, not recall. Measure recall against known positives: DOI-backed papers tested with their DOI hidden, plus curated blog-to-blog citations. Include authorless and short titles, namesakes, copies, same-host citations and negative controls. Cache by article identity and validation version; metadata changes must invalidate both results and stored “none.”

No files were changed.