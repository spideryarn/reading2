# A secret-bearing response URL escaped through a diagnostic sibling

Up: [postmortems.md](../project/postmortems.md)

Stage 2 review of import sharing caught an ordinary private-link waiting response printing
its key in the browser console. Production exposure was not established. The review reproduced
the defect before fixing it.

The raw console URL originated in `01689d013`. `dba7839f9` made it part of ordinary waiting:
`loadPublicArticle` handles the new 409 through `readJson`, whose error logger prints
`Response.url`. The previous private-link stage already exposed the sibling 5xx path.

The class is **a secret scrubbed for telemetry but printed raw by a diagnostic sibling**.
The feedback buffer removes queries and fragments at its own boundary; that does not protect
the adjacent console call. Existing tests constructed responses with an empty URL and suppressed
console output, so the real transport property never reached an assertion.

Two new cases in `tests/public-still-being-added.test.ts` supplied a response URL containing
`?key=AAAAAAAAAAAAAAAAAAAAAA#fragment`. Both failed, for 409 and 500, with that exact key
in the console arguments. Both passed after the fix.

The lasting fix strips query and fragment before the shared console logger prints the URL.
Changing only the new waiting branch would leave the older error path open.

Countermeasures, ranked by cost against value:

1. Exercise secret-bearing response URLs against the logging sink. Cheap; implemented.
2. Redact at each diagnostic boundary. A downstream collector protects only itself.
3. Replace the logging system. Rejected: the defect was one unprotected sink, not missing
   infrastructure.

The lesson I would keep: a green assertion about the diagnostic buffer says nothing about the
console beside it. A response stub must carry the transport properties the security claim names.
