# A typeface for each voice: the author's, the AI's, the reader's (v1)

Report: SPIDERYARN-READING2-7C (`spya-rryap3`), Greg's own, a suggestion, 2026-10-01. Overseer queue
`qi-7ak7nwtp`. Note: [docs/user-feedback/](../user-feedback/) (written at the end).

> I'm leaning towards the idea of using font to distinguish the author-generated from AI-generated
> from user-generated text. Let's use:
> - Courier for all AI-generated text
> - A serif front for the author-text, e.g. Times new Roman
> - Arial or something like that for user-generated
> - and it's just occurred to me that UI text could perhaps be yet another font...!?
>
> Use your judgment. Perhaps try a v1 of this and I'll see how I feel about it, and then we can do a
> v2 that really goes to town if it feels good.
>
> — Greg, 2026-10-01

## What this is for

The app puts three voices side by side — the article, the model, and the reader — and today they are
all Geist. [typography.md](../project/typography.md) already names the cost: *"the article column no
longer looks different from our own chrome. A gist in the column beside a paragraph is now the same
face as the paragraph."* For a product whose point is to augment reading rather than replace it,
being able to tell at a glance *whose words these are* is the point, not decoration.

## Prior work

None. No plan, note or commit mentions a per-voice face; the only `gjd-remote` session matching is
this one. The code-map of where each voice renders was done by a subagent and is summarised in
§ Which elements.

## The v1

### Four faces

| Voice | Face | Why this one |
|---|---|---|
| Author — the article, and verbatim quotes of it | **Source Serif 4** (variable, self-hosted) | Greg said "a serif, e.g. Times New Roman". Times is a newspaper face cut for narrow columns of 9pt print; Source Serif is a screen serif in the same tradition, and it is *variable*, so `--reading-weight: 450` (the dark-mode thickening, typography.md § Weight) keeps working. System Times varies by device (Liberation Serif on Linux, Noto Serif on Android) and has no 450. |
| AI — everything a model wrote | **Courier Prime** (self-hosted) | Greg said Courier. Courier New is a hairline face at screen sizes, worse light-on-dark; Courier Prime is Courier redrawn to be read at body size. It is still unmistakably Courier, which is the signal Greg asked for. |
| Reader — what the reader typed | **Arial** (`Arial, Helvetica, 'Liberation Sans', sans-serif`) | Greg's word, no download. Most devices have one of the three; the rest get their generic sans. |
| UI — chrome | **Geist**, unchanged | The fourth face Greg wondered about. Leaving the chrome as it is *is* the fourth face: once the other three move off Geist, Geist means "the app". Changing ~150 chrome rules is the v2 if this feels right. |

**Simpler option passed over: the three system fonts exactly as named** (`Courier New`, `Times New
Roman`, `Arial`), with no new dependency. Turned down for the two reasons in the table — a hairline
Courier on a dark ground risks Greg judging the idea by an incidental ugliness, and system Times differs
by device. The cost is two `@fontsource` packages, the same mechanism Geist already uses
([`tailwind.css`](../../src/web/tailwind.css)); `@font-face` files download only when a rule uses
them, so a reader with the v1 off downloads nothing new.

### Behind the Experimental switch

The v1 is on only for readers with [Experimental features](../project/experimental-features.md)
on — Greg is one, most readers are not. Greg asked to *try* it and *see how he feels*; a Courier
summary for every paying reader is a lot to ship as an experiment, and the switch exists exactly for
that. Mechanism: `Reader` already calls `useExperimental()`; a hook,
[`useVoiceFaces`](../../src/web/useVoiceFaces.ts), sets `data-voices` on `<html>` while it is on and
takes it off when the last enabled reading view unmounts, and every rule in a new
`src/web/styles/voices.css` is
scoped under `:root[data-voices]`. **`Reader`, not `App`**: `App` deliberately does not subscribe to
the switch, so that pages which do not need it never ask `GET /api/reader` (App.tsx § nothing here
wakes it) — so the v1 is the reading view only, and `/profile`, Metadata and the shelf keep Geist. A
signed-out reader is off by the switch's own rules. It is every Experimental reader, not only Greg.

**Loading:** Fontsource uses `font-display: swap` and the switch arrives after the first paint, so a
reader with it on can see Geist, then a fallback, then the downloaded faces, and the article's line
breaks move with each. Accepted for an experiment; worth a `preload` if it is promoted.

**If Greg likes it**, promoting it is deleting the attribute guard. **If not**, it is deleting one
stylesheet, one effect and two imports.

### One stylesheet that names every voice

`voices.css` is the whole decision in one file: three blocks, author / AI / reader, each set to
`var(--font-author)`, `var(--font-ai)`, `var(--font-reader)`. Most selectors already existed; narrow
wrappers and modifiers separate mixed-provenance text from neighbouring UI copy. No other
stylesheet's rules change. Specificity does the work: `:root[data-voices] .x` outranks `.x`; the
file loads after the application sheets except the logo animations, in the same `app` layer, while
the later Tailwind utility layer still wins.

New tokens in [`styles/tokens.css`](../../styles/tokens.css): `--font-author`, `--font-ai`,
`--font-reader`. `--font-reading` and `--font-ui` are untouched, so with the switch off nothing moves.

### Which elements

v1 covers the surfaces a reader actually sits in; it does not chase every class. From the code map:

- **Author:** `.prose` (the article), `.quotes-text`, `.cmt-quote`, `.annotate-quote`,
  `.chat-dialog-quote`, `.chat-dialog-opening`, `.dock-question-quote`, `.ill-quote`,
  `.note-preview`, glossary's found passage, `.faq-quote`, `.ideas-quote`, `.tl-quote`,
  Timeline's quoted date words, `.srch-hit-quote`, `.clm-quote`, `.crit-quote`, `.mir-quote`,
  `.mir-passage`, `.traj-words`
  (including its full-quote card), block-link cards, `.prose-card-quote`, `.cite-entry`, and the
  article's claim in Debate.
- **AI:** summaries and gists (`.summ-text`, `.summ-question`, `.struct-gist`, `.outln-gist`,
  `.outln-arc`, `.outln-card-gist`, `.root-gist`, `.tip-gist`, `.tip-navlabel`), glossary
  (`.gloss-gloss`, `.gloss-part-text` — see below), the link card's own words
  (`.prose-card-part-relation`, `-why`, the term card's parts), ideas (`.ideas-name`,
  `.ideas-reason`), FAQ questions, quiz questions and marking (`.quiz-premise`, `.quiz-question`,
  `.quiz-list-q`, `.quiz-reply`, `.quiz-reference-text`, `.quiz-in-prose-q`), chat replies
  (`.chat-turn.model`), the
  comment's Explanation (`.cmt-answer`), Simple (`.simple-text`), Trajectory cues, timeline labels,
  citations' reasons, search's *why*, referee's reasons and Candidates answers/shortlist, the live
  conversation's companion transcript, Debate's AI fence (`.dbt-ai`) and its theme labels and gists.
- **Reader:** `.chat-turn.you`, the chat composer, edit and rename boxes, the comment note (`textarea.cmt-note`,
  `p.cmt-body`), the annotate textarea, follow-up input, `.dock-question-state.own`, `.mir-yours`,
  `.quiz-answer`, the search and glossary-ask inputs and saved searches, Trajectory's purpose,
  referee criteria (the editor, poles and saved rows), Mirror's repeated criteria, and Candidates'
  questions and composer, and the reader's side of the live transcript.

**Mixed classes, decided:** `.gloss-part-text` carries both voices across four modes; it is AI except
FAQ's passages (`.faq-quote`, the author's words) and Timeline's (`.tl-detail`, where one paragraph
holds a quoted phrase *and* our own note, so it stays UI). `.summ-text.missing` and other empty-state
lines are the app's, and stay Geist. A chat reply that quotes the article stays
all-AI in v1 — the face is "who said this sentence to you", and the model did.
Ideas' fixed group explanation stays UI; it is our explanation, not model output. The fixed
*whole paragraph — the exact words have moved* fallback stays UI in Ideas and Timeline. Claims'
fixed withheld-reason sentence stays UI while the model's ordinary reason is AI. Mirror's fallback
block id stays in its old face when the comment that would supply the quote cannot be found. A
fixed phrase that spells out the citation lookup's verdict stays UI, although the model chose the
verdict; the model's free-text account of what the work does remains AI.

**Section titles stay UI.** A tree node's `title` is model-written but told to copy the author's
heading verbatim, and only the spine's tooltip can tell which (`sourceHeading`). Putting titles in
Courier would mark the author's own headings as AI; putting them in serif would do the reverse. v2:
read `sourceHeading` per node.

**Not in v1:** third-party text (Wikipedia extracts, link blurbs, Debate's web quotes) — a fifth voice
the code map found; the marketing and shelf pages; `tw:font-prose` on Metadata and the shelf; the
Diagram SVG, whose title and gist lines share one `<text>`.

**The ordinary block-id affordances are Courier already** (`--font-id`, Greg's ask). Under the v1
they will look like AI text. Mirror's missing-comment fallback is the pre-existing exception: it
shows an id in the UI face. Left alone as wider than this stage, and named here for Greg to decide
in v2.

## Stages

1. **Build** — tokens, the two font packages, `voices.css`, `useVoiceFaces` in `Reader`, the `/design`
   FACES table, [typography.md](../project/typography.md) and
   [experimental-features.md](../project/experimental-features.md). Tests: a guard that every class
   `voices.css` names exists in a rendered `src/web` className (a renamed class would otherwise drop
   out of the v1 silently), and that the attribute follows the switch. GPT Sol code review.
2. **Look** — screenshots at laptop and phone width, switch on and off, of the article, Summary,
   Glossary, chat and a comment, by a Sonnet browser subagent. Adjust sizes if Courier Prime's width
   or the serif's x-height clash with the neighbours (a size tweak is expected, not a failure).
   Screenshots go in this doc.
3. **Land** — push to `dev`, the note, `feedback-endings.ts`.

## Open questions for Greg (v2)

- Does the serif stay at Geist's size, or does it want a step up (serifs read smaller)?
- Section titles: tag each by `sourceHeading`?
- Block ids: still Courier, now that Courier means "AI"?
- Promote out of the Experimental switch?

## Progress

- 2026-10-01 — plan written.
- 2026-10-01 — **GPT Sol, plan review** (read-only): *request changes — keep the gate and the four
   faces; correct the inventory, settle App versus Reader, and test that selectors apply.* Taken:
  missing AI text added (quiz reference answer, citation investigation, Debate's threads, key-source
  reason and relation, chat headings `.fmt-h`, which declare their own face and so do not inherit);
  `.srch-saved-criterion` added to the reader; `.summ-text.missing` and Timeline's
  `.gloss-part-text` excluded; the `/profile` selectors dropped, since the attribute is set only by
  the reading view; the plan's "App already calls it" was wrong and is now `Reader`. A second test
  checks every compound selector (`.chat-turn.model`) appears together in one component className,
  red-checked by mutation. Not taken: a jsdom computed-style test (jsdom's cascade is not the
  browser's) — the browser pass below reads computed styles in real Chrome instead. The masthead
  title stays Geist: the owner can rename it, so it is not reliably the author's.
- 2026-10-01 — **first browser pass** (Sonnet, Playwright, laptop and phone, seeded account,
  `fowler-phrenology`): serif and Courier Prime computed and loaded (latin subsets `loaded`, no
  fallback); Courier does not overflow the gutter, glossary or chat; the reader's chat message is
  Arial. One defect: the article's `h1`/`h2` stayed Geist, because `shell.css` gives `h1` its own
  face — fixed with `.prose :is(h1…h6)`. The prose column sits ~80px further right with the serif,
  because the serif is narrower and the 65ch column is centred; not a bug. A long URL clips at
  phone width — the serif is narrower than Geist, so that is not new.
- 2026-10-01 — **GPT code review/fix:** the document gate now counts coexisting enabled Readers,
  so one unmount cannot disable another; a red-first test covers that and StrictMode's rehearsal.
  The selector audit added author quotations that inheritance had left in Geist, the missing Ideas,
  Candidates, Debate and live-conversation model text, and the missing chat, Referee, Candidates
  and live-conversation reader text. Mixed UI copy now stays Geist rather than inheriting a
  neighbouring voice. The CSS contract test pins these
  representative inheritance-breaking and mixed-provenance cases, checks every top-level selector
  branch is gated, and parses className literals so a class mentioned only in a comment cannot pass.
