You are reviewing a documentation-restructuring plan for a TypeScript reading app called Spideryarn.
Read-only review — do not edit anything.

Read these, in this order:

1. `docs/plans/260827u-agents-md-slimming.md` — the plan.
2. `AGENTS.md` — the file being slimmed. `CLAUDE.md` is a symlink to it. It is loaded into every
   agent's context on every turn, and it is currently 54KB.
3. Skim `docs/project/` — 45 docs, several of them very large (`security.md` is 67KB,
   `database.md` 37KB, `web-client.md` 34KB).

The context that matters: several AI agents work this repo in parallel, each dropped in with no
memory. `AGENTS.md` is the first and often only thing they read. So the question behind every
judgement here is: **does an agent that reads only the slimmed `AGENTS.md` still do the right
thing?**

Please answer these, concretely, quoting the specific line or row you mean:

1. **What would be lost.** Go through the working-agreements section of `AGENTS.md` line by line. Is
   any of it a rule that an agent would actually violate if it were moved behind a link? The plan
   claims five bullets are safe to compress because the story is written elsewhere — check that
   claim against the target docs (`version-control.md`, `vision.md`, `comments.md`,
   `docs/reusable/codex-cli-as-subagent.md`, `docs/reusable/rename-or-move.md`). Name any fact that
   exists **only** in `AGENTS.md` and would be deleted rather than moved.

2. **The six-overview grouping.** Is it the right cut? Look at the 45 files in `docs/project/` and
   say which ones land in the wrong bucket, which are missing a home, and whether six is the right
   number. In particular: is a short new `security-overview.md` sitting beside a 67KB `security.md`
   a good idea or a confusing one, given renaming `security.md` is off the table (too many
   references, and other agents are editing it)? Suggest a better name or arrangement if you have
   one.

3. **The failure mode of a signpost tree.** Two-level indexes rot: the overview forgets a doc, or a
   new doc gets added with no parent and is invisible. What is the cheapest check that would catch
   that — ideally something scriptable that could join the repo's `npm run check`? Be specific about
   what it would assert.

4. **Blurb length.** The plan says overviews get a blurb in `AGENTS.md` and sub-docs get only a
   filename. Is a bare filename enough for an agent to decide whether to open a doc? Where is the
   real break-even, in your judgement, between "index too thin to be useful" and "index so fat
   nobody reads it"? Answer with reference to how an agent actually searches.

5. **Anything else you would do differently**, and anything in the plan that is simply wrong.

Be blunt and specific. Prefer naming a file and a line over general advice.
