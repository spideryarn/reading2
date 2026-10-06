# A recogniser fitted to one sample of a versioned page

Up: [postmortems.md](../project/postmortems.md)

bugs.winehq.org answers our fetch with an Anubis bot check, and stage 2 read it as an article of
1,106 characters titled *"Making sure you're not a bot!"*. This was hours after
[261006c](../plans/261006c-a-bot-check-page-is-refused-by-its-own-markup.md) had added a recogniser
for exactly that provider. **Whether any reader imported one was not established**: it was found by
[a measurement](../investigations/261006c-which-bot-check-walls-clear-the-floor-through-our-fetcher.md),
not by a report. The fix is
[261006f](../plans/261006f-other-bot-check-walls-that-clear-the-floor.md).

## What happened

[`src/challenge-page.ts`](../../src/challenge-page.ts) recognised Anubis by one element,
`<script id="anubis_challenge" type="application/json">`, holding the challenge the page sets. That
is what hal.science's page carries, and hal.science's page was the only one captured.

That single-shape entry was introduced in commit `677404435` on 2026-10-06.

WineHQ runs Anubis v1.15. That version's script fetches the challenge from the server once it is
running, so the page has no such element. The entry returned false and the page went on to
Readability like any other.

The measurement fetched 109 walled addresses. Nine answered with an Anubis page: eight on v1.26,
v1.27 or `devel`, all recognised, and this one.

## A recogniser fitted to a single sample of a third party's versioned output

The entry was a description of one page. It was treated as a description of a provider. Anubis is
software that sites install and upgrade when they choose to, so at any moment several versions of
its page are being served, and one capture says what one of them looks like.

The rule the registry sets itself is that an entry is written from a captured page, not guessed.
That rule is right and it is what produced the gap: it was satisfied by a sample of one.

No second instance was looked for outside this file. The registry has one entry, so there is no
sibling inside it.

## Why nothing went red

- **Every test used the one fixture.** The rungs, the counterfactual and the harness all read
  `hal_anubis.html`. The negative controls were synthetic pages built from the same element. Nothing
  in the suite was a second real Anubis page.
- **The counterfactual asserted the gap and called it a strength.** It removed `anubis_challenge`
  from HAL's bytes, checked that `anubis_version` was still there, and expected an article: *"it is
  this one, not the family, that the entry reads"*. A page with the version element and no challenge
  element is what v1.15 serves.
- **The plan review did not raise it.** It was asked whether the element was conclusive for the page
  in hand, and it is.

## What would have caught it, ranked by ease against value

1. **Fetch several sites that run the provider before writing its entry.** One script, about a
   hundred requests, no model call. It found the gap the same day. Done:
   [`scripts/probes/261006f-bot-wall-probe.ts`](../../scripts/probes/261006f-bot-wall-probe.ts).
2. **An entry says which versions it was captured from, and which were not seen.** Costs a
   sentence, and tells the next reader how far to trust a miss. Done, in the docstrings: v1.15, and
   v1.26 to `devel`; nothing between.
3. **Read the provider's source for every template it has shipped.** Not done. Anubis is open
   source, so this would turn two captured shapes into a known list. It is the cheapest next step
   if a third shape turns up.
4. Re-run the probe on a schedule — rejected. There is no scheduler
   ([cron-scheduler.md](../project/cron-scheduler.md)), and a wall changing its page is rare enough
   that a reader's report will arrive first.
5. Recognise the page by its title or its sentences, which every version shares — rejected. Visible
   wording is what an article about these checks quotes, and a wrong match refuses a real article.

## The fix that is right for the long term

What shipped: the entry reads two shapes, each with its captured page as a fixture, and each proved
required by removing it. The second shape (the version element together with the module script that
solves the check) is on every Anubis page seen, old and new.

**Part of the class is still open.** Versions between v1.15 and v1.26 were not captured, and a
future version can change the page again. Nothing checks for that. It is written down in
`src/challenge-page.ts` and in the investigation, and a sentence is not a check. Item 3 above is
what would close most of it.

## The thing I would tell myself

A fixture is one sample. Before writing a rule about somebody else's software from it, spend ten
minutes finding out how many versions of that software are in service, and fetch a few. The page in
front of you is the newest one somebody happened to hit, not the page.
