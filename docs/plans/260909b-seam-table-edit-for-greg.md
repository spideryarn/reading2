# For Greg: two edits to `overseer-direction.md`, before/after

`docs/project/overseer-direction.md`'s wording is a rule, so per
[edit-important-docs.md](../reusable/edit-important-docs.md) these go one approved set at a time
rather than landing with the code. **Neither is applied.** Both come out of
[260909b](260909b-usage-limits-tab-fleet-dashboard-24h-history.md).

---

## Edit 1 — a seventh file in the seam table

`~/.overseer/usage.jsonl` now exists: the daemon writes one line per usage pass, the dashboard reads
it lock-free for the Usage limits chart. The table's existing claim that *"the daemon is the only
writer of any of them"* **stays true**, which is why the file went there rather than under a new
`~/.fleet-usage/`.

### Before

```
| `attention.json` | the attention pass's memory (schema 1; keys `epoch`, `waits`, `verdicts`): … | the daemon only |
| `last-snapshot.json` | the differ's baseline … | the daemon only |
| `overseer.lock` | the single-writer claim | the daemon only |
```

### After

```
| `attention.json` | the attention pass's memory (schema 1; keys `epoch`, `waits`, `verdicts`): … | the daemon only |
| `usage.jsonl` | the last 24 hours of usage readings, one line per pass (`usage.prev.jsonl` after a rotation) — utilisation, the rejection clusters seen, and whether the checkpoint published that pass. It exists because `current.json` keeps only the latest reading and the cache behind it is overwritten, so this cannot be reconstructed afterwards | anyone, any time |
| `last-snapshot.json` | the differ's baseline … | the daemon only |
| `overseer.lock` | the single-writer claim | the daemon only |
```

The surrounding paragraphs count the files (*"said five files until…"*, *"turned out to be the
sixth"*). If you take this, one of them wants a following sentence — suggested wording, yours to
change:

> **And it was six until 2026-09-09, when `usage.jsonl` was added deliberately rather than
> discovered.** Unlike the two above it is part of the seam rather than private working state: the
> dashboard reads it on every view of the Usage limits tab. It is listed here first and built second,
> which is the difference between a seam and an omission.

---

## Edit 2 — say what the `tools/fleet` ↔ `tools/overseer` rule actually is

**This is the one I would take even if you drop the other.** Two sessions got this rule wrong in
opposite directions on the night of 2026-09-08/09, and both were confident. Neither looked for the
test that enforces it, because nothing says there is one.

Suggested addition, near the seam table. The one-sentence rule is
`260908f-roadmap-exec-identity`'s wording, and it is already the comment in
`tests/fleet-attention.test.ts`, so taking it verbatim keeps one home for the fact:

> ### Which of these two may import the other
>
> `tools/fleet/` may import a module from `tools/overseer/` **only if that module cannot reach
> `tools/overseer/store.ts`** — directly or transitively — and closes no cycle. The allowlist in
> `tests/fleet-attention.test.ts` is the enforcement, and its length is a consequence of that rule
> rather than a limit of its own.
>
> **The rule is about the store, not about the count.** A short allowlist reads as a quota — *two
> modules, and a third needs justifying* — but what earns a place is being a leaf that does not drag
> the store in behind it. `store.ts` pulls usage, memory, diff, lock and log along with it, and it
> holds the Overseer's *opinion* about what a bad checkpoint means, which is exactly what the
> dashboard must not inherit.
>
> **There is a test, and it is stricter than it looks**: it asserts the set by equality rather than
> containment, so removing an entry is as visible as adding one, and it walks the transitive closure
> — a fleet module importing `lock.js` which itself imported `store.js` is caught, where a
> direct-import scan would stop at `lock.js`.
>
> The lesson the two of us actually needed is more general than this seam: **name the scope you
> searched inside the sentence that reports the result.** "Nothing in `tools/overseer/` imports X" is
> a claim a reader can size. "The seam is one-way" is one they cannot — and it was false, in both
> halves, while sounding measured.

### Why it matters enough to be worth your approval

It cost about two hours and reversed a design decision. The claim arrived from one session that had
grepped a single direction and concluded about both; it was written into a plan as the *decisive*
reason without the reverse grep being run. Both sessions retracted. The end state everyone wants is
in the roadmap already — `work.ts`, `work-probe.ts` and `harness.ts` are about panes and processes,
which is the fleet's own domain, so **moving them takes the list back to two** and the rule stops
needing to be explained at all.
