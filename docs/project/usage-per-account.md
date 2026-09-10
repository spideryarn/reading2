# One section per account-subscription: which login still has room

The **Usage limits** tab has three parts. The top is one section per Claude and Codex
account-subscription on the box — **this doc**. Below it is the deep single-account card, which
carries what the sections cannot; below that is the 24-hour chart,
[usage-history.md](usage-history.md).

Greg, 2026-09-10:

> The Usage Limits page should have sections for each Claude and Codex account-subscription,
> summarising 5d and weekly X% used and when they reset.

The work is [260910c](../plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md)
and GPT Sol's review of it, which changed three things in the design before it was built. The
registry and the per-account launcher underneath it are
[260909g](../plans/260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md)'s.

**Read [usage-history.md](usage-history.md)'s eight rules first.** They govern this half too, and
nothing here restates them.

## Why there are two readings of usage, not one

They answer different questions and are believed on different evidence, and the page draws both.

| | the sections (this doc) | the card below them |
|---|---|---|
| Scope | **every** login on the box | the **one** the Overseer runs on |
| Source | `/api/oauth/usage` and Codex's app-server, live, per account | the `~/.claude.json` cache plus a ~2.9 GB transcript scan |
| Carries | windows: X% used, and when each resets | the same, plus the 429s, the coverage, and the verdict |
| Cost | two HTTPS calls per Claude account, one spawn per Codex account | 30–45 seconds, and it does not always finish |

**The card's half cannot be made per-account, and that is not a gap to close.** A 429 in a transcript
carries no account id at all, and the scan covers days that may span a `/login` swap — so feeding the
one global scan into a per-account verdict would count the same rejection once against every account
on the box. That is rule 4 of the eight, and `AccountUsageSection` has nowhere to put a rejection,
deliberately.

## The shape, and the one decision that shapes the rest

```text
Checkpoint
  usage:        StoredUsage          the ambient account, the scan, the verdict
  accountUsage: StoredAccountUsage   NEW — one live reading per account, windows only
```

**A sibling field, not a field inside `UsageReport`.** `chooseUsage` republishes a *stored* report
whenever a fresh transcript scan comes back incomplete, which it routinely does. Live HTTP readings
riding inside that report would be thrown away by a decision that has nothing to do with them — *a
publication decision is not an observation*, which [usage-history.md](usage-history.md) already names
as a mistake made once here.

No checkpoint schema bump: a reader that ignores the field draws no sections, which is poorer rather
than wrong. `tools/overseer/store.ts` states that rule itself.

Modules: `tools/overseer/account-usage.ts` (the collector and the record's parser),
`tools/fleet/account-usage-feed.ts` (the dashboard's projection),
`tools/fleet/web/src/AccountUsageSections.tsx` (the render), and the wire types in
`tools/fleet/wire.ts`.

## Six things that are not obvious

### `role` and `origin` are two fields, and folding them was a category error

`role` is what the account is **for** — `orchestrator` or `pool`, the registry's own vocabulary.
`origin` is how the box **knows about** it — `registered` or `ambient`.

The first draft made `ambient` a third role. GPT Sol's correction: the ambient login's role *is*
`orchestrator` — it is precisely the account every supervisory model call is spent on — so folding
provenance into the role made *what is this account for* unanswerable for the one account the answer
matters most about.

The distinction is load-bearing rather than tidy: **a registered account's reading was checked
against a recorded provider id before it was published, and an ambient one has nothing to pin it
against.** The two are believed on different evidence, and the page says which is which.

### The ambient login cannot be registered, and still needs a section

The account a process gets when nothing sets `CLAUDE_CONFIG_DIR` / `CODEX_HOME` cannot go in the
registry ([260909g](../plans/260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md)).
It is also the account the Overseer itself runs on — so a page silent about it is silent about every
supervisory call the box makes.

**It is emitted only when no registry entry already covers it.** The daemon may itself be running
routed, and then "the ambient account" *is* a registered one; without the check the page draws it
twice, once labelled ambient and once labelled pool, with two independently-taken readings that will
disagree by a percent or two. Two rows disagreeing about one subscription is worse than either row
alone, because it makes both untrustworthy.

### Directory equality is not subscription equality

`path.resolve` catches two spellings of one path. It does not catch two distinct state directories
holding the same login, a symlinked alias, or an ambient login copied into a registered home — and
because the ambient account is absent from the registry, the registry's own uniqueness rules cannot
catch them either.

So **identity has the last word, after the reads**: two sections in one family whose provider account
ids match *are* one subscription, however they were reached. The registered one is kept, and the
collision is reported as a loud problem, because it means the box thinks it has more headroom than it
has. Sections with **no** established identity are never collapsed — a null id is *nobody proved
whose this is*, and merging two of those invents the fact that is missing.

### `problems` is what stops a SHORT list telling the same lie as an empty one

An empty list would render as *this box has no account-subscriptions*, so `StoredAccountUsage` has a
`none` arm with a reason instead. But a **short** list is the subtler failure: if the registry will
not parse, every registered account vanishes while the ambient ones draw perfectly, and the page then
says *this box has one Claude subscription* with nothing on it to disagree.

`problems` carries faults that belong to no single account. The page draws them above the sections,
under a heading that says the list may be incomplete; `overseer usage` prints them with a `!` and
exits non-zero.

### One Codex reading per pass, fanned to two consumers

The daemon's usage pass already spawns one Codex app-server per tick and stashes the reading for the
history recorder. Collecting it again for the sections would be two spawns every five minutes and —
the part that matters — **two independently-measured numbers for one subscription on one page**, a
point apart, each undermining the other.

So `scripts/overseer.ts` collects it once and hands it to both. `daemon.ts`'s `accounts` hook runs
**strictly after** `run` in the same continuation, which is what makes the stash safe; that holds
only while the daemon refuses to overlap usage passes, which it does by the `usageRunning` guard.

It runs *after* rather than *in parallel* for the ordering, and *unconditionally* rather than inside
the success path for the same reason the field is a sibling: a 2.9 GB walk falling over must not take
down a set of cheap provider calls that have nothing to do with it.

### The page re-derives expiry; it does not inherit it

A five-hour window can reset between the checkpoint being written and the page being looked at, and a
held reading is republished for up to five minutes after that. So the sections reuse
`UsagePanel`'s `WindowStatCard`, whose `windowStat` checks each reset against the **browser's** clock
and draws no percentage for a window that has since reset.

This is the one place a live card and the history chart deliberately differ: history preserves what
was true then, a live card re-derives now. There is no window-drawing code in
`AccountUsageSections.tsx` at all, and that is why.

## "X% used", and only that

Greg, 2026-09-09:

> actually I think it is better to always & only say X% used (and leave it to the user that 100-X% is
> remaining)

This reversed an earlier decision (GPT Sol's S2-01), under which the card headlined `58% left` with
`42% used` beneath it. Two numbers for one fact meant working out which way round they were on every
glance. **The producer's own number is now the headline everywhere on this tab**, and there is no
derived arithmetic on the page — which also disposed of a rounding bug the complement had, where
`100 - 99.99` reached the screen as `0.010000000000005116`.

The five-hour and weekly windows are promoted; anything else — Claude's rotating codename windows,
`NIMBUS_QUILL` and friends — is **collapsed, not filtered**. Rule 6: an unrecognised window is a
named row, and a window nobody can explain is still a limit that can stop work.

## `overseer usage` reads the same collector

The terminal and the dashboard go through one `collectAccountUsage` and therefore one identity pin.
Before 2026-09-10 the CLI looped over the registry with its own comparison, which was a second
implementation of a rule the daemon also held; they would have drifted, and the drift would have
shown as one surface refusing a reading the other drew.

The printed block lists **registered** accounts only, because the ambient login already has the whole
`Claude subscription` block at the top of that output. The page reaches the same rule the other way
round: there, the sections own the percentages and the card below them owns the verdict.

**A broken registry is a non-zero exit, not a thrown command** — changed 2026-09-10. It used to throw
before printing anything, so a stray comma cost you the ambient account's reading too, which needs no
registry to take.

## Not built: per-account history

The 24-hour chart is still single-account, and the page says so under it — naming **no** email,
because a `/login` swap inside the window produces several account uuids across the range and naming
one would be a claim about every plotted series that nothing has checked.

What making it plural needs is in
[260910c § Stage 4](../plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md):
a `SUMMARY_SCHEMA` 2 change to a persisted format, a plural `stashedCodex` in retention, and the
series cut at `usage-history-series.ts:152` — where **alternating one-account records do not work**,
because the plot cuts every series absent from the current record, so an A/B/A/B sequence draws as
disconnected points rather than as two lines. One record must carry all accounts.
