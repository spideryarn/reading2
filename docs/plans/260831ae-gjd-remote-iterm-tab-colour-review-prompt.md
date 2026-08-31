# Review: colouring the iTerm tab while gjd-remote holds the terminal

You are reviewing a small, already-built change to a personal CLI. Be adversarial about
correctness; be brief about style.

## What it does

`gjd-remote` is a TypeScript CLI (run under `tsx`) that opens Claude Code / shell sessions on a
remote Hetzner box over mosh (falling back to ssh), each in a remote tmux session. It runs **in** the
user's iTerm2 tab on macOS and then `spawnSync`s mosh/ssh with `stdio: "inherit"`, so the remote
session takes over that same tab.

The change makes every command that hands the terminal to the box (`new-claude`, `new-shell`,
`resume`, `ssh`, `tunnel`) paint the iTerm tab violet for as long as it holds it, then hand the
colour back to the profile default. It does this by writing iTerm2's OSC 6 escape sequences to its
own stdout.

## Files to read

- `scripts/gjd-remote-tab.ts` (new) — colour constant, env parsing, guards, byte sequences
- `scripts/gjd-remote.ts` — `markTabRemote()` and its three call sites (`attach()`, `case "ssh"`,
  `case "tunnel"`); also the `--help` text
- `tests/gjd-remote-tab.test.ts` (new)
- `docs/plans/260831ae-gjd-remote-iterm-tab-colour.md` — the reasoning and the evidence
- `docs/reusable/iterm.md` — background on driving iTerm from a shell (not changed)

## What I most want challenged

1. **Correctness of the escape sequences and the guards.** Is there a realistic environment where
   these bytes get printed as visible junk, or land in a file/pipe? `canColourTab` checks
   `process.stdout.isTTY`, `TERM_PROGRAM === "iTerm.app"`, and absence of `TMUX`/`STY`. What is
   missing? Consider: stdout a tty but stderr not, `TERM_PROGRAM` inherited across `ssh` into a
   remote invocation, iTerm's tmux `-CC` integration, `CI`, running under `script(1)`.
2. **The undo.** It runs after `spawnSync` returns. Are there realistic paths where the process
   exits without running it and leaves the tab permanently violet — signals during or after
   `spawnSync`, `die()` called later, an exception? Is that worth fixing, or is a cosmetic leak
   acceptable? Note `attach()`'s existing `moshProbe()` runs `script(1)` with the real terminal on
   stdin BEFORE the paint.
3. **Ordering.** In `attach()`, the paint happens after `chooseTransport()` (which may run a 15s
   mosh probe through `script(1)`) and immediately before `spawnSync`. Is any of that ordering
   wrong or fragile?
4. **The env var contract.** `GJD_REMOTE_TAB_COLOUR` accepts `off`/`none`/empty or `#rrggbb`;
   anything else calls `die()` and aborts the whole command. Is aborting a session over a
   cosmetic setting the right call, or should it warn and carry on? Argue one way.
5. **Test quality.** Each test was made to go red by mutating the source (7 mutations listed in the
   plan doc). Is anything important untested — in particular anything in `markTabRemote()`, which
   is not exported and therefore has no unit test at all?
6. Anything in the docs that is stated as fact and is actually unverified.

## House rules this code is held to

- Fail closed: an error, empty output or an unrecognised environment means "do nothing", never
  "proceed".
- No silent success: a setting that looks honoured but is not is the bug class this repo keeps a
  document about (`docs/reusable/silent-success.md`).
- Prefer simple over easy; prefer the design with fewer parts touching each other.
- `strict` and `noUncheckedIndexedAccess` are on.

Give me a numbered list of findings, most serious first, each with the file and line, what actually
goes wrong, and the smallest fix. Say explicitly if you find nothing serious.
