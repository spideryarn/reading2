# Investigation docs

`docs/investigations/` holds **internal work**: evals, model comparisons, prompt or effort
measurements, audits of production data, and spikes against our own code or data. External work —
web or literature deep dives, library or vendor selection, best-practice surveys — goes in
`docs/research/` instead ([research.md](research.md)).

> make sure all such research gets written up in docs/research/ or somewhere similar
>
> — Greg, 2026-10-02

> I realise that my instructions were incorrect. I think we should use docs/research/ for research
> about external stuff (e.g. deep dive web searches), and docs/investigations/ for internal/evals
> stuff.
>
> — Greg, 2026-10-02, the same day

## The rule

**Any eval, model comparison or spike that informs a decision gets a write-up here before the work
is called done.** A plan's § Result or a file under `evals/results/` is not where anyone looks. The
write-up says what was asked, what was measured, what was decided and what was
ruled out. It links to the plan and the raw results rather than copying their tables.

The files are not indexed here; list the directory. A few that show the shape, mostly of a prompt
measured with scripted readers and a blind judge:

- [261003c](../investigations/261003c-tutorial-prompt-leans-to-retention.md) — Tutorial's prompt
  weighted towards the author, old against new, with the old run twice as the control.
- [261003e](../investigations/261003e-explore-sub-mode-against-chat-with-the-notes-tool.md) —
  Explore against Chat with the `reader_notes` tool: a product comparison, the numbers set before
  the run, and the one it did not meet.
- [261005e](../investigations/261005e-explore-prompt-widened-to-critiques-of-the-piece.md) —
  Explore's prompt widened to critiques of the piece: before and after with a scripted critic, a
  blind read inside its control's spread, and the false "no source" claims that took two revisions.
- [261006b](../investigations/261006b-skim-cue-situates-the-quote-eval.md) — Skim's cue asked to
  set the scene its quote assumes, with and without the quote's paragraph: a large gain on the
  question asked, and the two regressions (giving the finding away, misstating the context) that a
  second and third judge question caught.
- [261010a](../investigations/261010a-skim-per-pass-targets-and-walked-growth.md) — Skim's
  per-pass targets and the walked-growth repair (`skim/12` against `skim/11`): the old prompt failed
  to grow in half its runs, the new one in none, at the cost of a smaller Gist on short articles.
- [261011b](../investigations/261011b-skim-more-beats-gist-intros-and-short-stops.md) — `skim/13`:
  More beats Gist by carrying, not by shrinking Gist; a 90-word length rule that moved nothing and a
  marked 60-word one that halved the long stops; the new Gist preferred blind 10–3 against a 3–2
  control; and the pass intros rated, with no giveaways.
- [261017b](../investigations/261017b-skim-figures-as-stops-measured.md) — `skim/14`: figures as
  stops of their own, in four rounds: a figure with its own depth sat beside the wrong stops half the
  time, walking it in its quote's pass fixed that, and making room for it in the pass sizes stopped
  a third of them being trimmed; the quotes held, and a judge control for the intros.
- [261017c](../investigations/261017c-citation-blurbs-cost-and-quality.md) — a blurb per cited
  work, three ways, against gates set before the run: registry abstracts plus one batched Haiku
  call at about a cent an article and 4.6% unsupported, against a web search per work at ~$0.32
  and 17%; an Opus judge, a hand check, and the identity failures a judge cannot see.
- [261018b](../investigations/261018b-front-and-back-matter-eval.md) — front and back matter
  (authors, abstract, contents, thanks, references) found on 52 articles in three sets, two held
  out: a free label rule and one Haiku call, merged and held by code, fold no prose and find 67–96%
  of it; what each held-out set broke, and what is still missed.
- [261018c](../investigations/261018c-modes-say-when-the-piece-is-wrong.md) — `widerWorld` in
  Chat, Recall, Tutorial and Quiz: the piece's wrong date flagged on all four surfaces instead of
  one, labelled, with none of 19 replies judged as using it against the reader; a first wording that
  primed remarks about the reader's answer (6–0 against it on mode shape), and the rewrite that
  brought it to 4–1.
- [261009b](../investigations/261009b-skim-cue-optional-eval.md) — Skim's cue made optional
  (`skim/11`): two thirds of the cues dropped, both judges calling most old ones echoes, three
  wordings in one day, and the ship rule that was not met and was overridden, with the reasons.
- [261019b](../investigations/261019b-guide-plainer-blind-judged.md) — the guide told to suggest
  before it asks, never ask about the reader, and answer a question about a passage briefly: a
  two-turn eval, 19–2 blind against a 12–10 control.
- [261018d](../investigations/261018d-guide-reads-web-pages-measured.md) — the guide given
  `read_web_page`: it opened a page the reader handed it 6 of 6 times (0 before), opened no search
  result and kept sending the subject to Chat, at about $0.025 and 5 s a read; a planted read of the
  reader's About you tried 0 of 3 times; answers a few words longer.
- [261012a](../investigations/261012a-guide-hands-off-to-chat-and-shorter-measured.md) — the guide
  hands a content question to a new Chat (6 of 6 content turns, none of 14 reading turns) and says
  less: median 105 words to 55 on the next-steps eval, 103 to 64 on the broader one.
- [261011a](../investigations/261011a-the-guide-offers-buttons-only-measured.md) — the guide told
  it never opens a mode itself: no answer claimed to have opened one (against 3 of 12 on the old
  prompt), and fewer inline mode buttons in the *expert* case; the eval's empty answers predate it.
- [261007a](../investigations/261007a-the-guide-prompt-first-measurement.md) — two versions of the
  guide's prompt, each run twice, with buttons scored by the renderer's own `chipFor`: the shorter
  second version improved the measured failures, while the client still refused an injected mode.
- [261020e](../investigations/261020e-four-hundred-page-imports-measured.md) — three real PDFs at
  400 pages, before the page cap moves: a book loads (3.1 MB response), dense proceedings only just
  (~4.0 MB, transcription finishing 5 s inside its second window), and a maths book not at all,
  because a window that runs out saves almost none of its chunks; 250 is already marginal for it.
- [261007b](../investigations/261007b-help-chat-model-and-refusals.md) — Ask about Spideryarn on
  Luna against DeepSeek: 24 questions, every off-topic and jailbreak one declined, $0.0068 a question
  cold and $0.0006 warm, a cache that reads across questions and twelve quiet minutes, and the fuse
  sized cold anyway.

## Naming

The same convention as a planning doc — `yyMMdd<letter>-kebab-description.md`, from
`npx tsx scripts/plan-name.ts --dir=investigations "<topic>"`.
[write-planning-doc.md § File naming conventions](../reusable/write-planning-doc.md#file-naming-conventions).

The principles in [research.md § A few principles](research.md#a-few-principles) apply here too:
every number carries its date and the command that produced it, and the dead ends are written down.

---

Up: [vision.md](vision.md)
