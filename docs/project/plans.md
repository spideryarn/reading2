# Planning docs

`docs/plans/` holds **one file per piece of work**, written before it lands and kept afterwards, so
the reasoning and the evidence survive the work. It is the first place to look when you want to know
why something is the way it is — [find-previous-work.md](../reusable/find-previous-work.md) is how to
search it, and there is a lot to search (1,118 files on 2026-09-06, counting review artefacts:
`ls docs/plans | wc -l`).

**How to write one is [write-planning-doc.md](../reusable/write-planning-doc.md).** This doc is only
the handful of things that are true here in particular.

## Naming

`yyMMdd<letter>-kebab-description.md`, so they sort by the day the work started. Get it from
`npx tsx scripts/plan-name.ts "<description of the work>"` — the letter is the part you cannot work
out for yourself. A plan and its review artefacts share one letter, so they sort together.
[write-planning-doc.md § File naming conventions](../reusable/write-planning-doc.md#file-naming-conventions).

## A few principles

- **Name the simpler option you passed over, and why.** Not what we built — what we didn't, and what
  it would have cost. That is the half nobody can recover afterwards.
  [vision.md § Simpler first](vision.md#simpler-first).
- **A status line has to rest on something.** *Decided, not built — evidence: no hit for
  `realtime_sessions` outside prose.* A plan that says "done" with nothing behind it is prose, and
  prose cannot fail ([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)).
- **A plan is a record, not the documentation.** When a decision in it becomes how the thing works,
  write that into the `docs/project/` doc that owns it. The plan keeps the history; the doc keeps the
  fact.
- **Every plan goes to a cross-family reviewer before it is built, and the code goes back after** —
  [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md). Weight the second review higher.
- **In an unattended run, the questions and assumptions go in the plan doc**, because there is nobody
  in the chat to read them ([feedback-reports.md](feedback-reports.md)).

## See also

- [engineering-manager.md](../reusable/engineering-manager.md) — cutting a job into stages that each
  end committable, and handing them out.
- [research.md](research.md) — a plan says what we're doing; a research doc says what else we could
  have done, and why not.
- [postmortems.md](postmortems.md) — what happens when the plan turns out to have been wrong.

---

Up: [vision.md](vision.md)
