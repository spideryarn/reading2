# Entering a fetch abstraction is not dispatching a request

The typed guide's new one-page allowance was first charged on entry to
`fetchDocument`, not when that function sent its first HTTP request. A malformed, unsupported or
private address therefore used the allowance even though the fetcher refused it before transport,
and the next valid page was refused as the second read. The defect was found in the Stage 2B code
review before commit; nothing reached a reader.

## What happened

Stage 2B put a `beforeFetch` callback in `readWebPage`, after that function's three local refusals
and before its call to `fetchDocument`. The name and position looked like the contract: count only a
read that would fetch.

But `fetchDocument` is an abstraction over more than HTTP dispatch. It parses the URL, checks its
scheme, resolves its host and refuses private addresses before it calls `fetchImpl`. The policy hook
sat outside all of those checks. The red-first test made the mismatch visible:

```text
expected 'limit reached' to be 'blocked-address'
```

The unsupported `file:` call had already incremented the WeakMap, so the following loopback call
never reached the address guard.

## Entering a fetch abstraction is not dispatching a request

This is **a policy hook placed before a callee's hidden refusals mistaking entry into an abstraction
for the side effect the abstraction may eventually perform**.

The mistake recurs wherever a caller wants to meter, authorise or report an action whose real
boundary is inside a helper. A function named `fetchDocument` does not imply that every call fetches;
in this code, most of its security work consists of deciding not to.

The defect was introduced in the uncommitted Stage 2B diff for plan 261017e. There is no introducing
commit to name.

## Why nothing went red

`tests/guide-tool-gate.test.ts` mocked `fetchDocument` at its exported boundary and recorded entry to
that mock as a fetch. The test and the implementation therefore shared the same false boundary: both
treated calling the helper as proof that transport had begun. It could prove the local no-address,
long-query and open-article refusals, but none of the fetcher's own preflight refusals.

The sequential one-read test used two ordinary public addresses. It proved the WeakMap count and a
new context's reset, not where the first count was earned. No test tried a refused address followed
by a valid one in the same context.

## What would have caught it, ranked by ease against value

1. **Exercise the real transport seam** — done. The tool test now uses real `fetchDocument` with
   deterministic DNS and HTTP seams. Malformed, unsupported, literal-private and DNS-private targets
   must leave the valid read available; two concurrent valid calls may dispatch only one request;
   and a dispatched request still spends the read when transport fails.
2. **Put action policy at the action boundary** — done. `FetchOptions.beforeFirstRequest` runs after
   the first address guard and immediately before `fetchImpl`, once across redirects and retries.
   Fetch-layer tests pin both sides of that boundary.
3. **Duplicate the fetcher's URL and address checks in `chat-tools.ts`** — rejected. It is initially
   smaller, but DNS resolution and the SSRF rules would then have two implementations that can drift;
   the second one could also undermine the connection pinning that makes the real guard meaningful.
4. **Refund the allowance by failure code** — rejected. A redirect to a private address and a
   connection failure both happen after an HTTP request was already sent. The final error code does
   not say whether the side effect occurred, so refunding from it would recreate the same boundary
   mistake after the fact.

## The fix that is right for the long term

The fix is also the long-term one: the fetch layer exposes a narrow, generic gate at its
first transport dispatch. It carries no guide or `ToolOutcome` knowledge. A false result throws a
dedicated veto that bypasses network classification and retries; `readWebPage` maps that veto back
to its already-built limit outcome.

The gate is consumed once per logical fetch. Retries and redirects do not ask it again. If the first
address is refused, it is never asked. If a server was contacted and then redirected somewhere
private, the allowance remains spent because an HTTP request really happened.

## The thing I would tell myself

I knew `fetchDocument` owned the URL and SSRF checks, but I still placed a hook outside it and called
that position "before fetch". When the contract is about whether a side effect happened, I need the
seam beside the side effect, not beside the function whose name suggests it.
