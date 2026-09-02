# Code quality: the checks

How you find out whether what you just did works. Most of it is four npm scripts; the rest is a
browser and a stopwatch, for the two things a script cannot answer — does the reading view look
right, and what does it cost.

Two rules an agent will otherwise break:

- **Run `npm test` and `npm run typecheck` when you finish a change, not at commit time.** Both are
  deterministic and take seconds. Finding out at commit time that a change from half an hour ago was
  wrong is the expensive way to find out.
- **Lint's baseline is not clean.** `npm run lint` is advice, not a gate. Read the findings on the
  files you touched; don't try to get it to zero.

## The commands

| Command | What it checks | Gate? |
|---|---|---|
| `npm test` | the deterministic vitest suites in [`tests/`](../../tests) | **gate** |
| `npm run test:watch` | the same, while you work | — |
| `npm run typecheck` | all three tsconfig projects, plus guards that the checking happened | **gate** |
| `npm run build` | that vite can resolve, bundle and parse it — typechecking does not prove this | **gate** |
| `npm run cycles` | import cycles (zero today, so a failure is news) | **gate** |
| `npm run lint` / `lint:fix` | Biome over everything `biome.jsonc` allows | advice |
| `npm run knip` | unused files, exports, dependencies | advice |
| `npm run complexity` | functions worth a second look | advice |
| `npm run dupes` | copy-paste | advice |
| `npm run check` | all eight of the above, gates first, ~20s (`-- --fast` skips the build; `-- --offline` drops the database requirement below) | **gate** |
| `npm run count-lines` | how big the repo is, by what a file is *for* | — |
| `npm run db:check` | that the database in `DATABASE_URL` has the columns this build reads | needs a database |
| `npm run eval:*` | model quality — by hand, costs money, minutes | — |

**`npm run check` needs a local database**, because its test gate runs under `REQUIRE_POSTGRES=1` —
without it, seventy-odd suites skip themselves and the gate goes green over a quarter of the suite
not running ([static-analysis.md](static-analysis.md#the-gateadvisory-split)). `-- --offline` runs
everything else and says in its summary that it is not the real gate.

`db:check` is still not in `npm run check`, because it asks about one particular deployment's
database rather than about this code. Point it at the **app's** credential rather than an
administrator's — it asks
what the connecting role can see, and `information_schema` hides columns the role has no privilege
on, so a superuser seeing everything proves nothing about what Vercel can select. It is the answer
to "have the migrations reached the database this code is about to talk to?", which cost production
two outages on 2026-08-27 — [260827w-schema-drift-guard.md](../plans/260827w-schema-drift-guard.md).

The gate/advisory split is a deliberate design, written up at the top of
[`scripts/check.ts`](../../scripts/check.ts): a check that always fails is a check nobody runs, so a
tool with a known backlog prints its findings and does not fail the command. It gets promoted to a
gate on the day its findings reach zero, not before.

## A check you have never seen fail is not evidence

This is the house pattern, and it costs more time here than any other single thing. A thing reports
success while doing nothing, and the check you would naturally run returns the answer you were hoping
for — because it shares an assumption with the code. Read
[silent-success.md](../reusable/silent-success.md); it has a dozen worked examples and the habit that
catches them. This repo's own typecheck once exited 0 having checked 0 files.

[browser-testing.md](browser-testing.md) and [performance.md](performance.md) are both largely about
the same theme in its measuring form — instruments that came back confident and wrong. That is why
you read those two *before* you measure something, not after.

## The docs

- **[testing.md](testing.md)** — the vitest suites: what each one pins, what we deliberately don't
  test, how to render a component without a testing library, and why the docs themselves have a test.
- **[typechecking.md](typechecking.md)** — the three tsconfigs and why they differ, the strict flags,
  and the guards that stop a typecheck from checking nothing.
- **[linting.md](linting.md)** — why Biome rather than ESLint (TypeScript 7 removed the API ESLint
  needs), which rules are off on purpose, and the config-file extension that silently discards your
  settings.
- **[static-analysis.md](static-analysis.md)** — Knip, cycles, complexity, dupes; the gate/advisory
  split; and the tools that look perfect for this repo and are quietly wrong about it.
- **[browser-control.md](browser-control.md)** — two ways to drive a browser, and the machine you
  are on decides which. The extension on the laptop; Playwright on the remote box, where it cannot
  follow. Open this before either of the two below.
- **[browser-testing.md](browser-testing.md)** — driving the reading view in a real browser, and the
  ways it lies to you: colour in a screenshot, a hidden tab that fires no scroll events, hovering by
  pixel rather than by element. Open this before any UI check. Its recipes are written in the
  extension's tools, because that is the laptop.
- **[browser-testing-playwright.md](browser-testing-playwright.md)** — those same checks in
  Playwright, for the remote box, and which of that doc's traps stop existing once the browser is
  headless and yours: the hidden tab, the black screenshot, the pixel arithmetic, the 605px floor.
- **[claude-in-chrome.md](claude-in-chrome.md)** — getting the extension to talk to Claude Code in
  the first place. `list_connected_browsers` returning `[]` is almost always the wrong Chrome
  profile, not broken plumbing. Open this before you debug anything below the extension.
- **[performance.md](performance.md)** — what the page costs at rest and while scrolling, the exact
  commands, and why render counts beat percentages. Open this before any CPU claim.
- **[counting-lines.md](counting-lines.md)** — `npm run count-lines`: how big the thing is now, as a
  command rather than an argument. Nothing gates on it.
- **[evals/README.md](../../evals/README.md)** — **not tests.** An eval calls a model, costs money,
  and gives a slightly different answer each time. Run by hand when a decision needs one; results
  committed so the next change is compared against a number rather than a memory.

## Where the code is

- [`scripts/check.ts`](../../scripts/check.ts) — the one command, and the gate/advisory list
- [`scripts/typecheck.ts`](../../scripts/typecheck.ts), [`scripts/count-lines.ts`](../../scripts/count-lines.ts)
- [`vitest.config.ts`](../../vitest.config.ts), [`biome.jsonc`](../../biome.jsonc), [`knip.jsonc`](../../knip.jsonc)
- [`tests/`](../../tests), [`evals/`](../../evals)

---

Up: [AGENTS.md](../../AGENTS.md)
