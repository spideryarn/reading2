# An observed provider error lost to a later stream throw

Up: [postmortems.md](../project/postmortems.md). Review finding F9 in stage 1 of
[261006b](../plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md).

**Class: terminal-path inference overrides observed protocol evidence.** Introduced by
`e5a9c07a7f9984301cbddf6b7d511b9b84098d6a`, in `openRouterStream` in
[`src/ai-call.ts`](../../src/ai-call.ts). Found before the stage's review was complete.

The generator remembered an in-band error chunk, but consulted that evidence only when its
provisional outcome was still `ok`. A later body read could throw first, setting the outcome to
`error` or `aborted`. The branch described as giving the provider's error precedence was then
unreachable: a socket failure replaced `in_band` with `network:UND_ERR_SOCKET`, and a throwing
abort erased the failure fields entirely. The existing error-chunk tests covered consumer return
and clean exhaustion, which never exercised that branch after `catch`.

Two new tests in [`tests/ai-call-transport-retry.test.ts`](../../tests/ai-call-transport-retry.test.ts)
failed before the fix. Both expected `(1, error, mid_answer/in_band/200)`; the socket case got
`mid_answer/network:UND_ERR_SOCKET/200`, and the abort case got `(1, aborted, null)`.

The fix makes the observed in-band error take precedence in finalisation regardless of the
provisional outcome. It preserves the caller's thrown error and the single network attempt. This
is also the durable fix: infer a cause from termination only when no explicit protocol failure
was observed.

The cheap, high-value prevention is to compose observed protocol evidence with clean exhaustion,
consumer return, socket failure and both clean and throwing cancellation. Assert the full recorded
failure and the caller's unchanged error, rather than just the number of rows. The two added tests
cover the missing throwing paths; existing tests cover the ordinary return and completion paths.
