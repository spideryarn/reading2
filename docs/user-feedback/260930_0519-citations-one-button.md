# Citations: one button instead of *Look it up* and *Investigate*

SPIDERYARN-READING2-75 (`spya-mbgnwh`), from Greg, relayed by the Overseer. Sent 2026-09-30 05:19
from production `a522ba8c`, on `dongetal25-spya-vfmvmm` in Citations mode:

> In Citations mode, can we amalgamate "Look it up" and "Investigate" buttons to get the best of
> both worlds?

It answers the first of the two calls [5Q](260930_0125-citations-investigate-one-work.md) left in
[awaiting-approval.md](awaiting-approval.md).

**Ending: Shipped.** On `dev`, not deployed. Resolve 75; the next feedback sweep does the Sentry
status write.

What we did:

- Each row now has one button, **Investigate**. A press first runs what *Look it up* did: it finds
  the work's own page, and code checks that it is the work and finds the quote. The row's link and
  checked quote land first. Then the longer reading streams in, written knowing which page that is.
  A row whose quick check already came back good skips straight to the reading.
- If the quick check can't reach the provider, the press stops before the dearer call is paid for.
  If it finds nothing, the reading goes on and says it couldn't confirm the work. If the reading
  fails after the check landed, the check is kept and the row says so.
- The cost: about 15¢ a press, 12¢ when the check is skipped. The cheap 3¢ lookup has gone, and so
  has its larger hourly allowance. That is recorded as an assumption in the plan, with a one-line
  fallback (a quiet *Just find it* link) if it turns out to matter.

Plan: [260930d](../plans/260930d-citations-one-button-look-it-up-and-investigate-merged.md).
