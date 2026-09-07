# Privacy

**What we do with a reader's data, and the page that tells them so** —
[`/privacy`](../../src/web/PrivacyPage.tsx). Part of
[reading-view-overview.md](reading-view-overview.md).

This doc is the reasoning; the page is the promise. Its sibling is
[website-text.md](website-text.md), which owns the rest of the public-facing
copy — the landing page, and the one address a reader writes to.

**The rule for this file is that the page has to stay true of the code.** That is
a live cost rather than a slogan: three claims in the first draft were false when
written, and a fourth was found by a review. What is checked mechanically and
what a person has to re-read are both listed below.

Written 2026-09-02, when there were still no real readers, which is the cheapest moment to write
one. **That moment has passed**: Stripe went live on 2026-09-03, sign-up is open to anyone and
there are paying readers, so the two soft spots listed under *Still open* below stopped being
theoretical the same day. The page's own wording was moved from "alpha" to "beta" then, and its
`LAST_UPDATED` bumped with it.

> We're still in Alpha, so this doesn't have to be fancy/long. But let's aim to be clear about what
> we store/process and why, and what models & third-parties/subprocessors etc. […] We want it to be
> brief/concise, and written very plainly, with some high-level, important protections for us as you
> see fit (but without filling it with legalese).
>
> — Greg, 2026-09-02

## The four decisions Greg made

Asked, on the day, because none of them could be read off the code:

1. **Who is responsible.** Greg Detre, sole trader, in the UK — but *"if possible for now let's not
   even mention me"*. So the page says "built and run by one person in London, United Kingdom" and
   gives the address. **This is the one soft spot in the policy**: UK GDPR's Article 13 wants the
   controller *identified*, and "one person in London" identifies nobody. It was a defensible
   position while every reader was a friend of Greg's, and it has an address that reaches a real
   human on it — but there are paying readers as of 2026-09-03, so the condition it was waiting on
   has been met. It is the first thing to change.
2. **Deletion and export**: *"email us and we'll do it"*. True today — there is no
   account-deletion endpoint, and no per-article delete either: the shelf's button archives, and
   since 2026-09-04 it says so — and the page says all of that in those words rather than implying
   a button. Build the button and this paragraph changes.
3. **Whether we read reader content**: yes, and the page says so plainly. There is an
   administrator's view across all owners ([admin.md](admin.md)), debugging a reader's broken
   article means looking at it, and a reader discovering that for themselves is far worse than
   being told. What the page rules out instead is the part that would actually offend: selling it,
   publishing it, training on it.
4. **Facts**: the database is Supabase `eu-west-2` (London); Vercel's functions are pinned to
   `lhr1` (`vercel.json`). Stripe is named although payments are **not switched on yet** — Greg,
   *"let's include it anyway, because hopefully it will be soon"* — and the page says out loud that
   it is off, which is what keeps that honest rather than premature.

## What the cross-family review changed, and what is still open

The page went to GPT Sol on 2026-09-02 with the diff, the schema and the routing table, and came
back with fifteen findings. **Every one that was checked turned out to be real**, which is the
argument for reviewing a policy the way code is reviewed: prose about a system is exactly as
falsifiable as the system, and nothing about re-reading a sentence tells you the button underneath it
does something else.

The four that mattered:

- **"Delete an article and it goes" was false.** The button called `shelf.archive`
  ([`ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx)), which sets `archived_at` and destroys nothing.
  Found by reading the button rather than the sentence, which is the only way it could have been
  found. The page said what the button really did and offered erasure by email — and on 2026-09-04
  the button itself was renamed to **Archive**, so the page no longer has to explain a word away
  ([library.md](library.md#this-section-was-called-delete-means-archive-and-that-was-the-bug)).
- **The feedback tick-box gates diagnostics, not the screenshot.** A pasted screenshot is its own
  consent and is sent whether or not the box is ticked — [`src/db/schema.ts`](../../src/db/schema.ts)
  § `feedback_diagnostics_consented` says so in as many words. The page had merged the two.
- **Sentry gets the signed-in reader's account id and email on every error**
  ([`src/monitoring-scrub.ts`](../../src/monitoring-scrub.ts)), which Greg asked for on 2026-08-28.
  The page mentioned an email address only under bug reports.
- **Quiz answers are not stored at all** — v1 marks and discards
  ([`src/db/schema.ts`](../../src/db/schema.ts) § `quiz`). The page had them on the kept list.

Also corrected: the account fields we actually hold, what a public link exposes, that OpenRouter
allows fallbacks so the upstream may be a cloud host rather than the model's maker, that ZDR covers
content and not the fact of a request, that Vercel's network is global even though the functions are
in London, and that server logs hold a status rather than an answer.

**Still open, and each needs a decision rather than a sentence:**

1. **The controller is not identified.** Sol's verdict is unambiguous — Article 13 wants the
   controller's identity, there is no beta exception, and an email address is mitigation rather than
   compliance. Greg's instruction stands and is recorded above; this is the thing to revisit first.
2. **No transfer safeguard is named** for sending data to US providers. Linking a provider's consumer
   privacy policy is not a transfer mechanism, and the page currently does no more than that.
3. **No Article 9 condition** for special-category material. Asking readers not to upload health
   records does not stop us processing them when they do.
4. **There is no terms of service**, so the four protective paragraphs are operational advice that
   nobody has agreed to. Sol is right that the age rule and the uploader's obligation belong in short
   Terms — acceptable use, availability, liability, governing law — and that a privacy notice cannot
   carry them.
5. **The ICO data protection fee** (~£40/yr for a sole trader) is very likely due once real personal
   data is being processed.

## What a bug report carries

**The section the code points at.** `src/db/schema.ts`, `src/routes.ts` and
`src/types.ts` all cite this heading by name, because the Feedback box is the one
place in the app where a reader hands us something we did not already have, and
the rules changed on the day the policy was written.

Three things go with every report, and the reader is told all three on
[`/privacy`](../../src/web/PrivacyPage.tsx):

- **What they typed**, and their **email address**, taken from the auth gate
  rather than from the browser.
- **The address they were at, whole** — query string and all. This is new. It was
  a closed vocabulary of ten route names (`route_kind`) until 2026-09-02, on the
  argument that our URLs carry `?q=` and `?find=`, which is the reader's own
  typing, and `/add/<a whole third-party URL>`, which may carry a token. Greg
  reversed it: *"I think it's fine (and even advantageous) to store the url with
  the Feedback - if that means we can get rid of the route_kind and simplify
  things, proceed."* [`src/db/schema.ts`](../../src/db/schema.ts) § `url` has the
  engineering half of the argument — a vocabulary that needs a migration per page
  is one whose escape hatch gets used, and an escape hatch in use is worse data
  than no constraint.
- **The build commit and the article slug**, so a report names a deploy and a
  piece.

**Two consents, and they are not the same one.** The tick-box gates the
diagnostics blob — recent errors, what the browser is — and a `CHECK` in the
schema enforces that a row cannot carry diagnostics without it. **A screenshot is
not covered by it**, deliberately: pasting a picture in *is* the consent for that
picture, and gating it on the tick-box would refuse a report a reader knowingly
assembled. The page had these merged in its first draft and GPT Sol caught it.

**And the whole address reaches Sentry**, not just our own database. Asked and
answered, 2026-09-02: Greg chose the full URL everywhere over a path-only copy.
It is the one place on the page where a reader is told something that another
arrangement would have hidden, which is the point of telling them.

## What protects us, and what was deliberately left out

Four paragraphs at the foot, and they are the whole of it: **this is beta** (don't put anything
sensitive in it, we may reset data), **what you add is your responsibility** (the one that actually
matters for a tool whose whole job is ingesting other people's writing), **not for under-18s**, and
**this page will change**.

Left out on purpose: governing law, limitation of liability, a legal-basis table, DPA and SCC
language, a cookie banner (there is nothing to consent to — no analytics, no third-party cookies),
and every sentence beginning "we value your privacy". Those belong in terms of service if they
belong anywhere, and none of them is what would go wrong here.

## If something here is yours

The one section on the page written to somebody who does not have an account, and the last one for
that reason. **Greg chose "build a minimal takedown route" on 2026-09-04**, over doing nothing and
over a form with a queue behind it.

**Why it exists.** Spideryarn republishes the extracted text of somebody else's article. The owner
ticks a box confirming they have the right to; that box is not a rights *check* — it moves
responsibility onto the owner — and the platform's actual protection is that plus a way for the
wronged party to complain. [public-shelf.md](public-shelf.md) is what made that stop being
theoretical: a shared article used to be reachable by link and is now **findable**.

**It is a section, not a route**, and the argument is written beside it in
[`PrivacyPage.tsx`](../../src/web/PrivacyPage.tsx). A page of its own costs an arm in `parseRoute`, a
member of the `Route` union, a case in `page-title.ts`, two arms of `App.tsx` and a component — and,
worse, a second public address making claims about what we do that has to stay true alongside this
one. The words belong beside *What you add is your responsibility*, which is the same fact told to
the other party, and beside *Deleting things*, which is already "email us and we do it by hand".
Findability comes from the link rather than from the page's name.

**Reachable from the two surfaces a stranger meets a republished article on**, and from nowhere
else: the foot of `/read/public`, and the visitor's own details page for one article. Not the
reading view — a report link in the prose chrome would shout at every reader of an article that is
almost certainly shared legitimately, and that bar is measured by `stickyOffset`
([`src/web/scroll.ts`](../../src/web/scroll.ts)), so anything added to it moves where every deep link
lands. `TAKEDOWN_LINK` in [`src/messages.ts`](../../src/messages.ts) is one sentence doing both jobs
— the link text *and* the whole of the offer — so there is no lead-in prose to keep in step with it.

**What the section promises is bounded on purpose**: one mailbox, one pair of hands, days rather than
hours, nothing out of hours. It asks for the address of the Spideryarn page first, because a message
that does not name one cannot be acted on. And it says what *taken down* means here — the article
goes private, which takes it off the shelf and stops the shared link opening it, while the reader's
own copy stays until somebody asks for it to be erased. A complainant finding that out afterwards
would be worse than being told.

**What was deliberately not built**: no form, no table, no queue, no moderation view, and nothing
that changes an article's visibility without a person deciding. The mechanism for taking something
down is the owner's own sharing switch; an administrator's override of it is a much larger decision
than this section, and [admin.md](admin.md) is where it would have to be argued.

**This section keeps the promise; it no longer carries the argument.** Since 2026-09-06 the reasons a
rights-holder might be reassured — what actually goes out, that the original stays linked from the
top of our copy, that none of it is in a search engine, what the model wrote and what the author did
— live on `/features/public-readable-sharing`
([public-readable-sharing.md](public-readable-sharing.md)), which is also where the two claims that
turned out to be false are recorded. The split is worth stating because it is the reason neither
page restates the other: **this section is what we will do when you ask; that page is what we do with
an article in the meantime.**

**The anchor is a mechanism, not markup.** `navigate` scrolls to the top on every navigation and a
client-rendered page has nothing under the fragment for a browser to find on a cold load, so
`PrivacyPage` scrolls its own section into view. The id and the address are one constant —
`TAKEDOWN_SECTION_ID` in [`src/web/router.ts`](../../src/web/router.ts) — because two string literals
in two files is a link that lands at the top of a long policy and tells nobody it missed.
[`tests/takedown-privacy-section.test.tsx`](../../tests/takedown-privacy-section.test.tsx) drives
both arms of it.

## Where a reader's voice goes

**Added 2026-09-07, because this is the one thing on `/privacy` that got weaker rather than
stronger**, and a page that only ever records improvements is not being kept honestly. Greg took the
decision on 2026-09-06 knowing the cost; the work is
[260907c](../plans/260907c-dictation-onto-an-openai-transcriber.md).

Dictation used to go to `google/gemini-3.1-flash-lite` with `provider: { zdr: true }`, and that flag
is what let the line beside every microphone say *"and isn't stored"*. It now goes to
`openai/gpt-transcribe` on OpenRouter's `POST /v1/audio/transcriptions`, because that is the only
route measured to accept a **vocabulary** — the list of an article's own words that stops a
transcriber guessing at *Spideryarn* and at author surnames, which is the entire reason the feature
exists.

### Why the guarantee could not simply be carried over

Not "we forgot to set the flag" and not "the model has no zero-retention endpoint". **The flag is
ignored on that endpoint**, which is worse, because a request carrying it succeeds:

| sent to `/v1/audio/transcriptions` | answer |
|---|---|
| `provider: {"only": ["anthropic"]}` | **200**, with a transcript — Anthropic serves no transcriber |
| `provider: {"zdr": true}` | **200**, for a model absent from `GET /api/v1/endpoints/zdr` |
| the same `zdr: true` on `/v1/chat/completions` | 404, *"No endpoints found matching your data policy"* |

The first row shows the block is not read; the second and third together prove it, because an
enforced flag must 404 for a model with no qualifying endpoint, and on the chat endpoint it does.
OpenRouter's STT guide documents the first row's half — *"Routing preferences (`order`, `only`,
`ignore`) are not applied to transcription requests"* — and says nothing about `zdr`, so the
measurement is the authority. It is re-runnable:
[`evals/dictation/probe-stt-routes.ts`](../../evals/dictation/probe-stt-routes.ts).

**A route that would have kept the promise exists and loses on the thing that matters.**
`openai/whisper-large-v3` on Groq *is* on OpenRouter's ZDR list. Biasing on the Whisper family is the
`prompt` field, 224 tokens, which OpenAI's own guide calls *"less control than the recommended
transcription model"* and which
[260903i](../plans/260903i-which-model-transcribes-dictation.md) measured through this very endpoint
"answering 200 and changing nothing". Keeping zero data retention therefore means giving up the
vocabulary, and the vocabulary is why anybody dictates here at all.

### What is actually true now, with the quotations the page is written from

Every clause of the reader-facing copy traces to one of these. **Check the wording against these
before editing it**, and do not add a warmer clause that none of them supports.

- **OpenRouter, on its own logging** — *"OpenRouter does not store your prompts or responses, unless
  you opt in"*, both settings *"Off by default"*, and it stores request metadata but *"not the
  content of your prompts or responses"*.
  <https://openrouter.ai/docs/guides/privacy/data-collection>
- **OpenRouter, on audio specifically** — *"We do not persist image, audio or video files beyond the
  duration necessary to route the request, except as required for abuse detection, security,
  billing, or legal compliance."* Their policy also names voice recordings as *"biometric
  information"* under applicable laws. <https://openrouter.ai/privacy>
- **OpenRouter, on whose policy governs downstream** — *"We do not control, and are not responsible
  for, LLMs' handling of your Inputs or Outputs"*; a provider's practices are the provider's.
  <https://openrouter.ai/privacy>
- **OpenAI, on training** — *"data sent to the OpenAI API is not used to train or improve OpenAI
  models (unless you explicitly opt in)"*.
  <https://developers.openai.com/api/docs/guides/your-data>
- **OpenAI, on retention** — the general API default is *"abuse monitoring logs … retained for up to
  30 days"*, but their per-endpoint table gives `/v1/audio/transcriptions` an abuse-monitoring
  retention of **None** and an application-state retention of **None**, one of only three rows in
  the table with no retention at all. Same URL.

### The gap, which is why the copy hedges

**We do not know which OpenAI endpoint OpenRouter calls.** `gpt-transcribe` is listed by OpenAI
under both `/v1/audio/transcriptions` (retention None) and `/v1/realtime/transcription_sessions`
(30 days), and nothing OpenRouter publishes says which it uses. So the strong sentence — *"and they
say they keep nothing"* — rests on a fact nobody outside OpenRouter can check, and this page's whole
register is that a reader could check it. Hence *"we no longer promise they don't"* beside the
button, and a paragraph on `/privacy` that says what each party publishes and stops.

**The two ways to close it**, neither taken here and both real, are in
[260907c § Open questions](../plans/260907c-dictation-onto-an-openai-transcriber.md#open-questions-for-greg):
call OpenAI directly, where the endpoint is ours to name, or apply to OpenAI's zero-data-retention
programme.

### What did not change

The audio is still never written down by us. It arrives base64 in one request, goes out base64 in
one more, and is gone when the request ends; nothing stores it and nothing logs it, and
[`src/transcribe.ts`](../../src/transcribe.ts) logs lengths and term counts rather than words for
the same reason it always did. The `ai_calls` row saying a dictation happened is still written, and
still carries no content.

## What is pinned by a test, and what is not

[`tests/privacy-page.test.ts`](../../tests/privacy-page.test.ts) holds the **model names** to
`DISPLAY_NAME` in [`src/models.ts`](../../src/models.ts) and to `LIVE_MODEL` / `LIVE_TRANSCRIBER` in
[`src/live.ts`](../../src/live.ts). That is the claim that would go stale first and silently: swap a
model and nothing else in the repo would make anybody open the policy. It reads the page **with the
comments stripped**, because the file is heavily commented and several of those comments name a
model — the first version would have gone on passing after a name left the prose, which is
[silent success](../reusable/silent-success.md) in the test written to prevent it. GPT Sol found
that too. The page says "the **default** models", because
`SPIDERYARN_*_MODEL` can override several jobs at runtime and no test can see that.

**Everything else on the page is prose that a person has to re-read.** Go and look at it when any of
these moves:

- **what a shared article carries**, which changed twice on 2026-09-04 and is the only claim on the
  page that has ever gone from true to false. The paragraph under *Who can see your shelf* said
  *"Your notes, your comments and your conversations are not shared"*; two thirds of that stopped
  being true when Greg decided a public link carries the reader's comments and the model's answers
  to them, and their **saved searches** a few hours later — the questions they typed, in their own
  words, and the passages those found
  ([260904c](../plans/260904c-more-modes-on-a-shared-link.md), stages 3 and 4).
  **Conversations are still private, and the page says so separately** rather than quietly dropping
  all three — somebody who read the old sentence should be able to find out which half of it
  survived. The page does not enumerate the rest: the Access & Sharing card derives the full
  inventory at the moment of sharing
  ([`shared-inventory.ts`](../../src/web/shared-inventory.ts)), and two lists of one fact is how one
  of them goes stale.

  **Two constants went stale the same day and were only found by a review**, which is the part worth
  remembering rather than the fix. `SHARED_LINK_CARRIES` — the visitor's own sentence — still ended
  *"It never carries the comments, conversations, searches or notes of whoever added it"*, so the
  page told a reader that the comments in the drawer beside it had not been shared. And
  `NOT_SHARED_NOTE`, the one-line summary under the owner's third column, still said a shared link
  carries the piece *"never your own work on it"*, on a card whose first column had begun listing
  *Your comments and notes*. GPT Sol found both.

  The lesson is about the shape rather than the words: **a sentence that enumerates what does not
  cross is a promise with no test behind it**, and a hand-written summary of a derived list is worse
  — the list moves and the summary does not. `NOT_SHARED_NOTE` was deleted rather than reworded, and
  the note that replaced it on the *other* column (`SHARED_NOTE`, *"nothing a visitor does can spend
  a model call"*) is one `tests/public-network-trace.test.tsx` actually enforces.

- a new **subprocessor** arrives, or one goes — the list is Supabase, Vercel, OpenRouter, OpenAI,
  Google, Sentry, Stripe
- the **regions** change, or an article's bytes start living somewhere other than
  Supabase Storage in London ([database.md](database.md))
- **retention** changes anywhere — Sentry's 30 days, Vercel's ~1 day of request logs
- the **zero-retention** claim: `zdr: true` is now set on **nothing** (`AI_JOB_ROUTE` in
  [`src/ai-call.ts`](../../src/ai-call.ts)). It was dictation's alone until 2026-09-07 — see
  § Where a reader's voice goes below, which is the one place on this site where we tell a reader
  that something got weaker — [ai-gateway.md § A key is not
  access](ai-gateway.md#a-key-is-not-access-and-the-difference-is-invisible-until-a-reader-finds-it)
- **account deletion** or **export** grows a button, which changes decision 2 above
- **what the Archive button does** — it archives, it is called Archive since 2026-09-04, and the
  page says so; when a real delete or an account-deletion path is built, that section is the first
  thing to rewrite. The page also says what archiving does to an article that was *shared*: it drops
  out of the public listing (`publicLibraryQuery` filters `archived_at`) and the link keeps working,
  which is [library.md](library.md#archive-and-undo-is-the-confirmation)'s split between listing and
  access. If `publicSlug` ever starts filtering too, that sentence is wrong
- what actually survives a delete — the page names three kinds of thing, and both were checked against the
  schema rather than assumed: `raw_sources` has no lifecycle at all (nothing deletes a row from it,
  and the bytes are content-addressed, so two readers who add the same document share one object),
  and `ai_calls` outlives its article by design because it is the spend ledger.
  [database.md](database.md) and [`src/db/schema.ts`](../../src/db/schema.ts) § `rawSources`
- **the takedown section** — the section above. Its heading is `TAKEDOWN_HEADING` and its anchor is
  `TAKEDOWN_SECTION_ID`, both pinned; the prose in it is not, and is the thing to re-read if we ever
  start doing more than reading that mailbox by hand
- **payments** go live, which changes decision 4
- **what a bug report carries** — the section above; the two consents are a
  schema `CHECK` and a browser gesture respectively, and neither is a preference
- what the **browser** keeps — the page names the session, a few preferences, and the offline
  IndexedDB cache of article bodies in [`src/web/lib/offline-store.ts`](../../src/web/lib/offline-store.ts),
  which is dropped for that account on sign-out. The first draft claimed the session was the only
  thing stored, which was false and was the second wrong claim of the day; both were found by
  reading the code rather than by re-reading the prose.

There is also one thing the page asserts that lives in somebody's dashboard rather than in this
repo: **that OpenRouter is not logging our prompts.** Its account and key settings decide that, not
our code, and nothing here can check it. Whoever holds the account should confirm it, and re-confirm
it after any change to the key.

## Where it lives, and why it is not markdown

A route in [`src/web/router.ts`](../../src/web/router.ts) and a component,
[`PrivacyPage.tsx`](../../src/web/PrivacyPage.tsx), with the prose written as JSX — the same shape as
[`LandingPage.tsx`](../../src/web/LandingPage.tsx), which is the only other page in the app that is a
wall of public-facing prose.

A markdown file rendered at build time was the alternative, and the reason against it is specific:
`mdast-util-from-markdown` *is* installed, but the renderer over it is
[`Cited.tsx`](../../src/web/Cited.tsx), which exists to turn `spya-…` references into links into an
article and knows about citations, modes and a block index. Using it here would braid the privacy
page into the chat renderer; writing a second small renderer would be a second mechanism for the
same job. Neither is worth it for one page.

**It renders signed out.** That is the only structurally interesting thing about the route and it is
the point of the page: the person who most wants to know what we do with an article is the one
deciding whether to hand us one. So it joins `/login` as an exception in
[`App.tsx`](../../src/web/App.tsx)'s signed-out branch, and **every page with a bottom links to
it** — the shared footer row, [website-text.md § The footer](website-text.md#the-footer). That
includes `/profile` and the shelf, for a reader who signed in months ago and will never see the
landing page again.
