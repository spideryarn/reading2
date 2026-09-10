# Task: Stage 2 — the admission section on the Box health tab

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility` (a linked git worktree),
branch `worktree-admission-visibility`. TypeScript + ESM, vitest + React Testing Library.

**Read first, in this order:**

1. `docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md` — the plan.
   **§1 and §3 are the sentences this section must draw; §8 is the panel's own rules.** Read both
   "Review dispositions" sections too: they say which words were banned and why, and a reviewer will
   hold you to them.
2. Stage 1's code, already committed: `tools/fleet/routes-admission.ts`, `tools/fleet/wire.ts`'s new
   types, `tools/fleet/admission-wiring.ts`.
3. `tools/fleet/web/src/HealthHistory.tsx` and `health-history-client.ts` — **the exemplars**. That
   pair is an on-demand fetcher living inside `HealthPanel`, which is exactly this section's shape.
   Copy the four-arms discipline in `health-history-client.ts`'s header especially.
4. `docs/project/fleet-dashboard-modes.md` §§ *The seam, which is invisible from the panel*,
   *Absence is stated, never drawn*, *The test*.
5. `tools/fleet/web/src/HealthPanel.tsx` — where this mounts. Note `health: unknown`: the health
   prop is read loosely by name, never cast.

## What to build

### `tools/fleet/web/src/admission-client.ts`

`ADMISSION_URL = "api/admission"`, a typed `AdmissionApi` **seam**, and a parser that turns an
unknown JSON body into a view type or a stated absence.

**The seam is the point** and it is invisible from the panel: bind `fetch` at import time and the
module is unstubbable in any suite that imports it first, and the failure looks like a real network
call in a test that has none. Tests drive the panel through the seam; they never stub `fetch`.

The view type needs **one more arm than the server has**, for the same reason
`health-history-client.ts` does: the server's outcomes say what the *box* is, and there must be a
separate arm saying **this browser never got an answer it could read** — in the browser's own voice,
never wearing the server's. Collapsing those is how a network blip on Greg's phone becomes a
statement about the box.

Parse defensively and by name. Anything unrecognised becomes a stated unknown, not a number and not
a blank.

**Range-check any instant you did not compute.** `new Date(ms).toISOString()` throws `RangeError`
past ±8.64e15 and, thrown during render, blanks the **whole panel** rather than one line.
`Number.isFinite` does not catch it — `1e300` is finite and out of range.

### `tools/fleet/web/src/AdmissionSection.tsx`

The section. What it draws, in order:

1. **The forecast sentence, verbatim from the plan's §1**, including *"this panel admitted or
   refused nothing"* and the `--maxWorkers` clause. That wording is the output of two review rounds;
   do not improve it.
2. The outcome, and the gate's own numbers and message where it gave one.
3. The label from §3 — `forecast`, `observed` or `not-modelled`. **The string `enforced` must not
   appear anywhere in this file** except inside a sentence describing where enforcement actually
   happens (in a vitest process refusing itself).

**Never draw anything a reader could take for a healthy zero.** This is the panel's standing rule,
set by the Box health rework at `6e8e28e3`: `health-view.ts` now refuses to build a progress bar
when there is no number behind it. A forecast that is unavailable is a **sentence naming which kind
of nothing it is** — *the machine has no admission policy* / *the server could not ask its own gate*
/ *this browser never got an answer* — never an empty or zeroed shape.

### Mounting it

- `HealthPanel.tsx`: one mount line, and one optional `admissionApi` prop defaulted here, exactly as
  `historyApi` is. **Do not touch the `<HealthHistory …/>` line, the existing props signature, or
  the `historyApi` default.**
- `App.tsx`: one injected-and-defaulted prop alongside `historyApi`.

The card's order after the Box health rework is: record prose → four charts → verdict strip and its
time axis → legend. Place this section so it reads as part of that order rather than interrupting
it, and say in your answer where you put it and why.

## The tests

New file `tests/fleet-admission-panel.test.tsx`. Do not add cases to another session's test file.

`mount()` will not drive an on-demand section — `manualTransport()` controls pushed state only and
the ordinary helper injects no API. **`mountFull()` is the one that takes them.**

1. Opening Box health **issues the request** — assert through the injected seam.
2. Each of the five outcomes renders its own sentence, distinguishably.
3. The forecast disclaimer sentence is present, and `enforced` is absent from the rendered output.
4. `not-modelled` for a review or browser kind reads as *we have no cost model*, not as *fine* and
   not as *refused*.
5. A browser that never got an answer says so **in its own voice**; assert the server is not blamed.
6. No arm renders a zero or an empty bar for an absent number.

**Every test red first.** Report what each failure looked like.

## What you may and may not touch

In scope: `tools/fleet/web/src/admission-client.ts` (new), `AdmissionSection.tsx` (new),
`HealthPanel.tsx` (two small additions), `App.tsx` (one prop),
`tests/fleet-admission-panel.test.tsx` (new).

**Do not touch:** `health-view.ts`, `history-series.ts`, `HealthHistory.tsx`,
`health-history-client.ts`, `types.ts`, `mode.ts`, `Dock.tsx`, `tailwind.css`, anything under
`tools/fleet/` outside `web/src/`, or `tools/overseer/`. **This is a section, not a mode** — it adds
no tab, so none of the six mode registrations applies.

**Do not commit.** I read the diff and commit. **Do not touch the dashboard on :8787** — it is live,
and it serves a pre-change build, so it is not evidence about this work either way.

## Running things

- Focused: `npx vitest run tests/fleet-admission-panel.test.tsx tests/fleet-web.test.tsx`
  — the second one is not optional here: it pins the bars and tile copy that landed at `6e8e28e3`,
  and it is what catches a block duplicated or dropped by a clean merge.
- `npm run typecheck` — judge by **exit code**; its last two lines are always `✓` and it writes `✗`
  to stderr, so a tail or a stdout-only capture reads clean over a red run.
- **`vitest` never type-checks**, so a type-level guard cannot go red under `npm test`.
- Do **not** run the full `npm test`.

## At the end

List every file you changed, what each test failed with before it passed, and where you placed the
section in the card's order.
