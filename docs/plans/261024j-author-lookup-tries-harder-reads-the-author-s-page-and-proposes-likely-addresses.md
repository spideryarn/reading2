# Author lookup tries harder: reads the author's own page, and proposes likely addresses

One admin report, filed on `/admin/vouchers?tab=drafts`, 2026-10-23 22:39 UTC (`feedback-reporter.ts`
exit 0, so Greg's own words, and built). Up:
[admin.md § Author gifts](../project/admin.md#author-gifts-a-draft-voucher-for-an-articles-author),
[marketing-author-gifts.md](../project/marketing-author-gifts.md). Builds on
[261024f](261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md),
landed the same night, which took the neighbouring reports (#685, #687, #688).

> When trying to find an email for an author gift, it'd be great if you could try slightly harder.
> So, for example, you know, I did a bit more Googling myself, and I found an email address listed
> as an image here that I feel like you could have spotted.
>
> https://tinlizzie.org/~awarth/
>
> Or alternatively, maybe you could have tried to guess, based on other Incan Switch people, what
> the email address might be. And so you could list a few with tooltips for me with a level of
> confidence for each or something, just to save me Googling around myself.
>
> — Greg, 2026-10-23 (#686, `spya-w5yavh`). "Incan Switch" is dictation for *Ink & Switch*.

## What the example page actually does

Fetched 2026-10-24, the address on Alessandro Warth's page is three table cells:

```html
<tr><td>alexwarth</td><td><img src=images/at.gif></td><td>gmail.com</td></tr>
```

Only the `@` is an image. The lookup never reads a page: it sees the search provider's (Exa) text
extracts, and an extract drops the image, leaving `alexwarth gmail.com` at best — no address
token, so rule 2 of `src/author-lookup.ts` (an address counts only as a whole token in a result's
text) cannot see it, and the model is told never to guess. So this is not a vision problem. It is
**reading the page's own HTML, with each image kept as a marker**, and recognising the handful of
ways people disguise an address.

## Decisions

### D1. More searches, aimed at the author's own pages

`MAX_SEARCHES` 3 → **5**; `MAX_TOTAL_RESULTS` 10 → 15. The prompt names the order: the author's
name with the title or site; **their own homepage** (personal site, university or lab page); their
contact page; and, if no address has turned up, **a colleague's page at the same institution**, to
learn the address pattern there (D3). The answer gains `homepageUrl` (a result URL, or null — rule
1 applies). The card's *more than it was allowed* flag reads the constant rather than its own copy.

### D2. Read the author's own pages ourselves, images kept as markers

After the call, when **no address was seen**, fetch at most **two** pages: `homepageUrl` and
`contactUrl`, each only if it survived rule 1 (a search result URL, or the article's own). Through
`fetchDocument` (src/fetch.ts) — its scheme list, address guard, pinned agent, redirect limit and
size cap — never a bare `fetch`; HTML only; 10 seconds each; a failure is a line in the notes, not a
failed lookup.

The page is rendered to text with jsdom (no scripts run, nothing fetched), each `<img>` replaced by
`[image: <alt, else the file name>]`, table cells and block elements separated by a space. Then a
**deterministic** scan — no model sees the page, so it adds no new prompt-injection surface:

- **Plain address tokens** (`emailTokens`, as now).
- **Disguised addresses**: a local part, then an *at* — `@`, `[at]`, `(at)`, `{at}`, ` at `
  between spaces, or an image marker whose name or alt is `at`, `@` or `arroba` (`at.gif`,
  `at-sign.png`, `alt="@"`) — then a domain of at least two labels, whose dots may be `.`, `[dot]`,
  `(dot)` or ` dot `. Decoded, normalised, `looksLikeEmail`.
- `mailto:` hrefs, decoded.

Each becomes a **candidate written on their page** (D4). Its confidence is deterministic: **high**
when the local part contains the author's surname or first name (≥ 3 letters, accents folded) or
their initials plus surname, **medium** otherwise. Nothing found on a page fills the draft, even a
plain token: a homepage can carry a lab manager's or a department's address, and picking the
author's out of several is a judgement the page shows to Greg rather than makes for him.

*Passed over:* **a second model call over the fetched page** would read stranger disguises (a
JavaScript-assembled address, an address drawn entirely as an image), at one more paid call per
lookup and a new injection surface (a page's text inside a prompt). The deterministic scan covers
the example and the common forms for nothing. If Greg brings an example it misses, that is the
follow-up. **Optical reading of an address drawn as a whole image** — the same, later.

### D3. Guessed addresses, with a confidence each, never applied

The answer gains `guesses`: at most **three** `{address, confidence: "high"|"medium"|"low", why,
basisUrl}` — *the address pattern at this institution, from a colleague's address seen at
basisUrl*, or *the author's own domain*. The prompt says a guess is a guess, must say what it is
based on, and is listed only when no address was seen.

Checked in code, because the model's confidence is only its word:

- the address must be shaped (`looksLikeEmail`) and not equal to a seen address;
- `basisUrl` must survive rule 1, else it is dropped (the guess stays, with no basis);
- **pattern seen**: true only when the basis result's text (or a page read in D2) holds an address
  token at the **same domain** as the guess. A guess without a seen pattern is capped at **low**,
  whatever the model said.

A guess **never fills the draft** and is never sent automatically.

### D4. One list on the card: *Possible addresses*

Each lookup line shows its candidates — those written on their page (D2) first, then guesses (D3),
then the model's existing *suggested, not seen* address folded in as a low-confidence candidate
— one row each: the address, a confidence chip (*likely* / *possible* / *long shot* for high,
medium, low), and the kind in words (*written on their page in disguise* / *on their page* /
*a guess*). Hover or tap opens the house `Tooltip` card: the kind, why, the source page as a link,
and for a guess whether the colleague pattern was seen. A **Use this address** button on each row
patches the draft's address (the existing `PATCH`, Greg's own press) — shown only on a draft. When
the draft already has an address, the button reads *Use instead*.

Stored as rows, not JSON (docs/project/sql.md): a new table
`author_lookup_candidates (id, lookup_id → author_lookups on delete cascade, position, address,
kind 'on-page' | 'guess', confidence 'high' | 'medium' | 'low', why, source_url, pattern_seen,
created_at)`, written in `finishLookup`'s transaction. The MCP gift reader gets the same list. The
notes block gets a *Possible addresses* section and the pages read, for older readers.

### D5. What it costs

Two more searches and five more results at most, on the standard model; the ledger records it as
now, under the lookup's own run, and the card shows each run's cost, so the change is measured on
the first real lookup rather than estimated here. The page reads cost nothing but up to
20 seconds, after the response, where nobody is waiting.

## Stages

1. **Server**: prompt and answer (D1, D3), page read and decoder (D2), the rules, migration and
   store, MCP. Tests: the decoder on the example's HTML and the disguises listed; the confidence
   rules; guesses' basis and pattern checks and the low cap; a page read that fails; rule 1 on
   `homepageUrl`; candidates stored and listed; no candidate ever fills the draft.
2. **Page** (D4), a browser check by a Sonnet subagent with a seeded lookup.
3. Docs (admin.md, marketing-author-gifts.md), the Sol code review, the feedback note.

## What this is not

Not a crawler: two pages, both ones the search returned. Not an address verifier (SMTP probing is
unreliable and rude). Not a change to what may fill the draft: still only an address seen exactly
in a search result or the article.

## Revision 1, after GPT Sol's plan review — wins where it disagrees with the above

The review is [261024j-plan-review-sol.md](261024j-plan-review-sol.md). All ten findings are taken,
in these forms:

- **R1 (Sol 1): an address seen in a search result fills the draft only if it names the author.**
  Searching colleagues' pages puts real, seen addresses in the evidence pool, and the model could
  name one as the author's. So rule 2 narrows: an address seen in **the article's own text** fills
  the draft as before; one seen only in **a search result** fills it only when its local part names
  the author (`addressNamesAuthor`: surname, a first name of three letters or more, or initials
  with the surname). Otherwise it becomes a candidate, *seen at <page>, but not in the author's
  name*, for Greg to *Use*. A test has a colleague's address in a result, claimed as the author's.
- **R2 (Sol 2): no page is called "theirs".** The copy says *on <host>, the page the lookup took for
  theirs*, and the stored source is `fetchDocument`'s final URL after redirects.
- **R3 (Sol 3): confidence is computed, never the model's.** The model's `confidence` field is
  dropped. A guess carries `basis: {colleagueName, colleagueAddress, sourceUrl}`; code checks the
  colleague's address is a whole token in that source's text, works out which of a fixed set of
  patterns (`first.last`, `firstlast`, `first_last`, `flast`, `f.last`, `first`, `last`,
  `lastf`, `first-last`, `firstl`) turns the colleague's name into their local part, and applies it
  to the author's name. **A guess is *possible* (medium) only when that reproduces the guess
  exactly, at the colleague's domain, and the domain is not a public mail provider.** Every other
  guess is *long shot* (low). No guess is ever *likely*. For an address written on a page (D2):
  *likely* when it names the author, *possible* otherwise; one seen in a result but not naming
  the author (R1): *possible*.
- **R4 (Sol 4):** scripts, styles, templates, `noscript` and `head` were already skipped and are
  tested; a bare ` at ` needs a spelled-out dot and an address naming the author still decides
  the confidence. The image rule is `^(@|at|at[-_ ]?sign|arroba|atmark)` with an optional image
  extension, case-insensitive, on the alt text or the file name (query and fragment stripped,
  percent-decoded); jsdom decodes entities.
- **R5 (Sol 5): bounded as said.** `attempts: 1`, 2 MB, 10 s per page by an abort signal, and the
  two URLs de-duplicated; at most 6 addresses a page and **8 candidates a lookup**.
- **R6 (Sol 6): guesses are discarded in code** when an address filled (or could fill) the draft.
- **R7 (Sol 7):** the old *suggested, not seen* address joins the list, as *long shot*, only if it
  is address-shaped; otherwise it stays a line with no button.
- **R8 (Sol 8):** `kind` is `on-page` | `on-page-disguised` | `in-result` | `guess`, with checks on
  kind and confidence, a normalised address, `unique (lookup_id, position)` and
  `unique (lookup_id, address)`.
- **R9 (Sol 9): provenance.** *Use this address* goes through the existing `PATCH`; the card's
  label for an address with no lookup behind it becomes *chosen or typed by you*. Send's existing
  `expected` check already refuses a confirmation drawn before the change; a test holds it.
- **R10 (Sol 10):** the tests below each guard: colleague auto-fill; seen address plus guesses;
  prose and script false positives; a malformed `mailto:`; overflow; a lost finish inserts no
  candidates; a malformed legacy suggestion; MCP's candidate shape.

## Code review (GPT Sol), 2026-10-24

[261024j-code-review-sol.md](261024j-code-review-sol.md), on
[the scoped diff](261024j-code-review.diff). Verdict: *approve with fixes*. Sol fixed nine things in
place, each with a test, and every fix was kept:

1. The model could name a colleague as the author, so that colleague's seen address "named the
   author" and filled the draft. The name the checks use is now the article's own author first.
2. Initials alone (`as@…` for Ann Smith) counted as naming the author; R1 needs initials plus surname.
3. The page was scanned as one flat string, so separate blocks could join into an address. Block
   boundaries now hold, while Greg's three table cells still join.
4. Percent-encoded `mailto:` addresses were missed, and malformed escapes were listed.
5. The six-per-page cap was applied after collecting everything; scanning now stops at it.
6. `last.first` was not in the plan's pattern set and could make a guess *possible*; removed.
7. An address-shaped legacy suggestion joined the list only in the browser; it is now assembled on
   the server too, so the notes and MCP agree. The browser fold stays for lookups stored before this.
8. The table and the store accepted impossible combinations: two more checks hold confidence to kind,
   and a source to everything but an unverified guess. The migration was edited before it reached
   dev; on the shared local database the two checks were added by hand.
9. A test now holds that choosing an address closes an open Send confirmation and only PATCHes.

Not ours, noted for 261024f: `tests/owner-isolation.test.ts` flags `previewAuthorGiftEmail`'s join
on `articles.slug` (it also checks the owner, so it is the guard's regex, not a leak).
