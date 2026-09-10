# Task: Stage 4 — recognised live process roots, on an end-chained task

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility`, branch
`worktree-admission-visibility`. TypeScript + ESM, `tsx`, vitest.

**Read first:**

1. `docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md` — **§4 and §7
   are this stage's contract.** Both "Review dispositions" sections carry F1–F41 and the words that
   are banned; F8, F9 and F14 are specifically about this stage.
2. `tools/fleet/actions.ts` — **`ProcRecord`, `isVitestRunner`, and the browser rule.** You reuse
   these; you do not write new ones. Read the headers: they explain why the rules match executable
   paths and not substrings, and they carry the measurement that makes it matter.
3. `tools/fleet/execution-identity.ts` — start ticks and before/after bracketing.
4. `tools/fleet/routes-admission.ts` and `admission-wiring.ts` — where this plugs in.

## What this block is, and the three words that are not in its heading

It is headed **"Recognised live process roots"**. It is **not** "heavy work" and **not** "active
work", and the plan's §4 says why at length:

- a live Chrome root may be parked and idle, so presence establishes presence and nothing more;
- `codex` is how this very plan was implemented — `codex exec` is a generic batch job, not a review —
  so the observed class is **`codex-batch`**, never "review". `AdmissionRequest.kind` keeps `review`
  as a *declared* intent, which is a different thing from an intent inferred from an executable;
- anything the census does not recognise is **not counted at all**, and the block says so rather
  than implying its list is exhaustive.

## What to build

### The census, pure over rows a test supplies

Three classes: `test` (vitest), `codex-batch`, `browser`. **Reuse `actions.ts`'s recognisers** for
the first and third; write one new one for `codex-batch` to the same rule — an executable path,
never a substring anywhere in argv. `actions.ts`'s header records that a substring match once
counted **162 "chrome" processes that were mostly MCP servers whose arguments mentioned chrome**,
and my own naive fold reproduced that error at 33 "browser" roots on a box with a handful.

**Fold processes to roots** by walking `ppid`: a process whose ancestor carries the same class is not
a root, and a Chrome helper (`--type=` in argv) is never a root.

**Identity, because two reads of `/proc` are not one observation.** Reading `cmdline` and then `stat`
for a pid can staple an old parent relation onto a reused pid's new argv, describing a process that
never existed. Keep `startTicks` per row, bracket the walk, and classify anything that changed under
the read as **uncertain** rather than guessing.

Every count comes with an **uncertain** count and an **unreadable** count. A process that vanished
mid-walk is unreadable, not absent.

### The task and its cache — §7

**Measured at 37.7 ms median, 56.0 ms worst over 425 processes**, so it cannot go on the request
path; the dashboard is one Node process the Overseer has no alternative to. It goes on a repeating
task in `admission-wiring.ts` that is **end-chained, never a fixed interval** — waiting the cadence
*after* each pass finishes, the non-overlap rule `server.ts` already follows.

**The cache is a state, not a value**, and this is F12, which was established against the previous
draft of this stage:

| State | Meaning |
|---|---|
| `not-yet-computed` | the dashboard started less than one cadence ago. **Not** an empty result |
| `value` | a completed pass, with the instant it completed |
| `failed` | a pass that threw, with its cause — **and the last good value, explicitly marked stale, if there is one** |

The task **must never throw out into the server**, and a failure to enumerate `/proc` at all is a
`failed` cache state with its cause, never an empty census.

### The block

Under the forecast and the journal on `AdmissionSection.tsx`. It states its own age (a census is an
observation, and its completion instant is genuinely when it observed), names the finite recogniser
scope, and states the uncertain and unreadable counts rather than hiding them.

## The tests — red first

1. A Chrome helper (`--type=renderer`) is not a root.
2. A vitest **worker** is not a root; the runner is.
3. **An agent merely editing `vitest.config.ts` is not a vitest runner**, and **an MCP server whose
   arguments mention chrome is not a browser.** Both are recorded failures in `actions.ts`; both get
   a test here, because reusing a recogniser is only safe if the reuse is pinned.
4. A row that changed under the read is `uncertain`, not guessed.
5. A vanished pid is `unreadable`, not absent.
6. `/proc` unenumerable is a `failed` cache state carrying its cause, not an empty census.
7. The task never throws into the server; a pass that throws leaves the previous value marked stale.
8. `not-yet-computed` renders as itself, not as "nothing is running".
9. The block's heading and scope sentence are present, and the strings `heavy`, `active` and
   `review` do not appear as labels for observed processes.

## What you may and may not touch

In scope: a new census module under `tools/fleet/`, `admission-wiring.ts`,
`tools/fleet/routes-admission.ts`, `tools/fleet/wire.ts` (types only, appended),
`tools/fleet/web/src/admission-client.ts`, `tools/fleet/web/src/AdmissionSection.tsx`, and tests.

**Do not touch** `actions.ts` (import from it; do not edit it), `vitest-admission.ts`,
`vitest.config.ts`, `admission-journal.ts`, `collect.ts`, `routes-actions.ts`, `routes-new.ts`,
`health*.ts`, `tools/overseer/`, or the readiness files. **Do not touch :8787.** **Do not commit.**

## Running things

`npx vitest run tests/fleet-admission-census.test.ts tests/fleet-admission-route.test.ts tests/fleet-admission-panel.test.tsx`,
typecheck via `node --import tsx scripts/typecheck.ts`. Not the full `npm test`.

## At the end

List every file changed, what each test failed with first, what you measured the census at on this
box, and — the question this stage exists to get right — **whether any count the block displays
could be read as a stronger claim than "these processes exist right now".**
