# NO-SHIP

Blockers:

- [evals/declared-spend.ts:366](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/declared-spend.ts:366) and [line 377](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/declared-spend.ts:377) still write `reasoningTokens: null` and `inferenceGeo: null`. The claimed fixes are not implemented.
- [evals/declared-spend.ts:297](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/declared-spend.ts:297): `bodyThrew` is never set. A retried call whose body throws has its real error replaced at line 391.
- [tests/no-undeclared-spend.test.ts:356](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/no-undeclared-spend.test.ts:356) detects only bare `fetch(...)`; `globalThis.fetch(endpoint)` still passes inside a metered declared file—and in tests.

On pricing: blanket 1.1× would be wrong, but US-only inference on Claude 4.6+ should receive it conditionally. That rate is now in Anthropic’s [official pricing documentation](https://platform.claude.com/docs/en/about-claude/pricing).

No account/source cross-check remains correct. The 200 error-envelope dispute is not a blocker for this piece.