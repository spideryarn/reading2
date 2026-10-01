---
reports: none
ending: shipped
---
# The masthead's facts line pushed a phone page sideways

Not from a reader. The fix-long-url-and-chat-latest session noticed it on 2026-10-01 (plan 261001f)
and the Overseer dispatched it as a bug fix with no Sentry id. The time in the file name is when this
session received it.

> the antikythera-mechanism article overflows a 390 px page by about 180 px sideways, caused by
> something inside its figure wrappers

**Ending: Shipped.** On `dev` in 8dd4085f, plus the review fixes after it. Not deployed. There is
no Sentry issue to resolve.

It was not the figures. The cause was the masthead's facts line ("Wikimedia Foundation, Inc. ·
11,688 words · ~51 min …"), which had nowhere to break on a phone. It is fixed for every article:
four of the seven swept had been overflowing, and no figure overflowed in any of them.
[261001e-masthead-facts-line-overflows-a-phone.md](../plans/261001e-masthead-facts-line-overflows-a-phone.md).
