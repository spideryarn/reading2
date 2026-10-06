## Your zone: the server request path

`src/routes.ts` (11.6k lines, the route table and handlers), any `src/routes-*.ts` beside it,
`src/index.ts`, the auth/session gate, and the store it calls: `src/store/pg.ts`,
`src/store/pg-revisions.ts`, `src/store/contracts.ts`, `src/store/pg-chat.ts`,
`src/store/pg-comments.ts`, `src/store/public-reader.ts`, `src/store/db-errors.ts`,
`src/store/index.ts`, plus `src/stream-run.ts` and the per-mode server runners a route calls
(glossary, ideas, quotes, timeline, faq, citations, debate, quiz, search, simple-summary, converse).

Prior doc: `docs/investigations/261003b-fifth-sweep-server-request-layer.md` and its review
`261003b-fifth-sweep-review-sol-on-server-and-web.md`.

Zone-specific questions:

- **Per-mode routes as siblings.** For each mode's GET (read the stored artefact), POST (run),
  stream and DELETE, tabulate: ownership check, public-article access, rate-limit bucket,
  source-hash / staleness stamping, what an in-flight / failed / absent artefact returns (status
  code and body shape), abort on client disconnect, cost attribution. Where do they differ without
  a written reason?
- Store functions: transactions that should be one and are two; a read-then-write without a fence;
  error mapping (`db-errors.ts`) applied in some writers and not others.
- Anything a route trusts from the URL or body that the store does not re-check.

Finding IDs: SV1, SV2, ...
