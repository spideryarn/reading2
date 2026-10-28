# Feedback discussions, monospace mockups, and an admin mockups page

Report `spya-zytb0g` (#723), Greg, admin, filed as a suggestion on 2026-10-28; provenance proved by
`feedback-reporter.ts` (exit 0). No addenda at the start of the run. Session
`fbzytb0g-feedback-discussions-mockups`.

Status: **plan reviewed by GPT Sol (no P0; four P1s, all taken, below); Stage 1 building.**

## What Greg asked for

> In the feedback dialogue we have options for a problem or a suggestion. I guess I'd like to add a
> third for something like a question or a discussion where I'm going to ramble for a bit, raise some
> ideas, and I'm going to expect the model to come back with its own responses or proposals that
> we'll discuss some further, and then eventually go and build them.
>
> […] if you can see a way to improve it, I mean one really cool feature would be if the model could
> propose screenshots, or well at the very least ASCII text, but then it would need to be monospaced.
> […] I suppose it could create mockups somewhere at a particular URL that only admins can see.
>
> So actually maybe that would be a really good extra feature. It would be to create a
> /admin/mockups page with a table that can link out to particular mockups. And then the decision
> process for new ideas could reference these mockups. […] you could even try a few things and you
> know we'll compare and I'll say which I like.
>
> […] The machinery to make discussions back and forth better, so that I basically never have to
> open the terminal right now. Sometimes still things still get blocked, and I get the sense that the
> Overseer or whatever in the terminal doesn't always surface them as feedback. […] We make sure that
> anything that the Overseer needs to say to me can be said via this feedback machinery.
>
> — Greg, 2026-10-28 (`spya-zytb0g`)

Four asks, which this plan calls (a) a third kind, (b) better back-and-forth, (c) `/admin/mockups`,
and (d) the Overseer always able to reach him through Feedback.

## What already exists

- The dialog's kind toggle: `problem`, `suggestion`, or null (`FEEDBACK_KINDS`, src/types.ts; a
  `feedback_kind` CHECK in src/db/schema.ts; `KindHint` and `THANKS` in FeedbackDialog.tsx).
- Questions for an admin: a file under `docs/user-feedback/questions/`, published to production's
  `feedback_questions` with no deploy, answered or deferred in *Needs a decision*, read back with
  `feedback-questions.ts --answers` ([feedback.md § Questions for an admin](../project/feedback.md#questions-for-an-admin-and-replies-to-them-since-2026-10-07)).
  The body is plain text, drawn in the model's (proportional) face, with no markdown.
- Addenda to an admin's own open report.
- overseer.md already says *anything blocked on Greg goes out as a published question*. So (d) is not
  missing machinery; it is a rule that is not reliably followed. Evidence for how and why is gathered
  in Stage 4 before anything is changed.

## Stages, simplest and most valuable first

### Stage 1: a third kind, *Discussion*, for an admin (a)

- `FEEDBACK_KINDS` gains `discussion`; migration widens the `feedback_kind` CHECK (additive).
- **Only an admin is offered it, and only an admin may send it.** The button shows when the dialog's
  cosmetic `admin` flag is set; the route refuses `discussion` from anyone `isAdmin` says no to (400),
  since an ordinary reader has no way to read a reply, and a kind that promises a conversation
  nobody can hold is worse than none. Whether readers should get it later is noted for Greg, not
  built.
- Its own hint (think out loud; the reply comes back in *Needs a decision* as thoughts and proposals,
  and nothing is built until you say so) and its own thank-you.
- Every reader of `kind` that has a closed list is updated: Earlier tab, `/admin/feedback`, Sentry
  tag, admin mail, shipped emails (an admin never gets one, but the type must accept it), the sweep
  scripts.
- [feedback-reports.md](../project/feedback-reports.md) gains what an agent does with a discussion
  report: **no building on the first pass**. It answers with a question file (`report:` that id)
  holding its own responses and proposals, mockups where shape matters, and a recommendation; the
  report ends *Awaiting Greg*; the conversation goes on through replies; building starts when he says
  so, and the note's ending changes then. And its place in the priority bands (with an admin's
  suggestion).
- Tests: the store's CHECK test covers the new value; the route refuses it from a non-admin; the
  dialog shows the third button only for an admin.

### Stage 2: monospace blocks in a question (b)

- In a question's body, lines between two lines that are exactly ```` ``` ```` are drawn as a
  monospaced, horizontally scrolling block, line for line, so an ASCII mockup or diagram lines up.
  Everything else stays plain text. One shared component draws question text (and, in Stage 3, a
  mockup's text).
- The file compiler refuses an unclosed fence, as it refuses a second `Details` line.
- feedback-reports.md's body rule is updated to say so.
- This is the "at the very least ASCII, but then it would need to be monospaced" half, and it is live
  for every question the moment the deploy carrying it is.

### Stage 3: `/admin/mockups`, v1 from files in the repo (c)

- A mockup is a file `docs/mockups/m-xxxxxx.md` (header: `id`, `title`, `made`, `question`,
  `report`; body: plain text with the Stage 2 fences, and a line `image: <file>` showing an image that
  sits beside it, `docs/mockups/m-xxxxxx-*.png|jpg|webp`, capped in size).
- The server reads them from disk, as it reads `certs/` (`includeFiles` in vercel.json), behind the
  `/api/admin/` gate: a list, one mockup, one image. The pages are `/admin/mockups` (a table: id,
  title, date, the question and report it belongs to) and `/admin/mockups/m-xxxxxx`.
- In a question's text, an `m-xxxxxx` id is a link to its page (a fixed shape, so a link to nowhere
  else is impossible).
- A script, `scripts/mockups.ts`, prints a fresh id and checks every file (the test suite runs the
  check).
- **What v1 gives up: a mockup is visible after the next deploy**, not at once as a question is.
  Publishing mockups to the database like questions would make them live at once, but is a second
  kind of production write, which this run is not allowed to add and which needs Greg's yes. That is
  one of the Stage 5 questions.
- No HTML mockups served from our origin in v1: an image made from HTML (a Playwright screenshot of
  a wireframe in our own CSS, or of the real app on a branch) carries the same picture with nothing
  to execute.

### Stage 4: making sure the Overseer can always reach Greg (d)

First the evidence (an investigation of the Overseer's and other sessions' messages over the last
week: what needed Greg, and whether it was published). Then the change it supports. Candidates, to be
narrowed by the evidence:

- A deterministic check that names what is waiting on Greg with no published question (sessions in
  *needs you*, `blocked --on greg` work reports), printed where the Overseer already looks.
- A *notice* that needs no decision (deploy held, usage limit hit) as well as questions.
- Rule wording in overseer.md and AGENTS.md: both are rule docs, so the change goes to Greg as
  before/after text in a question, not edited here.

### Stage 5: the questions to Greg

As question files, published, each plain and with a recommendation:

- (c) How mockups should be made and where they should live, with real examples on `/admin/mockups`
  of each approach to compare: ASCII in a question; a wireframe drawn in our own CSS and
  screenshotted; a screenshot of the real app on a branch; an image model through OpenRouter (not
  possible until 1 November, when its monthly limit resets); and whether mockups should be published
  like questions so they are live at once.
- (d) whatever the evidence says needs his decision, including the rule-doc wording.

## What this does not do

- No image-model calls (OpenRouter is over its monthly limit until 1 November).
- No production writes beyond publishing questions; no deploy.
- Discussion is not offered to ordinary readers.

## Simpler options passed over

- **No new kind; use Suggestion and a convention.** Greg said himself he does not strictly need it,
  but that it would signal expectations. A kind is cheap here (one value, one CHECK), and the
  signal is what changes agent behaviour, so it is built.
- **Mockups only as ASCII inside questions** (Stage 2 alone). That is the floor he named, and it is
  built first; but he asked for the page by name and for images, so the page is built too, in its
  cheapest form.

## What the plan review changed

[GPT Sol's review](261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page-plan-review-sol.md):

- **F1 (P1)**: the server must find `docs/mockups/` from `process.cwd()`, not from the module's
  directory (src/vercel.ts says why: the bundle moves it; `certs/` works in production only because
  `PGSSLROOTCERT` is set). `includeFiles` becomes one glob, `{certs,docs/mockups}/**`, pinned by a
  test. Read only inside a mockup route, an absent directory is an empty list, and there is a total
  as well as a per-file size cap. The deploy is checked with a signed-in request afterwards.
- **F2 (P1)**: an `<img src>` sends no bearer header, so images are fetched with `apiFetch` into a
  blob URL, as the feedback screenshot already is; served with `sendBinary`, `private, no-store`, an
  allowlisted type and `nosniff`; the URL names only a validated mockup id and an image's index, never
  a filename.
- **F3 (P1)**: fences and the `Details` line are one line-by-line parser shared by the compiler, the
  server's read and the dialog, so a `Details` inside a fence is drawn, not split on. CRLF is
  normalised. A published row with an unclosed fence is drawn as plain text rather than failing the
  whole list.
- **F4 (P1)**: the mockup-comparison question is published only once the page is deployed and
  checked, and it does not claim an image-model example that cannot exist before 1 November.
- **F5 (P2)**: the saved draft's kind list, the sweep's prompt and priority bands
  (`scripts/overseer-tools/prompt-feedback-sweep.md`, feedback-reports.md) all learn the new kind.
- **F6 (P2)**: Stage 4 is an investigation and a question, not an open-ended build. The one piece of
  tooling built is a line in the tick's existing dialog scan; anything more is a decision for Greg.

## Stage 4's evidence

A Sonnet read of the Overseer's transcript, 2026-10-21 to 2026-10-28 (372 messages, keyword-filtered,
so a floor): of 14 things it said to Greg that needed him, 8 were also published as questions and 6
were not. The six fall into three shapes:

1. **A prompt only Greg may answer** (a dialog in a session's window, a command the permission
   checker refused, approving five AGENTS.md edits): told as *"press 1 in that window"*, never as a
   question. The largest class, and the most recent; `tidy-renames-sweep` was repeated in about 14
   hourly ticks.
2. **"One decision for you later"** tucked into a status message (email templates, a cycle check in
   `typecheck`, a re-import).
3. **The pacer's own instruction**: standing-jobs.md's queue pacer says to collect decisions *"into one
   batched message"*, which is a terminal message.

It knows how to publish (it published 79 files on 2026-10-21); its own rate fell after 2026-10-24,
and most later questions were written by feature sessions. Plain notices (deploy summaries, a check
that could not run) were never published, and the dialog has nowhere to put one.

So the change is mostly wording in overseer.md and standing-jobs.md, which are rule docs: proposed to
Greg as before/after text in a question. Built now, because it reads and changes nothing: the tick's
dialog scan says, for each session at a dialog, whether an open question names it.

## Log

- 2026-10-28: plan written.
