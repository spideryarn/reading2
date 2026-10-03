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

The files are not indexed here; list the directory. Two that show the shape, both of a prompt
measured with scripted readers and a blind judge:

- [261003c](../investigations/261003c-tutorial-prompt-leans-to-retention.md) — Tutorial's prompt
  weighted towards the author, old against new, with the old run twice as the control.
- [261003e](../investigations/261003e-explore-sub-mode-against-chat-with-the-notes-tool.md) —
  Explore against Chat with the `reader_notes` tool: a product comparison, the numbers set before
  the run, and the one it did not meet.

## Naming

The same convention as a planning doc — `yyMMdd<letter>-kebab-description.md`, from
`npx tsx scripts/plan-name.ts --dir=investigations "<topic>"`.
[write-planning-doc.md § File naming conventions](../reusable/write-planning-doc.md#file-naming-conventions).

The principles in [research.md § A few principles](research.md#a-few-principles) apply here too:
every number carries its date and the command that produced it, and the dead ends are written down.

---

Up: [vision.md](vision.md)
