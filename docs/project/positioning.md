# Positioning and the website

What the website says, who it says it to, and what it is called — the decisions, with Greg's words
beside each one. The long form, with every source and every tagline ever proposed, is
[260902k-spideryarn-reading-intent-brief.md](../research/260902k-spideryarn-reading-intent-brief.md);
this doc is the part of it that has been decided. The copy itself does not live here: it lives in
[`src/web/LandingPage.tsx`](../../src/web/LandingPage.tsx) and, when there is one, the marketing
site.

**Everything here is downstream of [vision.md](vision.md).** A sentence of copy that breaks one of
its principles is wrong even if it converts.

## The name

> It's a long story re the origin of Spideryarn. It was originally a note-taking app, with the idea
> of a web of ideas and stories weaving together, but still feels relevant. I'm reusing it as a
> name/brand for a bunch of experimental projects. This is the primary one right now. So let's go
> with spideryarn.com but with most of the reading-related stuff under /read and the main title on
> the homepage "Spideryarn Reading" (which is also helpfully explanatory for a brand-new user).
>
> — Greg, 2026-09-02

So: **Spideryarn** is the umbrella brand, a web of ideas and stories weaving together; **Spideryarn
Reading** is this product and the homepage title; the domain is `spideryarn.com`, and the reading
app sits under `/read`. The orange, `#DB8A45`, and the wordmark predate both apps — the oldest logo
file is from September 2020.

## Who the homepage speaks to first

**The general deep reader**: someone who has to read difficult non-fiction and needs to actually
understand it. Greg's 2025 list of who that is: *"academics, researchers, editors & reviewers,
journalists, strategists, politicians, investors, commentators, leaders — anyone who needs to read a
lot of non-fiction."* The copy **names fields as well as genres** — scientific papers, philosophy,
policy, long essays — rather than staying general (Greg, 2026-09-02, chose "name fields too").

Peer reviewers were the 2025 way in and are a built mode now, but they are not the front door. Their
material is kept for a page of their own:
[referee-mode.md § Website copy notes](referee-mode.md#website-copy-notes-kept-for-later).

## Depth, and efficiency

> time-saved is acceptable, but don't emphasise it. "more deeply & efficiently" feels right for now.
>
> — Greg, 2026-09-02

The 2025 tagline file's first line, *"Spideryarn — to help us read more deeply & efficiently"*, is
still the shape of the promise. Depth is the headline; efficiency is allowed, in the sense
[vision.md § Principles](vision.md#principles) gives it — less time on the parts you didn't need —
and never as a number. *"Review papers 3x faster"*, from the 2025 guidelines, is the kind of line
that does not come back.

## What the copy assumes about the product

> we should write the copy as if we're in Beta and taking payments.
>
> — Greg, 2026-09-02

The site is written for the product as it is about to be — Beta, sign-up open, paid — not for the
alpha behind an invite list that the landing page describes today. Stripe payments are being built;
public-readable articles and the first real users are the next milestones. Price is not decided; the
2025 thinking was $20 a month for as many articles as you like, paid by individuals first and
institutions later.

## Chat, on the site

Chat and live conversation appear **far down, framed as "ask in place"** — after zoom, glossary,
search and remember, named for what the reader does, never in the headline. The reason is the
anti-goal in [vision.md § Anti-goals](vision.md#anti-goals) and the defence in
[chat-tools.md](chat-tools.md): the article never leaves the screen and every claim links back.

## Evidence, and where it goes

The research that AI summaries hurt skilled readers most, and that full text first removes the
deficit, stays in [docs/research/](../research/260831e-helping-peer-reviewers/prior-art-and-cognitive-offloading.md)
for now. Greg, 2026-09-02: *"For now, let's just add this to docs/research/, and eventually we'll
add blog posts and/or pages that describe the thinking/evidence behind our product decisions."* Not
on the homepage.

The old version's own marketing material — Greg's 2025 vision doc, his taglines, a dictated
conversation with an AI marketing persona, and six AI research reports — is copied verbatim into
[docs/research/260902k-old-version-materials/](../research/260902k-old-version-materials/README.md),
because the old repo exists only on Greg's Mac. Each file says who is thought to have written it;
none of it is his word on the website until he has read it again.

## Whose words

> I want it to use my words rather than AI-generated, and it may not be clear what came from me vs
> AI. So for now, I'd say let's try and take notes on all the core ideas/concepts, and you can
> interview me and I'll use voice-dictation to breathe life & lyricism in.
>
> — Greg, 2026-09-02

Two rules follow. **Copy is built from Greg's dictated words**, not drafted by an agent and approved.
And **provenance is kept**: every doc about positioning marks which sentences are Greg's and which an
agent wrote, so the two cannot be confused later. The current landing page's best lines — *"AI that
helps you read harder things, not fewer of them"*, *"a door into the prose, never a wall in front of
it"* — are agent-written and are placeholders until the interview replaces them. The interview guide
is [260902k-spideryarn-reading-interview-guide.md](../research/260902k-spideryarn-reading-interview-guide.md).

Voice, as far as it is decided: closest to confident and plain, short sentences, the author's words
on the page; not the warm "we understand how frustrating" register of the 2025 guidelines.

## The principle behind the copy

The line between augmenting and automating, and why the site never sells ease. From notes Greg
dictated before 2026-09-03, stored in full in
[260902k-greg-notes-the-edge-between-ease-and-difficulty.md](../research/260902k-greg-notes-the-edge-between-ease-and-difficulty.md):

> it's always going to be tempting to move towards automation. And that's always going to be easier
> for the human, easier indeed for the product designer, and tempting. I guess we want to hold some
> kind of line. … The best one I have in my mind is: **what will help the human to best form their
> own rich updated internal representations?**
>
> you can go to the gym or you can buy a forklift truck to lift the weights. But if you buy the
> forklift truck that lifts the weights, then you atrophy.
>
> if I had 1 guiding hunch, it's that we want to be at a kind of edge between ease and difficulty
> where things are difficult enough that they have to work, but not so difficult that they give up
> or fail. … our goal is to make things easier where we can, but not too easy.
>
> — Greg, dictated before 2026-09-03

For the copy this means: the promise is never "less effort". It is effort spent where it counts —
the drudge made cheap so that the understanding gets more of you — and a product that does not lift
the weights for you. "A companion, not a replacement" is this principle in five words.

## What has been built from it

As of 2026-09-03, after four of the fourteen interview questions: the homepage
([`LandingPage.tsx`](../../src/web/LandingPage.tsx)) rewritten in Greg's words, and a features page
at `/features` ([`FeaturesPage.tsx`](../../src/web/FeaturesPage.tsx)) with a screenshot of every
mode and the plans. Each sentence in both files carries a comment naming its source or marking it
as tissue. The plan, with the lead-shot call and the simpler options passed over, is
[260902k-website-copy-homepage-and-features.md](../plans/260902k-website-copy-homepage-and-features.md);
the site-text rules are in [website-text.md](website-text.md).

## What is still open

The strapline (the page uses *"Read deeply & efficiently"*, the 2025 tagline file's first line,
until Greg answers question 14), the ten unanswered interview questions, and a waitlist that is
more than a `mailto:`. When the interview resumes, its answers go here and the `[tissue]` lines
on the pages go.

---

Up: [vision.md](vision.md)
