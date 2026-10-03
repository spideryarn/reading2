# Authors: outside links to find more about each

Greg, 2026-09-12, from the Feedback button on the Entropy paper (report `spya-uvxq8e`, Overseer
queue `qi-kd4rqz9p`):

> Perhaps the newly proposed citations mode, when it runs, should also separately highlight
> information about the authors themselves. Don't know what that would look like. Maybe at the very
> least, just kind of indicate the authors, their affiliations if available, and provide, like,
> something I could click on or expand that would take me to the top few links for them.

## What is already there

[260929d](260929d-authors-and-affiliations-at-import-shown-and-linked.md) (commit `3f172e525`), for a
later report, did most of it: a newly imported or reset article whose source declares its authors (a
scholarly page's tags, or a PDF front page the checked extraction accepts) keeps `meta.authors`, each
with its affiliations. The masthead shows the names on every page and in every mode, each with a card of
its affiliations, and the Metadata page has an Authors section. A click on a name opens **the shelf**
searched for that name.

**What is missing is the last clause.** "Take me to the top few links for them" means links off the
site. Nothing about an author leads outside Spideryarn today.

## What this does

Each author gets **two outside links, both of them searches**. Neither is a guessed address:

- **Google Scholar**: `https://scholar.google.com/scholar?q=author:"<name>"`. This lists their papers,
  and if they have a public Scholar profile that matches, Scholar may show it first ("User profiles
  for …"). We
  already send cited works to Scholar (`scholarUrl`, src/citations.ts).
- **The web**: `https://www.google.com/search?q="<name>" <first affiliation>`. The affiliation is the
  cheapest way to tell this person from someone else with the same name, so it goes in unquoted
  (it is a hint, not a requirement). With no affiliation, the name alone is used.

Both go in `authorSearchLinks(author)` in `src/web/AuthorNames.tsx`. That file is the one place that
draws an author, and a pure function there is easy to test. They open in a new tab with
`rel="noreferrer noopener"`, as the Debate and Criteria panels' outside links do, so the article's
address is not sent to Google.

They show up in two places:

- **The masthead card.** The card around each name gets a line under the affiliations,
  *Find out more: Google Scholar · Web search*. A card with links in it has to be one the pointer can
  enter, so the card becomes `interactive={{ label: "About <name>" }}`. This is the per-use option
  Greg chose on 2026-10-02 ([tooltips.md § A card the pointer can enter](../project/tooltips.md)).
  The *Click for everything on your shelf* line stays as it is.
- **The Metadata page's Authors section**, the same two links under each author's affiliations. On
  a phone a tap on a name goes to the shelf and no card opens (260929d § 4), so this is where a phone
  reader finds the links. It is also where they can be seen without hovering.

The links are drawn whether or not the reader owns the article. They name only the publisher's own
public metadata. A visitor gets no `authors` list anyway (260929d, *Visitors*), so today only the
owner sees them.

## Passed over

- **Not in the Citations band.** Greg asked for this "when citations mode runs". But the masthead
  already shows the authors above every mode, Citations included. The Citations band has been made
  smaller twice since (plans 261001l, 261001m), and a second list of the same names
  there would be a copy of the masthead's. The link from his words to where this lands is the
  masthead.
- **An in-app "top few links" (the fuller version).** One model call with web search, per author on
  demand, returning three links with a line each (homepage, profile, a recent paper). That would
  answer "the top few links" literally, inside the app, the way Citations' *Look it up* does for a
  work. But it is a paid call, a job, a cache, a streamed panel and a prompt to measure. The two
  searches often lead to those same links, for free, one click away. **Deferred**: worth building if Greg
  finds the searches are not enough.
- **ORCID / OpenAlex author pages.** A direct profile link would be better than a search, but we do
  not store an ORCID. Matching a name to an OpenAlex author id is the cross-article identity problem
  260929d deferred.
- **Bylines with no list.** An article with no `meta.authors` keeps its byline as one string, with
  no links. Splitting it is a guess (AuthorNames.tsx says why).

**After Sol's plan review** ([261003f-authors-plan-review-sol.md](261003f-authors-plan-review-sol.md),
no P0 or P1):

- **Quote marks come out of the name** (straight and curly) and whitespace is collapsed before it is
  quoted, so `Jane "JJ" Doe` cannot break the search's own grammar. Initials and diacritics stay.
- **The affiliation hint is capped** at 80 characters, cut at a word, because a stored affiliation
  can be 300 (`AUTHOR_LIMITS`) and the hint only has to tell two people apart.
- Tests read the *decoded* `q`, not the encoded URL. The browser check emulates touch, to show a
  tap on a masthead name still follows the shelf link now that its card is interactive.

## Tests

- `authorSearchLinks`: the Scholar query quotes the name with the `author:` operator; the web query
  includes the first affiliation and only the first; there is no affiliation clause when there is
  none; the query is URL-encoded, with a name containing `&` and quotes.
- The masthead component test (`tests/masthead-authors.test.tsx`): the card holds both links, they
  open in a new tab with `noreferrer`, and the card is interactive (labelled).
- The Metadata page shows the links under each author.
- Browser check at desktop and phone width: the pointer can cross into the card and click a link;
  the Metadata page has the links and nothing overflows.
