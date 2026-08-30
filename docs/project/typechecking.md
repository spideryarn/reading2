# Type-checking

```bash
npm run typecheck   # every project, plus the checks that the checking happened
```

Run it before you commit, alongside `npm test` — see [testing.md](testing.md). It takes a few
seconds and needs nothing running.

## Why this file exists

A typecheck is a thing we quote as evidence. "The client typechecks" is meant to end an argument. So
it matters, more than for most tools, that it is doing what it claims — and for several weeks it was
not:

> `npx tsc --noEmit -p src/web/tsconfig.json` has been exiting 0 without checking a single file. It
> extends the root config, which carries `"exclude": ["src/web", ...]` so that the node-side build
> skips the client — and `exclude` is inherited through `extends`. So this config excluded exactly
> what it included: 0 files, no errors possible, exit 0.
>
> — commit `fde38bb`, 2026-08-25

That is [silent-success](../reusable/silent-success.md) aimed squarely at the tool we use to decide
whether the code is right. Everything below is built so it cannot happen again quietly.

## The layout: one base of options, three projects

| File | What it is |
|---|---|
| [`tsconfig.base.json`](../../tsconfig.base.json) | compiler options, and **nothing else** |
| [`tsconfig.json`](../../tsconfig.json) | the node side: `src/` minus `src/web`, plus `scripts/` and the two vite configs |
| [`src/web/tsconfig.json`](../../src/web/tsconfig.json) | the browser client — see [web-client.md](web-client.md) |
| [`tests/tsconfig.json`](../../tests/tsconfig.json) | the tests, which reach into both of the others |

The base carries no `include`, `exclude` or `files`, and must never grow one. That is the whole
lesson of `fde38bb`: those three keys are inherited through `extends`, so a file list written for
one project silently becomes a rule for every project that extends it. Options are safe to share;
file lists are not.

Each project states its own file list. `src/web` and `tests` also state `"exclude": []` explicitly,
which is belt-and-braces — it neutralises an inherited exclusion if one ever reappears.

**So `npx tsc --noEmit -p tsconfig.json` is not "the typecheck", and reaching for it is a trap with
no error message.** That project is the node side only: a test file is not in it, and neither is
`src/web`. Run `npm run typecheck`, which runs all three and then checks that every `.ts`/`.tsx` in
the repo was resolved by one of them. The way this bites is a **type-level assertion in a test** —
a `Record<Derived, …>` written to make a missing case fail the build. Mutate the code it guards,
run the wrong project, get a clean exit, and conclude the assertion does not work. It does; you did
not run it. 2026-08-30, on `tests/messages.test.ts`.

### Why three, and not one

They genuinely differ, and the differences are the kind that catch bugs:

- **The node side uses `nodenext` module resolution**, because that is literally how those files run
  — `tsx`, node ESM. Under the `Bundler` resolution it had before, `import { x } from "./ids"` with
  the `.js` left off typechecked perfectly and then died the first time anyone ran the stage.
- **The client uses `Bundler` and the DOM libs**, because vite builds it and a browser runs it.
- **The tests need both at once**: a single test file imports `../src/arc.js` and
  `../src/web/keynav.js` in the same breath.

Before `tests/tsconfig.json` existed, the tests were checked by nothing at all. `npm test` runs them
through vitest, which strips the types without looking at them — so a test could assert against a
function signature that had not existed for weeks and stay green.

### The `@/` alias, and where it may live

shadcn generates its imports as `@/lib/utils`, so the alias had to exist before any component landed
([web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components)). Four things
resolve it, from four different files, and each fails its own way:

| Resolver | Reads | If the alias is missing there |
|---|---|---|
| vite | [`vite.config.ts`](../../vite.config.ts) | the dev server and the build cannot find the module |
| vitest | [`vitest.config.ts`](../../vitest.config.ts) | **vitest loads this file instead of `vite.config.ts`**, so an alias declared only there is invisible to tests while the dev server is perfectly happy |
| tsc, the client | [`src/web/tsconfig.json`](../../src/web/tsconfig.json) | the typecheck fails, or worse, resolves somewhere wrong |
| tsc, the tests | [`tests/tsconfig.json`](../../tests/tsconfig.json) | a test that imports a component which imports a shadcn one fails to typecheck, on a module vite and vitest both resolve perfectly well. Added 2026-08-25, when `tweets-page.test.ts` became the first test to reach one |

**`paths` lives in the project that needs it, never in the base.** `paths` entries resolve relative to
the config file that declares them, so in `tsconfig.base.json` a `"@/*": ["./*"]` would point at the
repo root for `tests/` and the node side too, and `@/lib/utils` would resolve to a file that does not
exist there. **Both copies point at `src/web`** — `./*` from inside it, `../src/web/*` from `tests/`
— which is the point: these are browser modules, and the node project still has no way to reach them
by this name.

**There is no `baseUrl`, and there must not be.** The migration plan called for `"baseUrl": "."`;
**TypeScript 7 has removed it outright** (error TS5102). `paths` now resolves relative to its own
config file, which is exactly the behaviour we wanted anyway. This was caught by the typecheck rather
than reasoned out, which is the argument for proving the alias in every runtime instead of one.

### The trap: the shadcn CLI cannot resolve the alias here

The CLI reads the **root** [`tsconfig.json`](../../tsconfig.json) to work out where `@/` points. Our
`paths` are in `src/web/tsconfig.json`, where they belong, so the CLI finds nothing, gives up, and
writes a literal `./@/components/ui/` directory **at the repo root**. It reports success.

Move the file to `src/web/components/ui/` by hand and delete the stray `@` directory. Anyone running
`shadcn add` in this repo must expect this every time —
[setup-dev.md § Adding a UI component](setup-dev.md#adding-a-ui-component) has the sequence.

Leaving it where the CLI put it does not merely look untidy: nothing under `./@/` is inside any
project's file list, so it would be typechecked by nothing. The second guard below catches that — an
unowned `.tsx` fails `npm run typecheck` — which is the only reason this is a nuisance and not a
silent hole.

**Do not relax a base-config flag to make generated code compile.** Generated components are our code
the moment they land, which is the whole shadcn model. Fix the file.

## The flags, and why

`strict` is on, and so is everything below it in the base config. The ones worth explaining:

- **`noUncheckedIndexedAccess`** — the one that matters most here. `blocks[i]` and `nodes[id]` now
  give you `T | undefined`, so every lookup has to answer "what if it isn't there?". This repo
  addresses everything by block id through exactly those two shapes
  ([block-ids.md](block-ids.md)), and a lookup that quietly yields `undefined` is how a range check
  goes wrong without saying so. Where an index really is in range, say so in a comment and use `!` —
  the comment is the point, not the `!`.
- **`exactOptionalPropertyTypes`** — "absent" and "present but undefined" stop being the same thing.
  This found a live bug the day it went on: `setAt(blockId, { history: "push", limitUrlUpdates:
  undefined })` in [`src/web/App.tsx`](../../src/web/App.tsx) was meant to cancel the position
  debounce so a spine click isn't sluggish, and cancelled nothing — nuqs resolves that option with
  `??`, so an explicit `undefined` falls straight through to `atParam`'s `debounce(...)`. It is
  `throttle(0)` now. See [url-state.md](url-state.md).
- **`verbatimModuleSyntax`** and **`isolatedModules`** — every file must make sense transpiled on
  its own, which is what tsx, vite and vitest all actually do to them.
- **`noEmit` in the base** — nothing here is ever built by `tsc`. The client goes through vite, the
  stages through tsx. `tsc` is a checker and only a checker.

**Deliberately off: `noPropertyAccessFromIndexSignature`.** It would force
`process.env["OPENROUTER_API_KEY"]` and `dataset["block"]` over the dotted form. Both are already
`string | undefined`, so the flag buys a typo check we mostly get elsewhere, at the cost of making
every environment and dataset read uglier. Turn it on if env-var typos ever actually bite.

## The two guards in `npm run typecheck`

[`scripts/typecheck.ts`](../../scripts/typecheck.ts) runs each project, but the reason it exists
rather than being `tsc && tsc && tsc` in package.json is the two things a plain run cannot tell you:

1. **Every project must resolve at least one file.** An empty project cannot fail. Exit 0 from one
   means nothing at all, and that is the exact shape of `fde38bb`.
2. **Every `.ts`/`.tsx` file in the repo must be resolved by some project.** This is what would have
   caught `tests/` going unchecked, and what catches the next directory somebody adds without
   thinking about which project owns it.

Projects are **discovered**, not listed, so adding a `tsconfig.json` anywhere is enough to get it
run. The file counts come from `tsc --listFiles` — the list tsc really used, not one recomputed from
`include`/`exclude`, which could go wrong in precisely the way tsc did.

Both guards were checked by breaking them on purpose: a project rigged to include and exclude the
same directory, a stray file outside every project, and a deliberate type error dropped into each of
the three in turn. That is the habit the whole of [silent-success.md](../reusable/silent-success.md)
argues for — **a check you have never seen fail is not yet a check.**

## Three ways to report it clean while it is red

All three happened. None is a flaw in the gate — the gate said the right thing every time.

**Filtering the summary away from the names.** `npm run typecheck 2>&1 | grep -E "^✓|^✗"` looks like
a reasonable way to see the three results at a glance. It is not: the per-error lines are **indented**
under the `✗`, so that filter prints `✗ tests/tsconfig.json (607 files, 2 errors)` and drops every
file name beneath it. A count is not a diagnosis, and "2 errors, and I know which ones" is a sentence
that gets shorter as you say it. Read the whole output, or grep for `error TS` **as well** as the
summary lines.

**Editing after the last run.** On 2026-08-29 a report said typecheck was clean except for one file
owned by another session. It had been true when the command was run; a one-line edit afterwards — made
to satisfy a *different* gate, `tests/fixture-ids.test.ts` — replaced an object literal and dropped a
required field. Every check run after that edit was a test run, and **vitest does not typecheck**, so
186 green tests said nothing about the red gate. docs/plans/delete-the-importer.md § *And a green
report over a red gate* has the whole reconstruction.

> **The gate must be the last thing you run before you report, not the last thing you remember
> running.** An edit invalidates every gate run before it, including a one-line edit that only
> touched a test.

**Green on the union of everybody's unfinished work.** This one is invisible in a single-agent tree
and routine here. `npm run typecheck` reads the **working tree**, and several agents share this one —
so it answers *does my tree compile*, when the question at commit time is *does `HEAD` plus my commit
compile*. Those come apart the moment your code depends on a file somebody else has written and not
yet committed. On 2026-08-28 four lanes each had a green gate and `HEAD` did not compile, with 16
errors across four files; every one was a commit whose missing file was sitting untracked beside it.
The next day it happened again, to the person who had written that up: `113ce17` landed `App.tsx`
without the five panel files whose `Props` it had reshaped.

**An import check does not catch it either**, which is the trap inside the trap. Resolving a file's
relative imports and refusing any that `git ls-files` does not know answers *can this be resolved*.
`113ce17` passed that and still had nine errors, because what had changed was the shape of a type
inside an **already-tracked** file. Resolution and type-checking are different questions.

> **Build the candidate, not the baseline.** `git worktree add --detach <tmp> HEAD`, symlink
> `node_modules` in, copy over the files you are about to commit, and run the gate *there*. That is
> literally *`HEAD` plus this commit*, which is the only one of the three possible greens you can act
> on before pushing.

Expect to iterate: on `1ace072` the first round of fixes surfaced three more errors in test files that
also had to come along. And the inverse is worth knowing before you panic — a **red** suite in this
tree is no more evidence about `HEAD` than a green one. An uncommitted `src/db/schema.ts` declaring a
table with no migration made about 16 database tests fail here while `HEAD` was perfectly fine.

## Where this fits

- [testing.md](testing.md) — the other thing to run before committing, and the doc-link test that
  keeps this file honest
- [architecture.md](architecture.md) — the stages the node-side project covers
- [web-client.md](web-client.md) — what the client project is checking
- [../reusable/silent-success.md](../reusable/silent-success.md) — the family of bug this whole file
  is a response to
