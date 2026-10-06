Fixed two refusal defects and corrected overstated comments. No commits, network access, or tmux-server contact; `infra/` untouched.

**F7 — P1, established, fixed:** A newline in the socket pathname could make `tmuxSocketPath` return an existing prefix. Both paths then resolved, and `collect()` wrongly refused the default socket. Regression tests failed first, including a continuation resembling a valid pane record and a symlink variant. Malformed or inconsistent metadata, and newline-containing expected paths, now yield `cannot-check`.

**F8 — P1, reasoned operator consequence, fixed:** Different canonical names can identify one hardlinked socket. Pathname inequality alone therefore cannot establish another server. The filesystem counterexample and collector regression were reproduced; a live tmux connection through a hardlink was not. Different canonical names now undergo device/inode comparison. Comparison failures yield `cannot-check`.

**F9 — P3, established, fixed:** Corrected claims that publication requires an anchor match, that `cannot-check` means the check is not running, and that `absent` always means another server. Scoped “Never absent” to production `collect()`, corrected the test’s historical claim, and qualified the plan’s exhaustive mismatch and permanent-success claims.

**F10 — P2, reasoned, not fixed; wider scope:** Filesystem comparisons occur after the tmux reply. Concurrent pathname replacement remains outside this anchor’s guarantee. No such race was observed; binding the answering server to its open socket would require a wider change.

F1–F6 checked individually:

| ID | Closure |
|---|---|
| F1 | Required wire field and explicit client `Omit`; type checks pass. |
| F2 | Nonempty `TMUX` without a pane retains `cannot-check`. Empty `TMUX` uses the socket anchor, including with `TMUX_PANE` set. |
| F3 | Both resolution failures are caught; symlink aliases work. Comparison failures are also nonblocking after my fixes. |
| F4 | Existing failure logging preserved; no duplicate logging added. |
| F5 | Supplied live evidence uses the service environment. Added success → refusal → recovery coverage through refresh and state composition. Deployment verification remains unobserved here. |
| F6 | Code and plan state that neither anchor proves listing completeness. |

The requested collector command initially passed **77 tests**; after fixes it passed **83**. Final validation passed **798 tests across ten fleet/client/ordering files**, **17 doc-link tests**, and all four TypeScript projects. The `npm run typecheck` wrapper hit a sandbox IPC denial; running the same script through `node --import tsx` passed. Scoped lint reported one unchanged warning.

No production consumer restores an older `FleetSnapshot` into the dashboard cache; the server starts with `snapshot = null`.

Files changed:

- [collect.ts](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tools/fleet/collect.ts)
- [wire.ts](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tools/fleet/wire.ts)
- [fleet-collect.test.ts](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tests/fleet-collect.test.ts)
- [fleet-refresh.test.ts](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tests/fleet-refresh.test.ts)
- [Stage plan](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/docs/plans/261006h-fleet-selfcheck-gets-an-anchor-that-works-under-systemd.md)
- [Root-cause postmortem](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/docs/postmortems/261006l-a-resolved-path-is-not-a-socket-identity.md)

VERDICT: ship with my fixes