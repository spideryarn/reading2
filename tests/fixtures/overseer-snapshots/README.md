# Real fleet snapshots, for the Overseer's diff logic

Captured from the live dashboard on **2026-09-08, 02:39–02:53 UTC** — 15 polls of
`GET http://127.0.0.1:8787/api/state` at 35-second intervals, yielding 8 distinct collections. Every
field of every row kept **verbatim**; the only edit is that each snapshot is trimmed to 6 sessions,
chosen to include the one the pair is about.

**Why real ones.** A hand-written fixture agrees with whatever its author imagined. These do not: see
the surprises below, several of which contradict what a plausible fixture would have said.

## The pairs

| pair | what it is |
|---|---|
| `status-change-{before,after}` | `$1991` goes `idle` → `working` |
| `session-gone-{before,after}` | `$2225` present in the first, absent in the second |
| `session-new-{before,after}` | `$2243` absent in the first, present in the second |
| `duplicate-{first,second}` | **two different polls that returned the same collection** — identical `collectedAt`, byte-identical payload |

The duplicate pair is the one most likely to be misread as filler. It is the opposite: with SSE and
polling both live, receiving the same collection twice is the *normal* case, and the admissibility
logic has to answer `duplicate` rather than `accept` or `reject`. Without a real example, that path
gets tested against a hand-copied file that is identical for the wrong reason.

## What the capture proves

**51 status comparisons differed in some field; 2 differed in anything meaningful.** Summed over
every session present in both halves of each of the 7 transitions, comparing whole `status` objects
against a canonical key of `kind` + `shell.busy` + `unknown.cause`. A ~25:1 noise ratio, almost all of
it `waiting.secondsLeft` counting down — consistent with the 36:1 measured on an earlier capture. A
diff that compares status objects structurally writes fifty-one events and buries the two.

## What these fixtures do NOT cover

Stated because absence is invisible, and a test that only uses these will look thorough while never
exercising the branches below:

- **No `unknown` status at all**, in 596 rows. So no `cause` value appears here, and the whole unknown
  arm is unexercised by real data.
- **`shell.busy` is always `true`.** The `false` branch never occurred.
- **One tmux generation only** (`tmuxServerPid: 132280` throughout). So the *different world* case —
  the one a reboot produces, and the reason the diff refuses to run across a generation boundary —
  **cannot be tested from these files.** It needs a constructed pair, and that construction should be
  labelled as constructed.
- **No `error` was ever non-null** and no snapshot was ever empty, so the two admissibility rejections
  have no real example either.
- **No verdict-level change.** `health.verdict.level` was `strained` throughout.

Where a case needs constructing, construct it from one of these files rather than from scratch, so
the envelope stays honest and only the field under test is synthetic.

## What was surprising

- `repo` is not one value. Across a single snapshot it was variously the repo, `null`, the literal
  string `"unknown"`, and `spideryarn/hellozenno`.
- `title` is null for about two-thirds of sessions. Null is the common case.
- Collection runs about every **70 s**, not the 60 s `refreshMs` advertises — it chains from the end
  of a 5.7–11.0 s run.
- Two different `tookMs` fields exist and mean different things: the snapshot's (the whole collection)
  and `health.tookMs` (the health probe alone).
- **Churn is constant.** Sessions appear and disappear on most collections, so a session vanishing is
  ordinary rather than alarming.

## Re-capturing

The producer is another agent's, and still moving. An earlier capture was **the wrong shape within
ninety minutes** — `meta`, `claudeSessionId`, `panePid`, `schema`, `tmuxServerPid` and `refreshMs` all
landed in between, and those files would have failed the parser they were meant to feed. So: check
`schema` against the live payload before trusting these, and re-capture at the moment you write a
parser rather than before. A test passing against a shape nothing emits any more is a test that has
quietly stopped watching.
