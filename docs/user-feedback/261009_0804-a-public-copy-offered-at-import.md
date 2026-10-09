---
reports: spya-ahvk74
ending: shipped
comment: Adding an article someone has already made public now stops and asks: read their copy free, or add your own, which uses one article. You chose to keep the free copy read-only for now (q-c75pj9).
---
# A public copy offered at import

Report `spya-ahvk74`, from Greg (an admin; `scripts/feedback-reporter.ts` exited 0), filed
2026-10-09 08:04 UTC; session `fbahvk74-import-public-offer`. No Sentry sign-in in this session, so
the next feedback sweep marks the Sentry issue.

> We should notice during the import process if a user tries to add an article that we already
> have as public, and ask them if they'd rather use the public one for free or have their own
> version which will use up one of their allotted slots.

**Ending: Shipped**, on `dev`. Plan
[261009j](../plans/261009j-a-public-copy-offered-at-import.md).

- A plain add that is not on the reader's own shelf now asks whether somebody else has a public,
  openable article at the same address (`urlKey`, so arXiv versions and paper mirrors count). If so
  the server answers with that copy and spends nothing.
- The add page stops on **Read the public copy (free)** or **Add my own copy**; the link hover card
  and the MCP `import_article` tool offer the same two. *Add a private copy to your shelf* on a
  public article has already chosen, so it goes straight to the paid add.
- Which public articles count is Citations' existing ownerless read, reused unchanged; no defence
  in the security map was edited.

The product choice the report raised but did not settle, whether the free copy can carry the
reader's own notes, was asked as [q-c75pj9](questions/q-c75pj9.md); Greg chose read-only for now
(A, reply `spya-hef0p4`, 2026-10-09): richer public copies wait until public articles take off.
Not built either: matching an *uploaded* PDF to a public article (a file has no address).
