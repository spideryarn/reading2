# Trawl the session transcripts

Not project-specific. How to answer "is this the first time?" with evidence rather than memory, by
reading what every recent agent said.

Claude Code keeps a transcript of every session as JSONL under `~/.claude/projects/<cwd-slug>/`,
one directory per working directory — so a repo with worktrees has one directory per worktree, all
sharing a prefix. Nobody reads those by hand: a day of work is 50 MB, most of it tool output. The
prose is a few percent of it, and the prose is where the debriefs, the retractions and the
complaints are.

## The recipe

1. **List the transcripts** by modification time, and pick a window:

   ```
   ls -la --time-style=+%Y-%m-%dT%H:%M ~/.claude/projects/<prefix>*/*.jsonl \
     | awk '$6 >= "2026-08-29" {print $6, $5, $7}' | sort > transcripts.txt
   ```

2. **Extract the prose.** Keep only `user` and `assistant` entries, and within them only `text`
   blocks — drop `tool_use`, `tool_result`, and the system-reminder wrappers. One text file per
   session, named by date and worktree so the readers can cite it. The script below did it for 97
   sessions in a few seconds; the 236 MB of transcript became 4.5 MB of prose.

   ```python
   import json, os, sys
   out_dir, listing = sys.argv[1], sys.argv[2]
   for line in open(listing):
       mtime, size, path = line.split()
       sid = os.path.basename(path).replace(".jsonl", "")
       proj = os.path.basename(os.path.dirname(path)).split("--")[-1] or "primary"
       msgs = []
       for raw in open(path, errors="replace"):
           try: e = json.loads(raw)
           except Exception: continue
           if e.get("type") not in ("user", "assistant"): continue
           c = (e.get("message") or {}).get("content")
           texts = [c] if isinstance(c, str) else [b.get("text", "") for b in c or [] if isinstance(b, dict) and b.get("type") == "text"]
           txt = "\n".join(t for t in texts if t.strip())
           if not txt.strip() or txt.startswith("<system-reminder") or txt.startswith("<local-command"): continue
           msgs.append(f"--- {e['type'].upper()} {(e.get('timestamp') or '')[:16]}\n{txt}\n")
       if msgs:
           with open(f"{out_dir}/{mtime[:10]}_{proj}_{sid}.txt", "w") as f:
               f.write(f"# session {sid} in {proj}, last modified {mtime}\n\n" + "\n".join(msgs))
   ```

3. **Split into balanced buckets** by size — about 500 KB each is one Sonnet's comfortable read —
   and give every reader the same prompt. The prompt names the shapes you are looking for, insists
   on reading every file in full rather than grepping for keywords, and fixes an output format:
   for each finding, the session file, the timestamp, who said it, a verbatim quote, a class, and
   whether a doc or policy fix would have addressed it. Ask for Greg's own general sentences
   separately from task instructions.

4. **Read the reports yourself, and check the quotes you use.** The readers are one classifier
   each; where two of them file the same incident under different classes, that is information
   about the classes, not an error. Save each report as it arrives — subagents cannot write files,
   so the report is the return value, and it is gone from context after a while.

5. **Write the working up** under `docs/research/`, quotes and session ids included. The
   transcripts are machine-local and rotate; the research note is what survives.

## What it is for

The question it answers is *how often*, with names attached. "This keeps happening" is a feeling
until eight readers hand back the same shape forty times with timestamps. The first run of this
([260903b-facts-that-were-wrong.md](../research/260903b-facts-that-were-wrong.md)) found the
thing it was sent for, and also the thing that changed the answer: five cases where the rule being
proposed already existed, was loaded, and did not hold.

Run it when Greg says "this is not the first time", and before writing a rule in response.
