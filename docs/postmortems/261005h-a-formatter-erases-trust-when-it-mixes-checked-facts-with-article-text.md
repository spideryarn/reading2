# A formatter erases trust when it mixes checked facts with article text

Code review of the unlanded 261005i candidate caught a mismatch with its plan: chat's concrete
Crossref count, source and read day were inside the article's untrusted fence. The explanation
outside the fence was correct, but the values were marked as article data. This was caught before
landing; no incorrect reader answer was established.

## Trust-level erasure during formatting

Commit `83b247bc3` added `citedByScore` to `citationRow` in
[`chat-tools.ts`](../../src/chat-tools.ts). That formatter mixed checked registry facts with titles
and descriptions from the article and its model-generated list. `citationsResult` fenced the mixed
string, losing the distinction the plan required. A root-cause subagent independently identified
the same composition error.

The existing tests verified the values in a row and the general explanation outside the fence,
separately. Neither checked which side of the final boundary contained the concrete values.

## The fix

The formatter returns count attributions separately from article rows. Displayed row numbers tie
them together without copying titles or raw date strings outside the fence. Filtering, row caps
and the character budget accept each row and its attribution together. The existing single article
fence remains around the article text.

## What would have caught the class, ranked

1. **Assert the final boundary with a concrete value.** Added to
   [`chat-citations-tool.test.ts`](../../tests/chat-citations-tool.test.ts), observed red before the
   fix and green afterwards. It checks attribution after filtering; another case checks caps and
   the combined character budget.
2. **Keep checked facts separate until rendering.** Implemented in `CitationListing`, so the
   final formatter chooses their trust boundary explicitly instead of inheriting one from a string.
3. **A general typed framework for every chat formatter.** Rejected for this fix: it would change
   unrelated tools and their existing output contracts. The separated fields and boundary test
   address this addition directly.

Up: [postmortems.md](../project/postmortems.md)
