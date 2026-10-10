# The Debate corpus — three live runs, paid for once and kept

**These three journals are the only replayable evidence Debate mode has**, and they are here rather
than in `output/debate-runs/` for one reason: `output/` is gitignored scratch, and until 2026-09-08
these files existed in exactly one place — a worktree that was about to be deleted. `npm run
worktree:check` is what caught it. Everything measured about the valence bug came out of these
files, and nothing can produce them again: the searches cost real money, the web has moved on, and
the model's answers are stochastic.

## What they are

Three runs of `evals/debate/run.ts` against production's `generateDebate`, all on 2026-09-06:

| run | article | reported rows |
|---|---|---|
| `…09-24-37-cargocult-spya-rz663q` | Feynman, *Cargo Cult Science* | 6 |
| `…09-26-49-writes` | Paul Graham, *Writes and Write-Nots* | 10 |
| `…09-28-28-claudes-constitution-spya-cr8bzk` | Anthropic, *Claude's Constitution* | 10 |

Each holds `journal.jsonl` — every request and response, including the search annotations with the
page extracts every quotation was checked against — plus `run.json` and `verify-fallback.json`.

**The Cargo Cult run is the one that matters most**, and not because of its rows: it is the only
article in the corpus whose sources are *polarity-inverting*, believer pages disputing a sceptic. The
valence bug needs that shape to appear at all, which is why the other two scored zero errors on an
unchanged prompt. Any future comparison that leaves it out is measuring nothing —
[the plan](../../../docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md) § E″, and
Sol's F69.

## What is deliberately not here

- **The `-check` runs.** `run.ts` writes those from a synthetic `bakingreview.example` fixture and
  they are regenerable, so they stay in `output/`. They are also a trap: an early sweep of mine
  counted twelve replays of one fixture as twelve pieces of evidence. **A fixture repeated is not
  evidence repeated.**
- **Anything from `data/` or a reader's article.** These three are public essays, and the extracts
  are of public pages. Checked for credentials before committing — request journals are exactly the
  kind of file that leaks an `Authorization` header, and these carry none.

## Reading them

Nothing points here by default: `RUN_ROOT` in `journal-rows.ts` is still `output/debate-runs`, which
is where a *fresh* run belongs. Pass the root explicitly.

```ts
import { readRunRows } from "./journal-rows.js";
const report = await readRunRows("2026-09-06T09-24-37-cargocult-spya-rz663q", "evals/debate/corpus");
```

**Read `report.problems` before believing any count.** It is non-empty whenever the account is short
of what the file actually holds, which is the whole reason that field exists.

And these rows predate the `valence` → `lean` rename (2026-09-08), so every one of them carries the
superseded vocabulary. `vocabularyReport` counts them as `supersededLeans` rather than
off-vocabulary, and `replayJournal` reads them forward — see `score.ts` § `SUPERSEDED_LEANS`, which
production's `readStoredLean` in `src/types.ts` must agree with. A run made *today* emitting
`valence` would be a prompt that has reverted, and is still a failure.
