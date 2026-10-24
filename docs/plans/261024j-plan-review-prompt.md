You are reviewing a plan, read-only. Do not edit any file.

The plan: docs/plans/261024j-author-lookup-tries-harder-reads-the-author-s-page-and-proposes-likely-addresses.md

It changes the author-gift lookup in src/author-lookup.ts (read its header: the three rules), the
store in src/store/pg-author-gifts.ts (`finishLookup`, the lookup listing), src/author-lookup-start.ts,
the card in src/web/AdminAuthorGifts.tsx (`LookupLine`), and the MCP gift reader in src/mcp/tools.ts.
The previous plan in this area, landed today, is
docs/plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md.
The safe fetcher is `fetchDocument` in src/fetch.ts. The security map is docs/project/security-map.md;
the SQL conventions are docs/project/sql.md.

Review for: correctness of the design against the code as it stands; security (SSRF, prompt
injection, a stranger's page or article steering what Greg sends); whether a guessed or decoded
address could reach a sent email without Greg's own press; the decoder's false positives and
negatives (the example page's HTML is in the plan); the confidence rules; whether a simpler design
gives Greg the same thing; anything the tests listed would miss.

Answer as a numbered list of findings, each with severity (high/medium/low), the evidence (file and
line, or the plan's section), and the change you recommend. End with a one-line verdict.
