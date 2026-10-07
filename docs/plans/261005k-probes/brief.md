# Brief: analyse a batch of the Overseer's auto-memory files for porting into docs in Git

You are one of four subagents doing stage 1 of
`docs/plans/261005k-port-overseer-auto-memory-into-docs.md`. **Read that plan first**, in full, then
`AGENTS.md` § "How we write docs here", then `docs/reusable/edit-important-docs.md` § "What counts
as important here", then `docs/reusable/signposting-and-single-source-of-truth.md`.

Repo: `/home/greg/code/spideryarn2` (the shared primary checkout; other agents are editing here
too). Source: `/home/greg/.claude/projects/-home-greg-code-spideryarn2/memory/<name>.md`.

**You edit no doc.** You analyse, and you write one report file. One writer applies the edits
afterwards, in sequence, so that four agents are not writing to the same docs at once. The only
file you create is your report.

Your batch of memory files is listed in your own prompt. Read each one in full.

## A memory file is several lessons, not one

Split each file into its distinct lessons — most have one to four. A file about a one-day outage
may also carry a lasting lesson about checking an exit code; a file about a credential may mostly
be about when Greg must be asked. Number them (`L1`, `L2`, …) and give **each lesson** exactly one
disposition:

1. **already** — a doc in this repo already says it. Prove it: grep `docs/` and `AGENTS.md` for
   several of the lesson's key terms (commands, error strings, dates, file names), open the hit, and
   read the passage. "Already" means the *lesson and how to act on it* are there, not that the topic
   is mentioned. Record the doc path, the section heading, and a short phrase quoted from the
   passage. If the doc has most of it but lacks a detail a new box would need (a command, a measured
   number, a second failure mode), the missing detail is its own lesson with disposition 2 or 3.
2. **edit** — not in a doc, and it is a **fact or a trap**: a description of how something behaves.
   Write the suggested edit (below) for the **one** doc that owns the subject. Short: the fact, the
   dated evidence in a clause. In that doc's voice, in the section where a reader with that problem
   would look. Not the memory's whole story, not first person, no mention of "memory".
3. **propose** — it would add or change an **obligation, a prohibition, a permission or a required
   workflow**: anything that tells an agent what it may, must or must not do. This holds in every
   doc and every section, a trap list included — "never retry keystrokes" is a rule wherever it
   sits. It also holds for any change at all to `AGENTS.md`, the seven entry-point docs (vision,
   architecture, reading-view-overview, design-css-overview, security-map, code-quality-overview,
   dev-and-deployment-overview) and anything under `docs/reusable/`. Write a numbered before/after
   proposal. **If unsure between 2 and 3, propose.**
4. **dropped** — a claim that is stale (say what you checked in the tree to know it no longer
   holds), about one finished job with nothing transferable, a duplicate of another memory's lesson
   (name it), or about the memory system itself. Drop claims, not files: the other lessons in the
   same file still get their own disposition.

Then, per file, one verdict:

- **eligible** — every lesson is *already* or *dropped*, so the file can be deleted today.
- **retain** — any lesson is *edit* or *propose*. (The orchestrator upgrades *edit* rows after the
  edits land and are checked; *propose* rows stay retained until Greg approves and they land.)

## Hard rules

- **Greg's words.** In your suggested text, quote Greg **only** with a string that appears inside
  quotation marks in the memory file, copied character for character, with the memory's date — and
  mark every such quote in the report's Quotes section so the orchestrator can check it against the
  original transcript. A model wrote the memory, so the quotation marks prove nothing yet. If the
  memory paraphrases him, do not write "Greg said"; write that the Overseer's notes record it, and
  list it under Quotes as a paraphrase. Never compose, tidy, merge or shorten a quote.
- **No secret values, anywhere, the report included.** No key, token, password, connection string,
  IP address or hostname. But **keep the limits**: when a credential may be used, who must be asked,
  and how to use it safely are lessons, not secrets, and are usually disposition 3.
- **Do not delete or edit any memory file.** Do not touch `MEMORY.md`.
- Run no version-control command that changes anything. `git diff HEAD -- <file>` and `git log`
  are fine. Do not run the test suite.
- **Links.** A link in suggested text must point at a file and an anchor that exist;
  `tests/doc-links.test.ts` checks both. Do not suggest a new doc unless nothing owns the subject,
  and say so under Doubts.
- **Verify, don't trust.** Where a memory names a file, flag, script or command, check it still
  exists before repeating it. If the tree contradicts the memory, the tree wins: drop or correct,
  and say so.
- Scratch files, if any, go in the scratchpad with the prefix given in your prompt.

## Your report

Write it with the `Write` tool to the report path given in your prompt (a **new** file in this
folder), and return only a five-line summary. Four parts.

### Table

One row per memory file in your batch: every file, no file twice. The `lessons` cell lists every
lesson with its disposition and target.

| memory file | sha256 (first 12) | lessons | verdict |
|---|---|---|---|
| `example-name` | `0123456789ab` | L1 already: `testing.md` § Heading — "quoted phrase". L2 edit E3. L3 propose P2. L4 dropped: stale, `scripts/x.ts` no longer exists. | retain |

Get the hash from `sha256sum <file>` at the moment you read the file.

### Edits

Numbered with your prefix letter (`AE1`, `AE2`, …). Each: target file and section; **Anchor** (an
exact, unique line already in the file that the new text goes directly after — or the exact text to
be replaced); **Text** (exactly what to insert, ready to paste, wrapped at 100 columns like the
doc); the memory file and lesson it carries.

### Proposals

Numbered (`AP1`, `AP2`, …). Each: target file and section; **Before** (the exact current text, or
"new, after" and the quoted line it follows); **After** (the exact text proposed); one line on why
it belongs there; the memory file and lesson it carries.

### Quotes, and doubts

Every Greg quote or paraphrase used in an Edit or Proposal: the exact string, the date, the memory
file. Then anything you were unsure of, any memory that contradicts a doc, any doc you found out of
date.
