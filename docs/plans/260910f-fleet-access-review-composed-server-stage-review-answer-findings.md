# Stage review findings: 260910f fleet access review composed server

Initial verdict: **refuse pending the two P1 fixes below**. The global placement of the Host guard
and security headers was sound, the four inline routes had the intended exact path/method policy,
and the current positive controls stopped at parsing. The harness nevertheless left an executable
server behind when its test runner was killed, and its Host parser accepted strings that were not
an HTTP authority as an allowed name.

Final verdict after fixes: **accept**. F11–F16 are fixed. A GPT Sol code review independently
accepted the result with no remaining in-scope P0–P2 finding; it changed no files.

## F11 — P1 — established: killing the test runner orphans the detached composed server

**Input.** Start `startFleetChild()` from a short-lived parent and kill that parent without running
`afterAll`. `spawnFleetChild()` starts `tsx` with `detached: true` and `stdio[0]: "ignore"`. The
child therefore has neither a parent-death signal nor an ownership pipe; after the parent dies it
keeps its listening socket, startup loops and temporary directories indefinitely. This is the
resource-triage failure mode recorded in the plan's Status, not a hypothetical cleanup omission.

**Fix.** Put a small owner process between vitest and `tsx`. The owner holds the server's detached
process group, watches a pipe from its parent, and terminates that group when the pipe closes; normal
`stop()` asks the same owner to terminate it. Add a subprocess test that kills only the helper's
caller and observes that the random port stops accepting connections.

## F12 — P1 — established: the Host parser accepts paths, URL credentials and other non-authorities

**Input.** `unaddressedHost()` parses `new URL("http://" + host)` and checks only `.hostname`.
Consequently `Host: localhost/path`, `Host: localhost?x`, and `Host: evil.example@localhost` all
produce hostname `localhost` and pass. A raw `GET /api/state` carrying one of those values therefore
reaches the poll instead of the promised 421. The same construction also normalises percent-encoded
and non-canonical URL hosts before applying the allowlist. These are not Host values a browser emits,
so this is a contract/parser-boundary defect rather than a demonstrated DNS-rebinding exploit.

**Fix.** Validate that the raw value is exactly one HTTP authority before using `URL` to extract its
hostname: no userinfo, path, query, fragment, backslash, percent escape or whitespace; a bracketed
IPv6 literal may have only a numeric port suffix, and any other host may have at most one numeric
port suffix. Keep the existing hostname predicate after that validation. Exercise the cases over
raw HTTP and retain positive controls for IPv4, bracketed IPv6, localhost and the MagicDNS short
name.

## F13 — P2 — established: duplicate Host fields are silently reduced to one allowed name

**Input.** Send raw HTTP with `Host: localhost` followed by `Host: evil.example`. Node exposes a
single `req.headers.host` value to the current guard, while `req.rawHeaders` preserves both. The
guard checks only the former, so which authority is enforced depends on Node's duplicate-header
normalisation. The request is malformed and browsers do not generate it, but the stage's fail-closed
Host claim has no defined answer for it.

**Fix.** Derive the Host values from `rawHeaders` and require exactly one before parsing it. Add both
header orders to the raw-HTTP matrix and expect the guarded 421 response with security headers.

## F14 — P2 — established: the reusable helper lets callers override every isolation boundary

**Input.** `spawnFleetChild({ env: { HOME: "/home/greg", TMUX: "…",
FLEET_ACT_ENABLED: "1" } })` applies those values after the isolated environment. The current suite
passes only `FLEET_BIND`, but the reusable API advertised by the helper can reconnect a future child
to the live stores, tmux server and enacted actions while still looking like use of the safe harness.

**Fix.** Replace the arbitrary environment override with the one presently required option
(`bind`), and apply all isolation values last. Extend the typed option deliberately if another safe
test switch is later needed. Add a compile/runtime-facing assertion that sensitive overrides are no
longer part of the helper API.

## F15 — P2 — established: the Origin matrix omits the DELETE form of a write route

**Input/mutation.** `/api/actions/cancel` accepts both POST and DELETE, but `WRITE_ROUTES` sends only
POST. A mutation that bypasses `checkOrigin()` only when `req.method === "DELETE"` leaves all 62
composed tests green even though a supported write method has lost its Origin gate. The production
route currently calls the shared parser for both methods, so this is a proof gap, not a present
bypass.

**Fix.** Make the matrix rows carry a method and add `DELETE /api/actions/cancel`, with the same
foreign/missing/null refusals and inert same-origin 400 positive control.

## F16 — P2 — established: the `*.ts.net` arm also accepts malformed names with no wildcard label

**Input.** `addressableHost(".ts.net")`, `addressableHost("box..tailnet.ts.net")`, and
`addressableHost("-box.tailnet.ts.net")` all return true because the predicate checks only
`endsWith(".ts.net")`. These cannot normally resolve, so this is not a demonstrated rebinding path,
but it is looser than the documented `*.ts.net` allowed set and makes malformed raw Host values look
deliberately addressable.

**Fix.** Validate every DNS label in the prefix (including the 63-byte limit) before accepting the
Tailscale suffix, and use the same label validator for the MagicDNS short-name arm. Add direct unit
cases for the malformed full names and overlong short/full labels.

## Non-finding: HEAD `/api/messages`

For a real row, HEAD still performs the bounded asynchronous transcript read before Node suppresses
the body. That is unnecessary I/O, but it is read-only and is consistent with HTTP permitting a
server to generate the selected representation in order to produce the same status and headers as
GET. It does not violate the stage's isolation or access contract, so I would not enlarge this stage
to extract or seed the route solely to optimise it.

## Fix disposition and evidence

- **F11 fixed:** the child-owner wrapper watches a Node IPC channel and terminates its private
  process group on disconnect. The composed regression kills the helper's caller and waits for the
  random listener to disappear. Sol independently exercised fast child exit and orderly shutdown;
  both preserved the intended exit and removed the temporary root.
- **F12–F13 fixed:** the global guard now counts Host fields in `rawHeaders`, requires exactly one,
  validates authority syntax before URL parsing, and has raw-HTTP cases for userinfo, path/query/
  fragment syntax, percent encoding, trailing dots, an IPv6 zone id, both duplicate orders and
  absolute-form targets.
- **F14 fixed:** `FleetChildOptions` exposes only the port and the narrowly typed bind used by the
  refusal test; isolation variables are applied by the helper and have a compile-time negative
  witness.
- **F15 fixed:** the composed Origin table now carries methods and covers both POST and DELETE for
  `/api/actions/cancel`, using the same inert body as every other positive control.
- **F16 fixed:** one DNS-label validator now owns the short-name rule and every label before
  `.ts.net`; direct unit tests cover empty, doubled, edge-hyphen, underscore and overlong labels.

Checks after the fixes: the six runnable focused files passed (80 tests); the full typecheck passed
all four projects and covered 2,012 source files. The composed HTTP file cannot bind in this sandbox
(`EPERM`), and `npm test` cannot connect to its Postgres test service here; both limitations are
environmental. Greg's pre-review composed run at candidate HEAD was green, but the new raw-HTTP and
parent-death cases still need one unsandboxed run.
