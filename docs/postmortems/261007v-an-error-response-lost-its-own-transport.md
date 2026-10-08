# An error response lost its own transport

Caught in the uncommitted remote MCP stage of [261007p](../plans/261007p-mcp-remote-sign-in-with-oauth.md).
No introducing commit exists yet; this review caught it before landing.

`readBytes` threw a 413 from inside `for await` over `IncomingMessage`. Node's default iterator
destroys the stream when the loop exits early. For an incoming HTTP request that also destroys
the socket: the API catch could log 413 but could not deliver it.

The class is **error handling closes its own response transport**. The existing MCP fixtures used
a generic `Readable` and a response object with no socket, so they could observe the status while
missing the lost connection. Independent root-cause review confirmed the iterator destruction.

The fix uses the non-destructive iterator and drains unused bytes without retaining them.
`tests/mcp-remote-boundaries.test.ts` went red with `req.destroyed === true`, then green. It uses a
real `IncomingMessage`; listening on a real TCP socket was refused by this sandbox (`EPERM`).

Countermeasures, ranked: first, use the real stream type in adapter tests (done); second, exercise
the wire response in an environment that permits sockets; a new general stream abstraction was
rejected because Node already exposes the required ownership control.

Up: [Postmortems](../project/postmortems.md).
