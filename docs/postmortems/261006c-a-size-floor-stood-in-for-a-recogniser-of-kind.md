# A size floor stood in for a recogniser of kind

Up: [postmortems.md](../project/postmortems.md)

hal.science answers our fetch with a bot check, and until 2026-10-06 stage 2 imported that page as
an article titled *"Making sure you're not a bot!"*, with no error. A published article spends the
reader's slot. **Whether any reader actually imported one was not established**: it was found by an
eval, [261005m](../plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md)'s
measurement of paper sources, not by a report. Any site behind the same check (Anubis) did the same.
The fix is [261006c](../plans/261006c-a-bot-check-page-is-refused-by-its-own-markup.md).

## What happened

Stage 2 had two refusals: Readability finds no article, and Readability returns fewer than 500
characters of article text (the capability floor, C1a of
[260904e](../plans/260904e-extraction-repair-evals-and-llm-post-processing.md)). A third had been
designed beside them, C1: a registry that recognises a bot wall by its own markup. On 2026-09-06 the
floor landed and C1 was deferred, on a measurement:

| fixture | the floor refuses it | chars |
|---|---|---|
| `pmc-article` (reCAPTCHA) | yes | 130 |
| `medium-about` (a 404 shell) | yes | 185 |

Both walls in the corpus were short, so the registry *"would change no publish/refuse outcome on any
page we have"*. That was true. HAL's page measures **1,034**: an Anubis check explains itself in
four paragraphs of well-formed prose.

## A check on how much stood in for a check on what

The floor answers *is there enough text to build from*. The question that mattered was *is this the
page the reader asked for*. The two agreed on every wall we had seen, because the walls we had seen
were terse, and that agreement was a property of two fixtures, not of walls.

The floor never claimed otherwise. Its own docstring says **"Not a bot-wall detector"**, its
reader's sentence says *"usually"*, and the doc says it decides nothing about what the page is. Each
of those sentences was correct and none of them refused a page. The product's actual behaviour was
that the only thing between a bot check and a reader's shelf was a character count.

The same shape, one step removed, was sitting in a test:
`tests/extraction-visible-text.test.ts` holds every fixture to 2,000 characters of visible text,
except two named non-articles, on the reasoning that *"their whole point is that they are almost
empty"*. A non-article that is not almost empty went red there the moment its fixture was added.

## Which commit

`ccc147e23` (2026-09-06, *Stage C1a*) introduced the floor and is where a wall first became
something a count refused. `287134c1f` (2026-09-07, *Stage C4a*) is the commit that wrote the
deferral into the plan: *"So C1 does not ship until a long-wall fixture does."*

## Why nothing went red

- **The deferral was right on its evidence.** Building a recogniser whose effect no
  fixture can witness is a thing that plan exists to refuse.
- **The condition for un-deferring was written down and owned by nobody.** The same paragraph says
  *"Getting the fixture is a stage-1 errand — fetch a few known-walled addresses and keep what comes
  back — and it costs far less than the recogniser."* The errand was never run and never queued. A
  month later an unrelated eval tripped over the page.
- **Nothing downstream can tell.** A bot check's prose splits into blocks, summarises and renders
  like any short article. The corpus's `notAnArticle` assertion only covers pages somebody already
  knew were walls.
- **The corpus was the population.** *"Any page we have"* was two pages, both captured the same
  week, and the claim built on them was about the web.

## What would have caught it, ranked by ease against value

1. **When a narrow check is accepted in place of the general one because the two agree on today's
   data, the errand that would separate them is queued in the same commit.** Not written as a
   sentence in the plan: an item somebody will pick up. Here it was fetching a few known walled
   addresses, which the plan itself called far cheaper than the recogniser. Free, and it is the one
   that addresses the class. **Not done for the entries still missing**: see item 6.
2. **A fixture for the thing the narrow check does *not* cover, sought on purpose.** The floor's
   tests pin it from above with a real 749-character page so nobody raises it. Nothing pinned the
   other direction — a non-article above the floor — because none was to hand. `hal_anubis.html` is
   that fixture now, and `tests/extract-challenge-page.test.ts` holds its counterfactual: the same
   bytes less one element are published. Done.
3. **An eval that reads titles.** What actually caught it: a person reading
   `evals/results/paper-sources-261005/summary.md` and seeing an article called *"Making sure you're
   not a bot!"*. Cheap wherever an eval already imports real addresses; it is luck, not a guard.
4. Raising the floor — rejected. At 1,034 characters it refuses genuine short pages, and the next
   check will be longer. It is the same substitution again.
5. Matching the title or the page's wording — rejected in 260904e with a real page behind the
   argument: `acx.html` says *"just a moment"* twice.
6. Recognising every known check up front (Cloudflare, reCAPTCHA, the *"enable JavaScript"* shells)
   — rejected. All are refused by the floor today, and an entry without a captured page is a guess
   about somebody else's markup. This knowingly leaves the class open for each of them: the first
   one seen to clear the floor is published until somebody notices. Nothing tracks that yet. The errand in item 1 is the
   countermeasure and it is still unqueued as this is written, which is the state this postmortem
   is about.

## The fix that is right for the long term

What shipped is the design that was deferred: a registry keyed on markup the check's own software
writes ([`src/challenge-page.ts`](../../src/challenge-page.ts)), one entry, a typed refusal that
outranks the other two, and a sentence that tells the reader what works. That is the right shape and
it is not complete: it recognises one provider. The long-term fix for *"we published a page that is
not what the reader asked for"* is partly in stage 1, which could know a challenge from the response
before any bytes are stored, and none of that is built.

## The thing I would tell myself

When I write *"this changes no outcome on any page we have"*, I am describing my fixtures. If the
reason two checks agree is that I have only two examples, the cheaper check is carrying a claim it
was never built to make, and the honest next step is to go and look for the example that separates
them, not to write down that somebody should.
