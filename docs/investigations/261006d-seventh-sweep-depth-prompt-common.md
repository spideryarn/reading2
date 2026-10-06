# Depth investigation for a whole-codebase sweep (read-only)

The brief every depth reader of the seventh sweep was given, GPT Sol and Opus alike; each also got
one of the four zone briefs beside this file
(`261006d-seventh-sweep-depth-prompt-<zone>.md`). Umbrella:
[261006m](../plans/261006m-seventh-codebase-sweep-depth-umbrella.md).

You are doing the **depth stage** of a periodic codebase sweep of this repo (Spideryarn, an
AI-assisted reading app: TypeScript, one server process, Postgres via Drizzle, a React client).
Tree: the current checkout, at `origin/dev` of 2026-10-06. **Do not change any tracked file.** Your
final answer IS the investigation document (markdown).

## Read first

- `docs/reusable/improve-the-codebase.md` — the method and the bar. Its tests (deletion test, YAGNI,
  "prove the drift", "the fix is a separate claim") apply to everything you propose.
- `docs/plans/261006j-sixth-codebase-sweep-umbrella.md` — yesterday's sweep. Its second-family
  breadth pass was "a light pass ... a weak null", and it ran no depth stage: **this zone was not
  read file by file. That is your job.** Read its § Considered and rejected and § After the
  clusters.
- `docs/plans/261003f-fifth-codebase-sweep-umbrella.md` § Held, § Considered and rejected — do not
  re-propose what is refused there (splitting files by size, a mode registry, a generic
  artefact-read hook, a generic stream shell, moving the httpError constructors, pruning knip
  exports, promoting lint, a sleep ban) unless you bring NEW evidence of drift or a defect, and say
  what is new.
- The fifth sweep's investigation of this zone, named in the zone brief, so you extend it rather
  than repeat it.

## How to work

- **Read properly, file by file, not grep-and-skim.** Prefer depth on fewer files to a shallow pass
  over many. Choose within the zone by churn x complexity x bug history
  (`git log --since=2026-09-20 --format= --name-only -i --grep=fix -- <path> | sort | uniq -c | sort -rn`,
  and `ls docs/postmortems | grep ^26100[3-6]`; read the postmortems that name your zone).
- What to look for, in order of worth:
  1. **Live defects** (Tier 0): a reachable call path that does the wrong thing. Give the input that
     shows it, and say whether you reproduced it, proved it from the code, or only suspect it.
  2. **A class that could be killed by construction**: a type, a narrower signature, a required
     parameter, one owner for a fact two places keep "in step by comment".
  3. **Siblings that drifted**: the same kind of read, state, control, route, job or error handled
     differently from one mode/route/step to the next for no written reason; a fix that reached one
     copy and not the others (name the fix commit). Greg, the owner, 2026-10-06: "looking for
     inconsistencies across modes is a good thing to try and improve".
  4. **Two mechanisms for one job**; dead code and dead branches; false comments; a decision that
     lives only in a commit body.
  5. Extractions — only where drift is PROVED and the deletion test passes.
- Every finding: an ID (the zone's prefix + a number), `file` + a content anchor (line numbers go
  stale; quote the identifier or a short phrase), **evidence state** (R reproduced / C proved from
  code / H hypothesis), tier (0 live defect, 1 cheap mechanical, 2 extraction needing a
  characterisation test, 3 rearchitecture: name and size only), ease 1-5, value 1-5, risk, and the
  proposed fix as a SEPARATE claim (what already exists that it might duplicate?). For Tier 0, the
  failing input and the smallest change that closes it.
- A quantifier means you counted: show the grep and the count.
- Anything that is a product trade-off, changes what a reader sees, or is hard to reverse: put it
  under "For the owner", plainly, with what it removes and what it costs. Do not design it.

## The document to write

```
# Seventh sweep, depth: <zone>  (<model>, read-only, 2026-10-06)
## What I read  (files read in full / in part / skipped, and why chosen)
## What the method could not see
## Findings  (ranked by ease x value; Tier 0 first)
## Siblings compared  (a small table: the thing, each sibling, how each handles it)
## For the owner
## Considered and not proposed  (with the reason)
## One level up  (is the zone's overall approach sound? one paragraph)
```

Be concrete and brief. No praise, no restating the brief. If you find little, say so and say how
hard you looked; a short honest doc beats a padded one.
