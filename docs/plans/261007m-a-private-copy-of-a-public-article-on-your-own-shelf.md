# A private copy of a public article, on your own shelf

Up: [plans.md](../project/plans.md) · the area is
[public-readable-sharing.md](../project/public-readable-sharing.md)

**Status: built, 2026-10-07.** On dev; not deployed.

Queue item `qi-jp2r4be8`. Option **B** of
[261006k](261006k-signed-in-reader-ai-on-someone-else-s-public-article.md), which Greg chose:

> B yes probably it would be nice to be able to add a private copy to your own shelf (perhaps in
> Metadata)
>
> — Greg, 2026-10-06

## What a signed-in visitor gets

Today a signed-in reader on somebody else's public article is offered nothing: the banner under
the masthead (`SharedNotice`, [PublicChrome.tsx](../../src/web/PublicChrome.tsx)) offers a
signed-out visitor *Make a free account* and a signed-in one no next step at all.

After this, the same banner carries one more line for them:

```
  ┌──────────────────────────────────────────────────────────────┐
  │ This article was shared publicly. …                          │
  │ Source: example.com/the-piece                                │
  │ … takedown … training …                                      │
  │ Want to search it, or chat with it? [Add a private copy to   │
  │ your shelf]  Uses one article from your allowance.           │
  └──────────────────────────────────────────────────────────────┘
```

and, when their shelf already holds an article at that address (`urlKey`, the rule a repeat paste
uses):

```
  │ You already have your own copy of this. [Open your copy]     │
```

- **The add button is a link to `/add/<address>`**, the existing door. The add page starts the
  import as it opens, so the press is the commitment, and the line says what it costs.
- **Already holding it costs nothing either way.** The direct link is the client half. The server
  half is already there: since [261007k](261007k-repeat-paste-is-free-and-says-so.md) a plain add of
  an address already on the reader's shelf answers `{ article, repeat: true }`, reserves nothing
  and the add page says *already on your shelf, cost nothing*. So a press made before the shelf has
  loaded, or after the client's lookup failed, is still free (`qi-yxr67qkz`'s rule).
- **Shown only when all of these hold:** signed in, the session confirmed (not the 401 arm), the
  article reached as **public** (`sharedBy === "public"`, never a private link), and a published
  address (`webSource(meta)`, which is `PublicMeta.url` after `publicSourceUrl`). Never built from
  a shared upload's guessed source. With no address there is no line.

## Where: the banner, which Metadata draws too, and the dead end

Greg suggested Metadata. The visitor's Metadata page (`PublicMetadataPage`,
[PublicPages.tsx](../../src/web/PublicPages.tsx)) already draws `SharedNotice`, so putting the
offer in the banner puts it on Metadata **and** on the reading view, under the masthead where a
visitor's eye is on arrival. That is the more findable entry point the item asks me to judge.

**And in `VisitorBand`**, the band a visitor meets when they press Chat, Search or any mode that
is the owner's: *"Chat is for whoever added this article …"*, then the offer. This was added after
GPT Sol's plan review (F3): on a narrow window a covering band hides the banner
(narrow-window.css § a band with no room), so someone who opens Chat sees the refusal and not the
way out. `VisitorBand` is one component drawn in one place (Reader.tsx § `band`), not the eleven
call sites this plan first guessed. One `PrivateCopy` component draws the line in both.

Not in the sticky controls bar: anything added there moves every deep link (PublicChrome.tsx says
why).

**The cost line is conditional** (*"A new copy uses one article from your allowance; if you
already have one, opening it is free."*). The add is still shown while the shelf has not answered,
if it could not be read, and for a reader whose copy is archived (`/api/library` lists no archived
article; the server's repeat lookup finds one). The server charges none of them, so an
unconditional *"uses one article"* would be false for them (Sol, F1 and F2).

## The shape

- `SharedNotice` gains a required `copyFrom: string | null` (the published address). Required, so
  neither caller can forget it; `Reader.tsx` and `PublicMetadataPage` pass `webSource(meta)`.
- A pure `privateCopyOffer(...)` in PublicChrome.tsx decides `null | { kind: "add", href } |
  { kind: "open", href }` from the five facts above plus the shelf entry, so the rule is testable
  without a session.
- A small `useShelfEntry(url)` exported from [link-facts.ts](../../src/web/link-facts.ts), reusing
  its module-level shelf (`loadShelf`, `watchShelf`, `shelfIndex`, `urlKey`) rather than a second
  `/api/library` reader. The hover card already loads it this way; its reader-change fence
  (`forgetShelf`) applies for free.
- Copy in [messages.ts](../../src/messages.ts).

## Tests, red first

1. `privateCopyOffer`: add link for signed-in + public + address; `null` for signed out, session
   unconfirmed, private link, no address; open link when the shelf has the article.
2. The banner renders `/add/<encoded address>` for a signed-in public visitor and does not for a
   signed-out one or a private link.
3. `useShelfEntry`'s matching is `shelfIndex`'s, already tested. Further tests came from the reviews and the browser check, below.

## The simpler option passed over

**The add link alone, with no shelf lookup.** The server already makes a repeat free and the add
page already says so, so the guarantee holds without the client half. Passed over narrowly: the
offer would tell a reader who already has the article that it *uses one article from your
allowance*, which is false for them, and the item asks to *take them to it*. The lookup is one
hook over machinery that exists.

No defence in [security-map.md](../project/security-map.md) is edited: the button is a link to a
route the reader could already type.

## What the reviews and the browser check changed

- **GPT Sol, plan review** ([findings](261007m-private-copy-plan-review-sol.md)), ready with
  changes: F1 and F2 made the cost line conditional; F3 put the offer in `VisitorBand` as well.
- **GPT Sol, code review** ([findings](261007m-private-copy-code-review-sol.md)), ready with changes,
  fixed in place: the visitor network-trace tests now give the public payload an address, so they
  exercise the shelf request (one `GET /api/library` for an eligible signed-in visitor, none for a
  signed-out one, none on the owner's page), and `useShelfEntry` restarts after a reader change
  while mounted
  ([postmortem 261007s](../postmortems/261007s-invalidating-a-cache-does-not-restart-its-mounted-readers.md)).
- **Browser check** (Sonnet, local Supabase, 1440×900, 820×1180, 390×844): the banner, the Chat
  band, the Metadata page and *Open your copy* all passed at the three widths; no offer for the
  owner or a signed-out visitor; no horizontal scroll. Two problems, both fixed:
  1. **The wrong offer for a few seconds.** A reader who already had a copy saw *Add* until the
     shelf arrived, then *Open your copy*. `useShelfEntry` now answers `asking | held | absent`,
     and the offer draws nothing while `asking`. A shelf that cannot be read answers `absent`
     (it is not retried this session), so the add shows, which the server makes free for a repeat.
  2. **No offer anywhere on a phone in Search.** The visitor's search panel is its own band
     (*"Whoever added this article hasn't searched it"*), not `VisitorBand`, and it covers the
     banner. `SearchAccess`'s visitor arm now carries the facts, and the panel draws the offer
     where the owner's box would be. Search is the mode Greg's report was about.

  Not checked in the browser: a private link (the rule is unit-tested), and pressing the add (the
  href is checked; the add page and the free repeat are 261007k's).

Screenshots: `261007m-shot-*.png` beside this plan.
