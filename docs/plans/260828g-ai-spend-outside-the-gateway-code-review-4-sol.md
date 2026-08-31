# NO-SHIP

Two blockers remain:

- [The scanner](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/no-undeclared-spend.test.ts:369) still misses the exact `globalThis.fetch(endpoint)` shape when `endpoint` is a variable. It searches only the call arguments’ AST for the hostname; the new test uses an inline URL at [line 668](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/no-undeclared-spend.test.ts:668). This passes in both tests and metered declared files.

- The pricing refusal was right until the primary source was checked. It is checked now: Anthropic documents 1.1× for US inference on Claude 4.6+ across every token category; workspace defaults can select US even when the request omits it. Haiku 4.5 is unaffected. Shipping a knowingly low `computedCostNanos` is incompatible with accurate tracking. Apply it conditionally and update `PRICE_CHECKED`. [Anthropic documentation](https://platform.claude.com/docs/en/manage-claude/data-residency)

The previous three blockers are correctly fixed. The targeted 75 tests pass. Typechecking found only the stated unrelated files.