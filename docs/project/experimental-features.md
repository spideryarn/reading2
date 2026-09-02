# Experimental features

One switch on [/profile](reader-profile.md), off by default. Greg, 2026-08-31:

> The idea is that when this is off, it shows just the features that are most valuable/polished
> (which is what we want for most users). When on, it includes extra features that might be still
> under development or not ready for production.

**Nothing is behind it yet.** That is deliberate: the switch and the decision about which features
are unfinished are two separate arguments, and taking them together means neither gets made
properly. Features go behind it one at a time, each with a reason.

## The three rules

**Off is the default, and off is what a reader who has never seen this page gets.** The column is
`null` for everybody until they say otherwise — with one exception, and it is a development one:
`npm run db:seed-dev` turns it **on** for the seeded local account, so a box or a laptop set up the
documented way is looking at the unfinished features rather than hiding them. That is the whole
audience for a local stack. It uses `writeExperimental` rather than its own SQL, so the `coalesce`
below holds and a second `npm run setup` does not move the date.
[supabase-local.md § A shelf with something on it](supabase-local.md#a-shelf-with-something-on-it).

**Hidden means hidden from the controls, not unreachable.** `?mode=outline` still works with the
switch off. The switch is about clutter, not enforcement — an old bookmark keeps working, and a
shared URL behaves the same for two people whose switches differ. A gate that redirected or 404'd
would turn a preference into a broken link.

**Hiding never deletes.** Turning the switch off must not remove an artefact, a note or a
generated answer. Whatever the reader made while it was on is still there when it goes back on.

## Where it lives

| | |
|---|---|
| Column | `spideryarn.reader_profiles.experimental_since timestamptz null` — `drizzle/0032_experimental_features.sql` |
| Filesystem | `experimentalSince` in `data/reader.json` — [`src/profile.ts`](../../src/profile.ts) |
| Contract | `readExperimental` / `writeExperimental` on `ReaderStore` — [`src/store/contracts.ts`](../../src/store/contracts.ts) |
| Wire | `experimentalSince` on `GET`/`PATCH /api/reader`; `PATCH` takes `{ experimental: boolean }`, **one field per request** |
| Client | [`useExperimental`](../../src/web/useExperimental.ts), and the row in [`SettingsSection.tsx`](../../src/web/SettingsSection.tsx) |

**A date, not a boolean**, and [sql.md](sql.md#a-nullable-timestamp-says-more-than-a-boolean) has the
general form of that argument: `null` is off, a timestamp is on-since-then, the same storage carries
more of the truth, and no existing row needs backfilling. Turning it on when it is already on does
**not** move the date — otherwise the value means "when did the client last send true" rather than
"since when", which is the one question it exists to answer.

**One field on the wire.** The server sends the date and the client derives the boolean. A boolean
sent beside the date would be two spellings of one fact, free to drift, and the one that drifted
would be the one a feature gate believed. A response that does not mention `experimentalSince` at
all is an **error** in the client, not an "off" — that is the same defect one level down.

**One change per `PATCH`.** A body naming both `profile` and `experimental` is a 400: they are two
store operations with no transaction across them, so a combined request could commit the profile,
fail on the switch, and answer with an error. Nothing sends both today. If something needs to, the
fix is one store operation that patches both — a single queued merge on the filesystem, a single
upsert in Postgres.

**Three states in the client, not two.** On, off, and *we have not read it yet* — the checkbox stays
disabled until the server answers, while a save is in flight, and when what is on screen came out of
the offline cache. Each of those is a state where a press would write a value nobody chose:
[`useExperimental`](../../src/web/useExperimental.ts) has the reasoning, and GPT Sol's review
(2026-08-31, in `docs/plans/`) is where two of the three came from.

## Putting a feature behind it

```tsx
const { on } = useExperimental();
if (!on) return null;          // …or leave the button out of the row
```

**Before the first gate, give the answer one home.** `apiFetch` has an offline cache, not an
in-flight one, so today every component calling `useExperimental` makes its own `GET /api/reader` and
keeps its own copy of the answer. That is fine for one settings row and wrong for a dozen gated
controls, which would also disagree with each other for the length of a toggle. A provider or a small
shared store is the fix, and it belongs in the same piece of work as the first real gate.

Then, in the same piece of work:

- **Say so here.** A list of what is currently hidden belongs in this doc, and it is how the next
  person knows what to look for when a reader says a feature has vanished.
- **Leave the route alone.** Gate the control, not the URL — see the second rule above. `MODES` in
  [`src/modes.ts`](../../src/modes.ts) stays as it is; what changes is whether the dock draws the
  button.
- **Check what happens mid-flight.** A reader can turn the switch off while an experimental panel is
  open. Falling back to the default mode is fine; throwing is not.

Nothing on the server reads the switch today. When something needs to — a step that should not run
for most people, say — the value is already where the server can see it, which is half the reason it
is a column rather than something in the browser's `localStorage`.

## What is behind it today

Nothing. When the first feature goes behind it, list it here with a line on why it is not ready.

## See also

- [reader-profile.md](reader-profile.md) — the page this switch is on, and the boxes above it.
- [sql.md](sql.md) — why the column is a nullable timestamp.
- [docs/plans/experimental-features-toggle.md](../plans/experimental-features-toggle.md) — the
  decisions taken when it was built, including the ones that went the other way.
