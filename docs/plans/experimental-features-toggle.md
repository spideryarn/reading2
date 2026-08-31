# A Settings section on /profile, and one switch in it

**Status:** built 2026-08-31.

Greg, 2026-08-31:

> Add a Settings section to /profile, with a toggle (and explanatory tooltip) for 'Experimental
> features' (default false) … when this is off, it shows just the features that are most
> valuable/polished (which is what we want for most users). When on, it includes extra features that
> might be still under development or not ready for production.

Three decisions were his, taken before any of this was written:

1. **In the database, as a proper column** — not a JSON blob, and not `localStorage`:

   > Yes in the database in the user profile row, but not in json, I'd prefer to use a proper field,
   > perhaps a nullable date-time, where null (default) means false, and we store the date when it
   > was set if true. Make a note in sql.md … that we prefer to maintain referential integrity and
   > get the database to do as much work for us as possible (foreign keys and proper fields rather
   > than json and nullable date-time over boolean for the extra information).

   That note is [sql.md](../project/sql.md), new, signposted from
   [database.md](../project/database.md).

2. **The mechanism only. Nothing is gated yet.** The switch ships with no features behind it, and
   each one goes behind it deliberately, one at a time. Shipping the switch and a list of
   already-hidden features in one move would mean deciding what is "not ready" in the same breath as
   deciding how hiding works, and only one of those is a mechanism.

3. **Hidden means hidden from the controls, not unreachable.** `?mode=outline` still works with the
   switch off. The switch is about clutter, not enforcement — an old bookmark keeps working, and a
   shared URL behaves the same for two people whose switches differ.

## What was built

**The column.** `spideryarn.reader_profiles.experimental_since timestamptz null`
(`drizzle/0032_experimental_features.sql`). Null is off, and it is the default, so no existing row
needs touching. A timestamp is on, *and* says when it was switched on — the extra information a
boolean would have thrown away, for the same storage. See [sql.md](../project/sql.md).

**Turning it on twice does not move the date.** The upsert writes
`coalesce(reader_profiles.experimental_since, now())`, so the value answers "since when" rather than
"when did the client last send true". Off writes `null` outright, so on-off-on is a new date, which
is the honest answer: the first spell ended.

**One field on the wire, not two.** `GET /api/reader` and `PATCH /api/reader` carry
`experimentalSince: string | null`; the client derives the boolean. A boolean *and* a date on the
same response would be two spellings of one fact, free to disagree.

**`PATCH` now returns both fields, always.** It used to answer `{ profile }`; it answers
`{ profile, experimentalSince }` whichever of the two the body changed. A response shape that varies
with the request is the one that gets read as "the other field is unset".

**The filesystem store keeps the same fact in `data/reader.json`** as an ISO string under
`experimentalSince`. Greg's "not in json" is about the database; the local store *is* a JSON file,
and giving this one field a second home would have been a second answer to "is it on".

## What was deliberately not built

- **No settings table.** One nullable column on the row that already exists, versus a table, a
  foreign key and a join for one boolean. Revisit at three or four settings, not at one.
- **No `localStorage` cache in front of it.** The switch is fetched with the rest of `/api/reader`,
  and reads false until it answers. A cached first paint would be a second copy of the value, and
  the failure mode is a reader who sees experimental features for one frame after turning them off.
- **No server-side gating.** Nothing on the server reads this yet. When something does, the column
  is already where the server can see it — which is half of why it is not in `localStorage`.

## What the review changed

[The built code went to GPT Sol](experimental-features-toggle-review-sol.md) before it landed, which
is the rule in AGENTS.md, and it earned its keep. Six of its findings were acted on:

1. **Two rapid toggles could leave the switch showing the opposite of the database.** Two `PATCH`es
   are two requests and the server applies them in the order they arrive; ordering the *responses*
   cannot undo that. Fixed by allowing one write in flight at a time, with a test that holds both
   requests open and was confirmed red without the guard. This was the one real bug.
2. **A combined `PATCH` was two writes with no transaction.** Now refused with a 400 until something
   actually needs it.
3. **`now()` is the transaction's start time**, so an "on" that waited on the row lock held by an
   "off" would stamp itself *before* that "off" committed. `clock_timestamp()` where a new date is
   minted; `coalesce` unchanged.
4. **An offline cached answer was treated as current.** `apiFetch` marks it with a header; the switch
   now shows it as the last known value and stays disabled.
5. **A response with no `experimentalSince` in it read as "off".** It is an error now — the
   variable-shape defect the route refuses to commit, committed by the client instead.
6. **A failed load said "Not saved"**, which is a sentence about a save nobody attempted, and left a
   dead control. Load and save errors are separate, and a failed load offers another go.

Two more were wording rather than behaviour: this repo's `useExperimental` does **not** share a
request with `useHasProfile` (`apiFetch` caches offline, it does not memoise in flight), and a
`boolean not null default false` would not have rewritten the table either — Postgres has stored a
constant default as metadata since 11. Both were overstated in the comments and are corrected.

Sol also confirmed the parts most likely to be wrong: the schema-qualified column reference inside
`DO UPDATE` names the existing row and is right; the filesystem queue, merge and atomic rename are
correct; `localStorage` would have been the wrong home.

## How to put a feature behind it

[experimental-features.md](../project/experimental-features.md) is the operating manual, and it is
the doc to update when the first feature actually goes behind the switch.
