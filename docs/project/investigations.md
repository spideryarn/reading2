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
- [261009b](../investigations/261009b-skim-cue-optional-eval.md) — Skim's cue made optional
  (`skim/11`): two thirds of the cues dropped, both judges calling most old ones echoes, three
  wordings in one day, and the ship rule that was not met and was overridden, with the reasons.
- [261007a](../investigations/261007a-the-guide-prompt-first-measurement.md) — two versions of the
  guide's prompt, each run twice, with buttons scored by the renderer's own `chipFor`: the shorter
  second version improved the measured failures, while the client still refused an injected mode.
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
