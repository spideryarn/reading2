# "Go round again — More" was one button doing two things

[SPIDERYARN-READING2-4N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4N) (2026-09-29
00:58 UTC), from an admin (Greg), in production, build `cba650a3`, in Trajectory at *More* on
`arxiv-2212-spya-u5293w` (overseer queue `qi-hmsgxajb`, batched with 4D, 4K and 4M).

> In Trajectory mode, the "Go round again - More" button is confusing. I think it should perhaps be
> two separate buttons: - "Go round again", i.e. first step at this level of granularity - "More
> detail" (if there is a higher level), and then go to the first step of the next-higher-level of
> granularity

**Ending: Shipped** — on `dev`, not deployed. Resolve 4N (this session runs on the pool account,
with no Sentry sign-in, so the next feedback sweep does the status write).

What we did, as you described it: at the end of a pass the door after the last stop is now two
buttons, **Go round again** (stop 1 of the same pass) and **More detail ›** (stop 1 of the next
deeper pass, shown only when there is one), with *End of Gist — 5 stops.* under them. The end of
*Most*, which used to have no door at all, now offers going round again.

One thing changed that you did not ask for, named so you can say no: the **Gist · More · Most
buttons** at the top of the band used to go round again too, if you pressed a deeper one while on
the last stop. Now that the door says "go round" out loud, that hidden rule would have been a second
meaning for one button, so a depth button now always keeps your place.

Plan: [260929a](../plans/260929a-trajectory-opens-on-stop-one-two-end-of-pass-doors-centred-jumps-compact-position.md) § 2.
