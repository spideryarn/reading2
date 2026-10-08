# Consent state belonged to the previous request

Caught in the uncommitted remote MCP stage of [261007p](../plans/261007p-mcp-remote-sign-in-with-oauth.md).
No introducing commit exists yet; it was found before landing.

Changing `authorization_id` retained request A's displayed details, but Allow sent request B's
id. An unfinished decision could also redirect after navigation. The class is **approval state
unbound from the identity it describes**: the component treated loaded details and current URL
as independent values. Independent root-cause review also found that the parent subscribed only
to pathname, so Back/Forward between ids did not load the next request, and automatic redirects
had the same stale-completion hazard as approvals.

The fix binds displayed state to its id, subscribes to the complete address, and checks request
lifetime and the current id before decisions or asynchronous redirects. Sign-in still preserves
the original id. `tests/oauth-consent-page.test.tsx` reproduced unreviewed approval, late decision
redirect, late automatic redirect, and missed same-page navigation before their respective fixes.

Countermeasures, ranked: first, vary request identity while work is pending (done); second, send
history events instead of forcing renders (done); a new global consent state manager was rejected
because this authority belongs to one request on one page. Binding state and completion is the
long-term fix, rather than merely resetting state in an effect.

Up: [Postmortems](../project/postmortems.md).
