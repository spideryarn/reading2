---
reports: spya-nca765
ending: shipped
---
# Citations spends too much height on its count and its foot note

Feedback row `spya-nca765` (2026-09-30 01:56 UTC), from Greg (admin), in production, build
`f9ac22eb`, in Citations on `dongetal25-spya-vfmvmm`. No Sentry issue: the row was never mirrored,
so there is no status to write.

> In citations mode, we use up quite a lot of vertical space with stuff that we might not need. So,
> for example, it says at the top how many works there are. I feel like that's maybe there's a more
> space-efficient way to say that. And at the bottom, there's an explanation of what citations mode
> is, and that could be inside an information icon tooltip, etc.

**Ending: Shipped** — on `dev`, not deployed (`b41bd6c3`, review fixes in `d1e16d76`).

What we did: the "N works" head row is gone whenever the order row is drawn; the count sits at that
row's right-hand end, and only outside *prioritised*, whose threshold row already says "n of m". The
two sentences that were the foot (influence is the model's memory; the list was capped, when it
was) are behind an (i) at the same end, the component FAQ already used, now shared as `BandAbout`.
The foot is left for a running or failed job only. On a landscape iPhone that is about 100px more
list.
[261001l](../plans/261001l-compact-quotes-and-citations-band-tops-and-click-a-diagram-to-enlarge.md).
