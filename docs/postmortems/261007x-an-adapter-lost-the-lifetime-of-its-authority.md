# An adapter lost the lifetime of its authority

Caught in the uncommitted remote MCP stage of [261007p](../plans/261007p-mcp-remote-sign-in-with-oauth.md).
No introducing commit exists yet; it was found before landing.

The Node-to-Web adapter gave the MCP SDK a fresh request but no disconnect signal. A paused tool
therefore retained its verified request API after the HTTP connection ended. Independent review
also probed the SDK: closing its JSON transport removes the response resolver without settling
`handleRequest`, while an already running callback can still continue.

The class is **an adapter drops the lifetime of an identity capability**. Normal-completion and
overlapping-request tests never disconnected during a tool, so both lifetimes appeared identical.

The fix races the exchange with Node disconnect, closes server and transport, and retires the
API and its sentinel verifier on disconnect or normal completion. Already accepted routes and
jobs retain their existing behavior; this does not promise to undo dispatched work. Each started
inner route's completion is registered in the outer after-response queue, so Vercel waits for its
accounting and deferred work even after closing the transport. A further test went red when the
outer invocation returned before a paused, accepted inner route completed, then green with the queue.
`tests/mcp-remote-lifetime.test.ts` went red because the exchange stayed pending, then green.
`tests/mcp-remote-boundaries.test.ts` also checks exact-token acceptance and verifier retirement.

Countermeasures, ranked: first, pause a callback across disconnect (done); second, test retained
capabilities after their owner closes (done); retrofitting cancellation into every route/job was
rejected because accepted persistent jobs have a separate lifetime. Explicit retirement is the
long-term boundary.

Up: [Postmortems](../project/postmortems.md).
