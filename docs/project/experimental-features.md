# Experimental features

One switch on [/profile](reader-profile.md), off by default. Greg, 2026-08-31:

> The idea is that when this is off, it shows just the features that are most valuable/polished
> (which is what we want for most users). When on, it includes extra features that might be still
> under development or not ready for production.

**Five modes are behind it**, since 2026-09-03 — [What is behind it today](#what-is-behind-it-today)
names them. Features go behind it one at a time, each with a reason: the switch and the decision
about which features are unfinished are two separate arguments, and taking them together means
neither gets made properly.

## The four rules

**A signed-out reader is off, because we decided.** Not because the request failed. `GET /api/reader`
sits behind the auth gate ([`src/routes.ts`](../../src/routes.ts)), so an anonymous request is a 401
— and the client used to catch that as a load error and leave `on` at its initial `false`. Right
answer, wrong reasoning ([silent-success.md](../reusable/silent-success.md)): the day the gate moved,
every gated feature would have turned on for strangers with no test saying otherwise. The store now
issues **no request at all** for an anonymous reader, and `tests/public-network-trace.test.tsx` pins
that at zero. Greg, 2026-09-03:

> When a non-logged-in user reads a Public-readable article, I thin it should default to treating
> them as "Experimental Features" = false.

**Off is the default, and off is what a reader who has never seen this page gets.** The column is
`null` for everybody until they say otherwise — with one exception, and it is a development one:
`npm run db:seed-dev` turns it **on** for the seeded local account, so a box or a laptop set up the
documented way is looking at the unfinished features rather than hiding them. That is the whole
audience for a local stack. It uses `writeExperimental` rather than its own SQL, so the `coalesce`
below holds and a second `npm run setup` does not move the date.
[supabase-local.md § A shelf with something on it](supabase-local.md#a-shelf-with-something-on-it).

**Hidden means hidden from the controls, not unreachable.** `?mode=timeline` still works with the
switch off, and the bar draws Timeline's button while the reader is in it, so the radiogroup still
has exactly one checked thing. The switch is about clutter, not enforcement — an old bookmark keeps
working, and a shared URL shows two people **the same band**, whatever their switches say. Their
*bars* differ, which is the whole point: eight buttons for one and thirteen for the other. A gate
that redirected or 404'd would turn a preference into a broken link.

**Hiding never deletes.** Turning the switch off must not remove an artefact, a note or a
generated answer. Whatever the reader made while it was on is still there when it goes back on.

## Where it lives

| | |
|---|---|
| Column | `spideryarn.reader_profiles.experimental_since timestamptz null` — [`drizzle/0037_experimental_features_and_callout_blocks.sql`](../../drizzle/0037_experimental_features_and_callout_blocks.sql) |
| Filesystem | `experimentalSince` in `data/reader.json` — [`src/profile.ts`](../../src/profile.ts) |
| Contract | `readExperimental` / `writeExperimental` on `ReaderStore` — [`src/store/contracts.ts`](../../src/store/contracts.ts) |
| Wire | `experimentalSince` on `GET`/`PATCH /api/reader`; `PATCH` takes `{ experimental: boolean }`, **one field per request** |
| Client | [`experimental-store.ts`](../../src/web/experimental-store.ts) — one module-level store for the whole client, session-bound, read through [`useExperimental`](../../src/web/useExperimental.ts). **All the reasoning lives there**: three states rather than two, one write at a time, the races an account switch opens, and why anonymous asks for nothing |
| Read by | the row in [`SettingsSection.tsx`](../../src/web/SettingsSection.tsx), and the four pages that mount a `Dock` — they call the hook and hand the answer to the bar as a prop ([`Dock.tsx`](../../src/web/Dock.tsx) § experimental) |

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

In the same piece of work:

- **Say so here.** A list of what is currently hidden belongs in this doc, and it is how the next
  person knows what to look for when a reader says a feature has vanished.
- **Leave the route alone.** Gate the control, not the URL — see *Hidden means hidden from the
  controls* above. `MODES` in
  [`src/modes.ts`](../../src/modes.ts) stays as it is; what changes is whether the dock draws the
  button.
- **What happens mid-flight is settled: the reader stays where they are.** Turning the switch off
  while an experimental mode is open leaves that mode open, and leaves its button in the bar — the
  bar draws the non-experimental modes **plus whichever one the URL names**
  ([`Dock.tsx`](../../src/web/Dock.tsx) § `visibleModes`). Falling back to the default mode is
  allowed by this doc and was turned down: staying put is less surprising and costs nothing. A gated
  control that cannot do that — one that would be left in a state it cannot draw — must fall back
  rather than throw.

Nothing on the server reads the switch today. When something needs to — a step that should not run
for most people, say — the value is already where the server can see it, which is half the reason it
is a column rather than something in the browser's `localStorage`.

## What is behind it today

**Five of the thirteen modes**, since 2026-09-03. Greg picked them
([260903c](../plans/260903c-gate-unpolished-modes-behind-experimental-features.md)), and each row is
a required `experimental: boolean` in `MODES_UI` ([`Dock.tsx`](../../src/web/Dock.tsx)), so mode
fourteen cannot be added without somebody deciding which side of the line it is on.

| Mode | Why it is behind the switch |
|---|---|
| [Quotes](quotes.md) | Verification is finished and deliberately narrow — it proves the words are in the piece and **not who wrote them**, which is a real limit a reader meets without being told. And the selection has been calibrated against one article. |
| [Timeline](timeline.md) | Four dating states, and drawing an undated row like a dated one throws away what the article actually said. Ten of twenty-six rows on the test article carry no date. |
| [Referee](referee-mode.md) | **Not because it is unfinished** — its own doc opens by saying all four sub-modes are built and working. It is the newest mode and by far the narrowest: it is for somebody who has been *asked to peer-review* the piece, which most readers never are. Greg's call, and the one row here that is about audience rather than readiness. |
| [Diagram](diagram.md) | Four pictures with different promises — `force`, `drift`, `trail` and `sketch` — and the expensive one is a ~$0.20 sketch that takes two to three minutes. |
| [Remember](remember-mode.md) | The name suggests saved notes and spaced repetition, neither of which exists; the quiz half is newer still. |

**The eight that stay visible**: Plain, Hierarchy, Outline, Summary, Glossary, Ideas, Search, Chat.
Hierarchy and Outline are stand-ins for the merged **Structure** mode
([260903b](../plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md)); when that lands it
takes one default-visible slot and those two go, making it seven of twelve. **Do not write
seven/twelve anywhere before then.**

## See also

- [reader-profile.md](reader-profile.md) — the page this switch is on, and the boxes above it.
- [sql.md](sql.md) — why the column is a nullable timestamp.
- [docs/plans/experimental-features-toggle.md](../plans/experimental-features-toggle.md) — the
  decisions taken when it was built, including the ones that went the other way.
