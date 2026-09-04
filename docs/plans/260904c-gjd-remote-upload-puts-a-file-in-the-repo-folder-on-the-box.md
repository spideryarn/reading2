# `gjd-remote upload` puts a file in the repo's folder on the box

**Status:** done, 2026-09-04. Written alongside the work rather than before it — the ask was one
subcommand and looked like an afternoon. Two cross-family reviews found seven and five things, which
is the reason this file exists at all.

> Add a new gjd-remote upload sub-command that takes the path to a file as input and uploads it to
> the 'uploads' folder of the current repo's folder on the remote box, and test it.
>
> — Greg, 2026-09-04

## What it is

```
gjd-remote upload <file> [-d DIR] [--repo OWNER/NAME] [--force]
```

One file from this machine into `<repo checkout>/uploads/<basename>` on the box. Run it from anywhere
inside the repo; the box path is resolved by origin, the same way every other per-repo command
resolves it, so nobody has to know or type it. The behaviour and the reasons are in
[hetzner-remote-server-box.md § Getting a file onto the box](../project/hetzner-remote-server-box.md#getting-a-file-onto-the-box);
this file is the decisions and the two reviews.

## The decisions, and the simpler options passed over

| decision | the simpler thing not done, and why |
|---|---|
| **Identity required**, and `--dir` verified as this repo's checkout | Let `--dir` be any path, as `new-shell` does. Rejected: here the repo *is* the address, and an upload is as likely to be a credential dump as `.env.local` is. `push-env` sets the precedent. |
| **Never clobbers**, `--force` to mean it | Overwrite, like every other `writeRemote` caller. Rejected: two files a week apart called `screenshot.png` are the ordinary case, and the second quietly winning is how the first goes missing. |
| **Reuse `writeRemote`**, taught to take a `Buffer` and to not clobber | A second write path just for uploads, or plain `scp`. Rejected on the repo's own grounds — two atomic-write recipes are two, and the one that gets a fix is not the one somebody is running. `scp` also measured ~3.9s against ~1.0s for a plain command. |
| **No sha256 readback** | Hash both ends, as `runBrowserSmoke` does after its `scp`. Not done: the byte count is compared *on the box inside the same remote command*, which is a stronger claim than the exit code `runBrowserSmoke` is compensating for. Both reviews agreed, the second one explicitly. |
| **One `uploads/` folder, basename only** | Mirror the local directory structure, or take a `--name`. Not done — simplest version first, and nothing has asked for either. |

## What the reviews changed

Both rounds were GPT Sol (`gpt-5.6-sol`, effort high), the second on the built code.

**Round one — seven findings, all accepted.** Three were High and all three were real: the staging
path was the predictable `<dest>.part`, so it was plantable as a symlink and shared by two concurrent
writers; `mv -f` moves the staging file *inside* a directory sitting at the destination and exits 0,
so the tool would print a path it never wrote; and the no-clobber check was a separate `[ -e ]` round
trip, which on a box hosting a dozen agents is a gap somebody lands in. Then: the tests covered
naming and not behaviour, uploads landed 0644, extra positionals were dropped on the floor, and the
filename guard let control characters through to the terminal.

**Round one's own fix had the same bug in it.** Sol proposed `ln` for the atomic publish. `ln src dir`
*also* means "link inside dir" and exits 0 — so the directory case was still there, in the fix. The
test written for it is what caught that; it is `ln -T` and `mv -fT` now, and that is the whole
argument for the shape of the test file below.

**Round two — five findings, all accepted.** The new behavioural tests would have failed on Greg's
Mac, where BSD `ln`/`mv` have no `-T`, and `npm test` is a gate on both machines. The concurrency
tests claimed more than they pinned. `ln`'s stderr went to `/dev/null`, which turned a read-only
mount into "bytes did not arrive intact" — a complaint about the one thing that had just been checked
and was fine. The `exit 17` path ignored whether its own cleanup worked, making "nothing was left
behind" a promise it could break. And "Nothing was sent" was false: the whole file *has* been sent by
the time `ln` finds the name taken.

Round two's verdict on the rest: no remaining high-severity issue, no regression for the prompt,
job-script or `provision.sh` callers of the shared writer, the script correct under `dash`, and the
`"written" | "exists"` return "reasonable and pleasantly small".

## The shape that came out of it

`scripts/gjd-remote-upload.ts` holds two pure things and no I/O: `uploadDestination`, the naming
policy, and `remoteWriteScript`, the `sh` that stages and publishes — which is now the recipe behind
**every** `writeRemote` in the tool, prompts and job scripts included. It is there because
`gjd-remote.ts` calls `main()` on import and nothing in it can be tested, which is why every other
piece of this tool is split out the same way.

`tests/gjd-remote-upload.test.ts` **runs** that script with `sh -c` against temporary directories
rather than asserting on its text. Three of those tests were red first and found real bugs: the `ln`
directory case above, and staging files left behind on two failure paths. A test that read the string
would only have agreed with whatever we already believed —
[silent-success.md](../reusable/silent-success.md).

## Evidence

End to end against a real box. The Hetzner box can ssh to itself, so `GJD_REMOTE_HOST=localhost`
exercises the entire path including the transport.

- 40 KB of random bytes → sha256 identical on the box; file 0600 in a 0700 `uploads/`
- the same name again → refused, exit 1, original untouched
- `--force` with different bytes → replaced, sha256 identical, no staging file left
- missing path, a directory, no argument, two arguments → each refused before any round trip
- a symlink → followed, real path printed, content correct
- `-d /home/greg` → refused as not a checkout of this repo
- `new-claude --wait 1h --no-attach` → prompt file 0600 and job script 0700 written through the
  changed shared recipe; session created, then killed

37 tests in the new file. All 17 `gjd-remote` test files pass. `npm run typecheck` clean. `biome
lint` reports the same five findings on `scripts/gjd-remote.ts` as `HEAD` — no new ones.

## Left undone, deliberately

- **No `--name`** to rename on the way up, and **no nested paths** under `uploads/`. Nothing has
  asked.
- **No sha256 readback**, per the table above.
- **Nothing prunes `uploads/`.** It is gitignored and nobody backs it up; if it becomes a problem,
  that is the day to decide what the rule should be.
