---
reports: spya-vafkvw
ending: shipped
---
# A jump should put what it links to in the middle of the page

[SPIDERYARN-READING2-4M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4M) (2026-09-29
00:55 UTC), from an admin (Greg), in production, build `cba650a3`, in Trajectory on
`arxiv-2212-spya-u5293w` (overseer queue `qi-hmsgxajb`, batched with 4D, 4K and 4N).

> In the Trajectory mode (and anywhere else that a block-link triggers a jump to the appropriate
> place in the text), perhaps the linked-to block should be vertically-centred on the page so it's
> easy to see its context.

**Ending: Shipped** — on `dev`, not deployed. Resolve 4M (this session runs on the pool account,
with no Sentry sign-in, so the next feedback sweep does the status write).

What we did: **every jump now lands centred** — every block link in every mode (they all go through
one function), and every Trajectory arrival. When the jump is to a quote, it is the quote that is
centred, not its whole paragraph, so a quote at the bottom of a long paragraph still lands in the
middle. A paragraph taller than the window goes to the top as before, because centring it would
show its middle and hide its start. Stepping with ↑ / ↓, and restoring a position (reload, Back, the
chip), still put things at the top: those are reading down the page, not jumping to a place.

The part that took the work: the app decides "where you are" from a line just under the top bar, and
a centred paragraph's top sits below that line — so the address, the next "Back to …" chip and the
arrow keys would all have said you were in the paragraph *above*. A centred arrival now counts as
where you are until you scroll. GPT Sol's review of the plan is what caught that.

Plan: [260929a](../plans/260929a-trajectory-opens-on-stop-one-two-end-of-pass-doors-centred-jumps-compact-position.md) § 3;
the rule is written down in [url-state.md](../project/url-state.md) § A jump lands centred.
