---
reports: spya-mzxq7c
ending: shipped
---
# The Earlier tab's All view says Not shipped, too

[SPIDERYARN-READING2-7D](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7D) (2026-09-30
23:01 UTC, `kind=suggestion`), from Greg (admin — `feedback-reporter.ts` exited 0), on
`dongetal25-spya-vfmvmm`, build `fe57a1ea`.

> In Feedback / Earlier / All, add the indicator for whether each suggestion has shipped or not.

**Ending: Shipped** — on `dev`, not deployed. Resolve 7D.

What we did: 260930e marked a shipped report with **Shipped** and left the rest bare, so in All a
not-shipped report had no indicator, only an absence. Now, in All, each of those says **Not
shipped**, quietly, with a tooltip careful to say only that it isn't *marked* shipped in the
version you're using. The Shipped and Not shipped filters are unchanged, since there every row
would say the same thing. [261001c](../plans/261001c-earlier-tab-marks-not-shipped-too.md).
