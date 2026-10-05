# Three robustness bugs: unknown wire values, a root with no children list, the chain timer

Up: [plans.md](../project/plans.md).

Three independent queue items, dispatched by the Overseer on 2026-10-05 under Greg's standing rule
(2026-10-04: *"if you see bugs, fix them without asking me"*). One stage and one commit per item, so
any one can land without the others. No paid model call is needed by any of them.

Done, for every stage: a failing test seen red first, `npm test` and `npm run typecheck` green, a
GPT Sol code review, and for anything a reader sees a browser check at desktop, iPad and phone widths.

## Stage A — `qi-nvwsgw8y`: an old app copy meeting a value it was built before

**The defect.** A copy of the app opened from a home-screen icon outlives several deploys. When the
server sends an enum value that copy has no table entry for, a bare `TABLE[value]` answers
`undefined`; when the value is an inherited name (`__proto__`, `constructor`, `toString`) it answers
an object or a function. The Metadata crash (`SPIDERYARN-READING2-BJ`, `-CB`) was this shape and was
fixed in `87f756f1e` with an own-key lookup and a neutral glyph (`src/web/Metadata.tsx` §
`stageIcon`). GPT Sol's F20 in
[the review of that work](261005d-notice-a-deploy-on-wake-code-review-sol.md) lists six more sites.

What each does today, as read (to be confirmed red, not assumed):

| Site | Lookup | Unknown value today |
|---|---|---|
| `SourceScanNotice.tsx` | `KIND_LABEL[kind]`, `ORDINARY_LABEL[ordinary]`, `BLIND_SPOT_LABEL[spot]` | empty label; the blind-spot list joins the word "undefined" into a sentence |
| `MirrorPanel.tsx` | `KIND_LABEL[remark.kind]` | empty badge |
| `CriteriaPanel.tsx` | `KIND_LABEL[row.config.kind]` | empty line |
| `marginalia/MarginaliaColumn.tsx` | `RELATION_WORD[relation]`, `PROVENANCE_TIP[provenance]` (four uses) | empty stamp or tip |
| `ProfilePage.tsx` | `PROVIDER_LABEL[m.provider] ?? m.provider`, `WIRE_LABEL[...] ?? ...` | already falls back to the raw value; only an inherited name defeats it |
| `live/gpt-live/useGptLive.ts` | `CLOSED_SENTENCE[reason] ?? CLOSED_OTHER` | already falls back; an inherited name hands `setError` a non-string |

An honest note on severity: React draws `undefined` as nothing, so most of these are a missing
label rather than a crash. What does throw is an object reaching React as a child (`__proto__`), and
what silently lies is `"undefined"` joined into prose. The queue item says "can crash"; the tests
will say which sites really do.

**The fix.** One small shared helper in `src/web/lib/` — an own-key lookup,
`ownLabel(table, key): T | undefined` — used by all six sites and by `stageIcon`, so there is one
way to read a table by a wire value. Each site names its own fallback:

- a kind / relation badge: the server's value in plain words (hyphens to spaces), so a new kind
  reads as itself rather than as a blank;
- a tooltip sentence or explanation (`PROVENANCE_TIP`, `ORDINARY_LABEL`): omitted, not invented;
- the blind-spot list: the raw value in plain words, never the word "undefined", and never dropped
  — a dropped blind spot would read as *we looked at everything*, which is the claim that list
  exists to prevent;
- `CLOSED_SENTENCE`: `CLOSED_OTHER`, as now.

Tests: one per site, each rendering (or calling) with a value outside the table and with
`__proto__`, seen red against today's code where today's code is wrong, plus a known-value control.

**Simpler option passed over:** `?? fallback` at each site with no helper. It leaves the inherited
names broken, which is the half that actually throws.

**Also in this stage: the temml import.** `src/web/maths.ts` § `loadTemml` fetches temml on demand.
After a deploy the old copy asks for a chunk that no longer exists, the import rejects,
`renderArticleMaths` catches it and the reader sees raw TeX with nothing said and nothing tried.
The recovery already exists for the two lazy routes: `src/web/stale-shell.ts` § `reloadIfStale`
asks whether a different build is live, reloads at most once per build per session, and declines
when the reader has unsent words. So: when the **default** loader rejects, call `reloadIfStale()`
(not awaited, its own failure swallowed) and return the article as today. A different build live ⇒
one reload and the maths draws; same build, offline, or a draft in hand ⇒ exactly today's
behaviour. An injected `load` (tests) does not trigger it unless the test asks.

What a reader sees: an article with formulae, opened in an old copy, reloads once instead of
showing raw TeX. That is the behaviour `/admin` and `/design` already have.

**Not doing:** retrying the import in place. A missing chunk stays missing; only a new shell knows
the new chunk's name.

## Stage B — `qi-gwnd4skg`: a stored tree whose root has no `children`

**The defect.** `src/web/tree.ts` § `buildChains` does `node.children.map(...)`. The type says
`children: NodeId[]`, but the tree is stored JSON and the type is a claim about it, not a check. A
root (or any node) with no `children` key throws and takes the reading view down. No producer
writes one today; long-documents stage D/E added a new producer, which is why this is worth an hour.

**The fix.** Guard where the stored tree is walked on the client: `buildChains`, and the two other
walkers in the same file that read `node.children` unguarded (`buildOutline` guards only the root;
`buildSummaryTree` guards nothing). A node with no list is a leaf. Then find what else the reading
view calls on the way to first paint with the same tree (`supplementIndex` is called from
`buildGeometry`) and make sure the fixed walk does not just move the crash one call down: the done
criterion is that the reading view's geometry, outline and summary tree all build from such a tree,
not that one line stopped throwing.

Tests, red first: `buildGeometry`, `buildOutline` and `buildSummaryTree` on a tree whose root has
no `children`, and on one where an inner node has none.

**Options passed over.** *Make the type forbid it* — it already does, and the type cannot see
JSON. *Normalise the tree once at the client's door* — covers every walker at once, and is the
better long-term shape if there turns out to be one door; the implementer reports how many doors
there are and whether other client walkers crash on the same input, and that is a follow-up to
report, not part of this stage. *Reject at the server* — `validate-tree.ts` is the place that
complains properly, and a reading view that draws a short tree is better than one that draws
nothing.

## Stage C — `qi-wbte273v`: the chain timer

**The defect.** ↑ / ↓ (`src/web/keynav.ts`) and the Diagram's Previous / Next
(`src/web/DiagramPanel.tsx`) step from *the row the last press aimed at* rather than from a
measurement, because a press mid-glide would measure a row half way. They believe that aim for
`CHAIN_MS` (600 ms: the 200 ms glide "plus a margin") and then measure again. The timer is a
`setTimeout` and the glide is `requestAnimationFrame`; under a long render the glide can still be
pending when the timer fires, the next press measures mid-air, and Next repeats the target it has
just used. GPT Sol reproduced it in a controlled test (261005c code review, C3). The class is the
one in [the postmortem](../postmortems/261005d-whose-scroll-was-that-decided-by-a-clock.md):
a clock standing in for a fact the code could read.

**Measure first.** A Sonnet subagent with Playwright, on a long article and a short one, at
desktop, iPad and phone widths, with and without CPU throttling: press Next (and ↓) twice at
several gaps around 600 ms and count how often the second press repeats the first target. The
numbers go in this doc. If it never happens in a browser the fix still lands (the fact is cheaper
than the clock), but the debrief says so.

**The fix: ask whether our jump has ended, rather than how long ago it began.** `scrollToBlock`
already tells its caller how a jump ends (`done(outcome)`: settled, cancelled or missing), and a
newer jump cancels the older one through the same call. So:

- `keynav.ts`: the chain is set on the press and cleared by that jump's own `done`, guarded by a
  per-press token so that the cancel a second press causes does not clear the second press's chain.
  The timer and `CHAIN_MS` go. The reader taking the page back (`wheel`, `pointerdown`) still drops
  it, as now.
- `DiagramPanel.tsx`: the same rule. Its jump goes out through the `onFollow` prop, which does not
  hand back an ending today. The implementer traces `onFollow` to where it reaches `scrollToBlock`
  and picks the smaller of: (a) passing a `done` through; (b) reading `glideTarget()` at press
  time, if and only if the glide is started synchronously inside `onFollow` (otherwise there is a
  gap before the glide begins, which is this bug again). The existing outside-gesture drop stays.

After a jump settles the page is where it will be, and `measureRow()` is a synchronous layout read
that already honours a centred arrival's anchor, so measuring afresh is right. The Diagram's 2026-08-31
comment says `glideTarget()` was tried and left "a gap where nothing is in flight and the
measurement is still mid-air"; as read today that gap should not exist for a layout read, but that
is a reading, so the implementer proves or refutes it with a test before deleting the comment.

**One edge to decide, named here so it is not inherited.** A target the page cannot reach (the last
rows of the article, where the scroll is clamped) never arrives at the reading line. Today a second
press inside 600 ms still steps on from the aim; with the timer gone it would measure and repeat.
Nothing moves either way for ↓, but ↑ straight after differs. Proposed: keep the aim after a
*settled* jump until the page next moves to a pixel that is not ours — the same fact the arrival
anchor uses — only if a test shows the edge is real; otherwise clear on `done` and say so.

Tests, red first: Sol's C3 shape for both callers (the glide's frames held back past 600 ms, a
second press, two distinct targets expected), and the existing chain tests kept. The test that
asserts "measures the world again once the chain has expired" by waiting `CHAIN_MS` is rewritten to
wait for the jump's end instead: it was the clock, written down as the requirement.

**Simpler option passed over:** a bigger `CHAIN_MS`. It goes green on any test with a large enough
number and loses on a longer book, which is what the postmortem says about its sibling.

## Progress

Nothing built yet.
