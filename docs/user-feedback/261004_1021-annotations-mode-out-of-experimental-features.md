---
reports: spya-vv54j2
ending: shipped
---
# Annotations (Marginalia) out of experimental features

`spya-vv54j2` (Sentry SPIDERYARN-READING2-C2, queue `qi-ef6fvbcm`), from Greg (admin; proved by
`feedback-reporter.ts` exit 0 on the production row), filed 2026-10-04 10:21 UTC from Glossary.
This session had no Sentry sign-in and did not write the Sentry status; the next feedback sweep
does.

> Let's take the annotations mode out of experimental features, i.e. make it a mainstream feature
> available to everybody.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did:

- **The Marginalia toggle is on every reader's bar**, and in the command bar, whatever the
  experimental switch says. A signed-out reader of a public article has it too; their press opens
  the column and starts nothing.
- **A new article's relation words (so, but, vs) are made on import**, with the other main modes,
  because that list is every mode outside the switch that makes something. One more model call per
  article, about 4 to 5 cents on the one measured.
- **A first-opened article arrives in Summary and Marginalia for every signed-in reader with room**
  (from 900px), which Greg asked for in `spya-ax5tmm` and which until now needed the switch on.
- `/help` no longer calls it experimental.

Nothing was deferred. Two questions for Greg, neither blocking, are in the plan: whether the
relation words should be made on import or only on the first press, and whether to make them for
articles added before this.

Plan: [261005d](../plans/261005d-marginalia-out-of-the-experimental-switch.md).
