---
reports: none
ending: shipped
comment: The register is docs/project/security-risks.md. Your option A is R1, at Medium. It holds 12 proposals for you to work through: 11 from this review and the earlier MCP risk, six of them High.
---
# A security-risks register, with option A as an accepted risk, and a review to fill it

Not from a reader, so there is no Sentry id. Greg's reply `spya-qnak8d` to
[q-rstqvz](questions/q-rstqvz.md), 2026-10-09, queue item `qi-32rmtndv`. The time in the file name
is when he sent it.

> A although I accept it's a bit of a security risk, so if you haven't already, can you create a
> doc for security risks and add this as a medium risk or whatever level you think it is? […] And
> then maybe can you kick off another agent whose job it is just to do a security review and update
> that security risks doc with anything else, and then we can work through their proposals in it.
>
> — Greg, 2026-10-09

**Ending: Shipped, 2026-10-09, on `dev`.** Plan
[261009o](../plans/261009o-security-risks-register-and-a-security-review.md).

- The register: [security-risks.md](../project/security-risks.md), owned by security-map.md.
- Option A is **R1, Medium**, accepted, with B then B+ as the later fix.
- The register has 12 proposals: this review added 11, and the earlier remote-MCP risk is R14. Six
  are High: two allow rules that skip auto mode's check (R6), the `postgres`
  password used routinely while the service-role key sits beside it (R7), one Unix user for every
  agent (R8), nothing protecting `main` (R9), unlimited live voice sessions (R10), and the full live
  Stripe key on the box (R11).
- One further review observation, R17, is folded into R2 and R8 rather than asking you to decide the
  same ambient-credential risk twice.
- No defence was changed. Building A itself is `qi-mmqzr385`, held for Greg because it relaxes a
  listed defence; q-rstqvz stays open until then.
