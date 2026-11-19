# Sources digest: acting on Greg's answers (principles, readers that search again, layout choices)

Written 2026-10-31. Acts on Greg's reply `spya-dvq5b4` to question
[q-v03wmh](../user-feedback/questions/q-v03wmh.md), about report `spya-vqmfrs` and the digest built in
[261030b](261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md). Queue item
`qi-qgqzgq6v`, session `fbvqmfrs-digest-answers`.

> 1 A
> 2 not sure, maybe B? what do you think is best for the user?
> 3 I don't really understand what you're asking. It's too hard to make sense of it without either an
> example or an ASCII diagram or something. So maybe try and build it yourself. Try and take
> screenshots to see what you think. Ask other agents that are taking on the role of being the user or
> expert product manager and UI and UX designer. And I guess you know we'll probably continue to tweak
> it.
>
> — Greg, 2026-10-31 (`spya-dvq5b4`)

Prior work checked: the related queue items `qi-xgnn5fpb` (readers that search again), `qi-eerykqdn`
(the other layouts) and `qi-dykn3xjh` (measure a real run), and the planner fix from session
`fbf37ug4-digest-plan-no-questions` (`bcc7ab0e8`, plan 261031b), which touches the planner's prompt
only. Nothing here overlaps it.

## 1. The two principles: written

Into [principles.md](../project/principles.md) as 2 and 3, with the wording the question proposed,
which Greg said yes to.

## 2. May the readers search again? A for now; a narrow B′ only if the measurement asks for it

Greg leaned B and asked what is best for the reader. Asked separately, Opus
([261031d-q2-consult-opus.md](261031d-q2-consult-opus.md)) and GPT Sol
([261031d-q2-consult-sol.md](261031d-q2-consult-sol.md)) came back with the same answer, and I agree
with it:

- **What the reader gains from B is unmeasured.** The digest has never run live. Each lead already has
  one or two planned searches and up to eight pages, and what a reader would still dig into is shown
  under *More*, where the reader's own chat (with its own search) can dig on their press.
- **What the reader risks is trust, not money.** A page our first search returned could tell the reader
  model what to search for next, and the page it steers us to then passes the quote check honestly,
  because its words really are on it. The quote check proves the words are on the page, not that the
  page deserves weight. The spend is bounded by the caps and the rate bucket; the steering is not. The
  attacker does not ordinarily see the query (it goes to OpenRouter and Exa), but article words could
  be copied into it, which matters for a private upload.
- **It costs every reader about +30% and a second round of waiting**, on a run that is already the
  dearest and slowest press in the app.

So: **A for the first live version**. If the measurement (`qi-dykn3xjh`) shows depth is missing, build
**B′**, not B: a reader may pick one follow-up **from a closed set** (a work the planner already named,
or a returned result's own bibliographic record), and **code** writes the query from that item's
bibliographic fields; never model-written query words, never passage prose, never the profile; one
round, a small cap per run, the first pass banked if the follow-up fails, the new pages fenced and
quotes re-checked, and hostile tests seen red first. Opus also names a cheaper fix to try first: more
planned searches per lead, which crosses no boundary.

**What would justify B′**, read from the measurement: roughly 20% or more of leads ending *could not
tell* or with no checked quote **because one identifiable search was missing** (not a paywalled paper
or a reader's reasoning failure); a hand follow-up in chat on those leads that would change a verdict
or add a cited fact about half the time; and more planned searches per lead not closing the same gaps.

`qi-xgnn5fpb` is rewritten to B′ and to wait on the measurement rather than on Greg.

## 3. The three layout choices: A, A, A, and the sections parted

**How it was decided.** A Sonnet subagent screenshotted the digest as built (Playwright on the box,
desktop 1440×900 and phone 390×844), first on the 5-paragraph seed from 261030b and then, because a
real digest is two to three times that, on a realistic 12-paragraph seed (about 490 words) written
into the local database on `clark-chalmers-1998-spya-uwb4tn` under a new `generatedAt`, so the ask
box showed rather than an old chat's mark. Three Opus subagents, each given the screenshots, the
alternatives as ASCII sketches and one role, answered separately:
[the brief](261031d-q3-roleplay-prompt.md). The chat model was refused locally (the key is at its
limit), so the screenshots of a chat show an error where an answer would be.

```
                   3a where you ask      3b how long          3c after Ask
 a reader          A (box + per-para)    A (one level)        A (Chat's band)
 product manager   A                     A                    A
 UI/UX designer    A                     A                    A
```

- **3a, A: the box under the digest and each paragraph's button.** They do different jobs: the
  paragraph's button asks about one claim, the box the question that cuts across sections (*"Is
  Rupert's embedded reading the same objection as Adams and Aizawa's?"*), which is the one a reader
  has at the end. Summary has the same box, so dropping it here would make two modes differ on one job.
- **3b, A: one level, with More.** At about 490 words the digest is already the brief: the overview
  is the Brief and each More the Fuller. A Brief level would be a summary of a summary, a second text
  that can drift from the first, and about $0.35 more a run. The reader: *"the kind of AI shortcut I
  distrust."*
- **3c, A: Chat's band, then the mark.** An inline chat would be a second place in the app that draws a
  chat, would grow the column without limit, and would put the AI's conversation where the reader
  reads the digest. Every other mode's *Ask in chat* opens Chat's band.

So `qi-eerykqdn` (build the B layouts if Greg picks them) is dropped.

**Built: the four sections parted** (`src/web/styles/reception.css` § `.digest-section`). All three
named it first: in the 12-paragraph column the headings had barely more space above them than
paragraphs have between them, so the four sections read as twelve equal paragraphs. Now a rule and
about twice the space above each section, the heading tight to its first paragraph, and the headings
a step darker (`--ink-soft`) than the dossier's group labels, since here they are how a reader finds
their way back. Re-screenshotted: five blocks at a glance, no heading orphaned, no rule colliding
with *More*'s left rule, phone fine.

**Fixed: a citation that checks out is not *worth checking*.** The reader, on a seed paragraph saying
a figure *matches the cited study* under *Worth checking: citations that may not say that*: *"A
sentence saying a citation is fine, under a heading promising problems, made me trust the section
less."* The writer's prompt said what goes under `check` but never where a `says-it` verdict goes, so
a live run could do the same. One sentence added (`sources-digest/4`): one that checks out goes in
`cites` if it adds anything, or nowhere. Not measured, as nothing about the digest can be until the
key resets; `qi-dykn3xjh`, which measures the first live runs, now checks it.

**Raised, and not built here**, each for its reason:

- **The chat's first message buries the reader's question** (the reader and the product manager): the
  handoff fences the digest's text under the question, and Chat draws the whole message raw, `"""`
  included, scrolled to its end, so what is on screen is the tail of the digest. Every handoff in the
  app (Summary's paragraphs, the quiz, *does it say that*) is fenced the same way and drawn by the same
  Chat view, so the fix (fold the quoted context to a line under the question) is Chat's, for every
  origin. Queued as its own proposal, `qi-6dkr66v9`.
- **The box gives way to the chat's mark** (the reader: nowhere to ask a second, unrelated question).
  That is the house rule, one chat per item, and the mark reopens a chat whose own composer takes the
  next question; kept. The question to Greg described the mark as *"Continue the conversation"*,
  which it does not say: it shows the chat's count and gist, as every mode's mark does.
- **The twelve bordered chat squares**, the **passage-id chips** (the reader would rather see "§2
  Extended cognition") and the **on-screen tint**: all three reviewers' notes, and all shared controls
  every mode draws the same way
  ([controls.md § Controls that do the same job look the same](../project/controls.md#controls-that-do-the-same-job-look-the-same)).
  Not changed for one mode.

## Progress

- 2026-10-31: principles 2 and 3 written; question 2 decided with Opus and Sol.
- 2026-10-31: question 3 decided from screenshots and three role-play reviews; the sections parted
  in CSS; the writer's `check` rule (`sources-digest/4`). Typecheck and the digest suites green.
- 2026-10-31: GPT Sol's code review ([261031d-code-review-sol.md](261031d-code-review-sol.md)),
  *approve with changes*, three documentation findings, all fixed by Sol: D-01 (principle 3 kept to
  the approved wording alone), D-02 and D-03 (the consultations stated as each said them). Queue:
  `qi-xgnn5fpb` rewritten to B′ and gated on the measurement, `qi-dykn3xjh` told what to measure for
  it and to check the `check` rule, `qi-eerykqdn` dropped, `qi-6dkr66v9` added.
