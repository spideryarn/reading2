# Audit architecture mode

> **Provenance.** Copied 2026-08-31 from
> [`docs/instructions/AUDIT_ARCHITECTURE_MODE.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/AUDIT_ARCHITECTURE_MODE.md)
> in gregdetre/gjdutils — see [gjdutils-instructions.md](gjdutils-instructions.md). Close to
> verbatim; only the list of background docs is adapted to what this repo actually has.

Perform a technical audit/review.

- If a feature/area/question/file has been mentioned, use that to guide your investigation.
- If a planning doc has been mentioned, check whether recent changes (e.g. recent related Git
  commits, and also uncommitted changes) implement the planning doc correctly.
- Look for bugs, gotchas, potential problems
- Is there anything you would refactor (e.g. too-large files/functions, near-duplicated code that
  could be reused), or architectural best practices we should use?
- Anything else you notice that could be improved?
- Zoom out to consider whether the overall strategy/approach is sound.

For background, read the relevant docs. Here that means:

- [AGENTS.md](../../AGENTS.md) — the working agreements, and the map of everything else
- [vision.md](../project/vision.md) — what we're trying to do, and what we're deliberately not doing
- whichever of the seven entry-point docs covers the area, and the docs beneath it
- the planning doc in `docs/plans/`, if there is one — see
  [write-planning-doc.md](write-planning-doc.md)
- [silent-success.md](silent-success.md) — the failure shape most of this repo's bugs have had

Don't make changes. Just investigate, discuss. Its doing counterpart, for when the job is to land
the rework rather than report it, is [improve-the-codebase.md](improve-the-codebase.md).

Output:

- Prioritise recommendations based on a combination of ease and value.
- Indicate how important each finding is and why, whether there's an obvious fix or multiple
  options, and how complex/risky you expect it to be.

Ultrathink.
