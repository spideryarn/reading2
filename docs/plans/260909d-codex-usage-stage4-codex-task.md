# Implement stage 4: show the Codex reading

You built stages 2 and 3 and applied two rounds of review findings to them. This is the last stage:
making the reading visible — in the fleet dashboard and in `overseer usage`.

Work in this checkout (git worktree, branch `worktree-codex-usage`), clean at `05d7f60d`. **Do not
commit**; I read the diff and commit from outside.

## Read first

1. **`docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md`** —
   **stage 4 is the specification.** Stage 1 holds the measured facts about the source, several of which
   constrain what may be drawn.
2. **Your own thirteen cautions for this stage** — eight at the end of
   `docs/plans/260909d-codex-usage-stage3-report.md`, five more at the end of
   `docs/plans/260909d-codex-usage-stage3b-fix-round-report.md`. **These are the specification too.**
   Read them before writing anything; they are the most concentrated list of ways this stage goes wrong.
3. **`docs/project/usage-history.md`** § "What the chart may not claim" — eight rules, each of which has
   a test on the Claude side. They apply here.
4. **`docs/project/fleet-dashboard-modes.md`** — how a tab is added, if you touch that surface.
5. **`tools/fleet/web/src/UsagePanel.tsx`** and **`tools/fleet/web/src/ui.tsx`** — the existing card and
   the `StatCard` primitive. Note `StatCard` already draws an absence in its own tone rather than the
   caller's; do not re-implement that.

## What to build

### 1. The client parser — `tools/fleet/web/src/usage-history-client.ts`

**This is the load-bearing part, and it is the reason stages 2 and 3 can both be green with nothing on
screen.** `parseSample` rebuilds each line as a whitelist — `{ nextDueMs, recordedAt, pass }` — so the
`codex` field is dropped at the browser boundary. That was finding 5 of the stage-2 review and it is
still there.

- A tolerant `codex` parser and the browser view types beside the existing ones.
- **Tolerant, not trusting.** These are bytes off a long-lived file that older and newer builds also
  write. A malformed Codex blob degrades to `unknown` and **must not** cost the Claude observation in the
  same line.
- **A malformed field is not an absent one.** An absent `codex` key means the writer predates the field;
  the record layer already keeps those apart and the browser must not collapse them.

### 2. The card — `tools/fleet/web/src/UsagePanel.tsx`

A second account card from the existing `StatCard` primitive, additive.

- **Age comes from `codex.readAt`**, never from the enclosing Claude pass's instant. They are different
  observations taken at different times, and the Claude pass may have failed while the Codex one
  succeeded.
- **One row per window, shown by its display alias or its raw duration.** `300 → "5 hours"`,
  `10080 → "7 days"`; an unfamiliar positive duration is drawn by its duration, not hidden.
  **Never derive a window's identity from its slot** — `primary` is the weekly window on one bucket and
  the five-hour window on another. This is measured, and it is in stage 1.
- **Only the general `codex` bucket is headroom.** If it is absent, headroom is unknown; no model-specific
  bucket may stand in for it, ever.
- **A `rateLimitReachedType` that is set is decision-significant** — your own caution. Showing only a
  percentage next to it could read as headroom while the backend has stopped serving.
- **Values above 100 are preserved and displayed.** Clamp bar geometry only, never the number.
- **No "API credits" stat.** The finding behind it was withdrawn — `credits` describes the ChatGPT
  account, not the `CODEX_API_KEY` balance. The reset-credit count is fine as its own stat.
- **`UsageCard` has two mounts** (Overseer tab and Usage tab). Ownership of "which reading is the newest
  Codex one" must be explicit so both mounts show the same thing — your own caution.
- **The live card re-derives reset expiry against the viewer's clock; historical chart points must not.**
  Also yours, and it is the distinction `usage-history.md` is most emphatic about.
- **Reject ambiguity rather than picking arbitrarily.** Persisted validation permits duplicate bucket ids
  and duplicate window slots, so a consumer using `find()` must treat a duplicate as unknown — your
  caution again.
- **Newest-state selection uses file order**, not `codex.readAt`; `readAt` is for the age of a value
  only. And a newer attempt supersedes an older value even when the newer one is unknown, absent,
  omitted, unreadable or unsupported.

### 3. `overseer usage` — `scripts/overseer.ts`

- Both accounts printed, additive to `usageLines()`, with the positive control printed every time.
- **`--json` must include the Codex reading too.** It bypasses `usageLines()` entirely
  (`scripts/overseer.ts:870` prints `JSON.stringify(report)`), so changing the text output alone leaves
  the JSON silently incomplete — your caution, and I have confirmed it in the source.
- **No new flag.** `buildProgram()`, the `Parsed` union and `help()` stay untouched.

### 4. The doc — `docs/project/usage-history.md`

A short section: the source, that every reading is a real fetch rather than a cache, the
positional-mapping trap, and that the number is **non-monotonic at short range** (it oscillates a full
point between readings seconds apart, so a threshold flaps and a one-point drop is not a refund).
Keep it brief and cite the plan rather than restating it.

## Constraints

- `tools/fleet/web/**`, `scripts/overseer.ts` (`usageLines()` and the `usage` case only),
  `docs/project/usage-history.md`, and their tests.
- **Do not import `scripts/subagent-cli.ts` or anything reaching `src/env.ts` from a file under
  `tools/`** — `tests/fleet-imports.test.ts` forbids it and it has already reddened the suite once in
  this work. The web bundle has its own stricter rules; check `tests/fleet-imports.test.ts` before
  adding any import.
- No new dependency.
- Do not weaken or delete a test to make a change fit.

## Tests

- **An end-to-end test: route payload → `parseUsageHistory` → rendered Codex card.** Nothing less
  catches a whitelist, which is the specific bug this stage exists to fix. Sol asked for exactly this.
- The parser's tolerant arms, including malformed-Codex-keeps-Claude and absent-vs-malformed.
- The card's rules above — each of the "must not" items wants a test that fails when it is violated.
- Red first. And please make sure each test can fail for the reason it names: two findings last round
  were tests that could not, and one of them I had praised.

## How to run things

- `npx vitest run tests/<one>.test.ts` and `node --import tsx <script>` work.
- **`npm run typecheck` and `npm test` do not** — I run those. Your own "direct TypeScript check" does
  **not** cover the test projects; it passed last round while the real typecheck failed on a test file,
  so reason carefully about types in tests.
- **No network, and no live reading.** The fixtures in `tests/fixtures/codex-usage/` exist for this.

## What to report

- What you changed, and the shape of the browser view types.
- Red-then-green evidence for the end-to-end test in particular.
- Anything in stage 4's specification, or in your own thirteen cautions, that turned out to be wrong.
  You have found a wrong instruction from me in all three previous rounds; please keep looking.
- Anything left undone or that you could not check.
