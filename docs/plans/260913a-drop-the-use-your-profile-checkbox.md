# Drop the "Use your profile" checkbox, and always use the profile

Feedback [SPIDERYARN-READING2-3B](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3B), queue
item `qi-r4vaqx33`. Owning doc: [reader-profile.md](../project/reader-profile.md).

> All the places where it has a little checkbox saying "use your profile", and remove that from the
> UI. Just always have it as on. So just assume that we're always going to use the profile, and we
> don't need to include it in the UI to ask them. So the UI is a bit tidier and more compact.
>
> — Greg, 2026-09-12, from an iPad, reading an article in summary mode

## What there is today

One component, `<UseProfile>` in [`src/web/WrittenForYou.tsx`](../../src/web/WrittenForYou.tsx),
draws a row beside every button that spends a model call:

```
  with a profile:     ☑ Use your profile  👤        ← checkbox + the button that opens ProfilePanel
  a self-started run:   Using your profile  👤        ← `automatic`: a sentence instead of the box
  no profile at all:                     👤 Your profile
```

It is used in seven places: the glossary (four rows — Find, Find them again, the two in-list rows,
and the foot's Find more), quotes, ideas, tweets, sketch, and the chat composer (which is also the
Remember panel's composer). The summaries panel no longer has one, although reader-profile.md's
table still says it does. Explain has never had one.

The tick is **not stored anywhere**. Each panel seeds it from the artefact on screen
(`profileHash != null` → ticked; a plain artefact → unticked), and chat holds it in component state
for the session. Unticked, the client sends `useProfile: false`; ticked, it sends nothing, and the
server reads absent as yes.

## What we are building

**Client only.** The checkbox goes, and the `automatic` sentence goes with it. The row becomes the
one button that opens the profile panel, labelled the way the no-profile row already is:

```
  every state:                           👤 Your profile
```

That keeps the way into `ProfilePanel` — what your profile says, and the links to edit both halves —
which GPT Sol's review of 260830c insisted on for the reader with no profile, and which is how a
first profile gets written. It is shorter than any of today's three rows.

- `<UseProfile>` becomes a component with only `slug`, renamed for what it now is (`<ProfileButton>`),
  and the rename is swept across code, tests and docs.
- Every client path that could send `useProfile: false` from a checkbox stops being able to: the
  `useProfile` parameter comes off `find`/`more`/`ensure`/`regenerate`/`write` in `useGlossary`,
  `useQuotes`, `useIdeas`, `useSketch`, `Tweets`, off `StepRun` in `useStepJob`, and off
  `ChatPanel`'s `onSend`/`onSendNew` and their callers in `ConversationModes.tsx` and
  `ChatDialog.tsx`. The panels' `withProfile` state goes.
- **`useChat`'s `opts.useProfile` stays.** `CandidatesPanel` sends `useProfile: false` on purpose —
  it is not a checkbox, it is a feature that must not be pitched at the reader — and that is the one
  remaining client caller.
- `useHasProfile` and the `hasProfile` fields on the hooks go if nothing reads them once the
  checkbox has gone (the button's label no longer depends on it). The server's `hasProfile` on
  `GET /api/reader` is left alone.
- CSS: `.prof-use` and `.prof-said` go; `.prof-row` and `.prof-open` stay.

**The server is untouched.** `useProfile` stays on the API with "absent means yes", because
`CandidatesPanel` depends on it, jobs' `sameWork` keys on it, and an API that still accepts `false`
from a client that no longer sends it costs nothing.

## The reader who has it OFF today

Turning it on for them is a decision, so here it is plainly. There is no stored "off" to migrate,
because the tick was never stored — so the question is what each such reader sees next:

- **Their plain artefacts stay exactly as they are.** A plain artefact carries `profileHash: null`,
  and `null` is never stale ([reader-profile.md § Provenance](../project/reader-profile.md#provenance-what-was-this-written-with-and-is-it-still-true)),
  so nothing lights up, nothing regenerates, and no badge appears.
- **The next rewrite they ask for is written for their profile.** "Find them again", "Write it
  again", Find more — each now sends no `useProfile`, so the server resolves the profile. The
  badge then reads *written for you*.
- **One edge of that:** the glossary's Find more on a plain list now asks for *profiled* terms, and
  `existingFor` refuses to merge a profiled top-up into an unprofiled list — so Find more on a plain
  glossary rewrites it rather than appending. That is the existing, correct behaviour for a
  profile mismatch (reader-profile.md § `existingFor`), and the reader keeps their `?term=` links;
  it is named here because the button's label still says "more".
- **Chat** is per-session state, so a reader who unticked it gets the profile from their next
  question after this deploys (and already did after any reload).
- **The way to not be profiled is now to empty both boxes.** That is a real loss of control, and
  it is the one Greg asked for.

How many readers are in that state is not measured: this session has no production database access,
and a `null` stamp cannot tell "unticked" from "had no profile when it was written" anyway.

## Stages

1. **Remove it.** The component, every call site, the client parameters, `useHasProfile` if
   orphaned, the CSS, and the tests that asserted the checkbox or the sentence — rewritten to assert
   the new row (the button present with its label, in both the profile and no-profile states; no
   checkbox anywhere; a generate request sends no `useProfile`). Docs in the same stage:
   reader-profile.md (§ The two controls, the table, § The client says whether, the
   `null`-never-stale rationale that cites the checkbox), glossary.md's two mentions,
   web-client.md, and the ProfilePanel/api.ts comments that name the checkbox. GPT Sol code review.

That is the whole job; it is one stage because every piece of it is the same removal.

## The simpler option passed over

**Hide the checkbox and leave the plumbing** — drop the `<label>` from `<UseProfile>` and change
nothing else. Five lines. Passed over because it leaves `useProfile` parameters on nine hooks and
callbacks that nothing can now set to `false`, `withProfile` state in five panels that nothing can
change, and a `hasProfile` fetch per panel whose only reader is gone: a control removed from the
screen but not from the code, which the next reader of any of those files has to reverse-engineer.

## Also passed over

- **Removing `useProfile` from the API as well.** More work, and wrong: `CandidatesPanel` needs it.
- **An icon-only button for a reader with a profile.** Tighter still, but 260830c measured a bare
  glyph in a row as saying nothing, and a single label in every state is simpler than two.

## Deferred

- The server's `hasProfile` on `GET /api/reader`, if nothing reads it afterwards.
- "Written for you" stays the only statement of what an artefact used; nothing new replaces the
  `automatic` sentence during a self-started run.
