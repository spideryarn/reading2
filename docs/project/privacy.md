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
2. **Deletion and export**: *"email us and we'll do it"*. True on the day — there was no
   account-deletion endpoint, and no per-article delete either: the shelf's button archives, and
   since 2026-09-04 it says so — and the page says all of that in those words rather than implying
   a button. Build the button and this paragraph changes.
   **Half of it has been built, and this paragraph has therefore changed**: since 2026-09-07 a
   reader can destroy one of their own articles for good, from that article's metadata page —
   § *Deleting an article, for good* below. Account deletion is still a mailbox and a pair of hands,
   so the sentence survives for the account and no longer for the article.
3. **Whether we read reader content**: yes, and the page says so plainly. There is an
   administrator's view across all owners ([admin.md](admin.md)), debugging a reader's broken
   article means looking at it, and a reader discovering that for themselves is far worse than
   being told. What the page rules out instead is the part that would actually offend: selling it,
   publishing it, training on it.
4. **Facts**: the database is Supabase `eu-west-2` (London); Vercel's functions are pinned to
   `lhr1` (`vercel.json`). Stripe was named before payments were live — Greg, *"let's include it
   anyway, because hopefully it will be soon"* — with the page saying out loud that it was off.
   Payments went live on 2026-09-03 ([billing.md](billing.md)) and the page went on saying "not
   switched on yet" until 2026-10-01 (Greg: *"fix"*). The replacement distinguishes details entered
   on Stripe's hosted pages from what we retain, and names the account id and purchase information
   we send. The sources of truth are `src/billing/checkout.ts`, `src/billing/webhook.ts` and the
   billing tables in `src/db/schema.ts`; changing any of those means re-reading the Stripe entry.

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
  **True then, reversed on 2026-10-05**: [§ Quiz answers](#quiz-answers) below.

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

**The tick-box can also bring the reader's own article, since 2026-09-13.** Ticked, on a page of an
article the reporter owns, the Sentry copy may carry the original file, when one is held and it is
no more than 10 MiB, and `article.json` — the text, tree, headings and summaries the page loaded —
when that is no more than 5 MiB. The reader's profile and purpose are left out. Owner-only, because nobody can consent for somebody else's
article; read on the server, so nothing new leaves the browser; Sentry only, never our database.
That made the page's old last sentence — *"What a bug report never carries is the text of the
article you were reading"* — false, so it went. Its replacement hedges ("may", "a page of", a size
limit, the screenshot) for reasons
[plan 260913a § The proposed reader-facing wording](../plans/260913a-send-the-source-file-and-the-article-with-extra-diagnostics.md#the-proposed-reader-facing-wording)
gives clause by clause.

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

The first row shows routing is not applied; the second and third together prove `zdr` is not
either, because an enforced flag must 404 for a model with no qualifying endpoint, and on the chat
endpoint it does. **Not the whole block** — `provider.options` *is* forwarded, and is how the
vocabulary reaches the model at all. Routing and options live in one object and are treated
completely differently by the far end.
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
  **"You" there is OpenAI's API customer, which on this route is OpenRouter and not us.** The page
  says "its API customer" for that reason: we could not opt in or out of it if we wanted to. The
  clause where "ours" *is* the right word is OpenRouter's logging setting, and the page marks that
  one as a commitment we hold ourselves to rather than something a reader can check.
- **OpenAI, on retention** — the general API default is *"abuse monitoring logs … retained for up to
  30 days"*, but their per-endpoint table gives `/v1/audio/transcriptions` an abuse-monitoring
  retention of **None** and an application-state retention of **None**, one of only three rows in
  the table with no retention at all. Same URL.

### The gap, which is why the copy hedges

**We do not know which OpenAI endpoint OpenRouter calls.** `gpt-transcribe` is listed by OpenAI
under both `/v1/audio/transcriptions` (retention None) and `/v1/realtime/transcription_sessions`
(30 days), and nothing OpenRouter publishes says which it uses. So the strong sentence — *"and they
say they keep nothing"* — rests on a fact nobody outside OpenRouter can check, and this page's whole
register is that a reader could check it. Hence *"they may keep it under their own policies"* beside the
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

### On the reader's own device, until the words arrive

**Since 2026-09-29 the browser keeps a copy of a dictation while it is being transcribed**, so that a
tab that closes or loses its connection does not lose minutes of talking — Greg's report
SPIDERYARN-READING2-5M, and [dictation.md § A closed tab does not lose a
dictation](dictation.md#a-closed-tab-does-not-lose-a-dictation). It is IndexedDB on the reader's
machine, never sent anywhere by being kept, and it goes when the words are in the box, when the
reader discards it, when they press **Sign out**, or on their next visit after a week. It is **not**
dropped when a session merely lapses, unlike the offline article copy, because that would be the
silent loss the copy exists to prevent. The promise beside the button is about our servers and is
unchanged; `/privacy` names the device copy in its paragraph on what the browser keeps.

## Deleting an article, for good

**Added 2026-09-07**, when the shelf stopped being the only ending an article has.
`DELETE /api/library/:slug`, offered from one place — *Delete this article* at the foot of that
article's metadata page, under Archive. The plan and every decision behind it are
[260906h-delete-an-article-permanently.md](../plans/260906h-delete-an-article-permanently.md); the
words the reader sees are [copy.md](copy.md) § *The words on the one control that cannot be undone*.
What belongs on **this** page is the part that is a promise about a reader's data.

**What actually goes.** One statement, `delete from articles`, and the cascade: the revisions, the
blocks and their identities, the tree and every generated artefact, and all of the reader's own
work on the piece — comments, notes, highlights, questions, chats, saved searches, where they left
off. Measured, not assumed: the Stage A spike seeded a fully populated article and listed what
emptied.

**What deliberately survives, and why the page may not imply otherwise.** Four things keep a row
with the article pointer set to null: `ai_calls` (the spend ledger outlives everything, and carries
no content), `ingest_events` (the billing slot is **not** refunded — deleting does not give a slot
back, [billing.md](billing.md)), `article_visibility_changes` (takedown evidence about a document we
no longer serve, changed from `cascade` to `set null` *for* this feature), and `feedback` rows
naming the slug. None of them holds the article's text — though the Sentry copy of a consented bug
report may, until Sentry's own retention ages it out (§ What a bug report carries). The page names
that copy on its own, as the fourth thing an erasure cannot reach, rather than leaving it inside
"our providers' own logs" — a whole article is not a log line. GPT Sol, 2026-09-13.

**And the honest limit: a copy already on a device cannot be recalled.** The control says so in
those words, and so must this page. Two of those copies are ours to name because we put them there —
the IndexedDB copy this browser saved so the article opens offline, and any export the reader has
taken as a zip. The delete retires the whole of the first for the signed-in reader on the device it
runs on (`forgetCachedReader` in [`cached-shelf.ts`](../../src/web/lib/cached-shelf.ts)); it cannot
reach another device, and it cannot reach a file already saved to a disk. **A third is a bug rather
than a fact**: authenticated plates and assets are served `immutable` for a year
([`src/routes.ts`](../../src/routes.ts)), so a browser may go on painting an image out of its own
HTTP cache after the article is gone. That is on the plan to fix and it is not yet fixed.

**The bytes are the other outstanding half.** The raw downloaded file — the PDF, the saved page —
is content-addressed and shared between articles *and between owners*, so deleting the article does
not yet delete the object. Stage E of the plan is the reference-counted catalogue that will. **Until
it lands, the page's existing paragraph is still true and must not be rewritten early**: it says we
keep the original *"stored under a fingerprint of its own contents rather than under your name, so
that if somebody else added the same document it is the same file and deleting your copy cannot take
theirs"*. When Stage E lands, that paragraph gains a clause and loses nothing — deleting your copy
still cannot take somebody else's, and we will no longer keep the file once nobody refers to it.

**`PrivacyPage.tsx` caught up on 2026-09-07, in the same run.** Under *Deleting things* it had read
*"There is no button that really erases an article — undo matters more than tidiness — so if you
want one actually gone, email us and we will do it"*, and Stage D made every clause of that false.
It now says what Delete permanently does, that there is no undo and no copy we can bring back, and
the one limit worth a reader's attention: a copy already downloaded to a device is out of our hands.
The account is still the email, and that sentence stayed.

It was caught by the agent that built the control rather than by a test, and **no test pins it** —
see the section below for what is pinned and why this is not. The rule it broke is this doc's own:
the page has to stay true of the code, and a feature that falsifies a sentence on it is not finished
until that sentence moves. The same trap took three sentences down on 2026-09-02 (`fcb0a209`).

## Reading time

**Added 2026-09-16**, with [reading-time.md](reading-time.md): for an owner, a running total of
seconds per block of their own articles, drawn in the spine and the gutter. Only with experimental
features on until 2026-10-05; for every owner since (below).
The page's *What we keep* gained a bullet, because the list is only honest if it is complete, and
"no advertising or analytics trackers" stays true: this is shown to the reader it is about and to
nobody reading a shared link.

Three words in that bullet were changed by GPT Sol's review of the plan, and each is a claim the
code has to keep true:

- **"Passage", not "paragraph"** — every row is sampled: headings, figures, list items.
- **"The totals, not a history"**, not "never when". The table has no timestamp column, but every
  update is a request line in the server logs, with a time and the article's slug in the path. The
  page says so in brackets rather than promising something the logs contradict.
- **"Not shown to anybody reading an article you have shared"**, not "to nobody else". An
  administrator can read stored data, which the page already says.

**It is kept for every owner since 2026-10-05, and the bullet lost "with experimental features
on".** That clause was a fact about when it was kept, never a permission: the switch was
availability, not consent. Greg took reading time out from behind the switch
([reading-time.md § Who gets it](reading-time.md#who-gets-it)), so the clause would have been false.
`LAST_UPDATED` already read 5 October 2026 from another change that day, so it did not move.

**The bullet promises no way to turn it off or erase it, because there is none yet.** It says the
totals go when the article does, which is true. When an off switch or an erase is built, the bullet
gains a sentence and the date moves.

It goes with the article (a cascade through `block_identities`), and is in both exports.

**Since 2026-09-30 the quiz reads it too** — [quiz.md § Only what you have read](quiz.md#only-what-you-have-read)
— in the browser, to choose which questions to show and to say how much of the piece is read. Nothing
new is stored or sent. So on 2026-10-01 the bullet stopped naming its uses: it now says *"Some of
Spideryarn's features use it — to show you where you have been, for example"*, and `LAST_UPDATED`
moved.

> Perhaps just remove some of the low-level detail, because the user doesn't really care *exactly
> which modes* use it - so just say that some modes might?
>
> — Greg, 2026-10-01

**A new owner-only feature that uses the totals only in memory needs no change here**, whether that
happens in the browser or on our server. Reconsider the bullet before storing anything new from the
totals, showing them or a conclusion drawn from them to a shared link's reader, or sending either
outside Spideryarn — to a model, for example. The plan is
[261001a](../plans/261001a-privacy-reading-time-wording.md).

## Shelf topics

**Added 2026-09-29**, with [shelf-terms.md § The model's judgement](shelf-terms.md#the-models-judgement):
the topic row above the shelf is now chosen with `gpt-6-luna`, which is shown each read article's
title (the reader's rename when there is one) and one-sentence gist, the program's candidate
topics with three example titles each, and the reader's profile if they wrote one. **This is a new
flow of the reader's reading list to a model**, not a new subprocessor — OpenRouter and OpenAI are
already on the page — so the page names the model and what it is shown, in the models paragraph,
and `LAST_UPDATED` moved. The scores it returns are stored against the reader
(`shelf_topic_scores`), deleted with the account, and never logged; nor are the titles, gists or
profile it was sent. It runs only for the shelf's owner — the public shelf gets no topics at all.

**Changed 2026-10-03**, with [shelf-terms.md § Topics a model names](shelf-terms.md#topics-a-model-names-broad-to-fine):
the same model now names the topics itself and sorts the articles into them, rather than scoring
phrases. It is shown the same titles, gists and profile, **and a paper's abstract when the paper
has no gist yet**, which is new; it is no longer shown candidate phrases. What it returns (the
topic names, and which article is in which) is stored against the reader in `shelf_topic_sets`,
deleted with the account, and never logged. The page's sentence and `LAST_UPDATED` moved.

## Quick search

**Added 2026-10-02**, with [search.md § Quick search](search.md#quick-search-a-meaning-search-in-about-a-second):
a quick search sends the article's passages and the words the reader searched for to TypeSafe's
`jev-1.13`, through OpenRouter. That is what the meaning search already sends to a model, so it is a
new model rather than a new kind of data — and not a new subprocessor in our contract, since the
call is OpenRouter's like the rest — but the page names it and what it is shown, in the models
paragraph. The search and its hits are stored like a meaning search (`search_runs`, with `kind =
'quick'`), and [`src/quick-search.ts`](../../src/quick-search.ts) logs counts only, never the
criterion or a passage.

## A sentence in the command bar

**Added 2026-10-03**, with
[reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar): a sentence
the bar cannot match, sent on Enter by a signed-in reader, goes to TypeSafe's `jev-1.13` with our
own words for the bar's commands, and, when the command picked takes words (a search, a term, a
tag), to `gpt-5.6-luna` as well, which copies them out. Neither is shown the article. **A new flow
of the reader's own words to two models already on the page**, not a new subprocessor, so the
`jev-1.13` clause in the models paragraph says so and `LAST_UPDATED` moved to 3 October 2026. The
sentence is not stored, and [`src/command-pick-call.ts`](../../src/command-pick-call.ts) logs the
outcome's kind, counts and timings, never the sentence or the words.

## The admin's sign-up and upgrade notices carry the address

**Added 2026-10-01**, at Greg's request
([261001b](../plans/261001b-admin-sign-up-email-carries-the-address.md)): the notice the server
mails us on a reader's first authenticated request, and on each upgrade, now carries their email
address as well as their account id and, for an upgrade, the plan names. It was left out on
2026-09-30 because each copy — Resend's log, Namecheap's forwarding of `hello@`, and the inbox it
lands in — is one more place an erasure has to reach; that is still true, so the Resend entry on the
page says what the note carries and the route it takes, and `tests/privacy-page.test.ts` holds the
sentence. Namecheap is named there but not added to the subprocessor list: it already forwards
every mail a reader sends `hello@`, and this is the first time the page has said so.
[email.md](email.md) owns the mechanics.

## A gift email to an existing reader carries their allowance

**Added 2026-10-02** ([261002a](../plans/261002a-fb99-voucher-email-for-existing-user.md)): when a
gift voucher's address is already exactly one account's, confirmed, its email tells that reader how
many articles they had left and how many they have with the gift. That is usage-derived data in
Resend's log and the reader's inbox, so the Resend entry on the page says so, `LAST_UPDATED` moved,
and `tests/privacy-page.test.ts` holds the clause. An address two accounts share, or one not
confirmed, gets the plain invitation instead, so the counts never go to an inbox we cannot tie to
one reader.

## A reader is emailed when their feedback ships

**Added 2026-10-02** ([261002f](../plans/261002f-email-readers-when-their-feedback-ships.md)): when
the deploy that carries a report's `shipped` note is live, its reporter (never an admin) gets one
plain-text email saying so. It is a service message about the reader's own report, not marketing,
so it needs no tick-box — and the diagnostics tick-box, which is about what a report carries, is
not one for it. The notice is this page; the button's hover card also says *"so we can write
back"*, but only to a reader who hovered. What goes
through Resend is the reader's current confirmed address, the report's kind and the day it was
filed, **never their words**. The Resend entry on the page says so, and `tests/privacy-page.test.ts`
holds the clause. `LAST_UPDATED` already reads 2 October 2026.

## The admin is emailed each reader's feedback

**Added 2026-10-02** ([261002j](../plans/261002j-email-the-admin-each-reader-s-feedback.md)), at
Greg's request: every report a reader (not an admin) files is mailed to our inbox — what they wrote,
its kind, the page address and slug, their email address and account id. Unlike the shipped-feedback
email above, **this one does carry their words**, through Resend's log and Namecheap's forwarding of
`hello@`, which is two more places an erasure has to reach. The Resend entry on the page says so,
and `tests/privacy-page.test.ts` holds the clause. `LAST_UPDATED` already reads 2 October 2026.

## Crossref, DataCite and OpenAlex are sent a DOI

**Added 2026-10-04**, with
[debate.md § Cited by](debate.md#cited-by-the-papers-that-cite-the-piece)
([261004h](../plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md)). Three
public indexes of published work are asked about a paper by its identifier, from our server:

- **Crossref and DataCite**, since 2026-10-01: what a DOI or arXiv id refers to, for an article
  being added and when its cited works are looked up ([`src/bibliographic.ts`](../../src/bibliographic.ts)).
  **They were missing from the page until this change**, which is the page falling behind the
  code for three days.
- **OpenAlex**, since 2026-10-04: which papers cite the article, when its owner has Debate's
  Reception open ([`src/citation-index.ts`](../../src/citation-index.ts)).

Each is sent the identifier and our contact address (in the `User-Agent`, and as `mailto` where the
service asks for it). Never the article's text, never anything about the reader. For a private
upload this does tell the service that somebody using Spideryarn asked about that paper, and the
page says so in those words.

**A paragraph under the list, not three more entries in it.** The list in *Where it goes* is who is
sent something of the reader's; these are sent the identifier of a published work. The page names
all three, links each, and says what is and is not sent. `LAST_UPDATED` moved to 4 October 2026.

**Pinned by a test from the code's own list**: `tests/privacy-page.test.ts` reads
`BIBLIOGRAPHIC_HOSTS` in [`src/fetch.ts`](../../src/fetch.ts), the only hosts that fetcher will
dial, and requires the page to name each. A fourth index turns it red until the page names it.

## Quiz answers

**Stored since 2026-10-05, at Greg's request** — the reversal of a sentence this page had carried
since the review above: *"Quiz answers are the exception: they go to a model to be marked and are
not stored."* That was true until then. Greg, 2026-10-04 (report `spya-e8ujxn`):

> I think when I tried with the quiz, I answered a question or two and then came back to it and it
> looked like the answers had been thrown away. Is there a way for us to store those answers?

So each mark that finishes is one row in `quiz_attempts`
([`src/db/schema.ts`](../../src/db/schema.ts)): the reader's answer, the reply it was given, the
question's words and when. The page's *What you write* bullet lists them and the exception sentence
is gone; `LAST_UPDATED` moved to 5 October 2026. The plan is
[261005b](../plans/261005b-quiz-answers-are-kept-and-restored.md); how it behaves is
[quiz.md § Answers are kept](quiz.md#answers-are-kept).

What the code has to keep true for the page to stay honest:

- **Whether an answer was judged right or wrong is still not stored**, and not logged. The table has
  no column for it; the hidden verdict lives in the panel for the length of a visit, as before
  ([quiz.md](quiz.md#whether-the-reader-got-it-right-is-asked-somewhere-else)).
- **Neither the answer nor the reply is logged** — the route reports a failed save with the slug
  and nothing else, and the store is guarded so a failed query's parameters do not reach an error.
- **Owner-only.** The owner's read returns them; the public page has no quiz and its queries never
  name the table (`tests/public-reads.test.ts`).
- **They go when the article does** (a cascade from `articles`), and they are in both exports —
  including answers to a batch of questions that has since been rewritten, which the panel no
  longer shows.

`tests/privacy-page.test.ts` holds the page to it: the old sentence must be gone and the new clause
there.

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

**One model is named generally, by Greg's decision.** High-powered AI's model appears as "Opus or a
similar frontier model", not as `claude-opus-5-5`. Greg, 2026-09-30: *"approved changes to Privacy
(though keep it a bit general, e.g. "Opus or similar frontier model")"*. The test keeps a short table
of approved general wordings (`GENERAL_WORDING`), so that model is still covered. Editing the
sentence away turns the test red, exactly as dropping an id would. Add to that table only with
Greg's say-so.

**The inventory had a hole, found the same day.** Illustrated's painter,
`google/gemini-3.1-flash-image` (`IMAGE_MODEL`, `src/illustrated.ts`), was sent text and images and
was in neither `DISPLAY_NAME` nor the page. It is in both now, and `tests/models.test.ts` lists it
among the sendable models. GPT Sol, [260930k](../plans/260930k-high-power-for-readers-and-cost-only-for-admins.md).

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
  Google, Sentry, Stripe, Resend
- the **regions** change, or an article's bytes start living somewhere other than
  Supabase Storage in London ([database.md](database.md))
- **retention** changes anywhere — Sentry's 30 days, Vercel's ~1 day of request logs
- the **zero-retention** claim: `zdr: true` is now set on **nothing** (`AI_JOB_ROUTE` in
  [`src/ai-call.ts`](../../src/ai-call.ts)). It was dictation's alone until 2026-09-07 — see
  § Where a reader's voice goes below, which is the one place on this site where we tell a reader
  that something got weaker — [ai-gateway.md § A key is not
  access](ai-gateway.md#a-key-is-not-access-and-the-difference-is-invisible-until-a-reader-finds-it)
- **account deletion** or **export** grows a button, which changes decision 2 above. **The
  per-article half of that happened on 2026-09-07 and the page was rewritten in the same run** —
  § *Deleting an article, for good* above is the record of what moved and what deliberately did not.
  What is still open here is the other two: account deletion is a mailbox and a pair of hands, and
  the page says so; export has had a button since before this section was written and the page has
  never mentioned it either way
- **what Archive and Delete permanently do, and the difference between them** — Archive archives,
  it has been called Archive since 2026-09-04, and *Deleting things* on the page now describes both
  controls: Archive is reversible and destroys nothing, Delete permanently erases the article and
  everything made from it with no undo, and neither can reach a copy already downloaded to a device.
  Rewrite that section if either control changes what it does. The page also says what archiving
  does to an article that was *shared*: it drops
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
  schema `CHECK` and a browser gesture respectively, and neither is a preference. Since 2026-09-13
  the key clauses of its last paragraph — that a report may carry the reader's own article, and the
  screenshot caveat — are pinned in `tests/privacy-page.test.ts`, as is the absence of the old
  "never carries the text of the article" promise; the rest of the section is still prose to re-read
- what the **browser** keeps — the page names the session, a few preferences, and the offline
  IndexedDB cache of article bodies in [`src/web/lib/offline-store.ts`](../../src/web/lib/offline-store.ts),
  which is dropped for that account on sign-out — and, since 2026-09-29, a dictation not yet
  transcribed ([`src/web/dictation-keep.ts`](../../src/web/dictation-keep.ts)), dropped on Sign out
  or after a week. The first draft claimed the session was the only
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
