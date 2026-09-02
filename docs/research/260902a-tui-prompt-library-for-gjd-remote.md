# A TUI prompt library for `gjd-remote`, and why it's not `readline` alone

`gjd-remote` ([`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts)) needs two interactive prompts
that don't exist yet:

1. A yes/no confirmation — "repo X is not on the box. Clone it to `~/code/X` and run its setup?
   `[y/N]`".
2. A multi-select checklist of 20-60 environment-variable **key names**, with a model's proposed
   subset pre-ticked, toggle-by-item, select-all / select-none, one-line reason per item, then
   confirm.

Researched 2026-09-02 against the criteria in
[third-party-library-selection.md](../reusable/third-party-library-selection.md) — community depth
first, because that's pretraining data for coding models; a well-designed, type-safe API second.
Numbers pulled live from the npm registry and GitHub APIs that day, not from memory.

This sits next to [260831d-gjd-remote-cli.md](260831d-gjd-remote-cli.md), which chose **no**
argument-parsing library for the same tool, for a reason specific to that day (a peer's uncommitted
`package.json` edit) rather than a standing rule against dependencies. That reasoning doesn't carry
over silently — it's re-examined below.

## The constraint that matters most here

`gjd-remote` sometimes reads its prompt text from stdin (`new-claude -p -`) and then reopens
`/dev/tty` for the interactive parts, because stdin is already spent
([`interactiveStdin()`](../../scripts/gjd-remote.ts), around line 1207). Whatever prompts this tool,
it **must accept an explicit input stream** (a `Readable` wrapping that fd) rather than assuming
`process.stdin` — otherwise the confirm/checklist prompts would silently read from the wrong place,
or hang, whenever they're reached after `-p -`.

This ruled out checking "does it support custom streams" as an afterthought — it's the first thing
checked below, by reading each library's actual TypeScript source, not its README.

## What was compared

| Library | Latest (released) | Weekly downloads | Stars / open issues | Custom input/output stream | Pre-ticked multiselect + select-all |
|---|---|---|---|---|---|
| **`@inquirer/prompts`** | 8.7.0 (2026‑08‑26) | 39.0M | 21,619 / 16 | **Yes** — `context: { input, output, signal }` on every prompt call | **Yes**, both built in |
| `@clack/prompts` | 1.7.0 (2026‑07‑03) | 21.3M | 8,035 / 87 | **Yes** — `input`/`output` in every prompt's options | Pre-tick yes (`initialValues`); select-all **no**, hand-rolled |
| `prompts` (terkelg) | 2.4.2 (2021‑10‑07) | 60.3M† | 9,308 / 150 | Yes (`stdin`/`stdout` opts) | Pre-tick yes; select-all no |
| `enquirer` | 2.4.1 (2023‑07‑28) | 35.3M† | 7,950 / 207 | Yes (`stdin`/`stdout` opts, documented) | Pre-tick yes (`enabled`); select-all no |
| `ink` | 7.1.1 (2026‑07‑16) | 6.5M | 39,776 / 32 | Yes (React renders to any stream) | Build it yourself — it's a UI framework, not a prompt set |
| `readline/promises` (built-in) | ships with Node | — | — | Trivial — constructor takes `input`/`output` directly | Build it yourself — no prompt UI at all |

† `prompts` and `enquirer`'s download counts are mostly inherited: `prompts` is a transitive
dependency of `create-vite`/`listr2`/etc, and `enquirer` of several scaffolding tools, so the number
overstates how many projects use it directly for new code today. Weight the release date and issue
count more than the raw download figure for these two.

**Verified, not assumed, for each of the two "yes" answers that mattered:**

- `@inquirer/prompts` — every modular prompt (`confirm`, `checkbox`, …) has the signature
  `Prompt<Value, Config> = (config: Config, context?: Context) => Promise<Value>`, and
  `Context = { input?: Readable; output?: Writable; clearPromptOnDone?: boolean; signal?: AbortSignal }`
  (from [`@inquirer/type`'s `inquirer.ts`](https://github.com/SBoudrias/Inquirer.js/blob/main/packages/type/src/inquirer.ts)).
  `createPrompt` defaults `input` to `process.stdin` and pipes `output` through a `MuteStream` onto
  `context.output ?? process.stdout` — so passing a custom fd-backed stream is a first-class,
  documented path, not a hack.
- `@inquirer/checkbox`'s source
  ([`packages/checkbox/src/index.ts`](https://github.com/SBoudrias/Inquirer.js/blob/main/packages/checkbox/src/index.ts))
  has `checked?: boolean` and `description?: string` per choice, and
  `shortcuts?: { all?: string | null; invert?: string | null }` defaulting to `{ all: 'a', invert: 'i' }`.
  The `all` handler is a genuine toggle — `selectAll = items.some(c => isSelectable(c) && !c.checked)`
  then sets every item to that — so one key does select-all *and* select-none depending on current
  state, which is exactly the two behaviours asked for, built in.
- `@clack/prompts`' `multiselect()` and `confirm()` both forward `input`/`output`/`signal` straight
  into `@clack/core`'s `Prompt` base class (verified in
  [`packages/prompts/src/multi-select.ts`](https://github.com/bombshell-dev/clack/blob/main/packages/prompts/src/multi-select.ts)
  and [`confirm.ts`](https://github.com/bombshell-dev/clack/blob/main/packages/prompts/src/confirm.ts)),
  and `MultiSelectOptions` has `initialValues?: Value[]` and per-option `hint`. But there is **no**
  `shortcuts` field on `MultiSelectOptions` at all — select-all would have to be hand-built (e.g.
  intercepting a keypress before it reaches clack's own handler), which is exactly the kind of custom
  raw-mode code this research is trying to avoid taking on.

**Non-TTY behaviour**, checked in both librares' raw-mode helpers rather than assumed: both
`@inquirer/core` (`readline.createInterface({ terminal: true, input, output })`) and `@clack/core`'s
`setRawMode()` (`if (i.isTTY) i.setRawMode(value)`, in
[`packages/core/src/utils/index.ts`](https://github.com/bombshell-dev/clack/blob/main/packages/core/src/utils/index.ts))
guard the raw-mode call behind `isTTY`, so neither throws when handed a non-TTY stream — but neither
gives you a clean "refuse with a message" for free either. `gjd-remote` already has its own TTY check
pattern (`process.stdin.isTTY`, `openSync('/dev/tty', 'r')` wrapped in try/catch) right next to where
these prompts would be called, so the tool's existing convention is what should decide "refuse
clearly", not the library.

**`enquirer` is effectively unmaintained.** Its GitHub API `pushed_at` reads 2024‑06‑11, which looked
like activity — but a diff against its last tag shows **zero commits since the 2.4.1 release on
2023‑07‑28**; the later push event touched something other than the `master` branch (a tag or a
non-code ref). 207 open issues, including known unhandled-promise-rejection bugs in `validate`, with
nobody merging fixes. Rich feature set (autocomplete, scale, per-item descriptions, explicit
`stdin`/`stdout` options — all genuinely present in its docs) but it's a dead end to build on now.

**No known `tsx`-specific incompatibility for any of these.** The general Node caveat — don't call
`setRawMode()` on a stream that lacks it (non-TTY stdin, some CI runners) — is handled inside both
`@inquirer/core` and `@clack/core` already, not something the caller has to work around. `tsx`'s own
open issues around stdin are specific to `--watch` mode, which `gjd-remote` doesn't use.

## Is there prior art for the exact UX?

Looked for a well-known tool that does "here's a proposed subset, pre-ticked, confirm or adjust" for
environment variables specifically — Doppler, Infisical, dotenv-vault, 1Password's `op run`, direnv.
None of them do quite this: Doppler and Infisical's CLIs prompt for *which project/config* to point
at (a single-select, not a pre-ticked multi-select over key names), `op run` and direnv work off a
static file with no prompt at all, and dotenv-vault's whole pitch is syncing everything, not
choosing a subset. The closest structural match to "AI proposes, human adjusts a checklist" isn't a
secrets tool at all — it's exactly the shape `@inquirer/checkbox`'s `checked` + `description` fields
were built for (a per-item default and a per-item reason), which is one more point in its favour
rather than a borrowed design.

## Recommendation

**`@inquirer/prompts`** (specifically `confirm` and `checkbox` from it) for both prompts.

- It's the only one of the five libraries where select-all/select-none and a per-item reason line
  are configuration, not code you write and maintain — the exact two features the checklist asks
  for.
- Custom input/output streams are a documented, typed part of every prompt's call signature, which
  slots directly into `interactiveStdin()`'s existing fd-reopen pattern with no adapter needed.
- It's the most actively maintained of the group by a wide margin — a release six days before this
  research, 16 open issues against 21.6k stars (a healthy ratio, unlike `clack`'s 87), and it's the
  library `vision.md`'s "long-lasting community" criterion points at hardest: it's the natural
  evolution of the `inquirer` most Node tutorials and pretraining data already know, not a rewrite
  under a different name.
- Zero-config styling is `clack`'s main selling point over it, but `gjd-remote` doesn't need
  boxes-and-step-indicators polish — it needs two working prompts.

**Runner-up: `@clack/prompts`.** Prettier output with no theming effort, equally solid custom-stream
support, and still actively maintained — but it would mean hand-rolling select-all/select-none as
custom raw-mode keypress code, which is the fiddly, easy-to-get-subtly-wrong part of a checklist UI
(the same class of complexity `readline`-from-scratch would impose everywhere). Worth revisiting only
if visual polish becomes a stated goal for this tool, which it isn't today.

**The built-in option, weighed honestly:** `readline/promises` gives the confirm prompt for free —
it's a five-line `rl.question()` wrapper, no library needed, and that part doesn't need one. The
multi-select checklist is the opposite case. A working checkbox UI needs raw-mode toggling, arrow-key
and space/enter handling, cursor repositioning to redraw without scrolling the terminal, resize
handling, and a Ctrl-C escape hatch — all things `@inquirer/checkbox` has already had years of bug
reports and fixes against. Unlike the argument-parsing decision in
[260831d](260831d-gjd-remote-cli.md), where Commander's whole value was ~40 lines of `switch`,
hand-rolling this one is not a shortcut — it's reproducing, badly, exactly the code these libraries
exist to have gotten right once. That asymmetry — trivial for the confirm, substantial and
bug-prone for the checklist — is why this research doesn't reach the same "no dependency" conclusion
260831d did, even though the underlying "prefer boring, fewer parts" principle is unchanged.

## What adding it costs

One dependency: `@inquirer/prompts` (which itself composes ten small `@inquirer/*` packages — `confirm`,
`checkbox`, etc. — all from the same maintainer, all released together). No transitive dependency
explosion the way `ink` would bring one (26 packages including a full Yoga/React-reconciler layout
engine, wildly disproportionate for two prompts). The same `package.json`-contention risk noted in
260831d applies verbatim if a peer has uncommitted edits there when this lands — check
`git status -- package.json` before adding it, same as any dependency change in this shared tree.

## Open question for the decision

[third-party-library-selection.md](../reusable/third-party-library-selection.md)'s process asks for
this to be discussed with Greg before it's final — this doc is the "search the web, evaluate
options" step, not the decision itself.
