# How other products handle logged-out, read-only access

What this is: research into how comparable platforms draw the line between what a stranger with no
account can see and what only a signed-in user gets, done ahead of designing Spideryarn's public
"world-readable" doc feature. Organised by decision, not by company.

## Login walls hurt reach, and get walked back

Twitter/X is the clearest case study. In late June 2023, Twitter started blocking logged-out users
from viewing tweets and profiles, then added daily read limits, both described by Musk as anti-scraping
measures ("We were getting data pillaged so much that it was degrading service for normal users!").
The effect on search was immediate and measurable: Google's index of tweets dropped more than 60%,
from 471 million to 180 million, and Twitter lost over 2,200 keywords from Google's first page
([Search Engine Journal](https://www.searchenginejournal.com/twitters-google-rankings-plummet-following-actions-by-elon-musk/490779/),
[Search Engine Land](https://searchengineland.com/twitter-didnt-just-block-unregistered-users-it-blocked-google-search-428943)).
Twitter silently reversed the outright block within days
([TechCrunch](https://techcrunch.com/2023/07/05/twitter-silently-removes-login-requirement-for-viewing-tweets/)),
then settled into a middle pattern that has persisted since: a modal appears after a guest scrolls a
certain amount, but the tweet content itself is visible underneath it, so crawlers can still read it
([Search Engine Journal](https://www.searchenginejournal.com/twitters-google-rankings-plummet-following-actions-by-elon-musk/490779/)).
By 2025–2026, X had quietly loosened this further — many individual tweets load for logged-out
visitors without a forced sign-in at all, undoing the most aggressive form of the wall without
announcing it
([positioniseverything.net](https://www.positioniseverything.net/twitter-reverts-login-requirements-for-tweet-viewing-without-any-announcement/)).

Reddit ran a related experiment: in 2023 it blocked most search engines other than Google (which had
paid $60M/year for a data licensing deal) from crawling and indexing it at all, on top of the API
pricing change that caused the "blackout" protest where ~8,000 subreddits went private
([Wikipedia: Reddit API controversy](https://en.wikipedia.org/wiki/Reddit_API_controversy),
[Yahoo/compareinternet coverage](https://tech.yahoo.com/ai/article/search-engines-that-dont-pay-up-cant-index-reddit-content-172949170.html)).
Quora's older, harsher pattern — block reading past the first answer without an account — produced a
years-long stream of complaints and workaround guides, and unlike Twitter it never walked the wall
back; commentators repeatedly contrast it with Stack Overflow, which never gated reading at all
([How-To Geek](https://www.howtogeek.com/186954/bypass-quora-login-and-see-all-answers/)).

**Takeaway:** every company that hard-walled logged-out reading either reversed it or kept paying an
ongoing SEO and goodwill cost for it. None of this is our situation directly — we're not fighting
scraping at Twitter's scale — but it's strong evidence that gating the *reading* of already-generated
content, as opposed to gating new work, is the move that specifically backfires.

## Public-by-default and what still gets gated

Bluesky was built to be public by default: posts, profiles, and likes are treated as public data, and
much of the read API (`public.api.bsky.app`) requires no authentication at all
([Bluesky docs, API Hosts and Auth](https://docs.bsky.app/docs/advanced-guides/api-directory)). When
Bluesky announced a logged-out web interface in November 2023, before it had shipped any way to make
an *individual account* private, users revolted — not against public access in the abstract, but
against having no per-account opt-out before the public surface went live
([TechCrunch](https://techcrunch.com/2023/12/06/bluesky-says-it-will-allow-users-to-opt-out-of-the-public-web-interface-after-backlash)).
Bluesky's fix was to ship a per-account "opt out of the logged-out view" toggle before turning the
public interface on, while being explicit that the toggle only binds Bluesky's own web client — it
cannot be enforced against third-party AT Protocol apps, because the underlying data is public on the
network regardless
([TechCrunch](https://techcrunch.com/2023/12/06/bluesky-says-it-will-allow-users-to-opt-out-of-the-public-web-interface-after-backlash),
[isp.page summary](https://isp.page/news/bluesky-says-it-will-allow-users-to-opt-out-of-the-public-web-interface-after-backlash/)).

**Takeaway:** the backlash wasn't "don't make things public" — it was "don't flip a default that
changes an existing user's exposure without them choosing it first." Spideryarn's design (owner ticks
a box per document) already matches the model Bluesky landed on, not the one that caused the
complaints.

## Link-sharing products: secrecy of the URL vs an explicit flag, and what the viewer sees

- **Notion**: "Share to web" is an explicit per-page toggle; once on, anyone with the link can view
  without a Notion account, and separate toggles control comment/edit/duplicate and (on paid plans)
  search-engine indexing and link expiry
  ([Notion Help](https://www.notion.com/help/sharing-and-permissions),
  [Notion Help, sharing settings](https://www.notion.com/help/guides/understanding-notions-sharing-settings)).
  Indexability is opt-in and separate from visibility — a page can be link-accessible but not
  Google-findable.
- **Google Docs "Anyone with the link"**: the file owner's name/email is always shown as the doc's
  owner to anyone who opens it, signed in or not. A visitor with no Google account, or who is signed
  out, shows up to the owner as an anonymous animal avatar rather than a real identity — the privacy
  protection runs toward the *viewer*, not the owner
  ([Google Docs Help, anonymous or unknown people](https://support.google.com/docs/answer/2494888)).
  This is close to the inverse of Spideryarn's requirement (hide the owner from the stranger); it's
  useful mainly as a reminder that "who sees whose identity" is two separate questions, not one flag.
- **Figma**: "Anyone with the link" plus a view/comment/edit level is the whole model; on paid plans
  you can restrict a link to prototype-only viewing rather than the full design file
  ([Figma Help](https://help.figma.com/hc/en-us/articles/5726756336791-Manage-public-link-sharing-and-open-sessions)).
  Sign-in is not required to view — link possession is the credential, same shape as Notion.
- **Readwise Reader**, the closest analogue to Spideryarn: a reader who has highlighted/annotated a
  saved article can flip "Enable public link on web," which produces a distraction-free public page
  with the highlights and annotations overlaid, viewable by anyone with the link, no account needed
  ([Readwise Docs, Sharing](https://docs.readwise.io/reader/docs/faqs/sharing)). Reader also lets you
  publish a "bundle" — a filtered collection of saved documents — as its own public, linkable page.
  This validates the core shape of our plan (owner flips a switch on one document, non-owners get a
  read-only rendering of AI-added value like highlights) but Reader's own docs don't say anything
  public about how it handles the underlying copyright question of re-hosting someone else's article
  text — I could not find a citable source on that point, so treat it as unresolved rather than
  assume Reader has solved it.

**Takeaway:** every one of these products uses "link possession is the credential," not a login wall,
for read-only sharing, and treats indexability as a separate decision from shareability. None of them
put the sharer's identity in front of a logged-out viewer by default (Google Docs does show it, but
only because the doc is the owner's personal file being *literally* handed over, not a product surface
being shown to the public) — supporting the "nothing about the owner" requirement in the brief.

## AI-cost gating for anonymous viewers: cached output yes, new generation no

This is the pattern closest to our actual constraint (spend nothing on a logged-out view), and the
evidence is thinner because it's usually undocumented product behavior rather than something companies
blog about.

- **ChatGPT shared links**: sharing takes a server-side snapshot of a conversation at share time; the
  link then serves that static snapshot to anyone, logged in or not, and continuing the conversation
  requires the viewer to have their own account — a new message starts a fresh conversation rather
  than extending the snapshot
  ([OpenAI Help Center](https://help.openai.com/en/articles/7925741-chatgpt-shared-links-faq)). This
  is exactly our target shape: serve the pre-computed artifact, block anything that would trigger new
  model spend.
  - The caution attached to this pattern: OpenAI's share links were, until August 2026, discoverable
    by search engines via a checkbox that many users didn't realize made the page indexable. Thousands
    of shared conversations — including ones with names, emails, resumes, health and business details
    — turned up in Google search results before OpenAI pulled the discoverability option entirely and
    began working with Google to de-index what had already been crawled
    ([Search Engine Land](https://searchengineland.com/google-indexing-shared-chatgpt-conversations-459839),
    [Bitdefender](https://www.bitdefender.com/en-us/blog/hotforsecurity/your-shared-chatgpt-chats-may-be-publicly-searchable-heres-how-to-delete-them)).
    The root cause reported was a missing `noindex`/robots restriction on the share pages combined
    with a checkbox default that was easy to misread as "share with the person I send this to," not
    "publish to the whole internet." OpenAI's fix was to kill the feature rather than patch the
    default.
- **NotebookLM public notebooks**: a notebook can be shared publicly with a link, viewable with no
  Google sign-in; Google's own description of the feature says a viewer can "ask questions or explore
  generated content, such as audio overviews, FAQs or briefing documents"
  ([blog.google](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-public-notebooks/),
  [9to5Google](https://9to5google.com/2025/06/03/notebooklm-public-links/)). Whether asking a fresh
  question against a public notebook triggers new generation for an anonymous visitor, or is served
  from cache/precomputed content only, is not stated anywhere I could find in Google's own
  documentation — this is a real gap, not a confirmed data point either way, and worth flagging as
  something to check directly (or assume the conservative reading: don't copy this pattern without
  verifying it doesn't let strangers spend your model budget by typing questions).
- **Perplexity**: logged-out ("anonymous") threads exist and are session-scoped — stored in the
  browser, expiring after 14 days, not tied to an account
  ([Perplexity Help Center](https://www.perplexity.ai/help-center/en/articles/12637451-where-did-my-threads-go)).
  I could not find any Perplexity documentation describing whether opening someone else's *shared*
  answer page as a logged-out visitor re-runs the query or serves a static cached render. Not
  citable either way — leaving it out of the recommendations below rather than guessing.

**Takeaway:** the one clean, documented precedent for "logged-out visitor sees AI output but can't
spend more AI budget" is ChatGPT's share-snapshot model — freeze the output at share time, serve it
statically, and require an account for anything that would call the model again. That maps directly
onto Spideryarn: render the article, ToC, summaries, glossary etc. that already exist; don't expose
any endpoint that generates more.

## `rel=canonical`, noindex, and the choice to be found

I could not find any first-party writing from Readwise, Instapaper, Pocket, or Matter about whether
their public article pages carry `rel=canonical` back to the original publisher or claim canonical
status for themselves — this looks like an undocumented implementation detail across the category, not
a settled public debate. The general SEO guidance (not specific to reader apps) is that a page hosting
someone else's syndicated content should canonicalize to the original to avoid competing with it and
to avoid duplicate-content penalties
([Yoast, rel=canonical guide](https://yoast.com/rel-canonical/); [Google Search
Central](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)).
Given we don't have a reader-app-specific precedent, this is inference from general SEO practice, not
a sourced product decision — flagged as such.

Separately, `noindex` and shareability are independent controls in every product above: Notion makes
indexing an explicit opt-in separate from "share to web"; Google's own guidance is that `noindex`
blocks *appearing in search results* but not *crawling*, so a page can still be reached and read by a
bot even when excluded from the index
([Google Search Central](https://developers.google.com/search/docs/crawling-indexing/block-indexing)).
The ChatGPT incident above is the cautionary tale for what happens when "shareable via link" and
"indexable by search engines" get conflated in the UI, either by a confusing checkbox or by shipping
without a `noindex` header at all.

## Signup conversion from a shared/gated page: soft beats hard, registration beats paywall

- **Metered vs. hard paywalls**: metered paywalls consistently convert better than hard walls for
  first-time visitors; the Lenfest Institute's cited figure is that a well-tuned meter converts
  5–10% of the most engaged readers to paid
  ([theaudiencers.com](https://theaudiencers.com/decisions/the-new-york-times-dynamic-paywall-model-analyzed/)).
  The New York Times moved from a fixed meter to a machine-learned "Dynamic Meter" that sets a
  personalized limit per reader, and reports registration (free account creation, not payment) alone
  raised conversion to paid by more than 40% in its 2022 annual report
  ([theaudiencers.com](https://theaudiencers.com/decisions/the-new-york-times-dynamic-paywall-model-analyzed/)).
  That's a useful distinct data point: the biggest lift came from getting people to make a free
  account at all, before ever asking them to pay.
- **Backlash pattern for hard walls**: the throughline across Medium, Quora, and the WSJ's original
  1996 hard paywall (the first of its kind) is that blocking reading entirely, rather than metering or
  previewing it, produces durable user resentment and bounce, and specifically breaks the ability for
  people to discuss or link to an article at all, which is often the thing driving the traffic in the
  first place
  ([Medium/Kavindu Narathota](https://blog.narathota.com/medium-you-let-me-down-so-no-more-paywall-8bf9258f2efd),
  [Center for Media Engagement](https://mediaengagement.org/research/the-ethics-of-news-paywalls/)).
  Medium's own metered model still gets criticized because most people arriving from Google, social,
  or a shared link are non-members, so a tight meter kills the click-through value of the link itself
  — several writers have manually un-paywalled their own posts in response
  ([byburk.net](https://letters.byburk.net/p/should-you-paywall-your-medium-articles)).
- **Substack** leans on a different lever entirely for conversion: rather than tightening the wall, it
  encourages writers to let free readers subscribe to *free* updates by email as an intermediate step,
  explicitly framed as building a repeated-touch relationship before ever pitching paid
  ([on.substack.com](https://on.substack.com/p/free-vs-paid)). This is closer to what a "sign up"
  (not "sign up to unlock this specific page") call-to-action should look like for us: an ongoing
  relationship, not a transaction gating this one document.

**Takeaway:** don't gate reading of the document itself — gate the *account-only actions*
(commenting, chatting, generating a new summary at a different granularity) and put the call-to-action
next to those actions, not blocking the prose. Consider a Times-style framing where the ask is
"create a free account" rather than "subscribe," since that's the step shown to move the needle most.

## Copyright / takedown posture for hosting someone else's article

Instapaper publishes a standard DMCA policy: a designated agent, the standard notice requirements, and
a stated policy of disabling/terminating repeat infringers
([instapaper.com/dmca](https://www.instapaper.com/dmca)). I could not find equivalent public policy
text for Pocket or a citable statement from Readwise on this specific point (their sharing docs
describe the feature, not the legal posture). The generic mechanism they're all presumably relying on
is the DMCA Section 512 safe harbor for online service providers — register a designated agent, respond
to takedown notices, terminate repeat infringers — which is the standard the U.S. Copyright Office
documents
([copyright.gov/512](https://www.copyright.gov/512/)). I'm not able to confirm from public sources
whether any of these products treat "here's Readability-extracted text of someone else's article,
rehosted at a public URL" differently from ordinary user-uploaded content for DMCA purposes; it's a
real open question, not one this research answered, and is worth a direct legal read rather than
inference.

## What this suggests for us

- **Don't wall off reading of the article or existing AI output.** Every product that hard-gated
  logged-out reading (Twitter's 2023 login wall, Quora, hard-paywall WSJ) either reversed it or kept
  eating an SEO/goodwill cost indefinitely. Gate the *account-only actions* (comment, chat, new
  generation), not the prose or the summaries that already exist.
- **Use link-possession as the credential, not login.** Notion, Figma, and Readwise Reader all let a
  stranger view via an unguessable-but-not-secret link with zero account — that's the shape to copy
  for "world-readable" documents, not a login wall with an exception list.
- **Freeze-and-serve, don't gate-and-proxy, for AI cost control.** ChatGPT's share model — snapshot
  the output at share time, serve that snapshot statically to anyone, require an account for anything
  that would call the model again — is the one clearly documented pattern that matches our "spends
  none of our AI budget" requirement. Copy it directly: no endpoint reachable by a logged-out visitor
  should be able to trigger generation.
- **Treat indexability as a separate flag from shareability, and default carefully.** Notion makes
  search-engine indexing an explicit opt-in distinct from "share to web." ChatGPT's actual incident
  (thousands of shared conversations, including sensitive personal content, turned up in Google search
  because a "make discoverable" checkbox was easy to misread) is the direct cautionary tale — don't
  make a world-readable doc indexable by default, and don't phrase the toggle ambiguously between
  "give this person the link" and "let Google crawl it."
- **The owner's identity should not reach the anonymous viewer.** No product researched puts the
  document owner's account, email, or profile in front of a logged-out visitor by product design —
  Google Docs is the one exception, but only because the doc *is* the owner's personal file being
  handed over, not a product surface shown to the public. This matches the "nothing about the owner"
  requirement already in the design.
  - **Canonicalize to the original article, not to us**, if we want to avoid competing with the
    source for search ranking — this is inference from general SEO practice (no reader-app-specific
    precedent was found), so validate against how it actually plays out once a doc or two is public
    and indexed, rather than treating it as settled.
- **Lead the signed-out call-to-action with "make a free account," not "subscribe" or "unlock this
  page."** The NYT's own reported number is that registration alone lifted paid conversion >40% —
  bigger than any meter-tuning change. Put the account-creation ask next to the account-only actions
  (comment, chat, new granularity), framed as joining an ongoing thing, the way Substack frames free
  email signup — not as a transaction blocking this one document.
- **A public doc must not expose a path to new generation**, including anything conversational (chat,
  Q&A) — NotebookLM's own docs don't say whether an anonymous visitor's question against a public
  notebook triggers fresh generation or serves cached output, which is exactly the ambiguity we cannot
  afford; whatever we ship should be explicit and auditable about this, not implicit.
- **Get a real legal read on the DMCA/copyright posture**, rather than assuming Instapaper's or
  Readwise's model of "we're just an OSP responding to takedowns" transfers cleanly — no source found
  either confirms or rules out that a Readability-extracted rehost of someone else's article is treated
  differently. Register a DMCA agent and have a takedown path ready regardless, since that's the
  minimum baseline every comparable product has in place.

Sources are cited inline above; nothing in this section states a number that wasn't attributed to the
document text it came from.

## The read-only state, in other people's words

What this section is: the literal copy and layout choices other products use for the moment a stranger
lands on a shared, read-only page — not whether to allow it (covered above), but what it says and looks
like once they're there.

### 1. The persistent read-only bar

- **Google Docs/Sheets/Slides**: a bar sits under the title showing the word **"View only"** (or
  **"Comment only"**) as a plain label, not a call to action. Clicking it, or a nearby prompt, surfaces
  a **"Request edit access"** button that emails the owner
  ([FAU help desk](https://helpdesk.fau.edu/TDClient/2061/Portal/KB/ArticleDet?ID=87949)). It is not
  dismissible — it's tied to the permission level, not a banner you close.
- **Notion**: public pages don't show a "view only" label at all. Instead the top-right corner of the
  page carries a **"Duplicate"** button (only if the owner has switched on "Duplicate as template" in
  Share → Publish → Site customization) — the read-only state is communicated by the *absence* of
  editing chrome, not by a bar saying so
  ([Notion Help, duplicate public pages](https://www.notion.com/help/duplicate-public-pages)). After
  duplicating, blocks the visitor didn't have permission to copy show up labeled **"No access"** inside
  their new copy — i.e. Notion tells you about the gap only at the point you hit it, not upfront.
- **Figma**: I could not find primary-source wording for Figma's own view-only/logged-out banner text
  (forum discussions confirm the mechanism — "anyone with the link" set to "can view" — but not the
  literal on-page copy); flagging as unsourced rather than guessing
  ([Figma Help, manage public link sharing](https://help.figma.com/hc/en-us/articles/5726756336791-Manage-public-link-sharing-and-open-sessions)).
- **ChatGPT shared links**: OpenAI's help page (`help.openai.com`) blocked direct fetch for me
  (403), so what follows is from indexed search snippets of that page, not a verified direct quote.
  Per those snippets, a shared link serves a static, non-continuable snapshot of the conversation to
  anyone with the link, and the creator's identity is not shown to the viewer by default
  ([OpenAI Help Center, shared links FAQ](https://help.openai.com/en/articles/7925741-chatgpt-shared-links-faq)).
  Treat the exact banner wording as unverified.
- **Craft**: publishing produces a live web page reachable by any browser; Craft's own docs describe
  publisher-side controls (a toggle to enable/disable visitor comments) but don't give the literal
  visitor-facing banner text
  ([Craft Help, Publish to Web](https://support.craft.do/hc/en-us/sections/15275755379612-Publish-to-Web)).
  Unsourced beyond that.
- **Coda**: I found no citable source — official docs or otherwise — for Coda's logged-out banner
  wording. Skipping rather than guessing.

**Pattern that does hold up across sources**: only Google Docs uses a literal, persistent, non-dismissible
label ("View only"). Notion and (as far as documented) Craft communicate read-only-ness by what's
*missing* from the chrome rather than a stated label — worth deciding deliberately rather than by
default, since a stranger who's never seen the editable version has no baseline to notice the absence.

### 2. Marking a disabled control, rather than hiding it — and real evidence against relying on a tooltip

This is the one place research turned up a direct argument against part of the plan as described.

NN/G's own tooltip guidance is explicit that a tooltip should never carry information a user needs to
complete a task: **"Important information should always be on the screen; therefore, tooltips shouldn't
be essential for the tasks users need to accomplish."** Their test is a single question — "is the
information in the tooltip necessary for users in order to complete a task?" — and if the answer is
yes, it must not live only in a tooltip
([NN/G, Tooltip Guidelines](https://www.nngroup.com/articles/tooltip-guidelines/)).

A design-practice piece that applies this directly to disabled buttons makes the point even sharper:

> "Don't use a tooltip to explain what's needed to enable the button. If the instructions are that
> important, don't hide them in a tooltip that the user has to hunt for or stumble upon by accident.
> Tooltips are not accessible by default."
> — [Unagi Software, "Should We or Should We Not Disable a Button?"](https://unagisoftware.com/articles/should-we-or-should-we-not-disable-a-button/)

Its recommended alternative is layered, always-visible text: a short explanation placed near the
control up front (not hidden), rather than a tooltip a visitor has to discover by hovering — and it
specifically flags that hover tooltips are not reliably reachable on touch devices or by
keyboard/screen-reader users at all.

NN/G's own separate treatment of disabled buttons focuses on the *visual* signal (desaturated color,
lower contrast, `aria-disabled="true"` in the markup) and stops short of prescribing tooltip vs. inline
text as the explanation mechanism
([NN/G, Button States: Communicate Interaction](https://www.nngroup.com/articles/button-states-communicate-interaction/)).
So the disable-vs-hide question itself isn't settled by NN/G — dimming instead of hiding is a
defensible, commonly-used pattern — but the *tooltip-as-the-only-explanation* part of the plan runs
directly against NN/G's stated tooltip rule and against the more specific button-disabling guidance
above. If the reason a control is dimmed ("you need an account to comment") is worth telling someone at
all, accessibility guidance says it should not live in a hover-only tooltip alone — put it somewhere
visible without hovering (inline label, adjacent text, or triggered on click/tap as well as hover), or
treat the tooltip as a supplement to visible text rather than the only carrier of the explanation.

I found no published conversion-rate comparison of disabled-and-labeled vs. hidden controls
specifically; the sources above are usability/accessibility guidance, not A/B-test numbers, and I'm not
aware of one that exists publicly — noting the gap rather than inventing a number.

### 3. The sign-up call to action: placement, timing, wording

- **General popup/CTA conversion benchmarks** (not specific to reading a shared document, so treat as a
  rough directional signal, not a prediction for our product): a 2025 benchmark of over 10,000 campaigns
  found modal/fullscreen popups convert higher than sticky banners — desktop modals around 4.44% vs.
  slide-in banners around 3.49%, and mobile modals around 7.39% vs. mobile slide-ins around 4.2%; the
  same report found scroll-triggered popups converting around 5.37% and exit-intent popups averaging
  2.81%, with the best-performing exit-intent campaigns reaching much higher
  ([Popupsmart, Popup Conversion Benchmark Report 2025](https://popupsmart.com/blog/popup-conversion-benchmark-report),
  via [Wisepops data cited in Crazy Egg's popup roundup](https://www.crazyegg.com/blog/popup-statistics/)).
  These numbers are from marketing/e-commerce popups in general, not reader products specifically —
  don't treat them as the expected conversion rate on a shared-article page.
- **The New York Times' own reported number is the most directly relevant data point found**: making a
  *free account* (not paying) was, on its own, associated with a **>40% increase in conversion to paid
  subscription**, larger than any change the Times made by tuning how many free articles the meter
  allowed ([theaudiencers.com, NYT dynamic paywall analysis](https://theaudiencers.com/decisions/the-new-york-times-dynamic-paywall-model-analyzed/)).
  This argues for putting "make a free account" in front of people early and often, rather than saving
  the ask for a hard wall.
- **Wording actually used in the wild**: Medium's block, quoted verbatim from a reader's own account of
  hitting it, reads **"You've read all of your member-only stories this month. Become a member to read
  and support the writers and publications uncovering new insights in the topics that matter to you."**
  ([devRant post quoting the Medium paywall text](https://devrant.com/rants/4196423/curious-about-programming-you-ve-read-all-of-your-member-only-stories-this-month)).
  Note what it does: names the limit hit, then reframes the ask as supporting the writer, not just
  unlocking content.
- **Substack's pattern is structurally different and closer to what fits us**: rather than tightening a
  meter, its own writer-facing guidance pushes "free updates by email" as the mechanism for turning a
  one-time reader into a repeat one, explicitly building an ongoing relationship before ever pitching
  paid ([on.substack.com, "Free vs. Paid"](https://on.substack.com/p/free-vs-paid)). The literal
  framing used there is signing up for **updates from this writer**, not "create an account to keep
  reading this page."
- I could not find a source giving inline-next-to-the-blocked-control vs. persistent-banner vs.
  modal-on-scroll conversion numbers for a *reading* product specifically (as opposed to e-commerce/lead-gen
  popups above) — this is a real gap, not a settled comparison.

### 4. What a shared page says about who shared it

- **Google Docs** is the one product researched that does show ownership to anyone who opens the link:
  Google's own help text states plainly, **"When you share a link to a file, your name and email will
  be visible as the owner of that file"** — this is a stated design choice, not an oversight
  ([Google Docs Help, sharing files](https://support.google.com/docs/answer/2494822)). It runs the
  privacy protection the other way: the *owner* sees anonymous visitors as unnamed "anonymous animals"
  when they're not signed in, but the *visitor* always sees who owns the doc
  ([Google Docs Help, anonymous or unknown people](https://support.google.com/docs/answer/2494888)).
- **Notion, Figma, ChatGPT, Readwise Reader, Craft**: none of the sources found for these describe
  showing the sharer's name, avatar, or account to an anonymous viewer as a default, product-level
  behavior. For ChatGPT specifically, indexed search snippets of OpenAI's own help page describe shared
  links as anonymous to the viewer by default (not independently verified by direct fetch — see caveat
  in section 1) ([OpenAI Help Center](https://help.openai.com/en/articles/7925741-chatgpt-shared-links-faq)).
  I could not find documentation, for any of these, of exact tab-title or page-title wording shown to a
  logged-out visitor (e.g. whether the browser tab says the document's own title, or something like
  "Shared document — Notion") — flagging as unsourced rather than guessing at copy.

**Pattern**: withholding the owner's identity from the anonymous visitor, which is what the brief
calls for, is the majority pattern among the products researched, not an unusual choice — Google Docs is
the outlier, and it's an outlier for a specific reason (the doc is literally the owner's personal file
being handed over) that doesn't apply to a product-level "shared documents" surface like ours.

### 5. Three empty states that must not blur together

The three we need — **not generated yet** / **not available to this visitor** / **not shared by the
owner** — map to real, distinct situations other products handle, though I could not find a single
product that documents all three with clean, separate wording in one place; the closest matches are
scattered across different products handling one situation each:

- **"Not shared" / access removed, after having existed**: Dropbox's own help text for a link to a
  file that's been deleted says plainly that **"Your shared link won't work if the file or folder was
  deleted"** — a statement about the *link*, not a friendly empty-state sentence for the person who
  just clicked it ([Dropbox Help, common sharing errors](https://help.dropbox.com/share/sharing-error)).
  Notion's equivalent, per its own docs, is blunter still: unpublishing a page makes anyone who clicks
  the old link land on a plain **404, "page could not be found"** — no distinction is drawn, in what
  Notion documents, between "never existed," "was unpublished," and "you don't have permission"; they
  all collapse into the same 404
  ([super.so FAQ on Notion 404s, describing the behavior](https://super.so/faqs/pages-not-displaying-or-404-error)).
  This is the failure mode to avoid: Notion's own collapse of three different situations into one
  generic 404 is the "get it wrong" example the task asked for, not a model to copy.
- **"Not available to this visitor" (permission-based, not existence-based)**: Loom draws this
  distinction more carefully than Notion does. Per its own support documentation, a video blocked by
  privacy settings shows: **"Sorry, Due to the privacy settings for this video, it cannot be played
  here at this time."** — and separately, a private video a visitor lacks permission for offers a
  **"Request Access"** action, distinct from the deleted/broken-link case
  ([Loom/Atlassian Support, privacy settings](https://support.loom.com/hc/en-us/articles/360016527597-How-to-use-Loom-s-privacy-settings)).
  This is closer to what "not available to this visitor" should sound like: it names the cause
  (privacy settings, not "not found") and it's explicit that the content exists but access doesn't.
  Google Docs does the same thing structurally with **"View only"** plus **"Request edit access"** —
  naming the boundary and offering the one action available across it, rather than a bare error
  ([FAU help desk](https://helpdesk.fau.edu/TDClient/2061/Portal/KB/ArticleDet?ID=87949)).
- **"Not generated yet" (nothing to show because the pipeline hasn't produced it)**: I found no
  citable example of a product stating this as a distinct third case, separate from "not shared" and
  "not permitted" — most of the products researched only have two states (shared/not) because they
  don't have Spideryarn's multi-stage AI pipeline sitting behind the content. This third state looks
  like it doesn't have a borrowable precedent; it may be genuinely specific to a product like ours where
  the underlying artifact can simply not exist yet, independent of any permission question.

**Recommendation implied by the evidence**: name the *cause*, not just the absence, in all three —
Notion's 404 is the example of what happens when you don't (three different situations reading as one
generic "nothing here"), and Loom/Google Docs are the examples of what happens when you do (the message
tells you which of several distinct reasons applies).

### 6. Revocation, said honestly

- **What the owner is told about what unsharing removes**: none of Notion, Google Docs, Figma, or
  Dropbox's own documentation, in what I could find, states plainly that a page a visitor already has
  open in their browser keeps whatever bytes already loaded — the documentation instead describes what
  happens on the *next* load. Google's own support text for a deleted/unshared file says a visitor who
  tries to open the link **"will see a message that lets them know that you have deleted the
  document"** — describing the next-request behavior, silent on what's already rendered in a tab that
  hasn't been reloaded
  ([Quora, citing the observed Google Docs behavior](https://www.quora.com/How-do-you-unshare-a-Google-doc-after-it-is-sent) —
  secondary source, treat accordingly; I could not find this specific behavior documented on a Google
  help page directly).
- **What the still-reading visitor is told**: Loom's **"cannot be played here at this time"** message
  and Notion's 404 are both next-load messages, triggered when the visitor's client re-requests the
  resource — neither product, in its own docs, describes actively pushing a "this was just unshared"
  notice to a tab that's already open and not making a new request.
- **The honest gap**: I could not find a single product, across everything researched, that says
  outright — to either the owner or the visitor — that unsharing cannot claw back a page already loaded
  in someone's browser, a screenshot already taken, or text already copied. Every source describes
  revocation only in terms of the *next* request being blocked. If Spideryarn states this plainly (a
  page already loaded keeps its bytes; revoking stops new loads, not past ones), that would be more
  candid than any precedent found in this research, not less — worth doing, but recognize it as not
  copying an existing pattern.

### 7. The share toggle itself, on the owner's side

- **Notion**: the control lives under Share → Publish, with a toggle literally labeled **"Duplicate as
  template"** governing whether visitors get a Duplicate button; site-level indexability is a separate,
  later-mentioned option (**"enable search engine indexing"**, gated to the Plus plan and above) — i.e.
  indexability is visibly a distinct control from shareability, not bundled into one switch
  ([Notion Help, duplicate public pages](https://www.notion.com/help/duplicate-public-pages);
  [Notion Help, sharing and permissions](https://www.notion.com/help/sharing-and-permissions)).
- **Google Docs**: the share dialog's access-level control is labeled **"Anyone with the link"**, with
  role labels exactly **"Viewer," "Commenter," "Editor."** The warning shown is the same ownership
  disclosure quoted in section 4 above — **"When you share a link to a file, your name and email will
  be visible as the owner of that file"** — delivered as informational help text rather than a
  blocking confirmation dialog at the moment of toggling
  ([Google Docs Help, sharing files](https://support.google.com/docs/answer/2494822)).
- **Figma**: the mechanism is "Anyone with the link" set to a permission level (view/comment/edit); I
  could not find Figma's own source for the literal warning copy shown when a link is switched to
  public — flagging as unsourced.
  ([Figma Help, manage public link sharing](https://help.figma.com/hc/en-us/articles/5726756336791-Manage-public-link-sharing-and-open-sessions)).
- **ChatGPT**: as covered in the first report, the discoverability checkbox that made shared links
  indexable by search engines was removed entirely in August 2026 after the indexing incident — OpenAI's
  fix was to delete the control rather than reword its warning
  ([Search Engine Land](https://searchengineland.com/google-indexing-shared-chatgpt-conversations-459839)).
  So "current wording" for that specific control no longer exists to quote — the feature it belonged to
  is gone.
- **Readwise Reader**: the control is a menu item, **"Enable public link on web"** (or, with
  annotations included on mobile, **"Share with annotations"**) — the exact labels given in Readwise's
  own docs. No warning text is quoted or described in that documentation
  ([Readwise Docs, Sharing](https://docs.readwise.io/reader/docs/faqs/sharing)).

**Pattern that holds**: every product that documents this control separates *shareable* from
*indexable* as two decisions (Notion explicitly; ChatGPT's incident is what happens when a product
blurs that line). None of the sources found show a hard confirmation/warning dialog gating the moment
you flip a doc public — the disclosure, where it exists at all (Google Docs), is inline help text, not
an interstitial you must click through. Worth deciding deliberately whether Spideryarn wants to be more
cautious than that norm, given the brief's own care about the owner's exposure.
