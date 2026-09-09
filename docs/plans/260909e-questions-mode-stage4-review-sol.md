# Questions mode Stage 4 GPT Sol review

The normal `scripts/run-codex.ts` review profile could not initialise on this host: the `tsx`
launcher first hit `listen EPERM` on its IPC socket, and the Node-import retry reached Codex but its
read-only app-server setup returned `EROFS`. The same durable prompt was therefore given directly to
a read-only `gpt-5.6-sol` agent. It ran the authorised client test file: 16/16 passed.

## First verdict: refuse

No P0. Two established P1 contract breaches remained.

### F1 — lossy parsed option keys could retain stale answer state

`dialogQuestionKey` used the browser rendering parse. That parser deliberately collapses an
unfamiliar option key to `{via: "unrecognised"}` and normalises arrow presses, so two raw keys a
newer server distinguishes could share one React key. The reproduced mutation was to answer a
question carrying `{via: "future-a"}`, then replace only that raw key with `{via: "future-b"}` on
the same row and execution; the old receipt survived.

Fixed by `questionSafetyKey`, which reads only the `sameQuestion` safety fields from the raw question
already preserved at the parse boundary. Its option key remains raw. The new lifecycle test watched
the old key retain `Sent.` and now watches it disappear.

### F2 — non-null malformed addresses still enabled buttons

The shared predicate checked addresses for presence but not the shapes `checkTarget` requires.
Otherwise valid rows with a malformed pane id, session handle, or conversation UUID exposed buttons
whose request would deterministically return `bad-target`.

Fixed by mirroring the three browser-safe address shapes inside the same predicate. Three generated
panel cases watched two buttons appear before the fix and now assert no enabled control and no seam
call.

## Narrow fix check

Verdict: **F1 and F2 are closed.** Sol found no established P0/P1 in either repair. It accepted that
the raw safety key contains only prompt, material identity and option label/consequence/raw key, and
that the predicate now mirrors the route's pane, session and UUID shapes. The supplied final scoped
result was 84/84.
