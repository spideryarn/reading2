# Real fleet snapshots, for the Overseer's diff logic

Captured from the live dashboard on **2026-09-08, 02:39–02:53 UTC** — 15 polls of
`GET http://127.0.0.1:8787/api/state` at 35-second intervals, yielding 8 distinct collections. A
second capture on **2026-09-08, 05:43–05:49 UTC** added the `waiting-*` pair. Every field of every
row kept **verbatim**; the only edit is that each snapshot is trimmed to 6 sessions, chosen to
include the ones the pair is about.

**Why real ones.** A hand-written fixture agrees with whatever its author imagined. These do not: see
the surprises below, several of which contradict what a plausible fixture would have said.

## The pairs

| pair | what it is |
|---|---|
| `status-change-{before,after}` | `$1991` goes `idle` → `working` |
| `session-gone-{before,after}` | `$2225` present in the first, absent in the second |
| `session-new-{before,after}` | `$2243` absent in the first, present in the second |
| `duplicate-{first,second}` | **two different polls that returned the same collection** — identical `collectedAt`, byte-identical payload |
| `waiting-{first,second}` | **three sessions counting down, across a MISSED collection** — 129.937 s apart rather than the usual 65 s |

The `waiting` pair is the second capture, and the missed collection in the middle of it is the point
rather than an accident. The tempting theory about `waiting.secondsLeft` is that collection jitter
makes an implied deadline (`collectedAt + secondsLeft`) wobble, so anything comparing deadlines needs
a tolerance the size of a collection interval. **It does not wobble.** Measured over six consecutive
collections, three waiting sessions each: the implied deadline is stable to **72 ms**, and it does
not move when the interval doubles — because the producer derives `secondsLeft` from a real deadline,
so both halves of the sum move together. That is what sizes `WAIT_DEADLINE_TOLERANCE_MS` in
`tools/overseer/diff.ts` at ten seconds rather than two minutes, and
`tests/overseer-diff.test.ts` re-measures it from these two files so the claim goes red rather than
stale if the producer ever changes.

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
- **A session that starts and ends between two collections is in neither of them.** No pure differ can
  record it — there is no evidence in the payloads to derive an event from — so the history is silent
  about it, and that silence is indistinguishable from nothing having happened. The window is one
  collection interval, about 65 s. Stated because absence is invisible: these files cannot exercise
  it, no test can fail for it, and the only fixes are outside the differ (a shorter interval, or the
  producer reporting what it saw between collections). GPT Sol's S2-08, 2026-09-08; the same note is
  on `diff()` in `tools/overseer/diff.ts`.
- ~~**No `waiting` status in the trimmed files**~~ — **fixed on 2026-09-08** by the `waiting-*` pair
  above, and worth keeping as a record of how the gap felt from inside. The original eight files held
  only `idle`, `working`, `needs-you` and `shell`, none of which has a volatile field, so **the noise
  these fixtures exist to warn about could not be reproduced from them** — a differ that compared
  whole status objects structurally passed every real pair. The 51-versus-2 measurement below was
  summed over the *untrimmed* capture, which is why it did not catch this. Found while writing S2's
  tests; the second capture was taken when S2-03 needed a real countdown to size a tolerance against.
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
- Collection runs about every **65 s**, not the 60 s `refreshMs` advertises — it chains from the end
  of each run. The first capture's runs took 5.7–11.0 s and it looked like ~70 s; the second
  capture's took 3.81–3.90 s and the interval was 65.0 s and very regular, so the excess is the run
  duration rather than jitter. **Collections do get missed**: the `waiting-*` pair is 129.9 s apart.
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

**It has now happened three times, and the third one is the reassuring kind.** The `waiting-*` pair,
captured six hours after the other eight, carries a top-level `answeringEnabled` the earlier files do
not — added without a `schema` bump, correctly, since a consumer that ignores it is not wrong. Both
generations of file parse, which is the evidence that the rule works: `parseObservation` reads the
fields it names and does not refuse a payload for carrying one it has never heard of, so an ADDED
field costs nothing while a removed or redefined one still has to move `schema`. So the drift to
watch for is not "a new key appeared" — it is the number at the top of the payload.
