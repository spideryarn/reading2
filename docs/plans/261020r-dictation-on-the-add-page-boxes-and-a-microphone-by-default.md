# A microphone on the add page's two boxes, and on every prose box by default

Report `spya-wc4vku` (#658, `SPIDERYARN-READING2-MQ`), an admin suggestion from Greg
(`feedback-reporter.ts` exit 0), 2026-10-19 21:54 UTC. Overseer queue item `qi-syvf7st3`.

> In the sort of page that shows after they add something while it's importing, make sure there's a
> dictation button next to the Why are you reading this? input box. And indeed, we really want a
> dictate button next to pretty much all of our input boxes that are going to have more than a few
> words of text typed into them. Let's make a minimal tweak to our docs and/or design system to make
> this more likely going forwards.
>
> — Greg, 2026-10-19

Handed back unbuilt by
[261020a § C2](261020a-add-page-asks-why-higher-and-about-you-says-when-it-is-ready-and-shows-import-progress.md#c2-a-microphone-on-both-add-page-boxes-not-built-here-handed-back-to-the-sweep),
whose Part C plan review ([261020a-part-c-plan-review-sol.md](261020a-part-c-plan-review-sol.md))
found four P1s. Those four are the spec here, and each has its section below.

## Why the add page is the hard place

Every other box with a microphone sits on a page the reader leaves by pressing something. The add
page **leaves by itself**: when the import finishes and neither box is in use, it opens the
article. And dictation's unmount *aborts* — the recording and the transcription with it (the
keeper may offer the words back on the next mount of the same box, but only best-effort). So a
microphone here needs the page to know when one is running, at every exit, not only completion.

## Stage 1 — the two boxes get the microphone

`PurposeBox` and `AboutYouBox` each call `useDictationField` exactly as
[dictation.md § Adding it to a box](../project/dictation.md#adding-it-to-a-box) says: the
`DictationButton` in the label row beside the scope tag, the `DictationStrip` under the textarea,
`readOnly={dictate.readOnly}` on the textarea, `report: dictationReporter("add")` (a new
`DictationSurface`, `"add"`, so a failure says where it happened).

- **Context.** About you: `{ kind: "profile" }`, as `/profile`'s box. Purpose: `{ kind: "article",
  slug }` once `job?.slug ?? completion?.slug` exists, `{ kind: "profile" }` before (Sol P2-5). The
  hook snapshots context at the press, so a slug arriving mid-sentence is safe.
- **Keeper keys** (Sol P1-4): `add:purpose:${wanted}` — `wanted` is the normalised URL or the
  upload id; `source` is empty for every upload and would collide them all — and `add:about-you`,
  source-independent because About you is one field for every article. No reader id: the keeper is
  already partitioned by reader (dictation-keep.ts).
- **A source change while dictating** (the component is reused when the address after `/add/`
  changes) changes the purpose key, so the words come back as `[mic-moved]` and are offered back
  rather than put in the new article's box. That is the existing machinery
  ([dictation.md § Words go only where they were said](../project/dictation.md#words-go-only-where-they-were-said));
  nothing new to build.
- **Commit at the end.** Purpose: `onCommit: purpose.commit`. About you: `onCommit: profile.commit`.
  The hook's `onChange` for purpose is the page's own (`purposeTouchedRef = true`,
  `purpose.setText(v, true)`), so the dictated words are the reader's like typed ones.
- No double press on Stop: neither box sends.

## Stage 2 — nothing saves the rough guesses (Sol P1-3)

Chromium's live guesses arrive through `onChange` before the transcript replaces them.

- **About you**: `useIdleCommit`'s `paused` is `dictate.busy`, as `ProfileBox` does.
- **Purpose**: a new `AddPurposeSession.setPaused(paused)`. While paused the idle timer is not
  armed (and one already armed is cleared), and **a seed that lands is held, not applied**: the box
  keeps the reader's words exactly as they are (no stored purpose adopted into a blank box under a
  live dictation, which would move the text under the hook's span), and nothing is committed. On
  unpause a held seed is applied — the same `seed()` — and that commits; otherwise a dirty box
  re-arms the idle timer. The page calls `setPaused` from the box's busy callback and from a layout
  effect on `[purpose]` that reads the busy ref, so a session replaced mid-dictation (the slug arriving) is paused before its first read can
  answer, since the read is a network round trip.
- Explicit commits are not paused: the blur that pressing the microphone causes commits only the
  pre-dictation words (Sol's closing note). **A hidden tab does not commit the purpose while it is
  dictating** (Sol's plan review P1-1, taken in part): hiding is not an exit, and a rough purpose
  could be read by the first modes before the transcript corrects it. About you's hidden-tab save
  still runs, as `ProfileBox`'s does; the dictation's own commit follows in seconds.
- **At an exit the box's visible words are sent**, rough or not: `pagehide`, unmount, and a
  session retired mid-dictation. The rest of Sol's P1-1 asked for a snapshot of the pre-dictation
  draft to send instead; declined, on the house rule that an exit keeps the words the reader could
  see rather than none (dictation.md § Adding it to a box, *the guard is for a press*; the annotate
  box's Opus arbitration in comments.md), and Opus agreed on 2026-10-20. **Accepted, and named**:
  a session retired mid-dictation while the page carries on — Retry landing on another slug, or
  the source changing — flushes Chromium's rough guesses to the article the reader has moved away
  from, and nothing corrects them. Rare, Chromium-only, and on an article no longer on screen.

## Stage 3 — the page does not leave, or unmount a box, while either is busy

**Busy, said upward** (Sol P1-2). Each box reports `dictate.busy` (armed — including *opening*,
before the device is open — or transcribing) from a layout effect, into two refs on the page
(`purposeBusyRef`, `aboutYouBusyRef`) for same-tick checks, and one piece of state
(`dictating`, their OR) for rendering. Two refs, because one shared boolean is last-writer-wins
across two boxes.

**Every exit checks it:**

1. **Completion** (`useEffect` on `completionKey`): busy counts like focus — the page waits at
   *ready* rather than leaving. Same for the repeat paste's ready-vs-repeat choice.
2. **Both Ready bars' *Open the article***, the purpose box's ⌘/Ctrl+Enter (which is *Open* once
   ready), **Open without saving**, and the repeat's *Open*: refused while busy, and the buttons
   `disabled` (the house rule: a guard and a disabled button, never a lit button that refuses).
3. **The waiting effect** (`phase.opening`): does not `leave` while busy. Busy cannot start there
   anyway — see the next point — but a dictation already transcribing when *Open* was pressed would
   otherwise be cut off when the save lands. Since Open is disabled while busy, this is belt and
   braces, and cheap.
4. **Once Open is waiting** (`phase.opening`, or `phase.kind` `gift` / `opened`), both microphones
   are disabled, so "press Open, then start dictating before the PATCH answers" cannot happen.

**Boxes stay mounted while busy** (Sol P1-1). `showPurpose` is false over a public-copy answer
(`choosing`) and over a failed queue request, and either would unmount a live recording. So
`showPurpose` gains `|| dictating`: a busy box stays on screen through those transitions and goes
when its words have landed. And **the public copy's *Read the public copy* link is disabled while
busy** (it navigates; `chooseOwnCopy` does not — it re-posts and the boxes stay).
`askAboutYouNow` is latched, so About you does not vanish on its own.

The source change is the one transition that is not held: the page is reused for the new
address, the boxes stay mounted, and the purpose key changing does the right thing (Stage 1).

**Not held: the reader's own navigations away.** *Back to the shelf*, a failed job card's ×, the
quota notice's links and the sharing disclosure's Help link stay live while a box is dictating
(Sol's plan review P1-3, declined; Opus agreed). They are a reader choosing to go elsewhere, as on
every other page with a microphone, and the keeper offers the recording back. The Open buttons are
held because they are this page's own next step, pressed right after speaking. Opus flagged the
job card's × as the borderline one — it says *Dismiss* but navigates here — and a one-prop disable
is available if it ever bites.

**Not changed: a purpose typed before a public-copy answer is not saved by *Read the public
copy*** (Sol P1-2, declined; Opus agreed). That is true of a typed purpose today, since the
reader's own copy has no slug to save to, and the draft is back in its box after *Add my own
copy*. The microphone adds no loss: the link is disabled while a box is dictating.

## Stage 4 — tests (Sol P2-6)

A lifecycle test file, `tests/add-page-dictation.test.tsx`, with a fake transcriber and the
existing add-page harness (whatever `tests/add-page*.test.tsx` uses):

- completion while opening / listening / transcribing → page waits at ready, does not navigate;
  when the words land and the box is left, it still waits (the reader was in it — like focus);
- a public-copy answer while busy → box stays mounted, the Read link is disabled; then unmounts
  after the words land;
- both Ready bars' Open, ⌘+Enter and Open without saving are disabled and refuse while busy;
- Open pressed (waiting on a save) → both microphones disabled;
- purpose: a seed landing during a dictation is held and the box unchanged; applied and committed
  after `onEnd`; no idle commit of live guesses (fake timers);
- About you: no autosave while busy;
- two uploads get different purpose keys; a source change mid-dictation yields `[mic-moved]`;
- `dictation_surface: "add"` pinned once.

Plus unit tests of `setPaused` in the existing add-purpose session tests.

## Stage 5 — making it the default (the docs and the design system)

- **A ratchet test**, `tests/prose-boxes-have-a-microphone.test.ts`: every `<textarea` under
  `src/web/` (a recursive scan) is found with **the top-level component it is drawn in**, and that
  component must set up a microphone (`useDictationField`, or a `DictationButton`,
  `DictationStrip` or `ProfileBox` it draws), or be named in an exemption list **with its reason**
  — a specimen on `/design`, a read-only report, an admin-only form, or *not yet: queued in the
  sweep* for the five reader prose boxes found without one: Skim's purpose box, Referee's
  new-criterion box, the Candidates search's scope, rewriting a chat question and editing a
  comment's note. Per component rather than per file (Sol P2-4): a file-level check passed
  `ChatPanel.tsx`, whose question-rewrite box has no microphone. A stale exemption fails too. A
  new textarea without a microphone then fails a test and its author has to decide. Not a lint over `<input>`: a mechanical check cannot tell a prose
  box from a search field, but almost every textarea is prose, and the list is where the
  exceptions say why. The fleet dashboard (`tools/fleet/`) has its own `DictationControl` and is
  out of scope.
- **dictation.md**: the box count (eleven → thirteen, naming the add page's two) and the keeper
  inventory (`add:purpose:<source>`, `add:about-you`); a line in § Adding it to a box pointing at
  this page as the worked example of a box on a page that leaves by itself.
- **controls.md: a row for "takes more than a few words of the reader's prose"**, pointing at
  `useDictationField` and the ratchet test. That is a rule doc, so the exact wording goes to Greg
  as a question file before it is edited
  ([edit-important-docs.md](../reusable/edit-important-docs.md)); nothing in controls.md changes in
  this run.
- **The sweep of the three boxes the ratchet lists as *not yet*** is its own Overseer queue entry
  (each has its own send/leave behaviour to check), filed before the note says shipped.

## The simpler option passed over

**Leave the add page without a microphone and only write the rule.** That was 261020a's choice,
for the reason above. Greg asked for this page by name, so the rule alone would decline the
concrete half of the report.

**Disable the microphone once the import finishes**, rather than holding the page. Simpler — no
held exits — but the moment the import finishes is exactly when a reader is most likely to be
mid-sentence in the box, and a microphone that switches off under them is the loss we are guarding
against, made visible.

## Review

**Plan review, GPT Sol (gpt-5.6-sol, high, read-only), 2026-10-20** —
[261020r-dictation-plan-review-sol.md](261020r-dictation-plan-review-sol.md). *Revise before
build*, five findings. P1-1 taken in part (no hidden-tab commit while dictating) and the rest
declined, P1-2 and P1-3 declined, all three with Opus arbitrating (Stages 2 and 3 say why). P2-4
taken: the ratchet is per component and lists `EditQuestion` and `CommentBody`. P3-5 taken: no
separate purpose-busy state; the replacement effect reads the ref.
