# Review this plan before it is built

You are reviewing a plan in the Spideryarn repo (this working tree, `/home/greg/code/spideryarn2`).
Read-only: do not edit files. Read `AGENTS.md` first for the house rules.

**The plan:** `docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md`

It reshapes the existing Feedback dialog: three text boxes become one, a nullable
problem/suggestion kind is added, and the box gets the app's existing voice-dictation control. The
three `text` columns behind the old boxes are backfilled into one and **dropped**, which touches the
production table.

## What to read

- `docs/project/feedback.md` — the evergreen doc for the feature.
- `src/web/FeedbackDialog.tsx`, `src/web/FeedbackButton.tsx` — the client half.
- `src/routes.ts` § feedback (search for `FEEDBACK_FIELDS`) — the route, its allowlist, its caps.
- `src/db/schema.ts` § feedback — the columns and every CHECK.
- `src/store/contracts.ts` (`NewFeedback`, `FeedbackReport`), `src/store/pg-feedback.ts`.
- `src/feedback.ts` (`message`, `tagsFor`), `src/feedback-envelope.ts` (`FEEDBACK_TAG_KEYS`).
- `src/types.ts` § feedback — the closed vocabularies and the caps.
- `docs/project/dictation.md` § "Adding it to a box", `src/web/useDictationField.ts`,
  `src/web/AnnotateDialog.tsx` (the closest existing call site).
- `docs/plans/260902l-admin-feedback-page.md` — an unbuilt page that will read these columns.
- `docs/project/database.md` — how migrations are generated and applied here.
- `tests/feedback-*.test.ts*` — what is currently pinned.

## What I want from you

Rank your findings by severity. **For each finding give (a) the concrete failure — the input, the
sequence, or the row state under which the plan as written goes wrong, something I can run or
reproduce — and (b) the smallest change that closes it, as a diff or a code block.** A finding
without (a) is an opinion; put those last and say so.

Do not write a patch into the tree. I want the mutation and the fix, not the edit.

Specific things I already suspect and would rather have confirmed or killed than re-raised as
discoveries — turn each into "here is how it breaks":

1. **The migration split.** The plan generates two drizzle migrations: one adding `body` + `kind`,
   one dropping `steps`/`expected`/`actual` with a hand-written `update … set body = concat_ws(…)`
   prepended before the drops. Is the ordering safe inside one file given how `scripts/db-migrate.ts`
   and drizzle's statement breakpoints work? Is there a window during a Vercel deploy where the
   *old* server code (still selecting `steps`) runs against the *new* schema, and does that matter
   here beyond a brief 500? Is a three-file split (add / custom backfill / drop) actually safer, or
   just more files?
2. **The rate cap.** `charsIn` in `src/store/pg-feedback.ts` feeds a per-owner cap. Moving from
   three 4,000-char fields to one changes what a single report can weigh. Does anything downstream
   (the cap, `MAX_FEEDBACK_BODY_BYTES` in `src/routes.ts`, the Sentry message size) assume the old
   ceiling?
3. **Strictness vs. stale clients.** `FEEDBACK_FIELDS` refuses any unknown key outright. After this
   change, a reader whose browser still has the old bundle posts `steps`/`expected`/`actual` and is
   refused with `[fb-field]` — at exactly the moment they are trying to tell us something is broken.
   Is that acceptable, or should the route accept the old three for a while and fold them into
   `body`? Say which, and why.
4. **The nullable `kind`.** Greg asked for no default: null means "they did not say". Does that
   leave any invariant unstated — in the CHECK, in `tagsFor` (an absent tag vs. a tag with an empty
   value), or in what a future `/admin/feedback` filter would do with it?
5. **The dictation wiring.** The dialog is a native modal `<dialog>` with `onPaste`/`onDrop`
   handlers for screenshots and a ⌘/Ctrl+Enter submit. Does putting `useDictationField` on a box
   inside it break anything the other call sites don't hit — the mic lock, focus restoration after
   `showModal`, `readOnly` vs. the form's Enter handling, or the paste handler eating something?
   Note also that closing the dialog mid-dictation is a case AnnotateDialog does not have.
6. **What the plan does not say.** Anything it silently assumes, any doc it will make wrong, any
   test that will pass for the wrong reason after the change.

Answer in Markdown. Be blunt: if the design is wrong, say what to do instead.
