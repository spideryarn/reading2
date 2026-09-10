# Review findings: 260910f fleet access review composed server

Verdict: **refuse pending plan changes**. The diagnosis that a hostile `Host` can reach read routes is sound, and a pre-routing authority check is the right shape, but the proposed acceptance has several established P1 gaps and one reasoned P0 harness hazard.

## F1 — P1 — reasoned: the proposed host policy rejects a legitimate MagicDNS short name and does not prove intended-device reachability

**Scenario not handled.** `addressableHost()` accepts IP literals, `localhost`, and names ending in `.ts.net`; it rejects `spideryarn-box`. The box is explicitly provisioned with that hostname (`infra/hetzner/provision.sh`), and MagicDNS normally makes a tailnet device's short machine name usable. Applying this predicate to every `Host` therefore turns a currently readable `http://spideryarn-box:8787/` bookmark into a 421. Saying no in-repo caller uses that spelling is not evidence about phone bookmarks or the roadmap acceptance that intended devices can reach the page. It is especially weak because the plan simultaneously records that the live listener was widened for phone access.

**Smallest plan change.** Define the allowed authorities as a positive deployment contract, not just a syntactic predicate: configured bind IPs, `localhost`, this box's exact MagicDNS FQDN, and the explicitly supported short hostname (or explicitly declare the short name unsupported after checking the actual phone URL). Add positive composed-server requests for every supported authority and require a before/after smoke through the SSH forward and the actual tailnet URL. Keep hostile names negative. Do not infer external/bookmark use from repo grep.

## F2 — P1 — established: Stage 1's rebinding-origin expectation contradicts Stage 2's global Host guard and can no longer prove route origin wiring

**Scenario not handled.** A real rebinding request has `Host: evil.example` and `Origin: http://evil.example`. Stage 1 requires every write route to return 403 for it, while Stage 2 requires the new earlier Host guard to return 421 before any route sees the request. Both cannot be true in the finished server. After the Host guard lands, this request also cannot establish that an individual write route still calls its origin check; the global guard wins first.

**Smallest plan change.** Split the controls into two matrices. The Host matrix uses matching hostile Host/Origin and expects the global Host-refusal status. The route-origin matrix uses an allowed Host and (1) a different hostile Origin, (2) a missing Origin, and (3) `Origin: null`, all with the required content type, and expects each route's 403. Its positive control uses allowed same-origin headers plus a deliberately invalid, side-effect-free body and expects a route-specific non-origin error. Mutate/remove each route's origin call independently, not only the shared predicate.

## F3 — P1 — established: the Host test only names `/api/state`, so the claimed before-routing coverage can leave sensitive paths open

**Scenario not handled.** The fix promises that static files, reads, writes, SSE, and the 404 are all refused before routing, but the only red test named is `GET /api/state` with a hostile Host. An implementation accidentally placed in the state branch passes while `/api/messages`, `/api/live` (which immediately emits the state payload), the static shell, route-module reads, and fallback responses still accept the hostile authority. `/api/messages` is the most direct unclosed transcript path.

**Smallest plan change.** Make the bad/missing-Host composed test data-driven over at least `/`, a built asset, `/api/state`, `/api/messages?id=...`, `/api/live`, one route-module GET, a write route, and an unknown path. Assert the same refusal status and complete security headers on each, and that SSE is refused before a subscriber is established. Add positive allowed-Host controls so the matrix cannot pass by refusing all traffic.

## F4 — P1 — established: exact-path/method acceptance is under-specified, and `HEAD /api/live` must not become a permanent SSE subscription

**Scenario not handled.** The plan identifies `/api/live`, `/api/state`, `/api/agents`, and `/api/messages`, but its red examples exercise only `/api/stateX` and `POST /api/state`. The other three clauses can remain prefix- or method-blind. Further, the blanket prescription “GET/HEAD only” is wrong for the current SSE implementation: routing HEAD through `subscribe()` registers a long-lived subscriber and does not produce a normal finite HEAD response.

**Smallest plan change.** Add a table for all four inline clauses (including both state names): exact valid path, a suffixed path, and wrong methods; include DELETE as well as POST where useful. Specify `/api/live` as GET-only (405 with `Allow: GET` for HEAD), or implement a separate finite HEAD response that never subscribes. State/messages/agents may support finite HEAD. Mutate each clause independently.

## F5 — P1 — established: the negative bind test can pass vacuously

**Scenario not handled.** “Refuses a connection on any other local interface address” has no witness if the runner discovers no non-loopback interface (common in a container or restricted CI). Skipping or iterating an empty address list reports green without proving the listener is scoped. A discovered interface can also be subject to unrelated routing/firewall behavior, weakening the causal claim.

**Smallest plan change.** On this Linux target, bind the child to `127.0.0.1` and use `127.0.0.2` as the deterministic negative witness (the loopback `/8` routes locally, but a socket bound to `127.0.0.1` does not accept it). First assert the witness address is locally routable with a tiny control listener, then assert the composed server cannot be reached there. If the environment cannot supply that witness, fail the test as unsupported; never skip or accept an empty candidate set. Keep the separate `0.0.0.0` startup refusal.

## F6 — P1 — established: the roadmap's production queue/drainer composition proof is explicitly dropped

**Scenario not handled.** The roadmap says “Prove production composition shares the queue with the refresh drainer.” The plan instead says the queue/drainer relation will remain source-level. The existing `fleet-refresh` test constructs one `ActionRoutes` object itself and passes `routes.drain`; it does not prove `server.ts` uses `handleActionRequest` and `drainSharedQueues` from the same module singleton. This is exactly the “built and tested but not composed” defect class the plan cites.

**Smallest plan change.** Add a test seam that drives the production composition, not a look-alike: either extract the small handler/refresh assembly with injectable collector and transport, as the roadmap permits, or expose a resettable composition factory whose defaults are the actual `handleActionRequest`/`drainSharedQueues` pair used by `server.ts`. Post an enqueue through that handler, run one controlled refresh, and observe it at a fake transport. The test must fail if `server.ts` drops or substitutes either side. Do not call this checkbox complete on a grep/source assertion.

## F7 — P1 — established: action attribution at the composed boundary is replaced with peer-address logging

**Scenario not handled.** The roadmap asks to verify action attribution. The plan's composed assertion checks only that a refused action log contains `remoteAddress`. That proves audit-source logging, not the action attribution contract the plan itself describes: `client-claimed` versus `unattributed-http`, the claimed speaker, and the rendered attribution that prevents an automated message becoming Greg's voice. A server can pass the proposed log test while losing receipt/speaker attribution at composition.

**Smallest plan change.** Keep the refusal-log test, but name it audit-source attribution. Add a side-effect-free composed request that creates a temporary-store receipt/queued item with a claimed speaker, read it back through the real receipt/action boundary, and assert `actor: client-claimed` and the speaker. Add the unattributed variant. If delivered-message attribution is what the roadmap intends, cover it in the controlled queue/drainer composition test from F6 by asserting the exact rendered prefix at the fake transport.

## F8 — P1 — established: checkbox 4 is only partly cited and two of its three properties disappear

**Scenario not handled.** The roadmap requires three things: hostile transcript strings render as text; unknown action variants remain disabled; unsupported permission dialogs do not acquire an answer path. The plan cites component-level hostile-string tests, silently drops the other two, and then excludes `web/src` and action behavior. It also claims stage acceptance without a browser-boundary check even though the roadmap acceptance explicitly names the HTTP/browser boundary.

**Smallest plan change.** Add an explicit verification checklist naming and running the existing tests for all three properties, and record their exact witnesses. Add one real-browser smoke using the built client and a hostile string served through an isolated HTTP fixture/composed server if this plan is to claim the roadmap's browser-boundary acceptance. No client code change is implied; verification is not a scope expansion. Otherwise narrow the plan's claim to the server subset and leave the roadmap stage unchecked.

## F9 — P0 — reasoned: positive origin controls are not specified as side-effect-free, so the real child can cross the very boundaries the isolation table promises

**Scenario not handled.** The plan says a same-origin request gets “a different answer” but does not pin the body or require every enable flag off. These are the real routes. A sufficiently valid same-origin new-session request invokes `gjd-remote` from the repository and can start a paid agent; a valid transcribe request makes an OpenRouter request; steer, broadcast, rename, and action requests reach tmux/process effects. A bogus OpenRouter key only protects billing/authentication, not outbound invocation, and `FLEET_DESCRIBE_MAX_CALLS=0` covers the background describer, not `/api/transcribe`. `TMUX_TMPDIR` protects the live tmux server, but it does not make `gjd-remote` or provider calls inert.

**Smallest plan change.** Make every positive-origin control explicitly stop at validation: use valid Host/Origin/content-type with a fixed malformed or schema-invalid body that is known to return 400 before receipt creation, tmux, launcher, filesystem mutation, or fetch. Set inherited action switches defensively (`FLEET_ACT_ENABLED=0`, `FLEET_BROADCAST_ENABLED=0`, `FLEET_ANSWER_ENABLED=0`) and clear/override launch-related environment (`FLEET_NEW_DIR*`, `GJD_REMOTE_*`, `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`) in addition to HOME. Add a harness sentinel that fails on any launch/provider-attempt log. If structurally proving this with the executable is awkward, inject throwing side-effect dependencies via the composition seam in F6. Do not send a valid transcribe or new-session body merely to obtain the positive control.

## F10 — P2 — established: temporary cwd and bare `--import tsx` need an absolute loader resolution

**Scenario not handled.** The isolation requires spawning with a non-repository temporary cwd. A child launched as `node --import tsx /absolute/tools/fleet/server.ts` resolves the bare `tsx` package from the child's resolution context; from an arbitrary temp cwd this can fail before the server starts. That produces a harness failure rather than security evidence.

**Smallest plan change.** Resolve the loader/CLI in the parent while still in the worktree (`import.meta.resolve("tsx")` or the absolute `node_modules/tsx/dist/cli.mjs`) and pass that absolute target to the child along with the absolute `server.ts` path. Assert the readiness line belongs to that child as already planned.

## Notes on the core diagnosis

- **DNS rebinding:** established at the HTTP composition level and exploitable in browsers that permit the HTTP/private-address transition. The browser supplies matching hostile Host and Origin, so the existing write-origin comparison does not protect reads. `/api/live` leaks the state payload as well as `/api/state`; `/api/messages` and other read modules are protected only if the authority check is truly pre-routing. Browser Local/Private Network Access behavior can reduce which browser/page combinations work, but it is not a server-side guarantee and does not invalidate the fix.
- **Status code:** 421 is defensible for a request sent to an authority this listener does not serve, although 400/403 are more conventional for a Host allowlist and 421 can invite a client retry on another connection. The security property is reject-before-route, not the exact code. Pick one code and test it consistently; this is not itself a blocking finding.
- **Known repo callers:** the Overseer and restart/readiness callers use `127.0.0.1`, so the proposed guard does not break those. SSH-forward use with `localhost`/`127.0.0.1` also remains valid. The unresolved legitimate caller is the short MagicDNS/browser spelling in F1.
- **Startup isolation:** HOME plus explicit store directories, a temp cwd, `TMUX`/`TMUX_PANE` removal, and a fresh `TMUX_TMPDIR` correctly separate the initial collector/drainer from live stores and live tmux. The remaining hazard is requests that are allowed past validation (F9), not the normal startup loop.
